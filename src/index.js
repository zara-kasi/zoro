import { Plugin, Notice } from 'obsidian';

import { Cache } from './cache/Cache.js';
import { RequestQueue } from './api/requests/RequestQueue.js';
import { AnilistApi } from './api/services/AnilistApi.js';
import { MalApi } from './api/services/MalApi.js';
import { SimklApi } from './api/services/SimklApi.js';

import { Authentication } from './auth/Authentication.js';
import { MALAuthentication } from './auth/MALAuthentication.js';
import { SimklAuthentication } from './auth/SimklAuthentication.js';

import { Theme } from './features/Theme.js';
import { Processor } from './processing/Processor.js';
import { Edit } from './editing/Edit.js';
import { MoreDetailsPanel } from './details/MoreDetailsPanel.js';
import { Export } from './features/Export.js';
import { Sample } from './features/Sample.js';
import { Prompt } from './features/Prompt.js';

import { Render } from './rendering/core/Render.js';
import { EmojiIconMapper } from './rendering/helpers/EmojiIconMapper.js';
import { ConnectedNotes } from './features/ConnectedNotes.js';
import { SidePanel, ZORO_VIEW_TYPE } from './ui/SidePanel.js';

import { DEFAULT_SETTINGS, GRID_COLUMN_OPTIONS,  GRID_COLUMN_LABELS, } from './core/constants.js';
import { ZoroSettingTab } from './settings/ZoroSettingTab.js';

class ZoroPlugin extends Plugin {
	constructor(app, manifest) {
		super(app, manifest);
		this.globalListeners = [];
		this.cache = new Cache({ obsidianPlugin: this });
		this.requestQueue = new RequestQueue(this);
		this.api = new AnilistApi(this);
		this.auth = new Authentication(this);
		this.malAuth = new MALAuthentication(this);
		this.malApi = new MalApi(this);
		this.simklAuth = new SimklAuthentication(this);
		this.simklApi = new SimklApi(this);
		this.theme = new Theme(this);
		this.processor = new Processor(this);
		this.edit = new Edit(this);
		this.moreDetailsPanel = new MoreDetailsPanel(this);
		this.export = new Export(this);
		this.sample = new Sample(this);
		this.prompt = new Prompt(this);
	}

	

	renderError(el, message, context = '', onRetry = null) {
		el.empty?.();
		el.classList.add('zoro-error-container');

		const wrapper = el.createDiv({ cls: 'zoro-error-box' });
		wrapper.createEl('strong', { text: `❌ ${context || 'Something went wrong'}` });
		wrapper.createEl('pre', { text: message });

		if (onRetry) {
			wrapper.createEl('button', { text: '🔄 Retry', cls: 'zoro-retry-btn' })
					.onclick = () => {
						el.empty();
						onRetry();
					};
		} else if (this.app?.workspace?.activeLeaf?.rebuildView) {
			wrapper.createEl('button', { text: 'Reload Note', cls: 'zoro-retry-btn' })
					.onclick = () => this.app.workspace.activeLeaf.rebuildView();
		}
	}

	getAniListUrl(mediaId, mediaType = 'ANIME') {
		return this.api.getAniListUrl(mediaId, mediaType);
	}

	getMALUrl(mediaId, mediaType = 'ANIME') {
		return this.malApi.getMALUrl(mediaId, mediaType);
	}

	getSimklUrl(mediaId, mediaType = 'ANIME') {
		return this.simklApi.getSimklUrl(mediaId, mediaType);
	}

	getSourceSpecificUrl(mediaId, mediaType, source) {
		const type = String(mediaType || '').toUpperCase();
		const numericId = Number(mediaId) || 0;

		

		switch ((source || '').toLowerCase()) {
			case 'mal':
				return this.getMALUrl(mediaId, mediaType);
			case 'simkl':
				return this.getSimklUrl(mediaId, mediaType);
			case 'anilist':
			default:
				return this.getAniListUrl(mediaId, mediaType);
		}
	}

