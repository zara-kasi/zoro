import { Notice } from 'obsidian';

class Cache {
  constructor(config = {}) {
    // ==============================================
    // CONFIG EXTRACTION & DEFAULTS
    // ==============================================
    
    // Pull out our configuration options with sensible defaults
    // This destructuring pattern makes the constructor super flexible - 
    // you can pass in just what you need and everything else gets reasonable defaults
    const {
      ttlMap = {},                    // Custom TTL overrides (usually empty on first run)
      obsidianPlugin = null,          // Reference to the main Obsidian plugin instance
      maxSize = 10000,               // Max items before we start evicting old stuff
      compressionThreshold = 1024,    // Compress data bigger than 1KB (saves memory)
      batchSize = 100                // How many items to process at once (prevents UI freezing)
    } = config;

    // ==============================================
    // TTL (TIME-TO-LIVE) CONFIGURATION
    // ==============================================
    
    // These are our cache expiration times - tuned based on how often data actually changes
    // We're being pretty aggressive here because anime/manga data doesn't change that often
    // and users hate waiting for stale data to refresh
    this.ttlMap = {
      userData: 30 * 60 * 1000,     // 30 minutes - user profiles change occasionally
      mediaData: 10 * 60 * 1000,    // 10 minutes - show info is mostly static
      searchResults: 2 * 60 * 1000, // 2 minutes - search results get stale fast
      mediaDetails: 60 * 60 * 1000  // 1 hour - detailed info rarely changes
    };
    
    // ==============================================
    // CORE DATA STRUCTURES
    // ==============================================
    
    // Main storage - each API gets its own bucket to avoid conflicts
    this.stores = {};
    
    // These indexes let us find stuff fast without scanning everything
    // byUser: find all data for a specific user
    // byMedia: find all cached info for a specific anime/manga
    // byTag: find data by custom tags (useful for grouping related requests)
    this.indexes = { 
      byUser: new Map(), 
      byMedia: new Map(), 
      byTag: new Map() 
    };
    
    // The APIs we're currently supporting - makes it easy to add more later
    this.apiSources = ['anilist', 'mal', 'simkl'];
    
    // ==============================================
    // CONFIGURATION STORAGE
    // ==============================================
    
    this.version = '3.2.0';                    // For migration logic when we update
    this.maxSize = maxSize;                    // Memory management
    this.compressionThreshold = compressionThreshold; // When to compress large data
    this.batchSize = batchSize;               // Prevents blocking the UI thread
    this.obsidianPlugin = obsidianPlugin;     // Need this for file operations
    
    // ==============================================
    // BACKGROUND TASK MANAGEMENT
    // ==============================================
    
    // These intervals handle our background maintenance tasks
    // We'll set them up later, but initialize them here so we can clean them up properly
    this.intervals = { 
      prune: null,    // Removes expired entries
      refresh: null,  // Updates stale data proactively 
      save: null      // Persists cache to disk periodically
    };
    
    // Feature flags for controlling background behavior
    // Disabled by default because they can be resource-intensive
    this.flags = { 
      autoPrune: false,        // Automatically clean up expired entries
      backgroundRefresh: false // Refresh stale data in the background
    };
    
    // ==============================================
    // PERFORMANCE METRICS
    // ==============================================
    
    // These stats help us tune performance and debug issues
    // Really useful for figuring out if the cache is actually helping
    this.stats = { 
      hits: 0,          // Cache hits (good!)
      misses: 0,        // Cache misses (means we had to fetch from API)
      sets: 0,          // How many times we stored something
      deletes: 0,       // Manual deletions
      evictions: 0,     // Forced deletions due to size limits
      compressions: 0   // How often we compressed large data
    };
    
    // ==============================================
    // OPERATIONAL STATE TRACKING
    // ==============================================
    
    // Keeps track of what the cache is currently doing
    // Prevents race conditions and helps with debugging
    this.state = { 
      loading: false,      // Are we currently loading from disk?
      saving: false,       // Are we currently saving to disk?
      lastSaved: null,     // When did we last successfully save?
      lastLoaded: null     // When did we last load from disk?
    };
    
    // ==============================================
    // ACCESS PATTERN TRACKING
    // ==============================================
    
    // Track which entries get accessed when - helps with intelligent eviction
    // We keep the most recently used stuff and evict the old stuff first
    this.accessLog = new Map();
    
    // Callbacks for when we refresh data in the background
    // Components can register to get notified when their data updates
    this.refreshCallbacks = new Map();
    
    // ==============================================
    // PERSISTENCE QUEUE MANAGEMENT
    // ==============================================
    
    // These manage our disk I/O operations to prevent corruption and improve performance
    this.loadQueue = new Set();           // What's waiting to be loaded
    this.saveQueue = new Set();           // What's waiting to be saved
    this.persistenceQueue = new Set();    // High-priority saves
    this.lastPersistTime = 0;            // Tracks save frequency
    this.saveDebounceTimer = null;       // Prevents excessive saving
    this.criticalSaveMode = false;       // Emergency save mode when things get dicey
    
    // ==============================================
    // INITIALIZATION
    // ==============================================
    
    // Set up our API-specific storage buckets
    this.initializeStores();
    
    // If we're connected to Obsidian, start loading any existing cache
    // This happens async so it won't block plugin startup
    if (this.obsidianPlugin) {
      this.initializeCache();
    }
  }

