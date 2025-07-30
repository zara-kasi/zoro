const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

const getDefaultGridColumns = () => {
  return window.innerWidth >= 768 ? 5 : 2;
};

const DEFAULT_SETTINGS = {
  defaultUsername: '',
  defaultLayout: 'card',
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
};

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
      userData: 30 * 60 * 1000, 
      mediaData: 10 * 60 * 1000, 
      searchResults: 2 * 60 * 1000, 
      mediaDetails: 60 * 60 * 1000, 
      malData: 60 * 60 * 1000, 
      ...ttlMap 
    };
    
    this.stores = { userData: new Map(), mediaData: new Map(), searchResults: new Map() };
    this.indexes = { byUser: new Map(), byMedia: new Map(), byTag: new Map() };
    
    Object.assign(this, {
      version: '3.1.0',
      maxSize,
      compressionThreshold,
      batchSize,
      obsidianPlugin,
      intervals: { prune: null, refresh: null, save: null },
      flags: { autoPrune: false, backgroundRefresh: false, debugMode: false },
      stats: { hits: 0, misses: 0, sets: 0, deletes: 0, evictions: 0, compressions: 0 },
      state: { loading: false, saving: false, lastSaved: null, lastLoaded: null },
      accessLog: new Map(),
      refreshCallbacks: new Map(),
      loadQueue: new Set(),
      saveQueue: new Set(),
      persistenceQueue: new Set(),
      lastPersistTime: 0,
      saveDebounceTimer: null,
      criticalSaveMode: false
    });
    
    if (this.obsidianPlugin) this.initializeCache();
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
      normalized[k] = input[k] ?? '';
    });
    return JSON.stringify(normalized);
  }

  structuredKey(scope, type, id, meta = {}) {
    return this.key({ __scope: scope, __type: type, __id: String(id), ...meta });
  }

  isExpired(entry, scope, customTtl = null) {
    const ttl = customTtl ?? entry.customTtl ?? this.ttlMap[scope] ?? 5 * 60 * 1000;
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
      const { userId, username, mediaId, tags } = JSON.parse(key);
      
      if (operation === 'delete') {
        this.removeFromIndexes(key, { userId, username, mediaId, tags });
        return;
      }

      this.addToIndex(this.indexes.byUser, userId || username, key);
      this.addToIndex(this.indexes.byMedia, mediaId, key);
      
      if (Array.isArray(tags)) {
        tags.forEach(tag => this.addToIndex(this.indexes.byTag, tag, key));
      }
    } catch {}
  }

  addToIndex(index, indexKey, key) {
    if (!indexKey) return;
    if (!index.has(indexKey)) index.set(indexKey, new Set());
    index.get(indexKey).add(key);
  }

  removeFromIndexes(key, { userId, username, mediaId, tags }) {
    this.removeFromIndex(this.indexes.byUser, userId || username, key);
    this.removeFromIndex(this.indexes.byMedia, mediaId, key);
    
    if (Array.isArray(tags)) {
      tags.forEach(tag => this.removeFromIndex(this.indexes.byTag, tag, key));
    }
  }

  removeFromIndex(index, indexKey, key) {
    if (!indexKey || !index.has(indexKey)) return;
    const set = index.get(indexKey);
    set.delete(key);
    if (set.size === 0) index.delete(indexKey);
  }

  enforceSize(scope) {
    const store = this.stores[scope];
    if (store.size <= this.maxSize) return 0;

    const entries = Array.from(store.entries())
      .map(([key, entry]) => ({ key, lastAccess: this.accessLog.get(key) || 0 }))
      .sort((a, b) => a.lastAccess - b.lastAccess)
      .slice(0, store.size - this.maxSize + this.batchSize);

    entries.forEach(({ key }) => {
      store.delete(key);
      this.updateIndexes(key, null, 'delete');
      this.accessLog.delete(key);
      this.stats.evictions++;
    });

    this.schedulePersistence();
    return entries.length;
  }

  get(key, options = {}) {
    const { scope = 'userData', ttl = null, refreshCallback = null } = options;
    const store = this.stores[scope];
    if (!store) { 
      this.stats.misses++; 
      return null; 
    }

    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    const entry = store.get(cacheKey);
    
    this.accessLog.set(cacheKey, Date.now());
    
    if (!entry) {
      this.stats.misses++;
      this.log('MISS', scope, cacheKey);
      this.maybeRefresh(cacheKey, scope, refreshCallback);
      return null;
    }

    if (this.isExpired(entry, scope, ttl)) {
      store.delete(cacheKey);
      this.updateIndexes(cacheKey, entry, 'delete');
      this.stats.misses++;
      this.log('EXPIRED', scope, cacheKey);
      this.maybeRefresh(cacheKey, scope, refreshCallback);
      this.schedulePersistence();
      return null;
    }

    this.stats.hits++;
    this.log('HIT', scope, cacheKey, Math.round((Date.now() - entry.timestamp) / 1000));
    
    if (this.shouldRefresh(entry, scope, ttl)) {
      const callback = this.refreshCallbacks.get(`${scope}:${cacheKey}`);
      if (callback) this.scheduleRefresh(cacheKey, scope, callback);
    }

    return this.decompress(entry);
  }

  set(key, value, options = {}) {
    const { scope = 'userData', ttl = null, tags = [], refreshCallback = null } = options;
    const store = this.stores[scope];
    if (!store) return false;

    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    const compressed = this.compress(value);
    
    const entry = {
      ...compressed,
      timestamp: Date.now(),
      customTtl: ttl,
      tags,
      accessCount: 1
    };

    store.set(cacheKey, entry);
    this.updateIndexes(cacheKey, entry);
    this.enforceSize(scope);
    
    this.stats.sets++;
    this.log('SET', scope, cacheKey, store.size);

    if (refreshCallback) {
      this.refreshCallbacks.set(`${scope}:${cacheKey}`, refreshCallback);
    }

    this.schedulePersistence(true);
    return true;
  }

  delete(key, options = {}) {
    const { scope = 'userData' } = options;
    const store = this.stores[scope];
    if (!store) return false;

    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    const entry = store.get(cacheKey);
    const deleted = store.delete(cacheKey);
    
    if (deleted) {
      this.updateIndexes(cacheKey, entry, 'delete');
      this.accessLog.delete(cacheKey);
      this.stats.deletes++;
      this.log('DELETE', scope, cacheKey);
      this.schedulePersistence();
    }
    
    return deleted;
  }

  invalidateByIndex(indexType, key) {
    const index = this.indexes[indexType];
    const keys = index?.get(key);
    if (!keys) return 0;

    let deleted = 0;
    keys.forEach(key => {
      Object.values(this.stores).forEach(store => {
        if (store.delete(key)) deleted++;
      });
      this.accessLog.delete(key);
    });

    index.delete(key);
    this.schedulePersistence();
    return deleted;
  }

  invalidateByUser(userKey) { return this.invalidateByIndex('byUser', userKey); }
  invalidateByMedia(mediaId) { return this.invalidateByIndex('byMedia', String(mediaId)); }
  invalidateByTag(tag) { return this.invalidateByIndex('byTag', tag); }

  clear(scope = null) {
    if (scope) {
      const store = this.stores[scope];
      if (!store) return 0;
      const count = store.size;
      store.clear();
      this.schedulePersistence();
      return count;
    }

    const total = Object.values(this.stores).reduce((sum, store) => {
      const size = store.size;
      store.clear();
      return sum + size;
    }, 0);
    
    Object.values(this.indexes).forEach(index => index.clear());
    this.accessLog.clear();
    this.refreshCallbacks.clear();
    
    this.log('CLEAR_ALL', 'all', '', total);
    this.schedulePersistence();
    return total;
  }

  pruneExpired(scope = null) {
    const scopes = scope ? [scope] : Object.keys(this.stores);
    let total = 0;
    const now = Date.now();

    scopes.forEach(currentScope => {
      const store = this.stores[currentScope];
      if (!store) return;

      const toDelete = [];
      for (const [key, entry] of store.entries()) {
        const ttl = entry.customTtl ?? this.ttlMap[currentScope];
        if ((now - entry.timestamp) > ttl) {
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

    if (total > 0) this.schedulePersistence();
    return total;
  }

  shouldRefresh(entry, scope, customTtl) {
    if (!this.flags.backgroundRefresh) return false;
    const ttl = customTtl ?? entry.customTtl ?? this.ttlMap[scope];
    return (Date.now() - entry.timestamp) > (ttl * 0.8);
  }

  maybeRefresh(key, scope, callback) {
    if (callback && typeof callback === 'function') {
      this.scheduleRefresh(key, scope, callback);
    }
  }

  scheduleRefresh(key, scope, callback) {
    const refreshKey = `${scope}:${key}`;
    if (this.loadQueue.has(refreshKey)) return;
    
    this.loadQueue.add(refreshKey);
    
    setTimeout(async () => {
      try {
        const newValue = await callback(key, scope);
        if (newValue !== undefined) {
          this.set(key, newValue, { scope, refreshCallback: callback });
        }
      } catch (error) {
        this.log('REFRESH_ERROR', scope, key, error.message);
      } finally {
        this.loadQueue.delete(refreshKey);
      }
    }, 0);
  }

  schedulePersistence(immediate = false) {
    if (immediate) this.criticalSaveMode = true;

    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);

    const delay = immediate ? 100 : 2000;
    this.saveDebounceTimer = setTimeout(() => this.saveToDisk(), delay);
  }

  startAutoPrune(interval = 5 * 60 * 1000) {
    this.stopAutoPrune();
    this.intervals.prune = setInterval(() => {
      const pruned = this.pruneExpired();
      if (pruned > 0) this.log('AUTO_PRUNE', 'system', '', `${pruned} entries pruned`);
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

  async saveWithMethod(adapter, pluginDir, payload) {
    const cachePath = `${pluginDir}/cache.json`;
    
    try {
      await adapter.write(cachePath, JSON.stringify(payload, null, 2));
      this.log('SAVE_SUCCESS', 'system', cachePath, 'Direct file write');
      return true;
    } catch (error) {
      this.log('SAVE_WARNING', 'system', 'cache.json', `Direct write failed: ${error.message}`);
    }

    try {
      const tempPath = `${pluginDir}/cache.tmp`;
      await adapter.write(tempPath, JSON.stringify(payload));
      
      try { await adapter.remove(cachePath); } catch {}
      await adapter.rename(tempPath, cachePath);
      
      this.log('SAVE_SUCCESS', 'system', cachePath, 'Atomic write');
      return true;
    } catch (error) {
      this.log('SAVE_WARNING', 'system', 'cache.tmp', `Atomic write failed: ${error.message}`);
      return false;
    }
  }

  async saveToDisk() {
    if (this.state.saving) return false;
    this.state.saving = true;

    try {
      const payload = {
        version: this.version,
        timestamp: Date.now(),
        stats: { ...this.stats },
        data: Object.fromEntries(
          Object.entries(this.stores).map(([scope, store]) => [scope, Array.from(store.entries())])
        ),
        indexes: Object.fromEntries(
          Object.entries(this.indexes).map(([type, index]) => 
            [type, Array.from(index.entries()).map(([k, v]) => [k, Array.from(v)])]
          )
        ),
        accessLog: Array.from(this.accessLog.entries())
      };

      const adapter = this.obsidianPlugin?.app?.vault?.adapter;
      if (adapter) {
        const pluginDir = this.obsidianPlugin.manifest.dir;
        const saved = await this.saveWithMethod(adapter, pluginDir, payload);
        
        if (saved) {
          this.state.lastSaved = Date.now();
          this.lastPersistTime = Date.now();
          this.criticalSaveMode = false;
          return true;
        }
      }

      this.log('SAVE_ERROR', 'system', '', 'All save methods failed');
      return false;
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
      
      const adapter = this.obsidianPlugin?.app?.vault?.adapter;
      if (adapter) {
        const cachePath = `${this.obsidianPlugin.manifest.dir}/cache.json`;
        
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

      Object.entries(data.data || {}).forEach(([scope, entries]) => {
        const store = this.stores[scope];
        if (!store || !Array.isArray(entries)) return;

        entries.forEach(([key, entry]) => {
          if (!entry?.timestamp) return;
          
          const ttl = entry.customTtl ?? this.ttlMap[scope];
          if ((now - entry.timestamp) < ttl) {
            store.set(key, entry);
            this.updateIndexes(key, entry);
            loaded++;
          }
        });
      });

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
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      totalRequests: total,
      cacheSize: Object.values(this.stores).reduce((sum, store) => sum + store.size, 0),
      indexSize: Object.values(this.indexes).reduce((sum, index) => sum + index.size, 0),
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
      if (store.size > 0) console.log(`${scope}: ${store.size} entries`);
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
    
    [this.loadQueue, this.saveQueue, this.persistenceQueue].forEach(queue => queue.clear());
    
    Object.keys(this.stats).forEach(key => this.stats[key] = 0);
    this.state = { loading: false, saving: false, lastSaved: null, lastLoaded: null };
    
    this.log('DESTROY', 'system', '', 'Cache destroyed and saved');
  }
}

class RequestQueue {
  constructor(plugin) {
    Object.assign(this, {
      plugin,
      queue: [],
      delay: 700,
      isProcessing: false
    });
  }

  add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  }

  toggleLoader(show) {
    if (!this.plugin?.settings?.showLoadingIcon) return;
    document.getElementById('zoro-global-loader')?.classList.toggle('zoro-show', show);
  }

  async process() {
    if (this.isProcessing || !this.queue.length) {
      if (!this.queue.length) this.toggleLoader(false);
      return;
    }
    
    this.isProcessing = true;
    if (this.queue.length === 1) this.toggleLoader(true);

    const { requestFn, resolve, reject } = this.queue.shift();
    
    try {
      resolve(await requestFn());
    } catch (err) {
      reject(err);
    } finally {
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }
}

class Api {
  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue;
    this.cache = plugin.cache;
    
    this.cacheTypeMap = {
      stats: 'userData',
      single: 'mediaData',
      search: 'searchResults'
    };
    
    this.apiUrl = 'https://graphql.anilist.co';
    this.authUrl = 'https://anilist.co/api/v2/oauth/token';
  }

  createCacheKey(config) {
    const sorted = {};
    Object.keys(config).sort().forEach(key => sorted[key] = config[key]);
    return JSON.stringify(sorted);
  }

  async makeObsidianRequest(code, redirectUri) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.plugin.settings.clientId,
      client_secret: this.plugin.settings.clientSecret || '',
      redirect_uri: redirectUri,
      code
    });

    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: this.authUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: body.toString()
      }));

      if (!response?.json || typeof response.json !== 'object') {
        throw new Error('Invalid response structure from AniList.');
      }

      return response.json;
    } catch (err) {
      console.error('[Zoro] Obsidian requestUrl failed:', err);
      throw new Error('Failed to authenticate with AniList via Obsidian requestUrl.');
    }
  }

  async fetchAniListData(config) {
    const cacheKey = this.createCacheKey(config);
    const cacheType = this.cacheTypeMap[config.type] || 'userData';
    
    if (!config.nocache) {
      const cached = this.cache.get(cacheKey, { scope: cacheType });
      if (cached) {
        console.log(`[Zoro] Cache HIT for ${cacheType}: ${cacheKey.substring(0, 50)}...`);
        return cached;
      }
    }

    console.log(`[Zoro] Cache MISS for ${cacheType}: ${cacheKey.substring(0, 50)}...`);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
      if (this.plugin.settings.accessToken) {
        await this.plugin.auth.ensureValidToken();
        headers.Authorization = `Bearer ${this.plugin.settings.accessToken}`;
      }
      
      const { query, variables } = this.buildQuery(config);
      
      const response = await this.requestQueue.add(() => requestUrl({
        url: this.apiUrl,
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables })
      }));
      
      const result = response.json;
      if (!result) throw new Error('Empty response from AniList.');
      
      if (result.errors?.length > 0) {
        this.handleApiErrors(result.errors);
      }
      
      if (!result.data) {
        throw new Error('AniList returned no data.');
      }
      
      this.cache.set(cacheKey, result.data, { scope: cacheType });
      console.log(`[Zoro] Cached data for ${cacheType}: ${cacheKey.substring(0, 50)}...`);
      
      return result.data;
    } catch (error) {
      console.error('[Zoro] fetchAniListData() failed:', error);
      throw error;
    }
  }

  buildQuery(config) {
    const queryMap = {
      stats: () => ({
        query: this.getUserStatsQuery({ mediaType: config.mediaType || 'ANIME', layout: config.layout || 'card' }),
        variables: { username: config.username }
      }),
      single: () => ({
        query: this.getSingleMediaQuery(),
        variables: {
          username: config.username,
          mediaId: parseInt(config.mediaId),
          type: config.mediaType
        }
      }),
      search: () => ({
        query: this.getSearchMediaQuery(config.layout),
        variables: {
          search: config.search,
          type: config.mediaType,
          page: config.page || 1,
          perPage: config.perPage || 5
        }
      })
    };

    return queryMap[config.type]?.() || {
      query: this.getMediaListQuery(config.layout),
      variables: {
        username: config.username,
        status: config.listType,
        type: config.mediaType || 'ANIME'
      }
    };
  }

  handleApiErrors(errors) {
    const firstError = errors[0];
    const isPrivate = firstError.message?.includes('Private') || firstError.message?.includes('permission');

    if (isPrivate) {
      const message = this.plugin.settings.accessToken
        ? '🚫 List is private and this token has no permission.'
        : '🔒 List is private. Please authenticate to access it.';
      throw new Error(message);
    }
    throw new Error(firstError.message || 'AniList returned an unknown error.');
  }

  async updateMediaListEntry(mediaId, updates) {
    try {
      if (!this.plugin.settings.accessToken || !(await this.plugin.auth.ensureValidToken())) {
        throw new Error('❌ Authentication required to update entries.');
      }

      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
            id status score progress
          }
        }
      `;
      
      const variables = { mediaId };
      if (updates.status !== undefined) variables.status = updates.status;
      if (updates.score !== undefined && updates.score !== null) variables.score = updates.score;
      if (updates.progress !== undefined) variables.progress = updates.progress;
      
      const response = await this.requestQueue.add(() => requestUrl({
        url: this.apiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.plugin.settings.accessToken}`
        },
        body: JSON.stringify({ query: mutation, variables })
      }));

      const result = response.json;
      if (!result || result.errors?.length > 0) {
        const message = result.errors?.[0]?.message || 'Unknown mutation error';
        throw new Error(`AniList update error: ${message}`);
      }
      
      this.cache.invalidateByMedia(mediaId);
      return result.data.SaveMediaListEntry;
    } catch (error) {
      console.error('[Zoro] updateMediaListEntry failed:', error);
      throw new Error(`❌ Failed to update entry: ${error.message}`);
    }
  }

  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.plugin.settings.accessToken) return false;
    
    try {
      const response = await this.fetchAniListData({
        type: 'single',
        mediaType,
        mediaId: parseInt(mediaId)
      });
      return response.MediaList !== null;
    } catch (error) {
      console.warn('Error checking media list status:', error);
      return false;
    }
  }

  getMediaFields(layout = 'card') {
    const fields = {
      compact: `
        id
        title { romaji }
        coverImage { medium }
      `,
      card: `
        id
        title { romaji english native }
        coverImage { large medium }
        format averageScore status genres episodes chapters isFavourite
      `,
      full: `
        id
        title { romaji english native }
        coverImage { large medium }
        episodes chapters genres format averageScore status isFavourite
        startDate { year month day }
        endDate { year month day }
      `
    };
    return fields[layout] || fields.card;
  }

  getMediaListQuery(layout = 'card') {
    const baseFields = `id status score progress`;
    const mediaFields = this.getMediaFields(layout);

    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType) {
        MediaListCollection(userName: $username, status: $status, type: $type) {
          lists {
            entries {
              ${baseFields}
              media { ${mediaFields} }
            }
          }
        }
      }
    `;
  }

  getSingleMediaQuery(layout = 'card') {
    const baseFields = `id status score progress`;
    const mediaFields = this.getMediaFields(layout);

    return `
      query ($username: String, $mediaId: Int, $type: MediaType) {
        MediaList(userName: $username, mediaId: $mediaId, type: $type) {
          ${baseFields}
          media { ${mediaFields} }
        }
      }
    `;
  }

  getUserStatsQuery({ 
    mediaType = 'ANIME', 
    layout = 'enhanced', 
    useViewer = false,
    includeGenres = true,
    includeStatus = true,
    includeHistory = false
  } = {}) {
    const typeKey = mediaType.toLowerCase();

    const statFields = {
      minimal: `count meanScore`,
      standard: `
        count meanScore standardDeviation
        episodesWatched chaptersRead minutesWatched volumesRead
      `,
      enhanced: `
        count meanScore standardDeviation
        episodesWatched minutesWatched chaptersRead volumesRead
        scores { score count }
        lengths { length count }
        releaseYears { releaseYear count }
        startYears { startYear count }
        formats { format count }
        statuses { status count }
      `,
      complete: `
        count meanScore standardDeviation
        episodesWatched minutesWatched chaptersRead volumesRead
        scores { score count }
        lengths { length count }
        releaseYears { releaseYear count }
        startYears { startYear count }
        formats { format count }
        statuses { status count }
        genres { genre count meanScore minutesWatched }
        tags { tag count meanScore minutesWatched }
        staff { staff { id name { full } } count meanScore }
        studios { studio { id name } count meanScore }
      `
    };

    const selectedFields = statFields[layout] || statFields.enhanced;
    const viewerPrefix = useViewer ? 'Viewer' : `User(name: $username)`;

    let queryParts = [
      `id name`,
      `avatar { large medium }`,
      `statistics { ${typeKey} { ${selectedFields} } }`
    ];

    if (layout === 'enhanced' || layout === 'complete') {
      queryParts.push(`
        options { displayAdultContent }
        mediaListOptions { scoreFormat rowOrder }
        favourites {
          anime { nodes { id title { romaji english } coverImage { medium } meanScore } }
          manga { nodes { id title { romaji english } coverImage { medium } meanScore } }
        }
      `);
    }

    return `
      query ($username: String) {
        ${viewerPrefix} { ${queryParts.join(' ')} }
      }
    `;
  }

  getSearchMediaQuery(layout = 'card') {
    const fields = this.getMediaFields(layout);

    return `
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(search: $search, type: $type) { ${fields} }
        }
      }
    `;
  }

  getAniListUrl(mediaId, mediaType = 'ANIME') {
    if (!mediaId || typeof mediaId !== 'number') {
      throw new Error(`Invalid mediaId: ${mediaId}`);
    }

    const type = String(mediaType).toUpperCase();
    const urlType = ['ANIME', 'MANGA'].includes(type) ? type.toLowerCase() : 'anime';
    return `https://anilist.co/${urlType}/${mediaId}`;
  }
}

