/**
 * main.ts - Zoro Plugin Entry Point
 * Migrated from index.js → main.ts
 * - Updated all imports to TypeScript (.ts extensions)
 * - Added strict typing for plugin components and settings
 * - Preserved all runtime behavior and OAuth handling
 */

import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';

import { Cache } from './cache/Cache';
import { RequestQueue } from './api/requests/RequestQueue';
import { AnilistApi } from './api/services/AnilistApi';
import { MalApi } from './api/services/MalApi';
import { SimklApi } from './api/services/SimklApi';

import { Authentication } from './auth/Authentication';
import { MALAuthentication } from './auth/MALAuthentication';
import { SimklAuthentication } from './auth/SimklAuthentication';

import { Theme } from './features/Theme';
import { Processor } from './processing/Processor';
import { Edit } from './editing/Edit';
import { MoreDetailsPanel } from './details/MoreDetailsPanel';
import { Export } from './features/Export';
import { Sample } from './features/Sample';
import { Prompt } from './features/Prompt';

import { Render } from './rendering/core/Render';
import { EmojiIconMapper } from './rendering/helpers/EmojiIconMapper';
import { ConnectedNotes } from './features/ConnectedNotes';
import { SidePanel, ZORO_VIEW_TYPE } from './ui/SidePanel';

import { DEFAULT_SETTINGS, GRID_COLUMN_OPTIONS, GRID_COLUMN_LABELS } from './core/constants';
import { ZoroSettingTab } from './settings/ZoroSettingTab';

// Type definitions for plugin components
interface GlobalListener {
  el: HTMLElement;
  type: string;
  fn: EventListener;
}

interface ZoroSettings {
  defaultApiSource: 'anilist' | 'mal' | 'simkl';
  defaultApiUserOverride: boolean;
  defaultUsername: string;
  defaultLayout: 'card' | 'table';
  notePath: string;
  insertCodeBlockOnNote: boolean;
  showCoverImages: boolean;
  showRatings: boolean;
  showProgress: boolean;
  showGenres: boolean;
  showLoadingIcon: boolean;
  gridColumns: string;
  hideUrlsInTitles: boolean;
  forceScoreFormat: boolean;
  showAvatar: boolean;
  showFavorites: boolean;
  showBreakdowns: boolean;
  showTimeStats: boolean;
  statsLayout: 'enhanced' | 'compact' | 'minimal';
  statsTheme: 'auto' | 'light' | 'dark';
  clientId: string;
  clientSecret: string;
  accessToken: string;
  anilistUsername: string;
  malClientId: string;
  malClientSecret: string;
  malAccessToken: string;
  malRefreshToken: string;
  malTokenExpiry: number | null;
  malUserInfo: Record<string, unknown> | null;
  simklClientId: string;
  simklClientSecret: string;
  simklAccessToken: string;
  simklUserInfo: Record<string, unknown> | null;
  autoFormatSearchUrls: boolean;
  customSearchUrls: {
    ANIME: string[];
    MANGA: string[];
    MOVIE_TV: string[];
  };
  customPropertyNames: Record<string, string>;
}

interface OAuthParams {
  state?: string;
  code?: string;
  [key: string]: unknown;
}

interface ZoroMeta {
  source?: string;
  mediaType?: string;
}

interface MediaEntry {
  media?: unknown;
  _zoroMeta?: ZoroMeta;
  [key: string]: unknown;
}

interface EditConfig {
  source?: string;
  mediaType?: string;
}

class ZoroPlugin extends Plugin {
  public settings!: ZoroSettings;
  public globalListeners: GlobalListener[] = [];
  
  // Core services
  public cache: Cache;
  public requestQueue: RequestQueue;
  public api: AnilistApi;
  public auth: Authentication;
  public malAuth: MALAuthentication;
  public malApi: MalApi;
  public simklAuth: SimklAuthentication;
  public simklApi: SimklApi;
  
