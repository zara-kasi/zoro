/**
 * SIMKL PIN-based authentication handler for Obsidian plugin
 * Migrated from SimklAuthentication.js → SimklAuthentication.ts
 * - Added comprehensive types for SIMKL API responses and PIN flow
 * - Typed polling mechanism for device authentication
 * - Added proper error handling and timeout management
 */

import type { Plugin, RequestUrlResponse } from 'obsidian';
import { Notice, requestUrl } from 'obsidian';

// SIMKL API response types
interface DeviceCodeResponse {
  user_code: string;
  device_code?: string;
  verification_url?: string;
  expires_in?: number;
  interval?: number;
}

interface PinCheckResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface SimklUser {
  name: string;
  description?: string;
  avatar?: string;
  url?: string;
  joined?: string;
  location?: string;
  age?: string;
  gender?: string;
}

interface SimklUserInfo {
  user?: SimklUser;
  account?: {
    id: number;
    timezone?: string;
  };
  connections?: {
    facebook?: boolean;
    google?: boolean;
    twitter?: boolean;
  };
  [key: string]: unknown;
}

// Plugin settings interface for SIMKL-specific fields
interface SimklPluginSettings {
  simklClientId: string;
  simklClientSecret: string;
  simklAccessToken: string;
  simklUserInfo: SimklUserInfo | null;
}

