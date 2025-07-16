//  Obsidian API
import {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  requestUrl,
  Modal
} from 'obsidian';

// Settings
import { DEFAULT_SETTINGS } from './settings/defaultSettings.js';
import { ZoroSettingTab } from './settings/settingsTab.js';
import { validateSettings } from './settings/helpers.js';
import { createSampleNotes } from './utils/sampleNotes.js';

// Utils 
import { RequestQueue } from './utils/requestQueue.js';
import { pruneCache, getFromCache, setToCache, clearCacheForMedia } from './utils/cache.js';

// API ListManager 
import { authenticateUser, exchangeCodeForToken, makeObsidianRequest, testAccessToken, getAuthenticatedUsername, handleAuthMessage } from './api/auth.js';
import { getMediaListQuery, getSingleMediaQuery, getUserStatsQuery, getSearchMediaQuery, getZoroUrl } from './api/graphql.js';
import { fetchZoroData } from './api/fetchZoroData.js';
import { updateMediaListEntry, checkIfMediaInList, addMediaToList } from './api/listManager.js';

// UI: Renderers 
import { renderMediaList, createMediaCard, createDetailsRow, renderTableLayout } from './ui/render/renderList.js';
import { renderSingleMedia } from './ui/render/renderSingle.js';
import { renderUserStats } from './ui/render/renderStats.js';

// UI: Modals 
import { createAddModal, createEditModal, createAuthenticationPrompt, ClientIdModal,
  ClientSecretModal,
  AuthPinModal } from './ui/modals.js';
  
  // UI: Search Interface 
  import { renderSearchInterface, renderSearchResults, handleAddClick } from './ui/searchInterface.js';
  
  // UI: helpers
  import { handleEditClick, renderError, fetchData, renderZoroData, processZoroSearchCodeBlock, processInlineLinks  } from './ui/helpers.js';
  
// Parsers 
import { parseCodeBlockConfig, parseSearchCodeBlockConfig } from './parsers/parseCodeBlock.js';
import { parseInlineLink } from './parsers/parseInlineLink.js';


// Plugin Class 
class ZoroPlugin extends Plugin { 
  
  constructor(app, manifest) {
    super(app, manifest);
    
  // Initialize separate caches
  this.cache = {
    userData: new Map(),     // User stats and lists
    mediaData: new Map(),    // Individual media items
    searchResults: new Map() // Search queries
  };
    this.requestQueue = new RequestQueue();
    this.cacheTimeout = 5 * 60 * 1000;

  // periodic pruning
  this.pruneInterval = setInterval(() => pruneCache(this.cache), this.cacheTimeout);
  }
  
async saveSettings() {
    try {
      const validSettings = this.validateSettings(this.settings);
      await this.saveData(validSettings);
      console.log('[Zoro] Settings saved successfully.');
    } catch (err) {
      console.error('[Zoro] Failed to save settings:', err);
      new Notice('⚠️ Failed to save settings. See console for details.');
    }
  }


async loadSettings() {
    const saved = await this.loadData() || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);
   
   // no secret saved...
   if (!this.settings.clientSecret) {
    const secret = await this.promptForSecret("Paste your client secret:");
    this.settings.clientSecret = secret.trim();
    await this.saveData(this.settings);
  }}
  
  export function injectCSS() {
  const styleId = 'zoro-plugin-styles';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) existingStyle.remove();
  
  const css = `
    .zoro-container { /* styles */ }
    /* add all necessary styles here */
  `;
  
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = css;
  document.head.appendChild(style);
}

async processZoroCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source) || {};

      // Debug: Log raw config
      console.log('[Zoro] Code block config:', config);

      // Handle authenticated user resolution
      if (config.useAuthenticatedUser) {
        const authUsername = await this.getAuthenticatedUsername();
        if (!authUsername) {
          throw new Error('❌ Could not retrieve authenticated username. Check your authentication setup or set a username manually.');
        }
        config.username = authUsername;
      }

      if (!config.username) {
        throw new Error('❌ No username provided. Set `username:` in your code block or enable `useAuthenticatedUser`.');
      }

      const data = await this.fetchZoroData(config);

      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('⚠️ No data returned from Zoro API.');
      }

      this.renderZoroData(el, data, config);
    } catch (error) {
      console.error('[Zoro] Code block processing error:', error);
      this.renderError(el, error.message || 'Unknown error occurred.');
    }
  }


  async onload() {
    console.log('[Zoro] Plugin loading...');

    // Load settings
    try {
      await this.loadSettings();
      console.log('[Zoro] Settings loaded.');
    } catch (err) {
      console.error('[Zoro] Failed to load settings:', err);
    }

    // Inject custom CSS
    try {
      this.injectCSS();
      console.log('[Zoro] CSS injected.');
    } catch (err) {
      console.error('[Zoro] Failed to inject CSS:', err);
    }

    // Register Markdown code block processors
    this.registerMarkdownCodeBlockProcessor('zoro', this.processZoroCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('zoro-search', this.processZoroSearchCodeBlock.bind(this));

    // Process inline links
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    // Add plugin settings tab
    this.addSettingTab(new ZoroSettingTab(this.app, this));

    console.log('[Zoro] Plugin loaded successfully.');
  }

  onunload() {
    console.log('Unloading Zoro Plugin');

    const styleId = 'zoro-plugin-styles';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
      console.log(`Removed style element with ID: ${styleId}`);
       // Clear pruning interval
  if (this.pruneInterval) {
    clearInterval(this.pruneInterval);
  }
      
  // Clear all caches
  this.cache.userData.clear();
  this.cache.mediaData.clear();
  this.cache.searchResults.clear();
      
    }
  }
} 

export default ZoroPlugin;