const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

// Settings
import { DEFAULT_SETTINGS } from './settings/defaultSettings.js';

import { ZoroSettingTab } from './settings/settingsTab.js';

import { validateSettings, saveSettings, loadSettings } from './settings/helpers.js';


// Caches
import { pruneCache, getFromCache, setToCache, clearCacheForMedia } from './utils/cache.js';

// Rate limit
import { RequestQueue } from './utils/requestQueue.js';

import { createSampleNotes } from './utils/sampleNotes.js';


// Authentication 
import { authenticateUser, exchangeCodeForToken, makeObsidianRequest, testAccessToken, getAuthenticatedUsername } from './api/auth.js';

// Graphql Queries
import { getMediaListQuery, getSingleMediaQuery, getUserStatsQuery, getSearchMediaQuery, getZoroUrl } from './api/graphql.js';

// Anilist API Fetcher
import { fetchZoroData } from './api/fetchZoroData.js';

import { updateMediaListEntry, checkIfMediaInList, addMediaToList } from './api/listManager.js';

import { handleAuthMessage } from './api/auth.js';

// UI 
import { renderMediaList, createMediaCard, createDetailsRow, renderTableLayout } from './ui/render/renderList.js';

import { renderSingleMedia } from './ui/render/renderSingle.js';

import { renderUserStats } from './ui/render/renderStats.js';



/// UI modal
import { createAddModal, createEditModal, createAuthenticationPrompt } from './ui/modals.js';

import {
  ClientIdModal,
  ClientSecretModal,
  AuthPinModal
} from './ui/modals.js';

import { renderSearchInterface, renderSearchResults, handleAddClick } from './ui/searchInterface.js';

import { handleEditClick } from './ui/helpers.js';

import { injectCSS } from './ui/helpers.js';

import { renderError } from './ui/helpers.js';

import { fetchData, renderZoroData } from './ui/helpers.js';



// Parsers
import { parseCodeBlockConfig, parseSearchCodeBlockConfig } from './parsers/parseCodeBlock.js';
import { parseInlineLink } from './parsers/parseInlineLink.js';


// Plugin Class 
class ZoroPlugin extends Plugin { 

  // Constructor 
  constructor(app, manifest) {
    super(app, manifest);
    
  // Initialize separate caches
  this.cache = {
    userData: new Map(),     // User stats and lists
    mediaData: new Map(),    // Individual media items
    searchResults: new Map() // Search queries
  };
    this.requestQueue = RequestQueue();
    this.cacheTimeout = 5 * 60 * 1000;

  // Add periodic pruning
  this.pruneInterval = setInterval(() => this.pruneCache(), this.cacheTimeout);
  }
  


  // On Load  ok
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

    // Process inline links (e.g., [[Zoro:ID]])
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));

    // Add plugin settings tab
    this.addSettingTab(new ZoroSettingTab(this.app, this));

    console.log('[Zoro] Plugin loaded successfully.');
  }
  

// Loading indicator 

  
  // Process Zoro Code Block - FIXED: Now properly inside the class
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


  // Process Zoro Search Code Block - FIXED: Removed duplicate and fixed structure
  async processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
config.search = '';


      if (this.settings.debugMode) {
        console.log('[Zoro] Search block config:', config);
      }

      // Show loading placeholder
      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      
      

      await this.renderSearchInterface(el, config);
    } catch (error) {
      console.error('[Zoro] Search block processing error:', error);
      this.renderError(el, error.message || 'Failed to process Zoro search block.');
    }
  }



  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="zoro:"]');

    for (const link of inlineLinks) {
      const href = link.getAttribute('href');
      
      // Optional: Show loading shimmer while data loads
      const placeholder = document.createElement('span');
      placeholder.textContent = '🔄 Loading Zoro...';
      link.replaceWith(placeholder);

      try {
        const config = this.parseInlineLink(href);
        const data = await this.fetchZoroData(config);

        const container = document.createElement('span');
        container.className = 'zoro-inline-container';
        this.renderZoroData(container, data, config);

        placeholder.replaceWith(container);

        // ✅ Cleanup if the block is removed (important for re-render safety)
        ctx.addChild({
          unload: () => {
            container.remove();
          }
        });

      } catch (error) {
        console.warn(`[Zoro] Inline link failed for ${href}:`, error);

        const errorEl = document.createElement('span');
        errorEl.className = 'zoro-inline-error';
        errorEl.textContent = `⚠️ ${error.message || 'Failed to load data'}`;

        placeholder.replaceWith(errorEl);
      }
    }
  }

  // Plugin unload method
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

module.exports = {
  default: ZoroPlugin,
};

