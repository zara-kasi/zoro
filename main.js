

// Zoro Plugin for Obsidian (AniList integration)
// Provides AniList user stats, lists, search, and editor functionalities within Obsidian.

const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

// === Constants ===

const DEFAULT_SETTINGS = {
  defaultUsername: '',
  defaultLayout: 'card',
  defaultSortField: '',
  defaultSortDir: '',
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  gridColumns: 2,
  theme: '',
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: ''
};

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

// For media list queries (same mapping as search)
const ANILIST_SORT_MAP = { ...ANILIST_SEARCH_SORT_MAP };

/**
 * Sort entries by given field and direction.
 * @param {Array} entries 
 * @param {{field:string, dir:string}} options 
 * @returns {Array}
 */
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
      case 'score':       return e.score != null ? e.score : -1;
      case 'popularity':  return m.popularity || 0;
      case 'trending':    return m.trending || 0;
      case 'favourites':  return m.favourites || 0;
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

// === Helper Classes ===

/**
 * Rate-limited request queue for AniList API calls.
 */
class RequestQueue {
  constructor() {
    this.queue = [];
    this.delay = 700; // ~85 requests/min
    this.isProcessing = false;
  }

  /**
   * Add a request function to the queue.
   * @param {Function} requestFn 
   */
  add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  }

  /**
   * Process the next request in the queue after delay.
   */
  async process() {
    if (this.isProcessing || !this.queue.length) return;
    this.isProcessing = true;
    const { requestFn, resolve, reject } = this.queue.shift();
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
      document.body.removeChild(loader);
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }
}

// === Main Plugin Class ===