  initializeStores() {
    // ==============================================
    // API-SPECIFIC STORAGE BUCKETS
    // ==============================================
    
    // Create separate storage compartments for each API we support
    // This prevents conflicts when the same user has different data across services
    // For example: user "john123" might have different anime lists on AniList vs MyAnimeList
    this.apiSources.forEach(api => {
      this.stores[`${api}:userData`] = new Map();      // User profiles, preferences, auth tokens
      this.stores[`${api}:mediaData`] = new Map();     // Basic anime/manga info (titles, genres, etc.)
      this.stores[`${api}:searchResults`] = new Map(); // Search query results (expire fastest)
    });
    
    // ==============================================
    // CROSS-API AGGREGATED STORES
    // ==============================================
    
    // These are our "master" stores that combine data from all APIs
    // Super useful for operations that need to work across multiple services
    // Like when a user wants to search "all my anime" regardless of which API it came from
    this.stores.userData = new Map();      // Merged user data from all APIs
    this.stores.mediaData = new Map();     // Consolidated media info (de-duplicated)
    this.stores.searchResults = new Map(); // Combined search results (ranked by relevance)
    
    // Note: We intentionally don't create a cross-API mediaDetails store here
    // because detailed info is usually API-specific and merging it gets messy
    // Better to keep those separate and let the UI decide how to combine them
  }

  async initializeCache() {
    try {
      // ==============================================
      // CACHE STARTUP SEQUENCE
      // ==============================================
      
      // First, try to load any existing cache data from disk
      // This is where we restore the user's previous session - their cached anime lists,
      // search results, etc. Makes the plugin feel instant on startup instead of
      // having to re-fetch everything from APIs
      await this.loadFromDisk();
      
      // Start our background save process - saves every 30 seconds
      // This is our "insurance policy" against data loss. Even if Obsidian crashes
      // or the user force-quits, we'll only lose at most 30 seconds of cache data
      // 30 seconds is a good balance - frequent enough to prevent major losses,
      // but not so frequent that we're constantly hitting the disk
      this.startIncrementalSave(30000);
      
      // Start the cleanup crew - runs every 5 minutes to remove expired entries
      // This prevents our cache from growing forever and eating up memory
      // We do this less frequently than saves because expired data doesn't hurt anything,
      // it's just wasted space. And cleanup can be CPU-intensive with large caches
      this.startAutoPrune(300000);
      
    } catch (error) {
      // If anything goes wrong during startup, log it but don't crash the plugin
      // Common issues: corrupted cache files, permission problems, disk full
      // We'll just start with an empty cache - not ideal but better than breaking
      this.log('INIT_ERROR', 'system', '', error.message);
      
      // Note: We don't re-throw the error here because cache initialization failing
      // shouldn't prevent the plugin from working. It'll just be slower on first use.
    }
  }

  key(input) {
    // ==============================================
    // CACHE KEY NORMALIZATION
    // ==============================================
    
    // If it's already a string, we're good to go - no conversion needed
    // This handles simple cases like "user:12345" or "anime:attack-on-titan"
    if (typeof input === 'string') return input;
    
    // Handle edge cases that would break JSON.stringify
    // null, undefined, numbers, booleans all get stringified safely
    if (!input || typeof input !== 'object') return String(input);
    
    // ==============================================
    // OBJECT KEY STANDARDIZATION
    // ==============================================
    
    // Here's where things get interesting - we need to create consistent keys
    // for objects that might have the same data but in different orders
    // 
    // Problem: {userId: 123, type: "anime"} and {type: "anime", userId: 123} 
    // should create the SAME cache key, but JSON.stringify would make them different
    
    const normalized = {};
    
    // Sort the keys alphabetically first - this ensures consistent ordering
    // regardless of how the object was constructed or passed in
    Object.keys(input).sort().forEach(k => {
      const val = input[k];
      
      // Normalize null/undefined to empty string to prevent cache misses
      // This way {userId: null} and {userId: undefined} and {userId: ""} 
      // all resolve to the same cache entry instead of creating duplicates
      normalized[k] = val !== null && val !== undefined ? val : '';
    });
    
    // Now stringify the normalized object - guaranteed to be consistent
    // for equivalent input objects regardless of property order or null/undefined values
    return JSON.stringify(normalized);
    
    // Real-world example:
    // key({type: "search", query: "naruto", userId: null}) 
    // key({userId: undefined, query: "naruto", type: "search"})
    // Both become: '{"query":"naruto","type":"search","userId":""}'
  }

