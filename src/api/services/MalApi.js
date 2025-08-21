import { requestUrl } from 'obsidian';
import { ZoroError } from '../../core/ZoroError.js';

class MalApi {
  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue; // Use the RequestQueue instance
    this.cache = plugin.cache;
    
    this.baseUrl = 'https://api.myanimelist.net/v2';
    this.tokenUrl = 'https://myanimelist.net/v1/oauth2/token';
    
    // Basic configuration - request handling delegated to RequestQueue
    this.config = {
      requestTimeout: 30000
    };
    
    // Comprehensive field sets for different layouts
    this.fieldSets = {
      compact: 'id,title,main_picture,list_status{status,score,num_episodes_watched,num_chapters_read}',
      card: 'id,title,main_picture,media_type,status,genres,num_episodes,num_chapters,mean,start_date,end_date,list_status{status,score,num_episodes_watched,num_chapters_read,num_volumes_read,is_rewatching,is_rereading,updated_at}',
      full: 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,list_status{status,score,num_episodes_watched,num_chapters_read,num_volumes_read,is_rewatching,is_rereading,updated_at},num_episodes,num_chapters,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics'
    };

    this.searchFieldSets = {
      compact: 'id,title,main_picture',
      card: 'id,title,main_picture,media_type,status,genres,num_episodes,num_chapters,mean,start_date,end_date',
      full: 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,num_episodes,num_chapters,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics'
    };

    // Status mappings
    this.malToAniListStatus = {
      'watching': 'CURRENT', 'reading': 'CURRENT', 'completed': 'COMPLETED',
      'on_hold': 'PAUSED', 'dropped': 'DROPPED', 
      'plan_to_watch': 'PLANNING', 'plan_to_read': 'PLANNING'
    };

