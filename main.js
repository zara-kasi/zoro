const { Plugin, PluginSettingTab, Setting } = require('obsidian');

class AniListPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async onload() {
    console.log('Loading AniList Plugin');
    
    // Load settings first
    await this.loadSettings();
    
    // Register code block processor
    this.registerMarkdownCodeBlockProcessor('anilist', this.processAniListCodeBlock.bind(this));
    
    // Register inline link processor
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));
    
    // Add plugin settings
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

  async processAniListCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source);
      const data = await this.fetchAniListData(config);
      this.renderAniListData(el, data, config);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

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
      throw new Error('Username is required');
    }
    
    config.listType = config.listType || 'CURRENT';
    config.layout = config.layout || this.settings.defaultLayout;
    
    return config;
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

  parseInlineLink(href) {
    // Parse: anilist:username/anime/123456 or anilist:username/stats
    const parts = href.replace('anilist:', '').split('/');
    
    if (parts.length < 2) {
      throw new Error('Invalid AniList link format');
    }
    
    const config = {
      username: parts[0],
      layout: 'card'
    };
    
    if (parts[1] === 'stats') {
      config.type = 'stats';
    } else if (parts[1] === 'anime' || parts[1] === 'manga') {
      config.type = 'single';
      config.mediaType = parts[1].toUpperCase();
      config.mediaId = parts[2];
    } else {
      config.listType = parts[1].toUpperCase();
    }
    
    return config;
  }

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
    } else {
      query = this.getMediaListQuery();
      variables = { 
        username: config.username, 
        status: config.listType,
        type: config.mediaType || 'ANIME'
      };
    }
    
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables })
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    
    this.cache.set(cacheKey, {
      data: result.data,
      timestamp: Date.now()
    });
    
    return result.data;
  }

  getMediaListQuery() {
    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType) {
        MediaListCollection(userName: $username, status: $status, type: $type) {
          lists {
            entries {
              id
              status
              score
              progress
              media {
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
              }
            }
          }
        }
      }
    `;
  }

  getSingleMediaQuery() {
    return `
      query ($username: String, $mediaId: Int, $type: MediaType) {
        MediaList(userName: $username, mediaId: $mediaId, type: $type) {
          id
          status
          score
          progress
          media {
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
          }
        }
      }
    `;
  }

  getUserStatsQuery() {
    return `
      query ($username: String) {
        User(name: $username) {
          id
          name
          avatar {
            large
            medium
          }
          statistics {
            anime {
              count
              episodesWatched
              minutesWatched
              meanScore
              standardDeviation
            }
            manga {
              count
              chaptersRead
              volumesRead
              meanScore
              standardDeviation
            }
          }
        }
      }
    `;
  }

  renderAniListData(el, data, config) {
    el.empty();
    el.className = 'anilist-container';
    
    if (config.type === 'stats') {
      this.renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      this.renderSingleMedia(el, data.MediaList, config);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
      this.renderMediaList(el, entries, config);
    }
  }

  renderUserStats(el, user) {
    const statsHtml = `
      <div class="anilist-user-stats">
        <div class="user-header">
          <img src="${user.avatar.medium}" alt="${user.name}" class="user-avatar">
          <h3>${user.name}</h3>
        </div>
        <div class="stats-grid">
          <div class="stat-section">
            <h4>Anime</h4>
            <div class="stat-item">
              <span>Count:</span>
              <span>${user.statistics.anime.count}</span>
            </div>
            <div class="stat-item">
              <span>Episodes:</span>
              <span>${user.statistics.anime.episodesWatched}</span>
            </div>
            <div class="stat-item">
              <span>Minutes:</span>
              <span>${user.statistics.anime.minutesWatched.toLocaleString()}</span>
            </div>
            <div class="stat-item">
              <span>Mean Score:</span>
              <span>${user.statistics.anime.meanScore}</span>
            </div>
          </div>
          <div class="stat-section">
            <h4>Manga</h4>
            <div class="stat-item">
              <span>Count:</span>
              <span>${user.statistics.manga.count}</span>
            </div>
            <div class="stat-item">
              <span>Chapters:</span>
              <span>${user.statistics.manga.chaptersRead}</span>
            </div>
            <div class="stat-item">
              <span>Volumes:</span>
              <span>${user.statistics.manga.volumesRead}</span>
            </div>
            <div class="stat-item">
              <span>Mean Score:</span>
              <span>${user.statistics.manga.meanScore}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    
    el.innerHTML = statsHtml;
  }

  renderSingleMedia(el, mediaList, config) {
    const media = mediaList.media;
    const title = media.title.english || media.title.romaji;
    
    const cardHtml = `
      <div class="anilist-single-card">
        ${this.settings.showCoverImages ? `<img src="${media.coverImage.medium}" alt="${title}" class="media-cover">` : ''}
        <div class="media-info">
          <h3>${title}</h3>
          <div class="media-details">
            <span class="status-badge status-${mediaList.status.toLowerCase()}">${mediaList.status}</span>
            ${this.settings.showProgress ? `<span class="progress">${mediaList.progress}/${media.episodes || media.chapters || '?'}</span>` : ''}
            ${this.settings.showRatings && mediaList.score ? `<span class="score">★ ${mediaList.score}</span>` : ''}
          </div>
          ${this.settings.showGenres ? `<div class="genres">${media.genres.slice(0, 3).map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    `;
    
    el.innerHTML = cardHtml;
  }

  renderMediaList(el, entries, config) {
    if (config.layout === 'table') {
      this.renderTableLayout(el, entries);
    } else {
      this.renderCardLayout(el, entries);
    }
  }

  renderCardLayout(el, entries) {
    const cardsHtml = entries.map(entry => {
      const media = entry.media;
      const title = media.title.english || media.title.romaji;
      
      return `
        <div class="anilist-card">
          ${this.settings.showCoverImages ? `<img src="${media.coverImage.medium}" alt="${title}" class="media-cover">` : ''}
          <div class="media-info">
            <h4>${title}</h4>
            <div class="media-details">
              <span class="status-badge status-${entry.status.toLowerCase()}">${entry.status}</span>
              ${this.settings.showProgress ? `<span class="progress">${entry.progress}/${media.episodes || media.chapters || '?'}</span>` : ''}
              ${this.settings.showRatings && entry.score ? `<span class="score">★ ${entry.score}</span>` : ''}
            </div>
            ${this.settings.showGenres ? `<div class="genres">${media.genres.slice(0, 3).map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    el.innerHTML = `<div class="anilist-cards-grid">${cardsHtml}</div>`;
  }

  renderTableLayout(el, entries) {
    const tableHtml = `
      <table class="anilist-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            ${this.settings.showProgress ? '<th>Progress</th>' : ''}
            ${this.settings.showRatings ? '<th>Score</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${entries.map(entry => {
            const media = entry.media;
            const title = media.title.english || media.title.romaji;
            
            return `
              <tr>
                <td>${title}</td>
                <td><span class="status-badge status-${entry.status.toLowerCase()}">${entry.status}</span></td>
                ${this.settings.showProgress ? `<td>${entry.progress}/${media.episodes || media.chapters || '?'}</td>` : ''}
                ${this.settings.showRatings ? `<td>${entry.score ? '★ ' + entry.score : '-'}</td>` : ''}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    
    el.innerHTML = tableHtml;
  }

  renderError(el, message) {
    el.innerHTML = `<div class="anilist-error">Error: ${message}</div>`;
  }

  onunload() {
    console.log('Unloading AniList Plugin');
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
      .setName('Show Cover Images')
      .setDesc('Display cover images for anime/manga')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCoverImages)
        .onChange(async (value) => {
          this.plugin.settings.showCoverImages = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Show Ratings')
      .setDesc('Display user ratings/scores')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showRatings)
        .onChange(async (value) => {
          this.plugin.settings.showRatings = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Show Progress')
      .setDesc('Display progress information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgress)
        .onChange(async (value) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Show Genres')
      .setDesc('Display genre tags')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = AniListPlugin;
