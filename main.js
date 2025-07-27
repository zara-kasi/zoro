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

    this.ttlMap = { userData: 30 * 60 * 1000, mediaData: 10 * 60 * 1000, searchResults: 2 * 60 * 1000, mediaDetails: 60 * 60 * 1000, malData: 60 * 60 * 1000, ...ttlMap };
    this.stores = { userData: new Map(), mediaData: new Map(), searchResults: new Map() };
    this.indexes = { byUser: new Map(), byMedia: new Map(), byTag: new Map() };
    
    
    this.version = '3.0.0';
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

  enforceSize(scope) {
    const store = this.stores[scope];
    if (store.size <= this.maxSize) return 0;

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

    return toEvict.length;
  }

  get(key, options = {}) {
    const { scope = 'userData', ttl = null, refreshCallback = null } = options;
    const store = this.stores[scope];
    if (!store) { this.stats.misses++; return null; }

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
    }
    
    return deleted;
  }

  invalidateByUser(userKey) {
    const keys = this.indexes.byUser.get(userKey);
    if (!keys) return 0;

    let deleted = 0;
    keys.forEach(key => {
      for (const store of Object.values(this.stores)) {
        if (store.delete(key)) deleted++;
      }
      this.accessLog.delete(key);
    });

    this.indexes.byUser.delete(userKey);
    return deleted;
  }

  invalidateByMedia(mediaId) {
    const keys = this.indexes.byMedia.get(String(mediaId));
    if (!keys) return 0;

    let deleted = 0;
    keys.forEach(key => {
      for (const store of Object.values(this.stores)) {
        if (store.delete(key)) deleted++;
      }
      this.accessLog.delete(key);
    });

    this.indexes.byMedia.delete(String(mediaId));
    return deleted;
  }

  invalidateByTag(tag) {
    const keys = this.indexes.byTag.get(tag);
    if (!keys) return 0;

    let deleted = 0;
    keys.forEach(key => {
      for (const store of Object.values(this.stores)) {
        if (store.delete(key)) deleted++;
      }
      this.accessLog.delete(key);
    });

    this.indexes.byTag.delete(tag);
    return deleted;
  }

  clear(scope = null) {
    if (scope) {
      const store = this.stores[scope];
      if (!store) return 0;
      const count = store.size;
      store.clear();
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
    return total;
  }

  pruneExpired(scope = null) {
    const scopes = scope ? [scope] : Object.keys(this.stores);
    let total = 0;

    scopes.forEach(currentScope => {
      const store = this.stores[currentScope];
      if (!store) return;

      const toDelete = [];
      const now = Date.now();

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
    if (this.loadQueue.has(`${scope}:${key}`)) return;
    
    this.loadQueue.add(`${scope}:${key}`);
    
    setTimeout(async () => {
      try {
        const newValue = await callback(key, scope);
        if (newValue !== undefined) {
          this.set(key, newValue, { scope, refreshCallback: callback });
        }
      } catch (error) {
        this.log('REFRESH_ERROR', scope, key, error.message);
      } finally {
        this.loadQueue.delete(`${scope}:${key}`);
      }
    }, 0);
  }

  startAutoPrune(interval = 5 * 60 * 1000) {
    this.stopAutoPrune();
    this.intervals.prune = setInterval(() => this.pruneExpired(), interval);
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

  startIncrementalSave(interval = 2 * 60 * 1000) {
    this.stopIncrementalSave();
    this.intervals.save = setInterval(() => this.saveToDisk(), interval);
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
        }
      };

      for (const [scope, store] of Object.entries(this.stores)) {
        payload.data[scope] = Array.from(store.entries());
      }

      if (this.obsidianPlugin?.app?.vault?.adapter) {
        const adapter = this.obsidianPlugin.app.vault.adapter;
        const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
        const cachePath = `${pluginDir}/cache.json`;
        
        await adapter.write(cachePath, JSON.stringify(payload));
        this.log('SAVE_SUCCESS', 'system', cachePath, 'Obsidian file system');
      } else if (this.obsidianPlugin?.saveData) {
        const existingData = await this.obsidianPlugin.loadData() || {};
        existingData.__cache = payload;
        await this.obsidianPlugin.saveData(existingData);
        this.log('SAVE_SUCCESS', 'system', 'data.json.__cache', 'Plugin data nested');
      }

      this.state.lastSaved = Date.now();
      return true;
    } catch (error) {
      this.log('SAVE_ERROR', 'system', '', error.message);
      return false;
    } finally {
      this.state.saving = false;
    }
  }

  async loadFromDisk() {
    if (this.state.loading) return 0;
    this.state.loading = true;

    try {
      let data;
      
      if (this.obsidianPlugin?.app?.vault?.adapter) {
        const adapter = this.obsidianPlugin.app.vault.adapter;
        const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
        const cachePath = `${pluginDir}/cache.json`;
        
        try {
          const raw = await adapter.read(cachePath);
          data = JSON.parse(raw);
          this.log('LOAD_SUCCESS', 'system', cachePath, 'Obsidian file system');
        } catch (error) {
          if (!error.message.includes('ENOENT')) {
            this.log('LOAD_ERROR', 'system', cachePath, error.message);
          }
          data = null;
        }
      } else if (this.obsidianPlugin?.loadData) {
        const pluginData = await this.obsidianPlugin.loadData() || {};
        data = pluginData.__cache || null;
        this.log('LOAD_SUCCESS', 'system', 'data.json.__cache', 'Plugin data nested');
      }

      if (!data) {
        this.log('LOAD_EMPTY', 'system', '', 'No cache data found');
        return 0;
      }

      let loaded = 0;
      const now = Date.now();

      for (const [scope, entries] of Object.entries(data.data || {})) {
        const store = this.stores[scope];
        if (!store || !Array.isArray(entries)) continue;

        for (const [key, entry] of entries) {
          if (!entry?.timestamp) continue;
          
          const ttl = entry.customTtl ?? this.ttlMap[scope];
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

      this.state.lastLoaded = Date.now();
      this.log('LOAD_COMPLETE', 'system', '', `${loaded} entries loaded`);
      return loaded;
    } catch (error) {
      this.log('LOAD_ERROR', 'system', '', error.message);
      return 0;
    } finally {
      this.state.loading = false;
    }
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(1) : '0.0';
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      totalRequests: total,
      cacheSize: Object.values(this.stores).reduce((sum, store) => sum + store.size, 0),
      indexSize: Object.values(this.indexes).reduce((sum, index) => sum + index.size, 0)
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

  destroy() {
    Object.values(this.intervals).forEach(interval => {
      if (interval) clearInterval(interval);
    });
    
    this.clear();
    this.loadQueue.clear();
    this.saveQueue.clear();
    
    Object.keys(this.stats).forEach(key => this.stats[key] = 0);
    this.state = { loading: false, saving: false, lastSaved: null, lastLoaded: null };
  }
}

class RequestQueue {
  constructor(plugin) {
    this.plugin = plugin;
    this.queue = [];
    this.delay = 700;
    this.isProcessing = false;
  }
  add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  }

  showGlobalLoader() {
    if (!this.plugin?.settings?.showLoadingIcon) return;
    document.getElementById('zoro-global-loader')?.classList.add('zoro-show');
  }

  hideGlobalLoader() {
    document.getElementById('zoro-global-loader')?.classList.remove('zoro-show');
  }

  async process() {
    if (this.isProcessing || !this.queue.length) {
      if (!this.queue.length) this.hideGlobalLoader();
      return;
    }
    this.isProcessing = true;
    if (this.queue.length === 1) this.showGlobalLoader();

    const { requestFn, resolve, reject } = this.queue.shift();
    try {
      const result = await requestFn();
      resolve(result);
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
  }

  createCacheKey(config) {
    const sortedConfig = {};
    Object.keys(config).sort().forEach(key => {
      sortedConfig[key] = config[key];
    });
    return JSON.stringify(sortedConfig);
  }

  async makeObsidianRequest(code, redirectUri) {
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
    };

    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://anilist.co/api/v2/oauth/token',
        method: 'POST',
        headers,
        body: body.toString()
      }));

      if (!response || typeof response.json !== 'object') {
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
    
    let cacheType;
    if (config.type === 'stats') {
      cacheType = 'userData';
    } else if (config.type === 'single') {
      cacheType = 'mediaData';
    } else if (config.type === 'search') {
      cacheType = 'searchResults';
    } else {
      cacheType = 'userData';
    }
    const cacheTtl = null;
    const cached = !config.nocache && this.plugin.cache.get(cacheKey, { scope: cacheType, ttl: cacheTtl });
    if (cached) {
      console.log(`[Zoro] Cache HIT for ${cacheType}: ${cacheKey.substring(0, 50)}...`);
      return cached;
    }

    console.log(`[Zoro] Cache MISS for ${cacheType}: ${cacheKey.substring(0, 50)}...`);

    let query, variables;
    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
      if (this.plugin.settings.accessToken) {
        await this.plugin.auth.ensureValidToken();
        headers['Authorization'] = `Bearer ${this.plugin.settings.accessToken}`;
      }
      
      if (config.type === 'stats') {
        query = this.getUserStatsQuery();
        variables = { username: config.username };
      } else if (config.type === 'single') {
        query = this.getSingleMediaQuery();
        variables = {
          username: config.username,
          mediaId: parseInt(config.mediaId),
          type: config.mediaType
        };
      } else if (config.type === 'search') {
        query = this.getSearchMediaQuery(config.layout);
        variables = {
          search: config.search,
          type: config.mediaType,
          page: config.page || 1,
          perPage: config.perPage || 5,
        };
      } else {
        query = this.getMediaListQuery(config.layout);
        variables = {
          username: config.username,
          status: config.listType,
          type: config.mediaType || 'ANIME',
        };
      }
      
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables })
      }));
      
      const result = response.json;
      if (!result) throw new Error('Empty response from AniList.');
      
      if (result.errors && result.errors.length > 0) {
        const firstError = result.errors[0];
        const isPrivate = firstError.message?.includes('Private') || firstError.message?.includes('permission');

        if (isPrivate) {
          if (this.plugin.settings.accessToken) {
            throw new Error('🚫 List is private and this token has no permission.');
          } else {
            throw new Error('🔒 List is private. Please authenticate to access it.');
          }
        }
        throw new Error(firstError.message || 'AniList returned an unknown error.');
      }
      
      if (!result.data) {
        throw new Error('AniList returned no data.');
      }
      
      this.plugin.cache.set(cacheKey, result.data, { scope: cacheType });
      console.log(`[Zoro] Cached data for ${cacheType}: ${cacheKey.substring(0, 50)}...`);
      
      return result.data;

    } catch (error) {
      console.error('[Zoro] fetchAniListData() failed:', error);
      throw error;
    }
  }

  async updateMediaListEntry(mediaId, updates) {
    try {
      if (!this.plugin.settings.accessToken || !(await this.plugin.auth.ensureValidToken())) {
        throw new Error('❌ Authentication required to update entries.');
      }

      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
            id
            status
            score
            progress
          }
        }
      `;
      
      const variables = {
        mediaId,
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.score !== undefined && updates.score !== null && { score: updates.score }),
        ...(updates.progress !== undefined && { progress: updates.progress }),
      };
      
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
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
      
      this.plugin.cache.invalidateByMedia(mediaId);
      
      return result.data.SaveMediaListEntry;

    } catch (error) {
      console.error('[Zoro] updateMediaListEntry failed:', error);
      throw new Error(`❌ Failed to update entry: ${error.message}`);
    }
  }

  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.plugin.settings.accessToken) return false;
    
    try {
      const config = {
        type: 'single',
        mediaType: mediaType,
        mediaId: parseInt(mediaId)
      };
      
      const response = await this.fetchAniListData(config);
      return response.MediaList !== null;
    } catch (error) {
      console.warn('Error checking media list status:', error);
      return false;
    }
  }

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
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
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
    const baseFields = `
      id
      status
      score
      progress
    `;

    const mediaFields = {
      compact: `
        id
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
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
      `
    };

    const selectedMediaFields = mediaFields[layout] || mediaFields.card;

    return `
      query ($username: String, $mediaId: Int, $type: MediaType) {
        MediaList(userName: $username, mediaId: $mediaId, type: $type) {
          ${baseFields}
          media {
            ${selectedMediaFields}
          }
        }
      }
    `;
  }

  getUserStatsQuery({ mediaType = 'ANIME', layout = 'card', useViewer = false } = {}) {
    const typeKey = mediaType.toLowerCase();

    const statFields = {
      compact: `
        count
        meanScore
      `,
      card: `
        count
        meanScore
        standardDeviation
      `,
      full: `
        count
        meanScore
        standardDeviation
        episodesWatched
        minutesWatched
        chaptersRead
        volumesRead
      `
    };

    const selectedFields = statFields[layout] || statFields.card;
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
        }
      }
    `;
  }

  getSearchMediaQuery(layout = 'card') {
    const mediaFields = {
      compact: `
        id
        title {
          romaji
        }
        coverImage {
          medium
        }
      `,
      card: `
        id
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
      `
    };

    const fields = mediaFields[layout] || mediaFields.card;

    return `
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(search: $search, type: $type) {
            ${fields}
          }
        }
      }
    `;
  }

  getAniListUrl(mediaId, mediaType = 'ANIME') {
    if (!mediaId || typeof mediaId !== 'number') {
      throw new Error(`Invalid mediaId: ${mediaId}`);
    }

    const type = String(mediaType).toUpperCase();
    const validTypes = ['ANIME', 'MANGA'];
    const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime';

    return `https://anilist.co/${urlType}/${mediaId}`;
  }
}

