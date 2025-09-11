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

export const GRID_COLUMN_LABELS: Record<GridColumnOption, string> = {
  [GRID_COLUMN_OPTIONS.DEFAULT]: 'Default (Responsive)',
  [GRID_COLUMN_OPTIONS.ONE]: '1 Column',
  [GRID_COLUMN_OPTIONS.TWO]: '2 Columns',
  [GRID_COLUMN_OPTIONS.THREE]: '3 Columns',
  [GRID_COLUMN_OPTIONS.FOUR]: '4 Columns',
  [GRID_COLUMN_OPTIONS.FIVE]: '5 Columns',
  [GRID_COLUMN_OPTIONS.SIX]: '6 Columns'
};

export interface ZoroSettings {
  defaultApiSource: string;
  defaultApiUserOverride: boolean;
  defaultUsername: string;
  defaultLayout: 'card' | 'list' | string;
  notePath: string;
  insertCodeBlockOnNote: boolean;
  showCoverImages: boolean;
  showRatings: boolean;
  showProgress: boolean;
  showGenres: boolean;
  showLoadingIcon: boolean;
  gridColumns: GridColumnOption;
  hideUrlsInTitles: boolean;
  forceScoreFormat: boolean;
  showAvatar: boolean;
  showFavorites: boolean;
  showBreakdowns: boolean;
  showTimeStats: boolean;
  // extend with other fields if needed
}

export const DEFAULT_SETTINGS: ZoroSettings = {
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
  gridColumns: GRID_COLUMN_OPTIONS.DEFAULT,
  hideUrlsInTitles: false,
  forceScoreFormat: false,
  showAvatar: true,
  showFavorites: false,
  showBreakdowns: false,
  showTimeStats: false
};

export const METADATA_KEYS = {
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
} as const;