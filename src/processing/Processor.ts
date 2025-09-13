import { Notice } from 'obsidian';
import type { Plugin } from 'obsidian';
import { Trending } from '../features/Trending';
import type { ZoroPluginSettings, ApiSource, Layout, MediaType } from '../settings';

export type OperationType = 'stats' | 'search' | 'single' | 'list' | 'trending';
export type ListType = 'CURRENT' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNING' | 'REPEATING';

export interface ZoroMetadata {
  source: ApiSource;
  mediaType: MediaType;
  fetchedAt?: number;
}

export interface ProcessorConfig {
  username?: string;
  listType?: ListType;
  mediaType?: MediaType;
  type?: OperationType;
  layout?: Layout;
  search?: string;
  source?: ApiSource;
  page?: number;
  perPage?: number;
  limit?: number;
  mediaId?: number;
  externalIds?: Record<string, string | number>;
  useAuthenticatedUser?: boolean;
}

export interface ApiResponse {
  User?: unknown;
  Media?: unknown;
  MediaListCollection?: {
    lists: Array<{
      entries: unknown[];
    }>;
  };
  Page?: {
    media?: unknown[];
  };
  [key: string]: unknown;
}

export interface MediaListEntry {
  id: number | null;
  status: string | null;
  score: number | null;
  progress: number;
  media: unknown;
  _zoroMeta?: ZoroMetadata;
}

export interface SearchInterfaceData {
  isSearchInterface: true;
  config: ProcessorConfig;
}

export interface TrendingOperationData {
  isTrendingOperation: true;
  config: ProcessorConfig;
}

export interface ApiInstance {
  fetchAniListData?(config: ProcessorConfig): Promise<ApiResponse>;
  fetchMALData?(config: ProcessorConfig & { type: string }): Promise<ApiResponse>;
  fetchSimklData?(config: ProcessorConfig & { type: string }): Promise<ApiResponse>;
}

export interface PluginWithApis extends Plugin {
  settings: ZoroPluginSettings;
  api?: ApiInstance;
  malApi?: ApiInstance;
  simklApi?: ApiInstance;
  auth?: {
    getAuthenticatedUsername(): Promise<string | null>;
  };
  render?: {
    createStatsSkeleton(): HTMLElement;
    createListSkeleton(count?: number): HTMLElement;
    renderUserStats(el: HTMLElement, data: unknown, options: { mediaType: string; layout: string }): void;
    renderSearchInterface(el: HTMLElement, config: ProcessorConfig): Promise<void>;
    renderSearchResults(el: HTMLElement, data: unknown[], config: ProcessorConfig): void;
    renderSingleMedia(el: HTMLElement, data: unknown, config: ProcessorConfig): void;
    renderMediaList(el: HTMLElement, data: unknown, config: ProcessorConfig): void;
  };
  renderError?(el: HTMLElement, message: string, context: string, retryFn: () => void): void;
}

function isApiResponse(value: unknown): value is ApiResponse {
  return value !== null && typeof value === 'object';
}

function assertIsApiResponse(value: unknown): asserts value is ApiResponse {
  if (!isApiResponse(value)) {
    throw new Error('Invalid API response format');
  }
}

export class Processor {
  private readonly plugin: PluginWithApis;
  private readonly apiRegistry = new Map<string, ApiInstance>();

  constructor(plugin: PluginWithApis) {
    this.plugin = plugin;
    this.initializeApis();
  }

  private initializeApis(): void {
    if (this.plugin.api) {
      this.apiRegistry.set('anilist', this.plugin.api);
    }
    
    if (this.plugin.malApi) {
      this.apiRegistry.set('mal', this.plugin.malApi);
    }
    
    if (this.plugin.simklApi) {
      this.apiRegistry.set('simkl', this.plugin.simklApi);
    }
  }