class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.globalListeners = [];
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
    
    try {
      await this.loadSettings();
      console.log('[Zoro] Settings loaded.');
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }
    
    await this.cache.loadFromDisk(); this.cache.startAutoPrune(10 * 60 * 1000);
    
    try {
      this.injectCSS();
      console.log('[Zoro] CSS injected.');
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }
    
    
   if (this.settings.theme) {
  await this.theme.applyTheme(this.settings.theme);
}

    this.registerMarkdownCodeBlockProcessor('zoro', this.processor.processZoroCodeBlock.bind(this.processor));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processor.processZoroSearchCodeBlock.bind(this.processor));
    this.registerMarkdownPostProcessor(this.processor.processInlineLinks.bind(this.processor));
    
    this.addSettingTab(new ZoroSettingTab(this.app, this));
    console.log('[Zoro] Plugin loaded successfully.');
  }

  validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'table'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : getDefaultGridColumns(),
      theme: typeof settings?.theme === 'string' ? settings.theme : '',
      showCoverImages: !!settings?.showCoverImages,
      showRatings: !!settings?.showRatings,
      showProgress: !!settings?.showProgress,
      showGenres: !!settings?.showGenres,
      showLoadingIcon: typeof settings?.showLoadingIcon === 'boolean' ? settings.showLoadingIcon : true,
      hideUrlsInTitles: typeof settings?.hideUrlsInTitles === 'boolean' ? settings.hideUrlsInTitles : true,
      forceScoreFormat: true,
      clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
      clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
      redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
      accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : '',
      malClientId: typeof settings?.malClientId === 'string' ? settings.malClientId : '',
      malClientSecret: typeof settings?.malClientSecret === 'string' ? settings.malClientSecret : '',
      malAccessToken: typeof settings?.malAccessToken === 'string' ? settings.malAccessToken : '',
      malRefreshToken: typeof settings?.malRefreshToken === 'string' ? settings.malRefreshToken : '',
      malTokenExpiry: typeof settings?.malTokenExpiry === 'number' ? settings.malTokenExpiry : null,
      malUserInfo: typeof settings?.malUserInfo === 'object' ? settings.malUserInfo : null,
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
    () => {
    }
  );
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
    this.globalLoader.textContent = '⏳';
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
    console.log('[Zoro] Unloading plugin...');

    this.cache.stopAutoPrune()
       .stopBackgroundRefresh()
              .destroy();

    this.theme.removeTheme();
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
        existingStyle.remove();
        console.log(`Removed style element with ID: ${styleId}`);
    }

    const loader = document.getElementById('zoro-global-loader');
    if (loader) loader.remove();
}

}