class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    // Initialize cache
    this.cache = {
      userData: new Map(),
      mediaData: new Map(),
      searchResults: new Map()
    };
    this.requestQueue = new RequestQueue();
    this.cacheTimeout = 4 * 60 * 1000; // 4 min
    // Periodic cache pruning
    this.pruneInterval = setInterval(() => this.pruneCache(), this.cacheTimeout);
  }

  // === Lifecycle ===

  /**
   * Prune expired entries from all caches.
   */
  pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache.userData) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.userData.delete(key);
      }
    }
    for (const [key, entry] of this.cache.mediaData) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.mediaData.delete(key);
      }
    }
    for (const [key, entry] of this.cache.searchResults) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.searchResults.delete(key);
      }
    }
    console.log('[Zoro] Cache pruned');
  }

  /**
   * Called when plugin is enabled: loads settings, injects CSS, registers processors.
   */
  async onload() {
    console.log('[Zoro] Plugin loading...');
    try {
      await this.loadSettings();
      console.log('[Zoro] Settings loaded.');
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }

    try {
      this.injectCSS();
      console.log('[Zoro] CSS injected.');
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }

    await this.applyTheme(this.settings.theme);

    // Register code block and link processors
    this.registerMarkdownCodeBlockProcessor('zoro', this.processZoroCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processZoroSearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    this.addSettingTab(new ZoroSettingTab(this.app, this));
    console.log('[Zoro] Plugin loaded successfully.');
  }

  /**
   * Called when plugin is disabled: remove styles and intervals.
   */
  onunload() {
    console.log('Unloading Zoro Plugin');
    const styleEl = document.getElementById('zoro-plugin-styles');
    if (styleEl) {
      styleEl.remove();
      console.log(`Removed style element: zoro-plugin-styles`);
    }
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    this.cache.userData.clear();
    this.cache.mediaData.clear();
    this.cache.searchResults.clear();
  }

  // === Settings ===

  /**
   * Validate loaded settings.
   * @param {object} settings 
   */
  validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'table'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      defaultSortField: (typeof settings?.defaultSortField === 'string' &&
        (settings.defaultSortField === '' || SORT_FIELDS[settings.defaultSortField])) ?
        settings.defaultSortField : '',
      defaultSortDir: ['asc', 'desc', ''].includes(settings?.defaultSortDir) ? settings.defaultSortDir : '',
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : 3,
      theme: typeof settings?.theme === 'string' ? settings.theme : '',
      showCoverImages: !!settings?.showCoverImages,
      showRatings: !!settings?.showRatings,
      showProgress: !!settings?.showProgress,
      showGenres: !!settings?.showGenres,
      clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
      clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
      redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
      accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : ''
    };
  }

  /**
   * Save plugin settings to storage.
   */
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

  /**
   * Load settings and prompt for missing client secret.
   */
  async loadSettings() {
    const saved = await this.loadData() || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);

    if (!this.settings.clientSecret) {
      const secret = await this.promptForCode('Enter your AniList client secret:');
      if (secret) {
        this.settings.clientSecret = secret.trim();
        await this.saveData(this.settings);
      }
    }
  }

  // === Authentication ===

  /**
   * Initiate AniList OAuth authentication flow.
   */
  async authenticateUser() {
    const clientId = this.settings.clientId;
    const redirectUri = this.settings.redirectUri || DEFAULT_SETTINGS.redirectUri;

    if (!clientId) {
      new Notice('❌ Please set your Client ID in plugin settings first.', 5000);
      return;
    }
    if (this.settings.accessToken) {
      const reuse = confirm('Do you want to re-authenticate?');
      if (!reuse) return;
    }

    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    try {
      new Notice('🔐 Opening authentication page...', 3000);
      window.addEventListener('message', this.handleAuthMessage.bind(this));

      if (window.require) {
        const { shell } = window.require('electron');
        await shell.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }

      const code = await this.promptForCode('Paste the PIN code from the authentication page:');
      if (!code?.trim()) {
        new Notice('⚠️ No code entered. Authentication cancelled.', 4000);
        return;
      }
      await this.exchangeCodeForToken(code.trim(), redirectUri);
      new Notice('✅ Authenticated successfully.', 4000);
    } catch (error) {
      console.error('[Zoro] Authentication failed:', error);
      new Notice(`❌ Authentication error: ${error.message}`, 5000);
    }
  }

  /**
   * Exchange authorization code for access token.
   * @param {string} code 
   * @param {string} redirectUri 
   */
  async exchangeCodeForToken(code, redirectUri) {
    const clientId = this.settings.clientId;
    const clientSecret = this.settings.clientSecret;
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret || '',
      redirect_uri: redirectUri
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' };

    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://anilist.co/api/v2/oauth/token',
        method: 'POST',
        headers,
        body: params.toString()
      }));
      const data = response.json;

      if (!data || typeof data !== 'object') {
        console.error('[Zoro] Unexpected response from server:', response);
        throw new Error('⚠️ Invalid response from server.');
      }
      if (!data.access_token) {
        throw new Error(data.error_description || '❌ No access token returned by server.');
      }

      this.settings.accessToken = data.access_token;
      if (data.expires_in) {
        this.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
      }
      await this.saveSettings();
      new Notice('✅ Successfully authenticated with AniList!', 4000);
      if (this.testAccessToken) {
        await this.testAccessToken();
      }
    } catch (err) {
      console.error('[Zoro] Authentication error:', err);
      new Notice(`❌ Authentication failed: ${err.message}`, 5000);
    }
  }

  /**
   * Validate that an access token exists.
   * @returns {boolean}
   */
  async ensureValidToken() {
    return !!this.settings.accessToken;
  }

  /**
   * Test the access token by fetching viewer data.
   */
  async testAccessToken() {
    const query = `
      query {
        Viewer { id name }
      }
    `;
    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer ${this.settings.accessToken}\`
        },
        body: JSON.stringify({ query })
      }));
      const data = response.json;
      if (!data?.data?.Viewer) {
        throw new Error('Invalid access token or response malformed.');
      }
      const username = data.data.Viewer.name;
      new Notice(\`🎉 Welcome, ${username}! Token is valid.\`);
    } catch (error) {
      console.warn('[Zoro] testAccessToken failed:', error);
      throw new Error('Token verification failed. Please re-authenticate.');
    }
  }

  /**
   * Get authenticated user name.
   * @returns {Promise<string|null>}
   */
  async getAuthenticatedUsername() {
    if (!this.settings.accessToken) return null;
    await this.ensureValidToken();
    const query = `
      query { Viewer { name } }
    `;
    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer ${this.settings.accessToken}\`
        },
        body: JSON.stringify({ query })
      }));
      const data = response.json;
      if (!data?.data?.Viewer?.name) {
        throw new Error('Invalid token or no username returned.');
      }
      this.settings.authUsername = data.data.Viewer.name;
      await this.saveSettings();
      return data.data.Viewer.name;
    } catch (error) {
      console.warn('[Zoro] getAuthenticatedUsername failed:', error);
      return null;
    }
  }

  /**
   * Prompt user for input (used for codes).
   * @param {string} message 
   */
  async promptForCode(message) {
    return new Promise((resolve) => {
      const code = prompt(message);
      resolve(code);
    });
  }

  // === Data Fetching ===

  /**
   * Fetch data from AniList via GraphQL.
   * Caches results based on config type.
   * @param {object} config 
   */
  async fetchZoroData(config) {
    const cacheKey = JSON.stringify(config);
    let cacheType;
    if (config.type === 'stats') cacheType = 'userData';
    else if (config.type === 'single') cacheType = 'mediaData';
    else if (config.type === 'search') cacheType = 'searchResults';
    else cacheType = 'userData';

    const cached = this.getFromCache(cacheType, cacheKey);
    if (cached) return cached;

    try {
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (this.settings.accessToken) {
        await this.ensureValidToken();
        headers.Authorization = \`Bearer ${this.settings.accessToken}\`;
      }

      let query, variables;
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
        query = this.getSearchMediaQuery();
        variables = {
          search: config.search,
          type: config.mediaType,
          page: config.page || 1,
          perPage: config.perPage || 5,
          sort: config.sortOptions?.anilistSort ? [config.sortOptions.anilistSort] : null
        };
      } else {
        query = this.getMediaListQuery();
        variables = {
          username: config.username,
          status: config.listType,
          type: config.mediaType || 'ANIME',
          sort: config.sortOptions?.anilistSort ? [config.sortOptions.anilistSort] : null
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
      if (result.errors?.length) {
        const errMsg = result.errors[0]?.message || 'Unknown error.';
        const isPrivate = errMsg.includes('Private') || errMsg.includes('permission');
        if (isPrivate) {
          if (this.settings.accessToken) {
            throw new Error('🚫 List is private and token has no permission.');
          } else {
            throw new Error('🔒 List is private. Please authenticate to access it.');
          }
        }
        throw new Error(errMsg);
      }
      if (!result.data) {
        throw new Error('AniList returned no data.');
      }

      this.setToCache(cacheType, cacheKey, result.data);
      return result.data;
    } catch (error) {
      console.error('[Zoro] fetchZoroData failed:', error);
      throw error;
    }
  }

  /**
   * Build GraphQL query for media list.
   * @param {string} layout 
   * @returns {string}
   */
  getMediaListQuery(layout = 'card') {
    const baseFields = `
      id
      status
      score
      progress
    `;
    const mediaFieldsByLayout = {
      compact: `
        id
        title { romaji }
        coverImage { medium }
      `,
      card: `
        id
        title { romaji english native }
        coverImage { large medium }
        format
        averageScore
        status
        genres
        episodes
        chapters
      `,
      full: `
        id
        title { romaji english native }
        coverImage { large medium }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate { year month day }
        endDate { year month day }
      `
    };
    const fields = mediaFieldsByLayout[layout] || mediaFieldsByLayout.card;
    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType, $sort: [MediaListSort]) {
        MediaListCollection(userName: $username, status: $status, type: $type, sort: $sort) {
          lists {
            entries {
              ${baseFields}
              media { ${fields} }
            }
          }
        }
      }
    `;
  }

  /**
   * Build GraphQL query for single media entry.
   * @param {string} layout 
   * @returns {string}
   */
  getSingleMediaQuery(layout = 'card') {
    const baseFields = `
      id
      status
      score
      progress
    `;
    const mediaFieldsByLayout = {
      compact: `
        id
        title { romaji }
        coverImage { medium }
      `,
      card: `
        id
        title { romaji english native }
        coverImage { large medium }
        format
        averageScore
        status
        genres
        episodes
        chapters
      `,
      full: `
        id
        title { romaji english native }
        coverImage { large medium }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate { year month day }
        endDate { year month day }
      `
    };
    const fields = mediaFieldsByLayout[layout] || mediaFieldsByLayout.card;
    return `
      query ($username: String, $mediaId: Int, $type: MediaType) {
        MediaList(userName: $username, mediaId: $mediaId, type: $type) {
          ${baseFields}
          media { ${fields} }
        }
      }
    `;
  }

  /**
   * Build GraphQL query for user statistics.
   * @param {{mediaType:string,layout:string,useViewer:boolean}} [opts]
   * @returns {string}
   */
  getUserStatsQuery({ mediaType = 'ANIME', layout = 'card', useViewer = false } = {}) {
    const typeKey = mediaType.toLowerCase();
    const statFieldsByLayout = {
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
    const fields = statFieldsByLayout[layout] || statFieldsByLayout.card;
    const viewerPrefix = useViewer ? 'Viewer' : `User(name: $username)`;
    return `
      query ($username: String) {
        ${viewerPrefix} {
          id
          name
          avatar { large medium }
          statistics {
            ${typeKey} { ${fields} }
          }
        }
      }
    `;
  }

  /**
   * Build GraphQL query for media search.
   * @param {string} layout 
   * @returns {string}
   */
  getSearchMediaQuery(layout = 'card') {
    const mediaFieldsByLayout = {
      compact: `
        id
        title { romaji }
        coverImage { medium }
      `,
      card: `
        id
        title { romaji english native }
        coverImage { large medium }
        format
        averageScore
        status
        genres
        episodes
        chapters
      `,
      full: `
        id
        title { romaji english native }
        coverImage { large medium }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate { year month day }
        endDate { year month day }
      `
    };
    const fields = mediaFieldsByLayout[layout] || mediaFieldsByLayout.card;
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

  /**
   * Construct AniList URL for media.
   * @param {number} mediaId 
   * @param {string} mediaType 
   * @returns {string}
   */
  getZoroUrl(mediaId, mediaType = 'ANIME') {
    if (!mediaId || typeof mediaId !== 'number') {
      throw new Error(`Invalid mediaId: ${mediaId}`);
    }
    const type = String(mediaType).toUpperCase();
    const validTypes = ['ANIME', 'MANGA'];
    const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime';
    return `https://anilist.co/${urlType}/${mediaId}`;
  }

  // === UI Rendering ===

  /**
   * Process standard code block with 'zoro'.
   */
  async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source) || {};
      console.log('[Zoro] Code block config:', config);

      if (config.useAuthenticatedUser) {
        const authUsername = await this.getAuthenticatedUsername();
        if (!authUsername) {
          throw new Error('❌ Could not retrieve authenticated username. Check auth setup or set username manually.');
        }
        config.username = authUsername;
      }

      if (!config.username) {
        throw new Error('❌ No username provided. Set `username:` or enable `useAuthenticatedUser`.');
      }

      const data = await this.fetchZoroData(config);
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('⚠️ No data returned from Zoro API.');
      }
      this.renderZoroData(el, data, config);
    } catch (error) {
      console.error('[Zoro] Code block error:', error);
      this.renderError(el, error.message || 'Unknown error occurred.');
    }
  }

  /**
   * Process 'zoro-search' code block.
   */
  async processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
      if (this.settings.debugMode) console.log('[Zoro] Search block config:', config);
      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      await this.renderSearchInterface(el, config);
    } catch (error) {
      console.error('[Zoro] Search block error:', error);
      this.renderError(el, error.message || 'Failed to process Zoro search block.');
    }
  }

  /**
   * Process inline links starting with 'zoro:'.
   */
  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="zoro:"]');
    for (const link of inlineLinks) {
      const href = link.getAttribute('href');
      const placeholder = document.createElement('span');
      placeholder.textContent = '🔄 Loading Zoro...';
      link.replaceWith(placeholder);
      try {
        const config = this.parseInlineLink(href);
        const data = await this.fetchZoroData(config);
        const container = document.createElement('span');
        container.className = 'zoro-inline-container';
        this.renderZoroData(container, data, config);
        placeholder.replaceWith(container);
        ctx.addChild({ unload: () => { container.remove(); } });
      } catch (error) {
        console.warn(`[Zoro] Inline link failed for ${href}:`, error);
        const errorEl = document.createElement('span');
        errorEl.className = 'zoro-inline-error';
        errorEl.textContent = `⚠️ ${error.message || 'Failed to load data'}`;
        placeholder.replaceWith(errorEl);
      }
    }
  }

  /**
   * Parse code block content into config object.
   * @param {string} source 
   */
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
      if (this.settings.defaultUsername) {
        config.username = this.settings.defaultUsername;
      } else if (this.settings.accessToken) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('Username is required. Please set a default in settings, authenticate, or specify one.');
      }
    }
    config.listType = config.listType || 'CURRENT';
    config.layout = config.layout || this.settings.defaultLayout;
    config.mediaType = config.mediaType || 'ANIME';
    const sortRaw = (config.sort || '').trim();
    config.sortOptions = sortRaw ? this._buildSortOptions(sortRaw, config) :
      this._buildSortOptions(`${this.settings.defaultSortField}-${this.settings.defaultSortDir}`, config);
    return config;
  }

  /**
   * Parse 'zoro-search' code block config.
   * @param {string} source 
   */
  parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const lines = source.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    config.layout = config.layout || this.settings.defaultLayout || 'card';
    config.mediaType = config.mediaType || 'ANIME';
    const sortRaw = (config.sort || '').trim();
    config.sortOptions = sortRaw ?
      this._buildSortOptions(sortRaw, config) :
      this._buildSortOptions(`${this.settings.defaultSortField}-${this.settings.defaultSortDir}`, config);
    return config;
  }

  /**
   * Parse inline 'zoro:' link into config.
   * @param {string} href 
   */
  parseInlineLink(href) {
    const [base, hash] = href.replace('zoro:', '').split('#');
    const parts = base.split('/');
    let username, pathParts;
    if (parts[0] === '') {
      if (!this.settings.defaultUsername) {
        throw new Error('⚠️ Default username not set. Configure it in settings.');
      }
      username = this.settings.defaultUsername;
      pathParts = parts.slice(1);
    } else {
      if (parts.length < 2) {
        throw new Error('❌ Invalid Zoro inline link format.');
      }
      username = parts[0];
      pathParts = parts.slice(1);
    }
    const config = { username, layout: 'card', type: 'list' };
    const main = pathParts[0], second = pathParts[1];
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
        if (['compact','card','minimal','full'].includes(mod)) {
          config.layout = mod;
        }
        if (mod === 'nocache') {
          config.nocache = true;
        }
      }
    }
    return config;
  }

  /**
   * Render search UI in code block.
   * @param {HTMLElement} el 
   * @param {object} config 
   */
  renderSearchInterface(el, config) {
    el.empty();
    el.className = 'zoro-search-container';
    const searchDiv = document.createElement('div');
    searchDiv.className = 'zoro-search-input-container';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'zoro-search-input';
    searchInput.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';
    searchDiv.appendChild(searchInput);
    el.appendChild(searchDiv);

    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'zoro-search-results';
    el.appendChild(resultsDiv);

    let timeout;
    const performSearch = async () => {
      const term = searchInput.value.trim();
      if (term.length < 3) {
        resultsDiv.innerHTML = '<div class="zoro-search-message">Type at least 3 characters to search...</div>';
        return;
      }
      try {
        resultsDiv.innerHTML = '<div class="zoro-search-loading">Searching...</div>';
        const searchConfig = { ...config, search: term, page: 1, perPage: 5 };
        const data = await this.fetchZoroData(searchConfig);
        this.renderSearchResults(resultsDiv, data.Page.media, config);
      } catch (err) {
        this.renderError(resultsDiv, err.message);
      }
    };

    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(performSearch, 300);
    });
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });
  }

  /**
   * Render search results cards.
   */
  renderSearchResults(el, media, config) {
    el.empty();
    if (media.length === 0) {
      el.innerHTML = '<div class="zoro-search-message">No results found.</div>';
      return;
    }
    const sorted = sortEntries(media, config.sortOptions);
    const gridDiv = document.createElement('div');
    gridDiv.className = 'zoro-cards-grid';
    gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);

    sorted.forEach(async (item) => {
      const title = item.title.english || item.title.romaji || '';
      const cardDiv = document.createElement('div');
      cardDiv.className = 'zoro-card';
      if (this.settings.showCoverImages && item.coverImage) {
        const img = document.createElement('img');
        img.src = item.coverImage.large;
        img.alt = title;
        img.className = 'media-cover';
        cardDiv.appendChild(img);
      }
      const mediaInfoDiv = document.createElement('div');
      mediaInfoDiv.className = 'media-info';

      // Title
      const titleEl = document.createElement('h4');
      const titleLink = document.createElement('a');
      titleLink.href = this.getZoroUrl(item.id, config.mediaType);
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleEl.appendChild(titleLink);
      mediaInfoDiv.appendChild(titleEl);

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

      // Add button
      const addBadge = document.createElement('span');
      addBadge.textContent = 'ADD';
      addBadge.className = 'status-badge status-planning clickable-status';
      addBadge.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        addBadge.textContent = 'Adding…';
        addBadge.style.pointerEvents = 'none';
        try {
          await this.addMediaToList(item.id, { status: 'PLANNING', progress: 0 }, config.mediaType);
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

      if (this.settings.showRatings && item.averageScore) {
        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'score';
        scoreSpan.textContent = `★ ${item.averageScore}`;
        detailsDiv.appendChild(scoreSpan);
      }
      mediaInfoDiv.appendChild(detailsDiv);

      if (this.settings.showGenres && item.genres) {
        const genresDiv = document.createElement('div');
        genresDiv.className = 'genres';
        item.genres.slice(0, 3).forEach(genre => {
          const tag = document.createElement('span');
          tag.className = 'genre-tag';
          tag.textContent = genre;
          genresDiv.appendChild(tag);
        });
        mediaInfoDiv.appendChild(genresDiv);
      }

      cardDiv.appendChild(mediaInfoDiv);
      gridDiv.appendChild(cardDiv);

      // Update add button if already in list
      if (this.settings.accessToken) {
        this.checkIfMediaInList(item.id, config.mediaType).then(inList => {
          if (inList) {
            addBadge.textContent = 'IN LIST';
            addBadge.style.backgroundColor = '#999';
            addBadge.style.cursor = 'not-allowed';
            addBadge.title = 'Already in your list';
            addBadge.onclick = null;
          }
        });
      }
    });

    el.appendChild(gridDiv);
  }

  /**
   * Render data based on config type.
   */
  renderZoroData(el, data, config) {
    el.empty();
    el.className = 'zoro-container';
    if (config.type === 'stats') {
      this.renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      this.renderSingleMedia(el, data.MediaList, config);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
      if (config.layout === 'table') {
        this.renderTableLayout(el, entries, config);
      } else {
        this.renderMediaList(el, entries, config);
      }
    }
  }

  /**
   * Display user statistics (anime/manga).
   */
  renderUserStats(el, user) {
    if (!user || !user.statistics) {
      this.renderError(el, 'User statistics unavailable.');
      return;
    }
    const safe = (val, fb = '—') => (val != null ? val : fb);

    const createItem = (label, value) => {
      const item = document.createElement('div');
      item.className = 'zoro-stat-item';
      item.innerHTML = `<span>${label}:</span><span>${value}</span>`;
      return item;
    };

    const createSection = (title, stats) => {
      const section = document.createElement('div');
      section.className = 'zoro-stat-section';
      const heading = document.createElement('h4');
      heading.textContent = title;
      section.appendChild(heading);
      for (const [key, label] of Object.entries({
        count: 'Count',
        episodesWatched: 'Episodes',
        minutesWatched: 'Minutes',
        meanScore: 'Mean Score',
        chaptersRead: 'Chapters',
        volumesRead: 'Volumes'
      })) {
        if (stats[key] !== undefined) {
          section.appendChild(createItem(label, stats[key].toLocaleString?.() || stats[key]));
        }
      }
      return section;
    };

    const container = document.createElement('div');
    container.className = 'zoro-user-stats';
    const header = document.createElement('div');
    header.className = 'zoro-user-header';
    header.innerHTML = `
      <img src="${user.avatar?.medium || ''}" alt="${user.name || ''}" class="zoro-user-avatar">
      <h3>${user.name || ''}</h3>
    `;
    const statsGrid = document.createElement('div');
    statsGrid.className = 'zoro-stats-grid';
    statsGrid.appendChild(createSection('Anime', user.statistics.anime || {}));
    statsGrid.appendChild(createSection('Manga', user.statistics.manga || {}));
    container.appendChild(header);
    container.appendChild(statsGrid);
    el.appendChild(container);
  }

  /**
   * Render single media card view.
   */
  renderSingleMedia(el, mediaList, config) {
    const media = mediaList.media;
    const title = media.title.english || media.title.romaji || '';
    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-single-card';
    if (this.settings.showCoverImages) {
      const img = document.createElement('img');
      img.src = media.coverImage.large;
      img.alt = title;
      img.className = 'media-cover';
      cardDiv.appendChild(img);
    }
    const mediaInfoDiv = document.createElement('div');
    mediaInfoDiv.className = 'media-info';
    const titleEl = document.createElement('h3');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'zoro-title-link';
    titleLink.textContent = title;
    titleEl.appendChild(titleLink);
    mediaInfoDiv.appendChild(titleEl);

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'media-details';
    if (media.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = media.format;
      detailsDiv.appendChild(formatBadge);
    }
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${mediaList.status.toLowerCase()}`;
    statusBadge.textContent = mediaList.status;
    detailsDiv.appendChild(statusBadge);

    if (this.settings.showProgress) {
      const progressSpan = document.createElement('span');
      progressSpan.className = 'progress';
      const total = media.episodes || media.chapters || '?';
      progressSpan.textContent = `${mediaList.progress}/${total}`;
      detailsDiv.appendChild(progressSpan);
    }

    if (this.settings.showRatings && mediaList.score != null) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${mediaList.score}`;
      detailsDiv.appendChild(scoreSpan);
    }
    mediaInfoDiv.appendChild(detailsDiv);

    if (this.settings.showGenres) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres';
      media.genres.slice(0, 3).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = genre;
        genresDiv.appendChild(tag);
      });
      mediaInfoDiv.appendChild(genresDiv);
    }

    cardDiv.appendChild(mediaInfoDiv);
    el.appendChild(cardDiv);
  }

  /**
   * Render list of media entries in grid.
   */
  renderMediaList(el, entries, config) {
    const sorted = sortEntries(entries, config.sortOptions);
    const gridDiv = document.createElement('div');
    gridDiv.className = 'zoro-cards-grid';
    gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);
    sorted.forEach(entry => {
      const card = this.createMediaCard(entry, config);
      gridDiv.appendChild(card);
    });
    el.empty();
    el.appendChild(gridDiv);
  }

  /**
   * Create a card element for a media entry.
   */
  createMediaCard(entry, config) {
    const media = entry.media;
    if (!media) return document.createTextNode('⚠️ Missing media');

    const title = media.title.english || media.title.romaji || 'Untitled';
    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-card';

    if (this.settings.showCoverImages && media.coverImage?.large) {
      const img = document.createElement('img');
      img.src = media.coverImage.large;
      img.alt = title;
      img.className = 'media-cover';
      cardDiv.appendChild(img);
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'media-info';

    const titleEl = document.createElement('h4');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link';
    titleLink.textContent = title;
    titleEl.appendChild(titleLink);
    infoDiv.appendChild(titleEl);

    const detailsDiv = this.createDetailsRow(entry);
    infoDiv.appendChild(detailsDiv);

    if (this.settings.showGenres && media.genres?.length) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres';
      media.genres.slice(0, 3).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = genre;
        genresDiv.appendChild(tag);
      });
      infoDiv.appendChild(genresDiv);
    }

    cardDiv.appendChild(infoDiv);
    return cardDiv;
  }

  /**
   * Create media details row with status, progress, score badges.
   */
  createDetailsRow(entry) {
    const media = entry.media;
    const details = document.createElement('div');
    details.className = 'media-details';

    // Format badge
    if (media.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = media.format;
      details.appendChild(formatBadge);
    }

    // Status badge (clickable)
    const status = document.createElement('span');
    status.className = `status-badge status-${entry.status?.toLowerCase()} clickable-status`;
    status.textContent = entry.status || 'Unknown';
    status.style.cursor = 'pointer';
    if (this.settings.accessToken) {
      status.title = 'Click to edit';
      status.onclick = (e) => this.handleEditClick(e, entry, status);
    } else {
      status.title = 'Click to authenticate';
      status.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.createAuthenticationPrompt();
      };
    }
    details.appendChild(status);

    // Progress badge
    if (this.settings.showProgress) {
      const progress = document.createElement('span');
      progress.className = 'progress';
      const total = media.episodes ?? media.chapters ?? '?';
      progress.textContent = `${entry.progress}/${total}`;
      details.appendChild(progress);
    }

    // Score badge
    if (this.settings.showRatings && entry.score != null) {
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `★ ${entry.score}`;
      details.appendChild(score);
    }

    return details;
  }

  /**
   * Handle clicking on status badge to edit entry.
   */
  handleEditClick(e, entry, statusEl) {
    e.preventDefault();
    e.stopPropagation();
    this.createEditModal(entry, async (updates) => {
      try {
        await this.updateMediaListEntry(entry.media.id, updates);
        new Notice('✅ Updated!');
        this.cache.userData.clear();
        this.cache.mediaData.clear();
        this.cache.searchResults.clear();

        const parent = statusEl.closest('.zoro-container');
        if (parent) {
          const block = parent.closest('.markdown-rendered')?.querySelector('code');
          if (block) {
            this.processZoroCodeBlock(block.textContent, parent, {});
          }
        }
      } catch (err) {
        new Notice(`❌ Update failed: ${err.message}`);
      }
    }, () => {
      // Cancel callback (no action needed)
    });
  }

  /**
   * Render entries in a table layout.
   */
  renderTableLayout(el, entries, config) {
    el.empty();
    const sorted = sortEntries(entries, config.sortOptions);
    const table = document.createElement('table');
    table.className = 'zoro-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Title', 'Format', 'Status'];
    if (this.settings.showProgress) headers.push('Progress');
    if (this.settings.showRatings) headers.push('Score');
    if (this.settings.showGenres) headers.push('Genres');

    headers.forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    sorted.forEach(entry => {
      const media = entry.media;
      if (!media) return;
      const row = document.createElement('tr');

      // Title cell
      const titleCell = document.createElement('td');
      const link = document.createElement('a');
      link.href = this.getZoroUrl(media.id, config.mediaType);
      link.textContent = media.title.english || media.title.romaji || 'Untitled';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'zoro-title-link';
      titleCell.appendChild(link);
      row.appendChild(titleCell);

      // Format cell
      const formatCell = document.createElement('td');
      formatCell.textContent = media.format || '-';
      row.appendChild(formatCell);

      // Status cell with clickable span
      const statusCell = document.createElement('td');
      const statusSpan = document.createElement('span');
      statusSpan.textContent = entry.status || '-';
      statusSpan.className = `status-badge status-${entry.status?.toLowerCase()} clickable-status`;
      statusSpan.style.cursor = 'pointer';
      if (this.settings.accessToken) {
        statusSpan.title = 'Click to edit';
        statusSpan.onclick = (e) => this.handleEditClick(e, entry, statusSpan);
      } else {
        statusSpan.title = 'Click to authenticate';
        statusSpan.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.createAuthenticationPrompt();
        };
      }
      statusCell.appendChild(statusSpan);
      row.appendChild(statusCell);

      // Progress cell
      if (this.settings.showProgress) {
        const progressCell = document.createElement('td');
        const total = media.episodes ?? media.chapters ?? '?';
        progressCell.textContent = `${entry.progress ?? 0}/${total}`;
        row.appendChild(progressCell);
      }

      // Score cell
      if (this.settings.showRatings) {
        const scoreCell = document.createElement('td');
        scoreCell.textContent = entry.score != null ? `★ ${entry.score}` : '-';
        row.appendChild(scoreCell);
      }

      // Genres cell
      if (this.settings.showGenres) {
        const genreCell = document.createElement('td');
        genreCell.textContent = (media.genres || []).slice(0, 3).join(', ') || '-';
        row.appendChild(genreCell);
      }

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    el.appendChild(table);
  }

  /**
   * Create and display an edit modal for a media entry.
   */
  createEditModal(entry, onSave, onCancel) {
    const self = this;
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
      await trySave();
    };

    const titleEl = document.createElement('h3');
    titleEl.className = 'zoro-modal-title';
    titleEl.textContent = entry.media.title.english || entry.media.title.romaji;
    form.appendChild(titleEl);

    // Status field
    const statusGroup = document.createElement('div');
    statusGroup.className = 'zoro-form-group zoro-status-group';
    const statusLabel = document.createElement('label');
    statusLabel.className = 'zoro-form-label zoro-status-label';
    statusLabel.textContent = '🧿 Status';
    statusLabel.setAttribute('for', 'zoro-status');
    const statusSelect = document.createElement('select');
    statusSelect.id = 'zoro-status';
    statusSelect.className = 'zoro-form-input zoro-status-select';
    ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === entry.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusGroup.appendChild(statusLabel);
    statusGroup.appendChild(statusSelect);
    form.appendChild(statusGroup);

    // Score field
    const scoreGroup = document.createElement('div');
    scoreGroup.className = 'zoro-form-group zoro-score-group';
    const scoreLabel = document.createElement('label');
    scoreLabel.className = 'zoro-form-label zoro-score-label';
    scoreLabel.textContent = '⭐ Score (0–10)';
    scoreLabel.setAttribute('for', 'zoro-score');
    const scoreInput = document.createElement('input');
    scoreInput.id = 'zoro-score';
    scoreInput.className = 'zoro-form-input zoro-score-input';
    scoreInput.type = 'number';
    scoreInput.min = '0';
    scoreInput.max = '10';
    scoreInput.step = '0.1';
    scoreInput.value = entry.score != null ? entry.score : '';
    scoreInput.placeholder = 'e.g. 8.5';
    scoreGroup.appendChild(scoreLabel);
    scoreGroup.appendChild(scoreInput);
    form.appendChild(scoreGroup);

    // Progress field
    const progressGroup = document.createElement('div');
    progressGroup.className = 'zoro-form-group zoro-progress-group';
    const progressLabel = document.createElement('label');
    progressLabel.className = 'zoro-form-label zoro-progress-label';
    progressLabel.textContent = '📊 Progress';
    progressLabel.setAttribute('for', 'zoro-progress');
    const progressInput = document.createElement('input');
    progressInput.id = 'zoro-progress';
    progressInput.className = 'zoro-form-input zoro-progress-input';
    progressInput.type = 'number';
    progressInput.min = '0';
    progressInput.max = entry.media.episodes || entry.media.chapters || 999;
    progressInput.value = entry.progress || 0;
    progressInput.placeholder = 'Progress';
    progressGroup.appendChild(progressLabel);
    progressGroup.appendChild(progressInput);
    form.appendChild(progressGroup);

    // Quick buttons for progress
    const quickDiv = document.createElement('div');
    quickDiv.className = 'zoro-quick-progress-buttons';
    const plusBtn = document.createElement('button');
    plusBtn.className = 'zoro-quick-btn zoro-plus-btn';
    plusBtn.type = 'button';
    plusBtn.textContent = '+1';
    plusBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      const max = progressInput.max;
      if (current < max) progressInput.value = current + 1;
    };
    const minusBtn = document.createElement('button');
    minusBtn.className = 'zoro-quick-btn zoro-minus-btn';
    minusBtn.type = 'button';
    minusBtn.textContent = '-1';
    minusBtn.onclick = () => {
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
    quickDiv.append(plusBtn, minusBtn, completeBtn);
    form.appendChild(quickDiv);

    // Buttons (favorite, save, delete, cancel)
    const btnContainer = document.createElement('div');
    btnContainer.className = 'zoro-modal-buttons';
    const favBtn = document.createElement('button');
    favBtn.className = 'zoro-modal-btn zoro-fav-btn';
    favBtn.type = 'button';
    favBtn.title = 'Toggle Favorite';
    favBtn.textContent = '🤍';
    favBtn.onclick = async () => {
      favBtn.disabled = true;
      favBtn.textContent = '⏳';
      try {
        let mediaType = favBtn.dataset.mediaType || entry.media.type || (entry.media.episodes ? 'ANIME' : 'MANGA');
        const isAnime = mediaType === 'ANIME';
        const mutation = `
          mutation ToggleFav($animeId: Int, $mangaId: Int) {
            ToggleFavourite(animeId: $animeId, mangaId: $mangaId) {
              anime { nodes { id } }
              manga { nodes { id } }
            }
          }
        `;
        const variables = {};
        if (isAnime) variables.animeId = entry.media.id;
        else variables.mangaId = entry.media.id;
        const res = await self.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer ${self.settings.accessToken}\`
          },
          body: JSON.stringify({ query: mutation, variables })
        }));
        if (res.json.errors) {
          new Notice(`API Error: ${res.json.errors[0].message}`, 8000);
          console.error('AniList API Error:', res.json.errors);
          throw new Error(res.json.errors[0].message);
        }
        const toggleResult = res.json.data.ToggleFavourite;
        let isFav = false;
        if (isAnime) {
          isFav = toggleResult.anime.nodes.some(node => node.id === entry.media.id);
        } else {
          isFav = toggleResult.manga.nodes.some(node => node.id === entry.media.id);
        }
        favBtn.textContent = isFav ? '❤️' : '🤍';
        new Notice(\`\${isFav ? 'Added to' : 'Removed from'} favorites!\`, 3000);
      } catch (e) {
        new Notice(\`❌ Error: \${e.message || 'Unknown error'}\`, 8000);
        console.error('Favorite toggle error:', e);
      } finally {
        favBtn.disabled = false;
      }
    };
    const saveBtn = document.createElement('button');
    saveBtn.className = 'zoro-modal-btn zoro-save-btn';
    saveBtn.type = 'submit';
    saveBtn.textContent = 'Save';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'zoro-modal-btn zoro-remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '🗑️';
    removeBtn.onclick = async () => {
      if (!confirm('Remove this entry?')) return;
      removeBtn.disabled = true;
      removeBtn.textContent = '⏳';
      try {
        const delMutation = `
          mutation ($id: Int) {
            DeleteMediaListEntry(id: $id) { deleted }
          }
        `;
        await self.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer ${self.settings.accessToken}\`
          },
          body: JSON.stringify({ query: delMutation, variables: { id: entry.id } })
        }));
        document.body.removeChild(modal);
        self.clearCacheForMedia(entry.media.id);
        const parentContainer = document.querySelector('.zoro-container');
        if (parentContainer) {
          const block = parentContainer.closest('.markdown-rendered')?.querySelector('code');
          if (block) self.processZoroCodeBlock(block.textContent, parentContainer, {});
        }
        new Notice('✅ Removed');
      } catch (e) {
        new Notice('❌ Could not remove');
      }
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-modal-btn zoro-cancel-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };
    btnContainer.append(removeBtn, favBtn, saveBtn, cancelBtn);
    form.append(btnContainer);

    content.appendChild(form);
    modal.append(overlay, content);
    document.body.appendChild(modal);

    // Fetch current favorite status
    (async () => {
      try {
        const favQuery = `
          query ($mediaId: Int) {
            Media(id: $mediaId) {
              isFavourite
              type
            }
          }
        `;
        const res = await self.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer ${self.settings.accessToken}\`
          },
          body: JSON.stringify({ query: favQuery, variables: { mediaId: entry.media.id } })
        }));
        const mediaData = res.json.data?.Media;
        const fav = mediaData?.isFavourite;
        favBtn.textContent = fav ? '❤️' : '🤍';
        favBtn.dataset.mediaType = mediaData?.type;
      } catch (e) {
        console.warn('Could not fetch favorite', e);
      }
    })();

    overlay.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };

    document.addEventListener('keydown', escListener);
    function escListener(e) {
      if (e.key === 'Escape') {
        onCancel();
        document.body.removeChild(modal);
        document.removeEventListener('keydown', escListener);
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        trySave();
      }
    }

    let saving = false;
    async function trySave() {
      if (saving) return;
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const scoreVal = parseFloat(scoreInput.value);
      if (scoreInput.value && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
        alert('⚠️ Score must be between 0 and 10.');
        resetSaveBtn();
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
        resetSaveBtn();
      }
    }

    function resetSaveBtn() {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      saving = false;
    }
  }

  /**
   * Prompt user to authenticate (shown when clicking status without token).
   */
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
    message.textContent = 'You need to authenticate with AniList to edit your entries.';

    const featuresDiv = document.createElement('div');
    featuresDiv.className = 'zoro-auth-features';
    const featuresTitle = document.createElement('h4');
    featuresTitle.className = 'zoro-auth-features-title';
    featuresTitle.textContent = 'Features after authentication:';
    const featuresList = document.createElement('ul');
    featuresList.className = 'zoro-auth-feature-list';
    [
      'Edit progress, scores, and status',
      'Access private lists and profiles',
      'Quick progress buttons (+1, -1, Complete)',
      'Auto-detect your username',
      'Real-time updates'
    ].forEach(feature => {
      const li = document.createElement('li');
      li.textContent = feature;
      featuresList.appendChild(li);
    });
    featuresDiv.append(featuresTitle, featuresList);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'zoro-modal-buttons';
    const authBtn = document.createElement('button');
    authBtn.className = 'zoro-auth-button';
    authBtn.textContent = '🔑 Authenticate';
    authBtn.onclick = () => {
      closeModal();
      this.app.setting.openTabById(this.manifest.id);
      new Notice('📝 Please use Optional Login in settings to authenticate');
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-cancel-button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => closeModal();
    buttonContainer.append(authBtn, cancelBtn);

    content.append(title, message, featuresDiv, buttonContainer);
    modal.append(overlay, content);
    document.body.appendChild(modal);
    authBtn.focus();
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

  /**
   * Check if a media is already in the user's list.
   * @param {number} mediaId 
   * @param {string} mediaType 
   * @returns {Promise<boolean>}
   */
  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.settings.accessToken) return false;
    try {
      const config = { type: 'single', mediaType, mediaId: parseInt(mediaId) };
      const response = await this.fetchZoroData(config);
      return response.MediaList != null;
    } catch (error) {
      console.warn('Error checking media list status:', error);
      return false;
    }
  }

  /**
   * Add or update media entry in list.
   * @param {number} mediaId 
   * @param {object} updates 
   * @param {string} mediaType 
   */
  async addMediaToList(mediaId, updates, mediaType) {
    if (!this.settings.accessToken) {
      throw new Error('Authentication required');
    }
    // Using same GraphQL mutation as update
    return this.updateMediaListEntry(mediaId, updates);
  }

  /**
   * Update media list entry (status, score, progress).
   * @param {number} mediaId 
   * @param {{status:string,score:number,progress:number}} updates 
   */
  async updateMediaListEntry(mediaId, updates) {
    try {
      if (!this.settings.accessToken || !(await this.ensureValidToken())) {
        throw new Error('❌ Authentication required to update entries.');
      }
      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
            id status score progress
          }
        }
      `;
      const variables = {
        mediaId,
        ...(updates.status && { status: updates.status }),
        ...(updates.score != null && { score: updates.score }),
        ...(updates.progress != null && { progress: updates.progress })
      };
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.accessToken}`
        },
        body: JSON.stringify({ query: mutation, variables })
      }));
      const result = response.json;
      if (!result || result.errors?.length) {
        const message = result.errors?.[0]?.message || 'Unknown mutation error';
        throw new Error(`AniList update error: ${message}`);
      }
      this.clearCacheForMedia(mediaId);
      return result.data.SaveMediaListEntry;
    } catch (error) {
      console.error('[Zoro] updateMediaListEntry failed:', error);
      throw new Error(`❌ Failed to update entry: ${error.message}`);
    }
  }

  /**
   * Clear cache entries related to a specific media.
   * @param {number} mediaId 
   */
  clearCacheForMedia(mediaId) {
    for (const key of this.cache.mediaData.keys()) {
      try {
        const parsed = JSON.parse(key);
        if (parsed.mediaId === mediaId || parsed.id === mediaId) {
          this.cache.mediaData.delete(key);
        }
      } catch {
        if (key.includes(`mediaId":${mediaId}`) || key.includes(`"id":${mediaId}`)) {
          this.cache.mediaData.delete(key);
        }
      }
    }
    this.cache.userData.clear();
    console.log(`[Zoro] Cleared cache for media ${mediaId}`);
  }

  /**
   * Display error message element.
   * @param {HTMLElement} el 
   * @param {string} message 
   * @param {string} [context] 
   * @param {Function|null} [onRetry] 
   */
  renderError(el, message, context = '', onRetry = null) {
    el.empty?.();
    el.classList.add('zoro-error-container');
    const wrapper = document.createElement('div');
    wrapper.className = 'zoro-error-box';
    const title = document.createElement('strong');
    title.textContent = `❌ ${context || 'Something went wrong'}`;
    wrapper.appendChild(title);
    const msg = document.createElement('pre');
    msg.textContent = message;
    wrapper.appendChild(msg);
    if (this.settings.accessToken) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = () => new Notice('Retry not implemented yet');
      wrapper.appendChild(retryBtn);
    }
    if (typeof onRetry === 'function') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = onRetry;
      wrapper.appendChild(retryBtn);
    }
    el.appendChild(wrapper);
  }

  // === Utilities ===

  /**
   * Convert date object to string YYYY-MM-DD.
   */
  dateToString(dateObj) {
    if (!dateObj || !dateObj.year) return '';
    return `${dateObj.year}-${String(dateObj.month || 0).padStart(2, '0')}-${String(dateObj.day || 0).padStart(2, '0')}`;
  }

  /**
   * Escape CSV values.
   */
  csvEscape(str = '') {
    if (typeof str !== 'string') str = String(str);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Export user's lists to CSV.
   */
  async exportUnifiedListsToCSV() {
    let username = this.settings.authUsername || this.settings.defaultUsername;
    if (!username) {
      new Notice('Set a default username in settings first.', 4000);
      return;
    }
    const useAuth = !!this.settings.accessToken;
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

    const fetchType = async (type) => {
      const headers = { 'Content-Type': 'application/json' };
      if (useAuth) {
        await this.ensureValidToken();
        headers.Authorization = `Bearer ${this.settings.accessToken}`;
      }
      const res = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: query.replace('type: ANIME', `type: ${type}`),
          variables: { userName: username }
        })
      }));
      return res.json.data?.MediaListCollection?.lists || [];
    };

    const [animeLists, mangaLists] = await Promise.all([fetchType('ANIME'), fetchType('MANGA')]);
    const lists = [...animeLists, ...mangaLists];
    const rows = [];
    const headers = [
      'ListName','Status','Progress','Score','Repeat','StartedAt','CompletedAt',
      'MediaID','Type','Format','TitleRomaji','TitleEnglish','TitleNative',
      'Episodes','Chapters','Volumes','MediaStart','MediaEnd','AverageScore',
      'Genres','MainStudio','URL'
    ];
    rows.push(headers.join(','));

    for (const list of lists) {
      for (const e of list.entries) {
        const m = e.media;
        const row = [
          list.name, e.status, e.progress || 0, e.score || '', e.repeat || 0,
          this.dateToString(e.startedAt), this.dateToString(e.completedAt),
          m.id, m.type, m.format,
          this.csvEscape(m.title.romaji), this.csvEscape(m.title.english), this.csvEscape(m.title.native),
          m.episodes || '', m.chapters || '', m.volumes || '',
          this.dateToString(m.startDate), this.dateToString(m.endDate),
          m.averageScore || '', this.csvEscape((m.genres || []).join(';')),
          this.csvEscape(m.studios?.nodes?.[0]?.name || ''),
          this.csvEscape(this.getZoroUrl(m.id, m.type))
        ];
        rows.push(row.join(','));
      }
    }

    if (rows.length <= 1) {
      new Notice('No lists found (private or empty).', 4000);
      return;
    }
    const csv = rows.join('\n');
    const suffix = useAuth ? '' : '_PUBLIC';
    const fileName = `AniList_${username}${suffix}_${new Date().toISOString().slice(0,10)}.csv`;
    await this.app.vault.create(fileName, csv);
    new Notice(`✅ CSV saved to vault: ${fileName}`, 4000);
    await this.app.workspace.openLinkText(fileName, '', false);
  }

  /**
   * Log out and clear credentials.
   */
  async logOut() {
    this.settings.accessToken = '';
    this.settings.tokenExpiry = 0;
    this.settings.authUsername = '';
    this.settings.clientId = '';
    this.settings.clientSecret = '';
    await this.saveSettings();
    this.cache.userData.clear();
    this.cache.mediaData.clear();
    this.cache.searchResults.clear();
    new Notice('✅ Logged out & cleared credentials.', 3000);
  }

  /**
   * Build sort options from raw string.
   */
  _buildSortOptions(raw, context = {}) {
    let [f='', d='asc'] = raw.split('-', 2);
    let field = f.trim(), dir = d.trim().toLowerCase();
    if (!SORT_FIELDS[field]) field = '';
    if (!['asc','desc',''].includes(dir)) dir = 'asc';
    if (!field) return { field: '', dir: '', anilistSort: null };
    const map = context.type === 'search' ? ANILIST_SEARCH_SORT_MAP : ANILIST_SORT_MAP;
    const key = map[field];
    if (!key) return { field: '', dir: '', anilistSort: null };
    const suffix = dir === 'desc' ? '_DESC' : '_ASC';
    return { field, dir, anilistSort: key + suffix };
  }

  /**
   * Return names of available themes (CSS files).
   */
  async getAvailableThemes() {
    try {
      const themesDir = `${this.manifest.dir}/themes`;
      const { files } = await this.app.vault.adapter.list(themesDir);
      return files.filter(f => f.endsWith('.css')).map(f => f.replace('.css',''));
    } catch {
      return [];
    }
  }

  /**
   * Apply selected theme CSS scoped to Zoro.
   * @param {string} themeName 
   */
  async applyTheme(themeName) {
    const old = document.getElementById('zoro-theme');
    if (old) old.remove();
    if (!themeName) return;
    const cssPath = `${this.manifest.dir}/themes/${themeName}.css`;
    let rawCss;
    try {
      rawCss = await this.app.vault.adapter.read(cssPath);
    } catch (err) {
      console.warn('Zoro: theme file missing:', themeName, err);
      new Notice(`❌ Theme "${themeName}" not found`);
      return;
    }
    const style = document.createElement('style');
    style.id = 'zoro-theme';
    style.textContent = this.scopeCss(rawCss);
    document.head.appendChild(style);
  }

  /**
   * Scope CSS rules under .zoro-container.
   */
  scopeCss(rawCss, scope = '.zoro-container') {
    let css = rawCss.replace(/:root\b/g, scope);
    css = css.replace(/(^|})(\s*)([^{@}][^{}]*?)\s*\{/g,
      (_, prefix, ws, selectorText) => {
        const scoped = selectorText.split(',').map(s => {
          const sel = s.trim();
          return sel.startsWith(scope) ? sel : `${scope} ${sel}`;
        }).join(', ');
        return `${prefix}${ws}${scoped} {`;
      });
    return css;
  }
}

