const { Plugin, PluginSettingTab, Setting } = require('obsidian');

class AniListPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async onload() {
    console.log('Loading AniList Plugin');
    // Load settings
    await this.loadSettings();
    // Apply cards-per-row CSS variable
    document.documentElement.style.setProperty('--cards-per-row', this.settings.cardsPerRow);

    // Register processors
    this.registerMarkdownCodeBlockProcessor('anilist', this.processAniListCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('anilist-search', this.processAniListSearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    // Add settings tab
    this.addSettingTab(new AniListSettingTab(this.app, this));

    // Inject grid CSS
    this.addCardGridStyles();
  }

  async loadSettings() {
    this.settings = Object.assign({}, {
      defaultLayout: 'card',
      showCoverImages: true,
      showRatings: true,
      showProgress: true,
      showGenres: true,
      cardsPerRow: 2
    }, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  addCardGridStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .anilist-grid, .anilist-search-grid {
        display: grid;
        gap: 15px;
        grid-template-columns: repeat(var(--cards-per-row), 1fr);
        width: 100%;
      }
      @media (max-width: 768px) {
        .anilist-grid, .anilist-search-grid {
          grid-template-columns: repeat(min(var(--cards-per-row), 2), 1fr);
        }
      }
      @media (max-width: 480px) {
        .anilist-grid, .anilist-search-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /* ---------------------- CodeBlock Processors ---------------------- */
  async processAniListCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source);
      const data = await this.fetchAniListData(config);
      this.renderAniListData(el, data, config);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

  async processAniListSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
      this.renderSearchInterface(el, config);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="anilist:"]');
    for (const link of inlineLinks) {
      try {
        const config = this.parseInlineLink(link.getAttribute('href'));
        const data = await this.fetchAniListData(config);
        const container = document.createElement('div');
        container.className = 'anilist-inline-container';
        this.renderAniListData(container, data, config);
        link.replaceWith(container);
      } catch (error) {
        this.renderError(link, error.message);
      }
    }
  }

  /* ---------------------- Parsing Helpers ---------------------- */
  parseCodeBlockConfig(source) {
    const config = {};
    source.split('\n').forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) config[key.trim()] = rest.join(':').trim();
    });
    config.layout = config.layout || this.settings.defaultLayout;
    config.cardsPerRow = this.settings.cardsPerRow;
    return config;
  }

  parseSearchCodeBlockConfig(source) {
    const config = {};
    source.split('\n').forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) config[key.trim()] = rest.join(':').trim();
    });
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.settings.defaultLayout;
    config.cardsPerRow = this.settings.cardsPerRow;
    return config;
  }

  parseInlineLink(href) {
    // href format: anilist:type:id:layout
    const parts = href.split(':').slice(1);
    const config = { type: parts[0], id: parts[1], layout: parts[2] || this.settings.defaultLayout };
    config.cardsPerRow = this.settings.cardsPerRow;
    return config;
  }

  /* ---------------------- Data Fetching ---------------------- */
  // ... (all fetchAniListData, GraphQL queries, caching remain exactly as in your original file) ...

  /* ---------------------- Rendering ---------------------- */
  renderSearchInterface(el, config) {
    el.empty();
    el.className = 'anilist-search-container';

    const searchDiv = document.createElement('div');
    searchDiv.className = 'anilist-search-input-container';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';
    const searchButton = document.createElement('button');
    searchButton.textContent = 'Search';
    searchDiv.appendChild(searchInput);
    searchDiv.appendChild(searchButton);
    el.appendChild(searchDiv);

    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'anilist-search-results';
    el.appendChild(resultsDiv);

    let timeout;
    const doSearch = async () => {
      const term = searchInput.value.trim();
      if (term.length < 3) {
        resultsDiv.innerHTML = '<div class="anilist-search-message">Type at least 3 characters...</div>';
        return;
      }
      resultsDiv.innerHTML = '<div class="anilist-search-loading">Searching...</div>';
      try {
        const data = await this.fetchAniListData({ ...config, search: term, page: 1, perPage: 20 });
        this.renderSearchResults(resultsDiv, data.Page.media);
      } catch (e) {
        this.renderError(resultsDiv, e.message);
      }
    };
    searchInput.addEventListener('input', () => { clearTimeout(timeout); timeout = setTimeout(doSearch, 300); });
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') doSearch(); });
    searchButton.addEventListener('click', doSearch);
  }

  renderSearchResults(el, media) {
    el.empty();
    if (!media.length) {
      el.innerHTML = '<div class="anilist-search-message">No results found.</div>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'anilist-search-grid';
    grid.style.setProperty('--cards-per-row', this.settings.cardsPerRow);
    media.forEach(item => {
      // ... original card rendering logic ...
    });
    el.appendChild(grid);
  }

  renderAniListData(el, data, config) {
    el.empty();
    el.className = 'anilist-container';
    if (config.type === 'stats') {
      this.renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      this.renderSingleMedia(el, data.MediaList, config);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(l => l.entries);
      if (config.layout === 'table') {
        this.renderTableLayout(el, entries);
      } else {
        this.renderMediaList(el, entries);
      }
    }
  }

  renderMediaList(el, entries) {
    const container = document.createElement('div');
    container.className = 'anilist-media-container';
    const grid = document.createElement('div');
    grid.className = 'anilist-grid';
    grid.style.setProperty('--cards-per-row', this.settings.cardsPerRow);
    entries.forEach(entry => {
      // ... original media card rendering ...
    });
    container.appendChild(grid);
    el.appendChild(container);
  }

  /* ---------------------- Error Handling ---------------------- */
  renderError(el, message) {
    el.empty();
    const err = document.createElement('div');
    err.className = 'anilist-error';
    err.textContent = `Error: ${message}`;
    el.appendChild(err);
  }
}

class AniListSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'AniList Integration Settings' });

    new Setting(containerEl)
      .setName('Default Layout')
      .setDesc('Choose default layout for media lists')
      .addDropdown(dd => dd
        .addOption('card', 'Card')
        .addOption('table', 'Table')
        .setValue(this.plugin.settings.defaultLayout)
        .onChange(async v => { this.plugin.settings.defaultLayout = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Cards Per Row')
      .setDesc('Number of cards per row in card layout (1–4)')
      .addSlider(slider => slider
        .setLimits(1, 4, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.cardsPerRow)
        .onChange(async v => {
          this.plugin.settings.cardsPerRow = v;
          await this.plugin.saveSettings();
          document.documentElement.style.setProperty('--cards-per-row', v);
          document.querySelectorAll('.anilist-grid, .anilist-search-grid')
            .forEach(g => g.style.setProperty('--cards-per-row', v));
        }));

    new Setting(containerEl)
      .setName('Show Cover Images')
      .addToggle(t => t.setValue(this.plugin.settings.showCoverImages)
        .onChange(async v => { this.plugin.settings.showCoverImages = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Show Ratings')
      .addToggle(t => t.setValue(this.plugin.settings.showRatings)
        .onChange(async v => { this.plugin.settings.showRatings = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Show Progress')
      .addToggle(t => t.setValue(this.plugin.settings.showProgress)
        .onChange(async v => { this.plugin.settings.showProgress = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Show Genres')
      .addToggle(t => t.setValue(this.plugin.settings.showGenres)
        .onChange(async v => { this.plugin.settings.showGenres = v; await this.plugin.saveSettings(); }));
  }
}

module.exports = AniListPlugin;
               
