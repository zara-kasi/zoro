import { requestUrl } from 'obsidian';
import { ZoroError } from '../../core/ZoroError.js';


class SimklApi {

  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue;
    this.cache = plugin.cache;
    
    this.baseUrl = 'https://api.simkl.com';
    this.tokenUrl = 'https://api.simkl.com/oauth/token';
    
    // Field sets for different request types (similar to MAL structure)
    this.fieldSets = {
      compact: 'title,poster',
      card: 'title,poster,year,ids,genres,rating,total_episodes,status',
      full: 'title,poster,year,ids,genres,rating,total_episodes,total_seasons,status,overview,first_aired,last_aired,country,network,aired_episodes'
    };

    // Search-specific field sets (no user data)
    this.searchFieldSets = {
      compact: 'title,poster,year,ids',
      card: 'title,poster,year,ids,genres,rating,total_episodes',
      full: 'title,poster,year,ids,genres,rating,total_episodes,overview,first_aired,last_aired'
    };

    // Status mappings (Simkl uses different status names)
    // Note: Movies only support plantowatch, completed, dropped
    // TV/Anime support watching, hold, completed, dropped, plantowatch
    this.simklToAniListStatus = {
      'watching': 'CURRENT',
      'completed': 'COMPLETED', 
      'hold': 'PAUSED',
      'dropped': 'DROPPED',
      'plantowatch': 'PLANNING',
      'notinteresting': 'DROPPED'
    };

    this.aniListToSimklStatus = {
      'CURRENT': 'watching',
      'COMPLETED': 'completed',
      'PAUSED': 'hold',
      'DROPPED': 'dropped',
      'PLANNING': 'plantowatch'
    };

    // Media type-specific status validation
    this.validMovieStatuses = ['plantowatch', 'completed', 'dropped'];
    this.validShowStatuses = ['watching', 'hold', 'completed', 'dropped', 'plantowatch'];

    // Media type mapping for API endpoints and data parsing
    this.mediaTypeMap = {
      'ANIME': 'anime',
      'MANGA': 'anime', // Simkl doesn't have manga, fallback to anime
      'TV': 'tv',
      'MOVIE': 'movies',
      'MOVIES': 'movies'
    };

    this.metrics = { requests: 0, cached: 0, errors: 0 };
  }

  // =================== MAIN FETCH METHOD (Following MAL pattern) ===================

  async fetchSimklData(config) {
    try {
      return await this.executeFetch(config);
    } catch (error) {
      this.metrics.errors++;
      
      throw this.createUserFriendlyError(error);
    }
  }

  async executeFetch(config) {
    const normalizedConfig = this.validateConfig(config);
    const cacheKey = this.createCacheKey(normalizedConfig);
    const cacheScope = this.getCacheScope(normalizedConfig.type);
    
    // Check cache first
    if (!normalizedConfig.nocache) {
      const cached = this.cache.get(cacheKey, { scope: cacheScope });
      if (cached) {
        this.metrics.cached++;
        return cached;
      }
    }

    // Ensure authentication for user-specific requests
    if (this.requiresAuth(normalizedConfig.type)) {
      await this.ensureValidToken();
    }
    
    // Build and execute request
    let transformedData = null;
    try {
      if (normalizedConfig.type === 'search') {
        // Use robust search with endpoint fallbacks
        transformedData = await this.performSearchWithFallbacks(normalizedConfig);
      } else {
        const requestParams = this.buildRequestParams(normalizedConfig);
        const rawResponse = await this.makeRequest(requestParams);
        transformedData = this.transformResponse(rawResponse, normalizedConfig);
      }
    } catch (err) {
      if (normalizedConfig.type !== 'single') {
        throw err;
      }
      console.warn('[Simkl] Primary single request failed, will try public fallback:', err?.message || err);
    }
    
    // If stats requested, enrich with distributions computed from user lists
    if (normalizedConfig.type === 'stats' && transformedData?.User) {
      try {
        await this.attachSimklDistributions(transformedData.User);
      } catch (e) {
        
      }
    }
     // Public fallback for single media when not found or auth missing
    if (normalizedConfig.type === 'single' && (!transformedData || transformedData.MediaList == null)) {
      try {
        const publicResult = await this.fetchSingleByIdPublic(normalizedConfig.mediaId, normalizedConfig.mediaType);
        if (publicResult) {
          transformedData = publicResult;
        }
      } catch (e) {
        console.warn('[Simkl] Public single fetch fallback failed:', e?.message || e);
      }
    }
    
    // Cache successful results
    if (transformedData && !normalizedConfig.nocache) {
      this.cache.set(cacheKey, transformedData, { scope: cacheScope });
    }
    
    return transformedData;
  }

  // =================== REQUEST BUILDING (Fixed based on MAL pattern) ===================

  buildRequestParams(config) {
    const endpoint = this.buildEndpointUrl(config);
    const params = this.buildQueryParams(config);
    const headers = this.getHeaders(config);
    
    return {
      url: this.buildFullUrl(endpoint, params),
      method: config.method || 'GET',
      headers,
      body: config.body,
      priority: config.priority || 'normal'
    };
  }

buildEndpointUrl(config) {
  const simklMediaType = this.getSimklMediaType(config.mediaType);
  
  switch (config.type) {
    case 'stats':
      return `${this.baseUrl}/users/settings`;
    case 'list':
      return `${this.baseUrl}/sync/all-items/${simklMediaType}`;
    case 'single':
      // For single items, we need to get the user's list and filter
      return `${this.baseUrl}/sync/all-items/${simklMediaType}`;
    case 'search':
      // CRITICAL FIX: Map internal media types to correct Simkl search endpoints
      if (simklMediaType === 'movies') {
        return `${this.baseUrl}/search/movie`; // Simkl uses singular 'movie'
      } else if (simklMediaType === 'anime') {
        return `${this.baseUrl}/search/anime`; // Simkl uses 'anime'
      } else if (simklMediaType === 'tv') {
        return `${this.baseUrl}/search/tv`; // Simkl uses 'tv'
      } else {
        // Fallback to TV search for unknown types
        return `${this.baseUrl}/search/tv`;
      }
    default:
      throw new Error(`Unknown request type: ${config.type}`);
  }
}

