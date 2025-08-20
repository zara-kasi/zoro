const { Plugin } = require('obsidian');

// Import constants using CommonJS
const { DEFAULT_SETTINGS, getDefaultGridColumns } = require('./src/core/constants.js');

// Import all classes using CommonJS
const { Cache } = require('./src/cache/Cache.js');
const { AniListRequest } = require('./src/api/requests/AniListRequest.js');
const { MALRequest } = require('./src/api/requests/MALRequest.js');
const { SimklRequest } = require('./src/api/requests/SimklRequest.js');
const { RequestQueue } = require('./src/api/requests/RequestQueue.js');
const { AnilistApi } = require('./src/api/services/AnilistApi.js');
const { MalApi } = require('./src/api/services/MalApi.js');
const { SimklApi } = require('./src/api/services/SimklApi.js');
const { Authentication } = require('./src/auth/Authentication.js');
const { MALAuthentication } = require('./src/auth/MALAuthentication.js');
const { SimklAuthentication } = require('./src/auth/SimklAuthentication.js');
const { AuthModal } = require('./src/auth/AuthModal.js');
const { SimklPinModal } = require('./src/auth/SimklPinModal.js');
const { Render } = require('./src/rendering/core/Render.js');
const { EmojiIconMapper } = require('./src/rendering/helpers/EmojiIconMapper.js');
const { Edit } = require('./src/editing/Edit.js');
const { ConnectedNotes } = require('./src/features/ConnectedNotes.js');
const { Theme } = require('./src/features/Theme.js');
const { Prompt } = require('./src/features/Prompt.js');
const { Export } = require('./src/features/Export.js');
const { Sample } = require('./src/features/Sample.js');
const { MoreDetailsPanel } = require('./src/details/MoreDetailsPanel.js');
const { Processor } = require('./src/processing/Processor.js');
const { ZoroSettingTab } = require('./src/settings/ZoroSettingTab.js');

