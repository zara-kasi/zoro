/**
 * APISourceHelper
 * Migrated from APISourceHelper.js → APISourceHelper.ts
 * - Added strict typing for plugin, API interfaces, and method parameters
 * - Created interfaces for media entries, configurations, and API responses
 * - Added type guards for source validation and data structure detection
 * - Preserved all source detection and API routing logic
 */

import type { Notice } from 'obsidian';

type MediaSource = 'anilist' | 'mal' | 'simkl';
type MediaType = 'ANIME' | 'TV' | 'MOVIE';

interface ZoroMeta {
  source?: string;
  mediaType?: string;
}

interface MediaTitle {
  english?: string;
  romaji?: string;
  native?: string;
}

interface Genre {
  name?: string;
  [key: string]: unknown;
}

interface Media {
  id?: number;
  idMal?: number;
  mal_id?: number;
  simkl_id?: number;
  title?: MediaTitle | string;
  type?: string;
  format?: string;
  episodes?: number;
  genres?: Genre[] | string[];
  siteUrl?: string;
}

interface User {
  siteUrl?: string;
  joined_at?: string;
}

interface ShowIds {
  simkl?: number;
  [key: string]: unknown;
}

interface Show {
  ids?: ShowIds;
  title?: string;
  year?: number;
  type?: string;
}

interface Node {
  id?: number;
  title?: string;
  main_picture?: unknown;
}

interface MediaEntry {
  _zoroMeta?: ZoroMeta;
  media?: Media;
  user?: User;
  show?: Show;
  node?: Node;
  ranking?: unknown;
  user_stats?: unknown;
  anime?: unknown;
  [key: string]: unknown;
}

interface SearchConfig {
  source?: string;
  mediaType?: string;
  type?: string;
  search?: string;
  query?: string;
  page?: number;
  perPage?: number;
  [key: string]: unknown;
}

interface MediaListUpdates {
  [key: string]: unknown;
}

interface API {
  fetchAniListData?: (config: SearchConfig) => Promise<unknown>;
  fetchMALData?: (config: SearchConfig) => Promise<unknown>;
  fetchSimklData?: (config: SearchConfig) => Promise<unknown>;
  updateMediaListEntry: (mediaId: number | string, updates: MediaListUpdates, mediaType?: string) => Promise<unknown>;
}

interface PluginSettings {
  accessToken?: string;
  malAccessToken?: string;
  simklAccessToken?: string;
}

interface ZoroPlugin {
  settings: PluginSettings;
  api: API;
  malApi: API;
  simklApi: API;
  getMALUrl?: (id: number | string, mediaType?: string) => string | undefined;
  getSimklUrl?: (id: number | string, mediaType?: string) => string | undefined;
  getAniListUrl?: (id: number | string, mediaType?: string) => string | undefined;
  getSourceSpecificUrl: (id: number | string, mediaType?: string, source?: string) => string | undefined;
}

function isValidMediaSource(source: unknown): source is MediaSource {
  return typeof source === 'string' && 
    ['anilist', 'mal', 'simkl'].includes(source.toLowerCase());
}

function isValidMediaType(type: unknown): type is MediaType {
  return typeof type === 'string' && 
    ['ANIME', 'TV', 'MOVIE'].includes(type.toUpperCase());
}

