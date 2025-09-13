import { Notice } from 'obsidian';

// Type definitions for plugin dependencies
interface TrendingPlugin {
  cache: CacheService;
  settings: TrendingSettings;
  requestQueue: RequestQueue;
  render: RenderService;
  renderError: (el: HTMLElement, message: string, context: string) => void;
}

interface TrendingSettings {
  defaultApiSource: string;
  simklClientId?: string;
}

interface CacheService {
  structuredKey(scope: string, category: string, key: string): string;
  get<T>(key: string, options?: CacheOptions): T | null;
  set<T>(key: string, value: T, options?: CacheOptions): void;
  delete(key: string, options?: { scope?: string; source?: string }): boolean;
  invalidateByTag(tag: string, options?: { source?: string }): number;
  getStats(): CacheStats;
}

interface CacheOptions {
  scope?: string;
  source?: string;
  ttl?: number;
  tags?: string[];
}

interface CacheStats {
  hitRate: string;
  cacheSize: number;
  hits: number;
  misses: number;
  storeBreakdown: Record<string, unknown>;
}

interface RequestQueue {
  add<T>(requestFn: () => Promise<T>, options?: RequestQueueOptions): Promise<T>;
}

interface RequestQueueOptions {
  priority?: 'low' | 'normal' | 'high';
  service?: string;
  metadata?: Record<string, unknown>;
}

interface RenderService {
  createListSkeleton(count: number): HTMLElement;
  renderSearchResults(
    el: HTMLElement, 
    items: MediaItem[], 
    options: RenderOptions
  ): void;
}

interface RenderOptions {
  layout?: string;
  mediaType?: string;
  source?: string;
}

// API Response Types
interface AniListResponse {
  data?: {
    Page?: {
      media?: AniListMedia[];
    };
  };
  errors?: Array<{ message: string }>;
}

interface AniListMedia {
  id: number;
  idMal?: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  coverImage?: {
    large?: string;
    medium?: string;
  };
  format?: string;
  averageScore?: number;
  genres?: string[];
  episodes?: number;
  chapters?: number;
  status?: string;
  startDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
}

interface JikanResponse {
  data?: JikanMedia[];
}

interface JikanMedia {
  mal_id: number;
  title?: string;
  title_english?: string;
  title_japanese?: string;
  titles?: Array<{ type: string; title: string }>;
  images?: {
    jpg?: {
      image_url?: string;
      large_image_url?: string;
    };
    webp?: {
      image_url?: string;
      large_image_url?: string;
    };
  };
  type?: string;
  score?: number;
  genres?: Array<{ name: string }>;
  episodes?: number;
  chapters?: number;
  volumes?: number;
  status?: string;
  published?: {
    from?: string;
    to?: string;
  };
  publishing?: boolean;
  serializations?: Array<{ name: string }>;
  authors?: Array<{ name: string }>;
  themes?: Array<{ name: string }>;
  demographics?: Array<{ name: string }>;
  popularity?: number;
  members?: number;
  favorites?: number;
}

interface SimklMedia {
  id?: number;
  rank?: number;
  ids?: {
    simkl_id?: number;
    simkl?: number;
    tmdb?: number;
    imdb?: string;
  };
  poster?: string;
  fanart?: string;
  release_date?: string;
  ratings?: {
    simkl?: {
      rating?: number;
    };
  };
  watched?: number;
  plan_to_watch?: number;
  status?: string;
  genres?: string[];
  total_episodes?: number;
  overview?: string;
}

// Internal data structures
interface MediaItem {
  id: number | string;
  idMal?: number;
  idTmdb?: number;
  idImdb?: string;
  idSimkl?: number;
  ids?: {
    simkl?: number;
    tmdb?: number;
    imdb?: string;
  };
  title: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
  };
  coverImage?: {
    large?: string | null;
    medium?: string | null;
  };
  bannerImage?: string | null;
  format?: string;
  averageScore?: number | null;
  genres?: string[];
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  status?: string;
  description?: string | null;
  startDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  };
  published?: {
    from?: string;
    to?: string;
  };
  publishing?: boolean;
  releaseDate?: string;
  serializations?: string[];
  authors?: string[];
  themes?: string[];
  demographics?: string[];
  popularity?: number | null;
  members?: number | null;
  favorites?: number | null;
  _zoroMeta: {
    source: string;
    mediaType: string;
    fetchedAt: number;
    trendingMethod?: string;
    apiEndpoint?: string;
    trending?: {
      watched?: number;
      planToWatch?: number;
      rating?: number;
      rank?: number;
    };
  };
}

