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
        
        const data = await this.fetchZoroData(searchConfig);
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