// === Modal/UI Component Classes ===

/**
 * Modal for entering Client ID in settings.
 */
class ClientIdModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    contentEl.createEl('h2', { text: '🔑 Enter Client ID' });
    const desc = contentEl.createEl('p', { cls: 'auth-modal-desc', text: 'Enter your AniList Client ID' });
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = inputContainer.createEl('input', { type: 'text', placeholder: 'Client ID', cls: 'auth-input' });
    const btnContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    const submitButton = btnContainer.createEl('button', { text: 'Save', cls: 'mod-cta auth-button' });
    const cancelButton = btnContainer.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    submitButton.onClickEvent(() => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    cancelButton.onClickEvent(() => this.close());
    input.onKeyPressEvent(e => {
      if (e.key === 'Enter') submitButton.click();
    });
    setTimeout(() => input.focus(), 100);
  }
}

/**
 * Modal for entering Client Secret in settings.
 */
class ClientSecretModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    contentEl.createEl('h2', { text: '🔐 Enter Client Secret' });
    const desc = contentEl.createEl('p', { cls: 'auth-modal-desc', text: 'Enter your AniList Client Secret' });
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = inputContainer.createEl('input', { type: 'password', placeholder: 'Client Secret', cls: 'auth-input' });
    const btnContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    const submitButton = btnContainer.createEl('button', { text: 'Save', cls: 'mod-cta auth-button' });
    const cancelButton = btnContainer.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    submitButton.onClickEvent(() => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    cancelButton.onClickEvent(() => this.close());
    input.onKeyPressEvent(e => {
      if (e.key === 'Enter') submitButton.click();
    });
    setTimeout(() => input.focus(), 100);
  }
}

