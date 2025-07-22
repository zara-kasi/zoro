// Obsidian API
  const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');
  
// Default Setting
  const DEFAULT_SETTINGS = {
  defaultUsername: '',
  defaultLayout: 'card',
  defaultSortField: '',
  defaultSortDir:   '', 
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  gridColumns: 2,
  theme: '',  
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: '',
};

//Sort
  const SORT_FIELDS = {
  title:        { label: 'Title' },
  startDate:    { label: 'Release Date' },
  completedAt:  { label: 'Completed At' },
  updatedAt:    { label: 'Recently Updated' },
  score:        { label: 'User Score' },
  popularity:   { label: 'Popularity' },
  trending:     { label: 'Trending' },
  favourites:   { label: 'Favorites' }
};
  const ANILIST_SEARCH_SORT_MAP = {
  title:       'TITLE_ROMAJI',
  startDate:   'START_DATE',
  updatedAt:   'UPDATED_AT',
  score:       'SCORE',
  popularity:  'POPULARITY',
  trending:    'TRENDING',
  favourites:  'FAVOURITES'
};
  function sortEntries(entries, { field = '', dir = '' } = {}) {
   if (field === '') return entries;
  const d = dir === 'desc' ? -1 : 1;
  const key = (e) => {
  const m = e.media || e;
    switch (field) {
      case 'title':       return (m.title?.english || m.title?.romaji || '').toLowerCase();
      case 'startDate':   return m.startDate?.year || 0;
      case 'completedAt': return e.completedAt?.year || 0;
      case 'updatedAt':   return e.updatedAt || 0;
      case 'score':       return e.score ?? -1;
      case 'popularity':  return m.popularity ?? 0;
      case 'trending':    return m.trending ?? 0;
      case 'favourites':  return m.favourites ?? 0;
      default:            return m.id || 0;
    }
  };
  return [...entries].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka < kb) return -d;
    if (ka > kb) return  d;
    const ta = (a.media?.title?.english || a.media?.title?.romaji || '').toLowerCase();
    const tb = (b.media?.title?.english || b.media?.title?.romaji || '').toLowerCase();
    if (ta < tb) return -1;
    if (ta > tb) return  1;
    return (a.media?.id || 0) - (b.media?.id || 0);
  });
}
// Request Queue
 class RequestQueue {
  constructor() {
    this.queue = [];
    this.delay = 700; // ~85 requests/min (AniList limit: 90/min)
    this.isProcessing = false;
  } add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  }
  async process() {
  if (this.isProcessing || !this.queue.length) return;
  this.isProcessing = true;
  const { requestFn, resolve, reject } = this.queue.shift(); // ✅ Fixed: Get reject from queue
  const loader = document.createElement('div');
loader.textContent = '⏳';
loader.style.cssText = 'position:fixed;bottom:10px;left:10px;font-size:16px;z-index:9999;';
document.body.appendChild(loader);

try {
  const result = await requestFn();
  resolve(result);
} catch (err) {
  reject(err);  
} finally {
  document.body.removeChild(loader); // Remove loading indicator
  setTimeout(() => {
    this.isProcessing = false;
    this.process();
  }, this.delay);
}
}
}
// API 
class Api {
  constructor(plugin) {
    this.plugin = plugin;
    this.requestQueue = plugin.requestQueue;
    this.cache = plugin.cache;
    this.cacheTimeout = plugin.cacheTimeout;
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
  async fetchZoroData(config) {
    const cacheKey = JSON.stringify(config);
    let cacheType;
    // Determine cache type based on request
    if (config.type === 'stats') {
      cacheType = 'userData';
    } else if (config.type === 'single') {
      cacheType = 'mediaData';
    } else if (config.type === 'search') {
      cacheType = 'searchResults';
    } else {
      cacheType = 'userData'; // Default for lists
    }
    const cached = this.plugin.getFromCache(cacheType, cacheKey);
    if (cached) return cached;

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
      // Build query and variables based on config type
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
          sort: config.sortOptions?.anilistSort ? [config.sortOptions.anilistSort] : null,
        };
      } else {
        query = this.getMediaListQuery(config.layout);
        variables = {
          username: config.username,
          status: config.listType,
          type: config.mediaType || 'ANIME',
          sort: config.sortOptions?.anilistSort ? [config.sortOptions.anilistSort] : null,
        };
      }
      // Make the GraphQL request with rate limiting
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
      // Save to cache
      this.plugin.setToCache(cacheType, cacheKey, result.data);
      return result.data;

    } catch (error) {
      console.error('[Zoro] fetchZoroData() failed:', error);
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
      this.plugin.clearCacheForMedia(mediaId);
      
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
      
     const response = await this.fetchZoroData(config);
      return response.MediaList !== null;
    } catch (error) {
      console.warn('Error checking media list status:', error);
      return false;
    }
  }
  async addMediaToList(mediaId, updates, mediaType) {
    if (!this.plugin.settings.accessToken) {
      throw new Error('Authentication required');
    }
    return await this.updateMediaListEntry(mediaId, updates);
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
      `
    };

    const fields = mediaFields[layout] || mediaFields.card;

    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType, $sort: [MediaListSort]) {
        MediaListCollection(userName: $username, status: $status, type: $type, sort: $sort) {
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
    const typeKey = mediaType.toLowerCase(); // 'anime' or 'manga'

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
      `
    };

    const fields = mediaFields[layout] || mediaFields.card;

    return `
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int, $sort: [MediaSort]) {
        Page(page: $page, perPage: $perPage) {
          media(search: $search, type: $type, sort: $sort) {
            ${fields}
          }
        }
      }
    `;
  }
  getZoroUrl(mediaId, mediaType = 'ANIME') {
    if (!mediaId || typeof mediaId !== 'number') {
      throw new Error(`Invalid mediaId: ${mediaId}`);
    }

    const type = String(mediaType).toUpperCase();
    const validTypes = ['ANIME', 'MANGA'];
    const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime'; // fallback

    return `https://anilist.co/${urlType}/${mediaId}`;
  }
}
// Plugin
class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
  // Initialize separate caches
  this.cache = {
    userData: new Map(),
    mediaData: new Map(),
    searchResults: new Map() 
  };
    this.requestQueue = new RequestQueue();
    this.cacheTimeout = 4 * 60 * 1000; // 4 min
// Add periodic pruning
  this.pruneInterval = setInterval(() => this.pruneCache(), this.cacheTimeout);
  this.api = new Api(this);
    this.auth = new Authentication(this);
    this.theme = new Theme(this);
    this.processor = new Processor(this);
    this.edit = new Edit(this);
    this.export = new Export(this);
    this.sample = new Sample(this);
    this.prompt = new Prompt(this);
  }
