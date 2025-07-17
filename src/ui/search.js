async function renderSearchInterface(el, config, settings, plugin) {
  el.empty();
  el.className = 'zoro-search-container';
  const searchDiv = document.createElement('div');
  searchDiv.className = 'zoro-search-input-container';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'zoro-search-input';
  input.placeholder = config.mediaType === 'ANIME' ? 'Search anime...' : 'Search manga...';
  searchDiv.appendChild(input);
  el.appendChild(searchDiv);
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'zoro-search-results';
  el.appendChild(resultsDiv);

  let searchTimeout;
  const performSearch = async () => {
    const term = input.value.trim();
    if (term.length < 3) {
      resultsDiv.innerHTML = '<div class="zoro-search-message">Type at least 3 characters to search...</div>';
      return;
    }
    resultsDiv.innerHTML = '<div class="zoro-search-loading">Searching...</div>';
    try {
      const data = await plugin.fetchZoroData({ ...config, search: term, page: 1, perPage: 20 });
      exports.renderSearchResults(resultsDiv, data.Page.media, config, settings, plugin);
    } catch (err) {
      require('./error').renderError(resultsDiv, err.message);
    }
  };
  input.addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(performSearch, 300); });
  input.addEventListener('keypress', e => { if (e.key === 'Enter') performSearch(); });
}

function renderSearchResults(el, media, config, settings, plugin) {
  el.empty();
  if (!media.length) { el.innerHTML = '<div class="zoro-search-message">No results found.</div>'; return; }
  const grid = document.createElement('div');
  grid.className = 'zoro-cards-grid';
  grid.style.setProperty('--zoro-grid-columns', settings.gridColumns);
  media.forEach(item => {
    const card = document.createElement('div');
    card.className = 'zoro-card';
    const title = item.title.english || item.title.romaji;
    if (settings.showCoverImages) {
      const img = document.createElement('img');
      img.src = item.coverImage.large;
      img.alt = title;
      img.className = 'media-cover';
      card.appendChild(img);
    }
    const info = document.createElement('div');
    info.className = 'media-info';
    info.innerHTML = `
      <h4><a href="https://anilist.co/${config.mediaType.toLowerCase()}/${item.id}" target="_blank" rel="noopener noreferrer" class="anilist-title-link">${title}</a></h4>
      <div class="media-details">
        ${item.format ? `<span class="format-badge">${item.format}</span>` : ''}
        <span class="status-badge status-${item.status.toLowerCase()}">${item.status}</span>
        ${settings.showRatings && item.averageScore ? `<span class="score">★ ${item.averageScore}</span>` : ''}
        <span class="status-badge status-planning clickable-status add-to-list-btn" style="cursor:pointer;background:#4CAF50;color:#fff">ADD</span>
      </div>
      ${settings.showGenres && item.genres ? `<div class="genres">${item.genres.slice(0,3).map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
    `;
    const addBtn = info.querySelector('.add-to-list-btn');
    if (settings.accessToken) {
      addBtn.title = 'Click to add to your list';
      addBtn.onclick = e => handleAddClick(e, item, config.mediaType, addBtn, plugin);
    } else {
      addBtn.title = 'Click to authenticate';
      addBtn.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        require('./modals').createAuthenticationPrompt(plugin);
      };
    }
    if (settings.accessToken) {
      plugin.checkIfMediaInList(item.id, config.mediaType).then(inList => {
        if (inList) {
          addBtn.textContent = 'IN LIST';
          addBtn.style.backgroundColor = '#999';
          addBtn.style.cursor = 'not-allowed';
          addBtn.title = 'Already in your list';
          addBtn.onclick = null;
        }
      });
    }
    card.appendChild(info);
    grid.appendChild(card);
  });
  el.appendChild(grid);
}

function handleAddClick(e, mediaItem, mediaType, buttonEl, plugin) {
  e.preventDefault();
  e.stopPropagation();
  const entry = {
    media: {
      id: mediaItem.id,
      title: mediaItem.title,
      episodes: mediaItem.episodes,
      chapters: mediaItem.chapters,
      format: mediaItem.format
    },
    status: 'PLANNING',
    score: null,
    progress: 0
  };
  require('./modals').createAddModal(entry, async updates => {
    try {
      buttonEl.textContent = 'Adding...';
      buttonEl.style.backgroundColor = '#ff9800';
      buttonEl.disabled = true;
      await plugin.addMediaToList(mediaItem.id, updates, mediaType);
      buttonEl.textContent = 'IN LIST';
      buttonEl.style.backgroundColor = '#999';
      buttonEl.style.cursor = 'not-allowed';
      buttonEl.title = 'Already in your list';
      buttonEl.onclick = null;
      new Notice('✅ Added to your list!');
      plugin.cache.userData.clear();
    } catch (err) {
      buttonEl.textContent = 'ADD';
      buttonEl.style.backgroundColor = '#4CAF50';
      buttonEl.disabled = false;
      new Notice(`❌ Failed to add: ${err.message}`);
    }
  }, () => new Notice('Add canceled.'));
}

module.exports = { renderSearchInterface, renderSearchResults, handleAddClick };
