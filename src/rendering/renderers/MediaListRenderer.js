const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

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
  const cols = Number(this.plugin.settings.gridColumns) || 2;
  grid.style.setProperty('--zoro-grid-columns', String(cols));
  grid.style.setProperty('--grid-cols', String(cols));
  grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
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
  const cols = Number(this.plugin.settings.gridColumns) || 2;
  grid.style.setProperty('--zoro-grid-columns', String(cols));
  grid.style.setProperty('--grid-cols', String(cols));
  grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
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
      const cols = Number(this.plugin.settings.gridColumns) || 2;
      grid.style.setProperty('--zoro-grid-columns', String(cols));
      grid.style.setProperty('--grid-cols', String(cols));
      grid.style.setProperty('--zoro-grid-gap', 'var(--size-4-4)');
    } catch {}

    const card = this.cardRenderer.createMediaCard(media, config, { isSearch: true });
    grid.appendChild(card);
  }
}

export { MediaListRenderer };