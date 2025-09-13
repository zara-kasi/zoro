/**
 * AniListEditModal - AniList-specific edit operations
 * Migrated from AniListEditModal.js → AniListEditModal.ts
 * - Added Plugin typing from obsidian
 * - Typed method parameters and GraphQL response structures
 * - Added interfaces for entry data and API responses
 */
import { Notice, requestUrl } from 'obsidian';
import type { Plugin, RequestUrlResponse } from 'obsidian';

// Core interfaces
interface MediaEntry {
  id: number;
  media: {
    id: number;
    type?: 'ANIME' | 'MANGA';
    isFavourite?: boolean;
  };
  status?: string;
  score?: number;
  progress?: number;
  [key: string]: unknown;
}

interface AniListMediaResponse {
  data?: {
    Media?: {
      isFavourite: boolean;
      type: 'ANIME' | 'MANGA';
    };
  };
  errors?: Array<{ message: string }>;
}

interface ToggleFavoriteResponse {
  data?: {
    ToggleFavourite: {
      anime: { nodes: Array<{ id: number }> };
      manga: { nodes: Array<{ id: number }> };
    };
  };
  errors?: Array<{ message: string }>;
}

interface DeleteEntryResponse {
  data?: {
    DeleteMediaListEntry: { deleted: boolean };
  };
  errors?: Array<{ message: string }>;
}

interface PluginWithAniList extends Plugin {
  requestQueue: {
    add<T>(fn: () => Promise<T>): Promise<T>;
  };
  settings: {
    accessToken: string;
  };
  cache: {
    invalidateByMedia(mediaId: string): void;
  };
}

function isPluginWithAniList(plugin: Plugin): plugin is PluginWithAniList {
  return 'requestQueue' in plugin && 'settings' in plugin && 'cache' in plugin;
}

export class AniListEditModal {
  private plugin: PluginWithAniList;

  constructor(plugin: Plugin) {
    if (!isPluginWithAniList(plugin)) {
      throw new Error('Plugin must have requestQueue, settings, and cache properties for AniList integration');
    }
    this.plugin = plugin;
  }

  async initializeFavoriteButton(entry: MediaEntry, favBtn: HTMLButtonElement): Promise<void> {
    if (entry.media.isFavourite !== undefined) {
      favBtn.className = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      favBtn.disabled = false;
      return;
    }
    
    try {
      const query = `
        query ($mediaId: Int) {
          Media(id: $mediaId) { 
            isFavourite 
            type
          }
        }`;
      const res: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.plugin.settings.accessToken}`
          },
          body: JSON.stringify({ query, variables: { mediaId: entry.media.id } })
        })
      );
      const responseData = res.json as AniListMediaResponse;
      const mediaData = responseData.data?.Media;
      const fav = mediaData?.isFavourite;
      entry.media.isFavourite = fav;
      favBtn.className = fav ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      if (mediaData?.type) {
        favBtn.dataset.mediaType = mediaData.type;
      }
    } catch (e) {
      console.warn('Could not fetch favorite', e);
    }
  }

  async toggleFavorite(entry: MediaEntry, favBtn: HTMLButtonElement): Promise<void> {
    favBtn.disabled = true;
    const wasAlreadyFavorited = entry.media.isFavourite;
    
    try {
      let mediaType = favBtn.dataset.mediaType as 'ANIME' | 'MANGA' | undefined;
      if (!mediaType) {
        mediaType = entry.media.type || 'ANIME';
      }
      
      const isAnime = mediaType === 'ANIME';
      
      const mutation = `
        mutation ToggleFav($animeId: Int, $mangaId: Int) {
          ToggleFavourite(animeId: $animeId, mangaId: $mangaId) {
            anime { nodes { id } }
            manga { nodes { id } }
          }
        }`;
        
      const variables: { animeId?: number; mangaId?: number } = {};
      if (isAnime) {
        variables.animeId = entry.media.id;
      } else {
        variables.mangaId = entry.media.id;
      }

      const res: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.plugin.settings.accessToken}`
          },
          body: JSON.stringify({ query: mutation, variables })
        })
      );
      
      const responseData = res.json as ToggleFavoriteResponse;
      if (responseData.errors) {
        new Notice(`API Error: ${responseData.errors[0].message}`, 8000);
        throw new Error(responseData.errors[0].message);
      }
      
      const isFav = !wasAlreadyFavorited;
      
      entry.media.isFavourite = isFav;
      document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-heart`)
        .forEach((h: HTMLElement) => h.style.display = entry.media.isFavourite ? '' : 'none');
      
      this.invalidateCache(entry);
      this.updateAllFavoriteButtons(entry);
      
      favBtn.className = isFav ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      new Notice(`${isFav ? 'Added to' : 'Removed from'} favorites!`, 3000);
      
    } catch (e: any) {
      new Notice(`❌ Error: ${e.message || 'Unknown error'}`, 8000);
    } finally {
      favBtn.disabled = false;
    }
  }

  async updateEntry(entry: MediaEntry, updates: Record<string, unknown>, onSave?: (updatedEntry: MediaEntry) => void): Promise<MediaEntry> {
    if (onSave) {
      await onSave(updates as MediaEntry); // TODO: confirm onSave parameter type
    }
    Object.assign(entry, updates);
    return entry;
  }

  async removeEntry(entry: MediaEntry): Promise<void> {
    const mutation = `
      mutation ($id: Int) {
        DeleteMediaListEntry(id: $id) { deleted }
      }`;
    await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.plugin.settings.accessToken}`
        },
        body: JSON.stringify({ query: mutation, variables: { id: entry.id } })
      })
    );
  }

  invalidateCache(entry: MediaEntry): void {
    this.plugin.cache.invalidateByMedia(String(entry.media.id));
  }

  updateAllFavoriteButtons(entry: MediaEntry): void {
    document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-fav-btn`)
      .forEach((btn: HTMLButtonElement) => {
        btn.className = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      });
  }

  supportsFeature(feature: string): boolean {
    return ['favorites', 'remove', 'update'].includes(feature);
  }
}