  structuredKey(scope, type, id, meta = {}) {
    // ==============================================
    // STRUCTURED CACHE KEY BUILDER
    // ==============================================
    
    // This is our "fancy" key builder for when we need more organization than just strings
    // It creates consistent, hierarchical cache keys that make sense across the app
    //
    // The double-underscore prefix (__scope, __type, __id) ensures these core fields
    // always come first in the sorted key, making cache keys more readable and debuggable
    //
    // Example usage patterns:
    // structuredKey('anilist', 'user', 12345, {includeStats: true})
    // → '{"__id":"12345","__scope":"anilist","__type":"user","includeStats":true}'
    //
    // structuredKey('mal', 'anime', 'attack-on-titan', {lang: 'en', detailed: false})
    // → '{"__id":"attack-on-titan","__scope":"mal","__type":"anime","detailed":false,"lang":"en"}'
    
    return this.key({ 
      __scope: scope,      // Which API or data source (anilist, mal, simkl)
      __type: type,        // What kind of data (user, anime, search, etc.)
      __id: String(id),    // The specific identifier (always stringify for consistency)
      ...meta             // Any additional parameters that affect the data
    });
    
    // Why this approach rocks:
    // 1. Consistent structure across all cache keys
    // 2. Easy to debug - you can immediately tell what a key represents
    // 3. The meta object lets us include request parameters that affect the result
    //    (like language, detail level, date ranges, etc.)
    // 4. String(id) prevents issues with numeric vs string IDs from different APIs
  }

  compositeScope(scope, source) {
    // ==============================================
    // SCOPE NAMESPACE BUILDER
    // ==============================================
    
    // Simple but crucial helper for building hierarchical cache namespaces
    // This lets us create multi-level scoping when we need more organization
    
    // If no source is provided, just return the base scope as-is
    // Handles cases where we're working with simple, single-level scopes
    if (!source) return scope;
    
    // Create a composite namespace by combining source and scope
    // This gives us flexible cache organization like:
    // 
    // compositeScope('userData', 'anilist') → 'anilist:userData'
    // compositeScope('search', 'mal') → 'mal:search'
    // compositeScope('trending', 'simkl') → 'simkl:trending'
    //
    // Super useful when the same logical scope (like 'userData') needs to be
    // kept separate across different APIs or data sources. Without this,
    // we'd risk cache collisions where AniList user data overwrites MAL user data
    return `${source}:${scope}`;
    
    // This pattern also makes cache debugging way easier - you can immediately tell
    // which API a cached entry came from just by looking at the scope prefix
}

  parseCompositeScope(compositeScope) {
    // ==============================================
    // SCOPE NAMESPACE PARSER
    // ==============================================
    
    // This is the reverse of compositeScope() - breaks apart namespaced scopes
    // back into their component parts so we can work with them individually
    
    // Split on colons to get potential source and scope parts
    // Need to handle cases like 'anilist:user:favorites' where there are multiple colons
    const parts = compositeScope.split(':');
    
    // Check if this looks like a properly namespaced scope:
    // 1. Must have at least 2 parts (source + scope)
    // 2. First part must be one of our known API sources
    if (parts.length >= 2 && this.apiSources.includes(parts[0])) {
      return { 
        source: parts[0],                    // Extract the API source (anilist, mal, simkl)
        scope: parts.slice(1).join(':')      // Rejoin the rest as the actual scope
      };
    }
    
    // If it doesn't match our namespacing pattern, treat it as a simple scope
    // This handles legacy cache keys or manually created scopes that don't follow
    // the source:scope convention
    return { 
      source: null, 
      scope: compositeScope    // Return the original string unchanged
    };
    
    // Examples of what this handles:
    // parseCompositeScope('anilist:userData') → {source: 'anilist', scope: 'userData'}
    // parseCompositeScope('mal:user:favorites') → {source: 'mal', scope: 'user:favorites'}
    // parseCompositeScope('simkl:trending:anime') → {source: 'simkl', scope: 'trending:anime'}
    // parseCompositeScope('customScope') → {source: null, scope: 'customScope'}
    // parseCompositeScope('unknown:scope') → {source: null, scope: 'unknown:scope'}
}

  getStore(scope, source = null) {
    // ==============================================
    // INTELLIGENT STORE LOOKUP
    // ==============================================
    
    // Build the full namespaced scope (like 'anilist:userData')
    // If source is null, this just returns the original scope
    const compositeScope = this.compositeScope(scope, source);
    
    // Try to find the store using our fallback strategy:
    // 1. First, look for the API-specific store (e.g., 'anilist:userData')
    // 2. If that doesn't exist, fall back to the general store (e.g., 'userData')
    //
    // This is super handy because it means:
    // - getStore('userData', 'anilist') → tries 'anilist:userData', then 'userData'
    // - getStore('userData') → just looks for 'userData'
    //
    // The fallback is crucial for backwards compatibility and cross-API operations
    // Sometimes you want API-specific data, sometimes you want the merged/general data
    return this.stores[compositeScope] || this.stores[scope];
    
    // Real-world scenarios where this shines:
    // 1. Looking for user data from a specific API but willing to accept general user data
    // 2. Migrating from non-namespaced to namespaced storage without breaking everything
    // 3. Graceful degradation when API-specific stores haven't been created yet
    //
    // Note: Returns undefined if neither store exists, which is expected behavior
    // The calling code should handle that case appropriately
}