// Plugin interface with required methods and properties
interface ZoroPlugin extends Plugin {
  settings: SimklPluginSettings;
  cache?: {
    clear(scope?: string): void;
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

export class SimklAuthentication {
  private readonly plugin: ZoroPlugin;
  private pollInterval: NodeJS.Timeout | null = null;

  // SIMKL API endpoints
  static readonly SIMKL_PIN_URL = 'https://api.simkl.com/oauth/pin';
  static readonly SIMKL_PIN_CHECK_URL = 'https://api.simkl.com/oauth/pin/';
  static readonly SIMKL_USER_URL = 'https://api.simkl.com/users/settings';

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
  }

  get isLoggedIn(): boolean {
    return Boolean(this.plugin.settings.simklAccessToken);
  }

  get hasRequiredCredentials(): boolean {
    return Boolean(
      this.plugin.settings.simklClientId && 
      this.plugin.settings.simklClientSecret
    );
  }

  async loginWithFlow(): Promise<void> {
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
      // Step 1: Request device code
      const pinUrl = `${SimklAuthentication.SIMKL_PIN_URL}?client_id=${encodeURIComponent(this.plugin.settings.simklClientId)}&redirect_uri=${encodeURIComponent('obsidian://zoro-auth/')}`;
      
      const deviceResponse: RequestUrlResponse = await requestUrl({
        url: pinUrl,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'simkl-api-key': this.plugin.settings.simklClientId
        },
        throw: false
      });

      if (deviceResponse.status < 200 || deviceResponse.status >= 300) {
        throw new Error(`PIN request failed: HTTP ${deviceResponse.status}`);
      }

      const deviceData = deviceResponse.json as DeviceCodeResponse;
      
      if (!deviceData.user_code) {
        throw new Error('Invalid response: missing user_code');
      }

      // Step 2: Open browser to PIN page
      new Notice('🔐 Opening SIMKL PIN page…', 3000);
      const pinPageUrl = deviceData.verification_url || 'https://simkl.com/pin';
      
      // Open auth URL using standard web API (works in all Obsidian versions)
     window.open(pinPageUrl, '_blank');
     
      // Start polling for authentication
      this.startPolling(deviceData);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('SIMKL authentication failed:', error);
      new Notice(`❌ Authentication failed: ${errorMessage}`, 8000);
    }
  }

  private async startPolling(deviceData: DeviceCodeResponse): Promise<void> {
    const { user_code, interval = 5, expires_in = 900 } = deviceData;
    const maxAttempts = Math.floor(expires_in / interval);
    let attempts = 0;

    const poll = async (): Promise<void> => {
      attempts++;
      
      if (attempts > maxAttempts) {
        this.stopPolling();
        new Notice('❌ Authentication timeout. Please try again.', 8000);
        return;
      }

      try {
        const pollUrl = `${SimklAuthentication.SIMKL_PIN_CHECK_URL}${encodeURIComponent(user_code)}?client_id=${encodeURIComponent(this.plugin.settings.simklClientId)}`;

        const response: RequestUrlResponse = await requestUrl({
          url: pollUrl,
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'simkl-api-key': this.plugin.settings.simklClientId
          },
          throw: false
        });

        const data = (response.json || {}) as PinCheckResponse;

        if (data.access_token) {
          // Success! Store token and clean up
          this.plugin.settings.simklAccessToken = data.access_token;
          await this.plugin.saveSettings();
          
          // Close any SIMKL PIN modals
          this.closeSimklModals();
          
          this.stopPolling();
          
          // Fetch user info
          try {
            await this.fetchUserInfo();
            new Notice('✅ Authenticated successfully!', 4000);
          } catch (userError) {
            console.log('[SIMKL-AUTH] Failed to fetch user info but auth succeeded', userError);
            new Notice('✅ Authenticated successfully!', 4000);
          }

          // Update default API source if needed
          if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
            await this.plugin.updateDefaultApiSourceBasedOnAuth();
          }
          return;
        }

        // Continue polling if no token yet (404 or empty response is expected while waiting)
        if (response.status === 404 || !data || Object.keys(data).length === 0) {
          // User hasn't entered code yet, continue polling
          return;
        }

        // Handle error responses
        if (data.error) {
          this.stopPolling();
          new Notice(`❌ Authentication failed: ${data.error_description || data.error}`, 8000);
          return;
        }

      } catch (error) {
        console.error('Polling error:', error);
        // Continue polling on network errors
      }
    };

    // Start polling
    this.pollInterval = setInterval(poll, interval * 1000);
    
    // Do first poll after the specified interval
    setTimeout(poll, interval * 1000);
  }

  private closeSimklModals(): void {
    // Close any SIMKL PIN modals that might be open
    document.querySelectorAll('.modal-container').forEach((modal: Element) => {
      if (modal.querySelector('.simkl-pin-modal')) {
        (modal as HTMLElement).remove();
      }
    });
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async fetchUserInfo(): Promise<void> {
    const headers = this.getAuthHeaders();
    if (!headers) {
      throw new Error('Not authenticated');
    }

    const res: RequestUrlResponse = await requestUrl({
      url: SimklAuthentication.SIMKL_USER_URL,
      method: 'GET',
      headers,
      throw: false
    });
    
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not fetch user info (HTTP ${res.status})`);
    }
    
    this.plugin.settings.simklUserInfo = res.json as SimklUserInfo;
    await this.plugin.saveSettings();
  }

  async logout(): Promise<void> {
    // Stop any active polling
    this.stopPolling();

    // Clear all SIMKL authentication data
    this.plugin.settings.simklAccessToken = '';
    this.plugin.settings.simklUserInfo = null;
    this.plugin.settings.simklClientId = '';
    this.plugin.settings.simklClientSecret = '';
    
    await this.plugin.saveSettings();
    
    // Clear SIMKL-specific cache if available
    if (this.plugin.cache) {
      this.plugin.cache.clear('simklData');
    }
    
    new Notice('✅ Logged out from SIMKL & cleared credentials.', 3000);
  }

  async ensureValidToken(): Promise<boolean> {
    if (!this.isLoggedIn) {
      throw new Error('Not authenticated with SIMKL');
    }
    if (!this.hasRequiredCredentials) {
      throw new Error('Missing SIMKL client credentials');
    }
    return true;
  }
  
  async getAuthenticatedUsername(): Promise<string> {
    await this.ensureValidToken();

    if (!this.plugin.settings.simklUserInfo) {
      await this.fetchUserInfo();
    }

    const name = this.plugin.settings.simklUserInfo?.user?.name;
    if (!name) {
      throw new Error('Could not fetch SIMKL username');
    }
    
    return name;
  }

  getAuthHeaders(): Record<string, string> | null {
    if (!this.isLoggedIn || !this.hasRequiredCredentials) {
      return null;
    }
    
    return { 
      'Authorization': `Bearer ${this.plugin.settings.simklAccessToken}`,
      'simkl-api-key': this.plugin.settings.simklClientId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }; 
  }
  
  isAuthenticated(): boolean {
    return this.isLoggedIn && this.hasRequiredCredentials;
  }
  
  getUserInfo(): SimklUserInfo | null {
    return this.plugin.settings.simklUserInfo;
  }
}

export { SimklAuthentication };
