const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

class RenderDetailPanel {
  constructor(plugin) {
    this.plugin = plugin;
  }

  createPanel(media, entry) {
    const fragment = document.createDocumentFragment();
    
    const panel = document.createElement('div');
    panel.className = 'zoro-more-details-panel';

    const content = document.createElement('div');
    content.className = 'panel-content';

    const sections = [];

    sections.push(this.createHeaderSection(media));
    sections.push(this.createMetadataSection(media, entry));
   
   if (media.type === 'ANIME' && media.nextAiringEpisode) {
      sections.push(this.createAiringSection(media.nextAiringEpisode));
    }

    if (media.averageScore > 0) {
      sections.push(this.createStatisticsSection(media));
    }

    if (media.genres?.length > 0) {
      sections.push(this.createGenresSection(media.genres));
    }

    sections.push(this.createSynopsisSection(media.description));
    sections.push(this.createExternalLinksSection(media));

    sections.forEach(section => content.appendChild(section));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close-btn';
    closeBtn.innerHTML = '×';

    panel.appendChild(closeBtn);
    panel.appendChild(content);

    // Add copy functionality styles
    this.addCopyStyles();

    return panel;
  }

  addCopyStyles() {
    // Styles are now handled externally in CSS file
    // This method can be removed or kept empty for backward compatibility
    return;
  }

  createCopyButton(type, data) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'zoro-copy-btn';
    copyBtn.createEl('span', { text: '📋' });
    copyBtn.title = 'Copy';

    // Direct copy on click - no dropdown
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      
      let textToCopy = '';
      if (type === 'title') {
        // Copy the best available title
        textToCopy = data.title?.english || data.title?.romaji || data.title?.native || 'Unknown Title';
      } else if (type === 'synopsis') {
        textToCopy = this.cleanSynopsis(data);
      }
      
