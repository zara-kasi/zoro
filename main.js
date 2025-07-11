const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

// plugin Class 
class ZoroPlugin extends Plugin { 

// Constructor 
constructor(app, manifest) {
  super(app, manifest);

  // In-memory cache with timeout enforcement
  this.cache = new Map();
  this.cacheTimeout = 5 * 60 * 1000;

  this.getFromCache = (key) => {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const { value, timestamp } = entry;
    if ((Date.now() - timestamp) > this.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }
    return value;
  };

  this.setToCache = (key, value) => {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  };
} 

  // On Load

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

  // Load settings 

  async loadSettings() {
  const saved = await this.loadData();
  this.settings = this.validateSettings(saved);
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


setTimeout(() => {
  plugin.saveSettings();
}, 300); // debounce-style delay



// For User Authentication 

async authenticateUser() {
  const clientId = this.settings.clientId;
  const redirectUri = this.settings.redirectUri || 'https://anilist.co/api/v2/oauth/pin';

  if (!clientId) {
    new Notice('❌ Please set your Client ID in plugin settings first.', 5000);
    return;
  }

  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;

  try {
    new Notice('🔐 Opening AniList login page...', 3000);

    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }

    const code = await this.promptForCode('Paste the PIN code from AniList:');

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

if (this.settings.accessToken) {
  const reuse = confirm('You are already authenticated. Do you want to re-authenticate?');
  if (!reuse) return;
}

/// Exchange code for token 

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
    const response = await requestUrl({
      url: 'https://anilist.co/api/v2/oauth/token',
      method: 'POST',
      headers,
      body: body.toString(),
    });

    const data = response?.json;

    if (!data || typeof data !== 'object') {
      console.error('[Zoro] Unexpected response from AniList:', response);
      throw new Error('⚠️ Invalid response from AniList.');
    }

    if (!data.access_token) {
      throw new Error(data.error_description || '❌ No access token returned by AniList.');
    }

    // Store auth details
    this.settings.accessToken = data.access_token;

    // Optional but recommended fields
    if (data.refresh_token) {
      this.settings.refreshToken = data.refresh_token;
    }

    if (data.expires_in) {
      this.settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
    }

    await this.saveSettings();

    new Notice('✅ Successfully authenticated with AniList!', 4000);

    // Optional sanity check
    await this.testAccessToken?.();

  } catch (err) {
    console.error('[Zoro] Authentication error:', err);
    new Notice(`❌ Authentication failed: ${err.message}`, 5000);
    this.showManualTokenOption?.(); // optional UI fallback
  }

}


isTokenExpired() {
  const expiry = this.settings.tokenExpiry;
  return !expiry || Date.now() >= expiry;
}

/// Make Obsidian Request 

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
    const response = await requestUrl({
      url: 'https://anilist.co/api/v2/oauth/token',
      method: 'POST',
      headers,
      body: body.toString()
    });

    if (!response || typeof response.json !== 'object') {
      throw new Error('Invalid response structure from AniList.');
    }

    return response.json;

  } catch (err) {
    console.error('[Zoro] Obsidian requestUrl failed:', err);
    throw new Error('Failed to authenticate with AniList via Obsidian requestUrl.');
  }
}

/// Incase of failure Show manual exchange token option 

showManualTokenOption() {
  new Notice('🔧 If authentication fails, you can enter the token manually.', 10000);

  setTimeout(() => {
    const userChoice = confirm(
      'Authentication failed. Would you like to manually input a token?\n\n' +
      'This involves:\n' +
      '1. Visiting AniList\'s OAuth page\n' +
      '2. Copying the access token\n' +
      '3. Pasting it below in the plugin settings.\n\n' +
      'Click OK to enter a token, Cancel to retry authentication.'
    );

    if (userChoice) {
      this.showManualTokenInstructions();
    }
  }, 2000);
}


/// Instructions Model 