getZoroUrl(mediaId, mediaType = 'ANIME') {
  return this.api.getZoroUrl(mediaId, mediaType);
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
// Onload 
  async onload() {
    console.log('[Zoro] Plugin loading...');
    this.render = new Render(this);
    // Load settings
    try {
      await this.loadSettings();
      console.log('[Zoro] Settings loaded.');
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }
    // Inject custom CSS
    try {
      this.injectCSS();
      console.log('[Zoro] CSS injected.');
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }
    // Apply saved theme (if any)
await this.theme.applyTheme(this.settings.theme);

    // Processors
    /// Markdown code block processors
    this.registerMarkdownCodeBlockProcessor('zoro', this.processor.processZoroCodeBlock.bind(this.processor));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processor.processZoroSearchCodeBlock.bind(this.processor));
    /// Process inline links (e.g., [[Zoro:ID]])
    this.registerMarkdownPostProcessor(this.processor.processInlineLinks.bind(this.processor));
    // Add plugin settings tab
    this.addSettingTab(new ZoroSettingTab(this.app, this));
    console.log('[Zoro] Plugin loaded successfully.');
  }
   // Validate Settings 
  validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'list'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : 3,
      theme: typeof settings?.theme === 'string' ? settings.theme : '',
   defaultSortField: (typeof settings?.defaultSortField === 'string' && (settings.defaultSortField === '' || SORT_FIELDS[settings.defaultSortField])) ? settings.defaultSortField : '',

      defaultSortDir:    ['asc','desc',''].includes(settings?.defaultSortDir) ? settings.defaultSortDir : '',
      showCoverImages: !!settings?.showCoverImages,
      showRatings: !!settings?.showRatings,
      showProgress: !!settings?.showProgress,
      showGenres: !!settings?.showGenres,
      clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
      clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
      redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
      accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : '',
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
  // Load settings 
  async loadSettings() {
    const saved = await this.loadData() || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);
   if (!this.settings.clientSecret) {
    const secret = await this.promptForSecret("Paste your client secret:");
    this.settings.clientSecret = secret.trim();
    await this.saveData(this.settings);
  }}
clearCacheForMedia(mediaId) {
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

  handleEditClick(e, entry, statusEl) {
    e.preventDefault();
    e.stopPropagation();

    this.edit.createEditModal(
      entry,
      async updates => {
        try {
          await this.api.updateMediaListEntry(entry.media.id, updates);
          new Notice('✅ Updated!');
 this.cache.userData.clear();
 this.cache.mediaData.clear();
 this.cache.searchResults.clear();

          const parent = statusEl.closest('.zoro-container');
          if (parent) {
            const block = parent.closest('.markdown-rendered')?.querySelector('code');
            if (block) this.processZoroCodeBlock(block.textContent, parent, {});
          }
        } catch (err) {
          new Notice(`❌ Update failed: ${err.message}`);
        }
      },
      () => {
      }
    );
  }

 
  // Inject Css not ok
  injectCSS() {
  const styleId = 'zoro-plugin-styles';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) existingStyle.remove();
  
  const css = `
    .zoro-container { /* styles */ }
    /* add all necessary styles here */
  `;
  
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = css;
  document.head.appendChild(style);
}

// Implement handler
  handleAuthMessage(event) {
  if (event.origin !== 'https://anilist.co') return;
  this.exchangeCodeForToken(event.data.code);
}

  // Render Errors
  renderError(el, message, context = '', onRetry = null) {
    el.empty?.(); // clear if Obsidian's `el` object has `.empty()` method
    el.classList.add('zoro-error-container');

    const wrapper = document.createElement('div');
    wrapper.className = 'zoro-error-box';

    const title = document.createElement('strong');
    title.textContent = `❌ ${context || 'Something went wrong'}`;
    wrapper.appendChild(title);

    const msg = document.createElement('pre');
    msg.textContent = message; // safe, no innerHTML
    wrapper.appendChild(msg);

    // Optional Retry button
    if (this.settings?.accessToken) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = () => {
        // You might re-call the source renderer here
        new Notice('Retry not implemented yet');
      };
      wrapper.appendChild(retryBtn);
    }

    // FIXED: Added onRetry functionality
    if (typeof onRetry === 'function') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = onRetry;
      wrapper.appendChild(retryBtn);
    }

    el.appendChild(wrapper);
  }

 // ---------- inside ZoroPlugin ----------
_buildSortOptions(raw) {
  let field = '', dir = '';

  // 1. Decide the field & dir
  if (!raw || raw.trim() === '') {
    // fall back to global defaults
    field = this.settings.defaultSortField || '';
    dir   = this.settings.defaultSortDir   || '';
  } else {
    // explicit block value
    const [f, d = 'asc'] = raw.split('-', 2);
    field = f.trim();
    dir   = d.trim().toLowerCase();
  }

  // 2. Validate
  if (!SORT_FIELDS[field]) field = '';
  if (!['asc', 'desc', ''].includes(dir)) dir = 'asc';

  if (!field) return { field: '', dir: '', anilistSort: null };

  // 3. Build AniList sort key (list vs search)
  const isSearch = arguments[1]?.type === 'search';
  const map      = isSearch ? ANILIST_SEARCH_SORT_MAP : ANILIST_SORT_MAP;

  const key = map[field];
  if (!key) return { field: '', dir: '', anilistSort: null };

  const suffix = dir === 'desc' ? '_DESC' : '_ASC';
  return { field, dir, anilistSort: key + suffix };
}
  // Plugin unload method
  onunload() {
    console.log('Unloading Zoro Plugin');
   this.theme.removeTheme();
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
      console.log(`Removed style element with ID: ${styleId}`);
       // Clear pruning interval
  if (this.pruneInterval) {
    clearInterval(this.pruneInterval);
  }
      
  // Clear all caches
  this.cache.userData.clear();
  this.cache.mediaData.clear();
  this.cache.searchResults.clear();
      
    }
  }

} 
// Authentication
class Authentication {
  constructor(plugin) {
    this.plugin = plugin;        // gives us access to plugin.settings & requestQueue
  }

  /* ---------- constants ---------- */
  static ANILIST_AUTH_URL  = 'https://anilist.co/api/v2/oauth/authorize';
  static ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
  static REDIRECT_URI      = 'https://anilist.co/api/v2/oauth/pin';

  /* ---------- public getter ---------- */
  get isLoggedIn() {
    return Boolean(this.plugin.settings.accessToken);
  }

