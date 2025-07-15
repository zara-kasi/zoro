// CacheManager.js
export class CacheManager {
  constructor(cacheTimeout = 5 * 60 * 1000) {
    this.cacheTimeout = cacheTimeout;
    
    // Initialize separate caches
    this.cache = {
      userData: new Map(),     // User stats and lists
      mediaData: new Map(),    // Individual media items
      searchResults: new Map() // Search queries
    };
    
    // Add periodic pruning
    this.pruneInterval = setInterval(() => this.pruneCache(), this.cacheTimeout);
  }

  // Prune Cache 
  pruneCache() {
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

  // Get from cache 
  getFromCache(type, key) {
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

  setToCache(type, key, value) {
    const cacheMap = this.cache[type];
    if (!cacheMap) return;
    
    cacheMap.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  // Clear specific cache type
  clearCache(type) {
    if (this.cache[type]) {
      this.cache[type].clear();
    }
  }

  // Clear all caches
  clearAllCaches() {
    Object.values(this.cache).forEach(cache => cache.clear());
  }

  // Get cache stats
  getCacheStats() {
    return {
      userData: this.cache.userData.size,
      mediaData: this.cache.mediaData.size,
      searchResults: this.cache.searchResults.size
    };
  }

  // Cleanup method to clear interval
  destroy() {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    this.clearAllCaches();
  }
}