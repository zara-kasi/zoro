const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

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
    
    // Register new search code block processors
    this.registerMarkdownCodeBlockProcessor('anilist-search', this.processAniListSearchCodeBlock.bind(this));
    
    // Register inline link processor
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));
    
    // Add plugin settings
    this.addSettingTab(new AniListSettingTab(this.app, this));
  }

async loadSettings() {
  this.settings = Object.assign({}, {
    defaultUsername: '', // Add this line
    defaultLayout: 'card',
    showCoverImages: true,
    showRatings: true,
    showProgress: true,
    showGenres: false,
    gridColumns: 3
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

  async processAniListSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
      this.renderSearchInterface(el, config);
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
  
  // Use default username if none provided
  if (!config.username) {
    if (this.settings.defaultUsername) {
      config.username = this.settings.defaultUsername;
    } else {
      throw new Error('Username is required. Please set a default username in plugin settings or specify one in the code block.');
    }
  }
  
  config.listType = config.listType || 'CURRENT';
  config.layout = config.layout || this.settings.defaultLayout;
  // Add this line to ensure mediaType is available
  config.mediaType = config.mediaType || 'ANIME';
  
  return config;
}


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
  // Parse: anilist:username/anime/123456 or anilist:username/stats or anilist:/stats (for default user)
  const parts = href.replace('anilist:', '').split('/');
  
  let username, pathParts;
  
  // Check if first part is empty (indicating default username should be used)
  if (parts[0] === '') {
    if (!this.settings.defaultUsername) {
      throw new Error('Default username not set. Please configure it in plugin settings.');
    }
    username = this.settings.defaultUsername;
    pathParts = parts.slice(1); // Remove empty first element
  } else {
    if (parts.length < 2) {
      throw new Error('Invalid AniList link format');
    }
    username = parts[0];
    pathParts = parts.slice(1);
  }
  
  const config = {
    username: username,
    layout: 'card'
  };
  
  if (pathParts[0] === 'stats') {
    config.type = 'stats';
  } else if (pathParts[0] === 'anime' || pathParts[0] === 'manga') {
    config.type = 'single';
    config.mediaType = pathParts[0].toUpperCase();
    config.mediaId = pathParts[1];
  } else {
    config.listType = pathParts[0].toUpperCase();
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
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(search: $search, type: $type) {
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
          }
        }
      }
    `;
  }

  // Helper function to generate AniList URL
getAniListUrl(mediaId, mediaType = 'anime') {
  const type = mediaType.toLowerCase();
  return `https://anilist.co/${type}/${mediaId}`;
}

  renderSearchInterface(el, config) {
    el.empty();
    el.className = 'anilist-search-container';
    
    // Create search input
    const searchDiv = document.createElement('div');
    searchDiv.className = 'anilist-search-input-container';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'anilist-search-input';
    searchInput.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';
    
    
    searchDiv.appendChild(searchInput);
    el.appendChild(searchDiv);
    
    // Create results container
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'anilist-search-results';
    el.appendChild(resultsDiv);
    
    // Add event listeners
    let searchTimeout;
    
    const performSearch = async () => {
      const searchTerm = searchInput.value.trim();
      
      if (searchTerm.length < 3) {
        resultsDiv.innerHTML = '<div class="anilist-search-message">Type at least 3 characters to search...</div>';
        return;
      }
      
      try {
        resultsDiv.innerHTML = '<div class="anilist-search-loading">Searching...</div>';
        
        const searchConfig = {
          ...config,
          search: searchTerm,
          page: 1,
          perPage: 20
        };
        
        const data = await this.fetchAniListData(searchConfig);
        this.renderSearchResults(resultsDiv, data.Page.media, config);
        
      } catch (error) {
        this.renderError(resultsDiv, error.message);
      }
    };
    
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(performSearch, 300);
    });
    
    
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch();
      }
    });
  }

  renderSearchResults(el, media, config) {
    el.empty();
    
    if (media.length === 0) {
      el.innerHTML = '<div class="anilist-search-message">No results found.</div>';
      return;
    }
    
    const gridDiv = document.createElement('div');
    gridDiv.className = 'anilist-cards-grid';
    gridDiv.style.setProperty('--anilist-grid-columns', this.settings.gridColumns);
    
    media.forEach(item => {
      const title = item.title.english || item.title.romaji;
      
      const cardDiv = document.createElement('div');
      cardDiv.className = 'anilist-search-card';
      
      if (this.settings.showCoverImages) {
        const img = document.createElement('img');
        img.src = item.coverImage.medium;
        img.alt = title;
        img.className = 'media-cover';
        cardDiv.appendChild(img);
      }
      
      const mediaInfoDiv = document.createElement('div');
      mediaInfoDiv.className = 'media-info';
      
      // Create clickable title
      const titleElement = document.createElement('h4');
      const titleLink = document.createElement('a');
      titleLink.href = this.getAniListUrl(item.id, config.mediaType);
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleElement.appendChild(titleLink);
      mediaInfoDiv.appendChild(titleElement);
      
      // Create details div
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'media-details';
      
      // Format badge
      if (item.format) {
        const formatBadge = document.createElement('span');
        formatBadge.className = 'format-badge';
        formatBadge.textContent = item.format;
        detailsDiv.appendChild(formatBadge);
      }
      
      // Status badge
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge status-${item.status.toLowerCase()}`;
      statusBadge.textContent = item.status;
      detailsDiv.appendChild(statusBadge);
      
      // Average score
      if (this.settings.showRatings && item.averageScore) {
        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'score';
        scoreSpan.textContent = `★ ${item.averageScore}`;
        detailsDiv.appendChild(scoreSpan);
      }
      
      mediaInfoDiv.appendChild(detailsDiv);
      
      // Create genres div
      if (this.settings.showGenres) {
        const genresDiv = document.createElement('div');
        genresDiv.className = 'genres';
        item.genres.slice(0, 3).forEach(genre => {
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

  renderAniListData(el, data, config) {
    el.empty();
    el.className = 'anilist-container';
    
    if (config.type === 'stats') {
      this.renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      this.renderSingleMedia(el, data.MediaList, config);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
      if (config.layout === 'table') {
        this.renderTableLayout(el, entries);
      } else {
        this.renderMediaList(el, entries, config);
      }
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
    titleLink.href = this.getAniListUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link';
    titleLink.textContent = title;
    titleElement.appendChild(titleLink);
    mediaInfoDiv.appendChild(titleElement);
    
    // Create details div
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'media-details';
    
    // Format badge
    if (media.format) {
      const formatBadge = document.createElement('span');
      formatBadge.className = 'format-badge';
      formatBadge.textContent = media.format;
      detailsDiv.appendChild(formatBadge);
    }
    
    // Status badge
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${mediaList.status.toLowerCase()}`;
    statusBadge.textContent = mediaList.status;
    detailsDiv.appendChild(statusBadge);
    
    // Progress
    if (this.settings.showProgress) {
      const progressSpan = document.createElement('span');
      progressSpan.className = 'progress';
      progressSpan.textContent = `${mediaList.progress}/${media.episodes || media.chapters || '?'}`;
      detailsDiv.appendChild(progressSpan);
    }
    
    // Score
    if (this.settings.showRatings && mediaList.score) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${mediaList.score}`;
      detailsDiv.appendChild(scoreSpan);
    }
    
    mediaInfoDiv.appendChild(detailsDiv);
    // Create genres div
    if (this.settings.showGenres) {
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
    const gridDiv = document.createElement('div');
    gridDiv.className = 'anilist-cards-grid';
    gridDiv.style.setProperty('--anilist-grid-columns', this.settings.gridColumns);
    
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
      titleLink.href = this.getAniListUrl(media.id, config.mediaType);
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleElement.appendChild(titleLink);
      mediaInfoDiv.appendChild(titleElement);
      
      // Create details div
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'media-details';
      
      // Format badge
      if (media.format) {
        const formatBadge = document.createElement('span');
        formatBadge.className = 'format-badge';
        formatBadge.textContent = media.format;
        detailsDiv.appendChild(formatBadge);
      }
      
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge status-${entry.status.toLowerCase()}`;
      statusBadge.textContent = entry.status;
      detailsDiv.appendChild(statusBadge);
      
      if (this.settings.showProgress) {
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
      if (this.settings.showGenres) {
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
    
    const titleHeader = document.createElement('th');
    titleHeader.textContent = 'Title';
    headerRow.appendChild(titleHeader);
    
    const formatHeader = document.createElement('th');
    formatHeader.textContent = 'Format';
    headerRow.appendChild(formatHeader);
    
    const statusHeader = document.createElement('th');
    statusHeader.textContent = 'Status';
    headerRow.appendChild(statusHeader);
    
    if (this.settings.showProgress) {
      const progressHeader = document.createElement('th');
      progressHeader.textContent = 'Progress';
      headerRow.appendChild(progressHeader);
    }
    
    if (this.settings.showRatings) {
      const scoreHeader = document.createElement('th');
      scoreHeader.textContent = 'Score';
      headerRow.appendChild(scoreHeader);
    }
    
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
      titleLink.href = this.getAniListUrl(media.id, config.mediaType);
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.className = 'anilist-title-link';
      titleLink.textContent = title;
      titleCell.appendChild(titleLink);
      row.appendChild(titleCell);
      
      // Format cell
      const formatCell = document.createElement('td');
      if (media.format) {
        const formatBadge = document.createElement('span');
        formatBadge.className = 'format-badge';
        formatBadge.textContent = media.format;
        formatCell.appendChild(formatBadge);
      } else {
        formatCell.textContent = '-';
      }
      row.appendChild(formatCell);
      
      // Status cell
      const statusCell = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge status-${entry.status.toLowerCase()}`;
      statusBadge.textContent = entry.status;
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
    el.innerHTML = `<div class="anilist-error">Error: ${message}</div>`;
  }

// Note Creation 

async createSampleNotes() {
  try {
    let successCount = 0;
    let errorMessages = [];
    
    // **FIRST NOTE CONFIGURATION**
    
    const firstNoteTitle = "Anime Dashboard";
    
const firstNoteContent = `\`\`\`anilist-search
mediaType: ANIME
\`\`\`
# 👀Watching:
\`\`\`anilist
listType: CURRENT
mediaType: ANIME
\`\`\`

# 📝Planning:
\`\`\`anilist
listType: PLANNING
mediaType: ANIME
layout: card
\`\`\`

# 🌀Repeating:
\`\`\`anilist
listType: REPEATING
mediaType: ANIME
layout: card
\`\`\`

# ⏸️On Hold:
\`\`\`anilist
listType: PAUSED
mediaType: ANIME
layout: card
\`\`\`

# 🏁Completed:
\`\`\`anilist
listType: COMPLETED
mediaType: ANIME
layout: card
\`\`\`

# 🗑️Dropped:
\`\`\`anilist
listType: DROPPED
mediaType: ANIME
layout: card
\`\`\`

# 📊Stats:
\`\`\`anilist
type: stats
\`\`\`

Created on: ${new Date().toLocaleDateString()}
`;

 const secondNoteTitle = "Manga Dashboard";

const secondNoteContent = `\`\`\`anilist-search
mediaType: MANGA
layout: card
\`\`\`
# 📖Reading:
\`\`\`anilist
listType: CURRENT
mediaType: MANGA
\`\`\`

# 📝Planning:
\`\`\`anilist
listType: PLANNING
mediaType: MANGA
\`\`\`
# 🌀Repeating:
\`\`\`anilist
listType: REPEATING
mediaType: MANGA
\`\`\`
# ⏸️On Hold:
\`\`\`anilist
listType: PAUSED
mediaType: MANGA
\`\`\`

# 🏁Completed:
\`\`\`anilist
listType: COMPLETED
mediaType: MANGA
\`\`\`
# 🗑️Dropped:
\`\`\`anilist
listType: DROPPED
mediaType: MANGA
\`\`\`
# 📊Stats:
\`\`\`anilist
type: stats
\`\`\`

Created on: ${new Date().toLocaleDateString()}
`;

    // Array of notes to create

    const notesToCreate = [
      { title: firstNoteTitle, content: firstNoteContent },
      { title: secondNoteTitle, content: secondNoteContent }
    ];

    // Create each note

    for (const note of notesToCreate) {
      try {
        const fileName = `${note.title}.md`;
        const filePath = fileName;

 // This creates the note in the vault root
        
        // Checking for if  file already exists
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile) {
          errorMessages.push(`"${note.title}" already exists`);
          continue;
        }
        
        // Create the new note
        await this.app.vault.create(filePath, note.content);
        successCount++;
        
      } catch (error) {
        errorMessages.push(`Failed to create "${note.title}": ${error.message}`);
      }
    }
    
    // Show results
    if (successCount > 0) {
      new Notice(`Successfully created ${successCount} note${successCount > 1 ? 's' : ''}!`, 4000);
      
      // Open the first successfully created note

      const firstNote = this.app.vault.getAbstractFileByPath(`${firstNoteTitle}.md`);
      if (firstNote) {
        await this.app.workspace.openLinkText(`${firstNoteTitle}.md`, '', false);
      }
    }
    
    if (errorMessages.length > 0) {
      new Notice(`Issues: ${errorMessages.join(', ')}`, 5000);
    }
    
  } catch (error) {
    console.error('Error creating notes:', error);
    new Notice(`Failed to create notes: ${error.message}`, 5000);
  }
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
    
    containerEl.createEl('h2', { text: 'Settings' });

new Setting(containerEl)
    .setName('Username')
    .setDesc('Add your AniList username to view your lists and stats — just make sure your profile is public.')
    .addText(text => text
      .setPlaceholder('Enter your AniList username')
      .setValue(this.plugin.settings.defaultUsername)
      .onChange(async (value) => {
        this.plugin.settings.defaultUsername = value.trim();
        await this.plugin.saveSettings();
      }));

// Create two notes One for Manga and other for Anime using Code block 

new Setting(containerEl)
  .setName('Create Sample Notes')
  .setDesc('Creates two notes — one for Anime, one for Manga — with all your lists, search, and stats preloaded. No setup needed.')
  .addButton(button => button
    .setButtonText('Create Note')
    .setTooltip('Click to create a sample note in your vault')
    .onClick(async () => {
      await this.plugin.createSampleNotes();
    }));

    
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
    new Setting(containerEl)
  .setName('Grid Columns')
  .setDesc('Number of columns in card grid layout')
  .addSlider(slider => slider
    .setLimits(1, 6, 1)
    .setValue(this.plugin.settings.gridColumns)
    .setDynamicTooltip()
    .onChange(async (value) => {
      this.plugin.settings.gridColumns = value;
      await this.plugin.saveSettings();
   }));

// more information botton 

new Setting(containerEl)
  .setName('Power Featurs')
  .setDesc('Want more features? Visit our GitHub page for tips, tricks, and powerful ways to customize your notes.')
  .addButton(button => button
    .setButtonText('View Documentation')
    .onClick(() => {
      window.open('https://github.com/zara-kasi/AniList-Obsidian/blob/main/README.md', '_blank');
    }));
    
  }
  
}


module.exports = AniListPlugin;