  /* ---------- OAuth helpers ---------- */
  async loginWithFlow() {
    // 1. Ensure we have client credentials
    if (!this.plugin.settings.clientId) {
      new Notice('❌ Please enter your Client ID first.', 5000);
      return;
    }

    // 2. Build auth url
    const { clientId } = this.plugin.settings;
    const authUrl =
      `${Authentication.ANILIST_AUTH_URL}?` +
      new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  Authentication.REDIRECT_URI,
        response_type: 'code'
      }).toString();

    // 3. Open browser
    new Notice('🔐 Opening AniList login page…', 3000);
    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }

    // 4. Prompt for pin
    const pin = await this.promptModal('Paste the PIN code from the browser:');
    if (!pin) return;

    // 5. Exchange pin → token
    await this.exchangePin(pin);
  }

  async logout() {
    this.plugin.settings.accessToken  = '';
    this.plugin.settings.tokenExpiry  = 0;
    this.plugin.settings.authUsername = '';
    this.plugin.settings.clientId     = '';
    this.plugin.settings.clientSecret = '';
    await this.plugin.saveSettings();

    // Clear caches
    this.plugin.cache.userData.clear();
    this.plugin.cache.mediaData.clear();
    this.plugin.cache.searchResults.clear();

    new Notice('✅ Logged out & cleared credentials.', 3000);
  }

  /* ---------- internal helpers ---------- */
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

      new Notice('✅ Authenticated successfully!', 4000);
    } catch (err) {
      new Notice(`❌ Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  async promptModal(message) {
    // Simple synchronous prompt (works in Obsidian)
    return new Promise((res) => {
      const val = prompt(message);
      res(val ? val.trim() : null);
    });
  }

  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated');
    return true;
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
    desc.setText('Enter your AniList application Client ID');
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
    
    submitButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    
    cancelButton.addEventListener('click', () => {
      this.close();
    });
    
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
    desc.setText('Enter your AniList application Client Secret');
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
    
    submitButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    
    cancelButton.addEventListener('click', () => {
      this.close();
    });
    
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
    
    submitButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    
    cancelButton.addEventListener('click', () => {
      this.close();
    });
    
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
// Theme
class Theme {
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
// Processor 
class Processor {
  constructor(plugin) {
    this.plugin = plugin;
  }

  // Process Zoro Code Block
  async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source) || {};

      // Debug: Log raw config
      console.log('[Zoro] Code block config:', config);

      // Handle authenticated user resolution
      if (config.useAuthenticatedUser) {
        const authUsername = await this.plugin.auth.getAuthenticatedUsername();
        if (!authUsername) {
          throw new Error('❌ Could not retrieve authenticated username. Check your authentication setup or set a username manually.');
        }
        config.username = authUsername;
      }

      if (!config.username) {
        throw new Error('❌ No username provided. Set `username:` in your code block or enable `useAuthenticatedUser`.');
      }

      const data = await this.plugin.api.fetchZoroData(config);

      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('⚠️ No data returned from Zoro API.');
      }

      if (config.type === 'stats') {
        this.plugin.render.renderUserStats(el, data.User);
      } else if (config.type === 'single') {
        this.plugin.render.renderSingleMedia(el, data.MediaList, config);
      } else {
        const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
        this.plugin.render.renderMediaList(el, entries, config);
      }
      
    } catch (error) {
      console.error('[Zoro] Code block processing error:', error);
      this.plugin.renderError(el, error.message || 'Unknown error occurred.');
    }
  }

  // Process Zoro Search Code Block
  async processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);

      if (this.plugin.settings.debugMode) {
        console.log('[Zoro] Search block config:', config);
      }

      // Show loading placeholder
      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      
      await this.plugin.render.renderSearchInterface(el, config);
    } catch (error) {
      console.error('[Zoro] Search block processing error:', error);
      this.plugin.renderError(el, error.message || 'Failed to process Zoro search block.');
    }
  }

  // Process Inline Links
  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="zoro:"]');

    for (const link of inlineLinks) {
      const href = link.getAttribute('href');
      
      // Optional: Show loading shimmer while data loads
      const placeholder = document.createElement('span');
      placeholder.textContent = '🔄 Loading Zoro...';
      link.replaceWith(placeholder);

      try {
        const config = this.parseInlineLink(href);
        const data = await this.plugin.api.fetchZoroData(config);

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

        // ✅ Cleanup if the block is removed (important for re-render safety)
        ctx.addChild({
          unload: () => {
            container.remove();
          }
        });

      } catch (error) {
        console.warn(`[Zoro] Inline link failed for ${href}:`, error);

        const errorEl = document.createElement('span');
        errorEl.className = 'zoro-inline-error';
        errorEl.textContent = `⚠️ ${error.message || 'Failed to load data'}`;

        placeholder.replaceWith(errorEl);
      }
    }
  }

  // Parse Code Block Config
  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    // Use authenticated user if no username provided and no default username
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
  
    const sortRaw = (config.sort || '').trim();
    if (!sortRaw) {
      // no explicit sort in block → use global defaults
      config.sortOptions = this.plugin._buildSortOptions(
        `${this.plugin.settings.defaultSortField}-${this.plugin.settings.defaultSortDir}`
      );
    } else {
      config.sortOptions = this.plugin._buildSortOptions(sortRaw);
    }
    
    return config;
  }

  // Parse Search Code Block Config
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
    
    // Default to ANIME if no mediaType specified
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.plugin.settings.defaultLayout;
    
    const sortRaw = (config.sort || '').trim();
    if (!sortRaw) {
      config.sortOptions = this.plugin._buildSortOptions(
        `${this.plugin.settings.defaultSortField}-${this.plugin.settings.defaultSortDir}`
      );
    } else {
      config.sortOptions = this.plugin._buildSortOptions(sortRaw);
    }
    
    return config;
  }

  // Parse Inline Link
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
      layout: 'card', // Default layout
      type: 'list'     // Default to media list
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

    // Optional layout modifiers from hash
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
// Render
class Render {
  constructor(plugin) {
    this.plugin = plugin;
  }

  /* ----------  SEARCH  ---------- */
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
      if (term.length < 3) { resultsDiv.innerHTML = '<div class="zoro-search-message">Type at least 3 characters…</div>'; return; }
      try {
        resultsDiv.innerHTML = '<div class="zoro-search-loading">Searching…</div>';
        const data = await this.plugin.api.fetchZoroData({ ...config, search: term, page: 1, perPage: 5 });
        this.renderSearchResults(resultsDiv, data.Page.media, config);
      } catch (e) { this.plugin.renderError(resultsDiv, e.message); }
    };
    input.addEventListener('input', () => { clearTimeout(timeout); timeout = setTimeout(doSearch, 300); });
    input.addEventListener('keypress', e => { if (e.key === 'Enter') doSearch(); });
  }

  renderSearchResults(el, media, config) {
  el.empty();
  if (media.length === 0) {
    el.innerHTML = '<div class="zoro-search-message">No results found.</div>';
    return;
  }

  const sorted = sortEntries(media, config.sortOptions);
  const gridDiv = document.createElement('div');
  gridDiv.className = 'zoro-cards-grid';
  gridDiv.style.setProperty('--zoro-grid-columns', this.plugin.settings.gridColumns);

  sorted.forEach(async (item) => {
    const title = item.title.english || item.title.romaji;

    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-card';

    if (this.plugin.settings.showCoverImages) {
      const img = document.createElement('img');
      img.src = item.coverImage.large;
      img.alt = title;
      img.className = 'media-cover';
      cardDiv.appendChild(img);
    }

    const mediaInfoDiv = document.createElement('div');
    mediaInfoDiv.className = 'media-info';

    const titleElement = document.createElement('h4');
    const titleLink = document.createElement('a');
    titleLink.href = this.plugin.getZoroUrl(item.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link';
    titleLink.textContent = title;
    titleElement.appendChild(titleLink);
    mediaInfoDiv.appendChild(titleElement);

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'media-details';

    if (item.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = item.format;
      detailsDiv.appendChild(formatBadge);
    }

    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${item.status.toLowerCase()}`;
    statusBadge.textContent = item.status;
    detailsDiv.appendChild(statusBadge);

    const addBadge = document.createElement('span');
    addBadge.textContent = 'ADD';
    addBadge.className = 'status-badge status-planning clickable-status';

    addBadge.onclick = async (e) => {
  e.preventDefault();
  e.stopPropagation();
  addBadge.textContent = 'Adding…';
  addBadge.style.pointerEvents = 'none';

  try {
    await this.plugin.api.addMediaToList(item.id, { status: 'PLANNING', progress: 0 }, config.mediaType);
    addBadge.className = 'status-badge status-planning';
    addBadge.textContent = 'PLANNING';
    addBadge.onclick = null;
    new Notice('✅ Added!');
  } catch (err) {
    new Notice(`❌ ${err.message}`);
    addBadge.textContent = 'ADD';
    addBadge.style.pointerEvents = '';
  }
};

    
    detailsDiv.appendChild(addBadge);

    if (this.plugin.settings.showRatings && item.averageScore) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${item.averageScore}`;
      detailsDiv.appendChild(scoreSpan);
    }

    mediaInfoDiv.appendChild(detailsDiv);

    if (this.plugin.settings.showGenres && item.genres) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres';
      item.genres.slice(0, 3).forEach(genre => {
        const genreTag = document.createElement('span');
        genreTag.className = 'genre-tag';
        genreTag.textContent = genre;
        genresDiv.appendChild(genreTag);
      });
      mediaInfoDiv.appendChild(genresDiv);
    }

    cardDiv.appendChild(mediaInfoDiv);
    gridDiv.appendChild(cardDiv);

    
  });

  el.appendChild(gridDiv);
}


  /* ----------  MEDIA LIST  ---------- */
  renderMediaList(el, entries, config) {
    const sorted = sortEntries(entries, config.sortOptions);
    el.empty();
    el.className = 'zoro-container';
    if (config.layout === 'table') {
      this.renderTableLayout(el, sorted, config);
    } else {
      const grid = el.createDiv({ cls: 'zoro-cards-grid' });
      grid.style.setProperty('--zoro-grid-columns', this.plugin.settings.gridColumns);
      sorted.forEach(entry => grid.appendChild(this.createMediaCard(entry, config)));
    }
  }

  renderTableLayout(el, sorted, config) {
    const table = el.createEl('table', { cls: 'zoro-table' });
    const headers = ['Title', 'Format', 'Status'];
    if (this.plugin.settings.showProgress) headers.push('Progress');
    if (this.plugin.settings.showRatings) headers.push('Score');
    if (this.plugin.settings.showGenres) headers.push('Genres');

    table.createTHead().createEl('tr', null, tr => headers.forEach(h => tr.createEl('th', { text: h })));

    const tbody = table.createTBody();
    sorted.forEach(entry => {
      const m = entry.media;
      const tr = tbody.createEl('tr');
      tr.createEl('td', null, td => td.createEl('a', { text: m.title.english || m.title.romaji, href: this.plugin.getZoroUrl(m.id, config.mediaType), cls: 'zoro-title-link', target: '_blank' }));
      tr.createEl('td', { text: m.format || '-' });
      tr.createEl('td', null, td => {
        const s = td.createEl('span', { text: entry.status, cls: `status-badge status-${entry.status.toLowerCase()} clickable-status` });
        s.onclick = e => {   e.preventDefault(); e.stopPropagation();   if (!this.plugin.settings.accessToken) {     this.plugin.prompt.createAuthenticationPrompt();     return;   }   this.plugin.handleEditClick(e, entry, s); };
      });
      if (this.plugin.settings.showProgress) tr.createEl('td', { text: `${entry.progress ?? 0}/${m.episodes ?? m.chapters ?? '?'}` });
      if (this.plugin.settings.showRatings) tr.createEl('td', { text: entry.score != null ? `★ ${entry.score}` : '-' });
      if (this.plugin.settings.showGenres) tr.createEl('td', { text: (m.genres || []).slice(0, 3).join(', ') || '-' });
    });
  }

  /* ----------  SINGLE MEDIA  ---------- */
  renderSingleMedia(el, mediaList, config) {
    const m = mediaList.media;
    el.empty(); el.className = 'zoro-container';
    const card = el.createDiv({ cls: 'zoro-single-card' });

    if (this.plugin.settings.showCoverImages) {
      card.createEl('img', { cls: 'media-cover', attr: { src: m.coverImage.large, alt: m.title.english || m.title.romaji } });
    }
    const info = card.createDiv({ cls: 'media-info' });
    info.createEl('h3', null, h => {
      h.createEl('a', { text: m.title.english || m.title.romaji, href: this.plugin.getZoroUrl(m.id, config.mediaType), cls: 'zoro-title-link', target: '_blank' });
    });

    const details = info.createDiv({ cls: 'media-details' });
    if (m.format) details.createEl('span', { text: m.format, cls: 'format-badge' });
    details.createEl('span', { text: mediaList.status, cls: `status-badge status-${mediaList.status.toLowerCase()}` });
    const status = details.lastChild; // the span we just created
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

  /* ----------  USER STATS  ---------- */
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

  /* ----------  SHARED CARD FACTORY  ---------- */
  createMediaCard(obj, config, isSearch = false) {
    const media = obj.media || obj; // search returns raw media
    const title = media.title.english || media.title.romaji;
    const card = document.createElement('div');
    card.className = 'zoro-card';

    if (this.plugin.settings.showCoverImages && media.coverImage?.large) {
      card.createEl('img', { cls: 'media-cover', attr: { src: media.coverImage.large, alt: title } });
    }

    const info = card.createDiv({ cls: 'media-info' });
    info.createEl('h4', null, h => {
      h.createEl('a', { text: title, href: this.plugin.getZoroUrl(media.id, config.mediaType), cls: 'anilist-title-link', target: '_blank' });
    });

    if (!isSearch) {
      const details = info.createDiv({ cls: 'media-details' });
      if (media.format) details.createEl('span', { text: media.format, cls: 'format-badge' });
      const status = details.createEl('span', { text: obj.status, cls: `status-badge status-${obj.status.toLowerCase()} clickable-status` });
      status.classList.add('clickable-status');
      status.onclick = e => {
  e.preventDefault();
  e.stopPropagation();
  if (!this.plugin.settings.accessToken) {
    this.plugin.prompt.createAuthenticationPrompt();
    return;
  }
  this.plugin.handleEditClick(e, obj, status);
};

      if (this.plugin.settings.showProgress) details.createEl('span', { text: `${obj.progress}/${media.episodes ?? media.chapters ?? '?'}`, cls: 'progress' });
      if (this.plugin.settings.showRatings && obj.score != null) details.createEl('span', { text: `★ ${obj.score}`, cls: 'score' });
    }
    if (this.plugin.settings.showGenres && media.genres?.length) {
      const genres = info.createDiv({ cls: 'genres' });
      media.genres.slice(0, 3).forEach(g => genres.createEl('span', { text: g, cls: 'genre-tag' }));
    }
    return card;
  }

  /* ----------  UTILITIES  ---------- */
  clear(el) { el.empty?.(); }
}
// Edit
class Edit {
  constructor(plugin) {
    this.plugin = plugin;
  }


  createEditModal(entry, onSave, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'zoro-edit-modal';

    const overlay = document.createElement('div');
    overlay.className = 'zoro-modal-overlay';

    const content = document.createElement('div');
    content.className = 'zoro-modal-content';

    const form = document.createElement('form');
    form.className = 'zoro-edit-form';
    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.trySave(entry, onSave, saveBtn, statusSelect, scoreInput, progressInput, modal, escListener);
    };

    const title = document.createElement('h3');
    title.className = 'zoro-modal-title';
    title.textContent = entry.media.title.english || entry.media.title.romaji;

    // --- Status Field ---
    const statusGroup = this.createStatusField(entry);
    const statusSelect = statusGroup.querySelector('.zoro-status-select');

    // --- Score Field ---
    const scoreGroup = this.createScoreField(entry);
    const scoreInput = scoreGroup.querySelector('.zoro-score-input');

    // --- Progress Field ---
    const progressGroup = this.createProgressField(entry);
    const progressInput = progressGroup.querySelector('.zoro-progress-input');

    // --- Quick Buttons ---
    const quickProgressDiv = this.createQuickProgressButtons(entry, progressInput, statusSelect);

    // --- Buttons ---
    const buttonContainer = this.createButtonContainer(entry, onSave, onCancel, modal);
    const saveBtn = buttonContainer.querySelector('.zoro-save-btn');
    const removeBtn = buttonContainer.querySelector('.zoro-remove-btn');

    // Setup remove button functionality
    this.setupRemoveButton(removeBtn, entry, modal);

    form.append(title, statusGroup, scoreGroup, progressGroup, quickProgressDiv, buttonContainer);
    content.appendChild(form);

    modal.append(overlay, content);
    document.body.appendChild(modal);

    // Setup modal interactions
    this.setupModalInteractions(modal, overlay, onCancel);

    // Keyboard accessibility
    const escListener = this.createEscapeListener(onCancel, modal, () => {
      this.trySave(entry, onSave, saveBtn, statusSelect, scoreInput, progressInput, modal, escListener);
    });
    document.addEventListener('keydown', escListener);

    // Get and set favorite status
    this.setFavoriteStatus(entry, buttonContainer.querySelector('.zoro-fav-btn'));
  }

  createStatusField(entry) {
    const statusGroup = document.createElement('div');
    statusGroup.className = 'zoro-form-group zoro-status-group';

    const statusLabel = document.createElement('label');
    statusLabel.className = 'zoro-form-label zoro-status-label';
    statusLabel.textContent = '🧿 Status';
    statusLabel.setAttribute('for', 'zoro-status');

    const statusSelect = document.createElement('select');
    statusSelect.className = 'zoro-form-input zoro-status-select';
    statusSelect.id = 'zoro-status';

    ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].forEach(status => {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      if (status === entry.status) option.selected = true;
      statusSelect.appendChild(option);
    });

    statusGroup.appendChild(statusLabel);
    statusGroup.appendChild(statusSelect);
    return statusGroup;
  }

  createScoreField(entry) {
    const scoreGroup = document.createElement('div');
    scoreGroup.className = 'zoro-form-group zoro-score-group';

    const scoreLabel = document.createElement('label');
    scoreLabel.className = 'zoro-form-label zoro-score-label';
    scoreLabel.textContent = '⭐ Score (0–10)';
    scoreLabel.setAttribute('for', 'zoro-score');

    const scoreInput = document.createElement('input');
    scoreInput.className = 'zoro-form-input zoro-score-input';
    scoreInput.type = 'number';
    scoreInput.id = 'zoro-score';
    scoreInput.min = '0';
    scoreInput.max = '10';
    scoreInput.step = '0.1';
    scoreInput.value = entry.score ?? '';
    scoreInput.placeholder = 'e.g. 8.5';

    scoreGroup.appendChild(scoreLabel);
    scoreGroup.appendChild(scoreInput);
    return scoreGroup;
  }

  createProgressField(entry) {
    const progressGroup = document.createElement('div');
    progressGroup.className = 'zoro-form-group zoro-progress-group';

    const progressLabel = document.createElement('label');
    progressLabel.className = 'zoro-form-label zoro-progress-label';
    progressLabel.textContent = '📊 Progress';
    progressLabel.setAttribute('for', 'zoro-progress');

    const progressInput = document.createElement('input');
    progressInput.className = 'zoro-form-input zoro-progress-input';
    progressInput.type = 'number';
    progressInput.id = 'zoro-progress';
    progressInput.min = '0';
    progressInput.max = entry.media.episodes || entry.media.chapters || 999;
    progressInput.value = entry.progress || 0;
    progressInput.placeholder = 'Progress';

    progressGroup.appendChild(progressLabel);
    progressGroup.appendChild(progressInput);
    return progressGroup;
  }

  createQuickProgressButtons(entry, progressInput, statusSelect) {
    const quickProgressDiv = document.createElement('div');
    quickProgressDiv.className = 'zoro-quick-progress-buttons';

    const plusOneBtn = document.createElement('button');
    plusOneBtn.className = 'zoro-quick-btn zoro-plus-btn';
    plusOneBtn.type = 'button';
    plusOneBtn.textContent = '+1';
    plusOneBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      const max = progressInput.max;
      if (current < max) progressInput.value = current + 1;
    };

    const minusOneBtn = document.createElement('button');
    minusOneBtn.className = 'zoro-quick-btn zoro-minus-btn';
    minusOneBtn.type = 'button';
    minusOneBtn.textContent = '-1';
    minusOneBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      if (current > 0) progressInput.value = current - 1;
    };

    const completeBtn = document.createElement('button');
    completeBtn.className = 'zoro-quick-btn zoro-complete-btn';
    completeBtn.type = 'button';
    completeBtn.textContent = 'Complete';
    completeBtn.onclick = () => {
      progressInput.value = entry.media.episodes || entry.media.chapters || 1;
      statusSelect.value = 'COMPLETED';
    };

    quickProgressDiv.append(plusOneBtn, minusOneBtn, completeBtn);
    return quickProgressDiv;
  }

  createButtonContainer(entry, onSave, onCancel, modal) {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'zoro-modal-buttons';

    // ❤️ Favorite toggle
    const favBtn = document.createElement('button');
    favBtn.className = 'zoro-modal-btn zoro-fav-btn';
    favBtn.type = 'button';
    favBtn.title = 'Toggle Favorite';
    favBtn.textContent = '🤍';

    favBtn.onclick = async () => {
      await this.toggleFavorite(entry, favBtn);
    };

    const saveBtn = document.createElement('button');
    saveBtn.className = 'zoro-modal-btn zoro-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.type = 'submit';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'zoro-modal-btn zoro-remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '🗑️';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-modal-btn zoro-cancel-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };

    buttonContainer.append(removeBtn, favBtn, saveBtn, cancelBtn);
    return buttonContainer;
  }

  setupRemoveButton(removeBtn, entry, modal) {
    removeBtn.onclick = async () => {
      if (!confirm('Remove this entry?')) return;
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
        // close modal & refresh view
        document.body.removeChild(modal);
        this.plugin.clearCacheForMedia(entry.media.id);
        // trigger re-render of the block that owns this entry
        const parentContainer = document.querySelector('.zoro-container');
        if (parentContainer) {
          const block = parentContainer.closest('.markdown-rendered')?.querySelector('code');
          if (block) {
            this.plugin.processZoroCodeBlock(block.textContent, parentContainer, {});
          }
        }
        new Notice('✅ Removed');
      } catch (e) {
        new Notice('❌ Could not remove');
      }
    };
  }

  setupModalInteractions(modal, overlay, onCancel) {
    overlay.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };
  }

  createEscapeListener(onCancel, modal, saveFunction) {
    return function escListener(e) {
      if (e.key === 'Escape') {
        onCancel();
        document.body.removeChild(modal);
        document.removeEventListener('keydown', escListener);
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        saveFunction();
      }
    };
  }

  async setFavoriteStatus(entry, favBtn) {
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
      favBtn.textContent = fav ? '❤️' : '🤍';
      
      // Store the media type for later use
      favBtn.dataset.mediaType = mediaData?.type;
    } catch (e) {
      console.warn('Could not fetch favorite', e);
    }
  }

  async toggleFavorite(entry, favBtn) {
    favBtn.disabled = true;
    favBtn.textContent = '⏳';
    
    try {
      // Use the stored media type, or fall back to detection
      let mediaType = favBtn.dataset.mediaType;
      if (!mediaType) {
        // Fallback detection - check for type field first, then episodes
        mediaType = entry.media.type || (entry.media.episodes ? 'ANIME' : 'MANGA');
      }
      
      const isAnime = mediaType === 'ANIME';
      
      const mutation = `
        mutation ToggleFav($animeId: Int, $mangaId: Int) {
          ToggleFavourite(animeId: $animeId, mangaId: $mangaId) {
            anime {
              nodes {
                id
              }
            }
            manga {
              nodes {
                id
              }
            }
          }
        }`;
        
      // Only include the relevant ID, don't pass null values
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
        console.error('AniList API Error:', res.json.errors);
        throw new Error(res.json.errors[0].message);
      }
      
      // Check if the media is now in favorites by looking at the response
      const toggleResult = res.json.data?.ToggleFavourite;
      let isFav = false;
      
      if (isAnime && toggleResult?.anime?.nodes) {
        isFav = toggleResult.anime.nodes.some(node => node.id === entry.media.id);
      } else if (!isAnime && toggleResult?.manga?.nodes) {
        isFav = toggleResult.manga.nodes.some(node => node.id === entry.media.id);
      }
      
      favBtn.textContent = isFav ? '❤️' : '🤍';
      new Notice(`${isFav ? 'Added to' : 'Removed from'} favorites!`, 3000);
      
    } catch (e) {
      new Notice(`❌ Error: ${e.message || 'Unknown error'}`, 8000);
      console.error('Favorite toggle error:', e);
    } finally {
      favBtn.disabled = false;
    }
  }

  // Save logic
  async trySave(entry, onSave, saveBtn, statusSelect, scoreInput, progressInput, modal, escListener) {
    if (this.saving) return;
    this.saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const scoreVal = parseFloat(scoreInput.value);
    if (scoreInput.value && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
      alert("⚠ Score must be between 0 and 10.");
      this.resetSaveBtn(saveBtn);
      return;
    }

    try {
      await onSave({
        status: statusSelect.value,
        score: scoreInput.value === '' ? null : scoreVal,
        progress: parseInt(progressInput.value) || 0
      });
      document.body.removeChild(modal);
      document.removeEventListener('keydown', escListener);
    } catch (err) {
      alert(`❌ Failed to save: ${err.message}`);
    }

    this.resetSaveBtn(saveBtn);
  }

  resetSaveBtn(saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    this.saving = false;
  }
}
// Prompt
class Prompt {
  constructor(plugin) {
    this.plugin = plugin;
  }

  createAuthenticationPrompt() {
    // Create modal wrapper
    const modal = document.createElement('div');
    modal.className = 'zoro-edit-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Authentication Required');

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'zoro-modal-overlay';

    // Modal content container
    const content = document.createElement('div');
    content.className = 'zoro-modal-content auth-prompt';

    // Title
    const title = document.createElement('h3');
    title.className = 'zoro-auth-title';
    title.textContent = '🔐 Authentication Required';

    // Message
    const message = document.createElement('p');
    message.className = 'zoro-auth-message';
    
    message.textContent = 'You need to authenticate with AniList to edit your anime/manga entries. This will allow you to update your progress, scores, and status directly from Obsidian.';

    // Feature list
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

    // Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'zoro-modal-buttons';

    const authenticateBtn = document.createElement('button');
    authenticateBtn.className = 'zoro-auth-button';
    
    authenticateBtn.textContent = '🔑 Authenticate';
    authenticateBtn.onclick = () => {
      closeModal();
      this.plugin.app.setting.open();
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
      new Notice('📝 Please use optional login to authenticate');
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-cancel-button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => closeModal();

    buttonContainer.appendChild(authenticateBtn);
    buttonContainer.appendChild(cancelBtn);

    // Build modal
    content.appendChild(title);
    content.appendChild(message);
    content.appendChild(featuresDiv);
    content.appendChild(buttonContainer);

    modal.appendChild(overlay);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Focus and Esc key handling
    authenticateBtn.focus();
    document.addEventListener('keydown', handleKeyDown);

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
// Export
class Export {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async exportUnifiedListsToCSV() {
    // decide which username to use
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
          this.csvEscape(this.plugin.getZoroUrl(m.id, m.type))
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

  /* ---------- helpers ---------- */
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
}
// Sample
class Sample {
  constructor(plugin) {
    this.plugin = plugin;
  }
  async createSampleNotes() {
    try {
      let successCount = 0;
      const errorMessages = [];

      const firstNoteTitle  = 'Anime Dashboard';
      const firstNoteContent = `\`\`\`zoro-search
mediaType: ANIME
\`\`\`

# 👀 Watching:
\`\`\`zoro
listType: CURRENT
mediaType: ANIME
\`\`\`

# 📝 Planning:
\`\`\`zoro
listType: PLANNING
mediaType: ANIME
\`\`\`

# 🌀 Repeating:
\`\`\`zoro
listType: REPEATING
mediaType: ANIME
\`\`\`

# ⏸️ On Hold:
\`\`\`zoro
listType: PAUSED
mediaType: ANIME
\`\`\`

# 🏁 Completed:
\`\`\`zoro
listType: COMPLETED
mediaType: ANIME
\`\`\`

# 🗑️ Dropped:
\`\`\`zoro
listType: DROPPED
mediaType: ANIME
\`\`\`

# 📊 Stats:
\`\`\`zoro
type: stats
\`\`\` 
`;

      const secondNoteTitle  = 'Manga Dashboard';
      const secondNoteContent = `\`\`\`zoro-search
mediaType: MANGA
\`\`\`

# 📖 Reading:
\`\`\`zoro
listType: CURRENT
mediaType: MANGA
\`\`\`

# 📝 Planning:
\`\`\`zoro
listType: PLANNING
mediaType: MANGA
\`\`\`

# 🌀 Repeating:
\`\`\`zoro
listType: REPEATING
mediaType: MANGA
\`\`\`

# ⏸️ On Hold:
\`\`\`zoro
listType: PAUSED
mediaType: MANGA
\`\`\`

# 🏁 Completed:
\`\`\`zoro
listType: COMPLETED
mediaType: MANGA
\`\`\`

# 🗑️ Dropped:
\`\`\`zoro
listType: DROPPED
mediaType: MANGA
\`\`\`

# 📊 Stats:
\`\`\`zoro
type: stats
\`\`\` 
`;

      const notes = [
        { title: firstNoteTitle, content: firstNoteContent },
        { title: secondNoteTitle, content: secondNoteContent }
      ];

      for (const note of notes) {
        const filePath = `${note.title}.md`;
        const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (existing) {
          errorMessages.push(`"${note.title}" already exists`);
          continue;
        }

        await this.plugin.app.vault.create(filePath, note.content);
        successCount++;
      }

      if (successCount) {
        new Notice(`Created ${successCount} note${successCount > 1 ? 's' : ''}`, 4000);
        const first = this.plugin.app.vault.getAbstractFileByPath(`${firstNoteTitle}.md`);
        if (first) await this.plugin.app.workspace.openLinkText(firstNoteTitle, '', false);
      }
      if (errorMessages.length) new Notice(`Note: ${errorMessages.join(', ')}`, 5000);

    } catch (err) {
      console.error('Error creating notes:', err);
      new Notice(`Failed to create notes: ${err.message}`, 5000);
    }
  }

  async createSampleFolders() {
  const { vault, workspace } = this.plugin.app;
  const dashboards = [
    {
      folder: 'Anime Dashboard',
      notes: [
        {
          name: 'Watching',
          content: `\`\`\`zoro-search
mediaType: ANIME
\`\`\`

\`\`\`zoro
listType: CURRENT
mediaType: ANIME
\`\`\``
        },
        {
          name: 'Planning',
          content: `\`\`\`zoro-search
mediaType: ANIME
\`\`\`

\`\`\`zoro
listType: PLANNING
mediaType: ANIME
\`\`\``
        },
        {
          name: 'Repeating',
          content: `\`\`\`zoro-search
mediaType: ANIME
\`\`\`

\`\`\`zoro
listType: REPEATING
mediaType: ANIME
\`\`\``
        },
        {
          name: 'On Hold',
          content: `\`\`\`zoro-search
mediaType: ANIME
\`\`\`

\`\`\`zoro
listType: PAUSED
mediaType: ANIME
\`\`\``
        },
        {
          name: 'Completed',
          content: `\`\`\`zoro-search
mediaType: ANIME
\`\`\`

\`\`\`zoro
listType: COMPLETED
mediaType: ANIME
\`\`\``
        },
        {
          name: 'Dropped',
          content: `\`\`\`zoro-search
mediaType: ANIME
\`\`\`

\`\`\`zoro
listType: DROPPED
mediaType: ANIME
\`\`\``
        },
        {
          name: 'Stats',
          content: `\`\`\`zoro
type: stats
\`\`\``
        }
      ]
    },
    {
      folder: 'Manga Dashboard',
      notes: [
        {
          name: 'Reading',
          content: `\`\`\`zoro-search
mediaType: MANGA
\`\`\`

\`\`\`zoro
listType: CURRENT
mediaType: MANGA
\`\`\``
        },
        {
          name: 'Planning',
          content: `\`\`\`zoro-search
mediaType: MANGA
\`\`\`

\`\`\`zoro
listType: PLANNING
mediaType: MANGA
\`\`\``
        },
        {
          name: 'Repeating',
          content: `\`\`\`zoro-search
mediaType: MANGA
\`\`\`

\`\`\`zoro
listType: REPEATING
mediaType: MANGA
\`\`\``
        },
        {
          name: 'On Hold',
          content: `\`\`\`zoro-search
mediaType: MANGA
\`\`\`

\`\`\`zoro
listType: PAUSED
mediaType: MANGA
\`\`\``
        },
        {
          name: 'Completed',
          content: `\`\`\`zoro-search
mediaType: MANGA
\`\`\`

\`\`\`zoro
listType: COMPLETED
mediaType: MANGA
\`\`\``
        },
        {
          name: 'Dropped',
          content: `\`\`\`zoro-search
mediaType: MANGA
\`\`\`

\`\`\`zoro
listType: DROPPED
mediaType: MANGA
\`\`\``
        },
        {
          name: 'Stats',
          content: `\`\`\`zoro
type: stats
\`\`\``
        }
      ]
    }
  ];

  for (const { folder, notes } of dashboards) {
    try {
      // Create folder if missing
      if (!vault.getAbstractFileByPath(folder)) {
        await vault.createFolder(folder);
      }
      // Create notes within it
      for (const { name, content } of notes) {
        const path = `${folder}/${name}.md`;
        if (!vault.getAbstractFileByPath(path)) {
          await vault.create(path, content);
        }
      }
      // Open the first note
      await workspace.openLinkText(notes[0].name, folder, false);
    } catch (err) {
      console.error(`[Zoro] Error creating "${folder}":`, err);
      new Notice(`❌ Failed creating ${folder}: ${err.message}`, 5000);
    }
  }

  new Notice('✅ Dashboards generated!', 4000);
}
}
// Settings
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