  getTTL(scope, source = null, customTtl = null) {
    // ==============================================
    // TTL RESOLUTION WITH PRIORITY CASCADE
    // ==============================================
    
    // Highest priority: explicit custom TTL passed by the caller
    // This lets specific cache operations override default behavior when needed
    // Example: "I know this search result changes hourly, cache it for 1 hour regardless of defaults"
    if (customTtl !== null) return customTtl;
    
    // Build the composite scope for API-specific TTL lookup
    const compositeScope = this.compositeScope(scope, source);
    
    // Priority cascade for finding the right TTL:
    // 1. API-specific TTL (e.g., 'anilist:userData' might expire faster than general userData)
    // 2. General scope TTL (e.g., 'userData' has a default expiration)
    // 3. Universal fallback of 5 minutes (safe default that's not too aggressive)
    return this.ttlMap[compositeScope] || this.ttlMap[scope] || 5 * 60 * 1000;
    
    // Why this cascade matters in practice:
    // - Some APIs might have rate limits that require longer caching
    // - Different APIs might have different data freshness requirements
    // - The 5-minute fallback prevents infinite caching if config is missing
    // - Custom TTLs let you handle edge cases without changing global defaults
    //
    // Example scenarios:
    // getTTL('searchResults', 'anilist', 60000) → returns 60000 (1 minute custom)
    // getTTL('userData', 'anilist') → checks 'anilist:userData', then 'userData', then 5min
    // getTTL('randomScope') → defaults to 5 minutes (safe fallback)
}

  isExpired(entry, scope, source = null, customTtl = null) {
    // ==============================================
    // CACHE EXPIRATION CHECK WITH TTL HIERARCHY
    // ==============================================
    
    // Figure out which TTL to use with this priority order:
    // 1. customTtl passed to this method (highest priority - "check with this specific TTL")
    // 2. entry.customTtl stored with the cache entry (per-entry override)
    // 3. getTTL() cascade (scope-based defaults)
    //
    // The nullish coalescing (??) is perfect here because it only falls through
    // on null/undefined, not on 0 (which would be a valid "never expire" TTL)
    const ttl = customTtl ?? entry.customTtl ?? this.getTTL(scope, source);
    
    // Simple age check: current time minus when we stored it vs the TTL
    // Returns true if the entry is stale and should be refreshed
    return (Date.now() - entry.timestamp) > ttl;
    
    // Why this hierarchy matters:
    // - Some individual cache entries might need special expiration rules
    //   (like "this user's profile changes daily" vs the general 30-minute rule)
    // - Method-level customTtl lets you do ad-hoc freshness checks
    //   ("is this data fresh enough for a critical operation?")
    // - Falls back gracefully to scope-based defaults for normal operations
    //
    // Real-world examples:
    // isExpired(entry, 'userData') → uses scope default (30 minutes)
    // isExpired(entry, 'userData', null, 60000) → "is this fresh within 1 minute?"
    // Entry stored with customTtl: 86400000 → "this specific user updates daily"
}

  compress(data) {
    // ==============================================
    // INTELLIGENT DATA COMPRESSION
    // ==============================================
    
    // First, serialize the data to see how big it actually is
    // We need the string representation anyway for size checking
    const str = JSON.stringify(data);
    
    // Only compress if it's worth the CPU overhead
    // Small data (< 1KB by default) isn't worth compressing because:
    // 1. Compression overhead might make it bigger
    // 2. CPU cost isn't justified for tiny savings
    // 3. Decompression adds latency for small gains
    if (str.length < this.compressionThreshold) {
      return { data, compressed: false };
    }
    
    try {
      // This is where the magic happens - compress the large data
      // We're probably using some form of LZ or deflate compression here
      const compressed = this.simpleCompress(str);
      
      // Track our compression stats for performance monitoring
      // Helps us tune the threshold and see if compression is actually helping
      this.stats.compressions++;
      
      // Return the compressed data with metadata so we know how to handle it later
      // originalSize is super useful for debugging memory usage and compression ratios
      return { 
        data: compressed, 
        compressed: true, 
        originalSize: str.length 
      };
      
    } catch {
      // If compression fails for any reason (corrupted data, out of memory, etc.)
      // gracefully fall back to storing uncompressed data
      // Better to have uncompressed data than no data at all
      return { data, compressed: false };
      
      // Note: We're not logging the error here because compression failures
      // might be common with certain data types, and we don't want to spam logs
    }
}

  decompress(entry) {
    // ==============================================
    // SAFE DATA DECOMPRESSION
    // ==============================================
    
    // Quick exit for uncompressed data - no work needed
    // This handles entries that were too small to compress or had compression disabled
    if (!entry.compressed) return entry.data;
    
    try {
      // Two-step decompression process:
      // 1. Decompress the binary/string data back to JSON string
      // 2. Parse the JSON string back into the original JavaScript object
      return JSON.parse(this.simpleDecompress(entry.data));
      
    } catch {
      // Fallback for when decompression goes wrong
      // This can happen with:
      // - Corrupted compressed data
      // - Version mismatches in compression algorithms
      // - Malformed JSON after decompression
      // - Memory issues during decompression
      //
      // We return the raw compressed data rather than throwing an error
      // It's probably useless, but at least the cache operation doesn't crash
      // The calling code will need to handle getting back compressed gibberish,
      // but that's better than losing the entire cache operation
      return entry.data;
      
      // Note: In a real-world scenario, you might want to log this failure
      // and potentially mark the cache entry for deletion since it's corrupted
      // But we're keeping it simple here and letting the caller deal with bad data
    }
}

