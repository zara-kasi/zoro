/**
 * MediaListRenderer
 * Migrated from MediaListRenderer.js → MediaListRenderer.ts
 * - Added types for media entries, config, and renderer dependencies
 * - Typed chunk rendering with proper async behavior
 * - Added error handling types for single media rendering
 */
import type { Plugin } from 'obsidian';
import { GRID_COLUMN_OPTIONS } from '../../core/constants';

interface MediaTitle {
  english?: string;
  romaji?: string;
  native?: string;
}

interface CoverImage {
  medium?: string;
  large?: string;
}

interface Media {
  id: number;
  title: MediaTitle;
  coverImage?: CoverImage;
  format?: string;
  status?: string;
  episodes?: number;
  chapters?: number;
  meanScore?: number;
  startDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
  genres?: string[];
}

interface MediaEntry {
  media: Media;
  status: string;
  progress?: number;
  score?: number;
}

interface MediaListItem {
  media?: Media;
}

interface RenderConfig {
  layout?: 'cards' | 'table';
  source?: string;
  mediaType?: string;
}

interface CardRendererOptions {
  isSearch?: boolean;
}

interface ParentRenderer {
  plugin: Plugin & {
    settings: {
      gridColumns?: number | string;
    };
  };
  cardRenderer: {
    createMediaCard(entry: MediaEntry | Media, config: RenderConfig, options?: CardRendererOptions): HTMLElement;
  };
  tableRenderer: {
    render(el: HTMLElement, entries: MediaEntry[], config: RenderConfig): void;
  };
}

export class MediaListRenderer {
  private parent: ParentRenderer;
  private plugin: ParentRenderer['plugin'];
  private cardRenderer: ParentRenderer['cardRenderer'];
  private tableRenderer: ParentRenderer['tableRenderer'];

  constructor(parentRenderer: ParentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.cardRenderer = parentRenderer.cardRenderer;
    this.tableRenderer = parentRenderer.tableRenderer;
  }

  render(el: HTMLElement, entries: MediaEntry[], config: RenderConfig): void {
    el.empty();
    el.className = 'zoro-container';
    
    if (config.layout === 'table') {
      this.tableRenderer.render(el, entries, config);
      return;
    }

    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    this.setupGridLayout(grid);
    
    const fragment = document.createDocumentFragment();
    
    entries.forEach(entry => {
      fragment.appendChild(this.cardRenderer.createMediaCard(entry, config));
    });
    
    grid.appendChild(fragment);
  }

  renderChunked(el: HTMLElement, entries: MediaEntry[], config: RenderConfig, chunkSize: number = 20): void {
    el.empty();
    el.className = 'zoro-container';
    
    const grid = el.createDiv({ cls: 'zoro-cards-grid' });
    this.setupGridLayout(grid);
    
    let index = 0;
    
    const renderChunk = (): void => {
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

  renderSingle(el: HTMLElement, mediaList: MediaListItem | null, config: RenderConfig): void {
    const media = mediaList?.media;
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
    this.setupGridLayout(grid);

    const card = this.cardRenderer.createMediaCard(media, config, { isSearch: true });
    grid.appendChild(card);
  }

  private setupGridLayout(grid: HTMLElement): void {
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
    } catch {
      // Silently handle grid configuration errors
    }
  }
}
