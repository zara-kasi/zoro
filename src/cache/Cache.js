class Cache {
  constructor(config = {}) {
    const {
      ttlMap = {},
      obsidianPlugin = null,
      maxSize = 10000,
      compressionThreshold = 1024,
      batchSize = 100
    } = config;

    this.ttlMap = {
  userData: 30 * 60 * 1000,     // 30 minutes for ALL APIs
  mediaData: 10 * 60 * 1000,    // 10 minutes for ALL APIs  
  searchResults: 2 * 60 * 1000, // 2 minutes for ALL APIs
  mediaDetails: 60 * 60 * 1000  // 1 hour for ALL APIs
};
    
    this.stores = {};
    this.indexes = { byUser: new Map(), byMedia: new Map(), byTag: new Map() };
    this.apiSources = ['anilist', 'mal', 'simkl'];
    
    this.version = '3.2.0';
    this.maxSize = maxSize;
    this.compressionThreshold = compressionThreshold;
    this.batchSize = batchSize;
    this.obsidianPlugin = obsidianPlugin;
    
    this.intervals = { prune: null, refresh: null, save: null };
    this.flags = { autoPrune: false, backgroundRefresh: false };
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, evictions: 0, compressions: 0 };
    this.state = { loading: false, saving: false, lastSaved: null, lastLoaded: null };
    
    this.accessLog = new Map();
    this.refreshCallbacks = new Map();
    this.loadQueue = new Set();
    this.saveQueue = new Set();
    
    this.persistenceQueue = new Set();
    this.lastPersistTime = 0;
    this.saveDebounceTimer = null;
    this.criticalSaveMode = false;
    
    this.initializeStores();
    
    if (this.obsidianPlugin) {
      this.initializeCache();
    }
  }

  initializeStores() {
    this.apiSources.forEach(api => {
      this.stores[`${api}:userData`] = new Map();
      this.stores[`${api}:mediaData`] = new Map();
      this.stores[`${api}:searchResults`] = new Map();
    });
    
    this.stores.userData = new Map();
    this.stores.mediaData = new Map();
    this.stores.searchResults = new Map();
  }



  async initializeCache() {
    try {
      await this.loadFromDisk();
      this.startIncrementalSave(30000);
      this.startAutoPrune(300000);
    } catch (error) {
      this.log('INIT_ERROR', 'system', '', error.message);
    }
  }

  key(input) {
    if (typeof input === 'string') return input;
    if (!input || typeof input !== 'object') return String(input);
    
    const normalized = {};
    Object.keys(input).sort().forEach(k => {
      const val = input[k];
      normalized[k] = val !== null && val !== undefined ? val : '';
    });
    return JSON.stringify(normalized);
  }

  structuredKey(scope, type, id, meta = {}) {
    return this.key({ __scope: scope, __type: type, __id: String(id), ...meta });
  }

  compositeScope(scope, source) {
    if (!source) return scope;
    return `${source}:${scope}`;
  }

  parseCompositeScope(compositeScope) {
    const parts = compositeScope.split(':');
    if (parts.length >= 2 && this.apiSources.includes(parts[0])) {
      return { source: parts[0], scope: parts.slice(1).join(':') };
    }
    return { source: null, scope: compositeScope };
  }

  getStore(scope, source = null) {
    const compositeScope = this.compositeScope(scope, source);
    return this.stores[compositeScope] || this.stores[scope];
  }

  getTTL(scope, source = null, customTtl = null) {
    if (customTtl !== null) return customTtl;
    
    const compositeScope = this.compositeScope(scope, source);
    return this.ttlMap[compositeScope] || this.ttlMap[scope] || 5 * 60 * 1000;
  }

  isExpired(entry, scope, source = null, customTtl = null) {
    const ttl = customTtl ?? entry.customTtl ?? this.getTTL(scope, source);
    return (Date.now() - entry.timestamp) > ttl;
  }

  compress(data) {
    const str = JSON.stringify(data);
    if (str.length < this.compressionThreshold) return { data, compressed: false };
    
    try {
      const compressed = this.simpleCompress(str);
      this.stats.compressions++;
      return { data: compressed, compressed: true, originalSize: str.length };
    } catch {
      return { data, compressed: false };
    }
  }

  decompress(entry) {
    if (!entry.compressed) return entry.data;
    try {
      return JSON.parse(this.simpleDecompress(entry.data));
    } catch {
      return entry.data;
    }
  }

  simpleCompress(str) {
    return btoa(encodeURIComponent(str)).replace(/[+/=]/g, m => ({ '+': '-', '/': '_', '=': '' }[m] || m));
  }

  simpleDecompress(compressed) {
    const restored = compressed.replace(/[-_]/g, m => ({ '-': '+', '_': '/' }[m]));
    const padded = restored + '='.repeat((4 - restored.length % 4) % 4);
    return decodeURIComponent(atob(padded));
  }

  updateIndexes(key, entry, operation = 'set') {
    try {
      const parsed = JSON.parse(key);
      const { __scope: scope, userId, username, mediaId, tags } = parsed;
      
      if (operation === 'delete') {
        this.removeFromIndexes(key, { userId, username, mediaId, tags });
        return;
      }

      if (userId || username) {
        const userKey = userId || username;
        if (!this.indexes.byUser.has(userKey)) this.indexes.byUser.set(userKey, new Set());
        this.indexes.byUser.get(userKey).add(key);
      }

      if (mediaId) {
        if (!this.indexes.byMedia.has(mediaId)) this.indexes.byMedia.set(mediaId, new Set());
        this.indexes.byMedia.get(mediaId).add(key);
      }

      if (tags && Array.isArray(tags)) {
        tags.forEach(tag => {
          if (!this.indexes.byTag.has(tag)) this.indexes.byTag.set(tag, new Set());
          this.indexes.byTag.get(tag).add(key);
        });
      }
    } catch {}
  }

  removeFromIndexes(key, { userId, username, mediaId, tags }) {
    const userKey = userId || username;
    if (userKey && this.indexes.byUser.has(userKey)) {
      this.indexes.byUser.get(userKey).delete(key);
      if (this.indexes.byUser.get(userKey).size === 0) this.indexes.byUser.delete(userKey);
    }

    if (mediaId && this.indexes.byMedia.has(mediaId)) {
      this.indexes.byMedia.get(mediaId).delete(key);
      if (this.indexes.byMedia.get(mediaId).size === 0) this.indexes.byMedia.delete(mediaId);
    }

    if (tags && Array.isArray(tags)) {
      tags.forEach(tag => {
        if (this.indexes.byTag.has(tag)) {
          this.indexes.byTag.get(tag).delete(key);
          if (this.indexes.byTag.get(tag).size === 0) this.indexes.byTag.delete(tag);
        }
      });
    }
  }

  enforceSize(scope, source = null) {
    const store = this.getStore(scope, source);
    if (!store || store.size <= this.maxSize) return 0;

    const entries = Array.from(store.entries())
      .map(([key, entry]) => ({ key, entry, lastAccess: this.accessLog.get(key) || 0 }))
      .sort((a, b) => a.lastAccess - b.lastAccess);

    const toEvict = entries.slice(0, store.size - this.maxSize + this.batchSize);
    toEvict.forEach(({ key }) => {
      store.delete(key);
      this.updateIndexes(key, null, 'delete');
      this.accessLog.delete(key);
      this.stats.evictions++;
    });

    this.schedulePersistence();
    return toEvict.length;
  }

  get(key, options = {}) {
    const { scope = 'userData', source = null, ttl = null, refreshCallback = null } = options;
    const store = this.getStore(scope, source);
    
    if (!store) { 
      this.stats.misses++; 
      return null; 
    }

    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    const entry = store.get(cacheKey);
    
    this.accessLog.set(cacheKey, Date.now());
    
    if (!entry) {
      this.stats.misses++;
      this.log('MISS', this.compositeScope(scope, source), cacheKey);
      this.maybeRefresh(cacheKey, scope, source, refreshCallback);
      return null;
    }

    if (this.isExpired(entry, scope, source, ttl)) {
      store.delete(cacheKey);
      this.updateIndexes(cacheKey, entry, 'delete');
      this.stats.misses++;
      this.log('EXPIRED', this.compositeScope(scope, source), cacheKey);
      this.maybeRefresh(cacheKey, scope, source, refreshCallback);
      this.schedulePersistence();
      return null;
    }

    this.stats.hits++;
    const age = Math.round((Date.now() - entry.timestamp) / 1000);
    this.log('HIT', this.compositeScope(scope, source), cacheKey, `${age}s old`);
    
    if (this.shouldRefresh(entry, scope, source, ttl)) {
      const callbackKey = `${this.compositeScope(scope, source)}:${cacheKey}`;
      const callback = this.refreshCallbacks.get(callbackKey);
      if (callback) this.scheduleRefresh(cacheKey, scope, source, callback);
    }

    return this.decompress(entry);
  }

  set(key, value, options = {}) {
    const { scope = 'userData', source = null, ttl = null, tags = [], refreshCallback = null } = options;
    const store = this.getStore(scope, source);
    
    if (!store) return false;

    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    const compressed = this.compress(value);
    
    const entry = {
      ...compressed,
      timestamp: Date.now(),
      customTtl: ttl,
      tags,
      accessCount: 1,
      source: source
    };

    store.set(cacheKey, entry);
    this.updateIndexes(cacheKey, entry);
    this.enforceSize(scope, source);
    
    this.stats.sets++;
    this.log('SET', this.compositeScope(scope, source), cacheKey, store.size);

    if (refreshCallback) {
      const callbackKey = `${this.compositeScope(scope, source)}:${cacheKey}`;
      this.refreshCallbacks.set(callbackKey, refreshCallback);
    }

    this.schedulePersistence(true);
    return true;
  }

  delete(key, options = {}) {
    const { scope = 'userData', source = null } = options;
    const store = this.getStore(scope, source);
    
    if (!store) return false;

    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    const entry = store.get(cacheKey);
    const deleted = store.delete(cacheKey);
    
    if (deleted) {
      this.updateIndexes(cacheKey, entry, 'delete');
      this.accessLog.delete(cacheKey);
      this.stats.deletes++;
      this.log('DELETE', this.compositeScope(scope, source), cacheKey);
      this.schedulePersistence();
    }
    
    return deleted;
  }

  invalidateByUser(userKey, options = {}) {
    const { source = null } = options;
    const keys = this.indexes.byUser.get(userKey);
    if (!keys) return 0;

    let deleted = 0;
    const storesToSearch = source ? 
      Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`)) :
      Object.entries(this.stores);

    keys.forEach(key => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      this.accessLog.delete(key);
    });

    if (!source) {
      this.indexes.byUser.delete(userKey);
    }
    
    this.log('INVALIDATE_USER', source || 'all', userKey, `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
  }

  invalidateByMedia(mediaId, options = {}) {
    const { source = null } = options;
    const keys = this.indexes.byMedia.get(String(mediaId));
    if (!keys) return 0;

    let deleted = 0;
    const storesToSearch = source ? 
      Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`)) :
      Object.entries(this.stores);

    keys.forEach(key => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      this.accessLog.delete(key);
    });

    if (!source) {
      this.indexes.byMedia.delete(String(mediaId));
    }
    
    this.log('INVALIDATE_MEDIA', source || 'all', String(mediaId), `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
  }

  invalidateByTag(tag, options = {}) {
    const { source = null } = options;
    const keys = this.indexes.byTag.get(tag);
    if (!keys) return 0;

    let deleted = 0;
    const storesToSearch = source ? 
      Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`)) :
      Object.entries(this.stores);

    keys.forEach(key => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      this.accessLog.delete(key);
    });

    if (!source) {
      this.indexes.byTag.delete(tag);
    }
    
    this.log('INVALIDATE_TAG', source || 'all', tag, `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
  }

  clearBySource(source) {
    let total = 0;
    Object.entries(this.stores).forEach(([scopeName, store]) => {
      if (scopeName.startsWith(`${source}:`)) {
        total += store.size;
        store.clear();
      }
    });
    
    Object.values(this.indexes).forEach(index => {
      for (const [key, keySet] of index.entries()) {
        const filteredKeys = Array.from(keySet).filter(cacheKey => {
          try {
            const parsed = JSON.parse(cacheKey);
            return parsed.__source !== source;
          } catch {
            return true;
          }
        });
        
        if (filteredKeys.length === 0) {
          index.delete(key);
        } else if (filteredKeys.length !== keySet.size) {
          index.set(key, new Set(filteredKeys));
        }
      }
    });
    
    this.log('CLEAR_SOURCE', source, '', `${total} entries`);
    this.schedulePersistence();
    return total;
  }

  clear(scope = null) {
    if (scope) {
      const store = this.stores[scope];
      if (!store) return 0;
      const count = store.size;
      store.clear();
      this.schedulePersistence();
      return count;
    }

    let total = 0;
    Object.values(this.stores).forEach(store => {
      total += store.size;
      store.clear();
    });
    
    Object.values(this.indexes).forEach(index => index.clear());
    this.accessLog.clear();
    this.refreshCallbacks.clear();
    
    this.log('CLEAR_ALL', 'all', '', total);
    this.schedulePersistence();
    return total;
  }

  pruneExpired(scope = null, source = null) {
    const scopesToPrune = scope ? [scope] : ['userData', 'mediaData', 'searchResults'];
    const sourcesToPrune = source ? [source] : [null, ...this.apiSources];
    
    let total = 0;
    const now = Date.now();

    scopesToPrune.forEach(currentScope => {
      sourcesToPrune.forEach(currentSource => {
        const store = this.getStore(currentScope, currentSource);
        if (!store) return;

        const toDelete = [];
        for (const [key, entry] of store.entries()) {
          if (this.isExpired(entry, currentScope, currentSource)) {
            toDelete.push(key);
          }
        }

        toDelete.forEach(key => {
          const entry = store.get(key);
          store.delete(key);
          this.updateIndexes(key, entry, 'delete');
          this.accessLog.delete(key);
          total++;
        });
      });
    });

    if (total > 0) {
      this.schedulePersistence();
    }
    return total;
  }

  shouldRefresh(entry, scope, source = null, customTtl = null) {
    if (!this.flags.backgroundRefresh) return false;
    const ttl = this.getTTL(scope, source, customTtl);
    return (Date.now() - entry.timestamp) > (ttl * 0.8);
  }

  maybeRefresh(key, scope, source, callback) {
    if (callback && typeof callback === 'function') {
      this.scheduleRefresh(key, scope, source, callback);
    }
  }

  scheduleRefresh(key, scope, source, callback) {
    const refreshKey = `${this.compositeScope(scope, source)}:${key}`;
    if (this.loadQueue.has(refreshKey)) return;
    
    this.loadQueue.add(refreshKey);
    
    setTimeout(async () => {
      try {
        const newValue = await callback(key, scope, source);
        if (newValue !== undefined) {
          this.set(key, newValue, { scope, source, refreshCallback: callback });
        }
      } catch (error) {
        this.log('REFRESH_ERROR', this.compositeScope(scope, source), key, error.message);
      } finally {
        this.loadQueue.delete(refreshKey);
      }
    }, 0);
  }
  schedulePersistence(immediate = false) {
    if (immediate) {
      this.criticalSaveMode = true;
    }

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    const delay = immediate ? 100 : 2000;
    this.saveDebounceTimer = setTimeout(() => {
      this.saveToDisk();
    }, delay);
  }

  startAutoPrune(interval = 5 * 60 * 1000) {
    this.stopAutoPrune();
    this.intervals.prune = setInterval(() => {
      const pruned = this.pruneExpired();
      if (pruned > 0) {
        this.log('AUTO_PRUNE', 'system', '', `${pruned} entries pruned`);
      }
    }, interval);
    this.flags.autoPrune = true;
    return this;
  }

  stopAutoPrune() {
    if (this.intervals.prune) {
      clearInterval(this.intervals.prune);
      this.intervals.prune = null;
    }
    this.flags.autoPrune = false;
    return this;
  }

  startBackgroundRefresh(interval = 10 * 60 * 1000) {
    this.flags.backgroundRefresh = true;
    return this;
  }

  stopBackgroundRefresh() {
    this.flags.backgroundRefresh = false;
    return this;
  }

  startIncrementalSave(interval = 30 * 1000) {
    this.stopIncrementalSave();
    this.intervals.save = setInterval(() => {
      if (Date.now() - this.lastPersistTime > interval / 2) {
        this.saveToDisk();
      }
    }, interval);
    return this;
  }

  stopIncrementalSave() {
    if (this.intervals.save) {
      clearInterval(this.intervals.save);
      this.intervals.save = null;
    }
    return this;
  }

  async saveToDisk() {
    if (this.state.saving) return false;
    this.state.saving = true;

    try {
      const payload = {
        version: this.version,
        timestamp: Date.now(),
        stats: { ...this.stats },
        data: {},
        indexes: {
          byUser: Array.from(this.indexes.byUser.entries()).map(([k, v]) => [k, Array.from(v)]),
          byMedia: Array.from(this.indexes.byMedia.entries()).map(([k, v]) => [k, Array.from(v)]),
          byTag: Array.from(this.indexes.byTag.entries()).map(([k, v]) => [k, Array.from(v)])
        },
        accessLog: Array.from(this.accessLog.entries())
      };

      for (const [scope, store] of Object.entries(this.stores)) {
        payload.data[scope] = Array.from(store.entries());
      }

      let saved = false;

      if (this.obsidianPlugin?.app?.vault?.adapter) {
        try {
          const adapter = this.obsidianPlugin.app.vault.adapter;
          const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
          const cachePath = `${pluginDir}/cache.json`;
          
          await adapter.write(cachePath, JSON.stringify(payload, null, 2));
          this.log('SAVE_SUCCESS', 'system', cachePath, 'Direct file write');
          saved = true;
        } catch (error) {
          this.log('SAVE_WARNING', 'system', 'cache.json', `Direct write failed: ${error.message}`);
        }
      }

      if (!saved && this.obsidianPlugin?.app?.vault?.adapter) {
        try {
          const adapter = this.obsidianPlugin.app.vault.adapter;
          const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
          const tempPath = `${pluginDir}/cache.tmp`;
          const cachePath = `${pluginDir}/cache.json`;
          
          await adapter.write(tempPath, JSON.stringify(payload));
          
          try {
            await adapter.remove(cachePath);
          } catch {}
          await adapter.rename(tempPath, cachePath);
          
          this.log('SAVE_SUCCESS', 'system', cachePath, 'Atomic write');
          saved = true;
        } catch (error) {
          this.log('SAVE_WARNING', 'system', 'cache.tmp', `Atomic write failed: ${error.message}`);
        }
      }

      if (saved) {
        this.state.lastSaved = Date.now();
        this.lastPersistTime = Date.now();
        this.criticalSaveMode = false;
        return true;
      } else {
        this.log('SAVE_ERROR', 'system', '', 'All save methods failed');
        return false;
      }
    } catch (error) {
      this.log('SAVE_ERROR', 'system', '', error.message);
      return false;
    } finally {
      this.state.saving = false;
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
    }
  }

  async loadFromDisk() {
    if (this.state.loading) return 0;
    this.state.loading = true;

    try {
      let data = null;
      
      if (this.obsidianPlugin?.app?.vault?.adapter) {
        const adapter = this.obsidianPlugin.app.vault.adapter;
        const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
        const cachePath = `${pluginDir}/cache.json`;
        
        try {
          const raw = await adapter.read(cachePath);
          data = JSON.parse(raw);
          this.log('LOAD_SUCCESS', 'system', cachePath, 'Direct file read');
        } catch (error) {
          if (!error.message.includes('ENOENT') && !error.message.includes('not exist')) {
            this.log('LOAD_WARNING', 'system', cachePath, error.message);
          }
        }
      }

      if (!data) {
        this.log('LOAD_EMPTY', 'system', '', 'No cache data found');
        this.state.lastLoaded = Date.now();
        return 0;
      }

      if (data.version && this.compareVersions(data.version, '3.0.0') < 0) {
        this.log('LOAD_WARNING', 'system', '', `Old cache version ${data.version}, clearing`);
        return 0;
      }

      let loaded = 0;
      const now = Date.now();

      for (const [scope, entries] of Object.entries(data.data || {})) {
        if (!this.stores[scope]) {
          this.stores[scope] = new Map();
        }
        
        const store = this.stores[scope];
        if (!Array.isArray(entries)) continue;

        for (const [key, entry] of entries) {
          if (!entry?.timestamp) continue;
          
          const { source: entrySource, scope: baseScope } = this.parseCompositeScope(scope);
          const ttl = this.getTTL(baseScope || scope, entrySource, entry.customTtl);
          
          if ((now - entry.timestamp) < ttl) {
            store.set(key, entry);
            this.updateIndexes(key, entry);
            loaded++;
          }
        }
      }

      if (data.indexes) {
        Object.entries(data.indexes).forEach(([indexType, entries]) => {
          if (this.indexes[indexType] && Array.isArray(entries)) {
            entries.forEach(([key, values]) => {
              this.indexes[indexType].set(key, new Set(values));
            });
          }
        });
      }

      if (data.accessLog && Array.isArray(data.accessLog)) {
        data.accessLog.forEach(([key, timestamp]) => {
          this.accessLog.set(key, timestamp);
        });
      }

      if (data.stats) {
        this.stats.compressions = data.stats.compressions || 0;
      }

      this.state.lastLoaded = Date.now();
      this.lastPersistTime = Date.now();
      this.log('LOAD_COMPLETE', 'system', '', `${loaded} entries loaded`);
      return loaded;
    } catch (error) {
      this.log('LOAD_ERROR', 'system', '', error.message);
      return 0;
    } finally {
      this.state.loading = false;
    }
  }
  
  async clearAll() {
  
  
  // Stop all timers to prevent interference
  this.stopAutoPrune();
  this.stopIncrementalSave(); 
  this.stopBackgroundRefresh();
  
  if (this.saveDebounceTimer) {
    clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = null;
  }
  
  // Clear all in-memory data
  let totalEntries = 0;
  Object.values(this.stores).forEach(store => {
    totalEntries += store.size;
    store.clear();
  });
  
  // Clear all indexes
  Object.values(this.indexes).forEach(index => index.clear());
  
  // Clear all tracking data
  this.accessLog.clear();
  this.refreshCallbacks.clear();
  this.loadQueue.clear();
  this.saveQueue.clear();
  this.persistenceQueue.clear();
  
  // Reset stats completely
  this.stats = { 
    hits: 0, 
    misses: 0, 
    sets: 0, 
    deletes: 0, 
    evictions: 0, 
    compressions: 0 
  };
  
  // Reset state
  this.state = { 
    loading: false, 
    saving: false, 
    lastSaved: null, 
    lastLoaded: null 
  };
  
  // Reset timestamps
  this.lastPersistTime = 0;
  this.criticalSaveMode = false;
  
  // Force delete cache file from disk
  if (this.obsidianPlugin?.app?.vault?.adapter) {
    try {
      const adapter = this.obsidianPlugin.app.vault.adapter;
      const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
      const cachePath = `${pluginDir}/cache.json`;
      const tempPath = `${pluginDir}/cache.tmp`;
      
      // Try to delete both cache files
      try {
        await adapter.remove(cachePath);

      } catch (error) {
        if (!error.message.includes('ENOENT') && !error.message.includes('not exist')) {
          console.warn('[Cache] Could not delete cache.json:', error.message);
        }
      }
      
      try {
        await adapter.remove(tempPath);

      } catch (error) {
        if (!error.message.includes('ENOENT') && !error.message.includes('not exist')) {
          console.warn('[Cache] Could not delete cache.tmp:', error.message);
        }
      }
      
    } catch (error) {
      console.error('[Cache] Error during disk cleanup:', error);
    }
  }
  
  // Write empty cache file to ensure clean state
  try {
    const emptyPayload = {
      version: this.version,
      timestamp: Date.now(),
      stats: { ...this.stats },
      data: {},
      indexes: { byUser: [], byMedia: [], byTag: [] },
      accessLog: []
    };
    
    if (this.obsidianPlugin?.app?.vault?.adapter) {
      const adapter = this.obsidianPlugin.app.vault.adapter;
      const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
      const cachePath = `${pluginDir}/cache.json`;
      
      await adapter.write(cachePath, JSON.stringify(emptyPayload, null, 2));
      
    }
  } catch (error) {
    console.warn('[Cache] Could not write empty cache file:', error.message);
  }
  
  // Restart essential services
  this.startIncrementalSave(30000);
  this.startAutoPrune(300000);
  
  
  this.log('CLEAR_ALL_COMPLETE', 'system', '', `${totalEntries} entries + disk cleanup`);
  
  return totalEntries;
}

  compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;
      
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }
    return 0;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(1) : '0.0';
    
    const storeStats = {};
    Object.entries(this.stores).forEach(([scope, store]) => {
      if (store.size > 0) {
        storeStats[scope] = store.size;
      }
    });
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      totalRequests: total,
      cacheSize: Object.values(this.stores).reduce((sum, store) => sum + store.size, 0),
      indexSize: Object.values(this.indexes).reduce((sum, index) => sum + index.size, 0),
      storeBreakdown: storeStats,
      lastSaved: this.state.lastSaved ? new Date(this.state.lastSaved).toLocaleString() : 'Never',
      lastLoaded: this.state.lastLoaded ? new Date(this.state.lastLoaded).toLocaleString() : 'Never'
    };
  }

  log(operation, scope, key, extra = '') {

    const truncated = key.length > 50 ? key.slice(0, 47) + '...' : key;

  }



  async destroy() {
    Object.values(this.intervals).forEach(interval => {
      if (interval) clearInterval(interval);
    });
    
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    
    this.criticalSaveMode = true;
    await this.saveToDisk();
    
    this.loadQueue.clear();
    this.saveQueue.clear();
    this.persistenceQueue.clear();
    
    Object.keys(this.stats).forEach(key => this.stats[key] = 0);
    this.state = { loading: false, saving: false, lastSaved: null, lastLoaded: null };
    
    this.log('DESTROY', 'system', '', 'Cache destroyed and saved');
  }

  // Clears a cache scope either globally or for a specific API source
  invalidateScope(scope, options = {}) {
    const { source = null } = options;
    let cleared = 0;

    if (source) {
      const composite = `${source}:${scope}`;
      const store = this.stores[composite];
      if (store) {
        cleared = store.size;
        store.clear();
      }
      // Also clear generic scope if present
      if (this.stores[scope]) {
        cleared += this.stores[scope].size;
        this.stores[scope].clear();
      }
      this.schedulePersistence();
      return cleared;
    }

    // No source specified: clear generic scope and all per-source scopes
    if (this.stores[scope]) {
      cleared += this.stores[scope].size;
      this.stores[scope].clear();
    }

    this.apiSources.forEach(api => {
      const composite = `${api}:${scope}`;
      const store = this.stores[composite];
      if (store) {
        cleared += store.size;
        store.clear();
      }
    });

    this.schedulePersistence();
    return cleared;
  }
}

export { Cache };