class InstructionsModal extends Modal {
  constructor(app, instructions, plugin) {
    super(app);
    this.instructions = instructions;
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl('h3', { text: 'Manual Token Setup' });

    const pre = contentEl.createEl('pre', {
      text: this.instructions,
    });
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.fontSize = '12px';
    pre.style.background = '#f5f5f5';
    pre.style.padding = '12px';
    pre.style.borderRadius = '5px';
    pre.style.overflowX = 'auto';

    const btnContainer = contentEl.createDiv({ cls: 'modal-button-row' });

    const manualTokenBtn = btnContainer.createEl('button', { text: 'Manual Token Input' });
    manualTokenBtn.onclick = () => {
      this.close();
      this.plugin.promptManualToken();
    };

    const closeBtn = btnContainer.createEl('button', { text: 'Close' });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

showInstructionsModal(instructions) {
  new InstructionsModal(this.app, instructions, this).open();
}

//// Prompt For manual Token

class ManualTokenModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl('h3', { text: 'Paste Access Token' });

    const input = contentEl.createEl('textarea', {
      cls: 'token-input-area',
      placeholder: 'Paste your access token here...',
    });

    input.style.width = '100%';
    input.style.minHeight = '80px';
    input.style.marginTop = '10px';

    const btnContainer = contentEl.createDiv({ cls: 'modal-button-row' });

    const saveBtn = btnContainer.createEl('button', { text: 'Save Token' });
    saveBtn.onclick = async () => {
      const token = input.value.trim();

      if (!token) {
        new Notice('⚠️ Please enter a valid token.');
        return;
      }

      try {
        this.plugin.settings.accessToken = token;
        await this.plugin.saveSettings();
        await this.plugin.testAccessToken?.();
        new Notice('✅ Token saved and verified!');
        this.close();
      } catch (err) {
        console.error('Token test failed:', err);
        new Notice(`❌ Token invalid: ${err.message}`);
      }
    };

    const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

async promptManualToken() {
  new ManualTokenModal(this.app, this).open();
}

//// test access token 

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
    const response = await requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query })
    });

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

// Get Authenticated Username 

async getAuthenticatedUsername() {
  if (!this.settings.accessToken) return null;

  const query = `
    query {
      Viewer {
        name
      }
    }
  `;

  try {
    const response = await requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query })
    });

    const data = response.json;

    if (!data?.data?.Viewer?.name) {
      throw new Error('Invalid token or no username returned.');
    }

    return data.data.Viewer.name;

  } catch (error) {
    console.warn('[Zoro] getAuthenticatedUsername() failed:', error);
    return null;
  }
}

this.settings.authUsername = data.data.Viewer.name;
await this.saveSettings();


// Fetch Anilist Data

async fetchAniListData(config) {
  const cacheKey = JSON.stringify(config);
  const cached = this.cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
    return cached.data;
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
      perPage: config.perPage || 20
    };
  } else {
    query = this.getMediaListQuery();
    variables = {
      username: config.username,
      status: config.listType,
      type: config.mediaType || 'ANIME'
    };
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (this.settings.accessToken) {
      headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
    }

    const response = await requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    });

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

    this.cache.set(cacheKey, {
      data: result.data,
      timestamp: Date.now()
    });

    return result.data;

  } catch (error) {
    console.error('[Zoro] fetchAniListData() failed:', error);
    throw error;
  }
}

// Process Zoro Code block 

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

// Update Media list entry 

async updateMediaListEntry(mediaId, updates) {
  if (!this.settings.accessToken) {
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

  // Filter out undefined values — critical to avoid mutation errors
  const variables = {
    mediaId,
    ...(updates.status !== undefined && { status: updates.status }),
    ...(updates.score !== undefined && { score: updates.score }),
    ...(updates.progress !== undefined && { progress: updates.progress }),
  };

  try {
    const response = await requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query: mutation, variables })
    });

    const result = response.json;

    if (!result || result.errors?.length > 0) {
      const message = result.errors?.[0]?.message || 'Unknown mutation error';
      throw new Error(`AniList update error: ${message}`);
    }

    // Clear cache on success
    this.cache.clear();

    return result.data.SaveMediaListEntry;

  } catch (error) {
    console.error('[Zoro] updateMediaListEntry failed:', error);
    throw new Error(`❌ Failed to update entry: ${error.message}`);
  }
}
async processZoroSearchCodeBlock(source, el, ctx) {
  try {
    const config = this.parseSearchCodeBlockConfig(source);
    
    // Optional: track per-block context
    ctx.addChild({
      unload: () => {
        // Cleanup if needed
      }
    });

    await this.renderSearchInterface(el, config); // Future-proof
  } catch (error) {
    console.error('[Zoro] Search block processing error:', error);
    this.renderError(el, error.message || 'Failed to process Zoro search block.');
  }
}

