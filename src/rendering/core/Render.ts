import { Notice, setIcon } from 'obsidian';
import type { Plugin } from 'obsidian';
import { APISourceHelper } from '../helpers/APISourceHelper';
import { FormatterHelper } from '../helpers/FormatterHelper';
import { CardRenderer } from '../renderers/CardRenderer';
import { SearchRenderer } from '../renderers/SearchRenderer';
import { TableRenderer } from '../renderers/TableRenderer';
import { MediaListRenderer } from '../renderers/MediaListRenderer';
import { StatsRenderer } from '../renderers/StatsRenderer';
import { DOMHelper } from '../helpers/DOMHelper';

// Core interfaces
interface RenderConfig {
  source?: 'anilist' | 'mal';
  mediaType?: 'ANIME' | 'MANGA';
  status?: string;
  format?: string;
  limit?: number;
  sort?: string;
  search?: string;
  [key: string]: unknown;
}

interface MediaTitle {
  romaji?: string;
  english?: string;
  native?: string;
}

interface Media {
  id: number;
  title: MediaTitle;
  format?: string;
  episodes?: number;
  chapters?: number;
  genres?: string[];
  [key: string]: unknown;
}

interface MediaEntry {
  media: Media;
  id: number;
  title?: MediaTitle;
  status: string;
  progress?: number;
  score?: number;
  mediaType?: 'ANIME' | 'MANGA';
  [key: string]: unknown;
}

interface MediaItem {
  id: number;
  title: MediaTitle;
  format?: string;
  episodes?: number;
  chapters?: number;
  genres?: string[];
  status?: string;
  progress?: number;
  score?: number;
  mediaType?: 'ANIME' | 'MANGA';
  [key: string]: unknown;
}

interface MediaListItem {
  id: number;
  title: MediaTitle;
  status: string;
  progress?: number;
  score?: number;
  [key: string]: unknown;
}

interface MediaStatistics {
  count: number;
  meanScore: number;
  [key: string]: unknown;
}

interface UserStatistics {
  anime: MediaStatistics;
  manga: MediaStatistics;
  [key: string]: unknown;
}

interface User {
  id: number;
  name: string;
  statistics: UserStatistics;
  [key: string]: unknown;
}

interface UserStats {
  id: number;
  name: string;
  statistics?: UserStatistics;
  [key: string]: unknown;
}

interface ScoreCount {
  score: number;
  count: number;
}

interface YearCount {
  year: number;
  count: number;
  releaseYear: number;
}

interface StatsOptions {
  showInsights?: boolean;
  showBreakdowns?: boolean;
  showFavorites?: boolean;
  showComparisons?: boolean;
  mediaType?: 'ANIME' | 'MANGA';
  [key: string]: unknown;
}

interface OverviewOptions {
  showComparisons: boolean;
  [key: string]: unknown;
}

interface MediaListOptions {
  scoreFormat?: 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5';
  [key: string]: unknown;
}

interface ListOptions {
  scoreFormat?: 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5';
  [key: string]: unknown;
}

interface ObsidianElementAttributes {
  cls?: string;
  text?: string;
  href?: string;
  target?: string;
  [key: string]: string | number | boolean | undefined;
}

interface ObsidianHTMLElement extends HTMLElement {
  createEl(tag: string, attr?: ObsidianElementAttributes, callback?: (el: HTMLElement) => void): HTMLElement;
  empty?(): void;
}

// Unified ParentRenderer interface that satisfies all renderers
interface ParentRenderer {
  plugin: Plugin & {
    settings: {
      // Common settings for all renderers
      showProgress: boolean;
      showRatings: boolean;
      showGenres: boolean;
      showCoverImages: boolean;
      hideUrlsInTitles: boolean;
      malAccessToken?: string;
      accessToken?: string;
      gridColumns?: string | number;
      simklUserInfo?: {
        account?: {
          id: string;
        };
      };
    };
    // Methods required by various renderers
    getMALUrl(id: number | string, mediaType: string): string;
    getAniListUrl(id: number | string, mediaType: string): string;
    handleEditClick(event: MouseEvent, entry: MediaEntry, element: HTMLElement, config: RenderConfig): void;
    renderError(el: HTMLElement, message: string): void;
    // Connected notes functionality
    connectedNotes: {
      openSidePanelWithContext(context: {
        media: Media;
        entry: MediaEntry;
        source: string;
        mediaType: string;
      }): Promise<void>;
      createConnectedNotesButton(media: Media, entry: MediaEntry, config: RenderConfig): HTMLElement;
      [key: string]: unknown;
    };
    // Cache functionality
    cache: {
      [key: string]: unknown;
    };
  };
  apiHelper: APISourceHelper;
  formatter: FormatterHelper;
}

