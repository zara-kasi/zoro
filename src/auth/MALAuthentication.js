import { Notice, requestUrl } from 'obsidian';
import { AuthModal } from './AuthModal.js';


class MALAuthentication {
  constructor(plugin) {
    this.plugin = plugin;
  }

  static MAL_AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize';
  static MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
  static MAL_USER_URL = 'https://api.myanimelist.net/v2/users/@me';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.malAccessToken && this.isTokenValid());
  }

  makeVerifier() {
    const arr = new Uint8Array(32);
    
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      try {
        crypto.getRandomValues(arr);
      } catch (e) {
        console.log('[MAL-AUTH] crypto.getRandomValues failed, using Math.random fallback', e);
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
      }
    } else {
      console.log('[MAL-AUTH] crypto.getRandomValues not available, using Math.random');
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
    }
    
    const verifier = btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 128);
    
    return verifier;
  }

  makeChallenge(verifier) {
    return verifier;
  }

  generateState() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      try {
        return crypto.randomUUID();
      } catch (e) {
        console.log('[MAL-AUTH] crypto.randomUUID failed, using fallback', e);
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
    if (!this.plugin.settings.malClientId) {
      new Notice('❌ Please enter your MAL Client ID first.', 5000);
      return;
    }
    
    if (this.isTokenValid()) {
      new Notice('Already authenticated with MyAnimeList', 3000);
      return;
    }

    this.verifier = this.makeVerifier();
    const challenge = this.makeChallenge(this.verifier);
    const state = this.generateState();

    this.authState = state;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.plugin.settings.malClientId,
      redirect_uri: 'http://localhost:8080/callback',
      code_challenge: challenge,
      code_challenge_method: 'plain',
      state: state
    });

    const authUrl = `${MALAuthentication.MAL_AUTH_URL}?${params.toString()}`;

    new Notice('🔐 Opening MyAnimeList login page…', 3000);
    if (window.require) {
      const { shell } = window.require('electron');
      await shell.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }

    const modal = AuthModal.malCallback(this.plugin.app, async (callbackUrl) => {
  const code = this.extractAuthCode(callbackUrl);
  if (!code) {
    new Notice('❌ Could not extract authorization code from URL', 5000);
    return;
  }
  await this.exchangeCodeForToken(code);
});
modal.open();
return;
  }

  extractAuthCode(input) {
    const trimmedInput = input.trim();
    
    if (!trimmedInput.includes('://') && !trimmedInput.includes('?') && !trimmedInput.includes('&')) {
      if (/^[A-Za-z0-9_-]{20,}$/.test(trimmedInput)) {
        return trimmedInput;
      }
    }
    
    let url;
    try {
      if (trimmedInput.startsWith('?')) {
        url = new URL('http://localhost' + trimmedInput);
      } else if (trimmedInput.includes('://')) {
        url = new URL(trimmedInput);
      } else {
        const codeMatch = trimmedInput.match(/[?&]code=([^&\s]+)/);
        if (codeMatch) {
          return decodeURIComponent(codeMatch[1]);
        }
        return null;
      }
    } catch (e) {
      const codeMatch = trimmedInput.match(/[?&]code=([^&\s]+)/);
      if (codeMatch) {
        return decodeURIComponent(codeMatch[1]);
      }
      return null;
    }
    
    const code = url.searchParams.get('code');
    if (code) {
      return decodeURIComponent(code);
    }
    
    const codeMatch = trimmedInput.match(/[?&]code=([^&\s]+)/);
    if (codeMatch) {
      return decodeURIComponent(codeMatch[1]);
    }
    
    return null;
  }

  async exchangeCodeForToken(code) {
    if (!code || code.length < 10) {
      throw new Error('Invalid authorization code');
    }

    new Notice('Exchanging authorization code for tokens…',6000);

    const body = new URLSearchParams({
      client_id: this.plugin.settings.malClientId,
      code: code,
      code_verifier: this.verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:8080/callback'
    });

    if (this.plugin.settings.malClientSecret && this.plugin.settings.malClientSecret.trim()) {
      body.append('client_secret', this.plugin.settings.malClientSecret.trim());
    }

    try {
      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: MALAuthentication.MAL_TOKEN_URL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: body.toString(),
          throw: false
        })
      );

      if (res.status < 200 || res.status >= 300) {
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
          
          if (errorData.error === 'invalid_client') {
            errorMsg += '\n\nTip: Check your Client ID and Secret in settings. For apps without a secret, leave the Client Secret field empty.';
          } else if (errorData.error === 'invalid_request') {
            errorMsg += '\n\nTip: Ensure your Redirect URI exactly matches what\'s registered in your MAL app settings.';
          } else if (errorData.error === 'invalid_grant') {
            errorMsg += '\n\nTip: The authorization code may have expired or been used already. Please try authenticating again.';
          }
        } catch (parseError) {
          errorMsg += `: ${errorText}`;
        }
        
        throw new Error(errorMsg);
      }

      let data;
      try {
        data = res.json || (res.text ? JSON.parse(res.text) : null);
      } catch (jsonError) {
        throw new Error('Invalid response from MyAnimeList server');
      }

      if (!data.access_token) {
        throw new Error('No access token received from MyAnimeList');
      }

      this.plugin.settings.malAccessToken = data.access_token;
      this.plugin.settings.malRefreshToken = data.refresh_token;
      this.plugin.settings.malTokenExpiry = Date.now() + (data.expires_in * 1000);
      await this.plugin.saveSettings();
      this.plugin.cache.invalidateByUser(this.plugin.settings.malUserInfo?.name);

      try {
        
      } catch (userError) {
        console.log('[MAL-AUTH] Failed to fetch user info but auth succeeded', userError);
        new Notice('✅ Complete Authentication', 4000);
      }
     if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
  await this.plugin.updateDefaultApiSourceBasedOnAuth();
}
    } catch (err) {
      new Notice(`❌ MAL Auth failed: ${err.message}`, 5000);
      throw err;
    }
  }

  async fetchUserInfo() {
    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: MALAuthentication.MAL_USER_URL,
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${this.plugin.settings.malAccessToken}`
        },
        throw: false
      })
    );
    
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not fetch user info (HTTP ${res.status})`);
    }
    
    this.plugin.settings.malUserInfo = res.json || (res.text ? JSON.parse(res.text) : null);
    await this.plugin.saveSettings();
  }

  async refreshAccessToken() {
    if (!this.plugin.settings.malRefreshToken) {
      throw new Error('No refresh token available');
    }
    
    const body = new URLSearchParams({
      client_id: this.plugin.settings.malClientId,
      refresh_token: this.plugin.settings.malRefreshToken,
      grant_type: 'refresh_token'
    });

    if (this.plugin.settings.malClientSecret && this.plugin.settings.malClientSecret.trim()) {
      body.append('client_secret', this.plugin.settings.malClientSecret.trim());
    }

    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: MALAuthentication.MAL_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        throw: false
      })
    );

    if (res.status < 200 || res.status >= 300) {
      const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
      throw new Error(`Token refresh failed (HTTP ${res.status}): ${errorText}`);
    }

    const data = res.json || (res.text ? JSON.parse(res.text) : null);
    this.plugin.settings.malAccessToken = data.access_token;
    this.plugin.settings.malRefreshToken = data.refresh_token || this.plugin.settings.malRefreshToken;
    this.plugin.settings.malTokenExpiry = Date.now() + (data.expires_in * 1000);
    await this.plugin.saveSettings();
  }

  isTokenValid() {
    return !!(this.plugin.settings.malAccessToken && 
              this.plugin.settings.malTokenExpiry && 
              Date.now() < (this.plugin.settings.malTokenExpiry - 5 * 60 * 1000));
  }

  async checkTokenExpiry() {
    if (this.isTokenValid()) return;
    if (!this.plugin.settings.malRefreshToken) {
      console.log('[MAL-AUTH] Token expired and no refresh token available');
      return;
    }
    
    try {
      await this.refreshAccessToken();
      console.log('[MAL-AUTH] Token automatically refreshed');
    } catch (e) {
      console.error('[MAL-AUTH] Automatic token refresh failed', e);
      new Notice('MAL authentication expired. Please re-authenticate.', 5000);
    }
  }

  async logout() {
    this.plugin.settings.malAccessToken = '';
    this.plugin.settings.malRefreshToken = '';
    this.plugin.settings.malTokenExpiry = null;
    this.plugin.settings.malUserInfo = null;
    this.plugin.settings.malClientId = '';
    this.plugin.settings.malClientSecret = '';
    await this.plugin.saveSettings();
    if (this.plugin.settings.malUserInfo?.name) {
    this.plugin.cache.invalidateByUser(this.plugin.settings.malUserInfo.name);
   }
    
   this.plugin.cache.clear('malData');
   this.plugin.cache.clear();
    new Notice('✅ Logged out from MyAnimeList & cleared credentials.', 3000);
  }

  

  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated with MyAnimeList');
    await this.checkTokenExpiry();
    return true;
  }
  
  async getAuthenticatedUsername() {
    await this.ensureValidToken();

    if (!this.plugin.settings.malUserInfo) {
      await this.fetchUserInfo();
    }

    const name = this.plugin.settings.malUserInfo?.name;
    if (!name) throw new Error('Could not fetch MAL username');
    return name;
  }

  getAuthHeaders() { 
    return this.isTokenValid() ? { Authorization: `Bearer ${this.plugin.settings.malAccessToken}` } : null; 
  }
  
  isAuthenticated() { 
    return this.isTokenValid(); 
  }
  
  getUserInfo() { 
    return this.plugin.settings.malUserInfo; 
  }
}

export { MALAuthentication };