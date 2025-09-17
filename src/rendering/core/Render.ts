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
  source?: string;
  mediaType?: 'ANIME' | 'MANGA';
  status?: string;
  format?: string;
  limit?: number;
  sort?: string;
  search?: string;
  [key: string]: unknown; // Allow additional config properties
}

interface MediaTitle {
  romaji?: string;
  english?: string;
  native?: string;
}

interface Media {
  id: number; // Keep as number for compatibility with other renderers
  title: MediaTitle;
  format?: string;
  episodes?: number;
  chapters?: number;
  genres?: string[];
  [key: string]: unknown;
}

interface MediaEntry {
  media: Media; // Required for compatibility with other renderers
  id?: number;
  title?: MediaTitle;
  status?: string;
  progress?: number;
  score?: number;
  mediaType?: 'ANIME' | 'MANGA';
  [key: string]: unknown;
}

interface MediaStatistics {
  count: number;
  meanScore: number;
  [key: string]: unknown;
}

interface UserStatistics {
  anime?: MediaStatistics;
  manga?: MediaStatistics;
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
  releaseYear: number; // Added required property
}

interface StatsOptions {
  showInsights?: boolean;
  showBreakdowns?: boolean;
  showFavorites?: boolean;
  mediaType?: 'ANIME' | 'MANGA';
  [key: string]: unknown;
}

interface MediaListOptions {
  scoreFormat?: 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5'; // Removed POINT_3
  [key: string]: unknown;
}

interface ListOptions {
  scoreFormat?: 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5'; // Removed POINT_3
  [key: string]: unknown;
}

// Obsidian-specific element interface
interface ObsidianElementAttributes {
  cls?: string;
  text?: string;
  href?: string;
  target?: string;
  [key: string]: unknown;
}

interface ObsidianHTMLElement extends HTMLElement {
  createEl(tag: string, attr?: ObsidianElementAttributes, callback?: (el: HTMLElement) => void): HTMLElement;
  empty?(): void;
}

export class Render {
  private plugin: Plugin;
  private apiHelper: APISourceHelper;
  private formatter: FormatterHelper;
  private cardRenderer: CardRenderer;
  private searchRenderer: SearchRenderer;
  private tableRenderer: TableRenderer;
  private mediaListRenderer: MediaListRenderer;
  private statsRenderer: StatsRenderer;

  constructor(plugin: Plugin) {
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

  renderSearchInterface(el: HTMLElement, config: RenderConfig): void {
    return this.searchRenderer.render(el, config);
  }

  renderMediaList(el: HTMLElement, entries: MediaEntry[], config: RenderConfig): void {
    return this.mediaListRenderer.render(el, entries, config);
  }

  renderSearchResults(el: HTMLElement, media: MediaEntry[], config: RenderConfig): void {
    return this.searchRenderer.renderSearchResults(el, media, config);
  }

  renderTableLayout(el: HTMLElement, entries: MediaEntry[], config: RenderConfig): void {
    // Convert entries to ensure they have the required media property
    const validEntries = entries.map(entry => ({
      ...entry,
      media: entry.media || {
        id: entry.id || 0,
        title: entry.title || { romaji: 'Unknown', english: 'Unknown' },
        format: 'UNKNOWN',
        episodes: 0,
        chapters: 0,
        genres: []
      }
    }));
    return this.tableRenderer.render(el, validEntries, config);
  }

  renderSingleMedia(el: HTMLElement, mediaList: MediaEntry[], config: RenderConfig): void {
    return this.mediaListRenderer.renderSingle(el, mediaList, config);
  }

  renderUserStats(el: HTMLElement, user: UserStats, options: StatsOptions = {}): void {
    return this.statsRenderer.render(el, user, options);
  }

  renderMediaListChunked(el: HTMLElement, entries: MediaEntry[], config: RenderConfig, chunkSize: number = 20): HTMLElement {
    // Convert entries to ensure they have the required media property
    const validEntries = entries.map(entry => ({
      ...entry,
      media: entry.media || {
        id: entry.id || 0,
        title: entry.title || { romaji: 'Unknown', english: 'Unknown' },
        format: 'UNKNOWN',
        episodes: 0,
        chapters: 0,
        genres: []
      }
    }));
    return this.mediaListRenderer.renderChunked(el, validEntries, config, chunkSize);
  }

  createMediaCard(data: Media | MediaEntry, config: RenderConfig, options: Record<string, unknown> = {}): HTMLElement {
    // Ensure data has the right structure
    let mediaData: Media;
    if ('media' in data && data.media) {
      mediaData = data.media;
    } else {
      // Convert MediaEntry or unknown structure to Media
      mediaData = {
        id: (data as any).id || 0,
        title: (data as any).title || { romaji: 'Unknown', english: 'Unknown' },
        format: (data as any).format || 'UNKNOWN',
        episodes: (data as any).episodes || 0,
        chapters: (data as any).chapters || 0,
        genres: (data as any).genres || []
      };
    }
    return this.cardRenderer.createMediaCard(mediaData, config, options);
  }

  // ========== SKELETON CREATION METHODS - UNCHANGED ==========
  
  createListSkeleton(count: number = 6): DocumentFragment {
    return DOMHelper.createListSkeleton(count);
  }

  createStatsSkeleton(): HTMLElement {
    return DOMHelper.createStatsSkeleton();
  }

  createSearchSkeleton(): HTMLElement {
    return DOMHelper.createSearchSkeleton();
  }

  // ========== EVENT HANDLING METHODS - UNCHANGED ==========
  
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
    // Ensure entry has the required structure for CardRenderer
    const validEntry = {
      ...entry,
      media: entry.media || {
        id: entry.id || 0,
        title: entry.title || { romaji: 'Unknown', english: 'Unknown' },
        format: 'UNKNOWN',
        episodes: 0,
        chapters: 0,
        genres: []
      }
    };
    return this.cardRenderer.handleStatusClick(e, validEntry, badge, config);
  }

