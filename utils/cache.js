// Prune Cache 

export function pruneCache() {
  const now = Date.now();
  
  // Prune user data cache
  for (const [key, entry] of this.cache.userData) {
    if (now - entry.timestamp > this.cacheTimeout) {
      this.cache.userData.delete(key);
    }
  }
  
  // Prune media data cache
  for (const [key, entry] of this.cache.mediaData) {
    if (now - entry.timestamp > this.cacheTimeout) {
      this.cache.mediaData.delete(key);
    }
  }
  
  // Prune search results cache
  for (const [key, entry] of this.cache.searchResults) {
    if (now - entry.timestamp > this.cacheTimeout) {
      this.cache.searchResults.delete(key);
    }
  }
  
  console.log('[Zoro] Cache pruned');
}

export function getFromCache(type, key) {
  const cacheMap = this.cache[type];
  if (!cacheMap) return null;
  
  const entry = cacheMap.get(key);
  if (!entry) return null;

  // Auto-prune expired entries on access
  if ((Date.now() - entry.timestamp) > this.cacheTimeout) {
    cacheMap.delete(key);
    return null;
  }
  return entry.value;
}

export function setToCache(type, key, value) {
  const cacheMap = this.cache[type];
  if (!cacheMap) return;
  
  cacheMap.set(key, {
    value,
    timestamp: Date.now()
  });
}

export function clearCacheForMedia(mediaId) {
  // Clear media-specific cache
  for (const [key] of this.cache.mediaData) {
    try {
      const parsedKey = JSON.parse(key);
      if (parsedKey.mediaId === mediaId || parsedKey.id === mediaId) {
        this.cache.mediaData.delete(key);
      }
    } catch {
      // Handle non-JSON keys
      if (key.includes(`mediaId":${mediaId}`) || key.includes(`"id":${mediaId}`)) {
        this.cache.mediaData.delete(key);
      }
    }
  }
  
  // Clear user lists cache (since they contain this media)
  this.cache.userData.clear();
  
  console.log(`[Zoro] Cleared cache for media ${mediaId}`);
}