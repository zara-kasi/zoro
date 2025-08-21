import { Notice } from 'obsidian';

class APISourceHelper {
  constructor(plugin) {
    this.plugin = plugin;
  }

  getAPI(source) {
    const normalizedSource = source?.toLowerCase();
    
    switch(normalizedSource) {
      case 'mal': return this.plugin.malApi;
      case 'simkl': return this.plugin.simklApi;
      case 'anilist':
      default: return this.plugin.api;
    }
  }

  isAuthenticated(source) {
    const normalizedSource = source?.toLowerCase();
    
    switch(normalizedSource) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'simkl':
        return !!this.plugin.settings.simklAccessToken;
      case 'anilist':
      default:
        return !!this.plugin.settings.accessToken;
    }
  }

  getSourceUrl(id, mediaType, source) {
    const normalizedSource = source?.toLowerCase();
    
    switch(normalizedSource) {
      case 'mal':
        return this.plugin.getMALUrl?.(id, mediaType);
      case 'simkl':
        return this.plugin.getSimklUrl?.(id, mediaType);
      case 'anilist':
      default:
        return this.plugin.getAniListUrl?.(id, mediaType);
    }
  }

  async fetchSearchData(config, term) {
    const normalizedSource = config.source?.toLowerCase();
    
    if (normalizedSource === 'mal') {
      return await this.plugin.malApi.fetchMALData({ 
        ...config, 
        type: 'search',
        search: term, 
        query: term,
        page: 1, 
        perPage: 5 
      });
    } else if (normalizedSource === 'simkl') {
      return await this.plugin.simklApi.fetchSimklData({ 
        ...config, 
        type: 'search',
        search: term, 
        query: term,
        page: 1, 
        perPage: 5 
      });
    } else {
      return await this.plugin.api.fetchAniListData({ 
        ...config, 
        type: 'search',
        search: term, 
        page: 1, 
        perPage: 5 
      });
    }
  }

  
  async updateMediaListEntry(mediaId, updates, source, mediaType) {
    const api = this.getAPI(source);
    if ((source || '').toLowerCase() === 'simkl') {
      return await api.updateMediaListEntry(mediaId, updates, mediaType);
    }
    return await api.updateMediaListEntry(mediaId, updates);
  }

  getSourceSpecificUrl(id, mediaType, source) {
    return this.plugin.getSourceSpecificUrl(id, mediaType, source);
  }

  detectSource(entry, config) {
    // 1. Check existing metadata first
    if (entry?._zoroMeta?.source) {
      return this.validateAndReturnSource(entry._zoroMeta.source);
    }
    
    // 2. Try config source
    if (config?.source) {
      return this.validateAndReturnSource(config.source);
    }
    
    // 3. Detect from data structure patterns
    const detectedSource = this.detectFromDataStructure(entry);
    if (detectedSource) {
      return detectedSource;
    }
    
    // 4. Fallback to best available source
    return this.getFallbackSource();
  }

  detectFromDataStructure(entry) {
    if (!entry || typeof entry !== 'object') return null;
    
    // AniList patterns
    if (entry.media?.siteUrl?.includes('anilist.co') ||
        entry.user?.siteUrl?.includes('anilist.co') ||
        (entry.media?.idMal !== undefined && !entry.media?.simkl_id) ||
        (entry.media?.id && entry.media?.title && entry.media?.type && !entry.media?.simkl_id)) {
      return 'anilist';
    }
    
    // MAL patterns  
    if (entry.node?.main_picture ||
        entry.ranking ||
        entry.media?.mal_id ||
        entry.user?.joined_at ||
        entry.node?.id && entry.node?.title) {
      return 'mal';
    }
    
    // SIMKL patterns
    if (entry.show?.ids?.simkl ||
        entry.user_stats ||
        entry.media?.simkl_id ||
        entry.show?.title && entry.show?.year) {
      return 'simkl';
    }
    
    return null;
  }

  validateAndReturnSource(source) {
    const normalizedSource = source?.toLowerCase();
    const validSources = ['anilist', 'mal', 'simkl'];
    
    if (validSources.includes(normalizedSource)) {
      return normalizedSource;
    }
    
    return null;
  }

  getFallbackSource() {
    // Return first available authenticated source, or default to anilist
    if (this.isAuthenticated('mal')) return 'mal';
    if (this.isAuthenticated('simkl')) return 'simkl'; 
    if (this.isAuthenticated('anilist')) return 'anilist';
    return 'anilist';
  }

  detectMediaType(entry, config, media) {
    if (entry?._zoroMeta?.mediaType) return entry._zoroMeta.mediaType;
    if (config?.mediaType) return config.mediaType;
    if (media?.format === 'MOVIE') return 'MOVIE';
    
    // Better logic for distinguishing between ANIME and TV
    // Check if it's explicitly marked as anime or has anime-specific properties
    if (media?.format === 'TV' || media?.type === 'TV' || 
        (media?.genres && media.genres.some(g => g.toLowerCase().includes('anime')))) {
      return 'TV';
    }
    
    // If it has episodes but no clear indication, check the source
    if (media?.episodes) {
      // For Simkl sources, check if it's in the anime category
      if (entry?.show?.type === 'anime' || entry?.anime) {
        return 'ANIME';
      }
      // Default to TV for shows with episodes unless explicitly anime
      return 'TV';
    }
    
    return 'TV';
  }
}

export { APISourceHelper };