// ALSO NEED TO FIX: getSimklMediaType method for consistency
getSimklMediaType(mediaType) {
  if (!mediaType) return 'anime'; // default
  
  const upperType = String(mediaType).toUpperCase();
  
  // FIXED: More precise mapping for search endpoints
  if (upperType === 'MOVIE' || upperType === 'MOVIES') {
    return 'movies'; // Keep as 'movies' for internal logic
  } else if (upperType === 'ANIME') {
    return 'anime';
  } else if (upperType === 'TV') {
    return 'tv';
  }
  
  return this.mediaTypeMap[upperType] || 'anime';
}
  buildQueryParams(config) {
    const params = {};
    
    // Always include client_id for public endpoints
    if (this.plugin.settings.simklClientId) {
      params.client_id = this.plugin.settings.simklClientId;
    }
    
    switch (config.type) {
      case 'search':
        if (config.search || config.query) {
          params.q = (config.search || config.query).trim();
        }
        // Simkl defaults: try conservative page/limit
        params.limit = Math.max(1, Math.min(config.perPage || 10, 20));
        params.page = Math.max(1, config.page || 1);
        break;
        
      case 'list':
      case 'single':
        // Simkl returns all user data in one call, no additional params needed
        break;
        
      case 'stats':
        // User settings/stats
        break;
    }
    
    return params;
  }

  getHeaders(config) {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `Zoro-Plugin/${this.plugin.manifest?.version || '1.0.0'}`
    };
    
          if (this.plugin.settings.simklClientId) {
        headers['simkl-api-key'] = this.plugin.settings.simklClientId;
      }
      
      // Add auth token for user-specific requests
      if (this.requiresAuth(config.type) && this.plugin.settings.simklAccessToken) {
        headers['Authorization'] = `Bearer ${this.plugin.settings.simklAccessToken}`;
      }
      
      // Some endpoints are picky without a Referer
      headers['Referer'] = 'https://simkl.com/';
      
      return headers;
    }

  // Append a focused error entry (only for edit-related requests)



  
   // =================== HTTP REQUEST EXECUTION (Following MAL pattern) ===================
  
   async makeRequest(requestParams) {
    this.metrics.requests++;
    
    const requestFn = () => requestUrl({
      url: requestParams.url,
      method: requestParams.method || 'GET',
      headers: requestParams.headers || {},
      body: requestParams.body
    });

    try {
      const response = await this.requestQueue.add(requestFn, {
        priority: requestParams.priority || 'normal',
        timeout: 30000
      });



      if (!response) {
        console.log('[Simkl][HTTP] Empty response object');
        throw new Error('Empty response from Simkl');
      }
      


      // Handle Simkl error responses
      if (response.status && (response.status < 200 || response.status >= 300)) {
        const errMsg = response.json?.error_description || response.json?.error || `HTTP ${response.status}`;
        console.log('[Simkl][HTTP] Non-200', errMsg);
        throw new Error(errMsg);
      }

      if (!response.json) {
        // Accept empty success body (Simkl may return 200 with no body)
        if (response.text === null || response.text === undefined || String(response.text).trim() === '') {
          return { ok: true };
        }
        try {
          const parsed = JSON.parse(response.text);
          return parsed;
        } catch (e) {
          // Fallback to success since status was 2xx
          return { ok: true };
        }
      }

      return response.json;

    } catch (error) {
      console.log('[Simkl][HTTP] request failed', error);
      throw error;
    }
  }

  // Robust search executor with endpoint fallbacks
  async performSearchWithFallbacks(config) { 
    const term = (config.search || config.query || '').trim();
    if (!term) {
      return { Page: { media: [] } };
    }

    // Try primary endpoint based on requested mediaType
    const primaryParams = this.buildRequestParams({ ...config, type: 'search' });
    
    try {
      const primaryRaw = await this.makeRequest(primaryParams);
      const primaryTransformed = this.transformSearchResponse(primaryRaw, config);
      
      // Check if we have any results at all
      if (primaryTransformed?.Page?.media?.length) {
        const itemsWithIds = primaryTransformed.Page.media.filter(item => item && item.id > 0);
        
        if (itemsWithIds.length > 0) {
          return primaryTransformed;
        }
      }
    } catch (e) { 
      console.log('[Simkl][Search] primary failed', e);
    }

    // Fallback matrix: try all three categories to be safe
    const candidates = [
      { type: 'ANIME', endpoint: `${this.baseUrl}/search/anime` },
      { type: 'TV', endpoint: `${this.baseUrl}/search/tv` },
      { type: 'MOVIE', endpoint: `${this.baseUrl}/search/movie` } // singular according to API
    ];

    const aggregated = [];
    for (const c of candidates) {
      try {
        const qp = {
          q: term,
          limit: Math.max(1, Math.min(config.perPage || 10, 20)),
          page: Math.max(1, config.page || 1)
        };
        if (this.plugin.settings.simklClientId) {
          qp.client_id = this.plugin.settings.simklClientId;
        }
        const url = this.buildFullUrl(c.endpoint, qp);
        const raw = await this.makeRequest({ url, method: 'GET', headers: this.getHeaders({ type: 'search' }), priority: 'normal' });
        const key = this.getSimklMediaType(c.type);
        let items;
        if (Array.isArray(raw)) items = raw;
        else if (Array.isArray(raw[key])) items = raw[key];
        else if (Array.isArray(raw.results)) items = raw.results;
        else if (raw.movie || raw.show) items = [raw];
        else items = [];
        
        for (const item of items) {
          const mapped = this.transformMedia(item, c.type);
          
          // Only include items with valid IDs for editing operations
          if (mapped && mapped.id > 0) {
            aggregated.push(mapped);
          }
        }
      } catch {}
    }

    return { Page: { media: aggregated } };
  }

  // Enhanced method to resolve a Simkl ID by title for edit operations when search results lack ids
  async resolveSimklIdByTitle(title, mediaType) {
    if (!title || typeof title !== 'string') return null;
    const term = title.trim();
    if (!term) return null;

    // Prefer specific endpoint by mediaType for more accurate results
    const typeUpper = String(mediaType || '').toUpperCase();
    const endpoints = [];
    if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES') endpoints.push(`${this.baseUrl}/search/movie`);
    else if (typeUpper === 'ANIME') endpoints.push(`${this.baseUrl}/search/anime`);
    else if (typeUpper === 'TV') endpoints.push(`${this.baseUrl}/search/tv`);
    // Add generic fallbacks
    endpoints.push(`${this.baseUrl}/search/anime`, `${this.baseUrl}/search/tv`, `${this.baseUrl}/search/movie`);

    for (const ep of endpoints) {
      try {
        const qp = { q: term, limit: 10, page: 1 }; // Increased limit for better matching
        if (this.plugin.settings.simklClientId) qp.client_id = this.plugin.settings.simklClientId;
        const url = this.buildFullUrl(ep, qp);
        const raw = await this.makeRequest({ url, method: 'GET', headers: this.getHeaders({ type: 'search' }), priority: 'normal' });
        const items = Array.isArray(raw) ? raw : (raw.results || raw.anime || raw.tv || raw.movies || []);
        
        // Try to find the best match by title similarity
        let bestMatch = null;
        let bestScore = 0;
        
        for (const it of items) {
          const node = it.movie || it.show || it;
          const ids = node?.ids || node;
          // Now that we normalize simkl_id to simkl, we can just use simkl
          const id = Number(ids?.simkl || ids?.id);
          
          if (id > 0) {
            // Calculate title similarity score
            const itemTitle = (node.title || node.name || '').toLowerCase();
            const searchTitle = term.toLowerCase();
            
            // Exact match gets highest score
            if (itemTitle === searchTitle) {
              return id;
            }
            
            // Partial match scoring
            const score = this.calculateTitleSimilarity(itemTitle, searchTitle);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = id;
            }
          }
        }
        
        // Return best match if we found one with reasonable similarity
        if (bestMatch && bestScore > 0.7) {
          return bestMatch;
        }
      } catch {}
    }
    return null;
  }

  // Helper method to calculate title similarity for better ID resolution
  calculateTitleSimilarity(title1, title2) {
    if (!title1 || !title2) return 0;
    
    const t1 = title1.toLowerCase().trim();
    const t2 = title2.toLowerCase().trim();
    
    if (t1 === t2) return 1.0;
    
    // Check if one title contains the other
    if (t1.includes(t2) || t2.includes(t1)) return 0.9;
    
    // Check for common variations (e.g., "Season 1", "S1", etc.)
    const clean1 = t1.replace(/season\s*\d+|s\d+|\(.*?\)/gi, '').trim();
    const clean2 = t2.replace(/season\s*\d+|s\d+|\(.*?\)/gi, '').trim();
    
    if (clean1 === clean2) return 0.8;
    
    // Simple word overlap scoring
    const words1 = new Set(clean1.split(/\s+/));
    const words2 = new Set(clean2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  // Method to ensure search results have proper IDs for editing operations
  async ensureSearchResultIds(searchResults, mediaType) {
    if (!searchResults?.Page?.media?.length) return searchResults;
    
    const enhancedResults = [];
    let resolvedCount = 0;
    
    for (const item of searchResults.Page.media) {
      if (item && item.id > 0) {
        // Item already has a valid ID
        enhancedResults.push(item);
      } else if (item && item.title) {
        // Try to resolve ID by title
        try {
          console.log(`[Simkl] Resolving ID for search result: "${item.title}"`);
          const resolvedId = await this.resolveSimklIdByTitle(item.title, mediaType);
          if (resolvedId) {
            item.id = resolvedId;
            enhancedResults.push(item);
            resolvedCount++;
            console.log(`[Simkl] Successfully resolved ID ${resolvedId} for "${item.title}"`);
          } else {
            console.warn(`[Simkl] Could not resolve ID for "${item.title}"`);
          }
        } catch (error) {
          console.warn(`[Simkl] Failed to resolve ID for "${item.title}":`, error);
        }
      }
    }
    
    if (resolvedCount > 0) {
      console.log(`[Simkl] Enhanced ${resolvedCount} search results with resolved IDs`);
    }
    
    return {
      Page: {
        media: enhancedResults
      }
    };
  }

  // Method to get a single media item by ID, useful for resolving search result IDs
  async getMediaById(mediaId, mediaType) {
    if (!mediaId || !Number.isFinite(Number(mediaId))) return null;
    
    try {
      const response = await this.fetchSingleByIdPublic(mediaId, mediaType);
      if (response?.MediaList) {
        return response.MediaList;
      }
    } catch (error) {
      console.warn(`[Simkl] Failed to get media by ID ${mediaId}:`, error);
    }
    
    return null;
  }

  // Method to validate and fix search result IDs before editing operations
  async validateSearchResultForEditing(searchResult, mediaType) {
    if (!searchResult) return null;
    
    // If it already has a valid ID, return as is
    if (searchResult.id && Number.isFinite(Number(searchResult.id)) && Number(searchResult.id) > 0) {
      return searchResult;
    }
    
    // Try to resolve ID by title
    if (searchResult.title) {
      try {
        const resolvedId = await this.resolveSimklIdByTitle(searchResult.title, mediaType);
        if (resolvedId) {
          searchResult.id = resolvedId;
          console.log(`[Simkl] Resolved ID ${resolvedId} for editing: "${searchResult.title}"`);
          return searchResult;
        }
      } catch (error) {
        console.warn(`[Simkl] Failed to resolve ID for editing "${searchResult.title}":`, error);
      }
    }
    
    console.warn(`[Simkl] Cannot edit search result without valid ID: "${searchResult.title}"`);
    return null;
  }



  // =================== DATA TRANSFORMATION (Fixed to match expected structure) ===================

  transformResponse(data, config) {
    
    
    switch (config.type) {
      case 'search':
        return this.transformSearchResponse(data, config);
      case 'single':
        return this.transformSingleResponse(data, config);
      case 'stats':
        return this.transformStatsResponse(data);
      case 'list':
        return this.transformListResponse(data, config);
      default:
        return this.transformListResponse(data, config);
    }
  }

  transformSearchResponse(data, config) {
    const simklType = this.getSimklMediaType(config.mediaType);

    let items = [];
    
    // CRITICAL FIX: Simkl search responses are typically direct arrays
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object') {
      // Try to find items under various possible keys
      const possibleKeys = [simklType, 'results', 'items', 'anime', 'tv', 'movies', 'shows'];
      
      for (const key of possibleKeys) {
        if (Array.isArray(data[key])) {
          items = data[key];
          break;
        }
      }
      
      // If still no items, check if it's a single item response
      if (items.length === 0) {
        if (data.movie || data.show || data.anime) {
          items = [data];
        }
      }
    }
    
    const transformedItems = items
      .map(item => this.transformMedia(item, config.mediaType))
      .filter(item => item && item.id > 0); // Only include items with valid IDs for editing operations
    
    return {
      Page: {
        media: transformedItems
      }
    };
  }

  transformSingleResponse(data, config) {
    const targetMediaId = parseInt(config.mediaId);
    let targetEntry = null;
    
    // FIXED: Use the actual media type being requested
    const simklMediaType = this.getSimklMediaType(config.mediaType);
    const mediaArray = data[simklMediaType] || [];
    
    if (Array.isArray(mediaArray)) {
      targetEntry = mediaArray.find(entry => {
        const show = entry.show || entry;
        const ids = show.ids || show;
        // Now that we normalize simkl_id to simkl, we can just use simkl
        return (ids.simkl === targetMediaId || ids.id === targetMediaId);
      });
    }
    
    return {
      MediaList: targetEntry ? this.transformListEntry(targetEntry, config.mediaType) : null
    };
  }
  
    // Fallback: fetch a single media by Simkl ID using public search-by-id API
  async fetchSingleByIdPublic(mediaId, mediaType) {
    const id = parseInt(mediaId);
    if (!id || Number.isNaN(id)) return null;

    const url = `${this.baseUrl}/search/id?simkl=${encodeURIComponent(id)}`;
    const headers = this.getHeaders({ type: 'search' });

    try {
      const response = await this.makeRequest({ url, method: 'GET', headers, priority: 'normal' });
      const wrapped = this.transformSinglePublicResponse(response, mediaType, id);
      return wrapped;
    } catch (e) {
      console.warn('[Simkl] fetchSingleByIdPublic failed:', e?.message || e);
      return { MediaList: null };
    }
  }

  // Parse public search-by-id response into MediaList shape
  transformSinglePublicResponse(raw, mediaType, targetId) {
    if (!raw || (typeof raw !== 'object' && !Array.isArray(raw))) return { MediaList: null };

    const candidates = [];
    ['anime', 'movies', 'tv', 'shows', 'results', 'items'].forEach(key => {
      if (Array.isArray(raw?.[key])) candidates.push(...raw[key]);
    });

    if (Array.isArray(raw)) candidates.push(...raw);
    if (candidates.length === 0 && raw?.ids) candidates.push(raw);

    const match = candidates.find(item => {
      const node = item.movie || item.show || item;
      const ids = node?.ids || node || {};
      // Now that we normalize simkl_id to simkl, we can just use simkl
      return Number(ids.simkl || ids.id) === Number(targetId);
    }) || null;

    if (!match) return { MediaList: null };

    const node = match.movie || match.show || match;
    const transformedMedia = this.transformMedia(node, mediaType);
    const entry = {
      id: null,
      status: null,
      score: null,
      progress: this.isMovieType(mediaType, node) ? 0 : 0,
      media: transformedMedia
    };

    return { MediaList: entry };
  }

  // FIXED: Complete rewrite of list response transformation with comprehensive debugging
  transformListResponse(data, config) {
    let entries = [];
    
    
    
    // FIXED: Use the correct media type key from the response
    const simklMediaType = this.getSimklMediaType(config.mediaType);
    const raw = data || {};

    
    
    // CRITICAL FIX: Try multiple possible data structure patterns
    
    // Pattern 1: Direct array under media type key
    if (Array.isArray(raw[simklMediaType])) {
      entries = raw[simklMediaType];
      
    }
    // Pattern 2: Root is an array (search results)
    else if (Array.isArray(raw)) {
      entries = raw;
      
    }
    // Pattern 3: Grouped data by status (e.g., {watching: [], completed: []})
    else if (raw[simklMediaType] && typeof raw[simklMediaType] === 'object') {
      const grouped = raw[simklMediaType];
      
      Object.keys(grouped).forEach(statusKey => {
        const arr = grouped[statusKey];
        if (Array.isArray(arr)) {
          
          arr.forEach(item => entries.push({ ...item, _status: statusKey }));
        }
      });
    }
    // Pattern 4: Try alternative media type keys (fallback)
    else {
      
      
      // Try common alternative keys
      const alternativeKeys = ['anime', 'movies', 'tv', 'shows', 'items', 'results'];
      let found = false;
      
      for (const key of alternativeKeys) {
        if (raw[key] && Array.isArray(raw[key]) && raw[key].length > 0) {
          
          entries = raw[key];
          found = true;
          break;
        }
      }
      
      // Last resort: try any array in the response
      if (!found) {
        
        Object.keys(raw).forEach(key => {
          if (Array.isArray(raw[key]) && raw[key].length > 0) {
            
            entries = entries.concat(raw[key]);
          }
        });
      }
    }
    
    
    
    // Sample the first entry to understand structure
    if (entries.length > 0) {
    }
    
    // Filter by status if specified
    if (config.listType && config.listType !== 'ALL') {
      const targetStatus = this.mapAniListStatusToSimkl(config.listType);
      const beforeFilter = entries.length;
      entries = entries.filter(entry => (entry.status || entry._status) === targetStatus);
      
    }
    
    
    // Transform entries with enhanced error handling
    const transformedEntries = [];
    entries.forEach((entry, index) => {
      try {
        const transformed = this.transformListEntry(entry, config.mediaType);
        if (transformed) {
          transformedEntries.push(transformed);
        } else {
          console.warn(`[Simkl] Entry ${index} transformed to null`);
        }
      } catch (error) {
        console.error(`[Simkl] Error transforming entry ${index}:`, error, entry);
      }
    });
    
    
    return {
      MediaListCollection: {
        lists: [{
          entries: transformedEntries
        }]
      }
    };
  }

  transformStatsResponse(data) {
    // Simkl user stats structure is different, adapt as needed
    const user = data.user || data;
     const simklStats = user.stats || {};

    // Normalize categories for Simkl: anime, tv, movies
    const animeStats = simklStats.anime || {};
    const tvStats = simklStats.tv || simklStats.shows || {};
    const movieStats = simklStats.movies || simklStats.films || {};
    return {
      User: {
        id: user.id || null,
        name: user.name || user.username || 'Unknown User',
        avatar: {
          large: user.avatar || null,
          medium: user.avatar || null
        },
        statistics: {
          anime: {
            count: animeStats.total || 0,
            meanScore: animeStats.rating || 0,
            standardDeviation: 0,
            episodesWatched: animeStats.episodes || 0,
            minutesWatched: animeStats.minutes || 0
          },
          tv: {
            count: tvStats.total || 0,
            meanScore: tvStats.rating || 0,
            standardDeviation: 0,
            episodesWatched: tvStats.episodes || 0,
            minutesWatched: tvStats.minutes || 0
          },
          movie: {
            count: movieStats.total || 0,
            meanScore: movieStats.rating || 0,
            standardDeviation: 0,
            minutesWatched: movieStats.minutes || 0
          }
        },
        mediaListOptions: {
          scoreFormat: 'POINT_10'
        }
      }
    };
  }

  // =================== MEDIA TRANSFORMATION (Fixed structure) ===================
  
  // FIXED: Added enhanced debugging and comprehensive data structure handling
  transformMedia(simklMedia, mediaType) {
    if (!simklMedia) {
      return null;
    }

    // CRITICAL FIX: Handle multiple possible data structures from Simkl
    let media, originalData;
    
    // Case 1: Data is nested under 'show' (common in sync responses)
    if (simklMedia.show) {
      
      media = simklMedia.show;
      originalData = simklMedia; // Keep reference to full object
    }
    // Case 2: Data is nested under 'movie' (for movie responses)
    else if (simklMedia.movie) {
      
      media = simklMedia.movie;
      originalData = simklMedia;
    }
    // Case 3: Data is directly in the root object
    else {
      
      media = simklMedia;
      originalData = simklMedia;
    }

    

    const ids = media.ids || originalData.ids || {};
    
    // FIXED: Enhanced poster extraction for movies
    const posterUrl = this.extractPosterUrl(media, originalData, ids);
    
    // FIXED: Better movie detection using mediaType and API response
    const isMovie = this.isMovieType(mediaType, media);
    
    // FIXED: Comprehensive title extraction logic with full debugging
    const extractedTitle = this.extractTitle(media, originalData);
    
    // FIXED: Enhanced genres extraction
    const genres = this.extractGenres(media, originalData);
    
    const episodes = (() => {
      // For movies, always return 1
      if (isMovie) {
        return 1;
      }
      
      const candidates = [
        media.total_episodes_count,
        media.total_episodes,
        media.episodes,
        originalData.total_episodes_count,
        originalData.total_episodes,
        originalData.episodes
      ];
      
      for (const cand of candidates) {
        if (cand !== undefined && cand !== null && cand !== '') {
          const n = Number(cand);
          if (!isNaN(n)) return n;
        }
      }
      return null;
    })();
    
    // Enhanced ID extraction for Simkl - normalize simkl_id to simkl for consistency
    let finalId = null;
    
    // CRITICAL FIX: Normalize simkl_id to simkl for consistent ID handling
    // First try to get the simkl ID from any available source
    if (ids.simkl_id && Number.isFinite(Number(ids.simkl_id))) {
      finalId = Number(ids.simkl_id);
      // Normalize: also set the simkl field for consistency
      ids.simkl = finalId;
    }
    // Fallback to other ID sources
    else if (ids.simkl && Number.isFinite(Number(ids.simkl))) {
      finalId = Number(ids.simkl);
    }
    else if (ids.id && Number.isFinite(Number(ids.id))) {
      finalId = Number(ids.id);
    }
    else if (media.id && Number.isFinite(Number(media.id))) {
      finalId = Number(media.id);
    }
    else if (originalData.id && Number.isFinite(Number(originalData.id))) {
      finalId = Number(originalData.id);
    }
    
    // If we still don't have an ID, try to extract from the media object itself
    if (!finalId && media.ids) {
      if (media.ids.simkl_id && Number.isFinite(Number(media.ids.simkl_id))) {
        finalId = Number(media.ids.simkl_id);
        // Normalize: also set the simkl field for consistency
        media.ids.simkl = finalId;
      } else if (media.ids.simkl && Number.isFinite(Number(media.ids.simkl))) {
        finalId = Number(media.ids.simkl);
      } else if (media.ids.id && Number.isFinite(Number(media.ids.id))) {
        finalId = Number(media.ids.id);
      }
    }
    
    // Additional check: sometimes the ID is directly on the root object
    if (!finalId && simklMedia.ids) {
      if (simklMedia.ids.simkl_id && Number.isFinite(Number(simklMedia.ids.simkl_id))) {
        finalId = Number(simklMedia.ids.simkl_id);
        // Normalize: also set the simkl field for consistency
        simklMedia.ids.simkl = finalId;
      } else if (simklMedia.ids.simkl && Number.isFinite(Number(simklMedia.ids.simkl))) {
        finalId = Number(simklMedia.ids.simkl);
      } else if (simklMedia.ids.id && Number.isFinite(Number(simklMedia.ids.id))) {
        finalId = Number(simklMedia.ids.id);
      }
    }
    
    // Final fallback - check if we have any numeric ID
    if (!finalId) {
      const allIds = [
        ids.simkl_id, ids.simkl, ids.id, media.id, originalData.id,
        media.ids?.simkl_id, media.ids?.simkl, media.ids?.id, 
        originalData?.ids?.simkl_id, originalData?.ids?.simkl, originalData?.ids?.id,
        simklMedia.ids?.simkl_id, simklMedia.ids?.simkl, simklMedia.ids?.id, simklMedia.id
      ];
      
      for (const id of allIds) {
        if (id && Number.isFinite(Number(id)) && Number(id) > 0) {
          finalId = Number(id);
          break;
        }
      }
    }

    const transformedResult = {
      id: finalId || 0,
      idMal: ids.mal || null,
      idImdb: ids.imdb || null,
      idTmdb: ids.tmdb || null,
      title: extractedTitle,
      coverImage: {
        large: posterUrl,
        medium: posterUrl,
        _raw: media.poster || media.image || media.cover,
        _normalized: posterUrl
      },
      format: isMovie ? 'MOVIE' : this.mapSimklFormat(
  media.type || media.kind || originalData.type || (mediaType || '').toString().toLowerCase(),
  mediaType
),
      averageScore: null, // Simkl ratings not needed for detail panel
      status: media.status ? media.status.toUpperCase() : null,
      genres: genres,
      episodes: episodes,
      chapters: null,
      isFavourite: false,
      startDate: this.parseDate(media.first_aired || originalData.first_aired),
      endDate: this.parseDate(media.last_aired || originalData.last_aired),
      // Simkl does not provide airing data in their API
      nextAiringEpisode: null,
      // Map Simkl overview to description for detail panel
      description: media.overview || originalData.overview || null,
      // FIXED: Add movie-specific metadata for rendering
      _isMovie: isMovie,
      _mediaType: mediaType,
      _rawData: originalData // Keep for debugging
    };

    
    return transformedResult;
  }

  // FIXED: Enhanced poster URL extraction method
  extractPosterUrl(media, originalData, ids) {
    // Try multiple poster field variations that Simkl uses for different content types
    const posterCandidates = [
      // Standard fields
      media.poster,
      media.image,
      media.cover,
      
      // Image object variations
      media.images?.poster,
      media.images?.poster_small,
      media.images?.poster_large,
      media.images?.movie_poster,
      media.images?.cover,
      media.images?.fanart,
      
      // Original data fallbacks
      originalData?.poster,
      originalData?.image,
      originalData?.cover,
      originalData?.images?.poster,
      originalData?.images?.movie_poster
    ];

    let posterUrl = null;
    
    for (const candidate of posterCandidates) {
      if (candidate) {
        if (typeof candidate === 'object') {
          posterUrl = candidate.full || candidate.large || candidate.medium || 
                     candidate.url || candidate.path || 
                     Object.values(candidate).find(v => typeof v === 'string' && v.trim());
        } else if (typeof candidate === 'string' && candidate.trim()) {
          posterUrl = candidate.trim();
        }
        
        if (posterUrl) break;
      }
    }
    
    // Process the found poster URL
    if (posterUrl) {
      if (posterUrl.startsWith('//')) {
        posterUrl = 'https:' + posterUrl;
      } else if (posterUrl.startsWith('/')) {
        posterUrl = 'https://simkl.in' + posterUrl;
      } else if (!posterUrl.match(/^https?:\/\//i)) {
        // Check if it looks like a direct filename or needs Simkl CDN path
        if (posterUrl.includes('.jpg') || posterUrl.includes('.png') || posterUrl.includes('.webp')) {
          // If it's already a filename, use Simkl CDN
          posterUrl = `https://simkl.in/posters/${posterUrl.replace(/\.(jpg|png|webp)$/i, '')}_m.jpg`;
        } else {
          // Use the ID-based fallback
          posterUrl = `https://simkl.in/posters/${posterUrl}_m.jpg`;
        }
      }
    }

    // Final fallback using media ID
    if (!posterUrl && ids && ids.simkl) {
      posterUrl = `https://simkl.in/posters/${ids.simkl}_m.jpg`;
    }

    
    return posterUrl;
  }



  // FIXED: Enhanced genres extraction method
  extractGenres(media, originalData) {
    const genreCandidates = [
      media.genres,
      media.genre,
      originalData?.genres,
      originalData?.genre
    ];

    for (const candidate of genreCandidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        // Filter out empty/invalid genres
        const validGenres = candidate.filter(g => 
          g && typeof g === 'string' && g.trim()
        ).map(g => g.trim());
        
        if (validGenres.length > 0) {
          
          return validGenres;
        }
      }
    }

    
    return [];
  }

  // FIXED: Completely rewritten comprehensive title extraction method with deep debugging
  extractTitle(media, originalData) {
    
    // CRITICAL FIX: Try ALL possible nested structures and field names
    const allPossibleTitleSources = [
      // Direct media object fields
      media?.title,
      media?.name,
      media?.en_title,
      media?.original_title,
      media?.title_en,
      media?.title_english,
      media?.english_name,
      media?.romaji,
      media?.english,
      media?.native,
      
      // Nested title objects (common in many APIs)
      media?.title?.english,
      media?.title?.romaji,
      media?.title?.native,
      media?.title?.en,
      media?.title?.original,
      
      // Original/root data fields
      originalData?.title,
      originalData?.name,
      originalData?.en_title,
      originalData?.original_title,
      originalData?.title_en,
      originalData?.title_english,
      originalData?.english_name,
      
      // Nested in original data
      originalData?.title?.english,
      originalData?.title?.romaji,
      originalData?.title?.native,
      originalData?.title?.en,
      originalData?.title?.original,
      
      // Show object nested fields (critical for Simkl sync responses)
      originalData?.show?.title,
      originalData?.show?.name,
      originalData?.show?.en_title,
      originalData?.show?.original_title,
      originalData?.show?.title_en,
      originalData?.show?.title_english,
      
      // Nested show title objects
      originalData?.show?.title?.english,
      originalData?.show?.title?.romaji,
      originalData?.show?.title?.native,
      originalData?.show?.title?.en,
      
      // Movie-specific nested fields
      originalData?.movie?.title,
      originalData?.movie?.name,
      originalData?.movie?.en_title,
      originalData?.movie?.original_title,
      
      // Alternative nested structures
      media?.show?.title,
      media?.show?.name,
      media?.movie?.title,
      media?.movie?.name,
      
      // International title variations
      media?.titles?.en,
      media?.titles?.english,
      media?.titles?.original,
      originalData?.titles?.en,
      originalData?.titles?.english,
      originalData?.titles?.original,
      
      // Last resort - use ID or any string field
      media?.slug,
      originalData?.slug,
      String(media?.id || originalData?.id || '').replace(/[^a-zA-Z0-9\s]/g, ' ')
    ];

    

    // Find the first valid title
    const primaryTitle = allPossibleTitleSources.find(title => 
      title && 
      typeof title === 'string' && 
      title.trim() !== '' && 
      title.toLowerCase() !== 'null' &&
      title.toLowerCase() !== 'undefined'
    );

    

    if (!primaryTitle || primaryTitle === 'Unknown Title') {
      
      
      // Emergency fallback: try to construct title from any available data
      const emergencyTitle = this.constructEmergencyTitle(media, originalData);
      if (emergencyTitle) {
        return {
          romaji: emergencyTitle,
          english: emergencyTitle,
          native: emergencyTitle
        };
      }
    }

    // Now find specific variants for English and native titles
    const englishCandidates = [
      media?.en_title,
      media?.title_en,
      media?.title_english,
      media?.english_name,
      media?.title?.english,
      media?.title?.en,
      originalData?.en_title,
      originalData?.title_en,
      originalData?.title_english,
      originalData?.show?.en_title,
      originalData?.show?.title?.english,
      originalData?.movie?.en_title,
      primaryTitle // fallback
    ];

    const nativeCandidates = [
      media?.original_title,
      media?.title_original,
      media?.native,
      media?.title?.native,
      media?.title?.original,
      originalData?.original_title,
      originalData?.title_original,
      originalData?.show?.original_title,
      originalData?.show?.title?.native,
      originalData?.movie?.original_title,
      primaryTitle // fallback
    ];

    const englishTitle = englishCandidates.find(title => 
      title && typeof title === 'string' && title.trim() !== ''
    ) || primaryTitle || 'Unknown Title';

    const nativeTitle = nativeCandidates.find(title => 
      title && typeof title === 'string' && title.trim() !== ''
    ) || primaryTitle || 'Unknown Title';

    // Smart romaji detection
    let romajiTitle = primaryTitle || 'Unknown Title';
    if (primaryTitle !== nativeTitle && /[a-zA-Z]/.test(primaryTitle)) {
      romajiTitle = primaryTitle;
    } else if (englishTitle !== primaryTitle) {
      romajiTitle = englishTitle;
    }

    const result = {
      romaji: romajiTitle,
      english: englishTitle,
      native: nativeTitle
    };

    
    return result;
  }

  // NEW: Emergency title construction when all standard fields fail
  constructEmergencyTitle(media, originalData) {
    // Try to build a title from any available string data
    const possibleSources = [
      // Try any field that might contain a readable name
      media?.slug?.replace(/[-_]/g, ' '),
      originalData?.slug?.replace(/[-_]/g, ' '),
      
      // Check if there are any string fields that might be titles
      ...Object.values(media || {}).filter(val => 
        typeof val === 'string' && 
        val.length > 2 && 
        val.length < 100 &&
        !/^https?:\/\//.test(val) && // not a URL
        !/^\d+$/.test(val) && // not just numbers
        !/^[a-f0-9-]{20,}$/.test(val) // not a hash/ID
      ),
      
      ...Object.values(originalData || {}).filter(val => 
        typeof val === 'string' && 
        val.length > 2 && 
        val.length < 100 &&
        !/^https?:\/\//.test(val) &&
        !/^\d+$/.test(val) &&
        !/^[a-f0-9-]{20,}$/.test(val)
      )
    ];

    const emergencyTitle = possibleSources[0];
    if (emergencyTitle) {
      // Clean it up
      return emergencyTitle
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, l => l.toUpperCase()); // Title case
    }

    return null;
  }

  // FIXED: Enhanced list entry transformation with proper movie handling
  transformListEntry(simklEntry, mediaType) {
    if (!simklEntry) return null;
    
    const show = simklEntry.show || simklEntry;
    const statusRaw = simklEntry.status || simklEntry._status || show.status || null;

    // Check if this is a movie
    const isMovie = this.isMovieType(mediaType, show);

    let progress = 0;
    const watchedCandidates = [
      simklEntry.watched_episodes_count,
      simklEntry.watched_episodes,
      simklEntry.episodes_watched,
      show.watched_episodes_count,
      show.watched_episodes
    ];
    
    for (const w of watchedCandidates) {
      if (w !== undefined && w !== null && w !== '') {
        const n = Number(w);
        if (!isNaN(n)) { 
          progress = n; 
          break; 
        }
      }
    }

    // FIXED: Movie-specific progress handling
    if (isMovie) {
      // For movies, progress is either 0 or 1
      if (progress > 0) {
        progress = 1;
      } else {
        // Check if status indicates movie was watched
        const watchedStatuses = ['completed', 'watching'];
        if (watchedStatuses.includes(String(statusRaw).toLowerCase())) {
          progress = 1;
        }
      }
    } else {
      // Handle TV shows with seasons (existing logic)
      if ((!progress || progress === 0) && typeof simklEntry.seasons_watched === 'number') {
        const totalEpisodes = (simklEntry.total_episodes_count ?? show.total_episodes_count ?? show.total_episodes ?? show.episodes) || 0;
        const totalSeasons = show.seasons || 1;
        if (totalEpisodes && totalSeasons) {
          const perSeason = totalEpisodes / totalSeasons;
          progress = Math.floor(simklEntry.seasons_watched * perSeason);
        }
      }
    }

    const mergedShow = Object.assign({}, show, {
      total_episodes_count: simklEntry.total_episodes_count ?? show.total_episodes_count ?? show.total_episodes,
      total_episodes: simklEntry.total_episodes_count ?? show.total_episodes
    });
    
    const transformedMedia = this.transformMedia(mergedShow, mediaType);
    
    return {
      id: transformedMedia?.id || null, 
      status: this.mapSimklStatusToAniList(statusRaw),
      score: simklEntry.user_rating ?? simklEntry.rating ?? show.rating ?? 0,
      progress: progress || 0,
      media: transformedMedia
    };
  }

  // FIXED: New helper method to properly detect movies
  isMovieType(mediaType, mediaData) {
    // First check the requested mediaType
    if (mediaType) {
      const upperType = String(mediaType).toUpperCase();
      if (upperType === 'MOVIE' || upperType === 'MOVIES') {
        return true;
      }
    }
    
    // Then check the media data itself
    if (mediaData) {
      const type = String(mediaData.type || mediaData.kind || '').toLowerCase();
      return type === 'movie' || type === 'film' || type.includes('movie');
    }
    
    return false;
  }

  // =================== UPDATE METHODS (Following MAL pattern) ===================
 async updateMediaListEntry(mediaId, updates, mediaType) {
  try {  
    const typeUpper = (mediaType || '').toString().toUpperCase();
    const isMovieOrTv = typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper.includes('SHOW');
    if (updates && updates._zUseTmdbId === true && isMovieOrTv) {
      // Prefer explicit TMDb/IMDb ids for trending TMDb entries
      let imdb = undefined;
      try {
        const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' });
        const media = cached?.media || cached || {};
        imdb = media.idImdb || media.ids?.imdb;
      } catch {}
      return await this.updateMediaListEntryWithIds({ tmdb: mediaId, imdb }, updates, mediaType);
    }
    return await this.executeUpdate(mediaId, updates, mediaType);  
  } catch (error) {  
    throw this.createUserFriendlyError(error);  
  }
}

  /**
   * Update/create a Simkl list entry using explicit external identifiers (e.g., TMDb/IMDb).
   * This is primarily used for TMDb trending items (movies/TV) where we don't have Simkl IDs.
   *
   * @param {{ tmdb?: number|string, imdb?: string, simkl?: number|string }} identifiers
   * @param {object} updates
   * @param {string} mediaType One of MOVIE/MOVIES/TV/ANIME
   */
  async updateMediaListEntryWithIds(identifiers, updates, mediaType) {
    try {
      await this.ensureValidToken();
      const payload = this.buildUpdatePayloadFromIdentifiers(identifiers, updates, mediaType);
      const typeUpper = (mediaType || '').toString().toUpperCase();
      const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';

      // Add to list (status)
      if (updates.status !== undefined) {
        await this.makeRequest({
          url: `${this.baseUrl}/sync/add-to-list`,
          method: 'POST',
          headers: this.getHeaders({ type: 'update' }),
          body: JSON.stringify(payload),
          priority: 'high'
        });

        // Enforce via ratings if score not provided
        if (updates.score === undefined || updates.score === null) {
          const statusMapped = this.mapAniListStatusToSimkl(updates.status);
          const statusToRating = { watching: 8, completed: 9, hold: 6, dropped: 3, plantowatch: 1 };
          const derived = statusToRating[statusMapped];
          if (derived) {
            const ratingsPayload = this.buildUpdatePayloadFromIdentifiers(identifiers, { score: derived }, mediaType);
            await this.makeRequest({
              url: `${this.baseUrl}/sync/ratings`,
              method: 'POST',
              headers: this.getHeaders({ type: 'update' }),
              body: JSON.stringify(ratingsPayload),
              priority: 'high'
            });
          }
        }
      }

      // Progress handling (movies only here; shows use watched_episodes in list payload already)
      if (updates.progress !== undefined) {
        if (isMovie) {
          const watched = (parseInt(updates.progress) || 0) > 0;
          const containerKey = 'movies';
          const historyPayload = { [containerKey]: [{ ids: {} }] };
          const item = historyPayload[containerKey][0];
          if (identifiers?.tmdb) item.ids.tmdb = parseInt(identifiers.tmdb);
          if (!item.ids.tmdb && identifiers?.imdb) item.ids.imdb = String(identifiers.imdb);
          if (!item.ids.tmdb && !item.ids.imdb && identifiers?.simkl) item.ids.simkl = parseInt(identifiers.simkl);

          await this.makeRequest({
            url: `${this.baseUrl}/sync/history${watched ? '' : '/remove'}`,
            method: 'POST',
            headers: this.getHeaders({ type: 'update' }),
            body: JSON.stringify(historyPayload),
            priority: 'high'
          });
        }
      }

      // Invalidate caches
      this.cache.invalidateScope('userData');

      return {
        id: null,
        status: updates.status || null,
        score: updates.score || 0,
        progress: updates.progress || 0
      };
    } catch (error) {
      throw this.createUserFriendlyError(error);
    }
  }

