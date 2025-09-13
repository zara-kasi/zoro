/**
 * Render - Main rendering orchestrator
 * Migrated from Render.js → Render.ts
 * - Added Plugin typing from obsidian
 * - Typed method parameters and return values
 * - Added interfaces for config objects and media data
 */
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

interface MediaEntry {
  id: number;
  title?: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  status?: string;
  mediaType?: 'ANIME' | 'MANGA';
  [key: string]: unknown; // Allow additional media properties
}

interface UserStats {
  id: number;
  name: string;
  statistics?: {
    anime?: unknown;
    manga?: unknown;
  };
  [key: string]: unknown;
}

interface StatsOptions {
  showInsights?: boolean;
  showBreakdowns?: boolean;
  showFavorites?: boolean;
  mediaType?: 'ANIME' | 'MANGA';
  [key: string]: unknown;
}

interface ListOptions {
  scoreFormat?: 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5' | 'POINT_3';
  [key: string]: unknown;
}

class Render {
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
    return this.tableRenderer.render(el, entries, config);
  }

  renderSingleMedia(el: HTMLElement, mediaList: MediaEntry[], config: RenderConfig): void {
    return this.mediaListRenderer.renderSingle(el, mediaList, config);
  }

  renderUserStats(el: HTMLElement, user: UserStats, options: StatsOptions = {}): void {
    return this.statsRenderer.render(el, user, options);
  }

  renderMediaListChunked(el: HTMLElement, entries: MediaEntry[], config: RenderConfig, chunkSize: number = 20): void {
    return this.mediaListRenderer.renderChunked(el, entries, config, chunkSize);
  }

  createMediaCard(data: MediaEntry, config: RenderConfig, options: Record<string, unknown> = {}): HTMLElement {
    return this.cardRenderer.createMediaCard(data, config, options);
  }

  // ========== SKELETON CREATION METHODS - UNCHANGED ==========
  
  createListSkeleton(count: number = 6): HTMLElement {
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

  handleStatusClick(e: Event, entry: MediaEntry, badge: HTMLElement, config: RenderConfig = {}): void {
    return this.cardRenderer.handleStatusClick(e, entry, badge, config);
  }

  handleAddClick(e: Event, media: MediaEntry, config: RenderConfig): void {
    return this.cardRenderer.handleAddClick(e, media, config);
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

  getSourceSpecificUrl(id: number, mediaType: 'ANIME' | 'MANGA', source: string): string {
    return this.apiHelper.getSourceSpecificUrl(id, mediaType, source);
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
    return this.statsRenderer.renderHeader(fragment, user);
  }

  renderStatsOverview(fragment: DocumentFragment, user: UserStats, options: StatsOptions): void {
    return this.statsRenderer.renderOverview(fragment, user, options);
  }

  renderMediaTypeCard(container: HTMLElement, type: 'ANIME' | 'MANGA', stats: unknown, listOptions: ListOptions): void {
    return this.statsRenderer.renderMediaTypeCard(container, type, stats, listOptions);
  }

  renderComparisonCard(container: HTMLElement, animeStats: unknown, mangaStats: unknown): void {
    return this.statsRenderer.renderComparisonCard(container, animeStats, mangaStats);
  }

  renderStatsBreakdowns(fragment: DocumentFragment, user: UserStats, mediaType: 'ANIME' | 'MANGA'): void {
    return this.statsRenderer.renderBreakdowns(fragment, user, mediaType);
  }

  renderStatsInsights(fragment: DocumentFragment, user: UserStats, mediaType: 'ANIME' | 'MANGA'): void {
    return this.statsRenderer.renderInsights(fragment, user, mediaType);
  }

  renderStatsFavorites(fragment: DocumentFragment, user: UserStats, mediaType: 'ANIME' | 'MANGA'): void {
    return this.statsRenderer.renderFavorites(fragment, user, mediaType);
  }

  renderBreakdownChart(container: HTMLElement, title: string, data: unknown[], keyField: string, options: Record<string, unknown> = {}): void {
    return this.statsRenderer.renderBreakdownChart(container, title, data, keyField, options);
  }

  renderScoreDistribution(container: HTMLElement, scores: unknown[], listOptions: ListOptions): void {
    return this.statsRenderer.renderScoreDistribution(container, scores, listOptions);
  }

  renderYearlyActivity(container: HTMLElement, yearData: unknown): void {
    return this.statsRenderer.renderYearlyActivity(container, yearData);
  }

  addSecondaryMetric(container: HTMLElement, label: string, value: string | number): void {
    return DOMHelper.addSecondaryMetric(container, label, value);
  }

  formatScore(score: number, scoreFormat: 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5' | 'POINT_3' = 'POINT_10'): string {
    return this.formatter.formatScore(score, scoreFormat);
  }

  formatWatchTime(minutes: number): string {
    return this.formatter.formatWatchTime(minutes);
  }

  generateInsights(stats: unknown, type: 'ANIME' | 'MANGA', user: UserStats): unknown {
    return this.statsRenderer.generateInsights(stats, type, user);
  }
}

export { Render };
