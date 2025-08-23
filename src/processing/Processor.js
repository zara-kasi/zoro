import { Notice } from 'obsidian';
import { Trending } from '../features/Trending.js';

class Processor {
  constructor(plugin) {
    this.plugin = plugin;
    this.apiRegistry = new Map();
    this.initializeApis();
  }

  initializeApis() {
    if (this.plugin.api) {
      this.apiRegistry.set('anilist', this.plugin.api);
    }
    
    if (this.plugin.malApi) {
      this.apiRegistry.set('mal', this.plugin.malApi);
    }
    
    if (this.plugin.simklApi) {
      this.apiRegistry.set('simkl', this.plugin.simklApi);
    }
  }

  getApiInstance(source) {
    const normalizedSource = source?.toLowerCase();
    
    if (!this.apiRegistry.has(normalizedSource)) {
      const availableSources = Array.from(this.apiRegistry.keys()).join(', ');
      throw new Error(`❌ Unsupported API source: ${source}. Available sources: ${availableSources}`);
    }
    
    return this.apiRegistry.get(normalizedSource);
  }

  getSupportedOperations(source) {
    const operationMap = {
      'anilist': ['stats', 'search', 'single', 'list', 'trending'],
      'mal': ['stats', 'search', 'single', 'list', 'trending'],
      'simkl': ['stats', 'search', 'single', 'list', 'trending']
    };
    
    return operationMap[source?.toLowerCase()] || [];
  }

  validateOperation(source, operation) {
    const supportedOps = this.getSupportedOperations(source);
    
    if (!supportedOps.includes(operation)) {
      throw new Error(`❌ Operation '${operation}' is not supported by ${source.toUpperCase()}. Supported operations: ${supportedOps.join(', ')}`);
    }
  }

  createSkeleton(config) {
    const skeletonMap = {
      'stats': () => this.plugin.render.createStatsSkeleton(),
      'single': () => this.plugin.render.createListSkeleton(1),
      'trending': () => this.plugin.render.createListSkeleton(),
      'search': () => this.plugin.render.createListSkeleton(),
      'list': () => this.plugin.render.createListSkeleton()
    };

    const createSkeletonFn = skeletonMap[config.type];
    if (!createSkeletonFn) {
      return this.plugin.render.createListSkeleton();
    }

    return createSkeletonFn();
  }

  async resolveAuthentication(config) {
    const updatedConfig = { ...config };

    if (config.source === 'mal' || config.source === 'simkl') {
      return updatedConfig;
    }

    if (updatedConfig.useAuthenticatedUser) {
      const authUsername = await this.plugin.auth.getAuthenticatedUsername();
      if (!authUsername) {
        throw new Error('❌ Could not retrieve authenticated username. Please authenticate or provide a username.');
      }
      updatedConfig.username = authUsername;
    }

    return updatedConfig;
  }

