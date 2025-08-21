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

	async showPanel(media, entry = null, triggerElement) {
		console.log('[OpenDetailPanel] showPanel called with:', { 
			media: { 
				id: media?.id, 
				type: media?.type, 
				_zoroMeta: media?._zoroMeta,
				idTmdb: media?.idTmdb,
				ids: media?.ids
			}, 
			entry: { 
				_zoroMeta: entry?._zoroMeta,
				media: {
					_zoroMeta: entry?.media?._zoroMeta,
					idTmdb: entry?.media?.idTmdb,
					ids: entry?.media?.ids
				}
			} 
		});
		
		this.closePanel();
		const panel = this.renderer.createPanel(media, entry);
		this.currentPanel = panel;
		this.renderer.positionPanel(panel, triggerElement);
		const closeBtn = panel.querySelector('.panel-close-btn');
		if (closeBtn) closeBtn.onclick = () => this.closePanel();
		document.body.appendChild(panel);
		document.addEventListener('click', this.boundOutsideClickHandler);
		this.plugin.requestQueue.showGlobalLoader();

		const shouldFetch = this.dataSource.shouldFetchDetailedData(media, entry);
		console.log('[OpenDetailPanel] shouldFetchDetailedData result:', shouldFetch);
		
		if (shouldFetch) {
			console.log('[OpenDetailPanel] Fetching detailed data for media ID:', media.id);
			this.dataSource.fetchAndUpdateData(media.id, entry, (detailedMedia, malData, imdbData) => {
				console.log('[OpenDetailPanel] Detailed data received:', { detailedMedia, malData, imdbData });
				if (this.currentPanel === panel) this.renderer.updatePanelContent(panel, detailedMedia, malData, imdbData);
			}).finally(() => this.plugin.requestQueue.hideGlobalLoader());
		} else {
			console.log('[OpenDetailPanel] Not fetching detailed data');
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