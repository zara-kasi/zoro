/**
 * SidePanel - Side panel view for Zoro plugin
 * Migrated from SidePanel.js → SidePanel.ts
 * - Added comprehensive typing for Obsidian ItemView integration
 * - Typed plugin dependencies and context objects
 * - Added proper DOM element typing and event handling
 */

import { ItemView, Notice, WorkspaceLeaf, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { ZoroPluginSettings, MediaType, ApiSource } from '../settings.js';

export const ZORO_VIEW_TYPE = 'zoro-panel';

export type PanelMode = 'details' | 'edit' | null;

export interface MediaObject {
  id: number;
  title?: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  type?: MediaType;
  format?: string;
  [key: string]: unknown;
}

export interface MediaListEntry {
  id: number | null;
  status: string | null;
  score: number | null;
  progress: number;
  media: MediaObject;
  _zoroMeta?: {
    source: ApiSource;
    mediaType: MediaType;
    [key: string]: unknown;
  };
}

export interface SearchIds {
  anilistId?: number;
  malId?: number;
  simklId?: number;
  imdbId?: string;
  tmdbId?: number;
  [key: string]: string | number | undefined;
}

export interface PanelContext {
  media?: MediaObject;
  entry?: MediaListEntry;
  source?: ApiSource;
  mediaType?: MediaType;
  searchIds?: SearchIds;
}

export interface ConnectedNote {
  title: string;
  file: TFile;
  [key: string]: unknown;
}

export interface ConnectedNotesModule {
  createNewConnectedNote(searchIds: SearchIds, mediaType: MediaType): Promise<void>;
  renderConnectExistingInterface(container: HTMLElement, searchIds: SearchIds, mediaType: MediaType): HTMLElement;
  searchConnectedNotes(searchIds: SearchIds, mediaType: MediaType): Promise<ConnectedNote[]>;
}

export interface MoreDetailsPanelModule {
  showPanel(media: MediaObject, entry: MediaListEntry | null, config: unknown, container: HTMLElement): Promise<void>;
}

export interface EditModule {
  createInlineEdit(
    entry: MediaListEntry,
    updateCallback: (updates: Record<string, unknown>) => Promise<void>,
    cancelCallback: () => void,
    source: ApiSource,
    container: HTMLElement
  ): Promise<void>;
}

export interface ApiModule {
  updateMediaListEntry(mediaId: number, updates: Record<string, unknown>): Promise<void>;
}

export interface PluginWithSidePanel {
  settings: ZoroPluginSettings;
  connectedNotes: ConnectedNotesModule;
  moreDetailsPanel: MoreDetailsPanelModule;
  edit: EditModule;
  api?: ApiModule;
  malApi?: ApiModule & {
    updateMediaListEntry(mediaId: number, updates: Record<string, unknown>): Promise<void>;
  };
  simklApi?: ApiModule & {
    updateMediaListEntry(mediaId: number, updates: Record<string, unknown>, mediaType?: MediaType): Promise<void>;
  };
}

export class SidePanel extends ItemView {
  private readonly plugin: PluginWithSidePanel;
  private currentCleanup: (() => void) | null = null;
  private context: PanelContext | null = null;
  private embedEl: HTMLElement | null = null;
  private detailsBtn: HTMLButtonElement | null = null;
  private editInlineBtn: HTMLButtonElement | null = null;
  private createBtn: HTMLButtonElement | null = null;
  private connectBtn: HTMLButtonElement | null = null;
  private currentMode: PanelMode = null;
  private eventHandlersAttached = false;
  
  // UI Elements
  private toolbarEl: HTMLElement | null = null;
  private buttonContainerEl: HTMLElement | null = null;
  private searchContainerEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PluginWithSidePanel) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ZORO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Zoro';
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    this.renderLayout();
    this.resetToBlank();
  }

  async onClose(): Promise<void> {
    this.teardownUI();
  }

  setContext(context: PanelContext | null): void {
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
  private updateButtonStates(): void {
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
   */
  private setButtonState(button: HTMLButtonElement | null, isActive: boolean): void {
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

  private renderLayout(): void {
    const root = this.containerEl;
    root.empty();
    root.addClass('zoro-side-panel');

    // Toolbar (top) - with flexible button container
    this.toolbarEl = root.createDiv({ cls: 'zoro-panel-toolbar' });
    this.buttonContainerEl = this.toolbarEl.createDiv({ cls: 'zoro-panel-button-container' });
    
    this.createBtn = this.buttonContainerEl.createEl('button', { 
      text: '📝', 
      cls: 'zoro-panel-btn' 
    }) as HTMLButtonElement;
    
    this.connectBtn = this.buttonContainerEl.createEl('button', { 
      text: '⛓️', 
      cls: 'zoro-panel-btn' 
    }) as HTMLButtonElement;
    
    this.editInlineBtn = this.buttonContainerEl.createEl('button', {
      text: '☑️',
      cls: 'zoro-panel-btn'
    }) as HTMLButtonElement;
    
    // New inline Details and Edit buttons
    this.detailsBtn = this.buttonContainerEl.createEl('button', {
      text: '🫔',
      cls: 'zoro-panel-btn'
    }) as HTMLButtonElement;

    // Search interface container (fixed position below toolbar)
    this.searchContainerEl = root.createDiv({ cls: 'zoro-panel-search-container' });

    // Inline embed container for details/edit UIs (rendered BELOW the buttons, inside the search container area)
    this.embedEl = this.searchContainerEl.createDiv({ cls: 'zoro-panel-embed is-hidden' });

    // Content (center - for notes list)
    this.contentEl = root.createDiv({ cls: 'zoro-panel-content' });

    // Attach event handlers immediately after creating buttons
    this.attachEventHandlers();
  }

  /**
   * Attach event handlers to buttons
   * This is separated from renderContextualUI to ensure handlers are always attached
   */
  private attachEventHandlers(): void {
    if (this.eventHandlersAttached) return;

    // Use event delegation with proper context checks
    this.createBtn?.addEventListener('click', async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (this.createBtn?.classList.contains('inactive') || this.createBtn?.classList.contains('disabled')) {
        return;
      }
      
      if (!this.context?.searchIds || !this.context?.mediaType) {
        return;
      }

      try {
        await this.plugin.connectedNotes.createNewConnectedNote(this.context.searchIds, this.context.mediaType);
        new Notice('Created connected note');
        await this.reloadNotesList(this.context);
      } catch (error) {
        console.error('[Zoro][SidePanel] Create note failed', error);
        new Notice('Failed to create note');
      }
    });

    this.connectBtn?.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (this.connectBtn?.classList.contains('inactive') || this.connectBtn?.classList.contains('disabled')) {
        return;
      }

      if (!this.context) return;

      const connectInterface = this.searchContainerEl?.querySelector('.zoro-connect-interface') as HTMLElement;
      if (!connectInterface) return;

      const isCurrentlyHidden = connectInterface.classList.contains('zoro-note-hidden');
      connectInterface.classList.toggle('zoro-note-hidden');
      
      // Show/hide the search container based on interface visibility
      this.showSearchContainer(!isCurrentlyHidden);
      
      if (!connectInterface.classList.contains('zoro-note-hidden')) {
        setTimeout(() => {
          const inp = connectInterface.querySelector('.zoro-note-search-input') as HTMLInputElement;
          inp?.focus();
        }, 100);
      }
    });

    this.detailsBtn?.addEventListener('click', async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (this.detailsBtn?.classList.contains('inactive') || this.detailsBtn?.classList.contains('disabled')) {
        return;
      }
      
      try {
        if (this.currentMode === 'details') {
          this.clearEmbed();
          return;
        }
        
        const media = this.context?.media || this.context?.entry?.media || null;
        if (!media) {
          new Notice('No media selected');
          return;
        }
        await this.showDetailsForMedia(media, this.context?.entry || null);
      } catch (error) {
        console.error('[Zoro][SidePanel] Failed to show details inline', error);
        new Notice('Failed to show details');
      }
    });

    this.editInlineBtn?.addEventListener('click', async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (this.editInlineBtn?.classList.contains('inactive') || this.editInlineBtn?.classList.contains('disabled')) {
        return;
      }
      
      try {
        if (this.currentMode === 'edit') {
          this.clearEmbed();
          return;
        }
        
        let entry = this.context?.entry || null;
        const source: ApiSource = (this.context?.entry?._zoroMeta?.source || this.context?.source || this.plugin?.settings?.defaultApiSource || 'anilist') as ApiSource;
        
        if (!entry) {
          const media = this.context?.media || null;
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
            _zoroMeta: { 
              source: source, 
              mediaType: (media.type || media.format || this.context?.mediaType || 'ANIME') as MediaType
            }
          };
        }

        await this.showEditForEntry(entry, { source });
      } catch (error) {
        console.error('[Zoro][SidePanel] Failed to show edit inline', error);
        new Notice('Failed to open edit form');
      }
    });

    this.eventHandlersAttached = true;
  }

  private showToolbar(show: boolean): void {
    if (!this.toolbarEl) return;
    if (show) this.toolbarEl.removeClass('is-hidden');
    else this.toolbarEl.addClass('is-hidden');
  }

  private showSearchContainer(show: boolean): void {
    if (!this.searchContainerEl) return;
    if (show) this.searchContainerEl.removeClass('is-hidden');
    else this.searchContainerEl.addClass('is-hidden');
  }

  private showContentContainer(show: boolean): void {
    if (!this.contentEl) return;
    if (show) this.contentEl.removeClass('is-hidden');
    else this.contentEl.addClass('is-hidden');
  }

  private showEmbedContainer(show: boolean): void {
    if (!this.embedEl) return;
    if (show) {
      this.embedEl.removeClass('is-hidden');
      // Ensure search container is visible when showing embeds (to render directly below toolbar)
      this.showSearchContainer(true);
    } else {
      this.embedEl.addClass('is-hidden');
    }
  }

  private clearEmbed(): void {
    if (this.embedEl) this.embedEl.empty();
    this.currentMode = null;
    this.showEmbedContainer(false);
    this.showContentContainer(true);
    this.showSearchContainer(false);
  }

  private teardownUI(): void {
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

  private resetToBlank(): void {
    this.teardownUI();
    this.showToolbar(false);
    this.showSearchContainer(false);
    this.showEmbedContainer(false);
    this.showContentContainer(true);
    
    // Update button states for blank state
    this.updateButtonStates();
    
    if (this.contentEl) {
      const c = this.contentEl.createDiv({ cls: 'zoro-panel-blank' });
      c.createEl('div', { text: 'Open this panel from a media card to use actions.' });
    }
  }

  private renderContextualUI(ctx: PanelContext): void {
    this.teardownUI();
    this.showToolbar(true);
    this.showSearchContainer(false); // Initially hidden
    this.showEmbedContainer(false);
    this.showContentContainer(true);

    if (!this.contentEl || !this.searchContainerEl) return;

    // Build list area in content
    const listWrap = this.contentEl.createDiv({ cls: 'zoro-note-panel-content' });
    const emptyState = listWrap.createDiv({ cls: 'zoro-note-empty-state' });
    emptyState.createEl('div', { text: 'Loading…', cls: 'zoro-note-empty-message' });
    
    // Build connect interface in the fixed search container
    const connectInterface = this.plugin.connectedNotes.renderConnectExistingInterface(
      this.searchContainerEl, 
      ctx.searchIds!, 
      ctx.mediaType!
    );
    connectInterface.classList.add('zoro-note-hidden', 'zoro-connect-interface');

    // Update button states after setting up UI
    this.updateButtonStates();

    let disposed = false;
    const load = async (): Promise<void> => {
      const found = await this.plugin.connectedNotes.searchConnectedNotes(ctx.searchIds!, ctx.mediaType!);
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
    
    load().catch(error => {
      console.error('[Zoro][SidePanel] Failed to load connected notes', error);
    });

    this.currentCleanup = () => {
      disposed = true;
      connectInterface?.remove?.();
      listWrap?.remove?.();
    };
  }

  private async showDetailsForMedia(media: MediaObject, entry: MediaListEntry | null = null): Promise<void> {
    if (!this.embedEl) return;
    this.embedEl.empty();
    this.showContentContainer(false);
    this.showEmbedContainer(true);
    try {
      await this.plugin.moreDetailsPanel.showPanel(media, entry, null, this.embedEl);
      this.currentMode = 'details';
    } catch (error) {
      console.error('[Zoro][SidePanel] Inline details failed', error);
      new Notice('Failed to load details');
    }
  }

  private async showEditForEntry(entry: MediaListEntry, config: { source?: ApiSource } = {}): Promise<void> {
    if (!this.embedEl) return;
    this.embedEl.empty();
    this.showContentContainer(false);
    this.showEmbedContainer(true);
    try {
      const source: ApiSource = config?.source || entry?._zoroMeta?.source || this.plugin?.settings?.defaultApiSource || 'anilist';
      await this.plugin.edit.createInlineEdit(
        entry,
        async (updates: Record<string, unknown>) => {
          // Route update to appropriate API
          try {
            if (source === 'mal') {
              await this.plugin.malApi?.updateMediaListEntry(entry.media.id, updates);
            } else if (source === 'simkl') {
              await this.plugin.simklApi?.updateMediaListEntry(entry.media.id, updates, entry?._zoroMeta?.mediaType);
            } else {
              await this.plugin.api?.updateMediaListEntry(entry.media.id, updates);
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
    } catch (error) {
      console.error('[Zoro][SidePanel] Inline edit failed', error);
      new Notice('Failed to open edit form');
    }
  }

  private async reloadNotesList(ctx: PanelContext): Promise<void> {
    if (!ctx) return;
    this.setContext(ctx); // simple re-render
  }
}
