const getDefaultGridColumns = () => {
  return window.innerWidth >= 768 ? 5 : 2;
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
  gridColumns: getDefaultGridColumns(),
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
};

export { DEFAULT_SETTINGS, getDefaultGridColumns };