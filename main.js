const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal } = require('obsidian');

// Settings
import { DEFAULT_SETTINGS } from './settings/defaultSettings.js';

import { ZoroSettingTab } from './settings/settingsTab.js';

// Caches
import { pruneCache, getFromCache, setToCache, clearCacheForMedia } from './utils/cache.js';

// Rate limit
import { RequestQueue } from './utils/requestQueue.js';

// Authentication 
import { authenticateUser, exchangeCodeForToken, makeObsidianRequest, testAccessToken, getAuthenticatedUsername } from './api/auth.js';

// Graphql Queries
import { getMediaListQuery, getSingleMediaQuery, getUserStatsQuery, getSearchMediaQuery, getZoroUrl } from './api/graphql.js';

// Anilist API Fetcher
import { fetchZoroData } from './api/fetchZoroData.js';

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

// Parsers
import { parseCodeBlockConfig } from './parsers/parseCodeBlock.js';
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
  
   // Validate Settings 
  validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'list'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      showCoverImages: !!settings?.showCoverImages,
      showRatings: !!settings?.showRatings,
      showProgress: !!settings?.showProgress,
      showGenres: !!settings?.showGenres,
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : 3,
      clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
      clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
      redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
      accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : '',
    };
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

  // Load settings 
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
  

// Loading indicator 
async fetchData(config) {
  this.showLoader();
  try {
    // API call
  } catch (error) {
    // Handle error
  } finally {
    this.hideLoader();
  }
}
  
  
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

// Update Media List 
    
    async updateMediaListEntry(mediaId, updates) {
  try {
    // Ensure valid token before proceeding
    if (!this.settings.accessToken || !(await this.ensureValidToken())) {
      throw new Error('❌ Authentication required to update entries.');
    }

    const mutation = `
      mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
          id
          status
          score
          progress
        }
      }
    `;

    // Filter out undefined values
    const variables = {
      mediaId,
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.score !== undefined && { score: updates.score }),
      ...(updates.progress !== undefined && { progress: updates.progress }),
    };

    
// Rate Limit  add
    const response = await this.requestQueue.add(() => requestUrl({
  url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query: mutation, variables })
    }));

    const result = response.json;

    if (!result || result.errors?.length > 0) {
      const message = result.errors?.[0]?.message || 'Unknown mutation error';
      throw new Error(`AniList update error: ${message}`);
    }

    // Targeted cache clearing instead of full clear
    this.clearCacheForMedia(mediaId);
    
    return result.data.SaveMediaListEntry;

  } catch (error) {
    console.error('[Zoro] updateMediaListEntry failed:', error);
    throw new Error(`❌ Failed to update entry: ${error.message}`);
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

  // Parse Code Block Config - FIXED: Now properly inside the class
  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    // Use authenticated user if no username provided and no default username
    if (!config.username) {
      if (this.settings.defaultUsername) {
        config.username = this.settings.defaultUsername;
      } else if (this.settings.accessToken) {
        config.useAuthenticatedUser = true;
      } else {
        throw new Error('Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
      }
    }
    
    config.listType = config.listType || 'CURRENT';
    config.layout = config.layout || this.settings.defaultLayout;
    config.mediaType = config.mediaType || 'ANIME';
    
    return config;
  }

  // Parse Search Code Block Config 
  parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    config.layout = config.layout || this.settings.defaultLayout || 'card';

    
    // Default to ANIME if no mediaType specified
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.settings.defaultLayout;
    
    return config;
  }

  // Process Inline Links - FIXED: Now properly inside the class
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

  // Parse Inline Link - FIXED: Now properly inside the class
  parseInlineLink(href) {
    const [base, hash] = href.replace('zoro:', '').split('#');

    const parts = base.split('/');
    let username, pathParts;

    if (parts[0] === '') {
      if (!this.settings.defaultUsername) {
        throw new Error('⚠️ Default username not set. Configure it in plugin settings.');
      }
      username = this.settings.defaultUsername;
      pathParts = parts.slice(1);
    } else {
      if (parts.length < 2) {
        throw new Error('❌ Invalid Zoro inline link format.');
      }
      username = parts[0];
      pathParts = parts.slice(1);
    }

    const config = {
      username: username,
      layout: 'card', // Default layout
      type: 'list'     // Default to media list
    };

    const main = pathParts[0];
    const second = pathParts[1];

    if (main === 'stats') {
      config.type = 'stats';
    } else if (main === 'anime' || main === 'manga') {
      config.type = 'single';
      config.mediaType = main.toUpperCase();
      if (!second || isNaN(parseInt(second))) {
        throw new Error('⚠️ Invalid media ID for anime/manga inline link.');
      }
      config.mediaId = parseInt(second);
    } else {
      config.listType = main.toUpperCase();
    }

    // Optional layout modifiers from hash
    if (hash) {
      const hashParts = hash.split(',');
      for (const mod of hashParts) {
        if (mod === 'compact' || mod === 'card' || mod === 'minimal' || mod === 'full') {
          config.layout = mod;
        }
        if (mod === 'nocache') {
          config.nocache = true;
        }
      }
    }

    return config;
  }



  
  // Add this method to check if media is already in user's list