  simpleCompress(str) {
    // Making strings safe for URLs and more compact for sharing or storing
    // Doing this in a few steps because each one solves a different problem
    
    // First, handle weird characters that would break URLs
    // encodeURIComponent() fixes spaces, special chars, emojis, etc.
    // Without this, you get mangled text when users paste international characters
    
    // Then convert to base64 to make it more compact 
    // btoa() turns our encoded string into base64 - good for cramming data into URLs
    
    // Finally, make it actually URL-friendly (this part trips people up)
    // Regular base64 uses +, /, and = characters that mess with URLs
    // Browsers think these mean something special, so we replace them:
    // + becomes - (safe in URLs)
    // / becomes _ (also safe)  
    // = gets removed (it's just padding)
    
    // Now we have a clean string that works in query params, localStorage, 
    // or anywhere else without weird encoding problems
    return btoa(encodeURIComponent(str)).replace(/[+/=]/g, m => ({ '+': '-', '/': '_', '=': '' }[m] || m));
}

  simpleDecompress(compressed) {
    // Reverse the URL-safe encoding we did in simpleCompress
    // Need to undo those character replacements first
    // - goes back to +, _ goes back to /
    const restored = compressed.replace(/[-_]/g, m => ({ '-': '+', '_': '/' }[m]));
    
    // Base64 needs proper padding to work, but we stripped the = signs earlier
    // Base64 strings must be divisible by 4, so we calculate how many = to add back
    // This math looks weird but it's the standard way to fix base64 padding
    // If length % 4 is 1, we add 3 equals. If it's 2, we add 2. If it's 3, we add 1.
    const padded = restored + '='.repeat((4 - restored.length % 4) % 4);
    
    // Now we can safely decode the base64 back to the original encoded string
    // Then decodeURIComponent undoes the URL encoding to get back the original text
    // This can throw an error if the compressed string was corrupted, so you might
    // want to wrap this in a try/catch depending on how you're using it
    return decodeURIComponent(atob(padded));
}

  updateIndexes(key, entry, operation = 'set') {
    try {
      // Keys are stored as JSON strings, so we need to parse them to get the metadata
      // This assumes keys have structure like: {"__scope": "posts", "userId": 123, "mediaId": 456, etc}
      const parsed = JSON.parse(key);
      const { __scope: scope, userId, username, mediaId, tags } = parsed;
      
      // Handle deletions first - just remove from all relevant indexes and bail out
      if (operation === 'delete') {
        this.removeFromIndexes(key, { userId, username, mediaId, tags });
        return;
      }

      // === USER INDEX ===
      // Keep track of all entries for each user so we can quickly find "all posts by user X"
      // Use either userId or username as the lookup key (prefer userId if both exist)
      if (userId || username) {
        const userKey = userId || username;
        if (!this.indexes.byUser.has(userKey)) this.indexes.byUser.set(userKey, new Set());
        this.indexes.byUser.get(userKey).add(key);
      }

      // === MEDIA INDEX === 
      // Track which entries reference each piece of media
      // Useful for finding "all comments on this video" or similar
      if (mediaId) {
        if (!this.indexes.byMedia.has(mediaId)) this.indexes.byMedia.set(mediaId, new Set());
        this.indexes.byMedia.get(mediaId).add(key);
      }

      // === TAG INDEX ===
      // Let users find entries by tags - each tag points to a set of keys that have it
      // Tags come as an array, so we add this key to every tag's index
      if (tags && Array.isArray(tags)) {
        tags.forEach(tag => {
          if (!this.indexes.byTag.has(tag)) this.indexes.byTag.set(tag, new Set());
          this.indexes.byTag.get(tag).add(key);
        });
      }
    } catch {
      // If JSON parsing fails, just ignore this key - probably corrupted or wrong format
      // Silent failure here because index updates shouldn't break the main operation
    }
}

  removeFromIndexes(key, { userId, username, mediaId, tags }) {
    // === CLEAN UP USER INDEX ===
    // Remove this key from the user's set of entries
    const userKey = userId || username;
    if (userKey && this.indexes.byUser.has(userKey)) {
      this.indexes.byUser.get(userKey).delete(key);
      // If this was the last entry for this user, remove the user entirely
      // Prevents memory leaks from accumulating empty sets over time
      if (this.indexes.byUser.get(userKey).size === 0) this.indexes.byUser.delete(userKey);
    }

    // === CLEAN UP MEDIA INDEX ===
    // Same deal - remove the key from this media's entry list
    if (mediaId && this.indexes.byMedia.has(mediaId)) {
      this.indexes.byMedia.get(mediaId).delete(key);
      // Delete the whole media entry if no keys reference it anymore
      if (this.indexes.byMedia.get(mediaId).size === 0) this.indexes.byMedia.delete(mediaId);
    }

    // === CLEAN UP TAG INDEXES ===
    // Go through each tag and remove this key from its set
    if (tags && Array.isArray(tags)) {
      tags.forEach(tag => {
        if (this.indexes.byTag.has(tag)) {
          this.indexes.byTag.get(tag).delete(key);
          // Remove unused tags to keep the index lean
          // Important for systems with lots of one-off tags
          if (this.indexes.byTag.get(tag).size === 0) this.indexes.byTag.delete(tag);
        }
      });
    }
}