  private getApiInstance(source: string): ApiInstance {
    const normalizedSource = source?.toLowerCase();
    
    if (!this.apiRegistry.has(normalizedSource)) {
      const availableSources = Array.from(this.apiRegistry.keys()).join(', ');
      throw new Error(`❌ Unsupported API source: ${source}. Available sources: ${availableSources}`);
    }
    
    return this.apiRegistry.get(normalizedSource)!;
  }

  private getSupportedOperations(source: string): OperationType[] {
    const operationMap: Record<string, OperationType[]> = {
      'anilist': ['stats', 'search', 'single', 'list', 'trending'],
      'mal': ['stats', 'search', 'single', 'list', 'trending'],
      'simkl': ['stats', 'search', 'single', 'list', 'trending']
    };
    
    return operationMap[source?.toLowerCase()] || [];
  }

  private validateOperation(source: string, operation: string): void {
    const supportedOps = this.getSupportedOperations(source);
    
    if (!supportedOps.includes(operation as OperationType)) {
      throw new Error(`❌ Operation '${operation}' is not supported by ${source.toUpperCase()}. Supported operations: ${supportedOps.join(', ')}`);
    }
  }

  private createSkeleton(config: ProcessorConfig): HTMLElement {
    if (!this.plugin.render) {
      throw new Error('Render module not available');
    }

    const skeletonMap: Record<string, () => HTMLElement> = {
      'stats': () => this.plugin.render!.createStatsSkeleton(),
      'single': () => this.plugin.render!.createListSkeleton(1),
      'trending': () => this.plugin.render!.createListSkeleton(),
      'search': () => this.plugin.render!.createListSkeleton(),
      'list': () => this.plugin.render!.createListSkeleton()
    };

    const createSkeletonFn = skeletonMap[config.type || 'list'];
    if (!createSkeletonFn) {
      return this.plugin.render.createListSkeleton();
    }

    return createSkeletonFn();
  }

  private async resolveAuthentication(config: ProcessorConfig): Promise<ProcessorConfig> {
    const updatedConfig = { ...config };

    if (config.source === 'mal' || config.source === 'simkl') {
      return updatedConfig;
    }

    if (updatedConfig.useAuthenticatedUser) {
      if (!this.plugin.auth) {
        throw new Error('Authentication module not available');
      }
      
      const authUsername = await this.plugin.auth.getAuthenticatedUsername();
      if (!authUsername) {
        throw new Error('❌ Could not retrieve authenticated username. Please authenticate or provide a username.');
      }
      updatedConfig.username = authUsername;
    }

    return updatedConfig;
  }

