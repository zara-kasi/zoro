const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');


class SimklAuthentication {
  constructor(plugin) {
    this.plugin = plugin;
    this.pollInterval = null;
  }

  static SIMKL_PIN_URL = 'https://api.simkl.com/oauth/pin';
  static SIMKL_PIN_CHECK_URL = 'https://api.simkl.com/oauth/pin/';
  static SIMKL_USER_URL = 'https://api.simkl.com/users/settings';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.simklAccessToken);
  }

  get hasRequiredCredentials() {
    return Boolean(this.plugin.settings.simklClientId && this.plugin.settings.simklClientSecret);
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
      // Step 1: Request device code
      const pinUrl = `${SimklAuthentication.SIMKL_PIN_URL}?client_id=${encodeURIComponent(this.plugin.settings.simklClientId)}&redirect_uri=${encodeURIComponent('urn:ietf:wg:oauth:2.0:oob')}`;
      
      const deviceResponse = await requestUrl({
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

      const deviceData = deviceResponse.json;
      
      if (!deviceData.user_code) {
        throw new Error('Invalid response: missing user_code');
      }

      // Step 2: Open browser to PIN page
      new Notice('🔐 Opening SIMKL PIN page…', 3000);
      const pinPageUrl = deviceData.verification_url || 'https://simkl.com/pin';
      
      if (window.require) {
        const { shell } = window.require('electron');
        await shell.openExternal(pinPageUrl);
      } else {
        window.open(pinPageUrl, '_blank');
      }

      // Step 3: Show PIN in modal and start polling
      const modal = new SimklPinModal(this.plugin.app, deviceData, async () => {
        // User clicked cancel
        this.stopPolling();
      });
      modal.open();

      // Start polling for authentication
      this.startPolling(deviceData);

    } catch (error) {
      console.error('SIMKL authentication failed:', error);
      new Notice(`❌ Authentication failed: ${error.message}`, 8000);
    }
  }

  async startPolling(deviceData) {
    const { user_code, interval = 5, expires_in = 900 } = deviceData;
    const maxAttempts = Math.floor(expires_in / interval);
    let attempts = 0;

    const poll = async () => {
      attempts++;
      
      if (attempts > maxAttempts) {
        this.stopPolling();
        new Notice('❌ Authentication timeout. Please try again.', 8000);
        return;
      }

      try {
        const pollUrl = `${SimklAuthentication.SIMKL_PIN_CHECK_URL}${encodeURIComponent(user_code)}?client_id=${encodeURIComponent(this.plugin.settings.simklClientId)}`;

        const response = await requestUrl({
          url: pollUrl,
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'simkl-api-key': this.plugin.settings.simklClientId
          },
          throw: false
        });

        const data = response.json || {};

        if (data.access_token) {
          // Success!
          this.plugin.settings.simklAccessToken = data.access_token;
          await this.plugin.saveSettings();
          
          // Close modal
          document.querySelectorAll('.modal-container').forEach(modal => {
            if (modal.querySelector('.simkl-pin-modal')) {
              modal.remove();
            }
          });
          
          this.stopPolling();
          
          // Fetch user info
          try {
            await this.fetchUserInfo();
            new Notice(`✅ Successfully authenticated with SIMKL! Welcome ${this.plugin.settings.simklUserInfo?.user?.name || 'user'} 🎉`, 4000);
          } catch (userError) {
            console.log('[SIMKL-AUTH] Failed to fetch user info but auth succeeded', userError);
            new Notice('✅ Authentication successful! 🎉', 4000);
          }
          if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
  await this.plugin.updateDefaultApiSourceBasedOnAuth();
}
          return;
        }

        // Continue polling if no token yet
        if (response.status === 404 || !data || Object.keys(data).length === 0) {
          // User hasn't entered code yet, continue polling
        }

      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // Start polling
    this.pollInterval = setInterval(poll, interval * 1000);
    
    // Do first poll after interval
    setTimeout(poll, interval * 1000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async fetchUserInfo() {
    const headers = this.getAuthHeaders();
    if (!headers) {
      throw new Error('Not authenticated');
    }

    const res = await requestUrl({
      url: SimklAuthentication.SIMKL_USER_URL,
      method: 'GET',
      headers,
      throw: false
    });
    
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not fetch user info (HTTP ${res.status})`);
    }
    
    this.plugin.settings.simklUserInfo = res.json;
    await this.plugin.saveSettings();
  }

  async logout() {
    this.plugin.settings.simklAccessToken = '';
    this.plugin.settings.simklUserInfo = null;
    this.plugin.settings.simklClientId = '';
    this.plugin.settings.simklClientSecret = '';
    await this.plugin.saveSettings();
    
    // Clear any SIMKL-specific cache if you have one
    if (this.plugin.cache) {
      this.plugin.cache.clear('simklData');
    }
    
    new Notice('✅ Logged out from SIMKL & cleared credentials.', 3000);
  }

  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated with SIMKL');
    if (!this.hasRequiredCredentials) throw new Error('Missing SIMKL client credentials');
    return true;
  }
  
  async getAuthenticatedUsername() {
    await this.ensureValidToken();

    if (!this.plugin.settings.simklUserInfo) {
      await this.fetchUserInfo();
    }

    const name = this.plugin.settings.simklUserInfo?.user?.name;
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

module.exports = { SimklAuthentication };