  enforceSize(scope, source = null) {
    // Get the specific store we're working with
    const store = this.getStore(scope, source);
    if (!store || store.size <= this.maxSize) return 0;

    // We're over the limit, time to kick some entries out
    // Build a list of everything with their last access times so we can decide what to evict
    // Entries that haven't been accessed get a lastAccess of 0 (oldest possible)
    const entries = Array.from(store.entries())
      .map(([key, entry]) => ({ key, entry, lastAccess: this.accessLog.get(key) || 0 }))
      .sort((a, b) => a.lastAccess - b.lastAccess); // Oldest stuff first

    // Figure out how many entries to remove
    // We remove a bit extra (batchSize) so we don't have to do this constantly
    // Like cleaning your room - better to do it thoroughly than clean one item at a time
    const toEvict = entries.slice(0, store.size - this.maxSize + this.batchSize);
    
    // Actually remove the entries and clean up all the related data
    toEvict.forEach(({ key }) => {
      store.delete(key);                              // Remove from main storage
      this.updateIndexes(key, null, 'delete');       // Clean up all the lookup indexes  
      this.accessLog.delete(key);                     // Remove from access tracking
      this.stats.evictions++;                        // Keep count for monitoring
    });

    // Something changed, so we should save to disk soon
    this.schedulePersistence();
    return toEvict.length;
}

  get(key, options = {}) {
    const { scope = 'userData', source = null, ttl = null, refreshCallback = null } = options;
    const store = this.getStore(scope, source);
    
    // No store means we can't find anything - probably a config issue
    if (!store) { 
      this.stats.misses++; 
      return null; 
    }

    // Convert objects to string keys if needed (consistent with how we store them)
    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    const entry = store.get(cacheKey);
    
    // Always update access time, even for misses - helps with debugging timing issues
    this.accessLog.set(cacheKey, Date.now());
    
    // === CACHE MISS ===
    if (!entry) {
      this.stats.misses++;
      this.log('MISS', this.compositeScope(scope, source), cacheKey);
      // Try to fetch fresh data if we have a way to do it
      this.maybeRefresh(cacheKey, scope, source, refreshCallback);
      return null;
    }

    // === EXPIRY CHECK ===
    // Even if we have the entry, it might be too old to use
    if (this.isExpired(entry, scope, source, ttl)) {
      // Clean up the stale entry completely - don't leave garbage around
      store.delete(cacheKey);
      this.updateIndexes(cacheKey, entry, 'delete');
      this.stats.misses++;
      this.log('EXPIRED', this.compositeScope(scope, source), cacheKey);
      // Try to get fresh data since the old stuff is useless
      this.maybeRefresh(cacheKey, scope, source, refreshCallback);
      this.schedulePersistence(); // Save the deletion
      return null;
    }

    // === CACHE HIT ===
    this.stats.hits++;
    const age = Math.round((Date.now() - entry.timestamp) / 1000);
    this.log('HIT', this.compositeScope(scope, source), cacheKey, `${age}s old`);
    
    // Check if we should refresh in the background while still returning cached data
    // This is "refresh-ahead" - keeps cache warm without making users wait
    if (this.shouldRefresh(entry, scope, source, ttl)) {
      const callbackKey = `${this.compositeScope(scope, source)}:${cacheKey}`;
      const callback = this.refreshCallbacks.get(callbackKey);
      if (callback) this.scheduleRefresh(cacheKey, scope, source, callback);
    }

    // Decompress and return the actual data
    return this.decompress(entry);
}

  set(key, value, options = {}) {
    const { scope = 'userData', source = null, ttl = null, tags = [], refreshCallback = null } = options;
    const store = this.getStore(scope, source);
    
    // Can't store anything if we don't have a valid store
    if (!store) return false;

    // Make sure we're using consistent key format
    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    
    // Compress the value to save memory and storage space
    // This is especially important for large objects or repeated data
    const compressed = this.compress(value);
    
    // Build the cache entry with all the metadata we need
    const entry = {
      ...compressed,                    // The actual compressed data
      timestamp: Date.now(),            // When this was stored (for TTL calculations)
      customTtl: ttl,                   // Custom expiry override if provided
      tags,                             // Tags for categorization and bulk operations
      accessCount: 1,                   // Start at 1 since we're "accessing" it by setting it
      source: source                    // Track where this came from for debugging
    };

    // Actually store the entry
    store.set(cacheKey, entry);
    
    // Update all our lookup indexes so we can find this entry later
    this.updateIndexes(cacheKey, entry);
    
    // Check if we're over the size limit and evict old entries if needed
    // Do this after adding so we don't immediately evict what we just added
    this.enforceSize(scope, source);
    
    // Keep stats for monitoring cache performance
    this.stats.sets++;
    this.log('SET', this.compositeScope(scope, source), cacheKey, store.size);

    // Store the refresh callback if provided - this lets us update the cache automatically later
    if (refreshCallback) {
      const callbackKey = `${this.compositeScope(scope, source)}:${cacheKey}`;
      this.refreshCallbacks.set(callbackKey, refreshCallback);
    }

    // Schedule saving to disk (immediate = true means higher priority)
    this.schedulePersistence(true);
    return true;
}