  async executeApiOperation(api, config) {
    const { type, source } = config;

    try {
      switch (type) {
        case 'stats':
          return await this.handleStatsOperation(api, config);
          
        case 'search':
          return await this.handleSearchOperation(api, config);
          
        case 'single':
          return await this.handleSingleOperation(api, config);
          
        case 'list':
          return await this.handleListOperation(api, config);
          
        case 'trending':
          return await this.handleTrendingOperation(api, config);
          
        default:
          throw new Error(`❌ Unknown operation type: ${type}`);
      }
    } catch (error) {
      throw new Error(`❌ ${source.toUpperCase()} API operation failed: ${error.message}`);
    }
  }

injectMetadata(data, config) {
  if (!data) return data;
  
  const metadata = {
    source: config.source || 'anilist',
    mediaType: config.mediaType || (data.media?.type || 'ANIME')
  };

  if (Array.isArray(data)) {
    data.forEach(entry => {
      if (entry) {
        entry._zoroMeta = metadata;
        // Ensure media type is consistent
        if (entry.media && !entry.media.type) {
          entry.media.type = metadata.mediaType;
        }
      }
    });
    return data;
  }
  
  // Handle single entry
  if (data && typeof data === 'object') {
    data._zoroMeta = metadata;
    if (data.media && !data.media.type) {
      data.media.type = metadata.mediaType;
    }
  }
  
  return data;
}
 async handleStatsOperation(api, config) {
  if (config.source === 'mal') {
    const response = await api.fetchMALData({ ...config, type: 'stats' });
    const data = response?.User || response;
    return this.injectMetadata(data, config);
  } else if (config.source === 'simkl') {
    const response = await api.fetchSimklData({ ...config, type: 'stats' });
    const data = response?.User || response;
    return this.injectMetadata(data, config);
  } else {
    const data = await api.fetchAniListData?.(config);
    const result = data?.User || data;
    return this.injectMetadata(result, config);
  }
}

async handleSearchOperation(api, config) {
  return { isSearchInterface: true, config };
}

async handleSingleOperation(api, config) {
  if (!config.mediaId && !config.externalIds) {
    throw new Error('❌ Media ID or externalIds is required for single media view');
  }

  if (config.source === 'mal') {
    // Use item endpoint to fetch single MAL media reliably
    const response = await api.fetchMALData({ ...config, type: 'item' });
    const media = response?.Media;
    const wrapped = media ? { id: null, status: null, score: null, progress: 0, media } : null;
    return this.injectMetadata(wrapped, config);
  } else if (config.source === 'simkl') {
    const response = await api.fetchSimklData({ ...config, type: 'single' });
    const data = response?.MediaList;
    return this.injectMetadata(data, config);
  } else {
    // AniList: use Media(id) query; wrap result to MediaList-like shape for renderer
    const data = await api.fetchAniListData?.({ ...config, type: 'single' });
    const media = data?.Media;
    const wrapped = media ? { id: null, status: null, score: null, progress: 0, media } : null;
    return this.injectMetadata(wrapped, config);
  }
}

async handleListOperation(api, config) {
  if (config.source === 'mal') {
    const response = await api.fetchMALData({
      ...config,
      type: 'list'
    });
    const entries = response?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.injectMetadata(entries, config);
  } else if (config.source === 'simkl') {
    const response = await api.fetchSimklData({
      ...config,
      type: 'list'
    });
    const entries = response?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.injectMetadata(entries, config);
  } else {
    const data = await api.fetchAniListData?.({ ...config });
    const entries = data?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.injectMetadata(entries, config);
  }
}

async handleTrendingOperation(api, config) {
  const trending = new Trending(this.plugin);
  
  const data = await trending.fetchTrending(
    config.source, 
    config.mediaType, 
    config.limit || 40  // Changed from 20 to 40
  );
  
  if (Array.isArray(data)) {
    data.forEach(item => {
      if (!item._zoroMeta) {
        item._zoroMeta = {
          source: config.source,
          mediaType: config.mediaType,
          fetchedAt: Date.now()
        };
      }
    });
  }
  
  return data;
}

async renderData(el, data, config) {
  const { type } = config;

  try {
    switch (type) {
      case 'stats':
        this.plugin.render.renderUserStats(el, data, { 
          mediaType: config.mediaType || 'ANIME', 
          layout: config.layout || 'enhanced' 
        });
        break;

      case 'search':
        if (data.isSearchInterface) {
          await this.plugin.render.renderSearchInterface(el, data.config);
        } else {
          this.plugin.render.renderSearchResults(el, data.Page?.media || [], config);
        }
        break;

      case 'single':
        this.plugin.render.renderSingleMedia(el, data, config);
        break;

      case 'list':
        this.plugin.render.renderMediaList(el, data, config);
        break;

      case 'trending':
        if (Array.isArray(data)) {
          console.log(`[Processor] Rendering trending data: ${data.length} items`);
          // Data is already fetched and formatted, just render it
          this.plugin.render.renderSearchResults(el, data, {
            layout: config.layout || 'card',
            mediaType: config.mediaType || 'ANIME',
            source: config.source,
            type: 'trending'
          });
        } else if (data && data.isTrendingOperation) {
          // Fallback to the old render method if needed
          console.log('[Processor] Using fallback trending render method');
          const trending = new Trending(this.plugin);
          await trending.renderTrendingBlock(el, data.config);
        } else {
          throw new Error('Invalid trending data format received');
        }
        break;

      default:
        throw new Error(`❌ Unknown rendering type: ${type}`);
    }
  } catch (error) {
    console.error('[Processor] Render data failed:', error);
    throw new Error(`❌ Rendering failed: ${error.message}`);
  }
}


  async processZoroCodeBlock(source, el, ctx) {
    let config;
    
    try {
      config = this.parseCodeBlockConfig(source) || {};
      
      this.validateOperation(config.source, config.type);
      
      const skeleton = this.createSkeleton(config);
      el.empty();
      el.appendChild(skeleton);

      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);

      await this.executeProcessing(el, config, retryFn);

    } catch (error) {
      console.error('[Zoro] Code block processing error:', error);
      el.empty();
      
      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);
      this.plugin.renderError(
        el,
        error.message || 'Unknown error occurred.',
        'Code block',
        retryFn
      );
    }
  }