	async updateDefaultApiSourceBasedOnAuth() {
		try {
			if (this.settings.defaultApiUserOverride) return;
			const authenticated = [];
			if (this.settings.accessToken) authenticated.push('anilist');
			if (this.settings.malAccessToken) authenticated.push('mal');
			if (this.settings.simklAccessToken) authenticated.push('simkl');

			let newDefault = this.settings.defaultApiSource;
			if (authenticated.length === 1) {
				newDefault = authenticated[0];
			} else {
				newDefault = 'anilist';
			}

			if (newDefault !== this.settings.defaultApiSource) {
				this.settings.defaultApiSource = newDefault;
				await this.saveSettings();
			}
		} catch (e) {
			console.warn('[Zoro] Failed to update default API source automatically:', e);
		}
	}

	async onload() {
		this.render = new Render(this);
		this.emojiMapper = new EmojiIconMapper();
		this.emojiMapper.init({ patchSettings: true, patchCreateEl: true, patchNotice: true });
		this.connectedNotes = new ConnectedNotes(this);
		try {
			await this.loadSettings();
		} catch (err) {
			console.error('[Zoro] Failed to load settings:', err);
		}

		await this.cache.loadFromDisk();
		this.cache.startAutoPrune(5 * 60 * 1000);

		try {
			this.injectCSS();
		} catch (err) {
			console.error('[Zoro] Failed to inject CSS:', err);
		}

		if (this.settings.theme) {
			await this.theme.applyTheme(this.settings.theme);
		}

		this.registerMarkdownCodeBlockProcessor('zoro', this.processor.processZoroCodeBlock.bind(this.processor));
		this.addSettingTab(new ZoroSettingTab(this.app, this));
		
		// Register custom URI handler for OAuth redirect
  this.registerObsidianProtocolHandler("zoro-auth", (params) => {
  this.auth.handleOAuthRedirect(params);
});

		// Register Zoro side panel view
		this.registerView(ZORO_VIEW_TYPE, (leaf) => new SidePanel(leaf, this));
		this.addCommand({
			id: 'zoro-open-panel',
			name: 'Open Zoro panel',
			callback: () => {
				const leaf = this.app.workspace.getRightLeaf(true);
				leaf.setViewState({ type: ZORO_VIEW_TYPE, active: true });
				this.app.workspace.revealLeaf(leaf);
			}
		});
	}

