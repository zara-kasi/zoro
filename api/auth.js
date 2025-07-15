export function async authenticateUser() {
    const clientId = this.settings.clientId;
    const redirectUri = this.settings.redirectUri || 'https://anilist.co/api/v2/oauth/pin';
    

    if (!clientId) {
      new Notice('❌ Please set your Client ID in plugin settings first.', 5000);
      return;
    }

    // Check if already authenticated
    if (this.settings.accessToken) {
      const reuse = confirm('Do you want to re-authenticate?');
      if (!reuse) return;
    }

    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;

    try {
      new Notice('🔐 Opening authentication page...', 3000);

  
 window.addEventListener('message', this.handleAuthMessage.bind(this));
      
      
      if (window.require) {
        const { shell } = window.require('electron');
        await shell.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }

      const code = await this.promptForCode('Paste the PIN code from the authentication page:');

      if (!code || !code.trim()) {
        new Notice('⚠️ No code entered. Authentication cancelled.', 4000);
        return;
      }

      await this.exchangeCodeForToken(code.trim(), redirectUri);
      new Notice('✅ Authenticated successfully.', 4000);
    } catch (error) {
      console.error('[Zoro] Authentication failed:', error);
      new Notice(`❌ Authentication error: ${error.message}`, 5000);
    }
  }

export function async promptForCode(message) {
    return new Promise((resolve) => {
      const code = prompt(message);
      resolve(code);
    });}
export function async exchangeCodeForToken(code, redirectUri) {
    const clientId = this.settings.clientId;
    const clientSecret = this.settings.clientSecret;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret || '', // optional but safe
      redirect_uri: redirectUri,
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };

    try {
      const response = await this.requestQueue.add(() => requestUrl({
  url: 'https://anilist.co/api/v2/oauth/token',
        method: 'POST',
        headers,
        body: body.toString(),
      }));

      const data = response?.json;

      if (!data || typeof data !== 'object') {
        console.error('[Zoro] Unexpected response from server:', response);
        throw new Error('⚠️ Invalid response from server.');
      }

      if (!data.access_token) {
        throw new Error(data.error_description || '❌ No access token returned by server.');
      }

      // Store auth details
      this.settings.accessToken = data.access_token;

      // Refresh Token 
      
      if (data.refresh_token) {
        this.settings.refreshToken = data.refresh_token;
      }

      if (data.expires_in) {
        this.settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
      }

      await this.saveSettings();

      new Notice('✅ Successfully authenticated with the service!', 4000);

      // Optional sanity check
      if (this.testAccessToken) {
        await this.testAccessToken();
      }

    } catch (err) {
      console.error('[Zoro] Authentication error:', err);
      new Notice(`❌ Authentication failed: ${err.message}`, 5000);
      if (this.showManualTokenOption) {
        this.showManualTokenOption(); // optional UI fallback
      }
    }
  }

export function async makeObsidianRequest(code, redirectUri) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret || '',
      redirect_uri: redirectUri,
      code: code
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };

    try {
      const response = await this.requestQueue.add(() => requestUrl({
  url: 'https://anilist.co/api/v2/oauth/token',
        method: 'POST',
        headers,
        body: body.toString()
      }));

      if (!response || typeof response.json !== 'object') {
        throw new Error('Invalid response structure from AniList.');
      }

      return response.json;

    } catch (err) {
      console.error('[Zoro] Obsidian requestUrl failed:', err);
      throw new Error('Failed to authenticate with AniList via Obsidian requestUrl.');
    }
  }
  
export function async testAccessToken() {
    const query = `
      query {
        Viewer {
          id
          name
        }
      }
    `;

    try {
      const response = await this.requestQueue.add(() => requestUrl({
  url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.accessToken}`
        },
        body: JSON.stringify({ query })
      }));

      const data = response.json;
      if (!data || !data.data?.Viewer) {
        throw new Error('Invalid access token or response malformed.');
      }

      const username = data.data.Viewer.name;
      new Notice(`🎉 Welcome, ${username}! Token is valid.`);
      return true;

    } catch (error) {
      console.warn('[Zoro] testAccessToken failed:', error);
      throw new Error('Token verification failed. Please check your token or re-authenticate.');
    }
  }

// Authenticated Username 
export function async getAuthenticatedUsername() {
  if (!this.settings.accessToken) return null;

  await this.ensureValidToken();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${this.settings.accessToken}`,
  };

  const query = `
    query {
      Viewer {
        name
      }
    }
  `;

  try {
    const response = await this.requestQueue.add(() =>
      requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      })
    );

    const data = response.json;

    if (!data?.data?.Viewer?.name) {
      throw new Error('Invalid token or no username returned.');
    }

    this.settings.authUsername = data.data.Viewer.name;
    await this.saveSettings();

    return data.data.Viewer.name;

  } catch (error) {
    console.warn('[Zoro] getAuthenticatedUsername() failed:', error);
    return null;
  }
  }