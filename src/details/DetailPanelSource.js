const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

class DetailPanelSource {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async convertMalToAnilistId(malId, malType) {
    const cacheKey = this.plugin.cache.structuredKey('conversion', 'mal_to_anilist', `${malId}_${malType || 'unknown'}`);
    const cached = this.plugin.cache.get(cacheKey, { scope: 'mediaData', source: 'anilist' });
    if (cached) return cached;

    const anilistType = this.convertMalTypeToAnilistType(malType);
    let result = null;
    if (!anilistType) {
      for (const tryType of ['ANIME', 'MANGA']) {
        result = await this.tryConvertWithType(malId, tryType);
        if (result) break;
      }
    } else {
      result = await this.tryConvertWithType(malId, anilistType);
    }

    if (result) {
      this.plugin.cache.set(cacheKey, result, {
        scope: 'mediaData',
        source: 'anilist',
        ttl: 30 * 24 * 60 * 60 * 1000,
        tags: ['conversion', 'mal_to_anilist']
      });
    }
    return result;
  }

  async tryConvertWithType(malId, anilistType) {
    const query = `query($idMal: Int, $type: MediaType) { Media(idMal: $idMal, type: $type) { id type } }`;
    const variables = { idMal: malId, type: anilistType };

    try {
      let response;
      if (this.plugin.fetchAniListData) {
        response = await this.plugin.fetchAniListData(query, variables);
      } else {
        const apiResponse = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables })
        });
        response = await apiResponse.json();
      }
      const anilistId = response?.data?.Media?.id;
      const anilistTypeResult = response?.data?.Media?.type;
      if (anilistId) return { id: anilistId, type: anilistTypeResult };
      return null;
    } catch {
      return null;
    }
  }

  convertMalTypeToAnilistType(malType) {
    if (!malType) return null;
    const normalizedType = malType.toString().toLowerCase();
    const typeMap = {
      'anime': 'ANIME', 'tv': 'ANIME', 'movie': 'ANIME', 'ova': 'ANIME', 'ona': 'ANIME', 'special': 'ANIME', 'music': 'ANIME',
      'manga': 'MANGA', 'manhwa': 'MANGA', 'manhua': 'MANGA', 'novel': 'MANGA', 'light_novel': 'MANGA', 'one_shot': 'MANGA'
    };
    return typeMap[normalizedType] || null;
  }

  shouldFetchDetailedData(media) {
    const missingBasicData = !media.description || !media.genres || !media.averageScore;
    const isAnimeWithoutAiring = media.type === 'ANIME' && !media.nextAiringEpisode;
    return missingBasicData || isAnimeWithoutAiring;
  }

  extractSourceFromEntry(entry) {
    return entry?._zoroMeta?.source || this.plugin.settings.defaultApiSource || 'anilist';
  }

  extractMediaTypeFromEntry(entry) {
    return entry?._zoroMeta?.mediaType || entry?.media?.type || null;
  }

  async fetchDetailedData(mediaId, entryOrSource = null, mediaType = null) {
    let source, resolvedMediaType;
    if (typeof entryOrSource === 'object' && entryOrSource !== null) {
      source = this.extractSourceFromEntry(entryOrSource);
      resolvedMediaType = this.extractMediaTypeFromEntry(entryOrSource);
    } else if (typeof entryOrSource === 'string') {
      source = entryOrSource;
      resolvedMediaType = mediaType;
    } else {
      source = this.plugin.settings.defaultApiSource || 'anilist';
      resolvedMediaType = mediaType;
    }

    let targetId = mediaId;
    let originalMalId = null;

    if (source === 'mal') {
      originalMalId = mediaId;
      const conversionResult = await this.convertMalToAnilistId(mediaId, resolvedMediaType);
      if (!conversionResult || !conversionResult.id) {
        throw new Error(`Could not convert MAL ID ${mediaId} to AniList ID`);
      }
      targetId = conversionResult.id;
    } else if (source === 'simkl' && resolvedMediaType === 'ANIME') {
      // For Simkl anime entries, use the exact same mechanism as MAL entries
      if (typeof entryOrSource === 'object' && entryOrSource?.media?.idMal) {
        originalMalId = entryOrSource.media.idMal;
        const conversionResult = await this.convertMalToAnilistId(entryOrSource.media.idMal, resolvedMediaType);
        if (!conversionResult || !conversionResult.id) {
          throw new Error(`Could not convert MAL ID ${entryOrSource.media.idMal} to AniList ID for Simkl anime`);
        }
        targetId = conversionResult.id;
              } else {
          // If no MAL ID found, just return null without showing annoying notice
          return null;
        }
    } else if (source === 'simkl' && (resolvedMediaType === 'MOVIE' || resolvedMediaType === 'TV')) {
      // For Simkl movies and TV shows, fetch detailed data from Simkl API
      if (typeof entryOrSource === 'object' && entryOrSource?.media?.id) {
        const detailedSimklData = await this.fetchSimklDetailedData(entryOrSource.media.id, resolvedMediaType);
        if (detailedSimklData) {
          // Merge the detailed data with the original media data
          return {
            ...entryOrSource.media,
            ...detailedSimklData,
            // Ensure we keep the original ID and other essential fields
            id: entryOrSource.media.id,
            idImdb: entryOrSource.media.idImdb || detailedSimklData.ids?.imdb || null,
            idTmdb: entryOrSource.media.idTmdb || detailedSimklData.ids?.tmdb || null,
            // Map Simkl overview to description
            description: detailedSimklData.overview || entryOrSource.media.overview || null,
            // Simkl does not provide airing data in their API
            nextAiringEpisode: null
          };
        }
        // Fallback to original media data if detailed fetch fails
        return entryOrSource.media;
              } else {
          return null;
        }
    }

    const stableCacheKey = this.plugin.cache.structuredKey('details', 'stable', targetId);
    const dynamicCacheKey = this.plugin.cache.structuredKey('details', 'airing', targetId);

    let stableData = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'anilist' });
    let airingData = this.plugin.cache.get(dynamicCacheKey, { scope: 'mediaDetails', source: 'anilist' });

    if (stableData && (stableData.type !== 'ANIME' || airingData)) {
      const combinedData = { ...stableData };
      if (airingData?.nextAiringEpisode) combinedData.nextAiringEpisode = airingData.nextAiringEpisode;
      return combinedData;
    }

    const query = this.getDetailedMediaQuery();
    const variables = { id: targetId };

    let response;
    if (this.plugin.fetchAniListData) {
      response = await this.plugin.fetchAniListData(query, variables);
    } else {
      const apiResponse = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables })
      });
      response = await apiResponse.json();
    }

    if (!response?.data?.Media) throw new Error('No media data received');
    const data = response.data.Media;
    if (originalMalId) data.originalMalId = originalMalId;

    const { nextAiringEpisode, ...stableDataOnly } = data;
    this.plugin.cache.set(stableCacheKey, stableDataOnly, { scope: 'mediaDetails', source: 'anilist', tags: ['details', 'stable', data.type?.toLowerCase()] });
    if (data.type === 'ANIME' && nextAiringEpisode) {
      this.plugin.cache.set(dynamicCacheKey, { nextAiringEpisode }, { scope: 'mediaDetails', source: 'anilist', tags: ['details', 'airing', 'anime'] });
    }
    return data;
  }

  async fetchMALData(malId, mediaType) {
    if (!malId) return null;
    
    // Use stable/dynamic caching system like AniList
    const stableCacheKey = this.plugin.cache.structuredKey('mal', 'stable', `${malId}_${mediaType}`);
    const dynamicCacheKey = this.plugin.cache.structuredKey('mal', 'airing', `${malId}_${mediaType}`);
    
    let stableData = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'mal' });
    let airingData = this.plugin.cache.get(dynamicCacheKey, { scope: 'mediaDetails', source: 'mal' });
    
    if (stableData) {
      const combinedData = { ...stableData };
      if (airingData?.nextAiringEpisode) combinedData.nextAiringEpisode = airingData.nextAiringEpisode;
      return combinedData;
    }

    try {
      const type = mediaType === 'MANGA' ? 'manga' : 'anime';
      const response = await fetch(`https://api.jikan.moe/v4/${type}/${malId}`);
      if (!response.ok) throw new Error(`Jikan API error: ${response.status}`);
      const data = (await response.json())?.data;
      
      if (data) {
        // Separate stable and dynamic data
        const { nextAiringEpisode, ...stableDataOnly } = data;
        
        // Cache stable data using cache class TTL
        this.plugin.cache.set(stableCacheKey, stableDataOnly, { 
          scope: 'mediaDetails', 
          source: 'mal', 
          tags: ['mal', 'details', 'stable', type] 
        });
        
        // Cache airing data using cache class TTL
        if (nextAiringEpisode) {
          this.plugin.cache.set(dynamicCacheKey, { nextAiringEpisode }, { 
            scope: 'mediaDetails', 
            source: 'mal', 
            tags: ['mal', 'details', 'airing', type] 
          });
        }
        
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  async fetchSimklDetailedData(simklId, mediaType) {
    if (!simklId) return null;
    
    // Use stable caching system (Simkl doesn't have airing data)
    const stableCacheKey = this.plugin.cache.structuredKey('simkl', 'stable', `${simklId}_${mediaType}`);
    const cached = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'simkl' });
    if (cached) return cached;

    try {
      // Use correct Simkl API endpoints for detailed data
      const endpoint = mediaType === 'MOVIE' ? 'movies' : 'tv';
      const url = `https://api.simkl.com/${endpoint}/${simklId}?extended=full&client_id=${this.plugin.settings.simklClientId}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Simkl API error: ${response.status}`);
      const data = await response.json();
      
      if (data) {
        // Simkl does not provide airing data in their API
        // Remove any next_episode field if it exists (it shouldn't)
        if (data.next_episode) {
          delete data.next_episode;
        }
        
        // Cache stable data using cache class TTL
        this.plugin.cache.set(stableCacheKey, data, { 
          scope: 'mediaDetails', 
          source: 'simkl', 
          tags: ['simkl', 'details', 'stable', endpoint] 
        });
        
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }





  async fetchIMDBData(imdbId, mediaType, simklData = null) {
    if (!imdbId) return null;
    
    // First, check if Simkl already provides IMDB rating data
    if (simklData && simklData._rawData) {
      const rawData = simklData._rawData;
      // Check if Simkl provides IMDB rating data directly
      if (rawData.imdb_rating || rawData.imdb_score || rawData.imdb_votes) {
        const imdbData = {
          score: rawData.imdb_rating || rawData.imdb_score || null,
          scored_by: rawData.imdb_votes || null,
          rank: null,
          imdbID: imdbId
        };
        return imdbData;
      }
    }
    
    // Fallback to OMDB API if Simkl doesn't provide IMDB rating data
    const stableCacheKey = this.plugin.cache.structuredKey('imdb', 'stable', `${imdbId}_${mediaType}`);
    const cached = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'imdb' });
    if (cached) return cached;

    try {
      // Use OMDB API to get IMDB data (free and reliable)
      const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=fc1fef96`);
      if (!response.ok) throw new Error(`OMDB API error: ${response.status}`);
      const data = await response.json();
      
      if (data.Response === 'True') {
        // Transform OMDB data to match our expected format
        const transformedData = {
          score: parseFloat(data.imdbRating) || null,
          scored_by: data.imdbVotes ? parseInt(data.imdbVotes.replace(/,/g, '')) : null,
          rank: null, // OMDB doesn't provide rank
          title: data.Title,
          year: data.Year,
          plot: data.Plot,
          director: data.Director,
          actors: data.Actors,
          genre: data.Genre,
          runtime: data.Runtime,
          awards: data.Awards,
          imdbID: data.imdbID
        };
        
        // Cache stable data using cache class TTL
        this.plugin.cache.set(stableCacheKey, transformedData, { 
          scope: 'mediaDetails', 
          source: 'imdb', 
          tags: ['imdb', 'details', 'stable'] 
        });
        
        return transformedData;
      }
      return null;
    } catch {
      return null;
    }
  }

  async fetchAndUpdateData(mediaId, entryOrSource = null, mediaTypeOrCallback = null, onUpdate = null) {
    let source, mediaType, callback;
    if (typeof entryOrSource === 'object' && entryOrSource !== null) {
      source = this.extractSourceFromEntry(entryOrSource);
      mediaType = this.extractMediaTypeFromEntry(entryOrSource);
      callback = mediaTypeOrCallback;
    } else if (typeof entryOrSource === 'string') {
      source = entryOrSource;
      if (typeof mediaTypeOrCallback === 'function') { mediaType = null; callback = mediaTypeOrCallback; }
      else { mediaType = mediaTypeOrCallback; callback = onUpdate; }
    } else {
      source = this.plugin.settings.defaultApiSource || 'anilist';
      mediaType = null;
      callback = mediaTypeOrCallback;
    }

    try {
      // Check for cached detail panel data first
      const detailPanelCacheKey = this.plugin.cache.structuredKey('detailPanel', 'combined', `${source}_${mediaId}_${mediaType}`);
      const cachedDetailPanel = this.plugin.cache.get(detailPanelCacheKey, { scope: 'mediaDetails', source: 'detailPanel' });
      
      if (cachedDetailPanel) {
        // Use cached data if available
        const { detailedMedia, malData, imdbData } = cachedDetailPanel;
        if (this.hasMoreData(detailedMedia)) callback(detailedMedia, null, null);
        if (malData) callback(detailedMedia, malData, null);
        if (imdbData) callback(detailedMedia, null, imdbData);
        return;
      }

      const detailedMedia = await this.fetchDetailedData(mediaId, entryOrSource, mediaType);
      
      // Handle case where fetchDetailedData returns null (e.g., Simkl anime without MAL ID)
      if (!detailedMedia) {
        return;
      }
      
      const malId = source === 'mal' ? (detailedMedia.originalMalId || mediaId) : detailedMedia.idMal;
      let malDataPromise = null;
      let imdbDataPromise = null;
      
      if (malId) malDataPromise = this.fetchMALData(malId, detailedMedia.type);
      
      // For Simkl movies/TV, fetch IMDB data
      if (source === 'simkl' && (mediaType === 'MOVIE' || mediaType === 'TV') && detailedMedia.idImdb) {
        imdbDataPromise = this.fetchIMDBData(detailedMedia.idImdb, detailedMedia.type, detailedMedia);
      }
      
      // Collect all data
      let malData = null;
      let imdbData = null;
      
      if (malDataPromise) {
        malData = await malDataPromise;
      }
      
      if (imdbDataPromise) {
        imdbData = await imdbDataPromise;
      }
      
      // Cache the combined detail panel data using cache class TTL
      const combinedData = { detailedMedia, malData, imdbData };
      this.plugin.cache.set(detailPanelCacheKey, combinedData, { 
        scope: 'mediaDetails', 
        source: 'detailPanel', 
        tags: ['detailPanel', 'combined', source, mediaType] 
      });
      
      // Call callbacks with data
      if (this.hasMoreData(detailedMedia)) callback(detailedMedia, null, null);
      if (malData) callback(detailedMedia, malData, null);
      if (imdbData) callback(detailedMedia, null, imdbData);
    } catch (error) {
      console.error('fetchAndUpdateData failed:', error);
    }
  }

  hasMoreData(newMedia) {
    const hasBasicData = newMedia.description || newMedia.genres?.length > 0 || newMedia.averageScore > 0;
    const hasAiringData = newMedia.type === 'ANIME' && newMedia.nextAiringEpisode;
    return hasBasicData || hasAiringData;
  }

  getDetailedMediaQuery() {
    return `query($id:Int){Media(id:$id){id type title{romaji english native}description(asHtml:false)format status season seasonYear averageScore genres nextAiringEpisode{airingAt episode timeUntilAiring}idMal}}`;
  }
}

export { DetailPanelSource };