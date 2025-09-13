/**
 * SimklApi.ts
 * Migrated from SimklApi.js → SimklApi.ts
 * - Added strict TypeScript types and interfaces
 * - Converted ES module imports
 * - Added proper Obsidian plugin typing
 * - Added validation functions for API responses
 */

import { requestUrl } from 'obsidian';
import type { Plugin } from 'obsidian';
import { ZoroError } from '../../core/ZoroError.js';

// Core interfaces for API responses
interface SimklMediaIds {
  simkl?: number;
  simkl_id?: number;
  id?: number;
  mal?: number;
  imdb?: string;
  tmdb?: number;
}

interface SimklTitleObject {
  english?: string;
  romaji?: string;
  native?: string;
  en?: string;
  original?: string;
}

interface SimklDate {
  year: number;
  month: number;
  day: number;
}

interface SimklCoverImage {
  large: string | null;
  medium: string | null;
  _raw?: string;
  _normalized?: string;
}

interface SimklMedia {
  id: number;
  idMal: number | null;
  idImdb: string | null;
  idTmdb: number | null;
  title: SimklTitleObject;
  coverImage: SimklCoverImage;
  format: string;
  averageScore: number | null;
  status: string | null;
  genres: string[];
  episodes: number | null;
  chapters: number | null;
  isFavourite: boolean;
  startDate: SimklDate | null;
  endDate: SimklDate | null;
  nextAiringEpisode: null;
  description: string | null;
  _isMovie: boolean;
  _mediaType: string;
  _rawData: unknown;
}

interface SimklListEntry {
  id: number | null;
  status: string | null;
  score: number;
  progress: number;
  media: SimklMedia;
}

interface SimklUserStats {
  total?: number;
  rating?: number;
  episodes?: number;
  minutes?: number;
}

interface SimklUser {
  id: number | null;
  name: string;
  avatar: {
    large: string | null;
    medium: string | null;
  };
  statistics: {
    anime: SimklUserStats & {
      count: number;
      meanScore: number;
      standardDeviation: number;
      episodesWatched: number;
      minutesWatched: number;
      statuses?: Array<{ status: string; count: number }>;
      scores?: Array<{ score: number; count: number }>;
      formats?: Array<{ format: string; count: number }>;
      releaseYears?: Array<{ releaseYear: number; count: number }>;
      genres?: string[];
    };
    tv: SimklUserStats & {
      count: number;
      meanScore: number;
      standardDeviation: number;
      episodesWatched: number;
      minutesWatched: number;
      statuses?: Array<{ status: string; count: number }>;
      scores?: Array<{ score: number; count: number }>;
      formats?: Array<{ format: string; count: number }>;
      releaseYears?: Array<{ releaseYear: number; count: number }>;
      genres?: string[];
    };
    movie: SimklUserStats & {
      count: number;
      meanScore: number;
      standardDeviation: number;
      minutesWatched: number;
      statuses?: Array<{ status: string; count: number }>;
      scores?: Array<{ score: number; count: number }>;
      formats?: Array<{ format: string; count: number }>;
      releaseYears?: Array<{ releaseYear: number; count: number }>;
      genres?: string[];
    };
  };
  mediaListOptions: {
    scoreFormat: string;
  };
}

interface SimklApiConfig {
  type?: 'search' | 'single' | 'stats' | 'list';
  mediaType?: string;
  mediaId?: number | string;
  search?: string;
  query?: string;
  page?: number;
  perPage?: number;
  listType?: string;
  method?: string;
  body?: string;
  priority?: 'high' | 'normal' | 'low';
  nocache?: boolean;
  ensureIds?: boolean;
  accessToken?: string;
  clientSecret?: string;
}

interface SimklUpdateData {
  status?: string;
  score?: number;
  progress?: number;
  _zUseTmdbId?: boolean;
}

interface SimklRequestParams {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  priority: string;
  type?: string;
}

interface SimklFieldSets {
  compact: string;
  card: string;
  full: string;
}

interface SimklSearchFieldSets {
  compact: string;
  card: string;
  full: string;
}

interface SimklStatusMapping {
  [key: string]: string;
}

interface SimklMediaTypeMapping {
  [key: string]: string;
}

interface SimklApiMetrics {
  requests: number;
  cached: number;
  errors: number;
}

interface SimklAuthResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface SimklSearchResponse {
  Page: {
    media: SimklMedia[];
  };
}

interface SimklSingleResponse {
  MediaList: SimklListEntry | null;
}

interface SimklListResponse {
  MediaListCollection: {
    lists: Array<{
      entries: SimklListEntry[];
    }>;
  };
}

interface SimklStatsResponse {
  User: SimklUser;
}

// Type guards for runtime validation
function isSimklAuthResponse(data: unknown): data is SimklAuthResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.access_token === 'string' || typeof obj.error === 'string';
}

function isSimklMediaResponse(data: unknown): data is Record<string, unknown> {
  if (!data) return false;
  if (Array.isArray(data)) return true;
  if (typeof data === 'object') return true;
  return false;
}

// Plugin settings interface (inferred from usage)
interface SimklPluginSettings {
  simklClientId?: string;
  simklClientSecret?: string;
  simklAccessToken?: string;
}

// Plugin interface (inferred from usage)
interface SimklPlugin extends Plugin {
  settings: SimklPluginSettings;
  requestQueue: {
    add: (fn: () => Promise<unknown>, options: {
      priority: string;
      timeout?: number;
      service: string;
      metadata: { type: string };
    }) => Promise<unknown>;
  };
  cache: {
    get: (key: string, options?: { scope?: string; source?: string }) => unknown;
    set: (key: string, value: unknown, options?: { scope?: string; source?: string }) => void;
    invalidateScope: (scope: string) => void;
    invalidateByMedia: (mediaId: string | number) => void;
  };
  manifest?: {
    version?: string;
  };
}

class SimklApi {
  private plugin: SimklPlugin;
  private requestQueue: SimklPlugin['requestQueue'];
  private cache: SimklPlugin['cache'];
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly fieldSets: SimklFieldSets;
  private readonly searchFieldSets: SimklSearchFieldSets;
  private readonly simklToAniListStatus: SimklStatusMapping;
  private readonly aniListToSimklStatus: SimklStatusMapping;
  private readonly validMovieStatuses: string[];
  private readonly validShowStatuses: string[];
  private readonly mediaTypeMap: SimklMediaTypeMapping;
  private metrics: SimklApiMetrics;

  constructor(plugin: SimklPlugin) {
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

  async fetchSimklData(config: SimklApiConfig): Promise<SimklSearchResponse | SimklSingleResponse | SimklListResponse | SimklStatsResponse> {
    try {
      return await this.executeFetch(config);
    } catch (error) {
      this.metrics.errors++;
      throw this.createUserFriendlyError(error as Error);
    }
  }

  private async executeFetch(config: SimklApiConfig): Promise<SimklSearchResponse | SimklSingleResponse | SimklListResponse | SimklStatsResponse> {
    const normalizedConfig = this.validateConfig(config);
    const cacheKey = this.createCacheKey(normalizedConfig);
    const cacheScope = this.getCacheScope(normalizedConfig.type || 'list');
    
    // Check cache first
    if (!normalizedConfig.nocache) {
      const cached = this.cache.get(cacheKey, { 
        scope: cacheScope,
        source: 'simkl'
      });
      if (cached) {
        this.metrics.cached++;
        return cached as SimklSearchResponse | SimklSingleResponse | SimklListResponse | SimklStatsResponse;
      }
    }

    // Ensure authentication for user-specific requests
    if (this.requiresAuth(normalizedConfig.type || 'list')) {
      await this.ensureValidToken();
    }
    
    // Build and execute request
    let transformedData: SimklSearchResponse | SimklSingleResponse | SimklListResponse | SimklStatsResponse | null = null;
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
      console.warn('[Simkl] Primary single request failed, will try public fallback:', (err as Error)?.message || err);
    }
    
    // If stats requested, enrich with distributions computed from user lists
    if (normalizedConfig.type === 'stats' && transformedData && 'User' in transformedData) {
      try {
        await this.attachSimklDistributions(transformedData.User);
      } catch (e) {
        // Silent fail for stats enrichment
      }
    }

    // Public fallback for single media when not found or auth missing
    if (normalizedConfig.type === 'single' && (!transformedData || !('MediaList' in transformedData) || transformedData.MediaList == null)) {
      try {
        const publicResult = await this.fetchSingleByIdPublic(normalizedConfig.mediaId!, normalizedConfig.mediaType!);
        if (publicResult) {
          transformedData = publicResult;
        }
      } catch (e) {
        console.warn('[Simkl] Public single fetch fallback failed:', (e as Error)?.message || e);
      }
    }
    
    // Cache successful results
    if (transformedData && !normalizedConfig.nocache) {
      this.cache.set(cacheKey, transformedData, { 
        scope: cacheScope,
        source: 'simkl'
      });
    }
    
    return transformedData || { MediaListCollection: { lists: [{ entries: [] }] } } as SimklListResponse;
  }

