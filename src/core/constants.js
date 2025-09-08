// Define all possible grid column options for the layout system
const GRID_COLUMN_OPTIONS = {
  DEFAULT: 'default', // responsive - adapts to screen size automatically
  ONE: '1',
  TWO: '2', 
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6'
};

// User-friendly labels for the grid options - these show up in the settings UI
const GRID_COLUMN_LABELS = {
  [GRID_COLUMN_OPTIONS.DEFAULT]: 'Default (Responsive)', // using bracket notation to reference the constant
  [GRID_COLUMN_OPTIONS.ONE]: '1 Column',
  [GRID_COLUMN_OPTIONS.TWO]: '2 Columns',
  [GRID_COLUMN_OPTIONS.THREE]: '3 Columns',
  [GRID_COLUMN_OPTIONS.FOUR]: '4 Columns',
  [GRID_COLUMN_OPTIONS.FIVE]: '5 Columns',
  [GRID_COLUMN_OPTIONS.SIX]: '6 Columns'
};

// All the default settings for the plugin
const DEFAULT_SETTINGS = {
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
  
  // Theme stuff
  theme: '',                          // empty means use default theme
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
  redirectUri: 'https://anilist.co/api/v2/oauth/pin', // standard AniList OAuth URL
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
  
  // TMDB for movies and TV shows
  tmdbApiKey: '',                    // free API key from themoviedb.org
  
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
};

// Export everything so other files can use these settings
export { DEFAULT_SETTINGS, GRID_COLUMN_OPTIONS, GRID_COLUMN_LABELS };