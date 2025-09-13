/**
 * AnilistApi
 * Migrated from AnilistApi.js → AnilistApi.ts
 * - Added comprehensive TypeScript interfaces for all data structures
 * - Converted ES module imports/exports
 * - Added type guards for API responses
 * - Typed all method parameters and return values
 */

import { Notice, requestUrl } from 'obsidian';
import type { Plugin } from 'obsidian';
import { ZoroError } from '../../core/ZoroError';

// =================== TYPE DEFINITIONS ===================

interface AnilistApiConfig {
  maxRetries: number;
  baseRetryDelay: number;
  maxRetryDelay: number;
  requestTimeout: number;
}

interface RequestConfig {
  type?: 'stats' | 'single' | 'search' | 'list';
  mediaType?: 'ANIME' | 'MANGA';
  username?: string;
  mediaId?: string | number;
  search?: string;
  page?: number;
  perPage?: number;
  listType?: string;
  layout?: 'compact' | 'card' | 'full' | 'standard' | 'minimal' | 'detailed';
  nocache?: boolean;
  priority?: 'low' | 'normal' | 'high';
  accessToken?: string;
  clientSecret?: string;
  useViewer?: boolean;
}

interface CacheOptions {
  scope: string;
  source: string;
  ttl?: number | null;
}

interface MediaListUpdates {
  status?: string;
  score?: number | null;
  progress?: number;
}

interface ClassifiedError {
  type: string;
  message: string;
  severity: 'error' | 'warn' | 'info';
  retryable: boolean;
}

interface RequestParams {
  query: string;
  variables: Record<string, unknown>;
  config: RequestConfig;
  requestId: string;
  priority?: 'low' | 'normal' | 'high';
  timeout: number;
  retries: number;
  metadata: Record<string, unknown>;
  service: string;
}

interface GraphQLError {
  message: string;
  extensions?: Record<string, unknown>;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
}

interface AniListResponse {
  data?: Record<string, unknown>;
  errors?: GraphQLError[];
}

interface MediaListEntry {
  id: number;
  status: string;
  score: number;
  progress: number;
  updatedAt: number;
  media: {
    id: number;
    idMal: number;
    title: { romaji: string; english: string };
  };
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface QueryResult {
  query: string;
  variables: Record<string, unknown>;
}

// Type guard functions
function assertIsAniListResponse(value: unknown): asserts value is AniListResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid AniList response structure');
  }
}

function assertIsOAuthResponse(value: unknown): asserts value is OAuthTokenResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid OAuth response structure');
  }
  const response = value as Record<string, unknown>;
  if (typeof response.access_token !== 'string') {
    throw new Error('OAuth response missing access_token');
  }
}

export class AnilistApi {
  private plugin: Plugin;
  private requestQueue: any; // TODO: type when RequestQueue is migrated
  private cache: any; // TODO: type when Cache is migrated
  private config: AnilistApiConfig;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.requestQueue = (plugin as any).requestQueue;
    this.cache = (plugin as any).cache;
    