class Processor {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source) || {};
      let skeleton;
      
      if (config.type === 'stats') {
        skeleton = this.plugin.render.createStatsSkeleton();
      } else if (config.type === 'single') {
        skeleton = this.plugin.render.createListSkeleton(1);
      } else {
        skeleton = this.plugin.render.createListSkeleton();
      }
      
      el.empty();
      el.appendChild(skeleton);

      if (config.useAuthenticatedUser) {
        const authUsername = await this.plugin.auth.getAuthenticatedUsername();
        if (!authUsername) {
          throw new Error('❌ Could not retrieve authenticated username...');
        }
        config.username = authUsername;
      }

      const doFetch = async () => {
        try {
          const data = await this.plugin.api.fetchAniListData(config);
          
          el.empty();
          
          if (config.type === 'stats') {
            this.plugin.render.renderUserStats(el, data.User);
          } else if (config.type === 'single') {
            this.plugin.render.renderSingleMedia(el, data.MediaList, config);
          } else {
            const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
            this.plugin.render.renderMediaList(el, entries, config);
          }
          
        } catch (err) {
          el.empty();
          this.plugin.renderError(el, err.message,
            'Failed to load list',
            doFetch
          );
        }
      };
      
      await doFetch();

    } catch (error) {
      el.empty();
      console.error('[Zoro] Code block processing error:', error);
      this.plugin.renderError(
        el,
        error.message || 'Unknown error occurred.',
        'Code block',
        () => this.processZoroCodeBlock(source, el, ctx)
      );
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
        try {
          await this.plugin.render.renderSearchInterface(el, config);
        } catch (err) {
          el.empty();
          this.plugin.renderError(el, err.message,
            'Search failed',
            doSearch
          );
        }
      };
      
      await doSearch();
    } catch (error) {
      console.error('[Zoro] Search block processing error:', error);
      el.empty();
      this.plugin.renderError(
        el,
        error.message || 'Failed to process Zoro search block.',
        'Search block',
        () => this.processZoroSearchCodeBlock(source, el, ctx)
      );
    }
  }

  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="zoro:"]');

    for (const link of inlineLinks) {
      const href = link.getAttribute('href');
      
      const placeholder = document.createElement('span');
      placeholder.textContent = '🔄 Loading Zoro...';
      link.replaceWith(placeholder);

      try {
        const config = this.parseInlineLink(href);
        const data = await this.plugin.api.fetchAniListData(config);

        const container = document.createElement('span');
        container.className = 'zoro-inline-container';
        
        if (config.type === 'stats') {
          this.plugin.render.renderUserStats(container, data.User);
        } else if (config.type === 'single') {
          this.plugin.render.renderSingleMedia(container, data.MediaList, config);
        } else {
          const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
          this.plugin.render.renderMediaList(container, entries, config);
        }

        placeholder.replaceWith(container);

        ctx.addChild({
          unload: () => {
            container.remove();
          }
        });

      } catch (error) {
        console.warn(`[Zoro] Inline link failed for ${href}:`, error);

        const container = document.createElement('span');
        container.className = 'zoro-inline-container';

        const retry = () => this.processInlineLinks(el, ctx);
        this.plugin.renderError(container, error.message, 'Inline link', retry);

        placeholder.replaceWith(container);
      }
    }
  }

  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    if (!config.username) {
      if (this.plugin.settings.defaultUsername) {
        config.username = this.plugin.settings.defaultUsername;
      } else if (this.plugin.settings.accessToken) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
      }
    }
    
    config.listType = config.listType || 'CURRENT';
    config.layout = config.layout || this.plugin.settings.defaultLayout;
    config.mediaType = config.mediaType || 'ANIME';
    
    return config;
  }

  parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.plugin.settings.defaultLayout;
    
    return config;
  }

  parseInlineLink(href) {
    const [base, hash] = href.replace('zoro:', '').split('#');

    const parts = base.split('/');
    let username, pathParts;

    if (parts[0] === '') {
      if (!this.plugin.settings.defaultUsername) {
        throw new Error('⚠️ Default username not set. Configure it in plugin settings.');
      }
      username = this.plugin.settings.defaultUsername;
      pathParts = parts.slice(1);
    } else {
      if (parts.length < 2) {
        throw new Error('❌ Invalid Zoro inline link format.');
      }
      username = parts[0];
      pathParts = parts.slice(1);
    }

    const config = {
      username: username,
      layout: 'card',
      type: 'list'
    };

    const main = pathParts[0];
    const second = pathParts[1];

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

    if (hash) {
      const hashParts = hash.split(',');
      for (const mod of hashParts) {
        if (mod === 'compact' || mod === 'card' || mod === 'minimal' || mod === 'full') {
          config.layout = mod;
        }
        if (mod === 'nocache') {
          config.nocache = true;
        }
      }
    }

    return config;
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

  renderUserStats(el, user) {
    el.empty(); el.className = 'zoro-container';
    if (!user?.statistics) { el.createDiv({ cls: 'zoro-error-box', text: 'Stats unavailable' }); return; }

    const container = el.createDiv({ cls: 'zoro-user-stats' });
    container.createDiv({ cls: 'zoro-user-header' }, div => {
      div.createEl('img', { cls: 'zoro-user-avatar', attr: { src: user.avatar?.medium || '', alt: user.name } });
      div.createEl('h3', { text: user.name });
    });

    const grid = container.createDiv({ cls: 'zoro-stats-grid' });
    ['anime', 'manga'].forEach(type => {
      const stats = user.statistics[type];
      if (!stats) return;
      const sec = grid.createDiv({ cls: 'zoro-stat-section' });
      sec.createEl('h4', { text: type.charAt(0).toUpperCase() + type.slice(1) });
      ['count', 'meanScore', 'episodesWatched', 'chaptersRead'].forEach(k => {
        if (stats[k] != null) sec.createDiv({ cls: 'zoro-stat-item', text: `${k}: ${stats[k].toLocaleString?.() ?? stats[k]}` });
      });
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
        .finally(() => {
          this.plugin.requestQueue.hideGlobalLoader();
        });
    } else {
      this.plugin.requestQueue.hideGlobalLoader();
    }
  }

  shouldFetchDetailedData(media) {
    const missingBasicData = !media.description || !media.genres || !media.averageScore;
    const isAnimeWithoutAiring = media.type === 'ANIME' && !media.nextAiringEpisode;
    
    return missingBasicData || isAnimeWithoutAiring;
  }

  async fetchAndUpdatePanel(mediaId, panel) {
    try {
      const detailedMedia = await this.fetchDetailedMediaData(mediaId);
      
      let malDataPromise = null;
      if (detailedMedia.idMal) {
        malDataPromise = this.fetchMALData(detailedMedia.idMal, detailedMedia.type);
      }
      
      if (this.currentPanel === panel && this.hasMoreData(detailedMedia)) {
        this.updatePanelContent(panel, detailedMedia, null);
      }
      
      if (malDataPromise) {
        const malData = await malDataPromise;
        if (this.currentPanel === panel && malData) {
          this.updatePanelContent(panel, detailedMedia, malData);
        }
      }
    } catch (error) {
      console.error('Background fetch failed:', error);
    }
  }
  
  hasMoreData(newMedia) {
    const hasBasicData = newMedia.description || newMedia.genres?.length > 0 || newMedia.averageScore > 0;
    const hasAiringData = newMedia.type === 'ANIME' && newMedia.nextAiringEpisode;
    
    return hasBasicData || hasAiringData;
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

  async fetchDetailedMediaData(mediaId) {
  const cacheKey = `details:${mediaId}`;
  const cached   = this.plugin.cache.get(cacheKey, { scope: 'mediaDetails' });
  if (cached) return cached;

  const query     = this.getDetailedMediaQuery();
  const variables = { id: mediaId };

  let response;
  try {
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

    if (!response?.data?.Media)
      throw new Error('No media data received');

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
  const cached   = this.plugin.cache.get(cacheKey, { scope: 'malData' });
  if (cached) return cached;

  try {
    const type     = mediaType === 'MANGA' ? 'manga' : 'anime';
    const response = await fetch(`https://api.jikan.moe/v4/${type}/${malId}`);

    if (!response.ok)
      throw new Error(`Jikan API error: ${response.status}`);

    const data = (await response.json())?.data;
    this.plugin.cache.set(cacheKey, data, { scope: 'malData' });
    return data;

  } catch (error) {
    console.error('Failed to fetch MAL data:', error);
    return null;
  }
}

  getDetailedMediaQuery() {
    return `query($id:Int){Media(id:$id){id type title{romaji english native}description(asHtml:false)format status season seasonYear averageScore genres nextAiringEpisode{airingAt episode timeUntilAiring}idMal}}`;
  }

  getAniListUrl(mediaId, mediaType = 'ANIME') {
    return this.plugin.getAniListUrl(mediaId, mediaType);
  }

  getMyAnimeListUrl(malId, mediaType = 'ANIME') {
    if (!malId) return null;
    const type = mediaType === 'MANGA' ? 'manga' : 'anime';
    return `https://myanimelist.net/${type}/${malId}`;
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
    closeBtn.onclick = () => this.closePanel();

    panel.appendChild(closeBtn);
    panel.appendChild(content);

    return panel;
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
    console.log('Creating external links for media:', media);
    console.log('Media idMal:', media.idMal);
    
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
      window.open(this.getAniListUrl(media.id, media.type), '_blank');
    };
    linksContainer.appendChild(anilistBtn);

    if (media.idMal) {
      console.log('MAL ID found, creating MAL button');
      const malBtn = document.createElement('button');
      malBtn.className = 'external-link-btn mal-btn';
      malBtn.innerHTML = '🔗 View on MAL';
      malBtn.onclick = (e) => {
        e.stopPropagation();
        window.open(this.getMyAnimeListUrl(media.idMal, media.type), '_blank');
      };
      linksContainer.appendChild(malBtn);
    } else {
      console.log('No MAL ID found for this media');
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

  handleOutsideClick(event) {
    if (this.currentPanel && !this.currentPanel.contains(event.target)) {
      this.closePanel();
    }
  }

  closePanel() {
    if (this.currentPanel) {
      const countdownElements = this.currentPanel.querySelectorAll('.countdown-value[data-interval-id]');
      countdownElements.forEach(element => {
        const intervalId = element.dataset.intervalId;
        if (intervalId) {
          clearInterval(parseInt(intervalId));
        }
      });

      document.removeEventListener('click', this.boundOutsideClickHandler);
      this.currentPanel.remove();
      this.currentPanel = null;
    }
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

    const pin = await this.promptModal('Paste the PIN code from the browser:');
    if (!pin) return;

    await this.exchangePin(pin);
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
      new Notice('✅ Authenticated successfully!', 4000);
    } catch (err) {
      new Notice(`❌ Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  async promptModal(message) {
    return new Promise((res) => {
      const val = prompt(message);
      res(val ? val.trim() : null);
    });
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

    if (currentFormat === 'POINT_10_DECIMAL') {
      console.log('Score format already set to POINT_10_DECIMAL');
      return;
    }

    // Update score format
    const mutation = `
      mutation {
        UpdateUser(scoreFormat: POINT_10_DECIMAL) {
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
    
    if (updatedFormat === 'POINT_10_DECIMAL') {
      new Notice('✅ Score format updated to 0.0-10.0 scale', 3000);
      console.log('🎉 Score format successfully changed to POINT_10_DECIMAL');
    } else {
      throw new Error(`Score format not updated properly. Got: ${updatedFormat}`);
    }
    
  } catch (err) {
    console.error('Failed to update score format:', err);
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

    const callbackUrl = await this.promptModal('Paste the FULL callback URL from the browser:');
    if (!callbackUrl) return;

    const code = this.extractAuthCode(callbackUrl);
    if (!code) {
      new Notice('❌ Could not extract authorization code from URL', 5000);
      return;
    }

    await this.exchangeCodeForToken(code);
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

    new Notice('Exchanging authorization code for tokens…');

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

  async promptModal(message) {
    return new Promise((res) => {
      const val = prompt(message);
      res(val ? val.trim() : null);
    });
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

class ClientIdModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    
    contentEl.createEl('h2', { text: '🔑 Enter Client ID' });
    
    const desc = contentEl.createEl('p');
    desc.setText('Enter your Zoro application Client ID');
    desc.addClass('auth-modal-desc');
    
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    
    const input = inputContainer.createEl('input', {
      type: 'text',
      placeholder: 'Client ID',
      cls: 'auth-input'
    });
    
    const buttonContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    
    const submitButton = buttonContainer.createEl('button', {
      text: 'Save',
      cls: 'mod-cta auth-button'
    });
    
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'auth-button'
    });
    
    const closeModal = () => {
      this.close();
    };
    
    submitButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        closeModal();
      }
    });
    
    cancelButton.addEventListener('click', closeModal);
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        submitButton.click();
      }
    });
    
    setTimeout(() => input.focus(), 100);
  }
}

class ClientSecretModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    
    contentEl.createEl('h2', { text: '🔐 Enter Client Secret' });
    
    const desc = contentEl.createEl('p');
    desc.setText('Enter your Zoro application Client Secret');
    desc.addClass('auth-modal-desc');
    
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    
    const input = inputContainer.createEl('input', {
      type: 'password',
      placeholder: 'Client Secret',
      cls: 'auth-input'
    });
    
    const buttonContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    
    const submitButton = buttonContainer.createEl('button', {
      text: 'Save',
      cls: 'mod-cta auth-button'
    });
    
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'auth-button'
    });
    
    const closeModal = () => {
      this.close();
    };
    
    submitButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        closeModal();
      }
    });
    
    cancelButton.addEventListener('click', closeModal);
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        submitButton.click();
      }
    });
    
    setTimeout(() => input.focus(), 100);
  }
}

class AuthPinModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal pin-modal');
    
    contentEl.createEl('h2', { text: '🔓 Complete Authentication' });
    
    const desc = contentEl.createEl('p');
    desc.setText('Copy the authorization code from the browser and paste it below');
    desc.addClass('auth-modal-desc');
    
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    
    const input = inputContainer.createEl('input', {
      type: 'text',
      placeholder: 'Paste authorization code here',
      cls: 'auth-input pin-input'
    });
    
    const buttonContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    
    const submitButton = buttonContainer.createEl('button', {
      text: '✅ Complete Authentication',
      cls: 'mod-cta auth-button submit-button'
    });
    
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'auth-button'
    });
    
    const closeModal = () => {
      this.close();
    };
    
    submitButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        closeModal();
      }
    });
    
    cancelButton.addEventListener('click', closeModal);
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        submitButton.click();
      }
    });
    
    input.addEventListener('input', (e) => {
      const value = e.target.value.trim();
      if (value) {
        submitButton.classList.add('ready');
      } else {
        submitButton.classList.remove('ready');
      }
    });
    
    setTimeout(() => input.focus(), 100);
  }
}

