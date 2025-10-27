import { Notice, requestUrl } from 'obsidian';

class SimklAuthentication {
  constructor(plugin) {
    this.plugin = plugin;
    this.authState = null; // Store state for CSRF protection
  }

  // Constants
  static SIMKL_AUTH_URL = 'https://simkl.com/oauth/authorize';
  static SIMKL_TOKEN_URL = 'https://api.simkl.com/oauth/token';
  static SIMKL_USER_URL = 'https://api.simkl.com/users/settings';
  static REDIRECT_URI = 'obsidian://zoro-auth/simkl';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.simklAccessToken);
  }

  get hasRequiredCredentials() {
    return Boolean(this.plugin.settings.simklClientId && this.plugin.settings.simklClientSecret);
  }

  // Generate random state for CSRF protection
  generateState() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      try {
        return crypto.randomUUID();
      } catch (e) {
        console.warn('[SIMKL Auth] crypto.randomUUID failed, using fallback', e);
      }
    }
    
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async loginWithFlow() {
    if (!this.plugin.settings.simklClientId) {
      new Notice('❌ Please enter your SIMKL Client ID first.', 5000);
      return;
    }

    if (!this.plugin.settings.simklClientSecret) {
      new Notice('❌ Please enter your SIMKL Client Secret first.', 5000);
      return;
    }

    if (this.isLoggedIn) {
      new Notice('Already authenticated with SIMKL', 3000);
      return;
    }

    try {
      // Generate state parameter for CSRF protection
      const state = this.generateState();
      this.authState = state;

      // Build authorization URL
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: this.plugin.settings.simklClientId,
        redirect_uri: SimklAuthentication.REDIRECT_URI,
        state: state
      });

      const authUrl = `${SimklAuthentication.SIMKL_AUTH_URL}?${params.toString()}`;

      new Notice('🔐 Opening SIMKL login page…', 3000);
      
      // Open in external browser
      if (window.require) {
        const { shell } = window.require('electron');
        await shell.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }

    } catch (error) {
      console.error('[SIMKL Auth] Failed to start auth flow:', error);
      new Notice(`❌ Authentication failed: ${error.message}`, 5000);
    }
  }

  async handleOAuthRedirect(params) {
    try {
      console.log('[SIMKL Auth] Received OAuth redirect:', params);
      
      const { code, state } = this.extractOAuthParams(params);
      
      // Validate state to prevent CSRF
      if (!this.authState || state !== this.authState) {
        throw new Error('State mismatch - possible CSRF attack');
      }
      
      if (!code) {
        const error = params.error || 'Unknown error';
        const errorDesc = params.error_description || 'No authorization code received';
        console.error('[SIMKL Auth] OAuth error:', { error, errorDesc });
        new Notice(`❌ SIMKL Authentication failed: ${errorDesc}`, 5000);
        return;
      }

      await this.exchangeCodeForToken(code);
      
    } catch (error) {
      console.error('[SIMKL Auth] Failed to handle OAuth redirect:', error);
      new Notice(`❌ SIMKL Authentication failed: ${error.message}`, 5000);
    }
  }

  extractOAuthParams(params) {
    let code = null;
    let state = null;
    
    if (params.code) {
      code = params.code;
      state = params.state || null;
    } else if (typeof params === 'string') {
      const urlParams = new URLSearchParams(params.startsWith('?') ? params.slice(1) : params);
      code = urlParams.get('code');
      state = urlParams.get('state');
    } else if (params.url) {
      try {
        const url = new URL(params.url);
        code = url.searchParams.get('code');
        state = url.searchParams.get('state');
      } catch (e) {
        console.warn('[SIMKL Auth] Failed to parse URL from params:', e);
      }
    }
    
    return { code, state };
  }

  async exchangeCodeForToken(code) {
    if (!code || code.length < 10) {
      throw new Error('Invalid authorization code');
    }

    new Notice('Exchanging authorization code for tokens…', 2000);

    const body = {
      code: code,
      client_id: this.plugin.settings.simklClientId,
      client_secret: this.plugin.settings.simklClientSecret,
      redirect_uri: SimklAuthentication.REDIRECT_URI,
      grant_type: 'authorization_code'
    };

    try {
      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: SimklAuthentication.SIMKL_TOKEN_URL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          throw: false
        })
      );

      if (res.status < 200 || res.status >= 300) {
        throw new Error(this.formatTokenError(res));
      }

      const data = res.json || JSON.parse(res.text);

      if (!data.access_token) {
        throw new Error('No access token received from SIMKL');
      }

      // Save tokens
      this.plugin.settings.simklAccessToken = data.access_token;
      await this.plugin.saveSettings();

      // Clear temporary state
      this.authState = null;

      new Notice('✅ Authenticated successfully!', 4000);
      
          // Refresh settings UI after Authentication
    this.plugin.refreshSettingsUI();
      
      // Fetch user info
      try {
        await this.fetchUserInfo();
      } catch (userError) {
        console.warn('[SIMKL Auth] Failed to fetch user info but auth succeeded', userError);
      }
      
      // Update default API source if needed
      if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
        await this.plugin.updateDefaultApiSourceBasedOnAuth();
      }
      
    } catch (err) {
      new Notice(`❌ SIMKL Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  formatTokenError(res) {
    const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
    let errorMsg = `Token exchange failed (HTTP ${res.status})`;
    
    try {
      const errorData = res.json || (res.text ? JSON.parse(res.text) : {});
      
      if (errorData.error) {
        errorMsg += `: ${errorData.error}`;
        if (errorData.error_description) {
          errorMsg += ` - ${errorData.error_description}`;
        }
      }
      
      // Add helpful tips
      if (errorData.error === 'invalid_client') {
        errorMsg += '\n\nTip: Check your Client ID and Secret in settings.';
      } else if (errorData.error === 'invalid_grant') {
        errorMsg += '\n\nTip: The authorization code may have expired. Please try again.';
      }
    } catch (parseError) {
      errorMsg += `: ${errorText}`;
    }
    
    return errorMsg;
  }

  async fetchUserInfo() {
    const headers = this.getAuthHeaders();
    if (!headers) {
      throw new Error('Not authenticated with SIMKL');
    }

    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: SimklAuthentication.SIMKL_USER_URL,
        method: 'GET',
        headers,
        throw: false
      })
    );
    
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not fetch SIMKL user info (HTTP ${res.status})`);
    }
    
    const fullResponse = res.json || JSON.parse(res.text);
    
    // Extract only necessary fields (consistent with MAL format)
    this.plugin.settings.simklUserInfo = {
      id: fullResponse.user?.id || fullResponse.account?.id,
      name: fullResponse.user?.name,
      picture: fullResponse.user?.avatar || fullResponse.user?.avatar_url
    };
    
    await this.plugin.saveSettings();
  }

  async logout() {
    this.plugin.settings.simklAccessToken = '';
    this.plugin.settings.simklUserInfo = null;
    this.plugin.settings.simklClientId = '';
    this.plugin.settings.simklClientSecret = '';
    await this.plugin.saveSettings();
    
    // Clear any SIMKL-specific cache
    if (this.plugin.cache) {
      this.plugin.cache.clear('simklData');
      this.plugin.cache.clear();
    }
    
    new Notice('✅ Logged out from SIMKL & cleared credentials.', 3000);
  }

  async ensureValidToken() {
    if (!this.isLoggedIn) {
      throw new Error('Not authenticated with SIMKL');
    }
    if (!this.hasRequiredCredentials) {
      throw new Error('Missing SIMKL client credentials');
    }
    return true;
  }
  
  async getAuthenticatedUsername() {
    await this.ensureValidToken();

    if (!this.plugin.settings.simklUserInfo) {
      await this.fetchUserInfo();
    }

    const name = this.plugin.settings.simklUserInfo?.name;
    if (!name) throw new Error('Could not fetch SIMKL username');
    return name;
  }

  getAuthHeaders() { 
    if (!this.isLoggedIn || !this.hasRequiredCredentials) return null;
    
    return { 
      'Authorization': `Bearer ${this.plugin.settings.simklAccessToken}`,
      'simkl-api-key': this.plugin.settings.simklClientId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }; 
  }
  
  isAuthenticated() { 
    return this.isLoggedIn && this.hasRequiredCredentials; 
  }
  
  getUserInfo() { 
    return this.plugin.settings.simklUserInfo; 
  }
}

export { SimklAuthentication };
