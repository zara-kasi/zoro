import { setIcon } from 'obsidian';
import { DOMHelper } from '../helpers/DOMHelper.js';
import { GRID_COLUMN_OPTIONS } from '../../core/constants.js';

class SearchRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.apiHelper = parentRenderer.apiHelper;
    this.cardRenderer = parentRenderer.cardRenderer;
  }

  render(el, config) {
  el.empty();
  el.className = 'zoro-search-container';

  const mt = String(config.mediaType || 'ANIME').toUpperCase();
  const src = String(config.source || '').toLowerCase();



  // wrapper with positioning
  const searchWrapper = el.createDiv({ cls: 'zoro-search-input-container' });

  // icon element positioned absolutely inside the input
  const iconSpan = searchWrapper.createEl('span', { cls: 'zoro-search-icon' });

  // Use Obsidian's setIcon with Lucide 'search' icon
  setIcon(iconSpan, 'search');

  // create the input with left padding for the icon
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'zoro-search-input';

  if (src === 'simkl') {
    if (mt === 'ANIME') input.placeholder = 'Search anime…';
    else if (mt === 'MOVIE' || mt === 'MOVIES') input.placeholder = 'Search movies…';
    else input.placeholder = 'Search TV shows…';
  } else {
    input.placeholder = mt === 'ANIME' ? 'Search anime…' : 'Search manga…';
  }

  searchWrapper.appendChild(input);

  // results container
  const resultsDiv = el.createDiv({ cls: 'zoro-search-results' });
  let timeout;

  const doSearch = async () => {
    const term = input.value.trim();
    if (term.length < 3) {
      resultsDiv.innerHTML = DOMHelper.createErrorMessage('Type at least 3 characters…');
      return;
    }

    try {
      resultsDiv.innerHTML = '';
      resultsDiv.appendChild(DOMHelper.createListSkeleton(5));

      const data = await this.apiHelper.fetchSearchData(config, term);

      resultsDiv.innerHTML = '';
      this.renderSearchResults(resultsDiv, data.Page.media, config);
    } catch (e) {
      this.plugin.renderError(resultsDiv, e.message);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(doSearch, 300);
  });

  input.addEventListener('keypress', e => {
    if (e.key === 'Enter') doSearch();
  });
}

  renderSearchResults(el, media, config) {
    el.empty();
    if (media.length === 0) {
      el.innerHTML = DOMHelper.createErrorMessage('No results found.');
      return;
    }

    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    try {
      const gridSetting = this.plugin.settings.gridColumns || GRID_COLUMN_OPTIONS.DEFAULT;
      if (gridSetting === GRID_COLUMN_OPTIONS.DEFAULT) {
        // For "Default", let CSS handle responsive behavior
        grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
      } else {
        // For fixed column values, set the CSS variables
        grid.style.setProperty('--zoro-grid-columns', String(gridSetting));
        grid.style.setProperty('--grid-cols', String(gridSetting));
        grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
        // Also set grid-template-columns directly to ensure it takes precedence
        grid.style.setProperty('grid-template-columns', `repeat(${gridSetting}, minmax(0, 1fr))`, 'important');
      }
    } catch {}
    const fragment = document.createDocumentFragment();
    
    media.forEach(item => {
      fragment.appendChild(this.cardRenderer.createMediaCard(item, config, { isSearch: true }));
    });
    
    grid.appendChild(fragment);
  }
}

export { SearchRenderer };