/**
 * Modal for pasting authentication PIN.
 */
class AuthPinModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal pin-modal');
    contentEl.createEl('h2', { text: '🔓 Complete Authentication' });
    contentEl.createEl('p', {
      cls: 'auth-modal-desc',
      text: 'Copy the authorization code from the browser and paste it below'
    });
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = inputContainer.createEl('input', {
      type: 'text',
      placeholder: 'Paste authorization code here',
      cls: 'auth-input pin-input'
    });
    const btnContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    const submitButton = btnContainer.createEl('button', { text: '✅ Complete Authentication', cls: 'mod-cta auth-button submit-button' });
    const cancelButton = btnContainer.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    submitButton.onClickEvent(() => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    cancelButton.onClickEvent(() => this.close());
    input.onKeyPressEvent(e => {
      if (e.key === 'Enter') submitButton.click();
    });
    input.onInputEvent(e => {
      if (e.target.value.trim()) {
        submitButton.addClass('ready');
      } else {
        submitButton.removeClass('ready');
      }
    });
    setTimeout(() => input.focus(), 100);
  }
}

/**
 * Plugin settings tab UI.
 */
class ZoroSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /**
   * Display the settings UI.
   */
  display() {
    const { containerEl } = this;
    containerEl.empty();

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
    const UI = section('🎨 Appearance');
    const Theme = section('🌌 Theme');
    const Data = section('📤 Your Data');
    const Guide = section('🧭 Guide');

    // Username setting
    new Setting(Account)
      .setName('🆔 Username')
      .setDesc('Allows access to your public profile and stats.')
      .addText(text => text
        .setPlaceholder('Enter your AniList username')
        .setValue(this.plugin.settings.defaultUsername)
        .onChange(async (value) => {
          this.plugin.settings.defaultUsername = value.trim();
          await this.plugin.saveSettings();
        }));

    // Authentication buttons
    const authSetting = new Setting(Account)
      .setName('🔓 Optional Login')
      .setDesc('Access private data and edit your lists.');
    authSetting.addButton(button => {
      this.authButton = button;
      this.updateAuthButton();
      button.onClick(async () => {
        await this.handleAuthButtonClick();
      });
    });

    new Setting(Account)
      .addButton(btn => btn
        .setButtonText('Log out')
        .setWarning()
        .onClick(async () => {
          await this.plugin.logOut();
          this.updateAuthButton();
        }));

    // UI settings
    new Setting(UI)
      .setName('🧊 Layout')
      .setDesc('Default layout for media lists')
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
      .setDesc('Number of columns in card layout')
      .addSlider(slider => slider
        .setLimits(1, 6, 1)
        .setValue(this.plugin.settings.gridColumns)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.gridColumns = value;
          await this.plugin.saveSettings();
        }));

    new Setting(UI)
      .setName('Sort by')
      .addDropdown(drop => {
        Object.entries(SORT_FIELDS).forEach(([k, { label }]) => drop.addOption(k, label));
        drop.setValue(this.plugin.settings.defaultSortField);
        drop.onChange(async v => {
          this.plugin.settings.defaultSortField = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(UI)
      .setName('Sort direction')
      .addDropdown(drop => {
        drop.addOption('', 'Default')
          .addOption('asc', 'Ascending ↑')
          .addOption('desc', 'Descending ↓')
          .setValue(this.plugin.settings.defaultSortDir)
          .onChange(async v => {
            this.plugin.settings.defaultSortDir = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(UI)
      .setName('🌆 Cover')
      .setDesc('Display cover images')
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

    // Data export
    new Setting(Data)
      .setName('🧾 Export your data')
      .setDesc('Export your AniList data to a CSV file.')
      .addButton(btn => btn
        .setButtonText('Export')
        .setClass('mod-cta')
        .onClick(async () => {
          try {
            await this.plugin.exportUnifiedListsToCSV();
          } catch (err) {
            new Notice(`❌ Export failed: ${err.message}`, 6000);
          }
        }));

    // Theme selection
    new Setting(Theme)
      .setName('Select Theme')
      .setDesc('Custom CSS theme (from /themes folder)')
      .addDropdown(async dropdown => {
        dropdown.addOption('', 'None (built-in)');
        const themes = await this.plugin.getAvailableThemes();
        themes.forEach(t => dropdown.addOption(t, t));
        dropdown.setValue(this.plugin.settings.theme);
        dropdown.onChange(async value => {
          this.plugin.settings.theme = value;
          await this.plugin.saveSettings();
          await this.plugin.applyTheme(value);
        });
      });

    // Sample notes
    new Setting(Guide)
      .setName('🍜 Sample Notes')
      .setDesc('Create sample Anime/Manga dashboard notes.')
      .addButton(button => button
        .setButtonText('Create Note')
        .setTooltip('Click to create sample notes')
        .onClick(async () => {
          await this.plugin.createSampleNotes();
          this.display();
        }));

    // Setup guide
    new Setting(Guide)
      .setName('🗝️ Need a Client ID?')
      .setDesc('Open guide for generating AniList Client ID/Secret.')
      .addButton(button => button
        .setButtonText('Setup Guide')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md', '_blank');
        }));

    new Setting(Guide)
      .addButton(button => button
        .setButtonText('Help & feedback')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/README.md', '_blank');
        }));
  }

  /**
   * Update the authentication button text in settings.
   */
  updateAuthButton() {
    if (!this.authButton) return;
    const settings = this.plugin.settings;
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
      const expiryDate = new Date(settings.tokenExpiry).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric'
      });
      this.authButton.setButtonText(`✅`);
      this.authButton.setCta();
    }
  }

  /**
   * Handle clicks on the authentication button.
   */
  async handleAuthButtonClick() {
    const settings = this.plugin.settings;
    if (!settings.clientId) {
      new ClientIdModal(this.app, async (clientId) => {
        this.plugin.settings.clientId = clientId.trim();
        await this.plugin.saveSettings();
        this.updateAuthButton();
      }).open();
    } else if (!settings.clientSecret) {
      new ClientSecretModal(this.app, async (clientSecret) => {
        this.plugin.settings.clientSecret = clientSecret.trim();
        await this.plugin.saveSettings();
        this.updateAuthButton();
      }).open();
    } else if (!settings.accessToken) {
      await this.plugin.authenticateUser();
    } else {
      await this.plugin.authenticateUser();
    }
  }
}

module.exports = {
  default: ZoroPlugin
};

Sources



No file chosenNo file chosen
ChatGPT can make mistakes. Check important info. See Cookie Preferences.

