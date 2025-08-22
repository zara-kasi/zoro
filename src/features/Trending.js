import { Notice } from 'obsidian';

class Trending {
  constructor(plugin) { 
    this.plugin = plugin; 
  }

  getTrendingCacheKey(source, mediaType, limit) {
    return this.plugin.cache.structuredKey('trending', 'trending', `${source}_${mediaType}_${limit}`);
  }

  async fetchAniListTrending(mediaType = 'ANIME', limit = 40) {
    const cacheKey = this.getTrendingCacheKey('anilist', mediaType, limit);
    
    const cached = this.plugin.cache.get(cacheKey, {
      scope: 'mediaData',
      source: 'anilist'
    });
    
    if (cached) {
      return cached;
    }

    const query = `
      query ($type: MediaType, $perPage: Int) {
        Page(page: 1, perPage: $perPage) {
          media(type: $type, sort: TRENDING_DESC) {
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
            genres
            episodes
            chapters
            status
            startDate {
              year
              month
              day
            }
          }
        }
      }
    `;

    const variables = {
      type: mediaType.toUpperCase(),
      perPage: limit
    };

    try {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Trending] AniList error response:', errorText);
        throw new Error(`AniList API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        console.error('[Trending] AniList GraphQL errors:', data.errors);
        throw new Error(`AniList GraphQL error: ${data.errors[0]?.message || 'Unknown error'}`);
      }

      if (!data.data?.Page?.media) {
        console.error('[Trending] No media data in response:', data);
        throw new Error('No trending data received from AniList');
      }

      const mediaList = data.data.Page.media.map(media => ({
        ...media,
        _zoroMeta: {
          source: 'anilist',
          mediaType: mediaType.toUpperCase(),
          fetchedAt: Date.now()
        }
      }));

      this.plugin.cache.set(cacheKey, mediaList, {
        scope: 'mediaData',
        source: 'anilist',
        ttl: 24 * 60 * 60 * 1000,
        tags: ['trending', mediaType.toLowerCase(), 'anilist']
      });

      return mediaList;

    } catch (error) {
      console.error('[Trending] AniList fetch failed:', error);
      
      const staleData = this.plugin.cache.get(cacheKey, {
        scope: 'mediaData',
        source: 'anilist',
        ttl: Infinity
      });
      
      if (staleData) {
        return staleData;
      }
      
      throw error;
    }
  }

  async fetchTMDbTrending(mediaType = 'MOVIE', limit = 40) {
    const tmdbApiKey = this.plugin.settings.tmdbApiKey;
    
    if (!tmdbApiKey) {
      console.error('[Trending] TMDb API key not configured');
      throw new Error('TMDb API key is required. Please add it in settings.');
    }

    const typeUpper = (mediaType || 'MOVIE').toUpperCase();
    const cacheKey = this.getTrendingCacheKey('tmdb', mediaType, limit);

    const cached = this.plugin.cache.get(cacheKey, {
      scope: 'mediaData'
    });
    
    if (cached) {
      return cached;
    }

    let endpoint;
    if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES') {
      endpoint = 'trending/movie/day';
    } else if (typeUpper === 'TV' || typeUpper === 'SHOW' || typeUpper === 'SHOWS') {
      endpoint = 'trending/tv/day';
    } else {
      console.log('[Trending] TMDb skipping anime request - should use AniList');
      return [];
    }

    const pages = Math.ceil(limit / 20);
    const allResults = [];

    try {
      for (let page = 1; page <= pages; page++) {
        const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${tmdbApiKey}&page=${page}`;
        
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Trending] TMDb error response:', errorText);
          throw new Error(`TMDb API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        if (!data.results || !Array.isArray(data.results)) {
          console.error('[Trending] Invalid TMDb response format:', data);
          throw new Error('Invalid response format from TMDb');
        }

        allResults.push(...data.results);
        
        if (allResults.length >= limit) break;
      }

      const mediaList = allResults
        .slice(0, limit)
        .map(item => this.transformTMDbMedia(item, mediaType))
        .filter(Boolean);

      try {
        const idsToFetch = mediaList.map(m => m.idTmdb).filter(Boolean).slice(0, 20);
        const fetches = idsToFetch.map(id => fetch(`https://api.themoviedb.org/3/${typeUpper.includes('MOVIE') ? 'movie' : 'tv'}/${id}/external_ids?api_key=${tmdbApiKey}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null));
        const results = await Promise.all(fetches);
        const tmdbToImdb = new Map();
        results.forEach((ext, idx) => {
          if (ext && (ext.imdb_id || ext.imdb)) {
            tmdbToImdb.set(idsToFetch[idx], ext.imdb_id || ext.imdb);
          }
        });
        mediaList.forEach(m => {
          const imdb = tmdbToImdb.get(m.idTmdb);
          if (imdb) {
            m.idImdb = imdb;
            if (!m.ids) m.ids = {};
            m.ids.imdb = imdb;
          }
        });
      } catch {}

      // Convert TMDb IDs to Simkl IDs for better integration
      try {
        if (this.plugin.simklApi && this.plugin.settings.simklClientId) {
          const simklConversions = await Promise.allSettled(
            mediaList.slice(0, 10).map(async (media) => {
              try {
                const conversion = await this.plugin.simklApi.convertTMDbToSimklId(
                  media.idTmdb, 
                  mediaType.toLowerCase()
                );
                if (conversion && conversion.simklId) {
                  return { media, conversion };
                }
                return null;
              } catch (error) {
                console.warn(`[Trending] Failed to convert TMDb ${media.idTmdb} to Simkl ID:`, error);
                return null;
              }
            })
          );

          // Apply successful conversions
          simklConversions.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
              const { media, conversion } = result.value;
              media.idSimkl = conversion.simklId;
              if (!media.ids) media.ids = {};
              media.ids.simkl = conversion.simklId;
              
              // Update the media ID to use Simkl ID for better integration
              if (conversion.simklId && conversion.simklId > 0) {
                media.id = conversion.simklId;
              }
            }
          });
        }
      } catch (error) {
        console.warn('[Trending] Simkl ID conversion failed:', error);
      }

      this.plugin.cache.set(cacheKey, mediaList, {
        scope: 'mediaData',
        ttl: 24 * 60 * 60 * 1000,
        tags: ['trending', mediaType.toLowerCase()]
      });

      return mediaList;

    } catch (error) {
      console.error('[Trending] TMDb fetch failed:', error);
      
      const staleData = this.plugin.cache.get(cacheKey, {
        scope: 'mediaData',
        ttl: Infinity
      });
      
      if (staleData) {
        return staleData;
      }
      
      throw error;
    }
  }

  transformTMDbMedia(item, mediaType) {
    try {
      const isMovie = mediaType.toUpperCase() === 'MOVIE' || mediaType.toUpperCase() === 'MOVIES';
      
      return {
        id: item.id,
        idTmdb: item.id,
        idImdb: null,
        idSimkl: null, // Will be populated later if conversion succeeds
        ids: {
          tmdb: item.id,
          imdb: null,
          simkl: null // Will be populated later if conversion succeeds
        },
        title: {
          english: isMovie ? item.title : item.name,
          romaji: null,
          native: null
        },
        coverImage: {
          large: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
          medium: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null
        },
        bannerImage: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        format: isMovie ? 'MOVIE' : 'TV',
        averageScore: item.vote_average ? Math.round(item.vote_average * 10) : null,
        popularity: item.popularity,
        genres: item.genre_ids || [],
        episodes: null,
        status: null,
        description: item.overview || null,
        startDate: {
          year: null,
          month: null,
          day: null
        },
        releaseDate: isMovie ? item.release_date : item.first_air_date,
        _zoroMeta: {
          mediaType: mediaType.toUpperCase(),
          fetchedAt: Date.now(),
          trending: {
            popularity: item.popularity,
            voteAverage: item.vote_average,
            voteCount: item.vote_count
          }
        }
      };
    } catch (error) {
      console.error('[Trending] Failed to transform TMDb item:', item, error);
      return null;
    }
  }

  async fetchJikanTrending(mediaType = 'anime', limit = 40) {
  const type = mediaType.toLowerCase();
  const cacheKey = this.getTrendingCacheKey('mal', mediaType, limit);
  
  const cached = this.plugin.cache.get(cacheKey, {
    scope: 'mediaData',
    source: 'mal'
  });
  
  if (cached) {
    return cached;
  }

  let url;
  let maxLimit = 25; // Jikan API limit for most endpoints
  
  if (type === 'manga') {
    // Use top manga by publishing (currently ongoing) for better trending
    url = `https://api.jikan.moe/v4/top/manga?filter=publishing&limit=${Math.min(limit, 25)}`;
  } else {
    // Back to original anime trending (airing filter)
    url = `https://api.jikan.moe/v4/top/${type}?filter=airing&limit=${Math.min(limit, 25)}`;
  }

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Trending] Jikan error response:', errorText);
      throw new Error(`Jikan API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    let items = [];
    
    if (type === 'manga') {
      // Handle regular top manga response (same as anime)
      const unique = [];
      const seen = new Set();
      
      (data.data || []).forEach(item => {
        if (!seen.has(item.mal_id)) {
          seen.add(item.mal_id);
          
          // Filter out finished manga - only keep ongoing/publishing manga
          const status = item.status?.toLowerCase() || '';
          const isFinished = status.includes('finished') || 
                           status.includes('completed') || 
                           status.includes('complete') ||
                           item.publishing === false; // Not currently publishing
          
          if (isFinished) {
            return; // Skip finished manga
          }
          
          unique.push({
            id: item.mal_id,
            malId: item.mal_id,
            title: {
              romaji: item.title || '',
              english: item.title_english || item.titles?.find(t => t.type === 'English')?.title || '',
              native: item.title_japanese || item.titles?.find(t => t.type === 'Japanese')?.title || ''
            },
            coverImage: {
              large: item.images?.jpg?.large_image_url || item.images?.webp?.large_image_url,
              medium: item.images?.jpg?.image_url || item.images?.webp?.image_url
            },
            format: item.type,
            averageScore: item.score ? Math.round(item.score * 10) : null,
            genres: item.genres?.map(g => g.name) || [],
            chapters: item.chapters,
            volumes: item.volumes,
            status: item.status,
            published: item.published ? {
              from: item.published.from,
              to: item.published.to
            } : null,
            publishing: item.publishing,
            serializations: item.serializations?.map(s => s.name) || [],
            authors: item.authors?.map(a => a.name) || [],
            themes: item.themes?.map(t => t.name) || [],
            demographics: item.demographics?.map(d => d.name) || [],
            popularity: item.popularity,
            members: item.members,
            favorites: item.favorites,
            _zoroMeta: {
              source: 'mal',
              mediaType: 'MANGA',
              fetchedAt: Date.now(),
              trendingMethod: 'publishing_ongoing',
              apiEndpoint: 'top/manga'
            }
          });
        }
      });
      
      items = unique.slice(0, limit);
    } else {
      // Handle regular top anime response
      const unique = [];
      const seen = new Set();
      
      (data.data || []).forEach(item => {
        if (!seen.has(item.mal_id)) {
          seen.add(item.mal_id);
          
          unique.push({
            id: item.mal_id,
            malId: item.mal_id,
            title: {
              romaji: item.title || '',
              english: item.title_english || item.titles?.find(t => t.type === 'English')?.title || '',
              native: item.title_japanese || item.titles?.find(t => t.type === 'Japanese')?.title || ''
            },
            coverImage: {
              large: item.images?.jpg?.large_image_url || item.images?.webp?.large_image_url,
              medium: item.images?.jpg?.image_url || item.images?.webp?.image_url
            },
            format: item.type,
            averageScore: item.score ? Math.round(item.score * 10) : null,
            genres: item.genres?.map(g => g.name) || [],
            episodes: item.episodes,
            status: item.status,
            popularity: item.popularity,
            members: item.members,
            favorites: item.favorites,
            _zoroMeta: {
              source: 'mal',
              mediaType: 'ANIME',
              fetchedAt: Date.now(),
              trendingMethod: 'airing',
              apiEndpoint: 'top/anime'
            }
          });
        }
      });
      
      items = unique.slice(0, limit);
    }

    this.plugin.cache.set(cacheKey, items, {
      scope: 'mediaData',
      source: 'mal',
      ttl: 24 * 60 * 60 * 1000,
      tags: ['trending', type, 'mal']
    });

    console.log(`[Trending] Jikan ${type} trending: ${items.length} items fetched using ${type === 'manga' ? 'recommendations' : 'airing'} method`);
    return items;

  } catch (error) {
    console.error('[Trending] Jikan fetch failed:', error);
    
    const staleData = this.plugin.cache.get(cacheKey, {
      scope: 'mediaData',
      source: 'mal',
      ttl: Infinity
    });
    
    if (staleData) {
      console.log('[Trending] Returning stale Jikan cache data');
      return staleData;
    }
    
    throw error;
  }
  }

  async fetchSimklTrending(mediaType = 'anime', limit = 40) {
    const cacheKey = this.getTrendingCacheKey('simkl', mediaType, limit);
    
    const cached = this.plugin.cache.get(cacheKey, {
      scope: 'mediaData',
      source: 'simkl'
    });
    
    if (cached) {
      return cached;
    }

    try {
      // Simkl doesn't have a native trending API, so we'll use their top content
      // For movies and TV shows, we'll use the top endpoints
      const type = mediaType.toLowerCase();
      let endpoint;
      
      if (type === 'movie' || type === 'movies') {
        endpoint = 'movies/top';
      } else if (type === 'tv' || type === 'show' || type === 'shows') {
        endpoint = 'tv/top';
      } else {
        // For anime, use the anime top endpoint
        endpoint = 'anime/top';
      }

      const url = `https://api.simkl.com/${endpoint}?extended=full&client_id=${this.plugin.settings.simklClientId}&limit=${limit}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Simkl API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        console.error('[Trending] Invalid Simkl response format:', data);
        return [];
      }

      const mediaList = data.slice(0, limit).map(item => ({
        id: item.ids?.simkl || item.id,
        idSimkl: item.ids?.simkl || item.id,
        idTmdb: item.ids?.tmdb || null,
        idImdb: item.ids?.imdb || null,
        ids: item.ids || {},
        title: {
          english: item.title || '',
          romaji: null,
          native: null
        },
        coverImage: {
          large: item.poster || null,
          medium: item.poster || null
        },
        format: type === 'movie' || type === 'movies' ? 'MOVIE' : (type === 'tv' || type === 'show' || type === 'shows' ? 'TV' : 'ANIME'),
        averageScore: item.rating ? Math.round(item.rating * 10) : null,
        genres: item.genres || [],
        episodes: item.total_episodes || null,
        status: null,
        description: item.overview || null,
        startDate: {
          year: item.year || null,
          month: null,
          day: null
        },
        _zoroMeta: {
          source: 'simkl',
          mediaType: type === 'movie' || type === 'movies' ? 'MOVIE' : (type === 'tv' || type === 'show' || type === 'shows' ? 'TV' : 'ANIME'),
          fetchedAt: Date.now()
        }
      }));

      this.plugin.cache.set(cacheKey, mediaList, {
        scope: 'mediaData',
        source: 'simkl',
        ttl: 24 * 60 * 60 * 1000,
        tags: ['trending', type, 'simkl']
      });

      return mediaList;

    } catch (error) {
      console.error('[Trending] Simkl fetch failed:', error);
      
      const staleData = this.plugin.cache.get(cacheKey, {
        scope: 'mediaData',
        source: 'simkl',
        ttl: Infinity
      });
      
      if (staleData) {
        return staleData;
      }
      
      throw error;
    }
  }

  async fetchTrending(source, mediaType, limit = 40) {
    const typeUpper = String(mediaType || '').toUpperCase();
    if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper === 'SHOW' || typeUpper === 'SHOWS') {
      return await this.fetchTMDbTrending(typeUpper.includes('MOVIE') ? 'MOVIE' : 'TV', limit);
    }

    switch ((source || '').toLowerCase()) {
      case 'mal':
        return await this.fetchJikanTrending(mediaType, limit);
      case 'simkl':
        return await this.fetchSimklTrending(mediaType, limit);
      case 'anilist':
      default:
        return await this.fetchAniListTrending(mediaType, limit);
    }
  }

  async renderTrendingBlock(el, config) {
    el.empty();
    el.appendChild(this.plugin.render.createListSkeleton(10));

    try {
      const type = (config.mediaType || 'ANIME').toLowerCase();
      const source = config.source || this.plugin.settings.defaultApiSource || 'anilist';
      const limit = config.limit || 40;

      const normalizedType = ['movie','movies','tv','show','shows'].includes(type) ? (type.includes('movie') ? 'MOVIE' : 'TV') : (type === 'manga' ? 'MANGA' : 'ANIME');

      const items = await this.plugin.requestQueue.add(() => 
        this.fetchTrending(source, normalizedType, limit)
      );

      items.forEach(item => {
        const isTmdb = ['MOVIE','MOVIES','TV','SHOW','SHOWS'].includes((config.mediaType || '').toUpperCase());
        
        // Check if this TMDb item has a successful Simkl conversion
        const hasSimklConversion = isTmdb && item.idSimkl && item.ids?.simkl;
        
        if (!item._zoroMeta) {
          item._zoroMeta = {
            source: hasSimklConversion ? 'simkl' : (isTmdb ? 'tmdb' : source),
            mediaType: config.mediaType || 'ANIME',
            fetchedAt: Date.now()
          };
        } else {
          // If we have a Simkl conversion, treat it as a Simkl item for better integration
          item._zoroMeta.source = hasSimklConversion ? 'simkl' : (isTmdb ? 'tmdb' : source);
          item._zoroMeta.mediaType = config.mediaType || 'ANIME';
          item._zoroMeta.fetchedAt = Date.now();
        }
        
        // For items with Simkl conversion, ensure the ID is set to Simkl ID
        if (hasSimklConversion) {
          item.id = item.idSimkl;
        }
      });

      el.empty();
      
      // Determine the effective source for rendering - use Simkl if any items have conversion
      const hasAnySimklConversion = items.some(item => 
        item._zoroMeta?.source === 'simkl'
      );
      const effectiveSource = hasAnySimklConversion ? 'simkl' : source;
      
      this.plugin.render.renderSearchResults(el, items, {
        layout: config.layout || 'card',
        mediaType: config.mediaType || 'ANIME',
        source: effectiveSource
      });

    } catch (err) {
      console.error('[Trending] Error in renderTrendingBlock:', err);
      el.empty();
      this.plugin.renderError(el, err.message, 'Trending');
    }
  }

  invalidateTrendingCache(source = null, mediaType = null) {
    if (source && mediaType) {
      const cacheKey = this.getTrendingCacheKey(source, mediaType, 40);
      this.plugin.cache.delete(cacheKey, { scope: 'mediaData', source });
    } else if (source) {
      this.plugin.cache.invalidateByTag('trending', { source });
    } else {
      this.plugin.cache.invalidateByTag('trending');
    }
  }

  async refreshTrending(source, mediaType, limit = 40) {
    this.invalidateTrendingCache(source, mediaType);
    return await this.fetchTrending(source, mediaType, limit);
  }

  getTrendingCacheStats() {
    const stats = this.plugin.cache.getStats();
    return {
      totalCacheSize: stats.cacheSize,
      hitRate: stats.hitRate,
      storeBreakdown: Object.entries(stats.storeBreakdown)
        .filter(([key]) => key.includes('mediaData'))
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {})
    };
  }
}

export { Trending };