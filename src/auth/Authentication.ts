import type { Plugin, RequestUrlResponse } from 'obsidian';
import { Notice, requestUrl, Modal } from 'obsidian';
import { AuthModal } from './AuthModal';

// OAuth and API response types
interface OAuthRedirectParams {
  code?: string;
  error?: string;
  error_description?: string;
  url?: string;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

interface ViewerResponse {
  data?: {
    Viewer?: {
      id: number;
      name: string;
      mediaListOptions?: {
        scoreFormat: ScoreFormat;
      };
    };
  };
  errors?: Array<{
    message: string;
    status: number;
    [key: string]: unknown;
  }>;
}

interface UpdateUserResponse {
  data?: {
    UpdateUser?: {
      id: number;
      name: string;
      mediaListOptions: {
        scoreFormat: ScoreFormat;
      };
    };
  };
  errors?: Array<{
    message: string;
    [key: string]: unknown;
  }>;
}

type ScoreFormat = 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5' | 'POINT_3';

// Plugin settings interface (minimal subset needed for auth)
interface PluginSettings {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  tokenExpiry: number;
  authUsername: string;
  anilistUsername: string;
  forceScoreFormat: boolean;
}

// Plugin interface with required methods and properties
interface ZoroPlugin extends Plugin {
  settings: PluginSettings;
  cache: {
    invalidateByUser(username: string): void;
    clear(): void;
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

export class Authentication {
  private readonly plugin: ZoroPlugin;

  // OAuth endpoints
  static readonly ANILIST_AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';
  static readonly ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
  static readonly REDIRECT_URI = 'https://anilist.co/api/v2/oauth/pin';

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
  }

  get isLoggedIn(): boolean {
    return Boolean(this.plugin.settings.accessToken);
  }

  async loginWithFlow(): Promise<void> {
    if (!this.plugin.settings.clientId) {
      new Notice('❌ Please enter your Client ID first.', 5000);
      return;
    }

    const { clientId } = this.plugin.settings;
    const authUrl =
      `${Authentication.ANILIST_AUTH_URL}?` +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'obsidian://zoro-auth/',
        response_type: 'code'
      }).toString();

    new Notice('🔐 Opening AniList login page…', 3000);

    // Open auth URL using standard web API (works in all Obsidian versions)
   window.open(authUrl, '_blank');
  }

  async handleOAuthRedirect(params: OAuthRedirectParams | string): Promise<void> {
    try {
      console.log('[Zoro Auth] Received OAuth redirect:', params);
      
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
          console.warn('[Zoro Auth] Failed to parse URL from params:', e);
        }
      }
      
      if (!code) {
        const error = typeof params === 'object' ? params.error || 'Unknown error' : 'Unknown error';
        const errorDesc = typeof params === 'object' ? params.error_description || 'No authorization code received' : 'No authorization code received';
        console.error('[Zoro Auth] OAuth error:', { error, errorDesc });
        new Notice(`❌ Authentication failed: ${errorDesc}`, 5000);
        return;
      }