// Zoro Plugin for Obsidian (AniList integration)
// Provides AniList user stats, lists, search, and editor functionalities within Obsidian.

const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

// === Constants ===

const DEFAULT_SETTINGS = {
  defaultUsername: '',
  defaultLayout: 'card',
  defaultSortField: '',
  defaultSortDir: '',
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  gridColumns: 2,
  theme: '',
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: ''
};

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

// For media list queries (same mapping as search)
const ANILIST_SORT_MAP = { ...ANILIST_SEARCH_SORT_MAP };

/**
 * Sort entries by given field and direction.
 * @param {Array} entries 
 * @param {{field:string, dir:string}} options 
 * @returns {Array}
 */
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
      case 'score':       return e.score != null ? e.score : -1;
      case 'popularity':  return m.popularity || 0;
      case 'trending':    return m.trending || 0;
      case 'favourites':  return m.favourites || 0;
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

// === Helper Classes ===

/**
 * Rate-limited request queue for AniList API calls.
 */
class RequestQueue {
  constructor() {
    this.queue = [];
    this.delay = 700; // ~85 requests/min
    this.isProcessing = false;
  }

  /**
   * Add a request function to the queue.
   * @param {Function} requestFn 
   */
  add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  }

  /**
   * Process the next request in the queue after delay.
   */
  async process() {
    if (this.isProcessing || !this.queue.length) return;
    this.isProcessing = true;
    const { requestFn, resolve, reject } = this.queue.shift();
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
      document.body.removeChild(loader);
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }
}

// === Main Plugin Class ===

