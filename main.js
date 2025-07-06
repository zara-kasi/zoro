const { Plugin, PluginSettingTab, Setting } = require('obsidian');

class AniListPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async onload() {
    console.log('Loading AniList Plugin');
    await this.loadSettings();

    // Register code block processors
    this.registerMarkdownCodeBlockProcessor('anilist', this.processAniListCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('anilist-search', this.processGlobalSearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    this.addSettingTab(new AniListSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, {
      defaultLayout: 'card',
      showCoverImages: true,
      showRatings: true,
      showProgress: true,
      showGenres: true
    }, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Code block for user lists
  async processAniListCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source);
      const data = await this.fetchAniListData(config);
      this.renderAniListData(el, data, config);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

  // New code block for global search
  async processGlobalSearchCodeBlock(source, el, ctx) {
    try {
      const container = document.createElement('div');
      container.className = 'anilist-global-container';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Search all shows...';
      input.className = 'anilist-global-search';
      container.appendChild(input);

      const results = document.createElement('div');
      results.className = 'anilist-global-results';
      container.appendChild(results);

      input.addEventListener('input', async e => {
        const term = e.target.value.trim();
        if (term.length < 3) return;
        const cfg = { type: 'search', searchTerm: term };
        const mediaList = await this.fetchAniListData(cfg);
        results.empty();
        this.renderCardLayout(results, mediaList.map(m => ({ media: m, status: m.status || '-', score: m.averageScore || 0, progress: m.episodes || m.chapters || 0 })));
      });

      el.appendChild(container);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="anilist:"]');
    for (const link of inlineLinks) {
      const href = link.getAttribute('href');
      try {
        const config = this.parseInlineLink(href);
        const data = await this.fetchAniListData(config);
        const container = document.createElement('div');
        container.className = 'anilist-inline-container';
        this.renderAniListData(container, data, config);
        link.parentNode.replaceChild(container, link);
      } catch (error) {
        this.renderError(link, error.message);
      }
    }
  }

  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) config[key] = value;
    }
    if (!config.username) throw new Error('Username is required');
    config.type = 'list';
    config.listType = config.listType || 'CURRENT';
    config.layout = config.layout || this.settings.defaultLayout;
    config.mediaType = config.mediaType || 'ANIME';
    return config;
  }

  parseInlineLink(href) {
    const parts = href.replace('anilist:', '').split('/');
    if (parts.length < 2) throw new Error('Invalid AniList link format');
    const config = { username: parts[0], layout: 'card', mediaType: 'ANIME' };
    if (parts[1] === 'stats') {
      config.type = 'stats';
    } else if (['anime', 'manga'].includes(parts[1])) {
      config.type = 'single';
      config.mediaType = parts[1].toUpperCase();
      config.mediaId = parts[2];
    } else {
      config.type = 'list';
      config.listType = parts[1].toUpperCase();
    }
    return config;
  }

  async fetchAniListData(config) {
    const key = JSON.stringify(config);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) return cached.data;

    let query, variables;
    switch (config.type) {
      case 'stats':
        query = this.getUserStatsQuery();
        variables = { username: config.username };
        break;
      case 'single':
        query = this.getSingleMediaQuery();
        variables = { username: config.username, mediaId: parseInt(config.mediaId), type: config.mediaType };
        break;
      case 'search':
        query = this.getSearchMediaQuery();
        variables = { search: config.searchTerm, type: 'ANIME' };
        break;
      default:
        query = this.getMediaListQuery();
        variables = { username: config.username, status: config.listType, type: config.mediaType };
    }

    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    const result = await res.json();
    if (result.errors) throw new Error(result.errors[0].message);

    const data = config.type === 'search' ? result.data.Page.media : result.data;
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  getMediaListQuery() {
    return `query ($username: String, $status: MediaListStatus, $type: MediaType) {
      MediaListCollection(userName: $username, status: $status, type: $type) {
        lists { entries { id status score progress media { id title { romaji english } coverImage { medium } format episodes chapters genres } } }
      }
    }`;
  }

  getSingleMediaQuery() {
    return `query ($username: String, $mediaId: Int, $type: MediaType) {
      MediaList(userName: $username, mediaId: $mediaId, type: $type) {
        status score progress media { id title { romaji english } coverImage { medium } format episodes chapters genres }
      }
    }`;
  }

  getUserStatsQuery() {
    return `query ($username: String) {
      User(name: $username) { id name avatar { medium } statistics { anime { count minutesWatched meanScore } manga { count chaptersRead meanScore } } }
    }`;
  }

  getSearchMediaQuery() {
    return `query ($search: String, $type: MediaType) {
      Page(page: 1, perPage: 20) { media(search: $search, type: $type) { id title { romaji english } coverImage { medium } format episodes chapters genres averageScore status } }
    }`;
  }

  renderAniListData(el, data, config) {
    el.empty();
    el.className = 'anilist-container';
    if (config.type === 'stats') this.renderUserStats(el, data.User);
    else if (config.type === 'single') this.renderSingleMedia(el, data.MediaList || data);
    else if (config.type === 'search') this.renderSearchResults(el, data);
    else this.renderMediaList(el, data.MediaListCollection.lists.flatMap(l => l.entries), config);
  }

  renderSearchResults(el, mediaList) {
    const header = document.createElement('h3'); header.textContent = 'Search Results'; el.appendChild(header);
    this.renderCardLayout(el, mediaList.map(m => ({ media: m, status: m.status || '-', score: m.averageScore || 0, progress: m.episodes || m.chapters || 0 })));
  }

  renderAniListData(el, data, config) {}

  renderMediaList(el, entries, config) {
    const localInput = document.createElement('input');
    localInput.type = 'text'; localInput.placeholder = 'Filter My List...'; localInput.className = 'anilist-local-search';
    el.appendChild(localInput);

    const listContainer = document.createElement('div'); listContainer.className = 'anilist-list'; el.appendChild(listContainer);

    const renderList = items => {
      listContainer.empty();
      if (config.layout === 'table') this.renderTableLayout(listContainer, items);
      else this.renderCardLayout(listContainer, items);
    };

    renderList(entries);
    localInput.addEventListener('input', e => {
      const term = e.target.value.toLowerCase();
      const filtered = entries.filter(en => {
        const t = en.media.title.english || en.media.title.romaji;
        return t.toLowerCase().includes(term);
      });
      renderList(filtered);
    });
  }

  renderSingleMedia(el, mediaList) {
    const en = mediaList; const m = mediaList.media || mediaList;
    const title = m.title.english || m.title.romaji;
    const card = document.createElement('div'); card.className = 'anilist-single-card';
    if (this.settings.showCoverImages) { const img = document.createElement('img'); img.src = m.coverImage.medium; img.alt = title; card.appendChild(img); }
    const info = document.createElement('div'); info.className = 'media-info';
    const h3 = document.createElement('h3'); const a = document.createElement('a'); a.href = this.getAniListUrl(m.id); a.target = '_blank'; a.rel = 'noopener'; a.textContent = title; h3.appendChild(a); info.appendChild(h3);
    const details = document.createElement('div'); details.className = 'media-details';
    const fmt = document.createElement('span'); fmt.className = 'format'; fmt.textContent = m.format; details.appendChild(fmt);
    const badge = document.createElement('span'); badge.className = `status-badge status-${en.status.toLowerCase()}`; badge.textContent = en.status; details.appendChild(badge);
    if (this.settings.showProgress) { const p = document.createElement('span'); p.className = 'progress'; p.textContent = `${en.progress}/${m.episodes||m.chapters||'?'}'; details.appendChild(p); }
    if (this.settings.showRatings) { const s = document.createElement('span'); s.className = 'score'; s.textContent = `★ ${en.score}`; details.appendChild(s); }
    info.appendChild(details);
    if (this.settings.showGenres) { const gd = document.createElement('div'); gd.className = 'genres'; (m.genres||[]).slice(0,3).forEach(g => { const gt = document.createElement('span'); gt.textContent = g; gd.appendChild(gt); }); info.appendChild(gd); }
    card.appendChild(info); el.appendChild(card);
  }

  renderCardLayout(el, entries) {
    const grid = document.createElement('div'); grid.className = 'anilist-cards-grid';
    entries.forEach(en => {
      const m = en.media;
      const title = m.title.english || m.title.romaji;
      const card = document.createElement('div'); card.className = 'anilist-card';
      if (this.settings.showCoverImages) { const img = document.createElement('img'); img.src = m.coverImage.medium; img.alt = title; card.appendChild(img); }
      const info = document.createElement('div'); info.className = 'media-info';
      const h4 = document.createElement('h4'); const a = document.createElement('a'); a.href = this.getAniListUrl(m.id); a.target = '_blank'; a.rel = 'noopener'; a.textContent = title; h4.appendChild(a); info.appendChild(h4);
      const details = document.createElement('div'); details.className = 'media-details';
      const fmt = document.createElement('span'); fmt.className = 'format'; fmt.textContent = m.format; details.appendChild(fmt);
      const badge = document.createElement('span'); badge.className = `status-badge status-${en.status.toLowerCase()}`; badge.textContent = en.status; details.appendChild(badge);
      if (this.settings.showProgress) { const p = document.createElement('span'); p.className = 'progress'; p.textContent = `${en.progress}/${m.episodes||m.chapters||'?'}'; details.appendChild(p); }
      if (this.settings.showRatings) { const s = document.createElement('span'); s.className = 'score'; s.textContent = `★ ${en.score}`; details.appendChild(s); }
      info.appendChild(details);
      if (this.settings.showGenres) { const gd = document.createElement('div'); gd.className = 'genres'; (m.genres||[]).slice(0,3).forEach(g => { const gt = document.createElement('span'); gt.textContent = g; gd.appendChild(gt); }); info.appendChild(gd); }
      card.appendChild(info); grid.appendChild(card);
    });
    el.appendChild(grid);
  }

  renderTableLayout(el, entries) {
    const table = document.createElement('table');
    const thead = document.createElement('thead'); const header = document.createElement('tr');
    ['Title','Format','Status', ...(this.settings.showProgress?['Progress']:[]), ...(this.settings.showRatings?['Score']:[])].forEach(txt => { const th = document.createElement('th'); th.textContent = txt; header.appendChild(th); });
    thead.appendChild(header); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    entries.forEach(en => {
      const m = en.media; const row = document.createElement('tr');
      const tdTitle = document.createElement('td'); const a = document.createElement('a'); a.href = this.getAniListUrl(m.id); a.target = '_blank'; a.rel = 'noopener'; a.textContent = m.title.english || m.title.romaji; tdTitle.appendChild(a); row.appendChild(tdTitle);
      const tdFmt = document.createElement('td'); tdFmt.textContent = m.format; row.appendChild(tdFmt);
      const tdStat = document.createElement('td'); const sb = document.createElement('span'); sb.className = `status-badge status-${en.status.toLowerCase()}`; sb.textContent = en.status; tdStat.appendChild(sb); row.appendChild(tdStat);
      if (this.settings.showProgress) { const tdP = document.createElement('td'); tdP.textContent = `${en.progress}/${m.episodes||m.chapters||'?'}'; row.appendChild(tdP); }
      if (this.settings.showRatings) { const tdS = document.createElement('td'); tdS.textContent = en.score?`★ ${en.score}`:'-'; row.appendChild(tdS); }
      tbody.appendChild(row);
    });
    table.appendChild(tbody); el.appendChild(table);
  }

  renderError(el, message) {
    el.innerHTML = `<div class=\"anilist-error\">Error: ${message}</div>`;
  }

  getAniListUrl(id) {
    return `https://anilist.co/anime/${id}`;
  }

  onunload() {
    console.log('Unloading AniList Plugin');
  }
}

class AniListSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl('h2', { text: 'AniList Integration Settings' });
    new Setting(containerEl).setName('Default Layout').setDesc('Choose default layout').addDropdown(d =>
      d.addOption('card', 'Card').addOption('table', 'Table').setValue(this.plugin.settings.defaultLayout).onChange(async v => { this.plugin.settings.defaultLayout = v; await this.plugin.saveSettings(); })
    );
    new Setting(containerEl).setName('Show Cover Images').addToggle(t =>
      t.setValue(this.plugin.settings.showCoverImages).onChange(async v => { this.plugin.settings.showCoverImages = v; await this.plugin.saveSettings(); })
    );
    new Setting(containerEl).setName('Show Ratings').addToggle(t =>
      t.setValue(this.plugin.settings.showRatings).onChange(async v => { this.plugin.settings.showRatings = v; await this.plugin.saveSettings(); })
    );
    new Setting(containerEl).setName('Show Progress').addToggle(t =>
      t.setValue(this.plugin.settings.showProgress).onChange(async v => { this.plugin.settings.showProgress = v; await this.plugin.saveSettings(); })
    );
    new Setting(containerEl).setName('Show Genres').addToggle(t =>
      t.setValue(this.plugin.settings.showGenres).onChange(async v => { this.plugin.settings.showGenres = v; await this.plugin.saveSettings(); })
    );
  }
}

module.exports = AniListPlugin;
      
