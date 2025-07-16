const { DEFAULT_SETTINGS } = require('./defaults');

function validateSettings(settings = {}) {
  return {
    defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
    defaultLayout: ['card', 'list', 'table'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
    showCoverImages: !!settings?.showCoverImages,
    showRatings: !!settings?.showRatings,
    showProgress: !!settings?.showProgress,
    showGenres: !!settings?.showGenres,
    gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : 3,
    clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
    clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
    redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
    accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : ''
  };
}

module.exports.validateSettings = validateSettings;