async executeUpdate(mediaId, updates, mediaType) {
  const normalizedId = this.normalizeSimklId(mediaId);
  console.log('[Simkl][Update] executeUpdate', { rawId: mediaId, normalizedId, updates, mediaType });
  this.validateMediaId(normalizedId);
  this.validateUpdates(updates);

  await this.ensureValidToken();  
  console.log('[Simkl][Update] token ensured');

  const typeUpper = (mediaType || '').toString().toUpperCase();
  const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';

  // 1) Status -> watchlist + enforce via ratings mapping  
  if (updates.status !== undefined) {  
    const statusPayload = this.buildUpdatePayload(normalizedId, { status: updates.status }, mediaType);  
    console.log('[Simkl][Update] watchlist status payload', statusPayload);  
    await this.makeRequest({  
      url: `${this.baseUrl}/sync/add-to-list`,  
      method: 'POST',  
      headers: this.getHeaders({ type: 'update' }),  
      body: JSON.stringify(statusPayload),  
      priority: 'high'  
    });  
    // Best-effort mirror: some accounts accept anime updates only under 'shows'  
    if (!isMovie && typeUpper === 'ANIME') {  
      const mirrorPayload = this.buildUpdatePayload(normalizedId, { status: updates.status }, mediaType, 'shows');  
      await this.makeRequest({  
        url: `${this.baseUrl}/sync/add-to-list`,  
        method: 'POST',  
        headers: this.getHeaders({ type: 'update' }),  
        body: JSON.stringify(mirrorPayload),  
        priority: 'normal'  
      });  
    }  
    // Enforce status via ratings if no explicit score was provided  
    if (updates.score === undefined || updates.score === null) {  
      const statusMapped = this.mapAniListStatusToSimkl(updates.status);  
      const statusToRating = { watching: 8, completed: 9, hold: 6, dropped: 3, plantowatch: 1 };  
      const derived = statusToRating[statusMapped];  
      if (derived) {  
        const ratingsPayload = this.buildUpdatePayload(normalizedId, { score: derived }, mediaType);  
        console.log('[Simkl][Update] derived ratings payload for status', ratingsPayload);  
        await this.makeRequest({  
          url: `${this.baseUrl}/sync/ratings`,  
          method: 'POST',  
          headers: this.getHeaders({ type: 'update' }),  
          body: JSON.stringify(ratingsPayload),  
          priority: 'high'  
        });  
      }  
    }  
    // If marking a show as completed without progress, push remaining episodes to history  
    if (!isMovie && String(updates.status).toUpperCase() === 'COMPLETED' && updates.progress === undefined) {  
      try {  
        let prevProgress = 0;  
        let totalEpisodes = 0;  
        prevProgress = Math.max(0, parseInt(existing?.progress) || 0);  
        // Try to detect total episodes from existing media data  
        const media = existing?.media;  
        totalEpisodes = Math.max(0, parseInt(media?.episodes) || 0);  
        if (!totalEpisodes) {  
          const single = await this.fetchSimklData({ type: 'single', mediaType, mediaId: normalizedId, nocache: true });  
          totalEpisodes = Math.max(0, parseInt(single?.MediaList?.media?.episodes) || 0);  
        }  
        if (totalEpisodes && totalEpisodes > prevProgress) {  
          const episodes = [];  
          for (let i = prevProgress + 1; i <= totalEpisodes && episodes.length < 1000; i++) episodes.push({ number: i });  
          if (episodes.length) {  
            const payload = { shows: [{ ids: { simkl: parseInt(normalizedId) }, episodes }] };  
            await this.makeRequest({  
              url: `${this.baseUrl}/sync/history`,  
              method: 'POST',  
              headers: this.getHeaders({ type: 'update' }),  
              body: JSON.stringify(payload),  
              priority: 'high'  
            });  
          }  
        }  
      } catch {}  
    }  
  }  

  // 2) Score -> ratings  
  if (updates.score !== undefined && updates.score !== null) {  
    const rating = Math.max(0, Math.min(10, Math.round(updates.score)));  
    if (rating > 0) {  
      const ratingsPayload = this.buildUpdatePayload(normalizedId, { score: rating }, mediaType);  
      console.log('[Simkl][Update] ratings payload', ratingsPayload);  
      await this.makeRequest({  
        url: `${this.baseUrl}/sync/ratings` ,  
        method: 'POST',  
        headers: this.getHeaders({ type: 'update' }),  
        body: JSON.stringify(ratingsPayload),  
        priority: 'high'  
      });  
      // Mirror ratings under 'shows' for anime as a fallback  
      if (!isMovie && typeUpper === 'ANIME') {  
        const mirrorRatings = this.buildUpdatePayload(normalizedId, { score: rating }, mediaType, 'shows');  
        await this.makeRequest({  
          url: `${this.baseUrl}/sync/ratings` ,  
          method: 'POST',  
          headers: this.getHeaders({ type: 'update' }),  
          body: JSON.stringify(mirrorRatings),  
          priority: 'normal'  
        });  
      }  
    }  
  }  

  // 3) Progress -> history (movies only); shows keep watched_episodes via watchlist payload  
  if (updates.progress !== undefined) {  
    if (isMovie) {  
      const watched = (parseInt(updates.progress) || 0) > 0;  
      const containerKey = 'movies';  
      const historyPayload = { [containerKey]: [{ ids: { simkl: parseInt(normalizedId) } }] };  
      console.log('[Simkl][Update] history payload', historyPayload);  
      await this.makeRequest({  
        url: `${this.baseUrl}/sync/history${watched ? '' : '/remove'}`,  
        method: 'POST',  
        headers: this.getHeaders({ type: 'update' }),  
        body: JSON.stringify(historyPayload),  
        priority: 'high'  
      });  
    } else {  
      // For shows, update progress via history episodes (incremental add/remove)  
      let prevProgress = 0;  
      let totalEpisodes = 0;  
      let airedEpisodes = 0;  
      try {  
        prevProgress = Math.max(0, parseInt(existing?.progress) || 0);  
        totalEpisodes = Math.max(0, parseInt(existing?.media?.episodes) || 0);  
        const raw = existing?.media?._rawData || {};  
        const airedCandidates = [raw.aired_episodes_count, raw.aired_episodes, raw.show?.aired_episodes_count, raw.show?.aired_episodes];  
        for (const cand of airedCandidates) {  
          const n = Number(cand);  
          if (Number.isFinite(n) && n > 0) { airedEpisodes = n; break; }  
        }  
      } catch {}  
      const requestedProgress = Math.max(0, parseInt(updates.progress) || 0);  
      // Cap increases to the number of aired (or known total) episodes to match Simkl behavior  
      const cap = Math.max(0, (airedEpisodes || totalEpisodes || requestedProgress));  
      if (requestedProgress !== prevProgress) {  
        let from, to, remove;  
        if (requestedProgress > prevProgress) {  
          remove = false;  
          from = prevProgress + 1;  
          to = Math.min(requestedProgress, cap);  
        } else {  
          remove = true;  
          from = requestedProgress + 1;  
          to = prevProgress;  
        }  
        const episodes = [];  
        for (let i = from; i <= to && episodes.length < 1000; i++) episodes.push({ number: i });  
        if (episodes.length > 0) {  
          const payload = { shows: [{ ids: { simkl: parseInt(normalizedId) }, episodes }] };  
          const url = `${this.baseUrl}/sync/history${remove ? '/remove' : ''}`;  
          await this.makeRequest({  
            url,  
            method: 'POST',  
            headers: this.getHeaders({ type: 'update' }),  
            body: JSON.stringify(payload),  
            priority: 'high'  
          });  
        }  
      }  
    }  
  }  
    
  // Invalidate cache  
  this.cache.invalidateByMedia(mediaId);  
  this.cache.invalidateScope('userData');  
    
    
  // Return AniList-compatible response  
  return {  
    id: null,  
    status: updates.status || null,  
    score: updates.score || 0,  
    progress: updates.progress || 0  
  };
}