      this.copyToClipboard(textToCopy, copyBtn);
    };

    return copyBtn;
  }

  cleanSynopsis(description) {
    if (!description || typeof description !== 'string' || !description.trim()) {
      return 'Synopsis not available';
    }
    
    return description
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }

  async copyToClipboard(text, buttonElement) {
  try {
    await navigator.clipboard.writeText(text);

    // cancel any existing revert timer
    if (buttonElement._copyTimeout) {
      clearTimeout(buttonElement._copyTimeout);
      buttonElement._copyTimeout = null;
    }

    const mapper = globalThis.__emojiIconMapper;

    // helper to render an "emoji" via mapper/createEl/setIcon/fallback
    const renderEmoji = (emojiOrGlyph, setIconNameFallback) => {
      // normalize (strip variation selector FE0F if present)
      const emoji = String(emojiOrGlyph).replace(/\uFE0F/g, '');

      // clear current children (stop spinner + previous icon)
      if (typeof buttonElement.replaceChildren === 'function') {
        buttonElement.replaceChildren();
      } else {
        buttonElement.innerHTML = '';
      }

      // 1) Try mapper -> DocumentFragment
      if (mapper) {
        try {
          const frag = mapper.parseToFragment(emoji);
          if (frag) {
            buttonElement.appendChild(frag);
            return;
          }
        } catch (e) { /* ignore and fallback */ }
      }

      // 2) Try patched createEl (if available)
      try {
        if (typeof buttonElement.createEl === 'function') {
          buttonElement.createEl('span', { text: emoji });
          return;
        }
      } catch {}

      // 3) Try global setIcon (icon name fallback)
      if (typeof setIcon === 'function' && setIconNameFallback) {
        const s = document.createElement('span');
        try {
          setIcon(s, setIconNameFallback);
          buttonElement.appendChild(s);
          return;
        } catch {}
      }

      // 4) Last-resort: raw emoji glyph
      buttonElement.textContent = emoji;
    };

    // show success icon (use mapper if present)
    renderEmoji('✅', 'check');
    buttonElement.classList.add('zoro-copied');

    // revert after 2s (store timer so we can cancel on repeated clicks)
    buttonElement._copyTimeout = setTimeout(() => {
      renderEmoji('📋', 'clipboard-list');
      buttonElement.classList.remove('zoro-copied');
      buttonElement._copyTimeout = null;
    }, 2000);

  } catch (err) {
    // fallback copy behaviour (your existing fallback method)
    this.fallbackCopyTextToClipboard(text, buttonElement);
  }
}

  fallbackCopyTextToClipboard(text, buttonElement) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand('copy');
      buttonElement.innerHTML = '✅';
      buttonElement.classList.add('zoro-copied');
      
      setTimeout(() => {
        buttonElement.innerHTML = '📋';
        buttonElement.classList.remove('zoro-copied');
      }, 2000);
    } catch (err) {
      buttonElement.innerHTML = '❌';
      setTimeout(() => {
        buttonElement.innerHTML = '📋';
      }, 2000);
    }
    
    document.body.removeChild(textArea);
  }

  updatePanelContent(panel, media, malData = null, imdbData = null) {
    const content = panel.querySelector('.panel-content');
    if (media.type === 'ANIME' && media.nextAiringEpisode && !content.querySelector('.airing-section')) {
      const airingSection = this.createAiringSection(media.nextAiringEpisode);
      const metadataSection = content.querySelector('.metadata-section');
      if (metadataSection) {
        metadataSection.insertAdjacentElement('afterend', airingSection);
      } else {
        const headerSection = content.querySelector('.panel-header');
        if (headerSection) {
          headerSection.insertAdjacentElement('afterend', airingSection);
        }
      }
    }
   
    
    if (media.description) {
      const existingSynopsis = content.querySelector('.synopsis-section');
      if (existingSynopsis) {
        const newSynopsis = this.createSynopsisSection(media.description);
        content.replaceChild(newSynopsis, existingSynopsis);
      }
    }

    if (media.genres?.length > 0 && !content.querySelector('.genres-section')) {
      const genresSection = this.createGenresSection(media.genres);
      const synopsisSection = content.querySelector('.synopsis-section');
      if (synopsisSection) {
        content.insertBefore(genresSection, synopsisSection);
      } else {
        content.appendChild(genresSection);
      }
    }

    if (media.idMal) {
      const existingLinksSection = content.querySelector('.external-links-section');
      if (existingLinksSection) {
        const newLinksSection = this.createExternalLinksSection(media);
        content.replaceChild(newLinksSection, existingLinksSection);
      }
    }

    if (media.averageScore > 0 || malData || imdbData) {
      const existingStats = content.querySelector('.stats-section');
      if (existingStats) {
        const newStats = this.createStatisticsSection(media, malData, imdbData);
        content.replaceChild(newStats, existingStats);
      } else {
        // Add statistics section if it doesn't exist (for Simkl entries)
        const newStats = this.createStatisticsSection(media, malData, imdbData);
        const synopsisSection = content.querySelector('.synopsis-section');
        if (synopsisSection) {
          content.insertBefore(newStats, synopsisSection);
        } else {
          content.appendChild(newStats);
        }
      }
    }
  }

  createAiringSection(nextAiringEpisode) {
    // Validate airing data structure
    if (!nextAiringEpisode || !nextAiringEpisode.airingAt || !nextAiringEpisode.episode) {
      return null;
    }

    const section = document.createElement('div');
    section.className = 'panel-section airing-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Next Airing';
    section.appendChild(title);

    const airingInfo = document.createElement('div');
    airingInfo.className = 'airing-info';

    const airingTime = new Date(nextAiringEpisode.airingAt * 1000);

    const episodeInfo = document.createElement('div');
    episodeInfo.className = 'airing-episode';
    episodeInfo.innerHTML = `<span class="airing-label">Episode:</span> <span class="airing-value">${nextAiringEpisode.episode}</span>`;
    airingInfo.appendChild(episodeInfo);

    const dateInfo = document.createElement('div');
    dateInfo.className = 'airing-date';
    dateInfo.innerHTML = `<span class="airing-label">Date:</span> <span class="airing-value">${this.formatAiringDate(airingTime)}</span>`;
    airingInfo.appendChild(dateInfo);

    const timeInfo = document.createElement('div');
    timeInfo.className = 'airing-time';
    timeInfo.innerHTML = `<span class="airing-label">Time:</span> <span class="airing-value">${this.formatAiringTimeOnly(airingTime)}</span>`;
    airingInfo.appendChild(timeInfo);

    if (nextAiringEpisode.timeUntilAiring > 0) {
      const countdownInfo = document.createElement('div');
      countdownInfo.className = 'airing-countdown';
      countdownInfo.innerHTML = `<span class="airing-label">In:</span> <span class="airing-value countdown-value">${this.formatTimeUntilAiring(nextAiringEpisode.timeUntilAiring)}</span>`;
      airingInfo.appendChild(countdownInfo);

      this.startCountdown(countdownInfo.querySelector('.countdown-value'), nextAiringEpisode.timeUntilAiring);
    }

    section.appendChild(airingInfo);
    return section;
  }

  formatAiringDate(date) {
    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    };
    return date.toLocaleDateString('en-GB', options);
  }

  formatAiringTimeOnly(date) {
    const options = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    return date.toLocaleTimeString('en-GB', options);
  }

  formatTimeUntilAiring(seconds) {
    const days = Math.floor(seconds / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  startCountdown(element, initialSeconds) {
    let remainingSeconds = initialSeconds;
    
    const updateCountdown = () => {
      if (remainingSeconds <= 0) {
        element.textContent = 'Aired!';
        return;
      }
      
      element.textContent = this.formatTimeUntilAiring(remainingSeconds);
      remainingSeconds--;
    };

    updateCountdown();
    const intervalId = setInterval(updateCountdown, 60000);
    element.dataset.intervalId = intervalId;
  }

  createSynopsisSection(description) {
    const section = document.createElement('div');
    section.className = 'panel-section synopsis-section zoro-copy-container';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Synopsis';
    section.appendChild(title);

    const synopsis = document.createElement('div');
    synopsis.className = 'synopsis-content';
    
    if (!description || typeof description !== 'string' || !description.trim()) {
      synopsis.className += ' synopsis-placeholder';
      synopsis.textContent = 'Synopsis not available yet.';
      section.appendChild(synopsis);
      return section;
    }
    
    const cleanDescription = description
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (!cleanDescription) {
      synopsis.className += ' synopsis-placeholder';
      synopsis.textContent = 'Synopsis is empty.';
      section.appendChild(synopsis);
      return section;
    }
    
    synopsis.textContent = cleanDescription;
    section.appendChild(synopsis);

    // Add copy button for synopsis
    const copyBtn = this.createCopyButton('synopsis', description);
    section.appendChild(copyBtn);

    return section;
  }

  createMetadataSection(media, entry) {
    const section = document.createElement('div');
    section.className = 'panel-section metadata-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Details';
    section.appendChild(title);

    const metaGrid = document.createElement('div');
    metaGrid.className = 'metadata-grid';

    if (media.format) {
      this.addMetadataItem(metaGrid, 'Format', this.formatDisplayName(media.format));
    }
    if (media.status) {
      this.addMetadataItem(metaGrid, 'Status', this.formatDisplayName(media.status));
    }

    section.appendChild(metaGrid);
    return section;
  }

  createStatisticsSection(media, malData = null, imdbData = null) {
    const section = document.createElement('div');
    section.className = 'panel-section stats-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Statistics';
    section.appendChild(title);

    const statsGrid = document.createElement('div');
    statsGrid.className = 'stats-grid';

    // AniList rating (for anime)
    if (media.averageScore > 0) {
      const scoreOutOf10 = (media.averageScore / 10).toFixed(1);
      this.addStatItem(statsGrid, 'AniList Score', `${scoreOutOf10}`, 'score-stat anilist-stat');
    }

    // MAL data (for anime)
    if (malData) {
      if (malData.score) {
        this.addStatItem(statsGrid, 'MAL Score', `${malData.score}`, 'score-stat mal-stat');
      }
      
      if (malData.scored_by) {
        this.addStatItem(statsGrid, 'MAL Ratings', malData.scored_by.toLocaleString(), 'count-stat');
      }
      
      if (malData.rank) {
        this.addStatItem(statsGrid, 'MAL Rank', `#${malData.rank}`, 'rank-stat');
      }
    }

    // IMDB data (for movies/TV)
    if (imdbData) {
      if (imdbData.score) {
        this.addStatItem(statsGrid, 'IMDB Score', `${imdbData.score}`, 'score-stat imdb-stat');
      }
      
      if (imdbData.scored_by) {
        this.addStatItem(statsGrid, 'IMDB Ratings', imdbData.scored_by.toLocaleString(), 'count-stat');
      }
    }

    section.appendChild(statsGrid);
    return section;
  }

  addMetadataItem(container, label, value) {
    const item = document.createElement('div');
    item.className = 'metadata-item';
    item.innerHTML = `<span class="metadata-label">${label}</span><span class="metadata-value">${value}</span>`;
    container.appendChild(item);
  }

  addStatItem(container, label, value, className = '') {
    const item = document.createElement('div');
    item.className = `stat-item ${className}`;
    item.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>`;
    container.appendChild(item);
  }

  createHeaderSection(media) {
    const header = document.createElement('div');
    header.className = 'panel-header';

    const titleSection = document.createElement('div');
    titleSection.className = 'title-section zoro-copy-container';
    
    const mainTitle = media.title?.english || media.title?.romaji || 'Unknown Title';
    titleSection.innerHTML = `<h2 class="main-title">${mainTitle}</h2>`;

    if (media.title?.romaji && media.title?.english && media.title.romaji !== media.title.english) {
      titleSection.innerHTML += `<div class="alt-title">${media.title.romaji}</div>`;
    }
    if (media.title?.native) {
      titleSection.innerHTML += `<div class="native-title">${media.title.native}</div>`;
    }

    // Add copy button for titles
    const copyBtn = this.createCopyButton('title', media);
    titleSection.appendChild(copyBtn);

    header.appendChild(titleSection);

    if (media.format || (media.season && media.seasonYear)) {
      const formatInfo = document.createElement('div');
      formatInfo.className = 'format-info';
      
      let html = '';
      if (media.format) {
        html += `<span class="format-badge-large">${this.formatDisplayName(media.format)}</span>`;
      }
      if (media.season && media.seasonYear) {
        html += `<span class="season-info">${this.capitalize(media.season)} ${media.seasonYear}</span>`;
      }
      
      formatInfo.innerHTML = html;
      header.appendChild(formatInfo);
    }

    return header;
  }

  createGenresSection(genres) {
    const section = document.createElement('div');
    section.className = 'panel-section genres-section';

    section.innerHTML = `
      <h3 class="section-title">Genres</h3>
      <div class="genres-container">
        ${genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
      </div>
    `;

    return section;
  }

  createExternalLinksSection(media) {
    const section = document.createElement('div');
    section.className = 'panel-section external-links-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'External Links';
    section.appendChild(title);

    const linksContainer = document.createElement('div');
    linksContainer.className = 'external-links-container';

    // AniList button (for anime)
    if (media.type === 'ANIME' || media.type === 'MANGA') {
      const anilistBtn = document.createElement('button');
      anilistBtn.className = 'external-link-btn anilist-btn';
      anilistBtn.innerHTML = '🔗 View on AniList';
      anilistBtn.onclick = (e) => {
        e.stopPropagation();
        const url = this.plugin.getAniListUrl ? this.plugin.getAniListUrl(media.id, media.type) : `https://anilist.co/${media.type.toLowerCase()}/${media.id}`;
        window.open(url, '_blank');
      };
      linksContainer.appendChild(anilistBtn);
    }

    // MAL button (for anime)
    if (media.idMal) {
      const malBtn = document.createElement('button');
      malBtn.className = 'external-link-btn mal-btn';
      malBtn.innerHTML = '🔗 View on MAL';
      malBtn.onclick = (e) => {
        e.stopPropagation();
        const type = media.type === 'MANGA' ? 'manga' : 'anime';
        window.open(`https://myanimelist.net/${type}/${media.idMal}`, '_blank');
      };
      linksContainer.appendChild(malBtn);
    }

    // Simkl button (for movies and TV only, not anime or manga)
if (media.id && media.type !== 'ANIME' && media.type !== 'MANGA') {
  const simklBtn = document.createElement('button');
  simklBtn.className = 'external-link-btn simkl-btn';
  simklBtn.innerHTML = '🔗 View on Simkl';
  simklBtn.onclick = (e) => {
    e.stopPropagation();
    const mediaType = media.type === 'MOVIE' ? 'movies' : 'tv';
    const url = `https://simkl.com/${mediaType}/${media.id}`;
    window.open(url, '_blank');
  };
  linksContainer.appendChild(simklBtn);
}

    // IMDB button (for movies/TV)
    if (media.idImdb) {
      const imdbBtn = document.createElement('button');
      imdbBtn.className = 'external-link-btn imdb-btn';
      imdbBtn.innerHTML = '🔗 View on IMDB';
      imdbBtn.onclick = (e) => {
        e.stopPropagation();
        window.open(`https://www.imdb.com/title/${media.idImdb}/`, '_blank');
      };
      linksContainer.appendChild(imdbBtn);
    }

    // TMDB button (for movies/TV)
    if (media.idTmdb) {
      const tmdbBtn = document.createElement('button');
      tmdbBtn.className = 'external-link-btn tmdb-btn';
      tmdbBtn.innerHTML = '🔗 View on TMDB';
      tmdbBtn.onclick = (e) => {
        e.stopPropagation();
        const mediaType = media.type === 'MOVIE' ? 'movie' : 'tv';
        window.open(`https://www.themoviedb.org/${mediaType}/${media.idTmdb}`, '_blank');
      };
      linksContainer.appendChild(tmdbBtn);
    }

    // NEW: Custom Search Buttons using the CustomExternalURL class
    this.plugin.moreDetailsPanel.customExternalURL.createSearchButtons(media, linksContainer);

    section.appendChild(linksContainer);
    return section;
  }
  
  extractDomainName(url) {
    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname;
      
      // Remove common prefixes
      domain = domain.replace(/^www\./, '');
      
      // Remove common TLDs and get the main part
      const parts = domain.split('.');
      if (parts.length >= 2) {
        // Take the second-to-last part (main domain name)
        domain = parts[parts.length - 2];
      }
      
      // Capitalize first letter
      return domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase();
    } catch (e) {
      return 'Search';
    }
  }
  
  getBestTitle(media) {
    return media.title?.english || 
           media.title?.romaji || 
           media.title?.native || 
           'Unknown Title';
  }

  buildSearchUrl(template, title) {
    try {
      const encodedTitle = encodeURIComponent(title);
      return template + encodedTitle;
    } catch (e) {
      return template + title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '+');
    }
  }

  parseSearchUrls(urlString) {
    if (!urlString || urlString.trim() === '') {
      return [];
    }
    
    return urlString.split(',')
      .map(url => url.trim())
      .filter(url => url.length > 0);
  }

  formatDisplayName(str) {
    if (!str) return '';
    return str.replace(/_/g, ' ')
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
  }

  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  positionPanel(panel, triggerElement) {
    panel.className = 'zoro-more-details-panel';
  }

  cleanupCountdowns(panel) {
    const countdownElements = panel.querySelectorAll('.countdown-value[data-interval-id]');
    countdownElements.forEach(element => {
      const intervalId = element.dataset.intervalId;
      if (intervalId) {
        clearInterval(parseInt(intervalId));
      }
    });
  }
}

module.exports = { RenderDetailPanel };