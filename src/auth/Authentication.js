import { Notice, requestUrl, Modal } from 'obsidian';
import { AuthModal } from './AuthModal.js';


// AniList Authentication 

class Authentication {
  constructor(plugin) {
    this.plugin = plugin;
  }

  static ANILIST_AUTH_URL  = 'https://anilist.co/api/v2/oauth/authorize';
  static ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
  static REDIRECT_URI      = 'https://anilist.co/api/v2/oauth/pin';

  get isLoggedIn() {
    return Boolean(this.plugin.settings.accessToken);
  }


async loginWithFlow() {
  if (!this.plugin.settings.clientId) {
    new Notice('❌ Please enter your Client ID first.', 5000);
    return;
  }

  const { clientId } = this.plugin.settings;
  const authUrl =
    `${Authentication.ANILIST_AUTH_URL}?` +
    new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  'obsidian://zoro-auth/anilist/',  // Changed from 'obsidian://zoro-auth/'
      response_type: 'code'
    }).toString();

  new Notice('🔐 Opening AniList login page…', 3000);
  if (window.require) {
    const { shell } = window.require('electron');
    await shell.openExternal(authUrl);
  } else {
    window.open(authUrl, '_blank');
  }
}

  async handleOAuthRedirect(params) {
  try {
    console.log('[Zoro Auth] Received OAuth redirect:', params);
    
    // Extract the authorization code from the URL parameters
    let code = null;
    
    if (params.code) {
      code = params.code;
    } else if (typeof params === 'string') {
      const urlParams = new URLSearchParams(params.startsWith('?') ? params.slice(1) : params);
      code = urlParams.get('code');
    } else if (params.url) {
      try {
        const url = new URL(params.url);
        code = url.searchParams.get('code');
      } catch (e) {
        console.warn('[Zoro Auth] Failed to parse URL from params:', e);
      }
    }
    
    if (!code) {
      const error = params.error || 'Unknown error';
      const errorDesc = params.error_description || 'No authorization code received';
      console.error('[Zoro Auth] OAuth error:', { error, errorDesc });
      new Notice(`❌ Authentication failed: ${errorDesc}`, 5000);
      return;
    }

    await this.exchangePin(code); // Reuse existing exchange method
    
  } catch (error) {
    console.error('[Zoro Auth] Failed to handle OAuth redirect:', error);
    new Notice(`❌ Authentication failed: ${error.message}`, 5000);
  }
}

  async logout() {
    this.plugin.settings.accessToken  = '';
    this.plugin.settings.tokenExpiry  = 0;
    this.plugin.settings.authUsername = '';
    this.plugin.settings.anilistUsername = '';
    this.plugin.settings.clientId     = '';
    this.plugin.settings.clientSecret = '';
    await this.plugin.saveSettings();
    if (this.plugin.settings.authUsername) {
   this.plugin.cache.invalidateByUser(this.plugin.settings.authUsername);
 }
    this.plugin.cache.clear();
    new Notice('✅ Logged out & cleared credentials.', 3000);
  }

  async exchangePin(pin) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code:          pin.trim(),
    client_id:     this.plugin.settings.clientId,
    client_secret: this.plugin.settings.clientSecret || '',
    redirect_uri:  'obsidian://zoro-auth/anilist/'  // Changed from 'obsidian://zoro-auth/'
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept:         'application/json'
  };

  try {
    const res = await this.plugin.requestQueue.add(() =>
      requestUrl({
        url:    Authentication.ANILIST_TOKEN_URL,
        method: 'POST',
        headers,
        body:   body.toString()
      })
    );

    const data = res.json;
    if (!data?.access_token) {
      throw new Error(data.error_description || 'No token returned');
    }

    this.plugin.settings.accessToken = data.access_token;
    if (data.expires_in) {
      this.plugin.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
    }
    
    // NEW: Fetch and store username immediately
    try {
      const username = await this.getAuthenticatedUsername();
      // Username is already stored by getAuthenticatedUsername method
    } catch (usernameError) {
      console.warn('Failed to fetch username during authentication:', usernameError);
    }
    
    await this.plugin.saveSettings();
    this.plugin.cache.invalidateByUser(this.plugin.settings.anilistUsername);

    await this.forceScoreFormat();
    if (typeof this.plugin.updateDefaultApiSourceBasedOnAuth === 'function') {
      await this.plugin.updateDefaultApiSourceBasedOnAuth();
    }
    new Notice('✅ Authenticated successfully!', 4000);
  } catch (err) {
    new Notice(`❌ Auth failed: ${err.message}`, 5000);
    throw err;
  }
}


  async ensureValidToken() {
    if (!this.isLoggedIn) throw new Error('Not authenticated');
    return true;
  }
  
  async forceScoreFormat() {
  if (!this.plugin.settings.forceScoreFormat) return;
  
  await this.ensureValidToken();
  
  // First check current score format
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
    const currentResponse = await this.plugin.requestQueue.add(() =>
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

    const currentFormat = currentResponse.json?.data?.Viewer?.mediaListOptions?.scoreFormat;
    console.log('Current score format:', currentFormat);

    if (currentFormat === 'POINT_10') {
      console.log('Score format already set to POINT_10');
      return;
    }
    
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

    const response = await this.plugin.requestQueue.add(() =>
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

    if (response.json?.errors) {
      const errorMsg = response.json.errors[0]?.message || 'Unknown error';
      console.error('UpdateUser error:', response.json.errors);
      throw new Error(errorMsg);
    }
    
    const updatedFormat = response.json?.data?.UpdateUser?.mediaListOptions?.scoreFormat;
    console.log('Updated score format to:', updatedFormat);
    
    if (updatedFormat === 'POINT_10') {
      new Notice('✅ Score format updated to 0-10 scale', 3000);
      
    } else {
      throw new Error(`Score format not updated properly. Got: ${updatedFormat}`);
    }
    
  } catch (err) {
    
    new Notice(`❌ Could not update score format: ${err.message}`, 5000);
  }
}
 
 async getAuthenticatedUsername() {
  // Check if we already have it stored
  if (this.plugin.settings.anilistUsername) {
    return this.plugin.settings.anilistUsername;
  }

  await this.ensureValidToken();

  const query = `query { Viewer { name } }`;
  const res = await this.plugin.requestQueue.add(() =>
    requestUrl({
      url:     'https://graphql.anilist.co',
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${this.plugin.settings.accessToken}`
      },
      body: JSON.stringify({ query })
    })
  );

  const name = res.json?.data?.Viewer?.name;
  if (!name) throw new Error('Could not fetch username');
  
  // Store in both fields
  this.plugin.settings.authUsername = name;
  this.plugin.settings.anilistUsername = name; // NEW: Store in dedicated field
  await this.plugin.saveSettings();
  return name;
}
  
}

export { Authentication };