if (!config.search || config.search.trim().length === 0) {
  throw new Error('Search query is missing or empty.');
}

if (this.settings.debugMode) {
  console.log('[Zoro] Search block config:', config);
}

el.createEl('div', { text: '🔍 Searching AniList...', cls: 'zoro-loading-placeholder' });

/// code block Confirmation 

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
      // We'll handle this in the processAniListCodeBlock method
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

// Search code block Confirmation 

parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    // Default to ANIME if no mediaType specified
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.settings.defaultLayout;
    
    return config;
}

// Processing inline link

async processInlineLinks(el, ctx) {
  const inlineLinks = el.querySelectorAll('a[href^="anilist:"]');

  for (const link of inlineLinks) {
    const href = link.getAttribute('href');
    
    // Optional: Show loading shimmer while data loads
    const placeholder = document.createElement('span');
    placeholder.textContent = '🔄 Loading AniList...';
    link.replaceWith(placeholder);

    try {
      const config = this.parseInlineLink(href);
      const data = await this.fetchAniListData(config);

      const container = document.createElement('span');
      container.className = 'anilist-inline-container';
      this.renderAniListData(container, data, config);

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
      errorEl.className = 'anilist-inline-error';
      errorEl.textContent = `⚠️ ${error.message || 'Failed to load data'}`;

      placeholder.replaceWith(errorEl);
    }
  }
}


/// Inline Link


parseInlineLink(href) {
  const [base, hash] = href.replace('anilist:', '').split('#');

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
      throw new Error('❌ Invalid AniList inline link format.');
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


// Fetch Anilist Data 


async fetchAniListData(config) {
  const cacheKey = JSON.stringify(config);

  if (!config.nocache) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
  }

  let query, variables;

  switch (config.type) {
    case 'stats':
      query = this.getUserStatsQuery();
      variables = { username: config.username };
      break;

    case 'single':
      query = this.getSingleMediaQuery();
      variables = {
        username: config.username,
        mediaId: parseInt(config.mediaId),
        type: config.mediaType
      };
      break;

    case 'search':
      query = this.getSearchMediaQuery();
      variables = {
        search: config.search,
        type: config.mediaType,
        page: config.page || 1,
        perPage: config.perPage || 20
      };
      break;

    default: // media list
      query = this.getMediaListQuery();
      variables = {
        username: config.username,
        status: config.listType,
        type: config.mediaType || 'ANIME'
      };
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (this.settings.accessToken) {
      headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
    }

    const response = await requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    });

    const result = response.json;

    if (!result || result.errors?.length > 0) {
      const errMsg = result.errors?.[0]?.message || 'Unknown AniList error';
      if (errMsg.includes('Private')) {
        throw new Error(this.settings.accessToken
          ? '🚫 This list is private and you lack permission.'
          : '🔒 This list is private. Authenticate to view.');
      }
      throw new Error(`❌ AniList error: ${errMsg}`);
    }

    const data = result.data;
    if (!data) throw new Error('❌ No data received from AniList.');

    if (!config.nocache) {
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });
    }

    return data;

  } catch (err) {
    console.error('[Zoro] AniList fetch failed:', err);
    throw new Error(`❌ Failed to fetch data: ${err.message}`);
  }
}

/// Media List query

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

/// single Media Query 

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

// User Stats Query

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

// Search Media Query 


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

getAniListUrl(mediaId, mediaType = 'ANIME') {
  if (!mediaId || typeof mediaId !== 'number') {
    throw new Error(`Invalid mediaId: ${mediaId}`);
  }

  const type = String(mediaType).toUpperCase();

  const validTypes = ['ANIME', 'MANGA'];
  const urlType = validTypes.includes(type) ? type.toLowerCase() : 'anime'; // fallback

  return `https://anilist.co/${urlType}/${mediaId}`;
}


// **Renders**


/// Render Search Interface 

