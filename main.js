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
    
    // Register code block processors
    this.registerMarkdownCodeBlockProcessor('anilist', this.processAniListCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('anilist-search', this.processGlobalSearchCodeBlock.bind(this));
    
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

  async processGlobalSearchCodeBlock(source, el, ctx) {
    try {
      const container = document.createElement('div');
      container.className = 'anilist-global-container';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Search anime/manga...';
      input.className = 'anilist-global-search';
      container.appendChild(input);

      const results = document.createElement('div');
      results.className = 'anilist-global-results';
      container.appendChild(results);

      let searchTimeout;
      input.addEventListener('input', async (e) => {
        const term = e.target.value.trim();
        
        // Clear previous timeout
        if (searchTimeout) {
          clearTimeout(searchTimeout);
        }
        
        if (term.length < 3) {
          results.innerHTML = '';
          return;
        }
        
        // Debounce search
        searchTimeout = setTimeout(async () => {
          try {
            results.innerHTML = '<div class="anilist-loading">Searching...</div>';
            const config = { type: 'search', searchTerm: term };
            const data = await this.fetchAniListData(config);
            
            results.innerHTML = '';
            
            if (data.Page.media.length === 0) {
              results.innerHTML = '<div class="anilist-no-results">No results found</div>';
              return;
            }
            
            // Normalize into same shape as list entries
            const entries = data.Page.media.map(m => ({
              media: m,
              status: m.status || 'NOT_YET_RELEASED',
              score: m.averageScore || 0,
              progress: 0
            }));
            
            this.renderCardLayout(results, entries, true);
          } catch (error) {
            this.renderError(results, error.message);
          }
        }, 300);
      });

      el.appendChild(container);
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
    config.mediaType = config.mediaType || 'ANIME';
    
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
      config.mediaType = 'ANIME'; // Default to anime
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
    } else if (config.type === 'search') {
      query = this.getSearchMediaQuery();
      variables = { 
        search: config.searchTerm, 
        type: 'ANIME' // Can be modified to support both
      };
    } else {
      query = this.getMediaListQuery();
      variables = { 
        username: config.username, 
        status: config.listType,
        type: config.mediaType
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
                format
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
            format
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

  getSearchMediaQuery() {
    return `
      query ($search: String, $type: MediaType) {
        Page(page: 1, perPage: 20) {
          media(search: $search, type: $type) {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              medium
            }
            format
            episodes
            chapters
            genres
            averageScore
            status
          }
        }
      }
    `;
  }

  // Helper function to generate AniList URL
  getAniListUrl(mediaId, type = 'anime') {
    return `https://anilist.co/${type}/${mediaId}`;
  }

  renderAniListData(el, data, config) {
    // Clear element properly
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
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
    const statsContainer = document.createElement('div');
    statsContainer.className = 'anilist-user-stats';
    
    // User header
    const userHeader = document.createElement('div');
    userHeader.className = 'user-header';
    
    const avatar = document.createElement('img');
    avatar.src = user.avatar.medium;
    avatar.alt = user.name;
    avatar.className = 'user-avatar';
    userHeader.appendChild(avatar);
    
    const userName = document.createElement('h3');
    userName.textContent = user.name;
    userHeader.appendChild(userName);
    
    statsContainer.appendChild(userHeader);
    
    // Stats grid
    const statsGrid = document.createElement('div');
    statsGrid.className = 'stats-grid';
    
    // Anime stats
    const animeSection = document.createElement('div');
    animeSection.className = 'stat-section';
    
    const animeTitle = document.createElement('h4');
    animeTitle.textContent = 'Anime';
    animeSection.appendChild(animeTitle);
    
    const animeStats = [
      { label: 'Count', value: user.statistics.anime.count },
      { label: 'Episodes', value: user.statistics.anime.episodesWatched },
      { label: 'Minutes', value: user.statistics.anime.minutesWatched?.toLocaleString() || 0 },
      { label: 'Mean Score', value: user.statistics.anime.meanScore || 0 }
    ];
    
    animeStats.forEach(stat => {
      const statItem = document.createElement('div');
      statItem.className = 'stat-item';
      
      const label = document.createElement('span');
      label.textContent = stat.label + ':';
      statItem.appendChild(label);
      
      const value = document.createElement('span');
      value.textContent = stat.value;
      statItem.appendChild(value);
      
      animeSection.appendChild(statItem);
    });
    
    statsGrid.appendChild(animeSection);
    
    // Manga stats
    const mangaSection = document.createElement('div');
    mangaSection.className = 'stat-section';
    
    const mangaTitle = document.createElement('h4');
    mangaTitle.textContent = 'Manga';
    mangaSection.appendChild(mangaTitle);
    
    const mangaStats = [
      { label: 'Count', value: user.statistics.manga.count },
      { label: 'Chapters', value: user.statistics.manga.chaptersRead },
      { label: 'Volumes', value: user.statistics.manga.volumesRead },
      { label: 'Mean Score', value: user.statistics.manga.meanScore || 0 }
    ];
    
    mangaStats.forEach(stat => {
      const statItem = document.createElement('div');
      statItem.className = 'stat-item';
      
      const label = document.createElement('span');
      label.textContent = stat.label + ':';
      statItem.appendChild(label);
      
      const value = document.createElement('span');
      value.textContent = stat.value;
      statItem.appendChild(value);
      
      mangaSection.appendChild(statItem);
    });
    
    statsGrid.appendChild(mangaSection);
    statsContainer.appendChild(statsGrid);
    
    el.appendChild(statsContainer);
  }

  renderSingleMedia(el, mediaList, config) {
    const media = mediaList.media;
    const title = media.title.english || media.title.romaji;
    
    const cardDiv = document.createElement('div');
    cardDiv.className = 'anilist-single-card';
    
    if (this.settings.showCoverImages) {
      const img = document.createElement('img');
      img.src = media.coverImage.medium;
      img.alt = title;
      img.className = 'media-cover';
      cardDiv.appendChild(img);
    }
    
    const mediaInfoDiv = document.createElement('div');
    mediaInfoDiv.className = 'media-info';
    
    // Create clickable title
    const titleElement = document.createElement('h3');
    const titleLink = document.createElement('a');
    titleLink.href = this.getAniListUrl(media.id, config.mediaType?.toLowerCase() || 'anime');
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link';
    titleLink.textContent = title;
    titleElement.appendChild(titleLink);
    mediaInfoDiv.appendChild(titleElement);
    
    // Create details div
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'media-details';
    
    // Format
    if (media.format) {
      const formatSpan = document.createElement('span');
      formatSpan.className = 'format';
      formatSpan.textContent = media.format;
      detailsDiv.appendChild(formatSpan);
    }
    
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${mediaList.status.toLowerCase().replace('_', '-')}`;
    statusBadge.textContent = mediaList.status.replace('_', ' ');
    detailsDiv.appendChild(statusBadge);
    
    if (this.settings.showProgress) {
      const progressSpan = document.createElement('span');
      progressSpan.className = 'progress';
      progressSpan.textContent = `${mediaList.progress}/${media.episodes || media.chapters || '?'}`;
      detailsDiv.appendChild(progressSpan);
    }
    
    if (this.settings.showRatings && mediaList.score) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${mediaList.score}`;
      detailsDiv.appendChild(scoreSpan);
    }
    
    mediaInfoDiv.appendChild(detailsDiv);
    
    // Create genres div
    if (this.settings.showGenres && media.genres) {
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

  renderMediaList(el, entries, config) {
    // Add local search filter
    const localInput = document.createElement('input');
    localInput.type = 'text';
    localInput.placeholder = 'Filter list...';
    localInput.className = 'anilist-local-search';
    el.appendChild(localInput);
    
    const listContainer = document.createElement('div');
    listContainer.className = 'anilist-list-container';
    el.appendChild(listContainer);
    
    const renderList = (filteredEntries) => {
      // Clear container
      while (listContainer.firstChild) {
        listContainer.removeChild(listContainer.firstChild);
      }
      
      if (config.layout === 'table') {
        this.renderTableLayout(listContainer, filteredEntries);
      } else {
        this.renderCardLayout(listContainer, filteredEntries);
      }
    };
    
    // Initial render
    renderList(entries);
    
    // Filter functionality
    localInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = entries.filter(entry => {
        const title = entry.media.title.english || entry.media.title.romaji;
        return title.toLowerCase().includes(term);
      });
      renderList(filtered);
    });
  }

  renderCardLayout(el, entries, isSearch = false) {
    const gridDiv = document.createElement('div');
    gridDiv.className = 'anilist-cards-grid';
    
    entries.forEach(entry => {
      const media = entry.media;
      const title = media.title.english || media.title.romaji;
      
      const cardDiv = document.createElement('div');
      cardDiv.className = 'anilist-card';
      
      if (this.settings.showCoverImages) {
        const img = document.createElement('img');
        img.src = media.coverImage.medium;
        img.alt = title;
        img.className = 'media-cover';
        cardDiv.appendChild(img);
      }
      
      const mediaInfoDiv = document.createElement('div');
      mediaInfoDiv.className = 'media-info';
      
      // Create clickable title
      const titleElement = document.createElement('h4');
      const titleLink = document.createElement('a');
      titleLink.href = this.getAniListUrl(media.id, 'anime');
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleElement.appendChild(titleLink);
      mediaInfoDiv.appendChild(titleElement);
      
      // Create details div
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'media-details';
      
      // Format
    if (media.format) {
      const formatSpan = document.createElement('span');
      formatSpan.className = 'format';
      formatSpan.textContent = media.format;
      detailsDiv.appendChild(formatSpan);
    }
    
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${mediaList.status.toLowerCase().replace('_', '-')}`;
    statusBadge.textContent = mediaList.status.replace('_', ' ');
    detailsDiv.appendChild(statusBadge);
    
    if (this.settings.showProgress) {
      const progressSpan = document.createElement('span');
      progressSpan.className = 'progress';
      progressSpan.textContent = `${mediaList.progress}/${media.episodes || media.chapters || '?'}`;
      detailsDiv.appendChild(progressSpan);
    }
    
    if (this.settings.showRatings && mediaList.score) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${mediaList.score}`;
      detailsDiv.appendChild(scoreSpan);
    }
    
    mediaInfoDiv.appendChild(detailsDiv);
    
    // Create genres div
    if (this.settings.showGenres && media.genres) {
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

  renderMediaList(el, entries, config) {
    // Add local search filter
    const localInput = document.createElement('input');
    localInput.type = 'text';
    localInput.placeholder = 'Filter list...';
    localInput.className = 'anilist-local-search';
    el.appendChild(localInput);
    
    const listContainer = document.createElement('div');
    listContainer.className = 'anilist-list-container';
    el.appendChild(listContainer);
    
    const renderList = (filteredEntries) => {
      // Clear container
      while (listContainer.firstChild) {
        listContainer.removeChild(listContainer.firstChild);
      }
      
      if (config.layout === 'table') {
        this.renderTableLayout(listContainer, filteredEntries);
      } else {
        this.renderCardLayout(listContainer, filteredEntries);
      }
    };
    
    // Initial render
    renderList(entries);
    
    // Filter functionality
    localInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = entries.filter(entry => {
        const title = entry.media.title.english || entry.media.title.romaji;
        return title.toLowerCase().includes(term);
      });
      renderList(filtered);
    });
  }

  renderCardLayout(el, entries, isSearch = false) {
    const gridDiv = document.createElement('div');
    gridDiv.className = 'anilist-cards-grid';
    
    entries.forEach(entry => {
      const media = entry.media;
      const title = media.title.english || media.title.romaji;
      
      const cardDiv = document.createElement('div');
      cardDiv.className = 'anilist-card';
      
      if (this.settings.showCoverImages) {
        const img = document.createElement('img');
        img.src = media.coverImage.medium;
        img.alt = title;
        img.className = 'media-cover';
        cardDiv.appendChild(img);
      }
      
      const mediaInfoDiv = document.createElement('div');
      mediaInfoDiv.className = 'media-info';
      
      // Create clickable title
      const titleElement = document.createElement('h4');
      const titleLink = document.createElement('a');
      titleLink.href = this.getAniListUrl(media.id, 'anime');
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleElement.appendChild(titleLink);
      mediaInfoDiv.appendChild(titleElement);
      
      // Create details div
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'media-details';
      
      // Format
      if (media.format) {
        const formatSpan = document.createElement('span');
        formatSpan.className = 'format';
        formatSpan.textContent = media.format;
        detailsDiv.appendChild(formatSpan);
      }
      
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge status-${entry.status.toLowerCase().replace('_', '-')}`;
      statusBadge.textContent = entry.status.replace('_', ' ');
      detailsDiv.appendChild(statusBadge);
      
      if (this.settings.showProgress && !isSearch) {
        const progressSpan = document.createElement('span');
        progressSpan.className = 'progress';
        progressSpan.textContent = `${entry.progress}/${media.episodes || media.chapters || '?'}`;
        detailsDiv.appendChild(progressSpan);
      }
      
      if (this.settings.showRatings && entry.score) {
        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'score';
        scoreSpan.textContent = `★ ${entry.score}`;
        detailsDiv.appendChild(scoreSpan);
      }
      
      mediaInfoDiv.appendChild(detailsDiv);
      
      // Create genres div
      if (this.settings.showGenres && media.genres) {
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
      gridDiv.appendChild(cardDiv);
    });
    
    el.appendChild(gridDiv);
  }

  renderTableLayout(el, entries) {
    const table = document.createElement('table');
    table.className = 'anilist-table';
    
    // Create header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    const headers = ['Title', 'Format', 'Status'];
    
    if (this.settings.showProgress) {
      headers.push('Progress');
    }
    
    if (this.settings.showRatings) {
      headers.push('Score');
    }
    
    headers.forEach(headerText => {
      const th = document.createElement('th');
      th.textContent = headerText;
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement('tbody');
    
    entries.forEach(entry => {
      const media = entry.media;
      const title = media.title.english || media.title.romaji;
      
      const row = document.createElement('tr');
      
      // Title cell with clickable link
      const titleCell = document.createElement('td');
      const titleLink = document.createElement('a');
      titleLink.href = this.getAniListUrl(media.id, 'anime');
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleCell.appendChild(titleLink);
      row.appendChild(titleCell);
      
      // Format cell
      const formatCell = document.createElement('td');
      formatCell.textContent = media.format || '-';
      row.appendChild(formatCell);
      
      // Status cell
      const statusCell = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge status-${entry.status.toLowerCase().replace('_', '-')}`;
      statusBadge.textContent = entry.status.replace('_', ' ');
      statusCell.appendChild(statusBadge);
      row.appendChild(statusCell);
      
      // Progress cell
      if (this.settings.showProgress) {
        const progressCell = document.createElement('td');
        progressCell.textContent = `${entry.progress}/${media.episodes || media.chapters || '?'}`;
        row.appendChild(progressCell);
      }
      
      // Score cell
      if (this.settings.showRatings) {
        const scoreCell = document.createElement('td');
        scoreCell.textContent = entry.score ? `★ ${entry.score}` : '-';
        row.appendChild(scoreCell);
      }
      
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    el.appendChild(table);
  }

  renderError(el, message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'anilist-error';
    errorDiv.textContent = `Error: ${message}`;
    
    // Clear element first
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    
    el.appendChild(errorDiv);
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