  delete(key, options = {}) {
    const { scope = 'userData', source = null } = options;
    const store = this.getStore(scope, source);
    
    // Can't delete from a store that doesn't exist
    if (!store) return false;

    // Convert to consistent key format
    const cacheKey = typeof key === 'object' ? this.key(key) : key;
    
    // Grab the entry before deleting it - we need this for cleaning up indexes
    const entry = store.get(cacheKey);
    
    // Try to delete from the main store
    const deleted = store.delete(cacheKey);
    
    // Only do cleanup work if the deletion actually happened
    if (deleted) {
      // Clean up all the index references to this key
      // Need the original entry data to know which indexes to clean
      this.updateIndexes(cacheKey, entry, 'delete');
      
      // Remove from access tracking - no point tracking access to deleted entries
      this.accessLog.delete(cacheKey);
      
      // Update stats for monitoring
      this.stats.deletes++;
      this.log('DELETE', this.compositeScope(scope, source), cacheKey);
      
      // Save the changes to disk eventually
      this.schedulePersistence();
    }
    
    return deleted; // true if something was actually deleted, false otherwise
}

  invalidateByUser(userKey, options = {}) {
    const { source = null } = options;
    
    // Look up all the keys associated with this user
    const keys = this.indexes.byUser.get(userKey);
    if (!keys) return 0; // User doesn't exist in our indexes

    let deleted = 0;
    
    // Figure out which stores to search through
    // If source is specified, only look in stores for that source (like "twitter:")
    // Otherwise, search all stores - this is for when a user gets banned/deleted everywhere
    const storesToSearch = source ? 
      Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`)) :
      Object.entries(this.stores);

    // Go through each key that belongs to this user
    keys.forEach(key => {
      // Try to delete this key from each relevant store
      // Same key might exist in multiple stores (different scopes)
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      
      // Clean up access tracking for this key
      this.accessLog.delete(key);
    });

    // If we're doing a full invalidation (no specific source), 
    // remove the user from the index entirely since all their entries are gone
    // If it's source-specific, leave the user index alone - they might have data in other sources
    if (!source) {
      this.indexes.byUser.delete(userKey);
    }
    
    this.log('INVALIDATE_USER', source || 'all', userKey, `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
}

  invalidateByMedia(mediaId, options = {}) {
    const { source = null } = options;
    
    // Find all cache entries related to this piece of media
    // Convert to string since mediaIds might come in as numbers but we store them as strings
    const keys = this.indexes.byMedia.get(String(mediaId));
    if (!keys) return 0; // No cached data for this media

    let deleted = 0;
    
    // Same store filtering logic as invalidateByUser
    // Either target a specific source or hit all stores if doing a full cleanup
    const storesToSearch = source ? 
      Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`)) :
      Object.entries(this.stores);

    // Remove all entries that reference this media
    // This could be comments, reactions, metadata, thumbnails, etc.
    keys.forEach(key => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      
      // Clean up access tracking
      this.accessLog.delete(key);
    });

    // If doing a complete invalidation, remove the media from our index
    // Otherwise keep it around since there might be data in other sources
    if (!source) {
      this.indexes.byMedia.delete(String(mediaId));
    }
    
    this.log('INVALIDATE_MEDIA', source || 'all', String(mediaId), `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
}

  invalidateByTag(tag, options = {}) {
    const { source = null } = options;
    
    // Look up all entries that have this specific tag
    const keys = this.indexes.byTag.get(tag);
    if (!keys) return 0; // No entries with this tag

    let deleted = 0;
    
    // Same filtering pattern as the other invalidate methods
    // Target specific source stores or clean everything if no source specified
    const storesToSearch = source ? 
      Object.entries(this.stores).filter(([scopeName]) => scopeName.startsWith(`${source}:`)) :
      Object.entries(this.stores);

    // Delete all entries that were tagged with this tag
    // Useful for things like clearing all "NSFW" content or removing a banned hashtag
    keys.forEach(key => {
      storesToSearch.forEach(([, store]) => {
        if (store.delete(key)) deleted++;
      });
      
      // Clean up access logs
      this.accessLog.delete(key);
    });

    // Remove the tag from our index if we're doing a complete wipe
    // Leave it alone for source-specific cleanups since the tag might exist elsewhere
    if (!source) {
      this.indexes.byTag.delete(tag);
    }
    
    this.log('INVALIDATE_TAG', source || 'all', tag, `${deleted} entries`);
    this.schedulePersistence();
    return deleted;
}

