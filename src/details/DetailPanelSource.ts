/**
 * DetailPanelSource
 * Migrated from DetailPanelSource.js → DetailPanelSource.ts
 * - Added comprehensive type definitions for all methods and interfaces
 * - Used unknown for external API responses with type guards
 * - Preserved all runtime behavior exactly as original
 */

// Type definitions
interface Plugin {
  cache: CacheService;
  settings: PluginSettings;
  fetchAniListData?: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
  simklApi?: SimklApiService;
}

interface CacheService {
  structuredKey(namespace: string, type: string, key: string): string;
  get(key: string, options: CacheOptions): unknown;
  set(key: string, value: unknown, options: CacheSetOptions): void;
}

interface CacheOptions {
  scope: string;
  source: string;
}

interface CacheSetOptions extends CacheOptions {
  ttl?: number;
  tags: string[];
}

interface PluginSettings {
  defaultApiSource?: string;
  simklClientId?: string;
  tmdbApiKey?: string;
}

interface SimklApiService {
  buildFullUrl?: (base: string, params: Record<string, string>) => string;
  getHeaders?: (options: { type: string }) => Record<string, string>;
  makeRequest?: (options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    priority: string;
  }) => Promise<unknown>;
}

interface ConversionResult {
  id: number;
  type: string;
}

interface MediaEntry {
  _zoroMeta?: {
    source?: string;
    mediaType?: string;
  };
  media?: MediaData;
}

interface MediaData {
  id?: number | string;
  type?: string;
  format?: string;
  description?: string;
  overview?: string;
  genres?: string[];
  averageScore?: number;
  nextAiringEpisode?: AiringEpisode;
  idMal?: number;
  idImdb?: string;
  idTmdb?: number;
  ids?: {
    imdb?: string;
    tmdb?: number;
    simkl?: number;
  };
  originalMalId?: number;
}

interface AiringEpisode {
  airingAt: number;
  episode: number;
  timeUntilAiring: number;
}

interface DetailedMediaResponse {
  data?: {
    Media?: MediaData;
  };
}

interface MALData {
  nextAiringEpisode?: AiringEpisode;
  [key: string]: unknown;
}

interface IMDBData {
  score?: number | null;
  scored_by?: number | null;
  rank?: number | null;
  title?: string;
  year?: string;
  plot?: string;
  director?: string;
  actors?: string;
  genre?: string;
  runtime?: string;
  awards?: string;
  imdbID?: string;
}

interface CombinedDetailData {
  detailedMedia: MediaData;
  malData?: MALData | null;
  imdbData?: IMDBData | null;
}

type MediaTypeString = 'ANIME' | 'MANGA' | 'MOVIE' | 'TV' | string;
type SourceString = 'anilist' | 'mal' | 'simkl' | 'tmdb' | string;

// Type guards
function assertIsDetailedMediaResponse(value: unknown): asserts value is DetailedMediaResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected object response');
  }
}

function assertIsMALResponse(value: unknown): asserts value is { data?: MALData } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected MAL API response object');
  }
}

function assertIsSimklResponse(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected Simkl API response object');
  }
}

function assertIsOMDBResponse(value: unknown): asserts value is { Response: string; [key: string]: unknown } {
  if (typeof value !== 'object' || value === null || !('Response' in value)) {
    throw new Error('Expected OMDB API response object');
  }
}

export default class DetailPanelSource {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async convertMalToAnilistId(malId: number | string, malType?: MediaTypeString): Promise<ConversionResult | null> {
    const cacheKey = this.plugin.cache.structuredKey('conversion', 'mal_to_anilist', `${malId}_${malType || 'unknown'}`);
    const cached = this.plugin.cache.get(cacheKey, { scope: 'mediaData', source: 'anilist' }) as ConversionResult | null;
    if (cached) return cached;

