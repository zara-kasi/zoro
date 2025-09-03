import { ItemView, Notice } from 'obsidian';

const ZORO_VIEW_TYPE = 'zoro-panel';

class SidePanel extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentCleanup = null;
		this.context = null; // { media, entry, source, mediaType, searchIds }
		this.embedEl = null;
		this.detailsBtn = null;
		this.editInlineBtn = null;
		this.createBtn = null;
		this.connectBtn = null;
		this.currentMode = null; // 'details' | 'edit' | null
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
		
		// Update button states based on new context
		this.updateButtonStates();
		
		if (this.context && this.context.mediaType && this.context.searchIds) {
			this.renderContextualUI(this.context);
		} else {
			this.resetToBlank();
		}
	}

	/**
	 * Update button states based on current context
	 */
	updateButtonStates() {
		if (!this.context) {
			// No context - all buttons should be disabled
			this.setButtonState(this.createBtn, false);
			this.setButtonState(this.connectBtn, false);
			this.setButtonState(this.detailsBtn, false);
			this.setButtonState(this.editInlineBtn, false);
			return;
		}

		// Create button - always active when there's context
		this.setButtonState(this.createBtn, true);
		
		// Connect button - always active when there's context
		this.setButtonState(this.connectBtn, true);
		
		// Details button - active only if media is available
		const hasMedia = !!(this.context.media || this.context.entry?.media);
		this.setButtonState(this.detailsBtn, hasMedia);
		
		// Edit button - active only if media is available (entry can be created)
		this.setButtonState(this.editInlineBtn, hasMedia);
	}

	/**
	 * Set button active/inactive state
	 * @param {HTMLElement} button - The button element
	 * @param {boolean} isActive - Whether the button should be active
	 */
	setButtonState(button, isActive) {
		if (!button) return;
		
		if (isActive) {
			button.classList.remove('disabled', 'inactive');
			button.removeAttribute('disabled');
			button.style.pointerEvents = '';
		} else {
			button.classList.add('inactive');
			button.setAttribute('disabled', 'true');
			button.style.pointerEvents = 'none';
		}
	}

	renderLayout() {
		const root = this.containerEl;
		root.empty();
		root.addClass('zoro-side-panel');

		// Toolbar (top) - with flexible button container
		this.toolbarEl = root.createDiv({ cls: 'zoro-panel-toolbar' });
		this.buttonContainerEl = this.toolbarEl.createDiv({ cls: 'zoro-panel-button-container' });
		
		this.createBtn = this.buttonContainerEl.createEl('button', { 
			text: '📝', 
			cls: 'zoro-panel-btn' 
		});
		this.connectBtn = this.buttonContainerEl.createEl('button', { 
			text: '⛓️', 
			cls: 'zoro-panel-btn' 
		});
		
		this.editInlineBtn = this.buttonContainerEl.createEl('button', {
			text: '️☑️',
			cls: 'zoro-panel-btn'
		});
		
		// New inline Details and Edit buttons
		this.detailsBtn = this.buttonContainerEl.createEl('button', {
			text: '🫔',
			cls: 'zoro-panel-btn'
		});

		// Search interface container (fixed position below toolbar)
		this.searchContainerEl = root.createDiv({ cls: 'zoro-panel-search-container' });

		// Inline embed container for details/edit UIs (rendered BELOW the buttons, inside the search container area)
		this.embedEl = this.searchContainerEl.createDiv({ cls: 'zoro-panel-embed is-hidden' });

		// Content (center - for notes list)
		this.contentEl = root.createDiv({ cls: 'zoro-panel-content' });
	}

	showToolbar(show) {
		if (!this.toolbarEl) return;
		if (show) this.toolbarEl.removeClass('is-hidden');
		else this.toolbarEl.addClass('is-hidden');
	}

	showSearchContainer(show) {
		if (!this.searchContainerEl) return;
		if (show) this.searchContainerEl.removeClass('is-hidden');
		else this.searchContainerEl.addClass('is-hidden');
	}

	showContentContainer(show) {
		if (!this.contentEl) return;
		if (show) this.contentEl.removeClass('is-hidden');
		else this.contentEl.addClass('is-hidden');
	}

	showEmbedContainer(show) {
		if (!this.embedEl) return;
		if (show) {
			this.embedEl.removeClass('is-hidden');
			// Ensure search container is visible when showing embeds (to render directly below toolbar)
			this.showSearchContainer(true);
		} else {
			this.embedEl.addClass('is-hidden');
		}
	}

	clearEmbed() {
		if (this.embedEl) this.embedEl.empty();
		this.currentMode = null;
		this.showEmbedContainer(false);
		this.showContentContainer(true);
		this.showSearchContainer(false);
	}

	teardownUI() {
		try {
			if (typeof this.currentCleanup === 'function') {
				this.currentCleanup();
			}
		} finally {
			this.currentCleanup = null;
			if (this.contentEl) this.contentEl.empty();
			// Do not empty searchContainerEl to preserve the persistent embed container
			if (this.embedEl) this.embedEl.empty();
		}
	}

	resetToBlank() {
		this.teardownUI();
		this.showToolbar(false);
		this.showSearchContainer(false);
		this.showEmbedContainer(false);
		this.showContentContainer(true);
		
		// Update button states for blank state
		this.updateButtonStates();
		
		const c = this.contentEl.createDiv({ cls: 'zoro-panel-blank' });
		c.createEl('div', { text: 'Open this panel from a media card to use actions.' });
	}

	renderContextualUI(ctx) {
		this.teardownUI();
		this.showToolbar(true);
		this.showSearchContainer(false); // Initially hidden
		this.showEmbedContainer(false);
		this.showContentContainer(true);

		// Hook up actions with state checks
		this.createBtn.onclick = async () => {
			if (this.createBtn.classList.contains('inactive') || this.createBtn.classList.contains('disabled')) {
				return; // Prevent action if disabled
			}
			await this.plugin.connectedNotes.createNewConnectedNote(ctx.searchIds, ctx.mediaType);
			new Notice('Created connected note');
			await this.reloadNotesList(ctx);
		};
		
		// Build list area in content
		const listWrap = this.contentEl.createDiv({ cls: 'zoro-note-panel-content' });
		const emptyState = listWrap.createDiv({ cls: 'zoro-note-empty-state' });
		emptyState.createEl('div', { text: 'Loading…', cls: 'zoro-note-empty-message' });
		
		// Build connect interface in the fixed search container
		const connectInterface = this.plugin.connectedNotes.renderConnectExistingInterface(this.searchContainerEl, ctx.searchIds, ctx.mediaType);
		connectInterface.classList.add('zoro-note-hidden');

		this.connectBtn.onclick = () => {
			if (this.connectBtn.classList.contains('inactive') || this.connectBtn.classList.contains('disabled')) {
				return; // Prevent action if disabled
			}
			
			const isCurrentlyHidden = connectInterface.classList.contains('zoro-note-hidden');
			connectInterface.classList.toggle('zoro-note-hidden');
			
			// Show/hide the search container based on interface visibility
			this.showSearchContainer(!isCurrentlyHidden);
			
			if (!connectInterface.classList.contains('zoro-note-hidden')) {
				const inp = connectInterface.querySelector('.zoro-note-search-input');
				setTimeout(() => inp?.focus(), 100);
			}
		};

		// Wire inline Details and Edit buttons if media/entry context is available
		this.detailsBtn.onclick = async () => {
			if (this.detailsBtn.classList.contains('inactive') || this.detailsBtn.classList.contains('disabled')) {
				return; // Prevent action if disabled
			}
			
			try {
				if (this.currentMode === 'details') {
					this.clearEmbed();
					return;
				}
				const media = ctx?.media || ctx?.entry?.media || null;
				if (!media) {
					new Notice('No media selected');
					return;
				}
				await this.showDetailsForMedia(media, ctx?.entry || null);
			} catch (e) {
				console.error('[Zoro][SidePanel] Failed to show details inline', e);
			}
		};

		this.editInlineBtn.onclick = async () => {
			if (this.editInlineBtn.classList.contains('inactive') || this.editInlineBtn.classList.contains('disabled')) {
				return; // Prevent action if disabled
			}
			
			try {
				if (this.currentMode === 'edit') {
					this.clearEmbed();
					return;
				}
				let entry = ctx?.entry || null;
				let source = (ctx?.entry?._zoroMeta?.source || ctx?.source || this.plugin?.settings?.defaultApiSource || 'anilist');
				if (!entry) {
					const media = ctx?.media || null;
					if (!media) {
						new Notice('No entry to edit');
						return;
					}
					// Create a minimal entry object compatible with edit form
					entry = {
						media,
						status: 'PLANNING',
						progress: 0,
						score: null,
						id: null,
						_zoroMeta: { source: source, mediaType: (media.type || media.format || ctx?.mediaType || 'ANIME') }
					};
				}

				await this.showEditForEntry(entry, { source });
			} catch (e) {
				console.error('[Zoro][SidePanel] Failed to show edit inline', e);
			}
		};

		// Update button states after setting up event handlers
		this.updateButtonStates();

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

	async showDetailsForMedia(media, entry = null) {
		if (!this.embedEl) return;
		this.embedEl.empty();
		this.showContentContainer(false);
		this.showEmbedContainer(true);
		try {
			await this.plugin.moreDetailsPanel.showPanel(media, entry, null, this.embedEl);
			this.currentMode = 'details';
		} catch (e) {
			console.error('[Zoro][SidePanel] Inline details failed', e);
			new Notice('Failed to load details');
		}
	}

	async showEditForEntry(entry, config = {}) {
		if (!this.embedEl) return;
		this.embedEl.empty();
		this.showContentContainer(false);
		this.showEmbedContainer(true);
		try {
			const source = config?.source || entry?._zoroMeta?.source || this.plugin?.settings?.defaultApiSource || 'anilist';
			await this.plugin.edit.createInlineEdit(
				entry,
				async (updates) => {
					// Route update to appropriate API
					try {
						if (source === 'mal') {
							await this.plugin.malApi.updateMediaListEntry(entry.media.id, updates);
						} else if (source === 'simkl') {
							await this.plugin.simklApi.updateMediaListEntry(entry.media.id, updates, entry?._zoroMeta?.mediaType);
						} else {
							await this.plugin.api.updateMediaListEntry(entry.media.id, updates);
						}
					} catch (err) {
						console.error('[Zoro][SidePanel] Update failed', err);
						throw err;
					}
				},
				() => {},
				source,
				this.embedEl
			);
			this.currentMode = 'edit';
		} catch (e) {
			console.error('[Zoro][SidePanel] Inline edit failed', e);
			new Notice('Failed to open edit form');
		}
	}

	async reloadNotesList(ctx) {
		if (!ctx) return;
		this.setContext(ctx); // simple re-render
	}
}

export { SidePanel, ZORO_VIEW_TYPE };