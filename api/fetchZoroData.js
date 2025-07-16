export async function fetchZoroData(config) {
  const cacheKey = JSON.stringify(config);
  let cacheType;

  // Determine cache type based on request
  if (config.type === 'stats') {
    cacheType = 'userData';
  } else if (config.type === 'single') {
    cacheType = 'mediaData';
  } else if (config.type === 'search') {
    cacheType = 'searchResults';
  } else {
    cacheType = 'userData'; // Default for lists
  }

  const cached = getFromCache.bind(this)(cacheType, cacheKey);
  if (cached) return cached;

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    let query, variables;
     try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
if (this.settings.accessToken) {
  await this.ensureValidToken();
  
  headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
}

    if (config.type === 'stats') {
      query = this.getUserStatsQuery();
      variables = { username: config.username };
    } else if (config.type === 'single') {
      query = this.getSingleMediaQuery();
      variables = {
        username: config.username,
        mediaId: parseInt(config.mediaId),
        type: config.mediaType
      };
    } else if (config.type === 'search') {
      query = this.getSearchMediaQuery(config.layout);
      variables = {
        search: config.search,
        type: config.mediaType,
        page: config.page || 1,
        perPage: config.perPage || 20
      };
    } else {
      query = this.getMediaListQuery();
      variables = {
        username: config.username,
        status: config.listType,
        type: config.mediaType || 'ANIME'
      };
    }

   

      if (this.settings.accessToken) {
        headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
      }
      // Rate limit add
      const response = await this.requestQueue.add(() => requestUrl({
  url: 'https://graphql.anilist.co',

        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables })
      }));

      const result = response.json;

      if (!result) throw new Error('Empty response from AniList.');

      if (result.errors && result.errors.length > 0) {
        const firstError = result.errors[0];
        const isPrivate = firstError.message?.includes('Private') || firstError.message?.includes('permission');

        if (isPrivate) {
          if (this.settings.accessToken) {
            throw new Error('🚫 List is private and this token has no permission.');
          } else {
            throw new Error('🔒 List is private. Please authenticate to access it.');
          }
        }

        throw new Error(firstError.message || 'AniList returned an unknown error.');
      }

      if (!result.data) {
        throw new Error('AniList returned no data.');
      }

       // Save to cache
  this.setToCache(cacheType, cacheKey, result.data);
  return result.data;
    


    } catch (error) {
      console.error('[Zoro] fetchZoroData() failed:', error);
      throw error;
    }
  }