    const anilistType = this.convertMalTypeToAnilistType(malType);
    let result: ConversionResult | null = null;
    if (!anilistType) {
      for (const tryType of ['ANIME', 'MANGA'] as const) {
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

  private async tryConvertWithType(malId: number | string, anilistType: string): Promise<ConversionResult | null> {
    const query = `query($idMal: Int, $type: MediaType) { Media(idMal: $idMal, type: $type) { id type } }`;
    const variables = { idMal: Number(malId), type: anilistType };

    try {
      let response: unknown;
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
      
      assertIsDetailedMediaResponse(response);
      const anilistId = response?.data?.Media?.id;
      const anilistTypeResult = response?.data?.Media?.type;
      if (anilistId) return { id: Number(anilistId), type: String(anilistTypeResult || anilistType) };
      return null;
    } catch {
      return null;
    }
  }

  private convertMalTypeToAnilistType(malType?: MediaTypeString): string | null {
    if (!malType) return null;
    const normalizedType = malType.toString().toLowerCase();
    const typeMap: Record<string, string> = {
      'anime': 'ANIME', 'tv': 'ANIME', 'movie': 'ANIME', 'ova': 'ANIME', 'ona': 'ANIME', 'special': 'ANIME', 'music': 'ANIME',
      'manga': 'MANGA', 'manhwa': 'MANGA', 'manhua': 'MANGA', 'novel': 'MANGA', 'light_novel': 'MANGA', 'one_shot': 'MANGA'
    } as const;
    return typeMap[normalizedType] || null;
  }

  shouldFetchDetailedData(media: MediaData): boolean {
    const missingBasicData = !media.description || !media.genres || !media.averageScore;
    const mediaKind = media?.type || media?.format;
    const isAnimeWithoutAiring = mediaKind === 'ANIME' && !media.nextAiringEpisode;
    // Force fetch for TMDb movies/TV to route through Simkl detail panel
    const isTmdbMovieOrTv = ((media?._zoroMeta?.source || '').toLowerCase() === 'tmdb')
      && (mediaKind === 'MOVIE' || mediaKind === 'TV');
    return missingBasicData || isAnimeWithoutAiring || isTmdbMovieOrTv;
  }

  private extractSourceFromEntry(entry: MediaEntry): SourceString {
    return entry?._zoroMeta?.source || this.plugin.settings.defaultApiSource || 'anilist';
  }

  private extractMediaTypeFromEntry(entry: MediaEntry): MediaTypeString | null {
    return entry?._zoroMeta?.mediaType || entry?.media?.type || null;
  }

  async fetchDetailedData(
    mediaId: number | string, 
    entryOrSource: MediaEntry | SourceString | null = null, 
    mediaType: MediaTypeString | null = null
  ): Promise<MediaData | null> {
    let source: SourceString, resolvedMediaType: MediaTypeString | null;
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

    let targetId: number | string = mediaId;
    let originalMalId: number | null = null;

    if (source === 'mal') {
      originalMalId = Number(mediaId);
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
            // Ensure explicit media type for correct panel rendering
            type: resolvedMediaType,
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
    } else if (source === 'tmdb' && (resolvedMediaType === 'MOVIE' || resolvedMediaType === 'TV')) {
      // Route TMDb movies/TV through Simkl detail panel by resolving Simkl ID first
      try {
        const mediaObj = (typeof entryOrSource === 'object' && entryOrSource?.media) ? entryOrSource.media : null;
        const tmdbId = Number(mediaObj?.idTmdb || mediaId || mediaObj?.ids?.tmdb || 0) || 0;
        const imdbId = mediaObj?.idImdb || mediaObj?.ids?.imdb || null;

        const simklId = await this.resolveSimklIdFromExternal(tmdbId, imdbId, resolvedMediaType);
        if (simklId) {
          const detailedSimklData = await this.fetchSimklDetailedData(simklId, resolvedMediaType);
          if (detailedSimklData) {
            return {
              ...mediaObj,
              ...detailedSimklData,
              // Ensure explicit media type for correct panel rendering
              type: resolvedMediaType,
              // Preserve original TMDb id on the media object
              id: mediaObj?.id ?? tmdbId,
              idImdb: mediaObj?.idImdb || detailedSimklData.ids?.imdb || imdbId || null,
              idTmdb: mediaObj?.idTmdb || tmdbId || detailedSimklData.ids?.tmdb || null,
              // Ensure Simkl ids are available under ids
              ids: {
                ...(detailedSimklData.ids || {}),
                tmdb: mediaObj?.idTmdb || tmdbId || (detailedSimklData.ids?.tmdb ?? null),
                imdb: mediaObj?.idImdb || imdbId || (detailedSimklData.ids?.imdb ?? null)
              },
              description: detailedSimklData.overview || mediaObj?.overview || mediaObj?.description || null,
              nextAiringEpisode: null
            };
          }
        }
      } catch {}
      // If resolution fails, just return the original media without changes
      if (typeof entryOrSource === 'object' && entryOrSource?.media) return entryOrSource.media;
      return null;
    }

    const stableCacheKey = this.plugin.cache.structuredKey('details', 'stable', String(targetId));
    const dynamicCacheKey = this.plugin.cache.structuredKey('details', 'airing', String(targetId));

    const stableData = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'anilist' }) as MediaData | null;
    const airingData = this.plugin.cache.get(dynamicCacheKey, { scope: 'mediaDetails', source: 'anilist' }) as { nextAiringEpisode?: AiringEpisode } | null;

    if (stableData && (stableData.type !== 'ANIME' || airingData)) {
      const combinedData = { ...stableData };
      if (airingData?.nextAiringEpisode) combinedData.nextAiringEpisode = airingData.nextAiringEpisode;
      return combinedData;
    }

    const query = this.getDetailedMediaQuery();
    const variables = { id: Number(targetId) };

    let response: unknown;
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

    assertIsDetailedMediaResponse(response);
    if (!response?.data?.Media) throw new Error('No media data received');
    const data = response.data.Media;
    if (originalMalId) data.originalMalId = originalMalId;

    const { nextAiringEpisode, ...stableDataOnly } = data;
    this.plugin.cache.set(stableCacheKey, stableDataOnly, { 
      scope: 'mediaDetails', 
      source: 'anilist', 
      tags: ['details', 'stable', data.type?.toLowerCase() || 'unknown'] 
    });
    if (data.type === 'ANIME' && nextAiringEpisode) {
      this.plugin.cache.set(dynamicCacheKey, { nextAiringEpisode }, { 
        scope: 'mediaDetails', 
        source: 'anilist', 
        tags: ['details', 'airing', 'anime'] 
      });
    }
    return data;
  }

