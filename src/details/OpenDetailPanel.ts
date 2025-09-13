import { RenderDetailPanel } from './RenderDetailPanel';
import { DetailPanelSource } from './DetailPanelSource';

// Type definitions
interface Plugin {
  connectedNotes: ConnectedNotesService;
  requestQueue: RequestQueueService;
  [key: string]: unknown; // TODO: replace with actual plugin interface
}

interface ConnectedNotesService {
  openSidePanelWithContext(context: SidePanelContext): Promise<SidePanelView>;
}

interface SidePanelContext {
  media: MediaData;
  entry: EntryData | null;
  source: string;
  mediaType: string;
}

interface SidePanelView {
  embedEl?: HTMLElement;
  currentMode?: string;
  showContentContainer?: (show: boolean) => void;
  showEmbedContainer?: (show: boolean) => void;
}

interface RequestQueueService {
  showGlobalLoader(): void;
  hideGlobalLoader(): void;
}

interface MediaData {
  id?: number | string;
  type?: string;
  format?: string;
  idTmdb?: number;
  idImdb?: string;
  ids?: {
    tmdb?: number;
    imdb?: string;
    simkl?: number;
  };
  [key: string]: unknown;
}

interface EntryData {
  _zoroMeta?: {
    source?: string;
    mediaType?: string;
  };
  [key: string]: unknown;
}

interface MALData {
  [key: string]: unknown; // TODO: confirm MAL data structure
}

interface IMDBData {
  [key: string]: unknown; // TODO: confirm IMDB data structure
}

type UpdateCallback = (detailedMedia: MediaData, malData: MALData | null, imdbData: IMDBData | null) => void;

export class OpenDetailPanel {
  private plugin: Plugin;
  public currentPanel: HTMLElement | null;
  private boundOutsideClickHandler: (event: MouseEvent) => void;
  private renderer: RenderDetailPanel;
  private dataSource: DetailPanelSource;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.currentPanel = null;
    this.boundOutsideClickHandler = this.handleOutsideClick.bind(this);
    this.renderer = new RenderDetailPanel(plugin);
    this.dataSource = new DetailPanelSource(plugin);
  }

  async showPanel(
    media: MediaData,
    entry: EntryData | null = null,
    triggerElement: HTMLElement,
    mountContainer: HTMLElement | null = null
  ): Promise<HTMLElement> {
    this.closePanel();
    
    // If this is a TMDb trending MOVIE/TV item, resolve Simkl details first before rendering
    try {
      const mediaKind = media?.type || media?.format;
      const hasTmdbId = (Number(media?.idTmdb) > 0) || (Number(media?.ids?.tmdb) > 0) || (Number(media?.id) > 0 && (entry?._zoroMeta?.source || '').toLowerCase() === 'tmdb');
      const isMovieOrTv = mediaKind === 'MOVIE' || mediaKind === 'TV';
      if (hasTmdbId && isMovieOrTv) {
        const tmdbId = Number(media?.idTmdb || media?.ids?.tmdb || media?.id);
        const imdbId = media?.idImdb || media?.ids?.imdb || null;
        const resolved = await this.dataSource.resolveSimklIdFromExternal(tmdbId, imdbId, mediaKind);
        if (resolved) {
          // Enrich media with resolved Simkl id for downstream links
          media = { ...media, ids: { ...(media.ids || {}), simkl: resolved } };
        }
      }
    } catch {}

    const panel = this.renderer.createPanel(media, entry);
    this.currentPanel = panel;
    
    if (mountContainer && mountContainer.appendChild) {
      // Direct mount to provided container
      panel.classList.add('zoro-inline');
      this.renderer.positionPanel(panel, null);
      const closeBtn = panel.querySelector('.panel-close-btn') as HTMLElement | null;
      if (closeBtn) closeBtn.onclick = () => this.closePanel();
      mountContainer.appendChild(panel);
    } else {
      // Route to Side Panel - but actually mount the panel to the sidebar's embed container
      try {
        const mediaType = (entry?._zoroMeta?.mediaType || media?.type || media?.format || 'ANIME');
        const source = (entry?._zoroMeta?.source || 'anilist');
        const view = await this.plugin.connectedNotes.openSidePanelWithContext({ media, entry, source, mediaType });
        
        // FIXED: Actually mount the panel to the sidebar's embed container
        panel.classList.add('zoro-inline');
        this.renderer.positionPanel(panel, null);
        const closeBtn = panel.querySelector('.panel-close-btn') as HTMLElement | null;
        if (closeBtn) closeBtn.onclick = () => this.closePanel();
        
        // Mount to the sidebar's embed container instead of calling showDetailsForMedia
        if (view.embedEl) {
          view.embedEl.appendChild(panel);
          view.currentMode = 'details';
          if (view.showContentContainer) view.showContentContainer(false);
          if (view.showEmbedContainer) view.showEmbedContainer(true);
        }
        
      } catch (err) {
        console.error('[Zoro][Details] Failed to open Side Panel for details', err);
      }
    }

    this.plugin.requestQueue.showGlobalLoader();
    
    if (this.dataSource.shouldFetchDetailedData(media)) {
      const updateCallback: UpdateCallback = (detailedMedia, malData, imdbData) => {
        if (this.currentPanel === panel) {
          this.renderer.updatePanelContent(panel, detailedMedia, malData, imdbData);
        }
      };
      
      this.dataSource.fetchAndUpdateData(media.id, entry, updateCallback)
        .finally(() => this.plugin.requestQueue.hideGlobalLoader());
    } else {
      this.plugin.requestQueue.hideGlobalLoader();
    }
    
    return panel;
  }

  private handleOutsideClick(event: MouseEvent): void {
    if (this.currentPanel && !this.currentPanel.contains(event.target as Node)) {
      this.closePanel();
    }
  }

  closePanel(): void {
    if (this.currentPanel) {
      this.renderer.cleanupCountdowns(this.currentPanel);
      document.removeEventListener('click', this.boundOutsideClickHandler);
      this.currentPanel.remove();
      this.currentPanel = null;
    }
  }
}