buildUpdatePayload(mediaId, updates, mediaType, forceContainerKey = null) { 
  console.log('[Simkl][Update] buildUpdatePayload', { mediaId, updates, mediaType, forceContainerKey });
  const typeUpper = (mediaType || '').toString().toUpperCase();
  const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';

  // Simkl expects container 'shows' for anime/TV and 'movies' for movies  
  const containerKey = forceContainerKey || (isMovie ? 'movies' : 'shows');  
  const payload = { [containerKey]: [{ ids: {} }] };  

  const item = payload[containerKey][0];  
  item.type = isMovie ? 'movie' : 'show';  
  // Prefer TMDb/IMDb if present in cache
  try {
    const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' });
    const media = cached?.media || cached || {};
    const tmdb = media.idTmdb || media.ids?.tmdb;
    const imdb = media.idImdb || media.ids?.imdb;
    if (tmdb) item.ids.tmdb = parseInt(tmdb);
    if (imdb) item.ids.imdb = imdb;
  } catch {}
  if (!item.ids.tmdb && !item.ids.imdb) {
    const typeUpperLocal = typeUpper; // retain computed
    const shouldUseTmdbFallback = (updates?._zUseTmdbId === true) && (isMovie || typeUpperLocal === 'TV' || typeUpperLocal.includes('SHOW'));
    if (shouldUseTmdbFallback) {
      item.ids.tmdb = parseInt(mediaId);
    } else {
      item.ids.simkl = parseInt(mediaId);
    }
  }
  
  console.log('[Simkl][Update] initial payload item', JSON.parse(JSON.stringify(item)));  
    
  // Add status using 'to' key instead of 'status' for list operations
  if (updates.status !== undefined) {  
    const originalStatus = updates.status;
    const validatedStatus = this.validateAndConvertStatus(updates.status, mediaType);
    item.to = validatedStatus;
    
    // Log status conversion for debugging
    if (originalStatus !== validatedStatus) {
      console.log(`[Simkl][Update] Status converted: ${originalStatus} → ${validatedStatus} (${isMovie ? 'movie' : 'show'})`);
    }
  } else if (!isMovie && updates.progress !== undefined) {  
    // Ensure status present when only progress is updated on shows  
    const prog = parseInt(updates.progress) || 0;  
    item.to = prog > 0 ? 'watching' : 'plantowatch';  
  }  
  
  // Add rating (Simkl uses 1-10 scale)  
  if (updates.score !== undefined && updates.score !== null) {  
    const score = Math.max(0, Math.min(10, Math.round(updates.score)));  
    if (score > 0) {  
      item.rating = score;  
    }  
  }  
    
  // Add progress  
  if (updates.progress !== undefined) {  
    if (isMovie) {  
      // movies don't have episodes; treat any progress > 0 as watched flag  
      item.watched = (parseInt(updates.progress) || 0) > 0;  
    } else {  
      const prog = parseInt(updates.progress) || 0;  
      item.watched_episodes = prog;  
      // If status not provided for shows, set a sensible default to satisfy API  
      if (item.to === undefined) {  
        item.to = prog > 0 ? 'watching' : 'plantowatch';  
      }  
    }  
  }  
    
  console.log('[Simkl][Update] enriched item before cache', JSON.parse(JSON.stringify(item)));  
  // Enrich with optional identifiers if available from cache (helps matching on server)  
  try {  
    const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' });  
    const media = cached?.media || cached;  
    if (media?.idImdb) {  
      item.ids.imdb = media.idImdb;  
    }  
    if (media?.idMal) {  
      item.ids.mal = media.idMal;  
    }  
    const title = media?.title?.english || media?.title?.romaji || media?.title?.native;  
    if (title) {  
      item.title = title;  
    }  
    console.log('[Simkl][Update] enriched item after cache', JSON.parse(JSON.stringify(item)));  
  } catch (e) { console.log('[Simkl][Update] cache enrich failed', e); }  

  console.log('[Simkl][Update] final payload', JSON.parse(JSON.stringify(payload)));  
  return payload;
}

  // Build payload using explicit identifiers, bypassing cache lookup
  buildUpdatePayloadFromIdentifiers(identifiers, updates, mediaType, forceContainerKey = null) {
    const typeUpper = (mediaType || '').toString().toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';
    const containerKey = forceContainerKey || (isMovie ? 'movies' : 'shows');
    const payload = { [containerKey]: [{ ids: {} }] };

    const item = payload[containerKey][0];
    item.type = isMovie ? 'movie' : 'show';

    const tmdb = identifiers?.tmdb;
    const imdb = identifiers?.imdb;
    const simkl = identifiers?.simkl;
    if (tmdb) item.ids.tmdb = parseInt(tmdb);
    if (!item.ids.tmdb && imdb) item.ids.imdb = String(imdb);
    if (!item.ids.tmdb && !item.ids.imdb && simkl) item.ids.simkl = parseInt(simkl);

    // Try to enrich with metadata from cache (title/mal/imdb stabilization)
    try {
      const cached = this.cache?.get(String(tmdb || simkl), { scope: 'mediaData' })
        || this.cache?.get(String(simkl || tmdb), { scope: 'mediaData' });
      const media = cached?.media || cached || {};
      if (!item.ids.imdb && media.idImdb) item.ids.imdb = media.idImdb;
      if (media.idMal) item.ids.mal = media.idMal;
      const title = media?.title?.english || media?.title?.romaji || media?.title?.native;
      if (title) item.title = title;
    } catch {}

    // Status
    if (updates.status !== undefined) {
      const validatedStatus = this.validateAndConvertStatus(updates.status, mediaType);
      item.to = validatedStatus;
    } else if (!isMovie && updates.progress !== undefined) {
      const prog = parseInt(updates.progress) || 0;
      item.to = prog > 0 ? 'watching' : 'plantowatch';
    }

    // Rating
    if (updates.score !== undefined && updates.score !== null) {
      const score = Math.max(0, Math.min(10, Math.round(updates.score)));
      if (score > 0) item.rating = score;
    }

    // Progress
    if (updates.progress !== undefined) {
      if (isMovie) {
        item.watched = (parseInt(updates.progress) || 0) > 0;
      } else {
        const prog = parseInt(updates.progress) || 0;
        item.watched_episodes = prog;
        if (item.to === undefined) item.to = prog > 0 ? 'watching' : 'plantowatch';
      }
    }

    return payload;
  }

