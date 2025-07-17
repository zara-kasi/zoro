const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

// Default settings constant ok
const DEFAULT_SETTINGS = {
  defaultUsername: '',
  defaultLayout: 'card',
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  gridColumns: 2,
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: '',
};

  // Rate limit 
class RequestQueue {
  constructor() {
    this.queue = [];
    this.delay = 700; // ~85 requests/min (AniList limit: 90/min)
    this.isProcessing = false;
  }

  add(requestFn) {
    return new Promise((resolve) => {
      this.queue.push({ requestFn, resolve });
      this.process();
    });
  }

  async process() {
    if (this.isProcessing || !this.queue.length) return;

    this.isProcessing = true;
    const { requestFn, resolve } = this.queue.shift();

    try {
      const result = await requestFn();
      resolve(result);
    } finally {
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }
}


// Plugin Class 
class ZoroPlugin extends Plugin { 


  // Constructor 
  constructor(app, manifest) {
    super(app, manifest);
    
  // Initialize separate caches
  this.cache = {
    userData: new Map(),     // User stats and lists
    mediaData: new Map(),    // Individual media items
    searchResults: new Map() // Search queries
  };
    this.requestQueue = new RequestQueue();
    this.cacheTimeout = 5 * 60 * 1000;

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


  // On Load  ok
  async onload() {
    console.log('[Zoro] Plugin loading...');

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

    // Register Markdown code block processors
    this.registerMarkdownCodeBlockProcessor('zoro', this.processZoroCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processZoroSearchCodeBlock.bind(this));

    // Process inline links (e.g., [[Zoro:ID]])
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    // Add plugin settings tab
    this.addSettingTab(new ZoroSettingTab(this.app, this));

    console.log('[Zoro] Plugin loaded successfully.');
  }
  
   // Validate Settings 
  validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'list'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      showCoverImages: !!settings?.showCoverImages,
      showRatings: !!settings?.showRatings,
      showProgress: !!settings?.showProgress,
      showGenres: !!settings?.showGenres,
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : 3,
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
   
   // no secret saved...
   if (!this.settings.clientSecret) {
    const secret = await this.promptForSecret("Paste your client secret:");
    this.settings.clientSecret = secret.trim();
    await this.saveData(this.settings);
  }}
  

 // Authentication 
  async authenticateUser() {
    const clientId = this.settings.clientId;
    const redirectUri = this.settings.redirectUri || 'https://anilist.co/api/v2/oauth/pin';
    

    if (!clientId) {
      new Notice('❌ Please set your Client ID in plugin settings first.', 5000);
      return;
    }

    // Check if already authenticated
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

      if (!code || !code.trim()) {
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

  async promptForCode(message) {
    return new Promise((resolve) => {
      const code = prompt(message);
      resolve(code);
    });
  }


  // Exchange code for token 
  async exchangeCodeForToken(code, redirectUri) {
    const clientId = this.settings.clientId;
    const clientSecret = this.settings.clientSecret;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret || '', // optional but safe
      redirect_uri: redirectUri,
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
        body: body.toString(),
      }));

      const data = response?.json;

      if (!data || typeof data !== 'object') {
        console.error('[Zoro] Unexpected response from server:', response);
        throw new Error('⚠️ Invalid response from server.');
      }

      if (!data.access_token) {
        throw new Error(data.error_description || '❌ No access token returned by server.');
      }

      // Store auth details
      this.settings.accessToken = data.access_token;
      
      if (data.expires_in) {
        this.settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
      }

      await this.saveSettings();

      new Notice('✅ Successfully authenticated with the service!', 4000);

      // Optional sanity check
      if (this.testAccessToken) {
        await this.testAccessToken();
      }

    } catch (err) {
      console.error('[Zoro] Authentication error:', err);
      new Notice(`❌ Authentication failed: ${err.message}`, 5000);
      if (this.showManualTokenOption) {
        this.showManualTokenOption(); // optional UI fallback
      }
    }
  }


  // Token Validation 
