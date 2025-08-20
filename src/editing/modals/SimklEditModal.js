const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

class SimklEditModal {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async initializeFavoriteButton(entry, favBtn) {
    favBtn.style.display = 'none';
  }

  async toggleFavorite(entry, favBtn) {
    return;
  }

  async updateEntry(entry, updates, onSave) {
    console.log('[Simkl][Edit] updateEntry called', { entry, updates });
    const mediaId = entry.media?.id || entry.mediaId;
    console.log('[Simkl][Edit] raw mediaId', mediaId);
    if (!mediaId) throw new Error('Media ID not found');
    const mediaType = entry._zoroMeta?.mediaType || (entry.media?.format === 'MOVIE' ? 'MOVIE' : 'TV');
    console.log('[Simkl][Edit] mediaType', mediaType);
    console.log('[Simkl][Edit] calling updateMediaListEntry', { mediaId, updates, mediaType });
    await this.plugin.simklApi.updateMediaListEntry(mediaId, updates, mediaType);
    console.log('[Simkl][Edit] updateEntry done');
    await onSave(updates);
    Object.assign(entry, updates);
    return entry;
  }

  async removeEntry(entry) {
    console.log('[Simkl][Edit] removeEntry called', entry);
    const mediaId = entry.media?.id || entry.mediaId;
    console.log('[Simkl][Edit] raw mediaId', mediaId);
    if (!mediaId) throw new Error('Media ID not found');
    const mediaType = entry._zoroMeta?.mediaType || (entry.media?.format === 'MOVIE' ? 'MOVIE' : 'TV');
    console.log('[Simkl][Edit] mediaType', mediaType);
    await this.plugin.simklApi.removeMediaListEntry(mediaId, mediaType);
    console.log('[Simkl][Edit] removeEntry done');
  }

  invalidateCache(entry) {
    if (entry.media?.id) {
      this.plugin.cache.invalidateByMedia(entry.media.id);
    }
    this.plugin.cache.invalidateScope?.('userData');
  }

  supportsFeature(feature) {
    return ['update', 'remove'].includes(feature);
  }
}

export { SimklEditModal };