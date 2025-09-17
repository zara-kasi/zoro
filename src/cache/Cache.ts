import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

// Core data structures
interface CacheEntry {
  data: unknown;
  compressed: boolean;
  timestamp: number;
  customTtl?: number | null;
  tags: string[];
  accessCount: number;
  source: string | null;
  originalSize?: number;
}

interface CacheConfig {
  ttlMap?: Record<string, number>;
  obsidianPlugin?: Plugin | null;
  maxSize?: number;
  compressionThreshold?: number;
  batchSize?: number;
}

interface CacheOptions {
  scope?: string;
  source?: string | null;
  ttl?: number | null;
  tags?: string[];
  refreshCallback?: RefreshCallback | null;
}

interface ParsedKey {
  __scope: string;
  __type: string;
  __id: string;
  __source?: string;
  userId?: string;
  username?: string;
  mediaId?: string | number;
  tags?: string[];
  [key: string]: unknown;
}

interface CompositeScope {
  source: string | null;
  scope: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  compressions: number;
}

interface CacheState {
  loading: boolean;
  saving: boolean;
  lastSaved: number | null;
  lastLoaded: number | null;
}

interface CacheFlags {
  autoPrune: boolean;
  backgroundRefresh: boolean;
}

interface CacheIntervals {
  prune: NodeJS.Timeout | null;
  refresh: NodeJS.Timeout | null;
  save: NodeJS.Timeout | null;
}

interface StatsWithMeta extends CacheStats {
  hitRate: string;
  totalRequests: number;
  cacheSize: number;
  indexSize: number;
  storeBreakdown: Record<string, number>;
  lastSaved: string;
  lastLoaded: string;
}

interface CachePayload {
  version: string;
  timestamp: number;
  stats: CacheStats;
  data: Record<string, Array<[string, CacheEntry]>>;
  indexes: {
    byUser: Array<[string, string[]]>;
    byMedia: Array<[string, string[]]>;
    byTag: Array<[string, string[]]>;
  };
  accessLog: Array<[string, number]>;
}

type RefreshCallback = (key: string, scope: string, source: string | null) => Promise<unknown>;
type CacheKey = string | Record<string, unknown>;
type StoreMap = Map<string, CacheEntry>;
type IndexMap = Map<string, Set<string>>;

const DEFAULT_API_SOURCES = ["anilist", "mal", "simkl"] as const;
const DEFAULT_TTL_MAP = {
  userData: 30 * 60 * 1000, // 30 minutes - user profiles change occasionally
  mediaData: 10 * 60 * 1000, // 10 minutes - show info is mostly static
  searchResults: 2 * 60 * 1000, // 2 minutes - search results get stale fast
  mediaDetails: 60 * 60 * 1000 // 1 hour - detailed info rarely changes
} as const;

export class Cache {
  private readonly ttlMap: Record<string, number>;
  private readonly stores: Record<string, StoreMap> = {};
  private readonly indexes: {
    byUser: IndexMap;
    byMedia: IndexMap;
    byTag: IndexMap;
  };
  private readonly apiSources: readonly string[];
  private readonly version: string = "3.2.0";
  private readonly maxSize: number;
  private readonly compressionThreshold: number;
  private readonly batchSize: number;
  private readonly obsidianPlugin: Plugin | null;

  private readonly intervals: CacheIntervals;
  private readonly flags: CacheFlags;
  private readonly stats: CacheStats;
  private readonly state: CacheState;
  private readonly accessLog: Map<string, number>;
  private readonly refreshCallbacks: Map<string, RefreshCallback>;
  private readonly loadQueue: Set<string>;
  private readonly saveQueue: Set<string>;
  private readonly persistenceQueue: Set<string>;

  private lastPersistTime: number = 0;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private criticalSaveMode: boolean = false;

