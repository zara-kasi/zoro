const { Plugin, Notice, requestUrl, Modal, Setting, PluginSettingTab } = require('obsidian');
const { DEFAULT_SETTINGS } = require('../settings/defaults');
const { validateSettings } = require('../settings/validators');
const { RequestQueue } = require('../utils/RequestQueue');
const { injectCSS } = require('../styles/inject');
const { createSampleNotes } = require('../utils/sampleNotes');
const {
  ClientIdModal,
  ClientSecretModal,
  AuthPinModal,
  ZoroSettingTab
} = require('../settings/modals');

class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.cache = {
      userData: new Map(),
      mediaData: new Map(),
      searchResults: new Map()
    };
    this.requestQueue = new RequestQueue();
    this.cacheTimeout = 5 * 60 * 1000;
    this.pruneInterval = null;
  }

  // ---------- lifecycle ----------
  async onload() {
    console.log('[Zoro] Plugin loading...');
    await this.loadSettings();
    injectCSS();
    this.registerMarkdownCodeBlockProcessor('zoro', this.processZoroCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processZoroSearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));
    this.addSettingTab(new ZoroSettingTab(this.app, this));
    this.pruneInterval = setInterval(() => this.pruneCache(), this.cacheTimeout);
    console.log('[Zoro] Plugin loaded successfully.');
  }

  onunload() {
    console.log('Unloading Zoro Plugin');
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) existingStyle.remove();
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    this.cache.userData.clear();
    this.cache.mediaData.clear();
    this.cache.searchResults.clear();
  }

  // ---------- settings ----------
  async loadSettings() {
    const saved = await this.loadData() || {};
    this.settings = validateSettings(Object.assign({}, DEFAULT_SETTINGS, saved));
    if (!this.settings.clientSecret) {
      const secret = await this.promptForSecret('Paste your client secret:');
      this.settings.clientSecret = secret.trim();
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(validateSettings(this.settings));
  }

  // ---------- cache ----------
  pruneCache() {
    const now = Date.now();
    ['userData', 'mediaData', 'searchResults'].forEach(type => {
      for (const [key, entry] of this.cache[type]) {
        if (now - entry.timestamp > this.cacheTimeout) this.cache[type].delete(key);
      }
    });
    console.log('[Zoro] Cache pruned');
  }

  getFromCache(type, key) {
    const map = this.cache[type];
    if (!map) return null;
    const entry = map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheTimeout) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }

  setToCache(type, key, value) {
    this.cache[type]?.set(key, { value, timestamp: Date.now() });
  }

  clearCacheForMedia(mediaId) {
    for (const [k] of this.cache.mediaData) {
      try {
        const parsed = JSON.parse(k);
        if (parsed.mediaId === mediaId || parsed.id === mediaId) this.cache.mediaData.delete(k);
      } catch {
        if (k.includes(`mediaId":${mediaId}`) || k.includes(`"id":${mediaId}`)) this.cache.mediaData.delete(k);
      }
    }
    this.cache.userData.clear();
    console.log(`[Zoro] Cleared cache for media ${mediaId}`);
  }

  // ---------- auth ----------
  async authenticateUser() {
    const { clientId, redirectUri = DEFAULT_SETTINGS.redirectUri } = this.settings;
    if (!clientId) return new Notice('❌ Please set your Client ID in plugin settings first.', 5000);
    if (this.settings.accessToken && !confirm('Do you want to re-authenticate?')) return;

    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    new Notice('🔐 Opening authentication page...', 3000);

    window.addEventListener('message', this.handleAuthMessage.bind(this));
    window.require ? window.require('electron').shell.openExternal(authUrl) : window.open(authUrl, '_blank');
    const code = await this.promptForCode('Paste the PIN code from the authentication page:');
    if (!code?.trim()) return new Notice('⚠️ No code entered. Authentication cancelled.', 4000);
    await this.exchangeCodeForToken(code.trim(), redirectUri);
    new Notice('✅ Authenticated successfully.', 4000);
  }

  async promptForCode(message) {
    return new Promise(r => r(prompt(message)));
  }

  async promptForSecret(message) {
    return new Promise(r => r(prompt(message)));
  }

  async exchangeCodeForToken(code, redirectUri) {
    const { clientId, clientSecret } = this.settings;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret || '',
      redirect_uri: redirectUri
    });
    const res = await this.requestQueue.add(() => requestUrl({
      url: 'https://anilist.co/api/v2/oauth/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString()
    }));
    const data = res.json;
    if (!data?.access_token) throw new Error(data?.error_description || 'No access token');
    this.settings.accessToken = data.access_token;
    if (data.refresh_token) this.settings.refreshToken = data.refresh_token;
    if (data.expires_in) this.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
    await this.saveSettings();
  }

  async refreshToken() {
    if (!this.settings.refreshToken) throw new Error('No refresh token');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.settings.refreshToken,
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret || ''
    });
    const res = await this.requestQueue.add(() => requestUrl({
      url: 'https://anilist.co/api/v2/oauth/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString()
    }));
    const data = res.json;
    if (!data?.access_token) throw new Error(data?.error_description || 'Invalid token response');
    this.settings.accessToken = data.access_token;
    if (data.refresh_token) this.settings.refreshToken = data.refresh_token;
    if (data.expires_in) this.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
    await this.saveSettings();
    return true;
  }

  async ensureValidToken() {
    if (!this.settings.accessToken) return false;
    const expired = this.settings.tokenExpiry && (Date.now() + 300000) >= this.settings.tokenExpiry;
    if (expired) {
      try {
        await this.refreshToken();
        new Notice('🔁 Token refreshed successfully');
        return true;
      } catch (e) {
        new Notice('⚠️ Token refresh failed: ' + e.message);
        return false;
      }
    }
    return true;
  }

  isTokenExpired() {
    return !this.settings.tokenExpiry || Date.now() >= this.settings.tokenExpiry;
  }

  async testAccessToken() {
    const query = `query { Viewer { id name } }`;
    const res = await this.requestQueue.add(() => requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    }));
    const name = res.json?.data?.Viewer?.name;
    if (!name) throw new Error('Invalid token');
    new Notice(`🎉 Welcome, ${name}! Token is valid.`);
  }

  async getAuthenticatedUsername() {
    if (!this.settings.accessToken) return null;
    await this.ensureValidToken();
    const query = `query { Viewer { name } }`;
    const res = await this.requestQueue.add(() => requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    }));
    const name = res.json?.data?.Viewer?.name;
    if (!name) return null;
    this.settings.authUsername = name;
    await this.saveSettings();
    return name;
  }

  handleAuthMessage(event) {
    if (event.origin !== 'https://anilist.co') return;
    this.exchangeCodeForToken(event.data.code);
  }

  // ---------- api ----------
  async fetchZoroData(config) {
    const cacheKey = JSON.stringify(config);
    const cacheType = { stats: 'userData', single: 'mediaData', search: 'searchResults' }[config.type] || 'userData';
    const cached = this.getFromCache(cacheType, cacheKey);
    if (cached) return cached;

    let query, variables;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.settings.accessToken) {
      await this.ensureValidToken();
      headers.Authorization = `Bearer ${this.settings.accessToken}`;
    }

    if (config.type === 'stats') {
      query = require('../api/queries').getUserStatsQuery({ username: config.username });
      variables = { username: config.username };
    } else if (config.type === 'single') {
      query = require('../api/queries').getSingleMediaQuery(config.layout);
      variables = { username: config.username, mediaId: parseInt(config.mediaId), type: config.mediaType };
    } else if (config.type === 'search') {
      query = require('../api/queries').getSearchMediaQuery(config.layout);
      variables = { search: config.search, type: config.mediaType, page: config.page || 1, perPage: config.perPage || 20 };
    } else {
      query = require('../api/queries').getMediaListQuery(config.layout);
      variables = { username: config.username, status: config.listType, type: config.mediaType || 'ANIME' };
    }

    const res = await this.requestQueue.add(() => requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    }));
    const result = res.json;
    if (result.errors?.length) {
      const msg = result.errors[0].message || 'AniList error';
      const privateErr = msg.includes('Private') || msg.includes('permission');
      if (privateErr && this.settings.accessToken) throw new Error('🚫 List is private and token lacks permission.');
      if (privateErr) throw new Error('🔒 List is private. Authenticate to access it.');
      throw new Error(msg);
    }
    if (!result.data) throw new Error('AniList returned no data.');
    this.setToCache(cacheType, cacheKey, result.data);
    return result.data;
  }

  // ---------- ui ----------
  renderZoroData(el, data, config) {
    el.empty();
    el.className = 'zoro-container';
    if (config.type === 'stats') {
      require('../ui/renderers').renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      require('../ui/renderers').renderSingleMedia(el, data.MediaList, config, this.settings);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(l => l.entries);
      if (config.layout === 'table') {
        require('../ui/renderers').renderTableLayout(el, entries, config, this.settings);
      } else {
        require('../ui/renderers').renderMediaList(el, entries, config, this.settings, this);
      }
    }
  }

  renderSearchInterface(el, config) {
    require('../ui/search').renderSearchInterface(el, config, this.settings, this);
  }

  renderSearchResults(el, media, config) {
    require('../ui/search').renderSearchResults(el, media, config, this.settings, this);
  }

  createEditModal(entry, onSave, onCancel) {
    require('../ui/modals').createEditModal(entry, onSave, onCancel);
  }

  createAddModal(entry, onSave, onCancel) {
    require('../ui/modals').createAddModal(entry, onSave, onCancel);
  }

  createAuthenticationPrompt() {
    require('../ui/modals').createAuthenticationPrompt(this);
  }

  renderError(el, message, context, onRetry) {
    require('../ui/error').renderError(el, message, context, onRetry, this.settings);
  }

  // ---------- processors ----------
  async processZoroCodeBlock(source, el, ctx) {
    const config = require('../parsers/codeblock').parseCodeBlockConfig(source, this.settings);
    try {
      if (config.useAuthenticatedUser) {
        const authUsername = await this.getAuthenticatedUsername();
        if (!authUsername) throw new Error('❌ Could not retrieve authenticated username.');
        config.username = authUsername;
      }
      if (!config.username) throw new Error('❌ No username provided.');
      const data = await this.fetchZoroData(config);
      this.renderZoroData(el, data, config);
    } catch (err) {
      this.renderError(el, err.message);
    }
  }

  async processZoroSearchCodeBlock(source, el, ctx) {
    const config = require('../parsers/codeblock').parseSearchCodeBlockConfig(source, this.settings);
    try {
      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      await this.renderSearchInterface(el, config);
    } catch (err) {
      this.renderError(el, err.message);
    }
  }

  async processInlineLinks(el, ctx) {
    const links = el.querySelectorAll('a[href^="zoro:"]');
    for (const link of links) {
      const placeholder = document.createElement('span');
      placeholder.textContent = '🔄 Loading Zoro...';
      link.replaceWith(placeholder);
      try {
        const config = require('../parsers/inlineLink').parseInlineLink(link.getAttribute('href'), this.settings);
        const data = await this.fetchZoroData(config);
        const container = document.createElement('span');
        container.className = 'zoro-inline-container';
        this.renderZoroData(container, data, config);
        placeholder.replaceWith(container);
        ctx.addChild({ unload: () => container.remove() });
      } catch (err) {
        const e = document.createElement('span');
        e.className = 'zoro-inline-error';
        e.textContent = `⚠️ ${err.message || 'Failed to load data'}`;
        placeholder.replaceWith(e);
      }
    }
  }

  // ---------- mutations ----------
  async updateMediaListEntry(mediaId, updates) {
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
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.score !== undefined && { score: updates.score }),
      ...(updates.progress !== undefined && { progress: updates.progress })
    };
    const res = await this.requestQueue.add(() => requestUrl({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query: mutation, variables })
    }));
    const result = res.json;
    if (result.errors?.length) throw new Error(`AniList update error: ${result.errors[0].message}`);
    this.clearCacheForMedia(mediaId);
    return result.data.SaveMediaListEntry;
  }

  async addMediaToList(mediaId, updates, mediaType) {
    return this.updateMediaListEntry(mediaId, updates);
  }

  async checkIfMediaInList(mediaId, mediaType) {
    if (!this.settings.accessToken) return false;
    try {
      const config = { type: 'single', mediaType, mediaId: parseInt(mediaId) };
      const data = await this.fetchZoroData(config);
      return data.MediaList !== null;
    } catch {
      return false;
    }
  }

  handleAddClick(e, mediaItem, mediaType, buttonEl) {
    require('../ui/search').handleAddClick(e, mediaItem, mediaType, buttonEl, this);
  }

  // ---------- utilities ----------
  getZoroUrl(mediaId, mediaType = 'ANIME') {
    if (!mediaId || typeof mediaId !== 'number') throw new Error(`Invalid mediaId: ${mediaId}`);
    const type = String(mediaType).toUpperCase();
    const urlType = ['ANIME', 'MANGA'].includes(type) ? type.toLowerCase() : 'anime';
    return `https://anilist.co/${urlType}/${mediaId}`;
  }
}

module.exports = ZoroPlugin;
