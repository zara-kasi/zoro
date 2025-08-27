// No obsidian imports needed
import { RenderDetailPanel } from './RenderDetailPanel.js';
import { DetailPanelSource } from './DetailPanelSource.js';

class OpenDetailPanel {
	constructor(plugin) {
		this.plugin = plugin;
		this.currentPanel = null;
		this.boundOutsideClickHandler = this.handleOutsideClick.bind(this);
		this.renderer = new RenderDetailPanel(plugin);
		this.dataSource = new DetailPanelSource(plugin);
	}

	async showPanel(media, entry = null, triggerElement, mountContainer = null) {
		this.closePanel();
		
		// If this is a TMDb trending MOVIE/TV item, resolve Simkl details first before rendering
		try {
			const mediaKind = media?.type || media?.format;
			const hasTmdbId = (Number(media?.idTmdb) > 0) || (Number(media?.ids?.tmdb) > 0) || (Number(media?.id) > 0 && (entry?._zoroMeta?.source || '').toLowerCase() === 'tmdb');
			const isMovieOrTv = mediaKind === 'MOVIE' || mediaKind === 'TV';
			if (hasTmdbId && isMovieOrTv) {
				const tmdbId = Number(media?.idTmdb || media?.ids?.tmdb || media?.id);
				const imdbId = media?.idImdb || media?.ids?.imdb || null;
				const resolved = await this.dataSource.resolveSimklIdFromExternal(tmdbId, imdbId, mediaKind);
				if (resolved) {
					// Enrich media with resolved Simkl id for downstream links
					media = { ...media, ids: { ...(media.ids || {}), simkl: resolved } };
				}
			}
		} catch {}

		const panel = this.renderer.createPanel(media, entry);
		this.currentPanel = panel;

		if (mountContainer && mountContainer.appendChild) {
			// Direct mount to provided container
			panel.classList.add('zoro-inline');
			this.renderer.positionPanel(panel, null);
			const closeBtn = panel.querySelector('.panel-close-btn');
			if (closeBtn) closeBtn.onclick = () => this.closePanel();
			mountContainer.appendChild(panel);
		} else {
			// Route to Side Panel - but actually mount the panel to the sidebar's embed container
			try {
				const mediaType = (entry?._zoroMeta?.mediaType || media?.type || media?.format || 'ANIME');
				const source = (entry?._zoroMeta?.source || 'anilist');
				const view = await this.plugin.connectedNotes.openSidePanelWithContext({ media, entry, source, mediaType });
				
				// FIXED: Actually mount the panel to the sidebar's embed container
				panel.classList.add('zoro-inline');
				this.renderer.positionPanel(panel, null);
				const closeBtn = panel.querySelector('.panel-close-btn');
				if (closeBtn) closeBtn.onclick = () => this.closePanel();
				
				// Mount to the sidebar's embed container instead of calling showDetailsForMedia
				if (view.embedEl) {
					view.embedEl.appendChild(panel);
					view.currentMode = 'details';
					view.showContentContainer(false);
					view.showEmbedContainer(true);
				}
				
			} catch (err) {
				console.error('[Zoro][Details] Failed to open Side Panel for details', err);
			}
		}

		this.plugin.requestQueue.showGlobalLoader();

		if (this.dataSource.shouldFetchDetailedData(media)) {
			this.dataSource.fetchAndUpdateData(media.id, entry, (detailedMedia, malData, imdbData) => {
				if (this.currentPanel === panel) this.renderer.updatePanelContent(panel, detailedMedia, malData, imdbData);
			}).finally(() => this.plugin.requestQueue.hideGlobalLoader());
		} else {
			this.plugin.requestQueue.hideGlobalLoader();
		}

		return panel;
	}

	handleOutsideClick(event) {
		if (this.currentPanel && !this.currentPanel.contains(event.target)) this.closePanel();
	}

	closePanel() {
		if (this.currentPanel) {
			this.renderer.cleanupCountdowns(this.currentPanel);
			document.removeEventListener('click', this.boundOutsideClickHandler);
			this.currentPanel.remove();
			this.currentPanel = null;
		}
	}
}

export { OpenDetailPanel };