renderSearchInterface(el, config) {
  el.empty();
  el.className = 'anilist-search-container';

  // Input container
  const searchDiv = document.createElement('div');
  searchDiv.className = 'anilist-search-input-container';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'anilist-search-input';
  searchInput.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';

  searchDiv.appendChild(searchInput);
  el.appendChild(searchDiv);

  // Results container
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'anilist-search-results';
  el.appendChild(resultsDiv);

  let searchTimeout;

  const performSearch = async () => {
    const searchTerm = searchInput.value.trim();

    if (searchTerm.length < 3) {
      resultsDiv.innerHTML = '<div class="anilist-search-message">Type at least 3 characters to search...</div>';
      return;
    }

    resultsDiv.innerHTML = `
      <div class="anilist-search-loading">
        🔍 Searching...
      </div>
    `;

    try {
      const searchConfig = {
        ...config,
        search: searchTerm,
        page: 1,
        perPage: 20
      };

      const data = await this.fetchAniListData(searchConfig);

      if (!data.Page || !data.Page.media || data.Page.media.length === 0) {
        resultsDiv.innerHTML = '<div class="anilist-search-message">😕 No results found.</div>';
        return;
      }

      this.renderSearchResults(resultsDiv, data.Page.media, config);

    } catch (error) {
      console.error('Search error:', error);
      resultsDiv.innerHTML = `<div class="anilist-search-error">❌ ${error.message}</div>`;
    }
  };

  // Event: Input with debounce
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 400);
  });

  // Event: Press Enter
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimeout);
      performSearch();
    }
  });

  // Optional: blur/cancel
  searchInput.addEventListener('blur', () => {
    clearTimeout(searchTimeout);
  });
}

// Render Search Result 

renderSearchResults(el, media, config) {
  el.empty();

  if (!media || media.length === 0) {
    el.innerHTML = '<div class="anilist-search-message">😕 No results found.</div>';
    return;
  }

  const layout = config.layout || 'card';
  const grid = document.createElement('div');
  grid.className = `anilist-results-grid layout-${layout}`;
  grid.style.setProperty('--anilist-grid-columns', this.settings.gridColumns || 3);

  media.forEach(item => {
    const title = item.title.english || item.title.romaji || item.title.native || 'Untitled';

    const card = document.createElement('div');
    card.className = 'anilist-search-card';

    // Cover image
    if (this.settings.showCoverImages) {
      const img = document.createElement('img');
      img.src = item.coverImage?.large || '';
      img.alt = `${title} cover`;
      img.className = 'media-cover';
      img.loading = 'lazy';
      card.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'media-info';

    // Title
    const titleEl = document.createElement('h4');
    const titleLink = document.createElement('a');
    titleLink.href = this.getAniListUrl(item.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = title;
    titleLink.className = 'anilist-title-link';
    titleEl.appendChild(titleLink);
    info.appendChild(titleEl);

    // Metadata badges
    const meta = document.createElement('div');
    meta.className = 'media-details';

    // Format
    if (item.format) {
      const format = document.createElement('span');
      format.className = 'format-badge';
      format.textContent = item.format;
      meta.appendChild(format);
    }

    // Status
    if (item.status) {
      const status = document.createElement('span');
      status.className = `status-badge status-${item.status.toLowerCase()}`;
      status.textContent = item.status;
      meta.appendChild(status);
    }

    // Score
    if (this.settings.showRatings && item.averageScore) {
      const score = document.createElement('span');
      score.className = 'score-badge';
      score.textContent = `★ ${item.averageScore}`;
      meta.appendChild(score);
    }

    info.appendChild(meta);

    // Genres
    if (this.settings.showGenres && item.genres?.length) {
      const genres = document.createElement('div');
      genres.className = 'media-genres';
      item.genres.slice(0, 3).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = genre;
        genres.appendChild(tag);
      });
      info.appendChild(genres);
    }

    card.appendChild(info);
    grid.appendChild(card);
  });

  el.appendChild(grid);
}

// Render AniList Data 

renderAniListData(el, data, config) {
  el.empty();
  el.className = 'zoro-container';

  try {
    if (config.type === 'stats') {
      if (!data?.User) {
        throw new Error('User statistics not found. Is the username correct?');
      }
      this.renderUserStats(el, data.User);
    }

    else if (config.type === 'single') {
      if (!data?.MediaList) {
        throw new Error('Media entry not found. Please check the ID or username.');
      }
      this.renderSingleMedia(el, data.MediaList, config);
    }

    else if (data?.MediaListCollection?.lists?.length) {
      const entries = data.MediaListCollection.lists.flatMap(list => list.entries || []);
      const layout = config.layout || this.settings.defaultLayout || 'card';

      if (layout === 'table') {
        this.renderTableLayout(el, entries);
      } else {
        this.renderMediaList(el, entries, config);
      }
    }

    else {
      throw new Error('No media list data found.');
    }

  } catch (error) {
    console.error('Error rendering AniList data:', error);
    this.renderError(el, error.message || 'Unknown rendering error');
  }
}

