import { ItemView, Notice } from 'obsidian';

const ZORO_VIEW_TYPE = 'zoro-panel';

class SidePanel extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentMode = 'blank';
		this.currentCleanup = null;
		this.context = null; // { media, entry, source, mediaType, searchIds }
	}

	getViewType() {
		return ZORO_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Zoro';
	}

	getIcon() {
		return 'book-open';
	}

	async onOpen() {
		this.renderLayout();
		this.setMode('blank');
	}

	async onClose() {
		this.teardownMode();
	}

	setContext(context) {
		this.context = context || null;
		// If a mode is active, re-render it with new context
		if (this.currentMode && this.currentMode !== 'blank') {
			this.setMode(this.currentMode, this.context);
		}
	}

	renderLayout() {
		const root = this.containerEl;
		root.empty();
		root.addClass('zoro-side-panel');

		// Toolbar (top)
		this.toolbarEl = root.createDiv({ cls: 'zoro-panel-toolbar' });
		this.connectBtn = this.toolbarEl.createEl('button', { text: 'Connect notes', cls: 'zoro-panel-btn' });
		this.createBtn = this.toolbarEl.createEl('button', { text: 'Create note', cls: 'zoro-panel-btn' });
		this.blankBtn = this.toolbarEl.createEl('button', { text: 'Home', cls: 'zoro-panel-btn' });

		this.connectBtn.onclick = () => this.setMode('connect', this.context);
		this.createBtn.onclick = () => this.setMode('create', this.context);
		this.blankBtn.onclick = () => this.setMode('blank');

		// Content (center)
		this.modeContainer = root.createDiv({ cls: 'zoro-panel-content' });
	}

	teardownMode() {
		try {
			if (typeof this.currentCleanup === 'function') {
				this.currentCleanup();
			}
		} finally {
			this.currentCleanup = null;
			if (this.modeContainer) this.modeContainer.empty();
		}
	}

	setMode(mode, context = null) {
		this.teardownMode();
		this.currentMode = mode;
		const ctx = context || this.context || {};

		// Highlight active button
		[this.connectBtn, this.createBtn, this.blankBtn].forEach(btn => btn && btn.removeClass('is-active'));
		if (mode === 'connect') this.connectBtn?.addClass('is-active');
		if (mode === 'create') this.createBtn?.addClass('is-active');
		if (mode === 'blank') this.blankBtn?.addClass('is-active');

		switch (mode) {
			case 'connect':
				this.currentCleanup = this.renderConnectMode(ctx);
				break;
			case 'create':
				this.currentCleanup = this.renderCreateMode(ctx);
				break;
			default:
				this.currentCleanup = this.renderBlankMode();
		}
	}

	renderBlankMode() {
		const c = this.modeContainer.createDiv({ cls: 'zoro-panel-blank' });
		c.createEl('h4', { text: 'Zoro Panel' });
		c.createEl('div', { text: 'Select a mode above to begin.' });
		return () => {};
	}

	renderConnectMode(ctx) {
		const container = this.modeContainer;
		const header = container.createDiv({ cls: 'zoro-panel-section-header' });
		header.createEl('h4', { text: 'Connected Notes' });

		// Guard: no context
		if (!ctx || !ctx.mediaType || !ctx.searchIds) {
			const info = container.createDiv({ cls: 'zoro-panel-info' });
			info.createEl('div', { text: 'No context provided.' });
			info.createEl('div', { text: 'Open the panel from a media card to provide IDs.' });
			return () => {};
		}

		// Notes list container
		const listWrap = container.createDiv({ cls: 'zoro-note-panel-content' });
		const emptyState = listWrap.createDiv({ cls: 'zoro-note-empty-state' });
		emptyState.createEl('div', { text: 'Loading…', cls: 'zoro-note-empty-message' });

		// Connect interface (hidden toggle desired). For simplicity, keep visible.
		const connectInterface = this.plugin.connectedNotes.renderConnectExistingInterface(container, ctx.searchIds, ctx.mediaType);

		let disposed = false;
		const load = async () => {
			const found = await this.plugin.connectedNotes.searchConnectedNotes(ctx.searchIds, ctx.mediaType);
			if (disposed) return;
			listWrap.empty();
			if (!found.length) {
				const es = listWrap.createDiv({ cls: 'zoro-note-empty-state' });
				es.createEl('div', { text: 'No notes linked yet', cls: 'zoro-note-empty-message' });
			} else {
				// Reuse renderer to build a list region
				const frag = document.createDocumentFragment();
				found.forEach(note => {
					const item = document.createElement('div');
					item.className = 'zoro-note-item';
					item.createEl('div', { text: note.title, cls: 'zoro-note-title' });
					item.onclick = () => {
						const mainLeaf = this.app.workspace.getLeaf('tab');
						mainLeaf.openFile(note.file);
						this.app.workspace.setActiveLeaf(mainLeaf);
					};
					frag.appendChild(item);
				});
				listWrap.appendChild(frag);
			}
		};
		load();

		return () => {
			disposed = true;
			connectInterface?.remove?.();
			listWrap?.remove?.();
		};
	}

	renderCreateMode(ctx) {
		const container = this.modeContainer;
		container.createEl('h4', { text: 'Create Connected Note' });
		// Guard: no context
		if (!ctx || !ctx.mediaType || !ctx.searchIds) {
			const info = container.createDiv({ cls: 'zoro-panel-info' });
			info.createEl('div', { text: 'No context provided.' });
			info.createEl('div', { text: 'Open the panel from a media card to provide IDs.' });
			return () => {};
		}
		const actions = container.createDiv({ cls: 'zoro-panel-actions' });
		const createBtn = actions.createEl('button', { text: 'Create note', cls: 'zoro-panel-btn' });
		createBtn.onclick = async () => {
			await this.plugin.connectedNotes.createNewConnectedNote(ctx.searchIds, ctx.mediaType);
			new Notice('Created connected note');
		};
		return () => {};
	}
}

export { SidePanel, ZORO_VIEW_TYPE };