class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    // Initialize cache
    this.cache = {
      userData: new Map(),
      mediaData: new Map(),
      searchResults: new Map()
    };
    this.requestQueue = new RequestQueue();
    this.cacheTimeout = 4 * 60 * 1000; // 4 min
    // Periodic cache pruning
    this.pruneInterval = setInterval(() => this.pruneCache(), this.cacheTimeout);
  }

  // === Lifecycle ===

  /**
   * Prune expired entries from all caches.
   */
  pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache.userData) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.userData.delete(key);
      }
    }
    for (const [key, entry] of this.cache.mediaData) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.mediaData.delete(key);
      }
    }
    for (const [key, entry] of this.cache.searchResults) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.searchResults.delete(key);
      }
    }
    console.log('[Zoro] Cache pruned');
  }

  /**
   * Called when plugin is enabled: loads settings, injects CSS, registers processors.
   */
  async onload() {
    console.log('[Zoro] Plugin loading...');
    try {
      await this.loadSettings();
      console.log('[Zoro] Settings loaded.');
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }

    try {
      this.injectCSS();
      console.log('[Zoro] CSS injected.');
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }

    await this.applyTheme(this.settings.theme);

    // Register code block and link processors
    this.registerMarkdownCodeBlockProcessor('zoro', this.processZoroCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processZoroSearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    this.addSettingTab(new ZoroSettingTab(this.app, this));
    console.log('[Zoro] Plugin loaded successfully.');
  }

  /**
   * Called when plugin is disabled: remove styles and intervals.
   */
  onunload() {
    console.log('Unloading Zoro Plugin');
    const styleEl = document.getElementById('zoro-plugin-styles');
    if (styleEl) {
      styleEl.remove();
      console.log(`Removed style element: zoro-plugin-styles`);
    }
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    this.cache.userData.clear();
    this.cache.mediaData.clear();
    this.cache.searchResults.clear();
  }

  // === Settings ===

  /**
   * Validate loaded settings.
   * @param {object} settings 
   */
  validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'table'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      defaultSortField: (typeof settings?.defaultSortField === 'string' &&
        (settings.defaultSortField === '' || SORT_FIELDS[settings.defaultSortField])) ?
        settings.defaultSortField : '',
      defaultSortDir: ['asc', 'desc', ''].includes(settings?.defaultSortDir) ? settings.defaultSortDir : '',
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : 3,
      theme: typeof settings?.theme === 'string' ? settings.theme : '',
      showCoverImages: !!settings?.showCoverImages,
      showRatings: !!settings?.showRatings,
      showProgress: !!settings?.showProgress,
      showGenres: !!settings?.showGenres,
      clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
      clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
      redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
      accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : ''
    };
  }

  /**
   * Save plugin settings to storage.
   */
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

  /**
   * Load settings and prompt for missing client secret.
   */
  async loadSettings() {
    const saved = await this.loadData() || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);

    if (!this.settings.clientSecret) {
      const secret = await this.promptForCode('Enter your AniList client secret:');
      if (secret) {
        this.settings.clientSecret = secret.trim();
        await this.saveData(this.settings);
      }
    }
  }

  // === Authentication ===

  /**
   * Initiate AniList OAuth authentication flow.
   */
  async authenticateUser() {
    const clientId = this.settings.clientId;
    const redirectUri = this.settings.redirectUri || DEFAULT_SETTINGS.redirectUri;

    if (!clientId) {
      new Notice('❌ Please set your Client ID in plugin settings first.', 5000);
      return;
    }
    if (this.settings.accessToken) {
      const reuse = confirm('Do you want to re-authenticate?');
      if (!reuse) return;
    }

    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    try {
      new Notice('🔐 Opening authentication page...', 3000);
      window.addEventListener('message', this.handleAuthMessage.bind(this));

      if (window.require) {
        const { shell } = window.require('electron');
        await shell.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }

      const code = await this.promptForCode('Paste the PIN code from the authentication page:');
      if (!code?.trim()) {
        new Notice('⚠️ No code entered. Authentication cancelled.', 4000);
        return;
      }
      await this.exchangeCodeForToken(code.trim(), redirectUri);
      new Notice('✅ Authenticated successfully.', 4000);
    } catch (error) {
      console.error('[Zoro] Authentication failed:', error);
      new Notice(`❌ Authentication error: ${error.message}`, 5000);
    }
  }

  /**
   * Exchange authorization code for access token.
   * @param {string} code 
   * @param {string} redirectUri 
   */
  async exchangeCodeForToken(code, redirectUri) {
    const clientId = this.settings.clientId;
    const clientSecret = this.settings.clientSecret;
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret || '',
      redirect_uri: redirectUri
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' };

    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://anilist.co/api/v2/oauth/token',
        method: 'POST',
        headers,
        body: params.toString()
      }));
      const data = response.json;

      if (!data || typeof data !== 'object') {
        console.error('[Zoro] Unexpected response from server:', response);
        throw new Error('⚠️ Invalid response from server.');
      }
      if (!data.access_token) {
        throw new Error(data.error_description || '❌ No access token returned by server.');
      }

      this.settings.accessToken = data.access_token;
      if (data.expires_in) {
        this.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
      }
      await this.saveSettings();
      new Notice('✅ Successfully authenticated with AniList!', 4000);
      if (this.testAccessToken) {
        await this.testAccessToken();
      }
    } catch (err) {
      console.error('[Zoro] Authentication error:', err);
      new Notice(`❌ Authentication failed: ${err.message}`, 5000);
    }
  }

  /**
   * Validate that an access token exists.
   * @returns {boolean}
   */
  async ensureValidToken() {
    return !!this.settings.accessToken;
  }

  /**
   * Test the access token by fetching viewer data.
   */
  async testAccessToken() {
    const query = `
      query {
        Viewer { id name }
      }
    `;
    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer ${this.settings.accessToken}\`
        },
        body: JSON.stringify({ query })
      }));
      const data = response.json;
      if (!data?.data?.Viewer) {
        throw new Error('Invalid access token or response malformed.');
      }
      const username = data.data.Viewer.name;
      new Notice(\`🎉 Welcome, ${username}! Token is valid.\`);
    } catch (error) {
      console.warn('[Zoro] testAccessToken failed:', error);
      throw new Error('Token verification failed. Please re-authenticate.');
    }
  }

  /**
   * Get authenticated user name.
   * @returns {Promise<string|null>}
   */
  async getAuthenticatedUsername() {
    if (!this.settings.accessToken) return null;
    await this.ensureValidToken();
    const query = `
      query { Viewer { name } }
    `;
    try {
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer ${this.settings.accessToken}\`
        },
        body: JSON.stringify({ query })
      }));
      const data = response.json;
      if (!data?.data?.Viewer?.name) {
        throw new Error('Invalid token or no username returned.');
      }
      this.settings.authUsername = data.data.Viewer.name;
      await this.saveSettings();
      return data.data.Viewer.name;
    } catch (error) {
      console.warn('[Zoro] getAuthenticatedUsername failed:', error);
      return null;
    }
  }

  /**
   * Prompt user for input (used for codes).
   * @param {string} message 
   */
  async promptForCode(message) {
    return new Promise((resolve) => {
      const code = prompt(message);
      resolve(code);
    });
  }

  // === Data Fetching ===

  /**
   * Fetch data from AniList via GraphQL.
   * Caches results based on config type.
   * @param {object} config 
   */
  async fetchZoroData(config) {
    const cacheKey = JSON.stringify(config);
    let cacheType;
    if (config.type === 'stats') cacheType = 'userData';
    else if (config.type === 'single') cacheType = 'mediaData';
    else if (config.type === 'search') cacheType = 'searchResults';
    else cacheType = 'userData';

    const cached = this.getFromCache(cacheType, cacheKey);
    if (cached) return cached;

    try {
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (this.settings.accessToken) {
        await this.ensureValidToken();
        headers.Authorization = \`Bearer ${this.settings.accessToken}\`;
      }

      let query, variables;
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
        query = this.getSearchMediaQuery();
        variables = {
          search: config.search,
          type: config.mediaType,
          page: config.page || 1,
          perPage: config.perPage || 5,
          sort: config.sortOptions?.anilistSort ? [config.sortOptions.anilistSort] : null
        };
      } else {
        query = this.getMediaListQuery();
        variables = {
          username: config.username,
          status: config.listType,
          type: config.mediaType || 'ANIME',
          sort: config.sortOptions?.anilistSort ? [config.sortOptions.anilistSort] : null
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
      if (result.errors?.length) {
        const errMsg = result.errors[0]?.message || 'Unknown error.';
        const isPrivate = errMsg.includes('Private') || errMsg.includes('permission');
        if (isPrivate) {
          if (this.settings.accessToken) {
            throw new Error('🚫 List is private and token has no permission.');
          } else {
            throw new Error('🔒 List is private. Please authenticate to access it.');
          }
        }
        throw new Error(errMsg);
      }
      if (!result.data) {
        throw new Error('AniList returned no data.');
      }

      this.setToCache(cacheType, cacheKey, result.data);
      return result.data;
    } catch (error) {
      console.error('[Zoro] fetchZoroData failed:', error);
      throw error;
    }
  }

  /**
   * Build GraphQL query for media list.
   * @param {string} layout 
   * @returns {string}
   */
  getMediaListQuery(layout = 'card') {
    const baseFields = `
      id
      status
      score
      progress
    `;
    const mediaFieldsByLayout = {
      compact: `
        id
        title { romaji }
        coverImage { medium }
      `,
      card: `
        id
        title { romaji english native }
        coverImage { large medium }
        format
        averageScore
        status
        genres
        episodes
        chapters
      `,
      full: `
        id
        title { romaji english native }
        coverImage { large medium }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate { year month day }
        endDate { year month day }
      `
    };
    const fields = mediaFieldsByLayout[layout] || mediaFieldsByLayout.card;
    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType, $sort: [MediaListSort]) {
        MediaListCollection(userName: $username, status: $status, type: $type, sort: $sort) {
          lists {
            entries {
              ${baseFields}
              media { ${fields} }
            }
          }
        }
      }
    `;
  }

  /**
   * Build GraphQL query for single media entry.
   * @param {string} layout 
   * @returns {string}
   */
  getSingleMediaQuery(layout = 'card') {
    const baseFields = `
      id
      status
      score
      progress
    `;
    const mediaFieldsByLayout = {
      compact: `
        id
        title { romaji }
        coverImage { medium }
      `,
      card: `
        id
        title { romaji english native }
        coverImage { large medium }
        format
        averageScore
        status
        genres
        episodes
        chapters
      `,
      full: `
        id
        title { romaji english native }
        coverImage { large medium }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate { year month day }
        endDate { year month day }
      `
    };
    const fields = mediaFieldsByLayout[layout] || mediaFieldsByLayout.card;
    return `
      query ($username: String, $mediaId: Int, $type: MediaType) {
        MediaList(userName: $username, mediaId: $mediaId, type: $type) {
          ${baseFields}
          media { ${fields} }
        }
      }
    `;
  }

  /**
   * Build GraphQL query for user statistics.
   * @param {{mediaType:string,layout:string,useViewer:boolean}} [opts]
   * @returns {string}
   */
  getUserStatsQuery({ mediaType = 'ANIME', layout = 'card', useViewer = false } = {}) {
    const typeKey = mediaType.toLowerCase();
    const statFieldsByLayout = {
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
    const fields = statFieldsByLayout[layout] || statFieldsByLayout.card;
    const viewerPrefix = useViewer ? 'Viewer' : `User(name: $username)`;
    return `
      query ($username: String) {
        ${viewerPrefix} {
          id
          name
          avatar { large medium }
          statistics {
            ${typeKey} { ${fields} }
          }
        }
      }
    `;
  }

  /**
   * Build GraphQL query for media search.
   * @param {string} layout 
   * @returns {string}
   */
  getSearchMediaQuery(layout = 'card') {
    const mediaFieldsByLayout = {
      compact: `
        id
        title { romaji }
        coverImage { medium }
      `,
      card: `
        id
        title { romaji english native }
        coverImage { large medium }
        format
        averageScore
        status
        genres
        episodes
        chapters
      `,
      full: `
        id
        title { romaji english native }
        coverImage { large medium }
        episodes
        chapters
        genres
        format
        averageScore
        status
        startDate { year month day }
        endDate { year month day }
      `
    };
    const fields = mediaFieldsByLayout[layout] || mediaFieldsByLayout.card;
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

  /**
   * Construct AniList URL for media.
   * @param {number} mediaId 
   * @param {string} mediaType 
   * @returns {string}
   */
  getZoroUrl(mediaId, mediaType = 'ANIME') {
    if (!mediaId || typeof mediaId !== 'number') {
      throw new Error(`Invalid mediaId: ${mediaId}`);
    }
    const type = String(mediaType).toUpperCase();
    const validTypes = ['ANIME', 'MANGA'];
    const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime';
    return `https://anilist.co/${urlType}/${mediaId}`;
  }

  // === UI Rendering ===

  /**
   * Process standard code block with 'zoro'.
   */
  async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source) || {};
      console.log('[Zoro] Code block config:', config);

      if (config.useAuthenticatedUser) {
        const authUsername = await this.getAuthenticatedUsername();
        if (!authUsername) {
          throw new Error('❌ Could not retrieve authenticated username. Check auth setup or set username manually.');
        }
        config.username = authUsername;
      }

      if (!config.username) {
        throw new Error('❌ No username provided. Set `username:` or enable `useAuthenticatedUser`.');
      }

      const data = await this.fetchZoroData(config);
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('⚠️ No data returned from Zoro API.');
      }
      this.renderZoroData(el, data, config);
    } catch (error) {
      console.error('[Zoro] Code block error:', error);
      this.renderError(el, error.message || 'Unknown error occurred.');
    }
  }

  /**
   * Process 'zoro-search' code block.
   */
  async processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
      if (this.settings.debugMode) console.log('[Zoro] Search block config:', config);
      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      await this.renderSearchInterface(el, config);
    } catch (error) {
      console.error('[Zoro] Search block error:', error);
      this.renderError(el, error.message || 'Failed to process Zoro search block.');
    }
  }

  /**
   * Process inline links starting with 'zoro:'.
   */
  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="zoro:"]');
    for (const link of inlineLinks) {
      const href = link.getAttribute('href');
      const placeholder = document.createElement('span');
      placeholder.textContent = '🔄 Loading Zoro...';
      link.replaceWith(placeholder);
      try {
        const config = this.parseInlineLink(href);
        const data = await this.fetchZoroData(config);
        const container = document.createElement('span');
        container.className = 'zoro-inline-container';
        this.renderZoroData(container, data, config);
        placeholder.replaceWith(container);
        ctx.addChild({ unload: () => { container.remove(); } });
      } catch (error) {
        console.warn(`[Zoro] Inline link failed for ${href}:`, error);
        const errorEl = document.createElement('span');
        errorEl.className = 'zoro-inline-error';
        errorEl.textContent = `⚠️ ${error.message || 'Failed to load data'}`;
        placeholder.replaceWith(errorEl);
      }
    }
  }

  /**
   * Parse code block content into config object.
   * @param {string} source 
   */
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
      if (this.settings.defaultUsername) {
        config.username = this.settings.defaultUsername;
      } else if (this.settings.accessToken) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('Username is required. Please set a default in settings, authenticate, or specify one.');
      }
    }
    config.listType = config.listType || 'CURRENT';
    config.layout = config.layout || this.settings.defaultLayout;
    config.mediaType = config.mediaType || 'ANIME';
    const sortRaw = (config.sort || '').trim();
    config.sortOptions = sortRaw ? this._buildSortOptions(sortRaw, config) :
      this._buildSortOptions(`${this.settings.defaultSortField}-${this.settings.defaultSortDir}`, config);
    return config;
  }

  /**
   * Parse 'zoro-search' code block config.
   * @param {string} source 
   */
  parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const lines = source.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    config.layout = config.layout || this.settings.defaultLayout || 'card';
    config.mediaType = config.mediaType || 'ANIME';
    const sortRaw = (config.sort || '').trim();
    config.sortOptions = sortRaw ?
      this._buildSortOptions(sortRaw, config) :
      this._buildSortOptions(`${this.settings.defaultSortField}-${this.settings.defaultSortDir}`, config);
    return config;
  }

  /**
   * Parse inline 'zoro:' link into config.
   * @param {string} href 
   */
  parseInlineLink(href) {
    const [base, hash] = href.replace('zoro:', '').split('#');
    const parts = base.split('/');
    let username, pathParts;
    if (parts[0] === '') {
      if (!this.settings.defaultUsername) {
        throw new Error('⚠️ Default username not set. Configure it in settings.');
      }
      username = this.settings.defaultUsername;
      pathParts = parts.slice(1);
    } else {
      if (parts.length < 2) {
        throw new Error('❌ Invalid Zoro inline link format.');
      }
      username = parts[0];
      pathParts = parts.slice(1);
    }
    const config = { username, layout: 'card', type: 'list' };
    const main = pathParts[0], second = pathParts[1];
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
        if (['compact','card','minimal','full'].includes(mod)) {
          config.layout = mod;
        }
        if (mod === 'nocache') {
          config.nocache = true;
        }
      }
    }
    return config;
  }

  /**
   * Render search UI in code block.
   * @param {HTMLElement} el 
   * @param {object} config 
   */
  renderSearchInterface(el, config) {
    el.empty();
    el.className = 'zoro-search-container';
    const searchDiv = document.createElement('div');
    searchDiv.className = 'zoro-search-input-container';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'zoro-search-input';
    searchInput.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';
    searchDiv.appendChild(searchInput);
    el.appendChild(searchDiv);

    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'zoro-search-results';
    el.appendChild(resultsDiv);

    let timeout;
    const performSearch = async () => {
      const term = searchInput.value.trim();
      if (term.length < 3) {
        resultsDiv.innerHTML = '<div class="zoro-search-message">Type at least 3 characters to search...</div>';
        return;
      }
      try {
        resultsDiv.innerHTML = '<div class="zoro-search-loading">Searching...</div>';
        const searchConfig = { ...config, search: term, page: 1, perPage: 5 };
        const data = await this.fetchZoroData(searchConfig);
        this.renderSearchResults(resultsDiv, data.Page.media, config);
      } catch (err) {
        this.renderError(resultsDiv, err.message);
      }
    };

    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(performSearch, 300);
    });
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });
  }

  /**
   * Render search results cards.
   */
  renderSearchResults(el, media, config) {
    el.empty();
    if (media.length === 0) {
      el.innerHTML = '<div class="zoro-search-message">No results found.</div>';
      return;
    }
    const sorted = sortEntries(media, config.sortOptions);
    const gridDiv = document.createElement('div');
    gridDiv.className = 'zoro-cards-grid';
    gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);

    sorted.forEach(async (item) => {
      const title = item.title.english || item.title.romaji || '';
      const cardDiv = document.createElement('div');
      cardDiv.className = 'zoro-card';
      if (this.settings.showCoverImages && item.coverImage) {
        const img = document.createElement('img');
        img.src = item.coverImage.large;
        img.alt = title;
        img.className = 'media-cover';
        cardDiv.appendChild(img);
      }
      const mediaInfoDiv = document.createElement('div');
      mediaInfoDiv.className = 'media-info';

      // Title
      const titleEl = document.createElement('h4');
      const titleLink = document.createElement('a');
      titleLink.href = this.getZoroUrl(item.id, config.mediaType);
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleEl.appendChild(titleLink);
      mediaInfoDiv.appendChild(titleEl);

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

      // Add button
      const addBadge = document.createElement('span');
      addBadge.textContent = 'ADD';
      addBadge.className = 'status-badge status-planning clickable-status';
      addBadge.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        addBadge.textContent = 'Adding…';
        addBadge.style.pointerEvents = 'none';
        try {
          await this.addMediaToList(item.id, { status: 'PLANNING', progress: 0 }, config.mediaType);
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

      if (this.settings.showRatings && item.averageScore) {
        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'score';
        scoreSpan.textContent = `★ ${item.averageScore}`;
        detailsDiv.appendChild(scoreSpan);
      }
      mediaInfoDiv.appendChild(detailsDiv);

      if (this.settings.showGenres && item.genres) {
        const genresDiv = document.createElement('div');
        genresDiv.className = 'genres';
        item.genres.slice(0, 3).forEach(genre => {
          const tag = document.createElement('span');
          tag.className = 'genre-tag';
          tag.textContent = genre;
          genresDiv.appendChild(tag);
        });
        mediaInfoDiv.appendChild(genresDiv);
      }

      cardDiv.appendChild(mediaInfoDiv);
      gridDiv.appendChild(cardDiv);

      // Update add button if already in list
      if (this.settings.accessToken) {
        this.checkIfMediaInList(item.id, config.mediaType).then(inList => {
          if (inList) {
            addBadge.textContent = 'IN LIST';
            addBadge.style.backgroundColor = '#999';
            addBadge.style.cursor = 'not-allowed';
            addBadge.title = 'Already in your list';
            addBadge.onclick = null;
          }
        });
      }
    });

    el.appendChild(gridDiv);
  }

  /**
   * Render data based on config type.
   */
  renderZoroData(el, data, config) {
    el.empty();
    el.className = 'zoro-container';
    if (config.type === 'stats') {
      this.renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      this.renderSingleMedia(el, data.MediaList, config);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
      if (config.layout === 'table') {
        this.renderTableLayout(el, entries, config);
      } else {
        this.renderMediaList(el, entries, config);
      }
    }
  }

  /**
   * Display user statistics (anime/manga).
   */
  renderUserStats(el, user) {
    if (!user || !user.statistics) {
      this.renderError(el, 'User statistics unavailable.');
      return;
    }
    const safe = (val, fb = '—') => (val != null ? val : fb);

    const createItem = (label, value) => {
      const item = document.createElement('div');
      item.className = 'zoro-stat-item';
      item.innerHTML = `<span>${label}:</span><span>${value}</span>`;
      return item;
    };

    const createSection = (title, stats) => {
      const section = document.createElement('div');
      section.className = 'zoro-stat-section';
      const heading = document.createElement('h4');
      heading.textContent = title;
      section.appendChild(heading);
      for (const [key, label] of Object.entries({
        count: 'Count',
        episodesWatched: 'Episodes',
        minutesWatched: 'Minutes',
        meanScore: 'Mean Score',
        chaptersRead: 'Chapters',
        volumesRead: 'Volumes'
      })) {
        if (stats[key] !== undefined) {
          section.appendChild(createItem(label, stats[key].toLocaleString?.() || stats[key]));
        }
      }
      return section;
    };

    const container = document.createElement('div');
    container.className = 'zoro-user-stats';
    const header = document.createElement('div');
    header.className = 'zoro-user-header';
    header.innerHTML = `
      <img src="${user.avatar?.medium || ''}" alt="${user.name || ''}" class="zoro-user-avatar">
      <h3>${user.name || ''}</h3>
    `;
    const statsGrid = document.createElement('div');
    statsGrid.className = 'zoro-stats-grid';
    statsGrid.appendChild(createSection('Anime', user.statistics.anime || {}));
    statsGrid.appendChild(createSection('Manga', user.statistics.manga || {}));
    container.appendChild(header);
    container.appendChild(statsGrid);
    el.appendChild(container);
  }

  /**
   * Render single media card view.
   */
  renderSingleMedia(el, mediaList, config) {
    const media = mediaList.media;
    const title = media.title.english || media.title.romaji || '';
    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-single-card';
    if (this.settings.showCoverImages) {
      const img = document.createElement('img');
      img.src = media.coverImage.large;
      img.alt = title;
      img.className = 'media-cover';
      cardDiv.appendChild(img);
    }
    const mediaInfoDiv = document.createElement('div');
    mediaInfoDiv.className = 'media-info';
    const titleEl = document.createElement('h3');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'zoro-title-link';
    titleLink.textContent = title;
    titleEl.appendChild(titleLink);
    mediaInfoDiv.appendChild(titleEl);

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'media-details';
    if (media.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = media.format;
      detailsDiv.appendChild(formatBadge);
    }
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${mediaList.status.toLowerCase()}`;
    statusBadge.textContent = mediaList.status;
    detailsDiv.appendChild(statusBadge);

    if (this.settings.showProgress) {
      const progressSpan = document.createElement('span');
      progressSpan.className = 'progress';
      const total = media.episodes || media.chapters || '?';
      progressSpan.textContent = `${mediaList.progress}/${total}`;
      detailsDiv.appendChild(progressSpan);
    }

    if (this.settings.showRatings && mediaList.score != null) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${mediaList.score}`;
      detailsDiv.appendChild(scoreSpan);
    }
    mediaInfoDiv.appendChild(detailsDiv);

    if (this.settings.showGenres) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres';
      media.genres.slice(0, 3).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = genre;
        genresDiv.appendChild(tag);
      });
      mediaInfoDiv.appendChild(genresDiv);
    }

    cardDiv.appendChild(mediaInfoDiv);
    el.appendChild(cardDiv);
  }

  /**
   * Render list of media entries in grid.
   */
  renderMediaList(el, entries, config) {
    const sorted = sortEntries(entries, config.sortOptions);
    const gridDiv = document.createElement('div');
    gridDiv.className = 'zoro-cards-grid';
    gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);
    sorted.forEach(entry => {
      const card = this.createMediaCard(entry, config);
      gridDiv.appendChild(card);
    });
    el.empty();
    el.appendChild(gridDiv);
  }

  /**
   * Create a card element for a media entry.
   */
  createMediaCard(entry, config) {
    const media = entry.media;
    if (!media) return document.createTextNode('⚠️ Missing media');

    const title = media.title.english || media.title.romaji || 'Untitled';
    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-card';

    if (this.settings.showCoverImages && media.coverImage?.large) {
      const img = document.createElement('img');
      img.src = media.coverImage.large;
      img.alt = title;
      img.className = 'media-cover';
      cardDiv.appendChild(img);
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'media-info';

    const titleEl = document.createElement('h4');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link';
    titleLink.textContent = title;
    titleEl.appendChild(titleLink);
    infoDiv.appendChild(titleEl);

    const detailsDiv = this.createDetailsRow(entry);
    infoDiv.appendChild(detailsDiv);

    if (this.settings.showGenres && media.genres?.length) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres';
      media.genres.slice(0, 3).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = genre;
        genresDiv.appendChild(tag);
      });
      infoDiv.appendChild(genresDiv);
    }

    cardDiv.appendChild(infoDiv);
    return cardDiv;
  }

  /**
   * Create media details row with status, progress, score badges.
   */
  createDetailsRow(entry) {
    const media = entry.media;
    const details = document.createElement('div');
    details.className = 'media-details';

    // Format badge
    if (media.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = media.format;
      details.appendChild(formatBadge);
    }

    // Status badge (clickable)
    const status = document.createElement('span');
    status.className = `status-badge status-${entry.status?.toLowerCase()} clickable-status`;
    status.textContent = entry.status || 'Unknown';
    status.style.cursor = 'pointer';
    if (this.settings.accessToken) {
      status.title = 'Click to edit';
      status.onclick = (e) => this.handleEditClick(e, entry, status);
    } else {
      status.title = 'Click to authenticate';
      status.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.createAuthenticationPrompt();
      };
    }
    details.appendChild(status);

    // Progress badge
    if (this.settings.showProgress) {
      const progress = document.createElement('span');
      progress.className = 'progress';
      const total = media.episodes ?? media.chapters ?? '?';
      progress.textContent = `${entry.progress}/${total}`;
      details.appendChild(progress);
    }

    // Score badge
    if (this.settings.showRatings && entry.score != null) {
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `★ ${entry.score}`;
      details.appendChild(score);
    }

    return details;
  }

  /**
   * Handle clicking on status badge to edit entry.
   */
  handleEditClick(e, entry, statusEl) {
    e.preventDefault();
    e.stopPropagation();
    this.createEditModal(entry, async (updates) => {
      try {
        await this.updateMediaListEntry(entry.media.id, updates);
        new Notice('✅ Updated!');
        this.cache.userData.clear();
        this.cache.mediaData.clear();
        this.cache.searchResults.clear();

        const parent = statusEl.closest('.zoro-container');
        if (parent) {
          const block = parent.closest('.markdown-rendered')?.querySelector('code');
          if (block) {
            this.processZoroCodeBlock(block.textContent, parent, {});
          }
        }
      } catch (err) {
        new Notice(`❌ Update failed: ${err.message}`);
      }
    }, () => {
      // Cancel callback (no action needed)
    });
  }

  /**
   * Render entries in a table layout.
   */
  renderTableLayout(el, entries, config) {
    el.empty();
    const sorted = sortEntries(entries, config.sortOptions);
    const table = document.createElement('table');
    table.className = 'zoro-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Title', 'Format', 'Status'];
    if (this.settings.showProgress) headers.push('Progress');
    if (this.settings.showRatings) headers.push('Score');
    if (this.settings.showGenres) headers.push('Genres');

    headers.forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    sorted.forEach(entry => {
      const media = entry.media;
      if (!media) return;
      const row = document.createElement('tr');

      // Title cell
      const titleCell = document.createElement('td');
      const link = document.createElement('a');
      link.href = this.getZoroUrl(media.id, config.mediaType);
      link.textContent = media.title.english || media.title.romaji || 'Untitled';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'zoro-title-link';
      titleCell.appendChild(link);
      row.appendChild(titleCell);

      // Format cell
      const formatCell = document.createElement('td');
      formatCell.textContent = media.format || '-';
      row.appendChild(formatCell);

      // Status cell with clickable span
      const statusCell = document.createElement('td');
      const statusSpan = document.createElement('span');
      statusSpan.textContent = entry.status || '-';
      statusSpan.className = `status-badge status-${entry.status?.toLowerCase()} clickable-status`;
      statusSpan.style.cursor = 'pointer';
      if (this.settings.accessToken) {
        statusSpan.title = 'Click to edit';
        statusSpan.onclick = (e) => this.handleEditClick(e, entry, statusSpan);
      } else {
        statusSpan.title = 'Click to authenticate';
        statusSpan.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.createAuthenticationPrompt();
        };
      }
      statusCell.appendChild(statusSpan);
      row.appendChild(statusCell);

      // Progress cell
      if (this.settings.showProgress) {
        const progressCell = document.createElement('td');
        const total = media.episodes ?? media.chapters ?? '?';
        progressCell.textContent = `${entry.progress ?? 0}/${total}`;
        row.appendChild(progressCell);
      }

      // Score cell
      if (this.settings.showRatings) {
        const scoreCell = document.createElement('td');
        scoreCell.textContent = entry.score != null ? `★ ${entry.score}` : '-';
        row.appendChild(scoreCell);
      }

      // Genres cell
      if (this.settings.showGenres) {
        const genreCell = document.createElement('td');
        genreCell.textContent = (media.genres || []).slice(0, 3).join(', ') || '-';
        row.appendChild(genreCell);
      }

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    el.appendChild(table);
  }

  /**
   * Create and display an edit modal for a media entry.
   */
  createEditModal(entry, onSave, onCancel) {
    const self = this;
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
      await trySave();
    };

    const titleEl = document.createElement('h3');
    titleEl.className = 'zoro-modal-title';
    titleEl.textContent = entry.media.title.english || entry.media.title.romaji;
    form.appendChild(titleEl);

    // Status field
    const statusGroup = document.createElement('div');
    statusGroup.className = 'zoro-form-group zoro-status-group';
    const statusLabel = document.createElement('label');
    statusLabel.className = 'zoro-form-label zoro-status-label';
    statusLabel.textContent = '🧿 Status';
    statusLabel.setAttribute('for', 'zoro-status');
    const statusSelect = document.createElement('select');
    statusSelect.id = 'zoro-status';
    statusSelect.className = 'zoro-form-input zoro-status-select';
    ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === entry.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusGroup.appendChild(statusLabel);
    statusGroup.appendChild(statusSelect);
    form.appendChild(statusGroup);

    // Score field
    const scoreGroup = document.createElement('div');
    scoreGroup.className = 'zoro-form-group zoro-score-group';
    const scoreLabel = document.createElement('label');
    scoreLabel.className = 'zoro-form-label zoro-score-label';
    scoreLabel.textContent = '⭐ Score (0–10)';
    scoreLabel.setAttribute('for', 'zoro-score');
    const scoreInput = document.createElement('input');
    scoreInput.id = 'zoro-score';
    scoreInput.className = 'zoro-form-input zoro-score-input';
    scoreInput.type = 'number';
    scoreInput.min = '0';
    scoreInput.max = '10';
    scoreInput.step = '0.1';
    scoreInput.value = entry.score != null ? entry.score : '';
    scoreInput.placeholder = 'e.g. 8.5';
    scoreGroup.appendChild(scoreLabel);
    scoreGroup.appendChild(scoreInput);
    form.appendChild(scoreGroup);

    // Progress field
    const progressGroup = document.createElement('div');
    progressGroup.className = 'zoro-form-group zoro-progress-group';
    const progressLabel = document.createElement('label');
    progressLabel.className = 'zoro-form-label zoro-progress-label';
    progressLabel.textContent = '📊 Progress';
    progressLabel.setAttribute('for', 'zoro-progress');
    const progressInput = document.createElement('input');
    progressInput.id = 'zoro-progress';
    progressInput.className = 'zoro-form-input zoro-progress-input';
    progressInput.type = 'number';
    progressInput.min = '0';
    progressInput.max = entry.media.episodes || entry.media.chapters || 999;
    progressInput.value = entry.progress || 0;
    progressInput.placeholder = 'Progress';
    progressGroup.appendChild(progressLabel);
    progressGroup.appendChild(progressInput);
    form.appendChild(progressGroup);

    // Quick buttons for progress
    const quickDiv = document.createElement('div');
    quickDiv.className = 'zoro-quick-progress-buttons';
    const plusBtn = document.createElement('button');
    plusBtn.className = 'zoro-quick-btn zoro-plus-btn';
    plusBtn.type = 'button';
    plusBtn.textContent = '+1';
    plusBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      const max = progressInput.max;
      if (current < max) progressInput.value = current + 1;
    };
    const minusBtn = document.createElement('button');
    minusBtn.className = 'zoro-quick-btn zoro-minus-btn';
    minusBtn.type = 'button';
    minusBtn.textContent = '-1';
    minusBtn.onclick = () => {
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
    quickDiv.append(plusBtn, minusBtn, completeBtn);
    form.appendChild(quickDiv);

    // Buttons (favorite, save, delete, cancel)
    const btnContainer = document.createElement('div');
    btnContainer.className = 'zoro-modal-buttons';
    const favBtn = document.createElement('button');
    favBtn.className = 'zoro-modal-btn zoro-fav-btn';
    favBtn.type = 'button';
    favBtn.title = 'Toggle Favorite';
    favBtn.textContent = '🤍';
    favBtn.onclick = async () => {
      favBtn.disabled = true;
      favBtn.textContent = '⏳';
      try {
        let mediaType = favBtn.dataset.mediaType || entry.media.type || (entry.media.episodes ? 'ANIME' : 'MANGA');
        const isAnime = mediaType === 'ANIME';
        const mutation = `
          mutation ToggleFav($animeId: Int, $mangaId: Int) {
            ToggleFavourite(animeId: $animeId, mangaId: $mangaId) {
              anime { nodes { id } }
              manga { nodes { id } }
            }
          }
        `;
        const variables = {};
        if (isAnime) variables.animeId = entry.media.id;
        else variables.mangaId = entry.media.id;
        const res = await self.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer ${self.settings.accessToken}\`
          },
          body: JSON.stringify({ query: mutation, variables })
        }));
        if (res.json.errors) {
          new Notice(`API Error: ${res.json.errors[0].message}`, 8000);
          console.error('AniList API Error:', res.json.errors);
          throw new Error(res.json.errors[0].message);
        }
        const toggleResult = res.json.data.ToggleFavourite;
        let isFav = false;
        if (isAnime) {
          isFav = toggleResult.anime.nodes.some(node => node.id === entry.media.id);
        } else {
          isFav = toggleResult.manga.nodes.some(node => node.id === entry.media.id);
        }
        favBtn.textContent = isFav ? '❤️' : '🤍';
        new Notice(\`\${isFav ? 'Added to' : 'Removed from'} favorites!\`, 3000);
      } catch (e) {
        new Notice(\`❌ Error: \${e.message || 'Unknown error'}\`, 8000);
        console.error('Favorite toggle error:', e);
      } finally {
        favBtn.disabled = false;
      }
    };
    const saveBtn = document.createElement('button');
    saveBtn.className = 'zoro-modal-btn zoro-save-btn';
    saveBtn.type = 'submit';
    saveBtn.textContent = 'Save';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'zoro-modal-btn zoro-remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '🗑️';
    removeBtn.onclick = async () => {
      if (!confirm('Remove this entry?')) return;
      removeBtn.disabled = true;
      removeBtn.textContent = '⏳';
      try {
        const delMutation = `
          mutation ($id: Int) {
            DeleteMediaListEntry(id: $id) { deleted }
          }
        `;
        await self.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer ${self.settings.accessToken}\`
          },
          body: JSON.stringify({ query: delMutation, variables: { id: entry.id } })
        }));
        document.body.removeChild(modal);
        self.clearCacheForMedia(entry.media.id);
        const parentContainer = document.querySelector('.zoro-container');
        if (parentContainer) {
          const block = parentContainer.closest('.markdown-rendered')?.querySelector('code');
          if (block) self.processZoroCodeBlock(block.textContent, parentContainer, {});
        }
        new Notice('✅ Removed');
      } catch (e) {
        new Notice('❌ Could not remove');
      }
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-modal-btn zoro-cancel-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };
    btnContainer.append(removeBtn, favBtn, saveBtn, cancelBtn);
    form.append(btnContainer);

    content.appendChild(form);
    modal.append(overlay, content);
    document.body.appendChild(modal);

    // Fetch current favorite status
    (async () => {
      try {
        const favQuery = `
          query ($mediaId: Int) {
            Media(id: $mediaId) {
              isFavourite
              type
            }
          }
        `;
        const res = await self.requestQueue.add(() => requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer ${self.settings.accessToken}\`
          },
          body: JSON.stringify({ query: favQuery, variables: { mediaId: entry.media.id } })
        }));
        const mediaData = res.json.data?.Media;
        const fav = mediaData?.isFavourite;
        favBtn.textContent = fav ? '❤️' : '🤍';
        favBtn.dataset.mediaType = mediaData?.type;
      } catch (e) {
        console.warn('Could not fetch favorite', e);
      }
    })();

    overlay.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };

    document.addEventListener('keydown', escListener);
    function escListener(e) {
      if (e.key === 'Escape') {
        onCancel();
        document.body.removeChild(modal);
        document.removeEventListener('keydown', escListener);
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        trySave();
      }
    }

    let saving = false;
    async function trySave() {
      if (saving) return;
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const scoreVal = parseFloat(scoreInput.value);
      if (scoreInput.value && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
        alert('⚠️ Score must be between 0 and 10.');
        resetSaveBtn();
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
        resetSaveBtn();
      }
    }

    function resetSaveBtn() {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      saving = false;
    }
  }

  /**
   * Prompt user to authenticate (shown when clicking status without token).
   */
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
    message.textContent = 'You need to authenticate with AniList to edit your entries.';

    const featuresDiv = document.createElement('div');
    featuresDiv.className = 'zoro-auth-features';
    const featuresTitle = document.createElement('h4');
    featuresTitle.className = 'zoro-auth-features-title';
    featuresTitle.textContent = 'Features after authentication:';
    const featuresList = document.createElement('ul');
    featuresList.className = 'zoro-auth-feature-list';
    [
      'Edit progress, scores, and status',
      'Access private lists and profiles',
      'Quick progress buttons (+1, -1, Complete)',
      'Auto-detect your username',
      'Real-time updates'
    ].forEach(feature => {
      const li = document.createElement('li');
      li.textContent = feature;
      featuresList.appendChild(li);
    });
    featuresDiv.append(featuresTitle, featuresList);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'zoro-modal-buttons';
    const authBtn = document.createElement('button');
    authBtn.className = 'zoro-auth-button';
    authBtn.textContent = '🔑 Authenticate';
    authBtn.onclick = () => {
      closeModal();
      this.app.setting.openTabById(this.manifest.id);
      new Notice('📝 Please use Optional Login in settings to authenticate');
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-cancel-button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => closeModal();
    buttonContainer.append(authBtn, cancelBtn);

    content.append(title, message, featuresDiv, buttonContainer);
    modal.append(overlay, content);
    document.body.appendChild(modal);
    authBtn.focus();
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

  /**
   * Check if a media is already in the user's list.
   * @param {number} mediaId 
   * @param {string} mediaType 
   * @returns {Promise<boolean>}
   */
  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.settings.accessToken) return false;
    try {
      const config = { type: 'single', mediaType, mediaId: parseInt(mediaId) };
      const response = await this.fetchZoroData(config);
      return response.MediaList != null;
    } catch (error) {
      console.warn('Error checking media list status:', error);
      return false;
    }
  }

  /**
   * Add or update media entry in list.
   * @param {number} mediaId 
   * @param {object} updates 
   * @param {string} mediaType 
   */
  async addMediaToList(mediaId, updates, mediaType) {
    if (!this.settings.accessToken) {
      throw new Error('Authentication required');
    }
    // Using same GraphQL mutation as update
    return this.updateMediaListEntry(mediaId, updates);
  }

  /**
   * Update media list entry (status, score, progress).
   * @param {number} mediaId 
   * @param {{status:string,score:number,progress:number}} updates 
   */
  async updateMediaListEntry(mediaId, updates) {
    try {
      if (!this.settings.accessToken || !(await this.ensureValidToken())) {
        throw new Error('❌ Authentication required to update entries.');
      }
      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
            id status score progress
          }
        }
      `;
      const variables = {
        mediaId,
        ...(updates.status && { status: updates.status }),
        ...(updates.score != null && { score: updates.score }),
        ...(updates.progress != null && { progress: updates.progress })
      };
      const response = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.accessToken}`
        },
        body: JSON.stringify({ query: mutation, variables })
      }));
      const result = response.json;
      if (!result || result.errors?.length) {
        const message = result.errors?.[0]?.message || 'Unknown mutation error';
        throw new Error(`AniList update error: ${message}`);
      }
      this.clearCacheForMedia(mediaId);
      return result.data.SaveMediaListEntry;
    } catch (error) {
      console.error('[Zoro] updateMediaListEntry failed:', error);
      throw new Error(`❌ Failed to update entry: ${error.message}`);
    }
  }

  /**
   * Clear cache entries related to a specific media.
   * @param {number} mediaId 
   */
  clearCacheForMedia(mediaId) {
    for (const key of this.cache.mediaData.keys()) {
      try {
        const parsed = JSON.parse(key);
        if (parsed.mediaId === mediaId || parsed.id === mediaId) {
          this.cache.mediaData.delete(key);
        }
      } catch {
        if (key.includes(`mediaId":${mediaId}`) || key.includes(`"id":${mediaId}`)) {
          this.cache.mediaData.delete(key);
        }
      }
    }
    this.cache.userData.clear();
    console.log(`[Zoro] Cleared cache for media ${mediaId}`);
  }

  /**
   * Display error message element.
   * @param {HTMLElement} el 
   * @param {string} message 
   * @param {string} [context] 
   * @param {Function|null} [onRetry] 
   */
  renderError(el, message, context = '', onRetry = null) {
    el.empty?.();
    el.classList.add('zoro-error-container');
    const wrapper = document.createElement('div');
    wrapper.className = 'zoro-error-box';
    const title = document.createElement('strong');
    title.textContent = `❌ ${context || 'Something went wrong'}`;
    wrapper.appendChild(title);
    const msg = document.createElement('pre');
    msg.textContent = message;
    wrapper.appendChild(msg);
    if (this.settings.accessToken) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = () => new Notice('Retry not implemented yet');
      wrapper.appendChild(retryBtn);
    }
    if (typeof onRetry === 'function') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = onRetry;
      wrapper.appendChild(retryBtn);
    }
    el.appendChild(wrapper);
  }

  // === Utilities ===

  /**
   * Convert date object to string YYYY-MM-DD.
   */
  dateToString(dateObj) {
    if (!dateObj || !dateObj.year) return '';
    return `${dateObj.year}-${String(dateObj.month || 0).padStart(2, '0')}-${String(dateObj.day || 0).padStart(2, '0')}`;
  }

  /**
   * Escape CSV values.
   */
  csvEscape(str = '') {
    if (typeof str !== 'string') str = String(str);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Export user's lists to CSV.
   */
  async exportUnifiedListsToCSV() {
    let username = this.settings.authUsername || this.settings.defaultUsername;
    if (!username) {
      new Notice('Set a default username in settings first.', 4000);
      return;
    }
    const useAuth = !!this.settings.accessToken;
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

    const fetchType = async (type) => {
      const headers = { 'Content-Type': 'application/json' };
      if (useAuth) {
        await this.ensureValidToken();
        headers.Authorization = `Bearer ${this.settings.accessToken}`;
      }
      const res = await this.requestQueue.add(() => requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: query.replace('type: ANIME', `type: ${type}`),
          variables: { userName: username }
        })
      }));
      return res.json.data?.MediaListCollection?.lists || [];
    };

    const [animeLists, mangaLists] = await Promise.all([fetchType('ANIME'), fetchType('MANGA')]);
    const lists = [...animeLists, ...mangaLists];
    const rows = [];
    const headers = [
      'ListName','Status','Progress','Score','Repeat','StartedAt','CompletedAt',
      'MediaID','Type','Format','TitleRomaji','TitleEnglish','TitleNative',
      'Episodes','Chapters','Volumes','MediaStart','MediaEnd','AverageScore',
      'Genres','MainStudio','URL'
    ];
    rows.push(headers.join(','));

    for (const list of lists) {
      for (const e of list.entries) {
        const m = e.media;
        const row = [
          list.name, e.status, e.progress || 0, e.score || '', e.repeat || 0,
          this.dateToString(e.startedAt), this.dateToString(e.completedAt),
          m.id, m.type, m.format,
          this.csvEscape(m.title.romaji), this.csvEscape(m.title.english), this.csvEscape(m.title.native),
          m.episodes || '', m.chapters || '', m.volumes || '',
          this.dateToString(m.startDate), this.dateToString(m.endDate),
          m.averageScore || '', this.csvEscape((m.genres || []).join(';')),
          this.csvEscape(m.studios?.nodes?.[0]?.name || ''),
          this.csvEscape(this.getZoroUrl(m.id, m.type))
        ];
        rows.push(row.join(','));
      }
    }

    if (rows.length <= 1) {
      new Notice('No lists found (private or empty).', 4000);
      return;
    }
    const csv = rows.join('\n');
    const suffix = useAuth ? '' : '_PUBLIC';
    const fileName = `AniList_${username}${suffix}_${new Date().toISOString().slice(0,10)}.csv`;
    await this.app.vault.create(fileName, csv);
    new Notice(`✅ CSV saved to vault: ${fileName}`, 4000);
    await this.app.workspace.openLinkText(fileName, '', false);
  }

  /**
   * Log out and clear credentials.
   */
  async logOut() {
    this.settings.accessToken = '';
    this.settings.tokenExpiry = 0;
    this.settings.authUsername = '';
    this.settings.clientId = '';
    this.settings.clientSecret = '';
    await this.saveSettings();
    this.cache.userData.clear();
    this.cache.mediaData.clear();
    this.cache.searchResults.clear();
    new Notice('✅ Logged out & cleared credentials.', 3000);
  }

  /**
   * Build sort options from raw string.
   */
  _buildSortOptions(raw, context = {}) {
    let [f='', d='asc'] = raw.split('-', 2);
    let field = f.trim(), dir = d.trim().toLowerCase();
    if (!SORT_FIELDS[field]) field = '';
    if (!['asc','desc',''].includes(dir)) dir = 'asc';
    if (!field) return { field: '', dir: '', anilistSort: null };
    const map = context.type === 'search' ? ANILIST_SEARCH_SORT_MAP : ANILIST_SORT_MAP;
    const key = map[field];
    if (!key) return { field: '', dir: '', anilistSort: null };
    const suffix = dir === 'desc' ? '_DESC' : '_ASC';
    return { field, dir, anilistSort: key + suffix };
  }

  /**
   * Return names of available themes (CSS files).
   */
  async getAvailableThemes() {
    try {
      const themesDir = `${this.manifest.dir}/themes`;
      const { files } = await this.app.vault.adapter.list(themesDir);
      return files.filter(f => f.endsWith('.css')).map(f => f.replace('.css',''));
    } catch {
      return [];
    }
  }

  /**
   * Apply selected theme CSS scoped to Zoro.
   * @param {string} themeName 
   */
  async applyTheme(themeName) {
    const old = document.getElementById('zoro-theme');
    if (old) old.remove();
    if (!themeName) return;
    const cssPath = `${this.manifest.dir}/themes/${themeName}.css`;
    let rawCss;
    try {
      rawCss = await this.app.vault.adapter.read(cssPath);
    } catch (err) {
      console.warn('Zoro: theme file missing:', themeName, err);
      new Notice(`❌ Theme "${themeName}" not found`);
      return;
    }
    const style = document.createElement('style');
    style.id = 'zoro-theme';
    style.textContent = this.scopeCss(rawCss);
    document.head.appendChild(style);
  }

  /**
   * Scope CSS rules under .zoro-container.
   */
  scopeCss(rawCss, scope = '.zoro-container') {
    let css = rawCss.replace(/:root\b/g, scope);
    css = css.replace(/(^|})(\s*)([^{@}][^{}]*?)\s*\{/g,
      (_, prefix, ws, selectorText) => {
        const scoped = selectorText.split(',').map(s => {
          const sel = s.trim();
          return sel.startsWith(scope) ? sel : `${scope} ${sel}`;
        }).join(', ');
        return `${prefix}${ws}${scoped} {`;
      });
    return css;
  }
}

