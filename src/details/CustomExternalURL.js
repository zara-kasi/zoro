const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

class CustomExternalURL {
  constructor(plugin) {
    this.plugin = plugin;
  }

  // Auto-format URL - removes everything after equals sign
  formatSearchUrl(url) {
    if (!url || !url.trim()) return '';
    
    const trimmedUrl = url.trim();
    const equalsIndex = trimmedUrl.indexOf('=');
    
    if (equalsIndex !== -1) {
      return trimmedUrl.substring(0, equalsIndex + 1);
    }
    
    // If no equals sign, add common search parameter
    if (trimmedUrl.includes('?')) {
      return trimmedUrl + (trimmedUrl.endsWith('?') ? 'q=' : '&q=');
    } else {
      return trimmedUrl + '?q=';
    }
  }
  
  // Smart template learning from user examples
  learnTemplateFromExample(url, searchTerm = 'zoro zoro') {
    if (!url || !searchTerm) return null;
    
    try {
      // Always keep a constant base term to detect space replacement
      const baseTerm = 'zoro zoro';
      let foundTerm = searchTerm;

      // First, try to find the exact search term
      let searchIndex = url.toLowerCase().indexOf(searchTerm.toLowerCase());
      
      if (searchIndex === -1) {
        // If not found, try to find variations of "zoro zoro"
        const variations = [
          'zoro zoro',
          'zoro-zoro',
          'zoro+zoro',
          'zoro_zoro',
          'zoro/zoro',
          'zoro%20zoro',
          'zoro%2Bzoro'
        ];
        
        for (const variation of variations) {
          const idx = url.toLowerCase().indexOf(variation.toLowerCase());
          if (idx !== -1) {
            searchIndex = idx;
            foundTerm = variation; // Keep which representation appears in the URL
            break;
          }
        }
      }
      
      if (searchIndex === -1) return null;
      
      // Extract template (everything before the search term)
      const template = url.substring(0, searchIndex);
      
      // Extract the search term as it appears in the URL
      const actualSearchTerm = url.substring(searchIndex, searchIndex + foundTerm.length);
      
      // Detect space replacement pattern using the base term
      const spacePattern = this.detectSpacePattern(baseTerm, actualSearchTerm);
      

      
      return {
        template: template,
        spacePattern: spacePattern,
        originalUrl: url,
        searchTerm: baseTerm
      };
    } catch (e) {
      return null;
    }
  }
  
  // Detect how spaces are replaced in the URL
  detectSpacePattern(originalTerm, urlTerm) {
    if (originalTerm === urlTerm) return ' ';
    
    // Handle the case where "zoro zoro" becomes "zoro-zoro" (no space)
    if (originalTerm === 'zoro zoro' && urlTerm === 'zoro-zoro') {
      return '-';
    }
    
    // Handle the case where "zoro zoro" becomes "zoro+zoro" (no space)
    if (originalTerm === 'zoro zoro' && urlTerm === 'zoro+zoro') {
      return '+';
    }
    
    // Handle the case where "zoro zoro" becomes "zoro_zoro" (no space)
    if (originalTerm === 'zoro zoro' && urlTerm === 'zoro_zoro') {
      return '_';
    }
    
    // Handle the case where "zoro zoro" becomes "zoro/zoro" (no space)
    if (originalTerm === 'zoro zoro' && urlTerm === 'zoro/zoro') {
      return '/';
    }
    
    // Handle the case where "zoro zoro" becomes "zoro%20zoro"
    if (originalTerm === 'zoro zoro' && urlTerm === 'zoro%20zoro') {
      return '%20';
    }
    
    // Handle the case where "zoro zoro" becomes "zoro%2Bzoro"
    if (originalTerm === 'zoro zoro' && urlTerm === 'zoro%2Bzoro') {
      return '%2B';
    }
    
    // For more complex cases, try to detect the pattern
    const originalWords = originalTerm.split(' ');
    const urlWords = urlTerm.split(/[+\-\/_%]/);
    
    if (originalWords.length !== urlWords.length) return ' ';
    
    // Find the separator used between words
    const separators = ['+', '-', '_', '/', '%20', '%2B'];
    
    for (const separator of separators) {
      if (urlTerm.includes(separator)) {
        return separator;
      }
    }
    
    return ' ';
  }
  
