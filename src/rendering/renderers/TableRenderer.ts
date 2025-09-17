import type { Plugin } from 'obsidian';

interface MediaTitle {
  english?: string;
  romaji?: string;
}

interface Media {
  id: number | string;
  title: MediaTitle;
  format?: string;
  episodes?: number;
  chapters?: number;
  genres?: string[];
}

interface MediaEntry {
  media: Media;
  status: string;
  progress?: number;
  score?: number;
}

interface RenderConfig {
  source: 'mal' | 'anilist';
  mediaType: string;
}

interface ParentRenderer {
  plugin: Plugin & {
    settings: {
      showProgress: boolean;
      showRatings: boolean;
      showGenres: boolean;
      malAccessToken?: string;
      accessToken?: string;
    };
    getMALUrl(id: number | string, mediaType: string): string;
    getAniListUrl(id: number | string, mediaType: string): string;
    handleEditClick(event: MouseEvent, entry: MediaEntry, element: HTMLElement, config: RenderConfig): void;
  };
  apiHelper: unknown; // TODO: type based on actual apiHelper interface
  formatter: unknown; // TODO: type based on actual formatter interface
}

export class TableRenderer {
  private parent: ParentRenderer;
  private plugin: ParentRenderer['plugin'];
  private apiHelper: unknown; // TODO: type based on actual apiHelper interface
  private formatter: unknown; // TODO: type based on actual formatter interface

  constructor(parentRenderer: ParentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.apiHelper = parentRenderer.apiHelper;
    this.formatter = parentRenderer.formatter;
  }

  render(el: HTMLElement, entries: MediaEntry[], config: RenderConfig): void {
    const table = el.createEl('table', { cls: 'zoro-table' });
    const headers = ['Title', 'Format', 'Status'];
    
    if (this.plugin.settings.showProgress) headers.push('Progress');
    if (this.plugin.settings.showRatings) headers.push('Score');
    if (this.plugin.settings.showGenres) headers.push('Genres');
    
    table.createTHead().createEl('tr', null, tr =>
      headers.forEach(h => tr.createEl('th', { text: h }))
    );
    
    const tbody = table.createTBody();
    const fragment = document.createDocumentFragment();
    
    entries.forEach(entry => {
      const m = entry.media;
      const tr = fragment.createEl('tr');
      
      tr.createEl('td', null, td =>
        td.createEl('a', {
          text: m.title.english || m.title.romaji || 'Untitled', // Added fallback for type safety
          href: config.source === 'mal' 
            ? this.plugin.getMALUrl(m.id, config.mediaType)
            : this.plugin.getAniListUrl(m.id, config.mediaType),
          cls: 'zoro-title-link',
          target: '_blank'
        })
      );
      
      tr.createEl('td', { text: m.format || '-' });
      
      tr.createEl('td', null, td => {
        const s = td.createEl('span', {
          text: entry.status,
          cls: `status-badge status-${entry.status.toLowerCase()} clickable-status`
        });
        
        s.onclick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Check authentication based on source
          const isAuthenticated = config.source === 'mal' 
            ? this.plugin.settings.malAccessToken 
            : this.plugin.settings.accessToken;
            
          if (!isAuthenticated) {
            return;
          }
          this.plugin.handleEditClick(e, entry, s, config);
        };
      });
      
      if (this.plugin.settings.showProgress) {
        tr.createEl('td', {
          text: `${entry.progress ?? 0}/${m.episodes ?? m.chapters ?? '?'}`
        });
      }
      
      if (this.plugin.settings.showRatings) {
        tr.createEl('td', { text: entry.score != null ? `★ ${entry.score}` : '-' });
      }
      
      if (this.plugin.settings.showGenres) {
        tr.createEl('td', {
          text: (m.genres || []).slice(0, 3).join(', ') || '-'
        });
      }
    });
    
    tbody.appendChild(fragment);
  }
}