class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.globalListeners = [];
    this.initializeComponents();
  }

  initializeComponents() {
    this.cache = new Cache({ obsidianPlugin: this });
    this.requestQueue = new RequestQueue(this);
    this.api = new Api(this);
    this.auth = new Authentication(this);
    this.malAuth = new MALAuthentication(this);
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

  async onload() {
    console.log('[Zoro] Plugin loading...');
    this.render = new Render(this);
    
    await this.initializeSettings();
    await this.initializeCache();
    this.setupUI();
    this.registerProcessors();
    
    this.addSettingTab(new ZoroSettingTab(this.app, this));
    console.log('[Zoro] Plugin loaded successfully.');
  }

  async initializeSettings() {
    try {
      await this.loadSettings();
      console.log('[Zoro] Settings loaded.');
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }
  }

  async initializeCache() {
    await this.cache.loadFromDisk();
    this.cache.startAutoPrune(5 * 60 * 1000);
  }

  setupUI() {
    try {
      this.injectCSS();
      if (this.settings.theme) {
        this.theme.applyTheme(this.settings.theme);
      }
      console.log('[Zoro] UI setup complete.');
    } catch (err) {
      console.error('[Zoro] Failed to setup UI:', err);
    }
  }

  registerProcessors() {
    this.registerMarkdownCodeBlockProcessor('zoro', this.processor.processZoroCodeBlock.bind(this.processor));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processor.processZoroSearchCodeBlock.bind(this.processor));
    this.registerMarkdownPostProcessor(this.processor.processInlineLinks.bind(this.processor));
  }

  validateSettings(settings) {
    const validators = {
      string: (val, def = '') => typeof val === 'string' ? val : def,
      boolean: (val, def = false) => typeof val === 'boolean' ? val : def,
      number: (val, def = null) => typeof val === 'number' ? val : def,
      object: (val, def = null) => typeof val === 'object' ? val : def,
      layout: (val) => ['card', 'table'].includes(val) ? val : 'card',
      gridColumns: (val) => Number.isInteger(val) ? val : getDefaultGridColumns()
    };

    return {
      defaultUsername: validators.string(settings?.defaultUsername),
      defaultLayout: validators.layout(settings?.defaultLayout),
      gridColumns: validators.gridColumns(settings?.gridColumns),
      theme: validators.string(settings?.theme),
      showCoverImages: validators.boolean(settings?.showCoverImages),
      showRatings: validators.boolean(settings?.showRatings),
      showProgress: validators.boolean(settings?.showProgress),
      showGenres: validators.boolean(settings?.showGenres),
      showLoadingIcon: validators.boolean(settings?.showLoadingIcon, true),
      hideUrlsInTitles: validators.boolean(settings?.hideUrlsInTitles, true),
      forceScoreFormat: true,
      clientId: validators.string(settings?.clientId),
      clientSecret: validators.string(settings?.clientSecret),
      redirectUri: validators.string(settings?.redirectUri, DEFAULT_SETTINGS.redirectUri),
      accessToken: validators.string(settings?.accessToken),
      malClientId: validators.string(settings?.malClientId),
      malClientSecret: validators.string(settings?.malClientSecret),
      malAccessToken: validators.string(settings?.malAccessToken),
      malRefreshToken: validators.string(settings?.malRefreshToken),
      malTokenExpiry: validators.number(settings?.malTokenExpiry),
      malUserInfo: validators.object(settings?.malUserInfo)
    };
  }

  async saveSettings() {
    try {
      const validSettings = this.validateSettings(this.settings);
      await this.saveData(validSettings);
      console.log('[Zoro] Settings saved successfully.');
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

  handleEditClick(e, entry, statusEl) {
    e.preventDefault();
    e.stopPropagation();

    this.edit.createEditModal(
      entry,
      async updates => {
        await this.api.updateMediaListEntry(entry.media.id, updates);
      },
      () => {}
    );
  }

  getStatsConfig() {
    const defaults = {
      showAvatar: true,
      showFavorites: true,
      showBreakdowns: true,
      showTimeStats: true,
      layout: 'enhanced',
      theme: 'auto'
    };

    return {
      showAvatar: this.settings.showAvatar ?? defaults.showAvatar,
      showFavorites: this.settings.showFavorites ?? defaults.showFavorites,
      showBreakdowns: this.settings.showBreakdowns ?? defaults.showBreakdowns,
      showTimeStats: this.settings.showTimeStats ?? defaults.showTimeStats,
      layout: this.settings.statsLayout ?? defaults.layout,
      theme: this.settings.statsTheme ?? defaults.theme
    };
  }

  injectCSS() {
    this.removeExistingStyles();
    this.createStyles();
    this.createGlobalLoader();
  }

  removeExistingStyles() {
    const existingStyle = document.getElementById('zoro-plugin-styles');
    if (existingStyle) existingStyle.remove();
  }

  createStyles() {
    const css = `.zoro-container { /* styles */ }`;
    
    const style = document.createElement('style');
    style.id = 'zoro-plugin-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  createGlobalLoader() {
    this.globalLoader = document.createElement('div');
    Object.assign(this.globalLoader, {
      id: 'zoro-global-loader',
      textContent: '⏳',
      className: 'zoro-global-loader'
    });
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

    const retryButton = wrapper.createEl('button', { 
      text: onRetry ? '🔄 Retry' : 'Reload Note', 
      cls: 'zoro-retry-btn' 
    });

    retryButton.onclick = () => {
      el.empty();
      onRetry ? onRetry() : this.app.workspace.activeLeaf.rebuildView();
    };
  }

  cleanup() {
    this.cache.stopAutoPrune().stopBackgroundRefresh().destroy();
    this.theme.removeTheme();
    this.removeExistingStyles();
    
    const loader = document.getElementById('zoro-global-loader');
    if (loader) loader.remove();
  }

  onunload() {
    console.log('[Zoro] Unloading plugin...');
    this.cleanup();
  }
}

class Processor {
  constructor(plugin) {
    this.plugin = plugin;
    
    this.renderMap = {
      stats: (el, data, config) => this.plugin.render.renderUserStats(el, data.User),
      single: (el, data, config) => this.plugin.render.renderSingleMedia(el, data.MediaList, config),
      default: (el, data, config) => {
        const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
        this.plugin.render.renderMediaList(el, entries, config);
      }
    };

    this.skeletonMap = {
      stats: () => this.plugin.render.createStatsSkeleton(),
      single: () => this.plugin.render.createListSkeleton(1),
      default: () => this.plugin.render.createListSkeleton()
    };
  }

  async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source) || {};
      
      if (config.type === 'trending') {
        const trending = new Trending(this.plugin);
        await trending.renderTrendingBlock(el, config);
        return;
      }
      
      this.showSkeleton(el, config);
      await this.processConfig(config);
      await this.fetchAndRender(el, config);
      
    } catch (error) {
      this.handleError(el, error, 'Code block', () => this.processZoroCodeBlock(source, el, ctx));
    }
  }

  async processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
      
      if (this.plugin.settings.debugMode) {
        console.log('[Zoro] Search block config:', config);
      }

      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      
      const doSearch = async () => {
        await this.plugin.render.renderSearchInterface(el, config);
      };
      
      await this.executeWithErrorHandling(doSearch, el, 'Search failed', doSearch);
      
    } catch (error) {
      this.handleError(el, error, 'Search block', () => this.processZoroSearchCodeBlock(source, el, ctx));
    }
  }

  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="zoro:"]');

    for (const link of inlineLinks) {
      await this.processInlineLink(link, ctx);
    }
  }

  async processInlineLink(link, ctx) {
    const href = link.getAttribute('href');
    const placeholder = this.createPlaceholder('🔄 Loading Zoro...');
    link.replaceWith(placeholder);

    try {
      const config = this.parseInlineLink(href);
      const data = await this.plugin.api.fetchAniListData(config);
      const container = this.createInlineContainer();
      
      const renderFn = this.renderMap[config.type] || this.renderMap.default;
      renderFn(container, data, config);

      placeholder.replaceWith(container);
      ctx.addChild({ unload: () => container.remove() });

    } catch (error) {
      console.warn(`[Zoro] Inline link failed for ${href}:`, error);
      const container = this.createInlineContainer();
      const retry = () => this.processInlineLinks(placeholder.parentElement, ctx);
      this.plugin.renderError(container, error.message, 'Inline link', retry);
      placeholder.replaceWith(container);
    }
  }

  showSkeleton(el, config) {
    const skeletonFn = this.skeletonMap[config.type] || this.skeletonMap.default;
    el.empty();
    el.appendChild(skeletonFn());
  }

  async processConfig(config) {
    if (config.useAuthenticatedUser) {
      const authUsername = await this.plugin.auth.getAuthenticatedUsername();
      if (!authUsername) {
        throw new Error('❌ Could not retrieve authenticated username...');
      }
      config.username = authUsername;
    }
  }

  async fetchAndRender(el, config) {
    const doFetch = async () => {
      const data = await this.plugin.api.fetchAniListData(config);
      el.empty();
      const renderFn = this.renderMap[config.type] || this.renderMap.default;
      renderFn(el, data, config);
    };

    await this.executeWithErrorHandling(doFetch, el, 'Failed to load list', doFetch);
  }

  async executeWithErrorHandling(fn, el, errorContext, retryFn) {
    try {
      await fn();
    } catch (err) {
      el.empty();
      this.plugin.renderError(el, err.message, errorContext, retryFn);
    }
  }

  createPlaceholder(text) {
    const placeholder = document.createElement('span');
    placeholder.textContent = text;
    return placeholder;
  }

  createInlineContainer() {
    const container = document.createElement('span');
    container.className = 'zoro-inline-container';
    return container;
  }

  handleError(el, error, context, retryFn) {
    el.empty();
    console.error(`[Zoro] ${context} processing error:`, error);
    this.plugin.renderError(el, error.message || 'Unknown error occurred.', context, retryFn);
  }

  parseCodeBlockConfig(source) {
    const config = this.parseKeyValuePairs(source);
    this.applyConfigDefaults(config);
    return config;
  }

  parseKeyValuePairs(source) {
    const config = {};
    const lines = source.split('\n').filter(l => l.trim());

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      
      if (key && value) config[key] = value;
    }
    return config;
  }

  applyConfigDefaults(config) {
    if (!config.username) {
      if (this.plugin.settings.defaultUsername) {
        config.username = this.plugin.settings.defaultUsername;
      } else if (this.plugin.settings.accessToken) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
      }
    }

    const defaults = {
      type: 'list',
      listType: config.type === 'list' ? 'CURRENT' : undefined,
      mediaType: 'ANIME',
      layout: this.plugin.settings.defaultLayout || 'card'
    };

    Object.entries(defaults).forEach(([key, defaultValue]) => {
      if (!config[key] && defaultValue !== undefined) {
        config[key] = defaultValue;
      }
    });

    if (config.type === 'trending') config.type = 'trending';
  }

  parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const parsed = this.parseKeyValuePairs(source);
    Object.assign(config, parsed);
    
    config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
    config.mediaType = config.mediaType || 'ANIME';
    
    return config;
  }

  parseInlineLink(href) {
    const [base, hash] = href.replace('zoro:', '').split('#');
    const parts = base.split('/');
    
    const { username, pathParts } = this.extractUserAndPath(parts);
    const config = this.buildConfigFromPath(username, pathParts);
    
    if (hash) {
      this.applyHashModifiers(config, hash);
    }

    return config;
  }

  extractUserAndPath(parts) {
    if (parts[0] === '') {
      if (!this.plugin.settings.defaultUsername) {
        throw new Error('⚠️ Default username not set. Configure it in plugin settings.');
      }
      return {
        username: this.plugin.settings.defaultUsername,
        pathParts: parts.slice(1)
      };
    }
    
    if (parts.length < 2) {
      throw new Error('❌ Invalid Zoro inline link format.');
    }
    
    return {
      username: parts[0],
      pathParts: parts.slice(1)
    };
  }

  buildConfigFromPath(username, pathParts) {
    const config = {
      username,
      layout: 'card',
      type: 'list'
    };

    const [main, second] = pathParts;

    if (main === 'stats') {
      config.type = 'stats';
    } else if (main === 'anime' || main === 'manga') {
      config.type = 'single';
      config.mediaType = main.toUpperCase();
      
      if (!second || isNaN(parseInt(second))) {
        throw new Error('⚠️ Invalid media ID for anime/manga inline link.');
      }
      config.mediaId = parseInt(second);
    } else {
      config.listType = main.toUpperCase();
    }

    return config;
  }

  applyHashModifiers(config, hash) {
    const hashParts = hash.split(',');
    const layouts = ['compact', 'card', 'minimal', 'full'];
    
    for (const mod of hashParts) {
      if (layouts.includes(mod)) {
        config.layout = mod;
      } else if (mod === 'nocache') {
        config.nocache = true;
      }
    }
  }
}

