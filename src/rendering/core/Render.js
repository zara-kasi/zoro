class Render {
  constructor(plugin) {
    this.plugin = plugin;
    
    // Initialize utility helpers
    this.apiHelper = new APISourceHelper(plugin);
    this.formatter = new FormatterHelper();
    
    // Initialize specialized renderers
    this.cardRenderer = new CardRenderer(this);
    this.searchRenderer = new SearchRenderer(this);
    this.tableRenderer = new TableRenderer(this);
    this.mediaListRenderer = new MediaListRenderer(this);
    this.statsRenderer = new StatsRenderer(this);
  }

  renderSearchInterface(el, config) {
    return this.searchRenderer.render(el, config);
  }

  renderMediaList(el, entries, config) {
    return this.mediaListRenderer.render(el, entries, config);
  }

  renderSearchResults(el, media, config) {
    return this.searchRenderer.renderSearchResults(el, media, config);
  }

  renderTableLayout(el, entries, config) {
    return this.tableRenderer.render(el, entries, config);
  }

  renderSingleMedia(el, mediaList, config) {
    return this.mediaListRenderer.renderSingle(el, mediaList, config);
  }

  renderUserStats(el, user, options = {}) {
    return this.statsRenderer.render(el, user, options);
  }

  renderMediaListChunked(el, entries, config, chunkSize = 20) {
    return this.mediaListRenderer.renderChunked(el, entries, config, chunkSize);
  }

  createMediaCard(data, config, options = {}) {
    return this.cardRenderer.createMediaCard(data, config, options);
  }

  // ========== SKELETON CREATION METHODS - UNCHANGED ==========
  
  createListSkeleton(count = 6) {
    return DOMHelper.createListSkeleton(count);
  }

  createStatsSkeleton() {
    return DOMHelper.createStatsSkeleton();
  }

  createSearchSkeleton() {
    return DOMHelper.createSearchSkeleton();
  }

  // ========== EVENT HANDLING METHODS - UNCHANGED ==========
  
  attachEventListeners(card, entry, media, config) {
    const statusBadge = card.querySelector('.clickable-status[data-entry-id]');
    if (statusBadge) {
      statusBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleStatusClick(e, entry, statusBadge, config);
      };
    }
    
    const addBtn = card.querySelector('.clickable-status[data-media-id]');
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleAddClick(e, media, config);
      };
    }
  }

  handleStatusClick(e, entry, badge, config = {}) {
    return this.cardRenderer.handleStatusClick(e, entry, badge, config);
  }

  handleAddClick(e, media, config) {
    return this.cardRenderer.handleAddClick(e, media, config);
  }

  // ========== UTILITY METHODS - UNCHANGED ==========
  
  clear(el) { 
    el.empty?.(); 
  }

  // Method to refresh active views (used by card renderer)
  refreshActiveViews() {
    // This method should trigger refresh of any active views
    // Implementation depends on your plugin's architecture
    if (this.plugin.refreshActiveViews) {
      this.plugin.refreshActiveViews();
    }
  }

  // ========== MISSING UTILITY METHODS FROM ORIGINAL ==========
  
  // URL generation methods that might be called from outside
  getAniListUrl(id, mediaType) {
    return this.plugin.getAniListUrl(id, mediaType);
  }

  getMALUrl(id, mediaType) {
    return this.plugin.getMALUrl(id, mediaType);
  }

  getSourceSpecificUrl(id, mediaType, source) {
    return this.apiHelper.getSourceSpecificUrl(id, mediaType, source);
  }

  // Error rendering (might be called from outside)
  renderError(el, message) {
    if (el.innerHTML !== undefined) {
      el.innerHTML = DOMHelper.createErrorMessage(message);
    } else {
      const errorDiv = el.createDiv({ cls: 'zoro-error' });
      errorDiv.textContent = message;
    }
  }

  // ========== STATS RENDERING HELPER METHODS - DELEGATED ==========
  
  renderStatsError(el, message) {
    return this.statsRenderer.renderError(el, message);
  }

  renderStatsHeader(fragment, user) {
    return this.statsRenderer.renderHeader(fragment, user);
  }

  renderStatsOverview(fragment, user, options) {
    return this.statsRenderer.renderOverview(fragment, user, options);
  }

  renderMediaTypeCard(container, type, stats, listOptions) {
    return this.statsRenderer.renderMediaTypeCard(container, type, stats, listOptions);
  }

  renderComparisonCard(container, animeStats, mangaStats) {
    return this.statsRenderer.renderComparisonCard(container, animeStats, mangaStats);
  }

  renderStatsBreakdowns(fragment, user, mediaType) {
    return this.statsRenderer.renderBreakdowns(fragment, user, mediaType);
  }

  renderStatsInsights(fragment, user, mediaType) {
    return this.statsRenderer.renderInsights(fragment, user, mediaType);
  }

  renderStatsFavorites(fragment, user, mediaType) {
    return this.statsRenderer.renderFavorites(fragment, user, mediaType);
  }

  renderBreakdownChart(container, title, data, keyField, options = {}) {
    return this.statsRenderer.renderBreakdownChart(container, title, data, keyField, options);
  }

  renderScoreDistribution(container, scores, listOptions) {
    return this.statsRenderer.renderScoreDistribution(container, scores, listOptions);
  }

  renderYearlyActivity(container, yearData) {
    return this.statsRenderer.renderYearlyActivity(container, yearData);
  }

  addSecondaryMetric(container, label, value) {
    return DOMHelper.addSecondaryMetric(container, label, value);
  }

  formatScore(score, scoreFormat = 'POINT_10') {
    return this.formatter.formatScore(score, scoreFormat);
  }

  formatWatchTime(minutes) {
    return this.formatter.formatWatchTime(minutes);
  }

  generateInsights(stats, type, user) {
    return this.statsRenderer.generateInsights(stats, type, user);
  }
}

export { Render };