export class Render implements ParentRenderer {
  public plugin: Plugin & {
    settings: {
      showProgress: boolean;
      showRatings: boolean;
      showGenres: boolean;
      showCoverImages: boolean;
      hideUrlsInTitles: boolean;
      malAccessToken?: string;
      accessToken?: string;
      gridColumns?: string | number;
      simklUserInfo?: {
        account?: {
          id: string;
        };
      };
    };
    getMALUrl(id: number | string, mediaType: string): string;
    getAniListUrl(id: number | string, mediaType: string): string;
    handleEditClick(event: MouseEvent, entry: MediaEntry, element: HTMLElement, config: RenderConfig): void;
    renderError(el: HTMLElement, message: string): void;
    connectedNotes: {
      openSidePanelWithContext(context: {
        media: Media;
        entry: MediaEntry;
        source: string;
        mediaType: string;
      }): Promise<void>;
      createConnectedNotesButton(media: Media, entry: MediaEntry, config: RenderConfig): HTMLElement;
      [key: string]: unknown;
    };
    cache: {
      [key: string]: unknown;
    };
  };
  public apiHelper: APISourceHelper;
  public formatter: FormatterHelper;
  private cardRenderer: CardRenderer;
  private searchRenderer: SearchRenderer;
  private tableRenderer: TableRenderer;
  private mediaListRenderer: MediaListRenderer;
  private statsRenderer: StatsRenderer;