class Render {
  constructor(plugin) {
    this.plugin = plugin;
  }

  renderSearchInterface(el, config) {
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
        resultsDiv.innerHTML = '<div class="zoro-search-message">Type at least 3 characters…</div>';
        return;
      }
      
      try {
        resultsDiv.innerHTML = '';
        resultsDiv.appendChild(this.createListSkeleton(5));
        
        const data = await this.plugin.api.fetchAniListData({ ...config, search: term, page: 1, perPage: 5 });
        
        resultsDiv.innerHTML = '';
        this.renderSearchResults(resultsDiv, data.Page.media, config);
      } catch (e) {
        this.plugin.renderError(resultsDiv, e.message);
      }
    };

    input.addEventListener('input', () => { clearTimeout(timeout); timeout = setTimeout(doSearch, 300); });
    input.addEventListener('keypress', e => { if (e.key === 'Enter') doSearch(); });
  }

  renderMediaList(el, entries, config) {
    el.empty();
    el.className = 'zoro-container';
    
    if (config.layout === 'table') {
      this.renderTableLayout(el, entries, config);
      return;
    }

    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    const fragment = document.createDocumentFragment();
    entries.forEach(entry => {
      fragment.appendChild(this.createMediaCard(entry, config));
    });
    
    grid.appendChild(fragment);
  }

  renderSearchResults(el, media, config) {
    el.empty();
    if (media.length === 0) {
      el.innerHTML = '<div class="zoro-search-message">No results found.</div>';
      return;
    }

    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    const fragment = document.createDocumentFragment();
    media.forEach(item => {
      fragment.appendChild(this.createMediaCard(item, config, { isSearch: true }));
    });
    
    grid.appendChild(fragment);
  }

  renderTableLayout(el, entries, config) {
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
          href: this.plugin.getAniListUrl(m.id, config.mediaType),
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
          if (!this.plugin.settings.accessToken) {
            this.plugin.prompt.createAuthenticationPrompt();
            return;
          }
          this.plugin.handleEditClick(e, entry, s);
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

  renderSingleMedia(el, mediaList, config) {
    const m = mediaList.media;
    el.empty(); el.className = 'zoro-container';
    const card = el.createDiv({ cls: 'zoro-single-card' });

    if (this.plugin.settings.showCoverImages) {
      card.createEl('img', { cls: 'media-cover', attr: { src: m.coverImage.large, alt: m.title.english || m.title.romaji } });
    }
    const info = card.createDiv({ cls: 'media-info' });
    info.createEl('h3', null, h => {
      h.createEl('a', { text: m.title.english || m.title.romaji, href: this.plugin.getAniListUrl(m.id, config.mediaType), cls: 'zoro-title-link', target: '_blank' });
    });

    const details = info.createDiv({ cls: 'media-details' });
    if (m.format) details.createEl('span', { text: m.format, cls: 'format-badge' });
    details.createEl('span', { text: mediaList.status, cls: `status-badge status-${mediaList.status.toLowerCase()}` });
    const status = details.lastChild;
    status.classList.add('clickable-status');
    status.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      if (!this.plugin.settings.accessToken) {
        this.plugin.prompt.createAuthenticationPrompt();
        return;
      }
      this.plugin.handleEditClick(e, mediaList, status);
    };

    if (this.plugin.settings.showProgress) details.createEl('span', { text: `${mediaList.progress}/${m.episodes || m.chapters || '?'}`, cls: 'progress' });
    if (this.plugin.settings.showRatings && mediaList.score != null) details.createEl('span', { text: `★ ${mediaList.score}`, cls: 'score' });

    if (this.plugin.settings.showGenres && m.genres?.length) {
      const g = info.createDiv({ cls: 'genres' });
      m.genres.slice(0, 3).forEach(genre => g.createEl('span', { text: genre, cls: 'genre-tag' }));
    }
  }

  // Enhanced render method with modular, theme-aware design
