// No obsidian imports needed here
import { GRID_COLUMN_OPTIONS } from '../../core/constants.js';

class MediaListRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.cardRenderer = parentRenderer.cardRenderer;
    this.tableRenderer = parentRenderer.tableRenderer;
  }

  render(el, entries, config) {
    el.empty();
    el.className = 'zoro-container';
    
    if (config.layout === 'table') {
      this.tableRenderer.render(el, entries, config);
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
    
    entries.forEach(entry => {
      fragment.appendChild(this.cardRenderer.createMediaCard(entry, config));
    });
    
    grid.appendChild(fragment);
  }

  renderChunked(el, entries, config, chunkSize = 20) {
    el.empty();
    el.className = 'zoro-container';
    
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
    let index = 0;
    
    const renderChunk = () => {
      const fragment = document.createDocumentFragment();
      const end = Math.min(index + chunkSize, entries.length);
      
      for (; index < end; index++) {
        fragment.appendChild(this.cardRenderer.createMediaCard(entries[index], config));
      }
      
      grid.appendChild(fragment);
      
      if (index < entries.length) {
        requestAnimationFrame(renderChunk);
      }
    };
    
    renderChunk();
  }

  renderSingle(el, mediaList, config) {
    const media = mediaList && mediaList.media;
    if (!media) {
      el.empty();
      el.className = 'zoro-container';
      const box = el.createDiv({ cls: 'zoro-error-box' });
      box.createEl('strong', { text: '❌ Single media' });
      box.createEl('pre', { text: 'Media not found. Ensure the mediaId is correct and exists on the selected source.' });
      return;
    }

    el.empty();
    el.className = 'zoro-container';

    // Render like a search card: shows Edit button, no progress, shows ratings
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

    const card = this.cardRenderer.createMediaCard(media, config, { isSearch: true });
    grid.appendChild(card);
  }
}

export { MediaListRenderer };