	validateSettings(settings) {
  const s = settings || {};
  const def = DEFAULT_SETTINGS;

  // Helper functions for type checking
  const isString = v => typeof v === 'string';
  const isBool = v => typeof v === 'boolean';
  const isNumber = v => typeof v === 'number' && !Number.isNaN(v);
  const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
  const validateArrayStrings = arr => Array.isArray(arr) ? arr.filter(u => typeof u === 'string' && u.trim() !== '') : [];

  // Validate grid columns setting with migration support
  const validateGridColumns = (value) => {
    // If it's already a valid string option, use it
    if (Object.values(GRID_COLUMN_OPTIONS).includes(value)) {
      return value;
    }
    
    // Legacy migration: convert old numeric values to new string format
    if (typeof value === 'number') {
      switch (value) {
        case 1: return GRID_COLUMN_OPTIONS.ONE;
        case 2: return GRID_COLUMN_OPTIONS.TWO;
        case 3: return GRID_COLUMN_OPTIONS.THREE;
        case 4: return GRID_COLUMN_OPTIONS.FOUR;
        case 5: return GRID_COLUMN_OPTIONS.FIVE;
        case 6: return GRID_COLUMN_OPTIONS.SIX;
        default: return GRID_COLUMN_OPTIONS.DEFAULT; // fallback for invalid numbers
      }
    }
    
    // String numbers (legacy support)
    if (typeof value === 'string' && ['1', '2', '3', '4', '5', '6'].includes(value)) {
      return value; // these are already valid in our system
    }
    
    // Default fallback
    return def.gridColumns;
  };

  // Validate customPropertyNames per-key, falling back to defaults
  const validatedCustomPropertyNames = {};
  const defaultPropNames = def.customPropertyNames || {};
  for (const key of Object.keys(defaultPropNames)) {
    const val = s?.customPropertyNames?.[key];
    validatedCustomPropertyNames[key] = isString(val) && val.trim() !== '' ? val.trim() : defaultPropNames[key];
  }

  return {
    // Basic API and identity settings
    defaultApiSource: ['anilist', 'mal', 'simkl'].includes(s?.defaultApiSource) ? s.defaultApiSource : def.defaultApiSource,
    defaultApiUserOverride: isBool(s?.defaultApiUserOverride) ? s.defaultApiUserOverride : def.defaultApiUserOverride,
    defaultUsername: isString(s?.defaultUsername) ? s.defaultUsername : def.defaultUsername,
    defaultLayout: ['card', 'table'].includes(s?.defaultLayout) ? s.defaultLayout : def.defaultLayout,

    // Note and UI settings
    notePath: isString(s?.notePath) ? s.notePath : def.notePath,
    insertCodeBlockOnNote: isBool(s?.insertCodeBlockOnNote) ? s.insertCodeBlockOnNote : def.insertCodeBlockOnNote,
    showCoverImages: isBool(s?.showCoverImages) ? s.showCoverImages : def.showCoverImages,
    showRatings: isBool(s?.showRatings) ? s.showRatings : def.showRatings,
    showProgress: isBool(s?.showProgress) ? s.showProgress : def.showProgress,
    showGenres: isBool(s?.showGenres) ? s.showGenres : def.showGenres,
    showLoadingIcon: isBool(s?.showLoadingIcon) ? s.showLoadingIcon : def.showLoadingIcon,
    gridColumns: validateGridColumns(s?.gridColumns), // updated to use new validation
    theme: isString(s?.theme) ? s.theme : def.theme,
    hideUrlsInTitles: isBool(s?.hideUrlsInTitles) ? s.hideUrlsInTitles : def.hideUrlsInTitles,
    forceScoreFormat: isBool(s?.forceScoreFormat) ? s.forceScoreFormat : def.forceScoreFormat,
    showAvatar: isBool(s?.showAvatar) ? s.showAvatar : def.showAvatar,
    showFavorites: isBool(s?.showFavorites) ? s.showFavorites : def.showFavorites,
    showBreakdowns: isBool(s?.showBreakdowns) ? s.showBreakdowns : def.showBreakdowns,
    showTimeStats: isBool(s?.showTimeStats) ? s.showTimeStats : def.showTimeStats,

    // Statistics settings
    statsLayout: ['enhanced', 'compact', 'minimal'].includes(s?.statsLayout) ? s.statsLayout : def.statsLayout,
    statsTheme: ['auto', 'light', 'dark'].includes(s?.statsTheme) ? s.statsTheme : def.statsTheme,

    // AniList authentication
    clientId: isString(s?.clientId) ? s.clientId : def.clientId,
    clientSecret: isString(s?.clientSecret) ? s.clientSecret : def.clientSecret,
    redirectUri: isString(s?.redirectUri) ? s.redirectUri : def.redirectUri,
    accessToken: isString(s?.accessToken) ? s.accessToken : def.accessToken,
    anilistUsername: isString(s?.anilistUsername) ? s.anilistUsername : def.anilistUsername,
  
    // MyAnimeList authentication
    malClientId: isString(s?.malClientId) ? s.malClientId : def.malClientId,
    malClientSecret: isString(s?.malClientSecret) ? s.malClientSecret : def.malClientSecret,
    malAccessToken: isString(s?.malAccessToken) ? s.malAccessToken : def.malAccessToken,
    malRefreshToken: isString(s?.malRefreshToken) ? s.malRefreshToken : def.malRefreshToken,
    malTokenExpiry: (s?.malTokenExpiry === null || isNumber(s?.malTokenExpiry)) ? s.malTokenExpiry : def.malTokenExpiry,
    malUserInfo: (s?.malUserInfo === null || isObject(s?.malUserInfo)) ? s.malUserInfo : def.malUserInfo,

    // Simkl authentication
    simklClientId: isString(s?.simklClientId) ? s.simklClientId : def.simklClientId,
    simklClientSecret: isString(s?.simklClientSecret) ? s.simklClientSecret : def.simklClientSecret,
    simklAccessToken: isString(s?.simklAccessToken) ? s.simklAccessToken : def.simklAccessToken,
    simklUserInfo: (s?.simklUserInfo === null || isObject(s?.simklUserInfo)) ? s.simklUserInfo : def.simklUserInfo,

    // Search and TMDB settings
    autoFormatSearchUrls: isBool(s?.autoFormatSearchUrls) ? s.autoFormatSearchUrls : def.autoFormatSearchUrls,
    customSearchUrls: {
      ANIME: validateArrayStrings(s?.customSearchUrls?.ANIME),
      MANGA: validateArrayStrings(s?.customSearchUrls?.MANGA),
      MOVIE_TV: validateArrayStrings(s?.customSearchUrls?.MOVIE_TV)
    },
    tmdbApiKey: isString(s?.tmdbApiKey) ? s.tmdbApiKey : def.tmdbApiKey,

    // Custom property names (validated per-key)
    customPropertyNames: validatedCustomPropertyNames
  };
}

