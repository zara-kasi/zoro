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
    this.currentEntry = null; // Store current entry for enhanced frontmatter
  }

  /**
   * Get the custom property name from settings or return default
   */
  getPropertyName(defaultName) {
    const customNames = this.plugin.settings?.customPropertyNames || {};
    return customNames[defaultName] || defaultName;
  }

  /**
   * Generate enhanced frontmatter properties with custom names
   */
  generateEnhancedFrontmatter(media, entry, mediaType) {
    const enhanced = {};
    
    if (!media) return enhanced;
    
    if (media.title) {
      enhanced[this.getPropertyName('title')] = media.title.english || media.title.romaji || media.title.native;
    }
    
    // Aliases (alternative titles excluding main title)
    const aliases = [];
    if (media.title) {
      const mainTitle = enhanced[this.getPropertyName('title')];
      if (media.title.romaji && media.title.romaji !== mainTitle) {
        aliases.push(media.title.romaji);
      }
      if (media.title.native && media.title.native !== mainTitle) {
        aliases.push(media.title.native);
      }
      if (media.title.english && media.title.english !== mainTitle) {
        aliases.push(media.title.english);
      }
    }
    if (aliases.length > 0) {
      enhanced[this.getPropertyName('aliases')] = aliases;
    }
    
    // Format
    if (media.format) {
      enhanced[this.getPropertyName('format')] = media.format;
    }
    
    // Status (from entry)
    if (entry && entry.status) {
      enhanced[this.getPropertyName('status')] = entry.status;
    }
    
    // Rating (from entry score)
    if (entry && entry.score !== null && entry.score !== undefined) {
      enhanced[this.getPropertyName('rating')] = entry.score;
    }
    
    // Favorite status
    enhanced[this.getPropertyName('favorite')] = media.isFavourite || false;
    
    // Total episodes
    if (media.episodes) {
      enhanced[this.getPropertyName('total_episodes')] = media.episodes;
    }
    
    // Total chapters
    if (media.chapters) {
      enhanced[this.getPropertyName('total_chapters')] = media.chapters;
    }
    
    if (entry && entry.progress !== null && entry.progress !== undefined) {
      const typeUpper = (mediaType || '').toString().toUpperCase();
      if (typeUpper === 'ANIME' || typeUpper === 'TV') {
        enhanced[this.getPropertyName('episodes_watched')] = entry.progress;
      } else if (typeUpper === 'MANGA') {
        enhanced[this.getPropertyName('chapters_read')] = entry.progress;
        if (entry.progressVolumes !== null && entry.progressVolumes !== undefined) {
          enhanced[this.getPropertyName('volumes_read')] = entry.progressVolumes;
        }
      }
      // Skip progress for MOVIE type
    }
    
    // Cover image
    if (media.coverImage) {
      enhanced[this.getPropertyName('cover')] = media.coverImage.large || media.coverImage.medium;
    }
    
    // Genres
    if (media.genres && Array.isArray(media.genres) && media.genres.length > 0) {
      enhanced[this.getPropertyName('genres')] = media.genres;
    }
    
    return enhanced;
  }

  buildOrderedFrontmatter(baseProps, enhancedProps, urls, tags) {
    const orderedFrontmatter = {};
    
    // ===========================================
    // CONTENT PROPERTIES
    // ===========================================
    const titleProp = this.getPropertyName('title');
    const aliasesProp = this.getPropertyName('aliases');
    const formatProp = this.getPropertyName('format');
    const statusProp = this.getPropertyName('status');
    const ratingProp = this.getPropertyName('rating');
    const favoriteProp = this.getPropertyName('favorite');
    
    if (enhancedProps[titleProp] !== undefined) orderedFrontmatter[titleProp] = enhancedProps[titleProp];
    if (enhancedProps[aliasesProp] !== undefined) orderedFrontmatter[aliasesProp] = enhancedProps[aliasesProp];
    if (enhancedProps[formatProp] !== undefined) orderedFrontmatter[formatProp] = enhancedProps[formatProp];
    if (enhancedProps[statusProp] !== undefined) orderedFrontmatter[statusProp] = enhancedProps[statusProp];
    if (enhancedProps[ratingProp] !== undefined) orderedFrontmatter[ratingProp] = enhancedProps[ratingProp];
    if (enhancedProps[favoriteProp] !== undefined) orderedFrontmatter[favoriteProp] = enhancedProps[favoriteProp];
    
    // ===========================================
    // MEDIA METRICS
    // ===========================================
    const totalEpisodesProp = this.getPropertyName('total_episodes');
    const totalChaptersProp = this.getPropertyName('total_chapters');
    
    if (enhancedProps[totalEpisodesProp] !== undefined) orderedFrontmatter[totalEpisodesProp] = enhancedProps[totalEpisodesProp];
    if (enhancedProps[totalChaptersProp] !== undefined) orderedFrontmatter[totalChaptersProp] = enhancedProps[totalChaptersProp];
    
    // ===========================================
    // PROGRESS PROPERTIES
    // ===========================================
    const episodesWatchedProp = this.getPropertyName('episodes_watched');
    const chaptersReadProp = this.getPropertyName('chapters_read');
    const volumesReadProp = this.getPropertyName('volumes_read');
    
    if (enhancedProps[episodesWatchedProp] !== undefined) orderedFrontmatter[episodesWatchedProp] = enhancedProps[episodesWatchedProp];
    if (enhancedProps[chaptersReadProp] !== undefined) orderedFrontmatter[chaptersReadProp] = enhancedProps[chaptersReadProp];
    if (enhancedProps[volumesReadProp] !== undefined) orderedFrontmatter[volumesReadProp] = enhancedProps[volumesReadProp];
    
    // ===========================================
    // TECHNICAL METADATA
    // ===========================================
    const malIdProp = this.getPropertyName('mal_id');
    const anilistIdProp = this.getPropertyName('anilist_id');
    const simklIdProp = this.getPropertyName('simkl_id');
    const imdbIdProp = this.getPropertyName('imdb_id');
    const tmdbIdProp = this.getPropertyName('tmdb_id');
    const mediaTypeProp = this.getPropertyName('media_type');
    
    if (baseProps[malIdProp] !== undefined) orderedFrontmatter[malIdProp] = baseProps[malIdProp];
    if (baseProps[anilistIdProp] !== undefined) orderedFrontmatter[anilistIdProp] = baseProps[anilistIdProp];
    if (baseProps[simklIdProp] !== undefined) orderedFrontmatter[simklIdProp] = baseProps[simklIdProp];
    if (baseProps[imdbIdProp] !== undefined) orderedFrontmatter[imdbIdProp] = baseProps[imdbIdProp];
    if (baseProps[tmdbIdProp] !== undefined) orderedFrontmatter[tmdbIdProp] = baseProps[tmdbIdProp];
    if (baseProps[mediaTypeProp] !== undefined) orderedFrontmatter[mediaTypeProp] = baseProps[mediaTypeProp];
    
    // ===========================================
    // MEDIA ASSETS
    // ===========================================
    const coverProp = this.getPropertyName('cover');
    const genresProp = this.getPropertyName('genres');
    
    if (enhancedProps[coverProp] !== undefined) orderedFrontmatter[coverProp] = enhancedProps[coverProp];
    if (enhancedProps[genresProp] !== undefined) orderedFrontmatter[genresProp] = enhancedProps[genresProp];
    
    // ===========================================
    // SYSTEM PROPERTIES
    // ===========================================
    const urlsProp = this.getPropertyName('urls');
    const tagsProp = this.getPropertyName('tags');
    
    if (urls !== undefined) orderedFrontmatter[urlsProp] = urls;
    if (tags !== undefined) orderedFrontmatter[tagsProp] = tags;
    
    // Add any remaining properties from baseProps that weren't handled above
    Object.entries(baseProps).forEach(([key, value]) => {
      if (orderedFrontmatter[key] === undefined) {
        orderedFrontmatter[key] = value;
      }
    });
    
    return orderedFrontmatter;
  }

  /**
   * Extract search IDs from media entry based on API source
   */
  extractSearchIds(media, entry, source) {
    const ids = {};
    
    // Use custom property names for IDs
    const malIdProp = this.getPropertyName('mal_id');
    const anilistIdProp = this.getPropertyName('anilist_id');
    const simklIdProp = this.getPropertyName('simkl_id');
    const imdbIdProp = this.getPropertyName('imdb_id');
    const tmdbIdProp = this.getPropertyName('tmdb_id');
    
    if (source === 'mal') {
      ids[malIdProp] = media.id;
    } else if (source === 'anilist') {
      if (media.idMal) {
        ids[malIdProp] = media.idMal;
      }
      ids[anilistIdProp] = media.id;
    } else if (source === 'simkl') {
      ids[simklIdProp] = media.id;
      
      const mediaType = this.plugin.apiHelper ? 
        this.plugin.apiHelper.detectMediaType(entry, {}, media) : 
        (entry?._zoroMeta?.mediaType || 'ANIME');
      
      if (mediaType === 'ANIME' && media.idMal) {
        ids[malIdProp] = media.idMal;
      }
      
      if (mediaType !== 'ANIME' && media.idImdb) {
        ids[imdbIdProp] = media.idImdb;
      }
      if (mediaType !== 'ANIME' && media.idTmdb) {
        ids[tmdbIdProp] = media.idTmdb;
      }
    } else if (source === 'tmdb') {
      if (media.idTmdb || media.id) ids[tmdbIdProp] = media.idTmdb || media.id;
      if (media.idImdb) ids[imdbIdProp] = media.idImdb;
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
        if (this.hasMatchingUrl(frontmatter.urls, this.currentUrls)) {
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
  const searchResults = [];
  if (!searchQuery || searchQuery.trim().length < 2) return searchResults;
  const query = searchQuery.toLowerCase().trim();

  const files = this.app.vault.getMarkdownFiles() || [];

  const needRebuild =
    !Array.isArray(this._filenameIndexList) ||
    this._filenameIndexSnapshotCount !== files.length ||
    (this._filenameIndexSnapshotSample || '') !== files.slice(0, 20).map(f => f?.basename || '').join('|');

  if (needRebuild) {
    const list = [];
    for (const f of files) {
      if (!f || !f.basename) continue;
      list.push({ nameLower: f.basename.toLowerCase(), file: f });
    }
    this._filenameIndexList = list;
    this._filenameIndexSnapshotCount = files.length;
    this._filenameIndexSnapshotSample = files.slice(0, 20).map(f => f?.basename || '').join('|');
  }

  const list = this._filenameIndexList || [];

  for (const e of list) {
    if (!e || !e.nameLower) continue;
    if (!e.nameLower.includes(query)) continue;

    const metadata = this.app.metadataCache.getFileCache(e.file) || {};
    const frontmatter = metadata.frontmatter || {};

    let alreadyConnected = false;
    for (const [idType, idValue] of Object.entries(searchIds || {})) {
      if (frontmatter[idType] == idValue && frontmatter.media_type === mediaType) {
        alreadyConnected = true;
        break;
      }
    }

    if (!alreadyConnected && this.currentUrls) {
      if (this.hasMatchingUrl(frontmatter.urls, this.currentUrls)) {
        alreadyConnected = true;
      }
    }

    if (alreadyConnected) continue;

    searchResults.push({
      file: e.file,
      title: e.file.basename,
      path: e.file.path,
      matchType: 'title'
    });

    if (searchResults.length >= 20) break;
  }

  searchResults.sort((a, b) => a.title.localeCompare(b.title));
  return searchResults;
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
    // Disable code block for TMDb trending (movies/TV) since single render is not supported
    const src = String(this.currentSource || '').toLowerCase();
    const typeUpper = String(this.currentMediaType || '').toUpperCase();
    if (src === 'tmdb' && (typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper === 'SHOW' || typeUpper === 'SHOWS')) {
      return '';
    }

    const lines = ['```zoro', 'type: single'];

    lines.push(`source: ${this.currentSource}`);
    lines.push(`mediaType: ${this.currentMediaType}`);
    lines.push(`mediaId: ${this.currentMedia.id}`);

    lines.push('```');

    return lines.join('\n');
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
                            existingFrontmatter.urls;
      
      const isAlreadyConnected = hasZoroTag && hasExistingIds;
      
      // Prepare base properties (existing + new technical metadata)
      const baseProps = { ...existingFrontmatter };
      
      if (isAlreadyConnected) {
        // Note is already connected - only merge URLs, don't overwrite other metadata
        console.log(`[ConnectedNotes] Note "${file.basename}" is already connected, only adding URLs`);
        
        // Only merge URL arrays
        if (this.currentUrls && this.currentUrls.length > 0) {
          baseProps.urls = this.mergeUrlArrays(existingFrontmatter.urls, this.currentUrls);
        }
        
        // Ensure Zoro tag is present (in case it was removed)
        if (!baseProps.tags) {
          baseProps.tags = ['Zoro'];
        } else if (Array.isArray(baseProps.tags)) {
          if (!baseProps.tags.includes('Zoro')) {
            baseProps.tags.push('Zoro');
          }
        }
        
      } else {
        // Note is not connected yet - add full metadata
        console.log(`[ConnectedNotes] Note "${file.basename}" is not connected, adding full metadata`);
        
        // Add new search IDs
        Object.entries(searchIds).forEach(([key, value]) => {
          baseProps[key] = value;
        });
        
        // Add media type
        baseProps.media_type = mediaType;
        
        // Generate enhanced properties but don't merge yet - we'll order them
        const enhancedProps = this.generateEnhancedFrontmatter(this.currentMedia, this.currentEntry, mediaType);
        
        // Only add enhanced properties if not already present (preserve existing values)
        Object.entries(enhancedProps).forEach(([key, value]) => {
          if (baseProps[key] === undefined) {
            baseProps[key] = value;
          }
        });
        
        // Merge URL arrays
        if (this.currentUrls && this.currentUrls.length > 0) {
          baseProps.urls = this.mergeUrlArrays(existingFrontmatter.urls, this.currentUrls);
        }
        
        // Add Zoro tag if not present
        if (!baseProps.tags) {
          baseProps.tags = ['Zoro'];
        } else if (Array.isArray(baseProps.tags)) {
          if (!baseProps.tags.includes('Zoro')) {
            baseProps.tags.push('Zoro');
          }
        }
      }
      
      // Build new frontmatter using proper ordering
      const enhancedProps = this.generateEnhancedFrontmatter(this.currentMedia, this.currentEntry, mediaType);
      const orderedFrontmatter = this.buildOrderedFrontmatter(baseProps, enhancedProps, baseProps.urls, baseProps.tags);
      
      // Build frontmatter lines
      const frontmatterLines = ['---'];
      Object.entries(orderedFrontmatter).forEach(([key, value]) => {
        if ((key === 'tags' || key === 'aliases' || key === 'genres') && Array.isArray(value)) {
          frontmatterLines.push(`${key}:`);
          value.forEach(item => {
            frontmatterLines.push(`  - ${item}`);
          });
        } else if (key === 'urls' && Array.isArray(value)) {
          frontmatterLines.push('urls:');
          value.forEach(url => {
            frontmatterLines.push(`  - "${url}"`);
          });
        } else if (typeof value === 'boolean') {
          frontmatterLines.push(`${key}: ${value}`);
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
   * Show connected notes in the permanent SidePanel
   */
  async showConnectedNotes(searchIds, mediaType, media = null, entry = null, source = null) {
    try {
      // Store current entry for enhanced frontmatter generation
      this.currentEntry = entry;
      
      const context = { searchIds, mediaType, media, entry, source };
      await this.openSidePanelWithContext(context);
    } catch (error) {
      console.error('[ConnectedNotes] Error showing connected notes:', error);
      new Notice('Failed to load connected notes');
    }
  }

  /**
   * Safely close the Zoro side panel by swapping the view to empty
   */
  closePanelSafely(view) {
    try {
      const leaf = view?.leaf;
      if (leaf && typeof leaf.setViewState === 'function') {
        leaf.setViewState({ type: 'empty' });
        return true;
      }
    } catch {}
    return false;
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
        const searchInput = connectInterface.querySelector('.zoro-search-input');
        setTimeout(() => searchInput.focus(), 100);
      } else {
        // Clear search when closed
        const searchInput = connectInterface.querySelector('.zoro-search-input');
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
      
      // Prepare base properties (technical metadata)
      const baseProps = {
        ...searchIds,
        media_type: mediaType
      };
      
      // Add URL array to base props
      if (this.currentUrls && this.currentUrls.length > 0) {
        baseProps.urls = [...this.currentUrls];
      }
      
      // Add Zoro tag
      baseProps.tags = ['Zoro'];
      
      // Generate enhanced properties
      const enhancedProps = this.generateEnhancedFrontmatter(this.currentMedia, this.currentEntry, mediaType);
      
      // Build ordered frontmatter
      const orderedFrontmatter = this.buildOrderedFrontmatter(baseProps, enhancedProps, baseProps.urls, baseProps.tags);
      
      // Build frontmatter lines
      const frontmatterLines = ['---'];
      Object.entries(orderedFrontmatter).forEach(([key, value]) => {
        if ((key === 'aliases' || key === 'genres') && Array.isArray(value)) {
          frontmatterLines.push(`${key}:`);
          value.forEach(item => {
            frontmatterLines.push(`  - ${item}`);
          });
        } else if (key === 'urls' && Array.isArray(value)) {
          frontmatterLines.push('urls:');
          value.forEach(url => {
            frontmatterLines.push(`  - "${url}"`);
          });
        } else if (key === 'tags' && Array.isArray(value)) {
          frontmatterLines.push('tags:');
          value.forEach(tag => {
            frontmatterLines.push(`  - ${tag}`);
          });
        } else if (typeof value === 'boolean') {
          frontmatterLines.push(`${key}: ${value}`);
        } else {
          frontmatterLines.push(`${key}: "${value}"`);
        }
      });
      frontmatterLines.push('---', '');
      
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
    // Extract source and media type
    const source = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectSource(entry, config) : 
      (entry?._zoroMeta?.source || config?.source || 'anilist');
    
    const mediaType = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectMediaType(entry, config, media) : 
      (entry?._zoroMeta?.mediaType || config?.mediaType || 'ANIME');
    
    // Store current media for filename generation (PREFER ENGLISH TITLE)
    this.currentMedia = media;
    
    // Store current entry for enhanced frontmatter generation
    this.currentEntry = entry;
    
    // Store current source and media type for code block generation
    this.currentSource = source;
    this.currentMediaType = mediaType;
    
    // Build URLs array for current media (NOW PASSES SOURCE)
    this.currentUrls = this.buildCurrentUrls(media, mediaType, source);
    
    // Extract search IDs
    const searchIds = this.extractSearchIds(media, entry, source);
    
    // Show connected notes and pass media/entry/source for Side Panel inline actions
    await this.showConnectedNotes(searchIds, mediaType, media, entry, source);
    
  } catch (error) {
    console.error('[ConnectedNotes] Button click error:', error);
    new Notice('Failed to open connected notes');
  }
}

  async openSidePanelWithContext(context) {
    // Reuse existing zoro-panel leaf if present; detach extras
    const leaves = this.app.workspace.getLeavesOfType?.('zoro-panel') || [];
    let leaf = leaves[0] || this.app.workspace.getRightLeaf(true);
    // Detach duplicate zoro-panel leaves (keep only one)
    if (leaves.length > 1) {
      for (let i = 1; i < leaves.length; i++) {
        try { leaves[i].detach(); } catch {}
      }
    }

    await leaf.setViewState({ type: 'zoro-panel', active: true });
    const view = leaf.view;
    if (view && typeof view.setContext === 'function') {
      view.setContext(context);
    }
    this.app.workspace.revealLeaf(leaf);
    return view;
  }
}

export { ConnectedNotes };