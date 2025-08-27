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
		// Only create a DOM panel when we actually have a container to mount into.
		if (mountContainer && mountContainer.appendChild) {
			const panel = this.renderer.createPanel(media, entry);
			this.currentPanel = panel;
			panel.classList.add('zoro-inline');
			this.renderer.positionPanel(panel, null);
			const closeBtn = panel.querySelector('.panel-close-btn');
			if (closeBtn) closeBtn.onclick = () => this.closePanel();
			mountContainer.appendChild(panel);
		} else {
			// Always route to Side Panel inline rendering if no mount container is provided
			try {
				const mediaType = (entry?._zoroMeta?.mediaType || media?.type || media?.format || 'ANIME');
				const source = (entry?._zoroMeta?.source || 'anilist');
				const view = await this.plugin.connectedNotes.openSidePanelWithContext({ media, entry, source, mediaType });
				await view.showDetailsForMedia(media, entry);
				return null;
			} catch (err) {
				console.error('[Zoro][Details] Failed to open Side Panel for details', err);
			}
		}
		// If we mounted inline, also perform async data updates for that panel instance
		if (this.currentPanel) {
			this.plugin.requestQueue.showGlobalLoader();
			if (this.dataSource.shouldFetchDetailedData(media)) {
				this.dataSource.fetchAndUpdateData(media.id, entry, (detailedMedia, malData, imdbData) => {
					if (this.currentPanel) this.renderer.updatePanelContent(this.currentPanel, detailedMedia, malData, imdbData);
				}).finally(() => this.plugin.requestQueue.hideGlobalLoader());
			} else {
				this.plugin.requestQueue.hideGlobalLoader();
			}
			return this.currentPanel;
		}
		return null;
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