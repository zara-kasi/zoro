// Authentication Code

class AuthenticationManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.requestQueue = plugin.requestQueue;
    this.messageHandler = null;
  }

  // Main authentication method
  async authenticateUser() {
    const clientId = this.settings.clientId;
    const redirectUri = this.settings.redirectUri || 'https://anilist.co/api/v2/oauth/pin';
    
    if (!clientId?.trim()) {
      new Notice('❌ Please set your Client ID in plugin settings first.', 5000);
      return false;
    }

    // Check if already authenticated
    if (this.settings.accessToken) {
      const reuse = confirm('You are already authenticated. Do you want to re-authenticate?');
      if (!reuse) return false;
    }

    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;

    try {
      new Notice('🔐 Opening authentication page...', 3000);
      
      // Open authentication URL
      await this.openAuthUrl(authUrl);
      
      // Get authorization code from user
      const code = await this.promptForCode('Paste the PIN code from the authentication page:');
      
      if (!code?.trim()) {
        new Notice('⚠️ No code entered. Authentication cancelled.', 4000);
        return false;
      }

      // Exchange code for token
      await this.exchangeCodeForToken(code.trim(), redirectUri);
      
      // Test the token
      await this.testAccessToken();
      
      new Notice('✅ Authenticated successfully!', 4000);
      return true;

    } catch (error) {
      console.error('[Zoro] Authentication failed:', error);
      new Notice(`❌ Authentication error: ${error.message}`, 5000);
      return false;
    }
  }

  // Open authentication URL
  async openAuthUrl(authUrl) {
    try {
      // Try Electron first (desktop app)
      if (window.require) {
        const { shell } = window.require('electron');
        await shell.openExternal(authUrl);
      } else {
        // Fallback to regular browser
        window.open(authUrl, '_blank');
      }
    } catch (error) {
      console.error('[Zoro] Failed to open auth URL:', error);
      throw new Error('Failed to open authentication page. Please navigate manually to: ' + authUrl);
    }
  }

  // Prompt user for authorization code
  async promptForCode(message) {
    return new Promise((resolve) => {
      // Using setTimeout to avoid blocking the UI
      setTimeout(() => {
        const code = prompt(message);
        resolve(code);
      }, 100);
    });
  }

  // Exchange authorization code for access token
  async exchangeCodeForToken(code, redirectUri) {
    const clientId = this.settings.clientId;
    const clientSecret = this.settings.clientSecret;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      ...(clientSecret && { client_secret: clientSecret })
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
        console.error('[Zoro] Unexpected response:', response);
        throw new Error('Invalid response from authentication server');
      }

      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      if (!data.access_token) {
        throw new Error('No access token received from server');
      }

      // Store authentication data
      this.settings.accessToken = data.access_token;

      await this.plugin.saveSettings();
      
    } catch (error) {
      console.error('[Zoro] Token exchange failed:', error);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }



  // Ensure token is valid
  async ensureValidToken() {
    return Boolean(this.settings.accessToken);
  }



  // Test access token validity
  async testAccessToken() {
    if (!this.settings.accessToken) {
      throw new Error('No access token available');
    }

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

      const data = response?.json;
      
      if (data?.errors) {
        throw new Error(data.errors[0]?.message || 'GraphQL error');
      }

      if (!data?.data?.Viewer) {
        throw new Error('Invalid token or malformed response');
      }

      const username = data.data.Viewer.name;
      console.log(`[Zoro] Token valid for user: ${username}`);
      return { valid: true, username };

    } catch (error) {
      console.error('[Zoro] Token test failed:', error);
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  // Get authenticated username
  async getAuthenticatedUsername() {
    if (!this.settings.accessToken) {
      return null;
    }

    // Ensure token is valid
    const isValid = await this.ensureValidToken();
    if (!isValid) {
      return null;
    }

    const query = `
      query {
        Viewer {
          name
          id
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

      const data = response?.json;

      if (data?.errors) {
        console.error('[Zoro] GraphQL errors:', data.errors);
        return null;
      }

      if (!data?.data?.Viewer?.name) {
        console.error('[Zoro] No username in response');
        return null;
      }

      const username = data.data.Viewer.name;
      
      // Cache the username
      this.settings.authUsername = username;
      await this.plugin.saveSettings();

      return username;

    } catch (error) {
      console.error('[Zoro] Failed to get username:', error);
      return null;
    }
  }

  // Clear authentication data
  async clearAuthentication() {
    this.settings.accessToken = '';
    this.settings.refreshToken = '';
    this.settings.tokenExpiry = null;
    this.settings.authUsername = '';
    await this.plugin.saveSettings();
  }

  // Check if user is authenticated
  isAuthenticated() {
    return Boolean(this.settings.accessToken);
  }

  // Cleanup method
  destroy() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
  }
}