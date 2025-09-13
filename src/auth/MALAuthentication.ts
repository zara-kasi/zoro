/**
 * MyAnimeList OAuth2 PKCE authentication handler for Obsidian plugin
 * Migrated from MALAuthentication.js → MALAuthentication.ts
 * - Added comprehensive types for OAuth2 PKCE flow and MAL API responses
 * - Typed plugin integration with proper error handling
 * - Added token management and refresh logic with proper typing
 */

import type { Plugin, RequestUrlResponse } from 'obsidian';
import { Notice, requestUrl } from 'obsidian';

// OAuth2 and MAL API response types
interface OAuthRedirectParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  url?: string;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface MALUserInfo {
  id: number;
  name: string;
  picture?: string;
  gender?: string;
  birthday?: string;
  location?: string;
  joined_at: string;
  anime_statistics?: {
    num_items_watching: number;
    num_items_completed: number;
    num_items_on_hold: number;
    num_items_dropped: number;
    num_items_plan_to_watch: number;
    num_items: number;
    num_days_watched: number;
    num_days_watching: number;
    num_days_completed: number;
    num_days_on_hold: number;
    num_days_dropped: number;
    num_days: number;
    num_episodes: number;
    num_times_rewatched: number;
    mean_score: number;
  };
  time_zone?: string;
  is_supporter?: boolean;
}

interface ErrorResponse {
  error: string;
  error_description?: string;
  [key: string]: unknown;
}

// Plugin settings interface for MAL-specific fields
interface MALPluginSettings {
  malClientId: string;
  malClientSecret: string;
  malAccessToken: string;
  malRefreshToken: string;
  malTokenExpiry: number | null;
  malUserInfo: MALUserInfo | null;
}

// Plugin interface with required methods and properties
interface ZoroPlugin extends Plugin {
  settings: MALPluginSettings;
  cache: {
    invalidateByUser(username: string): void;
    clear(scope?: string): void;
  };
  requestQueue: {
    add<T>(fn: () => Promise<T>): Promise<T>;
  };
  saveSettings(): Promise<void>;
  updateDefaultApiSourceBasedOnAuth?(): Promise<void>;
}

// Electron shell interface for external URL opening
interface ElectronShell {
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    require?: (module: 'electron') => { shell: ElectronShell };
  }
}

export class MALAuthentication {
  private readonly plugin: ZoroPlugin;
  private verifier?: string;
  private authState?: string;

