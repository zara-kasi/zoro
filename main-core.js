// The plugin bootstrap and core logic
const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');
const auth = require('./auth');
const api = require('./api');
const render = require('./render');
const utils = require('./utils');
const { ZoroSettingTab } = require('./settings');

class ZoroPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000;
  }

  async onload() {
    console.log('Loading Zoro Plugin');
    await this.loadSettings();
    this.injectCSS();
    this.registerMarkdownCodeBlockProcessor('anilist', this.processAniListCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('anilist-search', this.processAniListSearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));
    this.addSettingTab(new ZoroSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, {
      defaultUsername: '',
      defaultLayout: 'card',
      showCoverImages: true,
      showRatings: true,
      showProgress: true,
      showGenres: false,
      gridColumns: 3,
      clientId: '',
      clientSecret: '',
      redirectUri: 'https://anilist.co/api/v2/oauth/pin',
      accessToken: ''
    }, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async processAniListCodeBlock(source, el, ctx) {
    try {
      const config = utils.parseCodeBlockConfig.call(this, source);
      if (config.useAuthenticatedUser) {
        const authUsername = await api.getAuthenticatedUsername.call(this);
        if (authUsername) {
          config.username = authUsername;
        } else {
          throw new Error('Unable to get authenticated user.');
        }
      }
      const data = await api.fetchAniListData.call(this, config);
      render.renderAniListData.call(this, el, data, config);
    } catch (error) {
      render.renderError(el, error.message);
    }
  }

  async processAniListSearchCodeBlock(source, el, ctx) {
    try {
      const config = utils.parseSearchCodeBlockConfig.call(this, source);
      render.renderSearchInterface.call(this, el, config);
    } catch (error) {
      render.renderError(el, error.message);
    }
  }

  async processInlineLinks(el, ctx) {
    const links = el.querySelectorAll('a[href^="anilist:"]');
    for (const link of links) {
      try {
        const config = utils.parseInlineLink.call(this, link.getAttribute('href'));
        const data = await api.fetchAniListData.call(this, config);
        const container = document.createElement('div');
        container.className = 'zoro-inline-container';
        render.renderAniListData.call(this, container, data, config);
        link.parentNode.replaceChild(container, link);
      } catch (error) {
        render.renderError(link, error.message);
      }
    }
  }

  injectCSS() {
    const styleId = 'zoro-plugin-styles';
    const existing = document.getElementById(styleId);
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = render.additionalCSS;
    document.head.appendChild(style);
  }

  onunload() {
    console.log('Unloading Zoro Plugin');
    const styleId = 'zoro-plugin-styles';
    const existing = document.getElementById(styleId);
    if (existing) existing.remove();
  }
}

module.exports = {
  default: ZoroPlugin
};