// Build minimal payload for remove operations (only container and IDs)
buildRemovePayload(mediaId, mediaType, forceContainerKey = null) {
  console.log('[Simkl][Remove] buildRemovePayload', { mediaId, mediaType, forceContainerKey });
  const typeUpper = (mediaType || '').toString().toUpperCase();
  const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';

  // Simkl expects container 'shows' for anime/TV and 'movies' for movies  
  const containerKey = forceContainerKey || (isMovie ? 'movies' : 'shows');  
  const payload = { [containerKey]: [{ ids: {} }] };  

  // Try to enrich with TMDb/IMDb from cache; fallback to simkl id
  try {  
    const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' });  
    const media = cached?.media || cached || {};  
    const item = payload[containerKey][0];
    const tmdb = media.idTmdb || media.ids?.tmdb;  
    const imdb = media.idImdb || media.ids?.imdb;  
    if (tmdb) item.ids.tmdb = parseInt(tmdb);  
    if (imdb) item.ids.imdb = imdb;  
    // Add title for better server-side matching
    const title = media?.title?.english || media?.title?.romaji || media?.title?.native;  
    if (title) {  
      item.title = title;  
    }  
  } catch (e) { 
    console.log('[Simkl][Remove] cache enrich failed', e); 
  }
  if (!payload[containerKey][0].ids.tmdb && !payload[containerKey][0].ids.imdb) {
    payload[containerKey][0].ids.simkl = parseInt(mediaId);
  }

  console.log('[Simkl][Remove] minimal payload', JSON.parse(JSON.stringify(payload)));  
  return payload;
}

