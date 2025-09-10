// ProcessorTypes.ts - Core TypeScript interfaces and types for the Processor

export type ApiSource = 'anilist' | 'mal' | 'simkl';
export type MediaType = 'ANIME' | 'MANGA' | 'MOVIE' | 'MOVIES' | 'TV' | 'SHOW' | 'SHOWS';
export type OperationType = 'stats' | 'search' | 'single' | 'list' | 'trending';
export type ListType = 'CURRENT' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNING' | 'REPEATING';
export type LayoutType = 'card' | 'list' | 'compact' | 'enhanced';

export interface BaseConfig {
  source: ApiSource;
  type: OperationType;
  mediaType: MediaType;
  layout?: LayoutType;
}

export interface AuthConfig {
  username?: string;
  useAuthenticatedUser?: boolean;
}

export interface PaginationConfig {
  page?: number;
  perPage?: number;
  limit?: number;
}

export interface ProcessorConfig extends BaseConfig, AuthConfig, PaginationConfig {
  listType?: ListType;
  search?: string;
  query?: string;
  mediaId?: number;
  externalIds?: Record<string, any>;
}

export interface ZoroMetadata {
  source: ApiSource;
  mediaType: MediaType;
  fetchedAt?: number;
}

export interface MediaEntry {
  id?: number | null;
  status?: string | null;
  score?: number | null;
  progress?: number;
  media?: MediaData;
  _zoroMeta?: ZoroMetadata;
}

export interface MediaData {
  id?: number;
  type?: MediaType;
  title?: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  coverImage?: {
    medium?: string;
    large?: string;
  };
  [key: string]: any;
}

export interface UserStats {
  User?: any;
  _zoroMeta?: ZoroMetadata;
  [key: string]: any;
}

export interface SearchResult {
  Page?: {
    media?: MediaData[];
  };
  media?: MediaData[];
  [key: string]: any;
}

export interface MediaListCollection {
  MediaListCollection?: {
    lists?: Array<{
      entries: MediaEntry[];
    }>;
  };
  lists?: Array<{
    entries: MediaEntry[];
  }>;
}

export interface TrendingData extends Array<MediaEntry> {}

export interface SearchInterface {
  isSearchInterface: true;
  config: ProcessorConfig;
}

export interface TrendingOperation {
  isTrendingOperation: true;
  config: ProcessorConfig;
}

export type ProcessorData = 
  | UserStats 
  | SearchResult 
  | MediaEntry 
  | MediaEntry[] 
  | TrendingData 
  | SearchInterface 
  | TrendingOperation;

export interface ApiInstance {
  fetchAniListData?(config: ProcessorConfig): Promise<any>;
  fetchMALData?(config: ProcessorConfig): Promise<any>;
  fetchSimklData?(config: ProcessorConfig): Promise<any>;
}

export interface RenderOptions {
  mediaType?: MediaType;
  layout?: LayoutType;
  source?: ApiSource;
  type?: OperationType;
}

export interface PluginRenderer {
  createStatsSkeleton(): HTMLElement;
  createListSkeleton(count?: number): HTMLElement;
  renderUserStats(el: HTMLElement, data: UserStats, options: RenderOptions): void;
  renderSearchInterface(el: HTMLElement, config: ProcessorConfig): Promise<void>;
  renderSearchResults(el: HTMLElement, data: MediaData[], config: ProcessorConfig): void;
  renderSingleMedia(el: HTMLElement, data: MediaEntry, config: ProcessorConfig): void;
  renderMediaList(el: HTMLElement, data: MediaEntry[], config: ProcessorConfig): void;
}

export interface PluginAuth {
  getAuthenticatedUsername(): Promise<string | null>;
}

export interface PluginSettings {
  defaultApiSource?: ApiSource;
  defaultUsername?: string;
  anilistUsername?: string;
  defaultLayout?: LayoutType;
  accessToken?: string;
  malAccessToken?: string;
  simklAccessToken?: string;
}

export interface ZoroPlugin {
  api?: ApiInstance;
  malApi?: ApiInstance;
  simklApi?: ApiInstance;
  render: PluginRenderer;
  auth: PluginAuth;
  settings: PluginSettings;
  renderError(el: HTMLElement, message: string, title: string, retryFn: () => void): void;
}

export interface ConfigKeyMappings {
  [key: string]: keyof ProcessorConfig;
}

export interface OperationMap {
  [source: string]: OperationType[];
}

export interface SkeletonMap {
  [operation: string]: () => HTMLElement;
}