  private async executeApiOperation(api: ApiInstance | null, config: ProcessorConfig): Promise<unknown> {
    const { type, source } = config;

    try {
      switch (type) {
        case 'stats':
          return await this.handleStatsOperation(api!, config);
          
        case 'search':
          return await this.handleSearchOperation(api!, config);
          
        case 'single':
          return await this.handleSingleOperation(api!, config);
          
        case 'list':
          return await this.handleListOperation(api!, config);
          
        case 'trending':
          return await this.handleTrendingOperation(api, config);
          
        default:
          throw new Error(`❌ Unknown operation type: ${type}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`❌ ${source?.toUpperCase() || 'API'} operation failed: ${errorMessage}`);
    }
  }

  private injectMetadata<T>(data: T, config: ProcessorConfig): T {
    if (!data) return data;
    
    const metadata: ZoroMetadata = {
      source: config.source || 'anilist',
      mediaType: config.mediaType || 'ANIME'
    };

    if (Array.isArray(data)) {
      data.forEach(entry => {
        if (entry && typeof entry === 'object') {
          (entry as any)._zoroMeta = metadata;
          // Ensure media type is consistent
          if ((entry as any).media && !(entry as any).media.type) {
            (entry as any).media.type = metadata.mediaType;
          }
        }
      });
      return data;
    }
    
    // Handle single entry
    if (data && typeof data === 'object') {
      (data as any)._zoroMeta = metadata;
      if ((data as any).media && !(data as any).media.type) {
        (data as any).media.type = metadata.mediaType;
      }
    }
    
    return data;
  }

  private async handleStatsOperation(api: ApiInstance, config: ProcessorConfig): Promise<unknown> {
    let response: unknown;
    
    if (config.source === 'mal') {
      response = await api.fetchMALData?.({ ...config, type: 'stats' });
    } else if (config.source === 'simkl') {
      response = await api.fetchSimklData?.({ ...config, type: 'stats' });
    } else {
      response = await api.fetchAniListData?.(config);
    }
    
    assertIsApiResponse(response);
    const data = response.User || response;
    return this.injectMetadata(data, config);
  }

  private async handleSearchOperation(api: ApiInstance, config: ProcessorConfig): Promise<SearchInterfaceData> {
    return { isSearchInterface: true, config };
  }

  private async handleSingleOperation(api: ApiInstance, config: ProcessorConfig): Promise<MediaListEntry | null> {
    if (!config.mediaId && !config.externalIds) {
      throw new Error('❌ Media ID or externalIds is required for single media view');
    }

    let response: unknown;
    
    if (config.source === 'mal') {
      // Use item endpoint to fetch single MAL media reliably
      response = await api.fetchMALData?.({ ...config, type: 'item' });
      assertIsApiResponse(response);
      const media = response.Media;
      const wrapped: MediaListEntry = media ? { id: null, status: null, score: null, progress: 0, media } : null;
      return this.injectMetadata(wrapped, config);
    } else if (config.source === 'simkl') {
      response = await api.fetchSimklData?.({ ...config, type: 'single' });
      assertIsApiResponse(response);
      const data = response.MediaList;
      return this.injectMetadata(data, config);
    } else {
      // AniList: use Media(id) query; wrap result to MediaList-like shape for renderer
      response = await api.fetchAniListData?.({ ...config, type: 'single' });
      assertIsApiResponse(response);
      const media = response.Media;
      const wrapped: MediaListEntry = media ? { id: null, status: null, score: null, progress: 0, media } : null;
      return this.injectMetadata(wrapped, config);
    }
  }

  private async handleListOperation(api: ApiInstance, config: ProcessorConfig): Promise<unknown[]> {
    let response: unknown;
    
    if (config.source === 'mal') {
      response = await api.fetchMALData?.({ ...config, type: 'list' });
    } else if (config.source === 'simkl') {
      response = await api.fetchSimklData?.({ ...config, type: 'list' });
    } else {
      response = await api.fetchAniListData?.({ ...config, type: 'list' });
    }
    
    assertIsApiResponse(response);
    const entries = response.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.injectMetadata(entries, config);
  }

  private async handleTrendingOperation(api: ApiInstance | null, config: ProcessorConfig): Promise<unknown[]> {
    const trending = new Trending(this.plugin);
    
    const data = await trending.fetchTrending(
      config.source!, 
      config.mediaType!, 
      config.limit || 40
    );
    
    if (Array.isArray(data)) {
      data.forEach(item => {
        if (item && typeof item === 'object' && !(item as any)._zoroMeta) {
          (item as any)._zoroMeta = {
            source: config.source,
            mediaType: config.mediaType,
            fetchedAt: Date.now()
          };
        }
      });
    }
    
    return data;
  }

  private async renderData(el: HTMLElement, data: unknown, config: ProcessorConfig): Promise<void> {
    const { type } = config;

    if (!this.plugin.render) {
      throw new Error('Render module not available');
    }

    try {
      switch (type) {
        case 'stats':
          this.plugin.render.renderUserStats(el, data, { 
            mediaType: config.mediaType || 'ANIME', 
            layout: config.layout || 'enhanced' 
          });
          break;

        case 'search':
          const searchData = data as SearchInterfaceData;
          if (searchData.isSearchInterface) {
            await this.plugin.render.renderSearchInterface(el, searchData.config);
          } else {
            const apiResponse = data as ApiResponse;
            this.plugin.render.renderSearchResults(el, apiResponse.Page?.media || [], config);
          }
          break;

        case 'single':
          this.plugin.render.renderSingleMedia(el, data, config);
          break;

        case 'list':
          this.plugin.render.renderMediaList(el, data, config);
          break;

        case 'trending':
          if (Array.isArray(data)) {
            console.log(`[Processor] Rendering trending data: ${data.length} items`);
            // Data is already fetched and formatted, just render it
            this.plugin.render.renderSearchResults(el, data, {
              layout: config.layout || 'card',
              mediaType: config.mediaType || 'ANIME',
              source: config.source,
              type: 'trending'
            });
          } else {
            const trendingData = data as TrendingOperationData;
            if (trendingData && trendingData.isTrendingOperation) {
              // Fallback to the old render method if needed
              console.log('[Processor] Using fallback trending render method');
              const trending = new Trending(this.plugin);
              await trending.renderTrendingBlock(el, trendingData.config);
            } else {
              throw new Error('Invalid trending data format received');
            }
          }
          break;

        default:
          throw new Error(`❌ Unknown rendering type: ${type}`);
      }
    } catch (error) {
      console.error('[Processor] Render data failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`❌ Rendering failed: ${errorMessage}`);
    }
  }

  async processZoroCodeBlock(source: string, el: HTMLElement, ctx: unknown): Promise<void> {
    let config: ProcessorConfig;
    
    try {
      config = this.parseCodeBlockConfig(source) || {};
      
      this.validateOperation(config.source!, config.type!);
      
      const skeleton = this.createSkeleton(config);
      el.empty();
      el.appendChild(skeleton);

      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);

      await this.executeProcessing(el, config, retryFn);

    } catch (error) {
      console.error('[Zoro] Code block processing error:', error);
      el.empty();
      
      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred.';
      
      if (this.plugin.renderError) {
        this.plugin.renderError(el, errorMessage, 'Code block', retryFn);
      } else {
        // Fallback error display
        el.createEl('div', { text: `Error: ${errorMessage}` });
      }
    }
  }

  private async executeProcessing(el: HTMLElement, config: ProcessorConfig, retryFn: () => void): Promise<void> {
    try {
      const resolvedConfig = await this.resolveAuthentication(config);
      
      // Get API instance for non-trending operations
      let api: ApiInstance | null = null;
      if (resolvedConfig.type !== 'trending') {
        api = this.getApiInstance(resolvedConfig.source!);
      }
      
      // Execute the operation
      const data = await this.executeApiOperation(api, resolvedConfig);
      
      // Render the data
      await this.renderData(el, data, resolvedConfig);

    } catch (error) {
      console.error('[Processor] Execute processing failed:', error);
      el.empty();
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (this.plugin.renderError) {
        this.plugin.renderError(el, errorMessage, 'Failed to load', retryFn);
      }
      throw error;
    }
  }

  private parseCodeBlockConfig(source: string): ProcessorConfig {
    const config: ProcessorConfig = {};
    const lines = source.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    const keyMappings: Record<string, keyof ProcessorConfig> = {
      'username': 'username',
      'user': 'username',
      'listtype': 'listType',
      'list-type': 'listType',
      'list_type': 'listType',
      'mediatype': 'mediaType',
      'media-type': 'mediaType',
      'media_type': 'mediaType',
      'type': 'type',
      'layout': 'layout',
      'search': 'search',
      'query': 'search',
      'source': 'source',
      'api': 'source',
      'page': 'page',
      'perpage': 'perPage',
      'per-page': 'perPage',
      'per_page': 'perPage',
      'limit': 'perPage',
      'mediaid': 'mediaId',
      'media-id': 'mediaId',
      'media_id': 'mediaId',
      'id': 'mediaId'
    };

    for (let raw of lines) {
      const colonIndex = raw.indexOf(':');
      if (colonIndex === -1) continue;

      let key = raw.slice(0, colonIndex).trim().toLowerCase();
      let value = raw.slice(colonIndex + 1).trim();

      const mappedKey = keyMappings[key];
      if (!mappedKey) continue;

      (config as any)[mappedKey] = this.processConfigValue(mappedKey, value);
    }

    return this.applyConfigDefaults(config);
  }

  private processConfigValue(key: keyof ProcessorConfig, value: string): unknown {
    switch (key) {
      case 'listType':
        return value.toUpperCase().replace(/[\s-]/g, '_') as ListType;
      case 'mediaType':
        return value.toUpperCase() as MediaType;
      case 'type':
      case 'layout':
      case 'source':
        return value.toLowerCase();
      case 'page':
      case 'perPage':
      case 'mediaId':
        return parseInt(value) || undefined;
      default:
        return value;
    }
  }

  private applyConfigDefaults(config: ProcessorConfig): ProcessorConfig {
    const mt = String(config.mediaType || 'ANIME').toUpperCase();
    
    if (!config.source) {
      if (mt === 'MOVIE' || mt === 'MOVIES' || mt === 'TV' || mt === 'SHOW' || mt === 'SHOWS') {
        config.source = 'simkl';
      } else if (mt === 'MANGA') {
        const def = this.plugin.settings.defaultApiSource || 'anilist';
        config.source = def === 'simkl' ? 'mal' : def;
      } else {
        config.source = this.plugin.settings.defaultApiSource || 'anilist';
      }
    }

    if (config.type === 'trending') {
      config.mediaType = (config.mediaType || 'ANIME') as MediaType;
      config.layout = (config.layout || this.plugin.settings.defaultLayout || 'card') as Layout;
      config.limit = config.limit || config.perPage || 40;
      
      const mtUpper = config.mediaType.toUpperCase();
      if (['MOVIE','MOVIES','TV','SHOW','SHOWS'].includes(mtUpper)) {
        config.source = 'simkl';
      } else if (mtUpper === 'MANGA' && config.source === 'simkl') {
        config.source = 'mal';
      }
      
      return config;
    }

    // Skip auto-authentication for search operations
    if (config.type === 'search') {
      config.mediaType = (config.mediaType || 'ANIME') as MediaType;
      config.layout = (config.layout || this.plugin.settings.defaultLayout || 'card') as Layout;
      return config;
    }

    // Existing authentication checks for other operations
    if (config.source === 'mal' || config.source === 'simkl') {
      if (!this.hasValidAuthForSource(config.source)) {
        throw new Error(`❌ ${config.source.toUpperCase()} authentication required. Please authenticate in plugin settings.`);
      }
    } else {
      // AniList authentication logic
      if (!config.username) {
        if (this.plugin.settings.defaultUsername) {
          config.username = this.plugin.settings.defaultUsername;
        } else if (this.plugin.settings.anilistUsername) {
          config.username = this.plugin.settings.anilistUsername;
        } else if (this.hasValidAuthForSource(config.source)) {
          // Only set useAuthenticatedUser if we don't have stored username
          if (config.type !== 'search') {
            config.useAuthenticatedUser = true;
          }
        } else {
          throw new Error('❌ Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
        }
      }
    }

    config.type = (config.type || 'list') as OperationType;
    config.mediaType = (config.mediaType || 'ANIME') as MediaType;
    config.layout = (config.layout || this.plugin.settings.defaultLayout || 'card') as Layout;
    
    if (!config.listType && config.type === 'list') {
      config.listType = 'CURRENT';
    }
    
    if ((config.source === 'mal' || config.source === 'simkl') && config.listType === 'REPEATING') {
      throw new Error('Repeating is supported only on AniList.');
    }
    
    if (config.source === 'simkl' && config.mediaType === 'MANGA') {
      throw new Error('Manga is supported only on AniList and MyAnimeList.');
    }

    return config;
  }

  private hasValidAuthForSource(source: string): boolean {
    switch (source) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'simkl':
        return !!this.plugin.settings.simklAccessToken;
      case 'anilist':
        return !!this.plugin.settings.accessToken;
      default:
        return false;
    }
  }
}
