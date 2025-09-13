import { Notice } from 'obsidian';
import type { Plugin } from 'obsidian';

// Core interfaces
interface MediaEntry {
  id?: number;
  mediaId?: number;
  media?: {
    id: number;
    format?: string;
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

interface PluginWithSimkl extends Plugin {
  simklApi: {
    updateMediaListEntry(mediaId: number, updates: Record<string, unknown>, mediaType: string): Promise<void>;
    removeMediaListEntry(mediaId: number, mediaType: string): Promise<void>;
  };
  cache: {
    invalidateByMedia(mediaId: number): void;
    invalidateScope?(scope: string): void;
  };
}

function isPluginWithSimkl(plugin: Plugin): plugin is PluginWithSimkl {
  return 'simklApi' in plugin && 'cache' in plugin;
}

export class SimklEditModal {
  private plugin: PluginWithSimkl;

  constructor(plugin: Plugin) {
    if (!isPluginWithSimkl(plugin)) {
      throw new Error('Plugin must have simklApi and cache properties for Simkl integration');
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
    console.log('[Simkl][Edit] updateEntry called', { entry, updates });
    const mediaId = entry.media?.id || entry.mediaId;
    console.log('[Simkl][Edit] raw mediaId', mediaId);
    
    if (!mediaId) throw new Error('Media ID not found');
    
    const mediaType = entry._zoroMeta?.mediaType || (entry.media?.format === 'MOVIE' ? 'MOVIE' : 'TV');
    console.log('[Simkl][Edit] mediaType', mediaType);
    console.log('[Simkl][Edit] calling updateMediaListEntry', { mediaId, updates, mediaType });
    
    await this.plugin.simklApi.updateMediaListEntry(mediaId, updates, mediaType);
    console.log('[Simkl][Edit] updateEntry done');
    
    if (onSave) {
      await onSave(updates as MediaEntry); // TODO: confirm onSave parameter type
    }
    Object.assign(entry, updates);
    return entry;
  }

  async removeEntry(entry: MediaEntry): Promise<void> {
    console.log('[Simkl][Edit] removeEntry called', entry);
    const mediaId = entry.media?.id || entry.mediaId;
    console.log('[Simkl][Edit] raw mediaId', mediaId);
    
    if (!mediaId) throw new Error('Media ID not found');
    
    const mediaType = entry._zoroMeta?.mediaType || (entry.media?.format === 'MOVIE' ? 'MOVIE' : 'TV');
    console.log('[Simkl][Edit] mediaType', mediaType);
    
    await this.plugin.simklApi.removeMediaListEntry(mediaId, mediaType);
    console.log('[Simkl][Edit] removeEntry done');
  }

  invalidateCache(entry: MediaEntry): void {
    if (entry.media?.id) {
      this.plugin.cache.invalidateByMedia(entry.media.id);
    }
    this.plugin.cache.invalidateScope?.('userData');
  }

  supportsFeature(feature: string): boolean {
    return ['update', 'remove'].includes(feature);
  }
}
