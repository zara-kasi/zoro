class AnilistApi {
  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue;
    this.cache = plugin.cache;
    
    // Basic configuration - removed enterprise features
    this.config = {
      maxRetries: 3,
      baseRetryDelay: 1000,
      maxRetryDelay: 10000,
      requestTimeout: 30000
    };
  }

  // =================== CORE REQUEST METHODS ===================

  createCacheKey(config) {
    const sortedConfig = {};
    Object.keys(config).sort().forEach(key => {
      if (key === 'accessToken' || key === 'clientSecret') return;
      sortedConfig[key] = config[key];
    });
    return JSON.stringify(sortedConfig);
  }

  async fetchAniListData(config) {
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
      
      // Build query and variables
      const { query, variables } = this.buildQuery(config);
      
      // Execute request
      const result = await this.executeRequestWithRetry({
        query,
        variables,
        config,
        requestId,
        maxRetries: this.config.maxRetries
      });
      
      // Cache successful results
      if (result && !config.nocache) {
        this.cache.set(cacheKey, result, { scope: cacheType });
      }
      
      const duration = performance.now() - startTime;
      this.log('REQUEST_SUCCESS', config.type, requestId, `${duration.toFixed(1)}ms`);
      
      return result;
      
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

  async executeRequestWithRetry({ query, variables, config, requestId, maxRetries }) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.makeRawRequest({
          query,
          variables,
          config,
          requestId,
          attempt
        });
        
        if (attempt > 1) {
          this.log('RETRY_SUCCESS', config.type, requestId, `Attempt ${attempt}/${maxRetries}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries || !this.isRetryableError(error)) {
          throw error;
        }
        
        const delay = this.calculateRetryDelay(attempt);
        this.log('RETRY_ATTEMPT', config.type, requestId, 
          `Attempt ${attempt}/${maxRetries}, retrying in ${delay}ms: ${error.message}`);
        
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  async makeRawRequest({ query, variables, config, requestId, attempt = 1, skipAuth = false }) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `Zoro-Plugin/${this.plugin.manifest.version}`,
      'X-Request-ID': requestId
    };
    
    if (!skipAuth && this.plugin.settings.accessToken) {
      await this.plugin.auth.ensureValidToken();
      headers['Authorization'] = `Bearer ${this.plugin.settings.accessToken}`;
    }
    
    const requestBody = JSON.stringify({ query, variables });
    
    try {
      const response = await Promise.race([
        this.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers,
          body: requestBody
        })),
        this.createTimeoutPromise(this.config.requestTimeout)
      ]);
      
      const result = response.json;
      this.validateResponse(result);
      
      if (result.errors && result.errors.length > 0) {
        throw this.createGraphQLError(result.errors[0]);
      }
      
      if (!result.data) {
        throw new Error('AniList returned no data');
      }
      
      return result.data;
      
    } catch (error) {
      throw error;
    }
  }

  // =================== UPDATE METHOD ===================

  async updateMediaListEntry(mediaId, updates) {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      this.validateMediaId(mediaId);
      this.validateUpdates(updates);
      
      if (!this.plugin.settings.accessToken || !(await this.plugin.auth.ensureValidToken())) {
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
      
      const variables = {
        mediaId: parseInt(mediaId),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.score !== undefined && updates.score !== null && { score: parseFloat(updates.score) }),
        ...(updates.progress !== undefined && { progress: parseInt(updates.progress) }),
      };
      
      const result = await this.executeRequestWithRetry({
        query: mutation,
        variables,
        config: { type: 'update', mediaId },
        requestId,
        maxRetries: 2
      });

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

  createZoroError(classifiedError) {
    const errorMessages = {
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
    
    const error = new Error(classifiedError.message);
    error.type = classifiedError.type;
    error.severity = classifiedError.severity;
    error.retryable = classifiedError.retryable;
    error.userMessage = userMessage;
    
    return error;
  }

  createGraphQLError(graphqlError) {
    const error = new Error(graphqlError.message);
    error.type = 'GRAPHQL_ERROR';
    error.extensions = graphqlError.extensions;
    error.locations = graphqlError.locations;
    error.path = graphqlError.path;
    return error;
  }

  // =================== VALIDATION & UTILITY METHODS ===================

  validateConfig(config) {
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
      throw new Error('Invalid response from AniList');
    }
  }

  isRetryableError(error) {
    return error.retryable !== false && (
      error.status >= 500 ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.name === 'TimeoutError' ||
      error.status === 429
    );
  }

  calculateRetryDelay(attempt) {
    const baseDelay = this.config.baseRetryDelay;
    const maxDelay = this.config.maxRetryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  createTimeoutPromise(timeout) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Request timeout'));
      }, timeout);
    });
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
        const username = await this.plugin.auth.getAuthenticatedUsername();
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
        client_id: this.plugin.settings.clientId,
        client_secret: this.plugin.settings.clientSecret || '',
        redirect_uri: redirectUri,
        code: code
      });

      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': `Zoro-Plugin/${this.plugin.manifest.version}`,
        'X-Request-ID': requestId
      };

      const result = await this.executeRequestWithRetry({
        makeRequest: () => requestUrl({
          url: 'https://anilist.co/api/v2/oauth/token',
          method: 'POST',
          headers,
          body: body.toString()
        }),
        config: { type: 'auth' },
        requestId,
        maxRetries: 2
      });

      if (!result || typeof result.json !== 'object') {
        throw new Error('Invalid response structure from AniList');
      }

      const duration = performance.now() - startTime;
      this.log('AUTH_SUCCESS', 'oauth', requestId, `${duration.toFixed(1)}ms`);

      return result.json;

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


  getAniListUrl(mediaId, mediaType = 'ANIME') {
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
        error: error.message
      });
      throw error;
    }
  }

  // =================== QUERY BUILDERS ===================

  buildQuery(config) {
    let query, variables;
    
    if (config.type === 'stats') {
      query = this.getUserStatsQuery({
        mediaType: config.mediaType || 'ANIME',
        layout: config.layout || 'standard'
      });
      variables = { username: config.username };
    } else if (config.type === 'single') {
      query = this.getSingleMediaQuery(config.layout);
      variables = {
        mediaId: parseInt(config.mediaId),
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
  getMediaListQuery(layout = 'card') {
    const baseFields = `
      id
      status
      score
      progress
    `;

    const mediaFields = {
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

  getSingleMediaQuery(layout = 'card') {
    const mediaFields = {
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
  } = {}) {
    const typeKey = mediaType.toLowerCase();

    const statFields = {
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

  getSearchMediaQuery(layout = 'card') {
    const mediaFields = {
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

  log(level, category, requestId, data = '') {
    if (level === 'ERROR') {
      const timestamp = new Date().toISOString();
      const logData = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
      console.log(`[${timestamp}] [Zoro-API] [${level}] [${category}] [${requestId}] ${logData}`);
    }
  }
}
export { AnilistApi };