async ensureValidToken() {
  return !!this.settings.accessToken;
}

  
  // Make Obsidian Request 
  async makeObsidianRequest(code, redirectUri) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret || '',
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

  // Test access token 
  async testAccessToken() {
    const query = `
      query {
        Viewer {
          id
          name
        }
      }
    `;

    try {
      const response = await this.requestQueue.add(() => requestUrl({
  url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.accessToken}`
        },
        body: JSON.stringify({ query })
      }));

      const data = response.json;
      if (!data || !data.data?.Viewer) {
        throw new Error('Invalid access token or response malformed.');
      }

      const username = data.data.Viewer.name;
      new Notice(`🎉 Welcome, ${username}! Token is valid.`);
      return true;

    } catch (error) {
      console.warn('[Zoro] testAccessToken failed:', error);
      throw new Error('Token verification failed. Please check your token or re-authenticate.');
    }
  }

// Authenticated Username 
  async getAuthenticatedUsername() {
  if (!this.settings.accessToken) return null;

  await this.ensureValidToken();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${this.settings.accessToken}`,
  };

  const query = `
    query {
      Viewer {
        name
      }
    }
  `;

  try {
    const response = await this.requestQueue.add(() =>
      requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      })
    );

    const data = response.json;

    if (!data?.data?.Viewer?.name) {
      throw new Error('Invalid token or no username returned.');
    }

    this.settings.authUsername = data.data.Viewer.name;
    await this.saveSettings();

    return data.data.Viewer.name;

  } catch (error) {
    console.warn('[Zoro] getAuthenticatedUsername() failed:', error);
    return null;
  }
  }
  
 
    
    /// *Fetching*

  // Fetch Zoro Data 
    
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

  const cached = this.getFromCache(cacheType, cacheKey);
  if (cached) return cached;

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    let query, variables;
     try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
if (this.settings.accessToken) {
  await this.ensureValidToken();
  
  headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
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
        perPage: config.perPage || 5 
      };
    } else {
      query = this.getMediaListQuery(config.layout);
      variables = {
        username: config.username,
        status: config.listType,
        type: config.mediaType || 'ANIME'
      };
    }

   

      if (this.settings.accessToken) {
        headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
      }
      // Rate limit add
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
          if (this.settings.accessToken) {
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
  this.setToCache(cacheType, cacheKey, result.data);
  return result.data;
    


    } catch (error) {
      console.error('[Zoro] fetchZoroData() failed:', error);
      throw error;
    }
  }



// Loading indicator 
async fetchData(config) {
  this.showLoader();
  try {
    // API call
  } catch (error) {
    // Handle error
  } finally {
    this.hideLoader();
  }
}
  
  
  // Process Zoro Code Block - FIXED: Now properly inside the class
  async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source) || {};

      // Debug: Log raw config
      console.log('[Zoro] Code block config:', config);

      // Handle authenticated user resolution
      if (config.useAuthenticatedUser) {
        const authUsername = await this.getAuthenticatedUsername();
        if (!authUsername) {
          throw new Error('❌ Could not retrieve authenticated username. Check your authentication setup or set a username manually.');
        }
        config.username = authUsername;
      }

      if (!config.username) {
        throw new Error('❌ No username provided. Set `username:` in your code block or enable `useAuthenticatedUser`.');
      }

      const data = await this.fetchZoroData(config);

      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('⚠️ No data returned from Zoro API.');
      }

      this.renderZoroData(el, data, config);
    } catch (error) {
      console.error('[Zoro] Code block processing error:', error);
      this.renderError(el, error.message || 'Unknown error occurred.');
    }
  }

// Update Media List 
    
    async updateMediaListEntry(mediaId, updates) {
  try {
    // Ensure valid token before proceeding
    if (!this.settings.accessToken || !(await this.ensureValidToken())) {
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

    // Filter out undefined values
    const variables = {
      mediaId,
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.score !== undefined && { score: updates.score }),
      ...(updates.progress !== undefined && { progress: updates.progress }),
    };

    
// Rate Limit  add
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

    if (!result || result.errors?.length > 0) {
      const message = result.errors?.[0]?.message || 'Unknown mutation error';
      throw new Error(`AniList update error: ${message}`);
    }

    // Targeted cache clearing instead of full clear
    this.clearCacheForMedia(mediaId);
    
    return result.data.SaveMediaListEntry;

  } catch (error) {
    console.error('[Zoro] updateMediaListEntry failed:', error);
    throw new Error(`❌ Failed to update entry: ${error.message}`);
  }
}

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

   

  // Process Zoro Search Code Block - FIXED: Removed duplicate and fixed structure
  async processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
