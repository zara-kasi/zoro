import { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } from 'obsidian';

import RequestQueue from '../lib/RequestQueue.js';
import CacheManager from '../lib/CacheManager.js';
import AuthManager from '../lib/AuthManager.js';
import QueryBuilder from '../lib/QueryBuilder.js';
import Renderer from '../lib/Renderer.js';
import SampleNotes from '../lib/SampleNotes.js';

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

export default class ZoroPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);

    // libraries
    this.requestQueue = new RequestQueue();
    this.cache = new CacheManager(this);
    this.auth = new AuthManager(this);
    this.query = new QueryBuilder(this);
    this.renderer = new Renderer(this);
    this.sampleNotes = new SampleNotes(this);
  }

  async onload() {
    console.log('[Zoro] plugin loading…');
    await this.loadSettings();

    this.renderer.injectCSS();

    // Markdown processors
    this.registerMarkdownCodeBlockProcessor('zoro', this.processZoroCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processZoroSearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    // Settings tab
    this.addSettingTab(new ZoroSettingTab(this.app, this));

    console.log('[Zoro] plugin loaded');
  }

  async loadSettings() {
    const saved = await this.loadData();
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);
  }

  validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'table'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
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
    const valid = this.validateSettings(this.settings);
    await this.saveData(valid);
    console.log('[Zoro] settings saved');
  }

  /* --------------  MARKDOWN PROCESSORS -------------- */

  async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.renderer.parseCodeBlockConfig(source);
      if (config.useAuthenticatedUser) {
        config.username = await this.auth.getAuthenticatedUsername();
        if (!config.username) throw new Error('Cannot determine authenticated user');
      }
      if (!config.username) throw new Error('Username required');
      const data = await this.fetchZoroData(config);
      this.renderer.renderZoroData(el, data, config);
    } catch (err) {
      this.renderer.renderError(el, err.message);
    }
  }

  async processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.renderer.parseSearchCodeBlockConfig(source);
      await this.renderer.renderSearchInterface(el, config);
    } catch (err) {
      this.renderer.renderError(el, err.message);
    }
  }

  async processInlineLinks(el, ctx) {
    const links = el.querySelectorAll('a[href^="zoro:"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const placeholder = document.createElement('span');
      placeholder.textContent = '🔄 Loading…';
      link.replaceWith(placeholder);
      try {
        const config = this.renderer.parseInlineLink(href);
        const data = await this.fetchZoroData(config);
        const container = document.createElement('span');
        container.className = 'zoro-inline-container';
        this.renderer.renderZoroData(container, data, config);
        placeholder.replaceWith(container);
        ctx.addChild({ unload: () => container.remove() });
      } catch (err) {
        const errorEl = document.createElement('span');
        errorEl.className = 'zoro-inline-error';
        errorEl.textContent = `⚠️ ${err.message}`;
        placeholder.replaceWith(errorEl);
      }
    }
  }

  async fetchZoroData(config) {
    const key = JSON.stringify(config);
    let cacheType;
    switch (config.type) {
      case 'stats': cacheType = 'userData'; break;
      case 'single': cacheType = 'mediaData'; break;
      case 'search': cacheType = 'searchResults'; break;
      default: cacheType = 'userData';
    }

    const cached = this.cache.get(cacheType, key);
    if (cached) return cached;

    const query = this.query.build(config);
    const variables = this.query.variables(config);

    const headers = { 'Content-Type': 'application/json' };
    if (this.settings.accessToken) {
      await this.auth.ensureValidToken();
      headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
    }

    const res = await this.requestQueue.add(() =>
      requestUrl({ url: 'https://graphql.anilist.co', method: 'POST', headers, body: JSON.stringify({ query, variables }) })
    );

    const json = res.json;
    if (json.errors?.length) throw new Error(json.errors[0].message);
    this.cache.set(cacheType, key, json.data);
    return json.data;
  }

  async updateMediaListEntry(mediaId, updates) {
    await this.auth.ensureValidToken();
    const mutation = `
      mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
          id status score progress
        }
      }
    `;
    const variables = { mediaId, ...updates };
    const res = await this.requestQueue.add(() =>
      requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.settings.accessToken}` },
        body: JSON.stringify({ query: mutation, variables }),
      })
    );
    const json = res.json;
    if (json.errors?.length) throw new Error(json.errors[0].message);
    this.cache.clearForMedia(mediaId);
    return json.data.SaveMediaListEntry;
  }

  async onunload() {
    console.log('[Zoro] unloading');
    this.cache.destroy();
  }
}

/* ---------------- SETTINGS TAB ---------------- */

class ZoroSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('➕ Sample Notes')
      .setDesc('Create starter notes for anime & manga dashboards')
      .addButton(btn =>
        btn.setButtonText('Create').onClick(() => this.plugin.sampleNotes.create())
      );

    new Setting(containerEl)
      .setName('👤 Default Username')
      .setDesc('Public username (no login required)')
      .addText(text =>
        text.setValue(this.plugin.settings.defaultUsername).onChange(async v => {
          this.plugin.settings.defaultUsername = v.trim();
          await this.plugin.saveSettings();
        })
      );

    // Dynamic auth button handled by AuthManager
    this.plugin.auth.addSettings(containerEl);

    new Setting(containerEl)
      .setName('🧊 Default Layout')
      .setDesc('Card or table')
      .addDropdown(d =>
        d
          .addOption('card', 'Card')
          .addOption('table', 'Table')
          .setValue(this.plugin.settings.defaultLayout)
          .onChange(async v => {
            this.plugin.settings.defaultLayout = v;
            await this.plugin.saveSettings();
          })
      );

    ['🌆 Cover', '⭐ Ratings', '📈 Progress', '🎭 Genres'].forEach((label, idx) => {
      const key = ['showCoverImages', 'showRatings', 'showProgress', 'showGenres'][idx];
      new Setting(containerEl)
        .setName(label)
        .addToggle(t =>
          t.setValue(this.plugin.settings[key]).onChange(async v => {
            this.plugin.settings[key] = v;
            await this.plugin.saveSettings();
          })
        );
    });

    new Setting(containerEl)
      .setName('🔲 Grid Columns')
      .setDesc('1–6 columns in card view')
      .addSlider(s =>
        s.setLimits(1, 6, 1)
          .setValue(this.plugin.settings.gridColumns)
          .setDynamicTooltip()
          .onChange(async v => {
            this.plugin.settings.gridColumns = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
