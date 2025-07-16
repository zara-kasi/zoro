export function renderSearchInterface(el, config) {
    el.empty();
    el.className = 'zoro-search-container';
    
    // Create search input
    const searchDiv = document.createElement('div');
    searchDiv.className = 'zoro-search-input-container';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'zoro-search-input';
    searchInput.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';
    
    
    searchDiv.appendChild(searchInput);
    el.appendChild(searchDiv);
    
    // Create results container
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'zoro-search-results';
    el.appendChild(resultsDiv);
    
    // Add event listeners
    let searchTimeout;
    
    const performSearch = async () => {
      const searchTerm = searchInput.value.trim();
      
      if (searchTerm.length < 3) {
        resultsDiv.innerHTML = '<div class="zoro-search-message">Type at least 3 characters to search...</div>';
        return;
      }
      
      try {
        resultsDiv.innerHTML = '<div class="zoro-search-loading">Searching...</div>';
        
        const searchConfig = { ...config,
          search: searchTerm,
          page: 1,
          perPage: 20
        };
        
        const data = await fetchZoroData.bind(this)(searchConfig);
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
export function renderSearchResults(el, media, config) {
  el.empty();
  
  if (media.length === 0) {
    el.innerHTML = '<div class="zoro-search-message">No results found.</div>';
    return;
  }
  
  const gridDiv = document.createElement('div');
  gridDiv.className = 'zoro-cards-grid';
  gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);
  
  media.forEach(async (item) => {
    const title = item.title.english || item.title.romaji;
    
    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-card';
    
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
    titleLink.href = this.getZoroUrl(item.id, config.mediaType);
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
    
    // Status badge (for media release status)
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge status-${item.status.toLowerCase()}`;
    statusBadge.textContent = item.status;
    detailsDiv.appendChild(statusBadge);
    
    // ADD button - styled like status badges but with different functionality
    const addButton = document.createElement('span');
    addButton.className = 'status-badge status-planning clickable-status add-to-list-btn';
    addButton.textContent = 'ADD';
    addButton.style.cursor = 'pointer';
    addButton.style.backgroundColor = '#4CAF50';
    addButton.style.color = 'white';
    
    if (this.settings.accessToken) {
      addButton.title = 'Click to add to your list';
      addButton.onclick = (e) => this.handleAddClick(e, item, config.mediaType, addButton);
    } else {
      addButton.title = 'Click to authenticate';
      addButton.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.createAuthenticationPrompt();
      };
    }
    
    detailsDiv.appendChild(addButton);
    
    // Average score
    if (this.settings.showRatings && item.averageScore) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `★ ${item.averageScore}`;
      detailsDiv.appendChild(scoreSpan);
    }
    
    mediaInfoDiv.appendChild(detailsDiv);
    
    // Create genres div
    if (this.settings.showGenres && item.genres) {
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
    
    // Check if item is already in list and update button accordingly
    if (this.settings.accessToken) {
      checkIfMediaInList.bind(this)(item.id, config.mediaType).then(inList => {
        if (inList) {
          addButton.textContent = 'IN LIST';
          addButton.style.backgroundColor = '#999';
          addButton.style.cursor = 'not-allowed';
          addButton.title = 'Already in your list';
          addButton.onclick = null;
        }
      });
    }
  });
  
  el.appendChild(gridDiv);
}

// Handle ADD button click
export function handleAddClick(e, mediaItem, mediaType, buttonEl) {
  e.preventDefault();
  e.stopPropagation();
  
  // Create a mock entry object similar to existing entries
  const mockEntry = {
    media: {
      id: mediaItem.id,
      title: mediaItem.title,
      episodes: mediaItem.episodes,
      chapters: mediaItem.chapters,
      format: mediaItem.format
    },
    status: 'PLANNING', // Default status
    score: null,
    progress: 0
  };
  
  this.createAddModal(
    mockEntry,
    async (updates) => {
      try {
        buttonEl.textContent = 'Adding...';
        buttonEl.style.backgroundColor = '#ff9800';
        buttonEl.disabled = true;
        
        await addMediaToList.bind(this)(mediaItem.id, updates, mediaType);
        
        buttonEl.textContent = 'IN LIST';
        buttonEl.style.backgroundColor = '#999';
        buttonEl.style.cursor = 'not-allowed';
        buttonEl.title = 'Already in your list';
        buttonEl.onclick = null;
        
        new Notice('✅ Added to your list!');
        this.cache.clear();
      } catch (err) {
        buttonEl.textContent = 'ADD';
        buttonEl.style.backgroundColor = '#4CAF50';
        buttonEl.disabled = false;
        new Notice(`❌ Failed to add: ${err.message}`);
      }
    },
    () => {
      new Notice('Add canceled.');
    }
  );
}