  async fetchMALData(malId: number | string, mediaType: MediaTypeString): Promise<MALData | null> {
    if (!malId) return null;
    
    // Use stable/dynamic caching system like AniList
    const stableCacheKey = this.plugin.cache.structuredKey('mal', 'stable', `${malId}_${mediaType}`);
    const dynamicCacheKey = this.plugin.cache.structuredKey('mal', 'airing', `${malId}_${mediaType}`);
    
    const stableData = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'mal' }) as MALData | null;
    const airingData = this.plugin.cache.get(dynamicCacheKey, { scope: 'mediaDetails', source: 'mal' }) as { nextAiringEpisode?: AiringEpisode } | null;
    
    if (stableData) {
      const combinedData = { ...stableData };
      if (airingData?.nextAiringEpisode) combinedData.nextAiringEpisode = airingData.nextAiringEpisode;
      return combinedData;
    }

    try {
      const type = mediaType === 'MANGA' ? 'manga' : 'anime';
      const response = await fetch(`https://api.jikan.moe/v4/${type}/${malId}`);
      if (!response.ok) throw new Error(`Jikan API error: ${response.status}`);
      const responseData = await response.json();
      assertIsMALResponse(responseData);
      const data = responseData?.data;
      
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

  async fetchSimklDetailedData(simklId: number | string, mediaType: MediaTypeString): Promise<Record<string, unknown> | null> {
    if (!simklId) return null;
    
    // Use stable caching system (Simkl doesn't have airing data)
    const stableCacheKey = this.plugin.cache.structuredKey('simkl', 'stable', `${simklId}_${mediaType}`);
    const cached = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'simkl' }) as Record<string, unknown> | null;
    if (cached) return cached;

    try {
      // Use correct Simkl API endpoints for detailed data
      const endpoint = mediaType === 'MOVIE' ? 'movies' : 'tv';
      const url = `https://api.simkl.com/${endpoint}/${simklId}?extended=full&client_id=${this.plugin.settings.simklClientId}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Simkl API error: ${response.status}`);
      const data = await response.json();
      assertIsSimklResponse(data);
      