// === Modal/UI Component Classes ===

/**
 * Modal for entering Client ID in settings.
 */
class ClientIdModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    contentEl.createEl('h2', { text: '🔑 Enter Client ID' });
    const desc = contentEl.createEl('p', { cls: 'auth-modal-desc', text: 'Enter your AniList Client ID' });
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = inputContainer.createEl('input', { type: 'text', placeholder: 'Client ID', cls: 'auth-input' });
    const btnContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    const submitButton = btnContainer.createEl('button', { text: 'Save', cls: 'mod-cta auth-button' });
    const cancelButton = btnContainer.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    submitButton.onClickEvent(() => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    cancelButton.onClickEvent(() => this.close());
    input.onKeyPressEvent(e => {
      if (e.key === 'Enter') submitButton.click();
    });
    setTimeout(() => input.focus(), 100);
  }
}

/**
 * Modal for entering Client Secret in settings.
 */
class ClientSecretModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    contentEl.createEl('h2', { text: '🔐 Enter Client Secret' });
    const desc = contentEl.createEl('p', { cls: 'auth-modal-desc', text: 'Enter your AniList Client Secret' });
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = inputContainer.createEl('input', { type: 'password', placeholder: 'Client Secret', cls: 'auth-input' });
    const btnContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    const submitButton = btnContainer.createEl('button', { text: 'Save', cls: 'mod-cta auth-button' });
    const cancelButton = btnContainer.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    submitButton.onClickEvent(() => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    cancelButton.onClickEvent(() => this.close());
    input.onKeyPressEvent(e => {
      if (e.key === 'Enter') submitButton.click();
    });
    setTimeout(() => input.focus(), 100);
  }
}