  // =================== REQUEST BUILDING (Fixed based on MAL pattern) ===================

  private buildRequestParams(config: SimklApiConfig): SimklRequestParams {
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

  private buildEndpointUrl(config: SimklApiConfig): string {
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
  private getSimklMediaType(mediaType?: string): string {
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

  private buildQueryParams(config: SimklApiConfig): Record<string, string> {
    const params: Record<string, string> = {};
    
    // Always include client_id for public endpoints
    if (this.plugin.settings.simklClientId) {
      params.client_id = this.plugin.settings.simklClientId;
    }
    
    switch (config.type) {
      case 'search':
        if (config.search || config.query) {
          params.q = (config.search || config.query)!.trim();
        }
        // Simkl defaults: try conservative page/limit
        params.limit = Math.max(1, Math.min(config.perPage || 10, 20)).toString();
        params.page = Math.max(1, config.page || 1).toString();
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

  private getHeaders(config: SimklApiConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `Zoro-Plugin/${this.plugin.manifest?.version || '1.0.0'}`
    };
    
    if (this.plugin.settings.simklClientId) {
      headers['simkl-api-key'] = this.plugin.settings.simklClientId;
    }
    
    // Add auth token for user-specific requests
    if (this.requiresAuth(config.type || 'list') && this.plugin.settings.simklAccessToken) {
      headers['Authorization'] = `Bearer ${this.plugin.settings.simklAccessToken}`;
    }
    
    // Some endpoints are picky without a Referer
    headers['Referer'] = 'https://simkl.com/';
    
    return headers;
  }

  // =================== HTTP REQUEST EXECUTION (Following MAL pattern) ===================
  
  private async makeRequest(requestParams: SimklRequestParams): Promise<unknown> {
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
        timeout: 25000,
        service: 'simkl',
        metadata: { type: requestParams.type || 'update' }
      }) as { status?: number; json?: unknown; text?: string };

      if (!response) {
        console.log('[Simkl][HTTP] Empty response object');
        throw new Error('Empty response from Simkl');
      }

      // Handle Simkl error responses
      if (response.status && (response.status < 200 || response.status >= 300)) {
        const errMsg = (response.json as { error_description?: string; error?: string })?.error_description || 
                      (response.json as { error?: string })?.error || 
                      `HTTP ${response.status}`;
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
  private async performSearchWithFallbacks(config: SimklApiConfig): Promise<SimklSearchResponse> { 
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

    const aggregated: SimklMedia[] = [];
    for (const c of candidates) {
      try {
        const qp: Record<string, string> = {
          q: term,
          limit: Math.max(1, Math.min(config.perPage || 10, 20)).toString(),
          page: Math.max(1, config.page || 1).toString()
        };
        if (this.plugin.settings.simklClientId) {
          qp.client_id = this.plugin.settings.simklClientId;
        }
        const url = this.buildFullUrl(c.endpoint, qp);
        const raw = await this.makeRequest({ url, method: 'GET', headers: this.getHeaders({ type: 'search' }), priority: 'normal' });
        const key = this.getSimklMediaType(c.type);
        let items: unknown[];
        if (Array.isArray(raw)) items = raw;
        else if (Array.isArray((raw as Record<string, unknown>)[key])) items = (raw as Record<string, unknown>)[key] as unknown[];
        else if (Array.isArray((raw as { results?: unknown[] }).results)) items = (raw as { results: unknown[] }).results;
        else if ((raw as { movie?: unknown; show?: unknown }).movie || (raw as { movie?: unknown; show?: unknown }).show) items = [raw];
        else items = [];
        
        for (const item of items) {
          const mapped = this.transformMedia(item, c.type);
          
          // Only include items with valid IDs for editing operations
          if (mapped && mapped.id > 0) {
            aggregated.push(mapped);
          }
        }
      } catch {
        // Silent fail for fallback attempts
      }
    }

    return { Page: { media: aggregated } };
  }

  // Enhanced method to resolve a Simkl ID by title for edit operations when search results lack ids
  private async resolveSimklIdByTitle(title: string, mediaType?: string): Promise<number | null> {
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
        const qp: Record<string, string> = { q: term, limit: '10', page: '1' }; // Increased limit for better matching
        if (this.plugin.settings.simklClientId) qp.client_id = this.plugin.settings.simklClientId;
        const url = this.buildFullUrl(ep, qp);
        const raw = await this.makeRequest({ url, method: 'GET', headers: this.getHeaders({ type: 'search' }), priority: 'normal' });
        const items = Array.isArray(raw) ? raw : 
                     ((raw as Record<string, unknown>).results as unknown[] || 
                      (raw as Record<string, unknown>).anime as unknown[] || 
                      (raw as Record<string, unknown>).tv as unknown[] || 
                      (raw as Record<string, unknown>).movies as unknown[] || []);
        
        // Try to find the best match by title similarity
        let bestMatch: number | null = null;
        let bestScore = 0;
        
        for (const it of items) {
          const node = (it as { movie?: unknown; show?: unknown }).movie || 
                      (it as { movie?: unknown; show?: unknown }).show || it;
          const ids = (node as { ids?: SimklMediaIds }).ids || node as SimklMediaIds;
          // Now that we normalize simkl_id to simkl, we can just use simkl
          const id = Number(ids?.simkl || ids?.id);
          
          if (id > 0) {
            // Calculate title similarity score
            const itemTitle = ((node as { title?: string; name?: string }).title || 
                              (node as { title?: string; name?: string }).name || '').toLowerCase();
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
      } catch {
        // Silent fail for individual endpoint attempts
      }
    }
    return null;
  }

  // Helper method to calculate title similarity for better ID resolution
  private calculateTitleSimilarity(title1: string, title2: string): number {
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
  async ensureSearchResultIds(searchResults: SimklSearchResponse, mediaType?: string): Promise<SimklSearchResponse> {
    if (!searchResults?.Page?.media?.length) return searchResults;
    
    const enhancedResults: SimklMedia[] = [];
    let resolvedCount = 0;
    
    for (const item of searchResults.Page.media) {
      if (item && item.id > 0) {
        // Item already has a valid ID
        enhancedResults.push(item);
      } else if (item && item.title) {
        // Try to resolve ID by title
        try {
          console.log(`[Simkl] Resolving ID for search result: "${item.title.romaji || item.title.english || item.title.native}"`);
          const resolvedId = await this.resolveSimklIdByTitle(item.title.romaji || item.title.english || item.title.native || '', mediaType);
          if (resolvedId) {
            item.id = resolvedId;
            enhancedResults.push(item);
            resolvedCount++;
            console.log(`[Simkl] Successfully resolved ID ${resolvedId} for "${item.title.romaji || item.title.english || item.title.native}"`);
          } else {
            console.warn(`[Simkl] Could not resolve ID for "${item.title.romaji || item.title.english || item.title.native}"`);
          }
        } catch (error) {
          console.warn(`[Simkl] Failed to resolve ID for "${item.title.romaji || item.title.english || item.title.native}":`, error);
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
  async getMediaById(mediaId: string | number, mediaType?: string): Promise<SimklListEntry | null> {
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
  async validateSearchResultForEditing(searchResult: SimklMedia, mediaType?: string): Promise<SimklMedia | null> {
    if (!searchResult) return null;
    
    // If it already has a valid ID, return as is
    if (searchResult.id && Number.isFinite(Number(searchResult.id)) && Number(searchResult.id) > 0) {
      return searchResult;
    }
    
    // Try to resolve ID by title
    if (searchResult.title) {
      try {
        const titleString = searchResult.title.romaji || searchResult.title.english || searchResult.title.native || '';
        const resolvedId = await this.resolveSimklIdByTitle(titleString, mediaType);
        if (resolvedId) {
          searchResult.id = resolvedId;
          console.log(`[Simkl] Resolved ID ${resolvedId} for editing: "${titleString}"`);
          return searchResult;
        }
      } catch (error) {
        console.warn(`[Simkl] Failed to resolve ID for editing "${searchResult.title.romaji || searchResult.title.english || searchResult.title.native}":`, error);
      }
    }
    
    console.warn(`[Simkl] Cannot edit search result without valid ID: "${searchResult.title?.romaji || searchResult.title?.english || searchResult.title?.native}"`);
    return null;
  }

  // =================== DATA TRANSFORMATION (Fixed to match expected structure) ===================

  private transformResponse(data: unknown, config: SimklApiConfig): SimklSearchResponse | SimklSingleResponse | SimklListResponse | SimklStatsResponse {
    switch (config.type) {
      case 'search':
        return this.transformSearchResponse(data, config);
      case 'single':
        return this.transformSingleResponse(data, config);
      case 'stats':
        return this.transformStatsResponse(data);
      case 'list':
      default:
        return this.transformListResponse(data, config);
    }
  }

  private transformSearchResponse(data: unknown, config: SimklApiConfig): SimklSearchResponse {
    const simklType = this.getSimklMediaType(config.mediaType);

    let items: unknown[] = [];
    
    // CRITICAL FIX: Simkl search responses are typically direct arrays
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object') {
      // Try to find items under various possible keys
      const possibleKeys = [simklType, 'results', 'items', 'anime', 'tv', 'movies', 'shows'];
      
      for (const key of possibleKeys) {
        if (Array.isArray((data as Record<string, unknown>)[key])) {
          items = (data as Record<string, unknown>)[key] as unknown[];
          break;
        }
      }
      
      // If still no items, check if it's a single item response
      if (items.length === 0) {
        if ((data as { movie?: unknown; show?: unknown; anime?: unknown }).movie || 
            (data as { movie?: unknown; show?: unknown; anime?: unknown }).show || 
            (data as { movie?: unknown; show?: unknown; anime?: unknown }).anime) {
          items = [data];
        }
      }
    }
    
    const transformedItems = items
      .map(item => this.transformMedia(item, config.mediaType))
      .filter((item): item is SimklMedia => item !== null && item.id > 0); // Only include items with valid IDs for editing operations
    
    return {
      Page: {
        media: transformedItems
      }
    };
  }

  private transformSingleResponse(data: unknown, config: SimklApiConfig): SimklSingleResponse {
    const targetMediaId = parseInt(String(config.mediaId));
    let targetEntry: unknown = null;
    
    // FIXED: Use the actual media type being requested
    const simklMediaType = this.getSimklMediaType(config.mediaType);
    const mediaArray = (data as Record<string, unknown>)[simklMediaType] as unknown[] || [];
    
    if (Array.isArray(mediaArray)) {
      targetEntry = mediaArray.find(entry => {
        const show = (entry as { show?: unknown }).show || entry;
        const ids = (show as { ids?: SimklMediaIds }).ids || show as SimklMediaIds;
        // Now that we normalize simkl_id to simkl, we can just use simkl
        return (ids.simkl === targetMediaId || ids.id === targetMediaId);
      });
    }
    
    return {
      MediaList: targetEntry ? this.transformListEntry(targetEntry, config.mediaType) : null
    };
  }
  
  // Fallback: fetch a single media by Simkl ID using public search-by-id API
  private async fetchSingleByIdPublic(mediaId: string | number, mediaType?: string): Promise<SimklSingleResponse> {
    const id = parseInt(String(mediaId));
    if (!id || Number.isNaN(id)) return { MediaList: null };

    const url = `${this.baseUrl}/search/id?simkl=${encodeURIComponent(id)}`;
    const headers = this.getHeaders({ type: 'search' });

    try {
      const response = await this.makeRequest({ url, method: 'GET', headers, priority: 'normal' });
      const wrapped = this.transformSinglePublicResponse(response, mediaType, id);
      return wrapped;
    } catch (e) {
      console.warn('[Simkl] fetchSingleByIdPublic failed:', (e as Error)?.message || e);
      return { MediaList: null };
    }
  }

  // Parse public search-by-id response into MediaList shape
  private transformSinglePublicResponse(raw: unknown, mediaType?: string, targetId?: number): SimklSingleResponse {
    if (!raw || (typeof raw !== 'object' && !Array.isArray(raw))) return { MediaList: null };

    const candidates: unknown[] = [];
    ['anime', 'movies', 'tv', 'shows', 'results', 'items'].forEach(key => {
      const rawObj = raw as Record<string, unknown>;
      if (Array.isArray(rawObj?.[key])) candidates.push(...(rawObj[key] as unknown[]));
    });

    if (Array.isArray(raw)) candidates.push(...raw);
    if (candidates.length === 0 && (raw as { ids?: unknown }).ids) candidates.push(raw);

    const match = candidates.find(item => {
      const node = (item as { movie?: unknown; show?: unknown }).movie || 
                  (item as { movie?: unknown; show?: unknown }).show || item;
      const ids = (node as { ids?: SimklMediaIds }).ids || node as SimklMediaIds || {};
      // Now that we normalize simkl_id to simkl, we can just use simkl
      return Number(ids.simkl || ids.id) === Number(targetId);
    }) || null;

    if (!match) return { MediaList: null };

    const node = (match as { movie?: unknown; show?: unknown }).movie || 
                (match as { movie?: unknown; show?: unknown }).show || match;
    const transformedMedia = this.transformMedia(node, mediaType);
    
    if (!transformedMedia) return { MediaList: null };
    
    const entry: SimklListEntry = {
      id: null,
      status: null,
      score: 0,
      progress: this.isMovieType(mediaType, node) ? 0 : 0,
      media: transformedMedia
    };

    return { MediaList: entry };
  }

  // FIXED: Complete rewrite of list response transformation with comprehensive debugging
  private transformListResponse(data: unknown, config: SimklApiConfig): SimklListResponse {
    let entries: unknown[] = [];
    
    // FIXED: Use the correct media type key from the response
    const simklMediaType = this.getSimklMediaType(config.mediaType);
    const raw = (data || {}) as Record<string, unknown>;

    // CRITICAL FIX: Try multiple possible data structure patterns
    
    // Pattern 1: Direct array under media type key
    if (Array.isArray(raw[simklMediaType])) {
      entries = raw[simklMediaType] as unknown[];
    }
    // Pattern 2: Root is an array (search results)
    else if (Array.isArray(raw)) {
      entries = raw;
    }
    // Pattern 3: Grouped data by status (e.g., {watching: [], completed: []})
    else if (raw[simklMediaType] && typeof raw[simklMediaType] === 'object') {
      const grouped = raw[simklMediaType] as Record<string, unknown>;
      
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
        if (raw[key] && Array.isArray(raw[key]) && (raw[key] as unknown[]).length > 0) {
          entries = raw[key] as unknown[];
          found = true;
          break;
        }
      }
      
      // Last resort: try any array in the response
      if (!found) {
        Object.keys(raw).forEach(key => {
          if (Array.isArray(raw[key]) && (raw[key] as unknown[]).length > 0) {
            entries = entries.concat(raw[key] as unknown[]);
          }
        });
      }
    }
    
    // Filter by status if specified
    if (config.listType && config.listType !== 'ALL') {
      const targetStatus = this.mapAniListStatusToSimkl(config.listType);
      entries = entries.filter(entry => 
        ((entry as { status?: string }).status || (entry as { _status?: string })._status) === targetStatus
      );
    }
    
    // Transform entries with enhanced error handling
    const transformedEntries: SimklListEntry[] = [];
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

  private transformStatsResponse(data: unknown): SimklStatsResponse {
    // Simkl user stats structure is different, adapt as needed
    const user = (data as { user?: unknown }).user || data as Record<string, unknown>;
    const simklStats = (user as { stats?: Record<string, unknown> }).stats || {};

    // Normalize categories for Simkl: anime, tv, movies
    const animeStats = (simklStats.anime || {}) as SimklUserStats;
    const tvStats = (simklStats.tv || simklStats.shows || {}) as SimklUserStats;
    const movieStats = (simklStats.movies || simklStats.films || {}) as SimklUserStats;
    
    return {
      User: {
        id: (user as { id?: number }).id || null,
        name: (user as { name?: string; username?: string }).name || 
              (user as { name?: string; username?: string }).username || 'Unknown User',
        avatar: {
          large: (user as { avatar?: string }).avatar || null,
          medium: (user as { avatar?: string }).avatar || null
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
  private transformMedia(simklMedia: unknown, mediaType?: string): SimklMedia | null {
    if (!simklMedia) {
      return null;
    }

    // CRITICAL FIX: Handle multiple possible data structures from Simkl
    let media: Record<string, unknown>, originalData: Record<string, unknown>;
    
    // Case 1: Data is nested under 'show' (common in sync responses)
    if ((simklMedia as { show?: unknown }).show) {
      media = (simklMedia as { show: Record<string, unknown> }).show;
      originalData = simklMedia as Record<string, unknown>; // Keep reference to full object
    }
    // Case 2: Data is nested under 'movie' (for movie responses)
    else if ((simklMedia as { movie?: unknown }).movie) {
      media = (simklMedia as { movie: Record<string, unknown> }).movie;
      originalData = simklMedia as Record<string, unknown>;
    }
    // Case 3: Data is directly in the root object
    else {
      media = simklMedia as Record<string, unknown>;
      originalData = simklMedia as Record<string, unknown>;
    }

    const ids = (media.ids || originalData.ids || {}) as SimklMediaIds;
    
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
    let finalId: number = 0;
    
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
      const mediaIds = media.ids as SimklMediaIds;
      if (mediaIds.simkl_id && Number.isFinite(Number(mediaIds.simkl_id))) {
        finalId = Number(mediaIds.simkl_id);
        // Normalize: also set the simkl field for consistency
        mediaIds.simkl = finalId;
      } else if (mediaIds.simkl && Number.isFinite(Number(mediaIds.simkl))) {
        finalId = Number(mediaIds.simkl);
      } else if (mediaIds.id && Number.isFinite(Number(mediaIds.id))) {
        finalId = Number(mediaIds.id);
      }
    }
    
    // Additional check: sometimes the ID is directly on the root object
    if (!finalId && originalData.ids) {
      const rootIds = originalData.ids as SimklMediaIds;
      if (rootIds.simkl_id && Number.isFinite(Number(rootIds.simkl_id))) {
        finalId = Number(rootIds.simkl_id);
        // Normalize: also set the simkl field for consistency
        rootIds.simkl = finalId;
      } else if (rootIds.simkl && Number.isFinite(Number(rootIds.simkl))) {
        finalId = Number(rootIds.simkl);
      } else if (rootIds.id && Number.isFinite(Number(rootIds.id))) {
        finalId = Number(rootIds.id);
      }
    }
    
    // Final fallback - check if we have any numeric ID
    if (!finalId) {
      const allIds = [
        ids.simkl_id, ids.simkl, ids.id, media.id, originalData.id,
        (media.ids as SimklMediaIds)?.simkl_id, (media.ids as SimklMediaIds)?.simkl, (media.ids as SimklMediaIds)?.id, 
        (originalData?.ids as SimklMediaIds)?.simkl_id, (originalData?.ids as SimklMediaIds)?.simkl, (originalData?.ids as SimklMediaIds)?.id,
        (originalData.ids as SimklMediaIds)?.simkl_id, (originalData.ids as SimklMediaIds)?.simkl, (originalData.ids as SimklMediaIds)?.id, originalData.id
      ];
      
      for (const id of allIds) {
        if (id && Number.isFinite(Number(id)) && Number(id) > 0) {
          finalId = Number(id);
          break;
        }
      }
    }

    const transformedResult: SimklMedia = {
      id: finalId || 0,
      idMal: ids.mal || null,
      idImdb: ids.imdb || null,
      idTmdb: ids.tmdb || null,
      title: extractedTitle,
      coverImage: {
        large: posterUrl,
        medium: posterUrl,
        _raw: String(media.poster || media.image || media.cover || ''),
        _normalized: posterUrl
      },
      format: isMovie ? 'MOVIE' : this.mapSimklFormat(
        String(media.type || media.kind || originalData.type || (mediaType || '').toString().toLowerCase()),
        mediaType
      ),
      averageScore: null, // Simkl ratings not needed for detail panel
      status: media.status ? String(media.status).toUpperCase() : null,
      genres: genres,
      episodes: episodes,
      chapters: null,
      isFavourite: false,
      startDate: this.parseDate(String(media.first_aired || originalData.first_aired || '')),
      endDate: this.parseDate(String(media.last_aired || originalData.last_aired || '')),
      // Simkl does not provide airing data in their API
      nextAiringEpisode: null,
      // Map Simkl overview to description for detail panel
      description: String(media.overview || originalData.overview || '') || null,
      // FIXED: Add movie-specific metadata for rendering
      _isMovie: isMovie,
      _mediaType: mediaType || '',
      _rawData: originalData // Keep for debugging
    };

    return transformedResult;
  }

  // FIXED: Enhanced poster URL extraction method
  private extractPosterUrl(media: Record<string, unknown>, originalData: Record<string, unknown>, ids: SimklMediaIds): string | null {
    // Try multiple poster field variations that Simkl uses for different content types
    const posterCandidates = [
      // Standard fields
      media.poster,
      media.image,
      media.cover,
      
      // Image object variations
      (media.images as Record<string, unknown>)?.poster,
      (media.images as Record<string, unknown>)?.poster_small,
      (media.images as Record<string, unknown>)?.poster_large,
      (media.images as Record<string, unknown>)?.movie_poster,
      (media.images as Record<string, unknown>)?.cover,
      (media.images as Record<string, unknown>)?.fanart,
      
      // Original data fallbacks
      originalData?.poster,
      originalData?.image,
      originalData?.cover,
      (originalData?.images as Record<string, unknown>)?.poster,
      (originalData?.images as Record<string, unknown>)?.movie_poster
    ];

    let posterUrl: string | null = null;
    
    for (const candidate of posterCandidates) {
      if (candidate) {
        if (typeof candidate === 'object') {
          const candidateObj = candidate as Record<string, unknown>;
          posterUrl = String(candidateObj.full || candidateObj.large || candidateObj.medium || 
                           candidateObj.url || candidateObj.path || 
                           Object.values(candidateObj).find(v => typeof v === 'string' && String(v).trim()) || '');
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
  private extractGenres(media: Record<string, unknown>, originalData: Record<string, unknown>): string[] {
    const genreCandidates = [
      media.genres,
      media.genre,
      originalData?.genres,
      originalData?.genre
    ];

    for (const candidate of genreCandidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        // Filter out empty/invalid genres
        const validGenres = candidate.filter((g): g is string => 
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
  private extractTitle(media: Record<string, unknown>, originalData: Record<string, unknown>): SimklTitleObject {
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
      (media?.title as Record<string, unknown>)?.english,
      (media?.title as Record<string, unknown>)?.romaji,
      (media?.title as Record<string, unknown>)?.native,
      (media?.title as Record<string, unknown>)?.en,
      (media?.title as Record<string, unknown>)?.original,
      
      // Original/root data fields
      originalData?.title,
      originalData?.name,
      originalData?.en_title,
      originalData?.original_title,
      originalData?.title_en,
      originalData?.title_english,
      originalData?.english_name,
      
      // Nested in original data
      (originalData?.title as Record<string, unknown>)?.english,
      (originalData?.title as Record<string, unknown>)?.romaji,
      (originalData?.title as Record<string, unknown>)?.native,
      (originalData?.title as Record<string, unknown>)?.en,
      (originalData?.title as Record<string, unknown>)?.original,
      
      // Show object nested fields (critical for Simkl sync responses)
      (originalData?.show as Record<string, unknown>)?.title,
      (originalData?.show as Record<string, unknown>)?.name,
      (originalData?.show as Record<string, unknown>)?.en_title,
      (originalData?.show as Record<string, unknown>)?.original_title,
      (originalData?.show as Record<string, unknown>)?.title_en,
      (originalData?.show as Record<string, unknown>)?.title_english,
      
      // Nested show title objects
      ((originalData?.show as Record<string, unknown>)?.title as Record<string, unknown>)?.english,
      ((originalData?.show as Record<string, unknown>)?.title as Record<string, unknown>)?.romaji,
      ((originalData?.show as Record<string, unknown>)?.title as Record<string, unknown>)?.native,
      ((originalData?.show as Record<string, unknown>)?.title as Record<string, unknown>)?.en,
      
      // Movie-specific nested fields
      (originalData?.movie as Record<string, unknown>)?.title,
      (originalData?.movie as Record<string, unknown>)?.name,
      (originalData?.movie as Record<string, unknown>)?.en_title,
      (originalData?.movie as Record<string, unknown>)?.original_title,
      
      // Alternative nested structures
      (media?.show as Record<string, unknown>)?.title,
      (media?.show as Record<string, unknown>)?.name,
      (media?.movie as Record<string, unknown>)?.title,
      (media?.movie as Record<string, unknown>)?.name,
      
      // International title variations
      (media?.titles as Record<string, unknown>)?.en,
      (media?.titles as Record<string, unknown>)?.english,
      (media?.titles as Record<string, unknown>)?.original,
      (originalData?.titles as Record<string, unknown>)?.en,
      (originalData?.titles as Record<string, unknown>)?.english,
      (originalData?.titles as Record<string, unknown>)?.original,
      
      // Last resort - use ID or any string field
      media?.slug,
      originalData?.slug,
      String(media?.id || originalData?.id || '').replace(/[^a-zA-Z0-9\s]/g, ' ')
    ];

    // Find the first valid title
    const primaryTitle = allPossibleTitleSources.find((title): title is string => 
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
      (media?.title as Record<string, unknown>)?.english,
      (media?.title as Record<string, unknown>)?.en,
      originalData?.en_title,
      originalData?.title_en,
      originalData?.title_english,
      (originalData?.show as Record<string, unknown>)?.en_title,
      ((originalData?.show as Record<string, unknown>)?.title as Record<string, unknown>)?.english,
      (originalData?.movie as Record<string, unknown>)?.en_title,
      primaryTitle // fallback
    ];

    const nativeCandidates = [
      media?.original_title,
      media?.title_original,
      media?.native,
      (media?.title as Record<string, unknown>)?.native,
      (media?.title as Record<string, unknown>)?.original,
      originalData?.original_title,
      originalData?.title_original,
      (originalData?.show as Record<string, unknown>)?.original_title,
      ((originalData?.show as Record<string, unknown>)?.title as Record<string, unknown>)?.native,
      (originalData?.movie as Record<string, unknown>)?.original_title,
      primaryTitle // fallback
    ];

    const englishTitle = englishCandidates.find((title): title is string => 
      title && typeof title === 'string' && title.trim() !== ''
    ) || primaryTitle || 'Unknown Title';

    const nativeTitle = nativeCandidates.find((title): title is string => 
      title && typeof title === 'string' && title.trim() !== ''
    ) || primaryTitle || 'Unknown Title';

    // Smart romaji detection
    let romajiTitle = primaryTitle || 'Unknown Title';
    if (primaryTitle !== nativeTitle && /[a-zA-Z]/.test(primaryTitle || '')) {
      romajiTitle = primaryTitle || 'Unknown Title';
    } else if (englishTitle !== primaryTitle) {
      romajiTitle = englishTitle;
    }

    const result: SimklTitleObject = {
      romaji: romajiTitle,
      english: englishTitle,
      native: nativeTitle
    };

    return result;
  }

  // NEW: Emergency title construction when all standard fields fail
  private constructEmergencyTitle(media: Record<string, unknown>, originalData: Record<string, unknown>): string | null {
    // Try to build a title from any available string data
    const possibleSources = [
      // Try any field that might contain a readable name
      String(media?.slug || '').replace(/[-_]/g, ' '),
      String(originalData?.slug || '').replace(/[-_]/g, ' '),
      
      // Check if there are any string fields that might be titles
      ...Object.values(media || {}).filter((val): val is string => 
        typeof val === 'string' && 
        val.length > 2 && 
        val.length < 100 &&
        !/^https?:\/\//.test(val) && // not a URL
        !/^\d+$/.test(val) && // not just numbers
        !/^[a-f0-9-]{20,}$/.test(val) // not a hash/ID
      ),
      
      ...Object.values(originalData || {}).filter((val): val is string => 
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
  private transformListEntry(simklEntry: unknown, mediaType?: string): SimklListEntry | null {
    if (!simklEntry) return null;
    
    const entryObj = simklEntry as Record<string, unknown>;
    const show = (entryObj.show || entryObj) as Record<string, unknown>;
    const statusRaw = entryObj.status || entryObj._status || show.status || null;

    // Check if this is a movie
    const isMovie = this.isMovieType(mediaType, show);

    let progress = 0;
    const watchedCandidates = [
      entryObj.watched_episodes_count,
      entryObj.watched_episodes,
      entryObj.episodes_watched,
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
      if ((!progress || progress === 0) && typeof entryObj.seasons_watched === 'number') {
        const totalEpisodes = Number(entryObj.total_episodes_count ?? show.total_episodes_count ?? show.total_episodes ?? show.episodes) || 0;
        const totalSeasons = Number(show.seasons) || 1;
        if (totalEpisodes && totalSeasons) {
          const perSeason = totalEpisodes / totalSeasons;
          progress = Math.floor(entryObj.seasons_watched * perSeason);
        }
      }
    }

    const mergedShow = Object.assign({}, show, {
      total_episodes_count: entryObj.total_episodes_count ?? show.total_episodes_count ?? show.total_episodes,
      total_episodes: entryObj.total_episodes_count ?? show.total_episodes
    });
    
    const transformedMedia = this.transformMedia(mergedShow, mediaType);
    
    if (!transformedMedia) return null;
    
    return {
      id: transformedMedia?.id || null, 
      status: this.mapSimklStatusToAniList(String(statusRaw || '')),
      score: Number(entryObj.user_rating ?? entryObj.rating ?? show.rating ?? 0),
      progress: progress || 0,
      media: transformedMedia
    };
  }

  // FIXED: New helper method to properly detect movies
  private isMovieType(mediaType?: string, mediaData?: unknown): boolean {
    // First check the requested mediaType
    if (mediaType) {
      const upperType = String(mediaType).toUpperCase();
      if (upperType === 'MOVIE' || upperType === 'MOVIES') {
        return true;
      }
    }
    
    // Then check the media data itself
    if (mediaData) {
      const dataObj = mediaData as Record<string, unknown>;
      const type = String(dataObj.type || dataObj.kind || '').toLowerCase();
      return type === 'movie' || type === 'film' || type.includes('movie');
    }
    
    return false;
  }

  // =================== UPDATE METHODS (Following MAL pattern) ===================
  async updateMediaListEntry(mediaId: string | number, updates: SimklUpdateData, mediaType?: string): Promise<{ id: number | null; status: string | null; score: number; progress: number }> {
    try {  
      const typeUpper = (mediaType || '').toString().toUpperCase();
      const isMovieOrTv = typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper.includes('SHOW');
      if (updates && updates._zUseTmdbId === true && isMovieOrTv) {
        // Prefer explicit TMDb/IMDb ids for trending TMDb entries
        let imdb: string | undefined = undefined;
        try {
          const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' }) as { media?: { idImdb?: string; ids?: { imdb?: string } } };
          const media = cached?.media || cached || {};
          imdb = (media as { idImdb?: string; ids?: { imdb?: string } }).idImdb || (media as { ids?: { imdb?: string } }).ids?.imdb;
        } catch {
          // Silent fail for cache lookup
        }
        return await this.updateMediaListEntryWithIds({ tmdb: Number(mediaId), imdb }, updates, mediaType);
      }
      return await this.executeUpdate(mediaId, updates, mediaType);  
    } catch (error) {  
      throw this.createUserFriendlyError(error as Error);  
    }
  }

  /**
   * Update/create a Simkl list entry using explicit external identifiers (e.g., TMDb/IMDb).
   * This is primarily used for TMDb trending items (movies/TV) where we don't have Simkl IDs.
   */
  async updateMediaListEntryWithIds(
    identifiers: { tmdb?: number | string; imdb?: string; simkl?: number | string }, 
    updates: SimklUpdateData, 
    mediaType?: string
  ): Promise<{ id: number | null; status: string | null; score: number; progress: number }> {
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
          priority: 'high',
          type: 'update'
        });

        // Enforce via ratings if score not provided
        if (updates.score === undefined || updates.score === null) {
          const statusMapped = this.mapAniListStatusToSimkl(updates.status);
          // Do not send ratings for planning; ratings can imply "seen" on Simkl
          if (statusMapped && statusMapped !== 'plantowatch') {
            const statusToRating: Record<string, number> = { watching: 8, completed: 9, hold: 6, dropped: 3, plantowatch: 1 };
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
      }

      // Progress handling (movies only here; shows use watched_episodes in list payload already)
      if (updates.progress !== undefined) {
        if (isMovie) {
          const watched = (parseInt(String(updates.progress)) || 0) > 0;
          const containerKey = 'movies';
          const historyPayload: Record<string, Array<{ ids: Record<string, string | number> }>> = { [containerKey]: [{ ids: {} }] };
          const item = historyPayload[containerKey][0];
          if (identifiers?.tmdb) item.ids.tmdb = parseInt(String(identifiers.tmdb));
          if (!item.ids.tmdb && identifiers?.imdb) item.ids.imdb = String(identifiers.imdb);
          if (!item.ids.tmdb && !item.ids.imdb && identifiers?.simkl) item.ids.simkl = parseInt(String(identifiers.simkl));

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
      throw this.createUserFriendlyError(error as Error);
    }
  }

  private async executeUpdate(
    mediaId: string | number, 
    updates: SimklUpdateData, 
    mediaType?: string
  ): Promise<{ id: number | null; status: string | null; score: number; progress: number }> {
    const normalizedId = this.normalizeSimklId(mediaId);
    console.log('[Simkl][Update] executeUpdate', { rawId: mediaId, normalizedId, updates, mediaType });
    this.validateMediaId(normalizedId);
    this.validateUpdates(updates);

    await this.ensureValidToken();  
    console.log('[Simkl][Update] token ensured');

    const typeUpper = (mediaType || '').toString().toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';

    // Get existing entry for context (TODO: implement proper existing entry lookup)
    const existing: { progress?: number; media?: { episodes?: number } } | null = null;

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
        // Do not send ratings for planning; ratings can imply "seen" on Simkl
        if (statusMapped && statusMapped !== 'plantowatch') {  
          const statusToRating: Record<string, number> = { watching: 8, completed: 9, hold: 6, dropped: 3, plantowatch: 1 };  
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
      }  
      
      // If marking a show as completed without progress, push remaining episodes to history  
      if (!isMovie && String(updates.status).toUpperCase() === 'COMPLETED' && updates.progress === undefined) {  
        try {  
          let prevProgress = 0;  
          let totalEpisodes = 0;  
          prevProgress = Math.max(0, parseInt(String(existing?.progress || 0)) || 0);  
          // Try to detect total episodes from existing media data  
          const media = existing?.media;  
          totalEpisodes = Math.max(0, parseInt(String(media?.episodes || 0)) || 0);  
          if (!totalEpisodes) {  
            const single = await this.fetchSimklData({ type: 'single', mediaType, mediaId: normalizedId, nocache: true }) as SimklSingleResponse;  
            totalEpisodes = Math.max(0, parseInt(String(single?.MediaList?.media?.episodes || 0)) || 0);  
          }  
          if (totalEpisodes && totalEpisodes > prevProgress) {  
            const episodes: Array<{ number: number }> = [];  
            for (let i = prevProgress + 1; i <= totalEpisodes && episodes.length < 1000; i++) episodes.push({ number: i });  
            if (episodes.length) {  
              const payload = { shows: [{ ids: { simkl: parseInt(String(normalizedId)) }, episodes }] };  
              await this.makeRequest({  
                url: `${this.baseUrl}/sync/history`,  
                method: 'POST',  
                headers: this.getHeaders({ type: 'update' }),  
                body: JSON.stringify(payload),  
                priority: 'high'  
              });  
            }  
          }  
        } catch {
          // Silent fail for episode completion
        }  
      }  
    }  

    // 2) Score -> ratings  
    if (updates.score !== undefined && updates.score !== null) {  
      const rating = Math.max(0, Math.min(10, Math.round(updates.score)));  
      if (rating > 0) {  
        const ratingsPayload = this.buildUpdatePayload(normalizedId, { score: rating }, mediaType);  
        console.log('[Simkl][Update] ratings payload', ratingsPayload);  
        await this.makeRequest({  
          url: `${this.baseUrl}/sync/ratings`,  
          method: 'POST',  
          headers: this.getHeaders({ type: 'update' }),  
          body: JSON.stringify(ratingsPayload),  
          priority: 'high'  
        });  
        
        // Mirror ratings under 'shows' for anime as a fallback  
        if (!isMovie && typeUpper === 'ANIME') {  
          const mirrorRatings = this.buildUpdatePayload(normalizedId, { score: rating }, mediaType, 'shows');  
          await this.makeRequest({  
            url: `${this.baseUrl}/sync/ratings`,  
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
        const watched = (parseInt(String(updates.progress)) || 0) > 0;  
        const containerKey = 'movies';  
        const historyPayload: Record<string, Array<{ ids: { simkl: number } }>> = { [containerKey]: [{ ids: { simkl: parseInt(String(normalizedId)) } }] };  
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
          prevProgress = Math.max(0, parseInt(String(existing?.progress || 0)) || 0);  
          totalEpisodes = Math.max(0, parseInt(String(existing?.media?.episodes || 0)) || 0);  
          const raw = (existing as { media?: { _rawData?: Record<string, unknown> } })?.media?._rawData || {};  
          const airedCandidates = [
            (raw as { aired_episodes_count?: unknown }).aired_episodes_count, 
            (raw as { aired_episodes?: unknown }).aired_episodes, 
            ((raw as { show?: Record<string, unknown> }).show?.aired_episodes_count), 
            ((raw as { show?: Record<string, unknown> }).show?.aired_episodes)
          ];  
          for (const cand of airedCandidates) {  
            const n = Number(cand);  
            if (Number.isFinite(n) && n > 0) { airedEpisodes = n; break; }  
          }  
        } catch {
          // Silent fail for episode data lookup
        }  
        const requestedProgress = Math.max(0, parseInt(String(updates.progress)) || 0);  
        // Cap increases to the number of aired (or known total) episodes to match Simkl behavior  
        const cap = Math.max(0, (airedEpisodes || totalEpisodes || requestedProgress));  
        if (requestedProgress !== prevProgress) {  
          let from: number, to: number, remove: boolean;  
          if (requestedProgress > prevProgress) {  
            remove = false;  
            from = prevProgress + 1;  
            to = Math.min(requestedProgress, cap);  
          } else {  
            remove = true;  
            from = requestedProgress + 1;  
            to = prevProgress;  
          }  
          const episodes: Array<{ number: number }> = [];  
          for (let i = from; i <= to && episodes.length < 1000; i++) episodes.push({ number: i });  
          if (episodes.length > 0) {  
            const payload = { shows: [{ ids: { simkl: parseInt(String(normalizedId)) }, episodes }] };  
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

  private buildUpdatePayload(
    mediaId: number, 
    updates: SimklUpdateData, 
    mediaType?: string, 
    forceContainerKey?: string
  ): Record<string, Array<Record<string, unknown>>> { 
    console.log('[Simkl][Update] buildUpdatePayload', { mediaId, updates, mediaType, forceContainerKey });
    const typeUpper = (mediaType || '').toString().toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';

    // Simkl expects container 'shows' for anime/TV and 'movies' for movies  
    const containerKey = forceContainerKey || (isMovie ? 'movies' : 'shows');  
    const payload: Record<string, Array<Record<string, unknown>>> = { [containerKey]: [{ ids: {} }] };  

    const item = payload[containerKey][0];  
    item.type = isMovie ? 'movie' : 'show';  
    
    // Prefer TMDb/IMDb if present in cache
    try {
      const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' }) as { media?: { idTmdb?: number; ids?: { tmdb?: number }; idImdb?: string } };
      const media = cached?.media || cached || {};
      const tmdb = (media as { idTmdb?: number; ids?: { tmdb?: number } }).idTmdb || (media as { ids?: { tmdb?: number } }).ids?.tmdb;
      const imdb = (media as { idImdb?: string; ids?: { imdb?: string } }).idImdb || (media as { ids?: { imdb?: string } }).ids?.imdb;
      if (tmdb) (item.ids as Record<string, number>).tmdb = parseInt(String(tmdb));
      if (imdb) (item.ids as Record<string, string>).imdb = imdb;
    } catch {
      // Silent fail for cache lookup
    }
    
    if (!(item.ids as Record<string, unknown>).tmdb && !(item.ids as Record<string, unknown>).imdb) {
      const typeUpperLocal = typeUpper; // retain computed
      const shouldUseTmdbFallback = (updates?._zUseTmdbId === true) && (isMovie || typeUpperLocal === 'TV' || typeUpperLocal.includes('SHOW'));
      if (shouldUseTmdbFallback) {
        (item.ids as Record<string, number>).tmdb = parseInt(String(mediaId));
      } else {
        (item.ids as Record<string, number>).simkl = parseInt(String(mediaId));
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
      const prog = parseInt(String(updates.progress)) || 0;  
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
        item.watched = (parseInt(String(updates.progress)) || 0) > 0;  
      } else {  
        const prog = parseInt(String(updates.progress)) || 0;  
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
      const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' }) as { media?: { idImdb?: string; idMal?: number; title?: SimklTitleObject } };  
      const media = cached?.media || cached;  
      if ((media as { idImdb?: string })?.idImdb) {  
        (item.ids as Record<string, string>).imdb = (media as { idImdb: string }).idImdb;  
      }  
      if ((media as { idMal?: number })?.idMal) {  
        (item.ids as Record<string, number>).mal = (media as { idMal: number }).idMal;  
      }  
      const title = (media as { title?: SimklTitleObject })?.title?.english || 
                   (media as { title?: SimklTitleObject })?.title?.romaji || 
                   (media as { title?: SimklTitleObject })?.title?.native;  
      if (title) {  
        item.title = title;  
      }  
      console.log('[Simkl][Update] enriched item after cache', JSON.parse(JSON.stringify(item)));  
    } catch (e) { 
      console.log('[Simkl][Update] cache enrich failed', e); 
    }  

    console.log('[Simkl][Update] final payload', JSON.parse(JSON.stringify(payload)));  
    return payload;
  }

  // Build payload using explicit identifiers, bypassing cache lookup
  private buildUpdatePayloadFromIdentifiers(
    identifiers: { tmdb?: number | string; imdb?: string; simkl?: number | string }, 
    updates: SimklUpdateData, 
    mediaType?: string, 
    forceContainerKey?: string
  ): Record<string, Array<Record<string, unknown>>> {
    const typeUpper = (mediaType || '').toString().toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';
    const containerKey = forceContainerKey || (isMovie ? 'movies' : 'shows');
    const payload: Record<string, Array<Record<string, unknown>>> = { [containerKey]: [{ ids: {} }] };

    const item = payload[containerKey][0];
    item.type = isMovie ? 'movie' : 'show';

    const tmdb = identifiers?.tmdb;
    const imdb = identifiers?.imdb;
    const simkl = identifiers?.simkl;
    if (tmdb) (item.ids as Record<string, number>).tmdb = parseInt(String(tmdb));
    if (!((item.ids as Record<string, unknown>).tmdb) && imdb) (item.ids as Record<string, string>).imdb = String(imdb);
    if (!((item.ids as Record<string, unknown>).tmdb) && !((item.ids as Record<string, unknown>).imdb) && simkl) (item.ids as Record<string, number>).simkl = parseInt(String(simkl));

    // Try to enrich with metadata from cache (title/mal/imdb stabilization)
    try {
      const cached = this.cache?.get(String(tmdb || simkl), { scope: 'mediaData' }) as { media?: { idImdb?: string; idMal?: number; title?: SimklTitleObject } } ||
        this.cache?.get(String(simkl || tmdb), { scope: 'mediaData' }) as { media?: { idImdb?: string; idMal?: number; title?: SimklTitleObject } };
      const media = cached?.media || cached || {};
      if (!((item.ids as Record<string, unknown>).imdb) && (media as { idImdb?: string }).idImdb) (item.ids as Record<string, string>).imdb = (media as { idImdb: string }).idImdb;
      if ((media as { idMal?: number }).idMal) (item.ids as Record<string, number>).mal = (media as { idMal: number }).idMal;
      const title = (media as { title?: SimklTitleObject })?.title?.english || 
                   (media as { title?: SimklTitleObject })?.title?.romaji || 
                   (media as { title?: SimklTitleObject })?.title?.native;
      if (title) item.title = title;
    } catch {
      // Silent fail for cache enrichment
    }

    // Status
    if (updates.status !== undefined) {
      const validatedStatus = this.validateAndConvertStatus(updates.status, mediaType);
      item.to = validatedStatus;
    } else if (!isMovie && updates.progress !== undefined) {
      const prog = parseInt(String(updates.progress)) || 0;
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
        item.watched = (parseInt(String(updates.progress)) || 0) > 0;
      } else {
        const prog = parseInt(String(updates.progress)) || 0;
        item.watched_episodes = prog;
        if (item.to === undefined) item.to = prog > 0 ? 'watching' : 'plantowatch';
      }
    }

    return payload;
  }

  // Build minimal payload for remove operations (only container and IDs)
  private buildRemovePayload(
    mediaId: number, 
    mediaType?: string, 
    forceContainerKey?: string
  ): Record<string, Array<Record<string, unknown>>> {
    console.log('[Simkl][Remove] buildRemovePayload', { mediaId, mediaType, forceContainerKey });
    const typeUpper = (mediaType || '').toString().toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';

    // Simkl expects container 'shows' for anime/TV and 'movies' for movies  
    const containerKey = forceContainerKey || (isMovie ? 'movies' : 'shows');  
    const payload: Record<string, Array<Record<string, unknown>>> = { [containerKey]: [{ ids: {} }] };  

    // Try to enrich with TMDb/IMDb from cache; fallback to simkl id
    try {  
      const cached = this.cache?.get(String(mediaId), { scope: 'mediaData' }) as { media?: { idTmdb?: number; ids?: { tmdb?: number }; idImdb?: string; title?: SimklTitleObject } };  
      const media = cached?.media || cached || {};  
      const item = payload[containerKey][0];
      const tmdb = (media as { idTmdb?: number; ids?: { tmdb?: number } }).idTmdb || (media as { ids?: { tmdb?: number } }).ids?.tmdb;  
      const imdb = (media as { idImdb?: string; ids?: { imdb?: string } }).idImdb || (media as { ids?: { imdb?: string } }).ids?.imdb;  
      if (tmdb) (item.ids as Record<string, number>).tmdb = parseInt(String(tmdb));  
      if (imdb) (item.ids as Record<string, string>).imdb = imdb;  
      // Add title for better server-side matching
      const title = (media as { title?: SimklTitleObject })?.title?.english || 
                   (media as { title?: SimklTitleObject })?.title?.romaji || 
                   (media as { title?: SimklTitleObject })?.title?.native;  
      if (title) {  
        item.title = title;  
      }  
    } catch (e) { 
      console.log('[Simkl][Remove] cache enrich failed', e); 
    }
    
    if (!((payload[containerKey][0].ids as Record<string, unknown>).tmdb) && 
        !((payload[containerKey][0].ids as Record<string, unknown>).imdb)) {
      (payload[containerKey][0].ids as Record<string, number>).simkl = parseInt(String(mediaId));
    }

    console.log('[Simkl][Remove] minimal payload', JSON.parse(JSON.stringify(payload)));  
    return payload;
  }

  // Remove media from user's Simkl list
  async removeMediaListEntry(mediaId: string | number, mediaType?: string): Promise<void> {
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
      throw this.createUserFriendlyError(error as Error);  
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

  async makeObsidianRequest(code: string, redirectUri: string): Promise<SimklAuthResponse> {
    const body = {
      grant_type: 'authorization_code',
      client_id: this.plugin.settings.simklClientId!,
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

      const response = await this.requestQueue.add(requestFn, { priority: 'high', service: 'simkl', metadata: { type: 'auth' } }) as { json?: unknown };
      
      if (!response?.json || typeof response.json !== 'object') {
        throw new Error('Invalid auth response from Simkl');
      }

      if (!isSimklAuthResponse(response.json)) {
        throw new Error('Invalid auth response structure from Simkl');
      }

      if (response.json.error) {
        throw new Error(response.json.error_description || response.json.error);
      }

      console.log('[Simkl] Authentication successful');
      return response.json;

    } catch (error) {
      console.error('[Simkl] Authentication failed:', (error as Error).message);
      throw new Error(`Simkl authentication failed: ${(error as Error).message}`);
    }
  }

  private async ensureValidToken(): Promise<boolean> {
    if (!this.plugin.settings.simklAccessToken) {
      throw new Error('Authentication required');
    }
    
    // TODO: Implement token refresh logic if needed
    return true;
  }

  // =================== MAPPING FUNCTIONS (Fixed) ===================

  private mapAniListStatusToSimkl(status: string): string {
    return this.aniListToSimklStatus[status] || status?.toLowerCase();
  }

  private mapSimklStatusToAniList(status: string): string {
    return this.simklToAniListStatus[status] || status?.toUpperCase();
  }

  // Validate and convert status based on media type
  private validateAndConvertStatus(status: string, mediaType?: string): string {
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
  getValidStatusesForMediaType(mediaType?: string): string[] {
    const typeUpper = String(mediaType || '').toUpperCase();
    const isMovie = typeUpper === 'MOVIE' || typeUpper === 'MOVIES';
    
    if (isMovie) {
      return this.validMovieStatuses;
    } else {
      return this.validShowStatuses;
    }
  }

  // Get valid AniList statuses for a specific media type
  getValidAniListStatusesForMediaType(mediaType?: string): string[] {
    const simklStatuses = this.getValidStatusesForMediaType(mediaType);
    return simklStatuses.map(status => this.simklToAniListStatus[status]).filter(Boolean);
  }

  // Check if a status is valid for a specific media type
  isStatusValidForMediaType(status: string, mediaType?: string): boolean {
    const validStatuses = this.getValidStatusesForMediaType(mediaType);
    return validStatuses.includes(status);
  }

  // Check if an AniList status is valid for a specific media type
  isAniListStatusValidForMediaType(aniListStatus: string, mediaType?: string): boolean {
    const simklStatus = this.mapAniListStatusToSimkl(aniListStatus);
    return this.isStatusValidForMediaType(simklStatus, mediaType);
  }

  // Get status conversion info for user feedback
  getStatusConversionInfo(aniListStatus: string, mediaType?: string): {
    original: string;
    converted: string;
    reason: string | null;
    note: string | null;
  } {
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
  getDefaultStatusForMediaType(mediaType?: string): string {
    return 'plantowatch'; // Always default to planning for new entries
  }

  // Get default AniList status for a media type
  getDefaultAniListStatusForMediaType(mediaType?: string): string {
    const defaultSimklStatus = this.getDefaultStatusForMediaType(mediaType);
    return this.simklToAniListStatus[defaultSimklStatus];
  }

  // FIXED: Enhanced format mapping with mediaType context
  private mapSimklFormat(type: string, mediaType?: string): string {
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
    
    const formatMap: Record<string, string> = {
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

  private parseDate(dateString: string): SimklDate | null {
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

  private validateConfig(config: SimklApiConfig): SimklApiConfig {
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

  private normalizeSimklId(mediaId: string | number): number {
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

  private validateMediaId(mediaId: number): void {
    if (!mediaId || mediaId <= 0) {
      throw new Error(`Invalid media ID: ${mediaId}`);
    }
  }

  private validateUpdates(updates: SimklUpdateData): void {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates must be an object');
    }
    
    if (Object.keys(updates).length === 0) {
      throw new Error('At least one field must be updated');
    }
  }

  private requiresAuth(requestType: string): boolean {
    // Only search requests don't require authentication
    return requestType !== 'search';
  }

  // =================== CACHE & URL METHODS ===================

  private createCacheKey(config: SimklApiConfig): string {
    const sortedConfig: Record<string, unknown> = {};
    Object.keys(config).sort().forEach(key => {
      if (key !== 'accessToken' && key !== 'clientSecret') {
        sortedConfig[key] = (config as Record<string, unknown>)[key];
      }
    });
    return JSON.stringify(sortedConfig);
  }

  private getCacheScope(requestType: string): string {
    const scopeMap: Record<string, string> = {
      'stats': 'userData',
      'single': 'mediaData',
      'search': 'searchResults',
      'list': 'userData'
    };
    return scopeMap[requestType] || 'userData';
  }

  private buildFullUrl(baseUrl: string, params: Record<string, string>): string {
    if (!params || Object.keys(params).length === 0) return baseUrl;
    const queryString = new URLSearchParams(params).toString();
    return `${baseUrl}?${queryString}`;
  }

  getSimklUrl(mediaId: string | number, mediaType = 'ANIME'): string {
    try {
      this.validateMediaId(this.normalizeSimklId(mediaId));
      const typeUpper = (mediaType || 'ANIME').toString().toUpperCase();
      
      let segment = 'tv'; // default
      if (typeUpper === 'ANIME') {
        segment = 'anime';
      } else if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper.includes('MOVIE')) {
        segment = 'movies';
      }
      
      return `https://simkl.com/${segment}/${this.normalizeSimklId(mediaId)}`;
    } catch (error) {
      throw error;
    }
  }

  // =================== ERROR HANDLING (Simplified from original) ===================

  private createUserFriendlyError(error: Error): Error {
    const errorMessages: Record<string, string> = {
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
    const friendlyError = new Error(userMessage) as Error & { type?: string; originalMessage?: string };
    friendlyError.type = errorType;
    friendlyError.originalMessage = error.message;
    
    return friendlyError;
  }

  // =================== COMPATIBILITY METHODS (Following MAL pattern) ===================

  async fetchSimklStats(config: SimklApiConfig): Promise<SimklStatsResponse> {
    return this.fetchSimklData({ ...config, type: 'stats' }) as Promise<SimklStatsResponse>;
  }

  async fetchSimklList(config: SimklApiConfig): Promise<SimklSearchResponse | SimklSingleResponse | SimklListResponse | SimklStatsResponse> {
    return this.fetchSimklData(config);
  }

  async searchSimklMedia(config: SimklApiConfig): Promise<SimklSearchResponse> {
    const searchResults = await this.fetchSimklData({ ...config, type: 'search' }) as SimklSearchResponse;
    
    // Ensure search results have proper IDs for editing operations
    if (config.ensureIds !== false) { // Default to true unless explicitly disabled
      return await this.ensureSearchResultIds(searchResults, config.mediaType);
    }
    
    return searchResults;
  }

  getMetrics(): SimklApiMetrics {
    return { ...this.metrics };
  }

  // Fetch entries for computing distributions
  private async fetchUserListEntries(mediaType = 'ANIME'): Promise<SimklListEntry[]> {
    const resp = await this.fetchSimklData({ type: 'list', mediaType }) as SimklListResponse;
    const entries = resp?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return entries;
  }

  // Compute distributions from entries (replicated from MAL logic for parity)
  private aggregateDistributionsFromEntries(entries: SimklListEntry[], typeLower: string): {
    statuses: Array<{ status: string; count: number }>;
    scores: Array<{ score: number; count: number }>;
    formats: Array<{ format: string; count: number }>;
    releaseYears: Array<{ releaseYear: number; count: number }>;
    genres: string[];
  } {
    const result = {
      statuses: [] as Array<{ status: string; count: number }>,
      scores: [] as Array<{ score: number; count: number }>,
      formats: [] as Array<{ format: string; count: number }>,
      releaseYears: [] as Array<{ releaseYear: number; count: number }>,
      genres: [] as string[]
    };
  
    const statusCounts = new Map<string, number>();
    const scoreCounts = new Map<number, number>();
    const formatCounts = new Map<string, number>();
    const yearCounts = new Map<number, number>();
    const genreSet = new Set<string>();
  
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

  private async attachSimklDistributions(user: SimklUser): Promise<void> {
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
      const applyFallbacks = (entries: SimklListEntry[], statsObj?: SimklUser['statistics']['anime']) => {
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
      // Silent fail for distributions
    }
  }

  // =================== MEDIA TYPE DETECTION (Following MAL pattern) ===================

  async getMediaType(mediaId: string | number): Promise<string> {
    // For Simkl, we need to determine if it's anime, TV, or movie
    // Since we don't have a direct way to detect this from ID alone,
    // we'll need to search across different types or use context
    return 'anime'; // Default fallback
  }
}

export { SimklApi };
