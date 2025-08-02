const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

const getDefaultGridColumns = () => {
  return window.innerWidth >= 768 ? 5 : 2;
};

const DEFAULT_SETTINGS = {
  defaultApiSource: 'anilist',
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
  debugMode: false,
};

class ZoroError {
  static instance(plugin) {
    if (!ZoroError._singleton) ZoroError._singleton = new ZoroError(plugin);
    return ZoroError._singleton;
  }

  constructor(plugin) {
    this.plugin = plugin;
    this.metrics = { 
      total: 0, 
      perType: new Map(), 
      perSeverity: new Map(),
      perHour: new Map(),
      patterns: new Map(),
      recovery: { attempts: 0, success: 0 }
    };
    this.buffer = [];
    this.maxBuffer = 100;
    this.severities = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4 };
    this.rateLimiter = new Map();
    this.correlationMap = new Map();
    this.alertThresholds = { error: 10, warn: 25, fatal: 1 };
    this.recoveryStrategies = new Map();
    this.startTime = Date.now();
    
    this.initRecoveryStrategies();
    this.startBackgroundTasks();
  }

  static create(type, message, meta = {}, severity = 'error') {
    return ZoroError.instance().build(type, message, meta, severity);
  }

  static async guard(fn, recovery = null, ctx = '') {
    const instance = ZoroError.instance();
    try { 
      return await fn(); 
    } catch (err) {
      const error = instance.fromException(err, ctx);
      
      if (recovery) {
        try {
          const result = await instance.executeRecovery(recovery, error, fn);
          if (result !== null) return result;
        } catch (recoveryErr) {
          instance.build('RECOVERY_FAILED', recoveryErr.message, { original: err, ctx }, 'error');
        }
      }
      
      throw error;
    }
  }

  static notify(type, message, severity = 'warn', duration = null) {
    const instance = ZoroError.instance();
    const e = instance.build(type, message, {}, severity);
    
    if (!instance.isRateLimited(type)) {
      const finalDuration = duration || instance.getNoticeDuration(severity);
      new Notice(e.userMessage, finalDuration);
    }
    
    return e;
  }

  static async withRetry(fn, options = {}) {
    const { maxRetries = 3, backoff = 1000, condition = () => true } = options;
    const instance = ZoroError.instance();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === maxRetries || !condition(err)) {
          instance.build('RETRY_EXHAUSTED', `Failed after ${attempt} attempts`, 
            { originalError: err.message, attempts: attempt }, 'error');
          throw err;
        }
        
        instance.build('RETRY_ATTEMPT', `Attempt ${attempt} failed, retrying`, 
          { error: err.message, nextAttemptIn: backoff * attempt }, 'warn');
        
        await instance.sleep(backoff * attempt);
      }
    }
  }

  build(type, message, meta = {}, severity = 'error') {
    const now = Date.now();
    const correlationId = this.generateCorrelationId();
    
    const entry = {
      id: correlationId,
      type, 
      message, 
      meta: this.sanitizeMeta(meta), 
      severity,
      timestamp: now,
      userMessage: this.toUserMessage(message, severity, type),
      stack: this.captureStack(),
      session: this.getSessionInfo(),
      context: this.getContext(),
      fingerprint: this.generateFingerprint(type, message)
    };

    this.record(entry);
    this.correlate(entry);
    this.persist(entry);
    this.act(entry);
    this.checkAlerts(entry);
    
    return this.createErrorObject(entry);
  }

  fromException(error, context = '') {
    const type = error.type || error.name || 'UnknownError';
    const msg = error.message || String(error);
    const meta = { 
      context, 
      original: error,
      stack: error.stack,
      code: error.code,
      status: error.status
    };
    
    return this.build(type, msg, meta, this.classifyErrorSeverity(error));
  }

  record(entry) {
    this.metrics.total++;
    this.incrementMap(this.metrics.perType, entry.type);
    this.incrementMap(this.metrics.perSeverity, entry.severity);
    
    const hour = Math.floor(entry.timestamp / (1000 * 60 * 60));
    this.incrementMap(this.metrics.perHour, hour);
    
    this.updatePatterns(entry);
    this.addToBuffer(entry);
  }

  async persist(entry) {
    if (this.isProd() && entry.severity !== 'fatal') return;
    
    try {
      const logData = {
        ...entry,
        version: this.plugin.manifest.version,
        platform: this.getPlatform()
      };
      
      const logFile = `${this.plugin.manifest.dir}/errors.jsonl`;
      await this.plugin.app.vault.adapter.append(logFile, JSON.stringify(logData) + '\n');
      
      if (entry.severity === 'fatal') {
        await this.createFatalReport(entry);
      }
    } catch {}
  }

  act(entry) {
    const level = this.severities[entry.severity] || 1;
    
    if (level <= 1 || this.plugin.settings?.debugMode) {
      console.error(`[Zoro-${entry.severity.toUpperCase()}] ${entry.type}: ${entry.message}`, {
        meta: entry.meta,
        context: entry.context,
        id: entry.id
      });
    }
    
    if (entry.severity === 'fatal') {
      this.handleFatalError(entry);
    }
  }

  async executeRecovery(recovery, error, originalFn) {
    this.metrics.recovery.attempts++;
    
    try {
      let result;
      
      if (typeof recovery === 'function') {
        result = await recovery(error);
      } else if (typeof recovery === 'string' && this.recoveryStrategies.has(recovery)) {
        result = await this.recoveryStrategies.get(recovery)(error, originalFn);
      } else {
        result = recovery;
      }
      
      this.metrics.recovery.success++;
      this.build('RECOVERY_SUCCESS', 'Automatic recovery succeeded', 
        { strategy: typeof recovery, originalError: error.type }, 'info');
      
      return result;
    } catch (err) {
      throw err;
    }
  }

  correlate(entry) {
    const key = entry.fingerprint;
    
    if (!this.correlationMap.has(key)) {
      this.correlationMap.set(key, []);
    }
    
    const correlations = this.correlationMap.get(key);
    correlations.push(entry.id);
    
    if (correlations.length > 10) {
      correlations.shift();
    }
    
    if (correlations.length > 3) {
      const frequency = correlations.length;
      const timeSpan = entry.timestamp - (this.buffer.find(e => e.id === correlations[0])?.timestamp || 0);
      
      if (timeSpan < 5 * 60 * 1000) {
        this.build('ERROR_PATTERN', `Recurring error detected: ${entry.type}`, 
          { frequency, timeSpanMs: timeSpan, pattern: key }, 'warn');
      }
    }
  }

  checkAlerts(entry) {
    const threshold = this.alertThresholds[entry.severity];
    if (!threshold) return;
    
    const recentCount = this.buffer.filter(e => 
      e.severity === entry.severity && 
      (entry.timestamp - e.timestamp) < 5 * 60 * 1000
    ).length;
    
    if (recentCount >= threshold) {
      this.build('ALERT_THRESHOLD', `${recentCount} ${entry.severity} errors in 5 minutes`, 
        { severity: entry.severity, count: recentCount, threshold }, 'fatal');
    }
  }

  initRecoveryStrategies() {
    this.recoveryStrategies.set('cache_fallback', async (error, originalFn) => {
      if (error.type?.includes('NETWORK') || error.type?.includes('TIMEOUT')) {
        return this.plugin.cache?.get(`fallback_${error.fingerprint}`) || null;
      }
      return null;
    });
    
    this.recoveryStrategies.set('retry_once', async (error, originalFn) => {
      await this.sleep(1000);
      return await originalFn();
    });
    
    this.recoveryStrategies.set('degrade_gracefully', async (error) => {
      return { error: true, message: 'Service temporarily unavailable', degraded: true };
    });
  }

  startBackgroundTasks() {
    setInterval(() => this.cleanupOldData(), 10 * 60 * 1000);
    setInterval(() => this.analyzePatterns(), 30 * 60 * 1000);
  }

  cleanupOldData() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    this.buffer = this.buffer.filter(e => e.timestamp > cutoff);
    
    for (const [key, times] of this.metrics.perHour.entries()) {
      if (key * 60 * 60 * 1000 < cutoff) {
        this.metrics.perHour.delete(key);
      }
    }
    
    for (const [key, correlations] of this.correlationMap.entries()) {
      const validCorrelations = correlations.filter(id => 
        this.buffer.some(e => e.id === id)
      );
      
      if (validCorrelations.length === 0) {
        this.correlationMap.delete(key);
      } else {
        this.correlationMap.set(key, validCorrelations);
      }
    }
  }

  analyzePatterns() {
    const patterns = new Map();
    const now = Date.now();
    const window = 60 * 60 * 1000;
    
    const recentErrors = this.buffer.filter(e => now - e.timestamp < window);
    
    for (const error of recentErrors) {
      const pattern = `${error.type}_${error.context?.component || 'unknown'}`;
      this.incrementMap(patterns, pattern);
    }
    
    for (const [pattern, count] of patterns.entries()) {
      if (count >= 5) {
        this.build('PATTERN_DETECTED', `Error pattern analysis: ${pattern}`, 
          { pattern, count, window: '1h' }, 'info');
      }
    }
  }

  async createFatalReport(entry) {
    const report = {
      timestamp: new Date(entry.timestamp).toISOString(),
      error: entry,
      system: {
        plugin: this.plugin.manifest,
        platform: this.getPlatform(),
        settings: this.sanitizeSettings(),
        uptime: Date.now() - this.startTime
      },
      context: {
        recentErrors: this.buffer.slice(0, 10),
        metrics: this.getMetrics(),
        activeRequests: this.plugin.requestQueue?.getMetrics?.() || null
      }
    };
    
    try {
      const reportFile = `${this.plugin.manifest.dir}/fatal-${Date.now()}.json`;
      await this.plugin.app.vault.adapter.write(reportFile, JSON.stringify(report, null, 2));
    } catch {}
  }

  handleFatalError(entry) {
    setTimeout(() => {
      new Notice('🧨 Fatal error occurred. Check console and restart Obsidian.', 10000);
    }, 100);
  }

  generateCorrelationId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  }

  generateFingerprint(type, message) {
    const normalizedMessage = message.replace(/\d+/g, 'N').replace(/['"]/g, '');
    return btoa(`${type}:${normalizedMessage}`).substr(0, 16);
  }

  captureStack() {
    return new Error().stack?.split('\n').slice(3, 8).join('\n') || 'No stack available';
  }

  getSessionInfo() {
    return {
      startTime: this.startTime,
      uptime: Date.now() - this.startTime,
      errors: this.metrics.total
    };
  }

  getContext() {
    return {
      component: this.getCurrentComponent(),
      activeView: this.plugin.app?.workspace?.activeLeaf?.view?.getViewType?.() || null,
      plugin: {
        version: this.plugin.manifest.version,
        enabled: true
      }
    };
  }

  getCurrentComponent() {
    const stack = new Error().stack;
    if (stack?.includes('Api.')) return 'api';
    if (stack?.includes('Cache.')) return 'cache';
    if (stack?.includes('Render.')) return 'render';
    if (stack?.includes('RequestQueue.')) return 'queue';
    return 'unknown';
  }

  classifyErrorSeverity(error) {
    if (error.message?.includes('fatal') || error.name === 'FatalError') return 'fatal';
    if (error.status >= 500) return 'error';
    if (error.status >= 400) return 'warn';
    if (error.name === 'TimeoutError') return 'warn';
    return 'error';
  }

  sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object') return meta;
    
    const sanitized = { ...meta };
    const sensitiveKeys = ['accessToken', 'clientSecret', 'password', 'key', 'secret'];
    
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  sanitizeSettings() {
    const settings = { ...this.plugin.settings };
    const sensitive = ['accessToken', 'clientSecret', 'malAccessToken', 'malClientSecret'];
    
    for (const key of sensitive) {
      if (settings[key]) {
        settings[key] = settings[key] ? '[SET]' : '[UNSET]';
      }
    }
    
    return settings;
  }

  toUserMessage(message, severity, type) {
    const templates = {
      NETWORK_ERROR: '🌐 Connection issue. Please check your internet.',
      TIMEOUT: '⏱️ Request timed out. Please try again.',
      AUTH_ERROR: '🔑 Authentication failed. Please re-login.',
      RATE_LIMITED: '🚦 Too many requests. Please wait a moment.',
      CACHE_ERROR: '💾 Cache issue detected.',
      UNKNOWN_ERROR: '❓ An unexpected error occurred.'
    };
    
    const template = templates[type];
    if (template) return template;
    
    const prefixes = {
      fatal: '🧨',
      error: '❌',
      warn: '⚠️',
      info: 'ℹ️',
      debug: '🔍'
    };
    
    return `${prefixes[severity] || '❌'} ${message}`;
  }

  createErrorObject(entry) {
    const error = new Error(entry.message);
    error.type = entry.type;
    error.severity = entry.severity;
    error.id = entry.id;
    error.timestamp = entry.timestamp;
    error.userMessage = entry.userMessage;
    error.fingerprint = entry.fingerprint;
    error.meta = entry.meta;
    return error;
  }

  isRateLimited(type) {
    const now = Date.now();
    const key = `notice_${type}`;
    const lastNotice = this.rateLimiter.get(key) || 0;
    
    if (now - lastNotice < 5000) {
      return true;
    }
    
    this.rateLimiter.set(key, now);
    return false;
  }

  getNoticeDuration(severity) {
    const durations = { fatal: 15000, error: 8000, warn: 5000, info: 3000, debug: 2000 };
    return durations[severity] || 5000;
  }

  incrementMap(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  addToBuffer(entry) {
    this.buffer.unshift(entry);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.pop();
    }
  }

  updatePatterns(entry) {
    const pattern = `${entry.type}_${entry.severity}`;
    this.incrementMap(this.metrics.patterns, pattern);
  }

  getPlatform() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      obsidian: this.plugin.app?.appId || 'unknown'
    };
  }

  isProd() {
    return !this.plugin.settings?.debugMode;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getMetrics() {
    const now = Date.now();
    const uptime = now - this.startTime;
    const recentErrors = this.buffer.filter(e => now - e.timestamp < 60 * 60 * 1000).length;
    
    return {
      total: this.metrics.total,
      uptime: this.formatDuration(uptime),
      recentHour: recentErrors,
      byType: Object.fromEntries(this.metrics.perType),
      bySeverity: Object.fromEntries(this.metrics.perSeverity),
      patterns: Object.fromEntries(this.metrics.patterns),
      recovery: this.metrics.recovery,
      errorRate: uptime > 0 ? (this.metrics.total / (uptime / 1000 / 60)).toFixed(2) + '/min' : '0/min'
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

  dump() {
    return {
      recent: this.buffer.slice(0, 20),
      metrics: this.getMetrics(),
      correlations: Object.fromEntries(this.correlationMap),
      health: this.getHealthStatus()
    };
  }

  getHealthStatus() {
    const now = Date.now();
    const recentErrors = this.buffer.filter(e => now - e.timestamp < 5 * 60 * 1000);
    const fatalCount = recentErrors.filter(e => e.severity === 'fatal').length;
    const errorCount = recentErrors.filter(e => e.severity === 'error').length;
    
    let status = 'healthy';
    if (fatalCount > 0 || errorCount > 10) status = 'critical';
    else if (errorCount > 5 || recentErrors.length > 15) status = 'degraded';
    
    return {
      status,
      recentErrors: recentErrors.length,
      fatalErrors: fatalCount,
      recoveryRate: this.metrics.recovery.attempts > 0 ? 
        (this.metrics.recovery.success / this.metrics.recovery.attempts * 100).toFixed(1) + '%' : 'N/A'
    };
  }

  async destroy() {
    if (this.metrics.total > 0) {
      await this.persist(this.build('SHUTDOWN', 'Error system shutting down', 
        { totalErrors: this.metrics.total, uptime: Date.now() - this.startTime }, 'info'));
    }
    
    this.buffer = [];
    this.metrics = { total: 0, perType: new Map(), perSeverity: new Map() };
    this.correlationMap.clear();
    this.rateLimiter.clear();
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
      'anilist:userData': 30 * 60 * 1000,
      'anilist:mediaData': 10 * 60 * 1000, 
      'anilist:searchResults': 2 * 60 * 1000,
      'mal:userData': 60 * 60 * 1000,
      'mal:mediaData': 30 * 60 * 1000,
      'mal:searchResults': 5 * 60 * 1000,
      userData: 30 * 60 * 1000, 
      mediaData: 10 * 60 * 1000, 
      searchResults: 2 * 60 * 1000, 
      mediaDetails: 60 * 60 * 1000, 
      malData: 60 * 60 * 1000, 
      ...ttlMap 
    };
    
    this.stores = {};
    this.indexes = { byUser: new Map(), byMedia: new Map(), byTag: new Map() };
    this.apiSources = ['anilist', 'mal'];
    
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
}

class RequestQueue {
  constructor(plugin) {
    this.plugin = plugin;
    
    // Multiple priority queues
    this.queues = {
      high: [],      // Auth, critical user actions
      normal: [],    // Regular API calls
      low: [],       // Background refresh, preloading
      batch: []      // Batch operations
    };
    
    // Enterprise configuration with MAL-aware settings
    this.config = {
      baseDelay: 700,
      maxDelay: 5000,
      minDelay: 100,
      adaptiveDelayEnabled: true,
      maxConcurrent: 3,
      maxRetries: 3,
      timeoutMs: 30000,
      rateLimitBuffer: 0.8, // Use 80% of rate limit
      batchSize: 5,
      batchDelay: 100,
      // MAL-specific configuration
      malConfig: {
        baseDelay: 1000,      // MAL is more conservative
        maxConcurrent: 2,     // Lower concurrency for MAL
        rateLimitBuffer: 0.7, // More conservative rate limiting
        authRetryDelay: 2000, // Delay for auth retries
        maxAuthRetries: 2     // Limited auth retries
      }
    };
    
    // State management
    this.state = {
      isProcessing: false,
      activeRequests: new Map(),
      completedRequests: 0,
      failedRequests: 0,
      totalProcessingTime: 0,
      lastRequestTime: 0,
      currentDelay: this.config.baseDelay,
      concurrentCount: 0,
      // MAL-specific state
      malState: {
        lastAuthCheck: 0,
        authCheckInterval: 300000, // 5 minutes
        consecutiveAuthFailures: 0,
        lastMalRequest: 0
      }
    };
    
    // Enhanced rate limiting with service-specific limits
    this.rateLimiter = {
      // AniList limits
      anilist: {
        requests: [],
        windowMs: 60000, // 1 minute window
        maxRequests: 90, // AniList limit
        resetTime: null,
        remaining: 90
      },
      // MAL limits (more conservative)
      mal: {
        requests: [],
        windowMs: 60000, // 1 minute window  
        maxRequests: 60, // Conservative MAL limit
        resetTime: null,
        remaining: 60
      }
    };
    
    // Adaptive delay system with service awareness
    this.adaptiveDelay = {
      successStreak: 0,
      errorStreak: 0,
      lastAdjustment: Date.now(),
      samples: [],
      avgResponseTime: 0,
      // Service-specific adaptive delays
      serviceDelays: {
        anilist: this.config.baseDelay,
        mal: this.config.malConfig.baseDelay
      }
    };
    
    // Enhanced metrics with service breakdown
    this.metrics = {
      requestsQueued: 0,
      requestsProcessed: 0,
      requestsFailed: 0,
      averageWaitTime: 0,
      averageProcessingTime: 0,
      queuePeakSize: 0,
      rateLimitHits: 0,
      timeouts: 0,
      retries: 0,
      batchedRequests: 0,
      startTime: Date.now(),
      // Service-specific metrics
      serviceMetrics: {
        anilist: { requests: 0, errors: 0, avgTime: 0 },
        mal: { requests: 0, errors: 0, avgTime: 0, authErrors: 0 }
      }
    };
    
    // Request tracking
    this.requestTracker = new Map();
    this.batchTimer = null;
    this.healthCheckInterval = null;
    
    // UI state
    this.loaderState = {
      visible: false,
      requestCount: 0,
      lastUpdate: 0
    };
    
    // Start background processes
    this.startBackgroundTasks();
  }

  // =================== ENHANCED CORE OPERATIONS ===================
  
  add(requestFn, options = {}) {
    const {
      priority = 'normal',
      timeout = this.config.timeoutMs,
      retries = this.config.maxRetries,
      batchable = false,
      metadata = {},
      service = 'anilist' // New: service identification
    } = options;
    
    const requestId = this.generateRequestId();
    const queueTime = Date.now();
    
    // MAL-specific adjustments
    const adjustedOptions = this.adjustOptionsForService(service, {
      timeout, retries, priority
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
        batchable,
        metadata: { ...metadata, service }, // Ensure service is tracked
        queueTime,
        startTime: null,
        attempt: 0,
        maxAttempts: adjustedOptions.retries + 1,
        service // Explicit service tracking
      };
      
      // Add to appropriate queue
      if (batchable && this.config.batchSize > 1) {
        this.queues.batch.push(requestItem);
        this.scheduleBatchProcessing();
      } else {
        this.queues[priority].push(requestItem);
      }
      
      this.metrics.requestsQueued++;
      this.updateQueueMetrics();
      
      // Start processing
      this.process();
      
      // Track request for monitoring
      this.requestTracker.set(requestId, {
        queueTime,
        priority,
        service,
        metadata: this.sanitizeMetadata(metadata)
      });
    });
  }
  
  // New: Service-specific option adjustments
  adjustOptionsForService(service, options) {
    if (service === 'mal') {
      return {
        timeout: Math.max(options.timeout, 30000), // MAL needs more time
        retries: Math.min(options.retries, this.config.malConfig.maxAuthRetries),
        priority: options.priority
      };
    }
    return options;
  }
  
  async process() {
    if (this.state.isProcessing || this.getTotalQueueSize() === 0) {
      if (this.getTotalQueueSize() === 0) {
        this.hideGlobalLoader();
      }
      return;
    }
    
    // Service-aware concurrency check
    const requestItem = this.peekNextRequest();
    if (requestItem && !this.canProcessRequest(requestItem)) {
      return;
    }
    
    this.state.isProcessing = true;
    
    try {
      // Get next request by priority
      const actualRequestItem = this.getNextRequest();
      if (!actualRequestItem) {
        this.state.isProcessing = false;
        return;
      }
      
      // Show loader if needed
      this.updateLoaderState();
      
      // Enhanced rate limiting check with service awareness
      const rateLimitCheck = this.checkServiceRateLimit(actualRequestItem.service);
      if (!rateLimitCheck.allowed) {
        // Re-queue the request and wait
        this.queues[actualRequestItem.priority].unshift(actualRequestItem);
        this.state.isProcessing = false;
        
        this.log('RATE_LIMITED', actualRequestItem.id, 
          `${actualRequestItem.service} rate limited - waiting ${rateLimitCheck.waitTime}ms`);
        setTimeout(() => this.process(), rateLimitCheck.waitTime);
        return;
      }
      
      // MAL-specific pre-request validation
      if (actualRequestItem.service === 'mal') {
        const authCheck = await this.validateMalAuth(actualRequestItem);
        if (!authCheck.valid) {
          this.handleMalAuthFailure(actualRequestItem, authCheck.error);
          return;
        }
      }
      
      // Process the request
      await this.executeRequest(actualRequestItem);
      
    } finally {
      this.state.isProcessing = false;
      
      // Continue processing if there are more requests
      if (this.getTotalQueueSize() > 0) {
        const delay = this.calculateServiceAwareDelay(requestItem?.service);
        setTimeout(() => this.process(), delay);
      }
    }
  }
  
  // New: Service-aware concurrency management
  canProcessRequest(requestItem) {
    const service = requestItem.service || 'anilist';
    const currentServiceRequests = Array.from(this.state.activeRequests.values())
      .filter(req => req.service === service).length;
    
    const maxConcurrent = service === 'mal' 
      ? this.config.malConfig.maxConcurrent 
      : this.config.maxConcurrent;
    
    return this.state.concurrentCount < this.config.maxConcurrent && 
           currentServiceRequests < maxConcurrent;
  }
  
  // New: Peek at next request without removing it
  peekNextRequest() {
    const priorities = ['high', 'normal', 'low'];
    for (const priority of priorities) {
      if (this.queues[priority].length > 0) {
        return this.queues[priority][0];
      }
    }
    return null;
  }
  
  async executeRequest(requestItem) {
    const { requestFn, resolve, reject, id, timeout, service } = requestItem;
    
    this.state.concurrentCount++;
    this.state.activeRequests.set(id, requestItem);
    requestItem.startTime = Date.now();
    requestItem.attempt++;
    
    const waitTime = requestItem.startTime - requestItem.queueTime;
    
    // Update service-specific state
    if (service === 'mal') {
      this.state.malState.lastMalRequest = Date.now();
    }
    
    try {
      this.log('REQUEST_START', id, {
        service,
        attempt: requestItem.attempt,
        waitTime: `${waitTime}ms`,
        queueSize: this.getTotalQueueSize()
      });
      
      // Execute with timeout
      const timeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('Request timeout')), timeout);
      });
      
      const result = await Promise.race([requestFn(), timeoutPromise]);
      
      // Success handling with service awareness
      const processingTime = Date.now() - requestItem.startTime;
      this.handleRequestSuccess(requestItem, result, processingTime, waitTime);
      resolve(result);
      
    } catch (error) {
      const processingTime = Date.now() - requestItem.startTime;
      const shouldRetry = await this.handleRequestError(requestItem, error, processingTime, waitTime);
      
      if (shouldRetry) {
        // Service-specific retry delay
        const retryDelay = this.calculateServiceRetryDelay(requestItem.attempt, service);
        await this.sleep(retryDelay);
        
        // Re-queue for retry
        this.queues[requestItem.priority].unshift(requestItem);
        this.metrics.retries++;
      } else {
        reject(error);
      }
    } finally {
      this.state.concurrentCount--;
      this.state.activeRequests.delete(id);
      this.requestTracker.delete(id);
    }
  }

  // =================== MAL-SPECIFIC ENHANCEMENTS ===================
  
  // New: MAL authentication validation
  async validateMalAuth(requestItem) {
    const now = Date.now();
    
    // Skip frequent auth checks
    if (now - this.state.malState.lastAuthCheck < this.state.malState.authCheckInterval) {
      return { valid: true };
    }
    
    try {
      // Check if we need token refresh
      if (this.plugin.malAuth && typeof this.plugin.malAuth.ensureValidToken === 'function') {
        await this.plugin.malAuth.ensureValidToken();
        this.state.malState.lastAuthCheck = now;
        this.state.malState.consecutiveAuthFailures = 0;
        return { valid: true };
      }
      
      // Fallback check
      if (!this.plugin.settings?.malAccessToken) {
        return { 
          valid: false, 
          error: 'No MAL access token available' 
        };
      }
      
      return { valid: true };
      
    } catch (error) {
      this.state.malState.consecutiveAuthFailures++;
      this.metrics.serviceMetrics.mal.authErrors++;
      
      return { 
        valid: false, 
        error: error.message || 'MAL authentication failed' 
      };
    }
  }
  
  // New: Handle MAL authentication failures
  handleMalAuthFailure(requestItem, errorMessage) {
    this.log('MAL_AUTH_FAILURE', requestItem.id, errorMessage);
    
    // If too many consecutive auth failures, reject immediately
    if (this.state.malState.consecutiveAuthFailures >= this.config.malConfig.maxAuthRetries) {
      requestItem.reject(new Error(`MAL authentication persistently failing: ${errorMessage}`));
      this.state.isProcessing = false;
      return;
    }
    
    // Re-queue with auth retry delay
    setTimeout(() => {
      this.queues[requestItem.priority].unshift(requestItem);
      this.state.isProcessing = false;
      this.process();
    }, this.config.malConfig.authRetryDelay);
  }

  // =================== ENHANCED RATE LIMITING ===================
  
  // New: Service-aware rate limiting
  checkServiceRateLimit(service = 'anilist') {
    const limiter = this.rateLimiter[service] || this.rateLimiter.anilist;
    const now = Date.now();
    
    // Clean old requests
    limiter.requests = limiter.requests.filter(
      time => now - time < limiter.windowMs
    );
    
    // Get service-specific buffer
    const buffer = service === 'mal' 
      ? this.config.malConfig.rateLimitBuffer 
      : this.config.rateLimitBuffer;
    
    // Check if we can make a request
    const maxAllowed = Math.floor(limiter.maxRequests * buffer);
    
    if (limiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...limiter.requests);
      const waitTime = limiter.windowMs - (now - oldestRequest);
      
      this.metrics.rateLimitHits++;
      return { 
        allowed: false, 
        waitTime: Math.max(waitTime, service === 'mal' ? 2000 : 1000),
        service 
      };
    }
    
    // Record the request
    limiter.requests.push(now);
    return { allowed: true, waitTime: 0, service };
  }
  
  // Enhanced rate limit info update with service awareness
  updateRateLimitInfo(headers, service = 'anilist') {
    const limiter = this.rateLimiter[service];
    if (!limiter) return;
    
    if (headers && headers['x-ratelimit-remaining']) {
      limiter.remaining = parseInt(headers['x-ratelimit-remaining']);
    }
    if (headers && headers['x-ratelimit-reset']) {
      limiter.resetTime = new Date(headers['x-ratelimit-reset']);
    }
  }

  // =================== ENHANCED ADAPTIVE DELAY ===================
  
  // New: Service-aware delay calculation
  calculateServiceAwareDelay(service = 'anilist') {
    if (!this.config.adaptiveDelayEnabled) {
      return service === 'mal' 
        ? this.config.malConfig.baseDelay 
        : this.config.baseDelay;
    }
    
    const serviceDelay = this.adaptiveDelay.serviceDelays[service] || this.config.baseDelay;
    let delay = serviceDelay;
    
    // Service-specific adjustments
    if (service === 'mal') {
      // MAL is more sensitive to rapid requests
      const timeSinceLastMal = Date.now() - this.state.malState.lastMalRequest;
      if (timeSinceLastMal < 1000) {
        delay = Math.max(delay, 1500);
      }
      
      // Account for auth failures
      if (this.state.malState.consecutiveAuthFailures > 0) {
        delay *= (1 + this.state.malState.consecutiveAuthFailures * 0.5);
      }
    }
    
    // Apply standard adaptive logic
    const limiter = this.rateLimiter[service] || this.rateLimiter.anilist;
    const rateLimitUtilization = limiter.requests.length / limiter.maxRequests;
    
    if (rateLimitUtilization > 0.8) {
      delay = Math.min(delay * 1.5, this.config.maxDelay);
    } else if (rateLimitUtilization < 0.3) {
      delay = Math.max(delay * 0.8, this.config.minDelay);
    }
    
    // Update service delay
    this.adaptiveDelay.serviceDelays[service] = delay;
    
    return Math.floor(delay);
  }
  
  // New: Service-specific retry delay
  calculateServiceRetryDelay(attempt, service = 'anilist') {
    const baseDelay = service === 'mal' ? 2000 : 1000;
    const maxDelay = service === 'mal' ? 15000 : 10000;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  // =================== ENHANCED ERROR HANDLING ===================
  
  handleRequestSuccess(requestItem, result, processingTime, waitTime) {
    const { service = 'anilist' } = requestItem;
    
    this.state.completedRequests++;
    this.state.totalProcessingTime += processingTime;
    this.updateAdaptiveDelay(true, processingTime, service);
    
    // Update service-specific metrics
    const serviceMetric = this.metrics.serviceMetrics[service];
    if (serviceMetric) {
      serviceMetric.requests++;
      serviceMetric.avgTime = (serviceMetric.avgTime + processingTime) / 2;
    }
    
    this.metrics.requestsProcessed++;
    this.updateMetrics(waitTime, processingTime);
    
    this.log('REQUEST_SUCCESS', requestItem.id, {
      service,
      attempt: requestItem.attempt,
      processingTime: `${processingTime}ms`,
      waitTime: `${waitTime}ms`
    });
  }
  
  async handleRequestError(requestItem, error, processingTime, waitTime) {
    const { service = 'anilist' } = requestItem;
    
    this.state.failedRequests++;
    this.updateAdaptiveDelay(false, processingTime, service);
    
    // Update service-specific error metrics
    const serviceMetric = this.metrics.serviceMetrics[service];
    if (serviceMetric) {
      serviceMetric.errors++;
    }
    
    // Service-specific error handling
    const shouldRetry = this.shouldRetryRequest(requestItem, error);
    
    if (shouldRetry) {
      this.log('REQUEST_RETRY', requestItem.id, {
        service,
        attempt: requestItem.attempt,
        maxAttempts: requestItem.maxAttempts,
        error: error.message,
        nextRetryIn: `${this.calculateServiceRetryDelay(requestItem.attempt, service)}ms`
      });
      
      return true;
    } else {
      this.metrics.requestsFailed++;
      this.log('REQUEST_FAILED', requestItem.id, {
        service,
        attempt: requestItem.attempt,
        error: error.message,
        processingTime: `${processingTime}ms`,
        waitTime: `${waitTime}ms`
      });
      return false;
    }
  }
  
  shouldRetryRequest(requestItem, error) {
    const { service = 'anilist' } = requestItem;
    
    if (requestItem.attempt >= requestItem.maxAttempts) {
      return false;
    }
    
    // MAL-specific retry logic
    if (service === 'mal') {
      // Don't retry MAL auth errors beyond limit
      if (error.message.includes('auth') || error.message.includes('401')) {
        return requestItem.attempt < this.config.malConfig.maxAuthRetries;
      }
      
      // MAL is stricter about retries
      if (error.status >= 400 && error.status < 500) {
        return false;
      }
    }
    
    // Standard retry logic
    if (error.message.includes('timeout')) {
      this.metrics.timeouts++;
      return true;
    }
    
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
    
    return true;
  }
  
  // Enhanced adaptive delay update with service awareness
  updateAdaptiveDelay(success, responseTime, service = 'anilist') {
    if (success) {
      this.adaptiveDelay.successStreak++;
      this.adaptiveDelay.errorStreak = 0;
    } else {
      this.adaptiveDelay.errorStreak++;
      this.adaptiveDelay.successStreak = 0;
    }
    
    // Update response time average
    this.adaptiveDelay.samples.push({ time: responseTime, service });
    if (this.adaptiveDelay.samples.length > 100) {
      this.adaptiveDelay.samples = this.adaptiveDelay.samples.slice(-50);
    }
    
    // Calculate service-specific average response times
    const serviceSamples = this.adaptiveDelay.samples.filter(s => s.service === service);
    if (serviceSamples.length > 0) {
      const serviceAvg = serviceSamples.reduce((a, b) => a + b.time, 0) / serviceSamples.length;
      
      // Adjust service delay based on performance
      if (serviceAvg > 3000 && service === 'mal') {
        this.adaptiveDelay.serviceDelays[service] = Math.min(
          this.adaptiveDelay.serviceDelays[service] * 1.2,
          this.config.maxDelay
        );
      }
    }
    
    this.adaptiveDelay.avgResponseTime = 
      this.adaptiveDelay.samples.reduce((a, b) => a + b.time, 0) / this.adaptiveDelay.samples.length;
  }

  // =================== ENHANCED METRICS ===================
  
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
        successRate: `${(successRate * 100).toFixed(2)}%`,
        averageWaitTime: `${this.metrics.averageWaitTime.toFixed(0)}ms`,
        averageProcessingTime: `${this.metrics.averageProcessingTime.toFixed(0)}ms`,
        currentDelay: `${this.state.currentDelay}ms`
      },
      rateLimit: {
        anilist: {
          requests: this.rateLimiter.anilist.requests.length,
          maxRequests: this.rateLimiter.anilist.maxRequests,
          remaining: this.rateLimiter.anilist.remaining,
          utilization: `${((this.rateLimiter.anilist.requests.length / this.rateLimiter.anilist.maxRequests) * 100).toFixed(1)}%`
        },
        mal: {
          requests: this.rateLimiter.mal.requests.length,
          maxRequests: this.rateLimiter.mal.maxRequests,
          remaining: this.rateLimiter.mal.remaining,
          utilization: `${((this.rateLimiter.mal.requests.length / this.rateLimiter.mal.maxRequests) * 100).toFixed(1)}%`
        },
        hits: this.metrics.rateLimitHits
      },
      concurrency: {
        active: this.state.concurrentCount,
        max: this.config.maxConcurrent
      },
      adaptive: {
        successStreak: this.adaptiveDelay.successStreak,
        errorStreak: this.adaptiveDelay.errorStreak,
        avgResponseTime: `${this.adaptiveDelay.avgResponseTime.toFixed(0)}ms`,
        serviceDelays: {
          anilist: `${this.adaptiveDelay.serviceDelays.anilist.toFixed(0)}ms`,
          mal: `${this.adaptiveDelay.serviceDelays.mal.toFixed(0)}ms`
        }
      },
      services: this.metrics.serviceMetrics,
      mal: {
        lastAuthCheck: new Date(this.state.malState.lastAuthCheck).toISOString(),
        authFailures: this.state.malState.consecutiveAuthFailures,
        lastRequest: this.state.malState.lastMalRequest ? 
          new Date(this.state.malState.lastMalRequest).toISOString() : 'never'
      }
    };
  }

  // =================== UTILITY METHODS (keeping existing ones) ===================
  
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
  
  updateLoaderState() {
    const totalRequests = this.getTotalQueueSize() + this.state.concurrentCount;
    const shouldShow = totalRequests > 0;
    
    if (shouldShow && !this.loaderState.visible) {
      this.showGlobalLoader();
    } else if (!shouldShow && this.loaderState.visible) {
      this.hideGlobalLoader();
    }
    
    this.loaderState.requestCount = totalRequests;
    this.loaderState.lastUpdate = Date.now();
  }
  
  showGlobalLoader() {
    if (!this.plugin?.settings?.showLoadingIcon) return;
    
    const loader = document.getElementById('zoro-global-loader');
    if (loader) {
      loader.classList.add('zoro-show');
      this.loaderState.visible = true;
      
      const queueSize = this.getTotalQueueSize();
      if (queueSize > 1) {
        loader.setAttribute('data-count', queueSize);
      }
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
  
  updateMetrics(waitTime, processingTime) {
    this.metrics.averageWaitTime = (this.metrics.averageWaitTime + waitTime) / 2;
    this.metrics.averageProcessingTime = (this.metrics.averageProcessingTime + processingTime) / 2;
    
    const currentQueueSize = this.getTotalQueueSize();
    if (currentQueueSize > this.metrics.queuePeakSize) {
      this.metrics.queuePeakSize = currentQueueSize;
    }
  }
  
  updateQueueMetrics() {
    const totalQueued = this.getTotalQueueSize();
    this.metrics.queuePeakSize = Math.max(this.metrics.queuePeakSize, totalQueued);
  }
  
  getHealthStatus() {
    const metrics = this.getMetrics();
    const queueSize = this.getTotalQueueSize();
    const errorRate = this.metrics.requestsFailed / (this.metrics.requestsProcessed + this.metrics.requestsFailed);
    
    let status = 'healthy';
    if (queueSize > 50 || errorRate > 0.1 || this.state.malState.consecutiveAuthFailures > 1) {
      status = 'degraded';
    }
    if (queueSize > 100 || errorRate > 0.25 || this.state.malState.consecutiveAuthFailures >= this.config.malConfig.maxAuthRetries) {
      status = 'unhealthy';
    }
    
    return {
      status,
      queueSize,
      errorRate: `${(errorRate * 100).toFixed(2)}%`,
      activeRequests: this.state.concurrentCount,
      rateLimitUtilization: {
        anilist: metrics.rateLimit.anilist.utilization,
        mal: metrics.rateLimit.mal.utilization
      },
      malAuthStatus: this.state.malState.consecutiveAuthFailures === 0 ? 'healthy' : 'degraded'
    };
  }
  
  startBackgroundTasks() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);
    
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }
  
  performHealthCheck() {
    const health = this.getHealthStatus();
    
    if (health.status === 'unhealthy') {
      this.log('HEALTH_WARNING', 'system', 
        `Queue unhealthy: ${health.queueSize} items, ${health.errorRate} error rate, MAL auth: ${health.malAuthStatus}`);
      
      if (this.getTotalQueueSize() > 200) {
        this.clearLowPriorityQueue();
      }
    }
  }
  
  cleanup() {
    // Clear old adaptive delay samples
    if (this.adaptiveDelay.samples.length > 100) {
      this.adaptiveDelay.samples = this.adaptiveDelay.samples.slice(-50);
    }
    
    // Clear old rate limit tracking for both services
    const now = Date.now();
    Object.keys(this.rateLimiter).forEach(service => {
      this.rateLimiter[service].requests = this.rateLimiter[service].requests.filter(
        time => now - time < this.rateLimiter[service].windowMs * 2
      );
    });
    
    // Reset MAL auth check interval if too old
    if (now - this.state.malState.lastAuthCheck > this.state.malState.authCheckInterval * 2) {
      this.state.malState.consecutiveAuthFailures = 0;
    }
  }
  
  // =================== BATCH PROCESSING (keeping existing) ===================
  
  scheduleBatchProcessing() {
    if (this.batchTimer) return;
    
    this.batchTimer = setTimeout(() => {
      this.processBatch();
      this.batchTimer = null;
    }, this.config.batchDelay);
  }
  
  async processBatch() {
    const batchItems = this.queues.batch.splice(0, this.config.batchSize);
    if (batchItems.length === 0) return;
    
    this.log('BATCH_START', 'batch', `Processing ${batchItems.length} requests`);
    
    try {
      const batches = this.groupBatchableRequests(batchItems);
      
      for (const [batchType, requests] of batches.entries()) {
        await this.executeBatch(batchType, requests);
      }
      
      this.metrics.batchedRequests += batchItems.length;
      
    } catch (error) {
      batchItems.forEach(item => item.reject(error));
      this.log('BATCH_ERROR', 'batch', error.message);
    }
  }
  
  groupBatchableRequests(items) {
    const batches = new Map();
    
    items.forEach(item => {
      const batchType = item.metadata.batchType || 'default';
      if (!batches.has(batchType)) {
        batches.set(batchType, []);
      }
      batches.get(batchType).push(item);
    });
    
    return batches;
  }
  
  async executeBatch(batchType, requests) {
    // Execute individually with service-aware delays
    for (const request of requests) {
      await this.executeRequest(request);
      const delay = request.service === 'mal' ? this.config.malConfig.baseDelay : this.config.minDelay;
      await this.sleep(delay);
    }
  }
  
  // =================== UTILITY METHODS ===================
  
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  sanitizeMetadata(metadata) {
    const sanitized = { ...metadata };
    delete sanitized.accessToken;
    delete sanitized.clientSecret;
    delete sanitized.malAccessToken;
    return sanitized;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
  
  log(level, requestId, data = '') {
    if (!this.plugin.settings?.debugMode && level !== 'ERROR') return;
    
    const timestamp = new Date().toISOString();
    const logData = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    
    console.log(`[${timestamp}] [Zoro-Queue] [${level}] [${requestId}] ${logData}`);
  }
  
  // =================== QUEUE MANAGEMENT ===================
  
  pause() {
    this.state.isProcessing = true;
    this.log('QUEUE_PAUSED', 'system', 'Queue processing paused');
  }
  
  resume() {
    this.state.isProcessing = false;
    this.process();
    this.log('QUEUE_RESUMED', 'system', 'Queue processing resumed');
  }
  
  clear(priority = null) {
    if (priority) {
      const cleared = this.queues[priority].length;
      this.queues[priority] = [];
      this.log('QUEUE_CLEARED', 'system', `Cleared ${cleared} ${priority} priority requests`);
      return cleared;
    } else {
      let total = 0;
      Object.keys(this.queues).forEach(p => {
        total += this.queues[p].length;
        this.queues[p] = [];
      });
      this.log('QUEUE_CLEARED', 'system', `Cleared all ${total} requests`);
      return total;
    }
  }
  
  clearLowPriorityQueue() {
    const cleared = this.clear('low');
    this.log('AUTO_RECOVERY', 'system', `Cleared ${cleared} low-priority requests for recovery`);
  }
  
  // New: Clear MAL-specific requests (useful for auth issues)
  clearMalRequests() {
    let cleared = 0;
    Object.keys(this.queues).forEach(priority => {
      const malRequests = this.queues[priority].filter(req => req.service === 'mal');
      this.queues[priority] = this.queues[priority].filter(req => req.service !== 'mal');
      cleared += malRequests.length;
      
      // Reject cleared MAL requests
      malRequests.forEach(req => {
        req.reject(new Error('MAL requests cleared due to authentication issues'));
      });
    });
    
    this.log('MAL_QUEUE_CLEARED', 'system', `Cleared ${cleared} MAL requests`);
    return cleared;
  }
  
  // =================== SHUTDOWN ===================
  
  async destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    const activeRequests = Array.from(this.state.activeRequests.values());
    if (activeRequests.length > 0) {
      this.log('SHUTDOWN', 'system', `Waiting for ${activeRequests.length} active requests`);
      
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
    
    this.log('DESTROYED', 'system', 'RequestQueue destroyed');
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
      // Use cache-friendly approach
      const config = {
        type: 'single',
        mediaType: mediaType,
        mediaId: parseInt(mediaId)
      };
      
      const response = await this.fetchAniListData(config);
      return response.MediaList !== null;
      
    } catch (error) {
      // Don't throw errors for this check, just return false
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
    
    this.fieldSets = {
      compact: 'id,title,main_picture',
      card: 'id,title,main_picture,media_type,status,genres,num_episodes,num_chapters,mean,start_date,end_date',
      full: 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,my_list_status,num_episodes,num_chapters,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics'
    };

    this.statusMappings = {
      'CURRENT': 'watching', 'COMPLETED': 'completed', 'PAUSED': 'on_hold',
      'DROPPED': 'dropped', 'PLANNING': 'plan_to_watch',
      'watching': 'watching', 'reading': 'reading', 'completed': 'completed',
      'on_hold': 'on_hold', 'dropped': 'dropped', 'plan_to_watch': 'plan_to_watch',
      'plan_to_read': 'plan_to_read'
    };

    this.reverseStatusMappings = {
      'watching': 'CURRENT', 'reading': 'CURRENT', 'completed': 'COMPLETED',
      'on_hold': 'PAUSED', 'dropped': 'DROPPED', 'plan_to_watch': 'PLANNING',
      'plan_to_read': 'PLANNING'
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

    // Only require authentication for user-specific requests
    if (this.requiresAuth(normalizedConfig.type)) {
      await this.ensureValidToken();
    }
    
    const requestParams = this.buildRequestParams(normalizedConfig);
    const rawResponse = await this.makeRequest(requestParams);
    const transformedData = this.transformResponse(rawResponse, normalizedConfig);
    
    this.cache.set(cacheKey, transformedData, { scope: cacheScope });
    return transformedData;
  }

  requiresAuth(requestType) {
    // Search requests don't require authentication
    // Only user-specific data requires auth
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
        const mediaType = config.mediaType === 'ANIME' ? 'anime' : 'manga';
        return `${this.baseUrl}/users/@me/${mediaType}list`;
      case 'search':
        const searchType = config.mediaType === 'ANIME' ? 'anime' : 'manga';
        return `${this.baseUrl}/${searchType}`;
      default:
        throw ZoroError.create('INVALID_REQUEST_TYPE', `Unknown type: ${config.type}`, { config }, 'error');
    }
  }

  buildQueryParams(config) {
    const params = {};
    
    switch (config.type) {
      case 'single':
      case 'list':
        params.fields = this.getFieldsForLayout(config.layout);
        params.limit = 1000;
        if (config.listType) params.status = this.mapAniListStatusToMAL(config.listType);
        params.sort = 'list_score';
        break;
      case 'search':
        const searchTerm = config.search || config.query || '';
        params.q = searchTerm.trim();
        params.limit = config.perPage || 5;
        params.offset = ((config.page || 1) - 1) * (config.perPage || 5);
        params.fields = this.getFieldsForLayout(config.layout);
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
    return await ZoroError.guard(
      async () => await this.executeUpdate(mediaId, updates),
      'retry_once',
      'MalApi.updateMediaListEntry'
    );
  }

  async executeUpdate(mediaId, updates) {
    if (!this.isValidMediaId(mediaId)) {
      throw ZoroError.create('INVALID_MEDIA_ID', `Invalid media ID: ${mediaId}`, { mediaId }, 'error');
    }

    await this.ensureValidToken();
    const mediaType = await this.getMediaType(mediaId);
    
    const endpoint = mediaType === 'anime' ? 'anime' : 'manga';
    const body = new URLSearchParams();
    
    if (updates.status !== undefined) {
      body.append('status', this.mapAniListStatusToMAL(updates.status));
    }
    if (updates.score !== undefined && updates.score !== null) {
      body.append('score', Math.round(updates.score));
    }
    if (updates.progress !== undefined) {
      const progressField = mediaType === 'anime' ? 'num_episodes_watched' : 'num_chapters_read';
      body.append(progressField, updates.progress);
    }

    const requestFn = async () => {
      return await requestUrl({
        url: `${this.baseUrl}/${endpoint}/${mediaId}/my_list_status`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.plugin.settings.malAccessToken}`
        },
        body: body.toString()
      });
    };

    const response = await this.requestQueue.add(requestFn, { priority: 'high' });
    
    if (!response?.json) {
      throw ZoroError.create('EMPTY_UPDATE_RESPONSE', 'Empty response from MAL update', { mediaId }, 'error');
    }

    if (response.json.error) {
      throw ZoroError.create('MAL_UPDATE_ERROR', response.json.message || 'MAL update failed', { error: response.json }, 'error');
    }

    this.cache.invalidateByMedia(mediaId);
    
    return {
      id: response.json.id || null,
      status: this.mapMALStatusToAniList(response.json.status),
      score: response.json.score || 0,
      progress: response.json.num_episodes_watched || response.json.num_chapters_read || 0
    };
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
      const config = { type: 'single', mediaType, mediaId: parseInt(mediaId) };
      const response = await this.fetchMALData(config);
      return response.MediaList !== null;
    } catch (error) {
      return false;
    }
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
          url: `${this.baseUrl}/anime/season/${year}/${season}?fields=${this.getFieldsForLayout('card')}`,
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

  transformResponse(data, config) {
    switch (config.type) {
      case 'search':
        return { Page: { media: data.data?.map(item => this.transformMedia(item)) || [] } };
      case 'single':
        const targetMedia = data.data?.find(item => item.node.id === parseInt(config.mediaId));
        return { MediaList: targetMedia ? this.transformListEntry(targetMedia) : null };
      case 'stats':
        return { User: this.transformUser(data) };
      default:
        return {
          MediaListCollection: {
            lists: [{ entries: data.data?.map(item => this.transformListEntry(item)) || [] }]
          }
        };
    }
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

  transformListEntry(malEntry) {
    const media = malEntry.node;
    const listStatus = malEntry.list_status;
    
    return {
      id: listStatus?.id || null,
      status: this.mapMALStatusToAniList(listStatus?.status),
      score: listStatus?.score || 0,
      progress: listStatus?.num_episodes_watched || listStatus?.num_chapters_read || 0,
      media: this.transformMedia(malEntry)
    };
  }

  transformUser(malUser) {
    return {
      id: malUser.id || null,
      name: malUser.name || 'Unknown User',
      avatar: {
        large: malUser.picture || null,
        medium: malUser.picture || null
      },
      statistics: {
        anime: { count: 0, meanScore: 0, standardDeviation: 0, episodesWatched: 0, minutesWatched: 0 },
        manga: { count: 0, meanScore: 0, standardDeviation: 0, chaptersRead: 0, volumesRead: 0 }
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

  async ensureValidToken() {
    if (!this.plugin.settings.malAccessToken) {
      throw ZoroError.create('AUTH_REQUIRED', 'Authentication required', {}, 'error');
    }
    return await this.plugin.malAuth?.ensureValidToken?.() || true;
  }

  getAuthHeaders() {
    const headers = { 'Accept': 'application/json' };
    // Only add auth header if we have a token (for user-specific requests)
    if (this.plugin.settings.malAccessToken) {
      headers['Authorization'] = `Bearer ${this.plugin.settings.malAccessToken}`;
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

  getFieldsForLayout(layout = 'card') {
    return this.fieldSets[layout] || this.fieldSets.card;
  }

  mapAniListStatusToMAL(status) {
    return this.statusMappings[status] || status;
  }

  mapMALStatusToAniList(status) {
    return this.reverseStatusMappings[status] || status;
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

  async onload() {
    console.log('[Zoro] Plugin loading...');
    this.render = new Render(this);
    
    try {
      await this.loadSettings();
      console.log('[Zoro] Settings loaded.');
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }
    
    await this.cache.loadFromDisk(); this.cache.startAutoPrune(5 * 60 * 1000);
    
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
    this.registerMarkdownPostProcessor(this.processor.processInlineLinks.bind(this.processor));
    
    this.addSettingTab(new ZoroSettingTab(this.app, this));
    console.log('[Zoro] Plugin loaded successfully.');
  }

  validateSettings(settings) {
    return {
      defaultApiSource: ['anilist', 'mal'].includes(settings?.defaultApiSource) ? settings.defaultApiSource : 'anilist',
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


handleEditClick(e, entry, statusEl, config = {}) {
  e.preventDefault();
  e.stopPropagation();

  this.edit.createEditModal(
    entry,
    async updates => {
      // Use appropriate API based on source
      if (config.source === 'mal') {
        await this.malApi.updateMediaListEntry(entry.media.id, updates);
      } else {
        await this.api.updateMediaListEntry(entry.media.id, updates);
      }
    },
    () => {
      // Callback after successful update
    },
    config.source || 'anilist'  // ← ADD THIS LINE - pass the source to the Edit modal
  );
}

  getStatsConfig() {
  return {
    showAvatar: this.settings.showAvatar ?? true,
    showFavorites: this.settings.showFavorites ?? true,
    showBreakdowns: this.settings.showBreakdowns ?? true,
    showTimeStats: this.settings.showTimeStats ?? true,
    layout: this.settings.statsLayout ?? 'enhanced', // minimal, standard, enhanced
    theme: this.settings.statsTheme ?? 'auto' // auto, light, dark
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
      'mal': ['stats', 'search', 'single', 'list']
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

  async handleStatsOperation(api, config) {
    if (config.source === 'mal') {
      const response = await api.fetchMALStats?.(config);
      return response?.User || response;
    } else {
      const data = await api.fetchAniListData?.(config);
      return data?.User || data;
    }
  }

  async handleSearchOperation(api, config) {
  return { isSearchInterface: true, config };
}

  async handleSingleOperation(api, config) {
    if (config.source === 'mal') {
      if (!config.mediaId) {
        throw new Error('❌ Media ID is required for single media view');
      }
      const response = await api.fetchMALData?.(config);
      return response?.MediaList;
    } else {
      const data = await api.fetchAniListData?.(config);
      return data?.MediaList;
    }
  }

  async handleListOperation(api, config) {
    if (config.source === 'mal') {
      const response = await api.fetchMALList?.({ 
        listType: config.listType, 
        mediaType: config.mediaType,
        layout: config.layout
      });
      return response?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    } else {
      const data = await api.fetchAniListData?.({ ...config });
      return data?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    }
  }

  async handleTrendingOperation(api, config) {
    if (config.source === 'mal') {
      throw new Error('❌ Trending is currently only supported for AniList');
    }
    
    return { isTrendingOperation: true, config };
  }

  async renderData(el, data, config) {
    const { type } = config;

    try {
      switch (type) {
        case 'stats':
          this.plugin.render.renderUserStats(el, data);
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
      
      const api = this.getApiInstance(resolvedConfig.source);
      
      const data = await this.executeApiOperation(api, resolvedConfig);
      
      await this.renderData(el, data, resolvedConfig);

    } catch (error) {
      el.empty();
      this.plugin.renderError(el, error.message, 'Failed to load', retryFn);
      throw error;
    }
  }

  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="zoro:"]');

    const processingPromises = Array.from(inlineLinks).map(link => 
      this.processInlineLink(link, ctx)
    );

    await Promise.allSettled(processingPromises);
  }

  async processInlineLink(link, ctx) {
    const href = link.getAttribute('href');
    
    const placeholder = document.createElement('span');
    placeholder.textContent = '🔄 Loading Zoro...';
    placeholder.className = 'zoro-loading-placeholder';
    link.replaceWith(placeholder);

    try {
      const config = this.parseInlineLink(href);
      
      // Validate operation support
      this.validateOperation(config.source || 'anilist', config.type);
      
      const api = this.getApiInstance(config.source || 'anilist');
      const data = await this.executeApiOperation(api, config);

      const container = document.createElement('span');
      container.className = 'zoro-inline-container';
      
      await this.renderData(container, data, config);

      placeholder.replaceWith(container);

      // Add cleanup handler
      ctx.addChild({
        unload: () => {
          if (container.parentNode) {
            container.remove();
          }
        }
      });

    } catch (error) {
      console.warn(`[Zoro] Inline link failed for ${href}:`, error);

      const container = document.createElement('span');
      container.className = 'zoro-inline-container zoro-error-container';

      const retryFn = () => {
        container.replaceWith(placeholder);
        this.processInlineLink(link, ctx);
      };

      this.plugin.renderError(container, error.message, 'Inline link', retryFn);
      placeholder.replaceWith(container);
    }
  }

  /**
   * Parse code block configuration with enhanced validation
   * @param {string} source - Raw code block content
   * @returns {Object} Parsed configuration object
   */
  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    // Configuration key mapping for flexibility
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
      'limit': 'perPage'
    };

    for (let raw of lines) {
      const colonIndex = raw.indexOf(':');
      if (colonIndex === -1) continue;

      let key = raw.slice(0, colonIndex).trim().toLowerCase();
      let value = raw.slice(colonIndex + 1).trim();

      // Map key to standardized format
      const mappedKey = keyMappings[key];
      if (!mappedKey) continue;

      // Process value based on key type
      config[mappedKey] = this.processConfigValue(mappedKey, value);
    }

    // Apply defaults and validation
    return this.applyConfigDefaults(config);
  }

  /**
   * Process configuration values with type conversion
   * @param {string} key - Configuration key
   * @param {string} value - Raw value
   * @returns {any} Processed value
   */
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
        return parseInt(value) || undefined;
      default:
        return value;
    }
  }

  /**
   * Apply configuration defaults and validation
   * @param {Object} config - Raw configuration object
   * @returns {Object} Configuration with defaults applied
   */
  applyConfigDefaults(config) {
    // Set default API source
    if (!config.source) {
      config.source = this.plugin.settings.defaultApiSource || 'anilist';
    }

    // Handle username resolution
    if (!config.username) {
      if (this.plugin.settings.defaultUsername) {
        config.username = this.plugin.settings.defaultUsername;
      } else if (this.hasValidAuthForSource(config.source)) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('❌ Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
      }
    }

    // Set default values
    config.type = config.type || 'list';
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
    
    if (!config.listType && config.type === 'list') {
      config.listType = 'CURRENT';
    }

    return config;
  }

  /**
   * Check if valid authentication exists for source
   * @param {string} source - API source
   * @returns {boolean} Whether valid auth exists
   */
  hasValidAuthForSource(source) {
    switch (source) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'anilist':
        return !!this.plugin.settings.accessToken;
      default:
        return false;
    }
  }

  /**
   * Parse inline link with enhanced error handling
   * @param {string} href - Inline link href
   * @returns {Object} Parsed configuration object
   */
  parseInlineLink(href) {
    try {
      const [base, hash] = href.replace('zoro:', '').split('#');
      const parts = base.split('/').filter(part => part !== '');

      let username, pathParts;

      // Handle username resolution
      if (parts.length === 0 || parts[0] === '') {
        if (!this.plugin.settings.defaultUsername) {
          throw new Error('⚠️ Default username not set. Configure it in plugin settings.');
        }
        username = this.plugin.settings.defaultUsername;
        pathParts = parts.slice(1);
      } else {
        username = parts[0];
        pathParts = parts.slice(1);
      }

      const config = {
        username: username,
        layout: 'card',
        type: 'list',
        source: this.plugin.settings.defaultApiSource || 'anilist'
      };

      // Parse path components
      if (pathParts.length > 0) {
        this.parseInlineLinkPath(config, pathParts);
      }

      // Parse hash modifiers
      if (hash) {
        this.parseInlineLinkHash(config, hash);
      }

      return config;

    } catch (error) {
      throw new Error(`❌ Invalid Zoro inline link format: ${error.message}`);
    }
  }

  /**
   * Parse inline link path components
   * @param {Object} config - Configuration object to modify
   * @param {string[]} pathParts - Path components
   */
  parseInlineLinkPath(config, pathParts) {
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
      // Treat as list type
      config.listType = main.toUpperCase().replace(/[\s-]/g, '_');
      config.type = 'list';
    }
  }

  /**
   * Parse inline link hash modifiers
   * @param {Object} config - Configuration object to modify
   * @param {string} hash - Hash portion of the link
   */
  parseInlineLinkHash(config, hash) {
    const validLayouts = ['compact', 'card', 'minimal', 'full'];
    const validSources = ['anilist', 'mal'];
    
    const hashParts = hash.split(',').map(part => part.trim().toLowerCase());
    
    for (const modifier of hashParts) {
      if (validLayouts.includes(modifier)) {
        config.layout = modifier;
      } else if (validSources.includes(modifier)) {
        config.source = modifier;
      } else if (modifier === 'nocache') {
        config.nocache = true;
      }
      // Silently ignore unknown modifiers for forward compatibility
    }
  }
}

class Render {
  constructor(plugin) {
    this.plugin = plugin;
  }
  logDebug(...args) {
  if (this.plugin.settings.debugMode) {
    console.log('[Zoro-Render]', ...args);
  }
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
      
      let data;
      if (config.source === 'mal') {
        data = await this.plugin.malApi.fetchMALData({ 
          ...config, 
          type: 'search',
          search: term, 
          query: term, // Support both parameters
          page: 1, 
          perPage: 5 
        });
      } else {
        data = await this.plugin.api.fetchAniListData({ 
          ...config, 
          type: 'search',
          search: term, 
          page: 1, 
          perPage: 5 
        });
      }
      
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


  renderSingleMedia(el, mediaList, config) {
  const m = mediaList.media;
  el.empty(); 
  el.className = 'zoro-container';
  const card = el.createDiv({ cls: 'zoro-single-card' });

  if (this.plugin.settings.showCoverImages) {
    card.createEl('img', { 
      cls: 'media-cover', 
      attr: { 
        src: m.coverImage.large, 
        alt: m.title.english || m.title.romaji 
      } 
    });
  }
  
  const info = card.createDiv({ cls: 'media-info' });
  info.createEl('h3', null, h => {
    h.createEl('a', { 
      text: m.title.english || m.title.romaji, 
      href: config.source === 'mal' 
        ? this.plugin.getMALUrl(m.id, config.mediaType)
        : this.plugin.getAniListUrl(m.id, config.mediaType), 
      cls: 'zoro-title-link', 
      target: '_blank' 
    });
  });

  const details = info.createDiv({ cls: 'media-details' });
  if (m.format) details.createEl('span', { text: m.format, cls: 'format-badge' });
  details.createEl('span', { 
    text: mediaList.status, 
    cls: `status-badge status-${mediaList.status.toLowerCase()}` 
  });
  
  const status = details.lastChild;
  status.classList.add('clickable-status');
  status.onclick = e => {
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
    this.plugin.handleEditClick(e, mediaList, status, config);
  };

  if (this.plugin.settings.showProgress) {
    details.createEl('span', { 
      text: `${mediaList.progress}/${m.episodes || m.chapters || '?'}`, 
      cls: 'progress' 
    });
  }
  
  if (this.plugin.settings.showRatings && mediaList.score != null) {
    details.createEl('span', { 
      text: `★ ${mediaList.score}`, 
      cls: 'score' 
    });
  }

  if (this.plugin.settings.showGenres && m.genres?.length) {
    const g = info.createDiv({ cls: 'genres' });
    m.genres.slice(0, 3).forEach(genre => 
      g.createEl('span', { text: genre, cls: 'genre-tag' })
    );
  }
}

// Optimized and functional stats rendering methods for the Render class

renderUserStats(el, user, options = {}) {
  const {
    layout = 'standard',
    mediaType = 'ANIME',
    showComparisons = true,
    showTrends = true
  } = options;

  el.empty();
  el.className = `zoro-container zoro-stats-container zoro-stats-${layout}`;

  if (!user || !user.statistics) {
    this.renderStatsError(el, 'No statistics available for this user');
    return;
  }

  const fragment = document.createDocumentFragment();

  // User header with key info
  this.renderStatsHeader(fragment, user);

  // Main overview cards
  this.renderStatsOverview(fragment, user, { showComparisons });

  // Detailed breakdowns based on layout
  if (layout !== 'minimal') {
    this.renderStatsBreakdowns(fragment, user, mediaType);
  }

  // Activity insights
  if (layout === 'detailed' && showTrends) {
    this.renderStatsInsights(fragment, user, mediaType);
  }

  // Favorites showcase
  this.renderStatsFavorites(fragment, user, mediaType);

  el.appendChild(fragment);
}

renderStatsError(el, message) {
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

renderStatsHeader(fragment, user) {
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

// Create clickable user name that opens profile
const userName = userDetails.createEl('h2', { 
  text: user.name,
  cls: 'zoro-user-name zoro-user-name-clickable'
});

// Make the user name clickable
userName.style.cursor = 'pointer';
userName.addEventListener('click', () => {
  window.open(`https://anilist.co/user/${user.name}`, '_blank');
});

// Optional: Add hover effect for better UX
userName.addEventListener('mouseenter', () => {
  userName.style.textDecoration = 'underline';
});

userName.addEventListener('mouseleave', () => {
  userName.style.textDecoration = 'none';
});
}

renderStatsOverview(fragment, user, options) {
  const { showComparisons } = options;
  const overview = fragment.createDiv({ cls: 'zoro-stats-overview' });
  
  const statsGrid = overview.createDiv({ cls: 'zoro-stats-grid' });

  // Anime stats
  const animeStats = user.statistics.anime;
  if (animeStats && animeStats.count > 0) {
    this.renderMediaTypeCard(statsGrid, 'anime', animeStats, user.mediaListOptions);
  }

  // Manga stats  
  const mangaStats = user.statistics.manga;
  if (mangaStats && mangaStats.count > 0) {
    this.renderMediaTypeCard(statsGrid, 'manga', mangaStats, user.mediaListOptions);
  }

  // Combined insights card
  if (animeStats?.count > 0 && mangaStats?.count > 0 && showComparisons) {
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
    const displayScore = this.formatScore(stats.meanScore, scoreFormat);
    
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
      this.addSecondaryMetric(secondaryMetrics, 'Episodes', stats.episodesWatched.toLocaleString());
    }
    if (stats.minutesWatched) {
      const timeFormatted = this.formatWatchTime(stats.minutesWatched);
      this.addSecondaryMetric(secondaryMetrics, 'Time Watched', timeFormatted);
    }
  } else {
    if (stats.chaptersRead) {
      this.addSecondaryMetric(secondaryMetrics, 'Chapters', stats.chaptersRead.toLocaleString());
    }
    if (stats.volumesRead) {
      this.addSecondaryMetric(secondaryMetrics, 'Volumes', stats.volumesRead.toLocaleString());
    }
  }

  if (stats.standardDeviation) {
    this.addSecondaryMetric(secondaryMetrics, 'Score Deviation', stats.standardDeviation.toFixed(1));
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

renderStatsBreakdowns(fragment, user, mediaType) {
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

renderStatsInsights(fragment, user, mediaType) {
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

renderStatsFavorites(fragment, user, mediaType) {
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
          alt: item.title?.romaji || item.title?.english
        }
      });
    }
    
    const info = favItem.createDiv({ cls: 'zoro-favorite-info' });
    info.createEl('div', { 
      text: item.title?.english || item.title?.romaji || 'Unknown',
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

// Helper methods

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
    label.textContent = this.formatScore(scoreData.score, listOptions?.scoreFormat);
    
    const bar = barContainer.createDiv({ cls: 'zoro-score-bar' });
    const percentage = (scoreData.count / maxCount) * 100;
    bar.style.setProperty('--bar-width', `${percentage}%`);
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

  // Show recent years (last 10 years or top 8 by count)
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

// Utility methods

addSecondaryMetric(container, label, value) {
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
    // Use appropriate URL based on source
    if (config.source === 'mal') {
      titleLink.href = this.plugin.getMALUrl(media.id, config.mediaType);
    } else {
      titleLink.href = this.plugin.getAniListUrl(media.id, config.mediaType);
    }
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
      statusBadge.onclick = (e) => this.handleStatusClick(e, entry, statusBadge, config);
      details.appendChild(statusBadge);
    }


if (isSearch) {
  const editBtn = document.createElement('span');
  editBtn.className = 'status-badge status-edit clickable-status';
  editBtn.textContent = 'Edit';
  editBtn.dataset.loading = 'false';
  
  editBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Check authentication based on source
    const isAuthenticated = config.source === 'mal' 
      ? this.plugin.settings.malAccessToken 
      : this.plugin.settings.accessToken;

    if (!isAuthenticated) {
      console.log(`[Zoro] Not authenticated with ${config.source || 'anilist'}`);
      this.plugin.prompt.createAuthenticationPrompt(config.source || 'anilist');
      return;
    }

    // Show loading state
    editBtn.dataset.loading = 'true';
    editBtn.innerHTML = `
  <div class="sharingan-glow">
    <div class="tomoe-container">
      <span class="tomoe"></span>
      <span class="tomoe"></span>
      <span class="tomoe"></span>
    </div>
  </div>
`;

    editBtn.style.pointerEvents = 'none';

    try {
      console.log(`[Zoro] Checking user entry for media ${media.id} via ${config.source || 'anilist'}`);
      
      // Get user's actual entry for this media
      let existingEntry = null;
      
      if (config.source === 'mal') {
        // Use MAL API (you can implement getUserEntryForMedia in MAL later)
        existingEntry = await this.plugin.malApi.getUserEntryForMedia?.(media.id, config.mediaType) || null;
      } else {
        // Use AniList API with the new method
        existingEntry = await this.plugin.api.getUserEntryForMedia(media.id, config.mediaType);
      }
      
      console.log(`[Zoro] User entry result:`, existingEntry ? 'Found existing entry' : 'Not in user list');
      
      // Prepare entry data based on what we found
      const entryToEdit = existingEntry || {
        media: media,
        status: 'PLANNING',
        progress: 0,
        score: null,
        id: null
      };

      // Update button appearance
      const isNewEntry = !existingEntry;
      editBtn.textContent = isNewEntry ? 'Add' : 'Edit';
      editBtn.className = `status-badge ${isNewEntry ? 'status-add' : 'status-edit'} clickable-status`;

      // Reset loading state
      editBtn.dataset.loading = 'false';
      editBtn.style.pointerEvents = 'auto';

      console.log(`[Zoro] Opening edit modal for ${isNewEntry ? 'new' : 'existing'} entry`);

      // Open edit modal with correct data
      this.plugin.edit.createEditModal(
        entryToEdit,
        async (updates) => {
          try {
            console.log(`[Zoro] Updating media ${media.id} with:`, updates);
            
            const api = config.source === 'mal' ? this.plugin.malApi : this.plugin.api;
            await api.updateMediaListEntry(media.id, updates);
            
            // Success feedback
            const successMessage = isNewEntry ? '✅ Added to list!' : '✅ Updated!';
            new Notice(successMessage, 3000);
            console.log(`[Zoro] ${successMessage}`);
            
            // Update button to reflect it's now in the list
            editBtn.textContent = 'Edit';
            editBtn.className = 'status-badge status-edit clickable-status';
            
            // Refresh any open list views
            this.refreshActiveViews();
            
          } catch (updateError) {
            console.error('[Zoro] Update failed:', updateError);
            new Notice(`❌ Update failed: ${updateError.message}`, 5000);
          }
        },
        () => {
          // Modal cancelled - reset button state
          console.log('[Zoro] Edit modal cancelled');
          editBtn.textContent = 'Edit';
          editBtn.className = 'status-badge status-edit clickable-status';
          editBtn.dataset.loading = 'false';
          editBtn.style.pointerEvents = 'auto';
        },
        config.source // Pass source to modal for proper API handling
      );

    } catch (error) {
      console.error('[Zoro] User entry check failed:', error);
      
      // Reset button state
      editBtn.textContent = 'Edit';
      editBtn.dataset.loading = 'false';
      editBtn.style.pointerEvents = 'auto';
      
      // Show user-friendly message but still allow editing
      new Notice('⚠️ Could not check list status, assuming new entry', 3000);
      
      // Fallback to default new entry data
      const defaultEntry = {
        media: media,
        status: 'PLANNING',
        progress: 0,
        score: null,
        id: null
      };

      console.log('[Zoro] Falling back to default entry data');

      this.plugin.edit.createEditModal(
        defaultEntry,
        async (updates) => {
          try {
            const api = config.source === 'mal' ? this.plugin.malApi : this.plugin.api;
            await api.updateMediaListEntry(media.id, updates);
            new Notice('✅ Added to list!', 3000);
            this.refreshActiveViews();
          } catch (updateError) {
            console.error('[Zoro] Update failed:', updateError);
            new Notice(`❌ Failed to add: ${updateError.message}`, 5000);
          }
        },
        () => {
          console.log('[Zoro] Fallback edit modal cancelled');
        },
        config.source
      );
    }
  };
  
  details.appendChild(editBtn);
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

  handleStatusClick(e, entry, badge, config = {}) {
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
  
  this.plugin.handleEditClick(e, entry, badge, config);
}

  handleAddClick(e, media, config) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.target;
    btn.innerHTML = `
  <div class="sharingan-glow">
    <div class="tomoe-container">
      <span class="tomoe"></span>
      <span class="tomoe"></span>
      <span class="tomoe"></span>
    </div>
  </div>
`;

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
  }

  createEditModal(entry, onSave, onCancel, source = 'anilist') {
    const modal = this.createModalStructure();
    const { overlay, content, form } = modal;
    
    const title = this.createTitle(entry);
    const closeBtn = Edit.createCloseButton(() => this.closeModal(modal.container, onCancel));
    const favoriteBtn = this.createFavoriteButton(entry, source);
    const formFields = this.createFormFields(entry);
    const quickButtons = this.createQuickProgressButtons(entry, formFields.progress.input, formFields.status.input);
    const actionButtons = this.createActionButtons(entry, onSave, modal, source);
    
    this.setupModalInteractions(modal, overlay, onCancel);
    this.setupFormSubmission(form, entry, onSave, actionButtons.save, formFields, modal, source);
    this.setupEscapeListener(onCancel, modal, () => {
      this.handleSave(entry, onSave, actionButtons.save, formFields, modal, source);
    });
    
    this.assembleModal(content, form, {
      title,
      closeBtn,
      favoriteBtn,
      formFields,
      quickButtons,
      actionButtons
    });
    
    document.body.appendChild(modal.container);
    
    if (source === 'anilist') {
      this.initializeFavoriteButton(entry, favoriteBtn);
    } else {
      favoriteBtn.style.display = 'none';
    }
    
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
  
  static createCloseButton(onClick) {
    const btn = document.createElement('button');
    btn.className = 'panel-close-btn';
    btn.innerHTML = '×';
    btn.title = 'Close';
    btn.onclick = onClick;
    return btn;
  }

  createFavoriteButton(entry, source) {
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
    
    favBtn.onclick = () => this.toggleFavorite(entry, favBtn, source);
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

  createActionButtons(entry, onSave, modal, source) {
    const container = document.createElement('div');
    container.className = 'zoro-modal-buttons';
    
    const removeBtn = this.createActionButton({
      label: this.config.buttons.remove.label,
      className: this.config.buttons.remove.class,
      onClick: () => this.handleRemove(entry, modal.container, source)
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
  
  setupFormSubmission(form, entry, onSave, saveBtn, formFields, modal, source) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.handleSave(entry, onSave, saveBtn, formFields, modal, source);
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

  async toggleFavorite(entry, favBtn, source = 'anilist') {
    if (source !== 'anilist') return;
    
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

  async handleRemove(entry, modalElement, source = 'anilist') {
    if (!confirm('Remove this entry?')) return;
    
    const removeBtn = modalElement.querySelector('.zoro-remove-btn');
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

    
    try {
      if (source === 'mal') {
        // MAL doesn't support removing entries via API in most cases
        // It would require setting status to a "not in list" state
        new Notice('❌ MAL does not support removing entries via API', 5000);
        throw new Error('MAL remove not supported');
      } else {
        // AniList remove
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

  async handleSave(entry, onSave, saveBtn, formFields, modal, source = 'anilist') {
    if (this.saving) return;
    this.saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    const form = modal.form;
    const scoreVal = parseFloat(formFields.score.input.value);
    
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
      
      if (source === 'mal') {
        await this.plugin.malApi.updateMediaListEntry(entry.media.id, updates);
      } else {
        await onSave(updates);
      }
      
      Object.assign(entry, updates);
      
      this.invalidateCache(entry, source);
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
  }
  
  updateAllFavoriteButtons(entry) {
    document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-fav-btn`)
      .forEach(btn => {
        btn.className = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      });
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

class Trending {
  constructor(plugin) { this.plugin = plugin; }

  async renderTrendingBlock(el, config) {
    el.empty();
    el.appendChild(this.plugin.render.createListSkeleton(10));

    try {
      const type = (config.mediaType || 'ANIME').toLowerCase();
      const url = `https://api.jikan.moe/v4/top/${type}?filter=airing&limit=20`;
      const resp = await this.plugin.requestQueue.add(() => fetch(url).then(r => r.json()));
      const unique = [];
      const seen = new Set();
      (resp.data || []).forEach(item => {
        if (!seen.has(item.mal_id)) {
          seen.add(item.mal_id);
          unique.push(item);
        }
      });
      const top20 = unique.slice(0, 20).map(item => ({
        id: item.mal_id,
        title: { romaji: item.title || '', english: item.title_english, native: item.title_japanese },
        coverImage: { large: item.images?.jpg?.large_image_url },
        format: item.type,
        averageScore: item.score ? Math.round(item.score * 10) : null,
        genres: item.genres?.map(g => g.name) || [],
        episodes: item.episodes,
        chapters: type === 'manga' ? item.chapters : undefined
      }));
      el.empty();
      this.plugin.render.renderSearchResults(el, top20, { layout: config.layout || 'card', mediaType: config.mediaType || 'ANIME' });
    } catch (err) {
      this.plugin.renderError(el, err.message, 'Trending');
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
      new Notice('✅ Score format updated to 0.0-10.0 scale', 3000);
      console.log('🎉 Score format successfully changed to POINT_10');
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
      .setName('Loading Icon')
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
    
    new Setting(Exp)
  .setName('Default API Source')
  .setDesc('Choose which API to use by default when no source is specified in code blocks')
  .addDropdown(dropdown => dropdown
    .addOption('anilist', 'AniList')
    .addOption('mal', 'MyAnimeList')
    .setValue(this.plugin.settings.defaultApiSource)
    .onChange(async (value) => {
      this.plugin.settings.defaultApiSource = value;
      await this.plugin.saveSettings();
    }));
    

new Setting(Exp)
  .setName('Dump metrics & health')
  .setDesc('Open Dev-Tools console first, then click.')
  .addButton(btn =>
    btn
      .setButtonText('Show')
      .onClick(() => {
        const api = this.plugin.api;
        // 1. console table
        console.table(api.metrics);
        // 2. full health object
        console.log('Health:', api.getHealthStatus());
        // 3. quick notice
        const h = api.getHealthStatus();
        new Notice(
          `Status: ${h.status}\n` +
          `Requests: ${h.requests.total} (${h.latency.avg} ms avg)\n` +
          `Errors: ${h.requests.failed}`,
          8000
        );
      })
  );
  
  
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