/**
 * Modal for pasting authentication PIN.
 */
class AuthPinModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal pin-modal');
    contentEl.createEl('h2', { text: '🔓 Complete Authentication' });
    contentEl.createEl('p', {
      cls: 'auth-modal-desc',
      text: 'Copy the authorization code from the browser and paste it below'
    });
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = inputContainer.createEl('input', {
      type: 'text',
      placeholder: 'Paste authorization code here',
      cls: 'auth-input pin-input'
    });
    const btnContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    const submitButton = btnContainer.createEl('button', { text: '✅ Complete Authentication', cls: 'mod-cta auth-button submit-button' });
    const cancelButton = btnContainer.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    submitButton.onClickEvent(() => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    cancelButton.onClickEvent(() => this.close());
    input.onKeyPressEvent(e => {
      if (e.key === 'Enter') submitButton.click();
    });
    input.onInputEvent(e => {
      if (e.target.value.trim()) {
        submitButton.addClass('ready');
      } else {
        submitButton.removeClass('ready');
      }
    });
    setTimeout(() => input.focus(), 100);
  }
}

/**
 * Plugin settings tab UI.
 */
class ZoroSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /**
   * Display the settings UI.
   */
  display() {
    const { containerEl } = this;
    containerEl.empty();

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
    const UI = section('🎨 Appearance');
    const Theme = section('🌌 Theme');
    const Data = section('📤 Your Data');
    const Guide = section('🧭 Guide');

    // Username setting
    new Setting(Account)
      .setName('🆔 Username')
      .setDesc('Allows access to your public profile and stats.')
      .addText(text => text
        .setPlaceholder('Enter your AniList username')
        .setValue(this.plugin.settings.defaultUsername)
        .onChange(async (value) => {
          this.plugin.settings.defaultUsername = value.trim();
          await this.plugin.saveSettings();
        }));

    // Authentication buttons
    const authSetting = new Setting(Account)
      .setName('🔓 Optional Login')
      .setDesc('Access private data and edit your lists.');
    authSetting.addButton(button => {
      this.authButton = button;
      this.updateAuthButton();
      button.onClick(async () => {
        await this.handleAuthButtonClick();
      });
    });

    new Setting(Account)
      .addButton(btn => btn
        .setButtonText('Log out')
        .setWarning()
        .onClick(async () => {
          await this.plugin.logOut();
          this.updateAuthButton();
        }));

    // UI settings
    new Setting(UI)
      .setName('🧊 Layout')
      .setDesc('Default layout for media lists')
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
      .setDesc('Number of columns in card layout')
      .addSlider(slider => slider
        .setLimits(1, 6, 1)
        .setValue(this.plugin.settings.gridColumns)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.gridColumns = value;
          await this.plugin.saveSettings();
        }));

    new Setting(UI)
      .setName('Sort by')
      .addDropdown(drop => {
        Object.entries(SORT_FIELDS).forEach(([k, { label }]) => drop.addOption(k, label));
        drop.setValue(this.plugin.settings.defaultSortField);
        drop.onChange(async v => {
          this.plugin.settings.defaultSortField = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(UI)
      .setName('Sort direction')
      .addDropdown(drop => {
        drop.addOption('', 'Default')
          .addOption('asc', 'Ascending ↑')
          .addOption('desc', 'Descending ↓')
          .setValue(this.plugin.settings.defaultSortDir)
          .onChange(async v => {
            this.plugin.settings.defaultSortDir = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(UI)
      .setName('🌆 Cover')
      .setDesc('Display cover images')
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

    // Data export
    new Setting(Data)
      .setName('🧾 Export your data')
      .setDesc('Export your AniList data to a CSV file.')
      .addButton(btn => btn
        .setButtonText('Export')
        .setClass('mod-cta')
        .onClick(async () => {
          try {
            await this.plugin.exportUnifiedListsToCSV();
          } catch (err) {
            new Notice(`❌ Export failed: ${err.message}`, 6000);
          }
        }));

    // Theme selection
    new Setting(Theme)
      .setName('Select Theme')
      .setDesc('Custom CSS theme (from /themes folder)')
      .addDropdown(async dropdown => {
        dropdown.addOption('', 'None (built-in)');
        const themes = await this.plugin.getAvailableThemes();
        themes.forEach(t => dropdown.addOption(t, t));
        dropdown.setValue(this.plugin.settings.theme);
        dropdown.onChange(async value => {
          this.plugin.settings.theme = value;
          await this.plugin.saveSettings();
          await this.plugin.applyTheme(value);
        });
      });

    // Sample notes
    new Setting(Guide)
      .setName('🍜 Sample Notes')
      .setDesc('Create sample Anime/Manga dashboard notes.')
      .addButton(button => button
        .setButtonText('Create Note')
        .setTooltip('Click to create sample notes')
        .onClick(async () => {
          await this.plugin.createSampleNotes();
          this.display();
        }));

    // Setup guide
    new Setting(Guide)
      .setName('🗝️ Need a Client ID?')
      .setDesc('Open guide for generating AniList Client ID/Secret.')
      .addButton(button => button
        .setButtonText('Setup Guide')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md', '_blank');
        }));

    new Setting(Guide)
      .addButton(button => button
        .setButtonText('Help & feedback')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/README.md', '_blank');
        }));
  }

  /**
   * Update the authentication button text in settings.
   */
  updateAuthButton() {
    if (!this.authButton) return;
    const settings = this.plugin.settings;
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
      const expiryDate = new Date(settings.tokenExpiry).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric'
      });
      this.authButton.setButtonText(`✅`);
      this.authButton.setCta();
    }
  }

  /**
   * Handle clicks on the authentication button.
   */
  async handleAuthButtonClick() {
    const settings = this.plugin.settings;
    if (!settings.clientId) {
      new ClientIdModal(this.app, async (clientId) => {
        this.plugin.settings.clientId = clientId.trim();
        await this.plugin.saveSettings();
        this.updateAuthButton();
      }).open();
    } else if (!settings.clientSecret) {
      new ClientSecretModal(this.app, async (clientSecret) => {
        this.plugin.settings.clientSecret = clientSecret.trim();
        await this.plugin.saveSettings();
        this.updateAuthButton();
      }).open();
    } else if (!settings.accessToken) {
      await this.plugin.authenticateUser();
    } else {
      await this.plugin.authenticateUser();
    }
  }
}

module.exports = {
  default: ZoroPlugin
};