// Remove media from user's Simkl list
async removeMediaListEntry(mediaId, mediaType) {
  const normalizedId = this.normalizeSimklId(mediaId);
  this.validateMediaId(normalizedId);
  await this.ensureValidToken();
  const typeUpper = (mediaType || '').toString().toUpperCase();
  const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';
  
  console.log('[Simkl][Remove] Starting removal for', { normalizedId, mediaType, isMovie });
  
  // Use minimal payload for remove operations
  const payload = this.buildRemovePayload(normalizedId, mediaType);

  const requestParams = {  
    url: `${this.baseUrl}/sync/remove-from-list`,  
    method: 'POST',  
    headers: this.getHeaders({ type: 'update' }),  
    body: JSON.stringify(payload),  
    priority: 'high'  
  };  

  try {  
    console.log('[Simkl][Remove] Making primary remove request', requestParams);
    await this.makeRequest(requestParams);  
    console.log('[Simkl][Remove] Primary remove request successful');
  } catch (error) {  
    console.error('[Simkl][Remove] Primary remove request failed', error);
    throw this.createUserFriendlyError(error);  
  }  

  // Best-effort fallback: if anime removal silently fails, retry with 'shows' container  
  try {  
    if (!isMovie && typeUpper === 'ANIME') {  
      console.log('[Simkl][Remove] Attempting anime fallback with shows container');
      const fallback = this.buildRemovePayload(normalizedId, mediaType, 'shows');  
      await this.makeRequest({  
        url: `${this.baseUrl}/sync/remove-from-list`,  
        method: 'POST',  
        headers: this.getHeaders({ type: 'update' }),  
        body: JSON.stringify(fallback),  
        priority: 'normal'  
      });  
      console.log('[Simkl][Remove] Anime fallback completed');
    }  
  } catch (fallbackError) {
    console.warn('[Simkl][Remove] Fallback attempt failed', fallbackError);
  }

  // Also try removing from watchlist and history as comprehensive cleanup
  try {
    console.log('[Simkl][Remove] Attempting comprehensive cleanup');
    
    // Remove from watchlist (different endpoint)
    await this.makeRequest({
      url: `${this.baseUrl}/sync/watchlist/remove`,
      method: 'POST',
      headers: this.getHeaders({ type: 'update' }),
      body: JSON.stringify(payload),
      priority: 'normal'
    });
    
    // Remove from history
    await this.makeRequest({
      url: `${this.baseUrl}/sync/history/remove`,
      method: 'POST',
      headers: this.getHeaders({ type: 'update' }),
      body: JSON.stringify(payload),
      priority: 'normal'
    });
    
    // Remove ratings
    await this.makeRequest({
      url: `${this.baseUrl}/sync/ratings/remove`,
      method: 'POST',
      headers: this.getHeaders({ type: 'update' }),
      body: JSON.stringify(payload),
      priority: 'normal'
    });
    
    console.log('[Simkl][Remove] Comprehensive cleanup completed');
  } catch (cleanupError) {
    console.warn('[Simkl][Remove] Comprehensive cleanup failed', cleanupError);
    // Don't throw here as the main removal might have worked
  }

  // Invalidate cache after all operations
  this.cache.invalidateByMedia(mediaId);  
  this.cache.invalidateScope('userData');
  
  console.log('[Simkl][Remove] Removal process completed for', normalizedId);
}
  // =================== AUTH METHODS (Following MAL pattern) ===================

  async makeObsidianRequest(code, redirectUri) {
    const body = {
      grant_type: 'authorization_code',
      client_id: this.plugin.settings.simklClientId,
      client_secret: this.plugin.settings.simklClientSecret || '',
      redirect_uri: redirectUri,
      code: code
    };

    try {
      const requestFn = () => requestUrl({
        url: this.tokenUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const response = await this.requestQueue.add(requestFn, { priority: 'high' });
      
      if (!response?.json || typeof response.json !== 'object') {
        throw new Error('Invalid auth response from Simkl');
      }

      if (response.json.error) {
        throw new Error(response.json.error_description || response.json.error);
      }

      console.log('[Simkl] Authentication successful');
      return response.json;

    } catch (error) {
      console.error('[Simkl] Authentication failed:', error.message);
      throw new Error(`Simkl authentication failed: ${error.message}`);
    }
  }

  async ensureValidToken() {
    if (!this.plugin.settings.simklAccessToken) {
      throw new Error('Authentication required');
    }
    
    // TODO: Implement token refresh logic if needed
    return true;
  }


  // =================== MAPPING FUNCTIONS (Fixed) ===================

  mapAniListStatusToSimkl(status) {
    return this.aniListToSimklStatus[status] || status?.toLowerCase();
  }

  mapSimklStatusToAniList(status) {
    return this.simklToAniListStatus[status] || status?.toUpperCase();
  }

  // Validate and convert status based on media type
  validateAndConvertStatus(status, mediaType) {
    if (!status) return 'plantowatch'; // Default to planning
    
    const typeUpper = String(mediaType || '').toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';
    
    // Convert AniList status to Simkl status
    const simklStatus = this.mapAniListStatusToSimkl(status);
    
    if (isMovie) {
      // Movies only support limited statuses
      if (!this.validMovieStatuses.includes(simklStatus)) {
        // Convert invalid movie statuses to valid ones
        if (['watching', 'hold'].includes(simklStatus)) {
          return 'plantowatch'; // Convert watching/on-hold to planning for movies
        }
        // Keep completed and dropped as-is
        if (['completed', 'dropped'].includes(simklStatus)) {
          return simklStatus;
        }
        // Default to planning for any other invalid status
        return 'plantowatch';
      }
      return simklStatus;
    } else {
      // Shows support all statuses
      if (!this.validShowStatuses.includes(simklStatus)) {
        return 'plantowatch'; // Default to planning for invalid show statuses
      }
      return simklStatus;
    }
  }

  // Get valid statuses for a specific media type
  getValidStatusesForMediaType(mediaType) {
    const typeUpper = String(mediaType || '').toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';
    
    if (isMovie) {
      return this.validMovieStatuses;
    } else {
      return this.validShowStatuses;
    }
  }

  // Get valid AniList statuses for a specific media type
  getValidAniListStatusesForMediaType(mediaType) {
    const simklStatuses = this.getValidStatusesForMediaType(mediaType);
    return simklStatuses.map(status => this.simklToAniListStatus[status]).filter(Boolean);
  }

  // Check if a status is valid for a specific media type
  isStatusValidForMediaType(status, mediaType) {
    const validStatuses = this.getValidStatusesForMediaType(mediaType);
    return validStatuses.includes(status);
  }

  // Check if an AniList status is valid for a specific media type
  isAniListStatusValidForMediaType(aniListStatus, mediaType) {
    const simklStatus = this.mapAniListStatusToSimkl(aniListStatus);
    return this.isStatusValidForMediaType(simklStatus, mediaType);
  }

  // Get status conversion info for user feedback
  getStatusConversionInfo(aniListStatus, mediaType) {
    const typeUpper = String(mediaType || '').toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';
    
    if (isMovie) {
      const simklStatus = this.mapAniListStatusToSimkl(aniListStatus);
      if (!this.validMovieStatuses.includes(simklStatus)) {
        const convertedStatus = this.validateAndConvertStatus(aniListStatus, mediaType);
        return {
          original: aniListStatus,
          converted: this.simklToAniListStatus[convertedStatus],
          reason: `Movies in Simkl only support: Planning, Completed, Dropped`,
          note: `${aniListStatus} was converted to ${this.simklToAniListStatus[convertedStatus]}`
        };
      }
    }
    
    return {
      original: aniListStatus,
      converted: aniListStatus,
      reason: null,
      note: null
    };
  }

  // Get default status for a media type
  getDefaultStatusForMediaType(mediaType) {
    return 'plantowatch'; // Always default to planning for new entries
  }

  // Get default AniList status for a media type
  getDefaultAniListStatusForMediaType(mediaType) {
    const defaultSimklStatus = this.getDefaultStatusForMediaType(mediaType);
    return this.simklToAniListStatus[defaultSimklStatus];
  }
  // FIXED: Enhanced format mapping with mediaType context
  mapSimklFormat(type, mediaType) {
    if (!type) {
      // Use mediaType as fallback
      if (mediaType) {
        const upperType = String(mediaType).toUpperCase();
        if (upperType === 'MOVIE' || upperType === 'MOVIES') return 'MOVIE';
        if (upperType === 'TV') return 'TV';
        if (upperType === 'ANIME') return 'TV';
      }
      return 'TV';
    }
    
    const formatMap = {
      'tv': 'TV',
      'movie': 'MOVIE',
      'film': 'MOVIE',
      'special': 'SPECIAL',
      'ova': 'OVA',
      'ona': 'ONA',
      'anime': 'TV'
    };
    
    const lowerType = String(type).toLowerCase();
    if (lowerType.includes('movie') || lowerType.includes('film')) {
      return 'MOVIE';
    }
    
    return formatMap[lowerType] || 'TV';
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

  // =================== VALIDATION METHODS (Following MAL pattern) ===================

  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }

    const normalized = { ...config };
    if (!normalized.type) normalized.type = 'list';
    if (normalized.mediaType) normalized.mediaType = normalized.mediaType.toUpperCase();
    
    if (normalized.page && (normalized.page < 1 || normalized.page > 1000)) {
      throw new Error(`Invalid page: ${normalized.page}`);
    }
    
    return normalized;
  }

  normalizeSimklId(mediaId) {
    if (typeof mediaId === 'number') {
      return Number.isFinite(mediaId) && mediaId > 0 ? mediaId : 0;
    }
    if (!mediaId) return 0;
    // Accept strings like "simkl:12345", "id=12345", or mixed forms, pick the first valid group of digits
    const str = String(mediaId);
    // Prefer exact simkl id if encoded like simkl:123 or simkl=123
    const simklMatch = str.match(/simkl[^0-9]*([0-9]+)/i);
    if (simklMatch && simklMatch[1]) {
      const val = parseInt(simklMatch[1], 10);
      return Number.isFinite(val) && val > 0 ? val : 0;
    }
    // Fallback: first standalone number
    const anyMatch = str.match(/([0-9]{1,})/);
    if (anyMatch && anyMatch[1]) {
      const val = parseInt(anyMatch[1], 10);
      return Number.isFinite(val) && val > 0 ? val : 0;
    }
    return 0;
  }

  validateMediaId(mediaId) {
    const id = this.normalizeSimklId(mediaId);
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

  requiresAuth(requestType) {
    // Only search requests don't require authentication
    return requestType !== 'search';
  }

  // =================== CACHE & URL METHODS ===================

  createCacheKey(config) {
    const sortedConfig = {};
    Object.keys(config).sort().forEach(key => {
      if (key !== 'accessToken' && key !== 'clientSecret') {
        sortedConfig[key] = config[key];
      }
    });
    return JSON.stringify(sortedConfig);
  }

  getCacheScope(requestType) {
    const scopeMap = {
      'stats': 'userData',
      'single': 'mediaData',
      'search': 'searchResults',
      'list': 'userData'
    };
    return scopeMap[requestType] || 'userData';
  }

  buildFullUrl(baseUrl, params) {
    if (!params || Object.keys(params).length === 0) return baseUrl;
    const queryString = new URLSearchParams(params).toString();
    return `${baseUrl}?${queryString}`;
  }

  getSimklUrl(mediaId, mediaType = 'ANIME') {
    try {
      this.validateMediaId(mediaId);
      const typeUpper = (mediaType || 'ANIME').toString().toUpperCase();
      
      let segment = 'tv'; // default
      if (typeUpper === 'ANIME') {
        segment = 'anime';
      } else if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper.includes('MOVIE')) {
        segment = 'movies';
      }
      
      return `https://simkl.com/${segment}/${mediaId}`;
    } catch (error) {
      throw error;
    }
  }
  // =================== ERROR HANDLING (Simplified from original) ===================

  createUserFriendlyError(error) {
    const errorMessages = {
      'auth': '🔑 Authentication required. Please connect your Simkl account.',
      'network': '🌐 Connection issue. Please check your internet connection.',
      'rate': '🚦 Too many requests. Please wait a moment.',
      'server': '🔧 Simkl servers are experiencing issues.',
      'invalid': '⚠️ Invalid request. Please check your input.'
    };
    
    let errorType = 'unknown';
    const msg = error.message?.toLowerCase() || '';
    
    if (msg.includes('auth') || msg.includes('unauthorized')) {
      errorType = 'auth';
    } else if (msg.includes('rate limit')) {
      errorType = 'rate';
    } else if (msg.includes('network') || msg.includes('connection')) {
      errorType = 'network';
    } else if (msg.includes('server') || msg.includes('500')) {
      errorType = 'server';
    } else if (msg.includes('invalid') || msg.includes('400')) {
      errorType = 'invalid';
    }
    
    const userMessage = errorMessages[errorType] || '❌ An unexpected error occurred.';
    const friendlyError = new Error(userMessage);
    friendlyError.type = errorType;
    friendlyError.originalMessage = error.message;
    
    return friendlyError;
  }

  // =================== COMPATIBILITY METHODS (Following MAL pattern) ===================

  async fetchSimklStats(config) {
    return this.fetchSimklData({ ...config, type: 'stats' });
  }

  async fetchSimklList(config) {
    return this.fetchSimklData(config);
  }

  async searchSimklMedia(config) {
    const searchResults = await this.fetchSimklData({ ...config, type: 'search' });
    
    // Ensure search results have proper IDs for editing operations
    if (config.ensureIds !== false) { // Default to true unless explicitly disabled
      return await this.ensureSearchResultIds(searchResults, config.mediaType);
    }
    
    return searchResults;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  // Fetch entries for computing distributions
  async fetchUserListEntries(mediaType = 'ANIME') {
    const resp = await this.fetchSimklData({ type: 'list', mediaType });
    const entries = resp?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return entries;
  }

  // Compute distributions from entries (replicated from MAL logic for parity)
  aggregateDistributionsFromEntries(entries, typeLower) {
    const result = {
      statuses: [],
      scores: [],
      formats: [],
      releaseYears: [],
      genres: []
    };
  
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

  async attachSimklDistributions(user) {
    try {
      const [animeEntries, tvEntries, movieEntries] = await Promise.all([
        this.fetchUserListEntries('ANIME'),
        this.fetchUserListEntries('TV'),
        this.fetchUserListEntries('MOVIE')
      ]);
      const animeAgg = this.aggregateDistributionsFromEntries(animeEntries, 'anime');
      const tvAgg = this.aggregateDistributionsFromEntries(tvEntries, 'tv');
      const movieAgg = this.aggregateDistributionsFromEntries(movieEntries, 'movie');

      if (user?.statistics?.anime) {
        Object.assign(user.statistics.anime, animeAgg);
      }
      if (user?.statistics?.tv) {
        Object.assign(user.statistics.tv, tvAgg);
      }
      if (user?.statistics?.movie) {
        Object.assign(user.statistics.movie, movieAgg);
      }

      // Apply fallback values similar to MAL implementation
      const applyFallbacks = (entries, statsObj) => {
        if (!statsObj) return;
        if (!statsObj.count || statsObj.count === 0) {
          statsObj.count = Array.isArray(entries) ? entries.length : 0;
        }
        if ((!statsObj.meanScore || statsObj.meanScore === 0) && Array.isArray(entries) && entries.length) {
          const rated = entries.filter(e => typeof e.score === 'number' && e.score > 0);
          if (rated.length) {
            const avg10 = rated.reduce((sum, e) => sum + e.score, 0) / rated.length;
            statsObj.meanScore = Math.round(avg10 * 10) / 10;
          }
        }
      };

      applyFallbacks(animeEntries, user?.statistics?.anime);
      applyFallbacks(tvEntries, user?.statistics?.tv);
      applyFallbacks(movieEntries, user?.statistics?.movie);

    } catch (err) {
      
    }
  }

  // =================== MEDIA TYPE DETECTION (Following MAL pattern) ===================

  async getMediaType(mediaId) {
    // For Simkl, we need to determine if it's anime, TV, or movie
    // Since we don't have a direct way to detect this from ID alone,
    // we'll need to search across different types or use context
    return 'anime'; // Default fallback
  }

  // Resolve a Simkl entry (and id) using external identifiers like TMDb/IMDb
  async resolveSimklByExternalIds({ tmdb = null, imdb = null }, mediaType) {
    try {
      const params = [];
      if (tmdb) params.push(`tmdb=${encodeURIComponent(tmdb)}`);
      if (!tmdb && imdb) params.push(`imdb=${encodeURIComponent(imdb)}`);
      if (params.length === 0) return null;
      const url = `${this.baseUrl}/search/id?${params.join('&')}`;
      const headers = this.getHeaders({ type: 'search' });
      const response = await this.makeRequest({ url, method: 'GET', headers, priority: 'normal' });

      // Reuse transformSinglePublicResponse parsing by simkl id once we find a candidate with simkl id
      const candidates = [];
      ['anime', 'movies', 'tv', 'shows', 'results', 'items'].forEach(key => {
        if (Array.isArray(response?.[key])) candidates.push(...response[key]);
      });
      if (Array.isArray(response)) candidates.push(...response);
      if (response?.ids) candidates.push(response);

      const first = candidates.find(item => {
        const node = item.movie || item.show || item;
        const ids = node?.ids || node || {};
        return Number(ids?.simkl || ids?.id) > 0;
      });
      if (!first) return null;
      const node = first.movie || first.show || first;
      const simklId = Number(node?.ids?.simkl || node?.ids?.id);
      const media = this.transformMedia(node, mediaType);
      return { simklId, media };
    } catch (e) {
      console.warn('[Simkl] resolveSimklByExternalIds failed:', e?.message || e);
      return null;
    }
  }

}

export { SimklApi };