config.search = '';


      if (this.settings.debugMode) {
        console.log('[Zoro] Search block config:', config);
      }

      // Show loading placeholder
      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      
      

      await this.renderSearchInterface(el, config);
    } catch (error) {
      console.error('[Zoro] Search block processing error:', error);
      this.renderError(el, error.message || 'Failed to process Zoro search block.');
    }
  }

  // Parse Code Block Config - FIXED: Now properly inside the class
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
      if (this.settings.defaultUsername) {
        config.username = this.settings.defaultUsername;
      } else if (this.settings.accessToken) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
      }
    }
    
    config.listType = config.listType || 'CURRENT';
    config.layout = config.layout || this.settings.defaultLayout;
    config.mediaType = config.mediaType || 'ANIME';
    
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
    
    config.layout = config.layout || this.settings.defaultLayout || 'card';

    
    // Default to ANIME if no mediaType specified
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.settings.defaultLayout;
    
    return config;
  }

  // Process Inline Links - FIXED: Now properly inside the class
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
        const data = await this.fetchZoroData(config);

        const container = document.createElement('span');
        container.className = 'zoro-inline-container';
        this.renderZoroData(container, data, config);

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

  // Parse Inline Link - FIXED: Now properly inside the class
  parseInlineLink(href) {
    const [base, hash] = href.replace('zoro:', '').split('#');

    const parts = base.split('/');
    let username, pathParts;

    if (parts[0] === '') {
      if (!this.settings.defaultUsername) {
        throw new Error('⚠️ Default username not set. Configure it in plugin settings.');
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

  // Get Media List Query - FIXED: Now properly inside the class
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

  // Single Media Query - FIXED: Now properly inside the class
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

  // User Stats Query - FIXED: Now properly inside the class
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

  // Search Media Query - FIXED: Now properly inside the class
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
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(search: $search, type: $type, sort: POPULARITY_DESC) {
            ${fields}
          }
        }
      }
    `;
  }

  // Getting AniList URL
  getZoroUrl(mediaId, mediaType = 'ANIME') {
    if (!mediaId || typeof mediaId !== 'number') {
      throw new Error(`Invalid mediaId: ${mediaId}`);
    }

    const type = String(mediaType).toUpperCase();

    const validTypes = ['ANIME', 'MANGA'];
    const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime'; // fallback

    return `https://anilist.co/${urlType}/${mediaId}`;
  }

  // Render Search Interface
  renderSearchInterface(el, config) {
    el.empty();
    el.className = 'zoro-search-container';
    
    // Create search input
    const searchDiv = document.createElement('div');
    searchDiv.className = 'zoro-search-input-container';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'zoro-search-input';
    searchInput.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';
    
    
    searchDiv.appendChild(searchInput);
    el.appendChild(searchDiv);
    
    // Create results container
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'zoro-search-results';
    el.appendChild(resultsDiv);
    
    // Add event listeners
    let searchTimeout;
    
    const performSearch = async () => {
      const searchTerm = searchInput.value.trim();
      
      if (searchTerm.length < 3) {
        resultsDiv.innerHTML = '<div class="zoro-search-message">Type at least 3 characters to search...</div>';
        return;
      }
      
      try {
        resultsDiv.innerHTML = '<div class="zoro-search-loading">Searching...</div>';
        
        const searchConfig = { ...config,
          search: searchTerm,
          page: 1,
          perPage: 5 
        };
        
        const data = await this.fetchZoroData(searchConfig);
        
this.renderSearchResults(resultsDiv, data.Page.media, config);


        
      } catch (error) {
        this.renderError(resultsDiv, error.message);
      }
    };
    
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(performSearch, 300);
    });
    
    
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch();
      }
    });
  }
  
  // Add this method to check if media is already in user's list