  // MAL OAuth2 endpoints
  static readonly MAL_AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize';
  static readonly MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
  static readonly MAL_USER_URL = 'https://api.myanimelist.net/v2/users/@me';

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
  }

  get isLoggedIn(): boolean {
    return Boolean(this.plugin.settings.malAccessToken && this.isTokenValid());
  }

  private makeVerifier(): string {
    const arr = new Uint8Array(32);
    
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      try {
        crypto.getRandomValues(arr);
      } catch (e) {
        console.log('[MAL-AUTH] crypto.getRandomValues failed, using Math.random fallback', e);
        this.fillArrayWithMathRandom(arr);
      }
    } else {
      console.log('[MAL-AUTH] crypto.getRandomValues not available, using Math.random');
      this.fillArrayWithMathRandom(arr);
    }
    
    const verifier = btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 128);
    
    return verifier;
  }

  private fillArrayWithMathRandom(arr: Uint8Array): void {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }

  private makeChallenge(verifier: string): string {
    // MAL uses plain challenge method, so challenge = verifier
    return verifier;
  }

  private generateState(): string {
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

  async loginWithFlow(): Promise<void> {
    if (!this.plugin.settings.malClientId) {
      new Notice('❌ Please enter your MAL Client ID first.', 5000);
      return;
    }
    
    if (this.isTokenValid()) {
      new Notice('Already authenticated with MyAnimeList', 3000);
      return;
    }

    // Generate and store PKCE parameters
    this.verifier = this.makeVerifier();
    const challenge = this.makeChallenge(this.verifier);
    const state = this.generateState() + '_mal'; // Add _mal marker

    this.authState = state;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.plugin.settings.malClientId,
      redirect_uri: 'obsidian://zoro-auth/',
      code_challenge: challenge,
      code_challenge_method: 'plain',
      state: state
    });

    const authUrl = `${MALAuthentication.MAL_AUTH_URL}?${params.toString()}`;

    new Notice('🔐 Opening MyAnimeList login page…', 3000);

    // Try Electron shell first, fallback to window.open
    if (window.require) {
      try {
        const { shell } = window.require('electron');
        await shell.openExternal(authUrl);
      } catch (error) {
        console.warn('[MAL-AUTH] Electron shell failed, using fallback:', error);
        window.open(authUrl, '_blank');
      }
    } else {
      window.open(authUrl, '_blank');
    }
  }

  async handleOAuthRedirect(params: OAuthRedirectParams | string): Promise<void> {
    try {
      console.log('[MAL Auth] Received OAuth redirect:', params);
      
      let code: string | null = null;
      
      // Extract authorization code from various parameter formats
      if (typeof params === 'object' && params.code) {
        code = params.code;
      } else if (typeof params === 'string') {
        const urlParams = new URLSearchParams(params.startsWith('?') ? params.slice(1) : params);
        code = urlParams.get('code');
      } else if (typeof params === 'object' && params.url) {
        try {
          const url = new URL(params.url);
          code = url.searchParams.get('code');
        } catch (e) {
          console.warn('[MAL Auth] Failed to parse URL from params:', e);
        }
      }
      
      if (!code) {
        const error = typeof params === 'object' ? params.error || 'Unknown error' : 'Unknown error';
        const errorDesc = typeof params === 'object' ? params.error_description || 'No authorization code received' : 'No authorization code received';
        console.error('[MAL Auth] OAuth error:', { error, errorDesc });
        new Notice(`❌ MAL Authentication failed: ${errorDesc}`, 5000);
        return;
      }

      await this.exchangeCodeForToken(code);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[MAL Auth] Failed to handle OAuth redirect:', error);
      new Notice(`❌ MAL Authentication failed: ${errorMessage}`, 5000);
    }
  }

  async exchangeCodeForToken(code: string): Promise<void> {
    if (!code || code.length < 10) {
      throw new Error('Invalid authorization code');
    }

    if (!this.verifier) {
      throw new Error('No code verifier available - please restart the authentication flow');
    }

    new Notice('Exchanging authorization code for tokens…', 2000);

    const body = new URLSearchParams({
      client_id: this.plugin.settings.malClientId,
      code: code,
      code_verifier: this.verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'obsidian://zoro-auth/'
    });

    // Add client secret if available (optional for public clients)
    if (this.plugin.settings.malClientSecret && this.plugin.settings.malClientSecret.trim()) {
      body.append('client_secret', this.plugin.settings.malClientSecret.trim());
    }

    try {
      const res: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
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
        let errorMsg = `Token exchange failed (HTTP ${res.status})`;
        
        try {
          const errorData = (res.json || (res.text ? JSON.parse(res.text) : {})) as ErrorResponse;
          
          if (errorData.error) {
            errorMsg += `: ${errorData.error}`;
            if (errorData.error_description) {
              errorMsg += ` - ${errorData.error_description}`;
            }
            
            // Add helpful error tips
            if (errorData.error === 'invalid_client') {
              errorMsg += '\n\nTip: Check your Client ID and Secret in settings. For apps without a secret, leave the Client Secret field empty.';
            } else if (errorData.error === 'invalid_request') {
              errorMsg += '\n\nTip: Ensure your Redirect URI exactly matches what\'s registered in your MAL app settings.';
            } else if (errorData.error === 'invalid_grant') {
              errorMsg += '\n\nTip: The authorization code may have expired or been used already. Please try authenticating again.';
            }
          } else {
            const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
            errorMsg += `: ${errorText}`;
          }
        } catch (parseError) {
          const errorText = res.text || JSON.stringify(res.json) || 'Unknown error';
          errorMsg += `: ${errorText}`;
        }
        
        throw new Error(errorMsg);
      }

      // Parse token response
      let data: TokenResponse;
      try {
        data = res.json || (res.text ? JSON.parse(res.text) : null);
      } catch (jsonError) {
        throw new Error('Invalid response from MyAnimeList server');
      }

      if (!data || !data.access_token) {
        throw new Error('No access token received from MyAnimeList');
      }

      // Save tokens and expiry
      this.plugin.settings.malAccessToken = data.access_token;
      this.plugin.settings.malRefreshToken = data.refresh_token || '';
      this.plugin.settings.malTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
      
      await this.plugin.saveSettings();
      
      // Invalidate existing user cache
      if (this.plugin.settings.malUserInfo?.name) {
        this.plugin.cache.invalidateByUser(this.plugin.settings.malUserInfo.name);
      }

      new Notice('✅ Authenticated successfully!', 4000);
      
      // Fetch user info
      try {
        await this.fetchUserInfo();
      } catch (userError) {
        console.log('[MAL-AUTH] Failed to fetch user info but auth succeeded', userError);
      }
      
      // Update default API source if needed
      if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
        await this.plugin.updateDefaultApiSourceBasedOnAuth();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      new Notice(`❌ MAL Auth failed: ${errorMessage}`, 5000);
      throw err;
    }
  }

  async fetchUserInfo(): Promise<void> {
    const res: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
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

  async refreshAccessToken(): Promise<void> {
    if (!this.plugin.settings.malRefreshToken) {
      throw new Error('No refresh token available');
    }
    
    const body = new URLSearchParams({
      client_id: this.plugin.settings.malClientId,
      refresh_token: this.plugin.settings.malRefreshToken,
      grant_type: 'refresh_token'
    });

    // Add client secret if available
    if (this.plugin.settings.malClientSecret && this.plugin.settings.malClientSecret.trim()) {
      body.append('client_secret', this.plugin.settings.malClientSecret.trim());
    }

    const res: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
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

    const data = res.json || (res.text ? JSON.parse(res.text) : null) as TokenResponse;
    if (!data || !data.access_token) {
      throw new Error('No access token in refresh response');
    }

    this.plugin.settings.malAccessToken = data.access_token;
    this.plugin.settings.malRefreshToken = data.refresh_token || this.plugin.settings.malRefreshToken;
    this.plugin.settings.malTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    
    await this.plugin.saveSettings();
  }

  isTokenValid(): boolean {
    return !!(
      this.plugin.settings.malAccessToken && 
      this.plugin.settings.malTokenExpiry && 
      Date.now() < (this.plugin.settings.malTokenExpiry - 5 * 60 * 1000) // 5 minute buffer
    );
  }

  async checkTokenExpiry(): Promise<void> {
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

  async logout(): Promise<void> {
    // Store username before clearing for cache invalidation
    const currentUsername = this.plugin.settings.malUserInfo?.name;

    // Clear all MAL authentication data
    this.plugin.settings.malAccessToken = '';
    this.plugin.settings.malRefreshToken = '';
    this.plugin.settings.malTokenExpiry = null;
    this.plugin.settings.malUserInfo = null;
    this.plugin.settings.malClientId = '';
    this.plugin.settings.malClientSecret = '';
    
    await this.plugin.saveSettings();
    
    // Invalidate user-specific cache data
    if (currentUsername) {
      this.plugin.cache.invalidateByUser(currentUsername);
    }
    
    // Clear MAL-specific cache scopes
    this.plugin.cache.clear('malData');
    this.plugin.cache.clear();
    
    new Notice('✅ Logged out from MyAnimeList & cleared credentials.', 3000);
  }

  async ensureValidToken(): Promise<boolean> {
    if (!this.isLoggedIn) {
      throw new Error('Not authenticated with MyAnimeList');
    }
    
    await this.checkTokenExpiry();
    return true;
  }
  
  async getAuthenticatedUsername(): Promise<string> {
    await this.ensureValidToken();

    if (!this.plugin.settings.malUserInfo) {
      await this.fetchUserInfo();
    }

    const name = this.plugin.settings.malUserInfo?.name;
    if (!name) {
      throw new Error('Could not fetch MAL username');
    }
    
    return name;
  }

  getAuthHeaders(): { Authorization: string } | null {
    return this.isTokenValid() 
      ? { Authorization: `Bearer ${this.plugin.settings.malAccessToken}` }
      : null;
  }
  
  isAuthenticated(): boolean {
    return this.isTokenValid();
  }
  
  getUserInfo(): MALUserInfo | null {
    return this.plugin.settings.malUserInfo;
  }
}

export { MALAuthentication };
