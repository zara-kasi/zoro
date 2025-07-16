function parseCodeBlockConfig(source, settings) {
  const config = {};
  source.split('\n').filter(l => l.trim()).forEach(line => {
    const [k, v] = line.split(':').map(s => s.trim());
    if (k && v) config[k] = v;
  });
  if (!config.username) {
    if (settings.defaultUsername) config.username = settings.defaultUsername;
    else if (settings.accessToken) config.useAuthenticatedUser = true;
    else throw new Error('Username is required.');
  }
  config.listType = config.listType || 'CURRENT';
  config.layout = config.layout || settings.defaultLayout;
  config.mediaType = config.mediaType || 'ANIME';
  return config;
}

function parseSearchCodeBlockConfig(source, settings) {
  const config = { type: 'search' };
  source.split('\n').filter(l => l.trim()).forEach(line => {
    const [k, v] = line.split(':').map(s => s.trim());
    if (k && v) config[k] = v;
  });
  config.layout = config.layout || settings.defaultLayout || 'card';
  config.mediaType = config.mediaType || 'ANIME';
  return config;
}

module.exports = { parseCodeBlockConfig, parseSearchCodeBlockConfig };
