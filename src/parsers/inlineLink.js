function parseInlineLink(href, settings) {
  const [base, hash] = href.replace('zoro:', '').split('#');
  const parts = base.split('/');
  let username, pathParts;
  if (parts[0] === '') {
    if (!settings.defaultUsername) throw new Error('⚠️ Default username not set.');
    username = settings.defaultUsername;
    pathParts = parts.slice(1);
  } else {
    if (parts.length < 2) throw new Error('❌ Invalid Zoro inline link format.');
    username = parts[0];
    pathParts = parts.slice(1);
  }
  const config = { username, layout: 'card', type: 'list' };
  const main = pathParts[0];
  const second = pathParts[1];
  if (main === 'stats') config.type = 'stats';
  else if (['anime', 'manga'].includes(main)) {
    config.type = 'single';
    config.mediaType = main.toUpperCase();
    if (!second || isNaN(parseInt(second))) throw new Error('⚠️ Invalid media ID.');
    config.mediaId = parseInt(second);
  } else {
    config.listType = main.toUpperCase();
  }
  if (hash) {
    hash.split(',').forEach(mod => {
      if (['compact', 'card', 'minimal', 'full'].includes(mod)) config.layout = mod;
      if (mod === 'nocache') config.nocache = true;
    });
  }
  return config;
}

module.exports = { parseInlineLink };
