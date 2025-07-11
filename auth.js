// Authentication & token exchange functions
const { Notice } = require('obsidian');
const { prompt } = window;

async function authenticateUser() {
  if (!this.settings.clientId) {
    new Notice('Please set Client ID first');
    return;
  }
  const redirectUri = this.settings.redirectUri;
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${this.settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  new Notice('Opening auth page...', 3000);
  try {
    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }
    new Notice('Paste PIN code when ready', 8000);
    setTimeout(async () => {
      const code = prompt('Paste PIN here:');
      if (code) {
        await exchangeCodeForToken.call(this, code.trim());
      }
    }, 4000);
  } catch (e) {
    new Notice(`Error: ${e.message}`);
  }
}

async function exchangeCodeForToken(code) {
  try {
    const resp = await makeRequest.call(this, code);
    if (resp.access_token) {
      this.settings.accessToken = resp.access_token;
      await this.saveSettings();
      new Notice('Authenticated!');
    } else throw new Error('No token');
  } catch (e) {
    new Notice(`Auth failed: ${e.message}`);
  }
}

async function makeRequest(code) {
  const body = {
    grant_type: 'authorization_code',
    client_id: this.settings.clientId,
    client_secret: this.settings.clientSecret,
    redirect_uri: this.settings.redirectUri,
    code
  };
  const resp = await window.requestUrl({
    url: 'https://anilist.co/api/v2/oauth/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return JSON.parse(resp.text);
}

// Expose methods
module.exports = {
  authenticateUser,
  exchangeCodeForToken
};