  handleAddClick(e: MouseEvent, media: MediaEntry, config: RenderConfig, element?: HTMLElement, callback?: () => void): Promise<void> {
    return this.cardRenderer.handleAddClick(e, media, config, element, callback);
  }

  // ========== UTILITY METHODS - UNCHANGED ==========
  
  clear(el: HTMLElement & { empty?: () => void }): void { 
    el.empty?.(); 
  }

  // Method to refresh active views (used by card renderer)
  refreshActiveViews(): void {
    // This method should trigger refresh of any active views
    // Implementation depends on your plugin's architecture
    if (this.plugin && 'refreshActiveViews' in this.plugin && typeof (this.plugin as any).refreshActiveViews === 'function') {
      (this.plugin as any).refreshActiveViews();
    }
  }

  // ========== MISSING UTILITY METHODS FROM ORIGINAL ==========
  
  // URL generation methods that might be called from outside
  getAniListUrl(id: number, mediaType: 'ANIME' | 'MANGA'): string {
    if (this.plugin && 'getAniListUrl' in this.plugin && typeof (this.plugin as any).getAniListUrl === 'function') {
      return (this.plugin as any).getAniListUrl(id, mediaType);
    }
    // TODO: confirm plugin method signature
    return '';
  }

  getMALUrl(id: number, mediaType: 'ANIME' | 'MANGA'): string {
    if (this.plugin && 'getMALUrl' in this.plugin && typeof (this.plugin as any).getMALUrl === 'function') {
      return (this.plugin as any).getMALUrl(id, mediaType);
    }
    // TODO: confirm plugin method signature
    return '';
  }

  getSourceSpecificUrl(id: number | string, mediaType: 'ANIME' | 'MANGA', source: string): string {
    return this.apiHelper.getSourceSpecificUrl(id, mediaType, source) ?? '';
  }

  // Error rendering (might be called from outside)
  renderError(el: HTMLElement | { innerHTML?: string; createDiv?: (options: { cls: string }) => HTMLElement }, message: string): void {
    if ('innerHTML' in el && el.innerHTML !== undefined) {
      el.innerHTML = DOMHelper.createErrorMessage(message);
    } else if ('createDiv' in el && typeof el.createDiv === 'function') {
      const errorDiv = el.createDiv({ cls: 'zoro-error' });
      errorDiv.textContent = message;
    }
  }

  // ========== STATS RENDERING HELPER METHODS - DELEGATED ==========
  
  renderStatsError(el: HTMLElement, message: string): void {
    return this.statsRenderer.renderError(el, message);
  }

  renderStatsHeader(fragment: DocumentFragment, user: UserStats): void {
    // Convert UserStats to User for compatibility
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
    // Convert UserStats to User for compatibility
    const userCompat: User = {
      ...user,
      statistics: {
        anime: user.statistics?.anime as MediaStatistics || { count: 0, meanScore: 0 },
        manga: user.statistics?.manga as MediaStatistics || { count: 0, meanScore: 0 }
      }
    };
    return this.statsRenderer.renderOverview(fragment, userCompat, options);
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
    // Convert UserStats to User for compatibility
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
    // Convert UserStats to User for compatibility
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
    // Convert UserStats to User for compatibility
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
    return DOMHelper.addSecondaryMetric(container as ObsidianHTMLElement, label, value);
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
    return this.statsRenderer.generateInsights(validStats, type, user);
  }
}