renderUserStats(el, user, options = {}) {
  const {
    showAvatar = true,
    showFavorites = true,
    showBreakdowns = true,
    showTimeStats = true,
    layout = 'enhanced',
    theme = 'auto' // auto, light, dark
  } = options;

  el.empty();
  el.className = `zoro-container zoro-stats-container zoro-stats-${layout}`;
  
  // Add theme class
  if (theme !== 'auto') {
    el.classList.add(`zoro-theme-${theme}`);
  }

  if (!user) {
    this._renderError(el, 'No user data available');
    return;
  }

  if (!user.statistics) {
    this._renderError(el, 'Statistics unavailable for this user');
    return;
  }

  const frag = document.createDocumentFragment();

  // Render header section
  if (showAvatar) {
    this._renderHeader(frag, user);
  }

  // Render main stats sections
  this._renderMainStats(frag, user, { showTimeStats, showBreakdowns });

  // Render additional insights
  if (showBreakdowns && layout !== 'minimal') {
    this._renderStatsBreakdowns(frag, user);
  }

  // Render favorites section
  if (showFavorites && user.favourites && layout === 'enhanced') {
    this._renderFavorites(frag, user.favourites);
  }

  el.appendChild(frag);

  // Trigger entrance animation
  requestAnimationFrame(() => {
    el.classList.add('zoro-stats-loaded');
  });
}

// Private helper methods for modular rendering

_renderError(el, message) {
  const errorEl = el.createDiv({ 
    cls: 'zoro-error-box',
    text: message 
  });
  errorEl.createEl('small', { 
    text: 'Check your username and try again',
    cls: 'zoro-error-hint'
  });
}

_renderHeader(frag, user) {
  const header = frag.createDiv({ cls: 'zoro-stats-header' });
  
  if (user.avatar?.medium) {
    const avatarContainer = header.createDiv({ cls: 'zoro-avatar-container' });
    const avatar = avatarContainer.createEl('img', {
      cls: 'zoro-stats-avatar',
      attr: { 
        src: user.avatar.medium, 
        alt: `${user.name}'s avatar`,
        loading: 'lazy' 
      },
    });
    
    // Add loading placeholder
    avatar.addEventListener('load', () => {
      avatarContainer.classList.add('zoro-avatar-loaded');
    });
  }

  const userInfo = header.createDiv({ cls: 'zoro-user-info' });
  const nameLink = userInfo.createEl('a', {
    cls: 'zoro-stats-username external-link',
    text: user.name,
    href: `https://anilist.co/user/${user.name}`,
    target: '_blank',
  });
  
  const profileHint = userInfo.createEl('span', {
    cls: 'zoro-profile-hint',
    text: 'View full profile'
  });
}

_renderMainStats(frag, user, options) {
  const { showTimeStats, showBreakdowns } = options;
  const statsSection = frag.createDiv({ cls: 'zoro-stats-section zoro-main-stats' });
  
  const grid = statsSection.createDiv({ cls: 'zoro-stats-grid' });

  ['anime', 'manga'].forEach(type => {
    const stats = user.statistics[type];
    if (!stats || stats.count === 0) return;

    const card = this._createStatsCard(grid, type, stats, { showTimeStats, showBreakdowns });
  });
}

_createStatsCard(container, type, stats, options) {
  const { showTimeStats, showBreakdowns } = options;
  const card = container.createDiv({ 
    cls: 'zoro-stats-card zoro-stats-card-main',
    attr: { 'data-type': type }
  });

  // Card header
  const header = card.createDiv({ cls: 'zoro-card-header' });
  header.createEl('h3', { 
    text: type.toUpperCase(), 
    cls: 'zoro-stats-type-title' 
  });

  // Primary stats
  const primaryStats = card.createDiv({ cls: 'zoro-primary-stats' });
  this._renderPrimaryStat(primaryStats, 'Total', stats.count, 'zoro-stat-count');
  
  if (stats.meanScore > 0) {
    this._renderPrimaryStat(primaryStats, 'Mean Score', 
      `${stats.meanScore.toFixed(1)}/10`, 'zoro-stat-score');
  }

  // Secondary stats grid
  const secondaryGrid = card.createDiv({ cls: 'zoro-secondary-stats' });
  
  const secondaryStats = this._getSecondaryStats(type, stats, showTimeStats);
  secondaryStats.forEach(({ label, value, className }) => {
    if (value != null && value !== 0) {
      this._renderSecondaryStat(secondaryGrid, label, value, className);
    }
  });

  return card;
}

_getSecondaryStats(type, stats, showTimeStats) {
  const baseStats = [
    { 
      label: 'Std Deviation', 
      value: stats.standardDeviation ? stats.standardDeviation.toFixed(2) : null,
      className: 'zoro-stat-deviation'
    }
  ];

  if (type === 'anime') {
    baseStats.push(
      { 
        label: 'Episodes', 
        value: stats.episodesWatched,
        className: 'zoro-stat-episodes'
      }
    );
    
    if (showTimeStats && stats.minutesWatched) {
      const hours = Math.floor(stats.minutesWatched / 60);
      const days = Math.floor(hours / 24);
      let timeValue = `${hours.toLocaleString()}h`;
      
      if (days > 0) {
        timeValue = `${days.toLocaleString()}d ${(hours % 24)}h`;
      }
      
      baseStats.push({
        label: 'Time Watched',
        value: timeValue,
        className: 'zoro-stat-time'
      });
    }
  } else {
    baseStats.push(
      { 
        label: 'Chapters', 
        value: stats.chaptersRead,
        className: 'zoro-stat-chapters'
      },
      { 
        label: 'Volumes', 
        value: stats.volumesRead,
        className: 'zoro-stat-volumes'
      }
    );
  }

  return baseStats.filter(stat => stat.value != null);
}

_renderPrimaryStat(container, label, value, className = '') {
  const statEl = container.createDiv({ cls: `zoro-primary-stat ${className}` });
  statEl.createEl('div', { cls: 'zoro-stat-value-primary', text: value });
  statEl.createEl('div', { cls: 'zoro-stat-label-primary', text: label });
}

_renderSecondaryStat(container, label, value, className = '') {
  const statEl = container.createDiv({ cls: `zoro-secondary-stat ${className}` });
  statEl.createEl('span', { cls: 'zoro-stat-label-secondary', text: label });
  statEl.createEl('span', { cls: 'zoro-stat-value-secondary', text: value.toLocaleString?.() ?? value });
}

_renderStatsBreakdowns(frag, user) {
  const hasBreakdowns = this._hasBreakdownData(user);
  if (!hasBreakdowns) return;

  const breakdownSection = frag.createDiv({ cls: 'zoro-stats-section zoro-breakdowns' });
  breakdownSection.createEl('h3', { 
    text: 'Detailed Breakdowns', 
    cls: 'zoro-section-title' 
  });

  const breakdownGrid = breakdownSection.createDiv({ cls: 'zoro-breakdown-grid' });

  ['anime', 'manga'].forEach(type => {
    const stats = user.statistics[type];
    if (!stats) return;

    this._renderTypeBreakdowns(breakdownGrid, type, stats);
  });
}

_hasBreakdownData(user) {
  return ['anime', 'manga'].some(type => {
    const stats = user.statistics[type];
    return stats && (stats.statuses || stats.scores || stats.genres || stats.formats);
  });
}

_renderTypeBreakdowns(container, type, stats) {
  if (!stats || stats.count === 0) return;

  const typeSection = container.createDiv({ 
    cls: 'zoro-breakdown-type',
    attr: { 'data-type': type }
  });

  // Status breakdown
  if (stats.statuses?.length) {
    this._renderBreakdownChart(typeSection, 'Status Distribution', stats.statuses, 'status');
  }

  // Score distribution
  if (stats.scores?.length) {
    const validScores = stats.scores.filter(s => s.score > 0);
    if (validScores.length) {
      this._renderBreakdownChart(typeSection, 'Score Distribution', validScores, 'score');
    }
  }

  // Format breakdown
  if (stats.formats?.length) {
    this._renderBreakdownChart(typeSection, 'Format Distribution', stats.formats, 'format');
  }

  // Top genres (limit to top 5)
  if (stats.genres?.length) {
    const topGenres = stats.genres
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    this._renderBreakdownChart(typeSection, 'Top Genres', topGenres, 'genre');
  }
}

_renderBreakdownChart(container, title, data, keyField) {
  const chartContainer = container.createDiv({ cls: 'zoro-breakdown-chart' });
  chartContainer.createEl('h4', { text: title, cls: 'zoro-breakdown-title' });

  const chartEl = chartContainer.createDiv({ cls: 'zoro-chart-container' });
  
  // Simple bar chart representation (preparing for future chart library)
  const maxCount = Math.max(...data.map(item => item.count));
  
  data.forEach(item => {
    const barContainer = chartEl.createDiv({ cls: 'zoro-chart-bar-container' });
    const barLabel = barContainer.createDiv({ 
      cls: 'zoro-chart-label',
      text: item[keyField] || item.status || item.genre || item.format
    });
    
    const barWrapper = barContainer.createDiv({ cls: 'zoro-chart-bar-wrapper' });
    const bar = barWrapper.createDiv({ 
      cls: 'zoro-chart-bar',
      attr: { 'data-type': keyField }
    });
    const barValue = barWrapper.createDiv({ 
      cls: 'zoro-chart-value',
      text: item.count
    });
    
// Set bar width as CSS variable for animation
const percentage = (item.count / maxCount) * 100;
bar.style.setProperty('--bar-width', `${percentage}%`);
    
    // Add delay for staggered animation
    const index = data.indexOf(item);
    bar.style.animationDelay = `${index * 0.1}s`;
  });

  // Add chart metadata for future chart library integration
  chartEl.setAttribute('data-chart-type', 'horizontal-bar');
  chartEl.setAttribute('data-chart-data', JSON.stringify(data));
  chartEl.setAttribute('data-chart-key', keyField);
}

