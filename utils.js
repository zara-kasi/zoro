function parseCodeBlockConfig(source) {
  const config = {};
  source.split('\n').forEach(line => {
    const [k, v] = line.split(':').map(s => s.trim());
    if (k && v) config[k] = v;
  });
  if (!config.username && this.settings.defaultUsername) {
    config.username = this.settings.defaultUsername;
  }
  config.layout = config.layout || this.settings.defaultLayout;
  return config;
}

function parseSearchCodeBlockConfig(source) {
  const cfg = parseCodeBlockConfig.call(this, source);
  cfg.type = 'search';
  return cfg;
}

function parseInlineLink(href) {
  const parts = href.replace('anilist:', '').split('/');
  return { username: parts[0], type: parts[1] || 'stats' };
}

module.exports = {
  parseCodeBlockConfig,
  parseSearchCodeBlockConfig,
  parseInlineLink
};