async checkIfMediaInList(mediaId, mediaType) {
  if (!this.settings.accessToken) return false;
  
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

// Add this method to add new media to list
async addMediaToList(mediaId, updates, mediaType) {
  if (!this.settings.accessToken) {
    throw new Error('Authentication required');
  }
  
  // Use the same method as your existing updateMediaListEntry
  // but for adding new entries instead of updating existing ones
  return await this.updateMediaListEntry(mediaId, updates);
}

// Modified renderSearchResults method to include ADD buttons
renderSearchResults(el, media, config) {
  el.empty();
  
  if (media.length === 0) {
    el.innerHTML = '<div class="zoro-search-message">No results found.</div>';
    return;
  }
  
  const gridDiv = document.createElement('div');
  gridDiv.className = 'zoro-cards-grid';
  gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);
  
  media.forEach(async (item) => {
    const title = item.title.english || item.title.romaji;
    
    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-card';
    
    if (this.settings.showCoverImages) {
      const img = document.createElement('img');
      img.src = item.coverImage.large;
      img.alt = title;
      img.className = 'media-cover';
      cardDiv.appendChild(img);
    }
    
    const mediaInfoDiv = document.createElement('div');
    mediaInfoDiv.className = 'media-info';
    
    // Create clickable title
    const titleElement = document.createElement('h4');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(item.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link';
    titleLink.textContent = title;
    titleElement.appendChild(titleLink);
    mediaInfoDiv.appendChild(titleElement);
    
    // Create details div
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'media-details';
    
    // Format badge
    if (item.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = item.format;
      detailsDiv.appendChild(formatBadge);
    }
    
    // Status badge (for media release status)
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${item.status.toLowerCase()}`;
    statusBadge.textContent = item.status;
    detailsDiv.appendChild(statusBadge);
    
    // ADD button
    
const addBadge = document.createElement('span');
addBadge.textContent = 'ADD';
addBadge.className = 'status-badge status-planning clickable-status';
addBadge.onclick = (e) => {
  e.preventDefault();
  e.stopPropagation();
  this.createEditModal(
    {
      media: {
        id: item.id,
        title: item.title,
        episodes: item.episodes,
        chapters: item.chapters,
        format: item.format,
      },
      status: 'PLANNING',
      score: null,
      progress: 0,
    },
    async (updates) => {
      addBadge.onclick = async (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    badge.textContent = 'Adding…';
    badge.style.pointerEvents = 'none';

    await this.addMediaToList(item.id, updates, config.mediaType);

    // success
    badge.className = `status-badge status-${updates.status.toLowerCase()} clickable-status`;
    badge.textContent = updates.status;
    badge.onclick = null;
    new Notice('✅ Added!');
  } catch (err) {
    console.error('[Zoro] Add failed:', err);
    new Notice(`❌ ${err.message}`);
    badge.textContent = 'ADD';
    badge.style.pointerEvents = '';
  }
};

      addBadge.className = `status-badge status-${updates.status.toLowerCase()} clickable-status`;
      addBadge.textContent = updates.status;
      addBadge.onclick = null; // disable after add
      new Notice('✅ Added!');
    },
    () => new Notice('Add cancelled.')
  );
};
    
    detailsDiv.appendChild(addBadge);

    
    // Average score
    if (this.settings.showRatings && item.averageScore) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${item.averageScore}`;
      detailsDiv.appendChild(scoreSpan);
    }
    
    mediaInfoDiv.appendChild(detailsDiv);
    
    // Create genres div
    if (this.settings.showGenres && item.genres) {
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
    
    // Check if item is already in list and update button accordingly
    if (this.settings.accessToken) {
      this.checkIfMediaInList(item.id, config.mediaType).then(inList => {
        if (inList) {
          addButton.textContent = 'IN LIST';
          addButton.style.backgroundColor = '#999';
          addButton.style.cursor = 'not-allowed';
          addButton.title = 'Already in your list';
          addButton.onclick = null;
        }
      });
    }
  });
  
  el.appendChild(gridDiv);
}



  

  //  render ZoroData
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

  // Render User's Stats (Need some fixes)
  renderUserStats(el, user) {
    if (!user || !user.statistics) {
      this.renderError(el, 'User statistics unavailable.');
      return;
    }
    

    const safe = (val, fallback = '—') => (val != null ? val : fallback);

    const createStatItem = (label, value) => {
      const item = document.createElement('div');
      item.className = 'zoro-stat-item';
      item.innerHTML = `<span>${label}:</span><span>${safe(value)}</span>`;
      return item;
    };

    const createStatSection = (title, stats) => {
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
          section.appendChild(createStatItem(label, stats[key].toLocaleString?.() || stats[key]));
        }
      }

      return section;
    };

    const container = document.createElement('div');
    container.className = 'zoro-user-stats';

    const header = document.createElement('div');
    header.className = 'zoro-user-header';
    header.innerHTML = `
      <img src="${safe(user.avatar?.medium, '')}" alt="${safe(user.name)}" class="zoro-user-avatar">
      <h3>${safe(user.name)}</h3>
    `;

    const statsGrid = document.createElement('div');
    statsGrid.className = 'zoro-stats-grid';

    statsGrid.appendChild(createStatSection('Anime', user.statistics.anime || {}));
    statsGrid.appendChild(createStatSection('Manga', user.statistics.manga || {}));

    container.appendChild(header);
    container.appendChild(statsGrid);
    el.appendChild(container);
  }

  // Render Single Media 
  renderSingleMedia(el, mediaList, config) {
    const media = mediaList.media;
    const title = media.title.english || media.title.romaji;
    
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
    
    // Create clickable title
    const titleElement = document.createElement('h3');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'zoro-title-link';
    titleLink.textContent = title;
    titleElement.appendChild(titleLink);
    mediaInfoDiv.appendChild(titleElement);
    
    // Create details div
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'media-details';
    
    // Format badge
    if (media.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = media.format;
      detailsDiv.appendChild(formatBadge);
    }
    
    // Status badge
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${mediaList.status.toLowerCase()}`;
    statusBadge.textContent = mediaList.status;
    detailsDiv.appendChild(statusBadge);
    
    // Progress
    if (this.settings.showProgress) {
      const progressSpan = document.createElement('span');
      progressSpan.className = 'progress';
      progressSpan.textContent = `${mediaList.progress}/${media.episodes || media.chapters || '?'}`;
      detailsDiv.appendChild(progressSpan);
    }
    
    // Score
    if (this.settings.showRatings && mediaList.score) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${mediaList.score}`;
      detailsDiv.appendChild(scoreSpan);
    }
    
    mediaInfoDiv.appendChild(detailsDiv);
    // Create genres div
    if (this.settings.showGenres) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres';
      media.genres.slice(0, 3).forEach(genre => {
        const genreTag = document.createElement('span');
        genreTag.className = 'genre-tag';
        genreTag.textContent = genre;
        genresDiv.appendChild(genreTag);
      });
      mediaInfoDiv.appendChild(genresDiv);
    }
    
    cardDiv.appendChild(mediaInfoDiv);
    el.appendChild(cardDiv);
  }


  // Render Media Lists
  
  // Render Media Lists
  renderMediaList(el, entries, config) {
    const gridDiv = document.createElement('div');
    gridDiv.className = 'zoro-cards-grid';
    gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);

    entries.forEach(entry => {
      const card = this.createMediaCard(entry, config);
      gridDiv.appendChild(card);
    });

    el.empty();
    el.appendChild(gridDiv);
  }

  createMediaCard(entry, config) {
    const media = entry.media;
    if (!media) return document.createTextNode('⚠️ Missing media');

    const title = media.title.english || media.title.romaji || 'Untitled';

    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-card';

    // Cover - using old styling class name
    if (this.settings.showCoverImages && media.coverImage?.large) {
      const img = document.createElement('img');
      img.src = media.coverImage.large;
      img.alt = title;
      img.className = 'media-cover'; // Changed from 'zoro-media-cover' to match old style
      cardDiv.appendChild(img);
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'media-info'; // Changed from 'zoro-media-info' to match old style

    // Title - using old styling class name
    const titleElement = document.createElement('h4');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link'; // Changed from 'zoro-title-link' to match old style
    titleLink.textContent = title;
    titleElement.appendChild(titleLink);
    infoDiv.appendChild(titleElement);

    // Details - using old styling approach
    const detailsDiv = this.createDetailsRow(entry);
    infoDiv.appendChild(detailsDiv);

    // Genres - using old styling class name
    if (this.settings.showGenres && media.genres?.length) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres'; // Changed from 'zoro-genres' to match old style
      media.genres.slice(0, 3).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag'; // Changed from 'zoro-genre-tag' to match old style
        tag.textContent = genre;
        genresDiv.appendChild(tag);
      });
      infoDiv.appendChild(genresDiv);
    }

    cardDiv.appendChild(infoDiv);
    return cardDiv;
  }

  createDetailsRow(entry) {
    const media = entry.media;
    const details = document.createElement('div');
    details.className = 'media-details'; // Changed from 'zoro-media-details' to match old style

    // Format - using old styling class name
    if (media.format) {
      const format = document.createElement('span');
      format.className = 'format-badge'; // Changed from 'zoro-badge zoro-format' to match old style
      format.textContent = media.format;
      details.appendChild(format);
    }

    // Status - using old styling class name but keeping new functionality
    const status = document.createElement('span');
    status.className = `status-badge status-${entry.status?.toLowerCase()} clickable-status`; // Changed from 'zoro-badge zoro-status' to match old style
    status.textContent = entry.status ?? 'Unknown';
    status.style.cursor = 'pointer';

    if (this.settings.accessToken) {
      status.title = 'Click to edit';
      status.onclick = e => this.handleEditClick(e, entry, status);
    } else {
      status.title = 'Click to authenticate';
      status.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        this.createAuthenticationPrompt();
      };
    }

    details.appendChild(status);

    // Progress - using old styling class name
    if (this.settings.showProgress) {
      const progress = document.createElement('span');
      progress.className = 'progress'; // Changed from 'zoro-badge zoro-progress' to match old style
      const total = media.episodes ?? media.chapters ?? '?';
      progress.textContent = `${entry.progress}/${total}`; // Changed format to match old style
      details.appendChild(progress);
    }

    // Score - using old styling class name
    if (this.settings.showRatings && entry.score != null) {
      const score = document.createElement('span');
      score.className = 'score'; // Changed from 'zoro-badge zoro-score' to match old style
      score.textContent = `★ ${entry.score}`;
      details.appendChild(score);
    }

    return details;
  }

  handleEditClick(e, entry, statusEl) {
    e.preventDefault();
    e.stopPropagation();

    this.createEditModal(
      entry,
      async updates => {
        try {
          await this.updateMediaListEntry(entry.media.id, updates);
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
        new Notice('Edit canceled.');
      }
    );
  }


  // Render Table Layout 
  renderTableLayout(el, entries, config) {
    el.empty();
    
    const table = document.createElement('table');
    table.className = 'zoro-table';

    // --- HEADER ---
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

    // --- BODY ---
    const tbody = document.createElement('tbody');

    entries.forEach(entry => {
      const media = entry.media;
      if (!media) return; // skip broken

      const row = document.createElement('tr');

      // --- Title ---
      const titleCell = document.createElement('td');
      const title = media.title.english || media.title.romaji || 'Untitled';
      const link = document.createElement('a');
      
      link.href = this.getZoroUrl(media.id, config.mediaType);
      link.textContent = title;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'zoro-title-link';
      titleCell.appendChild(link);
      row.appendChild(titleCell);

      // --- Format ---
      const formatCell = document.createElement('td');
      formatCell.textContent = media.format || '-';
      row.appendChild(formatCell);

      // --- Status ---
      const statusCell = document.createElement('td');
      const status = document.createElement('span');
      status.textContent = entry.status || '-';
      status.className = `zoro-badge status-${entry.status?.toLowerCase()} clickable-status`;
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

      statusCell.appendChild(status);
      row.appendChild(statusCell);

      // --- Progress ---
            // --- Progress ---
      if (this.settings.showProgress) {
        const progressCell = document.createElement('td');
        const total = media.episodes ?? media.chapters ?? '?';
        progressCell.textContent = `${entry.progress ?? 0}/${total}`;
        row.appendChild(progressCell);
      }


      // --- Score ---
      if (this.settings.showRatings) {
        const scoreCell = document.createElement('td');
        scoreCell.textContent = entry.score != null ? `★ ${entry.score}` : '-';
        row.appendChild(scoreCell);
      }
      // --- Genres ---
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

  // Create Edit Modal
  createEditModal(entry, onSave, onCancel) {
    const modal = document.createElement('div');
    // RENAMED from anilist-edit-modal to zoro-edit-modal
    modal.className = 'zoro-edit-modal';

    const overlay = document.createElement('div');
    // RENAMED from anilist-modal-overlay to zoro-modal-overlay
    overlay.className = 'zoro-modal-overlay';

    const content = document.createElement('div');
    // RENAMED from anilist-modal-content to zoro-modal-content
    content.className = 'zoro-modal-content';

    const form = document.createElement('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      await trySave();
    };

    const title = document.createElement('h3');
    title.textContent = entry.media.title.english || entry.media.title.romaji;

    // --- Status Field ---
    const statusGroup = document.createElement('div');
    statusGroup.className = 'form-group';

    const statusLabel = document.createElement('label');
    statusLabel.textContent = 'Status';
    // RENAMED from anilist-status to zoro-status
    statusLabel.setAttribute('for', 'zoro-status');

    const statusSelect = document.createElement('select');
    // RENAMED from anilist-status to zoro-status
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

    // --- Score Field ---
    const scoreGroup = document.createElement('div');
    scoreGroup.className = 'form-group';

    const scoreLabel = document.createElement('label');
    scoreLabel.textContent = 'Score (0–5)';
    // RENAMED from anilist-score to zoro-score
    scoreLabel.setAttribute('for', 'zoro-score');

    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    // RENAMED from anilist-score to zoro-score
    scoreInput.id = 'zoro-score';
    scoreInput.min = '0';
    scoreInput.max = '10';
    scoreInput.step = '0.1';
    scoreInput.value = entry.score ?? '';
    scoreInput.placeholder = 'e.g. 8.5';

    scoreGroup.appendChild(scoreLabel);
    scoreGroup.appendChild(scoreInput);

    // --- Progress Field ---
    const progressGroup = document.createElement('div');
    progressGroup.className = 'form-group';

    const progressLabel = document.createElement('label');
    progressLabel.textContent = 'Progress';
    // RENAMED from anilist-progress to zoro-progress
    progressLabel.setAttribute('for', 'zoro-progress');

    const progressInput = document.createElement('input');
    progressInput.type = 'number';
    // RENAMED from anilist-progress to zoro-progress
    progressInput.id = 'zoro-progress';
    progressInput.min = '0';
    progressInput.max = entry.media.episodes || entry.media.chapters || 999;
    progressInput.value = entry.progress || 0;
    progressInput.placeholder = 'Progress';

    progressGroup.appendChild(progressLabel);
    progressGroup.appendChild(progressInput);

    // --- Quick Buttons ---
    const quickProgressDiv = document.createElement('div');
    quickProgressDiv.className = 'quick-progress-buttons';

    const plusOneBtn = document.createElement('button');
    plusOneBtn.type = 'button';
    plusOneBtn.textContent = '+1';
    plusOneBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      const max = progressInput.max;
      if (current < max) progressInput.value = current + 1;
    };

    const minusOneBtn = document.createElement('button');
    minusOneBtn.type = 'button';
    minusOneBtn.textContent = '-1';
    minusOneBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      if (current > 0) progressInput.value = current - 1;
    };

    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.textContent = 'Complete';
    completeBtn.onclick = () => {
      progressInput.value = entry.media.episodes || entry.media.chapters || 1;
      statusSelect.value = 'COMPLETED';
    };

    quickProgressDiv.append(plusOneBtn, minusOneBtn, completeBtn);

    // --- Buttons ---
    const buttonContainer = document.createElement('div');
    // RENAMED from anilist-modal-buttons to zoro-modal-buttons
    buttonContainer.className = 'zoro-modal-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.type = 'submit';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };

    buttonContainer.append(saveBtn, cancelBtn);

    form.append(title, statusGroup, scoreGroup, progressGroup, quickProgressDiv, buttonContainer);
    content.appendChild(form);
    modal.append(overlay, content);
    document.body.appendChild(modal);

    overlay.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };

    // Keyboard accessibility
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

    // Save logic
    let saving = false;
    async function trySave() {
      if (saving) return;
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const scoreVal = parseFloat(scoreInput.value);
      if (scoreInput.value && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
        alert("⚠ Score must be between 0 and 10.");
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
      }

      resetSaveBtn();
    }

    function resetSaveBtn() {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      saving = false;
    }
  }

  // Create Authentication Prompt 
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
    
    authenticateBtn.textContent = '🔑 Authenticate with AniList';
    authenticateBtn.onclick = () => {
      closeModal();
      this.app.setting.open();
      this.app.setting.openTabById(this.manifest.id);
      new Notice('📝 Please configure authentication in the plugin settings');
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

 async createSampleNotes() {
  try {
    let successCount = 0;
    let errorMessages = [];
    
    // **FIRST NOTE CONFIGURATION**
    
    const firstNoteTitle = "Anime Dashboard";
    
const firstNoteContent =`\`\`\`zoro-search
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

 const secondNoteTitle = "Manga Dashboard";

const secondNoteContent =`\`\`\`zoro-search
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

    // Array of notes to create

    const notesToCreate = [
      { title: firstNoteTitle, content: firstNoteContent },
      { title: secondNoteTitle, content: secondNoteContent }
    ];

    // Create each note

    for (const note of notesToCreate) {
      try {
        const fileName = `${note.title}.md`;
        const filePath = fileName;

 // This creates the note in the vault root
        
        // Checking for if  file already exists
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile) {
          errorMessages.push(`"${note.title}" already exists`);
          continue;
        }
        
        // Create the new note
        await this.app.vault.create(filePath, note.content);
        successCount++;
        
      } catch (error) {
        errorMessages.push(`Failed to create "${note.title}": ${error.message}`);
      }
    }
    
    // Show results
    if (successCount > 0) {
      new Notice(`Successfully created ${successCount} note${successCount > 1 ? 's' : ''}!`, 4000);
      
      // Open the first successfully created note

      const firstNote = this.app.vault.getAbstractFileByPath(`${firstNoteTitle}.md`);
      if (firstNote) {
        await this.app.workspace.openLinkText(`${firstNoteTitle}.md`, '', false);
      }
    }
    
    if (errorMessages.length > 0) {
      new Notice(`Issues: ${errorMessages.join(', ')}`, 5000);
    }
    
  } catch (error) {
    console.error('Error creating notes:', error);
    new Notice(`Failed to create notes: ${error.message}`, 5000);
  }
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
  
// Export 
async exportUnifiedListsToCSV() {
  // decide which username to use
  let username = this.settings.authUsername;
  if (!username) username = this.settings.defaultUsername;
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

  const fetchType = async type => {
    const headers = { 'Content-Type': 'application/json' };
    if (useAuth) {
      await this.ensureValidToken();
      headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
    }

    const res = await this.requestQueue.add(() =>
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
        this.csvEscape(this.getZoroUrl(m.id, m.type))
      ];
      rows.push(row.join(','));
    }
  }

  const csv = rows.join('\n');
  const suffix = useAuth ? '' : '_PUBLIC';
  
      const folder = 'Zoro exports';               // any vault-relative folder
    await this.app.vault.createFolder(folder).catch(() => {}); // create if missing
    const fileName = `${folder}/AniList_${username}${suffix}_${new Date().toISOString().slice(0, 10)}.csv`;
  await this.app.vault.create(fileName, csv);
  new Notice(`✅ CSV saved to vault: ${fileName}`, 4000);
  await this.app.workspace.openLinkText(fileName, '', false);
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
 
  // Plugin unload method
  onunload() {
    console.log('Unloading Zoro Plugin');

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


/// Class for Client Id Pop up in settings


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

// Settings Menu 
class ZoroSettingTab extends PluginSettingTab { 
  constructor(app, plugin) { 
    super(app, plugin); 
    this.plugin = plugin; 
  }
  

  display() { 
    const { containerEl } = this;
    // This will clear the Setting's tab each time you open it 
    containerEl.empty()
    
 new Setting(containerEl)
      .setName('➕ Sample Notes')
      .setDesc('Creates notes to view your anime and manga data.')
      .addButton(button => button
        .setButtonText('Create Note')
        .setTooltip('Click to create a sample note in your vault')
        .onClick(async () => {
          await this.plugin.createSampleNotes();
        }));

    new Setting(containerEl)
      .setName('👤 Username')
      .setDesc('Lets you access your public profile and stats — that’s it.')
      .addText(text => text
        .setPlaceholder('Enter your AniList username')
        .setValue(this.plugin.settings.defaultUsername)
        .onChange(async (value) => {
          this.plugin.settings.defaultUsername = value.trim();
          await this.plugin.saveSettings();
        }));
        
        // Dynamic Authentication button

const authSetting = new Setting(containerEl)
  .setName('🔓 Optional Login')
  .setDesc('Lets you peek at your private profile and actually change stuff.');

authSetting.addButton(button => {
  this.authButton = button;
  this.updateAuthButton();
  
  button.onClick(async () => {
    await this.handleAuthButtonClick();
  });
});



    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName('🌆 Cover')
      .setDesc('Display cover images for anime/manga')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCoverImages)
        .onChange(async (value) => {
          this.plugin.settings.showCoverImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('⭐ Ratings')
      .setDesc('Display user ratings/scores')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showRatings)
        .onChange(async (value) => {
          this.plugin.settings.showRatings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('📈 Progress')
      .setDesc('Display progress information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgress)
        .onChange(async (value) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('🎭 Genres')
      .setDesc('Display genre tags')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
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
        
      

    new Setting(containerEl)
      .setName('🪤 Hidden Settings ')
      .setDesc('Yes, there’s an authentication guide. Click it.')
      .addButton(button => button
        .setButtonText('View Documentation')
        .onClick(() => {
          window.open('https://github.com/zara-kasi/zoro/blob/main/README.md', '_blank');
        }));
        
/* ---- Unified Export button (always shown) ---- */
new Setting(containerEl)
  .setName('📤 Export Lists to CSV')
  .setDesc('Downloads your lists (full if authenticated, public otherwise).')
  .addButton(btn => btn
    .setButtonText('Export Now')
    .setClass('mod-cta')
    .onClick(async () => {
      try {
        await this.plugin.exportUnifiedListsToCSV();
      } catch (err) {
        new Notice(`❌ Export failed: ${err.message}`, 6000);
      }
    })
  );

  }
  //  Dynamic Update of Auth button
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
      month: 'short', 
      day: 'numeric' 
    });
    this.authButton.setButtonText(`✅  Acccount Connected`);
    this.authButton.setCta();
  }
  
}

async handleAuthButtonClick() {
  const settings = this.plugin.settings;
  
  if (!settings.clientId) {
    const modal = new ClientIdModal(this.app, async (clientId) => {
      if (clientId && clientId.trim()) {
        this.plugin.settings.clientId = clientId.trim();
        await this.plugin.saveSettings();
        this.updateAuthButton();
      }
    });
    modal.open();
  } else if (!settings.clientSecret) {
    const modal = new ClientSecretModal(this.app, async (clientSecret) => {
      if (clientSecret && clientSecret.trim()) {
        this.plugin.settings.clientSecret = clientSecret.trim();
        await this.plugin.saveSettings();
        this.updateAuthButton();
      }
    });
    modal.open();
  } else if (!settings.accessToken) {
    await this.plugin.authenticateUser();
  } else {
    await this.plugin.authenticateUser();
  }
}

}




module.exports = {
  default: ZoroPlugin,
};

