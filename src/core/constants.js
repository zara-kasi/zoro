const getDefaultGridColumns = () => {
  return window.innerWidth >= 768 ? 5 : 2;
};

// New unified grid column system
const GRID_COLUMN_OPTIONS = {
  DEFAULT: 'default',
  ONE: '1',
  TWO: '2', 
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6'
};

const GRID_COLUMN_LABELS = {
  [GRID_COLUMN_OPTIONS.DEFAULT]: 'Default (Responsive)',
  [GRID_COLUMN_OPTIONS.ONE]: '1 Column',
  [GRID_COLUMN_OPTIONS.TWO]: '2 Columns',
  [GRID_COLUMN_OPTIONS.THREE]: '3 Columns',
  [GRID_COLUMN_OPTIONS.FOUR]: '4 Columns',
  [GRID_COLUMN_OPTIONS.FIVE]: '5 Columns',
  [GRID_COLUMN_OPTIONS.SIX]: '6 Columns'
};

const DEFAULT_SETTINGS = {
  defaultApiSource: 'anilist',
  defaultApiUserOverride: false,
  defaultUsername: '',
  defaultLayout: 'card',
  notePath: 'Zoro/Note',
  insertCodeBlockOnNote: true,
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  showLoadingIcon: true,
  gridColumns: GRID_COLUMN_OPTIONS.DEFAULT, // Changed from numeric to string option
  theme: '', 
  hideUrlsInTitles: true,
  forceScoreFormat: true,
  showAvatar: true,
  showFavorites: true,
  showBreakdowns: true,
  showTimeStats: true,
  statsLayout: 'enhanced',
  statsTheme: 'auto',
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: '',
  malClientId: '',
  malClientSecret: '',
  malAccessToken: '',
  malRefreshToken: '',
  malTokenExpiry: null,
  malUserInfo: null,
  simklClientId: '',
  simklClientSecret: '',
  simklAccessToken: '',
  simklUserInfo: null,
  autoFormatSearchUrls: true,
  customSearchUrls: {
    ANIME: [],
    MANGA: [],
    MOVIE_TV: []
  },
  tmdbApiKey: '',
  customPropertyNames: {
    title: 'title',
    aliases: 'aliases', 
    format: 'format',
    status: 'status',
    rating: 'rating',
    favorite: 'favorite',
    total_episodes: 'total_episodes',
    total_chapters: 'total_chapters',
    episodes_watched: 'episodes_watched',
    chapters_read: 'chapters_read',
    volumes_read: 'volumes_read',
    mal_id: 'mal_id',
    anilist_id: 'anilist_id', 
    simkl_id: 'simkl_id',
    imdb_id: 'imdb_id',
    tmdb_id: 'tmdb_id',
    media_type: 'media_type',
    cover: 'cover',
    genres: 'genres',
    urls: 'urls',
    tags: 'tags'
  }
};

export { DEFAULT_SETTINGS, getDefaultGridColumns, GRID_COLUMN_OPTIONS, GRID_COLUMN_LABELS };