// variables For headers
        const Account  = section('👤 Account', true);
    const UI = section('📺 Display');
    const Theme = section('🌌 Theme');
    const Guide = section('🧭 Guide');
    const More = section('✨  More');
    const Data = section('📤 Data');
    const Cache = section('🔄 Cache');
    const About = section('ℹ️ About');
    

    
    new Setting(Account)
      .setName('🆔 Username')
      .setDesc('Lets you access your public profile and stats — that’s it.')
      .addText(text => text
        .setPlaceholder('Enter your AniList username')
        .setValue(this.plugin.settings.defaultUsername)
        .onChange(async (value) => {
          this.plugin.settings.defaultUsername = value.trim();
          await this.plugin.saveSettings();
        }));
        
        // Dynamic Authentication button

const authSetting = new Setting(
  Account)
  .setName('🔓 Optional Login')
  .setDesc('Lets you peek at your private profile and actually change stuff.');

authSetting.addButton(button => {
  this.authButton = button;
  this.updateAuthButton();
  
  button.onClick(async () => {
    await this.handleAuthButtonClick();
  });
});

    new Setting(UI)
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
        
        new Setting(UI)
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
        
      /* ----------  existing ZoroSettingTab.display()  ---------- */

new Setting(UI)
  .setName('Sort by')
  .addDropdown(drop =>
    Object.entries(SORT_FIELDS).forEach(([k, { label }]) => drop.addOption(k, label))
    && drop.setValue(this.plugin.settings.defaultSortField)   // ← already validated
           .onChange(async v => {
             this.plugin.settings.defaultSortField = v;
             await this.plugin.saveSettings();
           })
  );

