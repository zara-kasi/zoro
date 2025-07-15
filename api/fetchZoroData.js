// Improved Fetch Zoro Data Function

class ZoroDataFetcher {
  constructor(plugin) {
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.requestQueue = plugin.requestQueue;
    this.cacheManager = plugin.cacheManager;
  }

  // Main data fetching method
  async fetchZoroData(config) {
    // Validate config
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config provided');
    }

    const cacheKey = this.generateCacheKey(config);
    const cacheType = this.determineCacheType(config);

    // Check cache first
    const cached = this.cacheManager.getFromCache(cacheType, cacheKey);
    if (cached) {
      console.log(`[Zoro] Cache hit for ${cacheType}:`, cacheKey);
      return cached;
    }

    console.log(`[Zoro] Cache miss for ${cacheType}:`, cacheKey);

    try {
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      // Add authorization if token exists
      if (this.settings.accessToken) {
        const isValid = await this.plugin.authManager.ensureValidToken();
        if (isValid) {
          headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
        }
      }

      // Build query and variables
      const { query, variables } = this.buildQueryAndVariables(config);

      // Make the API request
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables })
      }));

      // Process response
      const result = await this.processResponse(response, config);

      // Cache the result
      this.cacheManager.setToCache(cacheType, cacheKey, result);

      return result;

    } catch (error) {
      console.error('[Zoro] fetchZoroData() failed:', error);
      throw error;
    }
  }

  // Generate cache key from config
  generateCacheKey(config) {
    // Create a consistent cache key by sorting object keys
    const sortedConfig = Object.keys(config)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = config[key];
        return sorted;
      }, {});
    
    return JSON.stringify(sortedConfig);
  }

  // Determine cache type based on request
  determineCacheType(config) {
    switch (config.type) {
      case 'stats':
        return 'userData';
      case 'single':
        return 'mediaData';
      case 'search':
        return 'searchResults';
      default:
        return 'userData'; // Default for lists
    }
  }

  // Build GraphQL query and variables
  buildQueryAndVariables(config) {
    let query, variables;

    switch (config.type) {
      case 'stats':
        if (!config.username) {
          throw new Error('Username is required for stats request');
        }
        query = this.getUserStatsQuery();
        variables = { username: config.username };
        break;

      case 'single':
        if (!config.username || !config.mediaId) {
          throw new Error('Username and mediaId are required for single media request');
        }
        query = this.getSingleMediaQuery();
        variables = {
          username: config.username,
          mediaId: parseInt(config.mediaId),
          type: config.mediaType || 'ANIME'
        };
        break;

      case 'search':
        if (!config.search) {
          throw new Error('Search term is required for search request');
        }
        query = this.getSearchMediaQuery(config.layout);
        variables = {
          search: config.search,
          type: config.mediaType || 'ANIME',
          page: config.page || 1,
          perPage: config.perPage || 20
        };
        break;

      default:
        // Default to media list
        if (!config.username) {
          throw new Error('Username is required for list request');
        }
        query = this.getMediaListQuery();
        variables = {
          username: config.username,
          status: config.listType,
          type: config.mediaType || 'ANIME'
        };
        break;
    }

    return { query, variables };
  }

  // Process API response
  async processResponse(response, config) {
    if (!response) {
      throw new Error('No response received from AniList');
    }

    const result = response.json;

    if (!result) {
      throw new Error('Empty response from AniList');
    }

    // Handle GraphQL errors
    if (result.errors && result.errors.length > 0) {
      const firstError = result.errors[0];
      const errorMessage = firstError.message || 'Unknown GraphQL error';

      // Check for private list errors
      const isPrivate = errorMessage.includes('Private') || 
                       errorMessage.includes('permission') ||
                       errorMessage.includes('private');

      if (isPrivate) {
        if (this.settings.accessToken) {
          throw new Error('🚫 This list is private and your token doesn\'t have permission to access it.');
        } else {
          throw new Error('🔒 This list is private. Please authenticate to access it.');
        }
      }

      // Check for rate limiting
      if (errorMessage.includes('rate') || errorMessage.includes('limit')) {
        throw new Error('⏰ Rate limit exceeded. Please wait a moment and try again.');
      }

      // Check for invalid user
      if (errorMessage.includes('User not found') || errorMessage.includes('Invalid user')) {
        throw new Error(`👤 User "${config.username}" not found on AniList.`);
      }

      throw new Error(`AniList Error: ${errorMessage}`);
    }

    // Ensure we have data
    if (!result.data) {
      throw new Error('AniList returned no data');
    }

    console.log(`[Zoro] Successfully fetched ${config.type} data`);
    return result.data;
  }

  // Wrapper method with loading indicator
  async fetchDataWithLoader(config) {
    this.showLoader();
    try {
      return await this.fetchZoroData(config);
    } catch (error) {
      console.error('[Zoro] Data fetch failed:', error);
      throw error;
    } finally {
      this.hideLoader();
    }
  }

  // Show loading indicator
  showLoader() {
    // Implementation depends on your UI
    console.log('[Zoro] Loading...');
    // You might want to show a loading spinner or disable UI elements
  }

  // Hide loading indicator
  hideLoader() {
    // Implementation depends on your UI
    console.log('[Zoro] Loading complete');
    // You might want to hide the loading spinner or re-enable UI elements
  }

  // Utility method to clear cache for specific type
  clearCacheForType(type) {
    const cacheType = this.determineCacheType({ type });
    this.cacheManager.clearCache(cacheType);
  }

  // Utility method to get cache stats
  getCacheStats() {
    return this.cacheManager.getCacheStats();
  }

  // Method to prefetch commonly used data
  async prefetchUserData(username) {
    if (!username) return;

    try {
      // Prefetch user stats
      await this.fetchZoroData({
        type: 'stats',
        username: username
      });

      // Prefetch current watching list
      await this.fetchZoroData({
        type: 'list',
        username: username,
        listType: 'CURRENT',
        mediaType: 'ANIME'
      });

      console.log(`[Zoro] Prefetched data for user: ${username}`);
    } catch (error) {
      console.warn(`[Zoro] Failed to prefetch data for user: ${username}`, error);
    }
  }

  // You'll need to implement these query methods based on your existing code
  getUserStatsQuery() {
    // Return your user stats GraphQL query
    throw new Error('getUserStatsQuery() not implemented');
  }

  getSingleMediaQuery() {
    // Return your single media GraphQL query
    throw new Error('getSingleMediaQuery() not implemented');
  }

  getSearchMediaQuery(layout) {
    // Return your search media GraphQL query
    throw new Error('getSearchMediaQuery() not implemented');
  }

  getMediaListQuery() {
    // Return your media list GraphQL query
    throw new Error('getMediaListQuery() not implemented');
  }
}