const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal,setIcon } = require('obsidian');

const getDefaultGridColumns = () => {
  return window.innerWidth >= 768 ? 5 : 2;
};

const DEFAULT_SETTINGS = {
  defaultApiSource: 'anilist',
  defaultApiUserOverride: false,
  defaultUsername: '',
  defaultLayout: 'card',
  notePath: 'Zoro/Note',
  insertCodeBlockOnNote: true,
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  showLoadingIcon: true,
  gridColumns: getDefaultGridColumns(),
  theme: '', 
  hideUrlsInTitles: true,
  forceScoreFormat: true,
  showAvatar: true,
  showFavorites: true,
  showBreakdowns: true,
  showTimeStats: true,
  statsLayout: 'enhanced',
  statsTheme: 'auto',
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: '',
  malClientId: '',
  malClientSecret: '',
  malAccessToken: '',
  malRefreshToken: '',
  malTokenExpiry: null,
  malUserInfo: null,
simklClientId: '',
simklClientSecret: '',
simklAccessToken: '',
simklUserInfo: null,
  debugMode: false,
};

class ZoroError {
  static instance(plugin) {
    if (!ZoroError._singleton) ZoroError._singleton = new ZoroError(plugin);
    return ZoroError._singleton;
  }

  constructor(plugin) {
    this.plugin = plugin;
    this.noticeRateLimit = new Map(); // Prevent notification spam
    this.recoveryStrategies = new Map();
    this.initRecoveryStrategies();
  }

  // Main entry point for creating errors with user notifications
  static notify(message, severity = 'error', duration = null) {
    const instance = ZoroError.instance();
    
    if (!instance.isRateLimited(message)) {
      const userMessage = instance.getUserMessage(message, severity);
      const noticeDuration = duration || instance.getNoticeDuration(severity);
      new Notice(userMessage, noticeDuration);
    }
    
    // Log to console for debugging (developers can check if needed)
    if (severity === 'error' || severity === 'fatal') {
      console.error(`[Zoro] ${message}`);
    }
    
    return new Error(message);
  }

  // Guard function with automatic recovery
  static async guard(fn, recoveryStrategy = null) {
    const instance = ZoroError.instance();
    
    try {
      return await fn();
    } catch (error) {
      // Try recovery first (silent)
      if (recoveryStrategy && instance.recoveryStrategies.has(recoveryStrategy)) {
        try {
          const result = await instance.recoveryStrategies.get(recoveryStrategy)(error, fn);
          if (result !== null) return result;
        } catch (recoveryError) {
          // Recovery failed, fall through to show user error
        }
      }
      
      // Show user-friendly error if recovery failed
      const userMessage = instance.getUserMessage(error.message || String(error), 'error');
      if (!instance.isRateLimited(error.message)) {
        new Notice(userMessage, 6000);
      }
      
      throw error;
    }
  }

  // Retry mechanism for network/temporary failures
  static async withRetry(fn, maxRetries = 2) {
    const instance = ZoroError.instance();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxRetries) {
          // Final attempt failed
          const message = `Operation failed after ${maxRetries} attempts`;
          ZoroError.notify(message, 'error');
          throw error;
        }
        
        // Silent retry with small delay
        await instance.sleep(1000 * attempt);
      }
    }
  }

  // Initialize simple recovery strategies
  initRecoveryStrategies() {
    // Cache fallback for network issues
    this.recoveryStrategies.set('cache', async (error, originalFn) => {
      if (this.isNetworkError(error)) {
        const cachedResult = this.plugin.cache?.getLastKnown?.();
        if (cachedResult) {
          ZoroError.notify('Using offline data', 'info', 3000);
          return cachedResult;
        }
      }
      return null;
    });

    // Simple retry for temporary failures
    this.recoveryStrategies.set('retry', async (error, originalFn) => {
      if (this.isTemporaryError(error)) {
        await this.sleep(1500);
        return await originalFn();
      }
      return null;
    });

    // Graceful degradation
    this.recoveryStrategies.set('degrade', async (error) => {
      return { error: true, message: 'Limited functionality available' };
    });
  }

  // Convert technical errors to user-friendly messages
  getUserMessage(message, severity) {
    const lowerMessage = message.toLowerCase();
    
    // Network issues
    if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || 
        lowerMessage.includes('connection') || lowerMessage.includes('timeout')) {
      return '🌐 Connection issue. Check your internet and try again.';
    }
    
    // Authentication issues
    if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized') || 
        lowerMessage.includes('forbidden')) {
      return '🔑 Login required. Please check your credentials.';
    }
    
    // Rate limiting
    if (lowerMessage.includes('rate') || lowerMessage.includes('too many')) {
      return '🚦 Please wait a moment before trying again.';
    }
    
    // Cache issues
    if (lowerMessage.includes('cache')) {
      return '💾 Data refresh needed. Please try again.';
    }
    
    // Server issues
    if (lowerMessage.includes('server') || lowerMessage.includes('503') || 
        lowerMessage.includes('502') || lowerMessage.includes('500')) {
      return '🔧 Service temporarily unavailable. Please try again later.';
    }
    
    // Default messages based on severity
    const prefixes = {
      fatal: '🧨 Critical error occurred',
      error: '❌ Something went wrong',
      warn: '⚠️ Minor issue detected',
      info: 'ℹ️ Information'
    };
    
    return `${prefixes[severity] || prefixes.error}. Please try again.`;
  }

  // Prevent notification spam
  isRateLimited(message) {
    const now = Date.now();
    const key = this.getMessageKey(message);
    const lastShown = this.noticeRateLimit.get(key) || 0;
    
    if (now - lastShown < 5000) { // 5 second cooldown
      return true;
    }
    
    this.noticeRateLimit.set(key, now);
    
    // Cleanup old entries periodically
    if (this.noticeRateLimit.size > 50) {
      this.cleanupRateLimit();
    }
    
    return false;
  }

  // Get notice duration based on severity
  getNoticeDuration(severity) {
    const durations = {
      fatal: 10000,
      error: 6000,
      warn: 4000,
      info: 3000
    };
    return durations[severity] || 5000;
  }

  // Helper methods
  isNetworkError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('network') || message.includes('fetch') || 
           message.includes('timeout') || message.includes('connection');
  }

  isTemporaryError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('temporary') || message.includes('retry') ||
           message.includes('503') || message.includes('502');
  }

  getMessageKey(message) {
    // Create a simple key for rate limiting (remove numbers and special chars)
    return message.replace(/\d+/g, '').replace(/[^\w\s]/g, '').trim().toLowerCase();
  }

  cleanupRateLimit() {
    const now = Date.now();
    const cutoff = now - 60000; // 1 minute ago
    
    for (const [key, timestamp] of this.noticeRateLimit.entries()) {
      if (timestamp < cutoff) {
        this.noticeRateLimit.delete(key);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup when plugin unloads
  destroy() {
    this.noticeRateLimit.clear();
    this.recoveryStrategies.clear();
  }
}

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
    this.flags = { autoPrune: false, backgroundRefresh: false, debugMode: false };
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

  enableDebug(enabled = true) {
    this.flags.debugMode = enabled;
    console.log(`[Zoro] Cache debug ${enabled ? 'ON' : 'OFF'}`);
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
  console.log('[Cache] Starting complete cache clear...');
  
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
        console.log('[Cache] Deleted cache.json from disk');
      } catch (error) {
        if (!error.message.includes('ENOENT') && !error.message.includes('not exist')) {
          console.warn('[Cache] Could not delete cache.json:', error.message);
        }
      }
      
      try {
        await adapter.remove(tempPath);
        console.log('[Cache] Deleted cache.tmp from disk');
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
      console.log('[Cache] Wrote empty cache file');
    }
  } catch (error) {
    console.warn('[Cache] Could not write empty cache file:', error.message);
  }
  
  // Restart essential services
  this.startIncrementalSave(30000);
  this.startAutoPrune(300000);
  
  console.log(`[Cache] Complete cache clear finished - ${totalEntries} entries removed`);
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
    if (!this.flags.debugMode) return;
    const truncated = key.length > 50 ? key.slice(0, 47) + '...' : key;
    console.log(`[Cache] ${operation}: ${scope}:${truncated} ${extra}`);
  }

  debug() {
    console.group('[Cache] Debug Report');
    console.log('Stats:', this.getStats());
    console.log('State:', this.state);
    console.log('Flags:', this.flags);
    
    Object.entries(this.stores).forEach(([scope, store]) => {
      if (store.size > 0) {
        console.log(`${scope}: ${store.size} entries`);
      }
    });
    
    console.groupEnd();
    return this;
  }

  enableDebug(enabled = true) {
    this.flags.debugMode = enabled;
    return this;
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

class AniListRequest {
  constructor(config) {
    this.config = config;
    this.rateLimiter = {
      requests: [],
      windowMs: 60000,
      maxRequests: 90,
      remaining: 90
    };
    this.metrics = {
      requests: 0,
      errors: 0,
      avgTime: 0
    };
  }

  checkRateLimit() {
    const now = Date.now();
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { allowed: false, waitTime: Math.max(waitTime, 1000) };
    }

    this.rateLimiter.requests.push(now);
    return { allowed: true, waitTime: 0 };
  }

  shouldRetry(error, attempt, maxAttempts) {
    if (attempt >= maxAttempts) return false;
    if (error.message.includes('timeout')) return true;
    if (error.status >= 400 && error.status < 500) return false;
    return true;
  }

  getRetryDelay(attempt) {
    const baseDelay = 1000;
    const maxDelay = 10000;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  updateMetrics(processingTime, isError = false) {
    this.metrics.requests++;
    if (isError) {
      this.metrics.errors++;
    } else {
      this.metrics.avgTime = (this.metrics.avgTime + processingTime) / 2;
    }
  }

  getUtilization() {
    return `${((this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100).toFixed(1)}%`;
  }
}
class MALRequest {
  constructor(config, plugin) {
    this.config = config;
    this.plugin = plugin;
    this.rateLimiter = {
      requests: [],
      windowMs: 60000,
      maxRequests: 60,
      remaining: 60
    };
    this.authState = {
      lastAuthCheck: 0,
      authCheckInterval: 300000,
      consecutiveAuthFailures: 0,
      lastRequest: 0
    };
    this.metrics = {
      requests: 0,
      errors: 0,
      avgTime: 0,
      authErrors: 0
    };
  }

  checkRateLimit() {
    const now = Date.now();
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.malConfig.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { allowed: false, waitTime: Math.max(waitTime, 2000) };
    }

    this.rateLimiter.requests.push(now);
    this.authState.lastRequest = now;
    return { allowed: true, waitTime: 0 };
  }

  async validateAuth() {
    const now = Date.now();
    
    if (now - this.authState.lastAuthCheck < this.authState.authCheckInterval) {
      return { valid: true };
    }

    try {
      if (this.plugin.malAuth && typeof this.plugin.malAuth.ensureValidToken === 'function') {
        await this.plugin.malAuth.ensureValidToken();
        this.authState.lastAuthCheck = now;
        this.authState.consecutiveAuthFailures = 0;
        return { valid: true };
      }

      if (!this.plugin.settings?.malAccessToken) {
        return { 
          valid: false, 
          error: 'No MAL access token available' 
        };
      }

      return { valid: true };
    } catch (error) {
      this.authState.consecutiveAuthFailures++;
      this.metrics.authErrors++;
      return { 
        valid: false, 
        error: error.message || 'MAL authentication failed' 
      };
    }
  }

  shouldRetry(error, attempt, maxAttempts) {
    if (attempt >= maxAttempts) return false;
    
    if (error.message.includes('auth') || error.message.includes('401')) {
      return attempt < this.config.malConfig.maxAuthRetries;
    }
    
    if (error.status >= 400 && error.status < 500) return false;
    if (error.message.includes('timeout')) return true;
    return true;
  }

  getRetryDelay(attempt) {
    const baseDelay = 2000;
    const maxDelay = 15000;
    
    const timeSinceLastRequest = Date.now() - this.authState.lastRequest;
    if (timeSinceLastRequest < 1000) {
      return Math.max(baseDelay, 1500);
    }
    
    if (this.authState.consecutiveAuthFailures > 0) {
      return baseDelay * (1 + this.authState.consecutiveAuthFailures * 0.5);
    }
    
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  updateMetrics(processingTime, isError = false) {
    this.metrics.requests++;
    if (isError) {
      this.metrics.errors++;
    } else {
      this.metrics.avgTime = (this.metrics.avgTime + processingTime) / 2;
    }
  }

  getUtilization() {
    return `${((this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100).toFixed(1)}%`;
  }

  getAuthStatus() {
    return this.authState.consecutiveAuthFailures === 0 ? 'healthy' : 'degraded';
  }
}
class SimklRequest {
  constructor(config, plugin) {
    this.config = config;
    this.plugin = plugin;
    this.rateLimiter = {
      requests: [],
      windowMs: 60000, // 1 minute window
      maxRequests: 100, // Simkl allows more requests than MAL but less than AniList
      remaining: 100
    };
    this.authState = {
      lastAuthCheck: 0,
      authCheckInterval: 600000, // 10 minutes - longer than MAL since Simkl tokens are more stable
      consecutiveAuthFailures: 0,
      lastRequest: 0,
      tokenExpiry: null
    };
    this.metrics = {
      requests: 0,
      errors: 0,
      avgTime: 0,
      authErrors: 0,
      searchRequests: 0, // Track search vs auth requests separately
      userRequests: 0
    };
  }

  checkRateLimit() {
    const now = Date.now();
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.simklConfig.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { allowed: false, waitTime: Math.max(waitTime, 1500) }; // Slightly longer wait than AniList
    }

    this.rateLimiter.requests.push(now);
    this.authState.lastRequest = now;
    return { allowed: true, waitTime: 0 };
  }

  async validateAuth() {
    const now = Date.now();
    
    // Skip auth validation for search requests (they don't require auth)
    if (this.lastRequestWasSearch) {
      return { valid: true };
    }
    
    if (now - this.authState.lastAuthCheck < this.authState.authCheckInterval) {
      return { valid: true };
    }

    try {
      if (this.plugin.simklAuth && typeof this.plugin.simklAuth.ensureValidToken === 'function') {
        await this.plugin.simklAuth.ensureValidToken();
        this.authState.lastAuthCheck = now;
        this.authState.consecutiveAuthFailures = 0;
        return { valid: true };
      }

      if (!this.plugin.settings?.simklAccessToken) {
        return { 
          valid: false, 
          error: 'No Simkl access token available' 
        };
      }

      // Check if token is expired (if we have expiry info)
      if (this.authState.tokenExpiry && now > this.authState.tokenExpiry) {
        return {
          valid: false,
          error: 'Simkl token has expired'
        };
      }

      this.authState.lastAuthCheck = now;
      return { valid: true };
    } catch (error) {
      this.authState.consecutiveAuthFailures++;
      this.metrics.authErrors++;
      return { 
        valid: false, 
        error: error.message || 'Simkl authentication failed' 
      };
    }
  }

  shouldRetry(error, attempt, maxAttempts) {
    if (attempt >= maxAttempts) return false;
    
    // Simkl-specific error handling
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return attempt < 2; // Only retry rate limits once
    }
    
    if (error.message.includes('auth') || error.message.includes('401') || error.message.includes('403')) {
      return attempt < this.config.simklConfig.maxAuthRetries;
    }
    
    // Server errors (5xx) - retry
    if (error.status >= 500 && error.status < 600) return true;
    
    // Client errors (4xx except auth) - don't retry
    if (error.status >= 400 && error.status < 500) return false;
    
    // Network/timeout errors - retry
    if (error.message.includes('timeout') || error.message.includes('network')) return true;
    
    return true;
  }

  getRetryDelay(attempt) {
    const baseDelay = 1500; // Slightly longer than AniList
    const maxDelay = 12000;
    
    const timeSinceLastRequest = Date.now() - this.authState.lastRequest;
    if (timeSinceLastRequest < 1000) {
      return Math.max(baseDelay, 2000);
    }
    
    // Longer delays for auth failures
    if (this.authState.consecutiveAuthFailures > 0) {
      return baseDelay * (1 + this.authState.consecutiveAuthFailures * 0.7);
    }
    
    // Rate limit specific delays
    if (this.lastErrorWasRateLimit) {
      return Math.max(baseDelay * 2, 5000);
    }
    
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1500;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  updateMetrics(processingTime, isError = false) {
    this.metrics.requests++;
    if (isError) {
      this.metrics.errors++;
    } else {
      this.metrics.avgTime = (this.metrics.avgTime + processingTime) / 2;
    }
    
    // Track request types for better insights
    if (this.lastRequestWasSearch) {
      this.metrics.searchRequests++;
    } else {
      this.metrics.userRequests++;
    }
  }

  getUtilization() {
    return `${((this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100).toFixed(1)}%`;
  }

  getAuthStatus() {
    if (this.authState.consecutiveAuthFailures === 0) return 'healthy';
    if (this.authState.consecutiveAuthFailures < 3) return 'degraded';
    return 'unhealthy';
  }

  // Simkl-specific method to set request context
  setRequestContext(isSearch = false) {
    this.lastRequestWasSearch = isSearch;
  }

  // Simkl-specific method to handle rate limit errors
  handleRateLimitError() {
    this.lastErrorWasRateLimit = true;
    setTimeout(() => {
      this.lastErrorWasRateLimit = false;
    }, 30000); // Reset flag after 30 seconds
  }

  // Method to update token expiry information
  updateTokenExpiry(expiresIn) {
    if (expiresIn) {
      this.authState.tokenExpiry = Date.now() + (expiresIn * 1000);
    }
  }

  // Get detailed metrics including Simkl-specific data
  getDetailedMetrics() {
    return {
      ...this.metrics,
      rateLimiter: {
        current: this.rateLimiter.requests.length,
        max: this.rateLimiter.maxRequests,
        utilization: this.getUtilization()
      },
      auth: {
        status: this.getAuthStatus(),
        failures: this.authState.consecutiveAuthFailures,
        lastCheck: new Date(this.authState.lastAuthCheck).toISOString(),
        tokenExpiry: this.authState.tokenExpiry ? 
          new Date(this.authState.tokenExpiry).toISOString() : null
      },
      requestTypes: {
        search: this.metrics.searchRequests,
        user: this.metrics.userRequests,
        searchRatio: this.metrics.requests > 0 ? 
          `${((this.metrics.searchRequests / this.metrics.requests) * 100).toFixed(1)}%` : '0%'
      }
    };
  }
}
class RequestQueue {
  constructor(plugin) {
    this.plugin = plugin;
    
    this.queues = {
      high: [],
      normal: [],
      low: []
    };
    
    this.config = {
      baseDelay: 700,
      maxDelay: 5000,
      minDelay: 100,
      maxConcurrent: 3,
      maxRetries: 3,
      timeoutMs: 30000,
      rateLimitBuffer: 0.8,
      malConfig: {
        baseDelay: 1000,
        maxConcurrent: 2,
        rateLimitBuffer: 0.7,
        authRetryDelay: 2000,
        maxAuthRetries: 2
      },
      simklConfig: {
        baseDelay: 1200,
        maxConcurrent: 2,
        rateLimitBuffer: 0.75,
        authRetryDelay: 2500,
        maxAuthRetries: 3
      }
    };
    
    this.state = {
      isProcessing: false,
      activeRequests: new Map(),
      completedRequests: 0,
      failedRequests: 0,
      concurrentCount: 0
    };
    
    this.services = {
      anilist: new AniListRequest(this.config),
      mal: new MALRequest(this.config, plugin),
      simkl: new SimklRequest(this.config, plugin)
    };
    
    this.metrics = {
      requestsQueued: 0,
      requestsProcessed: 0,
      requestsFailed: 0,
      queuePeakSize: 0,
      rateLimitHits: 0,
      retries: 0,
      startTime: Date.now()
    };
    
    this.requestTracker = new Map();
    
    this.loaderState = {
      visible: false,
      requestCount: 0,
      lastUpdate: 0,
      debounceTimeout: null
    };
    
    this.startBackgroundTasks();
  }

  add(requestFn, options = {}) {
    const {
      priority = 'normal',
      timeout = this.config.timeoutMs,
      retries = this.config.maxRetries,
      metadata = {},
      service = 'anilist'
    } = options;
    
    const requestId = this.generateRequestId();
    const queueTime = Date.now();
    
    const adjustedOptions = this.adjustOptionsForService(service, {
      timeout, retries, priority, metadata
    });
    
    return new Promise((resolve, reject) => {
      const requestItem = {
        requestFn,
        resolve,
        reject,
        id: requestId,
        priority,
        timeout: adjustedOptions.timeout,
        retries: adjustedOptions.retries,
        metadata: { ...metadata, service },
        queueTime,
        startTime: null,
        attempt: 0,
        maxAttempts: adjustedOptions.retries + 1,
        service
      };
      
      this.queues[priority].push(requestItem);
      this.metrics.requestsQueued++;
      this.updateQueueMetrics();
      
      // Update loader state immediately when request is queued
      this.updateLoaderState(true);
      
      // Start processing
      this.process();
      
      this.requestTracker.set(requestId, {
        queueTime,
        priority,
        service
      });
    });
  }
  
  adjustOptionsForService(service, options) {
    if (service === 'mal') {
      return {
        timeout: Math.max(options.timeout, 30000),
        retries: Math.min(options.retries, this.config.malConfig.maxAuthRetries),
        priority: options.priority,
        metadata: options.metadata
      };
    }
    
    if (service === 'simkl') {
      return {
        timeout: Math.max(options.timeout, 25000), // Simkl can be slower than AniList
        retries: Math.min(options.retries, this.config.simklConfig.maxAuthRetries),
        priority: options.priority,
        metadata: options.metadata
      };
    }
    
    return options;
  }
  
  async process() {
    if (this.state.isProcessing || this.getTotalQueueSize() === 0) {
      if (this.getTotalQueueSize() === 0) {
        this.updateLoaderState(false);
      }
      return;
    }
    
    this.state.isProcessing = true;
    this.updateLoaderState(true);
    
    try {
      const requestItem = this.getNextRequest();
      if (!requestItem) {
        this.state.isProcessing = false;
        this.updateLoaderState(false);
        return;
      }
      
      if (!this.canProcessRequest(requestItem)) {
        this.queues[requestItem.priority].unshift(requestItem);
        this.state.isProcessing = false;
        setTimeout(() => this.process(), this.config.minDelay);
        return;
      }
      
      const serviceHandler = this.services[requestItem.service];
      const rateLimitCheck = serviceHandler.checkRateLimit();
      
      if (!rateLimitCheck.allowed) {
        this.queues[requestItem.priority].unshift(requestItem);
        this.state.isProcessing = false;
        this.metrics.rateLimitHits++;
        
        setTimeout(() => this.process(), rateLimitCheck.waitTime);
        return;
      }
      
      // Service-specific auth validation
      if (requestItem.service === 'mal') {
        const authCheck = await serviceHandler.validateAuth();
        if (!authCheck.valid) {
          this.handleMalAuthFailure(requestItem, authCheck.error);
          return;
        }
      } else if (requestItem.service === 'simkl') {
        // Set request context for Simkl (helps with auth decisions)
        const isSearchRequest = requestItem.metadata?.type === 'search';
        serviceHandler.setRequestContext(isSearchRequest);
        
        // Only validate auth for non-search requests
        if (!isSearchRequest) {
          const authCheck = await serviceHandler.validateAuth();
          if (!authCheck.valid) {
            this.handleSimklAuthFailure(requestItem, authCheck.error);
            return;
          }
        }
      }
      
      await this.executeRequest(requestItem, serviceHandler);
      
    } finally {
      this.state.isProcessing = false;
      
      if (this.getTotalQueueSize() > 0) {
        setTimeout(() => this.process(), this.config.minDelay);
      } else {
        this.updateLoaderState(false);
      }
    }
  }
  
  canProcessRequest(requestItem) {
    const service = requestItem.service || 'anilist';
    const currentServiceRequests = Array.from(this.state.activeRequests.values())
      .filter(req => req.service === service).length;
    
    const maxConcurrent = this.getMaxConcurrentForService(service);
    
    return this.state.concurrentCount < this.config.maxConcurrent && 
           currentServiceRequests < maxConcurrent;
  }
  
  getMaxConcurrentForService(service) {
    switch (service) {
      case 'mal':
        return this.config.malConfig.maxConcurrent;
      case 'simkl':
        return this.config.simklConfig.maxConcurrent;
      default:
        return this.config.maxConcurrent;
    }
  }
  
  async executeRequest(requestItem, serviceHandler) {
    const { requestFn, resolve, reject, id, timeout, service } = requestItem;
    
    this.state.concurrentCount++;
    this.state.activeRequests.set(id, requestItem);
    requestItem.startTime = Date.now();
    requestItem.attempt++;
    
    const waitTime = requestItem.startTime - requestItem.queueTime;
    
    try {
      const timeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('Request timeout')), timeout);
      });
      
      const result = await Promise.race([requestFn(), timeoutPromise]);
      
      const processingTime = Date.now() - requestItem.startTime;
      this.handleRequestSuccess(requestItem, result, processingTime, waitTime, serviceHandler);
      resolve(result);
      
    } catch (error) {
      const processingTime = Date.now() - requestItem.startTime;
      const shouldRetry = await this.handleRequestError(requestItem, error, processingTime, waitTime, serviceHandler);
      
      if (shouldRetry) {
        const retryDelay = serviceHandler.getRetryDelay(requestItem.attempt);
        setTimeout(() => {
          this.queues[requestItem.priority].unshift(requestItem);
          this.process();
        }, retryDelay);
        this.metrics.retries++;
      } else {
        reject(error);
      }
    } finally {
      this.state.concurrentCount--;
      this.state.activeRequests.delete(id);
      this.requestTracker.delete(id);
      
      this.updateLoaderState();
    }
  }

  handleMalAuthFailure(requestItem, errorMessage) {
    const malService = this.services.mal;
    
    if (malService.authState.consecutiveAuthFailures >= this.config.malConfig.maxAuthRetries) {
      requestItem.reject(new Error(`MAL authentication persistently failing: ${errorMessage}`));
      this.state.isProcessing = false;
      this.updateLoaderState(false);
      return;
    }
    
    setTimeout(() => {
      this.queues[requestItem.priority].unshift(requestItem);
      this.state.isProcessing = false;
      this.process();
    }, this.config.malConfig.authRetryDelay);
  }

  handleSimklAuthFailure(requestItem, errorMessage) {
    const simklService = this.services.simkl;
    
    if (simklService.authState.consecutiveAuthFailures >= this.config.simklConfig.maxAuthRetries) {
      requestItem.reject(new Error(`Simkl authentication persistently failing: ${errorMessage}`));
      this.state.isProcessing = false;
      this.updateLoaderState(false);
      return;
    }
    
    setTimeout(() => {
      this.queues[requestItem.priority].unshift(requestItem);
      this.state.isProcessing = false;
      this.process();
    }, this.config.simklConfig.authRetryDelay);
  }

  handleRequestSuccess(requestItem, result, processingTime, waitTime, serviceHandler) {
    this.state.completedRequests++;
    serviceHandler.updateMetrics(processingTime);
    this.metrics.requestsProcessed++;
  }
  
  async handleRequestError(requestItem, error, processingTime, waitTime, serviceHandler) {
    this.state.failedRequests++;
    serviceHandler.updateMetrics(processingTime, true);
    
    // Simkl-specific error handling
    if (requestItem.service === 'simkl' && error.message.includes('rate limit')) {
      serviceHandler.handleRateLimitError();
    }
    
    const shouldRetry = serviceHandler.shouldRetry(error, requestItem.attempt, requestItem.maxAttempts);
    
    if (!shouldRetry) {
      this.metrics.requestsFailed++;
    }
    
    return shouldRetry;
  }

  // Updated loader state management remains the same
  updateLoaderState(forceShow = null) {
    if (this.loaderState.debounceTimeout) {
      clearTimeout(this.loaderState.debounceTimeout);
      this.loaderState.debounceTimeout = null;
    }
    
    const totalRequests = this.getTotalQueueSize() + this.state.concurrentCount;
    let shouldShow;
    
    if (forceShow !== null) {
      shouldShow = forceShow;
    } else {
      shouldShow = totalRequests > 0;
    }
    
    if (shouldShow && !this.loaderState.visible) {
      this.showGlobalLoader();
    } else if (!shouldShow && this.loaderState.visible) {
      this.loaderState.debounceTimeout = setTimeout(() => {
        if (this.getTotalQueueSize() + this.state.concurrentCount === 0) {
          this.hideGlobalLoader();
        }
      }, 300);
    }
    
    this.loaderState.requestCount = totalRequests;
    this.loaderState.lastUpdate = Date.now();
    
    if (this.loaderState.visible) {
      this.updateLoaderCounter();
    }
  }
  
  showGlobalLoader() {
    if (!this.plugin?.settings?.showLoadingIcon) return;
    
    const loader = document.getElementById('zoro-global-loader');
    if (loader) {
      loader.classList.add('zoro-show');
      this.loaderState.visible = true;
      this.updateLoaderCounter();
    }
  }
  
  hideGlobalLoader() {
    const loader = document.getElementById('zoro-global-loader');
    if (loader) {
      loader.classList.remove('zoro-show');
      loader.removeAttribute('data-count');
      this.loaderState.visible = false;
    }
  }
  
  updateLoaderCounter() {
    const loader = document.getElementById('zoro-global-loader');
    if (loader && this.loaderState.visible) {
      const queueSize = this.getTotalQueueSize() + this.state.concurrentCount;
      if (queueSize > 1) {
        loader.setAttribute('data-count', queueSize);
      } else {
        loader.removeAttribute('data-count');
      }
    }
  }
  
  updateQueueMetrics() {
    const totalQueued = this.getTotalQueueSize();
    this.metrics.queuePeakSize = Math.max(this.metrics.queuePeakSize, totalQueued);
  }

  getMetrics() {
    const now = Date.now();
    const uptime = now - this.metrics.startTime;
    const totalRequests = this.metrics.requestsProcessed + this.metrics.requestsFailed;
    const successRate = totalRequests > 0 ? (this.metrics.requestsProcessed / totalRequests) : 1;
    
    return {
      uptime: this.formatDuration(uptime),
      queue: {
        current: this.getQueueSizes(),
        total: this.getTotalQueueSize(),
        peak: this.metrics.queuePeakSize,
        processed: this.metrics.requestsProcessed,
        failed: this.metrics.requestsFailed,
        retries: this.metrics.retries
      },
      performance: {
        successRate: `${(successRate * 100).toFixed(2)}%`
      },
      rateLimit: {
        anilist: {
          requests: this.services.anilist.rateLimiter.requests.length,
          maxRequests: this.services.anilist.rateLimiter.maxRequests,
          remaining: this.services.anilist.rateLimiter.remaining,
          utilization: this.services.anilist.getUtilization()
        },
        mal: {
          requests: this.services.mal.rateLimiter.requests.length,
          maxRequests: this.services.mal.rateLimiter.maxRequests,
          remaining: this.services.mal.rateLimiter.remaining,
          utilization: this.services.mal.getUtilization()
        },
        simkl: {
          requests: this.services.simkl.rateLimiter.requests.length,
          maxRequests: this.services.simkl.rateLimiter.maxRequests,
          remaining: this.services.simkl.rateLimiter.remaining,
          utilization: this.services.simkl.getUtilization()
        },
        hits: this.metrics.rateLimitHits
      },
      concurrency: {
        active: this.state.concurrentCount,
        max: this.config.maxConcurrent
      },
      services: {
        anilist: this.services.anilist.metrics,
        mal: this.services.mal.metrics,
        simkl: this.services.simkl.getDetailedMetrics()
      },
      mal: {
        lastAuthCheck: new Date(this.services.mal.authState.lastAuthCheck).toISOString(),
        authFailures: this.services.mal.authState.consecutiveAuthFailures,
        lastRequest: this.services.mal.authState.lastRequest ? 
          new Date(this.services.mal.authState.lastRequest).toISOString() : 'never'
      },
      simkl: {
        lastAuthCheck: new Date(this.services.simkl.authState.lastAuthCheck).toISOString(),
        authFailures: this.services.simkl.authState.consecutiveAuthFailures,
        lastRequest: this.services.simkl.authState.lastRequest ? 
          new Date(this.services.simkl.authState.lastRequest).toISOString() : 'never',
        authStatus: this.services.simkl.getAuthStatus(),
        tokenExpiry: this.services.simkl.authState.tokenExpiry ?
          new Date(this.services.simkl.authState.tokenExpiry).toISOString() : null
      },
      loader: {
        visible: this.loaderState.visible,
        requestCount: this.loaderState.requestCount
      }
    };
  }

  getNextRequest() {
    const priorities = ['high', 'normal', 'low'];
    for (const priority of priorities) {
      if (this.queues[priority].length > 0) {
        return this.queues[priority].shift();
      }
    }
    return null;
  }
  
  getTotalQueueSize() {
    return Object.values(this.queues).reduce((total, queue) => total + queue.length, 0);
  }
  
  getQueueSizes() {
    const sizes = {};
    Object.keys(this.queues).forEach(priority => {
      sizes[priority] = this.queues[priority].length;
    });
    return sizes;
  }
  
  getHealthStatus() {
    const queueSize = this.getTotalQueueSize();
    const errorRate = this.metrics.requestsFailed / (this.metrics.requestsProcessed + this.metrics.requestsFailed);
    
    let status = 'healthy';
    const malAuthFailures = this.services.mal.authState.consecutiveAuthFailures;
    const simklAuthFailures = this.services.simkl.authState.consecutiveAuthFailures;
    
    if (queueSize > 50 || errorRate > 0.1 || malAuthFailures > 1 || simklAuthFailures > 1) {
      status = 'degraded';
    }
    if (queueSize > 100 || errorRate > 0.25 || 
        malAuthFailures >= this.config.malConfig.maxAuthRetries ||
        simklAuthFailures >= this.config.simklConfig.maxAuthRetries) {
      status = 'unhealthy';
    }
    
    return {
      status,
      queueSize,
      errorRate: `${(errorRate * 100).toFixed(2)}%`,
      activeRequests: this.state.concurrentCount,
      rateLimitUtilization: {
        anilist: this.services.anilist.getUtilization(),
        mal: this.services.mal.getUtilization(),
        simkl: this.services.simkl.getUtilization()
      },
      authStatus: {
        mal: this.services.mal.getAuthStatus(),
        simkl: this.services.simkl.getAuthStatus()
      }
    };
  }
  
  startBackgroundTasks() {
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }
  
  cleanup() {
    const now = Date.now();
    
    Object.values(this.services).forEach(service => {
      service.rateLimiter.requests = service.rateLimiter.requests.filter(
        time => now - time < service.rateLimiter.windowMs * 2
      );
    });
    
    // Cleanup MAL auth state
    if (now - this.services.mal.authState.lastAuthCheck > this.services.mal.authState.authCheckInterval * 2) {
      this.services.mal.authState.consecutiveAuthFailures = 0;
    }
    
    // Cleanup Simkl auth state
    if (now - this.services.simkl.authState.lastAuthCheck > this.services.simkl.authState.authCheckInterval * 2) {
      this.services.simkl.authState.consecutiveAuthFailures = 0;
    }
  }
  
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
  
  pause() {
    this.state.isProcessing = true;
  }
  
  resume() {
    this.state.isProcessing = false;
    this.process();
  }
  clear(priority = null) {
    if (priority) {
      const cleared = this.queues[priority].length;
      this.queues[priority] = [];
      this.updateLoaderState();
      return cleared;
    } else {
      let total = 0;
      Object.keys(this.queues).forEach(p => {
        total += this.queues[p].length;
        this.queues[p] = [];
      });
      this.updateLoaderState();
      return total;
    }
  }
  
  clearMalRequests() {
    let cleared = 0;
    Object.keys(this.queues).forEach(priority => {
      const malRequests = this.queues[priority].filter(req => req.service === 'mal');
      this.queues[priority] = this.queues[priority].filter(req => req.service !== 'mal');
      cleared += malRequests.length;
      
      malRequests.forEach(req => {
        req.reject(new Error('MAL requests cleared due to authentication issues'));
      });
    });
    
    this.updateLoaderState();
    return cleared;
  }
  
  clearSimklRequests() {
    let cleared = 0;
    Object.keys(this.queues).forEach(priority => {
      const simklRequests = this.queues[priority].filter(req => req.service === 'simkl');
      this.queues[priority] = this.queues[priority].filter(req => req.service !== 'simkl');
      cleared += simklRequests.length;
      
      simklRequests.forEach(req => {
        req.reject(new Error('Simkl requests cleared due to authentication issues'));
      });
    });
    
    this.updateLoaderState();
    return cleared;
  }
  
  clearRequestsByService(serviceName) {
    if (!['anilist', 'mal', 'simkl'].includes(serviceName)) {
      throw new Error(`Unknown service: ${serviceName}`);
    }
    
    let cleared = 0;
    Object.keys(this.queues).forEach(priority => {
      const serviceRequests = this.queues[priority].filter(req => req.service === serviceName);
      this.queues[priority] = this.queues[priority].filter(req => req.service !== serviceName);
      cleared += serviceRequests.length;
      
      serviceRequests.forEach(req => {
        req.reject(new Error(`${serviceName} requests cleared`));
      });
    });
    
    this.updateLoaderState();
    return cleared;
  }
  
  // Get service-specific queue statistics
  getServiceQueueStats() {
    const stats = {
      anilist: { high: 0, normal: 0, low: 0, total: 0 },
      mal: { high: 0, normal: 0, low: 0, total: 0 },
      simkl: { high: 0, normal: 0, low: 0, total: 0 }
    };
    
    Object.keys(this.queues).forEach(priority => {
      this.queues[priority].forEach(req => {
        const service = req.service || 'anilist';
        stats[service][priority]++;
        stats[service].total++;
      });
    });
    
    return stats;
  }
  
  // Update token expiry for Simkl
  updateSimklTokenExpiry(expiresIn) {
    this.services.simkl.updateTokenExpiry(expiresIn);
  }
  
  async destroy() {
    // Clear debounce timeout
    if (this.loaderState.debounceTimeout) {
      clearTimeout(this.loaderState.debounceTimeout);
    }
    
    const activeRequests = Array.from(this.state.activeRequests.values());
    if (activeRequests.length > 0) {
      await Promise.allSettled(
        activeRequests.map(req => 
          new Promise(resolve => {
            const originalResolve = req.resolve;
            const originalReject = req.reject;
            req.resolve = (...args) => { originalResolve(...args); resolve(); };
            req.reject = (...args) => { originalReject(...args); resolve(); };
          })
        )
      );
    }
    
    this.clear();
    this.hideGlobalLoader();
  }
}

class AnilistApi {
  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue;
    this.cache = plugin.cache;
    
    // Enterprise-grade enhancements
    this.metrics = this.initializeMetrics();
    this.circuitBreaker = this.initializeCircuitBreaker();
    this.rateLimiter = this.initializeRateLimiter();
    this.healthChecker = this.initializeHealthChecker();
    this.batchQueue = new Map();
    this.batchTimer = null;
    this.requestTracker = new Map();
    
    // Configuration
    this.config = {
      maxRetries: 3,
      baseRetryDelay: 1000,
      maxRetryDelay: 10000,
      requestTimeout: 30000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      batchDelay: 50,
      maxBatchSize: 10
    };
    
    // Start background tasks
    this.startHealthMonitoring();
  }

  // =================== CORE ENTERPRISE FEATURES ===================

  initializeMetrics() {
    return {
      requests: { total: 0, success: 0, failed: 0, cached: 0 },
      latency: { samples: [], min: Infinity, max: 0, avg: 0, p95: 0 },
      errors: new Map(),
      endpoints: new Map(),
      rateLimits: { hits: 0, remaining: Infinity, resetTime: null },
      circuitBreaker: { state: 'CLOSED', failures: 0, lastFailure: null },
      startTime: Date.now()
    };
  }

  initializeCircuitBreaker() {
    return {
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      failures: 0,
      lastFailureTime: null,
      
      recordSuccess: () => {
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.state = 'CLOSED';
        this.metrics.circuitBreaker.state = 'CLOSED';
        this.metrics.circuitBreaker.failures = 0;
      },
      
      recordFailure: () => {
        this.circuitBreaker.failures++;
        this.circuitBreaker.lastFailureTime = Date.now();
        this.metrics.circuitBreaker.failures = this.circuitBreaker.failures;
        this.metrics.circuitBreaker.lastFailure = this.circuitBreaker.lastFailureTime;
        
        if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
          this.circuitBreaker.state = 'OPEN';
          this.metrics.circuitBreaker.state = 'OPEN';
          this.log('CIRCUIT_BREAKER_OPEN', 'system', '', `Failures: ${this.circuitBreaker.failures}`);
        }
      },
      
      canExecute: () => {
        if (this.circuitBreaker.state === 'CLOSED') return true;
        if (this.circuitBreaker.state === 'OPEN') {
          const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
          if (timeSinceFailure > this.config.circuitBreakerTimeout) {
            this.circuitBreaker.state = 'HALF_OPEN';
            this.metrics.circuitBreaker.state = 'HALF_OPEN';
            return true;
          }
          return false;
        }
        return true; // HALF_OPEN
      }
    };
  }

  initializeRateLimiter() {
    return {
      requests: [],
      windowMs: 60000, // 1 minute
      maxRequests: 90, // AniList limit is 90/min
      
      canMakeRequest: () => {
        const now = Date.now();
        this.rateLimiter.requests = this.rateLimiter.requests.filter(
          time => now - time < this.rateLimiter.windowMs
        );
        
        if (this.rateLimiter.requests.length >= this.rateLimiter.maxRequests) {
          const oldestRequest = Math.min(...this.rateLimiter.requests);
          const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
          return { allowed: false, waitTime };
        }
        
        this.rateLimiter.requests.push(now);
        return { allowed: true, waitTime: 0 };
      }
    };
  }

  initializeHealthChecker() {
    return {
      lastCheck: null,
      status: 'unknown',
      latency: null,
      
      checkHealth: async () => {
        const startTime = Date.now();
        try {
          // Simple health check query
          await this.makeRawRequest({
            query: '{ Viewer { id } }',
            variables: {},
            skipAuth: true
          });
          
          this.healthChecker.status = 'healthy';
          this.healthChecker.latency = Date.now() - startTime;
          this.healthChecker.lastCheck = Date.now();
          return true;
        } catch (error) {
          this.healthChecker.status = 'unhealthy';
          this.healthChecker.lastCheck = Date.now();
          return false;
        }
      }
    };
  }

  // =================== ENHANCED REQUEST METHODS ===================

  createCacheKey(config) {
    const sortedConfig = {};
    Object.keys(config).sort().forEach(key => {
      // Sanitize sensitive data from cache keys
      if (key === 'accessToken' || key === 'clientSecret') return;
      sortedConfig[key] = config[key];
    });
    return JSON.stringify(sortedConfig);
  }

  async fetchAniListData(config) {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      // Input validation
      this.validateConfig(config);
      
      // Check circuit breaker
      if (!this.circuitBreaker.canExecute()) {
        throw new ApiError('SERVICE_UNAVAILABLE', 'AniList service is temporarily unavailable');
      }
      
      // Check cache first using your excellent cache system
      const cacheKey = this.createCacheKey(config);
      const cacheType = this.determineCacheType(config);
      
      if (!config.nocache) {
        const cached = this.cache.get(cacheKey, { 
          scope: cacheType, 
          ttl: this.getCacheTTL(config) // null = use cache's built-in TTLs
        });
        
        if (cached) {
          this.recordMetrics('cache_hit', cacheType, performance.now() - startTime);
          this.log('CACHE_HIT', cacheType, requestId, `${(performance.now() - startTime).toFixed(1)}ms`);
          return cached;
        }
      }
      
      // Rate limiting check
      const rateLimitCheck = this.rateLimiter.canMakeRequest();
      if (!rateLimitCheck.allowed) {
        this.log('RATE_LIMITED', 'system', requestId, `Wait: ${rateLimitCheck.waitTime}ms`);
        await this.sleep(rateLimitCheck.waitTime);
      }
      
      // Build query and variables
      const { query, variables } = this.buildQuery(config);
      
      // Execute request with retry logic
      const result = await this.executeRequestWithRetry({
        query,
        variables,
        config,
        requestId,
        maxRetries: this.config.maxRetries
      });
      
      // Cache successful results using your cache system
      if (result && !config.nocache) {
        this.cache.set(cacheKey, result, { 
          scope: cacheType
          
        });
      }
      
      // Record success metrics
      const duration = performance.now() - startTime;
      this.recordMetrics('success', config.type, duration);
      this.circuitBreaker.recordSuccess();
      
      this.log('REQUEST_SUCCESS', config.type, requestId, `${duration.toFixed(1)}ms`);
      
      return result;
      
    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, config);
      
      // Record failure metrics
      this.recordMetrics('error', config.type, duration, classifiedError.type);
      this.circuitBreaker.recordFailure();
      
      // Enhanced error logging
      this.log('REQUEST_FAILED', config.type, requestId, {
        error: classifiedError.type,
        message: classifiedError.message,
        duration: `${duration.toFixed(1)}ms`,
        config: this.sanitizeConfig(config)
      });
      
      throw this.createUserFriendlyError(classifiedError);
    }
  }

  async executeRequestWithRetry({ query, variables, config, requestId, maxRetries }) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.makeRawRequest({
          query,
          variables,
          config,
          requestId,
          attempt
        });
        
        if (attempt > 1) {
          this.log('RETRY_SUCCESS', config.type, requestId, `Attempt ${attempt}/${maxRetries}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries || !this.isRetryableError(error)) {
          throw error;
        }
        
        const delay = this.calculateRetryDelay(attempt);
        this.log('RETRY_ATTEMPT', config.type, requestId, 
          `Attempt ${attempt}/${maxRetries}, retrying in ${delay}ms: ${error.message}`);
        
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  async makeRawRequest({ query, variables, config, requestId, attempt = 1, skipAuth = false }) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `Zoro-Plugin/${this.plugin.manifest.version}`,
      'X-Request-ID': requestId
    };
    
    if (!skipAuth && this.plugin.settings.accessToken) {
      await this.plugin.auth.ensureValidToken();
      headers['Authorization'] = `Bearer ${this.plugin.settings.accessToken}`;
    }
    
    const requestBody = JSON.stringify({ query, variables });
    
    // Add request to tracker
    this.requestTracker.set(requestId, {
      startTime: Date.now(),
      config: this.sanitizeConfig(config),
      attempt,
      query: query.substring(0, 100) + '...'
    });
    
    try {
      const response = await Promise.race([
        this.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers,
          body: requestBody
        })),
        this.createTimeoutPromise(this.config.requestTimeout)
      ]);
      
      // Update rate limit info from headers
      this.updateRateLimitInfo(response.headers);
      
      const result = response.json;
      
      // Validate response structure
      this.validateResponse(result);
      
      // Handle GraphQL errors
      if (result.errors && result.errors.length > 0) {
        throw this.createGraphQLError(result.errors[0]);
      }
      
      if (!result.data) {
        throw new ApiError('INVALID_RESPONSE', 'AniList returned no data');
      }
      
      return result.data;
      
    } finally {
      this.requestTracker.delete(requestId);
    }
  }

  // =================== BATCH OPERATIONS ===================

  async fetchMultipleMedia(mediaIds) {
    return new Promise((resolve, reject) => {
      const batchPromises = mediaIds.map(id => {
        return new Promise((resolveItem, rejectItem) => {
          if (!this.batchQueue.has('media')) {
            this.batchQueue.set('media', []);
          }
          
          this.batchQueue.get('media').push({
            mediaId: id,
            resolve: resolveItem,
            reject: rejectItem
          });
        });
      });
      
      // Schedule batch processing
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.processBatches(), this.config.batchDelay);
      }
      
      Promise.all(batchPromises).then(resolve).catch(reject);
    });
  }

  async processBatches() {
    const mediaBatch = this.batchQueue.get('media');
    
    if (mediaBatch && mediaBatch.length > 0) {
      try {
        const mediaIds = mediaBatch.map(item => item.mediaId);
        const results = await this.fetchBatchMedia(mediaIds);
        
        mediaBatch.forEach(({ mediaId, resolve }) => {
          resolve(results[mediaId] || null);
        });
        
      } catch (error) {
        mediaBatch.forEach(({ reject }) => {
          reject(error);
        });
      }
      
      this.batchQueue.set('media', []);
    }
    
    this.batchTimer = null;
  }

  async fetchBatchMedia(mediaIds) {
    const query = `
      query ($ids: [Int]) {
        Page(page: 1, perPage: ${mediaIds.length}) {
          media(id_in: $ids) {
            id
            idMal
            title { romaji english native }
            coverImage { large medium }
            format
            averageScore
            status
            genres
            episodes
            chapters
            isFavourite
          }
        }
      }
    `;
    
    const result = await this.makeRawRequest({
      query,
      variables: { ids: mediaIds },
      config: { type: 'batch_media' }
    });
    
    const mediaMap = {};
    result.Page.media.forEach(media => {
      mediaMap[media.id] = media;
    });
    
    return mediaMap;
  }

  // =================== ENHANCED UPDATE METHOD ===================

  async updateMediaListEntry(mediaId, updates) {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      // Validate inputs
      this.validateMediaId(mediaId);
      this.validateUpdates(updates);
      
      if (!this.plugin.settings.accessToken || !(await this.plugin.auth.ensureValidToken())) {
        throw new ApiError('AUTH_REQUIRED', 'Authentication required to update entries');
      }

      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
            id
            status
            score
            progress
            updatedAt
            media {
              id
              idMal
              title { romaji english }
            }
          }
        }
      `;
      
      const variables = {
        mediaId: parseInt(mediaId),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.score !== undefined && updates.score !== null && { score: parseFloat(updates.score) }),
        ...(updates.progress !== undefined && { progress: parseInt(updates.progress) }),
      };
      
      const result = await this.executeRequestWithRetry({
        query: mutation,
        variables,
        config: { type: 'update', mediaId },
        requestId,
        maxRetries: 2 // Fewer retries for mutations
      });

      // Intelligent cache invalidation
      await this.invalidateRelatedCache(mediaId, updates);
      
      const duration = performance.now() - startTime;
      this.recordMetrics('update_success', 'mutation', duration);
      
      this.log('UPDATE_SUCCESS', 'mutation', requestId, {
        mediaId,
        updates: Object.keys(updates),
        duration: `${duration.toFixed(1)}ms`
      });
      
      return result.SaveMediaListEntry;

    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, { type: 'update', mediaId });
      
      this.recordMetrics('update_error', 'mutation', duration, classifiedError.type);
      
      this.log('UPDATE_FAILED', 'mutation', requestId, {
        mediaId,
        updates: Object.keys(updates),
        error: classifiedError.type,
        duration: `${duration.toFixed(1)}ms`
      });
      
      throw this.createUserFriendlyError(classifiedError);
    }
  }

  // =================== ERROR HANDLING & CLASSIFICATION ===================

  classifyError(error, context = {}) {
    // Network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return { type: 'NETWORK_ERROR', message: error.message, severity: 'high', retryable: true };
    }
    
    // Timeout errors
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return { type: 'TIMEOUT', message: error.message, severity: 'medium', retryable: true };
    }
    
    // Rate limiting
    if (error.status === 429 || error.message.includes('rate limit')) {
      return { type: 'RATE_LIMITED', message: error.message, severity: 'low', retryable: true };
    }
    
    // Authentication errors
    if (error.status === 401 || error.message.includes('Unauthorized')) {
      return { type: 'AUTH_ERROR', message: error.message, severity: 'high', retryable: false };
    }
    
    // Server errors
    if (error.status >= 500) {
      return { type: 'SERVER_ERROR', message: error.message, severity: 'high', retryable: true };
    }
    
    // GraphQL errors
    if (error.message?.includes('Private') || error.message?.includes('permission')) {
      return { type: 'PRIVATE_LIST', message: error.message, severity: 'low', retryable: false };
    }
    
    // Client errors
    if (error.status >= 400 && error.status < 500) {
      return { type: 'CLIENT_ERROR', message: error.message, severity: 'medium', retryable: false };
    }
    
    // Unknown errors
    return { type: 'UNKNOWN_ERROR', message: error.message, severity: 'medium', retryable: false };
  }

  createUserFriendlyError(classifiedError) {
    const errorMessages = {
      'NETWORK_ERROR': '🌐 Connection issue. Please check your internet connection and try again.',
      'TIMEOUT': '⏱️ Request timed out. Please try again.',
      'RATE_LIMITED': '🚦 Too many requests. Please wait a moment and try again.',
      'AUTH_ERROR': '🔑 Authentication expired. Please re-authenticate with AniList.',
      'SERVER_ERROR': '🔧 AniList servers are experiencing issues. Please try again later.',
      'PRIVATE_LIST': '🔒 This user\'s list is private.',
      'CLIENT_ERROR': '⚠️ Invalid request. Please check your input.',
      'SERVICE_UNAVAILABLE': '🚫 Service is temporarily unavailable due to repeated failures.',
      'UNKNOWN_ERROR': '❌ An unexpected error occurred. Please try again.'
    };
    
    const userMessage = errorMessages[classifiedError.type] || errorMessages['UNKNOWN_ERROR'];
    const error = new Error(userMessage);
    error.type = classifiedError.type;
    error.severity = classifiedError.severity;
    error.retryable = classifiedError.retryable;
    error.originalMessage = classifiedError.message;
    
    return error;
  }

  createGraphQLError(graphqlError) {
    const error = new Error(graphqlError.message);
    error.type = 'GRAPHQL_ERROR';
    error.extensions = graphqlError.extensions;
    error.locations = graphqlError.locations;
    error.path = graphqlError.path;
    return error;
  }

  // =================== UTILITY METHODS ===================

  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new ApiError('INVALID_CONFIG', 'Configuration must be an object');
    }
    
    if (config.type && !['stats', 'single', 'search', 'list'].includes(config.type)) {
      throw new ApiError('INVALID_TYPE', `Invalid config type: ${config.type}`);
    }
    
    if (config.mediaType && !['ANIME', 'MANGA'].includes(config.mediaType)) {
      throw new ApiError('INVALID_MEDIA_TYPE', `Invalid media type: ${config.mediaType}`);
    }
  }

  validateMediaId(mediaId) {
    const id = parseInt(mediaId);
    if (!id || id <= 0) {
      throw new ApiError('INVALID_MEDIA_ID', `Invalid media ID: ${mediaId}`);
    }
  }

  validateUpdates(updates) {
    if (!updates || typeof updates !== 'object') {
      throw new ApiError('INVALID_UPDATES', 'Updates must be an object');
    }
    
    if (Object.keys(updates).length === 0) {
      throw new ApiError('EMPTY_UPDATES', 'At least one field must be updated');
    }
  }

  validateResponse(response) {
    if (!response || typeof response !== 'object') {
      throw new ApiError('INVALID_RESPONSE', 'Invalid response from AniList');
    }
  }

  isRetryableError(error) {
    return error.retryable !== false && (
      error.status >= 500 ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.name === 'TimeoutError' ||
      error.status === 429
    );
  }

  calculateRetryDelay(attempt) {
    const baseDelay = this.config.baseRetryDelay;
    const maxDelay = this.config.maxRetryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add randomness to prevent thundering herd
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  createTimeoutPromise(timeout) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Request timeout'));
      }, timeout);
    });
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sanitizeConfig(config) {
    const sanitized = { ...config };
    delete sanitized.accessToken;
    delete sanitized.clientSecret;
    return sanitized;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  // =================== MONITORING & METRICS ===================

  recordMetrics(operation, type, duration, errorType = null) {
    this.metrics.requests.total++;
    
    if (operation === 'success' || operation === 'cache_hit') {
      if (operation === 'cache_hit') {
        this.metrics.requests.cached++;
      } else {
        this.metrics.requests.success++;
      }
    } else {
      this.metrics.requests.failed++;
      
      if (errorType) {
        const count = this.metrics.errors.get(errorType) || 0;
        this.metrics.errors.set(errorType, count + 1);
      }
    }
    
    // Update latency stats
    if (duration) {
      this.metrics.latency.samples.push(duration);
      if (this.metrics.latency.samples.length > 1000) {
        this.metrics.latency.samples = this.metrics.latency.samples.slice(-500);
      }
      
      this.metrics.latency.min = Math.min(this.metrics.latency.min, duration);
      this.metrics.latency.max = Math.max(this.metrics.latency.max, duration);
      this.metrics.latency.avg = this.metrics.latency.samples.reduce((a, b) => a + b, 0) / this.metrics.latency.samples.length;
      
      // Calculate 95th percentile
      const sorted = [...this.metrics.latency.samples].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      this.metrics.latency.p95 = sorted[p95Index] || 0;
    }
    
    // Update endpoint stats
    if (!this.metrics.endpoints.has(type)) {
      this.metrics.endpoints.set(type, { requests: 0, success: 0, errors: 0, avgLatency: 0 });
    }
    
    const endpointStats = this.metrics.endpoints.get(type);
    endpointStats.requests++;
    
    if (operation === 'success' || operation === 'cache_hit') {
      endpointStats.success++;
    } else {
      endpointStats.errors++;
    }
    
    if (duration) {
      endpointStats.avgLatency = (endpointStats.avgLatency + duration) / 2;
    }
  }

  updateRateLimitInfo(headers) {
    if (headers && headers['x-ratelimit-remaining']) {
      this.metrics.rateLimits.remaining = parseInt(headers['x-ratelimit-remaining']);
    }
    if (headers && headers['x-ratelimit-reset']) {
      this.metrics.rateLimits.resetTime = new Date(headers['x-ratelimit-reset']);
    }
  }

  startHealthMonitoring() {
    // Check health every 5 minutes
    setInterval(() => {
      this.healthChecker.checkHealth();
    }, 5 * 60 * 1000);
    
    // Initial health check
    setTimeout(() => this.healthChecker.checkHealth(), 1000);
  }

  getHealthStatus() {
    const now = Date.now();
    const uptime = now - this.metrics.startTime;
    const totalRequests = this.metrics.requests.total;
    const successRate = totalRequests > 0 ? (this.metrics.requests.success / totalRequests) : 1;
    const errorRate = totalRequests > 0 ? (this.metrics.requests.failed / totalRequests) : 0;
    
    let status = 'healthy';
    if (errorRate > 0.10 || this.circuitBreaker.state === 'OPEN') {
      status = 'unhealthy';
    } else if (errorRate > 0.05 || this.circuitBreaker.state === 'HALF_OPEN') {
      status = 'degraded';
    }
    
    return {
      status,
      uptime: this.formatDuration(uptime),
      requests: {
        total: totalRequests,
        success: this.metrics.requests.success,
        failed: this.metrics.requests.failed,
        cached: this.metrics.requests.cached,
        successRate: `${(successRate * 100).toFixed(2)}%`,
        errorRate: `${(errorRate * 100).toFixed(2)}%`
      },
      latency: {
        avg: `${this.metrics.latency.avg.toFixed(0)}ms`,
        min: `${this.metrics.latency.min}ms`,
        max: `${this.metrics.latency.max}ms`,
        p95: `${this.metrics.latency.p95.toFixed(0)}ms`
      },
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures
      },
      rateLimits: {
        remaining: this.metrics.rateLimits.remaining,
        resetTime: this.metrics.rateLimits.resetTime
      },
      errors: Object.fromEntries(this.metrics.errors),
      lastHealthCheck: this.healthChecker.lastCheck ? 
        new Date(this.healthChecker.lastCheck).toLocaleString() : 'Never'
    };
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // =================== INTELLIGENT CACHE MANAGEMENT ===================
  // Using your existing enterprise-grade cache system

  determineCacheType(config) {
    const typeMap = {
      'stats': 'userData',
      'single': 'mediaData',
      'search': 'searchResults',
      'list': 'userData'
    };
    return typeMap[config.type] || 'userData';
  }
  getCacheTTL(config) {
    // Return null to use your cache's built-in TTL system
    // Your cache already has perfect TTL mapping:
    // userData: 30min, mediaData: 10min, searchResults: 2min, etc.
    return null;
  }
  async invalidateRelatedCache(mediaId, updates) {
    // Use your cache's excellent invalidation system
    this.cache.invalidateByMedia(mediaId);
    
    // If status changed, invalidate user list caches
    if (updates.status) {
      try {
        const username = await this.plugin.auth.getAuthenticatedUsername();
        if (username) {
          this.cache.invalidateByUser(username);
        }
      } catch (error) {
        // Ignore errors getting username for cache invalidation
      }
    }
  }

  // =================== LOGGING ===================

  log(level, category, requestId, data = '') {
    if (!this.plugin.settings.debugMode && level !== 'ERROR') return;
    
    const timestamp = new Date().toISOString();
    const logData = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    
    console.log(`[${timestamp}] [Zoro-API] [${level}] [${category}] [${requestId}] ${logData}`);
  }

  // =================== EXISTING METHODS (Enhanced) ===================

  buildQuery(config) {
    let query, variables;
    
    if (config.type === 'stats') {
      query = this.getUserStatsQuery({
        mediaType: config.mediaType || 'ANIME',
        layout: config.layout || 'standard'
      });
      variables = { username: config.username };
    } else if (config.type === 'single') {
      query = this.getSingleMediaQuery(config.layout);
      variables = {
        mediaId: parseInt(config.mediaId),
        type: config.mediaType
      };
    } else if (config.type === 'search') {
      query = this.getSearchMediaQuery(config.layout);
      variables = {
        search: config.search,
        type: config.mediaType,
        page: config.page || 1,
        perPage: Math.min(config.perPage || 10, 50), // Limit to prevent large responses
      };
    } else {
      query = this.getMediaListQuery(config.layout);
      variables = {
        username: config.username,
        status: config.listType,
        type: config.mediaType || 'ANIME',
      };
    }
    
    return { query, variables };
  }

  async makeObsidianRequest(code, redirectUri) {
    const requestId = this.generateRequestId();
    const startTime = performance.now();
    
    try {
      // Input validation
      if (!code || typeof code !== 'string') {
        throw new ApiError('INVALID_CODE', 'Authorization code is required');
      }
      
      if (!redirectUri || typeof redirectUri !== 'string') {
        throw new ApiError('INVALID_REDIRECT_URI', 'Redirect URI is required');
      }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.plugin.settings.clientId,
        client_secret: this.plugin.settings.clientSecret || '',
        redirect_uri: redirectUri,
        code: code
      });

      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': `Zoro-Plugin/${this.plugin.manifest.version}`,
        'X-Request-ID': requestId
      };

      const result = await this.executeRequestWithRetry({
        makeRequest: () => requestUrl({
          url: 'https://anilist.co/api/v2/oauth/token',
          method: 'POST',
          headers,
          body: body.toString()
        }),
        config: { type: 'auth' },
        requestId,
        maxRetries: 2
      });

      if (!result || typeof result.json !== 'object') {
        throw new ApiError('INVALID_AUTH_RESPONSE', 'Invalid response structure from AniList');
      }

      const duration = performance.now() - startTime;
      this.recordMetrics('auth_success', 'oauth', duration);
      this.log('AUTH_SUCCESS', 'oauth', requestId, `${duration.toFixed(1)}ms`);

      return result.json;

    } catch (error) {
      const duration = performance.now() - startTime;
      const classifiedError = this.classifyError(error, { type: 'auth' });
      
      this.recordMetrics('auth_error', 'oauth', duration, classifiedError.type);
      this.log('AUTH_FAILED', 'oauth', requestId, {
        error: classifiedError.type,
        duration: `${duration.toFixed(1)}ms`
      });

      throw this.createUserFriendlyError(classifiedError);
    }
  }

  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.plugin.settings.accessToken) return false;
    
    try {
      // Use direct Media(id) query instead of user list
      const query = `query ($id: Int, $type: MediaType){ Media(id: $id, type: $type){ id } }`;
      const variables = { id: parseInt(mediaId), type: mediaType };
      const result = await this.makeRawRequest({ query, variables, config: { type: 'single_check', nocache: true } });
      return !!result?.Media?.id;
    } catch (error) {
      this.log('MEDIA_CHECK_FAILED', 'utility', this.generateRequestId(), {
        mediaId,
        mediaType,
        error: error.message
      });
      return false;
    }
  }

  // =================== QUERY BUILDERS (Enhanced with Error Handling) ===================

  getMediaListQuery(layout = 'card') {
    const baseFields = `
      id
      status
      score
      progress
    `;

    const mediaFields = {
      compact: `
        id
        idMal
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        format
        averageScore
        status
        genres
        episodes
        chapters
        isFavourite
      `,
      full: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        isFavourite
        description(asHtml: false)
        meanScore
        popularity
        favourites
        studios {
          nodes {
            name
          }
        }
      `
    };

    const fields = mediaFields[layout] || mediaFields.card;

    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType) {
        MediaListCollection(userName: $username, status: $status, type: $type) {
          lists {
            entries {
              ${baseFields}
              media {
                ${fields}
              }
            }
          }
        }
      }
    `;
  }

  getSingleMediaQuery(layout = 'card') {
    const mediaFields = {
      compact: `
        id
        idMal
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        format
        averageScore
        status
        genres
        episodes
        chapters
        isFavourite
      `,
      full: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        isFavourite
        description(asHtml: false)
        meanScore
        popularity
        favourites
        studios {
          nodes {
            name
          }
        }
      `
    };

    const selectedMediaFields = mediaFields[layout] || mediaFields.card;

    return `
      query ($mediaId: Int, $type: MediaType) {
        Media(id: $mediaId, type: $type) {
          ${selectedMediaFields}
        }
      }
    `;
  }

  getUserStatsQuery({ 
    mediaType = 'ANIME', 
    layout = 'standard',
    useViewer = false
  } = {}) {
    const typeKey = mediaType.toLowerCase();

    const statFields = {
      minimal: `
        count
        meanScore
        minutesWatched
        episodesWatched
        chaptersRead
      `,
      standard: `
        count
        meanScore
        standardDeviation
        episodesWatched
        minutesWatched
        chaptersRead
        volumesRead
        scores {
          score
          count
        }
        statuses {
          status
          count
        }
        formats {
          format
          count
        }
        releaseYears {
          releaseYear
          count
        }
      `,
      detailed: `
        count
        meanScore
        standardDeviation
        episodesWatched
        minutesWatched
        chaptersRead
        volumesRead
        scores {
          score
          count
        }
        statuses {
          status
          count
        }
        formats {
          format
          count
        }
        releaseYears {
          releaseYear
          count
        }
        startYears {
          startYear
          count
        }
        genres {
          genre
          count
          meanScore
          minutesWatched
        }
      `
    };

    const selectedFields = statFields[layout] || statFields.standard;
    const viewerPrefix = useViewer ? 'Viewer' : `User(name: $username)`;

    return `
      query ($username: String) {
        ${viewerPrefix} {
          id
          name
          avatar {
            large
            medium
          }
          statistics {
            ${typeKey} {
              ${selectedFields}
            }
          }
          favourites {
            ${typeKey} {
              nodes {
                id
                idMal
                title {
                  romaji
                  english
                }
                coverImage {
                  medium
                  large
                }
                meanScore
                ${mediaType === 'ANIME' ? 'episodes' : 'chapters'}
                format
              }
            }
          }
          mediaListOptions {
            scoreFormat
          }
        }
      }
    `;
  }

  getSearchMediaQuery(layout = 'card') {
    const mediaFields = {
      compact: `
        id
        idMal
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        format
        averageScore
        status
        genres
        episodes
        chapters
        isFavourite
      `,
      full: `
        id
        idMal
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        isFavourite
        description(asHtml: false)
        meanScore
        popularity
        favourites
      `
    };

    const fields = mediaFields[layout] || mediaFields.card;

    return `
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(search: $search, type: $type) {
            ${fields}
          }
        }
      }
    `;
  }
  
async checkIfMediaInList(mediaId, mediaType) {
  try {
    const userEntry = await this.getUserEntryForMedia(mediaId, mediaType);
    return userEntry !== null;
  } catch (error) {
    console.warn('[AniList] Error in checkIfMediaInList:', error);
    return false;
  }
}

async getUserEntryForMedia(mediaId, mediaType) {
  try {
    if (!this.plugin.settings.accessToken) {
      return null;
    }
    
    const username = await this.plugin.auth.getAuthenticatedUsername();
    if (!username) {
      return null;
    }
    
    // Minimal query - only get what the edit modal actually needs
    const query = `
      query ($username: String, $mediaId: Int, $type: MediaType) {
        MediaList(userName: $username, mediaId: $mediaId, type: $type) {
          id
          status
          score
          progress
          media {
            id
            idMal
            title {
              english
              romaji
            }
            episodes
            chapters
            isFavourite
          }
        }
      }
    `;
    
    const variables = {
      username: username,
      mediaId: parseInt(mediaId),
      type: mediaType
    };
    
    const result = await this.makeRawRequest({
      query,
      variables,
      config: { type: 'user_entry_check', nocache: true }
    });
    
    return result.MediaList; // null if not in list, entry if in list
    
  } catch (error) {
    console.warn('[AniList] getUserEntryForMedia failed:', error.message);
    return null;
  }
}
  getAniListUrl(mediaId, mediaType = 'ANIME') {
    try {
      this.validateMediaId(mediaId);
      
      const type = String(mediaType).toUpperCase();
      const validTypes = ['ANIME', 'MANGA'];
      const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime';

      return `https://anilist.co/${urlType}/${mediaId}`;
    } catch (error) {
      this.log('URL_GENERATION_FAILED', 'utility', this.generateRequestId(), {
        mediaId,
        mediaType,
        error: error.message
      });
      throw error;
    }
  }

  // =================== ADVANCED FEATURES ===================

  async getRecommendations(mediaId, limit = 5) {
    const query = `
      query ($mediaId: Int, $page: Int, $perPage: Int) {
        Media(id: $mediaId) {
          id
          recommendations(page: $page, perPage: $perPage, sort: RATING_DESC) {
            nodes {
              rating
              mediaRecommendation {
                id
                title { romaji english }
                coverImage { medium }
                format
                averageScore
                genres
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.makeRawRequest({
        query,
        variables: { mediaId: parseInt(mediaId), page: 1, perPage: limit },
        config: { type: 'recommendations' }
      });

      return result.Media.recommendations.nodes.map(node => ({
        rating: node.rating,
        media: node.mediaRecommendation
      }));
    } catch (error) {
      this.log('RECOMMENDATIONS_FAILED', 'feature', this.generateRequestId(), {
        mediaId,
        error: error.message
      });
      return [];
    }
  }

  async getTrendingMedia(mediaType = 'ANIME', limit = 10) {
    const query = `
      query ($type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: $type, sort: TRENDING_DESC) {
            id
            title { romaji english }
            coverImage { large medium }
            format
            averageScore
            trending
            genres
            episodes
            chapters
          }
        }
      }
    `;

    try {
      const result = await this.makeRawRequest({
        query,
        variables: { type: mediaType, page: 1, perPage: limit },
        config: { type: 'trending' }
      });

      return result.Page.media;
    } catch (error) {
      this.log('TRENDING_FAILED', 'feature', this.generateRequestId(), {
        mediaType,
        error: error.message
      });
      return [];
    }
  }

  // =================== DEBUG & MAINTENANCE ===================

  debugInfo() {
    return {
      health: this.getHealthStatus(),
      activeRequests: this.requestTracker.size,
      batchQueue: Object.fromEntries(
        Array.from(this.batchQueue.entries()).map(([key, items]) => [key, items.length])
      ),
      config: {
        maxRetries: this.config.maxRetries,
        requestTimeout: this.config.requestTimeout,
        circuitBreakerThreshold: this.config.circuitBreakerThreshold
      }
    };
  }

  async runHealthCheck() {
    const results = {
      timestamp: new Date().toISOString(),
      overall: 'unknown',
      checks: {}
    };

    // API connectivity
    try {
      await this.healthChecker.checkHealth();
      results.checks.connectivity = { status: 'pass', latency: this.healthChecker.latency };
    } catch (error) {
      results.checks.connectivity = { status: 'fail', error: error.message };
    }

    // Authentication
    try {
      if (this.plugin.settings.accessToken) {
        await this.plugin.auth.ensureValidToken();
        results.checks.authentication = { status: 'pass' };
      } else {
        results.checks.authentication = { status: 'skip', reason: 'No token configured' };
      }
    } catch (error) {
      results.checks.authentication = { status: 'fail', error: error.message };
    }

    // Cache
    try {
      const cacheStats = this.cache.getStats();
      results.checks.cache = { 
        status: 'pass', 
        size: cacheStats.cacheSize,
        hitRate: cacheStats.hitRate 
      };
    } catch (error) {
      results.checks.cache = { status: 'fail', error: error.message };
    }

    // Circuit breaker
    results.checks.circuitBreaker = {
      status: this.circuitBreaker.state === 'OPEN' ? 'warn' : 'pass',
      state: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures
    };

    // Overall status
    const hasFailures = Object.values(results.checks).some(check => check.status === 'fail');
    const hasWarnings = Object.values(results.checks).some(check => check.status === 'warn');
    
    if (hasFailures) {
      results.overall = 'fail';
    } else if (hasWarnings) {
      results.overall = 'warn';
    } else {
      results.overall = 'pass';
    }

    return results;
  }

  resetMetrics() {
    this.metrics = this.initializeMetrics();
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'CLOSED';
    this.log('METRICS_RESET', 'system', this.generateRequestId(), 'All metrics reset');
  }

  // =================== CLEANUP ===================

  async destroy() {
    // Clear any pending timers
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Clear batch queues
    this.batchQueue.clear();
    
    // Clear request tracker
    this.requestTracker.clear();

    // Final metrics log
    this.log('API_DESTROY', 'system', this.generateRequestId(), this.getHealthStatus());
  }
}
class MalApi {
  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue;
    this.cache = plugin.cache;
    this.errorHandler = ZoroError.instance(plugin);
    
    this.baseUrl = 'https://api.myanimelist.net/v2';
    this.tokenUrl = 'https://myanimelist.net/v1/oauth2/token';
    
    // FIXED: Corrected field syntax based on MAL API v2 specification
    // MAL API v2 uses curly braces {} for nested fields, not parentheses
    this.fieldSets = {
      compact: 'id,title,main_picture,list_status{status,score,num_episodes_watched,num_chapters_read}',
      card: 'id,title,main_picture,media_type,status,genres,num_episodes,num_chapters,mean,start_date,end_date,list_status{status,score,num_episodes_watched,num_chapters_read,num_volumes_read,is_rewatching,is_rereading,updated_at}',
      full: 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,list_status{status,score,num_episodes_watched,num_chapters_read,num_volumes_read,is_rewatching,is_rereading,updated_at},num_episodes,num_chapters,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics'
    };

    // Search-specific field sets (no user data)
    this.searchFieldSets = {
      compact: 'id,title,main_picture',
      card: 'id,title,main_picture,media_type,status,genres,num_episodes,num_chapters,mean,start_date,end_date',
      full: 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,num_episodes,num_chapters,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics'
    };

    this.malToAniListStatus = {
      'watching': 'CURRENT', 'reading': 'CURRENT', 'completed': 'COMPLETED',
      'on_hold': 'PAUSED', 'dropped': 'DROPPED', 
      'plan_to_watch': 'PLANNING', 'plan_to_read': 'PLANNING'
    };

    this.aniListToMalStatus = {
      'CURRENT': 'watching', 'COMPLETED': 'completed', 'PAUSED': 'on_hold',
      'DROPPED': 'dropped', 'PLANNING': 'plan_to_watch'
    };

    this.metrics = { requests: 0, cached: 0, errors: 0 };
  }
  

  async fetchMALData(config) {
    return await ZoroError.guard(
      async () => await this.executeFetch(config),
      'cache_fallback',
      'MalApi.fetchMALData'
    );
  }

  async executeFetch(config) {
    const normalizedConfig = this.validateConfig(config);
    const cacheKey = this.createCacheKey(normalizedConfig);
    const cacheScope = this.getCacheScope(normalizedConfig.type);
    
    if (!normalizedConfig.nocache) {
      const cached = this.cache.get(cacheKey, { scope: cacheScope });
      if (cached) {
        this.metrics.cached++;
        return cached;
      }
    }

    if (this.requiresAuth(normalizedConfig.type)) {
      await this.ensureValidToken();
    }
    
    const requestParams = this.buildRequestParams(normalizedConfig);
    
    const rawResponse = await this.makeRequest(requestParams);
    if (normalizedConfig.type === 'stats') {
  const user = this.transformUser(rawResponse);
  await this.attachMALDistributions(user);
  const enriched = { User: user };
  this.cache.set(cacheKey, enriched, { scope: cacheScope });
  return enriched;
}
    const transformedData = this.transformResponse(rawResponse, normalizedConfig);
    
    this.cache.set(cacheKey, transformedData, { scope: cacheScope });
    return transformedData;
  }

  transformResponse(data, config) {

    switch (config.type) {
      case 'search':
        return { Page: { media: data.data?.map(item => this.transformMedia(item)) || [] } };
      case 'single':
        // Prefer search/item based retrieval for single; this block remains for legacy but returns null to avoid random item
        return { MediaList: null };
      case 'item':
        return { Media: this.transformMedia(data) };
      case 'stats':
        return { User: this.transformUser(data) };
      default:
        return {
          MediaListCollection: {
            lists: [{ 
              entries: data.data?.map(item => this.transformListEntry(item, config)) || [] 
            }]
          }
        };
    }
  }

  transformListEntry(malEntry, config = {}) {
    const media = malEntry.node || malEntry;
    const listStatus = malEntry.list_status;
    const mediaType = media?.media_type || 'tv';
    
    
    
    
    let status = null;
    let score = 0;
    let progress = 0;
    let entryId = null;

    if (listStatus) {
      status = this.mapMALStatusToAniList(listStatus.status, mediaType);
      score = listStatus.score || 0;
      
      // Proper progress field selection based on media type
      if (mediaType === 'manga' || mediaType === 'novel' || mediaType === 'manhwa') {
        progress = listStatus.num_chapters_read || 0;
      } else {
        progress = listStatus.num_episodes_watched || 0;
      }
      
      entryId = listStatus.id || null;
      
    
    } else if (config.listType) {
      status = config.listType;
      score = 0;
      progress = 0;
      entryId = null;
      
    }

    return {
      id: entryId,
      status: status,
      score: score,
      progress: progress,
      chaptersRead: listStatus?.num_chapters_read ?? null,
volumesRead: listStatus?.num_volumes_read ?? null,
      media: this.transformMedia(malEntry)
    };
  }

  buildQueryParams(config) {
    const params = {};
    
    switch (config.type) {
      case 'single':
      case 'list':
        // Use list field sets that include list_status
        params.fields = this.getFieldsForLayout(config.layout || 'card', false);
        params.limit = config.limit || 1000;
        
        // Status filtering - only add if specific status requested
        if (config.listType && config.listType !== 'ALL') {
          const malStatus = this.mapAniListStatusToMAL(config.listType, config.mediaType?.toLowerCase());
          if (malStatus) {
            params.status = malStatus;
          }
        }
        params.sort = 'list_score';
        break;
        
      case 'search':
        params.q = (config.search || config.query || '').trim();
        params.limit = config.perPage || 25;
        params.offset = ((config.page || 1) - 1) * (config.perPage || 25);
        // Use search field sets (no user data)
        params.fields = this.getFieldsForLayout(config.layout || 'card', true);
        break;
      
      case 'item':
        // Use detailed non-list fields for single item fetch
        params.fields = this.getFieldsForLayout(config.layout || 'card', true);
        break;
        
      case 'stats':
       params.fields = [
  'id',
  'name',
  'picture',
  'anime_statistics',
  'manga_statistics'
].join(',');
        break;
    }
    
    return params;
  }

  async makeRequest(requestParams) {
    this.metrics.requests++;
    
    const requestFn = () => requestUrl({
      url: requestParams.url,
      method: requestParams.method || 'GET',
      headers: requestParams.headers || {},
      body: requestParams.body
    });

    try {
      const response = await this.requestQueue.add(requestFn, {
        priority: requestParams.priority || 'normal',
        metadata: requestParams.metadata || {},
        timeout: 30000
      });

      if (!response?.json) {
        throw ZoroError.create('EMPTY_RESPONSE', 'Empty response from MAL', { url: requestParams.url }, 'error');
      }

      if (response.json.error) {
        throw ZoroError.create('MAL_API_ERROR', response.json.message || 'MAL API error', { error: response.json }, 'error');
      }

      

      return response.json;
    } catch (error) {
      this.metrics.errors++;
      if (error.type) throw error;
      throw ZoroError.create('REQUEST_FAILED', 'MAL request failed', { error: error.message, url: requestParams.url }, 'error');
    }
  }

  async updateMediaListEntry(mediaId, updates) {
  
  
  try {
    
    
    const result = await ZoroError.guard(
      async () => {
        
        return await this.executeUpdate(mediaId, updates);
      },
      'retry_once',
      'MalApi.updateMediaListEntry'
    );
    
    
    
    return result;
  } catch (error) {
    
    
    throw error;
  }
}
  async executeUpdate(mediaId, updates) {
    if (!this.isValidMediaId(mediaId)) {
      throw ZoroError.create('INVALID_MEDIA_ID', `Invalid media ID: ${mediaId}`, { mediaId }, 'error');
    }

    await this.ensureValidToken();
    const mediaType = await this.getMediaType(mediaId);
    const endpoint = mediaType === 'anime' ? 'anime' : 'manga';
    const body = new URLSearchParams();
    
    if (mediaType === 'anime') {
        body.append('is_rewatching', 'false');
    } else {
        body.append('is_rereading', 'false'); 
    }
    
    if (updates.status !== undefined && updates.status !== null) {
      const malStatus = this.mapAniListStatusToMAL(updates.status, mediaType);
      if (malStatus) {
        body.append('status', malStatus);
      }
    }
    
    if (updates.score !== undefined && updates.score !== null) {
      const score = Math.max(0, Math.min(10, Math.round(updates.score)));
      body.append('score', score.toString());
    }
    
    if (updates.progress !== undefined && updates.progress !== null) {
      const progress = Math.max(0, parseInt(updates.progress) || 0);
      const progressField = mediaType === 'anime' ? 'num_watched_episodes' : 'num_chapters_read';
      body.append(progressField, progress.toString());
    }

    if (body.toString().length === 0) {
      throw ZoroError.create('NO_UPDATES', 'No valid updates provided', { updates }, 'error');
    }

    const requestFn = async () => {
      const makeRequest = async (method) => {
        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.plugin.settings.malAccessToken}`,
          'User-Agent': 'Obsidian-Zoro-Plugin'
        };
        if (this.plugin?.settings?.malClientId) {
          headers['X-MAL-CLIENT-ID'] = this.plugin.settings.malClientId;
        }
        return await requestUrl({
          url: `${this.baseUrl}/${endpoint}/${mediaId}/my_list_status`,
          method,
          headers,
          body: body.toString()
        });
      };

      // Try PATCH first, then fall back to PUT if method not allowed
      try {
        const response = await makeRequest('PATCH');
        if (response.status >= 400) {
          if (response.status === 405) throw Object.assign(new Error('METHOD_NOT_ALLOWED'), { status: response.status });
          throw new Error(`HTTP ${response.status}: ${response.text || 'Unknown error'}`);
        }
        return response;
      } catch (err) {
        if (err && (err.status === 405 || /405/.test(err.message || ''))) {
          const response = await makeRequest('PUT');
          if (response.status >= 400) {
            throw new Error(`HTTP ${response.status}: ${response.text || 'Unknown error'}`);
          }
          return response;
        }
        throw err;
      }
    };

    const response = await this.requestQueue.add(requestFn, { priority: 'high' });
    
    if (!response?.json && response.status !== 200) {
      throw ZoroError.create('EMPTY_UPDATE_RESPONSE', 'Invalid response from MAL update', { 
        mediaId, 
        status: response.status,
        body: body.toString()
      }, 'error');
    }

    let responseData = response.json || {};
    
    if (responseData.error) {
      throw ZoroError.create('MAL_UPDATE_ERROR', responseData.message || 'MAL update failed', { 
        error: responseData,
        requestBody: body.toString(),
        mediaId 
      }, 'error');
    }

    this.cache.invalidateByMedia(mediaId);
    this.cache.invalidateScope('userData');
    
    return {
      id: responseData.id || null,
      status: responseData.status ? this.mapMALStatusToAniList(responseData.status, mediaType) : updates.status,
      score: responseData.score !== undefined ? responseData.score : (updates.score || 0),
      progress: mediaType === 'anime' 
        ? (responseData.num_episodes_watched !== undefined ? responseData.num_episodes_watched : (updates.progress || 0))
        : (responseData.num_chapters_read !== undefined ? responseData.num_chapters_read : (updates.progress || 0))
    };
  }

  mapAniListStatusToMAL(aniListStatus, mediaType = 'anime') {
    if (!aniListStatus) return null;
    
    // FIXED: More precise media type detection
    const isAnime = mediaType === 'anime' || mediaType === 'tv' || mediaType === 'movie' || 
                   mediaType === 'special' || mediaType === 'ova' || mediaType === 'ona';
    
    const statusMap = {
      'CURRENT': isAnime ? 'watching' : 'reading',
      'COMPLETED': 'completed',
      'PAUSED': 'on_hold',
      'DROPPED': 'dropped',
      'PLANNING': isAnime ? 'plan_to_watch' : 'plan_to_read',
      'REPEATING': isAnime ? 'watching' : 'reading'
    };
    
    return statusMap[aniListStatus] || null;
  }

  mapMALStatusToAniList(malStatus, mediaType = 'anime') {
    if (!malStatus) return null;
    
    const statusMap = {
      'watching': 'CURRENT',
      'reading': 'CURRENT', 
      'completed': 'COMPLETED',
      'on_hold': 'PAUSED',
      'dropped': 'DROPPED',
      'plan_to_watch': 'PLANNING',
      'plan_to_read': 'PLANNING'
    };
    
    return statusMap[malStatus.toLowerCase()] || null;
  }

  transformMedia(malMedia) {
    const media = malMedia.node || malMedia;
    
    return {
      id: media.id,
      title: {
        romaji: media.title || 'Unknown Title',
        english: media.alternative_titles?.en || media.title || 'Unknown Title',
        native: media.alternative_titles?.ja || media.title || 'Unknown Title'
      },
      coverImage: {
        large: media.main_picture?.large || media.main_picture?.medium || null,
        medium: media.main_picture?.medium || media.main_picture?.large || null
      },
      format: media.media_type?.toUpperCase() || null,
      averageScore: media.mean ? Math.round(media.mean * 10) : null,
      status: media.status?.toUpperCase()?.replace('_', '_') || null,
      genres: media.genres?.map(g => g.name) || [],
      episodes: media.num_episodes || null,
      chapters: media.num_chapters || null,
      isFavourite: false,
      startDate: this.parseDate(media.start_date),
      endDate: this.parseDate(media.end_date)
    };
  }

  transformUser(malUser) {
    const animeStats = malUser?.anime_statistics || {};
const mangaStats = malUser?.manga_statistics || {};

const countAnime = animeStats.num_items || 0;
const countManga = mangaStats.num_items || 0;

const minutesWatched = typeof animeStats.num_days_watched === 'number'
  ? Math.round(animeStats.num_days_watched * 24 * 60)
  : 0;
    return {
      id: malUser?.id || null,
name: malUser?.name || 'Unknown User',
      avatar: {
        large: malUser?.picture || null,
medium: malUser?.picture || null
},
mediaListOptions: {
  scoreFormat: 'POINT_10'
      },
      statistics: {
        anime: {
  count: countAnime,
  meanScore: typeof animeStats.mean_score === 'number' ? Math.round(animeStats.mean_score * 10) : 0,
  standardDeviation: 0,
  episodesWatched: animeStats.num_episodes || 0,
  minutesWatched: minutesWatched
},
manga: {
  count: countManga,
  meanScore: typeof mangaStats.mean_score === 'number' ? Math.round(mangaStats.mean_score * 10) : 0,
  standardDeviation: 0,
  chaptersRead: mangaStats.num_chapters || 0,
  volumesRead: mangaStats.num_volumes || 0
}
      }
    };
  }

  parseDate(dateString) {
    if (!dateString) return null;
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate()
      };
    } catch (error) {
      return null;
    }
  }

  requiresAuth(requestType) {
    return requestType !== 'search';
  }

  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw ZoroError.create('INVALID_CONFIG', 'Request config must be an object', { config }, 'error');
    }

    const normalized = { ...config };
    if (!normalized.type) normalized.type = 'list';
    if (normalized.mediaType) normalized.mediaType = normalized.mediaType.toUpperCase();
    
    if (normalized.page && (normalized.page < 1 || normalized.page > 1000)) {
      throw ZoroError.create('INVALID_PAGINATION', `Invalid page: ${normalized.page}`, { page: normalized.page }, 'error');
    }
    
    return normalized;
  }

  buildRequestParams(config) {
    const url = this.buildEndpointUrl(config);
    const params = this.buildQueryParams(config);
    const headers = this.getAuthHeaders();
    
    return {
      url: this.buildFullUrl(url, params),
      method: 'GET',
      headers,
      priority: config.priority || 'normal',
      metadata: { type: config.type, mediaType: config.mediaType }
    };
  }

  buildEndpointUrl(config) {
    switch (config.type) {
      case 'stats':
        return `${this.baseUrl}/users/@me`;
      case 'single':
      case 'list':
        // FIXED: Use correct endpoint format
        const mediaType = config.mediaType === 'ANIME' ? 'anime' : 'manga';
        return `${this.baseUrl}/users/@me/${mediaType}list`;
      case 'search':
        const searchType = config.mediaType === 'ANIME' ? 'anime' : 'manga';
        return `${this.baseUrl}/${searchType}`;
      case 'item':
        const itemType = config.mediaType === 'ANIME' ? 'anime' : 'manga';
        return `${this.baseUrl}/${itemType}/${parseInt(config.mediaId)}`;
      default:
        throw ZoroError.create('INVALID_REQUEST_TYPE', `Unknown type: ${config.type}`, { config }, 'error');
    }
  }

  async ensureValidToken() {
    if (!this.plugin.settings.malAccessToken) {
      throw ZoroError.create('AUTH_REQUIRED', 'Authentication required', {}, 'error');
    }
    return await this.plugin.malAuth?.ensureValidToken?.() || true;
  }

  getAuthHeaders() {
    const headers = { 
      'Accept': 'application/json',
      'User-Agent': 'Obsidian-Zoro-Plugin'
    };
    if (this.plugin.settings.malAccessToken) {
      headers['Authorization'] = `Bearer ${this.plugin.settings.malAccessToken}`;
    }
    if (this.plugin.settings.malClientId) {
      headers['X-MAL-CLIENT-ID'] = this.plugin.settings.malClientId;
    }
    return headers;
  }

  createCacheKey(config) {
    const sortedConfig = {};
    Object.keys(config).sort().forEach(key => {
      sortedConfig[key] = config[key];
    });
    return JSON.stringify(sortedConfig);
  }

  getCacheScope(requestType) {
    const scopeMap = {
      'stats': 'userData',
      'single': 'mediaData', 
      'item': 'mediaData',
      'search': 'searchResults',
      'list': 'userData'
    };
    return scopeMap[requestType] || 'userData';
  }

  buildFullUrl(baseUrl, params) {
    if (!params || Object.keys(params).length === 0) return baseUrl;
    const queryString = new URLSearchParams(params).toString();
    return `${baseUrl}?${queryString}`;
  }

  getFieldsForLayout(layout = 'card', isSearch = false) {
    const fieldSet = isSearch ? this.searchFieldSets : this.fieldSets;
    return fieldSet[layout] || fieldSet.card;
  }

  isValidMediaId(mediaId) {
    const id = parseInt(mediaId);
    return !isNaN(id) && id > 0 && id < Number.MAX_SAFE_INTEGER;
  }

  getMALUrl(mediaId, mediaType = 'ANIME') {
    if (!this.isValidMediaId(mediaId)) {
      throw ZoroError.create('INVALID_MEDIA_ID', `Invalid mediaId: ${mediaId}`, { mediaId, mediaType }, 'error');
    }
    const type = String(mediaType).toUpperCase();
    const urlType = type === 'MANGA' ? 'manga' : 'anime';
    return `https://myanimelist.net/${urlType}/${mediaId}`;
  }

  async getMediaType(mediaId) {
    const types = ['anime', 'manga'];
    
    for (const type of types) {
      try {
        const requestParams = {
          url: `${this.baseUrl}/${type}/${mediaId}?fields=id`,
          headers: this.getAuthHeaders(),
          priority: 'low'
        };
        
        const response = await this.makeRequest(requestParams);
        if (response && !response.error) return type;
      } catch (error) {
        continue;
      }
    }
    return 'anime';
  }

  async makeObsidianRequest(code, redirectUri) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.plugin.settings.malClientId,
      client_secret: this.plugin.settings.malClientSecret || '',
      redirect_uri: redirectUri,
      code: code,
      code_verifier: this.plugin.settings.malCodeVerifier
    });

    const requestFn = () => requestUrl({
      url: this.tokenUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: body.toString()
    });

    try {
      const response = await this.requestQueue.add(requestFn, { priority: 'high' });
      
      if (!response?.json || typeof response.json !== 'object') {
        throw ZoroError.create('INVALID_AUTH_RESPONSE', 'Invalid auth response from MAL', {}, 'error');
      }

      return response.json;
    } catch (error) {
      throw ZoroError.create('AUTH_FAILED', 'MAL authentication failed', { error: error.message }, 'error');
    }
  }

  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.plugin.settings.malAccessToken) return false;
    try {
      // Use item endpoint to determine existence instead of user list
      const type = mediaType === 'ANIME' ? 'anime' : 'manga';
      const requestParams = {
        url: `${this.baseUrl}/${type}/${parseInt(mediaId)}?fields=id`,
        headers: this.getAuthHeaders(),
        priority: 'low'
      };
      const resp = await this.makeRequest(requestParams);
      return !!resp?.id;
    } catch {
      return false;
    }
  }

  async getMALRecommendations(mediaId, mediaType = 'ANIME') {
    return await ZoroError.guard(
      async () => {
        await this.ensureValidToken();
        const type = mediaType === 'ANIME' ? 'anime' : 'manga';
        
        const requestParams = {
          url: `${this.baseUrl}/${type}/${mediaId}?fields=recommendations`,
          headers: this.getAuthHeaders(),
          priority: 'low'
        };

        const response = await this.makeRequest(requestParams);
        return response.recommendations?.map(rec => ({
          node: this.transformMedia(rec.node),
          num_recommendations: rec.num_recommendations
        })) || [];
      },
      'degrade_gracefully',
      'MalApi.getMALRecommendations'
    );
  }

  async getMALSeasonalAnime(year, season) {
    return await ZoroError.guard(
      async () => {
        await this.ensureValidToken();
        
        const requestParams = {
          url: `${this.baseUrl}/anime/season/${year}/${season}?fields=${this.getFieldsForLayout('card', true)}`,
          headers: this.getAuthHeaders(),
          priority: 'low'
        };

        const response = await this.makeRequest(requestParams);
        return {
          Page: {
            media: response.data?.map(item => this.transformMedia(item)) || []
          }
        };
      },
      'cache_fallback',
      'MalApi.getMALSeasonalAnime'
    );
  }

  enableDebug(enabled = true) {
    this.errorHandler.build('DEBUG_MODE_CHANGED', 
      `Debug mode ${enabled ? 'enabled' : 'disabled'}`, 
      { enabled }, 
      'info'
    );
  }

  async fetchMALStats(config) {
    return this.fetchMALData({ ...config, type: 'stats' });
  }

  async fetchMALList(config) {
    return this.fetchMALData(config);
  }

  getMetrics() {
    return { ...this.metrics };
  }
  
  async attachMALDistributions(user) {
  try {
    const [animeEntries, mangaEntries] = await Promise.all([
      this.fetchUserListEntries('ANIME'),
      this.fetchUserListEntries('MANGA')
    ]);

    const animeAgg = this.aggregateDistributionsFromEntries(animeEntries, 'anime');
    const mangaAgg = this.aggregateDistributionsFromEntries(mangaEntries, 'manga');

    if (user?.statistics?.anime) {
      Object.assign(user.statistics.anime, animeAgg);
    }
    if (user?.statistics?.manga) {
      Object.assign(user.statistics.manga, mangaAgg);
    }
    
    const applyFallbacks = (entries, statsObj, type) => {
  if (!statsObj) return;

  if (!statsObj.count || statsObj.count === 0) {
    statsObj.count = Array.isArray(entries) ? entries.length : 0;
  }

  if ((!statsObj.meanScore || statsObj.meanScore === 0) && Array.isArray(entries) && entries.length) {
    const rated = entries.filter(e => typeof e.score === 'number' && e.score > 0);
    if (rated.length) {
      const avg10 = rated.reduce((sum, e) => sum + e.score, 0) / rated.length;
      statsObj.meanScore = Math.round(avg10 * 10);
    }
  }

  if (type === 'manga') {
    if (!statsObj.chaptersRead || statsObj.chaptersRead === 0) {
      statsObj.chaptersRead = entries.reduce((s, e) => s + (e.chaptersRead || 0), 0);
    }
    if (!statsObj.volumesRead || statsObj.volumesRead === 0) {
      statsObj.volumesRead = entries.reduce((s, e) => s + (e.volumesRead || 0), 0);
    }
  } else if (type === 'anime') {
    if (!statsObj.episodesWatched || statsObj.episodesWatched === 0) {
      statsObj.episodesWatched = entries.reduce((s, e) => s + (e.progress || 0), 0);
    }
  }
};

applyFallbacks(animeEntries, user?.statistics?.anime, 'anime');
applyFallbacks(mangaEntries, user?.statistics?.manga, 'manga');
    
  } catch (e) {
  }
}

async fetchUserListEntries(mediaType) {
  const listConfig = { type: 'list', mediaType, layout: 'card', limit: 1000 };
  const requestParams = this.buildRequestParams(listConfig);
  const raw = await this.makeRequest(requestParams);
  const transformed = this.transformResponse(raw, listConfig);
  const entries = transformed?.MediaListCollection?.lists?.[0]?.entries || [];
  return entries;
}

aggregateDistributionsFromEntries(entries, typeLower) {
  const result = {
    statuses: [],
    scores: [],
    formats: [],
    releaseYears: [],
    genres: []
  };

  if (!Array.isArray(entries) || entries.length === 0) return result;

  const statusCounts = new Map();
  const scoreCounts = new Map();
  const formatCounts = new Map();
  const yearCounts = new Map();
  const genreSet = new Set();

  for (const entry of entries) {
    const status = entry?.status;
    if (status) {
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    }

    const rawScore = entry?.score;
    if (typeof rawScore === 'number' && rawScore > 0) {
      const scaled = Math.round(rawScore * 10);
      scoreCounts.set(scaled, (scoreCounts.get(scaled) || 0) + 1);
    }

    const format = entry?.media?.format;
    if (format) {
      formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
    }

    const year = entry?.media?.startDate?.year;
    if (typeof year === 'number' && year > 0) {
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    }

    const genres = entry?.media?.genres || [];
    for (const g of genres) {
      if (typeof g === 'string' && g.trim()) genreSet.add(g);
    }
  }

  result.statuses = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  result.scores = Array.from(scoreCounts.entries())
    .map(([score, count]) => ({ score, count }))
    .sort((a, b) => a.score - b.score);

  result.formats = Array.from(formatCounts.entries())
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count);

  result.releaseYears = Array.from(yearCounts.entries())
    .map(([releaseYear, count]) => ({ releaseYear, count }))
    .sort((a, b) => b.releaseYear - a.releaseYear);

  result.genres = Array.from(genreSet);

  return result;
}
}
class SimklApi {
  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue;
    this.cache = plugin.cache;
    
    this.baseUrl = 'https://api.simkl.com';
    this.tokenUrl = 'https://api.simkl.com/oauth/token';
    
    // Field sets for different request types (similar to MAL structure)
    this.fieldSets = {
      compact: 'title,poster',
      card: 'title,poster,year,ids,genres,rating,total_episodes,status',
      full: 'title,poster,year,ids,genres,rating,total_episodes,total_seasons,status,overview,first_aired,last_aired,country,network,aired_episodes'
    };

    // Search-specific field sets (no user data)
    this.searchFieldSets = {
      compact: 'title,poster,year,ids',
      card: 'title,poster,year,ids,genres,rating,total_episodes',
      full: 'title,poster,year,ids,genres,rating,total_episodes,overview,first_aired,last_aired'
    };

    // Status mappings (Simkl uses different status names)
    this.simklToAniListStatus = {
      'watching': 'CURRENT',
      'completed': 'COMPLETED', 
      'hold': 'PAUSED',
      'dropped': 'DROPPED',
      'plantowatch': 'PLANNING',
      'notinteresting': 'DROPPED'
    };

    this.aniListToSimklStatus = {
      'CURRENT': 'watching',
      'COMPLETED': 'completed',
      'PAUSED': 'hold',
      'DROPPED': 'dropped',
      'PLANNING': 'plantowatch'
    };

    // Media type mapping for API endpoints and data parsing
    this.mediaTypeMap = {
      'ANIME': 'anime',
      'MANGA': 'anime', // Simkl doesn't have manga, fallback to anime
      'TV': 'tv',
      'MOVIE': 'movies',
      'MOVIES': 'movies'
    };

    this.metrics = { requests: 0, cached: 0, errors: 0 };
  }

  // =================== MAIN FETCH METHOD (Following MAL pattern) ===================

  async fetchSimklData(config) {
    try {
      return await this.executeFetch(config);
    } catch (error) {
      this.metrics.errors++;
      
      throw this.createUserFriendlyError(error);
    }
  }

  async executeFetch(config) {
    const normalizedConfig = this.validateConfig(config);
    const cacheKey = this.createCacheKey(normalizedConfig);
    const cacheScope = this.getCacheScope(normalizedConfig.type);
    
    // Check cache first
    if (!normalizedConfig.nocache) {
      const cached = this.cache.get(cacheKey, { scope: cacheScope });
      if (cached) {
        this.metrics.cached++;
        return cached;
      }
    }

    // Ensure authentication for user-specific requests
    if (this.requiresAuth(normalizedConfig.type)) {
      await this.ensureValidToken();
    }
    
    // Build and execute request
    let transformedData = null;
    try {
      const requestParams = this.buildRequestParams(normalizedConfig);
      const rawResponse = await this.makeRequest(requestParams);
      transformedData = this.transformResponse(rawResponse, normalizedConfig);
    } catch (err) {
      if (normalizedConfig.type !== 'single') {
        throw err;
      }
      console.warn('[Simkl] Primary single request failed, will try public fallback:', err?.message || err);
    }
    
    // If stats requested, enrich with distributions computed from user lists
    if (normalizedConfig.type === 'stats' && transformedData?.User) {
      try {
        await this.attachSimklDistributions(transformedData.User);
      } catch (e) {
        
      }
    }
     // Public fallback for single media when not found or auth missing
    if (normalizedConfig.type === 'single' && (!transformedData || transformedData.MediaList == null)) {
      try {
        const publicResult = await this.fetchSingleByIdPublic(normalizedConfig.mediaId, normalizedConfig.mediaType);
        if (publicResult) {
          transformedData = publicResult;
        }
      } catch (e) {
        console.warn('[Simkl] Public single fetch fallback failed:', e?.message || e);
      }
    }
    
    // Cache successful results
    if (transformedData && !normalizedConfig.nocache) {
      this.cache.set(cacheKey, transformedData, { scope: cacheScope });
    }
    
    return transformedData;
  }

  // =================== REQUEST BUILDING (Fixed based on MAL pattern) ===================

  buildRequestParams(config) {
    const endpoint = this.buildEndpointUrl(config);
    const params = this.buildQueryParams(config);
    const headers = this.getHeaders(config);
    
    return {
      url: this.buildFullUrl(endpoint, params),
      method: config.method || 'GET',
      headers,
      body: config.body,
      priority: config.priority || 'normal'
    };
  }

  buildEndpointUrl(config) {
    const simklMediaType = this.getSimklMediaType(config.mediaType);
    
    switch (config.type) {
      case 'stats':
        return `${this.baseUrl}/users/settings`;
      case 'list':
        return `${this.baseUrl}/sync/all-items/${simklMediaType}`;
      case 'single':
        // For single items, we need to get the user's list and filter
        return `${this.baseUrl}/sync/all-items/${simklMediaType}`;
      case 'search':
        return `${this.baseUrl}/search/${simklMediaType}`;
      default:
        throw new Error(`Unknown request type: ${config.type}`);
    }
  }

  // FIXED: Proper media type conversion for Simkl API
  getSimklMediaType(mediaType) {
    if (!mediaType) return 'anime'; // default
    
    const upperType = String(mediaType).toUpperCase();
    return this.mediaTypeMap[upperType] || 'anime';
  }

  buildQueryParams(config) {
    const params = {};
    
    // Always include client_id for public endpoints
    if (this.plugin.settings.simklClientId) {
      params.client_id = this.plugin.settings.simklClientId;
    }
    
    switch (config.type) {
      case 'search':
        if (config.search || config.query) {
          params.q = (config.search || config.query).trim();
        }
        params.limit = Math.min(config.perPage || 25, 50);
        params.page = config.page || 1;
        break;
        
      case 'list':
      case 'single':
        // Simkl returns all user data in one call, no additional params needed
        break;
        
      case 'stats':
        // User settings/stats
        break;
    }
    
    return params;
  }

  getHeaders(config) {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `Zoro-Plugin/${this.plugin.manifest?.version || '1.0.0'}`
    };
    
    if (this.plugin.settings.simklClientId) {
      headers['simkl-api-key'] = this.plugin.settings.simklClientId;
    }
    
    // Add auth token for user-specific requests
    if (this.requiresAuth(config.type) && this.plugin.settings.simklAccessToken) {
      headers['Authorization'] = `Bearer ${this.plugin.settings.simklAccessToken}`;
    }
    
    return headers;
  }

  // =================== HTTP REQUEST EXECUTION (Following MAL pattern) ===================

  async makeRequest(requestParams) {
    this.metrics.requests++;
    
    const requestFn = () => requestUrl({
      url: requestParams.url,
      method: requestParams.method || 'GET',
      headers: requestParams.headers || {},
      body: requestParams.body
    });

    try {
      const response = await this.requestQueue.add(requestFn, {
        priority: requestParams.priority || 'normal',
        timeout: 30000
      });

      if (!response?.json) {
        throw new Error('Empty response from Simkl');
      }

      // Handle Simkl error responses
      if (response.json.error) {
        
        throw new Error(response.json.error_description || response.json.error);
      }

      
      return response.json;

    } catch (error) {
      
      throw error;
    }
  }

  // =================== DATA TRANSFORMATION (Fixed to match expected structure) ===================

  transformResponse(data, config) {
    
    
    switch (config.type) {
      case 'search':
        return this.transformSearchResponse(data, config);
      case 'single':
        return this.transformSingleResponse(data, config);
      case 'stats':
        return this.transformStatsResponse(data);
      case 'list':
        return this.transformListResponse(data, config);
      default:
        return this.transformListResponse(data, config);
    }
  }

  transformSearchResponse(data, config) {
    const mediaList = Array.isArray(data) ? data : [];
    
    return {
      Page: {
        media: mediaList.map(item => this.transformMedia(item, config.mediaType))
      }
    };
  }

  transformSingleResponse(data, config) {
    const targetMediaId = parseInt(config.mediaId);
    let targetEntry = null;
    
    // FIXED: Use the actual media type being requested
    const simklMediaType = this.getSimklMediaType(config.mediaType);
    const mediaArray = data[simklMediaType] || [];
    
    if (Array.isArray(mediaArray)) {
      targetEntry = mediaArray.find(entry => {
        const show = entry.show || entry;
        const ids = show.ids || show;
        return ids.simkl === targetMediaId || ids.id === targetMediaId;
      });
    }
    
    return {
      MediaList: targetEntry ? this.transformListEntry(targetEntry, config.mediaType) : null
    };
  }
  
    // Fallback: fetch a single media by Simkl ID using public search-by-id API
  async fetchSingleByIdPublic(mediaId, mediaType) {
    const id = parseInt(mediaId);
    if (!id || Number.isNaN(id)) return null;

    const url = `${this.baseUrl}/search/id?simkl=${encodeURIComponent(id)}`;
    const headers = this.getHeaders({ type: 'search' });

    try {
      const response = await this.makeRequest({ url, method: 'GET', headers, priority: 'normal' });
      const wrapped = this.transformSinglePublicResponse(response, mediaType, id);
      return wrapped;
    } catch (e) {
      console.warn('[Simkl] fetchSingleByIdPublic failed:', e?.message || e);
      return { MediaList: null };
    }
  }

  // Parse public search-by-id response into MediaList shape
  transformSinglePublicResponse(raw, mediaType, targetId) {
    if (!raw || (typeof raw !== 'object' && !Array.isArray(raw))) return { MediaList: null };

    const candidates = [];
    ['anime', 'movies', 'tv', 'shows', 'results', 'items'].forEach(key => {
      if (Array.isArray(raw?.[key])) candidates.push(...raw[key]);
    });

    if (Array.isArray(raw)) candidates.push(...raw);
    if (candidates.length === 0 && raw?.ids) candidates.push(raw);

    const match = candidates.find(item => {
      const node = item.movie || item.show || item;
      const ids = node?.ids || node || {};
      return Number(ids.simkl || ids.id) === Number(targetId);
    }) || null;

    if (!match) return { MediaList: null };

    const node = match.movie || match.show || match;
    const entry = {
      id: null,
      status: null,
      score: null,
      progress: this.isMovieType(mediaType, node) ? 0 : 0,
      media: this.transformMedia(node, mediaType)
    };

    return { MediaList: entry };
  }

  // FIXED: Complete rewrite of list response transformation with comprehensive debugging
  transformListResponse(data, config) {
    let entries = [];
    
    
    
    // FIXED: Use the correct media type key from the response
    const simklMediaType = this.getSimklMediaType(config.mediaType);
    const raw = data || {};

    
    
    // CRITICAL FIX: Try multiple possible data structure patterns
    
    // Pattern 1: Direct array under media type key
    if (Array.isArray(raw[simklMediaType])) {
      entries = raw[simklMediaType];
      
    }
    // Pattern 2: Root is an array (search results)
    else if (Array.isArray(raw)) {
      entries = raw;
      
    }
    // Pattern 3: Grouped data by status (e.g., {watching: [], completed: []})
    else if (raw[simklMediaType] && typeof raw[simklMediaType] === 'object') {
      const grouped = raw[simklMediaType];
      
      Object.keys(grouped).forEach(statusKey => {
        const arr = grouped[statusKey];
        if (Array.isArray(arr)) {
          
          arr.forEach(item => entries.push({ ...item, _status: statusKey }));
        }
      });
    }
    // Pattern 4: Try alternative media type keys (fallback)
    else {
      
      
      // Try common alternative keys
      const alternativeKeys = ['anime', 'movies', 'tv', 'shows', 'items', 'results'];
      let found = false;
      
      for (const key of alternativeKeys) {
        if (raw[key] && Array.isArray(raw[key]) && raw[key].length > 0) {
          
          entries = raw[key];
          found = true;
          break;
        }
      }
      
      // Last resort: try any array in the response
      if (!found) {
        
        Object.keys(raw).forEach(key => {
          if (Array.isArray(raw[key]) && raw[key].length > 0) {
            
            entries = entries.concat(raw[key]);
          }
        });
      }
    }
    
    
    
    // Sample the first entry to understand structure
    if (entries.length > 0) {
    }
    
    // Filter by status if specified
    if (config.listType && config.listType !== 'ALL') {
      const targetStatus = this.mapAniListStatusToSimkl(config.listType);
      const beforeFilter = entries.length;
      entries = entries.filter(entry => (entry.status || entry._status) === targetStatus);
      
    }
    
    
    // Transform entries with enhanced error handling
    const transformedEntries = [];
    entries.forEach((entry, index) => {
      try {
        const transformed = this.transformListEntry(entry, config.mediaType);
        if (transformed) {
          transformedEntries.push(transformed);
        } else {
          console.warn(`[Simkl] Entry ${index} transformed to null`);
        }
      } catch (error) {
        console.error(`[Simkl] Error transforming entry ${index}:`, error, entry);
      }
    });
    
    
    return {
      MediaListCollection: {
        lists: [{
          entries: transformedEntries
        }]
      }
    };
  }

  transformStatsResponse(data) {
    // Simkl user stats structure is different, adapt as needed
    const user = data.user || data;
    
    return {
      User: {
        id: user.id || null,
        name: user.name || user.username || 'Unknown User',
        avatar: {
          large: user.avatar || null,
          medium: user.avatar || null
        },
        statistics: {
          anime: {
            count: user.stats?.anime?.total || 0,
            meanScore: user.stats?.anime?.rating || 0,
            standardDeviation: 0,
            episodesWatched: user.stats?.anime?.episodes || 0,
            minutesWatched: user.stats?.anime?.minutes || 0
          },
          manga: {
            count: 0,
            meanScore: 0,
            standardDeviation: 0,
            chaptersRead: 0,
            volumesRead: 0
          }
        },
        mediaListOptions: {
          scoreFormat: 'POINT_10'
        }
      }
    };
  }

  // =================== MEDIA TRANSFORMATION (Fixed structure) ===================
  
  // FIXED: Added enhanced debugging and comprehensive data structure handling
  transformMedia(simklMedia, mediaType) {
    

    if (!simklMedia) {
      
      return null;
    }

    // CRITICAL FIX: Handle multiple possible data structures from Simkl
    let media, originalData;
    
    // Case 1: Data is nested under 'show' (common in sync responses)
    if (simklMedia.show) {
      
      media = simklMedia.show;
      originalData = simklMedia; // Keep reference to full object
    }
    // Case 2: Data is nested under 'movie' (for movie responses)
    else if (simklMedia.movie) {
      
      media = simklMedia.movie;
      originalData = simklMedia;
    }
    // Case 3: Data is directly in the root object
    else {
      
      media = simklMedia;
      originalData = simklMedia;
    }

    

    const ids = media.ids || originalData.ids || {};
    
    // FIXED: Enhanced poster extraction for movies
    const posterUrl = this.extractPosterUrl(media, originalData, ids);
    
    // FIXED: Better movie detection using mediaType and API response
    const isMovie = this.isMovieType(mediaType, media);
    
    // FIXED: Comprehensive title extraction logic with full debugging
    const extractedTitle = this.extractTitle(media, originalData);
    
    // FIXED: Enhanced genres extraction
    const genres = this.extractGenres(media, originalData);
    
    const episodes = (() => {
      // For movies, always return 1
      if (isMovie) {
        return 1;
      }
      
      const candidates = [
        media.total_episodes_count,
        media.total_episodes,
        media.episodes,
        originalData.total_episodes_count,
        originalData.total_episodes,
        originalData.episodes
      ];
      
      for (const cand of candidates) {
        if (cand !== undefined && cand !== null && cand !== '') {
          const n = Number(cand);
          if (!isNaN(n)) return n;
        }
      }
      return null;
    })();
    
    const transformedResult = {
      id: ids.simkl || ids.id || media.id || originalData.id,
      idMal: ids.mal || null,
      idImdb: ids.imdb || null,
      title: extractedTitle,
      coverImage: {
        large: posterUrl,
        medium: posterUrl,
        _raw: media.poster || media.image || media.cover,
        _normalized: posterUrl
      },
      format: this.mapSimklFormat(media.type || media.kind || originalData.type || 'tv', mediaType),
      averageScore: media.rating ? Math.round((media.rating > 10 ? media.rating : media.rating * 10)) : null,
      status: media.status ? media.status.toUpperCase() : null,
      genres: genres,
      episodes: episodes,
      chapters: null,
      isFavourite: false,
      startDate: this.parseDate(media.first_aired || originalData.first_aired),
      endDate: this.parseDate(media.last_aired || originalData.last_aired),
      // FIXED: Add movie-specific metadata for rendering
      _isMovie: isMovie,
      _mediaType: mediaType,
      _rawData: originalData // Keep for debugging
    };

    
    return transformedResult;
  }

  // FIXED: Enhanced poster URL extraction method
  extractPosterUrl(media, originalData, ids) {
    // Try multiple poster field variations that Simkl uses for different content types
    const posterCandidates = [
      // Standard fields
      media.poster,
      media.image,
      media.cover,
      
      // Image object variations
      media.images?.poster,
      media.images?.poster_small,
      media.images?.poster_large,
      media.images?.movie_poster,
      media.images?.cover,
      media.images?.fanart,
      
      // Original data fallbacks
      originalData?.poster,
      originalData?.image,
      originalData?.cover,
      originalData?.images?.poster,
      originalData?.images?.movie_poster
    ];

    let posterUrl = null;
    
    for (const candidate of posterCandidates) {
      if (candidate) {
        if (typeof candidate === 'object') {
          posterUrl = candidate.full || candidate.large || candidate.medium || 
                     candidate.url || candidate.path || 
                     Object.values(candidate).find(v => typeof v === 'string' && v.trim());
        } else if (typeof candidate === 'string' && candidate.trim()) {
          posterUrl = candidate.trim();
        }
        
        if (posterUrl) break;
      }
    }
    
    // Process the found poster URL
    if (posterUrl) {
      if (posterUrl.startsWith('//')) {
        posterUrl = 'https:' + posterUrl;
      } else if (posterUrl.startsWith('/')) {
        posterUrl = 'https://simkl.in' + posterUrl;
      } else if (!posterUrl.match(/^https?:\/\//i)) {
        // Check if it looks like a direct filename or needs Simkl CDN path
        if (posterUrl.includes('.jpg') || posterUrl.includes('.png') || posterUrl.includes('.webp')) {
          // If it's already a filename, use Simkl CDN
          posterUrl = `https://simkl.in/posters/${posterUrl.replace(/\.(jpg|png|webp)$/i, '')}_m.jpg`;
        } else {
          // Use the ID-based fallback
          posterUrl = `https://simkl.in/posters/${posterUrl}_m.jpg`;
        }
      }
    }

    // Final fallback using media ID
    if (!posterUrl && ids && ids.simkl) {
      posterUrl = `https://simkl.in/posters/${ids.simkl}_m.jpg`;
    }

    
    return posterUrl;
  }

  // FIXED: Enhanced genres extraction method
  extractGenres(media, originalData) {
    const genreCandidates = [
      media.genres,
      media.genre,
      originalData?.genres,
      originalData?.genre
    ];

    for (const candidate of genreCandidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        // Filter out empty/invalid genres
        const validGenres = candidate.filter(g => 
          g && typeof g === 'string' && g.trim()
        ).map(g => g.trim());
        
        if (validGenres.length > 0) {
          
          return validGenres;
        }
      }
    }

    
    return [];
  }

  // FIXED: Completely rewritten comprehensive title extraction method with deep debugging
  extractTitle(media, originalData) {
    
    // CRITICAL FIX: Try ALL possible nested structures and field names
    const allPossibleTitleSources = [
      // Direct media object fields
      media?.title,
      media?.name,
      media?.en_title,
      media?.original_title,
      media?.title_en,
      media?.title_english,
      media?.english_name,
      media?.romaji,
      media?.english,
      media?.native,
      
      // Nested title objects (common in many APIs)
      media?.title?.english,
      media?.title?.romaji,
      media?.title?.native,
      media?.title?.en,
      media?.title?.original,
      
      // Original/root data fields
      originalData?.title,
      originalData?.name,
      originalData?.en_title,
      originalData?.original_title,
      originalData?.title_en,
      originalData?.title_english,
      originalData?.english_name,
      
      // Nested in original data
      originalData?.title?.english,
      originalData?.title?.romaji,
      originalData?.title?.native,
      originalData?.title?.en,
      originalData?.title?.original,
      
      // Show object nested fields (critical for Simkl sync responses)
      originalData?.show?.title,
      originalData?.show?.name,
      originalData?.show?.en_title,
      originalData?.show?.original_title,
      originalData?.show?.title_en,
      originalData?.show?.title_english,
      
      // Nested show title objects
      originalData?.show?.title?.english,
      originalData?.show?.title?.romaji,
      originalData?.show?.title?.native,
      originalData?.show?.title?.en,
      
      // Movie-specific nested fields
      originalData?.movie?.title,
      originalData?.movie?.name,
      originalData?.movie?.en_title,
      originalData?.movie?.original_title,
      
      // Alternative nested structures
      media?.show?.title,
      media?.show?.name,
      media?.movie?.title,
      media?.movie?.name,
      
      // International title variations
      media?.titles?.en,
      media?.titles?.english,
      media?.titles?.original,
      originalData?.titles?.en,
      originalData?.titles?.english,
      originalData?.titles?.original,
      
      // Last resort - use ID or any string field
      media?.slug,
      originalData?.slug,
      String(media?.id || originalData?.id || '').replace(/[^a-zA-Z0-9\s]/g, ' ')
    ];

    

    // Find the first valid title
    const primaryTitle = allPossibleTitleSources.find(title => 
      title && 
      typeof title === 'string' && 
      title.trim() !== '' && 
      title.toLowerCase() !== 'null' &&
      title.toLowerCase() !== 'undefined'
    );

    

    if (!primaryTitle || primaryTitle === 'Unknown Title') {
      
      
      // Emergency fallback: try to construct title from any available data
      const emergencyTitle = this.constructEmergencyTitle(media, originalData);
      if (emergencyTitle) {
        return {
          romaji: emergencyTitle,
          english: emergencyTitle,
          native: emergencyTitle
        };
      }
    }

    // Now find specific variants for English and native titles
    const englishCandidates = [
      media?.en_title,
      media?.title_en,
      media?.title_english,
      media?.english_name,
      media?.title?.english,
      media?.title?.en,
      originalData?.en_title,
      originalData?.title_en,
      originalData?.title_english,
      originalData?.show?.en_title,
      originalData?.show?.title?.english,
      originalData?.movie?.en_title,
      primaryTitle // fallback
    ];

    const nativeCandidates = [
      media?.original_title,
      media?.title_original,
      media?.native,
      media?.title?.native,
      media?.title?.original,
      originalData?.original_title,
      originalData?.title_original,
      originalData?.show?.original_title,
      originalData?.show?.title?.native,
      originalData?.movie?.original_title,
      primaryTitle // fallback
    ];

    const englishTitle = englishCandidates.find(title => 
      title && typeof title === 'string' && title.trim() !== ''
    ) || primaryTitle || 'Unknown Title';

    const nativeTitle = nativeCandidates.find(title => 
      title && typeof title === 'string' && title.trim() !== ''
    ) || primaryTitle || 'Unknown Title';

    // Smart romaji detection
    let romajiTitle = primaryTitle || 'Unknown Title';
    if (primaryTitle !== nativeTitle && /[a-zA-Z]/.test(primaryTitle)) {
      romajiTitle = primaryTitle;
    } else if (englishTitle !== primaryTitle) {
      romajiTitle = englishTitle;
    }

    const result = {
      romaji: romajiTitle,
      english: englishTitle,
      native: nativeTitle
    };

    
    return result;
  }

  // NEW: Emergency title construction when all standard fields fail
  constructEmergencyTitle(media, originalData) {
    // Try to build a title from any available string data
    const possibleSources = [
      // Try any field that might contain a readable name
      media?.slug?.replace(/[-_]/g, ' '),
      originalData?.slug?.replace(/[-_]/g, ' '),
      
      // Check if there are any string fields that might be titles
      ...Object.values(media || {}).filter(val => 
        typeof val === 'string' && 
        val.length > 2 && 
        val.length < 100 &&
        !/^https?:\/\//.test(val) && // not a URL
        !/^\d+$/.test(val) && // not just numbers
        !/^[a-f0-9-]{20,}$/.test(val) // not a hash/ID
      ),
      
      ...Object.values(originalData || {}).filter(val => 
        typeof val === 'string' && 
        val.length > 2 && 
        val.length < 100 &&
        !/^https?:\/\//.test(val) &&
        !/^\d+$/.test(val) &&
        !/^[a-f0-9-]{20,}$/.test(val)
      )
    ];

    const emergencyTitle = possibleSources[0];
    if (emergencyTitle) {
      // Clean it up
      return emergencyTitle
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, l => l.toUpperCase()); // Title case
    }

    return null;
  }

  // FIXED: Enhanced list entry transformation with proper movie handling
  transformListEntry(simklEntry, mediaType) {
    if (!simklEntry) return null;
    
    const show = simklEntry.show || simklEntry;
    const statusRaw = simklEntry.status || simklEntry._status || show.status || null;

    // Check if this is a movie
    const isMovie = this.isMovieType(mediaType, show);

    let progress = 0;
    const watchedCandidates = [
      simklEntry.watched_episodes_count,
      simklEntry.watched_episodes,
      simklEntry.episodes_watched,
      show.watched_episodes_count,
      show.watched_episodes
    ];
    
    for (const w of watchedCandidates) {
      if (w !== undefined && w !== null && w !== '') {
        const n = Number(w);
        if (!isNaN(n)) { 
          progress = n; 
          break; 
        }
      }
    }

    // FIXED: Movie-specific progress handling
    if (isMovie) {
      // For movies, progress is either 0 or 1
      if (progress > 0) {
        progress = 1;
      } else {
        // Check if status indicates movie was watched
        const watchedStatuses = ['completed', 'watching'];
        if (watchedStatuses.includes(String(statusRaw).toLowerCase())) {
          progress = 1;
        }
      }
    } else {
      // Handle TV shows with seasons (existing logic)
      if ((!progress || progress === 0) && typeof simklEntry.seasons_watched === 'number') {
        const totalEpisodes = (simklEntry.total_episodes_count ?? show.total_episodes_count ?? show.total_episodes ?? show.episodes) || 0;
        const totalSeasons = show.seasons || 1;
        if (totalEpisodes && totalSeasons) {
          const perSeason = totalEpisodes / totalSeasons;
          progress = Math.floor(simklEntry.seasons_watched * perSeason);
        }
      }
    }

    const mergedShow = Object.assign({}, show, {
      total_episodes_count: simklEntry.total_episodes_count ?? show.total_episodes_count ?? show.total_episodes,
      total_episodes: simklEntry.total_episodes_count ?? show.total_episodes
    });
    
    return {
      id: null, 
      status: this.mapSimklStatusToAniList(statusRaw),
      score: simklEntry.user_rating ?? simklEntry.rating ?? show.rating ?? 0,
      progress: progress || 0,
      media: this.transformMedia(mergedShow, mediaType)
    };
  }

  // FIXED: New helper method to properly detect movies
  isMovieType(mediaType, mediaData) {
    // First check the requested mediaType
    if (mediaType) {
      const upperType = String(mediaType).toUpperCase();
      if (upperType === 'MOVIE' || upperType === 'MOVIES') {
        return true;
      }
    }
    
    // Then check the media data itself
    if (mediaData) {
      const type = String(mediaData.type || mediaData.kind || '').toLowerCase();
      return type === 'movie' || type === 'film' || type.includes('movie');
    }
    
    return false;
  }

  // =================== UPDATE METHODS (Following MAL pattern) ===================

  async updateMediaListEntry(mediaId, updates) {
    
    
    try {
      return await this.executeUpdate(mediaId, updates);
    } catch (error) {
      
      throw this.createUserFriendlyError(error);
    }
  }

  async executeUpdate(mediaId, updates) {
    this.validateMediaId(mediaId);
    this.validateUpdates(updates);
    
    await this.ensureValidToken();
    
    // Build update payload
    const updatePayload = this.buildUpdatePayload(mediaId, updates);
    
    const requestParams = {
      url: `${this.baseUrl}/sync/add-to-list`,
      method: 'POST',
      headers: this.getHeaders({ type: 'update' }),
      body: JSON.stringify(updatePayload),
      priority: 'high'
    };
    
    const response = await this.makeRequest(requestParams);
    
    // Invalidate cache
    this.cache.invalidateByMedia(mediaId);
    this.cache.invalidateScope('userData');
    
    
    // Return AniList-compatible response
    return {
      id: null,
      status: updates.status || null,
      score: updates.score || 0,
      progress: updates.progress || 0
    };
  }

  buildUpdatePayload(mediaId, updates) {
    // Simkl expects specific payload structure
    const payload = {
      shows: [{
        ids: { simkl: parseInt(mediaId) }
      }]
    };
    
    const showItem = payload.shows[0];
    
    // Add status
    if (updates.status !== undefined) {
      showItem.status = this.mapAniListStatusToSimkl(updates.status);
    }
    
    // Add rating (Simkl uses 1-10 scale)
    if (updates.score !== undefined && updates.score !== null) {
      const score = Math.max(0, Math.min(10, Math.round(updates.score)));
      if (score > 0) {
        showItem.rating = score;
      }
    }
    
    // Add progress
    if (updates.progress !== undefined) {
      showItem.watched_episodes = parseInt(updates.progress) || 0;
    }
    
    return payload;
  }

  // Remove media from user's Simkl list
  async removeMediaListEntry(mediaId) {
    this.validateMediaId(mediaId);
    await this.ensureValidToken();

    const payload = {
      shows: [{ ids: { simkl: parseInt(mediaId) } }]
    };

    const requestParams = {
      url: `${this.baseUrl}/sync/remove-from-list`,
      method: 'POST',
      headers: this.getHeaders({ type: 'update' }),
      body: JSON.stringify(payload),
      priority: 'high'
    };

    try {
      await this.makeRequest(requestParams);
      this.cache.invalidateByMedia(mediaId);
      this.cache.invalidateScope('userData');
    } catch (error) {
      
      throw this.createUserFriendlyError(error);
    }
  }

  // =================== AUTH METHODS (Following MAL pattern) ===================

  async makeObsidianRequest(code, redirectUri) {
    const body = {
      grant_type: 'authorization_code',
      client_id: this.plugin.settings.simklClientId,
      client_secret: this.plugin.settings.simklClientSecret || '',
      redirect_uri: redirectUri,
      code: code
    };

    try {
      const requestFn = () => requestUrl({
        url: this.tokenUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const response = await this.requestQueue.add(requestFn, { priority: 'high' });
      
      if (!response?.json || typeof response.json !== 'object') {
        throw new Error('Invalid auth response from Simkl');
      }

      if (response.json.error) {
        throw new Error(response.json.error_description || response.json.error);
      }

      console.log('[Simkl] Authentication successful');
      return response.json;

    } catch (error) {
      console.error('[Simkl] Authentication failed:', error.message);
      throw new Error(`Simkl authentication failed: ${error.message}`);
    }
  }

  async ensureValidToken() {
    if (!this.plugin.settings.simklAccessToken) {
      throw new Error('Authentication required');
    }
    
    // TODO: Implement token refresh logic if needed
    return true;
  }

  // =================== UTILITY METHODS ===================

  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.plugin.settings.simklAccessToken) return false;
    
    try {
      const config = { 
        type: 'single', 
        mediaType, 
        mediaId: parseInt(mediaId),
        nocache: true 
      };
      const response = await this.fetchSimklData(config);
      return response.MediaList !== null;
    } catch (error) {
      
      return false;
    }
  }

  async getUserEntryForMedia(mediaId, mediaType) {
    try {
      if (!this.plugin.settings.simklAccessToken) {
        return null;
      }
      
      const config = {
        type: 'single',
        mediaType,
        mediaId: parseInt(mediaId),
        nocache: true
      };
      
      const result = await this.fetchSimklData(config);
      return result.MediaList; // null if not in list, entry if in list
      
    } catch (error) {
      
      return null;
    }
  }

  // =================== MAPPING FUNCTIONS (Fixed) ===================

  mapAniListStatusToSimkl(status) {
    return this.aniListToSimklStatus[status] || status?.toLowerCase();
  }

  mapSimklStatusToAniList(status) {
    return this.simklToAniListStatus[status] || status?.toUpperCase();
  }

  // FIXED: Enhanced format mapping with mediaType context
  mapSimklFormat(type, mediaType) {
    if (!type) {
      // Use mediaType as fallback
      if (mediaType) {
        const upperType = String(mediaType).toUpperCase();
        if (upperType === 'MOVIE' || upperType === 'MOVIES') return 'MOVIE';
        if (upperType === 'TV') return 'TV';
        if (upperType === 'ANIME') return 'TV';
      }
      return 'TV';
    }
    
    const formatMap = {
      'tv': 'TV',
      'movie': 'MOVIE',
      'film': 'MOVIE',
      'special': 'SPECIAL',
      'ova': 'OVA',
      'ona': 'ONA',
      'anime': 'TV'
    };
    
    const lowerType = String(type).toLowerCase();
    if (lowerType.includes('movie') || lowerType.includes('film')) {
      return 'MOVIE';
    }
    
    return formatMap[lowerType] || 'TV';
  }

  parseDate(dateString) {
    if (!dateString) return null;
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate()
      };
    } catch (error) {
      return null;
    }
  }

  // =================== VALIDATION METHODS (Following MAL pattern) ===================

  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }

    const normalized = { ...config };
    if (!normalized.type) normalized.type = 'list';
    if (normalized.mediaType) normalized.mediaType = normalized.mediaType.toUpperCase();
    
    if (normalized.page && (normalized.page < 1 || normalized.page > 1000)) {
      throw new Error(`Invalid page: ${normalized.page}`);
    }
    
    return normalized;
  }

  validateMediaId(mediaId) {
    const id = parseInt(mediaId);
    if (!id || id <= 0) {
      throw new Error(`Invalid media ID: ${mediaId}`);
    }
  }

  validateUpdates(updates) {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates must be an object');
    }
    
    if (Object.keys(updates).length === 0) {
      throw new Error('At least one field must be updated');
    }
  }

  requiresAuth(requestType) {
    // Only search requests don't require authentication
    return requestType !== 'search';
  }

  // =================== CACHE & URL METHODS ===================

  createCacheKey(config) {
    const sortedConfig = {};
    Object.keys(config).sort().forEach(key => {
      if (key !== 'accessToken' && key !== 'clientSecret') {
        sortedConfig[key] = config[key];
      }
    });
    return JSON.stringify(sortedConfig);
  }

  getCacheScope(requestType) {
    const scopeMap = {
      'stats': 'userData',
      'single': 'mediaData',
      'search': 'searchResults',
      'list': 'userData'
    };
    return scopeMap[requestType] || 'userData';
  }

  buildFullUrl(baseUrl, params) {
    if (!params || Object.keys(params).length === 0) return baseUrl;
    const queryString = new URLSearchParams(params).toString();
    return `${baseUrl}?${queryString}`;
  }

  getSimklUrl(mediaId, mediaType = 'ANIME') {
    try {
      this.validateMediaId(mediaId);
      const typeUpper = (mediaType || 'ANIME').toString().toUpperCase();
      
      let segment = 'tv'; // default
      if (typeUpper === 'ANIME') {
        segment = 'anime';
      } else if (typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper.includes('MOVIE')) {
        segment = 'movies';
      }
      
      return `https://simkl.com/${segment}/${mediaId}`;
    } catch (error) {
      throw error;
    }
  }

  // =================== ERROR HANDLING (Simplified from original) ===================

  createUserFriendlyError(error) {
    const errorMessages = {
      'auth': '🔑 Authentication required. Please connect your Simkl account.',
      'network': '🌐 Connection issue. Please check your internet connection.',
      'rate': '🚦 Too many requests. Please wait a moment.',
      'server': '🔧 Simkl servers are experiencing issues.',
      'invalid': '⚠️ Invalid request. Please check your input.'
    };
    
    let errorType = 'unknown';
    const msg = error.message?.toLowerCase() || '';
    
    if (msg.includes('auth') || msg.includes('unauthorized')) {
      errorType = 'auth';
    } else if (msg.includes('rate limit')) {
      errorType = 'rate';
    } else if (msg.includes('network') || msg.includes('connection')) {
      errorType = 'network';
    } else if (msg.includes('server') || msg.includes('500')) {
      errorType = 'server';
    } else if (msg.includes('invalid') || msg.includes('400')) {
      errorType = 'invalid';
    }
    
    const userMessage = errorMessages[errorType] || '❌ An unexpected error occurred.';
    const friendlyError = new Error(userMessage);
    friendlyError.type = errorType;
    friendlyError.originalMessage = error.message;
    
    return friendlyError;
  }

  // =================== COMPATIBILITY METHODS (Following MAL pattern) ===================

  async fetchSimklStats(config) {
    return this.fetchSimklData({ ...config, type: 'stats' });
  }

  async fetchSimklList(config) {
    return this.fetchSimklData(config);
  }

  async searchSimklMedia(config) {
    return this.fetchSimklData({ ...config, type: 'search' });
  }

  getMetrics() {
    return { ...this.metrics };
  }

  // Fetch entries for computing distributions
  async fetchUserListEntries(mediaType = 'ANIME') {
    const resp = await this.fetchSimklData({ type: 'list', mediaType });
    const entries = resp?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return entries;
  }

  // Compute distributions from entries (replicated from MAL logic for parity)
  aggregateDistributionsFromEntries(entries, typeLower) {
    const result = {
      statuses: [],
      scores: [],
      formats: [],
      releaseYears: [],
      genres: []
    };
  
    const statusCounts = new Map();
    const scoreCounts = new Map();
    const formatCounts = new Map();
    const yearCounts = new Map();
    const genreSet = new Set();
  
    for (const entry of entries) {
      const status = entry?.status;
      if (status) {
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      }
  
      const rawScore = entry?.score;
      if (typeof rawScore === 'number' && rawScore > 0) {
        const scaled = Math.round(rawScore * 10);
        scoreCounts.set(scaled, (scoreCounts.get(scaled) || 0) + 1);
      }
  
      const format = entry?.media?.format;
      if (format) {
        formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
      }
  
      const year = entry?.media?.startDate?.year;
      if (typeof year === 'number' && year > 0) {
        yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      }
  
      const genres = entry?.media?.genres || [];
      for (const g of genres) {
        if (typeof g === 'string' && g.trim()) genreSet.add(g);
      }
    }
  
    result.statuses = Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  
    result.scores = Array.from(scoreCounts.entries())
      .map(([score, count]) => ({ score, count }))
      .sort((a, b) => a.score - b.score);
  
    result.formats = Array.from(formatCounts.entries())
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count);
  
    result.releaseYears = Array.from(yearCounts.entries())
      .map(([releaseYear, count]) => ({ releaseYear, count }))
      .sort((a, b) => b.releaseYear - a.releaseYear);
  
    result.genres = Array.from(genreSet);
  
    return result;
  }

  async attachSimklDistributions(user) {
    try {
      const animeEntries = await this.fetchUserListEntries('ANIME');
      const animeAgg = this.aggregateDistributionsFromEntries(animeEntries, 'anime');

      if (user?.statistics?.anime) {
        Object.assign(user.statistics.anime, animeAgg);
      }

      // Apply fallback values similar to MAL implementation
      const applyFallbacks = (entries, statsObj) => {
        if (!statsObj) return;
        if (!statsObj.count || statsObj.count === 0) {
          statsObj.count = Array.isArray(entries) ? entries.length : 0;
        }
        if ((!statsObj.meanScore || statsObj.meanScore === 0) && Array.isArray(entries) && entries.length) {
          const rated = entries.filter(e => typeof e.score === 'number' && e.score > 0);
          if (rated.length) {
            const avg10 = rated.reduce((sum, e) => sum + e.score, 0) / rated.length;
            statsObj.meanScore = Math.round(avg10 * 10) / 10;
          }
        }
      };

      applyFallbacks(animeEntries, user?.statistics?.anime);

    } catch (err) {
      
    }
  }

  // =================== MEDIA TYPE DETECTION (Following MAL pattern) ===================

  async getMediaType(mediaId) {
    // For Simkl, we need to determine if it's anime, TV, or movie
    // Since we don't have a direct way to detect this from ID alone,
    // we'll need to search across different types or use context
    return 'anime'; // Default fallback
  }

  // =================== DEBUGGING (Simplified) ===================

  enableDebug(enabled = true) {
    this.debugEnabled = enabled;
    console.log(`[Simkl] Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }
}

class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.globalListeners = [];
    this.cache = new Cache({ obsidianPlugin: this });
    this.requestQueue = new RequestQueue(this);
    this.api = new AnilistApi(this);
    this.auth = new Authentication(this);
    this.malAuth = new MALAuthentication(this);
    this.malApi = new MalApi(this);
    this.simklAuth = new SimklAuthentication(this);
    this.simklApi = new SimklApi(this);
    this.theme = new Theme(this);
    this.processor = new Processor(this);
    this.edit = new Edit(this);
    this.moreDetailsPanel = new MoreDetailsPanel(this);
    this.export = new Export(this);
    this.sample = new Sample(this);
    this.prompt = new Prompt(this);
  }

  getAniListUrl(mediaId, mediaType = 'ANIME') {
    return this.api.getAniListUrl(mediaId, mediaType);
  }
  
  getMALUrl(mediaId, mediaType = 'ANIME') {
    return this.malApi.getMALUrl(mediaId, mediaType);
  }

  getSimklUrl(mediaId, mediaType = 'ANIME') {
    return this.simklApi.getSimklUrl(mediaId, mediaType);
  }
  
  getSourceSpecificUrl(mediaId, mediaType, source) {
  switch (source) {
    case 'mal':
      return this.getMALUrl(mediaId, mediaType);
    case 'simkl':
      return this.getSimklUrl(mediaId, mediaType);
    case 'anilist':
    default:
      return this.getAniListUrl(mediaId, mediaType);
  
  }
}

async updateDefaultApiSourceBasedOnAuth() {
  try {
    if (this.settings.defaultApiUserOverride) return;
    const authenticated = [];
    if (this.settings.accessToken) authenticated.push('anilist');
    if (this.settings.malAccessToken) authenticated.push('mal');
    if (this.settings.simklAccessToken) authenticated.push('simkl');

    let newDefault = this.settings.defaultApiSource;
    if (authenticated.length === 1) {
      newDefault = authenticated[0];
    } else {
      newDefault = 'anilist';
    }

    if (newDefault !== this.settings.defaultApiSource) {
      this.settings.defaultApiSource = newDefault;
      await this.saveSettings();
    }
  } catch (e) {
    console.warn('[Zoro] Failed to update default API source automatically:', e);
  }
}


  async onload() {
    this.render = new Render(this);
    this.emojiMapper = new EmojiIconMapper();
this.emojiMapper.init({ patchSettings:true, patchCreateEl:true, patchNotice:true });
    this.connectedNotes = new ConnectedNotes(this);
    try {
      await this.loadSettings();
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }
    
    await this.cache.loadFromDisk(); 
    this.cache.startAutoPrune(5 * 60 * 1000);
    
    try {
      this.injectCSS();
      
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }
    
    if (this.settings.theme) {
      await this.theme.applyTheme(this.settings.theme);
    }

    this.registerMarkdownCodeBlockProcessor('zoro', this.processor.processZoroCodeBlock.bind(this.processor));
    this.addSettingTab(new ZoroSettingTab(this.app, this));
    
  }

  validateSettings(settings) {
  return {
    defaultApiSource: ['anilist', 'mal', 'simkl'].includes(settings?.defaultApiSource) ? settings.defaultApiSource : 'anilist',
    defaultApiUserOverride: typeof settings?.defaultApiUserOverride === 'boolean' ? settings.defaultApiUserOverride : false,
    defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
    defaultLayout: ['card', 'table'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
    notePath: typeof settings?.notePath === 'string' ? settings.notePath : 'Zoro/Note',
    insertCodeBlockOnNote: typeof settings?.insertCodeBlockOnNote === 'boolean' ? settings.insertCodeBlockOnNote : true,
    showCoverImages: typeof settings?.showCoverImages === 'boolean' ? settings.showCoverImages : true,
    showRatings: typeof settings?.showRatings === 'boolean' ? settings.showRatings : true,
    showProgress: typeof settings?.showProgress === 'boolean' ? settings.showProgress : true,
    showGenres: typeof settings?.showGenres === 'boolean' ? settings.showGenres : false,
    showLoadingIcon: typeof settings?.showLoadingIcon === 'boolean' ? settings.showLoadingIcon : true,
    gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : getDefaultGridColumns(),
    theme: typeof settings?.theme === 'string' ? settings.theme : '',
    hideUrlsInTitles: typeof settings?.hideUrlsInTitles === 'boolean' ? settings.hideUrlsInTitles : true,
    forceScoreFormat: typeof settings?.forceScoreFormat === 'boolean' ? settings.forceScoreFormat : true,
    showAvatar: typeof settings?.showAvatar === 'boolean' ? settings.showAvatar : true,
    showFavorites: typeof settings?.showFavorites === 'boolean' ? settings.showFavorites : true,
    showBreakdowns: typeof settings?.showBreakdowns === 'boolean' ? settings.showBreakdowns : true,
    showTimeStats: typeof settings?.showTimeStats === 'boolean' ? settings.showTimeStats : true,
    statsLayout: ['enhanced', 'compact', 'minimal'].includes(settings?.statsLayout) ? settings.statsLayout : 'enhanced',
    statsTheme: ['auto', 'light', 'dark'].includes(settings?.statsTheme) ? settings.statsTheme : 'auto',
    clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
    clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
    redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : 'https://anilist.co/api/v2/oauth/pin',
    accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : '',
    malClientId: typeof settings?.malClientId === 'string' ? settings.malClientId : '',
    malClientSecret: typeof settings?.malClientSecret === 'string' ? settings.malClientSecret : '',
    malAccessToken: typeof settings?.malAccessToken === 'string' ? settings.malAccessToken : '',
    malRefreshToken: typeof settings?.malRefreshToken === 'string' ? settings.malRefreshToken : '',
    malTokenExpiry: settings?.malTokenExpiry === null || typeof settings?.malTokenExpiry === 'number' ? settings.malTokenExpiry : null,
    malUserInfo: settings?.malUserInfo === null || typeof settings?.malUserInfo === 'object' ? settings.malUserInfo : null,
    simklClientId: typeof settings?.simklClientId === 'string' ? settings.simklClientId : '',
    simklClientSecret: typeof settings?.simklClientSecret === 'string' ? settings.simklClientSecret : '',
    simklAccessToken: typeof settings?.simklAccessToken === 'string' ? settings.simklAccessToken : '',
    simklUserInfo: settings?.simklUserInfo === null || typeof settings?.simklUserInfo === 'object' ? settings.simklUserInfo : null,
    debugMode: typeof settings?.debugMode === 'boolean' ? settings.debugMode : false,
  };
}

  async saveSettings() {
    try {
      const validSettings = this.validateSettings(this.settings);
      await this.saveData(validSettings);
      
    } catch (err) {
      console.error('[Zoro] Failed to save settings:', err);
      new Notice('⚠️ Failed to save settings. See console for details.');
    }
  }

  async loadSettings() {
    const saved = await this.loadData() || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);
    if (!this.settings.clientSecret) {
      const secret = await this.promptForSecret("Paste your client secret:");
      this.settings.clientSecret = secret.trim();
      await this.saveData(this.settings);
    }
    if (typeof this.updateDefaultApiSourceBasedOnAuth === 'function') {
  await this.updateDefaultApiSourceBasedOnAuth();
}
  }

  addGlobalListener(el, type, fn) {
    el.addEventListener(type, fn);
    this.globalListeners.push({ el, type, fn });
  }

  removeAllGlobalListeners() {
    this.globalListeners.forEach(({ el, type, fn }) => {
      el.removeEventListener(type, fn);
    });
    this.globalListeners.length = 0;
  }

  handleEditClick(e, entry, statusEl, config = {}) {
    e.preventDefault();
    e.stopPropagation();

    this.edit.createEditModal(
      entry,
      async updates => {
        // Use appropriate API based on source
        if (config.source === 'mal') {
          await this.malApi.updateMediaListEntry(entry.media.id, updates);
        } else if (config.source === 'simkl') {
          await this.simklApi.updateMediaListEntry(entry.media.id, updates);
        } else {
          await this.api.updateMediaListEntry(entry.media.id, updates);
        }
      },
      () => {
        // Callback after successful update
      },
      config.source || 'anilist'
    );
  }

  getStatsConfig() {
    return {
      showAvatar: this.settings.showAvatar ?? true,
      showFavorites: this.settings.showFavorites ?? true,
      showBreakdowns: this.settings.showBreakdowns ?? true,
      showTimeStats: this.settings.showTimeStats ?? true,
      layout: this.settings.statsLayout ?? 'enhanced',
      theme: this.settings.statsTheme ?? 'auto'
    };
  }

  injectCSS() {
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) existingStyle.remove();
    
    const css = `
      .zoro-container { /* styles */ }
    `;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);

    this.globalLoader = document.createElement('div');
    this.globalLoader.id = 'zoro-global-loader';
    this.globalLoader.innerHTML = `
      <div class="sharingan-glow">
        <div class="tomoe-container">
          <span class="tomoe"></span>
          <span class="tomoe"></span>
          <span class="tomoe"></span>
        </div>
      </div>
    `;
    
    this.globalLoader.className = 'zoro-global-loader';
    document.body.appendChild(this.globalLoader);
  }

  handleAuthMessage(event) {
    if (event.origin !== 'https://anilist.co') return;
    this.exchangeCodeForToken(event.data.code);
  }

  renderError(el, message, context = '', onRetry = null) {
    el.empty?.();
    el.classList.add('zoro-error-container');

    const wrapper = el.createDiv({ cls: 'zoro-error-box' });
    wrapper.createEl('strong', { text: `❌ ${context || 'Something went wrong'}` });
    wrapper.createEl('pre', { text: message });

    if (onRetry) {
      wrapper.createEl('button', { text: '🔄 Retry', cls: 'zoro-retry-btn' })
            .onclick = () => {
              el.empty();
              onRetry();
            };
    } else {
      wrapper.createEl('button', { text: 'Reload Note', cls: 'zoro-retry-btn' })
            .onclick = () => this.app.workspace.activeLeaf.rebuildView();
    }
  }

  onunload() {

    this.cache.stopAutoPrune()
       .stopBackgroundRefresh()
       .destroy();

    this.theme.removeTheme();
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
        existingStyle.remove();
      
    }

    const loader = document.getElementById('zoro-global-loader');
    if (loader) loader.remove();
  }
}
class Processor {
  constructor(plugin) {
    this.plugin = plugin;
    this.apiRegistry = new Map();
    this.initializeApis();
  }

  initializeApis() {
    if (this.plugin.api) {
      this.apiRegistry.set('anilist', this.plugin.api);
    }
    
    if (this.plugin.malApi) {
      this.apiRegistry.set('mal', this.plugin.malApi);
    }
    
    if (this.plugin.simklApi) {
      this.apiRegistry.set('simkl', this.plugin.simklApi);
    }
  }

  getApiInstance(source) {
    const normalizedSource = source?.toLowerCase();
    
    if (!this.apiRegistry.has(normalizedSource)) {
      const availableSources = Array.from(this.apiRegistry.keys()).join(', ');
      throw new Error(`❌ Unsupported API source: ${source}. Available sources: ${availableSources}`);
    }
    
    return this.apiRegistry.get(normalizedSource);
  }

  getSupportedOperations(source) {
    const operationMap = {
      'anilist': ['stats', 'search', 'single', 'list', 'trending'],
      'mal': ['stats', 'search', 'single', 'list', 'trending'],
      'simkl': ['stats', 'search', 'single', 'list', 'trending']
    };
    
    return operationMap[source?.toLowerCase()] || [];
  }

  validateOperation(source, operation) {
    const supportedOps = this.getSupportedOperations(source);
    
    if (!supportedOps.includes(operation)) {
      throw new Error(`❌ Operation '${operation}' is not supported by ${source.toUpperCase()}. Supported operations: ${supportedOps.join(', ')}`);
    }
  }

  createSkeleton(config) {
    const skeletonMap = {
      'stats': () => this.plugin.render.createStatsSkeleton(),
      'single': () => this.plugin.render.createListSkeleton(1),
      'trending': () => this.plugin.render.createListSkeleton(),
      'search': () => this.plugin.render.createListSkeleton(),
      'list': () => this.plugin.render.createListSkeleton()
    };

    const createSkeletonFn = skeletonMap[config.type];
    if (!createSkeletonFn) {
      return this.plugin.render.createListSkeleton();
    }

    return createSkeletonFn();
  }

  async resolveAuthentication(config) {
    const updatedConfig = { ...config };

    if (config.source === 'mal' || config.source === 'simkl') {
      return updatedConfig;
    }

    if (updatedConfig.useAuthenticatedUser) {
      const authUsername = await this.plugin.auth.getAuthenticatedUsername();
      if (!authUsername) {
        throw new Error('❌ Could not retrieve authenticated username. Please authenticate or provide a username.');
      }
      updatedConfig.username = authUsername;
    }

    return updatedConfig;
  }

  async executeApiOperation(api, config) {
    const { type, source } = config;

    try {
      switch (type) {
        case 'stats':
          return await this.handleStatsOperation(api, config);
          
        case 'search':
          return await this.handleSearchOperation(api, config);
          
        case 'single':
          return await this.handleSingleOperation(api, config);
          
        case 'list':
          return await this.handleListOperation(api, config);
          
        case 'trending':
          return await this.handleTrendingOperation(api, config);
          
        default:
          throw new Error(`❌ Unknown operation type: ${type}`);
      }
    } catch (error) {
      throw new Error(`❌ ${source.toUpperCase()} API operation failed: ${error.message}`);
    }
  }

injectMetadata(data, config) {
  if (!data) return data;
  
  const metadata = {
    source: config.source || 'anilist',
    mediaType: config.mediaType || (data.media?.type || 'ANIME')
  };

  if (Array.isArray(data)) {
    data.forEach(entry => {
      if (entry) {
        entry._zoroMeta = metadata;
        // Ensure media type is consistent
        if (entry.media && !entry.media.type) {
          entry.media.type = metadata.mediaType;
        }
      }
    });
    return data;
  }
  
  // Handle single entry
  if (data && typeof data === 'object') {
    data._zoroMeta = metadata;
    if (data.media && !data.media.type) {
      data.media.type = metadata.mediaType;
    }
  }
  
  return data;
}


 async handleStatsOperation(api, config) {
  if (config.source === 'mal') {
    const response = await api.fetchMALData({ ...config, type: 'stats' });
    const data = response?.User || response;
    return this.injectMetadata(data, config);
  } else if (config.source === 'simkl') {
    const response = await api.fetchSimklData({ ...config, type: 'stats' });
    const data = response?.User || response;
    return this.injectMetadata(data, config);
  } else {
    const data = await api.fetchAniListData?.(config);
    const result = data?.User || data;
    return this.injectMetadata(result, config);
  }
}

async handleSearchOperation(api, config) {
  return { isSearchInterface: true, config };
}

async handleSingleOperation(api, config) {
  if (!config.mediaId) {
    throw new Error('❌ Media ID is required for single media view');
  }

  if (config.source === 'mal') {
    // Use item endpoint to fetch single MAL media reliably
    const response = await api.fetchMALData({ ...config, type: 'item' });
    const media = response?.Media;
    const wrapped = media ? { id: null, status: null, score: null, progress: 0, media } : null;
    return this.injectMetadata(wrapped, config);
  } else if (config.source === 'simkl') {
    const response = await api.fetchSimklData({ ...config, type: 'single' });
    const data = response?.MediaList;
    return this.injectMetadata(data, config);
  } else {
    // AniList: use Media(id) query; wrap result to MediaList-like shape for renderer
    const data = await api.fetchAniListData?.({ ...config, type: 'single' });
    const media = data?.Media;
    const wrapped = media ? { id: null, status: null, score: null, progress: 0, media } : null;
    return this.injectMetadata(wrapped, config);
  }
}

async handleListOperation(api, config) {
  if (config.source === 'mal') {
    const response = await api.fetchMALData({
      ...config,
      type: 'list'
    });
    const entries = response?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.injectMetadata(entries, config);
  } else if (config.source === 'simkl') {
    const response = await api.fetchSimklData({
      ...config,
      type: 'list'
    });
    const entries = response?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.injectMetadata(entries, config);
  } else {
    const data = await api.fetchAniListData?.({ ...config });
    const entries = data?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.injectMetadata(entries, config);
  }
}

async handleTrendingOperation(api, config) {
  return { isTrendingOperation: true, config };
}

  async renderData(el, data, config) {
    const { type } = config;

    try {
      switch (type) {
        case 'stats':
          this.plugin.render.renderUserStats(el, data, { mediaType: config.mediaType || 'ANIME', layout: config.layout || 'enhanced' });
          break;

        case 'search':
          if (data.isSearchInterface) {
            await this.plugin.render.renderSearchInterface(el, data.config);
          } else {
            this.plugin.render.renderSearchResults(el, data.Page?.media || [], config);
          }
          break;

        case 'single':
          this.plugin.render.renderSingleMedia(el, data, config);
          break;

        case 'list':
          this.plugin.render.renderMediaList(el, data, config);
          break;

        case 'trending':
          if (data.isTrendingOperation) {
            const trending = new Trending(this.plugin);
            await trending.renderTrendingBlock(el, data.config);
          }
          break;

        default:
          throw new Error(`❌ Unknown rendering type: ${type}`);
      }
    } catch (error) {
      throw new Error(`❌ Rendering failed: ${error.message}`);
    }
  }

  async processZoroCodeBlock(source, el, ctx) {
    let config;
    
    try {
      config = this.parseCodeBlockConfig(source) || {};
      
      this.validateOperation(config.source, config.type);
      
      const skeleton = this.createSkeleton(config);
      el.empty();
      el.appendChild(skeleton);

      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);

      await this.executeProcessing(el, config, retryFn);

    } catch (error) {
      console.error('[Zoro] Code block processing error:', error);
      el.empty();
      
      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);
      this.plugin.renderError(
        el,
        error.message || 'Unknown error occurred.',
        'Code block',
        retryFn
      );
    }
  }

  async executeProcessing(el, config, retryFn) {
    try {
      const resolvedConfig = await this.resolveAuthentication(config);
      
      if (config.type === 'trending') {
        const data = await this.executeApiOperation(null, resolvedConfig);
        await this.renderData(el, data, resolvedConfig);
      } else {
        const api = this.getApiInstance(resolvedConfig.source);
        const data = await this.executeApiOperation(api, resolvedConfig);
        await this.renderData(el, data, resolvedConfig);
      }

    } catch (error) {
      el.empty();
      this.plugin.renderError(el, error.message, 'Failed to load', retryFn);
      throw error;
    }
  }

  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    const keyMappings = {
      'username': 'username',
      'user': 'username',
      'listtype': 'listType',
      'list-type': 'listType',
      'list_type': 'listType',
      'mediatype': 'mediaType',
      'media-type': 'mediaType',
      'media_type': 'mediaType',
      'type': 'type',
      'layout': 'layout',
      'search': 'search',
      'query': 'search',
      'source': 'source',
      'api': 'source',
      'page': 'page',
      'perpage': 'perPage',
      'per-page': 'perPage',
      'per_page': 'perPage',
      'limit': 'perPage',
      // support single media identifiers
      'mediaid': 'mediaId',
      'media-id': 'mediaId',
      'media_id': 'mediaId',
      'id': 'mediaId'
    };

    for (let raw of lines) {
      const colonIndex = raw.indexOf(':');
      if (colonIndex === -1) continue;

      let key = raw.slice(0, colonIndex).trim().toLowerCase();
      let value = raw.slice(colonIndex + 1).trim();

      const mappedKey = keyMappings[key];
      if (!mappedKey) continue;

      config[mappedKey] = this.processConfigValue(mappedKey, value);
    }

    return this.applyConfigDefaults(config);
  }

  processConfigValue(key, value) {
    switch (key) {
      case 'listType':
        return value.toUpperCase().replace(/[\s-]/g, '_');
      case 'mediaType':
        return value.toUpperCase();
      case 'type':
      case 'layout':
      case 'source':
        return value.toLowerCase();
      case 'page':
      case 'perPage':
      case 'mediaId':
        return parseInt(value) || undefined;
      default:
        return value;
    }
  }

  applyConfigDefaults(config) {
    if (!config.source) {
      config.source = this.plugin.settings.defaultApiSource || 'anilist';
    }

    if (config.type === 'trending') {
      config.mediaType = config.mediaType || 'ANIME';
      config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
      return config;
    }

    if (config.source === 'mal' || config.source === 'simkl') {
      if (!this.hasValidAuthForSource(config.source)) {
        throw new Error(`❌ ${config.source.toUpperCase()} authentication required. Please authenticate in plugin settings.`);
      }
    } else {
      if (!config.username) {
        if (this.plugin.settings.defaultUsername) {
          config.username = this.plugin.settings.defaultUsername;
        } else if (this.hasValidAuthForSource(config.source)) {
          config.useAuthenticatedUser = true;
        } else {
          throw new Error('❌ Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
        }
      }
    }

    config.type = config.type || 'list';
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
    
    if (!config.listType && config.type === 'list') {
      config.listType = 'CURRENT';
    }
    
    if ((config.source === 'mal' || config.source === 'simkl') && config.listType === 'REPEATING') {
      throw new Error('Repeating is supported only on AniList.');
    }
    
    if (config.source === 'simkl' && config.mediaType === 'MANGA') {
      throw new Error('Manga is supported only on AniList and MyAnimeList.');
    }

    return config;
  }

  hasValidAuthForSource(source) {
    switch (source) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'simkl':
        return !!this.plugin.settings.simklAccessToken;
      case 'anilist':
        return !!this.plugin.settings.accessToken;
      default:
        return false;
    }
  }
}

class Render {
  constructor(plugin) {
    this.plugin = plugin;
    
    // Initialize utility helpers
    this.apiHelper = new APISourceHelper(plugin);
    this.formatter = new FormatterHelper();
    
    // Initialize specialized renderers
    this.cardRenderer = new CardRenderer(this);
    this.searchRenderer = new SearchRenderer(this);
    this.tableRenderer = new TableRenderer(this);
    this.mediaListRenderer = new MediaListRenderer(this);
    this.statsRenderer = new StatsRenderer(this);
  }

  renderSearchInterface(el, config) {
    return this.searchRenderer.render(el, config);
  }

  renderMediaList(el, entries, config) {
    return this.mediaListRenderer.render(el, entries, config);
  }

  renderSearchResults(el, media, config) {
    return this.searchRenderer.renderSearchResults(el, media, config);
  }

  renderTableLayout(el, entries, config) {
    return this.tableRenderer.render(el, entries, config);
  }

  renderSingleMedia(el, mediaList, config) {
    return this.mediaListRenderer.renderSingle(el, mediaList, config);
  }

  renderUserStats(el, user, options = {}) {
    return this.statsRenderer.render(el, user, options);
  }

  renderMediaListChunked(el, entries, config, chunkSize = 20) {
    return this.mediaListRenderer.renderChunked(el, entries, config, chunkSize);
  }

  createMediaCard(data, config, options = {}) {
    return this.cardRenderer.createMediaCard(data, config, options);
  }

  // ========== SKELETON CREATION METHODS - UNCHANGED ==========
  
  createListSkeleton(count = 6) {
    return DOMHelper.createListSkeleton(count);
  }

  createStatsSkeleton() {
    return DOMHelper.createStatsSkeleton();
  }

  createSearchSkeleton() {
    return DOMHelper.createSearchSkeleton();
  }

  // ========== EVENT HANDLING METHODS - UNCHANGED ==========
  
  attachEventListeners(card, entry, media, config) {
    const statusBadge = card.querySelector('.clickable-status[data-entry-id]');
    if (statusBadge) {
      statusBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleStatusClick(e, entry, statusBadge, config);
      };
    }
    
    const addBtn = card.querySelector('.clickable-status[data-media-id]');
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleAddClick(e, media, config);
      };
    }
  }

  handleStatusClick(e, entry, badge, config = {}) {
    return this.cardRenderer.handleStatusClick(e, entry, badge, config);
  }

  handleAddClick(e, media, config) {
    return this.cardRenderer.handleAddClick(e, media, config);
  }

  // ========== UTILITY METHODS - UNCHANGED ==========
  
  clear(el) { 
    el.empty?.(); 
  }

  // Method to refresh active views (used by card renderer)
  refreshActiveViews() {
    // This method should trigger refresh of any active views
    // Implementation depends on your plugin's architecture
    if (this.plugin.refreshActiveViews) {
      this.plugin.refreshActiveViews();
    }
  }

  // ========== MISSING UTILITY METHODS FROM ORIGINAL ==========
  
  // URL generation methods that might be called from outside
  getAniListUrl(id, mediaType) {
    return this.plugin.getAniListUrl(id, mediaType);
  }

  getMALUrl(id, mediaType) {
    return this.plugin.getMALUrl(id, mediaType);
  }

  getSourceSpecificUrl(id, mediaType, source) {
    return this.apiHelper.getSourceSpecificUrl(id, mediaType, source);
  }

  // Error rendering (might be called from outside)
  renderError(el, message) {
    if (el.innerHTML !== undefined) {
      el.innerHTML = DOMHelper.createErrorMessage(message);
    } else {
      const errorDiv = el.createDiv({ cls: 'zoro-error' });
      errorDiv.textContent = message;
    }
  }

  // ========== STATS RENDERING HELPER METHODS - DELEGATED ==========
  
  renderStatsError(el, message) {
    return this.statsRenderer.renderError(el, message);
  }

  renderStatsHeader(fragment, user) {
    return this.statsRenderer.renderHeader(fragment, user);
  }

  renderStatsOverview(fragment, user, options) {
    return this.statsRenderer.renderOverview(fragment, user, options);
  }

  renderMediaTypeCard(container, type, stats, listOptions) {
    return this.statsRenderer.renderMediaTypeCard(container, type, stats, listOptions);
  }

  renderComparisonCard(container, animeStats, mangaStats) {
    return this.statsRenderer.renderComparisonCard(container, animeStats, mangaStats);
  }

  renderStatsBreakdowns(fragment, user, mediaType) {
    return this.statsRenderer.renderBreakdowns(fragment, user, mediaType);
  }

  renderStatsInsights(fragment, user, mediaType) {
    return this.statsRenderer.renderInsights(fragment, user, mediaType);
  }

  renderStatsFavorites(fragment, user, mediaType) {
    return this.statsRenderer.renderFavorites(fragment, user, mediaType);
  }

  renderBreakdownChart(container, title, data, keyField, options = {}) {
    return this.statsRenderer.renderBreakdownChart(container, title, data, keyField, options);
  }

  renderScoreDistribution(container, scores, listOptions) {
    return this.statsRenderer.renderScoreDistribution(container, scores, listOptions);
  }

  renderYearlyActivity(container, yearData) {
    return this.statsRenderer.renderYearlyActivity(container, yearData);
  }

  addSecondaryMetric(container, label, value) {
    return DOMHelper.addSecondaryMetric(container, label, value);
  }

  formatScore(score, scoreFormat = 'POINT_10') {
    return this.formatter.formatScore(score, scoreFormat);
  }

  formatWatchTime(minutes) {
    return this.formatter.formatWatchTime(minutes);
  }

  generateInsights(stats, type, user) {
    return this.statsRenderer.generateInsights(stats, type, user);
  }
}
class CardRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.apiHelper = parentRenderer.apiHelper;
    this.formatter = parentRenderer.formatter;
  }

  createMediaCard(data, config, options = {}) {
    const isSearch = options.isSearch || false;
    const isCompact = config.layout === 'compact';
    const media = isSearch ? data : data.media;
    // For search/trending items, synthesize a lightweight entry carrying metadata for proper source/mediaType detection
    const entry = isSearch
      ? {
          media,
          _zoroMeta: data?._zoroMeta || {
            source:
              this.apiHelper.validateAndReturnSource(config?.source) ||
              data?._zoroMeta?.source ||
              this.apiHelper.detectFromDataStructure({ media }) ||
              this.apiHelper.getFallbackSource(),
            mediaType: config?.mediaType || (media?.episodes ? 'ANIME' : 'MANGA')
          }
        }
      : data;
    const source = this.apiHelper.detectSource(entry, config);
    const mediaType = this.apiHelper.detectMediaType(entry, config, media);
    
    const card = document.createElement('div');
    card.className = `zoro-card ${isCompact ? 'compact' : ''}`;
    card.dataset.mediaId = media.id;

    // Create cover image if enabled
    if (this.plugin.settings.showCoverImages && media.coverImage?.large) {
      const coverContainer = this.createCoverContainer(media, entry, isSearch, isCompact);
      card.appendChild(coverContainer);
    }

    // Create media info section
    const info = this.createMediaInfo(media, entry, config, isSearch, isCompact);
    card.appendChild(info);
    
    // Add heart for favorites
    const heart = document.createElement('span');
    heart.className = 'zoro-heart';
    if (!media.isFavourite) heart.style.display = 'none';
    card.appendChild(heart);

    return card;
  }

  createCoverContainer(media, entry, isSearch, isCompact) {
    const coverContainer = document.createElement('div');
    coverContainer.className = 'cover-container';
    
    const img = document.createElement('img');
    img.src = media.coverImage.large;
    img.alt = media.title.english || media.title.romaji;
    img.className = 'media-cover pressable-cover';
    img.loading = 'lazy';

    
    let pressTimer = null;
    let isPressed = false;
    const pressHoldDuration = 400;
    
    img.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isPressed = true;
      img.classList.add('pressed');
      
      pressTimer = setTimeout(() => {
        if (isPressed) {
          this.plugin.moreDetailsPanel.showPanel(media, entry, img);
          img.classList.remove('pressed');
          isPressed = false;
        }
      }, pressHoldDuration);
    };

    img.onmouseup = img.onmouseleave = (e) => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      img.classList.remove('pressed');
      isPressed = false;
    };
    
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    
    img.oncontextmenu = (e) => {
      e.preventDefault();
      return false;
    };
    
    img.ondragstart = (e) => {
      e.preventDefault();
      return false;
    };
    
    img.ontouchstart = (e) => {
      isPressed = true;
      img.classList.add('pressed');
      
      pressTimer = setTimeout(() => {
        if (isPressed) {
          e.preventDefault();
          this.plugin.moreDetailsPanel.showPanel(media, entry, img);
          img.classList.remove('pressed');
          isPressed = false;
        }
      }, pressHoldDuration);
    };

    img.ontouchend = img.ontouchcancel = img.ontouchmove = (e) => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      img.classList.remove('pressed');
      isPressed = false;
    };
    
    img.title = 'Press and hold for more details';
    
    coverContainer.appendChild(img);
    
    // Add format badge to cover if available
    if (media.format) {
      const formatBadge = this.createFormatBadgeForCover(media);
      coverContainer.appendChild(formatBadge);
    }
    
    const needsOverlay = (!isSearch && entry && this.plugin.settings.showProgress) || 
                        (this.plugin.settings.showRatings && ((isSearch && media.averageScore != null) || (!isSearch && entry?.score != null)));
                        
    if (needsOverlay) {
      const overlay = this.createCoverOverlay(media, entry, isSearch);
      coverContainer.appendChild(overlay);
    }
    
    return coverContainer;
  }

  createFormatBadgeForCover(media) {
    const formatBadge = document.createElement('div');
    formatBadge.className = 'zoro-format-badge-cover';
    formatBadge.textContent = this.formatter.formatFormat(media.format);
    return formatBadge;
  }

  createCoverOverlay(media, entry, isSearch) {
    const overlay = document.createElement('div');
    overlay.className = 'cover-overlay';
    
    // Progress indicator
    if (!isSearch && entry && this.plugin.settings.showProgress) {
      const progress = document.createElement('span');
      progress.className = 'progress';
      const total = media.episodes || media.chapters || '?';
      progress.textContent = this.formatter.formatProgress(entry.progress, total);
      overlay.appendChild(progress);
    } else {
      overlay.appendChild(document.createElement('span'));
    }
    
    // Rating indicator
    if (this.plugin.settings.showRatings) {
      const score = isSearch ? media.averageScore : entry?.score;
      if (score != null) {
        const rating = document.createElement('span');
        rating.className = 'score';
        rating.textContent = this.formatter.formatRating(score, isSearch);
        overlay.appendChild(rating);
      } else {
        overlay.appendChild(document.createElement('span'));
      }
    }
    
    return overlay;
  }

  createMediaInfo(media, entry, config, isSearch, isCompact) {
    const info = document.createElement('div');
    info.className = 'media-info';

    // Title
    const title = this.createTitle(media, entry, config);
    info.appendChild(title);

    // Details (status, edit button - format badge removed)
    if (!isCompact) {
      const details = this.createMediaDetails(media, entry, config, isSearch);
      info.appendChild(details);
    }

    // Genres
    if (!isCompact && this.plugin.settings.showGenres && media.genres?.length) {
      const genres = this.createGenres(media);
      info.appendChild(genres);
    }

    return info;
  }

  createTitle(media, entry, config) {
    const title = document.createElement('h4');

    if (this.plugin.settings.hideUrlsInTitles) {
      title.textContent = this.formatter.formatTitle(media);
    } else {
      const titleLink = document.createElement('a');
      const source = this.apiHelper.detectSource(entry, config);
      const mediaType = this.apiHelper.detectMediaType(entry, config, media);
      
      // Use the proper URL method based on available plugin methods
      titleLink.href = this.plugin.getSourceSpecificUrl 
        ? this.apiHelper.getSourceSpecificUrl(media.id, mediaType, source)
        : this.apiHelper.getSourceUrl(media.id, mediaType, source);
      
      titleLink.target = '_blank';
      titleLink.textContent = this.formatter.formatTitle(media);
      titleLink.className = 'media-title-link';
      title.appendChild(titleLink);
    }

    return title;
  }
  
  createMediaDetails(media, entry, config, isSearch) {
    const details = document.createElement('div');
    details.className = 'media-details';

    // Format badge removed from here - now on cover image

    // Status badge or edit button
    if (!isSearch && entry && entry.status) {
      const statusBadge = this.createStatusBadge(entry, config);
      details.appendChild(statusBadge);
    }

    if (isSearch) {
      const editBtn = this.createEditButton(media, entry, config);
      details.appendChild(editBtn);
    }

    // CONNECTED NOTES BUTTON - ADD THIS
    const connectedNotesBtn = this.plugin.connectedNotes.createConnectedNotesButton(media, entry, config);
    details.appendChild(connectedNotesBtn);

    return details;
  }
  
  createStatusBadge(entry, config) {
    const statusBadge = document.createElement('span');
    const statusClass = this.formatter.getStatusClass(entry.status);
    const statusText = this.formatter.getStatusText(entry.status);
    
    statusBadge.className = `status-badge status-${statusClass} clickable-status`;
    statusBadge.textContent = statusText;
    statusBadge.onclick = (e) => this.handleStatusClick(e, entry, statusBadge, config);
    
    return statusBadge;
  }

  createEditButton(media, entry, config) {
    const editBtn = document.createElement('span');
    editBtn.className = 'status-badge status-edit clickable-status';
    editBtn.textContent = 'Edit';
    editBtn.dataset.loading = 'false';
    
    editBtn.onclick = (e) => this.handleEditClick(e, media, entry, config, editBtn);
    
    return editBtn;
  }

  createGenres(media) {
    const genres = document.createElement('div');
    genres.className = 'genres';
    
    const genreList = this.formatter.formatGenres(media.genres);
    genreList.forEach(g => {
      const tag = document.createElement('span');
      tag.className = 'genre-tag';
      tag.textContent = g || 'Unknown';
      genres.appendChild(tag);
    });
    
    return genres;
  }

  handleStatusClick(e, entry, badge, config) {
    e.preventDefault();
    e.stopPropagation();
    
    const source = this.apiHelper.detectSource(entry, config);
    const mediaType = this.apiHelper.detectMediaType(entry, config);
    
    if (!this.apiHelper.isAuthenticated(source)) {
      this.plugin.prompt.createAuthenticationPrompt(source);
      return;
    }
    
    this.plugin.handleEditClick(e, entry, badge, { source, mediaType });
  }

  async handleEditClick(e, media, entry, config, editBtn) {
    e.preventDefault();
    e.stopPropagation();
    
    const entrySource = this.apiHelper.detectSource(entry, config);
    const entryMediaType = this.apiHelper.detectMediaType(entry, config, media);

    if (!this.apiHelper.isAuthenticated(entrySource)) {
      console.log(`[Zoro] Not authenticated with ${entrySource}`);
      this.plugin.prompt.createAuthenticationPrompt(entrySource);
      return;
    }

    editBtn.dataset.loading = 'true';
    editBtn.innerHTML = DOMHelper.createLoadingSpinner();
    editBtn.style.pointerEvents = 'none';

    try {
      console.log(`[Zoro] Checking user entry for media ${media.id} via ${entrySource}`);
      
      const existingEntry = await this.apiHelper.getUserEntryForMedia(media.id, entryMediaType, entrySource);
      console.log(`[Zoro] User entry result:`, existingEntry ? 'Found existing entry' : 'Not in user list');
      
      const entryToEdit = existingEntry || {
        media: media,
        status: 'PLANNING',
        progress: 0,
        score: null,
        id: null
      };

      const isNewEntry = !existingEntry;
      editBtn.textContent = isNewEntry ? 'Add' : 'Edit';
      editBtn.className = `status-badge ${isNewEntry ? 'status-add' : 'status-edit'} clickable-status`;
      editBtn.dataset.loading = 'false';
      editBtn.style.pointerEvents = 'auto';

      console.log(`[Zoro] Opening edit modal for ${isNewEntry ? 'new' : 'existing'} entry`);

      this.plugin.edit.createEditModal(
        entryToEdit,
        async (updates) => {
          try {
            console.log(`[Zoro] Updating media ${media.id} with:`, updates);
            await this.apiHelper.updateMediaListEntry(media.id, updates, entrySource);
            
            const successMessage = isNewEntry ? '✅ Added to list!' : '✅ Updated!';
            new Notice(successMessage, 3000);
            console.log(`[Zoro] ${successMessage}`);
            
            editBtn.textContent = 'Edit';
            editBtn.className = 'status-badge status-edit clickable-status';
            
            this.parent.refreshActiveViews();
            
          } catch (updateError) {
            console.error('[Zoro] Update failed:', updateError);
            new Notice(`❌ Update failed: ${updateError.message}`, 5000);
          }
        },
        () => {
          console.log('[Zoro] Edit modal cancelled');
          editBtn.textContent = 'Edit';
          editBtn.className = 'status-badge status-edit clickable-status';
          editBtn.dataset.loading = 'false';
          editBtn.style.pointerEvents = 'auto';
        },
        entrySource
      );

    } catch (error) {
      console.error('[Zoro] User entry check failed:', error);
      
      editBtn.textContent = 'Edit';
      editBtn.dataset.loading = 'false';
      editBtn.style.pointerEvents = 'auto';
      
      new Notice('⚠️ Could not check list status, assuming new entry', 3000);
      
      const defaultEntry = {
        media: media,
        status: 'PLANNING',
        progress: 0,
        score: null,
        id: null
      };

      this.plugin.edit.createEditModal(
        defaultEntry,
        async (updates) => {
          try {
            await this.apiHelper.updateMediaListEntry(media.id, updates, entrySource);
            new Notice('✅ Added to list!', 3000);
            this.parent.refreshActiveViews();
          } catch (updateError) {
            console.error('[Zoro] Update failed:', updateError);
            new Notice(`❌ Failed to add: ${updateError.message}`, 5000);
          }
        },
        () => {
          console.log('[Zoro] Fallback edit modal cancelled');
        },
        entrySource
      );
    }
  }
}
class SearchRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.apiHelper = parentRenderer.apiHelper;
    this.cardRenderer = parentRenderer.cardRenderer;
  }

  render(el, config) {
    el.empty();
    el.className = 'zoro-search-container';

    const searchDiv = el.createDiv({ cls: 'zoro-search-input-container' });
    const input = searchDiv.createEl('input', { type: 'text', cls: 'zoro-search-input' });
    input.placeholder = config.mediaType === 'ANIME' ? 'Search anime…' : 'Search manga…';

    const resultsDiv = el.createDiv({ cls: 'zoro-search-results' });
    let timeout;

    const doSearch = async () => {
      const term = input.value.trim();
      if (term.length < 3) {
        resultsDiv.innerHTML = DOMHelper.createErrorMessage('Type at least 3 characters…');
        return;
      }
      
      try {
        resultsDiv.innerHTML = '';
        resultsDiv.appendChild(DOMHelper.createListSkeleton(5));
        
        const data = await this.apiHelper.fetchSearchData(config, term);
        
        resultsDiv.innerHTML = '';
        this.renderSearchResults(resultsDiv, data.Page.media, config);
      } catch (e) {
        this.plugin.renderError(resultsDiv, e.message);
      }
    };

    input.addEventListener('input', () => { 
      clearTimeout(timeout); 
      timeout = setTimeout(doSearch, 300); 
    });
    
    input.addEventListener('keypress', e => { 
      if (e.key === 'Enter') doSearch(); 
    });
  }

  renderSearchResults(el, media, config) {
    el.empty();
    if (media.length === 0) {
      el.innerHTML = DOMHelper.createErrorMessage('No results found.');
      return;
    }

    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    try {
  const cols = Number(this.plugin.settings.gridColumns) || 2;
  grid.style.setProperty('--zoro-grid-columns', String(cols));
  grid.style.setProperty('--grid-cols', String(cols));
  grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
} catch {}
    const fragment = document.createDocumentFragment();
    
    media.forEach(item => {
      fragment.appendChild(this.cardRenderer.createMediaCard(item, config, { isSearch: true }));
    });
    
    grid.appendChild(fragment);
  }
}
class MediaListRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.cardRenderer = parentRenderer.cardRenderer;
    this.tableRenderer = parentRenderer.tableRenderer;
  }

  render(el, entries, config) {
    el.empty();
    el.className = 'zoro-container';
    
    if (config.layout === 'table') {
      this.tableRenderer.render(el, entries, config);
      return;
    }

    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    try {
  const cols = Number(this.plugin.settings.gridColumns) || 2;
  grid.style.setProperty('--zoro-grid-columns', String(cols));
  grid.style.setProperty('--grid-cols', String(cols));
  grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
} catch {}
    const fragment = document.createDocumentFragment();
    
    entries.forEach(entry => {
      fragment.appendChild(this.cardRenderer.createMediaCard(entry, config));
    });
    
    grid.appendChild(fragment);
  }

  renderChunked(el, entries, config, chunkSize = 20) {
    el.empty();
    el.className = 'zoro-container';
    
    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    try {
  const cols = Number(this.plugin.settings.gridColumns) || 2;
  grid.style.setProperty('--zoro-grid-columns', String(cols));
  grid.style.setProperty('--grid-cols', String(cols));
  grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
} catch {}
    let index = 0;
    
    const renderChunk = () => {
      const fragment = document.createDocumentFragment();
      const end = Math.min(index + chunkSize, entries.length);
      
      for (; index < end; index++) {
        fragment.appendChild(this.cardRenderer.createMediaCard(entries[index], config));
      }
      
      grid.appendChild(fragment);
      
      if (index < entries.length) {
        requestAnimationFrame(renderChunk);
      }
    };
    
    renderChunk();
  }

  renderSingle(el, mediaList, config) {
    const media = mediaList && mediaList.media;
    if (!media) {
      el.empty();
      el.className = 'zoro-container';
      const box = el.createDiv({ cls: 'zoro-error-box' });
      box.createEl('strong', { text: '❌ Single media' });
      box.createEl('pre', { text: 'Media not found. Ensure the mediaId is correct and exists on the selected source.' });
      return;
    }

    el.empty();
    el.className = 'zoro-container';

    // Render like a search card: shows Edit button, no progress, shows ratings
    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    try {
      const cols = Number(this.plugin.settings.gridColumns) || 2;
      grid.style.setProperty('--zoro-grid-columns', String(cols));
      grid.style.setProperty('--grid-cols', String(cols));
      grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
    } catch {}

    const card = this.cardRenderer.createMediaCard(media, config, { isSearch: true });
    grid.appendChild(card);
  }
}
class TableRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.apiHelper = parentRenderer.apiHelper;
    this.formatter = parentRenderer.formatter;
  }

  render(el, entries, config) {
    const table = el.createEl('table', { cls: 'zoro-table' });
    const headers = ['Title', 'Format', 'Status'];
    if (this.plugin.settings.showProgress) headers.push('Progress');
    if (this.plugin.settings.showRatings) headers.push('Score');
    if (this.plugin.settings.showGenres) headers.push('Genres');

    table.createTHead().createEl('tr', null, tr =>
      headers.forEach(h => tr.createEl('th', { text: h }))
    );

    const tbody = table.createTBody();
    const fragment = document.createDocumentFragment();

    entries.forEach(entry => {
      const m = entry.media;
      const tr = fragment.createEl('tr');
      tr.createEl('td', null, td =>
        td.createEl('a', {
          text: m.title.english || m.title.romaji,
          href: config.source === 'mal' 
            ? this.plugin.getMALUrl(m.id, config.mediaType)
            : this.plugin.getAniListUrl(m.id, config.mediaType),
          cls: 'zoro-title-link',
          target: '_blank'
        })
      );
      tr.createEl('td', { text: m.format || '-' });
      tr.createEl('td', null, td => {
        const s = td.createEl('span', {
          text: entry.status,
          cls: `status-badge status-${entry.status.toLowerCase()} clickable-status`
        });
        s.onclick = e => {
          e.preventDefault();
          e.stopPropagation();
          
          // Check authentication based on source
          const isAuthenticated = config.source === 'mal' 
            ? this.plugin.settings.malAccessToken 
            : this.plugin.settings.accessToken;
            
          if (!isAuthenticated) {
            this.plugin.prompt.createAuthenticationPrompt();
            return;
          }
          this.plugin.handleEditClick(e, entry, s, config);
        };
      });
      if (this.plugin.settings.showProgress)
        tr.createEl('td', {
          text: `${entry.progress ?? 0}/${m.episodes ?? m.chapters ?? '?'}`
        });
      if (this.plugin.settings.showRatings)
        tr.createEl('td', { text: entry.score != null ? `★ ${entry.score}` : '-' });
      if (this.plugin.settings.showGenres)
        tr.createEl('td', {
          text: (m.genres || []).slice(0, 3).join(', ') || '-'
        });
    });

    tbody.appendChild(fragment);
  }
}
class StatsRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.formatter = parentRenderer.formatter;
  }

  render(el, user, options = {}) {
    const {
      layout = 'standard',
      mediaType = 'ANIME',
      showComparisons = true,
      showTrends = true
    } = options;

    el.empty();
    el.className = `zoro-container zoro-stats-container zoro-stats-${layout}`;

    if (!user || !user.statistics) {
      this.renderError(el, 'No statistics available for this user');
      return;
    }

    const fragment = DOMHelper.createFragment();

    // User header with key info
    this.renderHeader(fragment, user);

    // Main overview cards
    this.renderOverview(fragment, user, { showComparisons, mediaType });

    // Detailed breakdowns based on layout
    if (layout !== 'minimal') {
      this.renderBreakdowns(fragment, user, mediaType);
    }

    // Activity insights
    if (layout === 'detailed' && showTrends) {
      this.renderInsights(fragment, user, mediaType);
    }

    // Favorites showcase
    this.renderFavorites(fragment, user, mediaType);

    el.appendChild(fragment);
  }

  renderError(el, message) {
    const errorDiv = el.createDiv({ cls: 'zoro-stats-error' });
    errorDiv.createEl('div', { 
      cls: 'zoro-error-icon',
      text: '📊' 
    });
    errorDiv.createEl('h3', { 
      text: 'Stats Unavailable',
      cls: 'zoro-error-title'
    });
    errorDiv.createEl('p', { 
      text: message,
      cls: 'zoro-error-message'
    });
  }

  renderHeader(fragment, user) {
    const header = fragment.createDiv({ cls: 'zoro-stats-header' });
    
    const userInfo = header.createDiv({ cls: 'zoro-user-info' });
    
    if (user.avatar?.medium) {
      userInfo.createEl('img', {
        cls: 'zoro-user-avatar',
        attr: { 
          src: user.avatar.medium,
          alt: `${user.name}'s avatar`
        }
      });
    }

    const userDetails = userInfo.createDiv({ cls: 'zoro-user-details' });
    const userName = userDetails.createEl('h2', { 
      text: user.name,
      cls: 'zoro-user-name zoro-user-name-clickable'
    });

    // Make the user name clickable
    userName.style.cursor = 'pointer';
    userName.addEventListener('click', () => {
      const source = user?._zoroMeta?.source || 'anilist';
const url = source === 'mal'
  ? `https://myanimelist.net/profile/${encodeURIComponent(user.name)}`
  : `https://anilist.co/user/${encodeURIComponent(user.name)}`;
window.open(url, '_blank');
    });

    userName.addEventListener('mouseenter', () => {
      userName.style.textDecoration = 'underline';
    });

    userName.addEventListener('mouseleave', () => {
      userName.style.textDecoration = 'none';
    });
  }

  renderOverview(fragment, user, options) {
    const { showComparisons, mediaType = 'ANIME' } = options;
    const overview = fragment.createDiv({ cls: 'zoro-stats-overview' });
    
    const statsGrid = overview.createDiv({ cls: 'zoro-stats-grid' });

    // Anime stats
    const animeStats = user.statistics.anime;

    // Manga stats  
    const mangaStats = user.statistics.manga;
    const showAnime = String(mediaType).toUpperCase() === 'ANIME';
const showManga = String(mediaType).toUpperCase() === 'MANGA';

if (showAnime && animeStats && animeStats.count > 0) {
  this.renderMediaTypeCard(statsGrid, 'anime', animeStats, user.mediaListOptions);
}
if (showManga && mangaStats && mangaStats.count > 0) {
      this.renderMediaTypeCard(statsGrid, 'manga', mangaStats, user.mediaListOptions);
    }

     if (showAnime && showManga && animeStats?.count > 0 && mangaStats?.count > 0 && showComparisons) {
      this.renderComparisonCard(statsGrid, animeStats, mangaStats);
    }
  }

  renderMediaTypeCard(container, type, stats, listOptions) {
    const card = container.createDiv({ 
      cls: `zoro-stat-card zoro-${type}-card`,
      attr: { 'data-type': type }
    });

    // Header
    const header = card.createDiv({ cls: 'zoro-card-header' });
    header.createEl('h3', { 
      text: type.charAt(0).toUpperCase() + type.slice(1),
      cls: 'zoro-card-title'
    });

    // Primary metrics
    const metrics = card.createDiv({ cls: 'zoro-primary-metrics' });
    
    // Total count - most important metric
    const totalMetric = metrics.createDiv({ cls: 'zoro-metric zoro-metric-primary' });
    totalMetric.createEl('div', { 
      text: stats.count.toLocaleString(),
      cls: 'zoro-metric-value'
    });
    totalMetric.createEl('div', { 
      text: 'Total',
      cls: 'zoro-metric-label'
    });

    // Mean score if available
    if (stats.meanScore > 0) {
      const scoreMetric = metrics.createDiv({ cls: 'zoro-metric' });
      const scoreFormat = listOptions?.scoreFormat || 'POINT_10';
      const displayScore = this.formatter.formatScore(stats.meanScore, scoreFormat);
      
      scoreMetric.createEl('div', { 
        text: displayScore,
        cls: 'zoro-metric-value zoro-score-value'
      });
      scoreMetric.createEl('div', { 
        text: 'Avg Score',
        cls: 'zoro-metric-label'
      });
    }

    // Secondary metrics
    const secondaryMetrics = card.createDiv({ cls: 'zoro-secondary-metrics' });
    
    if (type === 'anime') {
      if (stats.episodesWatched) {
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Episodes', stats.episodesWatched.toLocaleString());
      }
      if (stats.minutesWatched) {
        const timeFormatted = this.formatter.formatWatchTime(stats.minutesWatched);
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Time Watched', timeFormatted);
      }
    } else {
      if (stats.chaptersRead) {
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Chapters', stats.chaptersRead.toLocaleString());
      }
      if (stats.volumesRead) {
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Volumes', stats.volumesRead.toLocaleString());
      }
    }

    if (stats.standardDeviation) {
      DOMHelper.addSecondaryMetric(secondaryMetrics, 'Score Deviation', stats.standardDeviation.toFixed(1));
    }
  }

  renderComparisonCard(container, animeStats, mangaStats) {
    const card = container.createDiv({ cls: 'zoro-stat-card zoro-comparison-card' });

    const header = card.createDiv({ cls: 'zoro-card-header' });
    header.createEl('h3', { 
      text: 'At a Glance',
      cls: 'zoro-card-title'
    });

    const comparisons = card.createDiv({ cls: 'zoro-comparisons' });

    // Total entries
    const totalAnime = animeStats.count || 0;
    const totalManga = mangaStats.count || 0;
    const totalCombined = totalAnime + totalManga;
    
    const totalComp = comparisons.createDiv({ cls: 'zoro-comparison' });
    totalComp.createEl('div', { 
      text: totalCombined.toLocaleString(),
      cls: 'zoro-comparison-value'
    });
    totalComp.createEl('div', { 
      text: 'Total Entries',
      cls: 'zoro-comparison-label'
    });

    // Preference indicator
    if (totalAnime > 0 && totalManga > 0) {
      const preference = totalAnime > totalManga ? 'Anime' : 
                       totalManga > totalAnime ? 'Manga' : 'Balanced';
      const ratio = totalAnime > totalManga ? 
                    (totalAnime / totalManga).toFixed(1) : 
                    (totalManga / totalAnime).toFixed(1);
      
      const prefComp = comparisons.createDiv({ cls: 'zoro-comparison' });
      prefComp.createEl('div', { 
        text: preference,
        cls: 'zoro-comparison-value'
      });
      prefComp.createEl('div', { 
        text: preference === 'Balanced' ? 'Preference' : `${ratio}:1 Ratio`,
        cls: 'zoro-comparison-label'
      });
    }

    // Score comparison
    const animeScore = animeStats.meanScore || 0;
    const mangaScore = mangaStats.meanScore || 0;
    if (animeScore > 0 && mangaScore > 0) {
      const scoreDiff = Math.abs(animeScore - mangaScore);
      const higherType = animeScore > mangaScore ? 'Anime' : 'Manga';
      
      const scoreComp = comparisons.createDiv({ cls: 'zoro-comparison' });
      scoreComp.createEl('div', { 
        text: scoreDiff < 0.5 ? 'Similar' : higherType,
        cls: 'zoro-comparison-value'
      });
      scoreComp.createEl('div', { 
        text: 'Higher Rated',
        cls: 'zoro-comparison-label'
      });
    }
  }

  renderBreakdowns(fragment, user, mediaType) {
    const type = mediaType.toLowerCase();
    const stats = user.statistics[type];
    
    if (!stats || stats.count === 0) return;

    const section = fragment.createDiv({ cls: 'zoro-stats-breakdowns' });
    section.createEl('h3', { 
      text: `${mediaType} Breakdown`,
      cls: 'zoro-section-title'
    });

    const breakdownGrid = section.createDiv({ cls: 'zoro-breakdown-grid' });

    // Status distribution (most useful)
    if (stats.statuses?.length) {
      this.renderBreakdownChart(breakdownGrid, 'Status Distribution', stats.statuses, 'status', {
        showPercentages: true,
        maxItems: 6
      });
    }

    // Score distribution (if user rates)
    if (stats.scores?.length) {
      const validScores = stats.scores.filter(s => s.score > 0 && s.count > 0);
      if (validScores.length >= 3) {
        this.renderScoreDistribution(breakdownGrid, validScores, user.mediaListOptions);
      }
    }

    // Format breakdown
    if (stats.formats?.length) {
      const topFormats = stats.formats.slice(0, 6);
      this.renderBreakdownChart(breakdownGrid, 'Format Distribution', topFormats, 'format', {
        showPercentages: true
      });
    }

    // Release years (activity timeline)
    if (stats.releaseYears?.length) {
      this.renderYearlyActivity(breakdownGrid, stats.releaseYears);
    }
  }

  renderInsights(fragment, user, mediaType) {
    const type = mediaType.toLowerCase();
    const stats = user.statistics[type];
    
    if (!stats) return;

    const insights = fragment.createDiv({ cls: 'zoro-stats-insights' });
    insights.createEl('h3', { 
      text: 'Insights',
      cls: 'zoro-section-title'
    });

    const insightsList = insights.createDiv({ cls: 'zoro-insights-list' });

    // Generate meaningful insights
    const insightData = this.generateInsights(stats, type, user);
    insightData.forEach(insight => {
      const item = insightsList.createDiv({ cls: 'zoro-insight-item' });
      item.createEl('div', { 
        text: insight.icon,
        cls: 'zoro-insight-icon'
      });
      item.createEl('div', { 
        text: insight.text,
        cls: 'zoro-insight-text'
      });
    });
  }

  renderFavorites(fragment, user, mediaType) {
    const type = mediaType.toLowerCase();
    const favorites = user.favourites?.[type]?.nodes;
    
    if (!favorites?.length) return;

    const section = fragment.createDiv({ cls: 'zoro-stats-favorites' });
    section.createEl('h3', { 
      text: `Favorite ${mediaType}`,
      cls: 'zoro-section-title'
    });

    const favGrid = section.createDiv({ cls: 'zoro-favorites-grid' });
    
    favorites.slice(0, 6).forEach(item => {
      const favItem = favGrid.createDiv({ cls: 'zoro-favorite-item' });
      
      if (item.coverImage?.medium) {
        favItem.createEl('img', {
          cls: 'zoro-favorite-cover',
          attr: {
            src: item.coverImage.medium,
            alt: this.formatter.formatTitle(item)
          }
        });
      }
      
      const info = favItem.createDiv({ cls: 'zoro-favorite-info' });
      info.createEl('div', { 
        text: this.formatter.formatTitle(item),
        cls: 'zoro-favorite-title'
      });
      
      if (item.meanScore) {
        info.createEl('div', { 
          text: `★ ${(item.meanScore / 10).toFixed(1)}`,
          cls: 'zoro-favorite-score'
        });
      }
    });
  }

  renderBreakdownChart(container, title, data, keyField, options = {}) {
    const { showPercentages = false, maxItems = 8 } = options;
    
    const chartContainer = container.createDiv({ cls: 'zoro-breakdown-chart' });
    chartContainer.createEl('h4', { 
      text: title,
      cls: 'zoro-breakdown-title'
    });

    const chartData = data.slice(0, maxItems);
    const total = chartData.reduce((sum, item) => sum + item.count, 0);
    const maxCount = Math.max(...chartData.map(item => item.count));

    const chart = chartContainer.createDiv({ cls: 'zoro-chart' });
    
    chartData.forEach((item, index) => {
      const barContainer = chart.createDiv({ cls: 'zoro-chart-bar-container' });
      
      const label = barContainer.createDiv({ cls: 'zoro-chart-label' });
      label.textContent = item[keyField] || item.status || item.genre || item.format;
      
      const barSection = barContainer.createDiv({ cls: 'zoro-chart-bar-section' });
      const bar = barSection.createDiv({ cls: 'zoro-chart-bar' });
      
      const percentage = (item.count / maxCount) * 100;
      bar.style.setProperty('--bar-width', `${percentage}%`);
      bar.style.animationDelay = `${index * 0.1}s`;
      
      const value = barSection.createDiv({ cls: 'zoro-chart-value' });
      if (showPercentages && total > 0) {
        const percent = ((item.count / total) * 100).toFixed(1);
        value.textContent = `${item.count} (${percent}%)`;
      } else {
        value.textContent = item.count.toLocaleString();
      }
    });
  }

  renderScoreDistribution(container, scores, listOptions) {
  const chartContainer = container.createDiv({ cls: 'zoro-breakdown-chart' });
  chartContainer.createEl('h4', { 
    text: 'Score Distribution',
    cls: 'zoro-breakdown-title'
  });

  const chart = chartContainer.createDiv({ cls: 'zoro-score-chart' });
  const maxCount = Math.max(...scores.map(s => s.count));

  scores.forEach((scoreData, index) => {
    const barContainer = chart.createDiv({ cls: 'zoro-score-bar-container' });
    
    const label = barContainer.createDiv({ cls: 'zoro-score-label' });
    const scoreFormat = listOptions?.scoreFormat || 'POINT_10';
    let scoreValue = scoreData.score;
    if (scoreFormat === 'POINT_10' && typeof scoreValue === 'number' && scoreValue <= 10) {
      scoreValue = scoreValue * 10;
    }
    label.textContent = this.formatter.formatScore(scoreValue, scoreFormat);
    
    const bar = barContainer.createDiv({ cls: 'zoro-score-bar' });
    const percentage = (scoreData.count / maxCount) * 100;
    // Fix: Set --bar-height instead of --bar-width for vertical bars
    bar.style.setProperty('--bar-height', `${percentage}%`);
    bar.style.animationDelay = `${index * 0.1}s`;
    
    const value = barContainer.createDiv({ cls: 'zoro-score-value' });
    value.textContent = scoreData.count;
  });
}

  renderYearlyActivity(container, yearData) {
    const chartContainer = container.createDiv({ cls: 'zoro-breakdown-chart' });
    chartContainer.createEl('h4', { 
      text: 'Activity by Year',
      cls: 'zoro-breakdown-title'
    });

    const recentYears = yearData
      .filter(y => y.releaseYear >= new Date().getFullYear() - 15)
      .slice(0, 8);

    if (recentYears.length === 0) return;

    const timeline = chartContainer.createDiv({ cls: 'zoro-year-timeline' });
    const maxCount = Math.max(...recentYears.map(y => y.count));

    recentYears.forEach((yearData, index) => {
      const yearItem = timeline.createDiv({ cls: 'zoro-year-item' });
      
      yearItem.createEl('div', { 
        text: yearData.releaseYear,
        cls: 'zoro-year-label'
      });
      
      const bar = yearItem.createDiv({ cls: 'zoro-year-bar' });
      const percentage = (yearData.count / maxCount) * 100;
      bar.style.setProperty('--bar-width', `${percentage}%`);
      bar.style.animationDelay = `${index * 0.1}s`;
      
      yearItem.createEl('div', { 
        text: yearData.count,
        cls: 'zoro-year-count'
      });
    });
  }

  generateInsights(stats, type, user) {
    const insights = [];
    
    // Completion rate insight
    if (stats.statuses) {
      const completed = stats.statuses.find(s => s.status === 'COMPLETED')?.count || 0;
      const total = stats.count;
      const completionRate = (completed / total * 100).toFixed(0);
      
      if (completionRate >= 80) {
        insights.push({
          icon: '🏆',
          text: `High completion rate: ${completionRate}% of your ${type} are completed`
        });
      } else if (completionRate <= 30) {
        insights.push({
          icon: '📚',
          text: `Lots to explore: Only ${completionRate}% completed, plenty of ${type} to discover!`
        });
      }
    }

    // Score distribution insight
    if (stats.meanScore > 0) {
      if (stats.meanScore >= 80) {
        insights.push({
          icon: '⭐',
          text: `You're generous with ratings! Average score: ${(stats.meanScore/10).toFixed(1)}/10`
        });
      } else if (stats.meanScore <= 60) {
        insights.push({
          icon: '🔍',
          text: `Selective taste: You rate ${type} conservatively with ${(stats.meanScore/10).toFixed(1)}/10 average`
        });
      }
    }

    // Volume insight for anime
    if (type === 'anime' && stats.episodesWatched) {
      if (stats.episodesWatched >= 5000) {
        insights.push({
          icon: '🎭',
          text: `Anime veteran: ${stats.episodesWatched.toLocaleString()} episodes watched!`
        });
      }
      
      if (stats.minutesWatched >= 100000) { // ~69 days
        const days = Math.floor(stats.minutesWatched / (60 * 24));
        insights.push({
          icon: '⏰',
          text: `Time investment: ${days} days worth of anime watched`
        });
      }
    }

    // Genre diversity (if available)
    if (stats.genres && stats.genres.length >= 15) {
      insights.push({
        icon: '🌈',
        text: `Diverse taste: You enjoy ${stats.genres.length} different genres`
      });
    }

    return insights.slice(0, 4); // Limit to 4 insights
  }
}
class APISourceHelper {
  constructor(plugin) {
    this.plugin = plugin;
  }

  getAPI(source) {
    const normalizedSource = source?.toLowerCase();
    
    switch(normalizedSource) {
      case 'mal': return this.plugin.malApi;
      case 'simkl': return this.plugin.simklApi;
      case 'anilist':
      default: return this.plugin.api;
    }
  }

  isAuthenticated(source) {
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

  getSourceUrl(id, mediaType, source) {
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

  async fetchSearchData(config, term) {
    const normalizedSource = config.source?.toLowerCase();
    
    if (normalizedSource === 'mal') {
      return await this.plugin.malApi.fetchMALData({ 
        ...config, 
        type: 'search',
        search: term, 
        query: term,
        page: 1, 
        perPage: 5 
      });
    } else if (normalizedSource === 'simkl') {
      return await this.plugin.simklApi.fetchSimklData({ 
        ...config, 
        type: 'search',
        search: term, 
        query: term,
        page: 1, 
        perPage: 5 
      });
    } else {
      return await this.plugin.api.fetchAniListData({ 
        ...config, 
        type: 'search',
        search: term, 
        page: 1, 
        perPage: 5 
      });
    }
  }

  async getUserEntryForMedia(mediaId, mediaType, source) {
    const normalizedSource = source?.toLowerCase();
    
    if (normalizedSource === 'mal') {
      return await this.plugin.malApi.getUserEntryForMedia?.(mediaId, mediaType) || null;
    } else if (normalizedSource === 'simkl') {
      return await this.plugin.simklApi.getUserEntryForMedia?.(mediaId, mediaType) || null;
    } else {
      return await this.plugin.api.getUserEntryForMedia(mediaId, mediaType);
    }
  }

  async updateMediaListEntry(mediaId, updates, source) {
    const api = this.getAPI(source);
    return await api.updateMediaListEntry(mediaId, updates);
  }

  getSourceSpecificUrl(id, mediaType, source) {
    return this.plugin.getSourceSpecificUrl(id, mediaType, source);
  }

  detectSource(entry, config) {
    // 1. Check existing metadata first
    if (entry?._zoroMeta?.source) {
      return this.validateAndReturnSource(entry._zoroMeta.source);
    }
    
    // 2. Try config source
    if (config?.source) {
      return this.validateAndReturnSource(config.source);
    }
    
    // 3. Detect from data structure patterns
    const detectedSource = this.detectFromDataStructure(entry);
    if (detectedSource) {
      return detectedSource;
    }
    
    // 4. Fallback to best available source
    return this.getFallbackSource();
  }

  detectFromDataStructure(entry) {
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
        entry.node?.id && entry.node?.title) {
      return 'mal';
    }
    
    // SIMKL patterns
    if (entry.show?.ids?.simkl ||
        entry.user_stats ||
        entry.media?.simkl_id ||
        entry.show?.title && entry.show?.year) {
      return 'simkl';
    }
    
    return null;
  }

  validateAndReturnSource(source) {
    const normalizedSource = source?.toLowerCase();
    const validSources = ['anilist', 'mal', 'simkl'];
    
    if (validSources.includes(normalizedSource)) {
      return normalizedSource;
    }
    
    return null;
  }

  getFallbackSource() {
    // Return first available authenticated source, or default to anilist
    if (this.isAuthenticated('mal')) return 'mal';
    if (this.isAuthenticated('simkl')) return 'simkl'; 
    if (this.isAuthenticated('anilist')) return 'anilist';
    return 'anilist';
  }

  detectMediaType(entry, config, media) {
    return entry?._zoroMeta?.mediaType || config.mediaType || 
           (media?.episodes ? 'ANIME' : 'MANGA');
  }
}
class FormatterHelper {
  formatScore(score, scoreFormat = 'POINT_10') {
    switch (scoreFormat) {
      case 'POINT_100':
        return `${Math.round(score * 10)}/100`;
      case 'POINT_10':
        return `${(score / 10).toFixed(1)}/10`;
      case 'POINT_5':
        return `${Math.round(score / 20)}/5`;
      case 'POINT_3':
        return score >= 70 ? '😊' : score >= 40 ? '😐' : '😞';
      default:
        return `${Math.round(score / 10)}/10`;
    }
  }

  formatWatchTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 365) {
      const years = (days / 365).toFixed(1);
      return `${years} years`;
    } else if (days > 30) {
      const months = Math.floor(days / 30);
      return `${months} months`;
    } else if (days > 0) {
      return `${days} days`;
    } else {
      return `${hours} hours`;
    }
  }

  formatProgress(current, total) {
    return `${current || 0}/${total || '?'}`;
  }

  formatRating(score, isSearch = false) {
    if (score == null) return null;
    
    if (isSearch) {
      return `★ ${Math.round(score / 10)}`;
    } else {
      if (score > 10) {
        return `★ ${Math.round(score / 10)}`;
      } else {
        return `★ ${Math.round(score)}`;
      }
    }
  }

  getStatusClass(status) {
    return status ? status.toLowerCase() : 'unknown';
  }

  getStatusText(status) {
    return status || 'Unknown';
  }

  formatGenres(genres, maxCount = 3) {
    if (!genres?.length) return [];
    return genres.slice(0, maxCount);
  }

  formatTitle(media) {
    return media.title?.english || media.title?.romaji || 'Unknown';
  }

  formatFormat(format) {
    return format ? format.substring(0, 2).toUpperCase() : '';
  }
}
class DOMHelper {
  static createLoadingSpinner() {
    return `
      <div class="sharingan-glow">
        <div class="tomoe-container">
          <span class="tomoe"></span>
          <span class="tomoe"></span>
          <span class="tomoe"></span>
        </div>
      </div>
    `;
  }

  static createSkeletonCard() {
    const skeleton = document.createElement('div');
    skeleton.className = 'zoro-card zoro-skeleton';
    skeleton.innerHTML = `
      <div class="skeleton-cover"></div>
      <div class="media-info">
        <div class="skeleton-title"></div>
        <div class="skeleton-details">
          <span class="skeleton-badge"></span>
          <span class="skeleton-badge"></span>
        </div>
      </div>
    `;
    return skeleton;
  }

  static createListSkeleton(count = 6) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'zoro-card zoro-skeleton';
      skeleton.innerHTML = `
        <div class="skeleton-cover"></div>
        <div class="media-info">
          <div class="skeleton-title"></div>
          <div class="skeleton-details">
            <span class="skeleton-badge"></span>
            <span class="skeleton-badge"></span>
          </div>
        </div>
      `;
      fragment.appendChild(skeleton);
    }
    return fragment;
  }

  static createStatsSkeleton() {
    const container = document.createElement('div');
    container.className = 'zoro-container zoro-stats-skeleton';
    container.innerHTML = `
      <div class="zoro-user-stats">
        <div class="zoro-user-header">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-title"></div>
        </div>
        <div class="zoro-stats-grid">
          <div class="skeleton-stat-section"></div>
          <div class="skeleton-stat-section"></div>
        </div>
      </div>
    `;
    return container;
  }

  static createSearchSkeleton() {
    const container = document.createElement('div');
    container.className = 'zoro-search-container zoro-search-skeleton';
    container.innerHTML = `
      <div class="zoro-search-input-container">
        <input type="text" class="zoro-search-input" disabled placeholder="Loading search...">
      </div>
      <div class="zoro-search-results">
        <div class="zoro-cards-grid">
          ${Array(3).fill().map(() => `
            <div class="zoro-card zoro-skeleton">
              <div class="skeleton-cover"></div>
              <div class="media-info">
                <div class="skeleton-title"></div>
                <div class="skeleton-details">
                  <span class="skeleton-badge"></span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return container;
  }

  static createErrorMessage(message) {
    return `<div class="zoro-search-message">${message}</div>`;
  }

  static createFragment() {
    return document.createDocumentFragment();
  }

  static setupFragment() {
    // Create fragment with Obsidian's createEl method if available
    const fragment = document.createDocumentFragment();
    
    // Add Obsidian's createEl method to fragment if it doesn't exist
    if (!fragment.createEl && document.createEl) {
      fragment.createEl = function(tag, attr, callback) {
        const el = document.createElement(tag);
        if (attr) {
          if (attr.cls) el.className = attr.cls;
          if (attr.text) el.textContent = attr.text;
          if (attr.attr) {
            Object.entries(attr.attr).forEach(([key, value]) => {
              el.setAttribute(key, value);
            });
          }
        }
        if (callback) callback(el);
        this.appendChild(el);
        return el;
      };
    }
    
    return fragment;
  }

  static setupPressAndHold(element, callback, duration = 400) {
    let pressTimer = null;
    let isPressed = false;
    
    const startPress = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isPressed = true;
      element.classList.add('pressed');
      
      pressTimer = setTimeout(() => {
        if (isPressed) {
          callback(e);
          element.classList.remove('pressed');
          isPressed = false;
        }
      }, duration);
    };

    const endPress = (e) => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      element.classList.remove('pressed');
      isPressed = false;
    };

    // Mouse events
    element.onmousedown = startPress;
    element.onmouseup = element.onmouseleave = endPress;
    
    // Touch events
    element.ontouchstart = startPress;
    element.ontouchend = element.ontouchcancel = element.ontouchmove = endPress;
    
    // Prevent default behaviors
    element.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    
    element.oncontextmenu = (e) => {
      e.preventDefault();
      return false;
    };
    
    element.ondragstart = (e) => {
      e.preventDefault();
      return false;
    };

    return { startPress, endPress };
  }

  static addSecondaryMetric(container, label, value) {
    const metric = container.createDiv({ cls: 'zoro-secondary-metric' });
    metric.createEl('span', { 
      text: label,
      cls: 'zoro-metric-label-small'
    });
    metric.createEl('span', { 
      text: value,
      cls: 'zoro-metric-value-small'
    });
  }
}
class EmojiIconMapper {
  constructor(opts = {}) {
    this.map = new Map(Object.entries({
      '👤': 'user',
      '🧭': 'compass',
      '📺': 'monitor',
      '🌌': 'palette',
      '✨': 'sparkles',
      '📤': 'upload',
      '🔁': 'refresh-cw',
      '🚧': 'construction',
      'ℹ️': 'info',
      '🆔': 'id-card',
      '✳️': 'shell',
      '🗾': 'origami',
      '⚡': 'zap',
      '🗝️': 'key',
      '🧊': 'layout-grid',
      '🔲': 'columns-3',
      '⏳': 'loader',
      '🔗': 'link',
      '🌆': 'image',
      '⭐': 'star',
      '📈': 'trending-up',
      '🎭': 'tag',
      '🧮': 'calculator',
      '🧾': 'file-text',
      '🎨': 'palette',
      '📥': 'download',
      '🗑': 'trash',
      '📊': 'bar-chart',
      '🧹': 'trash-2',
      '🎬': 'film',
      '🗝': 'key',
      '🔑': 'key',
      '🔒': 'lock',
      '🔍': 'search',
      '🌐': 'globe',
      '🛰️': 'globe',
      '🌀': 'refresh-cw',
      '🌟': 'star',
      '🗑️': 'trash-2',
      '⌛': 'hourglass',
      '📃': 'file-text',
      '📉': 'trending-down',
      '🧿': 'list',
      '🧨': 'zap',
      'ℹ': 'info',
      '⚠️': 'alert-triangle',
      '➕': 'circle-plus',
      '📝': 'square-pen',
      '⛓️': 'workflow',
      '💾': 'database-backup',
      '🌓': 'swatch-book',
      '🗒️': 'notebook-pen', 
      '🗂️': 'folder-open',
      '🔮': 'square-mouse-pointer',
      '🎴': 'file-input',
      ...Object.fromEntries(opts.map || [])
    }));
    
    this._sortedKeys = [...this.map.keys()].sort((a, b) => b.length - a.length);
    this._emojiRegex = new RegExp(`(${this._sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    this._iconRegex = /\[icon:([a-z0-9-]+)\]/gi;
    this._colonRegex = /:([a-z0-9-]+):/gi;
    this._patches = new Map();
    this._patched = false;
    this.iconSize = opts.iconSize ?? 30;
    this.gap = opts.gap ?? 6;
    this._iconStyle = `display:inline-flex;align-items:center;justify-content:center;width:${this.iconSize}px;height:${this.iconSize}px;vertical-align:middle`;
  }

  init(opts = {}) {
    const { patchSettings = true, patchCreateEl = true, patchNotice = false } = opts;
    
    if (this._patched) return this;
    
    this._injectStyles();
    patchSettings && this._patchSettings();
    patchCreateEl && this._patchCreateEl();
    patchNotice && this._patchNotice();
    
    this._patched = true;
    globalThis.__emojiIconMapper = this;
    return this;
  }

  unpatch() {
    if (!this._patched) return this;
    
    for (const [target, original] of this._patches) {
      try { Object.assign(target, original); } catch {}
    }
    
    this._patches.clear();
    this._patched = false;
    return this;
  }

  parseToFragment(text) {
    if (!text?.trim?.()) return null;
    
    if (!this._hasTokens(text)) return null;
    
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    
    const matches = this._getAllMatches(text);
    if (!matches.length) return null;
    
    matches.forEach(({ start, end, iconName }) => {
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      
      fragment.appendChild(this._createIcon(iconName));
      lastIndex = end;
    });
    
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    
    return fragment;
  }

  _hasTokens(text) {
    this._emojiRegex.lastIndex = 0;
    return text.includes('[icon:') || text.includes(':') || this._emojiRegex.test(text);
  }

  _getAllMatches(text) {
    const matches = [];
    
    this._iconRegex.lastIndex = 0;
    for (const match of text.matchAll(this._iconRegex)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        iconName: match[1]
      });
    }
    
    this._colonRegex.lastIndex = 0;
    for (const match of text.matchAll(this._colonRegex)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        iconName: match[1]
      });
    }
    
    this._emojiRegex.lastIndex = 0;
    for (const match of text.matchAll(this._emojiRegex)) {
      const iconName = this.map.get(match[0]);
      if (iconName) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          iconName
        });
      }
    }
    
    return matches
      .sort((a, b) => a.start - b.start)
      .filter((match, i, arr) => 
        i === 0 || match.start >= arr[i - 1].end
      );
  }

  _createIcon(name) {
    const span = document.createElement('span');
    span.style.cssText = this._iconStyle;
    
    try {
      if (typeof setIcon === 'function' && name) {
        setIcon(span, name);
      } else {
        span.textContent = name ? `[${name}]` : '';
      }
    } catch {
      span.textContent = '';
    }
    
    return span;
  }

  _injectStyles() {
    const styleId = 'emoji-icon-mapper-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `.eim-inline{display:inline-flex;gap:${this.gap}px;align-items:center;line-height:1}`;
    document.head.appendChild(style);
  }

  _createPatchedMethod(original, processor) {
    const self = this;
    return function(value) {
      if (typeof value === 'string') {
        const fragment = self.parseToFragment(value);
        if (fragment) {
          const wrapper = document.createElement('span');
          wrapper.className = 'eim-inline';
          wrapper.appendChild(fragment);
          return original.call(this, wrapper);
        }
      }
      return original.call(this, value);
    };
  }

  _patchSettings() {
    if (typeof Setting === 'undefined') return;
    
    const proto = Setting.prototype;
    const original = {
      setName: proto.setName,
      setDesc: proto.setDesc
    };
    
    proto.setName = this._createPatchedMethod(original.setName);
    proto.setDesc = this._createPatchedMethod(original.setDesc);
    
    this._patches.set(proto, original);
  }

  _patchCreateEl() {
    if (!Element.prototype.createEl) return;
    
    const proto = Element.prototype;
    const original = { createEl: proto.createEl };
    const self = this;
    
    proto.createEl = function(tag, attrs, options) {
      if (attrs?.text != null) {
        const { text, ...restAttrs } = attrs;
        const element = original.createEl.call(this, tag, restAttrs, options);
        
        if (typeof text === 'string') {
          const fragment = self.parseToFragment(text);
          element.appendChild(fragment || document.createTextNode(text));
        } else {
          element.appendChild(document.createTextNode(String(text)));
        }
        
        return element;
      }
      return original.createEl.apply(this, arguments);
    };
    
    this._patches.set(proto, original);
  }

  _patchNotice() {
    if (typeof Notice === 'undefined') return;
    
    const OriginalNotice = Notice;
    const self = this;
    
    function PatchedNotice(text, duration) {
      const instance = new OriginalNotice('', duration);
      const element = instance.noticeEl || instance.containerEl;
      
      if (element && typeof text === 'string') {
        const fragment = self.parseToFragment(text);
        element.appendChild(fragment || document.createTextNode(text));
      }
      
      return instance;
    }
    
    Object.setPrototypeOf(PatchedNotice, OriginalNotice);
    PatchedNotice.prototype = OriginalNotice.prototype;
    
    globalThis.Notice = PatchedNotice;
    this._patches.set(globalThis, { Notice: OriginalNotice });
  }

  addMap(mappings) {
    const entries = mappings instanceof Map ? mappings : Object.entries(mappings);
    
    for (const [key, value] of entries) {
      this.map.set(key, value);
    }
    
    this._sortedKeys = [...this.map.keys()].sort((a, b) => b.length - a.length);
    this._emojiRegex = new RegExp(
      `(${this._sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 
      'g'
    );
    this._iconRegex = /\[icon:([a-z0-9-]+)\]/gi;
    this._colonRegex = /:([a-z0-9-]+):/gi;
    
    return this;
  }

  getStats() {
    return {
      totalMappings: this.map.size,
      patched: this._patched,
      patchCount: this._patches.size
    };
  }
}

class Edit {
  constructor(plugin) {
    this.plugin = plugin;
    this.saving = false;
    this.config = {
      statuses: [
        { value: 'CURRENT', label: 'Current', emoji: '📺' },
        { value: 'PLANNING', label: 'Planning', emoji: '📋' },
        { value: 'COMPLETED', label: 'Completed', emoji: '✅' },
        { value: 'DROPPED', label: 'Dropped', emoji: '❌' },
        { value: 'PAUSED', label: 'On hold', emoji: '⏸️' },
        { value: 'REPEATING', label: 'Repeating', emoji: '🔄' }
      ],
      fields: {
        status: { label: 'Status', emoji: '🧿', id: 'zoro-status' },
        score: { label: 'Score', emoji: '⭐', id: 'zoro-score', min: 0, max: 10, step: 1 },
        progress: { label: 'Progress', emoji: '📊', id: 'zoro-progress' }
      },
      buttons: {
        save: { label: 'Save', class: 'zoro-save-btn' },
        remove: { label: '️Remove', class: 'zoro-remove-btn' },
        favorite: { class: 'zoro-fav-btn', hearts: { empty: '', filled: '' } },
        close: { class: 'zoro-modal-close' }
      }
    };

    this.renderer = new RenderEditModal(this.config);
    this.support = new SupportEditModal(plugin, this.renderer);
    this.anilistProvider = new AniListEditModal(plugin);
    this.malProvider = new MALEditModal(plugin);
    this.simklProvider = new SimklEditModal(plugin);
    this.providers = {
      'anilist': this.anilistProvider,
      'mal': this.malProvider,
'simkl': this.simklProvider
    };
  }

  createEditModal(entry, onSave, onCancel, source = 'anilist') {

  const actualSource = entry._zoroMeta?.source || source;
  const provider = this.providers[actualSource];
  
  const modal = this.renderer.createModalStructure();
  const { overlay, content, form } = modal;
  
  const title = this.renderer.createTitle(entry);
  const closeBtn = this.renderer.createCloseButton(() => this.support.closeModal(modal.container, onCancel));
  const favoriteBtn = this.renderer.createFavoriteButton(entry, actualSource, (entry, btn, src) => this.toggleFavorite(entry, btn, src));
  const formFields = this.renderer.createFormFields(entry, actualSource); // Pass actualSource here
  const quickButtons = this.renderer.createQuickProgressButtons(entry, formFields.progress.input, formFields.status.input);
  const actionButtons = this.renderer.createActionButtons(entry, () => this.handleRemove(entry, modal.container, actualSource), this.config, actualSource);
  
  this.support.setupModalInteractions(modal, overlay, onCancel);
  this.support.setupFormSubmission(form, () => this.handleSave(entry, onSave, actionButtons.save, formFields, modal, actualSource));
  this.support.setupEscapeListener(onCancel, modal, () => {
    this.handleSave(entry, onSave, actionButtons.save, formFields, modal, actualSource);
  });
  
  this.renderer.assembleModal(content, form, {
    title,
    closeBtn,
    favoriteBtn,
    formFields,
    quickButtons,
    actionButtons
  });
  
  document.body.appendChild(modal.container);
  
  if (provider.supportsFeature('favorites')) {
    this.initializeFavoriteButton(entry, favoriteBtn, actualSource);
  } else {
    favoriteBtn.style.display = 'none';
  }
  
  return modal;
}

  async initializeFavoriteButton(entry, favBtn, source) {
    const provider = this.providers[source];
    await provider.initializeFavoriteButton(entry, favBtn);
  }

  async toggleFavorite(entry, favBtn, source) {
    const provider = this.providers[source];
    await provider.toggleFavorite(entry, favBtn);
  }

  async handleSave(entry, onSave, saveBtn, formFields, modal, source) {
    if (this.saving) return;
    this.saving = true;
    this.support.setSavingState(saveBtn);
    
    const form = modal.form;
    
    try {
      const updates = this.support.extractFormData(formFields);
      const provider = this.providers[source];
      
      await provider.updateEntry(entry, updates, onSave);
      
      provider.invalidateCache(entry);
      this.support.refreshUI(entry);
      this.support.closeModal(modal.container, () => {});
      
      new Notice('✅ Saved');
    } catch (err) {
      this.support.showModalError(form, `Save failed: ${err.message}`);
      this.support.resetSaveButton(saveBtn);
      this.saving = false;
      return;
    }
    
    this.support.resetSaveButton(saveBtn);
    this.saving = false;
  }

  async handleRemove(entry, modalElement, source) {
    if (!confirm('Remove this entry?')) return;
    
    const removeBtn = modalElement.querySelector('.zoro-remove-btn');
    this.support.setRemovingState(removeBtn);
    
    try {
      const provider = this.providers[source];
      
      if (!provider.supportsFeature('remove')) {
        throw new Error(`${source.toUpperCase()} does not support removing entries via API`);
      }
      
      await provider.removeEntry(entry);
      
      provider.invalidateCache(entry);
      this.support.refreshUI(entry);
      this.support.closeModal(modalElement, () => {});
      
      new Notice('✅ Removed');
    } catch (e) {
      this.support.showModalError(modalElement.querySelector('.zoro-edit-form'), `Remove failed: ${e.message}`);
      this.support.resetRemoveButton(removeBtn);
    }
  }

  closeModal(modalElement, onCancel) {
    this.support.closeModal(modalElement, onCancel);
  }
}
class RenderEditModal {
  constructor(config) {
    this.config = config;
  }

  createModalStructure() {
    const container = document.createElement('div');
    container.className = 'zoro-edit-modal';
    
    const overlay = document.createElement('div');
    overlay.className = 'zoro-modal-overlay';
    
    const content = document.createElement('div');
    content.className = 'zoro-modal-content';
    
    const form = document.createElement('form');
    form.className = 'zoro-edit-form';
    
    content.appendChild(form);
    container.append(overlay, content);
    
    return { container, overlay, content, form };
  }
  
  createTitle(entry) {
    const title = document.createElement('h3');
    title.className = 'zoro-modal-title';
    title.textContent = entry.media.title.english || entry.media.title.romaji;
    return title;
  }
  
  createCloseButton(onClick) {
    const btn = document.createElement('button');
    btn.className = 'panel-close-btn';
    btn.innerHTML = '×';
    btn.title = 'Close';
    btn.onclick = onClick;
    return btn;
  }

  createFavoriteButton(entry, source, onToggle) {
    const favBtn = document.createElement('button');
    favBtn.className = this.config.buttons.favorite.class;
    favBtn.type = 'button';
    favBtn.title = 'Toggle Favorite';
    
    if (source === 'mal') {
      favBtn.style.display = 'none';
      return favBtn;
    }
    
    favBtn.className = entry.media.isFavourite ? 
      'zoro-fav-btn zoro-heart' : 
      'zoro-fav-btn zoro-no-heart';
    
    favBtn.onclick = () => onToggle(entry, favBtn, source);
    return favBtn;
  }
  
  createFormFields(entry, source = 'anilist') {
    const statusField = this.createStatusField(entry, source);
    const scoreField = this.createScoreField(entry);
    const progressField = this.createProgressField(entry);
    
    return {
      status: statusField,
      score: scoreField,
      progress: progressField
    };
  }
  
  createFormField({ type, label, emoji, id, value, options = {}, className = '' }) {
    const group = document.createElement('div');
    group.className = `zoro-form-group zoro-${type}-group ${className}`.trim();

    const labelEl = document.createElement('label');
    labelEl.className = `zoro-form-label zoro-${type}-label`;
    labelEl.textContent = `${emoji} ${label}`;
    labelEl.setAttribute('for', id);

    let input;
    
    if (type === 'select') {
      input = this.createSelectInput(id, value, options);
    } else if (type === 'number') {
      input = this.createNumberInput(id, value, options);
    } else {
      input = this.createTextInput(id, value, options);
    }

    group.appendChild(labelEl);
    group.appendChild(input);
    return { group, input, label: labelEl };
  }

  createSelectInput(id, selectedValue, { items = [] }) {
    const select = document.createElement('select');
    select.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-select`;
    select.id = id;

    items.forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      if (item.value === selectedValue) option.selected = true;
      select.appendChild(option);
    });

    return select;
  }

  createNumberInput(id, value, { min, max, step, placeholder }) {
    const input = document.createElement('input');
    input.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-input`;
    input.type = 'number';
    input.id = id;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (step !== undefined) input.step = step;
    input.value = value ?? '';
    if (placeholder) input.placeholder = placeholder;
    return input;
  }
  
  createTextInput(id, value, { placeholder }) {
    const input = document.createElement('input');
    input.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-input`;
    input.type = 'text';
    input.id = id;
    input.value = value ?? '';
    if (placeholder) input.placeholder = placeholder;
    return input;
  }
  
  createStatusField(entry, source = 'anilist') {
    const config = this.config.fields.status;
    
    // Filter out REPEATING status for MAL since it doesn't support it
    let availableStatuses = this.config.statuses;
    if (source === 'mal','simkl') {
      availableStatuses = this.config.statuses.filter(status => status.value !== 'REPEATING');
    }
    
    
    
    return this.createFormField({
      type: 'select',
      label: config.label,
      emoji: config.emoji,
      id: config.id,
      value: entry.status,
      options: { items: availableStatuses }
    });
  }

  createScoreField(entry) {
    const config = this.config.fields.score;
    return this.createFormField({
      type: 'number',
      label: `${config.label} (${config.min}–${config.max})`,
      emoji: config.emoji,
      id: config.id,
      value: entry.score,
      options: {
        min: config.min,
        max: config.max,
        step: config.step,
        placeholder: `e.g. ${config.max/2 + config.max/5}` 
      }
    });
  }

  createProgressField(entry) {
    const config = this.config.fields.progress;
    const maxProgress = entry.media.episodes || entry.media.chapters || 999;
    
    return this.createFormField({
      type: 'number',
      label: config.label,
      emoji: config.emoji,
      id: config.id,
      value: entry.progress || 0,
      options: {
        min: 0,
        max: maxProgress,
        placeholder: 'Progress'
      }
    });
  }

  createQuickProgressButtons(entry, progressInput, statusSelect) {
    const container = document.createElement('div');
    container.className = 'zoro-quick-progress-buttons';

    const plusBtn = this.createQuickButton('+1', 'zoro-plus-btn', () => {
      const current = parseInt(progressInput.value) || 0;
      const max = progressInput.max;
      if (current < max) progressInput.value = current + 1;
    });

    const minusBtn = this.createQuickButton('-1', 'zoro-minus-btn', () => {
      const current = parseInt(progressInput.value) || 0;
      if (current > 0) progressInput.value = current - 1;
    });

    const completeBtn = this.createQuickButton('Complete', 'zoro-complete-btn', () => {
      progressInput.value = entry.media.episodes || entry.media.chapters || 1;
      statusSelect.value = 'COMPLETED';
    });

    container.append(plusBtn, minusBtn, completeBtn);
    return { container, plus: plusBtn, minus: minusBtn, complete: completeBtn };
  }
  
  createQuickButton(label, className, onClick) {
    const button = document.createElement('button');
    button.className = `zoro-quick-btn ${className}`;
    button.type = 'button';
    button.textContent = label;
    button.onclick = onClick;
    return button;
  }

  createActionButtons(entry, onRemove, config, source = 'anilist') {
    const container = document.createElement('div');
    container.className = 'zoro-modal-buttons';
    
    const removeBtn = this.createActionButton({
      label: config.buttons.remove.label,
      className: config.buttons.remove.class,
      onClick: onRemove
    });
    
    if (source === 'mal') {
      removeBtn.style.display = 'none';
    }
    
    const saveBtn = this.createActionButton({
      label: config.buttons.save.label,
      className: config.buttons.save.class,
      type: 'submit'
    });
    
    container.append(removeBtn, saveBtn);
    return { container, remove: removeBtn, save: saveBtn };
  }
  
  createActionButton({ label, className, type = 'button', onClick, disabled = false }) {
    const button = document.createElement('button');
    button.className = `zoro-modal-btn ${className}`;
    button.type = type;
    button.textContent = label;
    button.disabled = disabled;
    if (onClick) button.onclick = onClick;
    return button;
  }

  assembleModal(content, form, elements) {
    content.appendChild(elements.closeBtn);
    const favContainer = document.createElement('div');
    favContainer.className = 'zoro-fav-container';
    favContainer.appendChild(elements.favoriteBtn);

    form.append(
      elements.title,
      elements.favoriteBtn,
      elements.formFields.status.group,
      elements.formFields.score.group,
      elements.formFields.progress.group,
      elements.quickButtons.container,
      elements.actionButtons.container
    );
  }
}
class AniListEditModal {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async initializeFavoriteButton(entry, favBtn) {
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
      const res = await this.plugin.requestQueue.add(() =>
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
      const mediaData = res.json.data?.Media;
      const fav = mediaData?.isFavourite;
      entry.media.isFavourite = fav;
      favBtn.className = fav ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      favBtn.dataset.mediaType = mediaData?.type;
    } catch (e) {
      console.warn('Could not fetch favorite', e);
    }
  }

  async toggleFavorite(entry, favBtn) {
    favBtn.disabled = true;
    const wasAlreadyFavorited = entry.media.isFavourite;
    
    try {
      let mediaType = favBtn.dataset.mediaType;
      if (!mediaType) {
        mediaType = entry.media.type || (entry.media.episodes ? 'ANIME' : 'MANGA');
      }
      
      const isAnime = mediaType === 'ANIME';
      
      const mutation = `
        mutation ToggleFav($animeId: Int, $mangaId: Int) {
          ToggleFavourite(animeId: $animeId, mangaId: $mangaId) {
            anime { nodes { id } }
            manga { nodes { id } }
          }
        }`;
        
      const variables = {};
      if (isAnime) {
        variables.animeId = entry.media.id;
      } else {
        variables.mangaId = entry.media.id;
      }

      const res = await this.plugin.requestQueue.add(() =>
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
      
      if (res.json.errors) {
        new Notice(`API Error: ${res.json.errors[0].message}`, 8000);
        throw new Error(res.json.errors[0].message);
      }
      
      const isFav = !wasAlreadyFavorited;
      
      entry.media.isFavourite = isFav;
      document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-heart`)
        .forEach(h => h.style.display = entry.media.isFavourite ? '' : 'none');
      
      this.invalidateCache(entry);
      this.updateAllFavoriteButtons(entry);
      
      favBtn.className = isFav ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      new Notice(`${isFav ? 'Added to' : 'Removed from'} favorites!`, 3000);
      
    } catch (e) {
      new Notice(`❌ Error: ${e.message || 'Unknown error'}`, 8000);
    } finally {
      favBtn.disabled = false;
    }
  }

  async updateEntry(entry, updates, onSave) {
    await onSave(updates);
    Object.assign(entry, updates);
    return entry;
  }

  async removeEntry(entry) {
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

  invalidateCache(entry) {
    this.plugin.cache.invalidateByMedia(String(entry.media.id));
  }

  updateAllFavoriteButtons(entry) {
    document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-fav-btn`)
      .forEach(btn => {
        btn.className = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      });
  }

  supportsFeature(feature) {
    return ['favorites', 'remove', 'update'].includes(feature);
  }
}
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
    const mediaId = entry.media?.id || entry.mediaId;
    if (!mediaId) throw new Error('Media ID not found');

    await this.plugin.simklApi.updateMediaListEntry(mediaId, updates);
    await onSave(updates);
    Object.assign(entry, updates);
    return entry;
  }

  async removeEntry(entry) {
    const mediaId = entry.media?.id || entry.mediaId;
    if (!mediaId) throw new Error('Media ID not found');

    await this.plugin.simklApi.removeMediaListEntry(mediaId);
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
class SupportEditModal {
  constructor(plugin, renderer) {
    this.plugin = plugin;
    this.renderer = renderer;
  }

  validateScore(scoreValue) {
    const scoreVal = parseFloat(scoreValue);
    if (scoreValue && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
      return { valid: false, error: "Score must be between 0 and 10" };
    }
    return { valid: true, value: scoreValue === '' ? null : scoreVal };
  }

  extractFormData(formFields) {
    const scoreValidation = this.validateScore(formFields.score.input.value);
    if (!scoreValidation.valid) {
      throw new Error(scoreValidation.error);
    }

    return {
      status: formFields.status.input.value,
      score: scoreValidation.value,
      progress: parseInt(formFields.progress.input.value) || 0
    };
  }

  setupModalInteractions(modal, overlay, onCancel) {
    overlay.onclick = () => this.closeModal(modal.container, onCancel);
  }

  setupFormSubmission(form, handleSaveFunction) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      await handleSaveFunction();
    };
  }

  setupEscapeListener(onCancel, modal, saveFunction) {
    const escListener = (e) => {
      if (e.key === 'Escape') {
        this.closeModal(modal.container, onCancel);
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        saveFunction();
      }
    };
    
    this.plugin.addGlobalListener(document, 'keydown', escListener);
    modal._escListener = escListener;
  }

  closeModal(modalElement, onCancel) {
    if (modalElement && modalElement.parentNode) {
      modalElement.parentNode.removeChild(modalElement);
    }
    if (modalElement._escListener) {
      document.removeEventListener('keydown', modalElement._escListener);
    }
    this.plugin.removeAllGlobalListeners();
    onCancel();
  }

  showModalError(form, msg) {
    form.querySelector('.zoro-modal-error')?.remove();
    const banner = document.createElement('div');
    banner.className = 'zoro-modal-error';
    banner.textContent = msg;
    form.appendChild(banner);
  }

  resetSaveButton(saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }

  setSavingState(saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  setRemovingState(removeBtn) {
    removeBtn.disabled = true;
    removeBtn.innerHTML = `
<div class="sharingan-glow">
  <div class="tomoe-container">
    <span class="tomoe"></span>
    <span class="tomoe"></span>
    <span class="tomoe"></span>
  </div>
</div>
`;
  }

  resetRemoveButton(removeBtn) {
    removeBtn.disabled = false;
    removeBtn.textContent = '🗑️';
  }

  detectSource(entry) {
    if (this.plugin.currentApi === 'mal' || entry.source === 'mal') {
      return 'mal';
    }
    return 'anilist';
  }

  refreshUI(entry) {
    const card = document.querySelector(`.zoro-container [data-media-id="${entry.media.id}"]`);
    if (card) {
      const statusBadge = card.querySelector('.clickable-status');
      if (statusBadge) {
        statusBadge.textContent = entry.status;
        statusBadge.className = `status-badge status-${entry.status.toLowerCase()} clickable-status`;
      }
      const scoreEl = card.querySelector('.score');
      if (scoreEl) scoreEl.textContent = entry.score != null ? `★ ${entry.score}` : '';
      
      const progressEl = card.querySelector('.progress');
      if (progressEl) {
        const total = entry.media.episodes || entry.media.chapters || '?';
        progressEl.textContent = `${entry.progress}/${total}`;
      }
    } else {
      const container = Array.from(document.querySelectorAll('.zoro-container'))
                              .find(c => c.querySelector(`[data-media-id="${entry.media.id}"]`));
      if (container) {
        const block = container.closest('.markdown-rendered')?.querySelector('code');
        if (block) {
          container.innerHTML = '';
          container.appendChild(this.plugin.render.createListSkeleton(1));
          this.plugin.processZoroCodeBlock(block.textContent, container, {});
        }
      }
    }
  }
}
class ConnectedNotes {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.currentMedia = null; // Store current media for filename generation
    this.currentUrls = null; // Store current URLs as array for matching
    this.currentSource = null; // Store current source for code block generation
    this.currentMediaType = null; // Store current media type for code block generation
  }

 /**
 * Extract search IDs from media entry based on API source
 */
extractSearchIds(media, entry, source) {
  const ids = {};
  
  // mal_id is STANDARD for all anime/manga regardless of source
  if (source === 'mal') {
    ids.mal_id = media.id;
  } else if (source === 'anilist') {
    // Primary: use idMal if available, Fallback: use anilist id
    if (media.idMal) {
      ids.mal_id = media.idMal;
    }
    // Always add anilist_id as backup
    ids.anilist_id = media.id;
  } else if (source === 'simkl') {
    ids.simkl_id = media.id;
    
    // Get media type for SIMKL backup strategy
    const mediaType = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectMediaType(entry, {}, media) : 
      (entry?._zoroMeta?.mediaType || 'ANIME');
    
    // For ANIME: use MAL as standard backup (like AniList)
    if (mediaType === 'ANIME' && media.idMal) {
      ids.mal_id = media.idMal;
    }
    
    // For Movies/TV/other media types: use IMDB as backup
    if (mediaType !== 'ANIME' && media.idImdb) {
      ids.imdb_id = media.idImdb;
    }
  }
  
  return ids;
}

/**
 * Build URLs array for current media to match against
 */
buildCurrentUrls(media, mediaType, source) {
  const urls = [];
  
  // Build source-specific URL first
  if (source === 'simkl') {
    // Build SIMKL URL
    urls.push(`https://simkl.com/${mediaType.toLowerCase()}/${media.id}`);
    
    // For ANIME: Add MAL URL as backup
    if (mediaType === 'ANIME' && media.idMal) {
      urls.push(`https://myanimelist.net/${mediaType.toLowerCase()}/${media.idMal}`);
    }
    
    // For Movies/TV/other: Add IMDB URL as backup
    if (mediaType !== 'ANIME' && media.idImdb) {
      urls.push(`https://www.imdb.com/title/${media.idImdb}/`);
    }
    
  } else {
    // Build MAL URL if MAL ID exists
    if (media.idMal) {
      urls.push(`https://myanimelist.net/${mediaType.toLowerCase()}/${media.idMal}`);
    }
    
    // Build AniList URL for non-SIMKL sources
    if (source !== 'simkl') {
      urls.push(`https://anilist.co/${mediaType.toLowerCase()}/${media.id}`);
    }
  }
  
  return urls;
}
  /**
   * Check if any URL in the array matches the current media URLs
   */
  hasMatchingUrl(frontmatterUrls, currentUrls) {
    if (!frontmatterUrls || !currentUrls) return false;
    
    // Ensure frontmatterUrls is an array
    const urlArray = Array.isArray(frontmatterUrls) ? frontmatterUrls : [frontmatterUrls];
    
    // Check if any URL in frontmatter matches any current URL
    return urlArray.some(url => currentUrls.includes(url));
  }

  /**
   * Search vault for notes with matching properties
   */
  async searchConnectedNotes(searchIds, mediaType) {
    const connectedNotes = [];
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      const metadata = this.app.metadataCache.getFileCache(file);
      const frontmatter = metadata?.frontmatter;
      
      if (!frontmatter) continue;

      let hasMatchingId = false;

      // Priority 1: Check MAL ID + media type
      if (searchIds.mal_id && frontmatter.mal_id == searchIds.mal_id && frontmatter.media_type === mediaType) {
        hasMatchingId = true;
      }
      
      // Priority 2: Check AniList ID + media type (if MAL didn't match)
      if (!hasMatchingId && searchIds.anilist_id && frontmatter.anilist_id == searchIds.anilist_id && frontmatter.media_type === mediaType) {
        hasMatchingId = true;
      }
      
      // Priority 3: Check other IDs + media type (if still no match)
      if (!hasMatchingId) {
        for (const [idType, idValue] of Object.entries(searchIds)) {
          if (idType !== 'mal_id' && idType !== 'anilist_id' && frontmatter[idType] == idValue && frontmatter.media_type === mediaType) {
            hasMatchingId = true;
            break;
          }
        }
      }

      // Priority 4: Check URL array matching (fallback option)
      if (!hasMatchingId && this.currentUrls) {
        if (this.hasMatchingUrl(frontmatter.url, this.currentUrls)) {
          hasMatchingId = true;
        }
      }

      // Also check for #Zoro tag
      const hasZoroTag = metadata?.tags?.some(tag => tag.tag === '#Zoro') || false;
      
      if (hasMatchingId || hasZoroTag) {
        connectedNotes.push({
          file: file,
          title: file.basename,
          path: file.path,
          frontmatter: frontmatter,
          hasMatchingId: hasMatchingId,
          hasZoroTag: hasZoroTag
        });
      }
    }

    return connectedNotes;
  }

  /**
   * Search vault for existing notes to connect (excludes already connected ones)
   */
  async findNotesToConnect(searchQuery, searchIds, mediaType) {
    const allFiles = this.app.vault.getMarkdownFiles();
    const searchResults = [];
    
    if (!searchQuery || searchQuery.trim().length < 2) {
      return searchResults;
    }
    
    const query = searchQuery.toLowerCase().trim();
    
    for (const file of allFiles) {
      // Skip files that already have matching IDs or URLs
      const metadata = this.app.metadataCache.getFileCache(file);
      const frontmatter = metadata?.frontmatter;
      
      if (frontmatter) {
        let alreadyConnected = false;
        
        // Check ID matching
        for (const [idType, idValue] of Object.entries(searchIds)) {
          if (frontmatter[idType] == idValue && frontmatter.media_type === mediaType) {
            alreadyConnected = true;
            break;
          }
        }
        
        // Check URL array matching if not already connected
        if (!alreadyConnected && this.currentUrls) {
          if (this.hasMatchingUrl(frontmatter.url, this.currentUrls)) {
            alreadyConnected = true;
          }
        }
        
        if (alreadyConnected) continue;
      }
      
      // Search in filename
      if (file.basename.toLowerCase().includes(query)) {
        searchResults.push({
          file: file,
          title: file.basename,
          path: file.path,
          matchType: 'title'
        });
        continue;
      }
      
      // Search in content (first 500 chars for performance)
      try {
        const content = await this.app.vault.cachedRead(file);
        const contentPreview = content.slice(0, 500).toLowerCase();
        if (contentPreview.includes(query)) {
          searchResults.push({
            file: file,
            title: file.basename,
            path: file.path,
            matchType: 'content'
          });
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }
    
    // Sort by relevance (title matches first, then alphabetically)
    return searchResults.sort((a, b) => {
      if (a.matchType !== b.matchType) {
        return a.matchType === 'title' ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    }).slice(0, 20); // Limit to 20 results for performance
  }

  /**
   * Merge URL arrays, avoiding duplicates
   */
  mergeUrlArrays(existingUrls, newUrls) {
    if (!newUrls || newUrls.length === 0) {
      return existingUrls || [];
    }
    
    if (!existingUrls) {
      return [...newUrls];
    }
    
    // Ensure existing is an array
    const existingArray = Array.isArray(existingUrls) ? existingUrls : [existingUrls];
    
    // Create new array with existing URLs plus new ones (no duplicates)
    const mergedUrls = [...existingArray];
    
    newUrls.forEach(url => {
      if (!mergedUrls.includes(url)) {
        mergedUrls.push(url);
      }
    });
    
    return mergedUrls;
  }

  /**
   * Generate code block content based on current media entry
   */
  generateCodeBlockContent() {
    if (!this.plugin.settings.insertCodeBlockOnNote) {
    return ''; // Return empty if setting is disabled
  }
    if (!this.currentMedia || !this.currentSource || !this.currentMediaType) {
      return ''; // Return empty if missing required data
    }

    const codeBlockLines = [
      '```zoro',
      'type: single',
      `source: ${this.currentSource}`,
      `mediaType: ${this.currentMediaType}`,
      `mediaId: ${this.currentMedia.id}`,
      '```'
    ];

    return codeBlockLines.join('\n');
  }

  /**
   * Add metadata to existing note
   */
   async connectExistingNote(file, searchIds, mediaType) {
  try {
    const content = await this.app.vault.read(file);
    const metadata = this.app.metadataCache.getFileCache(file);
    const existingFrontmatter = metadata?.frontmatter || {};
    
    // Parse existing frontmatter
    let frontmatterEnd = 0;
    let bodyContent = content;
    
    if (content.startsWith('---\n')) {
      const secondDelimiter = content.indexOf('\n---\n', 4);
      if (secondDelimiter !== -1) {
        frontmatterEnd = secondDelimiter + 5;
        bodyContent = content.slice(frontmatterEnd);
      }
    }
    
    // Check if note is already connected to Zoro (has Zoro tag and some metadata)
    const hasZoroTag = metadata?.tags?.some(tag => tag.tag === '#Zoro') || 
                      (Array.isArray(existingFrontmatter.tags) && existingFrontmatter.tags.includes('Zoro'));
    
    const hasExistingIds = existingFrontmatter.mal_id || 
                          existingFrontmatter.anilist_id || 
                          existingFrontmatter.simkl_id ||
                          existingFrontmatter.imdb_id ||
                          existingFrontmatter.media_type ||
                          existingFrontmatter.url;
    
    const isAlreadyConnected = hasZoroTag && hasExistingIds;
    
    // Start with existing frontmatter
    const updatedFrontmatter = { ...existingFrontmatter };
    
    if (isAlreadyConnected) {
      // Note is already connected - only merge URLs, don't overwrite other metadata
      console.log(`[ConnectedNotes] Note "${file.basename}" is already connected, only adding URLs`);
      
      // Only merge URL arrays
      if (this.currentUrls && this.currentUrls.length > 0) {
        updatedFrontmatter.url = this.mergeUrlArrays(existingFrontmatter.url, this.currentUrls);
      }
      
      // Ensure Zoro tag is present (in case it was removed)
      if (!updatedFrontmatter.tags) {
        updatedFrontmatter.tags = ['Zoro'];
      } else if (Array.isArray(updatedFrontmatter.tags)) {
        if (!updatedFrontmatter.tags.includes('Zoro')) {
          updatedFrontmatter.tags.push('Zoro');
        }
      }
      
    } else {
      // Note is not connected yet - add full metadata
      console.log(`[ConnectedNotes] Note "${file.basename}" is not connected, adding full metadata`);
      
      // Add new search IDs
      Object.entries(searchIds).forEach(([key, value]) => {
        updatedFrontmatter[key] = value;
      });
      
      // Merge URL arrays
      if (this.currentUrls && this.currentUrls.length > 0) {
        updatedFrontmatter.url = this.mergeUrlArrays(existingFrontmatter.url, this.currentUrls);
      }
      
      // Add media type
      updatedFrontmatter.media_type = mediaType;
      
      // Add Zoro tag if not present
      if (!updatedFrontmatter.tags) {
        updatedFrontmatter.tags = ['Zoro'];
      } else if (Array.isArray(updatedFrontmatter.tags)) {
        if (!updatedFrontmatter.tags.includes('Zoro')) {
          updatedFrontmatter.tags.push('Zoro');
        }
      }
    }
    
    // Build new frontmatter
    const frontmatterLines = ['---'];
    Object.entries(updatedFrontmatter).forEach(([key, value]) => {
      if (key === 'tags' && Array.isArray(value)) {
        frontmatterLines.push('tags:');
        value.forEach(tag => {
          frontmatterLines.push(`  - ${tag}`);
        });
      } else if (key === 'url' && Array.isArray(value)) {
        frontmatterLines.push('url:');
        value.forEach(url => {
          frontmatterLines.push(`  - "${url}"`);
        });
      } else {
        frontmatterLines.push(`${key}: "${value}"`);
      }
    });
    frontmatterLines.push('---', '');
    
    // Handle code block generation
    let finalBodyContent = bodyContent;
    
    if (!isAlreadyConnected) {
      // Only add code block for new connections (not for URL-only updates)
      const codeBlockContent = this.generateCodeBlockContent();
      
      // Check if a zoro code block already exists in the body
      const zoroCodeBlockRegex = /```zoro[\s\S]*?```/;
      if (codeBlockContent && !zoroCodeBlockRegex.test(bodyContent)) {
        // Add code block after frontmatter with proper spacing
        finalBodyContent = codeBlockContent + '\n\n' + bodyContent;
      }
    }
    
    const newContent = frontmatterLines.join('\n') + finalBodyContent;
    
    // Write updated content
    await this.app.vault.modify(file, newContent);
    
    // Show appropriate success message
    if (isAlreadyConnected) {
      new Notice(`Updated URLs for: ${file.basename}`);
    } else {
      new Notice(`Connected note: ${file.basename}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('[ConnectedNotes] Error connecting existing note:', error);
    new Notice(`Failed to connect note: ${file.basename}`);
    return false;
  }
}
  /**
   * Show connected notes in a single dedicated side panel
   */
  async showConnectedNotes(searchIds, mediaType) {
    try {
      // Search for connected notes
      const connectedNotes = await this.searchConnectedNotes(searchIds, mediaType);

      // Look for existing Zoro panel first
      let zoroLeaf = null;
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view.titleEl && leaf.view.titleEl.textContent === 'Zoro') {
          zoroLeaf = leaf;
          return false; // Stop iteration
        }
      });

      // If no existing Zoro panel, create new one
      if (!zoroLeaf) {
        zoroLeaf = this.app.workspace.getRightLeaf(false);
      }

      // Render content and set title
      this.renderConnectedNotesInView(zoroLeaf.view, connectedNotes, searchIds, mediaType);
      
      // Ensure the side panel is visible
      this.app.workspace.revealLeaf(zoroLeaf);
      
    } catch (error) {
      console.error('[ConnectedNotes] Error showing connected notes:', error);
      new Notice('Failed to load connected notes');
    }
  }

  /**
   * Render the connect existing notes interface
   */
  renderConnectExistingInterface(container, searchIds, mediaType) {
    // Create search interface container
    const connectInterface = container.createEl('div', { cls: 'zoro-note-connect-interface' });
    
    // Search input
    const searchInput = connectInterface.createEl('input', { cls: 'zoro-note-search-input' });
    searchInput.type = 'text';
    searchInput.placeholder = ' Search notes to connect...';
    
    // Search results container
    const resultsContainer = connectInterface.createEl('div', { cls: 'zoro-note-search-results' });
    
    // Search functionality with debounce
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        const query = searchInput.value;
        resultsContainer.empty();
        
        if (query.trim().length >= 2) {
          const results = await this.findNotesToConnect(query, searchIds, mediaType);
          
          if (results.length === 0) {
            const noResults = resultsContainer.createEl('div', { text: 'No notes found', cls: 'zoro-note-no-results' });
          } else {
            results.forEach(result => {
              const resultItem = resultsContainer.createEl('div', { cls: 'zoro-note-search-result' });
              
              const noteTitle = resultItem.createEl('span', { text: result.title, cls: 'zoro-note-result-title' });
              
              const connectBtn = resultItem.createEl('button', { text: '➕', cls: 'zoro-note-connect-btn' });
              connectBtn.title = 'Connect this note';
              
              connectBtn.onclick = async (e) => {
                e.stopPropagation();
                const success = await this.connectExistingNote(result.file, searchIds, mediaType);
                if (success) {
                  // Refresh the connected notes panel
                  const connectedNotes = await this.searchConnectedNotes(searchIds, mediaType);
                  this.refreshConnectedNotesList(container.querySelector('.zoro-note-panel-content'), connectedNotes);
                  // Close search interface
                  connectInterface.classList.add('zoro-note-hidden');
                  searchInput.value = '';
                  resultsContainer.empty();
                }
              };
              
              // Click on item to preview
              resultItem.onclick = (e) => {
                if (e.target !== connectBtn) {
                  const mainLeaf = this.app.workspace.getLeaf('tab');
                  mainLeaf.openFile(result.file);
                }
              };
            });
          }
        }
      }, 300); // 300ms debounce
    });
    
    return connectInterface;
  }

  /**
   * Refresh the connected notes list without full re-render
   */
  refreshConnectedNotesList(mainContent, connectedNotes) {
    const notesList = mainContent.querySelector('.zoro-note-notes-list');
    const emptyState = mainContent.querySelector('.zoro-note-empty-state');
    
    if (connectedNotes.length === 0) {
      if (notesList) notesList.remove();
      if (!emptyState) {
        const newEmptyState = mainContent.createEl('div', { cls: 'zoro-note-empty-state' });
        newEmptyState.createEl('div', { text: 'No notes', cls: 'zoro-note-empty-message' });
      }
    } else {
      if (emptyState) emptyState.remove();
      if (notesList) notesList.remove();
      
      // Recreate notes list
      const newNotesList = mainContent.createEl('div', { cls: 'zoro-note-notes-list' });
      
      connectedNotes.forEach(note => {
        const noteItem = newNotesList.createEl('div', { cls: 'zoro-note-item' });
        
        // Note title
        const noteTitle = noteItem.createEl('div', { text: note.title, cls: 'zoro-note-title' });
        
        // Click handler for the entire item
        noteItem.onclick = (e) => {
          e.preventDefault();
          const mainLeaf = this.app.workspace.getLeaf('tab');
          mainLeaf.openFile(note.file);
          this.app.workspace.setActiveLeaf(mainLeaf);
        };

        // Show matching indicators
        const indicators = noteItem.createEl('div', { cls: 'zoro-note-indicators' });
        
        if (note.hasMatchingId) {
          const idIndicator = indicators.createEl('span', { text: '🔗', cls: 'zoro-note-id-indicator', title: 'Has matching ID' });
        }
        if (note.hasZoroTag) {
          const tagIndicator = indicators.createEl('span', { text: '🏷️', cls: 'zoro-note-tag-indicator', title: 'Has #Zoro tag' });
        }
      });
    }
  }

  /**
   * Render connected notes in the dedicated Zoro view
   */
  renderConnectedNotesInView(view, connectedNotes, searchIds, mediaType) {
    const container = view.containerEl;
    container.empty();
    container.className = 'zoro-note-container';

    // Set multiple title properties to ensure "Zoro" appears everywhere
    if (view.titleEl) {
      view.titleEl.setText('Zoro');
    }
    
    // Set the view's display name
    if (view.getDisplayText) {
      view.getDisplayText = () => 'Zoro';
    } else {
      view.getDisplayText = () => 'Zoro';
    }
    
    // Set view type if available
    if (view.getViewType) {
      view.getViewType = () => 'zoro-panel';
    } else {
      view.getViewType = () => 'zoro-panel';
    }
    
    // Force update the leaf's tab header
    if (view.leaf) {
      const leaf = view.leaf;
      setTimeout(() => {
        if (leaf.tabHeaderEl) {
          const titleEl = leaf.tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
          if (titleEl) {
            titleEl.textContent = 'Zoro';
          }
        }
        leaf.updateHeader();
      }, 10);
    }

    // Connect existing notes interface (initially hidden)
    const connectInterface = this.renderConnectExistingInterface(container, searchIds, mediaType);
    connectInterface.classList.add('zoro-note-hidden'); // Initially hidden

    // Main content area
    const mainContent = container.createEl('div', { cls: 'zoro-note-panel-content' });

    // Notes list or empty state
    if (connectedNotes.length === 0) {
      const emptyState = mainContent.createEl('div', { cls: 'zoro-note-empty-state' });
      emptyState.createEl('div', { text: 'No notes', cls: 'zoro-note-empty-message' });
    } else {
      // Notes list
      const notesList = mainContent.createEl('div', { cls: 'zoro-note-notes-list' });
      
      connectedNotes.forEach(note => {
        const noteItem = notesList.createEl('div', { cls: 'zoro-note-item' });
        
        // Note title
        const noteTitle = noteItem.createEl('div', { text: note.title, cls: 'zoro-note-title' });
        
        // Click handler for the entire item
        noteItem.onclick = (e) => {
          e.preventDefault();
          const mainLeaf = this.app.workspace.getLeaf('tab');
          mainLeaf.openFile(note.file);
          this.app.workspace.setActiveLeaf(mainLeaf);
        };

        // Show matching indicators
        const indicators = noteItem.createEl('div', { cls: 'zoro-note-indicators' });
        
        if (note.hasMatchingId) {
          const idIndicator = indicators.createEl('span', { text: '🔗', cls: 'zoro-note-id-indicator', title: 'Has matching ID' });
        }
        if (note.hasZoroTag) {
          const tagIndicator = indicators.createEl('span', { text: '🏷️', cls: 'zoro-note-tag-indicator', title: 'Has #Zoro tag' });
        }
      });
    }

    // Footer section at bottom
    const footer = container.createEl('div', { cls: 'zoro-note-panel-footer' });
    
    const createButton = footer.createEl('button', { text: '📝', cls: 'zoro-note-create-btn' });
    createButton.onclick = () => this.createNewConnectedNote(searchIds, mediaType);
    
    // New connect existing button
    const connectButton = footer.createEl('button', { text: '⛓️', cls: 'zoro-note-connect-existing-btn' });
    
    connectButton.onclick = () => {
      connectInterface.classList.toggle('zoro-note-hidden');
      
      if (!connectInterface.classList.contains('zoro-note-hidden')) {
        // Focus on search input when opened
        const searchInput = connectInterface.querySelector('.zoro-note-search-input');
        setTimeout(() => searchInput.focus(), 100);
      } else {
        // Clear search when closed
        const searchInput = connectInterface.querySelector('.zoro-note-search-input');
        const resultsContainer = connectInterface.querySelector('.zoro-note-search-results');
        searchInput.value = '';
        resultsContainer.empty();
      }
    };
  }

  /**
   * Extract media title for filename (prefers English, falls back to romaji)
   */
  getMediaTitleForFilename() {
    if (!this.currentMedia) {
      return 'Untitled'; // Fallback if no media stored
    }
    
    // Prefer English title, fall back to romaji, then native, then 'Untitled'
    const title = this.currentMedia.title?.english || 
                  this.currentMedia.title?.romaji || 
                  this.currentMedia.title?.native || 
                  'Untitled';
    
    // Clean the title for filename (remove invalid characters)
    return title.replace(/[<>:"/\\|?*]/g, '').trim();
  }

  /**
   * Get the configured note path from settings
   */
  getConfiguredNotePath() {
    // Get the note path from plugin settings
    const notePath = this.plugin.settings?.notePath || '';
    
    // Ensure path ends with '/' if it's not empty
    if (notePath && !notePath.endsWith('/')) {
      return notePath + '/';
    }
    
    return notePath;
  }

  /**
   * Generate unique filename with path like Obsidian does (Title, Title 1, Title 2, etc.)
   */
  generateUniqueFilename(baseName = null) {
    // Use media title if available, otherwise fallback to 'Untitled'
    const preferredBaseName = baseName || this.getMediaTitleForFilename();
    
    // Get configured path
    const notePath = this.getConfiguredNotePath();
    
    // Generate full path with filename
    const baseFileName = `${notePath}${preferredBaseName}.md`;
    
    // Check if base filename exists
    if (!this.app.vault.getAbstractFileByPath(baseFileName)) {
      return baseFileName;
    }
    
    // Generate numbered variants until we find one that doesn't exist
    let counter = 1;
    let uniqueFileName;
    do {
      uniqueFileName = `${notePath}${preferredBaseName} ${counter}.md`;
      counter++;
    } while (this.app.vault.getAbstractFileByPath(uniqueFileName));
    
    return uniqueFileName;
  }

  /**
   * Ensure the configured path exists in the vault
   */
  async ensurePathExists(filePath) {
    // Extract directory path from file path
    const pathParts = filePath.split('/');
    pathParts.pop(); // Remove filename
    const dirPath = pathParts.join('/');
    
    if (!dirPath) return; // No directory to create
    
    // Check if directory exists and create if it doesn't
    const abstractFile = this.app.vault.getAbstractFileByPath(dirPath);
    if (!abstractFile) {
      try {
        await this.app.vault.createFolder(dirPath);
      } catch (error) {
        // Folder might already exist, or there might be another issue
        console.warn('[ConnectedNotes] Could not create folder:', dirPath, error);
      }
    }
  }

  /**
   * Create a new note with unique filename and add metadata
   */
  async createNewConnectedNote(searchIds, mediaType) {
    try {
      // Generate unique filename using media title with configured path
      const uniqueFileName = this.generateUniqueFilename();
      
      // Ensure the directory path exists
      await this.ensurePathExists(uniqueFileName);
      
      // Create frontmatter content
      const frontmatterLines = [
        '---',
        ...Object.entries(searchIds).map(([key, value]) => `${key}: "${value}"`),
        `media_type: "${mediaType}"`,
      ];
      
      // Add URL array to frontmatter
      if (this.currentUrls && this.currentUrls.length > 0) {
        frontmatterLines.push('url:');
        this.currentUrls.forEach(url => {
          frontmatterLines.push(`  - "${url}"`);
        });
      }
      
      frontmatterLines.push('tags:', '  - Zoro', '---', '');
      
      const frontmatter = frontmatterLines.join('\n');

      // Generate code block content
      const codeBlockContent = this.generateCodeBlockContent();
      
      // Combine frontmatter with code block and additional spacing
      let noteContent = frontmatter;
      if (codeBlockContent) {
        noteContent += codeBlockContent + '\n\n';
      }

      // Create the file with unique name, frontmatter, and code block
      const file = await this.app.vault.create(uniqueFileName, noteContent);
      
      // Open in main workspace
      const mainLeaf = this.app.workspace.getLeaf('tab');
      await mainLeaf.openFile(file);
      this.app.workspace.setActiveLeaf(mainLeaf);
      
      new Notice('Created new connected note!');
      
    } catch (error) {
      console.error('[ConnectedNotes] Error creating new note:', error);
      new Notice('Failed to create new note');
    }
  }

  /**
   * Create the connected notes button for media cards
   */
  createConnectedNotesButton(media, entry, config) {
    const notesBtn = document.createElement('span');
    notesBtn.className = 'zoro-note-obsidian';
    notesBtn.textContent = 'Obsidian'; // Placeholder - CSS will handle actual styling
    notesBtn.title = 'View connected notes';
    
    notesBtn.onclick = (e) => this.handleConnectedNotesClick(e, media, entry, config);
    
    return notesBtn;
  }
  /**
 * Handle connected notes button click
 */
async handleConnectedNotesClick(e, media, entry, config) {
  e.preventDefault();
  e.stopPropagation();
  
  try {
    // Extract source and media type
    const source = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectSource(entry, config) : 
      (entry?._zoroMeta?.source || config?.source || 'anilist');
    
    const mediaType = this.plugin.apiHelper ? 
      this.plugin.apiHelper.detectMediaType(entry, config, media) : 
      (entry?._zoroMeta?.mediaType || config?.mediaType || 'ANIME');
    
    // Store current media for filename generation (PREFER ENGLISH TITLE)
    this.currentMedia = media;
    
    // Store current source and media type for code block generation
    this.currentSource = source;
    this.currentMediaType = mediaType;
    
    // Build URLs array for current media (NOW PASSES SOURCE)
    this.currentUrls = this.buildCurrentUrls(media, mediaType, source);
    
    // Extract search IDs
    const searchIds = this.extractSearchIds(media, entry, source);
    
    // Show connected notes
    await this.showConnectedNotes(searchIds, mediaType);
    
  } catch (error) {
    console.error('[ConnectedNotes] Button click error:', error);
    new Notice('Failed to open connected notes');
  }
}
}

class DetailPanelSource {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async convertMalToAnilistId(malId, malType) {
    const cacheKey = this.plugin.cache.structuredKey('conversion', 'mal_to_anilist', `${malId}_${malType || 'unknown'}`);
    const cached = this.plugin.cache.get(cacheKey, { scope: 'mediaData', source: 'anilist' });
    if (cached) return cached;

    const anilistType = this.convertMalTypeToAnilistType(malType);
    let result = null;
    if (!anilistType) {
      for (const tryType of ['ANIME', 'MANGA']) {
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

  async tryConvertWithType(malId, anilistType) {
    const query = `query($idMal: Int, $type: MediaType) { Media(idMal: $idMal, type: $type) { id type } }`;
    const variables = { idMal: malId, type: anilistType };

    try {
      let response;
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
      const anilistId = response?.data?.Media?.id;
      const anilistTypeResult = response?.data?.Media?.type;
      if (anilistId) return { id: anilistId, type: anilistTypeResult };
      return null;
    } catch {
      return null;
    }
  }

  convertMalTypeToAnilistType(malType) {
    if (!malType) return null;
    const normalizedType = malType.toString().toLowerCase();
    const typeMap = {
      'anime': 'ANIME', 'tv': 'ANIME', 'movie': 'ANIME', 'ova': 'ANIME', 'ona': 'ANIME', 'special': 'ANIME', 'music': 'ANIME',
      'manga': 'MANGA', 'manhwa': 'MANGA', 'manhua': 'MANGA', 'novel': 'MANGA', 'light_novel': 'MANGA', 'one_shot': 'MANGA'
    };
    return typeMap[normalizedType] || null;
  }

  shouldFetchDetailedData(media) {
    const missingBasicData = !media.description || !media.genres || !media.averageScore;
    const isAnimeWithoutAiring = media.type === 'ANIME' && !media.nextAiringEpisode;
    return missingBasicData || isAnimeWithoutAiring;
  }

  extractSourceFromEntry(entry) {
    return entry?._zoroMeta?.source || this.plugin.settings.defaultApiSource || 'anilist';
  }

  extractMediaTypeFromEntry(entry) {
    return entry?._zoroMeta?.mediaType || entry?.media?.type || null;
  }

  async fetchDetailedData(mediaId, entryOrSource = null, mediaType = null) {
    let source, resolvedMediaType;
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

    let targetId = mediaId;
    let originalMalId = null;

    if (source === 'mal') {
      originalMalId = mediaId;
      const conversionResult = await this.convertMalToAnilistId(mediaId, resolvedMediaType);
      if (!conversionResult || !conversionResult.id) {
        throw new Error(`Could not convert MAL ID ${mediaId} to AniList ID`);
      }
      targetId = conversionResult.id;
      this._noticeCache = this._noticeCache || { malConversion: new Set(), missingMalId: new Set() };
      if (!this._noticeCache.malConversion.has(String(mediaId))) {
        try { new Notice('Using AniList data via MAL→AniList ID conversion'); } catch {}
        this._noticeCache.malConversion.add(String(mediaId));
      }
    }

    const stableCacheKey = this.plugin.cache.structuredKey('details', 'stable', targetId);
    const dynamicCacheKey = this.plugin.cache.structuredKey('details', 'airing', targetId);

    let stableData = this.plugin.cache.get(stableCacheKey, { scope: 'mediaData', source: 'anilist' });
    let airingData = this.plugin.cache.get(dynamicCacheKey, { scope: 'mediaData', source: 'anilist' });

    if (stableData && (stableData.type !== 'ANIME' || airingData)) {
      const combinedData = { ...stableData };
      if (airingData?.nextAiringEpisode) combinedData.nextAiringEpisode = airingData.nextAiringEpisode;
      return combinedData;
    }

    const query = this.getDetailedMediaQuery();
    const variables = { id: targetId };

    let response;
    if (this.plugin.fetchAniListData) {
      response = await this.plugin.fetchAniListData(query, variables);
    } else {
      const apiResponse = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables })
      });
      response = await apiResponse.json();
    }

    if (!response?.data?.Media) throw new Error('No media data received');
    const data = response.data.Media;
    if (originalMalId) data.originalMalId = originalMalId;

    const { nextAiringEpisode, ...stableDataOnly } = data;
    this.plugin.cache.set(stableCacheKey, stableDataOnly, { scope: 'mediaData', source: 'anilist', ttl: 30 * 24 * 60 * 60 * 1000, tags: ['details', 'stable', data.type?.toLowerCase()] });
    if (data.type === 'ANIME' && nextAiringEpisode) {
      this.plugin.cache.set(dynamicCacheKey, { nextAiringEpisode }, { scope: 'mediaData', source: 'anilist', ttl: 60 * 60 * 1000, tags: ['details', 'airing', 'anime'] });
    }
    return data;
  }

  async fetchMALData(malId, mediaType) {
    if (!malId) return null;
    const cacheKey = this.plugin.cache.structuredKey('mal', 'details', `${malId}_${mediaType}`);
    const cached = this.plugin.cache.get(cacheKey, { scope: 'mediaData', source: 'mal' });
    if (cached) return cached;

    try {
      const type = mediaType === 'MANGA' ? 'manga' : 'anime';
      const response = await fetch(`https://api.jikan.moe/v4/${type}/${malId}`);
      if (!response.ok) throw new Error(`Jikan API error: ${response.status}`);
      const data = (await response.json())?.data;
      this.plugin.cache.set(cacheKey, data, { scope: 'mediaData', source: 'mal', ttl: 7 * 24 * 60 * 60 * 1000, tags: ['mal', 'details', type] });
      return data;
    } catch {
      return null;
    }
  }

  async fetchAndUpdateData(mediaId, entryOrSource = null, mediaTypeOrCallback = null, onUpdate = null) {
    let source, mediaType, callback;
    if (typeof entryOrSource === 'object' && entryOrSource !== null) {
      source = this.extractSourceFromEntry(entryOrSource);
      mediaType = this.extractMediaTypeFromEntry(entryOrSource);
      callback = mediaTypeOrCallback;
    } else if (typeof entryOrSource === 'string') {
      source = entryOrSource;
      if (typeof mediaTypeOrCallback === 'function') { mediaType = null; callback = mediaTypeOrCallback; }
      else { mediaType = mediaTypeOrCallback; callback = onUpdate; }
    } else {
      source = this.plugin.settings.defaultApiSource || 'anilist';
      mediaType = null;
      callback = mediaTypeOrCallback;
    }

    try {
      const detailedMedia = await this.fetchDetailedData(mediaId, source, mediaType);
      const malId = source === 'mal' ? (detailedMedia.originalMalId || mediaId) : detailedMedia.idMal;
      if (!malId && source !== 'mal') {
        this._noticeCache = this._noticeCache || { malConversion: new Set(), missingMalId: new Set() };
        if (!this._noticeCache.missingMalId.has(String(detailedMedia.id))) {
          try { new Notice('No MAL ID mapping found on AniList for this title'); } catch {}
          this._noticeCache.missingMalId.add(String(detailedMedia.id));
        }
      }
      let malDataPromise = null;
      if (malId) malDataPromise = this.fetchMALData(malId, detailedMedia.type);
      if (this.hasMoreData(detailedMedia)) callback(detailedMedia, null);
      if (malDataPromise) {
        const malData = await malDataPromise;
        if (malData) callback(detailedMedia, malData);
      }
    } catch (error) {
      console.error('fetchAndUpdateData failed:', error);
    }
  }

  hasMoreData(newMedia) {
    const hasBasicData = newMedia.description || newMedia.genres?.length > 0 || newMedia.averageScore > 0;
    const hasAiringData = newMedia.type === 'ANIME' && newMedia.nextAiringEpisode;
    return hasBasicData || hasAiringData;
  }

  getDetailedMediaQuery() {
    return `query($id:Int){Media(id:$id){id type title{romaji english native}description(asHtml:false)format status season seasonYear averageScore genres nextAiringEpisode{airingAt episode timeUntilAiring}idMal}}`;
  }
}

class OpenDetailPanel {
  constructor(plugin) {
    this.plugin = plugin;
    this.currentPanel = null;
    this.boundOutsideClickHandler = this.handleOutsideClick.bind(this);
    this.renderer = new RenderDetailPanel(plugin);
    this.dataSource = new DetailPanelSource(plugin);
  }

  async showPanel(media, entry = null, triggerElement) {
    this.closePanel();
    const panel = this.renderer.createPanel(media, entry);
    this.currentPanel = panel;
    this.renderer.positionPanel(panel, triggerElement);
    const closeBtn = panel.querySelector('.panel-close-btn');
    if (closeBtn) closeBtn.onclick = () => this.closePanel();
    document.body.appendChild(panel);
    document.addEventListener('click', this.boundOutsideClickHandler);
    this.plugin.requestQueue.showGlobalLoader();

    if (this.dataSource.shouldFetchDetailedData(media)) {
      this.dataSource.fetchAndUpdateData(media.id, entry, (detailedMedia, malData) => {
        if (this.currentPanel === panel) this.renderer.updatePanelContent(panel, detailedMedia, malData);
      }).finally(() => this.plugin.requestQueue.hideGlobalLoader());
    } else {
      this.plugin.requestQueue.hideGlobalLoader();
    }
    return panel;
  }

  handleOutsideClick(event) {
    if (this.currentPanel && !this.currentPanel.contains(event.target)) this.closePanel();
  }

  closePanel() {
    if (this.currentPanel) {
      this.renderer.cleanupCountdowns(this.currentPanel);
      document.removeEventListener('click', this.boundOutsideClickHandler);
      this.currentPanel.remove();
      this.currentPanel = null;
    }
  }
}

class MoreDetailsPanel {
  constructor(plugin) {
    this.plugin = plugin;
    this.openDetailPanel = new OpenDetailPanel(plugin);
  }

  async showPanel(media, entry = null, triggerElement) {
    return await this.openDetailPanel.showPanel(media, entry, triggerElement);
  }

  closePanel() {
    this.openDetailPanel.closePanel();
  }

  get currentPanel() {
    return this.openDetailPanel.currentPanel;
  }
}
class RenderDetailPanel {
  constructor(plugin) {
    this.plugin = plugin;
  }

  createPanel(media, entry) {
    const fragment = document.createDocumentFragment();
    
    const panel = document.createElement('div');
    panel.className = 'zoro-more-details-panel';

    const content = document.createElement('div');
    content.className = 'panel-content';

    const sections = [];

    sections.push(this.createHeaderSection(media));
    sections.push(this.createMetadataSection(media, entry));

    if (media.type === 'ANIME' && media.nextAiringEpisode) {
      sections.push(this.createAiringSection(media.nextAiringEpisode));
    }

    if (media.averageScore > 0) {
      sections.push(this.createStatisticsSection(media));
    }

    if (media.genres?.length > 0) {
      sections.push(this.createGenresSection(media.genres));
    }

    sections.push(this.createSynopsisSection(media.description));
    sections.push(this.createExternalLinksSection(media));

    sections.forEach(section => content.appendChild(section));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close-btn';
    closeBtn.innerHTML = '×';

    panel.appendChild(closeBtn);
    panel.appendChild(content);

    return panel;
  }

  updatePanelContent(panel, media, malData = null) {
    const content = panel.querySelector('.panel-content');
    
    if (media.type === 'ANIME' && media.nextAiringEpisode && !content.querySelector('.airing-section')) {
      const airingSection = this.createAiringSection(media.nextAiringEpisode);
      const metadataSection = content.querySelector('.metadata-section');
      if (metadataSection) {
        metadataSection.insertAdjacentElement('afterend', airingSection);
      } else {
        const headerSection = content.querySelector('.panel-header');
        if (headerSection) {
          headerSection.insertAdjacentElement('afterend', airingSection);
        }
      }
    }
    
    if (media.description) {
      const existingSynopsis = content.querySelector('.synopsis-section');
      if (existingSynopsis) {
        const newSynopsis = this.createSynopsisSection(media.description);
        content.replaceChild(newSynopsis, existingSynopsis);
      }
    }

    if (media.genres?.length > 0 && !content.querySelector('.genres-section')) {
      const genresSection = this.createGenresSection(media.genres);
      const synopsisSection = content.querySelector('.synopsis-section');
      if (synopsisSection) {
        content.insertBefore(genresSection, synopsisSection);
      } else {
        content.appendChild(genresSection);
      }
    }

    if (media.idMal) {
      const existingLinksSection = content.querySelector('.external-links-section');
      if (existingLinksSection) {
        const newLinksSection = this.createExternalLinksSection(media);
        content.replaceChild(newLinksSection, existingLinksSection);
      }
    }

    if (media.averageScore > 0 || malData) {
      const existingStats = content.querySelector('.stats-section');
      if (existingStats) {
        const newStats = this.createStatisticsSection(media, malData);
        content.replaceChild(newStats, existingStats);
      }
    }
  }

  createAiringSection(nextAiringEpisode) {
    const section = document.createElement('div');
    section.className = 'panel-section airing-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Next Airing';
    section.appendChild(title);

    const airingInfo = document.createElement('div');
    airingInfo.className = 'airing-info';

    const airingTime = new Date(nextAiringEpisode.airingAt * 1000);

    const episodeInfo = document.createElement('div');
    episodeInfo.className = 'airing-episode';
    episodeInfo.innerHTML = `<span class="airing-label">Episode:</span> <span class="airing-value">${nextAiringEpisode.episode}</span>`;
    airingInfo.appendChild(episodeInfo);

    const dateInfo = document.createElement('div');
    dateInfo.className = 'airing-date';
    dateInfo.innerHTML = `<span class="airing-label">Date:</span> <span class="airing-value">${this.formatAiringDate(airingTime)}</span>`;
    airingInfo.appendChild(dateInfo);

    const timeInfo = document.createElement('div');
    timeInfo.className = 'airing-time';
    timeInfo.innerHTML = `<span class="airing-label">Time:</span> <span class="airing-value">${this.formatAiringTimeOnly(airingTime)}</span>`;
    airingInfo.appendChild(timeInfo);

    if (nextAiringEpisode.timeUntilAiring > 0) {
      const countdownInfo = document.createElement('div');
      countdownInfo.className = 'airing-countdown';
      countdownInfo.innerHTML = `<span class="airing-label">In:</span> <span class="airing-value countdown-value">${this.formatTimeUntilAiring(nextAiringEpisode.timeUntilAiring)}</span>`;
      airingInfo.appendChild(countdownInfo);

      this.startCountdown(countdownInfo.querySelector('.countdown-value'), nextAiringEpisode.timeUntilAiring);
    }

    section.appendChild(airingInfo);
    return section;
  }

  formatAiringDate(date) {
    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    };
    return date.toLocaleDateString('en-GB', options);
  }

  formatAiringTimeOnly(date) {
    const options = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    return date.toLocaleTimeString('en-GB', options);
  }

  formatTimeUntilAiring(seconds) {
    const days = Math.floor(seconds / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  startCountdown(element, initialSeconds) {
    let remainingSeconds = initialSeconds;
    
    const updateCountdown = () => {
      if (remainingSeconds <= 0) {
        element.textContent = 'Aired!';
        return;
      }
      
      element.textContent = this.formatTimeUntilAiring(remainingSeconds);
      remainingSeconds--;
    };

    updateCountdown();
    const intervalId = setInterval(updateCountdown, 60000);
    element.dataset.intervalId = intervalId;
  }

  createSynopsisSection(description) {
    const section = document.createElement('div');
    section.className = 'panel-section synopsis-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Synopsis';
    section.appendChild(title);

    const synopsis = document.createElement('div');
    synopsis.className = 'synopsis-content';
    
    if (!description || typeof description !== 'string' || !description.trim()) {
      synopsis.className += ' synopsis-placeholder';
      synopsis.textContent = 'Synopsis not available yet.';
      section.appendChild(synopsis);
      return section;
    }
    
    const cleanDescription = description
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (!cleanDescription) {
      synopsis.className += ' synopsis-placeholder';
      synopsis.textContent = 'Synopsis is empty.';
      section.appendChild(synopsis);
      return section;
    }
    
    synopsis.textContent = cleanDescription;
    section.appendChild(synopsis);
    return section;
  }

  createMetadataSection(media, entry) {
    const section = document.createElement('div');
    section.className = 'panel-section metadata-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Details';
    section.appendChild(title);

    const metaGrid = document.createElement('div');
    metaGrid.className = 'metadata-grid';

    if (media.format) {
      this.addMetadataItem(metaGrid, 'Format', this.formatDisplayName(media.format));
    }
    if (media.status) {
      this.addMetadataItem(metaGrid, 'Status', this.formatDisplayName(media.status));
    }

    section.appendChild(metaGrid);
    return section;
  }

  createStatisticsSection(media, malData = null) {
    const section = document.createElement('div');
    section.className = 'panel-section stats-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Statistics';
    section.appendChild(title);

    const statsGrid = document.createElement('div');
    statsGrid.className = 'stats-grid';

    if (media.averageScore > 0) {
      const scoreOutOf10 = (media.averageScore / 10).toFixed(1);
      this.addStatItem(statsGrid, 'AniList Score', `${scoreOutOf10}`, 'score-stat anilist-stat');
    }

    if (malData) {
      if (malData.score) {
        this.addStatItem(statsGrid, 'MAL Score', `${malData.score}`, 'score-stat mal-stat');
      }
      
      if (malData.scored_by) {
        this.addStatItem(statsGrid, 'MAL Ratings', malData.scored_by.toLocaleString(), 'count-stat');
      }
      
      if (malData.rank) {
        this.addStatItem(statsGrid, 'MAL Rank', `#${malData.rank}`, 'rank-stat');
      }
    }

    section.appendChild(statsGrid);
    return section;
  }

  addMetadataItem(container, label, value) {
    const item = document.createElement('div');
    item.className = 'metadata-item';
    item.innerHTML = `<span class="metadata-label">${label}</span><span class="metadata-value">${value}</span>`;
    container.appendChild(item);
  }

  addStatItem(container, label, value, className = '') {
    const item = document.createElement('div');
    item.className = `stat-item ${className}`;
    item.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>`;
    container.appendChild(item);
  }

  createHeaderSection(media) {
    const header = document.createElement('div');
    header.className = 'panel-header';

    const titleSection = document.createElement('div');
    titleSection.className = 'title-section';
    
    const mainTitle = media.title?.english || media.title?.romaji || 'Unknown Title';
    titleSection.innerHTML = `<h2 class="main-title">${mainTitle}</h2>`;

    if (media.title?.romaji && media.title?.english && media.title.romaji !== media.title.english) {
      titleSection.innerHTML += `<div class="alt-title">${media.title.romaji}</div>`;
    }
    if (media.title?.native) {
      titleSection.innerHTML += `<div class="native-title">${media.title.native}</div>`;
    }

    header.appendChild(titleSection);

    if (media.format || (media.season && media.seasonYear)) {
      const formatInfo = document.createElement('div');
      formatInfo.className = 'format-info';
      
      let html = '';
      if (media.format) {
        html += `<span class="format-badge-large">${this.formatDisplayName(media.format)}</span>`;
      }
      if (media.season && media.seasonYear) {
        html += `<span class="season-info">${this.capitalize(media.season)} ${media.seasonYear}</span>`;
      }
      
      formatInfo.innerHTML = html;
      header.appendChild(formatInfo);
    }

    return header;
  }

  createGenresSection(genres) {
    const section = document.createElement('div');
    section.className = 'panel-section genres-section';

    section.innerHTML = `
      <h3 class="section-title">Genres</h3>
      <div class="genres-container">
        ${genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
      </div>
    `;

    return section;
  }

  createExternalLinksSection(media) {
    const section = document.createElement('div');
    section.className = 'panel-section external-links-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'External Links';
    section.appendChild(title);

    const linksContainer = document.createElement('div');
    linksContainer.className = 'external-links-container';

    const anilistBtn = document.createElement('button');
    anilistBtn.className = 'external-link-btn anilist-btn';
    anilistBtn.innerHTML = '🔗 View on AniList';
    anilistBtn.onclick = (e) => {
      e.stopPropagation();
      const url = this.plugin.getAniListUrl ? this.plugin.getAniListUrl(media.id, media.type) : `https://anilist.co/${media.type.toLowerCase()}/${media.id}`;
      window.open(url, '_blank');
    };
    linksContainer.appendChild(anilistBtn);

    if (media.idMal) {
      const malBtn = document.createElement('button');
      malBtn.className = 'external-link-btn mal-btn';
      malBtn.innerHTML = '🔗 View on MAL';
      malBtn.onclick = (e) => {
        e.stopPropagation();
        const type = media.type === 'MANGA' ? 'manga' : 'anime';
        window.open(`https://myanimelist.net/${type}/${media.idMal}`, '_blank');
      };
      linksContainer.appendChild(malBtn);
    }

    section.appendChild(linksContainer);
    return section;
  }

  formatDisplayName(str) {
    if (!str) return '';
    return str.replace(/_/g, ' ')
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
  }

  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  positionPanel(panel, triggerElement) {
    panel.className = 'zoro-more-details-panel';
  }

  cleanupCountdowns(panel) {
    const countdownElements = panel.querySelectorAll('.countdown-value[data-interval-id]');
    countdownElements.forEach(element => {
      const intervalId = element.dataset.intervalId;
      if (intervalId) {
        clearInterval(parseInt(intervalId));
      }
    });
  }
}
class Trending {
  constructor(plugin) { 
    this.plugin = plugin; 
  }

  // Generate cache key for trending data
  getTrendingCacheKey(source, mediaType, limit) {
    return this.plugin.cache.structuredKey('trending', 'trending', `${source}_${mediaType}_${limit}`);
  }

  async fetchAniListTrending(mediaType = 'ANIME', limit = 20) {
    const cacheKey = this.getTrendingCacheKey('anilist', mediaType, limit);
    
    // Try cache first
    const cached = this.plugin.cache.get(cacheKey, {
      scope: 'mediaData',
      source: 'anilist'
    });
    
    if (cached) {
      
      return cached;
    }

    const query = `
      query ($type: MediaType, $perPage: Int) {
        Page(page: 1, perPage: $perPage) {
          media(type: $type, sort: TRENDING_DESC) {
            id
            idMal
            title {
              romaji
              english
              native
            }
            coverImage {
              large
              medium
            }
            format
            averageScore
            genres
            episodes
            chapters
            status
            startDate {
              year
              month
              day
            }
          }
        }
      }
    `;

    const variables = {
      type: mediaType.toUpperCase(),
      perPage: limit
    };

    

    try {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables })
      });

      

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Trending] AniList error response:', errorText);
        throw new Error(`AniList API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      

      if (data.errors) {
        console.error('[Trending] AniList GraphQL errors:', data.errors);
        throw new Error(`AniList GraphQL error: ${data.errors[0]?.message || 'Unknown error'}`);
      }

      if (!data.data?.Page?.media) {
        console.error('[Trending] No media data in response:', data);
        throw new Error('No trending data received from AniList');
      }

      const mediaList = data.data.Page.media.map(media => ({
        ...media,
        _zoroMeta: {
          source: 'anilist',
          mediaType: mediaType.toUpperCase(),
          fetchedAt: Date.now()
        }
      }));

      // Cache the result with trending-specific tags and longer TTL
      this.plugin.cache.set(cacheKey, mediaList, {
        scope: 'mediaData',
        source: 'anilist',
        ttl: 24 * 60 * 60 * 1000, // 24 hours for trending data
        tags: ['trending', mediaType.toLowerCase(), 'anilist']
      });

      
      return mediaList;

    } catch (error) {
      console.error('[Trending] AniList fetch failed:', error);
      
      // Try to return stale cache data as fallback
      const staleData = this.plugin.cache.get(cacheKey, {
        scope: 'mediaData',
        source: 'anilist',
        ttl: Infinity // Accept any cached data as fallback
      });
      
      if (staleData) {
        
        return staleData;
      }
      
      throw error;
    }
  }

  // Fetch Simkl trending (popular) items
  async fetchSimklTrending(mediaType = 'ANIME', limit = 20) {
    const typeLower = mediaType.toLowerCase();
    const cacheKey = this.getTrendingCacheKey('simkl', mediaType, limit);

    const cached = this.plugin.cache.get(cacheKey, {
      scope: 'mediaData',
      source: 'simkl'
    });
    if (cached) return cached;

    const category = typeLower === 'anime' ? 'anime' : 'tv';
    const url = `https://api.simkl.com/lists/${category}/trending?limit=${limit}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'simkl-api-key': this.plugin.settings.simklClientId || ''
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Trending] Simkl error response:', errorText);
        throw new Error(`Simkl API error: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      const items = Array.isArray(data) ? data : [];

      const normalized = items
        .map(item => this.plugin.simklApi.transformMedia(item))
        .filter(Boolean)
        .map(media => ({
          id: media.id,
          idMal: media.idMal,
          idImdb: media.idImdb,
          title: media.title,
          coverImage: media.coverImage,
          format: media.format,
          averageScore: media.averageScore,
          genres: media.genres,
          episodes: media.episodes,
          status: media.status,
          _zoroMeta: {
            source: 'simkl',
            mediaType: mediaType.toUpperCase(),
            fetchedAt: Date.now()
          }
        }));

      this.plugin.cache.set(cacheKey, normalized, {
        scope: 'mediaData',
        source: 'simkl',
        ttl: 24 * 60 * 60 * 1000,
        tags: ['trending', category, 'simkl']
      });

      return normalized;
    } catch (error) {
      console.error('[Trending] Simkl fetch failed:', error);
      const staleData = this.plugin.cache.get(cacheKey, {
        scope: 'mediaData',
        source: 'simkl',
        ttl: Infinity
      });
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchJikanTrending(mediaType = 'anime', limit = 20) {
    const type = mediaType.toLowerCase();
    const cacheKey = this.getTrendingCacheKey('mal', mediaType, limit);
    
    // Try cache first
    const cached = this.plugin.cache.get(cacheKey, {
      scope: 'mediaData',
      source: 'mal'
    });
    
    if (cached) {
      
      return cached;
    }

    const url = `https://api.jikan.moe/v4/top/${type}?filter=airing&limit=${limit}`;
    
    

    try {
      const response = await fetch(url);
      
      
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Trending] Jikan error response:', errorText);
        throw new Error(`Jikan API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      
      
      const unique = [];
      const seen = new Set();
      
      (data.data || []).forEach(item => {
        if (!seen.has(item.mal_id)) {
          seen.add(item.mal_id);
          unique.push({
            id: item.mal_id,
            malId: item.mal_id,
            title: {
              romaji: item.title || '',
              english: item.title_english || '',
              native: item.title_japanese || ''
            },
            coverImage: {
              large: item.images?.jpg?.large_image_url,
              medium: item.images?.jpg?.image_url
            },
            format: item.type,
            averageScore: item.score ? Math.round(item.score * 10) : null,
            genres: item.genres?.map(g => g.name) || [],
            episodes: item.episodes,
            chapters: type === 'manga' ? item.chapters : undefined,
            status: item.status,
            _zoroMeta: {
              source: 'mal',
              mediaType: type === 'manga' ? 'MANGA' : 'ANIME',
              fetchedAt: Date.now()
            }
          });
        }
      });

      const result = unique.slice(0, limit);
      
      // Cache the result with trending-specific tags and longer TTL
      this.plugin.cache.set(cacheKey, result, {
        scope: 'mediaData',
        source: 'mal',
        ttl: 24 * 60 * 60 * 1000, // 24 hours for trending data
        tags: ['trending', type, 'mal']
      });

      
      return result;

    } catch (error) {
      console.error('[Trending] Jikan fetch failed:', error);
      
      // Try to return stale cache data as fallback
      const staleData = this.plugin.cache.get(cacheKey, {
        scope: 'mediaData',
        source: 'mal',
        ttl: Infinity // Accept any cached data as fallback
      });
      
      if (staleData) {
        
        return staleData;
      }
      
      throw error;
    }
  }

  // Unified method that works with any API source
  async fetchTrending(source, mediaType, limit = 20) {
    
    
    switch (source) {
      case 'mal':
        return await this.fetchJikanTrending(mediaType, limit);
      case 'simkl':
        return await this.fetchSimklTrending(mediaType, limit);
      case 'anilist':
      default:
        return await this.fetchAniListTrending(mediaType, limit);
    }
  }

  async renderTrendingBlock(el, config) {
    
    
    el.empty();
    el.appendChild(this.plugin.render.createListSkeleton(10));

    try {
      const type = (config.mediaType || 'ANIME').toLowerCase();
      const source = config.source || this.plugin.settings.defaultApiSource || 'anilist';
      const limit = config.limit || 20;

      

      // Use unified method with proper queue management
      const items = await this.plugin.requestQueue.add(() => 
        this.fetchTrending(source, type === 'manga' ? 'MANGA' : 'ANIME', limit)
      );

      // Ensure metadata is set for each item
      items.forEach(item => {
        if (!item._zoroMeta) {
          item._zoroMeta = {
            source: source,
            mediaType: config.mediaType || 'ANIME',
            fetchedAt: Date.now()
          };
        }
      });

      

      el.empty();
      this.plugin.render.renderSearchResults(el, items, {
        layout: config.layout || 'card',
        mediaType: config.mediaType || 'ANIME',
        source: source
      });

      

    } catch (err) {
      console.error('[Trending] Error in renderTrendingBlock:', err);
      el.empty();
      this.plugin.renderError(el, err.message, 'Trending');
    }
  }

  // Utility methods for cache management
  invalidateTrendingCache(source = null, mediaType = null) {
    if (source && mediaType) {
      // Invalidate specific trending cache
      const cacheKey = this.getTrendingCacheKey(source, mediaType, 20); // assuming default limit
      this.plugin.cache.delete(cacheKey, { scope: 'mediaData', source });
    } else if (source) {
      // Invalidate all trending for a source
      this.plugin.cache.invalidateByTag('trending', { source });
    } else {
      // Invalidate all trending cache
      this.plugin.cache.invalidateByTag('trending');
    }
    
  }

  // Force refresh trending data
  async refreshTrending(source, mediaType, limit = 20) {
    
    
    // Clear existing cache
    this.invalidateTrendingCache(source, mediaType);
    
    // Fetch fresh data
    return await this.fetchTrending(source, mediaType, limit);
  }

  // Get cache stats for trending data
  getTrendingCacheStats() {
    const stats = this.plugin.cache.getStats();
    return {
      totalCacheSize: stats.cacheSize,
      hitRate: stats.hitRate,
      storeBreakdown: Object.entries(stats.storeBreakdown)
        .filter(([key]) => key.includes('mediaData'))
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {})
    };
  }
}

class Authentication {
  constructor(plugin) {
    this.plugin = plugin;
  }

  static ANILIST_AUTH_URL  = 'https://anilist.co/api/v2/oauth/authorize';
  static ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
  static REDIRECT_URI      = 'https://anilist.co/api/v2/oauth/pin';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.accessToken);
  }

  async loginWithFlow() {
    if (!this.plugin.settings.clientId) {
      new Notice('❌ Please enter your Client ID first.', 5000);
      return;
    }

    const { clientId } = this.plugin.settings;
    const authUrl =
      `${Authentication.ANILIST_AUTH_URL}?` +
      new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  Authentication.REDIRECT_URI,
        response_type: 'code'
      }).toString();

    new Notice('🔐 Opening AniList login page…', 3000);
    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }

    const modal = AuthModal.aniListPin(this.plugin.app, async (pin) => {
  await this.exchangePin(pin);
});
modal.open();
  }

  async logout() {
    this.plugin.settings.accessToken  = '';
    this.plugin.settings.tokenExpiry  = 0;
    this.plugin.settings.authUsername = '';
    this.plugin.settings.clientId     = '';
    this.plugin.settings.clientSecret = '';
    await this.plugin.saveSettings();
    if (this.plugin.settings.authUsername) {
   this.plugin.cache.invalidateByUser(this.plugin.settings.authUsername);
 }
    this.plugin.cache.clear();
    new Notice('✅ Logged out & cleared credentials.', 3000);
  }

  async exchangePin(pin) {
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code:          pin.trim(),
      client_id:     this.plugin.settings.clientId,
      client_secret: this.plugin.settings.clientSecret || '',
      redirect_uri:  Authentication.REDIRECT_URI
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept:         'application/json'
    };

    try {
      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url:    Authentication.ANILIST_TOKEN_URL,
          method: 'POST',
          headers,
          body:   body.toString()
        })
      );

      const data = res.json;
      if (!data?.access_token) {
        throw new Error(data.error_description || 'No token returned');
      }

      this.plugin.settings.accessToken = data.access_token;
      if (data.expires_in) {
        this.plugin.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
      }
      await this.plugin.saveSettings();
      this.plugin.cache.invalidateByUser(await this.getAuthenticatedUsername());

      await this.forceScoreFormat();
      if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
  await this.plugin.updateDefaultApiSourceBasedOnAuth();
}
      new Notice('✅ Authenticated successfully!', 4000);
    } catch (err) {
      new Notice(`❌ Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  

  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated');
    return true;
  }
  
  async forceScoreFormat() {
  if (!this.plugin.settings.forceScoreFormat) return;
  
  await this.ensureValidToken();
  
  // First check current score format
  const viewerQuery = `
    query {
      Viewer {
        id
        name
        mediaListOptions {
          scoreFormat
        }
      }
    }
  `;

  try {
    const currentResponse = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.plugin.settings.accessToken}`
        },
        body: JSON.stringify({ query: viewerQuery })
      })
    );

    const currentFormat = currentResponse.json?.data?.Viewer?.mediaListOptions?.scoreFormat;
    console.log('Current score format:', currentFormat);

    if (currentFormat === 'POINT_10') {
      console.log('Score format already set to POINT_10');
      return;
    }
    
    const mutation = `
      mutation {
        UpdateUser(scoreFormat: POINT_10) {
          id
          name
          mediaListOptions {
            scoreFormat
          }
        }
      }
    `;

    const response = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.plugin.settings.accessToken}`
        },
        body: JSON.stringify({ query: mutation })
      })
    );

    if (response.json?.errors) {
      const errorMsg = response.json.errors[0]?.message || 'Unknown error';
      console.error('UpdateUser error:', response.json.errors);
      throw new Error(errorMsg);
    }
    
    const updatedFormat = response.json?.data?.UpdateUser?.mediaListOptions?.scoreFormat;
    console.log('Updated score format to:', updatedFormat);
    
    if (updatedFormat === 'POINT_10') {
      new Notice('✅ Score format updated to 0-10 scale', 3000);
      
    } else {
      throw new Error(`Score format not updated properly. Got: ${updatedFormat}`);
    }
    
  } catch (err) {
    
    new Notice(`❌ Could not update score format: ${err.message}`, 5000);
  }
}

  async getAuthenticatedUsername() {
    await this.ensureValidToken();

    const query = `query { Viewer { name } }`;
    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url:     'https://graphql.anilist.co',
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${this.plugin.settings.accessToken}`
        },
        body: JSON.stringify({ query })
      })
    );

    const name = res.json?.data?.Viewer?.name;
    if (!name) throw new Error('Could not fetch username');
    this.plugin.settings.authUsername = name;
    await this.plugin.saveSettings();
    return name;
  }
}
class MALAuthentication {
  constructor(plugin) {
    this.plugin = plugin;
  }

  static MAL_AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize';
  static MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
  static MAL_USER_URL = 'https://api.myanimelist.net/v2/users/@me';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.malAccessToken && this.isTokenValid());
  }

  makeVerifier() {
    const arr = new Uint8Array(32);
    
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      try {
        crypto.getRandomValues(arr);
      } catch (e) {
        console.log('[MAL-AUTH] crypto.getRandomValues failed, using Math.random fallback', e);
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
      }
    } else {
      console.log('[MAL-AUTH] crypto.getRandomValues not available, using Math.random');
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
    }
    
    const verifier = btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 128);
    
    return verifier;
  }

  makeChallenge(verifier) {
    return verifier;
  }

  generateState() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      try {
        return crypto.randomUUID();
      } catch (e) {
        console.log('[MAL-AUTH] crypto.randomUUID failed, using fallback', e);
      }
    }
    
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async loginWithFlow() {
    if (!this.plugin.settings.malClientId) {
      new Notice('❌ Please enter your MAL Client ID first.', 5000);
      return;
    }
    
    if (this.isTokenValid()) {
      new Notice('Already authenticated with MyAnimeList', 3000);
      return;
    }

    this.verifier = this.makeVerifier();
    const challenge = this.makeChallenge(this.verifier);
    const state = this.generateState();

    this.authState = state;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.plugin.settings.malClientId,
      redirect_uri: 'http://localhost:8080/callback',
      code_challenge: challenge,
      code_challenge_method: 'plain',
      state: state
    });

    const authUrl = `${MALAuthentication.MAL_AUTH_URL}?${params.toString()}`;

    new Notice('🔐 Opening MyAnimeList login page…', 3000);
    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }

    const modal = AuthModal.malCallback(this.plugin.app, async (callbackUrl) => {
  const code = this.extractAuthCode(callbackUrl);
  if (!code) {
    new Notice('❌ Could not extract authorization code from URL', 5000);
    return;
  }
  await this.exchangeCodeForToken(code);
});
modal.open();
return;
  }

  extractAuthCode(input) {
    const trimmedInput = input.trim();
    
    if (!trimmedInput.includes('://') && !trimmedInput.includes('?') && !trimmedInput.includes('&')) {
      if (/^[A-Za-z0-9_-]{20,}$/.test(trimmedInput)) {
        return trimmedInput;
      }
    }
    
    let url;
    try {
      if (trimmedInput.startsWith('?')) {
        url = new URL('http://localhost' + trimmedInput);
      } else if (trimmedInput.includes('://')) {
        url = new URL(trimmedInput);
      } else {
        const codeMatch = trimmedInput.match(/[?&]code=([^&\s]+)/);
        if (codeMatch) {
          return decodeURIComponent(codeMatch[1]);
        }
        return null;
      }
    } catch (e) {
      const codeMatch = trimmedInput.match(/[?&]code=([^&\s]+)/);
      if (codeMatch) {
        return decodeURIComponent(codeMatch[1]);
      }
      return null;
    }
    
    const code = url.searchParams.get('code');
    if (code) {
      return decodeURIComponent(code);
    }
    
    const codeMatch = trimmedInput.match(/[?&]code=([^&\s]+)/);
    if (codeMatch) {
      return decodeURIComponent(codeMatch[1]);
    }
    
    return null;
  }

  async exchangeCodeForToken(code) {
    if (!code || code.length < 10) {
      throw new Error('Invalid authorization code');
    }

    new Notice('Exchanging authorization code for tokens…',6000);

    const body = new URLSearchParams({
      client_id: this.plugin.settings.malClientId,
      code: code,
      code_verifier: this.verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:8080/callback'
    });

    if (this.plugin.settings.malClientSecret && this.plugin.settings.malClientSecret.trim()) {
      body.append('client_secret', this.plugin.settings.malClientSecret.trim());
    }

    try {
      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: MALAuthentication.MAL_TOKEN_URL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: body.toString(),
          throw: false
        })
      );

      if (res.status < 200 || res.status >= 300) {
        const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
        
        let errorMsg = `Token exchange failed (HTTP ${res.status})`;
        
        try {
          const errorData = res.json || (res.text ? JSON.parse(res.text) : {});
          
          if (errorData.error) {
            errorMsg += `: ${errorData.error}`;
            if (errorData.error_description) {
              errorMsg += ` - ${errorData.error_description}`;
            }
          }
          
          if (errorData.error === 'invalid_client') {
            errorMsg += '\n\nTip: Check your Client ID and Secret in settings. For apps without a secret, leave the Client Secret field empty.';
          } else if (errorData.error === 'invalid_request') {
            errorMsg += '\n\nTip: Ensure your Redirect URI exactly matches what\'s registered in your MAL app settings.';
          } else if (errorData.error === 'invalid_grant') {
            errorMsg += '\n\nTip: The authorization code may have expired or been used already. Please try authenticating again.';
          }
        } catch (parseError) {
          errorMsg += `: ${errorText}`;
        }
        
        throw new Error(errorMsg);
      }

      let data;
      try {
        data = res.json || (res.text ? JSON.parse(res.text) : null);
      } catch (jsonError) {
        throw new Error('Invalid response from MyAnimeList server');
      }

      if (!data.access_token) {
        throw new Error('No access token received from MyAnimeList');
      }

      this.plugin.settings.malAccessToken = data.access_token;
      this.plugin.settings.malRefreshToken = data.refresh_token;
      this.plugin.settings.malTokenExpiry = Date.now() + (data.expires_in * 1000);
      await this.plugin.saveSettings();
      this.plugin.cache.invalidateByUser(this.plugin.settings.malUserInfo?.name);

      try {
        await this.fetchUserInfo();
        new Notice(`✅ Successfully authenticated with MAL! Welcome ${this.plugin.settings.malUserInfo?.name || 'user'} 🎉`, 4000);
      } catch (userError) {
        console.log('[MAL-AUTH] Failed to fetch user info but auth succeeded', userError);
        new Notice('✅ Authentication successful! 🎉', 4000);
      }
     if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
  await this.plugin.updateDefaultApiSourceBasedOnAuth();
}
    } catch (err) {
      new Notice(`❌ MAL Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  async fetchUserInfo() {
    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: MALAuthentication.MAL_USER_URL,
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${this.plugin.settings.malAccessToken}`
        },
        throw: false
      })
    );
    
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not fetch user info (HTTP ${res.status})`);
    }
    
    this.plugin.settings.malUserInfo = res.json || (res.text ? JSON.parse(res.text) : null);
    await this.plugin.saveSettings();
  }

  async refreshAccessToken() {
    if (!this.plugin.settings.malRefreshToken) {
      throw new Error('No refresh token available');
    }
    
    const body = new URLSearchParams({
      client_id: this.plugin.settings.malClientId,
      refresh_token: this.plugin.settings.malRefreshToken,
      grant_type: 'refresh_token'
    });

    if (this.plugin.settings.malClientSecret && this.plugin.settings.malClientSecret.trim()) {
      body.append('client_secret', this.plugin.settings.malClientSecret.trim());
    }

    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: MALAuthentication.MAL_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        throw: false
      })
    );

    if (res.status < 200 || res.status >= 300) {
      const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
      throw new Error(`Token refresh failed (HTTP ${res.status}): ${errorText}`);
    }

    const data = res.json || (res.text ? JSON.parse(res.text) : null);
    this.plugin.settings.malAccessToken = data.access_token;
    this.plugin.settings.malRefreshToken = data.refresh_token || this.plugin.settings.malRefreshToken;
    this.plugin.settings.malTokenExpiry = Date.now() + (data.expires_in * 1000);
    await this.plugin.saveSettings();
  }

  isTokenValid() {
    return !!(this.plugin.settings.malAccessToken && 
              this.plugin.settings.malTokenExpiry && 
              Date.now() < (this.plugin.settings.malTokenExpiry - 5 * 60 * 1000));
  }

  async checkTokenExpiry() {
    if (this.isTokenValid()) return;
    if (!this.plugin.settings.malRefreshToken) {
      console.log('[MAL-AUTH] Token expired and no refresh token available');
      return;
    }
    
    try {
      await this.refreshAccessToken();
      console.log('[MAL-AUTH] Token automatically refreshed');
    } catch (e) {
      console.error('[MAL-AUTH] Automatic token refresh failed', e);
      new Notice('MAL authentication expired. Please re-authenticate.', 5000);
    }
  }

  async logout() {
    this.plugin.settings.malAccessToken = '';
    this.plugin.settings.malRefreshToken = '';
    this.plugin.settings.malTokenExpiry = null;
    this.plugin.settings.malUserInfo = null;
    this.plugin.settings.malClientId = '';
    this.plugin.settings.malClientSecret = '';
    await this.plugin.saveSettings();
    if (this.plugin.settings.malUserInfo?.name) {
    this.plugin.cache.invalidateByUser(this.plugin.settings.malUserInfo.name);
   }
    
   this.plugin.cache.clear('malData');
   this.plugin.cache.clear();
    new Notice('✅ Logged out from MyAnimeList & cleared credentials.', 3000);
  }

  

  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated with MyAnimeList');
    await this.checkTokenExpiry();
    return true;
  }
  
  async getAuthenticatedUsername() {
    await this.ensureValidToken();

    if (!this.plugin.settings.malUserInfo) {
      await this.fetchUserInfo();
    }

    const name = this.plugin.settings.malUserInfo?.name;
    if (!name) throw new Error('Could not fetch MAL username');
    return name;
  }

  getAuthHeaders() { 
    return this.isTokenValid() ? { Authorization: `Bearer ${this.plugin.settings.malAccessToken}` } : null; 
  }
  
  isAuthenticated() { 
    return this.isTokenValid(); 
  }
  
  getUserInfo() { 
    return this.plugin.settings.malUserInfo; 
  }
}
class SimklAuthentication {
  constructor(plugin) {
    this.plugin = plugin;
    this.pollInterval = null;
  }

  static SIMKL_PIN_URL = 'https://api.simkl.com/oauth/pin';
  static SIMKL_PIN_CHECK_URL = 'https://api.simkl.com/oauth/pin/';
  static SIMKL_USER_URL = 'https://api.simkl.com/users/settings';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.simklAccessToken);
  }

  get hasRequiredCredentials() {
    return Boolean(this.plugin.settings.simklClientId && this.plugin.settings.simklClientSecret);
  }

  async loginWithFlow() {
    if (!this.plugin.settings.simklClientId) {
      new Notice('❌ Please enter your SIMKL Client ID first.', 5000);
      return;
    }

    if (!this.plugin.settings.simklClientSecret) {
      new Notice('❌ Please enter your SIMKL Client Secret first.', 5000);
      return;
    }

    if (this.isLoggedIn) {
      new Notice('Already authenticated with SIMKL', 3000);
      return;
    }

    try {
      // Step 1: Request device code
      const pinUrl = `${SimklAuthentication.SIMKL_PIN_URL}?client_id=${encodeURIComponent(this.plugin.settings.simklClientId)}&redirect_uri=${encodeURIComponent('urn:ietf:wg:oauth:2.0:oob')}`;
      
      const deviceResponse = await requestUrl({
        url: pinUrl,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'simkl-api-key': this.plugin.settings.simklClientId
        },
        throw: false
      });

      if (deviceResponse.status < 200 || deviceResponse.status >= 300) {
        throw new Error(`PIN request failed: HTTP ${deviceResponse.status}`);
      }

      const deviceData = deviceResponse.json;
      
      if (!deviceData.user_code) {
        throw new Error('Invalid response: missing user_code');
      }

      // Step 2: Open browser to PIN page
      new Notice('🔐 Opening SIMKL PIN page…', 3000);
      const pinPageUrl = deviceData.verification_url || 'https://simkl.com/pin';
      
      if (window.require) {
        const { shell } = window.require('electron');
        await shell.openExternal(pinPageUrl);
      } else {
        window.open(pinPageUrl, '_blank');
      }

      // Step 3: Show PIN in modal and start polling
      const modal = new SimklPinModal(this.plugin.app, deviceData, async () => {
        // User clicked cancel
        this.stopPolling();
      });
      modal.open();

      // Start polling for authentication
      this.startPolling(deviceData);

    } catch (error) {
      console.error('SIMKL authentication failed:', error);
      new Notice(`❌ Authentication failed: ${error.message}`, 8000);
    }
  }

  async startPolling(deviceData) {
    const { user_code, interval = 5, expires_in = 900 } = deviceData;
    const maxAttempts = Math.floor(expires_in / interval);
    let attempts = 0;

    const poll = async () => {
      attempts++;
      
      if (attempts > maxAttempts) {
        this.stopPolling();
        new Notice('❌ Authentication timeout. Please try again.', 8000);
        return;
      }

      try {
        const pollUrl = `${SimklAuthentication.SIMKL_PIN_CHECK_URL}${encodeURIComponent(user_code)}?client_id=${encodeURIComponent(this.plugin.settings.simklClientId)}`;

        const response = await requestUrl({
          url: pollUrl,
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'simkl-api-key': this.plugin.settings.simklClientId
          },
          throw: false
        });

        const data = response.json || {};

        if (data.access_token) {
          // Success!
          this.plugin.settings.simklAccessToken = data.access_token;
          await this.plugin.saveSettings();
          
          // Close modal
          document.querySelectorAll('.modal-container').forEach(modal => {
            if (modal.querySelector('.simkl-pin-modal')) {
              modal.remove();
            }
          });
          
          this.stopPolling();
          
          // Fetch user info
          try {
            await this.fetchUserInfo();
            new Notice(`✅ Successfully authenticated with SIMKL! Welcome ${this.plugin.settings.simklUserInfo?.user?.name || 'user'} 🎉`, 4000);
          } catch (userError) {
            console.log('[SIMKL-AUTH] Failed to fetch user info but auth succeeded', userError);
            new Notice('✅ Authentication successful! 🎉', 4000);
          }
          if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
  await this.plugin.updateDefaultApiSourceBasedOnAuth();
}
          return;
        }

        // Continue polling if no token yet
        if (response.status === 404 || !data || Object.keys(data).length === 0) {
          // User hasn't entered code yet, continue polling
        }

      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // Start polling
    this.pollInterval = setInterval(poll, interval * 1000);
    
    // Do first poll after interval
    setTimeout(poll, interval * 1000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async fetchUserInfo() {
    const headers = this.getAuthHeaders();
    if (!headers) {
      throw new Error('Not authenticated');
    }

    const res = await requestUrl({
      url: SimklAuthentication.SIMKL_USER_URL,
      method: 'GET',
      headers,
      throw: false
    });
    
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not fetch user info (HTTP ${res.status})`);
    }
    
    this.plugin.settings.simklUserInfo = res.json;
    await this.plugin.saveSettings();
  }

  async logout() {
    this.plugin.settings.simklAccessToken = '';
    this.plugin.settings.simklUserInfo = null;
    this.plugin.settings.simklClientId = '';
    this.plugin.settings.simklClientSecret = '';
    await this.plugin.saveSettings();
    
    // Clear any SIMKL-specific cache if you have one
    if (this.plugin.cache) {
      this.plugin.cache.clear('simklData');
    }
    
    new Notice('✅ Logged out from SIMKL & cleared credentials.', 3000);
  }

  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated with SIMKL');
    if (!this.hasRequiredCredentials) throw new Error('Missing SIMKL client credentials');
    return true;
  }
  
  async getAuthenticatedUsername() {
    await this.ensureValidToken();

    if (!this.plugin.settings.simklUserInfo) {
      await this.fetchUserInfo();
    }

    const name = this.plugin.settings.simklUserInfo?.user?.name;
    if (!name) throw new Error('Could not fetch SIMKL username');
    return name;
  }

  getAuthHeaders() { 
    if (!this.isLoggedIn || !this.hasRequiredCredentials) return null;
    
    return { 
      'Authorization': `Bearer ${this.plugin.settings.simklAccessToken}`,
      'simkl-api-key': this.plugin.settings.simklClientId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }; 
  }
  
  isAuthenticated() { 
    return this.isLoggedIn && this.hasRequiredCredentials; 
  }
  
  getUserInfo() { 
    return this.plugin.settings.simklUserInfo; 
  }
}
class SimklPinModal extends Modal {
  constructor(app, deviceData, onCancel) {
    super(app);
    this.deviceData = deviceData;
    this.onCancel = onCancel;
    this.countdownInterval = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('simkl-pin-modal');

    contentEl.createEl('h2', { 
      text: '🔐 SIMKL Authentication',
      attr: { style: 'text-align: center; margin-bottom: 20px;' }
    });

    const instructionsEl = contentEl.createEl('div', {
      attr: { style: 'text-align: center; padding: 20px;' }
    });

    instructionsEl.createEl('h3', { 
      text: 'Your PIN Code:',
      attr: { style: 'margin-bottom: 15px;' }
    });

    // Large PIN code display
    const codeEl = instructionsEl.createEl('div', {
      text: this.deviceData.user_code,
      cls: 'simkl-pin-code',
      attr: { 
        style: 'font-size: 3em; font-weight: bold; color: var(--interactive-accent); margin: 30px 0; padding: 20px; border: 3px solid var(--interactive-accent); border-radius: 12px; font-family: monospace; letter-spacing: 5px;'
      }
    });

    // Instructions
    const steps = instructionsEl.createEl('ol', {
      attr: { style: 'text-align: left; max-width: 400px; margin: 0 auto 20px auto;' }
    });
    steps.createEl('li', { text: 'The SIMKL PIN page should have opened in your browser' });
    steps.createEl('li', { text: 'Enter the code shown above' });
    steps.createEl('li', { text: 'This dialog will close automatically when complete' });

    // Buttons
    const buttonContainer = instructionsEl.createEl('div', {
      attr: { style: 'margin-top: 20px;' }
    });

    const copyButton = buttonContainer.createEl('button', {
      text: '📋 Copy Code',
      cls: 'mod-cta',
      attr: { style: 'margin: 5px;' }
    });

    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      attr: { style: 'margin: 5px;' }
    });

    // Countdown
    const countdownEl = instructionsEl.createEl('div', {
      attr: { style: 'margin-top: 15px; font-size: 0.9em; color: var(--text-muted);' }
    });

    // Event handlers
    copyButton.onclick = () => {
      navigator.clipboard.writeText(this.deviceData.user_code);
      new Notice('📋 Code copied to clipboard!');
    };

    cancelButton.onclick = () => {
      this.close();
      if (this.onCancel) this.onCancel();
      new Notice('Authentication cancelled.');
    };

    // Start countdown
    let timeLeft = this.deviceData.expires_in || 900;
    const updateCountdown = () => {
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      countdownEl.textContent = `⏰ Code expires in: ${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      if (timeLeft > 0) {
        timeLeft--;
      } else {
        this.close();
        if (this.onCancel) this.onCancel();
      }
    };
    
    updateCountdown();
    this.countdownInterval = setInterval(updateCountdown, 1000);
  }

  onClose() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }
}
class AuthModal extends Modal {
  constructor(app, config) {
    super(app);
    this.config = {
      title: '🔑 Authentication',
      description: 'Enter your credentials',
      placeholder: 'Enter value',
      submitText: 'Save',
      inputType: 'text',
      extraClasses: [],
      showReady: false,
      ...config
    };
    this.onSubmit = config.onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal', ...this.config.extraClasses);
    
    this.createHeader();
    this.createInput();
    this.createButtons();
    this.setupEventHandlers();
    
    setTimeout(() => this.input.focus(), 100);
  }

  createHeader() {
    this.contentEl.createEl('h2', { text: this.config.title });
    
    const desc = this.contentEl.createEl('p', { cls: 'auth-modal-desc' });
    desc.setText(this.config.description);
  }

  createInput() {
    const inputContainer = this.contentEl.createEl('div', { cls: 'auth-input-container' });
    
    this.input = inputContainer.createEl('input', {
      type: this.config.inputType,
      placeholder: this.config.placeholder,
      cls: `auth-input ${this.config.inputType === 'text' && this.config.extraClasses.includes('pin-modal') ? 'pin-input' : ''}`
    });
  }

  createButtons() {
    const buttonContainer = this.contentEl.createEl('div', { cls: 'auth-button-container' });
    
    this.submitButton = buttonContainer.createEl('button', {
      text: this.config.submitText,
      cls: `mod-cta auth-button ${this.config.showReady ? 'submit-button' : ''}`
    });
    
    this.cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'auth-button'
    });
  }

  setupEventHandlers() {
    const closeModal = () => this.close();
    
    this.submitButton.addEventListener('click', () => {
      const value = this.input.value.trim();
      if (value) {
        this.onSubmit(value);
        closeModal();
      }
    });
    
    this.cancelButton.addEventListener('click', closeModal);
    
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.submitButton.click();
      }
    });
    
    if (this.config.showReady) {
      this.input.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        this.submitButton.classList.toggle('ready', !!value);
      });
    }
  }

  // Static factory methods for convenience
  static clientId(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔑 Enter Client ID',
      description: 'Enter your application Client ID',
      placeholder: 'Client ID',
      onSubmit
    });
  }

  static clientSecret(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔐 Enter Client Secret',
      description: 'Enter your application Client Secret',
      placeholder: 'Client Secret',
      inputType: 'password',
      onSubmit
    });
  }

  // AniList PIN modal
  static aniListPin(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔓 AniList Authentication',
      description: 'Paste the PIN code from the browser:',
      placeholder: 'Paste PIN code here',
      submitText: '✅ Complete Authentication',
      extraClasses: ['pin-modal'],
      showReady: true,
      onSubmit
    });
  }

  // MAL callback URL modal
  static malCallback(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔓 MAL Authentication',
      description: 'Paste the FULL callback URL from the browser:',
      placeholder: 'Paste callback URL here',
      submitText: '✅ Complete Authentication',
      extraClasses: ['pin-modal'],
      showReady: true,
      onSubmit
    });
  }
}

class Theme {
static THEME_REPO_URL = 'https://api.github.com/repos/zara-kasi/zoro/contents/Theme?ref=main';

  constructor(plugin) {
    this.plugin = plugin;
    this.themeStyleId = 'zoro-theme';
    this.pluginScopes = [
      '.zoro-container',
      '.zoro-search-container',
      '.zoro-dashboard-container',
      '.zoro-modal-overlay',
      '.zoro-edit-modal',
      '.zoro-auth-modal'
    ];
  }

   async fetchRemoteThemes() {
  try {
    const res = await fetch(Theme.THEME_REPO_URL);
    if (!res.ok) throw res.status;
    const json = await res.json();
    return json
      .filter(item => item.type === 'file' && item.name.endsWith('.css'))
      .map(item => item.name.replace('.css', ''));
  } catch (e) {
    console.warn('[Zoro] Remote theme list failed', e);
    return [];
  }
}
   async downloadTheme(name) {
  const rawUrl = `https://raw.githubusercontent.com/zara-kasi/zoro/main/Theme/${encodeURIComponent(name)}.css`;
  const localPath = `${this.plugin.manifest.dir}/themes/${name}.css`;
  
  try {
    // Check if file exists and delete it
    try {
      await this.plugin.app.vault.adapter.stat(localPath);
      // File exists, delete it
      await this.plugin.app.vault.adapter.remove(localPath);
    } catch (e) {
      // File doesn't exist, continue with download
    }

    const res = await fetch(rawUrl);
    if (!res.ok) throw res.status;
    const css = await res.text();
    
    // Ensure themes directory exists
    const themesDir = `${this.plugin.manifest.dir}/themes`;
    try {
      await this.plugin.app.vault.adapter.mkdir(themesDir);
    } catch (e) {
      // Directory already exists
    }
    
    await this.plugin.app.vault.adapter.write(localPath, css);
    new Notice(`✅ Theme "${name}" downloaded successfully`);
    return true;
  } catch (e) {
    new Notice(`❌ Could not download "${name}": ${e}`);
    return false;
  }
}

  async getAvailableThemes() {
    try {
      const themesDir = `${this.plugin.manifest.dir}/themes`;
      const { files } = await this.plugin.app.vault.adapter.list(themesDir);
      return files
        .filter(f => f.endsWith('.css'))
        .map(f => f.split('/').pop().replace('.css', ''));
    } catch {
      return [];
    }
  }

  async applyTheme(themeName) {
    const old = document.getElementById(this.themeStyleId);
    if (old) old.remove();

    if (!themeName) return;

    const cssPath = `${this.plugin.manifest.dir}/themes/${themeName}.css`;
    let rawCss;
    try {
      rawCss = await this.plugin.app.vault.adapter.read(cssPath);
    } catch (err) {
      console.warn('Zoro: theme file missing:', themeName, err);
      new Notice(`❌ Theme "${themeName}" not found`);
      return;
    }

    const scopedCss = this.scopeToPlugin(rawCss);

    const style = document.createElement('style');
    style.id = this.themeStyleId;
    style.textContent = scopedCss;
    document.head.appendChild(style);
  }

   async deleteTheme(name) {
  const localPath = `${this.plugin.manifest.dir}/themes/${name}.css`;
  
  try {
    await this.plugin.app.vault.adapter.remove(localPath);
    new Notice(`✅ Theme "${name}" deleted successfully`);
    return true;
  } catch (e) {
    new Notice(`❌ Could not delete "${name}": ${e}`);
    return false;
  }
}
  scopeToPlugin(css) {
    const rules = this.extractCSSRules(css);
    const scopedRules = [];

    for (const rule of rules) {
      if (rule.type === 'at-rule') {
        scopedRules.push(this.handleAtRule(rule));
      } else if (rule.type === 'rule') {
        scopedRules.push(this.handleRegularRule(rule));
      } else {
        scopedRules.push(rule.content);
      }
    }

    return scopedRules.join('\n');
  }

  extractCSSRules(css) {
    const rules = [];
    let pos = 0;
    let current = '';
    let braceDepth = 0;
    let inAtRule = false;
    let atRuleType = '';

    while (pos < css.length) {
      const char = css[pos];
      current += char;

      if (char === '@' && braceDepth === 0) {
        if (current.slice(0, -1).trim()) {
          rules.push({ type: 'text', content: current.slice(0, -1) });
        }
        current = char;
        inAtRule = true;
        const match = css.slice(pos).match(/^@(\w+)/);
        atRuleType = match ? match[1] : '';
      }

      if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
        
        if (braceDepth === 0) {
          if (inAtRule) {
            rules.push({ type: 'at-rule', content: current, atType: atRuleType });
            inAtRule = false;
            atRuleType = '';
          } else {
            rules.push({ type: 'rule', content: current });
          }
          current = '';
        }
      }

      pos++;
    }

    if (current.trim()) {
      rules.push({ type: 'text', content: current });
    }

    return rules;
  }

  handleAtRule(rule) {
    if (rule.atType === 'media') {
      const mediaMatch = rule.content.match(/^(@media[^{]+)\{(.*)\}$/s);
      if (mediaMatch) {
        const mediaQuery = mediaMatch[1];
        const innerCSS = mediaMatch[2];
        const scopedInner = this.scopeToPlugin(innerCSS);
        return `${mediaQuery} {\n${scopedInner}\n}`;
      }
    }
    return rule.content;
  }

  handleRegularRule(rule) {
    const match = rule.content.match(/^([^{]+)\{(.*)\}$/s);
    if (!match) return rule.content;

    const selectors = match[1].trim();
    const declarations = match[2];

    const selectorList = selectors.split(',').map(s => s.trim());
    const scopedSelectors = [];

    for (const selector of selectorList) {
      if (this.isAlreadyPluginScoped(selector)) {
        scopedSelectors.push(selector);
      } else if (this.shouldBePluginScoped(selector)) {
        scopedSelectors.push(this.addPluginScope(selector));
      } else {
        scopedSelectors.push(selector);
      }
    }

    return `${scopedSelectors.join(', ')} {${declarations}}`;
  }

  isAlreadyPluginScoped(selector) {
    return this.pluginScopes.some(scope => selector.includes(scope));
  }

  shouldBePluginScoped(selector) {
    const globalPrefixes = [':root', 'html', 'body', '*'];
    const pluginPrefixes = ['.zoro-', '#zoro-'];
    
    const hasGlobalPrefix = globalPrefixes.some(prefix => selector.startsWith(prefix));
    const hasPluginPrefix = pluginPrefixes.some(prefix => selector.includes(prefix));
    
    return !hasGlobalPrefix && (hasPluginPrefix || !selector.startsWith('.'));
  }

  addPluginScope(selector) {
    const primaryScope = '.zoro-container';
    
    if (selector.includes('.zoro-modal') || selector.includes('.zoro-overlay')) {
      return selector;
    }
    
    if (selector.startsWith(':')) {
      return `${primaryScope}${selector}`;
    }
    
    return `${primaryScope} ${selector}`;
  }

  removeTheme() {
    const existingStyle = document.getElementById(this.themeStyleId);
    if (existingStyle) {
      existingStyle.remove();
    }
  }
}

class Prompt {
  constructor(plugin) {
    this.plugin = plugin;
  }

  createAuthenticationPrompt() {
    const modal = document.createElement('div');
    modal.className = 'zoro-edit-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Authentication Required');

    const overlay = document.createElement('div');
    overlay.className = 'zoro-modal-overlay';

    const content = document.createElement('div');
    content.className = 'zoro-modal-content auth-prompt';

    const title = document.createElement('h3');
    title.className = 'zoro-auth-title';
    title.textContent = '🔐 Authentication Required';

    const message = document.createElement('p');
    message.className = 'zoro-auth-message';
    
    message.textContent = 'You need to authenticate with AniList/MyAnimeList to edit your anime/manga entries. This will allow you to update your progress, scores, and status directly from Obsidian.';

    const featuresDiv = document.createElement('div');
    featuresDiv.className = 'zoro-auth-features';

    const featuresTitle = document.createElement('h4');
    featuresTitle.className = 'zoro-auth-features-title';
    featuresTitle.textContent = 'Features after authentication:';

    const featuresList = document.createElement('ul');
    featuresList.className = 'zoro-auth-feature-list';

    const features = [
      'Edit progress, scores, and status',
      'Access private lists and profiles',
      'Quick progress buttons (+1, -1, Complete)',
      'Auto-detect your username',
      'Real-time updates'
    ];

    features.forEach(feature => {
      const li = document.createElement('li');
      li.textContent = feature;
      featuresList.appendChild(li);
    });

    featuresDiv.appendChild(featuresTitle);
    featuresDiv.appendChild(featuresList);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'zoro-modal-buttons';

    const authenticateBtn = document.createElement('button');
    authenticateBtn.className = 'zoro-auth-button';
    
    authenticateBtn.textContent = '🔑 Authenticate';
    authenticateBtn.onclick = () => {
      closeModal();
      this.plugin.app.setting.open();
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
      new Notice('📝 Please use AniList/MyAnimeList to authenticate from settings. Hint: use Setup→ Authentication');
    };

    buttonContainer.appendChild(authenticateBtn);

    content.appendChild(title);
    content.appendChild(message);
    content.appendChild(featuresDiv);
    content.appendChild(buttonContainer);

    modal.appendChild(overlay);
    modal.appendChild(content);
    document.body.appendChild(modal);

    authenticateBtn.focus();
    this.plugin.addGlobalListener(document, 'keydown', handleKeyDown);

    overlay.onclick = closeModal;

    function closeModal() {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      document.removeEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    }
  }
}

class Export {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async ensureZoroFolder() {
    const folderPath = 'Zoro/Export';
    const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.plugin.app.vault.createFolder(folderPath);
    }
    return folderPath;
  }

  async exportUnifiedListsToCSV() {
    let username = this.plugin.settings.authUsername;
    if (!username) username = this.plugin.settings.defaultUsername;
    if (!username) {
      new Notice('Set a default username in settings first.', 3000);
      return;
    }

    const useAuth = !!this.plugin.settings.accessToken;
    const query = `
      query ($userName: String) {
        MediaListCollection(userName: $userName, type: ANIME) {
          lists {
            name
            entries {
              status progress score(format: POINT_10) repeat
              startedAt { year month day } completedAt { year month day }
              media {
                id idMal type format
                title { romaji english native }
                episodes chapters volumes
                startDate { year month day } endDate { year month day }
                averageScore genres
                studios(isMain: true) { nodes { name } }
              }
            }
          }
        }
      }
    `;

    new Notice(`${useAuth ? '📥 Full' : '📥 Public'} export started…`, 3000);
    const progress = this.createProgressNotice('📊 Exporting… 0 %');
    const fetchType = async type => {
      const headers = { 'Content-Type': 'application/json' };
      if (useAuth) {
        await this.plugin.auth.ensureValidToken();
        headers['Authorization'] = `Bearer ${this.plugin.settings.accessToken}`;
      }

      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: query.replace('type: ANIME', `type: ${type}`),
            variables: { userName: username }
          })
        })
      );
      const percent = type === 'ANIME' ? 33 : 66;
      this.updateProgressNotice(progress, `📊 Exporting… ${percent} %`);
      return res.json.data?.MediaListCollection?.lists || [];
    };

    const [animeLists, mangaLists] = await Promise.all([fetchType('ANIME'), fetchType('MANGA')]);
    
    if (!animeLists.flatMap(l => l.entries).length && !mangaLists.flatMap(l => l.entries).length) {
      new Notice('No lists found (private or empty).', 3000);
      return;
    }

    this.updateProgressNotice(progress, '📊 Generating standard export files...');

    const folderPath = await this.ensureZoroFolder();

    await this.createAniListUnifiedCSV([...animeLists, ...mangaLists], folderPath);

    if (animeLists.flatMap(l => l.entries).length > 0) {
      await this.createAniListAnimeXML(animeLists, folderPath);
    }

    if (mangaLists.flatMap(l => l.entries).length > 0) {
      await this.createAniListMangaXML(mangaLists, folderPath);
    }

    const totalItems = [...animeLists, ...mangaLists].flatMap(l => l.entries).length;
    const fileCount = 1 + (animeLists.flatMap(l => l.entries).length > 0 ? 1 : 0) + (mangaLists.flatMap(l => l.entries).length > 0 ? 1 : 0);
    
    this.finishProgressNotice(progress, `✅ Exported ${totalItems} items in ${fileCount} files`);
    new Notice(`✅ AniList export complete! Created ${fileCount} files`, 3000);
  }

  async createAniListUnifiedCSV(lists, folderPath) {
    const rows = [];
    const headers = [
      'ListName', 'Status', 'Progress', 'Score', 'Repeat',
      'StartedAt', 'CompletedAt', 'MediaID', 'Type', 'Format',
      'TitleRomaji', 'TitleEnglish', 'TitleNative',
      'Episodes', 'Chapters', 'Volumes',
      'MediaStart', 'MediaEnd', 'AverageScore', 'Genres', 'MainStudio', 'URL','MAL_ID'
    ];
    rows.push(headers.join(','));

    for (const list of lists) {
      for (const e of list.entries) {
        const m = e.media;
        const row = [
          list.name, e.status, e.progress ?? 0, e.score ?? '', e.repeat ?? 0,
          this.dateToString(e.startedAt), this.dateToString(e.completedAt),
          m.id, m.type, m.format,
          this.csvEscape(m.title.romaji), this.csvEscape(m.title.english), this.csvEscape(m.title.native),
          m.episodes ?? '', m.chapters ?? '', m.volumes ?? '',
          this.dateToString(m.startDate), this.dateToString(m.endDate),
          m.averageScore ?? '', this.csvEscape((m.genres || []).join(';')),
          this.csvEscape(m.studios?.nodes?.[0]?.name || ''),
          this.csvEscape(this.plugin.getAniListUrl(m.id, m.type)), m.idMal ?? ''
        ];
        rows.push(row.join(','));
      }
    }

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_AniList_Unified.csv`;
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[AniList Export] Unified CSV created successfully');
    await this.plugin.app.workspace.openLinkText(fileName, '', false);
  }

  async createAniListAnimeXML(animeLists, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>1</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let animeXml = '';
    
    for (const list of animeLists) {
      for (const entry of list.entries) {
        const media = entry.media;
        const malStatus = this.mapAniListToMalStatus(entry.status);
        const score = entry.score || 0;
        const episodes = entry.progress || 0;
        const malId = media.idMal || 0;
        
        const startDate = this.aniListDateToString(entry.startedAt);
        const finishDate = entry.status === 'COMPLETED' ? this.aniListDateToString(entry.completedAt) : '';
        
        const animeType = this.getAniListAnimeType(media.format);
        
        animeXml += `
  <anime>
    <series_animedb_id>${malId}</series_animedb_id>
    <series_title><![CDATA[${media.title.english || media.title.romaji || media.title.native || ''}]]></series_title>
    <series_type>${animeType}</series_type>
    <series_episodes>${media.episodes || 0}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${episodes}</my_watched_episodes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[Imported from AniList - List: ${list.name}]]></my_comments>
    <my_times_watched>${entry.repeat || 0}</my_times_watched>
    <my_rewatch_value></my_rewatch_value>
    <my_priority>LOW</my_priority>
    <my_tags><![CDATA[${(media.genres || []).join(', ')}]]></my_tags>
    <my_rewatching>0</my_rewatching>
    <my_rewatching_ep>0</my_rewatching_ep>
    <update_on_import>1</update_on_import>
  </anime>`;
      }
    }

    const xml = xmlHeader + animeXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_AniList_Anime.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[AniList Export] Anime MAL XML created successfully');
  }

  async createAniListMangaXML(mangaLists, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>2</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let mangaXml = '';
    
    for (const list of mangaLists) {
      for (const entry of list.entries) {
        const media = entry.media;
        const malStatus = this.mapAniListToMalStatus(entry.status);
        const score = entry.score || 0;
        const chapters = entry.progress || 0;
        const malId = media.idMal || 0;
        
        const startDate = this.aniListDateToString(entry.startedAt);
        const finishDate = entry.status === 'COMPLETED' ? this.aniListDateToString(entry.completedAt) : '';
        
        const mangaType = this.getAniListMangaType(media.format);
        
        mangaXml += `
  <manga>
    <series_mangadb_id>${malId}</series_mangadb_id>
    <series_title><![CDATA[${media.title.english || media.title.romaji || media.title.native || ''}]]></series_title>
    <series_type>${mangaType}</series_type>
    <series_chapters>${media.chapters || 0}</series_chapters>
    <series_volumes>${media.volumes || 0}</series_volumes>
    <my_id>0</my_id>
    <my_read_chapters>${chapters}</my_read_chapters>
    <my_read_volumes>0</my_read_volumes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[Imported from AniList - List: ${list.name}]]></my_comments>
    <my_times_read>${entry.repeat || 0}</my_times_read>
    <my_reread_value></my_reread_value>
    <my_priority>LOW</my_priority>
    <my_tags><![CDATA[${(media.genres || []).join(', ')}]]></my_tags>
    <my_rereading>0</my_rereading>
    <my_rereading_chap>0</my_rereading_chap>
    <update_on_import>1</update_on_import>
  </manga>`;
      }
    }

    const xml = xmlHeader + mangaXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_AniList_Manga.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[AniList Export] Manga MAL XML created successfully');
  }

  mapAniListToMalStatus(anilistStatus) {
    const statusMap = {
      'CURRENT': 'Watching',
      'READING': 'Reading',
      'COMPLETED': 'Completed',
      'PAUSED': 'On-Hold',
      'DROPPED': 'Dropped',
      'PLANNING': 'Plan to Watch',
      'PLAN_TO_READ': 'Plan to Read'
    };
    return statusMap[anilistStatus] || 'Plan to Watch';
  }

  getAniListAnimeType(format) {
    if (!format) return 'TV';
    
    const typeMap = {
      'TV': 'TV',
      'TV_SHORT': 'TV',
      'MOVIE': 'Movie',
      'SPECIAL': 'Special',
      'OVA': 'OVA',
      'ONA': 'ONA',
      'MUSIC': 'Music'
    };
    
    return typeMap[format] || 'TV';
  }

  getAniListMangaType(format) {
    if (!format) return 'Manga';
    
    const typeMap = {
      'MANGA': 'Manga',
      'LIGHT_NOVEL': 'Light Novel',
      'ONE_SHOT': 'One-shot',
      'DOUJINSHI': 'Doujinshi',
      'MANHWA': 'Manhwa',
      'MANHUA': 'Manhua',
      'NOVEL': 'Novel'
    };
    
    return typeMap[format] || 'Manga';
  }

  aniListDateToString(dateObj) {
    if (!dateObj || !dateObj.year) return '0000-00-00';
    const month = String(dateObj.month || 0).padStart(2, '0');
    const day = String(dateObj.day || 0).padStart(2, '0');
    return `${dateObj.year}-${month}-${day}`;
  }
  
  async exportMALListsToCSV() {
    if (!this.plugin.malAuth.isLoggedIn) {
      new Notice('❌ Please authenticate with MyAnimeList first.', 3000);
      return;
    }

    const username = this.plugin.settings.malUserInfo?.name;
    if (!username) {
      new Notice('❌ Could not fetch MAL username.', 3000);
      return;
    }

    new Notice('📥 Exporting MyAnimeList…', 3000);
    const progress = this.createProgressNotice('📊 MAL export 0 %');

    const fetchType = async type => {
      const headers = this.plugin.malAuth.getAuthHeaders();
      const apiType = type === 'ANIME' ? 'anime' : 'manga';
      const url = `https://api.myanimelist.net/v2/users/@me/${apiType}list?fields=list_status{status,score,num_episodes_watched,num_chapters_read,is_rewatching,num_times_rewatched,rewatch_value,start_date,finish_date,priority,num_times_reread,comments,tags},node{id,title,media_type,status,num_episodes,num_chapters,num_volumes,start_season,source,rating,mean,genres}&limit=1000&nsfw=true`;

      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({ url, method: 'GET', headers })
      );
      
      const items = (res.json?.data || []).map(item => ({
        ...item,
        _type: type
      }));
      
      const percent = type === 'ANIME' ? 33 : 66;
      this.updateProgressNotice(progress, `📊 MAL export ${percent} %`);
      return items;
    };

    const [anime, manga] = await Promise.all([
      fetchType('ANIME'),
      fetchType('MANGA')
    ]);

    if (anime.length === 0 && manga.length === 0) {
      new Notice('No MAL data found.', 3000);
      return;
    }

    this.updateProgressNotice(progress, '📊 Generating standard export files...');

    const folderPath = await this.ensureZoroFolder();

    await this.createMALUnifiedCSV([...anime, ...manga], folderPath);

    if (anime.length > 0) {
      await this.createMALAnimeXML(anime, folderPath);
    }

    if (manga.length > 0) {
      await this.createMALMangaXML(manga, folderPath);
    }

    const totalItems = anime.length + manga.length;
    const fileCount = 1 + (anime.length > 0 ? 1 : 0) + (manga.length > 0 ? 1 : 0);
    
    this.finishProgressNotice(progress, `✅ Exported ${totalItems} items in ${fileCount} files`);
    new Notice(`✅ MAL export complete! Created ${fileCount} files`, 3000);
  }

  async createMALUnifiedCSV(allItems, folderPath) {
    const rows = [];
    const headers = [
      'Type','Status','Progress','Score','Title','Start','End','Episodes','Chapters','Mean','MAL_ID','URL'
    ];
    rows.push(headers.join(','));

    allItems.forEach(item => {
      const m = item.node;
      const s = item.list_status;
      const type = item._type;
      rows.push([
        type,
        s.status,
        s.num_episodes_watched || s.num_chapters_read || 0,
        s.score || '',
        this.csvEscape(m.title),
        this.malDateToString(s.start_date),
        this.malDateToString(s.finish_date),
        m.num_episodes || '',
        m.num_chapters || '',
        m.mean || '',
        m.id,
        this.csvEscape(`https://myanimelist.net/${type.toLowerCase()}/${m.id}`)
      ].join(','));
    });

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_MAL_Unified.csv`;
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[MAL Export] Unified CSV created successfully');
    await this.plugin.app.workspace.openLinkText(fileName, '', false);
  }

  async createMALAnimeXML(animeItems, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>1</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let animeXml = '';
    
    animeItems.forEach(item => {
      const media = item.node;
      const listStatus = item.list_status;
      
      const malStatus = this.mapMALStatusToXML(listStatus.status, 'anime');
      const score = listStatus.score || 0;
      const episodes = listStatus.num_episodes_watched || 0;
      const malId = media.id;
      
      const startDate = this.malDateToString(listStatus.start_date);
      const finishDate = this.malDateToString(listStatus.finish_date);
      
      const animeType = this.getMALAnimeType(media.media_type);
      
      animeXml += `
  <anime>
    <series_animedb_id>${malId}</series_animedb_id>
    <series_title><![CDATA[${media.title || ''}]]></series_title>
    <series_type>${animeType}</series_type>
    <series_episodes>${media.num_episodes || 0}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${episodes}</my_watched_episodes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[${listStatus.comments || ''}]]></my_comments>
    <my_times_watched>${listStatus.num_times_rewatched || 0}</my_times_watched>
    <my_rewatch_value>${listStatus.rewatch_value || ''}</my_rewatch_value>
    <my_priority>${this.mapMALPriority(listStatus.priority)}</my_priority>
    <my_tags><![CDATA[${this.formatMALTags(listStatus.tags, media.genres)}]]></my_tags>
    <my_rewatching>${listStatus.is_rewatching ? 1 : 0}</my_rewatching>
    <my_rewatching_ep>0</my_rewatching_ep>
    <update_on_import>1</update_on_import>
  </anime>`;
    });

    const xml = xmlHeader + animeXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_MAL_Anime.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[MAL Export] Anime XML created successfully');
  }

  async createMALMangaXML(mangaItems, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>2</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let mangaXml = '';
    
    mangaItems.forEach(item => {
      const media = item.node;
      const listStatus = item.list_status;
      
      const malStatus = this.mapMALStatusToXML(listStatus.status, 'manga');
      const score = listStatus.score || 0;
      const chapters = listStatus.num_chapters_read || 0;
      const malId = media.id;
      
      const startDate = this.malDateToString(listStatus.start_date);
      const finishDate = this.malDateToString(listStatus.finish_date);
      
      const mangaType = this.getMALMangaType(media.media_type);
      
      mangaXml += `
  <manga>
    <series_mangadb_id>${malId}</series_mangadb_id>
    <series_title><![CDATA[${media.title || ''}]]></series_title>
    <series_type>${mangaType}</series_type>
    <series_chapters>${media.num_chapters || 0}</series_chapters>
    <series_volumes>${media.num_volumes || 0}</series_volumes>
    <my_id>0</my_id>
    <my_read_chapters>${chapters}</my_read_chapters>
    <my_read_volumes>0</my_read_volumes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[${listStatus.comments || ''}]]></my_comments>
    <my_times_read>${listStatus.num_times_reread || 0}</my_times_read>
    <my_reread_value></my_reread_value>
    <my_priority>${this.mapMALPriority(listStatus.priority)}</my_priority>
    <my_tags><![CDATA[${this.formatMALTags(listStatus.tags, media.genres)}]]></my_tags>
    <my_rereading>0</my_rereading>
    <my_rereading_chap>0</my_rereading_chap>
    <update_on_import>1</update_on_import>
  </manga>`;
    });

    const xml = xmlHeader + mangaXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_MAL_Manga.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[MAL Export] Manga XML created successfully');
  }

  mapMALStatusToXML(malStatus, type) {
    const animeStatusMap = {
      'watching': 'Watching',
      'completed': 'Completed',
      'on_hold': 'On-Hold',
      'dropped': 'Dropped',
      'plan_to_watch': 'Plan to Watch'
    };

    const mangaStatusMap = {
      'reading': 'Reading',
      'completed': 'Completed',
      'on_hold': 'On-Hold',
      'dropped': 'Dropped',
      'plan_to_read': 'Plan to Read'
    };

    const statusMap = type === 'anime' ? animeStatusMap : mangaStatusMap;
    return statusMap[malStatus] || (type === 'anime' ? 'Plan to Watch' : 'Plan to Read');
  }

  getMALAnimeType(mediaType) {
    if (!mediaType) return 'TV';
    
    const typeMap = {
      'tv': 'TV',
      'movie': 'Movie',
      'ova': 'OVA',
      'special': 'Special',
      'ona': 'ONA',
      'music': 'Music'
    };
    
    return typeMap[mediaType.toLowerCase()] || 'TV';
  }

  getMALMangaType(mediaType) {
    if (!mediaType) return 'Manga';
    
    const typeMap = {
      'manga': 'Manga',
      'novel': 'Novel',
      'light_novel': 'Light Novel',
      'one_shot': 'One-shot',
      'doujinshi': 'Doujinshi',
      'manhwa': 'Manhwa',
      'manhua': 'Manhua'
    };
    
    return typeMap[mediaType.toLowerCase()] || 'Manga';
  }

  mapMALPriority(priority) {
    const priorityMap = {
      0: 'LOW',
      1: 'MEDIUM', 
      2: 'HIGH'
    };
    return priorityMap[priority] || 'LOW';
  }

  formatMALTags(userTags, genres) {
    const tags = [];
    
    if (userTags && Array.isArray(userTags)) {
      tags.push(...userTags);
    }
    
    if (genres && Array.isArray(genres)) {
      tags.push(...genres.map(genre => genre.name || genre));
    }
    
    return tags.join(', ');
  }

  malDateToString(dateStr) {
    if (!dateStr) return '0000-00-00';
    return dateStr;
  }

  async exportSimklListsToCSV() {
    if (!this.plugin.simklAuth.isLoggedIn) {
      new Notice('❌ Please authenticate with SIMKL first.', 3000);
      return;
    }

    const username = this.plugin.settings.simklUserInfo?.user?.name;
    if (!username) {
      new Notice('❌ Could not fetch SIMKL username.', 3000);
      return;
    }

    console.log('[SIMKL Export] Starting export for user:', username);
    new Notice('📥 Exporting SIMKL data…', 3000);
    const progress = this.createProgressNotice('📊 Fetching SIMKL data...');

    try {
      this.updateProgressNotice(progress, '📊 Fetching all items...');
      
      const allItemsUrl = 'https://api.simkl.com/sync/all-items/';
      console.log('[SIMKL Export] Fetching from:', allItemsUrl);

      const allItemsRes = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: allItemsUrl,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.plugin.settings.simklAccessToken}`,
            'simkl-api-key': this.plugin.settings.simklClientId,
            'Content-Type': 'application/json'
          },
          throw: false
        })
      );

      console.log('[SIMKL Export] Response status:', allItemsRes.status);
      console.log('[SIMKL Export] Response data:', allItemsRes.json);

      if (allItemsRes.status !== 200) {
        throw new Error(`Failed to fetch data: HTTP ${allItemsRes.status}`);
      }

      const data = allItemsRes.json || {};
      console.log('[SIMKL Export] Data keys:', Object.keys(data));
      console.log('[SIMKL Export] Data structure:', data);

      const allItems = [];
      let totalItemsFound = 0;

      Object.keys(data).forEach(category => {
        console.log(`[SIMKL Export] Processing category: ${category}`);
        
        if (data[category] && Array.isArray(data[category])) {
          console.log(`[SIMKL Export] Found ${data[category].length} items in ${category}`);
          totalItemsFound += data[category].length;
          
          data[category].forEach(item => {
            allItems.push({
              ...item,
              _category: category,
              _type: this.determineItemType(item, category)
            });
          });
        } else if (data[category] && typeof data[category] === 'object') {
          console.log(`[SIMKL Export] ${category} has subcategories:`, Object.keys(data[category]));
          
          Object.keys(data[category]).forEach(status => {
            if (Array.isArray(data[category][status])) {
              console.log(`[SIMKL Export] Found ${data[category][status].length} items in ${category}.${status}`);
              totalItemsFound += data[category][status].length;
              
              data[category][status].forEach(item => {
                allItems.push({
                  ...item,
                  _category: category,
                  _status: status,
                  _type: this.determineItemType(item, category)
                });
              });
            }
          });
        }
      });

      console.log('[SIMKL Export] Total items processed:', allItems.length);
      console.log('[SIMKL Export] Total items found:', totalItemsFound);

      if (allItems.length === 0) {
        console.log('[SIMKL Export] No items found after processing');
        this.finishProgressNotice(progress, '❌ No data found');
        new Notice('No SIMKL data found after processing.', 3000);
        return;
      }

      const animeItems = allItems.filter(item => 
        item._category === 'anime' || 
        item._type === 'ANIME' ||
        (item.show && item.show.type === 'anime')
      );
      
      const moviesTvItems = allItems.filter(item => 
        item._category === 'movies' || 
        item._category === 'shows' ||
        item._type === 'MOVIE' || 
        item._type === 'SHOW' ||
        item.movie || 
        (item.show && item.show.type !== 'anime')
      );

      this.updateProgressNotice(progress, '📊 Generating standard export files...');

      const folderPath = await this.ensureZoroFolder();

      await this.createSimklUnifiedCSV(allItems, folderPath);

      if (moviesTvItems.length > 0) {
        await this.createSimklImdbCSV(moviesTvItems, folderPath);
      }

      if (animeItems.length > 0) {
        await this.createSimklMalXML(animeItems, folderPath);
      }

      this.finishProgressNotice(progress, `✅ Exported ${allItems.length} items in multiple formats`);
      new Notice(`✅ SIMKL export complete! Created ${1 + (moviesTvItems.length > 0 ? 1 : 0) + (animeItems.length > 0 ? 1 : 0)} files`, 3000);

    } catch (error) {
      console.error('[SIMKL Export] Export failed:', error);
      this.finishProgressNotice(progress, `❌ Export failed: ${error.message}`);
      new Notice(`❌ SIMKL export failed: ${error.message}`, 3000);
    }
  }

  async createSimklUnifiedCSV(allItems, folderPath) {
    const headers = [
      'Category', 'Type', 'Title', 'Year', 'Status', 'Rating',
      'SIMKL_ID', 'IMDB_ID', 'TMDB_ID', 'MAL_ID', 'Anilist_ID'
    ];

    const rows = [headers.join(',')];
    
    allItems.forEach((item, index) => {
      const safeGet = (obj, path, fallback = '') => {
        try {
          return path.split('.').reduce((o, p) => (o && o[p]) || fallback, obj);
        } catch {
          return fallback;
        }
      };

      const mediaObject = item.show || item.movie || item.anime || {};
      
      const row = [
        item._category || '',
        item._type || '',
        this.csvEscape(mediaObject.title || mediaObject.name || ''),
        mediaObject.year || mediaObject.aired?.year || mediaObject.released?.year || '',
        item._status || item.status || '',
        item.user_rating || item.rating || item.score || '',
        safeGet(mediaObject, 'ids.simkl'),
        safeGet(mediaObject, 'ids.imdb'),
        safeGet(mediaObject, 'ids.tmdb'),
        safeGet(mediaObject, 'ids.mal'),
        safeGet(mediaObject, 'ids.anilist')
      ];
      
      rows.push(row.join(','));
    });

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_SIMKL_Unified.csv`;
    
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[SIMKL Export] Unified CSV created successfully');
    await this.plugin.app.workspace.openLinkText(fileName, '', false);
  }

  async createSimklImdbCSV(moviesTvItems, folderPath) {
    const headers = [
      'Const', 'Your Rating', 'Date Rated', 'Title', 'URL', 'Title Type', 
      'IMDb Rating', 'Runtime (mins)', 'Year', 'Genres', 'Num Votes', 
      'Release Date', 'Directors'
    ];

    const rows = [headers.join(',')];
    
    moviesTvItems.forEach(item => {
      const mediaObject = item.show || item.movie || {};
      const safeGet = (obj, path, fallback = '') => {
        try {
          return path.split('.').reduce((o, p) => (o && o[p]) || fallback, obj);
        } catch {
          return fallback;
        }
      };

      const dateRated = this.getDateFromStatus(item._status || item.status);
      const imdbId = safeGet(mediaObject, 'ids.imdb');
      const imdbUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/` : '';
      const titleType = item._category === 'movies' ? 'movie' : 'tvSeries';
      
      const row = [
        imdbId || '',
        item.user_rating || item.rating || item.score || '',
        dateRated,
        this.csvEscape(mediaObject.title || mediaObject.name || ''),
        this.csvEscape(imdbUrl),
        titleType,
        mediaObject.rating || '',
        mediaObject.runtime || '',
        mediaObject.year || mediaObject.aired?.year || mediaObject.released?.year || '',
        this.csvEscape((mediaObject.genres || []).join(', ')),
        '',
        this.formatReleaseDate(mediaObject.released || mediaObject.aired),
        this.csvEscape((mediaObject.directors || []).join(', '))
      ];
      
      rows.push(row.join(','));
    });

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_SIMKL_IMDb.csv`;
    
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[SIMKL Export] IMDb CSV created successfully');
  }

  async createSimklMalXML(animeItems, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>1</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let animeXml = '';
    
    animeItems.forEach(item => {
      const mediaObject = item.show || item.anime || {};
      const safeGet = (obj, path, fallback = '') => {
        try {
          return path.split('.').reduce((o, p) => (o && o[p]) || fallback, obj);
        } catch {
          return fallback;
        }
      };

      const malStatus = this.mapSimklToMalStatus(item._status || item.status);
      const score = item.user_rating || item.rating || item.score || 0;
      const episodes = this.getSimklProgress(item);
      const malId = safeGet(mediaObject, 'ids.mal');
      
      const startDate = this.getDateFromStatus(item._status || item.status, 'start');
      const finishDate = malStatus === 'Completed' ? this.getDateFromStatus(item._status || item.status, 'finish') : '';
      
      animeXml += `
  <anime>
    <series_animedb_id>${malId || 0}</series_animedb_id>
    <series_title><![CDATA[${mediaObject.title || mediaObject.name || ''}]]></series_title>
    <series_type>${this.getAnimeType(mediaObject)}</series_type>
    <series_episodes>${mediaObject.episodes || 0}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${episodes}</my_watched_episodes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[Imported from SIMKL]]></my_comments>
    <my_times_watched>0</my_times_watched>
    <my_rewatch_value></my_rewatch_value>
    <my_priority>LOW</my_priority>
    <my_tags><![CDATA[]]></my_tags>
    <my_rewatching>0</my_rewatching>
    <my_rewatching_ep>0</my_rewatching_ep>
    <update_on_import>1</update_on_import>
  </anime>`;
    });

    const xml = xmlHeader + animeXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_SIMKL_MAL.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[SIMKL Export] MAL XML created successfully');
  }

  mapSimklToMalStatus(simklStatus) {
    const statusMap = {
      'watching': 'Watching',
      'completed': 'Completed',
      'plantowatch': 'Plan to Watch',
      'hold': 'On-Hold',
      'dropped': 'Dropped'
    };
    return statusMap[simklStatus?.toLowerCase()] || 'Plan to Watch';
  }

  getAnimeType(mediaObject) {
    if (!mediaObject.type) return 'TV';
    
    const typeMap = {
      'tv': 'TV',
      'movie': 'Movie',
      'ova': 'OVA',
      'ona': 'ONA',
      'special': 'Special',
      'music': 'Music'
    };
    
    return typeMap[mediaObject.type.toLowerCase()] || 'TV';
  }

  getDateFromStatus(status, type = 'rated') {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const currentDay = String(now.getDate()).padStart(2, '0');
    
    if (status === 'completed' && type === 'finish') {
      return `${currentYear}-${currentMonth}-${currentDay}`;
    } else if (type === 'start' && (status === 'watching' || status === 'completed')) {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      return `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    } else if (type === 'rated') {
      return `${currentYear}-${currentMonth}-${currentDay}`;
    }
    
    return '';
  }

  formatReleaseDate(dateObj) {
    if (!dateObj) return '';
    if (typeof dateObj === 'string') return dateObj;
    if (dateObj.year) {
      const month = String(dateObj.month || 1).padStart(2, '0');
      const day = String(dateObj.day || 1).padStart(2, '0');
      return `${dateObj.year}-${month}-${day}`;
    }
    return '';
  }

  xmlEscape(str) {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  determineItemType(item, category) {
    if (item.type) {
      return item.type.toUpperCase();
    }
    
    if (category) {
      return category.toUpperCase();
    }
    
    return 'UNKNOWN';
  }

  mapSimklStatus(simklStatus) {
    const statusMap = {
      'watching': 'CURRENT',
      'completed': 'COMPLETED', 
      'plantowatch': 'PLANNING',
      'hold': 'PAUSED',
      'dropped': 'DROPPED'
    };
    return statusMap[simklStatus] || simklStatus.toUpperCase();
  }

  getSimklProgress(item) {
    if (!item) return 0;

    const watched = (item.watched_episodes_count ?? item.watched_episodes ?? item.episodes_watched ?? item.progress);
    if (watched !== undefined && watched !== null && watched !== '') {
      const n = Number(watched);
      if (!isNaN(n)) return n;
    }

    const total = (item.total_episodes_count ?? item.total_episodes ?? item.episodes);
    if (item.seasons_watched && total) {
      const episodesPerSeason = Number(total) / (item.seasons || 1);
      return Math.floor(Number(item.seasons_watched) * episodesPerSeason);
    }

    const t = String(item._type || item.type || '').toLowerCase();
    if (t === 'movie' || item.media_type === 'movie') {
      return (String(item._status || item.status || '').toLowerCase() === 'completed') ? 1 : 0;
    }

    return Number(item.seasons_watched) || 0;
  }

  getSimklUrl(apiType, simklId, title) {
    if (!simklId) return '';
    
    const baseUrl = 'https://simkl.com';
    const urlType = apiType === 'anime' ? 'anime' : 
                   apiType === 'movies' ? 'movies' : 'tv';
    
    return `${baseUrl}/${urlType}/${simklId}`;
  }

  dateToString(dateObj) {
    if (!dateObj || !dateObj.year) return '';
    return `${dateObj.year}-${String(dateObj.month || 0).padStart(2, '0')}-${String(dateObj.day || 0).padStart(2, '0')}`;
  }

  csvEscape(str = '') {
    if (typeof str !== 'string') str = String(str);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
  
  createProgressNotice(message) {
    return new Notice(message, 0);
  }

  updateProgressNotice(notice, message) {
    notice.hide();
    return new Notice(message, 0);
  }

  finishProgressNotice(notice, message) {
    notice.hide();
    new Notice(message, 3000);
  }
}

class Sample {
    constructor(plugin) {
        this.plugin = plugin;
    }

    async createSampleFolders() {
        new Notice('Creating…', 3000);
        const vault = this.plugin.app.vault;
        const parentFolder = 'Zoro';
        
        const folders = [
            {
                name: 'Anime',
                files: ['Watching.md', 'Planning.md', 'Re-watching .md', 'On Hold.md', 'Completed.md', 'Dropped.md',
                'Trending.md','Stats.md'],
                firstFile: 'Watching.md'
            },
            {
                name: 'Manga', 
                files: ['Reading.md', 'Planning.md', 'Re-reading.md', 'On Hold.md', 'Completed.md', 'Dropped.md','Trending.md', 'Stats.md'],
                firstFile: 'Reading.md'
            }
        ];

        if (!vault.getAbstractFileByPath(parentFolder)) {
            await vault.createFolder(parentFolder);
        }

        for (const folder of folders) {
            const folderPath = parentFolder + '/' + folder.name;
            
            if (vault.getAbstractFileByPath(folderPath)) {
                new Notice('⏭️ ' + folder.name + ' already exists in ' + parentFolder);
                continue;
            }

            const baseUrl = 'https://raw.githubusercontent.com/zara-kasi/zoro/main/Template/' + 
                           encodeURIComponent(folder.name) + '/';

            await vault.createFolder(folderPath);
            let successfulFiles = 0;

            for (const templateFile of folder.files) {
                try {
                    const fileUrl = baseUrl + encodeURIComponent(templateFile);
                    const response = await fetch(fileUrl);
                    
                    if (!response.ok) {
                        continue;
                    }

                    const content = await response.text();
                    const filePath = folderPath + '/' + templateFile;
                    
                    await vault.create(filePath, content);
                    successfulFiles++;
                    
                } catch (error) {
                    continue;
                }
            }

            new Notice('✅ ' + folder.name + ' in ' + parentFolder + ' (' + successfulFiles + ' files)');

            if (successfulFiles > 0) {
                this.plugin.app.workspace.openLinkText(folder.firstFile, folderPath, false);
            }
        }
    }
}
class ZoroSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty()

    const section = (title, startOpen = false) => {
      const head = containerEl.createEl('h2', { text: title });
      head.style.cursor = 'pointer';
      head.style.userSelect = 'none';
      head.style.margin = '1.2em 0 0.4em 0';
      const body = containerEl.createDiv();
      body.style.marginLeft = '1em';
      body.style.display = startOpen ? 'block' : 'none';
      head.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });
      return body;
    };

    const Account = section('👤 Account');
    const Setup = section('🧭 Setup');
    const Display = section('📺 Display');
    const Theme = section('🌓 Theme');
    const Note = section('🗒️ Note');
    const More = section('✨  More');
    const Data = section('💾 Data');
    const Cache = section('🔁 Cache');
    const Exp = section('🚧 Beta');
    const About = section('ℹ️ About');

    new Setting(Account)
      .setName('🆔 Public profile')
      .setDesc("View your AniList profile and stats — no login needed.")
      .addText(text => text
        .setPlaceholder('AniList username')
        .setValue(this.plugin.settings.defaultUsername)
        .onChange(async (value) => {
          this.plugin.settings.defaultUsername = value.trim();
          await this.plugin.saveSettings();
        }));

    const authSetting = new Setting(Account)
      .setName('✳️ AniList')
      .setDesc('Lets you peek at your private profile and actually change stuff.');

    authSetting.addButton(button => {
      this.authButton = button;
      this.updateAuthButton();
      button.onClick(async () => {
        await this.handleAuthButtonClick();
      });
    });
    
    const malAuthSetting = new Setting(Account)
      .setName('🗾 MyAnimeList')
      .setDesc('Lets you edit and view your MAL entries.');

    malAuthSetting.addButton(btn => {
      this.malAuthButton = btn;
      this.updateMALAuthButton();
      btn.onClick(async () => {
        await this.handleMALAuthButtonClick();
      });
    });
    
    new Setting(Setup)
      .setName('⚡ Sample Folder')
      .setDesc('(Recommended)')
      .addButton(button =>
        button
          .setButtonText('Create')
          .onClick(async () => {
            await this.plugin.sample.createSampleFolders();
          })
      );
    
    new Setting(Setup)
      .setName('🗝️ Authentication ?')
      .setDesc('Guide: Takes less than a minute—no typing, just copy and paste.')
      .addButton(button => button
        .setButtonText('AniList')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md', '_blank');
        }));
        new Setting(Setup)
        .addButton(button => button
        .setButtonText('MAL')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/8d432f1b3d648e1f9ddc1698676f21483472a427/Docs/mal-auth-setup.md', '_blank');
        }));
        

    new Setting(Display)
      .setName('🧊 Layout')
      .setDesc('Choose the default layout for media lists')
      .addDropdown(dropdown => dropdown
        .addOption('card', 'Card Layout')
        .addOption('table', 'Table Layout')
        .setValue(this.plugin.settings.defaultLayout)
        .onChange(async (value) => {
          this.plugin.settings.defaultLayout = value;
          await this.plugin.saveSettings();
        }));

    new Setting(Display)
      .setName('🔲 Grid Columns')
      .setDesc('Number of columns in card grid layout')
      .addSlider(slider => slider
        .setLimits(1, 6, 1)
        .setValue(this.plugin.settings.gridColumns)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.gridColumns = value;
          await this.plugin.saveSettings();
          this.updateGridColumns(value);
        }));
        
        new Setting(Note)
      .setName('🗂️ Note path')
      .setDesc('Folder path where new connected notes will be created')
      .addText(text => text
        .setPlaceholder('folder/subfolder')
        .setValue(this.plugin.settings.notePath || '')
        .onChange(async (value) => {
          let cleanPath = value.trim();
          if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
          }
          if (cleanPath.endsWith('/')) {
            cleanPath = cleanPath.substring(0, cleanPath.length - 1);
          }
          
          this.plugin.settings.notePath = cleanPath;
          await this.plugin.saveSettings();
        }));
        
        new Setting(Note)
  .setName('🎴 Media block')
.setDesc('Auto-insert cover, rating, and details in new notes')
  .addToggle(toggle => toggle
    .setValue(this.plugin.settings.insertCodeBlockOnNote)
    .onChange(async (value) => {
      this.plugin.settings.insertCodeBlockOnNote = value;
      await this.plugin.saveSettings();
    }));
        
        new Setting(More)
      .setName('⏳ Loading Icon')
      .setDesc('Show loading animation during API requests')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showLoadingIcon)
        .onChange(async (value) => {
          this.plugin.settings.showLoadingIcon = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🔗 Plain Titles')
      .setDesc('Show titles as plain text instead of clickable links.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.hideUrlsInTitles)
        .onChange(async (value) => {
          this.plugin.settings.hideUrlsInTitles = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🌆 Cover')
      .setDesc('Display cover images for anime/manga')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCoverImages)
        .onChange(async (value) => {
          this.plugin.settings.showCoverImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('⭐ Ratings')
      .setDesc('Display user ratings/scores')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showRatings)
        .onChange(async (value) => {
          this.plugin.settings.showRatings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('📈 Progress')
      .setDesc('Display progress information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgress)
        .onChange(async (value) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🎭 Genres')
      .setDesc('Display genre tags')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(More)
      .setName('🧮 Score Scale')
      .setDesc('Ensures all ratings use the 0–10 point scale.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.forceScoreFormat)
        .onChange(async (value) => {
          this.plugin.settings.forceScoreFormat = value;
          await this.plugin.saveSettings();
          if (value && this.plugin.auth.isLoggedIn) {
            await this.plugin.auth.forceScoreFormat();
          }
        }));
    
    new Setting(Data)
      .setName('📤 Export your data')
      .setDesc("Everything you've watched, rated, and maybe ghosted — neatly exported into a CSV & standard export format from AniList, MAL and Simkl.")
      .addButton(btn => btn
        .setButtonText('AniList')
        .setClass('mod-cta')
        .onClick(async () => {
          try {
            await this.plugin.export.exportUnifiedListsToCSV();
          } catch (err) {
            new Notice(`❌ Export failed: ${err.message}`, 6000);
          }
        })
      );
      
    new Setting(Data)
      .addButton(btn => btn
        .setButtonText('MAL')
        .setClass('mod-cta')
        .onClick(async () => {
          try {
            await this.plugin.export.exportMALListsToCSV();
          } catch (err) {
            new Notice(`❌ MAL export failed: ${err.message}`, 6000);
          }
        })
      );
  
    new Setting(Data)
      .addButton(btn => btn
        .setButtonText('SIMKL')
        .setClass('mod-cta')
        .onClick(async () => {
          if (!this.plugin.simklAuth.isLoggedIn) {
            new Notice('❌ Please authenticate with SIMKL first.', 4000);
            return;
          }
          
          btn.setDisabled(true);
          btn.setButtonText('Exporting...');
          
          try {
            await this.plugin.export.exportSimklListsToCSV();
          } catch (err) {
            new Notice(`❌ SIMKL export failed: ${err.message}`, 6000);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText('SIMKL');
          }
        })
      );
      
      new Setting(Data)
      .setName('🧾 Export Guide')
      .setDesc('Export guide for AniList, MAL, and SIMKL data backup and migration. Creates CSV/XML files for cross-platform compatibility.')
      .addButton(button =>
        button
          .setClass('mod-cta')
          .setButtonText('Open')
          .onClick(() => {
            window.open('https://github.com/zara-kasi/zoro/blob/main/Docs/export-doc.md', '_blank');
          })
      );
  
    new Setting(Theme)
      .setName('🎨 Apply')
      .setDesc('Choose from available themes')
      .addDropdown(async dropdown => {
        dropdown.addOption('', 'Default');
        const localThemes = await this.plugin.theme.getAvailableThemes();
        localThemes.forEach(t => dropdown.addOption(t, t));
        dropdown.setValue(this.plugin.settings.theme || '');
        dropdown.onChange(async name => {
          this.plugin.settings.theme = name;
          await this.plugin.saveSettings();
          await this.plugin.theme.applyTheme(name);
        });
      });

    new Setting(Theme)
      .setName('📥 Download')
      .setDesc('Download themes from GitHub repository')
      .addDropdown(dropdown => {
        dropdown.addOption('', 'Select');
        
        this.plugin.theme.fetchRemoteThemes().then(remoteThemes => {
          remoteThemes.forEach(t => dropdown.addOption(t, t));
        });
        
        dropdown.onChange(async name => {
          if (!name) return;
          
          const success = await this.plugin.theme.downloadTheme(name);
          if (success) {
            this.plugin.theme.showApplyButton(containerEl, name);
          }
          dropdown.setValue('');
        });
      });

    new Setting(Theme)
      .setName('🗑 Delete')
      .setDesc('Remove downloaded themes from local storage')
      .addDropdown(async dropdown => {
        dropdown.addOption('', 'Select');
        const localThemes = await this.plugin.theme.getAvailableThemes();
        localThemes.forEach(t => dropdown.addOption(t, t));
        
        dropdown.onChange(async name => {
          if (!name) return;
          
          const success = await this.plugin.theme.deleteTheme(name);
          if (success) {
            // If deleted theme was currently active, remove it
            if (this.plugin.settings.theme === name) {
              this.plugin.settings.theme = '';
              await this.plugin.saveSettings();
              await this.plugin.theme.applyTheme('');
            }
          }
          dropdown.setValue('');
        });
      });
      
      new Setting(Cache)
      .setName('📊 Cache Stats')
      .setDesc('Show live cache usage and hit-rate in a pop-up.')
      .addButton(btn => btn
        .setButtonText('Show Stats')
        .onClick(() => {
          const s = this.plugin.cache.getStats();
          new Notice(
            `Cache: ${s.hitRate} | ${s.cacheSize} entries | Hits ${s.hits} | Misses ${s.misses}`,
            8000
          );
          console.table(s);
        })
      );

    new Setting(Cache)
  .setName('🧹 Clear Cache')
  .setDesc('Delete all cached data (user, media, search results).')
  .addButton(btn => btn
    .setButtonText('Clear All Cache')
    .setWarning()
    .onClick(async () => {
      const cleared = await this.plugin.cache.clearAll();
      new Notice(`✅ Cache cleared (${cleared} entries)`, 3000);
    })
  );
      

    const simklAuthSetting = new Setting(Exp)
      .setName('🎬 SIMKL')
      .setDesc('Track and sync your anime/movie/TV show progress with SIMKL.');

    simklAuthSetting.addButton(btn => {
      this.simklAuthButton = btn;
      this.updateSimklAuthButton();
      btn.onClick(async () => {
        await this.handleSimklAuthButtonClick();
      });
    });
    
    new Setting(Exp)
      .setName('Default API Source')
      .setDesc('Choose which API to use by default when no source is specified in code blocks')
      .addDropdown(dropdown => dropdown
        .addOption('anilist', 'AniList')
        .addOption('mal', 'MyAnimeList')
        .addOption('simkl', 'SIMKL')
        .setValue(this.plugin.settings.defaultApiSource)
        .onChange(async (value) => {
          this.plugin.settings.defaultApiSource = value;
          this.plugin.settings.defaultApiUserOverride = true;
          await this.plugin.saveSettings();
        }));
  
    new Setting(Exp)
      .setName('Debug Mode')
      .setDesc('Enable detailed console logs and performance metrics')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode || false)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
          
          // Enable/disable debug across components
          this.plugin.api?.enableDebug?.(value);
          this.plugin.cache?.enableDebug?.(value);
          new Notice(`Debug mode ${value ? 'enabled' : 'disabled'}`, 2000);
        })
      );

    new Setting(About)
      .setName('Author')
      .setDesc(this.plugin.manifest.author);
    new Setting(About)
      .setName('Version')
      .setDesc(this.plugin.manifest.version);
    new Setting(About)
      .setName('Privacy')
      .setDesc('Zoro only talks to the APIs to fetch & update your media data. Nothing else is sent or shared—your data stays local.');

    new Setting(About)
      .setName('GitHub')
      .setDesc('Get more info or report an issue.')
      .addButton(button =>
        button
          .setClass('mod-cta')
          .setButtonText('Open GitHub')
          .onClick(() => {
            window.open('https://github.com/zara-kasi/zoro', '_blank');
          })
      );
  }

  updateAuthButton() {
    if (!this.authButton) return;
    const { settings } = this.plugin;
    if (!settings.clientId) {
      this.authButton.setButtonText('Enter Client ID');
      this.authButton.removeCta();
    } else if (!settings.clientSecret) {
      this.authButton.setButtonText('Enter Client Secret');
      this.authButton.removeCta();
    } else if (!settings.accessToken) {
      this.authButton.setButtonText('Authenticate Now');
      this.authButton.setCta();
    } else {
      this.authButton.setButtonText('Sign Out');
      this.authButton.setWarning().removeCta();
    }
  }

  async handleAuthButtonClick() {
    const { settings } = this.plugin;
    if (!settings.clientId) {
      const modal = AuthModal.clientId(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.clientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateAuthButton();
        }
      });
      modal.open();
    } else if (!settings.clientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret) => {
        if (clientSecret?.trim()) {
          settings.clientSecret = clientSecret.trim();
          await this.plugin.saveSettings();
          this.updateAuthButton();
        }
      });
      modal.open();
    } else if (!settings.accessToken) {
      await this.plugin.auth.loginWithFlow();
      this.updateAuthButton();
    } else {
      if (confirm('⚠️ Are you sure you want to sign out?')) {
        await this.plugin.auth.logout();
        this.updateAuthButton();
      }
    }
  }

  updateMALAuthButton() {
    if (!this.malAuthButton) return;
    const { settings } = this.plugin;
    if (!settings.malClientId) {
      this.malAuthButton.setButtonText('Enter Client ID');
      this.malAuthButton.removeCta();
    } else if (!settings.malClientSecret) {
      this.malAuthButton.setButtonText('Enter Client Secret');
      this.malAuthButton.removeCta();
    } else if (!settings.malAccessToken) {
      this.malAuthButton.setButtonText('Authenticate Now');
      this.malAuthButton.setCta();
    } else {
      this.malAuthButton.setButtonText('Sign Out');
      this.malAuthButton.setWarning().removeCta();
    }
  }

  async handleMALAuthButtonClick() {
    const { settings } = this.plugin;
    if (!settings.malClientId) {
      const modal = AuthModal.clientId(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.malClientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateMALAuthButton();
        }
      });
      modal.open();
    } else if (!settings.malClientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret) => {
        if (clientSecret?.trim()) {
          settings.malClientSecret = clientSecret.trim();
          await this.plugin.saveSettings();
          this.updateMALAuthButton();
        }
      });
      modal.open();
    } else if (!settings.malAccessToken) {
      await this.plugin.malAuth.loginWithFlow();
      this.updateMALAuthButton();
    } else {
      if (confirm('⚠️ Are you sure you want to sign out?')) {
        await this.plugin.malAuth.logout();
        this.updateMALAuthButton();
      }
    }
  }
  
  updateSimklAuthButton() {
    if (!this.simklAuthButton) return;
    const { settings } = this.plugin;
    if (!settings.simklClientId) {
      this.simklAuthButton.setButtonText('Enter Client ID');
      this.simklAuthButton.removeCta();
    } else if (!settings.simklClientSecret) {
      this.simklAuthButton.setButtonText('Enter Client Secret');
      this.simklAuthButton.removeCta();
    } else if (!settings.simklAccessToken) {
      this.simklAuthButton.setButtonText('Authenticate Now');
      this.simklAuthButton.setCta();
    } else {
      this.simklAuthButton.setButtonText('Sign Out');
      this.simklAuthButton.setWarning().removeCta();
    }
  }

  async handleSimklAuthButtonClick() {
    const { settings } = this.plugin;
    if (!settings.simklClientId) {
      const modal = AuthModal.clientId(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.simklClientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateSimklAuthButton();
        }
      });
      modal.open();
    } else if (!settings.simklClientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret) => {
        if (clientSecret?.trim()) {
          settings.simklClientSecret = clientSecret.trim();
          await this.plugin.saveSettings();
          this.updateSimklAuthButton();
        }
      });
      modal.open();
    } else if (!settings.simklAccessToken) {
      await this.plugin.simklAuth.loginWithFlow();
      this.updateSimklAuthButton();
    } else {
      if (confirm('⚠️ Are you sure you want to sign out?')) {
        await this.plugin.simklAuth.logout();
        this.updateSimklAuthButton();
      }
    }
  }
  
  updateGridColumns(value) {
  const gridElements = document.querySelectorAll('.zoro-cards-grid');
  gridElements.forEach(grid => {
    try {
      grid.style.setProperty('--zoro-grid-columns', String(value));
      grid.style.setProperty('--grid-cols', String(value));
    } catch {}
  });
}
}

module.exports = {
  default: ZoroPlugin,
};