  clearBySource(source) {
    let total = 0;
    
    // === CLEAR MAIN STORES ===
    // Find all stores that belong to this source and wipe them completely
    // Store names are like "twitter:posts", "reddit:comments", etc.
    Object.entries(this.stores).forEach(([scopeName, store]) => {
      if (scopeName.startsWith(`${source}:`)) {
        total += store.size;
        store.clear(); // Nuclear option - everything goes
      }
    });
    
    // === CLEAN UP INDEXES ===
    // This is trickier - we need to remove source-specific keys from shared indexes
    // The indexes contain keys from multiple sources, so we can't just clear them
    Object.values(this.indexes).forEach(index => {
      for (const [key, keySet] of index.entries()) {
        // Filter out keys that belong to the source we're clearing
        const filteredKeys = Array.from(keySet).filter(cacheKey => {
          try {
            // Parse the cache key to check its source
            const parsed = JSON.parse(cacheKey);
            return parsed.__source !== source; // Keep keys NOT from this source
          } catch {
            // If parsing fails, keep the key - better safe than sorry
            return true;
          }
        });
        
        // If no keys left for this index entry, remove it entirely
        if (filteredKeys.length === 0) {
          index.delete(key);
        } 
        // If some keys were removed, update the set with what's left
        else if (filteredKeys.length !== keySet.size) {
          index.set(key, new Set(filteredKeys));
        }
        // Otherwise nothing changed, leave it alone
      }
    });
    
    this.log('CLEAR_SOURCE', source, '', `${total} entries`);
    this.schedulePersistence();
    return total;
}

  clear(scope = null) {
    // === SINGLE SCOPE CLEAR ===
    // If a specific scope is provided, just clear that one store
    if (scope) {
      const store = this.stores[scope];
      if (!store) return 0; // Scope doesn't exist, nothing to clear
      
      const count = store.size;
      store.clear(); // Wipe everything in this scope
      this.schedulePersistence(); // Save the change
      return count;
    }

    // === NUCLEAR OPTION - CLEAR EVERYTHING ===
    // No scope means clear the entire cache system
    let total = 0;
    
    // Wipe all stores completely
    Object.values(this.stores).forEach(store => {
      total += store.size;
      store.clear();
    });
    
    // Clear all the lookup indexes - no point keeping them around with empty stores
    Object.values(this.indexes).forEach(index => index.clear());
    
    // Clear access tracking - useless without any cached entries
    this.accessLog.clear();
    
    // Clear refresh callbacks - can't refresh entries that don't exist
    this.refreshCallbacks.clear();
    
    this.log('CLEAR_ALL', 'all', '', total);
    this.schedulePersistence(); // Save the nuclear reset
    return total;
}

  pruneExpired(scope = null, source = null) {
    // Figure out which scopes to check - either the one specified or all the main ones
    const scopesToPrune = scope ? [scope] : ['userData', 'mediaData', 'searchResults'];
    
    // Same for sources - check the specified one or check all known sources plus null
    const sourcesToPrune = source ? [source] : [null, ...this.apiSources];
    
    let total = 0;
    const now = Date.now(); // Not used but good for debugging if needed later

    // Go through every combination of scope and source
    scopesToPrune.forEach(currentScope => {
      sourcesToPrune.forEach(currentSource => {
        const store = this.getStore(currentScope, currentSource);
        if (!store) return; // Skip if this combination doesn't exist

        // First pass: find all the expired entries
        // We do this in two passes to avoid modifying the Map while iterating over it
        // That can cause weird bugs and missed entries
        const toDelete = [];
        for (const [key, entry] of store.entries()) {
          if (this.isExpired(entry, currentScope, currentSource)) {
            toDelete.push(key);
          }
        }

        // Second pass: actually delete the expired entries
        // Clean up everything properly just like a normal delete
        toDelete.forEach(key => {
          const entry = store.get(key); // Get entry data for index cleanup
          store.delete(key);                           // Remove from main store
          this.updateIndexes(key, entry, 'delete');   // Clean up lookup indexes
          this.accessLog.delete(key);                 // Remove from access tracking
          total++;
        });
      });
    });

    // Only bother saving if we actually deleted something
    if (total > 0) {
      this.schedulePersistence();
    }
    
    return total; // Tell caller how much junk we cleaned up
}

  shouldRefresh(entry, scope, source = null, customTtl = null) {
    // Background refresh might be disabled to save resources or during maintenance
    if (!this.flags.backgroundRefresh) return false;
    
    // Get the TTL for this entry (could be custom, scope-specific, or default)
    const ttl = this.getTTL(scope, source, customTtl);
    
    // The magic number: refresh when we're 80% of the way to expiration
    // This keeps the cache warm without hammering the API too much
    // Users get fast responses because we refresh before entries actually expire
    // The 20% buffer gives us time to fetch new data before the old data becomes stale
    return (Date.now() - entry.timestamp) > (ttl * 0.8);
}

  maybeRefresh(key, scope, source, callback) {
    // Only try to refresh if we actually have a way to get fresh data
    // No point scheduling a refresh if we don't know how to fetch the data
    if (callback && typeof callback === 'function') {
      this.scheduleRefresh(key, scope, source, callback);
    }
    // If no callback, we just silently do nothing - the cache miss/expiry already happened
    // and the caller will need to handle getting fresh data themselves
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