  // Build URL using learned template
  buildUrlWithTemplate(template, title, spacePattern) {
    if (!template || !title) return template;
    
    // Replace spaces with the detected pattern
    const encodedTitle = title.replace(/\s+/g, spacePattern);
    
    // Handle special cases
    if (spacePattern === '%20') {
      return template + encodeURIComponent(title);
    } else if (spacePattern === '%2B') {
      return template + encodeURIComponent(title).replace(/%20/g, '%2B');
    } else if (spacePattern === ' ') {
      // Space in URLs should be encoded
      return template + encodeURIComponent(title);
    }
    
    return template + encodedTitle;
  }
  
  // Build URL using learned template with proper replacement
  buildUrlWithTemplateAndReplacement(template, title, spacePattern, originalSearchTerm) {
    if (!template || !title) return template;
    
    // Replace spaces with the detected pattern
    const encodedTitle = title.replace(/\s+/g, spacePattern);
    
    // Handle special cases
    if (spacePattern === '%20') {
      return template + encodeURIComponent(title);
    } else if (spacePattern === '%2B') {
      return template + encodeURIComponent(title).replace(/%20/g, '%2B');
    } else if (spacePattern === ' ') {
      // Space in URLs should be encoded
      return template + encodeURIComponent(title);
    }
    
    return template + encodedTitle;
  }
  
  // Extract basic template from URL when no "zoro zoro" is found
  extractBasicTemplate(url) {
    if (!url) return null;
    
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part);
      
      // Look for common search patterns
      if (pathParts.includes('search')) {
        // URL like: https://sflix2.to/search/zoro-zoroThe%20Godfather
        const searchIndex = pathParts.indexOf('search');
        if (searchIndex !== -1 && searchIndex < pathParts.length - 1) {
          // Extract everything up to and including /search/
          const template = urlObj.origin + '/' + pathParts.slice(0, searchIndex + 1).join('/') + '/';
          
          // Try to detect the pattern from the remaining parts
          const remainingParts = pathParts.slice(searchIndex + 1);
          if (remainingParts.length > 0) {
            const firstPart = remainingParts[0];
            // Look for "zoro" in the first part
            if (firstPart.toLowerCase().includes('zoro')) {
              // Extract the pattern after "zoro"
              const zoroIndex = firstPart.toLowerCase().indexOf('zoro');
              const afterZoro = firstPart.substring(zoroIndex + 4); // "zoro" is 4 characters
              
              // Detect the pattern
              let spacePattern = ' ';
              if (afterZoro.startsWith('-')) spacePattern = '-';
              else if (afterZoro.startsWith('+')) spacePattern = '+';
              else if (afterZoro.startsWith('_')) spacePattern = '_';
              else if (afterZoro.startsWith('/')) spacePattern = '/';
              else if (afterZoro.startsWith('%20')) spacePattern = '%20';
              else if (afterZoro.startsWith('%2B')) spacePattern = '%2B';
              
              return {
                template: template,
                spacePattern: spacePattern,
                originalUrl: url,
                searchTerm: 'zoro zoro'
              };
            }
          }
        }
      }
      
      // If no specific pattern found, try to extract a general template
      const lastSlashIndex = url.lastIndexOf('/');
      if (lastSlashIndex !== -1) {
        const template = url.substring(0, lastSlashIndex + 1);
        return {
          template: template,
          spacePattern: '-', // Default to dash
          originalUrl: url,
          searchTerm: 'zoro zoro'
        };
      }
      