      if (data) {
        // Simkl does not provide airing data in their API
        // Remove any next_episode field if it exists (it shouldn't)
        if ('next_episode' in data) {
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

  async fetchIMDBData(
    imdbId: string, 
    mediaType: MediaTypeString, 
    simklData: Record<string, unknown> | null = null
  ): Promise<IMDBData | null> {
    if (!imdbId) return null;
    
    // First, check if Simkl already provides IMDB rating data
    if (simklData) {
      const ratings = simklData.ratings || (simklData._rawData as Record<string, unknown>)?.ratings;
      const imdbRating = (ratings as Record<string, unknown>)?.imdb as Record<string, unknown> | undefined;
      
      if (imdbRating && (imdbRating.rating || imdbRating.votes)) {
        const imdbData: IMDBData = {
          score: (imdbRating.rating as number) || null,
          scored_by: (imdbRating.votes as number) || null,
          rank: null,
          imdbID: imdbId
        };
        return imdbData;
      }
    }
    
    // Fallback to OMDB API if Simkl doesn't provide IMDB rating data
    const stableCacheKey = this.plugin.cache.structuredKey('imdb', 'stable', `${imdbId}_${mediaType}`);
    const cached = this.plugin.cache.get(stableCacheKey, { scope: 'mediaDetails', source: 'imdb' }) as IMDBData | null;
    if (cached) return cached;

    try {
      console.log('[Details][OMDb] Fetching OMDb data', { imdbId, mediaType });
      // Use OMDB API to get IMDB data (free and reliable)
      const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=fc1fef96`);
      if (!response.ok) {
        console.log('[Details][OMDb] HTTP error', response.status);
        throw new Error(`OMDB API error: ${response.status}`);
      }
      const data = await response.json();
      assertIsOMDBResponse(data);
      console.log('[Details][OMDb] Response', data?.Response, { 
        imdbRating: (data as Record<string, unknown>)?.imdbRating, 
        imdbVotes: (data as Record<string, unknown>)?.imdbVotes 
      });
      
      if (data.Response === 'True') {
        // Transform OMDB data to match our expected format
        const transformedData: IMDBData = {
          score: parseFloat((data as Record<string, unknown>).imdbRating as string) || null,
          scored_by: (data as Record<string, unknown>).imdbVotes 
            ? parseInt(((data as Record<string, unknown>).imdbVotes as string).replace(/,/g, '')) 
            : null,
          rank: null, // OMDB doesn't provide rank
          title: (data as Record<string, unknown>).Title as string,
          year: (data as Record<string, unknown>).Year as string,
          plot: (data as Record<string, unknown>).Plot as string,
          director: (data as Record<string, unknown>).Director as string,
          actors: (data as Record<string, unknown>).Actors as string,
          genre: (data as Record<string, unknown>).Genre as string,
          runtime: (data as Record<string, unknown>).Runtime as string,
          awards: (data as Record<string, unknown>).Awards as string,
          imdbID: (data as Record<string, unknown>).imdbID as string
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
    } catch (e) {
      console.log('[Details][OMDb] Fetch failed', (e as Error)?.message || e);
      return null;
    }
  }

  async fetchAndUpdateData(
    mediaId: number | string,
    entryOrSource: MediaEntry | SourceString | null = null,
    mediaTypeOrCallback: MediaTypeString | ((detailedMedia: MediaData, malData: MALData | null, imdbData: IMDBData | null) => void) | null = null,
    onUpdate: ((detailedMedia: MediaData, malData: MALData | null, imdbData: IMDBData | null) => void) | null = null
  ): Promise<void> {
    let source: SourceString, mediaType: MediaTypeString | null, callback: ((detailedMedia: MediaData, malData: MALData | null, imdbData: IMDBData | null) => void) | null;
    
    if (typeof entryOrSource === 'object' && entryOrSource !== null) {
      source = this.extractSourceFromEntry(entryOrSource);
      mediaType = this.extractMediaTypeFromEntry(entryOrSource);
      callback = mediaTypeOrCallback as ((detailedMedia: MediaData, malData: MALData | null, imdbData: IMDBData | null) => void) | null;
    } else if (typeof entryOrSource === 'string') {
      source = entryOrSource;
      if (typeof mediaTypeOrCallback === 'function') { 
        mediaType = null; 
        callback = mediaTypeOrCallback; 
      } else { 
        mediaType = mediaTypeOrCallback; 
        callback = onUpdate; 
      }
    } else {
      source = this.plugin.settings.defaultApiSource || 'anilist';
      mediaType = null;
      callback = mediaTypeOrCallback as ((detailedMedia: MediaData, malData: MALData | null, imdbData: IMDBData | null) => void) | null;
    }

    if (!callback) return;

    try {
      // Check for cached detail panel data first
      const detailPanelCacheKey = this.plugin.cache.structuredKey('detailPanel', 'combined', `${source}_${mediaId}_${mediaType}`);
      const cachedDetailPanel = this.plugin.cache.get(detailPanelCacheKey, { scope: 'mediaDetails', source: 'detailPanel' }) as CombinedDetailData | null;
      
      if (cachedDetailPanel) {
        // Use cached data if available, but try to enrich with OMDb if missing
        const { detailedMedia, malData, imdbData } = cachedDetailPanel;
        if (this.hasMoreData(detailedMedia)) callback(detailedMedia, null, null);
        if (malData) callback(detailedMedia, malData, null);
        if (imdbData) {
          callback(detailedMedia, null, imdbData);
        } else {
          // Attempt OMDb fetch if this is a TMDb/Simkl movie/TV and we have/ can resolve IMDb id
          const typeUpperCached = (mediaType || detailedMedia?.type || '').toString().toUpperCase();
          const isMovieOrTvCached = typeUpperCached.includes('MOVIE') || typeUpperCached === 'TV' || typeUpperCached.includes('SHOW');
          const isTmdbOrSimkl = (source === 'tmdb' || source === 'simkl');
          if (isTmdbOrSimkl && isMovieOrTvCached) {
            let imdbIdLocal: string | null = null;
            if (typeof entryOrSource === 'object' && entryOrSource?.media) {
              imdbIdLocal = entryOrSource.media.idImdb || entryOrSource.media.ids?.imdb || null;
              if (imdbIdLocal) console.log('[Details][OMDb][Cache] Using IMDb from entry.media', imdbIdLocal);
            }
            if (!imdbIdLocal) {
              imdbIdLocal = detailedMedia?.idImdb || detailedMedia?.ids?.imdb || null;
              if (imdbIdLocal) console.log('[Details][OMDb][Cache] Using IMDb from cached detailedMedia', imdbIdLocal);
            }
            if (!imdbIdLocal && source === 'tmdb') {
              try {
                const tmdbId = detailedMedia?.idTmdb || detailedMedia?.ids?.tmdb || Number(mediaId);
                console.log('[Details][OMDb][Cache] Resolving IMDb via TMDb external_ids', { tmdbId, mediaType });
                imdbIdLocal = await this.fetchImdbIdFromTmdb(tmdbId, typeUpperCached);
                if (imdbIdLocal) console.log('[Details][OMDb][Cache] Resolved IMDb via TMDb', imdbIdLocal);
              } catch (e) { 
                console.log('[Details][OMDb][Cache] Resolve failed', (e as Error)?.message || e); 
              }
            }
            if (imdbIdLocal) {
              const imdbDataResolved = await this.fetchIMDBData(imdbIdLocal, detailedMedia?.type || typeUpperCached, detailedMedia);
              if (imdbDataResolved) {
                // Update cache and callback
                const updated = { detailedMedia, malData, imdbData: imdbDataResolved };
                this.plugin.cache.set(detailPanelCacheKey, updated, { 
                  scope: 'mediaDetails', 
                  source: 'detailPanel', 
                  tags: ['detailPanel','combined', source, mediaType || 'unknown'] 
                });
                callback(detailedMedia, null, imdbDataResolved);
              }
            }
          }
        }
        return;
      }

      const detailedMedia = await this.fetchDetailedData(mediaId, entryOrSource, mediaType);
      
      // Handle case where fetchDetailedData returns null (e.g., Simkl anime without MAL ID)
      if (!detailedMedia) {
        return;
      }
      
      const malId = source === 'mal' ? (detailedMedia.originalMalId || Number(mediaId)) : detailedMedia.idMal;
      let malDataPromise: Promise<MALData | null> | null = null;
      let imdbDataPromise: Promise<IMDBData | null> | null = null;
      
      if (malId) malDataPromise = this.fetchMALData(malId, detailedMedia.type || 'ANIME');
      
      // For Simkl or TMDb movies/TV, fetch IMDB data
      const typeUpper = (mediaType || detailedMedia.type || '').toString().toUpperCase();
      const isMovieOrTv = typeUpper.includes('MOVIE') || typeUpper === 'TV' || typeUpper.includes('SHOW');
      if ((source === 'simkl' || source === 'tmdb') && isMovieOrTv) {
        let imdbIdLocal: string | null = null;
        // 1) Prefer IMDb from the original TMDb entry (entry.media)
        if (source === 'tmdb' && typeof entryOrSource === 'object' && entryOrSource?.media) {
          imdbIdLocal = entryOrSource.media.idImdb || entryOrSource.media.ids?.imdb || null;
          if (imdbIdLocal) console.log('[Details][OMDb] Using IMDb from TMDb entry.media', imdbIdLocal);
        }
        // 2) Fallback to detailed media (merged result)
        if (!imdbIdLocal) {
          imdbIdLocal = detailedMedia.idImdb || detailedMedia.ids?.imdb || null;
          if (imdbIdLocal) console.log('[Details][OMDb] Using IMDb from detailedMedia', imdbIdLocal);
        }
        // 3) Final fallback: resolve from TMDb external_ids
        if (!imdbIdLocal && source === 'tmdb') {
          try {
            const tmdbId = detailedMedia.idTmdb || detailedMedia.ids?.tmdb || Number(mediaId);
            console.log('[Details][OMDb] Missing IMDb id; resolving from TMDb external_ids', { tmdbId, mediaType });
            imdbIdLocal = await this.fetchImdbIdFromTmdb(tmdbId, typeUpper);
            if (imdbIdLocal) {
              detailedMedia.idImdb = imdbIdLocal;
              console.log('[Details][OMDb] Resolved IMDb id from TMDb', imdbIdLocal);
            }
          } catch (e) {
            console.log('[Details][OMDb] Failed to resolve IMDb id from TMDb', (e as Error)?.message || e);
          }
        }
        if (imdbIdLocal) {
          imdbDataPromise = this.fetchIMDBData(imdbIdLocal, detailedMedia.type || typeUpper, detailedMedia);
        } else {
          console.log('[Details][OMDb] IMDb id not found; skipping OMDb');
        }
      }
      
      // Collect all data
      let malData: MALData | null = null;
      let imdbData: IMDBData | null = null;
      
      if (malDataPromise) {
        malData = await malDataPromise;
      }
      
      if (imdbDataPromise) {
        imdbData = await imdbDataPromise;
      }
      
      // Cache the combined detail panel data using cache class TTL
      const combinedData: CombinedDetailData = { detailedMedia, malData, imdbData };
      this.plugin.cache.set(detailPanelCacheKey, combinedData, { 
        scope: 'mediaDetails', 
        source: 'detailPanel', 
        tags: ['detailPanel', 'combined', source, mediaType || 'unknown'] 
      });
      
      // Call callbacks with data
      if (this.hasMoreData(detailedMedia)) callback(detailedMedia, null, null);
      if (malData) callback(detailedMedia, malData, null);
      if (imdbData) callback(detailedMedia, null, imdbData);
    } catch (error) {
      console.error('fetchAndUpdateData failed:', error);
    }
  }

  private hasMoreData(newMedia: MediaData): boolean {
    const hasBasicData = newMedia.description || (newMedia.genres?.length ?? 0) > 0 || (newMedia.averageScore ?? 0) > 0;
    const hasAiringData = newMedia.type === 'ANIME' && newMedia.nextAiringEpisode;
    return hasBasicData || hasAiringData;
  }

  private getDetailedMediaQuery(): string {
    return `query($id:Int){Media(id:$id){id type title{romaji english native}description(asHtml:false)format status season seasonYear averageScore genres nextAiringEpisode{airingAt episode timeUntilAiring}idMal}}`;
  }

  // Helper: resolve Simkl ID from TMDb/IMDb for MOVIE/TV
  async resolveSimklIdFromExternal(
    tmdbId: number, 
    imdbId: string | null, 
    mediaType: MediaTypeString
  ): Promise<number | null> {
    if (!tmdbId && !imdbId) return null;
    const type = (mediaType === 'MOVIE' || mediaType === 'MOVIES') ? 'movies' : 'tv';
    const cacheKey = this.plugin.cache.structuredKey('simkl', 'resolve_external', `${type}_${tmdbId || 'none'}_${imdbId || 'none'}`);
    const cached = this.plugin.cache.get(cacheKey, { scope: 'mediaDetails', source: 'simkl' }) as number | null;
    if (cached) return cached;

    try {
      const params: Record<string, string> = {};
      if (tmdbId) params.tmdb = String(tmdbId);
      if (imdbId) params.imdb = String(imdbId);
      if (this.plugin.settings.simklClientId) params.client_id = this.plugin.settings.simklClientId;

      const base = 'https://api.simkl.com/search/id';
      const url = this.plugin.simklApi?.buildFullUrl ? this.plugin.simklApi.buildFullUrl(base, params) : `${base}?${new URLSearchParams(params).toString()}`;
      const headers = this.plugin.simklApi?.getHeaders ? this.plugin.simklApi.getHeaders({ type: 'search' }) : { 'Accept': 'application/json' };
      const data = this.plugin.simklApi && this.plugin.simklApi.makeRequest
        ? await this.plugin.simklApi.makeRequest({ url, method: 'GET', headers, priority: 'normal' })
        : await (await fetch(url)).json();

      // Try to extract Simkl ID from multiple possible structures
      let simklId: number | null = null;
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        const node = (item as Record<string, unknown>)?.movie || (item as Record<string, unknown>)?.show || item || {};
        const ids = (node as Record<string, unknown>).ids || (item as Record<string, unknown>)?.ids || {};
        const candidate = Number((ids as Record<string, unknown>).simkl || (ids as Record<string, unknown>).id);
        if (Number.isFinite(candidate) && candidate > 0) { 
          simklId = candidate; 
          break; 
        }
      }

      if (simklId) {
        this.plugin.cache.set(cacheKey, simklId, { 
          scope: 'mediaDetails', 
          source: 'simkl', 
          tags: ['simkl','resolve','external', type] 
        });
        return simklId;
      }
    } catch {}

    // Fallback: try type-specific endpoints if available
    try {
      const endpoint = (mediaType === 'MOVIE' || mediaType === 'MOVIES') ? 'movie' : 'tv';
      const idPart = tmdbId ? `tmdb/${encodeURIComponent(String(tmdbId))}` : `imdb/${encodeURIComponent(String(imdbId))}`;
      const url = `https://api.simkl.com/${endpoint}/${idPart}${this.plugin.settings.simklClientId ? `?client_id=${this.plugin.settings.simklClientId}` : ''}`;
      const headers = this.plugin.simklApi?.getHeaders ? this.plugin.simklApi.getHeaders({ type: 'search' }) : { 'Accept': 'application/json' };
      const data = this.plugin.simklApi && this.plugin.simklApi.makeRequest
        ? await this.plugin.simklApi.makeRequest({ url, method: 'GET', headers, priority: 'normal' })
        : await (await fetch(url)).json();
      const ids = (data as Record<string, unknown>)?.ids || {};
      const simklId = Number((ids as Record<string, unknown>).simkl || (ids as Record<string, unknown>).id);
      if (Number.isFinite(simklId) && simklId > 0) {
        this.plugin.cache.set(cacheKey, simklId, { 
          scope: 'mediaDetails', 
          source: 'simkl', 
          tags: ['simkl','resolve','external', endpoint] 
        });
        return simklId;
      }
    } catch {}

    return null;
  }

  // Helper: resolve IMDb id from TMDb external_ids
  async fetchImdbIdFromTmdb(tmdbId: number, mediaType: MediaTypeString): Promise<string | null> {
    if (!tmdbId) return null;
    const key = this.plugin.settings.tmdbApiKey;
    if (!key) return null;
    const typePath = (mediaType === 'MOVIE' || mediaType === 'MOVIES') ? 'movie' : 'tv';
    const url = `https://api.themoviedb.org/3/${typePath}/${tmdbId}/external_ids?api_key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as Record<string, unknown>;
      const imdb = data?.imdb_id || data?.imdb || null;
      return imdb ? String(imdb) : null;
    } catch {
      return null;
    }
  }
}

export { DetailPanelSource };
