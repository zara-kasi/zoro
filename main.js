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
      const config = this.parseCodeBlockConfig(source);
      const data = await this.fetchAniListData(config);
      this.renderAniListData(el, data, config);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

// Authentication 



async authenticateUser() {
  if (!this.settings.clientId) {
    new Notice('Please set Client ID in plugin settings first');
    return;
  }
  
  // Use AniList's built-in PIN display page
  const redirectUri = 'https://anilist.co/api/v2/oauth/pin';
  
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${this.settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  
  new Notice('Opening AniList authentication page...', 3000);
  
  try {
    // Open the authentication URL
    if (window.require) {
      // If running in Electron (desktop app)
      const { shell } = window.require('electron');
      await shell.openExternal(authUrl);
    } else {
      // Fallback for web/mobile
      window.open(authUrl, '_blank');
    }
    
    // Show clear instructions
    new Notice('After authorizing, copy the PIN code and paste it in the next prompt.', 8000);
    
    // Give user time to complete auth
    setTimeout(() => {
      const code = prompt('Paste the PIN code from AniList here:');
      if (code && code.trim()) {
        this.exchangeCodeForToken(code.trim(), redirectUri);
      }
    }, 4000);
    
  } catch (error) {
    new Notice(`Error opening authentication page: ${error.message}`);
  }
}

async exchangeCodeForToken(code, redirectUri) {
  try {
    const requestBody = {
      grant_type: 'authorization_code',
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
      redirect_uri: redirectUri,
      code: code
    };

    // Method 1: Try with proper headers and error handling
    const response = await this.makeTokenRequest(requestBody);
    
    if (response.access_token) {
      this.settings.accessToken = response.access_token;
      await this.saveSettings();
      new Notice('✅ Successfully authenticated with AniList!');
      
      // Test the token by making a simple API call
      await this.testAccessToken();
    } else {
      throw new Error('No access token received from AniList');
    }
    
  } catch (error) {
    console.error('Authentication error:', error);
    new Notice(`❌ Authentication failed: ${error.message}`);
    
    // Provide troubleshooting tips
    new Notice('💡 Try: 1) Check Client ID/Secret 2) Ensure PIN is correct 3) Try again', 8000);
  }
}

async makeTokenRequest(requestBody) {
  // Try multiple methods for better compatibility
  
  // Method 1: Standard fetch with proper headers
  try {
    const response = await fetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AniList-Obsidian-Plugin'
      },
      body: JSON.stringify(requestBody),
      mode: 'cors'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    return data;
    
  } catch (fetchError) {
    console.warn('Standard fetch failed, trying alternative method:', fetchError);
    
    // Method 2: Try with Obsidian's requestUrl if available
    if (this.app.vault.adapter && this.app.vault.adapter.requestUrl) {
      try {
        const response = await this.app.vault.adapter.requestUrl({
          url: 'https://anilist.co/api/v2/oauth/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
        
        return JSON.parse(response.text);
        
      } catch (obsidianError) {
        console.warn('Obsidian requestUrl failed:', obsidianError);
      }
    }
    
    // Method 3: Try with XMLHttpRequest as fallback
    try {
      return await this.makeXHRTokenRequest(requestBody);
    } catch (xhrError) {
      console.warn('XHR request failed:', xhrError);
      throw new Error(`All request methods failed. Last error: ${fetchError.message}`);
    }
  }
}

async makeXHRTokenRequest(requestBody) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.open('POST', 'https://anilist.co/api/v2/oauth/token', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    
    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (parseError) {
          reject(new Error(`Failed to parse response: ${parseError.message}`));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
      }
    };
    
    xhr.onerror = function() {
      reject(new Error('Network error occurred'));
    };
    
    xhr.ontimeout = function() {
      reject(new Error('Request timed out'));
    };
    
    xhr.timeout = 30000; // 30 second timeout
    xhr.send(JSON.stringify(requestBody));
  });
}

async testAccessToken() {
  try {
    const query = `
      query {
        Viewer {
          id
          name
        }
      }
    `;
    
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query })
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data.Viewer) {
        new Notice(`🎉 Welcome ${data.data.Viewer.name}! Authentication successful.`);
      }
    }
  } catch (error) {
    console.warn('Token test failed:', error);
    // Don't show error to user as main auth succeeded
  }
}

// Enhanced fetchAniListData method with better error handling
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
    
    // Add authorization header if we have an access token
    if (this.settings.accessToken) {
      headers['Authorization'] = `Bearer ${this.settings.accessToken}`;
    }
    
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query, variables })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.errors) {
      // Handle specific error cases
      if (result.errors[0].message.includes('Private')) {
        throw new Error('This user\'s list is private. Please make sure your AniList profile is public.');
      }
      throw new Error(result.errors[0].message);
    }
    
    this.cache.set(cacheKey, {
      data: result.data,
      timestamp: Date.now()
    });
    
    return result.data;
    
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

// Method to update media list entries (requires authentication)
async updateMediaListEntry(mediaId, updates) {
  if (!this.settings.accessToken) {
    throw new Error('Authentication required to update entries');
  }
  
  const mutation = `
    mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
        id
        status
        score
        progress
      }
    }
  `;
  
  const variables = {
    mediaId: mediaId,
    status: updates.status,
    score: updates.score,
    progress: updates.progress
  };
  
  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query: mutation, variables })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update entry: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    
    // Clear cache to force refresh
    this.cache.clear();
    
    return result.data.SaveMediaListEntry;
    
  } catch (error) {
    console.error('Update failed:', error);
    throw error;
  }
}