    // Basic configuration - removed enterprise features
    this.config = {
      maxRetries: 3,
      baseRetryDelay: 1000,
      maxRetryDelay: 10000,
      requestTimeout: 30000
    };
  }

  // =================== CORE REQUEST METHODS ===================

  createCacheKey(config: RequestConfig): string {
    const sortedConfig: Record<string, unknown> = {};
    Object.keys(config).sort().forEach(key => {
      if (key === 'accessToken' || key === 'clientSecret') return;
      sortedConfig[key] = (config as any)[key];
    });
    return JSON.stringify(sortedConfig);
  }

  async fetchAniListData(config: RequestConfig): Promise<unknown> {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      // Config validation and normalization
      this.validateConfig(config);
      
      // Check cache first with proper source parameter
      const cacheKey = this.createCacheKey(config);
      const cacheType = this.determineCacheType(config);
      
      if (!config.nocache) {
        const cached = this.cache.get(cacheKey, { 
          scope: cacheType,
          source: 'anilist',
          ttl: this.getCacheTTL(config)
        });
        
        if (cached) {
          this.log('CACHE_HIT', cacheType, requestId, `${(performance.now() - startTime).toFixed(1)}ms`);
          return cached;
        }
      }
      
      // Build query and variables
      const { query, variables } = this.buildQuery(config);
      
      // Request execution through upgraded makeRawRequest
      const requestParams: RequestParams = {
        query,
        variables,
        config,
        requestId,
        priority: config.priority || 'normal',
        timeout: this.config.requestTimeout,
        retries: this.config.maxRetries,
        metadata: { type: config.type, mediaType: config.mediaType, requestId },
        service: 'anilist'
      };
      
      const result = await this.makeRawRequest(requestParams);
      
      // Cache successful results with proper source parameter
      if (result && !config.nocache) {
        this.cache.set(cacheKey, result, { 
          scope: cacheType,
          source: 'anilist'
        });
      }
      
      const duration = performance.now() - startTime;
      this.log('REQUEST_SUCCESS', config.type || 'unknown', requestId, `${duration.toFixed(1)}ms`);
      
      return result;
      
    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, config);
      
      this.log('REQUEST_FAILED', config.type || 'unknown', requestId, {
        error: classifiedError.type,
        message: classifiedError.message,
        duration: `${duration.toFixed(1)}ms`
      });
      
      throw this.createZoroError(classifiedError);
    }
  }

  async makeRawRequest({ query, variables, config, requestId, priority = 'normal', timeout, retries, metadata, service }: RequestParams): Promise<unknown> {
    // Create requestFn that wraps the actual requestUrl call
    const requestFn = async (): Promise<unknown> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': `Zoro-Plugin/${(this.plugin as any).manifest.version}`,
        'X-Request-ID': requestId
      };
      
      if ((this.plugin as any).settings.accessToken) {
        await (this.plugin as any).auth.ensureValidToken();
        headers['Authorization'] = `Bearer ${(this.plugin as any).settings.accessToken}`;
      }
      
      const requestBody = JSON.stringify({ query, variables });
      
      // Direct requestUrl call
      const response = await requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers,
        body: requestBody
      });
      
      // Response validation inside makeRawRequest
      this.validateResponse(response.json);
      
      if (response.json.errors && response.json.errors.length > 0) {
        throw this.createGraphQLError(response.json.errors[0]);
      }
      
      if (!response.json.data) {
        throw new Error('AniList returned no data');
      }
      
      return response.json.data;
    };

    // Pass requestFn to requestQueue.add() with proper service metadata
    try {
      return await this.requestQueue.add(requestFn, {
        priority,
        timeout,
        retries,
        metadata,
        service
      });
    } catch (error) {
      // Error classification handled here
      throw error;
    }
  }

  // =================== UPDATE METHOD ===================

  async updateMediaListEntry(mediaId: string | number, updates: MediaListUpdates): Promise<MediaListEntry> {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      this.validateMediaId(mediaId);
      this.validateUpdates(updates);
      
      if (!(this.plugin as any).settings.accessToken || !(await (this.plugin as any).auth.ensureValidToken())) {
        throw new Error('Authentication required to update entries');
      }

      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
            id
            status
            score
            progress
            updatedAt
            media {
              id
              idMal
              title { romaji english }
            }
          }
        }
      `;
      
      const variables: Record<string, unknown> = {
        mediaId: parseInt(String(mediaId)),
      };
      
      if (updates.status !== undefined) variables.status = updates.status;
      if (updates.score !== undefined && updates.score !== null) variables.score = parseFloat(String(updates.score));
      if (updates.progress !== undefined) variables.progress = parseInt(String(updates.progress));
      
      // Use upgraded makeRawRequest following Simkl pattern
      const requestParams: RequestParams = {
        query: mutation,
        variables,
        config: { type: 'update' as const, mediaId },
        requestId,
        priority: 'high',
        timeout: this.config.requestTimeout,
        retries: 2,
        metadata: { type: 'update', mediaId, requestId },
        service: 'anilist'
      };
      
      const result = await this.makeRawRequest(requestParams) as { SaveMediaListEntry: MediaListEntry };

      await this.invalidateRelatedCache(mediaId, updates);
      
      const duration = performance.now() - startTime;
      this.log('UPDATE_SUCCESS', 'mutation', requestId, {
        mediaId,
        updates: Object.keys(updates),
        duration: `${duration.toFixed(1)}ms`
      });
      
      return result.SaveMediaListEntry;

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

  // =================== ERROR HANDLING ===================

  classifyError(error: any, context: RequestConfig = {}): ClassifiedError {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return { type: 'NETWORK_ERROR', message: error.message, severity: 'error', retryable: true };
    }
    
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return { type: 'TIMEOUT', message: error.message, severity: 'warn', retryable: true };
    }
    
    if (error.status === 429 || error.message.includes('rate limit')) {
      return { type: 'RATE_LIMITED', message: error.message, severity: 'warn', retryable: true };
    }
    
    if (error.status === 401 || error.message.includes('Unauthorized')) {
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

  createZoroError(classifiedError: ClassifiedError): Error {
    const errorMessages: Record<string, string> = {
      'NETWORK_ERROR': 'Connection issue. Please check your internet connection and try again.',
      'TIMEOUT': 'Request timed out. Please try again.',
      'RATE_LIMITED': 'Too many requests. Please wait a moment and try again.',
      'AUTH_ERROR': 'Authentication expired. Please re-authenticate with AniList.',
      'SERVER_ERROR': 'AniList servers are experiencing issues. Please try again later.',
      'PRIVATE_LIST': 'This user\'s list is private.',
      'CLIENT_ERROR': 'Invalid request. Please check your input.',
      'UNKNOWN_ERROR': 'An unexpected error occurred. Please try again.'
    };
    
    const userMessage = errorMessages[classifiedError.type] || errorMessages['UNKNOWN_ERROR'];
    
    // Use ZoroError.notify for user feedback and create a proper Error object
    ZoroError.notify(userMessage, classifiedError.severity);
    
    const error = new Error(classifiedError.message) as any;
    error.type = classifiedError.type;
    error.severity = classifiedError.severity;
    error.retryable = classifiedError.retryable;
    error.userMessage = userMessage;
    
    return error;
  }

  createGraphQLError(graphqlError: GraphQLError): Error {
    const error = new Error(graphqlError.message) as any;
    error.type = 'GRAPHQL_ERROR';
    error.extensions = graphqlError.extensions;
    error.locations = graphqlError.locations;
    error.path = graphqlError.path;
    return error;
  }

  // =================== VALIDATION & UTILITY METHODS ===================

  validateConfig(config: RequestConfig): void {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }
    
    if (config.type && !['stats', 'single', 'search', 'list'].includes(config.type)) {
      throw new Error(`Invalid config type: ${config.type}`);
    }
    
    if (config.mediaType && !['ANIME', 'MANGA'].includes(config.mediaType)) {
      throw new Error(`Invalid media type: ${config.mediaType}`);
    }
  }

  validateMediaId(mediaId: string | number): void {
    const id = parseInt(String(mediaId));
    if (!id || id <= 0) {
      throw new Error(`Invalid media ID: ${mediaId}`);
    }
  }

  validateUpdates(updates: MediaListUpdates): void {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates must be an object');
    }
    
    if (Object.keys(updates).length === 0) {
      throw new Error('At least one field must be updated');
    }
  }

  validateResponse(response: unknown): void {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from AniList');
    }
  }

  isRetryableError(error: any): boolean {
    return error.retryable !== false && (
      error.status >= 500 ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.name === 'TimeoutError' ||
      error.status === 429
    );
  }

  calculateRetryDelay(attempt: number): number {
    const baseDelay = this.config.baseRetryDelay;
    const maxDelay = this.config.maxRetryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Request timeout'));
      }, timeout);
    });
  }

  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =================== CACHE MANAGEMENT ===================

  determineCacheType(config: RequestConfig): string {
    const typeMap: Record<string, string> = {
      'stats': 'userData',
      'single': 'mediaData',
      'search': 'searchResults',
      'list': 'userData'
    };
    return typeMap[config.type || ''] || 'userData';
  }

  getCacheTTL(config: RequestConfig): null {
    return null; // Use cache's built-in TTL system
  }

  async invalidateRelatedCache(mediaId: string | number, updates: MediaListUpdates): Promise<void> {
    this.cache.invalidateByMedia(mediaId, { source: 'anilist' });
    
    if (updates.status) {
      try {
        const username = await (this.plugin as any).auth.getAuthenticatedUsername();
        if (username) {
          this.cache.invalidateByUser(username, { source: 'anilist' });
        }
      } catch (error) {
        // Ignore errors getting username for cache invalidation
      }
    }
  }

  // =================== OAUTH METHOD ===================

  async makeObsidianRequest(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
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
        client_id: (this.plugin as any).settings.clientId,
        client_secret: (this.plugin as any).settings.clientSecret || '',
        redirect_uri: redirectUri,
        code: code
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': `Zoro-Plugin/${(this.plugin as any).manifest.version}`,
        'X-Request-ID': requestId
      };

      const result = await requestUrl({
        url: 'https://anilist.co/api/v2/oauth/token',
        method: 'POST',
        headers,
        body: body.toString()
      });

      if (!result || typeof result.json !== 'object') {
        throw new Error('Invalid response structure from AniList');
      }

      assertIsOAuthResponse(result.json);

      const duration = performance.now() - startTime;
      this.log('AUTH_SUCCESS', 'oauth', requestId, `${duration.toFixed(1)}ms`);

      return result.json;

    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, { type: 'auth' as const });
      
      this.log('AUTH_FAILED', 'oauth', requestId, {
        error: classifiedError.type,
        duration: `${duration.toFixed(1)}ms`
      });

      throw this.createZoroError(classifiedError);
    }
  }

  getAniListUrl(mediaId: string | number, mediaType: string = 'ANIME'): string {
    try {
      this.validateMediaId(mediaId);
      
      const type = String(mediaType).toUpperCase();
      const validTypes = ['ANIME', 'MANGA'];
      const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime';

      return `https://anilist.co/${urlType}/${mediaId}`;
    } catch (error) {
      this.log('URL_GENERATION_FAILED', 'utility', this.generateRequestId(), {
        mediaId,
        mediaType,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // =================== QUERY BUILDERS ===================

  buildQuery(config: RequestConfig): QueryResult {
    let query: string;
    let variables: Record<string, unknown>;
    
    if (config.type === 'stats') {
      query = this.getUserStatsQuery({
        mediaType: config.mediaType || 'ANIME',
        layout: config.layout || 'standard',
        useViewer: config.useViewer
      });
      variables = { username: config.username };
    } else if (config.type === 'single') {
      query = this.getSingleMediaQuery(config.layout);
      variables = {
        mediaId: parseInt(String(config.mediaId)),
        type: config.mediaType
      };
    } else if (config.type === 'search') {
      query = this.getSearchMediaQuery(config.layout);
      variables = {
        search: config.search,
        type: config.mediaType,
        page: config.page || 1,
        perPage: Math.min(config.perPage || 10, 50),
      };
    } else {
      query = this.getMediaListQuery(config.layout);
      variables = {
        username: config.username,
        status: config.listType,
        type: config.mediaType || 'ANIME',
      };
    }
    
    return { query, variables };
  }

  getMediaListQuery(layout: string = 'card'): string {
    const baseFields = `
      id
      status
      score
      progress
    `;

    const mediaFields: Record<string, string> = {
      compact: `
        id
        idMal
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        format
        averageScore
        status
        genres
        episodes
        chapters
        isFavourite
      `,
      full: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        isFavourite
        description(asHtml: false)
        meanScore
        popularity
        favourites
        studios {
          nodes {
            name
          }
        }
      `
    };

    const fields = mediaFields[layout] || mediaFields.card;

    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType) {
        MediaListCollection(userName: $username, status: $status, type: $type) {
          lists {
            entries {
              ${baseFields}
              media {
                ${fields}
              }
            }
          }
        }
      }
    `;
  }

  getSingleMediaQuery(layout: string = 'card'): string {
    const mediaFields: Record<string, string> = {
      compact: `
        id
        idMal
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        format
        averageScore
        status
        genres
        episodes
        chapters
        isFavourite
      `,
      full: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        isFavourite
        description(asHtml: false)
        meanScore
        popularity
        favourites
        studios {
          nodes {
            name
          }
        }
      `
    };

    const selectedMediaFields = mediaFields[layout] || mediaFields.card;

    return `
      query ($mediaId: Int, $type: MediaType) {
        Media(id: $mediaId, type: $type) {
          ${selectedMediaFields}
        }
      }
    `;
  }

  getUserStatsQuery({ 
    mediaType = 'ANIME', 
    layout = 'standard',
    useViewer = false
  }: {
    mediaType?: string;
    layout?: string;
    useViewer?: boolean;
  } = {}): string {
    const typeKey = mediaType.toLowerCase();

    const statFields: Record<string, string> = {
      minimal: `
        count
        meanScore
        minutesWatched
        episodesWatched
        chaptersRead
      `,
      standard: `
        count
        meanScore
        standardDeviation
        episodesWatched
        minutesWatched
        chaptersRead
        volumesRead
        scores {
          score
          count
        }
        statuses {
          status
          count
        }
        formats {
          format
          count
        }
        releaseYears {
          releaseYear
          count
        }
      `,
      detailed: `
        count
        meanScore
        standardDeviation
        episodesWatched
        minutesWatched
        chaptersRead
        volumesRead
        scores {
          score
          count
        }
        statuses {
          status
          count
        }
        formats {
          format
          count
        }
        releaseYears {
          releaseYear
          count
        }
        startYears {
          startYear
          count
        }
        genres {
          genre
          count
          meanScore
          minutesWatched
        }
      `
    };

    const selectedFields = statFields[layout] || statFields.standard;
    const viewerPrefix = useViewer ? 'Viewer' : `User(name: $username)`;

    return `
      query ($username: String) {
        ${viewerPrefix} {
          id
          name
          avatar {
            large
            medium
          }
          statistics {
            ${typeKey} {
              ${selectedFields}
            }
          }
          favourites {
            ${typeKey} {
              nodes {
                id
                idMal
                title {
                  romaji
                  english
                }
                coverImage {
                  medium
                  large
                }
                meanScore
                ${mediaType === 'ANIME' ? 'episodes' : 'chapters'}
                format
              }
            }
          }
          mediaListOptions {
            scoreFormat
          }
        }
      }
    `;
  }

  getSearchMediaQuery(layout: string = 'card'): string {
    const mediaFields: Record<string, string> = {
      compact: `
        id
        idMal
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        format
        averageScore
        status
        genres
        episodes
        chapters
        isFavourite
      `,
      full: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        isFavourite
        description(asHtml: false)
        meanScore
        popularity
        favourites
      `
    };

    const fields = mediaFields[layout] || mediaFields.card;

    return `
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(search: $search, type: $type) {
            ${fields}
          }
        }
      }
    `;
  }

  // =================== LOGGING ===================

  log(level: string, category: string, requestId: string, data: any = ''): void {
    if (level === 'ERROR') {
      const timestamp = new Date().toISOString();
      const logData = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
      console.log(`[${timestamp}] [Zoro-API] [${level}] [${category}] [${requestId}] ${logData}`);
    }
  }
}