  constructor(config: CacheConfig = {}) {
    const {
      ttlMap = {},
      obsidianPlugin = null,
      maxSize = 10000,
      compressionThreshold = 1024,
      batchSize = 100
    } = config;

    this.ttlMap = { ...DEFAULT_TTL_MAP, ...ttlMap };
    this.obsidianPlugin = obsidianPlugin;
    this.maxSize = maxSize;
    this.compressionThreshold = compressionThreshold;
    this.batchSize = batchSize;
    this.apiSources = DEFAULT_API_SOURCES;

    this.indexes = {
      byUser: new Map(),
      byMedia: new Map(),
      byTag: new Map()
    };

    this.intervals = {
      prune: null,
      refresh: null,
      save: null
    };

    this.flags = {
      autoPrune: false,
      backgroundRefresh: false
    };

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      compressions: 0
    };

    this.state = {
      loading: false,
      saving: false,
      lastSaved: null,
      lastLoaded: null
    };

    this.accessLog = new Map();
    this.refreshCallbacks = new Map();
    this.loadQueue = new Set();
    this.saveQueue = new Set();
    this.persistenceQueue = new Set();

    this.initializeStores();

    if (this.obsidianPlugin) {
      this.initializeCache();
    }
  }

  private initializeStores(): void {
    this.apiSources.forEach((api) => {
      this.stores[`${api}:userData`] = new Map();
      this.stores[`${api}:mediaData`] = new Map();
      this.stores[`${api}:searchResults`] = new Map();
    });

    this.stores.userData = new Map();
    this.stores.mediaData = new Map();
    this.stores.searchResults = new Map();
  }

  private async initializeCache(): Promise<void> {
    try {
      await this.loadFromDisk();
      this.startIncrementalSave(30000);
      this.startAutoPrune(300000);
    } catch (error) {
      this.log("INIT_ERROR", "system", "", error instanceof Error ? error.message : String(error));
    }
  }

  private key(input: CacheKey): string {
    if (typeof input === "string") return input;
    if (!input || typeof input !== "object") return String(input);

    const normalized: Record<string, unknown> = {};
    Object.keys(input).sort().forEach((k) => {
      const val = input[k];
      normalized[k] = val !== null && val !== undefined ? val : "";
    });

    return JSON.stringify(normalized);
  }

  structuredKey(scope: string, type: string, id: string | number, meta: Record<string, unknown> = {}): string {
    return this.key({
      __scope: scope,
      __type: type,
      __id: String(id),
      ...meta
    });
  }

  private compositeScope(scope: string, source: string | null): string {
    if (!source) return scope;
    return `${source}:${scope}`;
  }

  private parseCompositeScope(compositeScope: string): CompositeScope {
    const parts = compositeScope.split(":");
    if (parts.length >= 2 && this.apiSources.includes(parts[0])) {
      return {
        source: parts[0],
        scope: parts.slice(1).join(":")
      };
    }
    return {
      source: null,
      scope: compositeScope
    };
  }

  private getStore(scope: string, source: string | null = null): StoreMap | undefined {
    const compositeScope = this.compositeScope(scope, source);
    return this.stores[compositeScope] || this.stores[scope];
  }

  private getTTL(scope: string, source: string | null = null, customTtl: number | null = null): number {
    if (customTtl !== null) return customTtl;
    const compositeScope = this.compositeScope(scope, source);
    return this.ttlMap[compositeScope] || this.ttlMap[scope] || 5 * 60 * 1000;
  }

  private isExpired(entry: CacheEntry, scope: string, source: string | null = null, customTtl: number | null = null): boolean {
    const ttl = customTtl ?? entry.customTtl ?? this.getTTL(scope, source);
    return Date.now() - entry.timestamp > ttl;
  }

  private compress(data: unknown): { data: unknown; compressed: boolean; originalSize?: number } {
    const str = JSON.stringify(data);
    if (str.length < this.compressionThreshold) {
      return { data, compressed: false };
    }

    try {
      const compressed = this.simpleCompress(str);
      this.stats.compressions++;
      return {
        data: compressed,
        compressed: true,
        originalSize: str.length
      };
    } catch {
      return { data, compressed: false };
    }
  }

  private decompress(entry: CacheEntry): unknown {
    if (!entry.compressed) return entry.data;
    try {
      return JSON.parse(this.simpleDecompress(entry.data as string));
    } catch {
      return entry.data;
    }
  }

  private simpleCompress(str: string): string {
    return btoa(encodeURIComponent(str)).replace(/[+/=]/g, (m) => 
      ({ "+": "-", "/": "_", "=": "" })[m] || m
    );
  }

  private simpleDecompress(compressed: string): string {
    const restored = compressed.replace(/[-_]/g, (m) => 
      ({ "-": "+", "_": "/" })[m] || m
    );
    const padded = restored + "=".repeat((4 - restored.length % 4) % 4);
    return decodeURIComponent(atob(padded));
  }

  private updateIndexes(key: string, entry: CacheEntry | null, operation: "set" | "delete" = "set"): void {
    try {
      const parsed: ParsedKey = JSON.parse(key);
      const { __scope: scope, userId, username, mediaId, tags } = parsed;

      if (operation === "delete") {
        this.removeFromIndexes(key, { userId, username, mediaId, tags });
        return;
      }

      if (userId || username) {
        const userKey = userId || username;
        if (!this.indexes.byUser.has(userKey!)) {
          this.indexes.byUser.set(userKey!, new Set());
        }
        this.indexes.byUser.get(userKey!)!.add(key);
      }

      if (mediaId) {
        const mediaIdStr = String(mediaId);
        if (!this.indexes.byMedia.has(mediaIdStr)) {
          this.indexes.byMedia.set(mediaIdStr, new Set());
        }
        this.indexes.byMedia.get(mediaIdStr)!.add(key);
      }

      if (tags && Array.isArray(tags)) {
        tags.forEach((tag) => {
          if (typeof tag === 'string') {
            if (!this.indexes.byTag.has(tag)) {
              this.indexes.byTag.set(tag, new Set());
            }
            this.indexes.byTag.get(tag)!.add(key);
          }
        });
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  private removeFromIndexes(key: string, { userId, username, mediaId, tags }: { 
    userId?: string; 
    username?: string; 
    mediaId?: string | number; 
    tags?: unknown[];
  }): void {
    const userKey = userId || username;
    if (userKey && this.indexes.byUser.has(userKey)) {
      this.indexes.byUser.get(userKey)!.delete(key);
      if (this.indexes.byUser.get(userKey)!.size === 0) {
        this.indexes.byUser.delete(userKey);
      }
    }

    if (mediaId && this.indexes.byMedia.has(String(mediaId))) {
      const mediaIdStr = String(mediaId);
      this.indexes.byMedia.get(mediaIdStr)!.delete(key);
      if (this.indexes.byMedia.get(mediaIdStr)!.size === 0) {
        this.indexes.byMedia.delete(mediaIdStr);
      }
    }

    if (tags && Array.isArray(tags)) {
      tags.forEach((tag) => {
        if (typeof tag === 'string' && this.indexes.byTag.has(tag)) {
          this.indexes.byTag.get(tag)!.delete(key);
          if (this.indexes.byTag.get(tag)!.size === 0) {
            this.indexes.byTag.delete(tag);
          }
        }
      });
    }
  }

  private enforceSize(scope: string, source: string | null = null): number {
    const store = this.getStore(scope, source);
    if (!store || store.size <= this.maxSize) return 0;

    const entries = Array.from(store.entries())
      .map(([key, entry]) => ({
        key,
        entry,
        lastAccess: this.accessLog.get(key) || 0
      }))
      .sort((a, b) => a.lastAccess - b.lastAccess);

    const toEvict = entries.slice(0, store.size - this.maxSize + this.batchSize);

    toEvict.forEach(({ key }) => {
      store.delete(key);
      this.updateIndexes(key, null, "delete");
      this.accessLog.delete(key);
      this.stats.evictions++;
    });

    this.schedulePersistence();
    return toEvict.length;
  }

  get(key: CacheKey, options: CacheOptions = {}): unknown {
    const { scope = "userData", source = null, ttl = null, refreshCallback = null } = options;
    const store = this.getStore(scope, source);

    if (!store) {
      this.stats.misses++;
      return null;
    }

    const cacheKey = typeof key === "object" ? this.key(key) : key;
    const entry = store.get(cacheKey);
    this.accessLog.set(cacheKey, Date.now());

    if (!entry) {
      this.stats.misses++;
      this.log("MISS", this.compositeScope(scope, source), cacheKey);
      this.maybeRefresh(cacheKey, scope, source, refreshCallback);
      return null;
    }

    if (this.isExpired(entry, scope, source, ttl)) {
      store.delete(cacheKey);
      this.updateIndexes(cacheKey, entry, "delete");
      this.stats.misses++;
      this.log("EXPIRED", this.compositeScope(scope, source), cacheKey);
      this.maybeRefresh(cacheKey, scope, source, refreshCallback);
      this.schedulePersistence();
      return null;
    }

    this.stats.hits++;
    const age = Math.round((Date.now() - entry.timestamp) / 1000);
    this.log("HIT", this.compositeScope(scope, source), cacheKey, `${age}s old`);

    if (this.shouldRefresh(entry, scope, source, ttl)) {
      const callbackKey = `${this.compositeScope(scope, source)}:${cacheKey}`;
      const callback = this.refreshCallbacks.get(callbackKey);
      if (callback) this.scheduleRefresh(cacheKey, scope, source, callback);
    }

    return this.decompress(entry);
  }

  set(key: CacheKey, value: unknown, options: CacheOptions = {}): boolean {
    const { scope = "userData", source = null, ttl = null, tags = [], refreshCallback = null } = options;
    const store = this.getStore(scope, source);

    if (!store) return false;

    const cacheKey = typeof key === "object" ? this.key(key) : key;
    const compressed = this.compress(value);

    const entry: CacheEntry = {
      ...compressed,
      timestamp: Date.now(),
      customTtl: ttl,
      tags,
      accessCount: 1,
      source
    };

    store.set(cacheKey, entry);
    this.updateIndexes(cacheKey, entry);
    this.enforceSize(scope, source);
    this.stats.sets++;
    this.log("SET", this.compositeScope(scope, source), cacheKey, String(store.size));

    if (refreshCallback) {
      const callbackKey = `${this.compositeScope(scope, source)}:${cacheKey}`;
      this.refreshCallbacks.set(callbackKey, refreshCallback);
    }

    this.schedulePersistence(true);
    return true;
  }

  delete(key: CacheKey, options: Pick<CacheOptions, 'scope' | 'source'> = {}): boolean {
    const { scope = "userData", source = null } = options;
    const store = this.getStore(scope, source);

    if (!store) return false;

    const cacheKey = typeof key === "object" ? this.key(key) : key;
    const entry = store.get(cacheKey);
    const deleted = store.delete(cacheKey);

    if (deleted) {
      this.updateIndexes(cacheKey, entry || null, "delete");
      this.accessLog.delete(cacheKey);
      this.stats.deletes++;
      this.log("DELETE", this.compositeScope(scope, source), cacheKey);
      this.schedulePersistence();
    }

    return deleted;
  }

  invalidateByUser(userKey: string, options: Pick<CacheOptions, 'source') = {}): number {
    const { source = null } = options;
    const keys = this.indexes.byUser.get(userKey);
    if (!keys) return 0;

    let deleted = 0;
    const storesToSearch = source 
      ? Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`))
      : Object.entries(this.stores);

    keys.forEach((key) => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      this.accessLog.delete(key);
    });

    if (!source) {
      this.indexes.byUser.delete(userKey);
    }

    this.log("INVALIDATE_USER", source || "all", userKey, `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
  }

  invalidateByMedia(mediaId: string | number, options: Pick<CacheOptions, 'source') = {}): number {
    const { source = null } = options;
    const keys = this.indexes.byMedia.get(String(mediaId));
    if (!keys) return 0;

    let deleted = 0;
    const storesToSearch = source 
      ? Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`))
      : Object.entries(this.stores);

    keys.forEach((key) => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      this.accessLog.delete(key);
    });

    if (!source) {
      this.indexes.byMedia.delete(String(mediaId));
    }

    this.log("INVALIDATE_MEDIA", source || "all", String(mediaId), `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
  }

  invalidateByTag(tag: string, options: Pick<CacheOptions, 'source') = {}): number {
    const { source = null } = options;
    const keys = this.indexes.byTag.get(tag);
    if (!keys) return 0;

    let deleted = 0;
    const storesToSearch = source 
      ? Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`))
      : Object.entries(this.stores);

    keys.forEach((key) => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      this.accessLog.delete(key);
    });

    if (!source) {
      this.indexes.byTag.delete(tag);
    }

    this.log("INVALIDATE_TAG", source || "all", tag, `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
  }

  clearBySource(source: string): number {
    let total = 0;

    Object.entries(this.stores).forEach(([scopeName, store]) => {
      if (scopeName.startsWith(`${source}:`)) {
        total += store.size;
        store.clear();
      }
    });

    // Clean indexes
    Object.values(this.indexes).forEach((index) => {
      for (const [key, keySet] of index.entries()) {
        const filteredKeys = Array.from(keySet).filter((cacheKey) => {
          try {
            const parsed: ParsedKey = JSON.parse(cacheKey);
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

    this.log("CLEAR_SOURCE", source, "", `${total} entries`);
    this.schedulePersistence();
    return total;
  }

  clear(scope: string | null = null): number {
    if (scope) {
      const store = this.stores[scope];
      if (!store) return 0;
      const count = store.size;
      store.clear();
      this.schedulePersistence();
      return count;
    }

    let total = 0;
    Object.values(this.stores).forEach((store) => {
      total += store.size;
      store.clear();
    });

    Object.values(this.indexes).forEach((index) => index.clear());
    this.accessLog.clear();
    this.refreshCallbacks.clear();

    this.log("CLEAR_ALL", "all", "", String(total));
    this.schedulePersistence();
    return total;
  }

  pruneExpired(scope: string | null = null, source: string | null = null): number {
    const scopesToPrune = scope ? [scope] : ["userData", "mediaData", "searchResults"];
    const sourcesToPrune = source ? [source] : [null, ...this.apiSources];
    let total = 0;

    scopesToPrune.forEach((currentScope) => {
      sourcesToPrune.forEach((currentSource) => {
        const store = this.getStore(currentScope, currentSource);
        if (!store) return;

        const toDelete: string[] = [];
        for (const [key, entry] of store.entries()) {
          if (this.isExpired(entry, currentScope, currentSource)) {
            toDelete.push(key);
          }
        }

        toDelete.forEach((key) => {
          const entry = store.get(key);
          store.delete(key);
          this.updateIndexes(key, entry || null, "delete");
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

  private shouldRefresh(entry: CacheEntry, scope: string, source: string | null = null, customTtl: number | null = null): boolean {
    if (!this.flags.backgroundRefresh) return false;
    const ttl = this.getTTL(scope, source, customTtl);
    return Date.now() - entry.timestamp > ttl * 0.8;
  }

  private maybeRefresh(key: string, scope: string, source: string | null, callback: RefreshCallback | null): void {
    if (callback && typeof callback === "function") {
      this.scheduleRefresh(key, scope, source, callback);
    }
  }

  private scheduleRefresh(key: string, scope: string, source: string | null, callback: RefreshCallback): void {
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
        this.log("REFRESH_ERROR", this.compositeScope(scope, source), key, 
          error instanceof Error ? error.message : String(error));
      } finally {
        this.loadQueue.delete(refreshKey);
      }
    }, 0);
  }

  private schedulePersistence(immediate: boolean = false): void {
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

  startAutoPrune(interval: number = 5 * 60 * 1000): this {
    this.stopAutoPrune();
    this.intervals.prune = setInterval(() => {
      const pruned = this.pruneExpired();
      if (pruned > 0) {
        this.log("AUTO_PRUNE", "system", "", `${pruned} entries pruned`);
      }
    }, interval);
    this.flags.autoPrune = true;
    return this;
  }

  stopAutoPrune(): this {
    if (this.intervals.prune) {
      clearInterval(this.intervals.prune);
      this.intervals.prune = null;
    }
    this.flags.autoPrune = false;
    return this;
  }

  startBackgroundRefresh(interval: number = 10 * 60 * 1000): this {
    this.flags.backgroundRefresh = true;
    return this;
  }

  stopBackgroundRefresh(): this {
    this.flags.backgroundRefresh = false;
    return this;
  }

  startIncrementalSave(interval: number = 30 * 1000): this {
    this.stopIncrementalSave();
    this.intervals.save = setInterval(() => {
      if (Date.now() - this.lastPersistTime > interval / 2) {
        this.saveToDisk();
      }
    }, interval);
    return this;
  }

  stopIncrementalSave(): this {
    if (this.intervals.save) {
      clearInterval(this.intervals.save);
      this.intervals.save = null;
    }
    return this;
  }

  async saveToDisk(): Promise<boolean> {
    if (this.state.saving) return false;
    this.state.saving = true;

    try {
      const payload: CachePayload = {
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

      // Try direct file write first
      if (this.obsidianPlugin?.app?.vault?.adapter) {
        try {
          const adapter = this.obsidianPlugin.app.vault.adapter;
          const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
          const cachePath = `${pluginDir}/cache.json`;

          await adapter.write(cachePath, JSON.stringify(payload, null, 2));
          this.log("SAVE_SUCCESS", "system", cachePath, "Direct file write");
          saved = true;
        } catch (error) {
          this.log("SAVE_WARNING", "system", "cache.json", 
            `Direct write failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Try atomic write as fallback
      if (!saved && this.obsidianPlugin?.app?.vault?.adapter) {
        try {
          const adapter = this.obsidianPlugin.app.vault.adapter;
          const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
          const tempPath = `${pluginDir}/cache.tmp`;
          const cachePath = `${pluginDir}/cache.json`;

          await adapter.write(tempPath, JSON.stringify(payload));
          
          try {
            await adapter.remove(cachePath);
          } catch {
            // Ignore file not exists errors
          }
          
          await adapter.rename(tempPath, cachePath);
          this.log("SAVE_SUCCESS", "system", cachePath, "Atomic write");
          saved = true;
        } catch (error) {
          this.log("SAVE_WARNING", "system", "cache.tmp", 
            `Atomic write failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (saved) {
        this.state.lastSaved = Date.now();
        this.lastPersistTime = Date.now();
        this.criticalSaveMode = false;
        return true;
      } else {
        this.log("SAVE_ERROR", "system", "", "All save methods failed");
        return false;
      }
    } catch (error) {
      this.log("SAVE_ERROR", "system", "", error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      this.state.saving = false;
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
    }
  }

  async loadFromDisk(): Promise<number> {
    if (this.state.loading) return 0;
    this.state.loading = true;

    try {
      let data: CachePayload | null = null;

      if (this.obsidianPlugin?.app?.vault?.adapter) {
        const adapter = this.obsidianPlugin.app.vault.adapter;
        const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
        const cachePath = `${pluginDir}/cache.json`;

        try {
          const raw = await adapter.read(cachePath);
          data = JSON.parse(raw) as CachePayload;
          this.log("LOAD_SUCCESS", "system", cachePath, "Direct file read");
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (!errorMsg.includes("ENOENT") && !errorMsg.includes("not exist")) {
            this.log("LOAD_WARNING", "system", cachePath, errorMsg);
          }
        }
      }

      if (!data) {
        this.log("LOAD_EMPTY", "system", "", "No cache data found");
        this.state.lastLoaded = Date.now();
        return 0;
      }

      if (data.version && this.compareVersions(data.version, "3.0.0") < 0) {
        this.log("LOAD_WARNING", "system", "", `Old cache version ${data.version}, clearing`);
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

          if (now - entry.timestamp < ttl) {
            store.set(key, entry);
            this.updateIndexes(key, entry);
            loaded++;
          }
        }
      }

      // Restore indexes
      if (data.indexes) {
        Object.entries(data.indexes).forEach(([indexType, entries]) => {
          if (this.indexes[indexType as keyof typeof this.indexes] && Array.isArray(entries)) {
            entries.forEach(([key, values]) => {
              this.indexes[indexType as keyof typeof this.indexes].set(key, new Set(values));
            });
          }
        });
      }

      // Restore access log
      if (data.accessLog && Array.isArray(data.accessLog)) {
        data.accessLog.forEach(([key, timestamp]) => {
          this.accessLog.set(key, timestamp);
        });
      }

      // Restore stats
      if (data.stats) {
        this.stats.compressions = data.stats.compressions || 0;
      }

      this.state.lastLoaded = Date.now();
      this.lastPersistTime = Date.now();
      this.log("LOAD_COMPLETE", "system", "", `${loaded} entries loaded`);
      return loaded;

    } catch (error) {
      this.log("LOAD_ERROR", "system", "", error instanceof Error ? error.message : String(error));
      return 0;
    } finally {
      this.state.loading = false;
    }
  }

  async clearAll(): Promise<number> {
    this.stopAutoPrune();
    this.stopIncrementalSave();
    this.stopBackgroundRefresh();

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }

    let totalEntries = 0;
    Object.values(this.stores).forEach((store) => {
      totalEntries += store.size;
      store.clear();
    });

    Object.values(this.indexes).forEach((index) => index.clear());
    this.accessLog.clear();
    this.refreshCallbacks.clear();
    this.loadQueue.clear();
    this.saveQueue.clear();
    this.persistenceQueue.clear();

    // Reset stats and state
    Object.assign(this.stats, {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      compressions: 0
    });

    Object.assign(this.state, {
      loading: false,
      saving: false,
      lastSaved: null,
      lastLoaded: null
    });

    this.lastPersistTime = 0;
    this.criticalSaveMode = false;

    // Clean up disk files
    if (this.obsidianPlugin?.app?.vault?.adapter) {
      try {
        const adapter = this.obsidianPlugin.app.vault.adapter;
        const pluginDir = `${this.obsidianPlugin.manifest.dir}`;
        const cachePath = `${pluginDir}/cache.json`;
        const tempPath = `${pluginDir}/cache.tmp`;

        try {
          await adapter.remove(cachePath);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (!errorMsg.includes("ENOENT") && !errorMsg.includes("not exist")) {
            console.warn("[Cache] Could not delete cache.json:", errorMsg);
          }
        }

        try {
          await adapter.remove(tempPath);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (!errorMsg.includes("ENOENT") && !errorMsg.includes("not exist")) {
            console.warn("[Cache] Could not delete cache.tmp:", errorMsg);
          }
        }
      } catch (error) {
        console.error("[Cache] Error during disk cleanup:", error);
      }
    }

    // Write empty cache file
    try {
      const emptyPayload: CachePayload = {
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn("[Cache] Could not write empty cache file:", errorMsg);
    }

    // Restart automatic processes
    this.startIncrementalSave(30000);
    this.startAutoPrune(300000);

    this.log("CLEAR_ALL_COMPLETE", "system", "", `${totalEntries} entries + disk cleanup`);
    return totalEntries;
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }

    return 0;
  }

  getStats(): StatsWithMeta {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(1) : "0.0";

    const storeStats: Record<string, number> = {};
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
      lastSaved: this.state.lastSaved ? new Date(this.state.lastSaved).toLocaleString() : "Never",
      lastLoaded: this.state.lastLoaded ? new Date(this.state.lastLoaded).toLocaleString() : "Never"
    };
  }

  private log(operation: string, scope: string, key: string, extra: string = ""): void {
    const truncated = key.length > 50 ? key.slice(0, 47) + "..." : key;
    // Note: Original implementation was empty - keeping for debugging hooks
  }

  async destroy(): Promise<void> {
    Object.values(this.intervals).forEach((interval) => {
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

    Object.keys(this.stats).forEach((key) => {
      (this.stats as Record<string, number>)[key] = 0;
    });

    Object.assign(this.state, {
      loading: false,
      saving: false,
      lastSaved: null,
      lastLoaded: null
    });

    this.log("DESTROY", "system", "", "Cache destroyed and saved");
  }

  invalidateScope(scope: string, options: Pick<CacheOptions, 'source') = {}): number {
    const { source = null } = options;
    let cleared = 0;

    if (source) {
      const composite = `${source}:${scope}`;
      const store = this.stores[composite];
      if (store) {
        cleared = store.size;
        store.clear();
      }

      if (this.stores[scope]) {
        cleared += this.stores[scope].size;
        this.stores[scope].clear();
      }

      this.schedulePersistence();
      return cleared;
    }

    // Clear global scope
    if (this.stores[scope]) {
      cleared += this.stores[scope].size;
      this.stores[scope].clear();
    }

    // Clear all API-specific scopes
    this.apiSources.forEach((api) => {
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
