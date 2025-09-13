/**
 * MALEditModal - MyAnimeList-specific edit operations
 * Migrated from MALEditModal.js → MALEditModal.ts
 * - Added Plugin typing from obsidian
 * - Typed method parameters and MAL API structures
 * - Added interfaces for entry data and API responses
 */
import { Notice } from 'obsidian';
import type { Plugin } from 'obsidian';

// Core interfaces
interface MediaEntry {
  id?: number;
  mediaId?: number;
  media?: {
    id: number;
    type?: string;
    format?: string;
    episodes?: number;
    chapters?: number;
  };
  _zoroMeta?: {
    mediaType?: string;
    source?: string;
  };
  status?: string;
  score?: number;
  progress?: number;
  [key: string]: unknown;
}

interface MALUpdates {
  status?: string;
  score?: number;
  progress?: number;
}

interface PluginWithMAL extends Plugin {
  malApi: {
    updateMediaListEntry(mediaId: number, updates: MALUpdates): Promise<MediaEntry>;
  };
  cache: {
    invalidateByMedia(mediaId: string): void;
    invalidateScope(scope: string): void;
  };
}

function isPluginWithMAL(plugin: Plugin): plugin is PluginWithMAL {
  return 'malApi' in plugin && 'cache' in plugin;
}

export class MALEditModal {
  private plugin: PluginWithMAL;

  constructor(plugin: Plugin) {
    if (!isPluginWithMAL(plugin)) {
      throw new Error('Plugin must have malApi and cache properties for MAL integration');
    }
    this.plugin = plugin;
  }

  async initializeFavoriteButton(entry: MediaEntry, favBtn: HTMLButtonElement): Promise<void> {
    favBtn.style.display = 'none';
  }

  async toggleFavorite(entry: MediaEntry, favBtn: HTMLButtonElement): Promise<void> {
    return;
  }

  async updateEntry(entry: MediaEntry, updates: Record<string, unknown>, onSave?: (updatedEntry: MediaEntry) => void): Promise<MediaEntry> {
    const mediaId = entry.media?.id || entry.mediaId;
    const mediaType = this.detectMediaType(entry);
    
    if (!mediaId) {
      throw new Error('Media ID not found');
    }
    
    const malUpdates: MALUpdates = {};
    
    if (updates.status !== undefined) {
      malUpdates.status = updates.status as string;
    }
    
    if (updates.score !== undefined) {
      malUpdates.score = updates.score === null ? 0 : (updates.score as number);
    }
    
    if (updates.progress !== undefined) {
      malUpdates.progress = updates.progress as number;
    }
    
    let updatedEntry: MediaEntry;
    
    try {
      updatedEntry = await this.plugin.malApi.updateMediaListEntry(mediaId, malUpdates);
      
      if (onSave) {
        await onSave(updatedEntry);
      }
      Object.assign(entry, updatedEntry);
      
      return entry;
    } catch (error: any) {
      if (error.message?.includes('No valid updates provided')) {
        throw new Error('No changes to save');
      }
      if (error.message?.includes('invalidateScope is not a function')) {
        console.warn('Cache cleanup failed:', error.message);
        if (updatedEntry!) {
          if (onSave) {
            await onSave(updatedEntry);
          }
          Object.assign(entry, updatedEntry);
          return entry;
        }
      }
      throw new Error(`MAL update failed: ${error.message}`);
    }
  }

  async removeEntry(entry: MediaEntry): Promise<void> {
    throw new Error('MAL does not support removing entries via API');
  }

  invalidateCache(entry: MediaEntry): void {
    if (entry.media?.id) {
      this.plugin.cache.invalidateByMedia(String(entry.media.id));
    }
    this.plugin.cache.invalidateScope('userData');
  }

  updateAllFavoriteButtons(entry: MediaEntry): void {
    // MAL doesn't have favorites
  }

  supportsFeature(feature: string): boolean {
    return ['update'].includes(feature);
  }

  private detectMediaType(entry: MediaEntry): string {
    // Try multiple ways to determine media type for MAL API
    if (entry._zoroMeta?.mediaType) {
      return entry._zoroMeta.mediaType.toLowerCase();
    }
    
    if (entry.media?.type) {
      return entry.media.type.toLowerCase();
    }
    
    // Check media format
    if (entry.media?.format) {
      const format = entry.media.format.toLowerCase();
      if (['tv', 'movie', 'ova', 'ona', 'special', 'music'].includes(format)) {
        return 'anime';
      }
      if (['manga', 'novel', 'one_shot'].includes(format)) {
        return 'manga';
      }
    }
    
    // Fall back to checking for episodes vs chapters
    if (entry.media?.episodes !== undefined && entry.media?.episodes !== null) {
      return 'anime';
    } else if (entry.media?.chapters !== undefined && entry.media?.chapters !== null) {
      return 'manga';
    }
    
    // Default fallback
    return 'anime';
  }
}