  constructor(plugin: Plugin) {
    // Create a proxy plugin that implements all required methods with fallbacks
    this.plugin = new Proxy(plugin as any, {
      get(target, prop) {
        if (prop === 'settings') {
          return {
            showProgress: target.settings?.showProgress ?? true,
            showRatings: target.settings?.showRatings ?? true,
            showGenres: target.settings?.showGenres ?? true,
            showCoverImages: target.settings?.showCoverImages ?? true,
            hideUrlsInTitles: target.settings?.hideUrlsInTitles ?? false,
            malAccessToken: target.settings?.malAccessToken,
            accessToken: target.settings?.accessToken,
            gridColumns: target.settings?.gridColumns ?? 3,
            simklUserInfo: target.settings?.simklUserInfo
          };
        }
        if (prop === 'renderError') {
          return target.renderError || ((el: HTMLElement, message: string) => {
            el.innerHTML = `<div class="zoro-error">${message}</div>`;
          });
        }
        if (prop === 'connectedNotes') {
          return target.connectedNotes || {
            openSidePanelWithContext: async () => {},
            createConnectedNotesButton: () => document.createElement('div')
          };
        }
        if (prop === 'cache') {
          return target.cache || {};
        }
        return target[prop];
      }
    });
    
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

  renderSearchInterface(el: HTMLElement, config: RenderConfig): void {
    return this.searchRenderer.render(el, config);
  }

  renderMediaList(el: HTMLElement, entries: MediaEntry[], config: RenderConfig): void {
    // Convert entries to ensure they match expected interface
    const validEntries = entries.map(entry => ({
      ...entry,
      status: entry.status || 'UNKNOWN'
    }));
    return this.mediaListRenderer.render(el, validEntries, config);
  }

  renderSearchResults(el: HTMLElement, media: MediaEntry[], config: RenderConfig): void {
    // Convert MediaEntry[] to MediaItem[]
    const mediaItems: MediaItem[] = media.map(entry => ({
      id: entry.id || entry.media.id,
      title: entry.title || entry.media.title,
      format: entry.media.format,
      episodes: entry.media.episodes,
      chapters: entry.media.chapters,
      genres: entry.media.genres,
      status: entry.status,
      progress: entry.progress,
      score: entry.score,
      mediaType: entry.mediaType
    }));
    return this.searchRenderer.renderSearchResults(el, mediaItems, config);
  }

  renderTableLayout(el: HTMLElement, entries: MediaEntry[], config: RenderConfig): void {
    // Convert entries to ensure they have the required properties
    const validEntries = entries.map(entry => ({
      ...entry,
      media: entry.media || {
        id: entry.id || 0,
        title: entry.title || { romaji: 'Unknown', english: 'Unknown' }
      },
      status: entry.status || 'UNKNOWN'
    }));
    
    // Ensure config has proper source type
    const validConfig: RenderConfig = {
      ...config,
      source: (config.source === 'anilist' || config.source === 'mal') ? config.source : 'anilist'
    };
    
    return this.tableRenderer.render(el, validEntries, validConfig);
  }

  renderSingleMedia(el: HTMLElement, mediaList: MediaEntry[], config: RenderConfig): void {
    // Convert MediaEntry[] to MediaListItem - create a proxy that matches both interfaces
    const mediaListItem = new Proxy(mediaList[0] || {}, {
      get(target, prop) {
        if (prop === 'id') return target.id || 0;
        if (prop === 'title') return target.title || target.media?.title || { romaji: 'Unknown' };
        if (prop === 'status') return target.status || 'UNKNOWN';
        if (prop === 'progress') return target.progress;
        if (prop === 'score') return target.score;
        return target[prop];
      }
    }) as MediaListItem;
    
    return this.mediaListRenderer.renderSingle(el, mediaListItem, config);
  }

  renderUserStats(el: HTMLElement, user: UserStats, options: StatsOptions = {}): void {
    // Convert UserStats to User
    const userCompat: User = {
      ...user,
      statistics: user.statistics || {
        anime: { count: 0, meanScore: 0 },
        manga: { count: 0, meanScore: 0 }
      }
    };
    return this.statsRenderer.render(el, userCompat, options);
  }

  renderMediaListChunked(el: HTMLElement, entries: MediaEntry[], config: RenderConfig, chunkSize: number = 20): HTMLElement {
    // Convert entries to ensure they have the required properties
    const validEntries = entries.map(entry => ({
      ...entry,
      media: entry.media || {
        id: entry.id || 0,
        title: entry.title || { romaji: 'Unknown', english: 'Unknown' }
      },
      status: entry.status || 'UNKNOWN'
    }));
    this.mediaListRenderer.renderChunked(el, validEntries, config, chunkSize);
    return el; // Return the element since the method expects HTMLElement
  }

  createMediaCard(data: Media | MediaEntry, config: RenderConfig, options: Record<string, unknown> = {}): HTMLElement {
    // Ensure data has the right structure
    let mediaData: Media;
    if ('media' in data && data.media) {
      mediaData = {
        id: data.media.id,
        title: data.media.title,
        ...data.media
      };
    } else if ('title' in data && data.title && 'id' in data && data.id) {
      // Data is already Media type
      mediaData = data as Media;
    } else {
      // Create fallback Media object
      mediaData = {
        id: (data as any).id || 0,
        title: (data as any).title || { romaji: 'Unknown', english: 'Unknown' }
      };
    }
    return this.cardRenderer.createMediaCard(mediaData, config, options);
  }

  // ========== SKELETON CREATION METHODS ==========
  
  createListSkeleton(count: number = 6): DocumentFragment {
    return DOMHelper.createListSkeleton(count);
  }

  createStatsSkeleton(): HTMLElement {
    return DOMHelper.createStatsSkeleton();
  }

  createSearchSkeleton(): HTMLElement {
    return DOMHelper.createSearchSkeleton();
  }

  // ========== EVENT HANDLING METHODS ==========
  
  attachEventListeners(card: HTMLElement, entry: MediaEntry, media: MediaEntry, config: RenderConfig): void {
    const statusBadge = card.querySelector('.clickable-status[data-entry-id]') as HTMLElement;
    if (statusBadge) {
      statusBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleStatusClick(e, entry, statusBadge, config);
      };
    }
    
    const addBtn = card.querySelector('.clickable-status[data-media-id]') as HTMLElement;
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleAddClick(e, media, config);
      };
    }
  }

  handleStatusClick(e: MouseEvent, entry: MediaEntry, badge: HTMLElement, config: RenderConfig = {}): void {
    // Ensure entry has the required structure
    const validEntry = {
      ...entry,
      media: entry.media || {
        id: entry.id || 0,
        title: entry.title || { romaji: 'Unknown', english: 'Unknown' }
      },
      status: entry.status || 'UNKNOWN'
    };
    return this.cardRenderer.handleStatusClick(e, validEntry, badge, config);
  }

  handleAddClick(e: MouseEvent, media: MediaEntry, config: RenderConfig, element?: HTMLElement, callback?: () => void): Promise<void> {
    // Convert MediaEntry to Media for CardRenderer
    const mediaData: Media = {
      id: media.id || media.media.id,
      title: media.title || media.media.title,
      format: media.media.format,
      episodes: media.media.episodes,
      chapters: media.media.chapters,
      genres: media.media.genres
    };
    // CardRenderer expects (e, media, entry, config, element)
    return this.cardRenderer.handleAddClick(e, mediaData, media, config, element);
  }

  // ========== UTILITY METHODS ==========
  
  clear(el: HTMLElement & { empty?: () => void }): void { 
    el.empty?.(); 
  }

  refreshActiveViews(): void {
    if (this.plugin && 'refreshActiveViews' in this.plugin && typeof (this.plugin as any).refreshActiveViews === 'function') {
      (this.plugin as any).refreshActiveViews();
    }
  }

  getAniListUrl(id: number, mediaType: 'ANIME' | 'MANGA'): string {
    if (this.plugin && 'getAniListUrl' in this.plugin && typeof (this.plugin as any).getAniListUrl === 'function') {
      return (this.plugin as any).getAniListUrl(id, mediaType);
    }
    return '';
  }

  getMALUrl(id: number, mediaType: 'ANIME' | 'MANGA'): string {
    if (this.plugin && 'getMALUrl' in this.plugin && typeof (this.plugin as any).getMALUrl === 'function') {
      return (this.plugin as any).getMALUrl(id, mediaType);
    }
    return '';
  }

  getSourceSpecificUrl(id: number | string, mediaType: 'ANIME' | 'MANGA', source: string): string {
    return this.apiHelper.getSourceSpecificUrl(id, mediaType, source) ?? '';
  }

  renderError(el: HTMLElement | { innerHTML?: string; createDiv?: (options: { cls: string }) => HTMLElement }, message: string): void {
    if ('innerHTML' in el && el.innerHTML !== undefined) {
      el.innerHTML = DOMHelper.createErrorMessage(message);
    } else if ('createDiv' in el && typeof el.createDiv === 'function') {
      const errorDiv = el.createDiv({ cls: 'zoro-error' });
      errorDiv.textContent = message;
    }
  }

  // ========== STATS RENDERING HELPER METHODS ==========
  
  renderStatsError(el: HTMLElement, message: string): void {
    return this.statsRenderer.renderError(el, message);
  }

  renderStatsHeader(fragment: DocumentFragment, user: UserStats): void {
    const userCompat: User = {
      ...user,
      statistics: {
        anime: user.statistics?.anime as MediaStatistics || { count: 0, meanScore: 0 },
        manga: user.statistics?.manga as MediaStatistics || { count: 0, meanScore: 0 }
      }
    };
    return this.statsRenderer.renderHeader(fragment, userCompat);
  }

  renderStatsOverview(fragment: DocumentFragment, user: UserStats, options: StatsOptions): void {
    const userCompat: User = {
      ...user,
      statistics: {
        anime: user.statistics?.anime as MediaStatistics || { count: 0, meanScore: 0 },
        manga: user.statistics?.manga as MediaStatistics || { count: 0, meanScore: 0 }
      }
    };
    const overviewOptions: OverviewOptions = {
      showComparisons: options.showComparisons ?? true,
      ...options
    };
    return this.statsRenderer.renderOverview(fragment, userCompat, overviewOptions);
  }

  renderMediaTypeCard(container: HTMLElement, type: 'ANIME' | 'MANGA', stats: unknown, listOptions: ListOptions): void {
    const validStats: MediaStatistics = {
      count: (stats as any)?.count || 0,
      meanScore: (stats as any)?.meanScore || 0,
      ...(stats as any)
    };
    return this.statsRenderer.renderMediaTypeCard(container, type, validStats, listOptions as MediaListOptions);
  }

  renderComparisonCard(container: HTMLElement, animeStats: unknown, mangaStats: unknown): void {
    const validAnimeStats: MediaStatistics = {
      count: (animeStats as any)?.count || 0,
      meanScore: (animeStats as any)?.meanScore || 0,
      ...(animeStats as any)
    };
    const validMangaStats: MediaStatistics = {
      count: (mangaStats as any)?.count || 0,
      meanScore: (mangaStats as any)?.meanScore || 0,
      ...(mangaStats as any)
    };
    return this.statsRenderer.renderComparisonCard(container, validAnimeStats, validMangaStats);
  }

  renderStatsBreakdowns(fragment: DocumentFragment, user: UserStats, mediaType: 'ANIME' | 'MANGA'): void {
    const userCompat: User = {
      ...user,
      statistics: {
        anime: user.statistics?.anime as MediaStatistics || { count: 0, meanScore: 0 },
        manga: user.statistics?.manga as MediaStatistics || { count: 0, meanScore: 0 }
      }
    };
    return this.statsRenderer.renderBreakdowns(fragment, userCompat, mediaType);
  }

  renderStatsInsights(fragment: DocumentFragment, user: UserStats, mediaType: 'ANIME' | 'MANGA'): void {
    const userCompat: User = {
      ...user,
      statistics: {
        anime: user.statistics?.anime as MediaStatistics || { count: 0, meanScore: 0 },
        manga: user.statistics?.manga as MediaStatistics || { count: 0, meanScore: 0 }
      }
    };
    return this.statsRenderer.renderInsights(fragment, userCompat, mediaType);
  }

  renderStatsFavorites(fragment: DocumentFragment, user: UserStats, mediaType: 'ANIME' | 'MANGA'): void {
    const userCompat: User = {
      ...user,
      statistics: {
        anime: user.statistics?.anime as MediaStatistics || { count: 0, meanScore: 0 },
        manga: user.statistics?.manga as MediaStatistics || { count: 0, meanScore: 0 }
      }
    };
    return this.statsRenderer.renderFavorites(fragment, userCompat, mediaType);
  }

  renderBreakdownChart(container: HTMLElement, title: string, data: unknown[], keyField: string, options: Record<string, unknown> = {}): void {
    return this.statsRenderer.renderBreakdownChart(container, title, data, keyField, options);
  }

  renderScoreDistribution(container: HTMLElement, scores: unknown[], listOptions: ListOptions): void {
    const validScores: ScoreCount[] = (scores as any[]).map(score => ({
      score: score?.score || 0,
      count: score?.count || 0
    }));
    return this.statsRenderer.renderScoreDistribution(container, validScores, listOptions as MediaListOptions);
  }

  renderYearlyActivity(container: HTMLElement, yearData: unknown): void {
    const validYearData: YearCount[] = Array.isArray(yearData) 
      ? (yearData as any[]).map(item => ({
          year: item?.year || 0,
          count: item?.count || 0,
          releaseYear: item?.releaseYear || item?.year || 0
        }))
      : [];
    return this.statsRenderer.renderYearlyActivity(container, validYearData);
  }

  addSecondaryMetric(container: HTMLElement, label: string, value: string | number): void {
    return DOMHelper.addSecondaryMetric(container, label, value);
  }

  formatScore(score: number, scoreFormat: 'POINT_100' | 'POINT_10' | 'POINT_5' = 'POINT_10'): string {
    return this.formatter.formatScore(score, scoreFormat as unknown as any);
  }

  formatWatchTime(minutes: number): string {
    return this.formatter.formatWatchTime(minutes);
  }

  generateInsights(stats: unknown, type: 'ANIME' | 'MANGA', user: UserStats): unknown {
    const validStats: MediaStatistics = {
      count: (stats as any)?.count || 0,
      meanScore: (stats as any)?.meanScore || 0,
      ...(stats as any)
    };
    const userCompat: User = {
      ...user,
      statistics: {
        anime: user.statistics?.anime as MediaStatistics || { count: 0, meanScore: 0 },
        manga: user.statistics?.manga as MediaStatistics || { count: 0, meanScore: 0 }
      }
    };
    return this.statsRenderer.generateInsights(validStats, type, userCompat);
  }
}