    this.aniListToMalStatus = {
      'CURRENT': 'watching', 'COMPLETED': 'completed', 'PAUSED': 'on_hold',
      'DROPPED': 'dropped', 'PLANNING': 'plan_to_watch'
    };
  }

  // =================== CORE REQUEST METHODS ===================

  createCacheKey(config) {
    const sortedConfig = {};
    Object.keys(config).sort().forEach(key => {
      if (key === 'malAccessToken' || key === 'malClientSecret') return;
      sortedConfig[key] = config[key];
    });
    return JSON.stringify(sortedConfig);
  }

  async fetchMALData(config) {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      this.validateConfig(config);
      
      // Check cache first
      const cacheKey = this.createCacheKey(config);
      const cacheType = this.determineCacheType(config);
      
      if (!config.nocache) {
        const cached = this.cache.get(cacheKey, { 
          scope: cacheType, 
          ttl: this.getCacheTTL(config)
        });
        
        if (cached) {
          this.log('CACHE_HIT', cacheType, requestId, `${(performance.now() - startTime).toFixed(1)}ms`);
          return cached;
        }
      }
      
      // Build request parameters
      const requestParams = this.buildRequestParams(config, requestId);
      
      // Execute request using RequestQueue with MAL service
      const result = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
        priority: config.priority || 'normal',
        timeout: this.config.requestTimeout,
        retries: 3,
        metadata: { 
          type: config.type, 
          mediaType: config.mediaType,
          requestId 
        },
        service: 'mal'
      });
      
      // Transform response to AniList-compatible format
      const transformedData = this.transformResponse(result, config);
      
      // Handle stats enrichment if needed
      if (config.type === 'stats' && transformedData?.User) {
        await this.attachMALDistributions(transformedData.User);
      }
      
      // Cache successful results
      if (transformedData && !config.nocache) {
        this.cache.set(cacheKey, transformedData, { scope: cacheType });
      }
      
      const duration = performance.now() - startTime;
      this.log('REQUEST_SUCCESS', config.type, requestId, `${duration.toFixed(1)}ms`);
      
      return transformedData;
      
    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, config);
      
      this.log('REQUEST_FAILED', config.type, requestId, {
        error: classifiedError.type,
        message: classifiedError.message,
        duration: `${duration.toFixed(1)}ms`
      });
      
      throw this.createZoroError(classifiedError);
    }
  }

  async makeRawRequest(requestParams) {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': `Zoro-Plugin/${this.plugin.manifest.version}`,
      'X-Request-ID': requestParams.requestId,
      ...requestParams.headers
    };

    // Always include MAL client id for public endpoints
    if (this.plugin.settings.malClientId) {
      headers['X-MAL-CLIENT-ID'] = this.plugin.settings.malClientId;
    }

    // Add authentication header only for non-search requests
    if (this.requiresAuth(requestParams.metadata?.type)) {
      if (this.plugin.settings.malAccessToken) {
        headers['Authorization'] = `Bearer ${this.plugin.settings.malAccessToken}`;
      }
    }

    const response = await requestUrl({
      url: requestParams.url,
      method: requestParams.method || 'GET',
      headers,
      body: requestParams.body
    });

    this.validateResponse(response);
    
    // Handle rate limiting
    if (response.status === 429) {
      const error = new Error('Rate limit exceeded');
      error.status = 429;
      error.type = 'RATE_LIMITED';
      error.retryable = true;
      throw error;
    }
    
    if (response.status >= 400) {
      const error = new Error(`HTTP ${response.status}: ${response.text || 'Unknown error'}`);
      error.status = response.status;
      error.type = 'HTTP_ERROR';
      error.retryable = response.status >= 500;
      throw error;
    }
    
    const result = response.json;
    
    if (result?.error) {
      const error = new Error(result.message || 'MAL API error');
      error.type = 'API_ERROR';
      error.originalError = result.error;
      error.retryable = false;
      throw error;
    }
    
    return result;
  }

  // =================== UPDATE METHOD ===================

  async updateMediaListEntry(mediaId, updates) {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      this.validateMediaId(mediaId);
      this.validateUpdates(updates);
      
      if (!this.plugin.settings.malAccessToken) {
        throw new Error('Authentication required to update entries');
      }

      const mediaType = await this.getMediaType(mediaId);
      const endpoint = mediaType === 'anime' ? 'anime' : 'manga';
      const body = this.buildUpdateBody(updates, mediaType);
      
      const requestParams = {
        url: `${this.baseUrl}/${endpoint}/${mediaId}/my_list_status`,
        method: 'PUT',
        body: body.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        requestId,
        metadata: { type: 'update', mediaId }
      };

      const result = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
        priority: 'high',
        timeout: this.config.requestTimeout,
        retries: 2,
        metadata: { 
          type: 'update', 
          mediaId,
          requestId 
        },
        service: 'mal'
      });

      // Invalidate related cache
      await this.invalidateRelatedCache(mediaId, updates);
      
      const duration = performance.now() - startTime;
      this.log('UPDATE_SUCCESS', 'mutation', requestId, {
        mediaId,
        updates: Object.keys(updates),
        duration: `${duration.toFixed(1)}ms`
      });
      
      return this.transformUpdateResponse(result, updates, mediaType);

    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, { type: 'update', mediaId });
      
      this.log('UPDATE_FAILED', 'mutation', requestId, {
        mediaId,
        updates: Object.keys(updates),
        error: classifiedError.type,
        duration: `${duration.toFixed(1)}ms`
      });
      
      throw this.createZoroError(classifiedError);
    }
  }

  buildUpdateBody(updates, mediaType) {
    const body = new URLSearchParams();
    
    // Set rewatching/rereading to false by default
    if (mediaType === 'anime') {
      body.append('is_rewatching', 'false');
    } else {
      body.append('is_rereading', 'false');
    }
    
    if (updates.status !== undefined && updates.status !== null) {
      const malStatus = this.mapAniListStatusToMAL(updates.status, mediaType);
      if (malStatus) {
        body.append('status', malStatus);
      }
    }
    
    if (updates.score !== undefined && updates.score !== null) {
      const score = Math.max(0, Math.min(10, Math.round(updates.score)));
      body.append('score', score.toString());
    }
    
    if (updates.progress !== undefined && updates.progress !== null) {
      const progress = Math.max(0, parseInt(updates.progress) || 0);
      const progressField = mediaType === 'anime' ? 'num_watched_episodes' : 'num_chapters_read';
      body.append(progressField, progress.toString());
    }

    if (body.toString().length === 0) {
      throw new Error('No valid updates provided');
    }

    return body;
  }

  transformUpdateResponse(malResponse, originalUpdates, mediaType) {
    return {
      id: malResponse.id || null,
      status: malResponse.status ? 
        this.mapMALStatusToAniList(malResponse.status, mediaType) : 
        originalUpdates.status,
      score: malResponse.score !== undefined ? 
        malResponse.score : 
        (originalUpdates.score || 0),
      progress: mediaType === 'anime' 
        ? (malResponse.num_episodes_watched !== undefined ? 
           malResponse.num_episodes_watched : 
           (originalUpdates.progress || 0))
        : (malResponse.num_chapters_read !== undefined ? 
           malResponse.num_chapters_read : 
           (originalUpdates.progress || 0)),
      media: {
        id: malResponse.id || null,
        idMal: malResponse.id || null,
        title: { romaji: malResponse.title || 'Unknown Title' }
      }
    };
  }

  // =================== ERROR HANDLING ===================

  classifyError(error, context = {}) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return { type: 'NETWORK_ERROR', message: error.message, severity: 'error', retryable: true };
    }
    
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return { type: 'TIMEOUT', message: error.message, severity: 'warn', retryable: true };
    }
    
    if (error.status === 429 || error.message.includes('rate limit')) {
      return { type: 'RATE_LIMITED', message: error.message, severity: 'warn', retryable: true };
    }
    
    if (error.status === 401 || error.message.includes('Unauthorized') || error.message.includes('auth')) {
      return { type: 'AUTH_ERROR', message: error.message, severity: 'error', retryable: false };
    }
    
    if (error.status >= 500) {
      return { type: 'SERVER_ERROR', message: error.message, severity: 'error', retryable: true };
    }
    
    if (error.message?.includes('Private') || error.message?.includes('permission')) {
      return { type: 'PRIVATE_LIST', message: error.message, severity: 'warn', retryable: false };
    }
    
    if (error.status >= 400 && error.status < 500) {
      return { type: 'CLIENT_ERROR', message: error.message, severity: 'warn', retryable: false };
    }
    
    return { type: 'UNKNOWN_ERROR', message: error.message, severity: 'error', retryable: false };
  }

  createZoroError(classifiedError) {
    const errorMessages = {
      'NETWORK_ERROR': 'Connection issue. Please check your internet connection and try again.',
      'TIMEOUT': 'Request timed out. Please try again.',
      'RATE_LIMITED': 'Too many requests. Please wait a moment and try again.',
      'AUTH_ERROR': 'Authentication expired. Please re-authenticate with MAL.',
      'SERVER_ERROR': 'MAL servers are experiencing issues. Please try again later.',
      'PRIVATE_LIST': 'This user\'s list is private.',
      'CLIENT_ERROR': 'Invalid request. Please check your input.',
      'UNKNOWN_ERROR': 'An unexpected error occurred. Please try again.'
    };
    
    const userMessage = errorMessages[classifiedError.type] || errorMessages['UNKNOWN_ERROR'];
    
    // Use ZoroError.notify for user feedback and create a proper Error object
    ZoroError.notify(userMessage, classifiedError.severity);
    
    const error = new Error(classifiedError.message);
    error.type = classifiedError.type;
    error.severity = classifiedError.severity;
    error.retryable = classifiedError.retryable;
    error.userMessage = userMessage;
    
    return error;
  }

  // =================== VALIDATION & UTILITY METHODS ===================

  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }
    
    if (config.type && !['stats', 'single', 'search', 'list', 'item'].includes(config.type)) {
      throw new Error(`Invalid config type: ${config.type}`);
    }
    
    if (config.mediaType && !['ANIME', 'MANGA'].includes(config.mediaType)) {
      throw new Error(`Invalid media type: ${config.mediaType}`);
    }
    
    if (config.page && (config.page < 1 || config.page > 1000)) {
      throw new Error(`Invalid page: ${config.page}`);
    }
  }

  validateMediaId(mediaId) {
    const id = parseInt(mediaId);
    if (!id || id <= 0) {
      throw new Error(`Invalid media ID: ${mediaId}`);
    }
  }

  validateUpdates(updates) {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates must be an object');
    }
    
    if (Object.keys(updates).length === 0) {
      throw new Error('At least one field must be updated');
    }
  }

  validateResponse(response) {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from MAL');
    }
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =================== CACHE MANAGEMENT ===================

  determineCacheType(config) {
    const typeMap = {
      'stats': 'userData',
      'single': 'mediaData',
      'item': 'mediaData',
      'search': 'searchResults',
      'list': 'userData'
    };
    return typeMap[config.type] || 'userData';
  }

  getCacheTTL(config) {
    return null; // Use cache's built-in TTL system
  }

  async invalidateRelatedCache(mediaId, updates) {
    this.cache.invalidateByMedia(mediaId);
    
    if (updates.status) {
      try {
        const username = await this.getAuthenticatedUsername();
        if (username) {
          this.cache.invalidateByUser(username);
        }
      } catch (error) {
        // Ignore errors getting username for cache invalidation
      }
    }
  }

  // =================== OAUTH METHOD ===================

  async makeObsidianRequest(code, redirectUri) {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      if (!code || typeof code !== 'string') {
        throw new Error('Authorization code is required');
      }
      
      if (!redirectUri || typeof redirectUri !== 'string') {
        throw new Error('Redirect URI is required');
      }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.plugin.settings.malClientId,
        client_secret: this.plugin.settings.malClientSecret || '',
        redirect_uri: redirectUri,
        code: code,
        code_verifier: this.plugin.settings.malCodeVerifier || ''
      });

      const requestParams = {
        url: this.tokenUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: body.toString(),
        requestId,
        metadata: { type: 'auth' }
      };

      const result = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
        priority: 'high',
        timeout: this.config.requestTimeout,
        retries: 2,
        metadata: { 
          type: 'auth',
          requestId 
        },
        service: 'mal'
      });

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response structure from MAL');
      }

      const duration = performance.now() - startTime;
      this.log('AUTH_SUCCESS', 'oauth', requestId, `${duration.toFixed(1)}ms`);

      return result;

    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, { type: 'auth' });
      
      this.log('AUTH_FAILED', 'oauth', requestId, {
        error: classifiedError.type,
        duration: `${duration.toFixed(1)}ms`
      });

      throw this.createZoroError(classifiedError);
    }
  }

  getMALUrl(mediaId, mediaType = 'ANIME') {
    try {
      this.validateMediaId(mediaId);
      
      const type = String(mediaType).toUpperCase();
      const urlType = type === 'MANGA' ? 'manga' : 'anime';

      return `https://myanimelist.net/${urlType}/${mediaId}`;
    } catch (error) {
      this.log('URL_GENERATION_FAILED', 'utility', this.generateRequestId(), {
        mediaId,
        mediaType,
        error: error.message
      });
      throw error;
    }
  }

  // =================== REQUEST BUILDERS ===================

  buildRequestParams(config, requestId) {
    const url = this.buildEndpointUrl(config);
    const params = this.buildQueryParams(config);
    
    return {
      url: this.buildFullUrl(url, params),
      method: 'GET',
      headers: this.getBaseHeaders(requestId),
      requestId,
      metadata: { type: config.type, mediaType: config.mediaType }
    };
  }

  buildEndpointUrl(config) {
    switch (config.type) {
      case 'stats':
        return `${this.baseUrl}/users/@me`;
      case 'single':
      case 'list':
        const mediaType = config.mediaType === 'ANIME' ? 'anime' : 'manga';
        return `${this.baseUrl}/users/@me/${mediaType}list`;
      case 'search':
        // Use proper MAL search endpoints
        if (config.mediaType === 'ANIME') {
          return `${this.baseUrl}/anime`; // GET /anime?q=...&limit=...
        } else {
          return `${this.baseUrl}/manga`; // GET /manga?q=...&limit=...
        }
      case 'item':
        const itemType = config.mediaType === 'ANIME' ? 'anime' : 'manga';
        return `${this.baseUrl}/${itemType}/${parseInt(config.mediaId)}`;
      default:
        throw new Error(`Unknown type: ${config.type}`);
    }
  }

  buildQueryParams(config) {
    const params = {};
    
    switch (config.type) {
      case 'single':
      case 'list':
        params.fields = this.getFieldsForLayout(config.layout || 'card', false);
        params.limit = config.limit || 1000;
        
        if (config.listType && config.listType !== 'ALL') {
          const malStatus = this.mapAniListStatusToMAL(config.listType, config.mediaType?.toLowerCase());
          if (malStatus) {
            params.status = malStatus;
          }
        }
        params.sort = 'list_score';
        break;
        
      case 'search':
        params.q = (config.search || config.query || '').trim();
        params.limit = config.perPage || 25;
        // MAL search does not support offset param on v2 search; keep limit only
        // fields are not accepted on search endpoints
        break;
      
      case 'item':
        params.fields = this.getFieldsForLayout(config.layout || 'card', true);
        break;
        
      case 'stats':
        params.fields = ['id', 'name', 'picture', 'anime_statistics', 'manga_statistics'].join(',');
        break;
    }
    
    return params;
  }

  buildFullUrl(baseUrl, params) {
    if (!params || Object.keys(params).length === 0) return baseUrl;
    const queryString = new URLSearchParams(params).toString();
    return `${baseUrl}?${queryString}`;
  }

  getBaseHeaders(requestId) {
    return {
      'Accept': 'application/json',
      'User-Agent': `Zoro-Plugin/${this.plugin.manifest.version}`,
      'X-Request-ID': requestId
    };
  }

  getFieldsForLayout(layout = 'card', isSearch = false) {
    const fieldSet = isSearch ? this.searchFieldSets : this.fieldSets;
    return fieldSet[layout] || fieldSet.card;
  }

  // =================== RESPONSE TRANSFORMERS ===================

  transformResponse(data, config) {
    switch (config.type) {
      case 'search':
        return { Page: { media: data.data?.map(item => this.transformMedia(item)) || [] } };
      case 'single':
        return { MediaList: null };
      case 'item':
        return { Media: this.transformMedia(data) };
      case 'stats':
        return { User: this.transformUser(data) };
      default:
        return {
          MediaListCollection: {
            lists: [{ 
              entries: data.data?.map(item => this.transformListEntry(item, config)) || [] 
            }]
          }
        };
    }
  }

  transformListEntry(malEntry, config = {}) {
    const media = malEntry.node || malEntry;
    const listStatus = malEntry.list_status;
    const mediaType = media?.media_type || 'tv';
    
    let status = null;
    let score = 0;
    let progress = 0;
    let entryId = null;

    if (listStatus) {
      status = this.mapMALStatusToAniList(listStatus.status, mediaType);
      score = listStatus.score || 0;
      
      if (mediaType === 'manga' || mediaType === 'novel' || mediaType === 'manhwa') {
        progress = listStatus.num_chapters_read || 0;
      } else {
        progress = listStatus.num_episodes_watched || 0;
      }
      
      entryId = listStatus.id || null;
    } else if (config.listType) {
      status = config.listType;
      score = 0;
      progress = 0;
      entryId = null;
    }

    return {
      id: entryId,
      status: status,
      score: score,
      progress: progress,
      chaptersRead: listStatus?.num_chapters_read ?? null,
      volumesRead: listStatus?.num_volumes_read ?? null,
      media: this.transformMedia(malEntry)
    };
  }

  transformMedia(malMedia) {
    const media = malMedia.node || malMedia;
    
    return {
      id: media.id,
      idMal: media.id,
      title: {
        romaji: media.title || 'Unknown Title',
        english: media.alternative_titles?.en || media.title || 'Unknown Title',
        native: media.alternative_titles?.ja || media.title || 'Unknown Title'
      },
      coverImage: {
        large: media.main_picture?.large || media.main_picture?.medium || null,
        medium: media.main_picture?.medium || media.main_picture?.large || null
      },
      format: media.media_type?.toUpperCase() || null,
      averageScore: media.mean ? Math.round(media.mean * 10) : null,
      status: media.status?.toUpperCase()?.replace('_', '_') || null,
      genres: media.genres?.map(g => g.name) || [],
      episodes: media.num_episodes || null,
      chapters: media.num_chapters || null,
      isFavourite: false,
      startDate: this.parseDate(media.start_date),
      endDate: this.parseDate(media.end_date),
      description: media.synopsis || null,
      meanScore: media.mean ? Math.round(media.mean * 10) : null,
      popularity: media.popularity || null,
      favourites: media.num_list_users || null,
      studios: media.studios ? { nodes: media.studios.map(s => ({ name: s.name })) } : null
    };
  }
  transformUser(malUser) {
    const animeStats = malUser?.anime_statistics || {};
    const mangaStats = malUser?.manga_statistics || {};

    const countAnime = animeStats.num_items || 0;
    const countManga = mangaStats.num_items || 0;

    const minutesWatched = typeof animeStats.num_days_watched === 'number'
      ? Math.round(animeStats.num_days_watched * 24 * 60)
      : 0;
      
    return {
      id: malUser?.id || null,
      name: malUser?.name || 'Unknown User',
      avatar: {
        large: malUser?.picture || null,
        medium: malUser?.picture || null
      },
      mediaListOptions: {
        scoreFormat: 'POINT_10'
      },
      statistics: {
        anime: {
          count: countAnime,
          meanScore: typeof animeStats.mean_score === 'number' ? Math.round(animeStats.mean_score * 10) : 0,
          standardDeviation: 0,
          episodesWatched: animeStats.num_episodes || 0,
          minutesWatched: minutesWatched,
          statuses: [],
          scores: [],
          formats: [],
          releaseYears: [],
          genres: []
        },
        manga: {
          count: countManga,
          meanScore: typeof mangaStats.mean_score === 'number' ? Math.round(mangaStats.mean_score * 10) : 0,
          standardDeviation: 0,
          chaptersRead: mangaStats.num_chapters || 0,
          volumesRead: mangaStats.num_volumes || 0,
          statuses: [],
          scores: [],
          formats: [],
          releaseYears: [],
          genres: []
        }
      },
      favourites: {
        anime: { nodes: [] },
        manga: { nodes: [] }
      }
    };
  }

  parseDate(dateString) {
    if (!dateString) return null;
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate()
      };
    } catch (error) {
      return null;
    }
  }

  // =================== STATUS MAPPING ===================

  mapAniListStatusToMAL(aniListStatus, mediaType = 'anime') {
    if (!aniListStatus) return null;
    
    const isAnime = mediaType === 'anime' || mediaType === 'tv' || mediaType === 'movie' || 
                   mediaType === 'special' || mediaType === 'ova' || mediaType === 'ona';
    
    const statusMap = {
      'CURRENT': isAnime ? 'watching' : 'reading',
      'COMPLETED': 'completed',
      'PAUSED': 'on_hold',
      'DROPPED': 'dropped',
      'PLANNING': isAnime ? 'plan_to_watch' : 'plan_to_read',
      'REPEATING': isAnime ? 'watching' : 'reading'
    };
    
    return statusMap[aniListStatus] || null;
  }

  mapMALStatusToAniList(malStatus, mediaType = 'anime') {
    if (!malStatus) return null;
    
    const statusMap = {
      'watching': 'CURRENT',
      'reading': 'CURRENT', 
      'completed': 'COMPLETED',
      'on_hold': 'PAUSED',
      'dropped': 'DROPPED',
      'plan_to_watch': 'PLANNING',
      'plan_to_read': 'PLANNING'
    };
    
    return statusMap[malStatus.toLowerCase()] || null;
  }

  // =================== AUTHENTICATION ===================

  async getAuthenticatedUsername() {
    try {
      if (!this.plugin.settings.malAccessToken) return null;
      
      const requestParams = {
        url: `${this.baseUrl}/users/@me?fields=id,name`,
        method: 'GET',
        requestId: this.generateRequestId(),
        metadata: { type: 'user_info' }
      };
      
      const result = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
        priority: 'normal',
        timeout: this.config.requestTimeout,
        retries: 1,
        metadata: { 
          type: 'user_info',
          nocache: true 
        },
        service: 'mal'
      });
      
      return result?.name || null;
      
    } catch (error) {
      console.warn('[MAL] getAuthenticatedUsername failed:', error.message);
      return null;
    }
  }

  requiresAuth(requestType) {
    return requestType !== 'search';
  }

  // =================== UTILITY METHODS ===================

  async getMediaType(mediaId) {
    const types = ['anime', 'manga'];
    
    for (const type of types) {
      try {
        const requestParams = {
          url: `${this.baseUrl}/${type}/${mediaId}?fields=id`,
          method: 'GET',
          requestId: this.generateRequestId(),
          metadata: { type: 'media_type_check' }
        };
        
        const response = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
          priority: 'low',
          timeout: this.config.requestTimeout,
          retries: 1,
          metadata: { 
            type: 'media_type_check',
            nocache: true 
          },
          service: 'mal'
        });
        
        if (response && !response.error) return type;
      } catch (error) {
        continue;
      }
    }
    return 'anime';
  }

  // =================== ENHANCED FEATURES ===================

  async attachMALDistributions(user) {
    try {
      const [animeEntries, mangaEntries] = await Promise.all([
        this.fetchUserListEntries('ANIME'),
        this.fetchUserListEntries('MANGA')
      ]);

      const animeAgg = this.aggregateDistributionsFromEntries(animeEntries, 'anime');
      const mangaAgg = this.aggregateDistributionsFromEntries(mangaEntries, 'manga');

      if (user?.statistics?.anime) {
        Object.assign(user.statistics.anime, animeAgg);
      }
      if (user?.statistics?.manga) {
        Object.assign(user.statistics.manga, mangaAgg);
      }
      
      this.applyStatsFallbacks(animeEntries, user?.statistics?.anime, 'anime');
      this.applyStatsFallbacks(mangaEntries, user?.statistics?.manga, 'manga');
      
    } catch (error) {
      console.warn('[MAL] Failed to attach distributions:', error);
    }
  }

  async fetchUserListEntries(mediaType) {
    const listConfig = { type: 'list', mediaType, layout: 'card', limit: 1000 };
    const requestParams = this.buildRequestParams(listConfig, this.generateRequestId());
    
    const raw = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
      priority: 'normal',
      timeout: this.config.requestTimeout,
      retries: 2,
      metadata: { 
        type: 'list',
        mediaType 
      },
      service: 'mal'
    });
    
    const transformed = this.transformResponse(raw, listConfig);
    const entries = transformed?.MediaListCollection?.lists?.[0]?.entries || [];
    return entries;
  }

  aggregateDistributionsFromEntries(entries, typeLower) {
    const result = {
      statuses: [],
      scores: [],
      formats: [],
      releaseYears: [],
      genres: []
    };

    if (!Array.isArray(entries) || entries.length === 0) return result;

    const statusCounts = new Map();
    const scoreCounts = new Map();
    const formatCounts = new Map();
    const yearCounts = new Map();
    const genreSet = new Set();

    for (const entry of entries) {
      const status = entry?.status;
      if (status) {
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      }

      const rawScore = entry?.score;
      if (typeof rawScore === 'number' && rawScore > 0) {
        const scaled = Math.round(rawScore * 10);
        scoreCounts.set(scaled, (scoreCounts.get(scaled) || 0) + 1);
      }

      const format = entry?.media?.format;
      if (format) {
        formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
      }

      const year = entry?.media?.startDate?.year;
      if (typeof year === 'number' && year > 0) {
        yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      }

      const genres = entry?.media?.genres || [];
      for (const g of genres) {
        if (typeof g === 'string' && g.trim()) genreSet.add(g);
      }
    }

    result.statuses = Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    result.scores = Array.from(scoreCounts.entries())
      .map(([score, count]) => ({ score, count }))
      .sort((a, b) => a.score - b.score);

    result.formats = Array.from(formatCounts.entries())
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count);

    result.releaseYears = Array.from(yearCounts.entries())
      .map(([releaseYear, count]) => ({ releaseYear, count }))
      .sort((a, b) => b.releaseYear - a.releaseYear);

    result.genres = Array.from(genreSet);

    return result;
  }

  applyStatsFallbacks(entries, statsObj, type) {
    if (!statsObj) return;

    if (!statsObj.count || statsObj.count === 0) {
      statsObj.count = Array.isArray(entries) ? entries.length : 0;
    }

    if ((!statsObj.meanScore || statsObj.meanScore === 0) && Array.isArray(entries) && entries.length) {
      const rated = entries.filter(e => typeof e.score === 'number' && e.score > 0);
      if (rated.length) {
        const avg10 = rated.reduce((sum, e) => sum + e.score, 0) / rated.length;
        statsObj.meanScore = Math.round(avg10 * 10);
      }
    }

    if (type === 'manga') {
      if (!statsObj.chaptersRead || statsObj.chaptersRead === 0) {
        statsObj.chaptersRead = entries.reduce((s, e) => s + (e.chaptersRead || 0), 0);
      }
      if (!statsObj.volumesRead || statsObj.volumesRead === 0) {
        statsObj.volumesRead = entries.reduce((s, e) => s + (e.volumesRead || 0), 0);
      }
    } else if (type === 'anime') {
      if (!statsObj.episodesWatched || statsObj.episodesWatched === 0) {
        statsObj.episodesWatched = entries.reduce((s, e) => s + (e.progress || 0), 0);
      }
    }
  }

  // =================== ADDITIONAL API METHODS ===================

  async getMALRecommendations(mediaId, mediaType = 'ANIME') {
    return await ZoroError.guard(async () => {
      const type = mediaType === 'ANIME' ? 'anime' : 'manga';
      
      const requestParams = {
        url: `${this.baseUrl}/${type}/${mediaId}?fields=recommendations`,
        method: 'GET',
        requestId: this.generateRequestId(),
        metadata: { type: 'recommendations' }
      };

      const response = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
        priority: 'low',
        timeout: this.config.requestTimeout,
        retries: 1,
        metadata: { 
          type: 'recommendations',
          nocache: false 
        },
        service: 'mal'
      });
      
      return response.recommendations?.map(rec => ({
        node: this.transformMedia(rec.node),
        num_recommendations: rec.num_recommendations
      })) || [];
      
    }, 'cache');
  }

  async getMALSeasonalAnime(year, season) {
    return await ZoroError.guard(async () => {
      const requestParams = {
        url: `${this.baseUrl}/anime/season/${year}/${season}?fields=${this.getFieldsForLayout('card', true)}`,
        method: 'GET',
        requestId: this.generateRequestId(),
        metadata: { type: 'seasonal' }
      };

      const response = await this.requestQueue.add(() => this.makeRawRequest(requestParams), {
        priority: 'low',
        timeout: this.config.requestTimeout,
        retries: 1,
        metadata: { 
          type: 'seasonal',
          nocache: false 
        },
        service: 'mal'
      });
      
      return {
        Page: {
          media: response.data?.map(item => this.transformMedia(item)) || []
        }
      };
      
    }, 'cache');
  }

  // =================== LOGGING ===================

  log(level, category, requestId, data = '') {
    if (level === 'ERROR') {
      const timestamp = new Date().toISOString();
      const logData = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
      console.log(`[${timestamp}] [Zoro-MAL] [${level}] [${category}] [${requestId}] ${logData}`);
    }
  }

  // =================== METRICS ===================

  getMetrics() {
    // Get metrics from the MAL service in RequestQueue
    const requestQueueMetrics = this.requestQueue.getMetrics();
    const malServiceMetrics = requestQueueMetrics.services?.mal || {};
    const malRateLimit = requestQueueMetrics.rateLimit?.mal || {};
    
    return {
      ...malServiceMetrics,
      utilization: malRateLimit.utilization || '0%',
      authStatus: requestQueueMetrics.mal?.authFailures === 0 ? 'healthy' : 'degraded',
      rateLimitInfo: malRateLimit
    };
  }

  // =================== COMPATIBILITY METHODS ===================

  async fetchMALStats(config) {
    return this.fetchMALData({ ...config, type: 'stats' });
  }

  async fetchMALList(config) {
    return this.fetchMALData(config);
  }
}

export { MalApi };