class MALEditModal {
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
  const mediaId = entry.media?.id || entry.mediaId;
  const mediaType = this.detectMediaType(entry);
  
  if (!mediaId) {
    throw new Error('Media ID not found');
  }

  const malUpdates = {};
  
  if (updates.status !== undefined) {
    malUpdates.status = updates.status;
  }
  
  if (updates.score !== undefined) {
    malUpdates.score = updates.score === null ? 0 : updates.score;
  }
  
  if (updates.progress !== undefined) {
    malUpdates.progress = updates.progress;
  }

  let updatedEntry;
  
  try {
    updatedEntry = await this.plugin.malApi.updateMediaListEntry(mediaId, malUpdates);
    
    await onSave(updatedEntry);
    Object.assign(entry, updatedEntry);
    
    return entry;
  } catch (error) {
    if (error.message?.includes('No valid updates provided')) {
      throw new Error('No changes to save');
    }
    if (error.message?.includes('invalidateScope is not a function')) {
      console.warn('Cache cleanup failed:', error.message);
      if (updatedEntry) {
        await onSave(updatedEntry);
        Object.assign(entry, updatedEntry);
        return entry;
      }
    }
    throw new Error(`MAL update failed: ${error.message}`);
  }
}

  async removeEntry(entry) {
    throw new Error('MAL does not support removing entries via API');
  }

  invalidateCache(entry) {
    if (entry.media?.id) {
      this.plugin.cache.invalidateByMedia(String(entry.media.id));
    }
    this.plugin.cache.invalidateScope('userData');
  }

  updateAllFavoriteButtons(entry) {
    // MAL doesn't have favorites
  }

  supportsFeature(feature) {
    return ['update'].includes(feature);
  }

  detectMediaType(entry) {
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
    if (entry.media?.episodes !== undefined || entry.media?.episodes !== null) {
      return 'anime';
    } else if (entry.media?.chapters !== undefined || entry.media?.chapters !== null) {
      return 'manga';
    }
    
    // Default fallback
    return 'anime';
  }
}

export { MALEditModal };