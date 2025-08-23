import { ItemView, Notice } from 'obsidian';

const ZORO_VIEW_TYPE = 'zoro-panel';

class SidePanel extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
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
		this.resetToBlank();
	}

	async onClose() {
		this.teardownUI();
	}

	setContext(context) {
		this.context = context || null;
		if (this.context && this.context.mediaType && this.context.searchIds) {
			this.renderContextualUI(this.context);
		} else {
			this.resetToBlank();
		}
	}

	renderLayout() {
		const root = this.containerEl;
		root.empty();
		root.addClass('zoro-note-container'); // Use your existing main container class

		// Toolbar (top) - with flexible button container
		this.toolbarEl = root.createDiv({ cls: 'zoro-note-panel-footer' }); // Reuse your footer styling for toolbar
		
		this.createBtn = this.toolbarEl.createEl('button', { 
			text: '📝 Create Note', 
			cls: 'zoro-note-create-btn' // Use your existing create button class
		});
		this.connectBtn = this.toolbarEl.createEl('button', { 
			text: '⛓️ Connect Note', 
			cls: 'zoro-note-connect-existing-btn' // Use your existing connect button class
		});

		// Search interface container (fixed position below toolbar)
		this.searchContainerEl = root.createDiv({ cls: 'zoro-note-connect-interface zoro-note-hidden' });

		// Content (center - for notes list)
		this.contentEl = root.createDiv({ cls: 'zoro-note-panel-content' });
	}

	showToolbar(show) {
		if (!this.toolbarEl) return;
		if (show) this.toolbarEl.removeClass('is-hidden');
		else this.toolbarEl.addClass('is-hidden');
	}

	showSearchContainer(show) {
		if (!this.searchContainerEl) return;
		if (show) this.searchContainerEl.removeClass('zoro-note-hidden');
		else this.searchContainerEl.addClass('zoro-note-hidden');
	}

	teardownUI() {
		try {
			if (typeof this.currentCleanup === 'function') {
				this.currentCleanup();
			}
		} finally {
			this.currentCleanup = null;
			if (this.contentEl) this.contentEl.empty();
			if (this.searchContainerEl) this.searchContainerEl.empty();
		}
	}

	resetToBlank() {
		this.teardownUI();
		this.showToolbar(false);
		this.showSearchContainer(false);
		const c = this.contentEl.createDiv({ cls: 'zoro-note-empty-state' }); // Use your existing empty state class
		c.createEl('h4', { text: 'Zoro Panel' });
		c.createEl('div', { text: 'Open this panel from a media card to use actions.', cls: 'zoro-note-empty-message' });
	}

	renderContextualUI(ctx) {
		this.teardownUI();
		this.showToolbar(true);
		this.showSearchContainer(false); // Initially hidden

		// Hook up actions
		this.createBtn.onclick = async () => {
			await this.plugin.connectedNotes.createNewConnectedNote(ctx.searchIds, ctx.mediaType);
			new Notice('Created connected note');
			await this.reloadNotesList(ctx);
		};
		
		// Build list area in content
		const listWrap = this.contentEl.createDiv({ cls: 'zoro-note-notes-list' }); // Use your existing notes list class
		const emptyState = listWrap.createDiv({ cls: 'zoro-note-empty-state' });
		emptyState.createEl('div', { text: 'Loading…', cls: 'zoro-note-empty-message' });
		
		// Build connect interface in the fixed search container
		const connectInterface = this.plugin.connectedNotes.renderConnectExistingInterface(this.searchContainerEl, ctx.searchIds, ctx.mediaType);
		connectInterface.classList.add('zoro-note-hidden');

		this.connectBtn.onclick = () => {
			const isCurrentlyHidden = connectInterface.classList.contains('zoro-note-hidden');
			connectInterface.classList.toggle('zoro-note-hidden');
			
			// Show/hide the search container based on interface visibility
			this.showSearchContainer(!isCurrentlyHidden);
			
			if (!connectInterface.classList.contains('zoro-note-hidden')) {
				const inp = connectInterface.querySelector('.zoro-note-search-input');
				setTimeout(() => inp?.focus(), 100);
			}
		};

		let disposed = false;
		const load = async () => {
			const found = await this.plugin.connectedNotes.searchConnectedNotes(ctx.searchIds, ctx.mediaType);
			if (disposed) return;
			listWrap.empty();
			if (!found.length) {
				const es = listWrap.createDiv({ cls: 'zoro-note-empty-state' });
				es.createEl('div', { text: 'No notes linked yet', cls: 'zoro-note-empty-message' });
			} else {
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

		this.currentCleanup = () => {
			disposed = true;
			connectInterface?.remove?.();
			listWrap?.remove?.();
		};
	}

	async reloadNotesList(ctx) {
		if (!ctx) return;
		this.setContext(ctx); // simple re-render
	}
}

export { SidePanel, ZORO_VIEW_TYPE };