// Search Bar

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
        img.src = item.coverImage.large;
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
      img.src = media.coverImage.large;
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
        img.src = media.coverImage.large;
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
statusBadge.className = `status-badge status-${entry.status.toLowerCase()} clickable-status`;
statusBadge.textContent = entry.status;
statusBadge.style.cursor = 'pointer';
statusBadge.onclick = (e) => {
  e.preventDefault();
  e.stopPropagation();
  
  this.createEditModal(entry, 
    async (updates) => {
      await this.updateMediaListEntry(entry.media.id, updates);
      new Notice('Updated successfully!');
      // Refresh the view
      location.reload();
    },
    () => {
      // Cancel - do nothing
    }
  );
};
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

// floating window for customisation 

createEditModal(entry, onSave, onCancel) {
  const modal = document.createElement('div');
  modal.className = 'anilist-edit-modal';
  
  const overlay = document.createElement('div');
  overlay.className = 'anilist-modal-overlay';
  
  const content = document.createElement('div');
  content.className = 'anilist-modal-content';
  
  const title = document.createElement('h3');
  title.textContent = entry.media.title.english || entry.media.title.romaji;
  
  const statusSelect = document.createElement('select');
  ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].forEach(status => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    if (status === entry.status) option.selected = true;
    statusSelect.appendChild(option);
  });
  
  const scoreInput = document.createElement('input');
  scoreInput.type = 'number';
  scoreInput.min = '0';
  scoreInput.max = '10';
  scoreInput.step = '0.1';
  scoreInput.value = entry.score || '';
  scoreInput.placeholder = 'Score (0-10)';
  
  const progressInput = document.createElement('input');
  progressInput.type = 'number';
  progressInput.min = '0';
  progressInput.max = entry.media.episodes || entry.media.chapters || 999;
  progressInput.value = entry.progress || 0;
  progressInput.placeholder = 'Progress';
  
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'anilist-modal-buttons';
  
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.onclick = () => {
    onSave({
      status: statusSelect.value,
      score: parseFloat(scoreInput.value) || null,
      progress: parseInt(progressInput.value) || 0
    });
    document.body.removeChild(modal);
  };
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    onCancel();
    document.body.removeChild(modal);
  };
  
  buttonContainer.appendChild(saveBtn);
  buttonContainer.appendChild(cancelBtn);
  
  content.appendChild(title);
  content.appendChild(statusSelect);
  content.appendChild(scoreInput);
  content.appendChild(progressInput);
  content.appendChild(buttonContainer);
  
  modal.appendChild(overlay);
  modal.appendChild(content);
  
  overlay.onclick = () => {
    onCancel();
    document.body.removeChild(modal);
  };
  
  document.body.appendChild(modal);
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

new Setting(containerEl)
    .setName('👤 Username')
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
  .setName('➕ Sample Notes')
  .setDesc('Creates two notes — one for Anime, one for Manga — with all your lists, search, and stats preloaded. No setup needed.')
  .addButton(button => button
    .setButtonText('Create Note')
    .setTooltip('Click to create a sample note in your vault')
    .onClick(async () => {
      await this.plugin.createSampleNotes();
    }));

    
    new Setting(containerEl)
      .setName('🧊 Layout')
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
      .setName('🌆 Cover')
      .setDesc('Display cover images for anime/manga')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCoverImages)
        .onChange(async (value) => {
          this.plugin.settings.showCoverImages = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('⭐ Ratings')
      .setDesc('Display user ratings/scores')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showRatings)
        .onChange(async (value) => {
          this.plugin.settings.showRatings = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('📈 Progress')
      .setDesc('Display progress information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgress)
        .onChange(async (value) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('🎭 Genres')
      .setDesc('Display genre tags')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
  .setName('🔲 Grid Columns')
  .setDesc('Number of columns in card grid layout')
  .addSlider(slider => slider
    .setLimits(1, 6, 1)
    .setValue(this.plugin.settings.gridColumns)
    .setDynamicTooltip()
    .onChange(async (value) => {
      this.plugin.settings.gridColumns = value;
      await this.plugin.saveSettings();
   }));

// Authentication Botton

new Setting(containerEl)
  .setName('🔑 Client ID')
  .setDesc('Your AniList application Client ID')
  .addText(text => text
    .setPlaceholder('Enter Client ID')
    .setValue(this.plugin.settings.clientId || '')
    .onChange(async (value) => {
      this.plugin.settings.clientId = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('🔐 Client Secret')
  .setDesc('Your AniList application Client Secret')
  .addText(text => text
    .setPlaceholder('Enter Client Secret')
    .setValue(this.plugin.settings.clientSecret || '')
    .onChange(async (value) => {
      this.plugin.settings.clientSecret = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('🔗 Redirect URI')
  .setDesc('Your application redirect URI')
  .addText(text => text
    .setPlaceholder('http://localhost:8080/callback')
    .setValue(this.plugin.settings.redirectUri || 'http://localhost:8080/callback')
    .onChange(async (value) => {
      this.plugin.settings.redirectUri = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('🔓 Authenticate')
  .setDesc('Connect your AniList account')
  .addButton(button => button
    .setButtonText(this.plugin.settings.accessToken ? 'Re-authenticate' : 'Authenticate')
    .onClick(async () => {
      await this.plugin.authenticateUser();
    }));

// more information botton 

new Setting(containerEl)
  .setName('⚡ Power Features')
  .setDesc('Want more features? Visit our GitHub page for tips, tricks, and powerful ways to customize your notes.')
  .addButton(button => button
    .setButtonText('View Documentation')
    .onClick(() => {
      window.open('https://github.com/zara-kasi/AniList-Obsidian/blob/main/README.md', '_blank');
    }));
    
  }
  
}

module.exports = AniListPlugin;