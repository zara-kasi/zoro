import { Notice } from 'obsidian';
import { EmojiIconMapper } from '../rendering/helpers/EmojiIconMapper.js';


class ConnectedNotes {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.currentMedia = null; // Store current media for filename generation
    this.currentUrls = null; // Store current URLs as array for matching
    this.currentSource = null; // Store current source for code block generation
    this.currentMediaType = null; // Store current media type for code block generation
    this.isTrendingContext = false; // Track if current action comes from a trending view
  }

   /**
 * Extract search IDs from media entry based on API source
 */
extractSearchIds(media, entry, source) {
  const ids = {};
  
  // mal_id is STANDARD for all anime/manga regardless of source
  if (source === 'mal') {
    ids.mal_id = media.id;
  } else if (source === 'anilist') {
    // Primary: use idMal if available, Fallback: use anilist id
    if (media.idMal) {
      ids.mal_id = media.idMal;
    }
    // Always add anilist_id as backup
    ids.anilist_id = media.id;
  } else if (source === 'simkl') {
    ids.simkl_id = media.id;
    
    // Get media type for SIMKL backup strategy
    const mediaType = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectMediaType(entry, {}, media) : 
      (entry?._zoroMeta?.mediaType || 'ANIME');
    
    // For ANIME: use MAL as standard backup (like AniList)
    if (mediaType === 'ANIME' && media.idMal) {
      ids.mal_id = media.idMal;
    }
    
    // For Movies/TV/other media types: use IMDB and TMDB as backup
    if (mediaType !== 'ANIME' && media.idImdb) {
      ids.imdb_id = media.idImdb;
    }
    if (mediaType !== 'ANIME' && media.idTmdb) {
      ids.tmdb_id = media.idTmdb;
    }
  } else if (source === 'tmdb') {
    if (media.idTmdb || media.id) ids.tmdb_id = media.idTmdb || media.id;
    if (media.idImdb) ids.imdb_id = media.idImdb;
  }
  
  return ids;
}

/**
 * Build URLs array for current media to match against
 */