	migrateGridColumnsSetting(value) {
		// Handle migration from old numeric system to new string system
		if (typeof value === 'number' && Number.isInteger(value)) {
			// Convert old numeric values to new string values
			if (value >= 1 && value <= 6) {
				return String(value);
			} else {
				// Invalid numeric value, use default
				return GRID_COLUMN_OPTIONS.DEFAULT;
			}
		} else if (typeof value === 'string') {
			// Validate string values
			const validOptions = Object.values(GRID_COLUMN_OPTIONS);
			if (validOptions.includes(value)) {
				return value;
			} else {
				// Invalid string value, use default
				return GRID_COLUMN_OPTIONS.DEFAULT;
			}
		} else {
			// No value or invalid type, use default
			return GRID_COLUMN_OPTIONS.DEFAULT;
		}
	}

	async saveSettings() {
		try {
			const validSettings = this.validateSettings(this.settings);
			await this.saveData(validSettings);
		} catch (err) {
			console.error('[Zoro] Failed to save settings:', err);
			new Notice('⚠️ Failed to save settings. See console for details.');
		}
	}

	async loadSettings() {
		const saved = (await this.loadData()) || {};
		const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.settings = this.validateSettings(merged);
		if (typeof this.updateDefaultApiSourceBasedOnAuth === 'function') {
			await this.updateDefaultApiSourceBasedOnAuth();
		}
	}

	addGlobalListener(el, type, fn) {
		el.addEventListener(type, fn);
		this.globalListeners.push({ el, type, fn });
	}

	removeAllGlobalListeners() {
		this.globalListeners.forEach(({ el, type, fn }) => {
			el.removeEventListener(type, fn);
		});
		this.globalListeners.length = 0;
	}
	
	handleEditClick(e, entry, statusEl, config = {}) {
    e.preventDefault();
    e.stopPropagation();
    const source = config.source || entry?._zoroMeta?.source || this.settings?.defaultApiSource || 'anilist';
    const mediaType = config.mediaType || entry?._zoroMeta?.mediaType || 'ANIME';
    const media = entry?.media;
    (async () => {
      const view = await this.connectedNotes.openSidePanelWithContext({ media, entry, source, mediaType });
      await view.showEditForEntry(entry, { source });
    })();
  }

	injectCSS() {
		const styleId = 'zoro-plugin-styles';
		const existingStyle = document.getElementById(styleId);
		if (existingStyle) existingStyle.remove();
		const style = document.createElement('style');
		style.id = styleId;
		style.textContent = `.zoro-container{}`;
		document.head.appendChild(style);
		this.globalLoader = document.createElement('div');
		this.globalLoader.id = 'zoro-global-loader';
		this.globalLoader.innerHTML = `
      <div class="global-loading-glow">
        <div class="tomoe-container">
          <span class="tomoe"></span>
          <span class="tomoe"></span>
          <span class="tomoe"></span>
        </div>
      </div>
    `;
		this.globalLoader.className = 'zoro-global-loader';
		document.body.appendChild(this.globalLoader);
	}

	onunload() {
		this.cache.stopAutoPrune().stopBackgroundRefresh().destroy();
		this.theme.removeTheme();
		// Convert any zoro-panel leaves to empty to avoid orphaned tabs
		try {
			const leaves = this.app?.workspace?.getLeavesOfType?.(ZORO_VIEW_TYPE) || [];
			for (const leaf of leaves) {
				leaf.setViewState({ type: 'empty' });
			}
		} catch {}
		const styleId = 'zoro-plugin-styles';
		const existingStyle = document.getElementById(styleId);
		if (existingStyle) {
			existingStyle.remove();
		}
		const loader = document.getElementById('zoro-global-loader');
		if (loader) loader.remove();
	}
}

export default ZoroPlugin;