new Setting(UI)
  .setName('Sort direction')
  .addDropdown(drop =>
    drop
      .addOption('', 'Default')
      .addOption('asc', 'Ascending ↑')
      .addOption('desc', 'Descending ↓')
      .setValue(this.plugin.settings.defaultSortDir)          // ← already validated
      .onChange(async v => {
        this.plugin.settings.defaultSortDir = v;
        await this.plugin.saveSettings();
      })
  );


    new Setting(UI)
      .setName('🌆 Cover')
      .setDesc('Display cover images for anime/manga')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCoverImages)
        .onChange(async (value) => {
          this.plugin.settings.showCoverImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(UI)
      .setName('⭐ Ratings')
      .setDesc('Display user ratings/scores')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showRatings)
        .onChange(async (value) => {
          this.plugin.settings.showRatings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(UI)
      .setName('📈 Progress')
      .setDesc('Display progress information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgress)
        .onChange(async (value) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
        }));

    new Setting(UI)
      .setName('🎭 Genres')
      .setDesc('Display genre tags')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));

    


    
        
/* ---- Unified Export button (always shown) ---- */
new Setting(Data)
.setName('🧾 Export your data')
  .setDesc('Everything you’ve watched, rated, and maybe ghosted — neatly exported into a CSV.')
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
  .setName('Select Theme')
  .setDesc('Pick a custom CSS file from the themes folder')
  .addDropdown(async dropdown => {
    // Populate
    dropdown.addOption('', 'None (built-in)');
    const themes = await this.plugin.theme.getAvailableThemes();
    themes.forEach(t => dropdown.addOption(t, t));

    // Pre-select saved value
    dropdown.setValue(this.plugin.settings.theme);

    // On change: apply + save
    dropdown.onChange(async value => {
      this.plugin.settings.theme = value;
      await this.plugin.saveSettings();
      await this.plugin.theme.applyTheme(value);
    });
  });

