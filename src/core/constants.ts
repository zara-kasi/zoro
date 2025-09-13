export const GRID_COLUMN_OPTIONS = {
  DEFAULT: 'default',
  ONE: '1',
  TWO: '2',
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6'
} as const;

export type GridColumnOption = typeof GRID_COLUMN_OPTIONS[keyof typeof GRID_COLUMN_OPTIONS];

// User-friendly labels for the grid options - these show up in the settings UI
export const GRID_COLUMN_LABELS: Record<GridColumnOption, string> = {
  [GRID_COLUMN_OPTIONS.DEFAULT]: 'Default (Responsive)',
  [GRID_COLUMN_OPTIONS.ONE]: '1 Column',
  [GRID_COLUMN_OPTIONS.TWO]: '2 Columns',
  [GRID_COLUMN_OPTIONS.THREE]: '3 Columns',
  [GRID_COLUMN_OPTIONS.FOUR]: '4 Columns',
  [GRID_COLUMN_OPTIONS.FIVE]: '5 Columns',
  [GRID_COLUMN_OPTIONS.SIX]: '6 Columns'
} as const;

export type ApiSource = 'anilist' | 'mal' | 'simkl';
export type Layout = 'card' | 'list';
export type StatsLayout = 'enhanced' | 'basic';
export type StatsTheme = 'auto' | 'light' | 'dark';
export type MediaType = 'ANIME' | 'MANGA' | 'MOVIE_TV';

export interface CustomSearchUrls {
  readonly ANIME: string[];
  readonly MANGA: string[];
  readonly MOVIE_TV: string[];
}

export interface CustomPropertyNames {
  readonly title: string;
  readonly aliases: string;
  readonly format: string;
  readonly status: string;
  readonly rating: string;
  readonly favorite: string;
  readonly total_episodes: string;
  readonly total_chapters: string;
  readonly episodes_watched: string;
  readonly chapters_read: string;
  readonly volumes_read: string;
  readonly mal_id: string;
  readonly anilist_id: string;
  readonly simkl_id: string;
  readonly imdb_id: string;
  readonly tmdb_id: string;
  readonly media_type: string;
  readonly cover: string;
  readonly genres: string;
  readonly urls: string;
  readonly tags: string;
}

export interface UserInfo {
  readonly id: string | number;
  readonly name: string;
  readonly avatar?: string;
  readonly [key: string]: unknown; // Allow additional properties from different APIs
}

export interface ZoroPluginSettings {
  // Basic API settings
  readonly defaultApiSource: ApiSource;
  readonly defaultApiUserOverride: boolean;
  readonly defaultUsername: string;
  
  // How things look and behave
  readonly defaultLayout: Layout;
  readonly notePath: string;
  readonly insertCodeBlockOnNote: boolean;
  readonly showCoverImages: boolean;
  readonly showRatings: boolean;
  readonly showProgress: boolean;
  readonly showGenres: boolean;
  readonly showLoadingIcon: boolean;
  readonly gridColumns: GridColumnOption;
  
  readonly hideUrlsInTitles: boolean;
  readonly forceScoreFormat: boolean;
  readonly showAvatar: boolean;
  readonly showFavorites: boolean;
  readonly showBreakdowns: boolean;
  readonly showTimeStats: boolean;
  readonly statsLayout: StatsLayout;
  readonly statsTheme: StatsTheme;
  
  // AniList API stuff - need to register app to get these
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accessToken: string;
  readonly anilistUsername: string;
  
  // MyAnimeList API - more complex auth system
  readonly malClientId: string;
  readonly malClientSecret: string;
  readonly malAccessToken: string;
  readonly malRefreshToken: string;
  readonly malTokenExpiry: number | null;
  readonly malUserInfo: UserInfo | null;
  
  // Simkl API - simpler than MAL
  readonly simklClientId: string;
  readonly simklClientSecret: string;
  readonly simklAccessToken: string;
  readonly simklUserInfo: UserInfo | null;
  
  // Search configuration
  readonly autoFormatSearchUrls: boolean;
  readonly customSearchUrls: CustomSearchUrls;
  
  // Let users customize what the properties are called in their notes
  readonly customPropertyNames: CustomPropertyNames;
}

// All the default settings for the plugin
export const DEFAULT_SETTINGS: ZoroPluginSettings = {
  // Basic API settings
  defaultApiSource: 'anilist',        // which API to use by default
  defaultApiUserOverride: false,      // let users pick different APIs per search
  defaultUsername: '',                // leave empty to use logged-in user
  
  // How things look and behave
  defaultLayout: 'card',              // card view looks nicer than list
  notePath: 'Zoro/Note',             // where to save notes
  insertCodeBlockOnNote: true,        // makes the notes look better in markdown
  showCoverImages: true,              
  showRatings: true,                  
  showProgress: true,                 // show how much you've watched/read
  showGenres: false,                  // can get cluttered, so off by default
  showLoadingIcon: true,              
  gridColumns: GRID_COLUMN_OPTIONS.DEFAULT, // use responsive grid
  
  hideUrlsInTitles: true,            // URLs in titles look ugly
  forceScoreFormat: true,            // makes scores consistent across different sites
  showAvatar: true,                  
  showFavorites: true,               
  showBreakdowns: true,              // detailed stats are cool
  showTimeStats: true,               // show time spent watching/reading
  statsLayout: 'enhanced',           // enhanced looks better than basic
  statsTheme: 'auto',               // auto-detect light/dark mode
  
  // AniList API stuff - need to register app to get these
  clientId: '',                      
  clientSecret: '',                  
  accessToken: '',                   // gets filled in after user logs in
  anilistUsername: '',
  
  // MyAnimeList API - more complex auth system
  malClientId: '',                   
  malClientSecret: '',               
  malAccessToken: '',                
  malRefreshToken: '',               // MAL tokens expire, so need refresh token
  malTokenExpiry: null,              // timestamp when token expires
  malUserInfo: null,                 // cache user info so we don't have to fetch it every time
  
  // Simkl API - simpler than MAL
  simklClientId: '',                 
  simklClientSecret: '',             
  simklAccessToken: '',              
  simklUserInfo: null,               
  
  // Search configuration
  autoFormatSearchUrls: true,        // clean up messy URLs automatically
  customSearchUrls: {                // let users add their own search sites
    ANIME: [],                       
    MANGA: [],                       
    MOVIE_TV: []                     
  },
  
  // Let users customize what the properties are called in their notes
  // This is useful if you want "rating" to be called "score" or whatever
  customPropertyNames: {
    title: 'title',                  
    aliases: 'aliases',              // alternate names
    format: 'format',                // TV, Movie, OVA, etc.
    status: 'status',                // watching, completed, etc.
    rating: 'rating',                
    favorite: 'favorite',            
    total_episodes: 'total_episodes', 
    total_chapters: 'total_chapters', 
    episodes_watched: 'episodes_watched', 
    chapters_read: 'chapters_read',   
    volumes_read: 'volumes_read',     // for manga
    mal_id: 'mal_id',                // MyAnimeList database ID
    anilist_id: 'anilist_id',        // AniList database ID  
    simkl_id: 'simkl_id',            
    imdb_id: 'imdb_id',              
    tmdb_id: 'tmdb_id',              
    media_type: 'media_type',        
    cover: 'cover',                  // cover image URL
    genres: 'genres',                
    urls: 'urls',                    // related links
    tags: 'tags'                     // user tags
  }
} as const;