async executeProcessing(el, config, retryFn) {
  try {
    const resolvedConfig = await this.resolveAuthentication(config);
    
    // Get API instance for non-trending operations
    let api = null;
    if (resolvedConfig.type !== 'trending') {
      api = this.getApiInstance(resolvedConfig.source);
    }
    
    // Execute the operation
    const data = await this.executeApiOperation(api, resolvedConfig);
    
    // Render the data
    await this.renderData(el, data, resolvedConfig);

  } catch (error) {
    console.error('[Processor] Execute processing failed:', error);
    el.empty();
    this.plugin.renderError(el, error.message, 'Failed to load', retryFn);
    throw error;
  }
}

  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    const keyMappings = {
      'username': 'username',
      'user': 'username',
      'listtype': 'listType',
      'list-type': 'listType',
      'list_type': 'listType',
      'mediatype': 'mediaType',
      'media-type': 'mediaType',
      'media_type': 'mediaType',
      'type': 'type',
      'layout': 'layout',
      'search': 'search',
      'query': 'search',
      'source': 'source',
      'api': 'source',
      'page': 'page',
      'perpage': 'perPage',
      'per-page': 'perPage',
      'per_page': 'perPage',
      'limit': 'perPage',
      // support single media identifiers
      'mediaid': 'mediaId',
      'media-id': 'mediaId',
      'media_id': 'mediaId',
      'id': 'mediaId'
    };

    for (let raw of lines) {
      const colonIndex = raw.indexOf(':');
      if (colonIndex === -1) continue;

      let key = raw.slice(0, colonIndex).trim().toLowerCase();
      let value = raw.slice(colonIndex + 1).trim();

      const mappedKey = keyMappings[key];
      if (!mappedKey) continue;

      config[mappedKey] = this.processConfigValue(mappedKey, value);
    }

    return this.applyConfigDefaults(config);
  }

  processConfigValue(key, value) {
    switch (key) {
      case 'listType':
        return value.toUpperCase().replace(/[\s-]/g, '_');
      case 'mediaType':
        return value.toUpperCase();
      case 'type':
      case 'layout':
      case 'source':
        return value.toLowerCase();
      case 'page':
      case 'perPage':
      case 'mediaId':
        return parseInt(value) || undefined;
      default:
        return value;
    }
  }

  applyConfigDefaults(config) {
  const mt = String(config.mediaType || 'ANIME').toUpperCase();
  if (!config.source) {
    if (mt === 'MOVIE' || mt === 'MOVIES' || mt === 'TV' || mt === 'SHOW' || mt === 'SHOWS') {
      config.source = 'simkl';
    } else if (mt === 'MANGA') {
      const def = this.plugin.settings.defaultApiSource || 'anilist';
      config.source = def === 'simkl' ? 'mal' : def;
    } else {
      config.source = this.plugin.settings.defaultApiSource || 'anilist';
    }
  }

  if (config.type === 'trending') {
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
    config.limit = config.limit || config.perPage || 40;  // Changed from 20 to 40
    
    const mtUpper = config.mediaType.toUpperCase();
    if (['MOVIE','MOVIES','TV','SHOW','SHOWS'].includes(mtUpper)) {
      config.source = 'simkl';
    } else if (mtUpper === 'MANGA' && (config.source === 'anilist' || config.source === 'simkl')) {
      config.source = 'mal';
    }
    
    return config;
  }

  // Existing authentication checks for other operations
  if (config.source === 'mal' || config.source === 'simkl') {
    if (!this.hasValidAuthForSource(config.source)) {
      throw new Error(`❌ ${config.source.toUpperCase()} authentication required. Please authenticate in plugin settings.`);
    }
  } else {
    if (!config.username) {
      if (this.plugin.settings.defaultUsername) {
        config.username = this.plugin.settings.defaultUsername;
      } else if (this.hasValidAuthForSource(config.source)) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('❌ Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
      }
    }
  }

  config.type = config.type || 'list';
  config.mediaType = config.mediaType || 'ANIME';
  config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
  
  if (!config.listType && config.type === 'list') {
    config.listType = 'CURRENT';
  }
  
  if ((config.source === 'mal' || config.source === 'simkl') && config.listType === 'REPEATING') {
    throw new Error('Repeating is supported only on AniList.');
  }
  
  if (config.source === 'simkl' && config.mediaType === 'MANGA') {
    throw new Error('Manga is supported only on AniList and MyAnimeList.');
  }

  return config;
}

  hasValidAuthForSource(source) {
    switch (source) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'simkl':
        return !!this.plugin.settings.simklAccessToken;
      case 'anilist':
        return !!this.plugin.settings.accessToken;
      default:
        return false;
    }
  }
}

export { Processor };