export class APISourceHelper {
  private plugin: ZoroPlugin;

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
  }

  getAPI(source: string | undefined): API {
    const normalizedSource = source?.toLowerCase();
    
    switch(normalizedSource) {
      case 'mal': 
        return this.plugin.malApi;
      case 'simkl': 
        return this.plugin.simklApi;
      case 'anilist':
      default: 
        return this.plugin.api;
    }
  }

  isAuthenticated(source: string | undefined): boolean {
    const normalizedSource = source?.toLowerCase();
    
    switch(normalizedSource) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'simkl':
        return !!this.plugin.settings.simklAccessToken;
      case 'anilist':
      default:
        return !!this.plugin.settings.accessToken;
    }
  }

  getSourceUrl(id: number | string, mediaType?: string, source?: string): string | undefined {
    const normalizedSource = source?.toLowerCase();
    
    switch(normalizedSource) {
      case 'mal':
        return this.plugin.getMALUrl?.(id, mediaType);
      case 'simkl':
        return this.plugin.getSimklUrl?.(id, mediaType);
      case 'anilist':
      default:
        return this.plugin.getAniListUrl?.(id, mediaType);
    }
  }

  async fetchSearchData(config: SearchConfig, term: string): Promise<unknown> {
    const normalizedSource = config.source?.toLowerCase();
    
    if (normalizedSource === 'mal') {
      return await this.plugin.malApi.fetchMALData?.({ 
        ...config, 
        type: 'search',
        search: term, 
        query: term,
        page: 1, 
        perPage: 5 
      });
    } else if (normalizedSource === 'simkl') {
      return await this.plugin.simklApi.fetchSimklData?.({ 
        ...config, 
        type: 'search',
        search: term, 
        query: term,
        page: 1, 
        perPage: 5 
      });
    } else {
      return await this.plugin.api.fetchAniListData?.({ 
        ...config, 
        type: 'search',
        search: term, 
        page: 1, 
        perPage: 5 
      });
    }
  }

  async updateMediaListEntry(
    mediaId: number | string, 
    updates: MediaListUpdates, 
    source?: string, 
    mediaType?: string
  ): Promise<unknown> {
    const api = this.getAPI(source);
    if ((source || '').toLowerCase() === 'simkl') {
      return await api.updateMediaListEntry(mediaId, updates, mediaType);
    }
    return await api.updateMediaListEntry(mediaId, updates);
  }

  getSourceSpecificUrl(id: number | string, mediaType?: string, source?: string): string | undefined {
    return this.plugin.getSourceSpecificUrl(id, mediaType, source);
  }

  detectSource(entry?: MediaEntry | null, config?: SearchConfig | null): MediaSource {
    // 1. Check existing metadata first
    if (entry?._zoroMeta?.source) {
      const validatedSource = this.validateAndReturnSource(entry._zoroMeta.source);
      if (validatedSource) return validatedSource;
    }
    
    // 2. Try config source
    if (config?.source) {
      const validatedSource = this.validateAndReturnSource(config.source);
      if (validatedSource) return validatedSource;
    }
    
    // 3. Detect from data structure patterns
    const detectedSource = this.detectFromDataStructure(entry);
    if (detectedSource) {
      return detectedSource;
    }
    
    // 4. Fallback to best available source
    return this.getFallbackSource();
  }

  private detectFromDataStructure(entry?: MediaEntry | null): MediaSource | null {
    if (!entry || typeof entry !== 'object') return null;
    
    // AniList patterns
    if (entry.media?.siteUrl?.includes('anilist.co') ||
        entry.user?.siteUrl?.includes('anilist.co') ||
        (entry.media?.idMal !== undefined && !entry.media?.simkl_id) ||
        (entry.media?.id && entry.media?.title && entry.media?.type && !entry.media?.simkl_id)) {
      return 'anilist';
    }
    
    // MAL patterns  
    if (entry.node?.main_picture ||
        entry.ranking ||
        entry.media?.mal_id ||
        entry.user?.joined_at ||
        (entry.node?.id && entry.node?.title)) {
      return 'mal';
    }
    
    // SIMKL patterns
    if (entry.show?.ids?.simkl ||
        entry.user_stats ||
        entry.media?.simkl_id ||
        (entry.show?.title && entry.show?.year)) {
      return 'simkl';
    }
    
    return null;
  }

  private validateAndReturnSource(source: string): MediaSource | null {
    const normalizedSource = source?.toLowerCase();
    
    if (isValidMediaSource(normalizedSource)) {
      return normalizedSource;
    }
    
    return null;
  }

  private getFallbackSource(): MediaSource {
    // Return first available authenticated source, or default to anilist
    if (this.isAuthenticated('mal')) return 'mal';
    if (this.isAuthenticated('simkl')) return 'simkl'; 
    if (this.isAuthenticated('anilist')) return 'anilist';
    return 'anilist';
  }

  detectMediaType(entry?: MediaEntry | null, config?: SearchConfig | null, media?: Media | null): MediaType {
    if (entry?._zoroMeta?.mediaType && isValidMediaType(entry._zoroMeta.mediaType)) {
      return entry._zoroMeta.mediaType as MediaType;
    }
    
    if (config?.mediaType && isValidMediaType(config.mediaType)) {
      return config.mediaType as MediaType;
    }
    
    if (media?.format === 'MOVIE') return 'MOVIE';
    
    // Better logic for distinguishing between ANIME and TV
    // Check if it's explicitly marked as anime or has anime-specific properties
    if (media?.format === 'TV' || media?.type === 'TV' || 
        (media?.genres && this.hasAnimeGenre(media.genres))) {
      return 'TV';
    }
    
    // If it has episodes but no clear indication, check the source
    if (media?.episodes) {
      // For Simkl sources, check if it's in the anime category
      if (entry?.show?.type === 'anime' || entry?.anime) {
        return 'ANIME';
      }
      // Default to TV for shows with episodes unless explicitly anime
      return 'TV';
    }
    
    return 'TV';
  }

  private hasAnimeGenre(genres: Genre[] | string[]): boolean {
    if (!Array.isArray(genres)) return false;
    
    return genres.some(g => {
      if (typeof g === 'string') {
        return g.toLowerCase().includes('anime');
      }
      if (typeof g === 'object' && g?.name) {
        return g.name.toLowerCase().includes('anime');
      }
      return false;
    });
  }
}