class Theme {
static THEME_REPO_URL = 'https://api.github.com/repos/zara-kasi/zoro/contents/Theme?ref=v1.0.1(test)';

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
  const rawUrl = `https://raw.githubusercontent.com/zara-kasi/zoro/v1.0.1(test)/Theme/${encodeURIComponent(name)}.css`;
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
        favorite: { class: 'zoro-fav-btn', hearts: { empty: 'Add', filled: 'Loved' } },
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
      favBtn.textContent = entry.media.isFavourite ? '❤️' : '🤍';
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
      favBtn.textContent = fav ? '❤️' : '🤍';
      favBtn.dataset.mediaType = mediaData?.type;
    } catch (e) {
      console.warn('Could not fetch favorite', e);
    }
  }

  async toggleFavorite(entry, favBtn) {
    favBtn.disabled = true;
    favBtn.textContent = '⏳';
    
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
      
      this.invalidateCache(entry);
      this.updateAllFavoriteButtons(entry);
      
      favBtn.textContent = isFav ? '❤️' : '🤍';
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
      .forEach(btn => btn.textContent = entry.media.isFavourite ? '❤️' : '🤍');
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
    
    authenticateBtn.textContent = '🔑 Login';
    authenticateBtn.onclick = () => {
      closeModal();
      this.plugin.app.setting.open();
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
      new Notice('📝 Please use AniList to authenticate from settings');
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-cancel-button';
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
                id type format
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
      'MediaStart', 'MediaEnd', 'AverageScore', 'Genres', 'MainStudio', 'URL'
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
          this.csvEscape(this.plugin.getAniListUrl(m.id, m.type))
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

    async createSampleNotes() {
        const vault = this.plugin.app.vault;
        const files = [
            [
                'Anime Dashboard.md',
                'https://raw.githubusercontent.com/zara-kasi/zoro/f761efb598f50adf27cd0e5f966b502c24e162cf/Template/Anime%20Dashboard.md'
            ],
            [
                'Manga Dashboard.md',
                'https://raw.githubusercontent.com/zara-kasi/zoro/f761efb598f50adf27cd0e5f966b502c24e162cf/Template/Manga%20Dashboard.md'
            ]
        ];

        let createdCount = 0;

        for (const [fileName, fileUrl] of files) {
            // Check if file already exists
            if (vault.getAbstractFileByPath(fileName)) {
                new Notice('⏭️ ' + fileName + ' already exists');
                continue;
            }

            try {
                // Fetch file content from remote URL
                const response = await fetch(fileUrl);
                
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const content = await response.text();
                
                // Create the file in vault
                await vault.create(fileName, content);
                new Notice('✅ ' + fileName);
                createdCount++;
                
            } catch (error) {
                new Notice('❌ ' + fileName + ': ' + error.message);
            }
        }

        // Open the first file if any files were created
        if (createdCount > 0) {
            this.plugin.app.workspace.openLinkText(files[0][0], '', false);
        }
    }

    async createSampleFolders() {
        const vault = this.plugin.app.vault;
        const folders = [
            {
                name: 'Anime Dashboard',
                files: ['Watching.md', 'Planning.md', 'Repeating.md', 'On Hold.md', 'Completed.md', 'Dropped.md', 'Stats.md'],
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

            const baseUrl = 'https://raw.githubusercontent.com/zara-kasi/zoro/be78f10b1abdef4e929b89480f4cd368b0338204/Template/' + 
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
    const Guide = section('🧭 Guide');
    const Display = section('📺 Display');
    const Theme = section('🌌 Theme');
    const Data = section('📤 Data');
    const More = section('✨  More');
    const Exp = section('🚧 Experimental');
    const About = section('ℹ️ About');

    new Setting(Account)
      .setName('🆔 Public profile')
      .setDesc("Lets you access AniList public profile and stats — that's it (No Authentication required).")
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
        .setButtonText('Export')
        .setClass('mod-cta')
        .onClick(async () => {
          try {
            await this.plugin.export.exportUnifiedListsToCSV();
          } catch (err) {
            new Notice(`❌ Export failed: ${err.message}`, 6000);
          }
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
  
  new Setting(Guide)
      .setName('🗝️ Need a Client ID?')
      .setDesc('Takes less than a minute—no typing, just copy and paste.')
      .addButton(button => button
        .setButtonText('Setup Guide')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md', '_blank');
        }));

    new Setting(Guide)
      .setName('⚡ Sample Folders')
      .setDesc('(Recommended)')
      .addButton(button =>
        button
          .setButtonText('Create Sample Folders')
          .onClick(async () => {
            await this.plugin.sample.createSampleFolders();
          })
      );

    const malAuthSetting = new Setting(Exp)
      .setName('🔓 MyAnimeList')
      .setDesc('Authenticate with MyAnimeList to edit and view your MAL entries');

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
      const modal = new ClientIdModal(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.clientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateAuthButton();
        }
      });
      modal.open();
    } else if (!settings.clientSecret) {
      const modal = new ClientSecretModal(this.app, async (clientSecret) => {
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
      this.malAuthButton.setButtonText('Enter MAL Client ID');
      this.malAuthButton.removeCta();
    } else if (!settings.malClientSecret) {
      this.malAuthButton.setButtonText('Enter MAL Client Secret');
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
      const modal = new ClientIdModal(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.malClientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateMALAuthButton();
        }
      });
      modal.open();
    } else if (!settings.malClientSecret) {
      const modal = new ClientSecretModal(this.app, async (clientSecret) => {
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