// Your complete ZoroPlugin class with all your methods
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
    this.simklAuth = new SimklAuthentication(this);
    this.simklApi = new SimklApi(this);
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

  getSimklUrl(mediaId, mediaType = 'ANIME') {
    return this.simklApi.getSimklUrl(mediaId, mediaType);
  }
  
  getSourceSpecificUrl(mediaId, mediaType, source) {
    const type = String(mediaType || '').toUpperCase();
    const numericId = Number(mediaId) || 0;

    if ((type === 'MOVIE' || type === 'TV') && numericId > 0) {
      return `https://www.themoviedb.org/${type === 'MOVIE' ? 'movie' : 'tv'}/${numericId}`;
    }

    switch ((source || '').toLowerCase()) {
      case 'mal':
        return this.getMALUrl(mediaId, mediaType);
      case 'simkl':
        return this.getSimklUrl(mediaId, mediaType);
      case 'anilist':
      default:
        return this.getAniListUrl(mediaId, mediaType);
    }
  }

  async updateDefaultApiSourceBasedOnAuth() {
    try {
      if (this.settings.defaultApiUserOverride) return;
      const authenticated = [];
      if (this.settings.accessToken) authenticated.push('anilist');
      if (this.settings.malAccessToken) authenticated.push('mal');
      if (this.settings.simklAccessToken) authenticated.push('simkl');

      let newDefault = this.settings.defaultApiSource;
      if (authenticated.length === 1) {
        newDefault = authenticated[0];
      } else {
        newDefault = 'anilist';
      }

      if (newDefault !== this.settings.defaultApiSource) {
        this.settings.defaultApiSource = newDefault;
        await this.saveSettings();
      }
    } catch (e) {
      console.warn('[Zoro] Failed to update default API source automatically:', e);
    }
  }

  // Fixed: Add promptForSecret method
  async promptForSecret(message) {
    const { Notice } = require('obsidian');
    
    return new Promise((resolve) => {
      // Simple prompt - you can enhance this later with a proper modal
      const secret = prompt(message || 'Enter your client secret:');
      if (!secret || secret.trim() === '') {
        new Notice('❌ Client secret is required for the plugin to work properly.');
        resolve('');
      } else {
        resolve(secret.trim());
      }
    });
  }

  async onload() {
    this.render = new Render(this);
    this.emojiMapper = new EmojiIconMapper();
    this.emojiMapper.init({ patchSettings:true, patchCreateEl:true, patchNotice:true });
    this.connectedNotes = new ConnectedNotes(this);
    
    try {
      await this.loadSettings();
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }
    
    await this.cache.loadFromDisk(); 
    this.cache.startAutoPrune(5 * 60 * 1000);
    
    try {
      this.injectCSS();
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }
    
    if (this.settings.theme) {
      await this.theme.applyTheme(this.settings.theme);
    }

    this.registerMarkdownCodeBlockProcessor('zoro', this.processor.processZoroCodeBlock.bind(this.processor));
    this.addSettingTab(new ZoroSettingTab(this.app, this));
  }

  validateSettings(settings) {
    return {
      defaultApiSource: ['anilist', 'mal', 'simkl'].includes(settings?.defaultApiSource) ? settings.defaultApiSource : 'anilist',
      defaultApiUserOverride: typeof settings?.defaultApiUserOverride === 'boolean' ? settings.defaultApiUserOverride : false,
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'table'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      notePath: typeof settings?.notePath === 'string' ? settings.notePath : 'Zoro/Note',
      insertCodeBlockOnNote: typeof settings?.insertCodeBlockOnNote === 'boolean' ? settings.insertCodeBlockOnNote : true,
      showCoverImages: typeof settings?.showCoverImages === 'boolean' ? settings.showCoverImages : true,
      showRatings: typeof settings?.showRatings === 'boolean' ? settings.showRatings : true,
      showProgress: typeof settings?.showProgress === 'boolean' ? settings.showProgress : true,
      showGenres: typeof settings?.showGenres === 'boolean' ? settings.showGenres : false,
      showLoadingIcon: typeof settings?.showLoadingIcon === 'boolean' ? settings.showLoadingIcon : true,
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : DEFAULT_SETTINGS.gridColumns,
      theme: typeof settings?.theme === 'string' ? settings.theme : '',
      hideUrlsInTitles: typeof settings?.hideUrlsInTitles === 'boolean' ? settings.hideUrlsInTitles : true,
      forceScoreFormat: typeof settings?.forceScoreFormat === 'boolean' ? settings.forceScoreFormat : true,
      showAvatar: typeof settings?.showAvatar === 'boolean' ? settings.showAvatar : true,
      showFavorites: typeof settings?.showFavorites === 'boolean' ? settings.showFavorites : true,
      showBreakdowns: typeof settings?.showBreakdowns === 'boolean' ? settings.showBreakdowns : true,
      showTimeStats: typeof settings?.showTimeStats === 'boolean' ? settings.showTimeStats : true,
      statsLayout: ['enhanced', 'compact', 'minimal'].includes(settings?.statsLayout) ? settings.statsLayout : 'enhanced',
      statsTheme: ['auto', 'light', 'dark'].includes(settings?.statsTheme) ? settings.statsTheme : 'auto',
      clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
      clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
      redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : 'https://anilist.co/api/v2/oauth/pin',
      accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : '',
      malClientId: typeof settings?.malClientId === 'string' ? settings.malClientId : '',
      malClientSecret: typeof settings?.malClientSecret === 'string' ? settings.malClientSecret : '',
      malAccessToken: typeof settings?.malAccessToken === 'string' ? settings.malAccessToken : '',
      malRefreshToken: typeof settings?.malRefreshToken === 'string' ? settings.malRefreshToken : '',
      malTokenExpiry: settings?.malTokenExpiry === null || typeof settings?.malTokenExpiry === 'number' ? settings.malTokenExpiry : null,
      malUserInfo: settings?.malUserInfo === null || typeof settings?.malUserInfo === 'object' ? settings.malUserInfo : null,
      simklClientId: typeof settings?.simklClientId === 'string' ? settings.simklClientId : '',
      simklClientSecret: typeof settings?.simklClientSecret === 'string' ? settings.simklClientSecret : '',
      simklAccessToken: typeof settings?.simklAccessToken === 'string' ? settings.simklAccessToken : '',
      simklUserInfo: settings?.simklUserInfo === null || typeof settings?.simklUserInfo === 'object' ? settings.simklUserInfo : null,
      autoFormatSearchUrls: typeof settings?.autoFormatSearchUrls === 'boolean' ? settings.autoFormatSearchUrls : true,
      customSearchUrls: {
        ANIME: Array.isArray(settings?.customSearchUrls?.ANIME) ? 
          settings.customSearchUrls.ANIME.filter(url => typeof url === 'string' && url.trim() !== '') : [],
        MANGA: Array.isArray(settings?.customSearchUrls?.MANGA) ? 
          settings.customSearchUrls.MANGA.filter(url => typeof url === 'string' && url.trim() !== '') : [],
        MOVIE_TV: Array.isArray(settings?.customSearchUrls?.MOVIE_TV) ? 
          settings.customSearchUrls.MOVIE_TV.filter(url => typeof url === 'string' && url.trim() !== '') : []
      },
      tmdbApiKey: typeof settings?.tmdbApiKey === 'string' ? settings.tmdbApiKey : '',
    };
  }

  async saveSettings() {
    const { Notice } = require('obsidian');
    
    try {
      const validSettings = this.validateSettings(this.settings);
      await this.saveData(validSettings);
    } catch (err) {
      console.error('[Zoro] Failed to save settings:', err);
      new Notice('⚠️ Failed to save settings. See console for details.');
    }
  }

  async loadSettings() {
    const saved = await this.loadData() || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);
    
    // Fixed: Only prompt if absolutely necessary and method exists
    if (!this.settings.clientSecret && typeof this.promptForSecret === 'function') {
      try {
        const secret = await this.promptForSecret("Paste your client secret:");
        this.settings.clientSecret = secret.trim();
        await this.saveData(this.settings);
      } catch (err) {
        console.warn('[Zoro] Could not prompt for client secret:', err);
      }
    }
    
    if (typeof this.updateDefaultApiSourceBasedOnAuth === 'function') {
      await this.updateDefaultApiSourceBasedOnAuth();
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
        if (config.source === 'mal') {
          await this.malApi.updateMediaListEntry(entry.media.id, updates);
        } else if (config.source === 'simkl') {
          await this.simklApi.updateMediaListEntry(entry.media.id, updates);
        } else {
          await this.api.updateMediaListEntry(entry.media.id, updates);
        }
      },
      () => {
        // Callback after successful update
      },
      config.source || 'anilist'
    );
  }

  getStatsConfig() {
    return {
      showAvatar: this.settings.showAvatar ?? true,
      showFavorites: this.settings.showFavorites ?? true,
      showBreakdowns: this.settings.showBreakdowns ?? true,
      showTimeStats: this.settings.showTimeStats ?? true,
      layout: this.settings.statsLayout ?? 'enhanced',
      theme: this.settings.statsTheme ?? 'auto'
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
      <div class="global-loading-glow">
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

  // Fixed: Remove problematic handleAuthMessage or implement properly
  // This was calling non-existent exchangeCodeForToken
  // Comment out or remove if not needed:
  /*
  handleAuthMessage(event) {
    if (event.origin !== 'https://anilist.co') return;
    // Fixed: Use correct method from auth
    if (this.auth && typeof this.auth.exchangePin === 'function') {
      this.auth.exchangePin(event.data.code);
    }
  }
  */

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
    this.cache.stopAutoPrune()
       .stopBackgroundRefresh()
       .destroy();

    this.theme.removeTheme();
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
        existingStyle.remove();
    }

    const loader = document.getElementById('zoro-global-loader');
    if (loader) loader.remove();
  }
}

// Export for Obsidian (CommonJS only)
module.exports = {
  default: ZoroPlugin,
};