      return null;
    } catch (e) {
      return null;
    }
  }

  // Validate if URL has proper search format
  isValidSearchUrl(url) {
    if (!url || !url.trim()) return false;
    
    try {
      new URL(url);
      return url.includes('=');
    } catch (e) {
      return false;
    }
  }

  // Extract clean domain name for button text
  extractDomainName(url) {
    try {
      // Support learned template JSON by using originalUrl or template for domain extraction
      let sourceUrl = url;
      if (typeof url === 'string') {
        const trimmed = url.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const data = JSON.parse(trimmed);
            if (data?.originalUrl) sourceUrl = data.originalUrl;
            else if (data?.template) sourceUrl = data.template;
          } catch {}
        }
      }

      const urlObj = new URL(sourceUrl);
      let domain = urlObj.hostname;
      domain = domain.replace(/^www\./, '');
      const parts = domain.split('.');
      if (parts.length >= 2) {
        domain = parts[parts.length - 2];
      }
      return domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase();
    } catch (e) {
      return 'Search';
    }
  }

  // Get best title from media object
  getBestTitle(media) {
    return media.title?.english || 
           media.title?.romaji || 
           media.title?.native || 
           'Unknown Title';
  }

  // Build search URL with encoded title
  buildSearchUrl(template, title) {
    if (!template || !title) return template;
    
    try {
      // Check if this is a learned template (JSON string)
      if (template.startsWith('{') && template.endsWith('}')) {
        const templateData = JSON.parse(template);
        if (templateData.template && templateData.spacePattern) {
          // Use the template with proper replacement
          const result = this.buildUrlWithTemplateAndReplacement(
            templateData.template, 
            title, 
            templateData.spacePattern, 
            templateData.searchTerm
          );
          
          return result;
        }
      }
      
      // Regular URL template
      const encodedTitle = encodeURIComponent(title);
      return template + encodedTitle;
    } catch (e) {
      return template + title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '+');
    }
  }

  // Add new URL to settings
  async addUrl(mediaType, url = '') {
    if (!this.plugin.settings.customSearchUrls[mediaType]) {
      this.plugin.settings.customSearchUrls[mediaType] = [];
    }
    
    let finalUrl = url.trim();
    
    if (this.plugin.settings.autoFormatSearchUrls) {
      // Auto-format URL
      finalUrl = this.formatSearchUrl(url);
    } else {
      // Learn template from example if it contains "zoro zoro" or variations
      const template = this.learnTemplateFromExample(url, 'zoro zoro');
      if (template) {
        // Store the learned template instead of the raw URL
        finalUrl = JSON.stringify(template);
      } else {
        // If no template learned, try to extract a basic template
        const basicTemplate = this.extractBasicTemplate(url);
        if (basicTemplate) {
          finalUrl = JSON.stringify(basicTemplate);
        }
      }
    }
    
    this.plugin.settings.customSearchUrls[mediaType].push(finalUrl);
    await this.plugin.saveSettings();
    return finalUrl;
  }

  // Remove URL from settings
  async removeUrl(mediaType, index) {
    if (this.plugin.settings.customSearchUrls[mediaType]) {
      this.plugin.settings.customSearchUrls[mediaType].splice(index, 1);
      await this.plugin.saveSettings();
    }
  }

  // Update URL in settings
  async updateUrl(mediaType, index, newUrl) {
    if (this.plugin.settings.customSearchUrls[mediaType] && 
        this.plugin.settings.customSearchUrls[mediaType][index] !== undefined) {
      let finalUrl = newUrl.trim();
      
      if (this.plugin.settings.autoFormatSearchUrls) {
        // Auto-format URL
        finalUrl = this.formatSearchUrl(newUrl);
      } else {
        // Learn template from example if it contains "zoro zoro" or variations
        const template = this.learnTemplateFromExample(newUrl, 'zoro zoro');
        if (template) {
          // Store the learned template instead of the raw URL
          finalUrl = JSON.stringify(template);
        } else {
          // If no template learned, try to extract a basic template
          const basicTemplate = this.extractBasicTemplate(newUrl);
          if (basicTemplate) {
            finalUrl = JSON.stringify(basicTemplate);
          }
        }
      }
      
      this.plugin.settings.customSearchUrls[mediaType][index] = finalUrl;
      await this.plugin.saveSettings();
      return finalUrl;
    }
  }

  // Get URLs for specific media type
  getUrls(mediaType) {
    // Map MOVIE and TV to MOVIE_TV for unified search URLs
    const mappedType = (mediaType === 'MOVIE' || mediaType === 'TV') ? 'MOVIE_TV' : mediaType;
    return this.plugin.settings.customSearchUrls?.[mappedType] || [];
  }

  // Create search buttons for panel
  createSearchButtons(media, container) {
    const customUrls = this.getUrls(media.type);
    if (!customUrls || customUrls.length === 0) return;

    const mediaTitle = this.getBestTitle(media);
    
    customUrls.forEach(url => {
      if (url && url.trim() !== '') {
        const domainName = this.extractDomainName(url);
        const searchBtn = document.createElement('button');
        searchBtn.className = 'external-link-btn zoro-custom-external-btn';
        searchBtn.innerHTML = `🔍 ${domainName}`;
        searchBtn.onclick = (e) => {
          e.stopPropagation();
          try {
            const searchUrl = this.buildSearchUrl(url, mediaTitle);
            window.open(searchUrl, '_blank');
          } catch (error) {
            console.error('Failed to open search URL:', error);
          }
        };
        container.appendChild(searchBtn);
      }
    });
  }
}

export { CustomExternalURL };