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


validateSettings(data) {
  return {
    defaultUsername: typeof data?.defaultUsername === 'string' ? data.defaultUsername : '',
    defaultLayout: ['card', 'list'].includes(data?.defaultLayout) ? data.defaultLayout : 'card',
    showCoverImages: !!data?.showCoverImages,
    showRatings: !!data?.showRatings,
    showProgress: !!data?.showProgress,
    showGenres: !!data?.showGenres,
    gridColumns: Number.isInteger(data?.gridColumns) ? data.gridColumns : 3,
    clientId: typeof data?.clientId === 'string' ? data.clientId : '',
    clientSecret: typeof data?.clientSecret === 'string' ? data.clientSecret : '',
    redirectUri: typeof data?.redirectUri === 'string' ? data.redirectUri : DEFAULT_SETTINGS.redirectUri,
    accessToken: typeof data?.accessToken === 'string' ? data.accessToken : '',
  };
}

  
// Save settings 

validateSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    gridColumns: Number.isInteger(settings.gridColumns) ? settings.gridColumns : DEFAULT_SETTINGS.gridColumns,
    redirectUri: typeof settings.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
    accessToken: typeof settings.accessToken === 'string' ? settings.accessToken : '',
    // add additional field checks as needed
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

showManualTokenInstructions() {
  new Notice('📝 Instructions for manual token entry:', 10000);
  // You could include a more detailed, structured way to enter the token directly into settings here.
  const instructions = `
    1. Open the AniList OAuth page in your browser.
    2. Copy the access token.
    3. In Obsidian, go to Plugin Settings -> "Zoro" -> "Authentication".
    4. Paste the token in the "Access Token" field.
  `;
  new Notice(instructions, 15000); // Show instructions in a notice or modal.
}

//// Follow Up with the instructions 

showManualTokenInstructions() {
  const instructions = `
📋 MANUAL TOKEN INSTRUCTIONS:

1. Open https://anilist.co/api/v2/oauth/pin and authorize the app.
2. You’ll receive a PIN code.
3. Use a tool like Postman or curl (if you're technical), or skip to step 6.
4. Make a POST request to: https://anilist.co/api/v2/oauth/token
5. Use content type: application/x-www-form-urlencoded
   And body (not JSON!):
     grant_type=authorization_code&
     client_id=${this.settings.clientId}&
     client_secret=${this.settings.clientSecret}&
     redirect_uri=https://anilist.co/api/v2/oauth/pin&
     code=YOUR_PIN_CODE_HERE
6. Get your access_token from the response.
7. Paste it into the plugin settings under “Manual Token Input”.
`.trim();

  this.showInstructionsModal(instructions);
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

// 