  // Features
  public theme: Theme;
  public processor: Processor;
  public edit: Edit;
  public moreDetailsPanel: MoreDetailsPanel;
  public export: Export;
  public sample: Sample;
  public prompt: Prompt;
  
  // Rendering and UI
  public render!: Render; // Initialized in onload
  public emojiMapper!: EmojiIconMapper; // Initialized in onload
  public connectedNotes!: ConnectedNotes; // Initialized in onload
  public globalLoader!: HTMLElement; // Initialized in injectCSS

  constructor(app: any, manifest: any) {
    super(app, manifest);
    
    // Initialize core services
    this.cache = new Cache({ obsidianPlugin: this });
    this.requestQueue = new RequestQueue(this);
    this.api = new AnilistApi(this);
    this.auth = new Authentication(this);
    this.malAuth = new MALAuthentication(this);
    this.malApi = new MalApi(this);
    this.simklAuth = new SimklAuthentication(this);
    this.simklApi = new SimklApi(this);
    
    // Initialize features
    this.theme = new Theme(this);
    this.processor = new Processor(this);
    this.edit = new Edit(this);
    this.moreDetailsPanel = new MoreDetailsPanel(this);
    this.export = new Export(this);
    this.sample = new Sample(this);
    this.prompt = new Prompt(this);
  }

  renderError(el: HTMLElement, message: string, context = '', onRetry: (() => void) | null = null): void {
    el.empty?.();
    el.classList.add('zoro-error-container');

    const wrapper = el.createDiv({ cls: 'zoro-error-box' });
    wrapper.createEl('strong', { text: `❌ ${context || 'Something went wrong'}` });
    wrapper.createEl('pre', { text: message });

    if (onRetry) {
      const retryBtn = wrapper.createEl('button', { text: '🔄 Retry', cls: 'zoro-retry-btn' });
      retryBtn.onclick = () => {
        el.empty();
        onRetry();
      };
    } else if (this.app?.workspace?.activeLeaf?.rebuildView) {
      const reloadBtn = wrapper.createEl('button', { text: 'Reload Note', cls: 'zoro-retry-btn' });
      reloadBtn.onclick = () => this.app.workspace.activeLeaf.rebuildView();
    }
  }

  getAniListUrl(mediaId: string | number, mediaType: string = 'ANIME'): string {
    return this.api.getAniListUrl(mediaId, mediaType);
  }

  getMALUrl(mediaId: string | number, mediaType: string = 'ANIME'): string {
    return this.malApi.getMALUrl(mediaId, mediaType);
  }

  getSimklUrl(mediaId: string | number, mediaType: string = 'ANIME'): string {
    return this.simklApi.getSimklUrl(mediaId, mediaType);
  }

  getSourceSpecificUrl(mediaId: string | number, mediaType: string, source: string): string {
    const type = String(mediaType || '').toUpperCase();
    const numericId = Number(mediaId) || 0;

    switch ((source || '').toLowerCase()) {
      case 'mal':
        return this.getMALUrl(mediaId, mediaType);
      case 'simkl':
        return this.getSimklUrl(mediaId, mediaType);
      case 'anilist':
      default:
        return this.getAniListUrl(mediaId, mediaType);
    }
  }

  async updateDefaultApiSourceBasedOnAuth(): Promise<void> {
    try {
      if (this.settings.defaultApiUserOverride) return;
      
      const authenticated: string[] = [];
      if (this.settings.accessToken) authenticated.push('anilist');
      if (this.settings.malAccessToken) authenticated.push('mal');
      if (this.settings.simklAccessToken) authenticated.push('simkl');

      let newDefault = this.settings.defaultApiSource;
      if (authenticated.length === 1) {
        newDefault = authenticated[0] as 'anilist' | 'mal' | 'simkl';
      } else {
        newDefault = 'anilist';
      }

      if (newDefault !== this.settings.defaultApiSource) {
        this.settings.defaultApiSource = newDefault;
        await this.saveSettings();
      }
    } catch (e) {
      console.warn('[Zoro] Failed to update default API source automatically:', e);
    }
  }