_renderFavorites(frag, favourites) {
  const hasAnime = favourites.anime?.nodes?.length > 0;
  const hasManga = favourites.manga?.nodes?.length > 0;
  
  if (!hasAnime && !hasManga) return;

  const favSection = frag.createDiv({ cls: 'zoro-stats-section zoro-favorites' });
  favSection.createEl('h3', { 
    text: 'Favorites', 
    cls: 'zoro-section-title' 
  });

  const favGrid = favSection.createDiv({ cls: 'zoro-favorites-grid' });

  if (hasAnime) {
    this._renderFavoriteType(favGrid, 'anime', favourites.anime.nodes.slice(0, 6));
  }
  
  if (hasManga) {
    this._renderFavoriteType(favGrid, 'manga', favourites.manga.nodes.slice(0, 6));
  }
}

_renderFavoriteType(container, type, items) {
  const typeContainer = container.createDiv({ 
    cls: 'zoro-favorite-type',
    attr: { 'data-type': type }
  });
  
  typeContainer.createEl('h4', { 
    text: `Favorite ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    cls: 'zoro-favorite-type-title'
  });

  const itemsGrid = typeContainer.createDiv({ cls: 'zoro-favorite-items' });
  
  items.forEach(item => {
    const itemEl = itemsGrid.createDiv({ cls: 'zoro-favorite-item' });
    
    if (item.coverImage?.medium) {
      const img = itemEl.createEl('img', {
        cls: 'zoro-favorite-cover',
        attr: {
          src: item.coverImage.medium,
          alt: item.title?.romaji || item.title?.english || 'Cover',
          loading: 'lazy'
        }
      });
    }
    
    const info = itemEl.createDiv({ cls: 'zoro-favorite-info' });
    const title = item.title?.english || item.title?.romaji || 'Unknown Title';
    info.createEl('div', { 
      cls: 'zoro-favorite-title',
      text: title,
      attr: { title: title }
    });
    
    if (item.meanScore) {
      info.createEl('div', { 
        cls: 'zoro-favorite-score',
        text: `★ ${item.meanScore/10}`
      });
    }
  });
}


  renderMediaListChunked(el, entries, config, chunkSize = 20) {
    el.empty();
    el.className = 'zoro-container';
    
    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    let index = 0;
    
    const renderChunk = () => {
      const fragment = document.createDocumentFragment();
      const end = Math.min(index + chunkSize, entries.length);
      
      for (; index < end; index++) {
        fragment.appendChild(this.createMediaCard(entries[index], config));
      }
      
      grid.appendChild(fragment);
      
      if (index < entries.length) {
        requestAnimationFrame(renderChunk);
      }
    };
    
    renderChunk();
  }

  createListSkeleton(count = 6) {
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

  createStatsSkeleton() {
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

  createSearchSkeleton() {
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

  createMediaCard(data, config, options = {}) {
    const isSearch = options.isSearch || false;
    const isCompact = config.layout === 'compact';
    const entry = isSearch ? null : data;
    const media = isSearch ? data : data.media;

    const card = document.createElement('div');
card.className = `zoro-card ${isCompact ? 'compact' : ''}`;
card.dataset.mediaId = media.id;

    if (this.plugin.settings.showCoverImages && media.coverImage?.large) {
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
      
      const needsOverlay = (!isSearch && entry && this.plugin.settings.showProgress) || 
                          (this.plugin.settings.showRatings && ((isSearch && media.averageScore != null) || (!isSearch && entry?.score != null)));
                          
      if (needsOverlay) {
        const overlay = document.createElement('div');
        overlay.className = 'cover-overlay';
        
        if (!isSearch && entry && this.plugin.settings.showProgress) {
          const progress = document.createElement('span');
          progress.className = 'progress';
          const total = media.episodes || media.chapters || '?';
          progress.textContent = `${entry.progress || 0}/${total}`;
          overlay.appendChild(progress);
        } else {
          overlay.appendChild(document.createElement('span'));
        }
        
        if (this.plugin.settings.showRatings) {
  const score = isSearch ? media.averageScore : entry?.score;
  if (score != null) {
    const rating = document.createElement('span');
    rating.className = 'score';
    
    if (isSearch) {
      rating.textContent = `★ ${(score / 10).toFixed(1)}`;
    } else {
      if (score > 10) {
        rating.textContent = `★ ${(score / 10).toFixed(1)}`;
      } else {
        rating.textContent = `★ ${score.toFixed(1)}`;
      }
    }
    
    overlay.appendChild(rating);
  } else {
    overlay.appendChild(document.createElement('span'));
  }
}
        
        coverContainer.appendChild(overlay);
      }
      
      card.appendChild(coverContainer);
    }

    const info = document.createElement('div');
    info.className = 'media-info';

    const title = document.createElement('h4');

    if (this.plugin.settings.hideUrlsInTitles) {
      title.textContent = media.title.english || media.title.romaji;
    } else {
      const titleLink = document.createElement('a');
      titleLink.href = this.plugin.getAniListUrl(media.id, config.mediaType);
      titleLink.target = '_blank';
      titleLink.textContent = media.title.english || media.title.romaji;
      titleLink.className = 'media-title-link';
      title.appendChild(titleLink);
    }

    info.appendChild(title);

    if (!isCompact) {
      const details = document.createElement('div');
      details.className = 'media-details';

      if (media.format) {
        const formatBadge = document.createElement('span');
        formatBadge.className = 'format-badge';
        formatBadge.textContent = media.format.substring(0, 2).toUpperCase();
        
        details.appendChild(formatBadge);
      }

      if (!isSearch && entry) {
        const statusBadge = document.createElement('span');
        statusBadge.className = `status-badge status-${entry.status.toLowerCase()} clickable-status`;
        statusBadge.textContent = entry.status;
        statusBadge.onclick = (e) => this.handleStatusClick(e, entry, statusBadge);
        details.appendChild(statusBadge);
      }

      if (isSearch) {
        const addBtn = document.createElement('span');
        addBtn.className = 'status-badge status-add clickable-status';
        addBtn.textContent = 'ADD';
        addBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (!this.plugin.settings.accessToken) {
            this.plugin.prompt.createAuthenticationPrompt();
            return;
          }

          const entryData = {
            media: media,
            status: 'PLANNING',
            progress: 0,
            score: null,
            id: null
          };

          this.plugin.edit.createEditModal(
            entryData,
            async (updates) => {
              await this.plugin.api.updateMediaListEntry(media.id, updates);
              new Notice('✅ Added!');
              
              const containers = document.querySelectorAll('.zoro-container');
              containers.forEach(container => {
                const block = container.closest('.markdown-rendered')?.querySelector('code');
                if (block) {
                  this.plugin.processor.processZoroCodeBlock(block.textContent, container, {});
                }
              });
            },
            () => {}
          );
        };
        details.appendChild(addBtn);
      }

      info.appendChild(details);
    }

    if (!isCompact && this.plugin.settings.showGenres && media.genres?.length) {
      const genres = document.createElement('div');
      genres.className = 'genres';
      media.genres.slice(0, 3).forEach(g => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = g;
        genres.appendChild(tag);
      });
      info.appendChild(genres);
    }

    card.appendChild(info);
    

const heart = document.createElement('span');
heart.className = 'zoro-heart';
if (!media.isFavourite) heart.style.display = 'none';
card.appendChild(heart);


    return card;
  }

  attachEventListeners(card, entry, media, config) {
    const statusBadge = card.querySelector('.clickable-status[data-entry-id]');
    if (statusBadge) {
      statusBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleStatusClick(e, entry, statusBadge);
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

  handleStatusClick(e, entry, badge) {
    e.preventDefault();
    e.stopPropagation();
    if (!this.plugin.settings.accessToken) {
      this.plugin.prompt.createAuthenticationPrompt();
      return;
    }
    this.plugin.handleEditClick(e, entry, badge);
  }

  handleAddClick(e, media, config) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.target;
    btn.textContent = '⏳';
    btn.disabled = true;
    
    this.plugin.api.addMediaToList(media.id, { status: 'PLANNING' }, config.mediaType)
      .then(() => {
        btn.textContent = '✅';
        new Notice('Added to list!');
      })
      .catch(err => {
        btn.textContent = 'ADD';
        btn.disabled = false;
        new Notice(`❌ ${err.message}`);
      });
  }

  clear(el) { el.empty?.(); }
}

class MoreDetailsPanel {
  constructor(plugin) {
    this.plugin = plugin;
    this.currentPanel = null;
    this.boundOutsideClickHandler = this.handleOutsideClick.bind(this);
  }

  async showPanel(media, entry = null, triggerElement) {
    this.closePanel();
    const panel = this.createPanel(media, entry);
    this.currentPanel = panel;
    this.positionPanel(panel, triggerElement);
    document.body.appendChild(panel);
    document.addEventListener('click', this.boundOutsideClickHandler);
    
    this.plugin.requestQueue.showGlobalLoader();
    
    if (this.shouldFetchDetailedData(media)) {
      this.fetchAndUpdatePanel(media.id, panel)
        .finally(() => this.plugin.requestQueue.hideGlobalLoader());
    } else {
      this.plugin.requestQueue.hideGlobalLoader();
    }
  }

  shouldFetchDetailedData(media) {
    return !media.description || !media.genres || !media.averageScore || 
           (media.type === 'ANIME' && !media.nextAiringEpisode);
  }

  async fetchAndUpdatePanel(mediaId, panel) {
    try {
      const detailedMedia = await this.fetchDetailedMediaData(mediaId);
      const malPromise = detailedMedia.idMal ? 
        this.fetchMALData(detailedMedia.idMal, detailedMedia.type) : null;
      
      if (this.currentPanel === panel && this.hasMoreData(detailedMedia)) {
        this.updatePanelContent(panel, detailedMedia, null);
      }
      
      if (malPromise) {
        const malData = await malPromise;
        if (this.currentPanel === panel && malData) {
          this.updatePanelContent(panel, detailedMedia, malData);
        }
      }
    } catch (error) {
      console.error('Background fetch failed:', error);
    }
  }
  
  hasMoreData(newMedia) {
    return newMedia.description || newMedia.genres?.length > 0 || 
           newMedia.averageScore > 0 || 
           (newMedia.type === 'ANIME' && newMedia.nextAiringEpisode);
  }

  updatePanelContent(panel, media, malData = null) {
    const content = panel.querySelector('.panel-content');
    
    // Update airing section
    if (media.type === 'ANIME' && media.nextAiringEpisode && !content.querySelector('.airing-section')) {
      const airingSection = this.createAiringSection(media.nextAiringEpisode);
      const insertAfter = content.querySelector('.metadata-section') || content.querySelector('.panel-header');
      insertAfter?.insertAdjacentElement('afterend', airingSection);
    }
    
    // Update synopsis
    if (media.description) {
      this.replaceSection(content, '.synopsis-section', () => this.createSynopsisSection(media.description));
    }

    // Update genres
    if (media.genres?.length > 0 && !content.querySelector('.genres-section')) {
      const genresSection = this.createGenresSection(media.genres);
      const synopsisSection = content.querySelector('.synopsis-section');
      synopsisSection ? content.insertBefore(genresSection, synopsisSection) : content.appendChild(genresSection);
    }

    // Update external links and stats
    if (media.idMal) {
      this.replaceSection(content, '.external-links-section', () => this.createExternalLinksSection(media));
    }
    
    if (media.averageScore > 0 || malData) {
      this.replaceSection(content, '.stats-section', () => this.createStatisticsSection(media, malData));
    }
  }

  replaceSection(content, selector, createFn) {
    const existing = content.querySelector(selector);
    if (existing) content.replaceChild(createFn(), existing);
  }

  async fetchDetailedMediaData(mediaId) {
    const cacheKey = `details:${mediaId}`;
    const cached = this.plugin.cache.get(cacheKey, { scope: 'mediaDetails' });
    if (cached) return cached;

    const query = `query($id:Int){Media(id:$id){id type title{romaji english native}description(asHtml:false)format status season seasonYear averageScore genres nextAiringEpisode{airingAt episode timeUntilAiring}idMal}}`;
    const variables = { id: mediaId };

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

      if (!response?.data?.Media) throw new Error('No media data received');
      
      const data = response.data.Media;
      this.plugin.cache.set(cacheKey, data, { scope: 'mediaDetails' });
      return data;
    } catch (error) {
      console.error('API fetch failed:', error);
      throw error;
    }
  }

  async fetchMALData(malId, mediaType) {
    if (!malId) return null;

    const cacheKey = `mal:${malId}:${mediaType}`;
    const cached = this.plugin.cache.get(cacheKey, { scope: 'malData' });
    if (cached) return cached;

    try {
      const type = mediaType === 'MANGA' ? 'manga' : 'anime';
      const response = await fetch(`https://api.jikan.moe/v4/${type}/${malId}`);
      if (!response.ok) throw new Error(`Jikan API error: ${response.status}`);

      const data = (await response.json())?.data;
      this.plugin.cache.set(cacheKey, data, { scope: 'malData' });
      return data;
    } catch (error) {
      console.error('Failed to fetch MAL data:', error);
      return null;
    }
  }

  createPanel(media, entry) {
    const panel = document.createElement('div');
    panel.className = 'zoro-more-details-panel';

    const content = document.createElement('div');
    content.className = 'panel-content';

    const sections = [
      this.createHeaderSection(media),
      this.createMetadataSection(media, entry),
      ...(media.type === 'ANIME' && media.nextAiringEpisode ? [this.createAiringSection(media.nextAiringEpisode)] : []),
      ...(media.averageScore > 0 ? [this.createStatisticsSection(media)] : []),
      ...(media.genres?.length > 0 ? [this.createGenresSection(media.genres)] : []),
      this.createSynopsisSection(media.description),
      this.createExternalLinksSection(media)
    ];

    sections.forEach(section => content.appendChild(section));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => this.closePanel();

    panel.append(closeBtn, content);
    return panel;
  }

  createAiringSection(nextAiringEpisode) {
    const section = this.createSection('airing-section', 'Next Airing');
    const airingInfo = document.createElement('div');
    airingInfo.className = 'airing-info';

    const airingTime = new Date(nextAiringEpisode.airingAt * 1000);
    const items = [
      ['Episode', nextAiringEpisode.episode, 'airing-episode'],
      ['Date', this.formatAiringDate(airingTime), 'airing-date'],
      ['Time', this.formatAiringTimeOnly(airingTime), 'airing-time']
    ];

    items.forEach(([label, value, className]) => {
      const item = document.createElement('div');
      item.className = className;
      item.innerHTML = `<span class="airing-label">${label}:</span> <span class="airing-value">${value}</span>`;
      airingInfo.appendChild(item);
    });

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

  createSection(className, title) {
    const section = document.createElement('div');
    section.className = `panel-section ${className}`;
    const titleEl = document.createElement('h3');
    titleEl.className = 'section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);
    return section;
  }

  formatAiringDate(date) {
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatAiringTimeOnly(date) {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  formatTimeUntilAiring(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
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
    const section = this.createSection('synopsis-section', 'Synopsis');
    const synopsis = document.createElement('div');
    synopsis.className = 'synopsis-content';
    
    if (!description?.trim()) {
      synopsis.className += ' synopsis-placeholder';
      synopsis.textContent = 'Synopsis not available yet.';
    } else {
      const cleanDescription = description
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
      
      synopsis.textContent = cleanDescription || 'Synopsis is empty.';
      if (!cleanDescription) synopsis.className += ' synopsis-placeholder';
    }
    
    section.appendChild(synopsis);
    return section;
  }

  createMetadataSection(media, entry) {
    const section = this.createSection('metadata-section', 'Details');
    const metaGrid = document.createElement('div');
    metaGrid.className = 'metadata-grid';

    [
      ['Format', media.format],
      ['Status', media.status]
    ].forEach(([label, value]) => {
      if (value) this.addMetadataItem(metaGrid, label, this.formatDisplayName(value));
    });

    section.appendChild(metaGrid);
    return section;
  }

  createStatisticsSection(media, malData = null) {
    const section = this.createSection('stats-section', 'Statistics');
    const statsGrid = document.createElement('div');
    statsGrid.className = 'stats-grid';

    if (media.averageScore > 0) {
      this.addStatItem(statsGrid, 'AniList Score', (media.averageScore / 10).toFixed(1), 'score-stat anilist-stat');
    }

    if (malData) {
      const stats = [
        ['MAL Score', malData.score, 'score-stat mal-stat'],
        ['MAL Ratings', malData.scored_by?.toLocaleString(), 'count-stat'],
        ['MAL Rank', malData.rank ? `#${malData.rank}` : null, 'rank-stat']
      ];
      
      stats.forEach(([label, value, className]) => {
        if (value) this.addStatItem(statsGrid, label, value, className);
      });
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

    const titles = [
      [media.title?.romaji, 'alt-title', media.title?.english !== media.title?.romaji],
      [media.title?.native, 'native-title', true]
    ];
    
    titles.forEach(([title, className, condition]) => {
      if (title && condition) {
        titleSection.innerHTML += `<div class="${className}">${title}</div>`;
      }
    });

    header.appendChild(titleSection);

    if (media.format || (media.season && media.seasonYear)) {
      const formatInfo = document.createElement('div');
      formatInfo.className = 'format-info';
      
      const parts = [
        media.format ? `<span class="format-badge-large">${this.formatDisplayName(media.format)}</span>` : '',
        (media.season && media.seasonYear) ? `<span class="season-info">${this.capitalize(media.season)} ${media.seasonYear}</span>` : ''
      ].filter(Boolean);
      
      formatInfo.innerHTML = parts.join('');
      header.appendChild(formatInfo);
    }

    return header;
  }

  createGenresSection(genres) {
    const section = this.createSection('genres-section', 'Genres');
    const container = document.createElement('div');
    container.className = 'genres-container';
    container.innerHTML = genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('');
    section.appendChild(container);
    return section;
  }

  createExternalLinksSection(media) {
    const section = this.createSection('external-links-section', 'External Links');
    const linksContainer = document.createElement('div');
    linksContainer.className = 'external-links-container';

    const buttons = [
      ['🔗 View on AniList', 'anilist-btn', () => this.getAniListUrl(media.id, media.type)],
      ...(media.idMal ? [['🔗 View on MAL', 'mal-btn', () => this.getMyAnimeListUrl(media.idMal, media.type)]] : [])
    ];

    buttons.forEach(([text, className, urlFn]) => {
      const btn = document.createElement('button');
      btn.className = `external-link-btn ${className}`;
      btn.innerHTML = text;
      btn.onclick = e => {
        e.stopPropagation();
        window.open(urlFn(), '_blank');
      };
      linksContainer.appendChild(btn);
    });

    section.appendChild(linksContainer);
    return section;
  }

  getAniListUrl(mediaId, mediaType = 'ANIME') {
    return this.plugin.getAniListUrl(mediaId, mediaType);
  }

  getMyAnimeListUrl(malId, mediaType = 'ANIME') {
    if (!malId) return null;
    const type = mediaType === 'MANGA' ? 'manga' : 'anime';
    return `https://myanimelist.net/${type}/${malId}`;
  }

  formatDisplayName(str) {
    return str?.replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ') || '';
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
  }

  positionPanel(panel, triggerElement) {
    panel.className = 'zoro-more-details-panel';
  }

  handleOutsideClick(event) {
    if (this.currentPanel && !this.currentPanel.contains(event.target)) {
      this.closePanel();
    }
  }

  closePanel() {
    if (this.currentPanel) {
      this.currentPanel.querySelectorAll('.countdown-value[data-interval-id]')
        .forEach(element => {
          const intervalId = element.dataset.intervalId;
          if (intervalId) clearInterval(parseInt(intervalId));
        });

      document.removeEventListener('click', this.boundOutsideClickHandler);
      this.currentPanel.remove();
      this.currentPanel = null;
    }
  }
}

class Trending {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async renderTrendingBlock(el, config) {
    el.empty();
    el.appendChild(this.plugin.render.createListSkeleton(10));

    try {
      const data = await this.fetchTrendingData(config.mediaType);
      const processedData = this.processJikanData(data, config.mediaType);
      
      el.empty();
      this.plugin.render.renderSearchResults(el, processedData, {
        layout: config.layout || 'card',
        mediaType: config.mediaType || 'ANIME'
      });
    } catch (err) {
      this.plugin.renderError(el, err.message, 'Trending');
    }
  }

  async fetchTrendingData(mediaType = 'ANIME') {
    const type = mediaType.toLowerCase();
    const url = `https://api.jikan.moe/v4/top/${type}?filter=airing&limit=20`;
    const response = await this.plugin.requestQueue.add(() => fetch(url).then(r => r.json()));
    return response.data || [];
  }

  processJikanData(data, mediaType) {
    const unique = this.removeDuplicates(data);
    return unique.slice(0, 20).map(item => this.transformJikanItem(item, mediaType));
  }

  removeDuplicates(data) {
    const seen = new Set();
    return data.filter(item => {
      if (seen.has(item.mal_id)) return false;
      seen.add(item.mal_id);
      return true;
    });
  }

  transformJikanItem(item, mediaType) {
    const isManga = mediaType?.toLowerCase() === 'manga';
    
    return {
      id: item.mal_id,
      title: {
        romaji: item.title || '',
        english: item.title_english,
        native: item.title_japanese
      },
      coverImage: { large: item.images?.jpg?.large_image_url },
      format: item.type,
      averageScore: item.score ? Math.round(item.score * 10) : null,
      genres: item.genres?.map(g => g.name) || [],
      episodes: item.episodes,
      ...(isManga && { chapters: item.chapters })
    };
  }
}

class Authentication {
  constructor(plugin) {
    this.plugin = plugin;
  }

  static ANILIST_AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';
  static ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
  static REDIRECT_URI = 'https://anilist.co/api/v2/oauth/pin';
  static GRAPHQL_URL = 'https://graphql.anilist.co';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.accessToken);
  }

  async loginWithFlow() {
    if (!this.plugin.settings.clientId) {
      new Notice('❌ Please enter your Client ID first.', 5000);
      return;
    }

    const authUrl = this.buildAuthUrl();
    new Notice('🔐 Opening AniList login page…', 3000);
    
    await this.openUrl(authUrl);
    
    const modal = AuthModal.aniListPin(this.plugin.app, async (pin) => {
  await this.exchangePin(pin);
});
modal.open();
  }

  buildAuthUrl() {
    const params = new URLSearchParams({
      client_id: this.plugin.settings.clientId,
      redirect_uri: Authentication.REDIRECT_URI,
      response_type: 'code'
    });
    return `${Authentication.ANILIST_AUTH_URL}?${params}`;
  }

  async openUrl(url) {
    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  async logout() {
    const settings = this.plugin.settings;
    const username = settings.authUsername;
    
    Object.assign(settings, {
      accessToken: '',
      tokenExpiry: 0,
      authUsername: '',
      clientId: '',
      clientSecret: ''
    });
    
    await this.plugin.saveSettings();
    
    if (username) this.plugin.cache.invalidateByUser(username);
    this.plugin.cache.clear();
    
    new Notice('✅ Logged out & cleared credentials.', 3000);
  }

  async exchangePin(pin) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: pin.trim(),
      client_id: this.plugin.settings.clientId,
      client_secret: this.plugin.settings.clientSecret || '',
      redirect_uri: Authentication.REDIRECT_URI
    });

    try {
      const res = await this.makeRequest(Authentication.ANILIST_TOKEN_URL, 'POST', {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      }, body.toString());

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
      
      new Notice('✅ Authenticated successfully!', 4000);
    } catch (err) {
      new Notice(`❌ Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  async makeRequest(url, method = 'POST', headers = {}, body = null) {
    return this.plugin.requestQueue.add(() => 
      requestUrl({ url, method, headers, body })
    );
  }

  async makeGraphQLRequest(query, includeAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (includeAuth) {
      await this.ensureValidToken();
      headers.Authorization = `Bearer ${this.plugin.settings.accessToken}`;
    }
    
    return this.makeRequest(Authentication.GRAPHQL_URL, 'POST', headers, 
      JSON.stringify({ query })
    );
  }


  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated');
    return true;
  }
  
  async forceScoreFormat() {
    if (!this.plugin.settings.forceScoreFormat) return;
    
    try {
      const currentFormat = await this.getCurrentScoreFormat();
      
      if (currentFormat === 'POINT_10_DECIMAL') {
        console.log('Score format already set to POINT_10_DECIMAL');
        return;
      }

      await this.updateScoreFormat();
    } catch (err) {
      console.error('Failed to update score format:', err);
      new Notice(`❌ Could not update score format: ${err.message}`, 5000);
    }
  }

  async getCurrentScoreFormat() {
    const query = `query { Viewer { mediaListOptions { scoreFormat } } }`;
    const response = await this.makeGraphQLRequest(query);
    return response.json?.data?.Viewer?.mediaListOptions?.scoreFormat;
  }

  async updateScoreFormat() {
    const mutation = `mutation { UpdateUser(scoreFormat: POINT_10_DECIMAL) { mediaListOptions { scoreFormat } } }`;
    const response = await this.makeGraphQLRequest(mutation);
    
    if (response.json?.errors) {
      const errorMsg = response.json.errors[0]?.message || 'Unknown error';
      throw new Error(errorMsg);
    }
    
    const updatedFormat = response.json?.data?.UpdateUser?.mediaListOptions?.scoreFormat;
    
    if (updatedFormat === 'POINT_10_DECIMAL') {
      new Notice('✅ Score format updated to 0.0-10.0 scale', 3000);
      console.log('🎉 Score format successfully changed to POINT_10_DECIMAL');
    } else {
      throw new Error(`Score format not updated properly. Got: ${updatedFormat}`);
    }
  }

  async getAuthenticatedUsername() {
    const query = `query { Viewer { name } }`;
    const res = await this.makeGraphQLRequest(query);
    
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
  static REDIRECT_URI = 'http://localhost:8080/callback';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.malAccessToken && this.isTokenValid());
  }

  generateSecureRandom(length) {
    const arr = new Uint8Array(length);
    
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      try {
        crypto.getRandomValues(arr);
        return arr;
      } catch (e) {
        console.log('[MAL-AUTH] crypto.getRandomValues failed, using Math.random fallback', e);
      }
    }
    
    console.log('[MAL-AUTH] crypto.getRandomValues not available, using Math.random');
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }

  makeVerifier() {
    const arr = this.generateSecureRandom(32);
    return btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 128);
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
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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

    const authUrl = this.buildAuthUrl(challenge, state);
    await this.openUrl(authUrl, '🔐 Opening MyAnimeList login page…');

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

  buildAuthUrl(challenge, state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.plugin.settings.malClientId,
      redirect_uri: MALAuthentication.REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'plain',
      state: state
    });
    return `${MALAuthentication.MAL_AUTH_URL}?${params}`;
  }

  async openUrl(url, noticeText) {
    new Notice(noticeText, 3000);
    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  extractAuthCode(input) {
    const trimmed = input.trim();
    
    // Direct code check
    if (!trimmed.includes('://') && !trimmed.includes('?') && !trimmed.includes('&')) {
      if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
    }
    
    // Try URL parsing
    try {
      const url = trimmed.startsWith('?') ? 
        new URL('http://localhost' + trimmed) : 
        trimmed.includes('://') ? new URL(trimmed) : null;
      
      if (url) {
        const code = url.searchParams.get('code');
        if (code) return decodeURIComponent(code);
      }
    } catch (e) {
      // Fall through to regex
    }
    
    // Regex fallback
    const codeMatch = trimmed.match(/[?&]code=([^&\s]+)/);
    return codeMatch ? decodeURIComponent(codeMatch[1]) : null;
  }

  async exchangeCodeForToken(code) {
    if (!code || code.length < 10) {
      throw new Error('Invalid authorization code');
    }

    new Notice('Exchanging authorization code for tokens…');

    const body = this.buildTokenRequestBody(code);

    try {
      const res = await this.makeRequest(MALAuthentication.MAL_TOKEN_URL, body);
      await this.handleTokenResponse(res);
    } catch (err) {
      new Notice(`❌ MAL Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  buildTokenRequestBody(code) {
    const body = new URLSearchParams({
      client_id: this.plugin.settings.malClientId,
      code: code,
      code_verifier: this.verifier,
      grant_type: 'authorization_code',
      redirect_uri: MALAuthentication.REDIRECT_URI
    });

    const secret = this.plugin.settings.malClientSecret?.trim();
    if (secret) body.append('client_secret', secret);
    
    return body;
  }

  async makeRequest(url, body, headers = {}) {
    return this.plugin.requestQueue.add(() =>
      requestUrl({
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...headers
        },
        body: body.toString(),
        throw: false
      })
    );
  }

  async handleTokenResponse(res) {
    if (res.status < 200 || res.status >= 300) {
      throw new Error(this.buildTokenErrorMessage(res));
    }

    const data = this.parseResponse(res);
    if (!data.access_token) {
      throw new Error('No access token received from MyAnimeList');
    }

    await this.saveTokenData(data);
    await this.postAuthSuccess();
  }

  buildTokenErrorMessage(res) {
    const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
    let errorMsg = `Token exchange failed (HTTP ${res.status})`;
    
    try {
      const errorData = res.json || (res.text ? JSON.parse(res.text) : {});
      
      if (errorData.error) {
        errorMsg += `: ${errorData.error}`;
        if (errorData.error_description) {
          errorMsg += ` - ${errorData.error_description}`;
        }
        
        const tips = {
          invalid_client: 'Check your Client ID and Secret in settings. For apps without a secret, leave the Client Secret field empty.',
          invalid_request: 'Ensure your Redirect URI exactly matches what\'s registered in your MAL app settings.',
          invalid_grant: 'The authorization code may have expired or been used already. Please try authenticating again.'
        };
        
        if (tips[errorData.error]) {
          errorMsg += `\n\nTip: ${tips[errorData.error]}`;
        }
      }
    } catch (parseError) {
      errorMsg += `: ${errorText}`;
    }
    
    return errorMsg;
  }

  parseResponse(res) {
    try {
      return res.json || (res.text ? JSON.parse(res.text) : null);
    } catch (jsonError) {
      throw new Error('Invalid response from MyAnimeList server');
    }
  }

  async saveTokenData(data) {
    const settings = this.plugin.settings;
    settings.malAccessToken = data.access_token;
    settings.malRefreshToken = data.refresh_token;
    settings.malTokenExpiry = Date.now() + (data.expires_in * 1000);
    await this.plugin.saveSettings();
    this.plugin.cache.invalidateByUser(settings.malUserInfo?.name);
  }

  async postAuthSuccess() {
    try {
      await this.fetchUserInfo();
      const username = this.plugin.settings.malUserInfo?.name || 'user';
      new Notice(`✅ Successfully authenticated with MAL! Welcome ${username} 🎉`, 4000);
    } catch (userError) {
      console.log('[MAL-AUTH] Failed to fetch user info but auth succeeded', userError);
      new Notice('✅ Authentication successful! 🎉', 4000);
    }
  }

  async fetchUserInfo() {
    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: MALAuthentication.MAL_USER_URL,
        method: 'GET',
        headers: { Authorization: `Bearer ${this.plugin.settings.malAccessToken}` },
        throw: false
      })
    );
    
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not fetch user info (HTTP ${res.status})`);
    }
    
    this.plugin.settings.malUserInfo = this.parseResponse(res);
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

    const secret = this.plugin.settings.malClientSecret?.trim();
    if (secret) body.append('client_secret', secret);

    const res = await this.makeRequest(MALAuthentication.MAL_TOKEN_URL, body);

    if (res.status < 200 || res.status >= 300) {
      const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
      throw new Error(`Token refresh failed (HTTP ${res.status}): ${errorText}`);
    }

    const data = this.parseResponse(res);
    const settings = this.plugin.settings;
    settings.malAccessToken = data.access_token;
    settings.malRefreshToken = data.refresh_token || settings.malRefreshToken;
    settings.malTokenExpiry = Date.now() + (data.expires_in * 1000);
    await this.plugin.saveSettings();
  }

  isTokenValid() {
    const { malAccessToken, malTokenExpiry } = this.plugin.settings;
    return !!(malAccessToken && malTokenExpiry && Date.now() < (malTokenExpiry - 5 * 60 * 1000));
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
    const settings = this.plugin.settings;
    const username = settings.malUserInfo?.name;
    
    Object.assign(settings, {
      malAccessToken: '',
      malRefreshToken: '',
      malTokenExpiry: null,
      malUserInfo: null,
      malClientId: '',
      malClientSecret: ''
    });
    
    await this.plugin.saveSettings();
    
    if (username) this.plugin.cache.invalidateByUser(username);
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

class Edit {
  constructor(plugin) {
    this.plugin = plugin;
    this.saving = false;
    this.config = {
      statuses: [
        { value: 'CURRENT', label: 'Watching/Reading', emoji: '📺' },
        { value: 'PLANNING', label: 'Plan to Watch/Read', emoji: '📋' },
        { value: 'COMPLETED', label: 'Completed', emoji: '✅' },
        { value: 'DROPPED', label: 'Dropped', emoji: '❌' },
        { value: 'PAUSED', label: 'Paused', emoji: '⏸️' },
        { value: 'REPEATING', label: 'Rewatching/Rereading', emoji: '🔄' }
      ],
      fields: {
        status: { label: 'Status', emoji: '🧿', id: 'zoro-status' },
        score: { label: 'Score', emoji: '⭐', id: 'zoro-score', min: 0, max: 10, step: 0.1 },
        progress: { label: 'Progress', emoji: '📊', id: 'zoro-progress' }
      },
      buttons: {
        save: { label: 'Save', class: 'zoro-save-btn' },
        remove: { label: '️Remove', class: 'zoro-remove-btn' },
        favorite: { class: 'zoro-fav-btn', hearts: { empty: '', filled: '' } },
        close: { class: 'zoro-modal-close' }
      }
    };
  }

  createEditModal(entry, onSave, onCancel) {
    // Create modal structure
    const modal = this.createModalStructure();
    const { overlay, content, form } = modal;
    
    // Create all elements
    const title = this.createTitle(entry);
    const closeBtn = this.createCloseButton(onCancel, modal);
    const favoriteBtn = this.createFavoriteButton(entry);
    const formFields = this.createFormFields(entry);
    const quickButtons = this.createQuickProgressButtons(entry, formFields.progress.input, formFields.status.input);
    const actionButtons = this.createActionButtons(entry, onSave, modal);
    
    // Setup interactions
    this.setupModalInteractions(modal, overlay, onCancel);
    this.setupFormSubmission(form, entry, onSave, actionButtons.save, formFields, modal);
    this.setupEscapeListener(onCancel, modal, () => {
      this.handleSave(entry, onSave, actionButtons.save, formFields, modal);
    });
    
    // Assemble modal
    this.assembleModal(content, form, {
      title,
      closeBtn,
      favoriteBtn,
      formFields,
      quickButtons,
      actionButtons
    });
    
    // Show modal
    document.body.appendChild(modal.container);
    
    // Initialize favorite status
    this.initializeFavoriteButton(entry, favoriteBtn);
    
    return modal;
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
  
  createCloseButton(onCancel, modal) {
    const closeBtn = document.createElement('button');
    closeBtn.className = this.config.buttons.close.class;
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close modal');
    closeBtn.title = 'Close';
    
    closeBtn.onclick = () => this.closeModal(modal.container, onCancel);
    
    return closeBtn;
  }
  
  createFavoriteButton(entry) {
    const favBtn = document.createElement('button');
    favBtn.className = this.config.buttons.favorite.class;
    favBtn.type = 'button';
    favBtn.title = 'Toggle Favorite';
    favBtn.textContent = entry.media.isFavourite ? 
      this.config.buttons.favorite.hearts.filled : 
      this.config.buttons.favorite.hearts.empty;
    
    favBtn.onclick = () => this.toggleFavorite(entry, favBtn);
    
    return favBtn;
  }
  
  createFormFields(entry) {
    const statusField = this.createStatusField(entry);
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
  
  createStatusField(entry) {
    const config = this.config.fields.status;
    return this.createFormField({
      type: 'select',
      label: config.label,
      emoji: config.emoji,
      id: config.id,
      value: entry.status,
      options: { items: this.config.statuses }
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
        placeholder: `e.g. ${config.max/2 + config.max/4}` // e.g. 7.5
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

  createActionButtons(entry, onSave, modal) {
    const container = document.createElement('div');
    container.className = 'zoro-modal-buttons';
    
    const removeBtn = this.createActionButton({
      label: this.config.buttons.remove.label,
      className: this.config.buttons.remove.class,
      onClick: () => this.handleRemove(entry, modal.container)
    });
    
    const saveBtn = this.createActionButton({
      label: this.config.buttons.save.label,
      className: this.config.buttons.save.class,
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
  
  setupModalInteractions(modal, overlay, onCancel) {
    overlay.onclick = () => this.closeModal(modal.container, onCancel);
  }
  
  setupFormSubmission(form, entry, onSave, saveBtn, formFields, modal) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.handleSave(entry, onSave, saveBtn, formFields, modal);
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
    
    // Store reference for cleanup
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

  async initializeFavoriteButton(entry, favBtn) {
    if (entry.media.isFavourite !== undefined) {
      favBtn.className = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      favBtn.classNamesabled = false;
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
      
      const toggleResult = res.json.data?.ToggleFavourite;
      let isFav = false;
      
      if (isAnime && toggleResult?.anime?.nodes) {
        isFav = toggleResult.anime.nodes.some(node => node.id === entry.media.id);
      } else if (!isAnime && toggleResult?.manga?.nodes) {
        isFav = toggleResult.manga.nodes.some(node => node.id === entry.media.id);
      }
      
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

  async handleRemove(entry, modalElement) {
    if (!confirm('Remove this entry?')) return;
    
    const removeBtn = modalElement.querySelector('.zoro-remove-btn');
    removeBtn.disabled = true;
    removeBtn.textContent = '⏳';
    
    try {
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
      
      this.invalidateCache(entry);
      this.refreshUI(entry);
      this.closeModal(modalElement, () => {});
      
      new Notice('✅ Removed');
    } catch (e) {
      this.showModalError(modalElement.querySelector('.zoro-edit-form'), `Remove failed: ${e.message}`);
      removeBtn.disabled = false;
      removeBtn.textContent = '🗑️';

    }
  }

  async handleSave(entry, onSave, saveBtn, formFields, modal) {
    if (this.saving) return;
    this.saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    const form = modal.form;
    const scoreVal = parseFloat(formFields.score.input.value);
    
    // Validation
    if (formFields.score.input.value && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
      this.showModalError(form, "Score must be between 0 and 10");
      this.resetSaveButton(saveBtn);
      return;
    }
    
    try {
      const updates = {
        status: formFields.status.input.value,
        score: formFields.score.input.value === '' ? null : scoreVal,
        progress: parseInt(formFields.progress.input.value) || 0
      };
      
      await onSave(updates);
      
      // Update entry data
      Object.assign(entry, updates);
      
      this.invalidateCache(entry);
      this.refreshUI(entry);
      this.closeModal(modal.container, () => {});
      
      new Notice('✅ Saved');
    } catch (err) {
      this.showModalError(form, `Save failed: ${err.message}`);
      this.resetSaveButton(saveBtn);
      return;
    }
    
    this.resetSaveButton(saveBtn);
  }
  
  resetSaveButton(saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    this.saving = false;
  }
  
  showModalError(form, msg) {
    form.querySelector('.zoro-modal-error')?.remove();
    const banner = document.createElement('div');
    banner.className = 'zoro-modal-error';
    banner.textContent = msg;
    form.appendChild(banner);
  }
  
  invalidateCache(entry) {
    this.plugin.cache.invalidateByMedia(String(entry.media.id));
    const listKey = this.plugin.api.createCacheKey({ 
      type: 'list', 
      username: entry.media.user?.name, 
      listType: entry.status 
    });
    const entryKey = this.plugin.api.createCacheKey({ 
      type: 'single', 
      mediaId: entry.media.id 
    });
    this.plugin.cache.delete(listKey, { scope: 'userData' });
    this.plugin.cache.delete(entryKey, { scope: 'mediaData' });
  }
  
  updateAllFavoriteButtons(entry) {
    document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-fav-btn`)
      .forEach(btn => btn.textContent = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart');
  }
  
  refreshUI(entry) {
    const card = document.querySelector(`.zoro-container [data-media-id="${entry.media.id}"]`);
    if (card) {
      // Update individual elements
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
      // Refresh entire container
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
    
    message.textContent = 'You need to authenticate with AniList to edit your anime/manga entries. This will allow you to update your progress, scores, and status directly from Obsidian.';

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
      new Notice('📝 Please use AniList to authenticate from settings');
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-close-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => closeModal();

    buttonContainer.appendChild(authenticateBtn);
    buttonContainer.appendChild(cancelBtn);

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

  async exportUnifiedListsToCSV() {
    let username = this.plugin.settings.authUsername;
    if (!username) username = this.plugin.settings.defaultUsername;
    if (!username) {
      new Notice('Set a default username in settings first.', 4000);
      return;
    }

    const useAuth = !!this.plugin.settings.accessToken;
    const query = `
      query ($userName: String) {
        MediaListCollection(userName: $userName, type: ANIME) {
          lists {
            name
            entries {
              status progress score(format: POINT_10_DECIMAL) repeat
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

    new Notice(`${useAuth ? '📥 Full' : '📥 Public'} export started…`, 4000);
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
      const percent = type === 'ANIME' ? 50 : 100;
      this.updateProgressNotice(progress, `📊 Exporting… ${percent} %`);
      return res.json.data?.MediaListCollection?.lists || [];
    };

    const [animeLists, mangaLists] = await Promise.all([fetchType('ANIME'), fetchType('MANGA')]);
    const lists = [...animeLists, ...mangaLists];

    if (!lists.flatMap(l => l.entries).length) {
      new Notice('No lists found (private or empty).', 4000);
      return;
    }

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
    const suffix = useAuth ? '' : '_PUBLIC';
    const fileName = `AniList_${username}${suffix}_${new Date().toISOString().slice(0, 10)}.csv`;
    await this.plugin.app.vault.create(fileName, csv);
    new Notice(`✅ CSV saved to vault: ${fileName}`, 4000);
    await this.plugin.app.workspace.openLinkText(fileName, '', false);
  }
  
  async exportMALListsToCSV() {
  if (!this.plugin.malAuth.isLoggedIn) {
    new Notice('❌ Please authenticate with MyAnimeList first.', 4000);
    return;
  }

  const username = this.plugin.settings.malUserInfo?.name;
  if (!username) {
    new Notice('❌ Could not fetch MAL username.', 4000);
    return;
  }

  new Notice('📥 Exporting MyAnimeList…', 3000);
  const progress = this.createProgressNotice('📊 MAL export 0 %');

  const fetchType = async type => {
    const headers = this.plugin.malAuth.getAuthHeaders();
    const apiType = type === 'ANIME' ? 'anime' : 'manga';
    const url = `https://api.myanimelist.net/v2/users/@me/${apiType}list?fields=list_status,media{title,start_date,end_date,num_episodes,num_chapters,status}&limit=1000&nsfw=true`;

    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({ url, method: 'GET', headers })
    );
      return (res.json?.data || []).map(item => ({
    ...item,
    _type: type
  }));
    this.updateProgressNotice(progress, `📊 MAL export ${type === 'ANIME' ? 50 : 100} %`);
    return res.json?.data || [];
  };

  const [anime, manga] = await Promise.all([
    fetchType('ANIME'),
    fetchType('MANGA')
  ]);

  const rows = [];
  const headers = [
    'Type','Status','Progress','Score','Title','Start','End','Episodes','Chapters','Mean','MAL_ID','URL'
  ];
  rows.push(headers.join(','));

  [...anime, ...manga].forEach(item => {
    const m = item.node;
    const s = item.list_status;
    const type = item._type;
    rows.push([
      type,
      s.status,
      s.num_episodes_watched || s.num_chapters_read || 0,
      s.score || '',
      this.csvEscape(m.title),
      this.dateToString(s.start_date),
      this.dateToString(s.finish_date),
      m.num_episodes || '',
      m.num_chapters || '',
      m.mean || '',
      m.id,
      this.csvEscape(`https://myanimelist.net/${type.toLowerCase()}/${m.id}`)
    ].join(','));
  });

  const csv = rows.join('\n');
  const fileName = `MAL_${username}_${new Date().toISOString().slice(0, 10)}.csv`;
  await this.plugin.app.vault.create(fileName, csv);
  new Notice(`✅ MAL CSV saved: ${fileName}`, 4000);
  await this.plugin.app.workspace.openLinkText(fileName, '', false);
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
    new Notice(message, 4000);
  }
}

 class Sample {
    constructor(plugin) {
        this.plugin = plugin;
    }

    async createSampleFolders() {
      new Notice('Creating…', 3000);
        const vault = this.plugin.app.vault;
        const folders = [
            {
                name: 'Anime Dashboard',
                files: ['Watching.md', 'Planning.md', 'Repeating.md', 'On Hold.md', 'Completed.md', 'Dropped.md',
                'Trending.md','Stats.md'],
                firstFile: 'Watching.md'
            },
            {
                name: 'Manga Dashboard', 
                files: ['Reading.md', 'Planning.md', 'Repeating.md', 'On Hold.md', 'Completed.md', 'Dropped.md', 'Stats.md'],
                firstFile: 'Reading.md'
            }
        ];

        for (const folder of folders) {
            // Check if folder already exists
            if (vault.getAbstractFileByPath(folder.name)) {
                new Notice('⏭️ ' + folder.name + ' already exists');
                continue;
            }

            const baseUrl = 'https://raw.githubusercontent.com/zara-kasi/zoro/main/Template/' + 
                           encodeURIComponent(folder.name) + '/';

            // Create the main folder
            await vault.createFolder(folder.name);
            let successfulFiles = 0;

            // Download and create each template file
            for (const templateFile of folder.files) {
                try {
                    const fileUrl = baseUrl + encodeURIComponent(templateFile);
                    const response = await fetch(fileUrl);
                    
                    if (!response.ok) {
                        continue; // Skip this file if download fails
                    }

                    const content = await response.text();
                    const filePath = folder.name + '/' + templateFile;
                    
                    await vault.create(filePath, content);
                    successfulFiles++;
                    
                } catch (error) {
                    // Silently continue with next file if this one fails
                    continue;
                }
            }

            new Notice('✅ ' + folder.name + ' (' + successfulFiles + ' files)');

            // Open the first file if any files were created successfully
            if (successfulFiles > 0) {
                this.plugin.app.workspace.openLinkText(folder.firstFile, folder.name, false);
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

    const Account = section('👤 Account', true);
    const Setup = section('🧭 Setup');
    const Display = section('📺 Display');
    const Theme = section('🌌 Theme');
    const More = section('✨  More');
    const Data = section('📤 Data');
    const Cache = section('🔁 Cache');
    const Exp = section('🚧 Upcoming');
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
    
    new Setting(Setup)
      .setName('🗝️ Authentication ?')
      .setDesc('Takes less than a minute—no typing, just copy and paste.')
      .addButton(button => button
        .setButtonText('Guide')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md', '_blank');
        }));

    new Setting(Setup)
      .setName('⚡ Sample Folders')
      .setDesc('(Recommended)')
      .addButton(button =>
        button
          .setButtonText('Create')
          .onClick(async () => {
            await this.plugin.sample.createSampleFolders();
          })
      );

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
  .setName('🧮 Score Scale')
  .setDesc('Ensures all ratings use the 0.0–10.0 point scale.')
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
      .setName('🧾 Export your data')
      .setDesc("Everything you've watched, rated, and maybe ghosted — neatly exported into a CSV.")
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
      .setName('️📚 Data Migration')
      .setDesc('Instructions to export from MAL and import into AniList (and vice versa).')
      .addButton(button =>
        button
          .setClass('mod-cta')
          .setButtonText('Open')
          .onClick(() => {
            window.open('https://github.com/zara-kasi/zoro/blob/62ce085c71b45c29c0dc61a061c8dedc1d7a7189/Docs/data.md', '_blank');
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
    .setButtonText('Clear Cache')
    .setWarning()
    .onClick(async () => {
      if (confirm('⚠️ This will delete ALL cached data. Continue?')) {
        const cleared = this.plugin.cache.clear();
        new Notice(`✅ Cache cleared (${cleared} entries)`, 3000);
      }
    })
  );


    const malAuthSetting = new Setting(Exp)
      .setName('🗾 MyAnimeList')
      .setDesc('Lets you edit and view your MAL entries.');

    malAuthSetting.addButton(btn => {
      this.malAuthButton = btn;
      this.updateMALAuthButton();
      btn.onClick(async () => {
        await this.handleMALAuthButtonClick();
      });
    });

    new Setting(About)
      .setName('Author')
      .setDesc(this.plugin.manifest.author);
    new Setting(About)
      .setName('Version')
      .setDesc(this.plugin.manifest.version);
    new Setting(About)
      .setName('Privacy')
      .setDesc('Zoro only talks to the AniList API to fetch & update your media data. Nothing else is sent or shared—your data stays local.');

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
}

module.exports = {
  default: ZoroPlugin,
};