interface TrendingConfig {
  mediaType?: string;
  source?: string;
  limit?: number;
  layout?: string;
}

// Type guards for API responses
function assertIsAniListResponse(data: unknown): asserts data is AniListResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid AniList response: not an object');
  }
}

function assertIsJikanResponse(data: unknown): asserts data is JikanResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid Jikan response: not an object');
  }
}

function assertIsSimklResponse(data: unknown): asserts data is SimklMedia[] {
  if (!Array.isArray(data)) {
    throw new Error('Invalid Simkl response: not an array');
  }
}

export class Trending {
  private plugin: TrendingPlugin;

  constructor(plugin: TrendingPlugin) {
    this.plugin = plugin;
  }

  private getTrendingCacheKey(source: string, mediaType: string, limit: number): string {
    return this.plugin.cache.structuredKey('trending', 'trending', `${source}_${mediaType}_${limit}`);
  }

  async fetchAniListTrending(mediaType: string = 'ANIME', limit: number = 40): Promise<MediaItem[]> {
    const cacheKey = this.getTrendingCacheKey('anilist', mediaType, limit);
    
    const cached = this.plugin.cache.get<MediaItem[]>(cacheKey, {
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

      const data: unknown = await response.json();
      assertIsAniListResponse(data);
      
      if (data.errors) {
        console.error('[Trending] AniList GraphQL errors:', data.errors);
        throw new Error(`AniList GraphQL error: ${data.errors[0]?.message || 'Unknown error'}`);
      }

      if (!data.data?.Page?.media) {
        console.error('[Trending] No media data in response:', data);
        throw new Error('No trending data received from AniList');
      }

      const mediaList: MediaItem[] = data.data.Page.media.map(media => ({
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
      
      const staleData = this.plugin.cache.get<MediaItem[]>(cacheKey, {
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

  async fetchJikanTrending(mediaType: string = 'anime', limit: number = 40): Promise<MediaItem[]> {
    const type = mediaType.toLowerCase();
    const cacheKey = this.getTrendingCacheKey('mal', mediaType, limit);
    
    const cached = this.plugin.cache.get<MediaItem[]>(cacheKey, {
      scope: 'mediaData',
      source: 'mal'
    });
    
    if (cached) {
      return cached;
    }

    let url: string;
    
    if (type === 'manga') {
      // Use top manga by publishing (currently ongoing) for better trending
      url = `https://api.jikan.moe/v4/top/manga?filter=publishing&limit=${Math.min(limit, 25)}`;
    } else {
      // Back to original anime trending (airing filter)
      url = `https://api.jikan.moe/v4/top/${type}?filter=airing&limit=${Math.min(limit, 25)}`;
    }

    try {
      const response = await this.plugin.requestQueue.add(() => fetch(url), {
        priority: 'normal',
        service: 'mal',
        metadata: { type: 'trending' }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Trending] Jikan error response:', errorText);
        throw new Error(`Jikan API error: ${response.status} - ${errorText}`);
      }

      const data: unknown = await response.json();
      assertIsJikanResponse(data);
      
      let items: MediaItem[] = [];
      
      if (type === 'manga') {
        // Handle regular top manga response (same as anime)
        const unique: MediaItem[] = [];
        const seen = new Set<number>();
        
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
              idMal: item.mal_id,
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
              } : undefined,
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
        const unique: MediaItem[] = [];
        const seen = new Set<number>();
        
        (data.data || []).forEach(item => {
          if (!seen.has(item.mal_id)) {
            seen.add(item.mal_id);
            
            unique.push({
              id: item.mal_id,
              idMal: item.mal_id,
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
      
      const staleData = this.plugin.cache.get<MediaItem[]>(cacheKey, {
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

  async fetchSimklTrending(mediaType: string = 'MOVIE', limit: number = 40): Promise<MediaItem[]> {
    const simklClientId = this.plugin.settings.simklClientId;
    
    if (!simklClientId) {
      throw new Error('Simkl Client ID is required. Please add it in settings.');
    }

    const typeUpper = (mediaType || 'MOVIE').toUpperCase();
    const cacheKey = this.getTrendingCacheKey('simkl', mediaType, limit);

    const cached = this.plugin.cache.get<MediaItem[]>(cacheKey, {
      scope: 'mediaData',
      source: 'simkl'
    });
    
    if (cached) {
      return cached;
    }

    let endpoint: string;
    if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES') {
      endpoint = 'movies/trending';
    } else if (typeUpper === 'TV' || typeUpper === 'SHOW' || typeUpper === 'SHOWS') {
      endpoint = 'tv/trending';
    } else {
      return [];
    }

    try {
      const url = `https://api.simkl.com/${endpoint}?limit=${limit}`;
      
      const requestFn = () => fetch(url, {
        headers: {
          'Accept': 'application/json',
          'simkl-api-key': simklClientId
        }
      });

      const response = await this.plugin.requestQueue.add(requestFn, {
        priority: 'normal',
        service: 'simkl',
        metadata: { type: 'trending' }
      });

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : 'No response';
        throw new Error(`Simkl API error: ${response ? response.status : 'NO-RESP'} - ${errorText}`);
      }

      const data: unknown = await response.json();
      assertIsSimklResponse(data);

      const mediaList = data
        .slice(0, limit)
        .map((item) => this.transformSimklTrendingMedia(item, mediaType))
        .filter((item): item is MediaItem => item !== null);

      this.plugin.cache.set(cacheKey, mediaList, {
        scope: 'mediaData',
        source: 'simkl',
        ttl: 24 * 60 * 60 * 1000,
        tags: ['trending', mediaType.toLowerCase(), 'simkl']
      });

      return mediaList;

    } catch (error) {
      const staleData = this.plugin.cache.get<MediaItem[]>(cacheKey, {
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

  private transformSimklTrendingMedia(item: SimklMedia, mediaType: string): MediaItem | null {
    try {
      const isMovie = mediaType.toUpperCase() === 'MOVIE' || mediaType.toUpperCase() === 'MOVIES';
      
      // Use rank as the title since actual titles aren't available
      const title = item.rank ? `Rank: ${item.rank}` : `Rank Unknown`;
      
      const simklId = item.ids?.simkl_id || item.ids?.simkl || item.id || null;
      const tmdbId = item.ids?.tmdb || null;
      const imdbId = item.ids?.imdb || null;
      
      const posterUrl = item.poster ? `https://simkl.in/posters/${item.poster}_m.jpg` : null;
      const fanartUrl = item.fanart ? `https://simkl.in/fanart/${item.fanart}_m.jpg` : null;
      
      let year: number | null = null;
      if (item.release_date) {
        const dateMatch = item.release_date.match(/(\d{4})/);
        year = dateMatch ? parseInt(dateMatch[1]) : null;
      }
      
      const simklRating = item.ratings?.simkl?.rating || null;
      const averageScore = simklRating ? Math.round(simklRating * 10) : null;
      
      return {
        id: simklId || 0,
        idTmdb: tmdbId,
        idImdb: imdbId,
        idSimkl: simklId,
        ids: {
          simkl: simklId,
          tmdb: tmdbId,
          imdb: imdbId
        },
        title: {
          english: title,
          romaji: null,
          native: null
        },
        coverImage: {
          large: posterUrl,
          medium: posterUrl
        },
        bannerImage: fanartUrl,
        format: isMovie ? 'MOVIE' : 'TV',
        averageScore: averageScore,
        popularity: item.watched || null,
        genres: item.genres || [],
        episodes: isMovie ? 1 : (item.total_episodes || null),
        status: item.status ? item.status.toUpperCase() : undefined,
        description: item.overview || null,
        startDate: {
          year: year,
          month: null,
          day: null
        },
        releaseDate: item.release_date || undefined,
        _zoroMeta: {
          source: 'simkl',
          mediaType: mediaType.toUpperCase(),
          fetchedAt: Date.now(),
          trending: {
            watched: item.watched,
            planToWatch: item.plan_to_watch,
            rating: simklRating,
            rank: item.rank
          }
        }
      };
    } catch (error) {
      return null;
    }
  }

  async fetchTrending(source: string, mediaType: string, limit: number = 40): Promise<MediaItem[]> {
    const typeUpper = String(mediaType || '').toUpperCase();
    
    // Use Simkl for movies and TV shows instead of TMDb
    if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper === 'SHOW' || typeUpper === 'SHOWS') {
      return await this.fetchSimklTrending(typeUpper.includes('MOVIE') ? 'MOVIE' : 'TV', limit);
    }

    // Keep existing logic for anime/manga
    switch ((source || '').toLowerCase()) {
      case 'mal':
        return await this.fetchJikanTrending(mediaType, limit);
      case 'anilist':
      default:
        return await this.fetchAniListTrending(mediaType, limit);
    }
  }

  async renderTrendingBlock(el: HTMLElement, config: TrendingConfig): Promise<void> {
    el.empty();
    el.appendChild(this.plugin.render.createListSkeleton(10));

    try {
      const type = (config.mediaType || 'ANIME').toLowerCase();
      let source = config.source || this.plugin.settings.defaultApiSource || 'anilist';
      const mt = String(config.mediaType || 'ANIME').toUpperCase();
      if (['MOVIE','MOVIES','TV','SHOW','SHOWS'].includes(mt)) source = 'simkl';
      if (mt === 'MANGA' && (source === 'anilist' || source === 'simkl')) source = 'mal';
      const limit = config.limit || 40;

      const normalizedType = ['movie','movies','tv','show','shows'].includes(type) ? (type.includes('movie') ? 'MOVIE' : 'TV') : (type === 'manga' ? 'MANGA' : 'ANIME');

      const items = await this.plugin.requestQueue.add(() => 
        this.fetchTrending(source, normalizedType, limit)
      );

      items.forEach(item => {
        const isSimkl = ['MOVIE','MOVIES','TV','SHOW','SHOWS'].includes((config.mediaType || '').toUpperCase());
        if (!item._zoroMeta) {
          item._zoroMeta = {
            source: isSimkl ? 'simkl' : source,
            mediaType: config.mediaType || 'ANIME',
            fetchedAt: Date.now()
          };
        } else {
          item._zoroMeta.source = isSimkl ? 'simkl' : source;
          item._zoroMeta.mediaType = config.mediaType || 'ANIME';
          item._zoroMeta.fetchedAt = Date.now();
        }
      });

      el.empty();
      this.plugin.render.renderSearchResults(el, items, {
        layout: config.layout || 'card',
        mediaType: config.mediaType || 'ANIME',
        source: source
      });

    } catch (err) {
      console.error('[Trending] Error in renderTrendingBlock:', err);
      el.empty();
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      this.plugin.renderError(el, message, 'Trending');
    }
  }

  invalidateTrendingCache(source: string | null = null, mediaType: string | null = null): void {
    if (source && mediaType) {
      const cacheKey = this.getTrendingCacheKey(source, mediaType, 40);
      this.plugin.cache.delete(cacheKey, { scope: 'mediaData', source });
    } else if (source) {
      this.plugin.cache.invalidateByTag('trending', { source });
    } else {
      this.plugin.cache.invalidateByTag('trending');
    }
  }

  async refreshTrending(source: string, mediaType: string, limit: number = 40): Promise<MediaItem[]> {
    this.invalidateTrendingCache(source, mediaType);
    return await this.fetchTrending(source, mediaType, limit);
  }

  getTrendingCacheStats(): {
    totalCacheSize: number;
    hitRate: string;
    storeBreakdown: Record<string, unknown>;
  } {
    const stats = this.plugin.cache.getStats();
    return {
      totalCacheSize: stats.cacheSize,
      hitRate: stats.hitRate,
      storeBreakdown: Object.entries(stats.storeBreakdown)
        .filter(([key]) => key.includes('mediaData'))
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {} as Record<string, unknown>)
    };
  }
}