// Render User's Stats


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
  if (!mediaList || !mediaList.media) {
    this.renderError(el, 'Media data unavailable.');
    return;
  }

  const media = mediaList.media;
  const title = media.title.english || media.title.romaji || 'Untitled';

  const cardDiv = document.createElement('div');
  cardDiv.className = 'zoro-single-card';

  if (this.settings.showCoverImages && media.coverImage?.large) {
    const img = document.createElement('img');
    img.src = media.coverImage.large;
    img.alt = title;
    img.className = 'zoro-media-cover';
    cardDiv.appendChild(img);
  }

  const mediaInfoDiv = document.createElement('div');
  mediaInfoDiv.className = 'zoro-media-info';

  // Title
  const titleElement = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = this.getAniListUrl(media.id, config.mediaType);
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.className = 'zoro-title-link';
  titleLink.textContent = title;
  titleElement.appendChild(titleLink);
  mediaInfoDiv.appendChild(titleElement);

  // Badges
  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'zoro-media-details';

  if (media.format) {
    const formatBadge = document.createElement('span');
    formatBadge.className = 'zoro-badge zoro-format';
    formatBadge.textContent = media.format;
    detailsDiv.appendChild(formatBadge);
  }

  const statusBadge = document.createElement('span');
  statusBadge.className = `zoro-badge zoro-status status-${mediaList.status?.toLowerCase()}`;
  statusBadge.textContent = mediaList.status || 'Unknown';
  detailsDiv.appendChild(statusBadge);

  if (this.settings.showProgress) {
    const progressSpan = document.createElement('span');
    progressSpan.className = 'zoro-badge zoro-progress';
    const total = media.episodes ?? media.chapters ?? '?';
    progressSpan.textContent = `Progress: ${mediaList.progress}/${total}`;
    detailsDiv.appendChild(progressSpan);
  }

  if (this.settings.showRatings && mediaList.score != null) {
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'zoro-badge zoro-score';
    scoreSpan.textContent = `★ ${mediaList.score}`;
    detailsDiv.appendChild(scoreSpan);
  }

  mediaInfoDiv.appendChild(detailsDiv);

  // Genres
  if (this.settings.showGenres && Array.isArray(media.genres)) {
    const genresDiv = document.createElement('div');
    genresDiv.className = 'zoro-genres';
    media.genres.slice(0, 3).forEach(genre => {
      const tag = document.createElement('span');
      tag.className = 'zoro-genre-tag';
      tag.textContent = genre;
      genresDiv.appendChild(tag);
    });
    mediaInfoDiv.appendChild(genresDiv);
  }

  cardDiv.appendChild(mediaInfoDiv);
  el.appendChild(cardDiv);
}

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

  // Cover
  if (this.settings.showCoverImages && media.coverImage?.large) {
    const img = document.createElement('img');
    img.src = media.coverImage.large;
    img.alt = title;
    img.className = 'zoro-media-cover';
    cardDiv.appendChild(img);
  }

  const infoDiv = document.createElement('div');
  infoDiv.className = 'zoro-media-info';

  // Title
  const titleElement = document.createElement('h4');
  const titleLink = document.createElement('a');
  titleLink.href = this.getAniListUrl(media.id, config.mediaType);
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.className = 'zoro-title-link';
  titleLink.textContent = title;
  titleElement.appendChild(titleLink);
  infoDiv.appendChild(titleElement);

  // Details
  const detailsDiv = this.createDetailsRow(entry);
  infoDiv.appendChild(detailsDiv);

  // Genres
  if (this.settings.showGenres && media.genres?.length) {
    const genresDiv = document.createElement('div');
    genresDiv.className = 'zoro-genres';
    media.genres.slice(0, 3).forEach(genre => {
      const tag = document.createElement('span');
      tag.className = 'zoro-genre-tag';
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
  details.className = 'zoro-media-details';

  // Format
  if (media.format) {
    const format = document.createElement('span');
    format.className = 'zoro-badge zoro-format';
    format.textContent = media.format;
    details.appendChild(format);
  }

  // Status
  const status = document.createElement('span');
  status.className = `zoro-badge zoro-status clickable-status status-${entry.status?.toLowerCase()}`;
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

  // Progress
  if (this.settings.showProgress) {
    const progress = document.createElement('span');
    progress.className = 'zoro-badge zoro-progress';
    const total = media.episodes ?? media.chapters ?? '?';
    progress.textContent = `Progress: ${entry.progress}/${total}`;
    details.appendChild(progress);
  }

  // Score
  if (this.settings.showRatings && entry.score != null) {
    const score = document.createElement('span');
    score.className = 'zoro-badge zoro-score';
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
        this.cache.clear();
        const parent = statusEl.closest('.zoro-container');
        if (parent) {
          const block = parent.closest('.markdown-rendered')?.querySelector('code');
          if (block) this.processAniListCodeBlock(block.textContent, parent, {});
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
    link.href = this.getAniListUrl(media.id, config.mediaType);
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
    if (this.settings.showProgress) {
      const progressCell = document.createElement('td');
      const total = media.episodes ?? media.chapters ?? '?';
      progressCell.textContent = `${entry.progress}/${total}`;
      row.appendChild(progressCell);
    }

    // --- Score ---
    if (this.settings.showRatings) {
      const scoreCell = document.createElement('td');
      scoreCell.textContent = entry.score != null ? `★ ${entry.score}` : '-';
      row.appendChild(scoreCell);
    }

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  el.appendChild(table);
}

// Create Edit Mode


createEditModal(entry, onSave, onCancel) {
  const modal = document.createElement('div');
  modal.className = 'anilist-edit-modal';

  const overlay = document.createElement('div');
  overlay.className = 'anilist-modal-overlay';

  const content = document.createElement('div');
  content.className = 'anilist-modal-content';

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
  statusLabel.setAttribute('for', 'anilist-status');

  const statusSelect = document.createElement('select');
  statusSelect.id = 'anilist-status';

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
  scoreLabel.textContent = 'Score (0–10)';
  scoreLabel.setAttribute('for', 'anilist-score');

  const scoreInput = document.createElement('input');
  scoreInput.type = 'number';
  scoreInput.id = 'anilist-score';
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
  progressLabel.setAttribute('for', 'anilist-progress');

  const progressInput = document.createElement('input');
  progressInput.type = 'number';
  progressInput.id = 'anilist-progress';
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
  buttonContainer.className = 'anilist-modal-buttons';

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

// Create Sample Notes from default Templates

async createSampleNotes() {
  try {
    let successCount = 0;
    const errorMessages: string[] = [];

    const notesToCreate = [
      {
        title: "Zoro Anime Dashboard",
        content: `\`\`\`zoro-search
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
layout: card
\`\`\`

# 🌀 Repeating:
\`\`\`zoro
listType: REPEATING
mediaType: ANIME
layout: card
\`\`\`

# ⏸️ On Hold:
\`\`\`zoro
listType: PAUSED
mediaType: ANIME
layout: card
\`\`\`

# 🏁 Completed:
\`\`\`zoro
listType: COMPLETED
mediaType: ANIME
layout: card
\`\`\`

# 🗑️ Dropped:
\`\`\`zoro
listType: DROPPED
mediaType: ANIME
layout: card
\`\`\`

# 📊 Stats:
\`\`\`zoro
type: stats
\`\`\``
      },
      {
        title: "Zoro Manga Dashboard",
        content: `\`\`\`zoro-search
mediaType: MANGA
layout: card
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
\`\`\``
      }
    ];

    for (const { title, content } of notesToCreate) {
      const filePath = `${title}.md`;
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);

      if (existingFile) {
        errorMessages.push(`"${title}" already exists`);
        continue;
      }

      await this.app.vault.create(filePath, content);
      successCount++;
    }

    if (successCount > 0) {
      new Notice(`✅ Created ${successCount} Zoro dashboard note${successCount > 1 ? 's' : ''}.`, 4000);
      const first = this.app.vault.getAbstractFileByPath(`${notesToCreate[0].title}.md`);
      if (first) await this.app.workspace.openLinkText(`${notesToCreate[0].title}.md`, '', false);
    }

    if (errorMessages.length > 0) {
      new Notice(`⚠️ Issues: ${errorMessages.join(', ')}`, 5000);
    }

  } catch (error) {
    console.error('Error creating notes:', error);
    new Notice(`❌ Failed to create Zoro notes: ${error.message}`, 5000);
  }
}

/// Injection css

injectCSS() {
  const styleId = 'zoro-plugin-styles';

  // Remove any existing <style> element with the same ID
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
  }

  // Dynamically inject CSS into the document head
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = this.generateZoroCSS(); // pull styles from a method or external file
  document.head.appendChild(style);
}


// Render Errors

renderError(el, message, context = '') {
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

  el.appendChild(wrapper);
}

renderError(el, message, context = '', onRetry = null) {
  ...
  if (typeof onRetry === 'function') {
    const retryBtn = document.createElement('button');
    retryBtn.textContent = '🔄 Retry';
    retryBtn.onclick = onRetry;
    wrapper.appendChild(retryBtn);
  }
}


// End Plugin class 

onunload() {
  console.log('Unloading Zoro Plugin');

  const styleId = 'zoro-plugin-styles';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
    console.log(`Removed style element with ID: ${styleId}`);
  }
}

// Settings Menu 

class ZoroSettingTab extends PluginSettingTab { constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

display() { const { containerEl } = this; containerEl.empty();

new Setting(containerEl)
  .setName('👤 Username')
  .setDesc('Add your Zoro username to view your lists and stats — just make sure your profile is public.')
  .addText(text => text
    .setPlaceholder('Enter your Zoro username')
    .setValue(this.plugin.settings.defaultUsername)
    .onChange(async (value) => {
      this.plugin.settings.defaultUsername = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('➕ Sample Notes')
  .setDesc('Creates two notes — one for Anime, one for Manga — with all your lists, search, and stats preloaded. No setup needed.')
  .addButton(button => button
    .setButtonText('Create Note')
    .setTooltip('Click to create a sample note in your vault')
    .onClick(async () => {
      await this.plugin.createSampleNotes();
    }));

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
  .setName('🔑 Client ID')
  .setDesc('Your Zoro application Client ID')
  .addText(text => text
    .setPlaceholder('Enter Client ID')
    .setValue(this.plugin.settings.clientId || '')
    .onChange(async (value) => {
      this.plugin.settings.clientId = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('🔐 Client Secret')
  .setDesc('Your Zoro application Client Secret')
  .addText(text => text
    .setPlaceholder('Enter Client Secret')
    .setValue(this.plugin.settings.clientSecret || '')
    .onChange(async (value) => {
      this.plugin.settings.clientSecret = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('🔗 Redirect URI')
  .setDesc('Your application redirect URI')
  .addText(text => text
    .setPlaceholder('http://localhost:8080/callback')
    .setValue(this.plugin.settings.redirectUri || 'http://localhost:8080/callback')
    .onChange(async (value) => {
      this.plugin.settings.redirectUri = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('🔓 Authenticate')
  .setDesc('Connect your Zoro account')
  .addButton(button => button
    .setButtonText(this.plugin.settings.accessToken ? 'Re-authenticate' : 'Authenticate')
    .onClick(async () => {
      await this.plugin.authenticateUser();
    }));

new Setting(containerEl)
  .setName('🔧 Manual Token Input')
  .setDesc('If automatic authentication fails, manually paste your access token here')
  .addText(text => text
    .setPlaceholder('Paste access token here...')
    .setValue('')
    .onChange(async (value) => {
      if (value.trim()) {
        this.plugin.settings.accessToken = value.trim();
        await this.plugin.saveSettings();
        new Notice('✅ Manual token saved! Testing...');
        try {
          await this.plugin.testAccessToken();
        } catch (error) {
          new Notice(`❌ Token test failed: ${error.message}`);
        }
      }
    }))
  .addButton(button => button
    .setButtonText('Clear Token')
    .onClick(async () => {
      this.plugin.settings.accessToken = '';
      await this.plugin.saveSettings();
      new Notice('Token cleared');
      this.display();
    }));

new Setting(containerEl)
  .setName('🔑 Authentication Status')
  .setDesc(this.plugin.settings.accessToken ? 
    '✅ Authenticated (Token saved)' : 
    '❌ Not authenticated');

new Setting(containerEl)
  .setName('⚡ Power Features')
  .setDesc('Want more features? Visit our GitHub page for tips, tricks, and powerful ways to customize your notes.')
  .addButton(button => button
    .setButtonText('View Documentation')
    .onClick(() => {
      window.open('https://github.com/zara-kasi/zoro/blob/main/README.md', '_blank');
    }));

} }

// end
module.exports = ZoroSettingTab;