new Setting(Guide)
  .setName('⚡ Sample Folders')
  .setDesc('Builds two folders for you — anime and manga — with everything pre-filled: notes, lists, search, stats. (Recommended)')
  .addButton(button =>
    button
      .setButtonText('Create Sample Folders')
      .onClick(async () => {
       await this.plugin.sample.createSampleFolders();
      })
  );
new Setting(Guide)
    .setName('🍜 Sample Notes')
    .setDesc('Builds two notes for you — anime and manga — with everything pre-filled: lists, search, stats. Like instant noodles, but for your library.')
    .addButton(button => button
      .setButtonText('Create Note')
      .setTooltip('Click to create sample notes in your vault')
      .onClick(async () => {
        await this.plugin.sample.createSampleNotes();
        this.display();
      })
    );
    
    new Setting(Guide)
     .setName('🗝️ Need a Client ID?')
    .setDesc('Click here to open the step-by-step guide for generating your AniList Client ID & Secret. Takes less than a minute—no typing, just copy and paste.')
      .addButton(button => button
        .setButtonText('Setup Guide')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md', '_blank');
        }));
        
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
  //  Dynamic Update of Auth button
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
    this.updateAuthButton(); // refresh after login completes
  } else {
    if (confirm('⚠️ Are you sure you want to sign out?')) { 
    await this.plugin.auth.logout();
    this.updateAuthButton(); // refresh after logout
  }
  }
}


}
module.exports = {
  default: ZoroPlugin,
};

