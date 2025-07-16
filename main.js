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
import { validateSettings, saveSettings, loadSettings } from './settings/helpers.js';
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
  import { handleEditClick, renderError, fetchData, renderZoroData, processZoroSearchCodeBlock, injectCSS, processZoroCodeBlock, processInlineLinks } from './ui/helpers.js';
  
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
  this.pruneCache = pruneCache.bind(this); this.pruneInterval = setInterval(() => this.pruneCache(), this.cacheTimeout);
  }
  




  


  async onload() {
    console.log('[Zoro] Plugin loading...');

    // Load settings
    try {
      await loadSettings.bind(this)();
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

  // Clean up CSS
  const styleId = 'zoro-plugin-styles';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
    console.log(`Removed style element with ID: ${styleId}`);
  }
  
  // Clear pruning interval (independent of CSS)
  if (this.pruneInterval) {
    clearInterval(this.pruneInterval);
    console.log('Cleared cache pruning interval');
  }
      
  // Clear all caches (independent of CSS)
  if (this.cache) {
    this.cache.userData.clear();
    this.cache.mediaData.clear();
    this.cache.searchResults.clear();
    console.log('Cleared all caches');
  }

  // Clear request queue if it exists
  if (this.requestQueue && typeof this.requestQueue.clear === 'function') {
    this.requestQueue.clear();
    console.log('Cleared request queue');
  }
}
} 

export default ZoroPlugin;