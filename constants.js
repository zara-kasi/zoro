const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

// Default settings constant ok
const DEFAULT_SETTINGS = {
  defaultUsername: '',
  defaultLayout: 'card',
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  gridColumns: 2,
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: '',
};