buildCurrentUrls(media, mediaType, source) {
  const urls = [];
  
  // Build source-specific URL first
  if (source === 'simkl') {
    // Build SIMKL URL
    const simklMediaType = (mediaType === 'ANIME' || mediaType.toLowerCase() === 'anime') ? 'anime' : 
                      (mediaType.toLowerCase() === 'movie') ? 'movies' :  // Note: "movies" not "movie"
                      mediaType.toLowerCase();
urls.push(`https://simkl.com/${simklMediaType}/${media.id}`);
    
    // For ANIME: Add MAL URL as backup
    if (mediaType === 'ANIME' && media.idMal) {
      const malMediaType = (mediaType.toLowerCase() === 'movie') ? 'anime' : mediaType.toLowerCase();
urls.push(`https://myanimelist.net/${malMediaType}/${media.idMal}`);
    }
    
    // For Movies/TV/other: Add IMDB and TMDB URLs as backup
    if (mediaType !== 'ANIME' && media.idImdb) {
      urls.push(`https://www.imdb.com/title/${media.idImdb}/`);
    }
    if (mediaType !== 'ANIME' && media.idTmdb) {
      const isMovie = (mediaType || '').toString().toUpperCase().includes('MOVIE');
      urls.push(`https://www.themoviedb.org/${isMovie ? 'movie' : 'tv'}/${media.idTmdb}`);
    }
    
  } else if (source === 'tmdb') {
    const isMovie = (mediaType || '').toString().toUpperCase().includes('MOVIE');
    urls.push(`https://www.themoviedb.org/${isMovie ? 'movie' : 'tv'}/${media.idTmdb || media.id}`);
    if (media.idImdb) urls.push(`https://www.imdb.com/title/${media.idImdb}/`);
  } else {
    // Build MAL URL if MAL ID exists
    if (media.idMal) {
      const malMediaType = (mediaType.toLowerCase() === 'movie') ? 'anime' : mediaType.toLowerCase();
urls.push(`https://myanimelist.net/${malMediaType}/${media.idMal}`);
    }
    
    // Build AniList URL for non-SIMKL sources
    if (source !== 'simkl') {
      urls.push(`https://anilist.co/${mediaType.toLowerCase()}/${media.id}`);
    }
  }
  
  return urls;
}
  /**
   * Check if any URL in the array matches the current media URLs
   */
  hasMatchingUrl(frontmatterUrls, currentUrls) {
    if (!frontmatterUrls || !currentUrls) return false;
    
    // Ensure frontmatterUrls is an array
    const urlArray = Array.isArray(frontmatterUrls) ? frontmatterUrls : [frontmatterUrls];
    
    // Check if any URL in frontmatter matches any current URL
    return urlArray.some(url => currentUrls.includes(url));
  }

  /**
   * Search vault for notes with matching properties
   */
  async searchConnectedNotes(searchIds, mediaType) {
    const connectedNotes = [];
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      const metadata = this.app.metadataCache.getFileCache(file);
      const frontmatter = metadata?.frontmatter;
      
      if (!frontmatter) continue;

      let hasMatchingId = false;

      // Priority 1: Check MAL ID + media type
      if (searchIds.mal_id && frontmatter.mal_id == searchIds.mal_id && frontmatter.media_type === mediaType) {
        hasMatchingId = true;
      }
      
      // Priority 2: Check AniList ID + media type (if MAL didn't match)
      if (!hasMatchingId && searchIds.anilist_id && frontmatter.anilist_id == searchIds.anilist_id && frontmatter.media_type === mediaType) {
        hasMatchingId = true;
      }
      
      // Priority 3: Check other IDs + media type (if still no match)
      if (!hasMatchingId) {
        for (const [idType, idValue] of Object.entries(searchIds)) {
          if (idType !== 'mal_id' && idType !== 'anilist_id' && frontmatter[idType] == idValue && frontmatter.media_type === mediaType) {
            hasMatchingId = true;
            break;
          }
        }
      }

      // Priority 4: Check URL array matching (fallback option)
      if (!hasMatchingId && this.currentUrls) {
        if (this.hasMatchingUrl(frontmatter.url, this.currentUrls)) {
          hasMatchingId = true;
        }
      }

      // Also check for #Zoro tag
      const hasZoroTag = metadata?.tags?.some(tag => tag.tag === '#Zoro') || false;
      
      if (hasMatchingId || hasZoroTag) {
        connectedNotes.push({
          file: file,
          title: file.basename,
          path: file.path,
          frontmatter: frontmatter,
          hasMatchingId: hasMatchingId,
          hasZoroTag: hasZoroTag
        });
      }
    }

    return connectedNotes;
  }

  /**
   * Search vault for existing notes to connect (excludes already connected ones)
   */
  async findNotesToConnect(searchQuery, searchIds, mediaType) {
    const allFiles = this.app.vault.getMarkdownFiles();
    const searchResults = [];
    
    if (!searchQuery || searchQuery.trim().length < 2) {
      return searchResults;
    }
    
    const query = searchQuery.toLowerCase().trim();
    
    for (const file of allFiles) {
      // Skip files that already have matching IDs or URLs
      const metadata = this.app.metadataCache.getFileCache(file);
      const frontmatter = metadata?.frontmatter;
      
      if (frontmatter) {
        let alreadyConnected = false;
        
        // Check ID matching
        for (const [idType, idValue] of Object.entries(searchIds)) {
          if (frontmatter[idType] == idValue && frontmatter.media_type === mediaType) {
            alreadyConnected = true;
            break;
          }
        }
        
        // Check URL array matching if not already connected
        if (!alreadyConnected && this.currentUrls) {
          if (this.hasMatchingUrl(frontmatter.url, this.currentUrls)) {
            alreadyConnected = true;
          }
        }
        
        if (alreadyConnected) continue;
      }
      
      // Search in filename
      if (file.basename.toLowerCase().includes(query)) {
        searchResults.push({
          file: file,
          title: file.basename,
          path: file.path,
          matchType: 'title'
        });
        continue;
      }
      
      // Search in content (first 500 chars for performance)
      try {
        const content = await this.app.vault.cachedRead(file);
        const contentPreview = content.slice(0, 500).toLowerCase();
        if (contentPreview.includes(query)) {
          searchResults.push({
            file: file,
            title: file.basename,
            path: file.path,
            matchType: 'content'
          });
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }
    
    // Sort by relevance (title matches first, then alphabetically)
    return searchResults.sort((a, b) => {
      if (a.matchType !== b.matchType) {
        return a.matchType === 'title' ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    }).slice(0, 20); // Limit to 20 results for performance
  }

  /**
   * Merge URL arrays, avoiding duplicates
   */
  mergeUrlArrays(existingUrls, newUrls) {
    if (!newUrls || newUrls.length === 0) {
      return existingUrls || [];
    }
    
    if (!existingUrls) {
      return [...newUrls];
    }
    
    // Ensure existing is an array
    const existingArray = Array.isArray(existingUrls) ? existingUrls : [existingUrls];
    
    // Create new array with existing URLs plus new ones (no duplicates)
    const mergedUrls = [...existingArray];
    
    newUrls.forEach(url => {
      if (!mergedUrls.includes(url)) {
        mergedUrls.push(url);
      }
    });
    
    return mergedUrls;
  }

  /**
   * Generate code block content based on current media entry
   */
  generateCodeBlockContent() {
    if (!this.plugin.settings.insertCodeBlockOnNote) {
      return ''; // Return empty if setting is disabled
    }
    if (!this.currentMedia || !this.currentSource || !this.currentMediaType) {
      return ''; // Return empty if missing required data
    }
    // Disable code block for trending Movie/TV entries regardless of source
    const typeUpper = String(this.currentMediaType || '').toUpperCase();
    const isMovieOrTv = (typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper === 'SHOW' || typeUpper === 'SHOWS');
    const isTrending = this.isTrendingContext || Boolean(this.currentMedia?._zoroMeta?.isTrending);
    if (isMovieOrTv && isTrending) {
      return '';
    }

    const codeBlockLines = [
      '```zoro',
      'type: single',
      `source: ${this.currentSource}`,
      `mediaType: ${this.currentMediaType}`,
      `mediaId: ${this.currentMedia.id}`,
      '```'
    ];

    return codeBlockLines.join('\n');
  }

  /**
   * Add metadata to existing note
   */
   async connectExistingNote(file, searchIds, mediaType) {
  try {
    const content = await this.app.vault.read(file);
    const metadata = this.app.metadataCache.getFileCache(file);
    const existingFrontmatter = metadata?.frontmatter || {};
    
    // Parse existing frontmatter
    let frontmatterEnd = 0;
    let bodyContent = content;
    
    if (content.startsWith('---\n')) {
      const secondDelimiter = content.indexOf('\n---\n', 4);
      if (secondDelimiter !== -1) {
        frontmatterEnd = secondDelimiter + 5;
        bodyContent = content.slice(frontmatterEnd);
      }
    }
    
    // Check if note is already connected to Zoro (has Zoro tag and some metadata)
    const hasZoroTag = metadata?.tags?.some(tag => tag.tag === '#Zoro') || 
                      (Array.isArray(existingFrontmatter.tags) && existingFrontmatter.tags.includes('Zoro'));
    
    const hasExistingIds = existingFrontmatter.mal_id || 
                          existingFrontmatter.anilist_id || 
                          existingFrontmatter.simkl_id ||
                          existingFrontmatter.imdb_id ||
                          existingFrontmatter.tmdb_id ||
                          existingFrontmatter.media_type ||
                          existingFrontmatter.url;
    
    const isAlreadyConnected = hasZoroTag && hasExistingIds;
    
    // Start with existing frontmatter
    const updatedFrontmatter = { ...existingFrontmatter };
    
    if (isAlreadyConnected) {
      // Note is already connected - only merge URLs, don't overwrite other metadata
      console.log(`[ConnectedNotes] Note "${file.basename}" is already connected, only adding URLs`);
      
      // Only merge URL arrays
      if (this.currentUrls && this.currentUrls.length > 0) {
        updatedFrontmatter.url = this.mergeUrlArrays(existingFrontmatter.url, this.currentUrls);
      }
      
      // Ensure Zoro tag is present (in case it was removed)
      if (!updatedFrontmatter.tags) {
        updatedFrontmatter.tags = ['Zoro'];
      } else if (Array.isArray(updatedFrontmatter.tags)) {
        if (!updatedFrontmatter.tags.includes('Zoro')) {
          updatedFrontmatter.tags.push('Zoro');
        }
      }
      
    } else {
      // Note is not connected yet - add full metadata
      console.log(`[ConnectedNotes] Note "${file.basename}" is not connected, adding full metadata`);
      
      // Add new search IDs
      Object.entries(searchIds).forEach(([key, value]) => {
        updatedFrontmatter[key] = value;
      });
      
      // Merge URL arrays
      if (this.currentUrls && this.currentUrls.length > 0) {
        updatedFrontmatter.url = this.mergeUrlArrays(existingFrontmatter.url, this.currentUrls);
      }
      
      // Add media type
      updatedFrontmatter.media_type = mediaType;
      
      // Add Zoro tag if not present
      if (!updatedFrontmatter.tags) {
        updatedFrontmatter.tags = ['Zoro'];
      } else if (Array.isArray(updatedFrontmatter.tags)) {
        if (!updatedFrontmatter.tags.includes('Zoro')) {
          updatedFrontmatter.tags.push('Zoro');
        }
      }
    }
    
    // Build new frontmatter
    const frontmatterLines = ['---'];
    Object.entries(updatedFrontmatter).forEach(([key, value]) => {
      if (key === 'tags' && Array.isArray(value)) {
        frontmatterLines.push('tags:');
        value.forEach(tag => {
          frontmatterLines.push(`  - ${tag}`);
        });
      } else if (key === 'url' && Array.isArray(value)) {
        frontmatterLines.push('url:');
        value.forEach(url => {
          frontmatterLines.push(`  - "${url}"`);
        });
      } else {
        frontmatterLines.push(`${key}: "${value}"`);
      }
    });
    frontmatterLines.push('---', '');
    
    // Handle code block generation
    let finalBodyContent = bodyContent;
    
    if (!isAlreadyConnected) {
      // Only add code block for new connections (not for URL-only updates)
      const codeBlockContent = this.generateCodeBlockContent();
      
      // Check if a zoro code block already exists in the body
      const zoroCodeBlockRegex = /```zoro[\s\S]*?```/;
      if (codeBlockContent && !zoroCodeBlockRegex.test(bodyContent)) {
        // Add code block after frontmatter with proper spacing
        finalBodyContent = codeBlockContent + '\n\n' + bodyContent;
      }
    }
    
    const newContent = frontmatterLines.join('\n') + finalBodyContent;
    
    // Write updated content
    await this.app.vault.modify(file, newContent);
    
    // Show appropriate success message
    if (isAlreadyConnected) {
      new Notice(`Updated URLs for: ${file.basename}`);
    } else {
      new Notice(`Connected note: ${file.basename}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('[ConnectedNotes] Error connecting existing note:', error);
    new Notice(`Failed to connect note: ${file.basename}`);
    return false;
  }
}


  /**
   * Show connected notes in a single dedicated side panel
   */
  async showConnectedNotes(searchIds, mediaType) {
    try {
      // Search for connected notes
      const connectedNotes = await this.searchConnectedNotes(searchIds, mediaType);

      // Look for existing Zoro panel first
      let zoroLeaf = null;
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view.titleEl && leaf.view.titleEl.textContent === 'Zoro') {
          zoroLeaf = leaf;
          return false; // Stop iteration
        }
      });

      // If no existing Zoro panel, create new one
      if (!zoroLeaf) {
        zoroLeaf = this.app.workspace.getRightLeaf(false);
      }

      // Render content and set title
      this.renderConnectedNotesInView(zoroLeaf.view, connectedNotes, searchIds, mediaType);
      
      // Ensure the side panel is visible
      this.app.workspace.revealLeaf(zoroLeaf);
      
    } catch (error) {
      console.error('[ConnectedNotes] Error showing connected notes:', error);
      new Notice('Failed to load connected notes');
    }
  }

  /**
   * Render the connect existing notes interface
   */
  renderConnectExistingInterface(container, searchIds, mediaType) {
  // Create search interface container
  const connectInterface = container.createEl('div', { cls: 'zoro-note-connect-interface' });

  // Use the same input container classes as your other search bar so CSS matches
  const searchWrapper = connectInterface.createEl('div', { cls: 'zoro-search-input-container' });

  // Create icon element (mapper will convert this emoji -> icon)
  const iconSpan = searchWrapper.createEl('span', { cls: 'zoro-search-icon' });

  // Ensure emoji mapper is initialized (idempotent)
  try {
    if (!globalThis.__emojiIconMapper) {
      // If EmojiIconMapper is available in scope
      if (typeof EmojiIconMapper === 'function') {
        new EmojiIconMapper().init({ patchCreateEl: true });
      }
    } else {
      // make sure it's patched (safe to call)
      globalThis.__emojiIconMapper.init?.({ patchCreateEl: true });
    }
  } catch (e) {
    // swallow — we'll fallback to raw emoji below
  }

  // Render the icon via mapper if available, otherwise fallback to raw emoji
  const mapper = globalThis.__emojiIconMapper;
  if (mapper) {
    const frag = mapper.parseToFragment('🔍');
    if (frag) iconSpan.appendChild(frag);
    else iconSpan.textContent = '🔍';
  } else if (typeof iconSpan.createEl === 'function') {
    // if createEl is patched but mapper not present, let patched createEl handle it
    iconSpan.createEl('span', { text: '🔍' });
  } else {
    iconSpan.textContent = '🔍';
  }

  // Create actual input (reuse same class as other search bar)
  const searchInput = searchWrapper.createEl('input', { cls: 'zoro-search-input' });
  searchInput.type = 'text';
  // plain-text placeholder (no emoji)
  searchInput.placeholder = ' Search notes to connect...';

  // Search results container
  const resultsContainer = connectInterface.createEl('div', { cls: 'zoro-note-search-results' });

  // Search functionality with debounce
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const query = searchInput.value;
      resultsContainer.empty();

      if (query.trim().length >= 2) {
        const results = await this.findNotesToConnect(query, searchIds, mediaType);

        if (results.length === 0) {
          resultsContainer.createEl('div', { text: 'No notes found', cls: 'zoro-note-no-results' });
        } else {
          results.forEach(result => {
            const resultItem = resultsContainer.createEl('div', { cls: 'zoro-note-search-result' });

            resultItem.createEl('span', { text: result.title, cls: 'zoro-note-result-title' });

            const connectBtn = resultItem.createEl('button', { text: '➕', cls: 'zoro-note-connect-btn' });
            connectBtn.title = 'Connect this note';

            connectBtn.onclick = async (e) => {
              e.stopPropagation();
              const success = await this.connectExistingNote(result.file, searchIds, mediaType);
              if (success) {
                const connectedNotes = await this.searchConnectedNotes(searchIds, mediaType);
                this.refreshConnectedNotesList(container.querySelector('.zoro-note-panel-content'), connectedNotes);
                connectInterface.classList.add('zoro-note-hidden');
                searchInput.value = '';
                resultsContainer.empty();
              }
            };

            // Click on item to preview
            resultItem.onclick = (e) => {
              if (e.target !== connectBtn) {
                const mainLeaf = this.app.workspace.getLeaf('tab');
                mainLeaf.openFile(result.file);
              }
            };
          });
        }
      }
    }, 300); // 300ms debounce
  });

  return connectInterface;
}



  /**
   * Refresh the connected notes list without full re-render
   */
  refreshConnectedNotesList(mainContent, connectedNotes) {
    const notesList = mainContent.querySelector('.zoro-note-notes-list');
    const emptyState = mainContent.querySelector('.zoro-note-empty-state');
    
    if (connectedNotes.length === 0) {
      if (notesList) notesList.remove();
      if (!emptyState) {
        const newEmptyState = mainContent.createEl('div', { cls: 'zoro-note-empty-state' });
        newEmptyState.createEl('div', { text: 'No notes', cls: 'zoro-note-empty-message' });
      }
    } else {
      if (emptyState) emptyState.remove();
      if (notesList) notesList.remove();
      
      // Recreate notes list
      const newNotesList = mainContent.createEl('div', { cls: 'zoro-note-notes-list' });
      
      connectedNotes.forEach(note => {
        const noteItem = newNotesList.createEl('div', { cls: 'zoro-note-item' });
        
        // Note title
        const noteTitle = noteItem.createEl('div', { text: note.title, cls: 'zoro-note-title' });
        
        // Click handler for the entire item
        noteItem.onclick = (e) => {
          e.preventDefault();
          const mainLeaf = this.app.workspace.getLeaf('tab');
          mainLeaf.openFile(note.file);
          this.app.workspace.setActiveLeaf(mainLeaf);
        };

        // Show matching indicators
        const indicators = noteItem.createEl('div', { cls: 'zoro-note-indicators' });
        
        if (note.hasMatchingId) {
          const idIndicator = indicators.createEl('span', { text: '🔗', cls: 'zoro-note-id-indicator', title: 'Has matching ID' });
        }
        if (note.hasZoroTag) {
          const tagIndicator = indicators.createEl('span', { text: '🏷️', cls: 'zoro-note-tag-indicator', title: 'Has #Zoro tag' });
        }
      });
    }
  }

  /**
   * Render connected notes in the dedicated Zoro view
   */
  renderConnectedNotesInView(view, connectedNotes, searchIds, mediaType) {
    const container = view.containerEl;
    container.empty();
    container.className = 'zoro-note-container';

    // Set multiple title properties to ensure "Zoro" appears everywhere
    if (view.titleEl) {
      view.titleEl.setText('Zoro');
    }
    
    // Set the view's display name
    if (view.getDisplayText) {
      view.getDisplayText = () => 'Zoro';
    } else {
      view.getDisplayText = () => 'Zoro';
    }
    
    // Set view type if available
    if (view.getViewType) {
      view.getViewType = () => 'zoro-panel';
    } else {
      view.getViewType = () => 'zoro-panel';
    }
    
    // Force update the leaf's tab header
    if (view.leaf) {
      const leaf = view.leaf;
      setTimeout(() => {
        if (leaf.tabHeaderEl) {
          const titleEl = leaf.tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
          if (titleEl) {
            titleEl.textContent = 'Zoro';
          }
        }
        leaf.updateHeader();
      }, 10);
    }

    // Connect existing notes interface (initially hidden)
    const connectInterface = this.renderConnectExistingInterface(container, searchIds, mediaType);
    connectInterface.classList.add('zoro-note-hidden'); // Initially hidden

    // Main content area
    const mainContent = container.createEl('div', { cls: 'zoro-note-panel-content' });

    // Notes list or empty state
    if (connectedNotes.length === 0) {
      const emptyState = mainContent.createEl('div', { cls: 'zoro-note-empty-state' });
      emptyState.createEl('div', { text: 'No notes linked yet ', cls: 'zoro-note-empty-message' });
    } else {
      // Notes list
      const notesList = mainContent.createEl('div', { cls: 'zoro-note-notes-list' });
      
      connectedNotes.forEach(note => {
        const noteItem = notesList.createEl('div', { cls: 'zoro-note-item' });
        
        // Note title
        const noteTitle = noteItem.createEl('div', { text: note.title, cls: 'zoro-note-title' });
        
        // Click handler for the entire item
        noteItem.onclick = (e) => {
          e.preventDefault();
          const mainLeaf = this.app.workspace.getLeaf('tab');
          mainLeaf.openFile(note.file);
          this.app.workspace.setActiveLeaf(mainLeaf);
        };

        // Show matching indicators
        const indicators = noteItem.createEl('div', { cls: 'zoro-note-indicators' });
        
        if (note.hasMatchingId) {
          const idIndicator = indicators.createEl('span', { text: '🔗', cls: 'zoro-note-id-indicator', title: 'Has matching ID' });
        }
        if (note.hasZoroTag) {
          const tagIndicator = indicators.createEl('span', { text: '🏷️', cls: 'zoro-note-tag-indicator', title: 'Has #Zoro tag' });
        }
      });
    }

    // Footer section at bottom
    const footer = container.createEl('div', { cls: 'zoro-note-panel-footer' });
    
    const createButton = footer.createEl('button', { text: '📝', cls: 'zoro-note-create-btn' });
    createButton.onclick = () => this.createNewConnectedNote(searchIds, mediaType);
    
    // New connect existing button
    const connectButton = footer.createEl('button', { text: '⛓️', cls: 'zoro-note-connect-existing-btn' });
    
    connectButton.onclick = () => {
      connectInterface.classList.toggle('zoro-note-hidden');
      
      if (!connectInterface.classList.contains('zoro-note-hidden')) {
        // Focus on search input when opened
        const searchInput = connectInterface.querySelector('.zoro-note-search-input');
        setTimeout(() => searchInput.focus(), 100);
      } else {
        // Clear search when closed
        const searchInput = connectInterface.querySelector('.zoro-note-search-input');
        const resultsContainer = connectInterface.querySelector('.zoro-note-search-results');
        searchInput.value = '';
        resultsContainer.empty();
      }
    };
  }

  /**
   * Extract media title for filename (prefers English, falls back to romaji)
   */
  getMediaTitleForFilename() {
    if (!this.currentMedia) {
      return 'Untitled'; // Fallback if no media stored
    }
    
    // Prefer English title, fall back to romaji, then native, then 'Untitled'
    const title = this.currentMedia.title?.english || 
                  this.currentMedia.title?.romaji || 
                  this.currentMedia.title?.native || 
                  'Untitled';
    
    // Clean the title for filename (remove invalid characters)
    return title.replace(/[<>:"/\\|?*]/g, '').trim();
  }

  /**
   * Get the configured note path from settings
   */
  getConfiguredNotePath() {
    // Get the note path from plugin settings
    const notePath = this.plugin.settings?.notePath || '';
    
    // Ensure path ends with '/' if it's not empty
    if (notePath && !notePath.endsWith('/')) {
      return notePath + '/';
    }
    
    return notePath;
  }

  /**
   * Generate unique filename with path like Obsidian does (Title, Title 1, Title 2, etc.)
   */
  generateUniqueFilename(baseName = null) {
    // Use media title if available, otherwise fallback to 'Untitled'
    const preferredBaseName = baseName || this.getMediaTitleForFilename();
    
    // Get configured path
    const notePath = this.getConfiguredNotePath();
    
    // Generate full path with filename
    const baseFileName = `${notePath}${preferredBaseName}.md`;
    
    // Check if base filename exists
    if (!this.app.vault.getAbstractFileByPath(baseFileName)) {
      return baseFileName;
    }
    
    // Generate numbered variants until we find one that doesn't exist
    let counter = 1;
    let uniqueFileName;
    do {
      uniqueFileName = `${notePath}${preferredBaseName} ${counter}.md`;
      counter++;
    } while (this.app.vault.getAbstractFileByPath(uniqueFileName));
    
    return uniqueFileName;
  }

  /**
   * Ensure the configured path exists in the vault
   */
  async ensurePathExists(filePath) {
    // Extract directory path from file path
    const pathParts = filePath.split('/');
    pathParts.pop(); // Remove filename
    const dirPath = pathParts.join('/');
    
    if (!dirPath) return; // No directory to create
    
    // Check if directory exists and create if it doesn't
    const abstractFile = this.app.vault.getAbstractFileByPath(dirPath);
    if (!abstractFile) {
      try {
        await this.app.vault.createFolder(dirPath);
      } catch (error) {
        // Folder might already exist, or there might be another issue
        console.warn('[ConnectedNotes] Could not create folder:', dirPath, error);
      }
    }
  }

  /**
   * Create a new note with unique filename and add metadata
   */
  async createNewConnectedNote(searchIds, mediaType) {
    try {
      // Generate unique filename using media title with configured path
      const uniqueFileName = this.generateUniqueFilename();
      
      // Ensure the directory path exists
      await this.ensurePathExists(uniqueFileName);
      
      // Create frontmatter content
      const frontmatterLines = [
        '---',
        ...Object.entries(searchIds).map(([key, value]) => `${key}: "${value}"`),
        `media_type: "${mediaType}"`,
      ];
      
      // Add URL array to frontmatter
      if (this.currentUrls && this.currentUrls.length > 0) {
        frontmatterLines.push('url:');
        this.currentUrls.forEach(url => {
          frontmatterLines.push(`  - "${url}"`);
        });
      }
      
      frontmatterLines.push('tags:', '  - Zoro', '---', '');
      
      const frontmatter = frontmatterLines.join('\n');

      // Generate code block content
      const codeBlockContent = this.generateCodeBlockContent();
      
      // Combine frontmatter with code block and additional spacing
      let noteContent = frontmatter;
      if (codeBlockContent) {
        noteContent += codeBlockContent + '\n\n';
      }

      // Create the file with unique name, frontmatter, and code block
      const file = await this.app.vault.create(uniqueFileName, noteContent);
      
      // Open in main workspace
      const mainLeaf = this.app.workspace.getLeaf('tab');
      await mainLeaf.openFile(file);
      this.app.workspace.setActiveLeaf(mainLeaf);
      
      new Notice('Created new connected note!');
      
    } catch (error) {
      console.error('[ConnectedNotes] Error creating new note:', error);
      new Notice('Failed to create new note');
    }
  }

  /**
   * Create the connected notes button for media cards
   */
  createConnectedNotesButton(media, entry, config) {
    const notesBtn = document.createElement('span');
    notesBtn.className = 'zoro-note-obsidian';
    notesBtn.createEl('span', { text: '🔮' });
    notesBtn.title = 'View connected notes';
    
    notesBtn.onclick = (e) => this.handleConnectedNotesClick(e, media, entry, config);
    
    return notesBtn;
  }
  /**
 * Handle connected notes button click
 */
async handleConnectedNotesClick(e, media, entry, config) {
  e.preventDefault();
  e.stopPropagation();
  
  try {
    // Determine trending context strictly via DOM/data attribute, independent of source
    let trendingFlag = false;
    try {
      const target = e.currentTarget || e.target;
      const cardEl = target?.closest?.('.zoro-card');
      if (cardEl && cardEl.dataset && cardEl.dataset.trending === 'true') {
        trendingFlag = true;
      }
    } catch {}
    this.isTrendingContext = trendingFlag;

    // Extract source and media type
    const source = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectSource(entry, config) : 
      (entry?._zoroMeta?.source || config?.source || 'anilist');
    
    const mediaType = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectMediaType(entry, config, media) : 
      (entry?._zoroMeta?.mediaType || config?.mediaType || 'ANIME');
    
    // Store current media for filename generation (PREFER ENGLISH TITLE)
    this.currentMedia = media;
    
    // Store current source and media type for code block generation
    this.currentSource = source;
    this.currentMediaType = mediaType;
    
    // Build URLs array for current media (NOW PASSES SOURCE)
    this.currentUrls = this.buildCurrentUrls(media, mediaType, source);
    
    // Extract search IDs
    const searchIds = this.extractSearchIds(media, entry, source);
    
    // Show connected notes
    await this.showConnectedNotes(searchIds, mediaType);
    
  } catch (error) {
    console.error('[ConnectedNotes] Button click error:', error);
    new Notice('Failed to open connected notes');
  }
}
}

export { ConnectedNotes };