async checkIfMediaInList(mediaId, mediaType) {
  if (!this.settings.accessToken) return false;
  
  try {
    const config = {
      type: 'single',
      mediaType: mediaType,
      mediaId: parseInt(mediaId)
    };
    
    const response = await this.fetchZoroData(config);
    return response.MediaList !== null;
  } catch (error) {
    console.warn('Error checking media list status:', error);
    return false;
  }
}

// Add this method to add new media to list
async addMediaToList(mediaId, updates, mediaType) {
  if (!this.settings.accessToken) {
    throw new Error('Authentication required');
  }
  
  // Use the same method as your existing updateMediaListEntry
  // but for adding new entries instead of updating existing ones
  return await this.updateMediaListEntry(mediaId, updates);
}



// Create Add Modal (similar to edit modal but for adding new items)

  //  render ZoroData
  renderZoroData(el, data, config) {
    el.empty();
    el.className = 'zoro-container';
    
    if (config.type === 'stats') {
      this.renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      this.renderSingleMedia(el, data.MediaList, config);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
      if (config.layout === 'table') {
        this.renderTableLayout(el, entries);
      } else {
        this.renderMediaList(el, entries, config);
      }
    }
  }


  handleEditClick(e, entry, statusEl) {
    e.preventDefault();
    e.stopPropagation();

    this.createEditModal(
      entry,
      async updates => {
        try {
          await this.updateMediaListEntry(entry.media.id, updates);
          new Notice('✅ Updated!');
          this.cache.clear();
          const parent = statusEl.closest('.zoro-container');
          if (parent) {
            const block = parent.closest('.markdown-rendered')?.querySelector('code');
            if (block) this.processZoroCodeBlock(block.textContent, parent, {});
          }
        } catch (err) {
          new Notice(`❌ Update failed: ${err.message}`);
        }
      },
      () => {
        new Notice('Edit canceled.');
      }
    );
  }


  
  


 async createSampleNotes() {
  try {
    let successCount = 0;
    let errorMessages = [];
    
    // **FIRST NOTE CONFIGURATION**
    
    const firstNoteTitle = "Anime Dashboard";
    
const firstNoteContent =`\`\`\`zoro-search
mediaType: ANIME
\`\`\`

# 👀 Watching:
\`\`\`zoro
listType: CURRENT
mediaType: ANIME
\`\`\`

# 📝 Planning:
\`\`\`zoro
listType: PLANNING
mediaType: ANIME
\`\`\`

# 🌀 Repeating:
\`\`\`zoro
listType: REPEATING
mediaType: ANIME
\`\`\`

# ⏸️ On Hold:
\`\`\`zoro
listType: PAUSED
mediaType: ANIME
\`\`\`

# 🏁 Completed:
\`\`\`zoro
listType: COMPLETED
mediaType: ANIME
\`\`\`

# 🗑️ Dropped:
\`\`\`zoro
listType: DROPPED
mediaType: ANIME
\`\`\`

# 📊 Stats:
\`\`\`zoro
type: stats
\`\`\` 

`;

 const secondNoteTitle = "Manga Dashboard";

const secondNoteContent =`\`\`\`zoro-search
mediaType: MANGA
\`\`\`

# 📖 Reading:
\`\`\`zoro
listType: CURRENT
mediaType: MANGA
\`\`\`

# 📝 Planning:
\`\`\`zoro
listType: PLANNING
mediaType: MANGA
\`\`\`

# 🌀 Repeating:
\`\`\`zoro
listType: REPEATING
mediaType: MANGA
\`\`\`

# ⏸️ On Hold:
\`\`\`zoro
listType: PAUSED
mediaType: MANGA
\`\`\`

# 🏁 Completed:
\`\`\`zoro
listType: COMPLETED
mediaType: MANGA
\`\`\`

# 🗑️ Dropped:
\`\`\`zoro
listType: DROPPED
mediaType: MANGA
\`\`\`

# 📊 Stats:
\`\`\`zoro
type: stats
\`\`\` 

`;

    // Array of notes to create

    const notesToCreate = [
      { title: firstNoteTitle, content: firstNoteContent },
      { title: secondNoteTitle, content: secondNoteContent }
    ];

    // Create each note

    for (const note of notesToCreate) {
      try {
        const fileName = `${note.title}.md`;
        const filePath = fileName;

 // This creates the note in the vault root
        
        // Checking for if  file already exists
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile) {
          errorMessages.push(`"${note.title}" already exists`);
          continue;
        }
        
        // Create the new note
        await this.app.vault.create(filePath, note.content);
        successCount++;
        
      } catch (error) {
        errorMessages.push(`Failed to create "${note.title}": ${error.message}`);
      }
    }
    
    // Show results
    if (successCount > 0) {
      new Notice(`Successfully created ${successCount} note${successCount > 1 ? 's' : ''}!`, 4000);
      
      // Open the first successfully created note

      const firstNote = this.app.vault.getAbstractFileByPath(`${firstNoteTitle}.md`);
      if (firstNote) {
        await this.app.workspace.openLinkText(`${firstNoteTitle}.md`, '', false);
      }
    }
    
    if (errorMessages.length > 0) {
      new Notice(`Issues: ${errorMessages.join(', ')}`, 5000);
    }
    
  } catch (error) {
    console.error('Error creating notes:', error);
    new Notice(`Failed to create notes: ${error.message}`, 5000);
  }
 }

  
  // Inject Css not ok
  injectCSS() {
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

// Implement handler
  handleAuthMessage(event) {
  if (event.origin !== 'https://anilist.co') return;
  this.exchangeCodeForToken(event.data.code);
}

  // Render Errors
  renderError(el, message, context = '', onRetry = null) {
    el.empty?.(); // clear if Obsidian's `el` object has `.empty()` method
    el.classList.add('zoro-error-container');

    const wrapper = document.createElement('div');
    wrapper.className = 'zoro-error-box';

    const title = document.createElement('strong');
    title.textContent = `❌ ${context || 'Something went wrong'}`;
    wrapper.appendChild(title);

    const msg = document.createElement('pre');
    msg.textContent = message; // safe, no innerHTML
    wrapper.appendChild(msg);

    // Optional Retry button
    if (this.settings?.accessToken) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = () => {
        // You might re-call the source renderer here
        new Notice('Retry not implemented yet');
      };
      wrapper.appendChild(retryBtn);
    }

    // FIXED: Added onRetry functionality
    if (typeof onRetry === 'function') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = onRetry;
      wrapper.appendChild(retryBtn);
    }

    el.appendChild(wrapper);
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