  async onload(): Promise<void> {
    // Initialize remaining components that need plugin reference
    this.render = new Render(this);
    this.emojiMapper = new EmojiIconMapper();
    this.emojiMapper.init({ patchSettings: true, patchCreateEl: true, patchNotice: true });
    this.connectedNotes = new ConnectedNotes(this);
    
    try {
      await this.loadSettings();
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }

    await this.cache.loadFromDisk();
    this.cache.startAutoPrune(5 * 60 * 1000);

    try {
      this.injectCSS();
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }

    if (this.settings.theme) {
      await this.theme.applyTheme(this.settings.theme);
    }

    this.registerMarkdownCodeBlockProcessor('zoro', this.processor.processZoroCodeBlock.bind(this.processor));
    this.addSettingTab(new ZoroSettingTab(this.app, this));
    
    // Register custom URI handler for OAuth redirect
    this.registerObsidianProtocolHandler("zoro-auth", (params: OAuthParams) => {
      if (params.state && params.state.endsWith('_mal')) {
        // MAL callback
        this.malAuth.handleOAuthRedirect(params);
      } else {
        // AniList callback
        this.auth.handleOAuthRedirect(params);
      }
    });

    // Register Zoro side panel view
    this.registerView(ZORO_VIEW_TYPE, (leaf: WorkspaceLeaf) => new SidePanel(leaf, this));
    this.addCommand({
      id: 'zoro-open-panel',
      name: 'Open Zoro panel',
      callback: () => {
        const leaf = this.app.workspace.getRightLeaf(true);
        leaf.setViewState({ type: ZORO_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      }
    });
  }

  validateSettings(settings: Partial<ZoroSettings>): ZoroSettings {
    const s = settings || {};
    const def = DEFAULT_SETTINGS as ZoroSettings;

    // Helper functions for type checking
    const isString = (v: unknown): v is string => typeof v === 'string';
    const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
    const isNumber = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
    const isObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
    const validateArrayStrings = (arr: unknown): string[] => Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string' && u.trim() !== '') : [];

    // Validate grid columns setting with migration support
    const validateGridColumns = (value: unknown): string => {
      // If it's already a valid string option, use it
      if (typeof value === 'string' && Object.values(GRID_COLUMN_OPTIONS).includes(value)) {
        return value;
      }
      
      // Legacy migration: convert old numeric values to new string format
      if (typeof value === 'number') {
        switch (value) {
          case 1: return GRID_COLUMN_OPTIONS.ONE;
          case 2: return GRID_COLUMN_OPTIONS.TWO;
          case 3: return GRID_COLUMN_OPTIONS.THREE;
          case 4: return GRID_COLUMN_OPTIONS.FOUR;
          case 5: return GRID_COLUMN_OPTIONS.FIVE;
          case 6: return GRID_COLUMN_OPTIONS.SIX;
          default: return GRID_COLUMN_OPTIONS.DEFAULT; // fallback for invalid numbers
        }
      }
      
      // String numbers (legacy support)
      if (typeof value === 'string' && ['1', '2', '3', '4', '5', '6'].includes(value)) {
        return value; // these are already valid in our system
      }
      
      // Default fallback
      return def.gridColumns;
    };

    // Validate customPropertyNames per-key, falling back to defaults
    const validatedCustomPropertyNames: Record<string, string> = {};
    const defaultPropNames = def.customPropertyNames || {};
    for (const key of Object.keys(defaultPropNames)) {
      const val = (s as any)?.customPropertyNames?.[key];
      validatedCustomPropertyNames[key] = isString(val) && val.trim() !== '' ? val.trim() : defaultPropNames[key];
    }

    return {
      // Basic API and identity settings
      defaultApiSource: (['anilist', 'mal', 'simkl'] as const).includes((s as any)?.defaultApiSource) ? (s as any).defaultApiSource : def.defaultApiSource,
      defaultApiUserOverride: isBool(s.defaultApiUserOverride) ? s.defaultApiUserOverride : def.defaultApiUserOverride,
      defaultUsername: isString(s.defaultUsername) ? s.defaultUsername : def.defaultUsername,
      defaultLayout: (['card', 'table'] as const).includes((s as any)?.defaultLayout) ? (s as any).defaultLayout : def.defaultLayout,

      // Note and UI settings
      notePath: isString(s.notePath) ? s.notePath : def.notePath,
      insertCodeBlockOnNote: isBool(s.insertCodeBlockOnNote) ? s.insertCodeBlockOnNote : def.insertCodeBlockOnNote,
      showCoverImages: isBool(s.showCoverImages) ? s.showCoverImages : def.showCoverImages,
      showRatings: isBool(s.showRatings) ? s.showRatings : def.showRatings,
      showProgress: isBool(s.showProgress) ? s.showProgress : def.showProgress,
      showGenres: isBool(s.showGenres) ? s.showGenres : def.showGenres,
      showLoadingIcon: isBool(s.showLoadingIcon) ? s.showLoadingIcon : def.showLoadingIcon,
      gridColumns: validateGridColumns(s.gridColumns),
      
      hideUrlsInTitles: isBool(s.hideUrlsInTitles) ? s.hideUrlsInTitles : def.hideUrlsInTitles,
      forceScoreFormat: isBool(s.forceScoreFormat) ? s.forceScoreFormat : def.forceScoreFormat,
      showAvatar: isBool(s.showAvatar) ? s.showAvatar : def.showAvatar,
      showFavorites: isBool(s.showFavorites) ? s.showFavorites : def.showFavorites,
      showBreakdowns: isBool(s.showBreakdowns) ? s.showBreakdowns : def.showBreakdowns,
      showTimeStats: isBool(s.showTimeStats) ? s.showTimeStats : def.showTimeStats,

      // Statistics settings
      statsLayout: (['enhanced', 'compact', 'minimal'] as const).includes((s as any)?.statsLayout) ? (s as any).statsLayout : def.statsLayout,
      statsTheme: (['auto', 'light', 'dark'] as const).includes((s as any)?.statsTheme) ? (s as any).statsTheme : def.statsTheme,

      // AniList authentication
      clientId: isString(s.clientId) ? s.clientId : def.clientId,
      clientSecret: isString(s.clientSecret) ? s.clientSecret : def.clientSecret,
      accessToken: isString(s.accessToken) ? s.accessToken : def.accessToken,
      anilistUsername: isString(s.anilistUsername) ? s.anilistUsername : def.anilistUsername,
    
      // MyAnimeList authentication
      malClientId: isString(s.malClientId) ? s.malClientId : def.malClientId,
      malClientSecret: isString(s.malClientSecret) ? s.malClientSecret : def.malClientSecret,
      malAccessToken: isString(s.malAccessToken) ? s.malAccessToken : def.malAccessToken,
      malRefreshToken: isString(s.malRefreshToken) ? s.malRefreshToken : def.malRefreshToken,
      malTokenExpiry: (s.malTokenExpiry === null || isNumber(s.malTokenExpiry)) ? s.malTokenExpiry : def.malTokenExpiry,
      malUserInfo: (s.malUserInfo === null || isObject(s.malUserInfo)) ? s.malUserInfo : def.malUserInfo,

      // Simkl authentication
      simklClientId: isString(s.simklClientId) ? s.simklClientId : def.simklClientId,
      simklClientSecret: isString(s.simklClientSecret) ? s.simklClientSecret : def.simklClientSecret,
      simklAccessToken: isString(s.simklAccessToken) ? s.simklAccessToken : def.simklAccessToken,
      simklUserInfo: (s.simklUserInfo === null || isObject(s.simklUserInfo)) ? s.simklUserInfo : def.simklUserInfo,

      // Search and TMDB settings
      autoFormatSearchUrls: isBool(s.autoFormatSearchUrls) ? s.autoFormatSearchUrls : def.autoFormatSearchUrls,
      customSearchUrls: {
        ANIME: validateArrayStrings((s as any)?.customSearchUrls?.ANIME),
        MANGA: validateArrayStrings((s as any)?.customSearchUrls?.MANGA),
        MOVIE_TV: validateArrayStrings((s as any)?.customSearchUrls?.MOVIE_TV)
      },

      // Custom property names (validated per-key)
      customPropertyNames: validatedCustomPropertyNames
    };
  }

  migrateGridColumnsSetting(value: unknown): string {
    // Handle migration from old numeric system to new string system
    if (typeof value === 'number' && Number.isInteger(value)) {
      // Convert old numeric values to new string values
      if (value >= 1 && value <= 6) {
        return String(value);
      } else {
        // Invalid numeric value, use default
        return GRID_COLUMN_OPTIONS.DEFAULT;
      }
    } else if (typeof value === 'string') {
      // Validate string values
      const validOptions = Object.values(GRID_COLUMN_OPTIONS);
      if (validOptions.includes(value)) {
        return value;
      } else {
        // Invalid string value, use default
        return GRID_COLUMN_OPTIONS.DEFAULT;
      }
    } else {
      // No value or invalid type, use default
      return GRID_COLUMN_OPTIONS.DEFAULT;
    }
  }

  async saveSettings(): Promise<void> {
    try {
      const validSettings = this.validateSettings(this.settings);
      await this.saveData(validSettings);
    } catch (err) {
      console.error('[Zoro] Failed to save settings:', err);
      new Notice('⚠️ Failed to save settings. See console for details.');
    }
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);
    if (typeof this.updateDefaultApiSourceBasedOnAuth === 'function') {
      await this.updateDefaultApiSourceBasedOnAuth();
    }
  }

  addGlobalListener(el: HTMLElement, type: string, fn: EventListener): void {
    el.addEventListener(type, fn);
    this.globalListeners.push({ el, type, fn });
  }

  removeAllGlobalListeners(): void {
    this.globalListeners.forEach(({ el, type, fn }) => {
      el.removeEventListener(type, fn);
    });
    this.globalListeners.length = 0;
  }
  
  handleEditClick(e: Event, entry: MediaEntry, statusEl: HTMLElement, config: EditConfig = {}): void {
    e.preventDefault();
    e.stopPropagation();
    const source = config.source || entry?._zoroMeta?.source || this.settings?.defaultApiSource || 'anilist';
    const mediaType = config.mediaType || entry?._zoroMeta?.mediaType || 'ANIME';
    const media = entry?.media;
    
    (async () => {
      const view = await this.connectedNotes.openSidePanelWithContext({ media, entry, source, mediaType });
      await view.showEditForEntry(entry, { source });
    })();
  }

  injectCSS(): void {
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) existingStyle.remove();
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `.zoro-container{}`;
    document.head.appendChild(style);
    
    this.globalLoader = document.createElement('div');
    this.globalLoader.id = 'zoro-global-loader';
    this.globalLoader.innerHTML = `
      <div class="global-loading-glow">
        <div class="tomoe-container">
          <span class="tomoe"></span>
          <span class="tomoe"></span>
          <span class="tomoe"></span>
        </div>
      </div>
    `;
    this.globalLoader.className = 'zoro-global-loader';
    document.body.appendChild(this.globalLoader);
  }

  onunload(): void {
    this.cache.stopAutoPrune().stopBackgroundRefresh().destroy();
    this.theme.removeTheme();
    
    // Convert any zoro-panel leaves to empty to avoid orphaned tabs
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.(ZORO_VIEW_TYPE) || [];
      for (const leaf of leaves) {
        leaf.setViewState({ type: 'empty' });
      }
    } catch {
      // Silent fail if workspace methods don't exist
    }
    
    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }
    
    const loader = document.getElementById('zoro-global-loader');
    if (loader) loader.remove();
  }
}

export default ZoroPlugin;