      await this.exchangePin(code);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Zoro Auth] Failed to handle OAuth redirect:', error);
      new Notice(`❌ Authentication failed: ${errorMessage}`, 5000);
    }
  }

  async logout(): Promise<void> {
    // Store username before clearing for cache invalidation
    const currentUsername = this.plugin.settings.authUsername;

    // Clear all authentication data
    this.plugin.settings.accessToken = '';
    this.plugin.settings.tokenExpiry = 0;
    this.plugin.settings.authUsername = '';
    this.plugin.settings.anilistUsername = '';
    this.plugin.settings.clientId = '';
    this.plugin.settings.clientSecret = '';
    
    await this.plugin.saveSettings();
    
    // Invalidate user-specific cache data
    if (currentUsername) {
      this.plugin.cache.invalidateByUser(currentUsername);
    }
    
    this.plugin.cache.clear();
    new Notice('✅ Logged out & cleared credentials.', 3000);
  }

  async exchangePin(pin: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: pin.trim(),
      client_id: this.plugin.settings.clientId,
      client_secret: this.plugin.settings.clientSecret || '',
      redirect_uri: 'obsidian://zoro-auth/'
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    };

    try {
      const res: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: Authentication.ANILIST_TOKEN_URL,
          method: 'POST',
          headers,
          body: body.toString()
        })
      );

      // Type guard for token response
      const data = res.json as TokenResponse;
      if (!data?.access_token) {
        throw new Error(data.error_description || data.error || 'No token returned');
      }

      // Store token and expiry
      this.plugin.settings.accessToken = data.access_token;
      if (data.expires_in) {
        this.plugin.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
      }
      
      // Fetch and store username immediately after successful token exchange
      try {
        await this.getAuthenticatedUsername();
      } catch (usernameError) {
        console.warn('Failed to fetch username during authentication:', usernameError);
        // Continue with authentication flow even if username fetch fails
      }
      
      await this.plugin.saveSettings();
      
      // Invalidate existing user cache
      if (this.plugin.settings.anilistUsername) {
        this.plugin.cache.invalidateByUser(this.plugin.settings.anilistUsername);
      }

      // Post-authentication setup
      await this.forceScoreFormat();
      if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
        await this.plugin.updateDefaultApiSourceBasedOnAuth();
      }
      
      new Notice('✅ Authenticated successfully!', 4000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Auth failed: ${errorMessage}`, 5000);
      throw err;
    }
  }

  async ensureValidToken(): Promise<boolean> {
    if (!this.isLoggedIn) {
      throw new Error('Not authenticated');
    }
    
    // TODO: Add token expiry check and refresh logic
    return true;
  }
  
  async forceScoreFormat(): Promise<void> {
    if (!this.plugin.settings.forceScoreFormat) return;
    
    await this.ensureValidToken();
    
    // Query current score format
    const viewerQuery = `
      query {
        Viewer {
          id
          name
          mediaListOptions {
            scoreFormat
          }
        }
      }
    `;

    try {
      const currentResponse: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.plugin.settings.accessToken}`
          },
          body: JSON.stringify({ query: viewerQuery })
        })
      );

      const viewerData = currentResponse.json as ViewerResponse;
      if (viewerData.errors) {
        throw new Error(viewerData.errors[0]?.message || 'Failed to fetch current score format');
      }

      const currentFormat = viewerData.data?.Viewer?.mediaListOptions?.scoreFormat;
      console.log('Current score format:', currentFormat);

      if (currentFormat === 'POINT_10') {
        console.log('Score format already set to POINT_10');
        return;
      }
      
      // Update score format to POINT_10
      const mutation = `
        mutation {
          UpdateUser(scoreFormat: POINT_10) {
            id
            name
            mediaListOptions {
              scoreFormat
            }
          }
        }
      `;

      const response: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.plugin.settings.accessToken}`
          },
          body: JSON.stringify({ query: mutation })
        })
      );

      const updateData = response.json as UpdateUserResponse;
      if (updateData.errors) {
        const errorMsg = updateData.errors[0]?.message || 'Unknown error';
        console.error('UpdateUser error:', updateData.errors);
        throw new Error(errorMsg);
      }
      
      const updatedFormat = updateData.data?.UpdateUser?.mediaListOptions?.scoreFormat;
      console.log('Updated score format to:', updatedFormat);
      
      if (updatedFormat === 'POINT_10') {
        new Notice('✅ Score format updated to 0-10 scale', 3000);
      } else {
        throw new Error(`Score format not updated properly. Got: ${updatedFormat}`);
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Could not update score format: ${errorMessage}`, 5000);
    }
  }
 
  async getAuthenticatedUsername(): Promise<string> {
    // Return cached username if available
    if (this.plugin.settings.anilistUsername) {
      return this.plugin.settings.anilistUsername;
    }

    await this.ensureValidToken();

    const query = `query { Viewer { name } }`;
    
    try {
      const res: RequestUrlResponse = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.plugin.settings.accessToken}`
          },
          body: JSON.stringify({ query })
        })
      );

      const viewerData = res.json as ViewerResponse;
      if (viewerData.errors) {
        throw new Error(viewerData.errors[0]?.message || 'Failed to fetch user data');
      }

      const name = viewerData.data?.Viewer?.name;
      if (!name) {
        throw new Error('Could not fetch username - no name in response');
      }
      
      // Store username in both settings fields
      this.plugin.settings.authUsername = name;
      this.plugin.settings.anilistUsername = name;
      await this.plugin.saveSettings();
      
      return name;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch authenticated username: ${errorMessage}`);
    }
  }
}
