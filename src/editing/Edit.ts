/**
 * Edit - Main edit modal orchestrator
 * Migrated from Edit.js → Edit.ts
 * - Added Plugin typing from obsidian
 * - Typed method parameters and return values
 * - Added interfaces for entry, config, and modal structures
 */
import { Notice } from 'obsidian';
import type { Plugin } from 'obsidian';
import { RenderEditModal } from './modals/RenderEditModal.js';
import { AniListEditModal } from './modals/AniListEditModal.js';
import { MALEditModal } from './modals/MALEditModal.js';
import { SimklEditModal } from './modals/SimklEditModal.js';
import { SupportEditModal } from './modals/SupportEditModal.js';

// Core interfaces
interface MediaEntry {
  id?: number;
  media?: {
    id: number;
    type?: string;
    format?: string;
    title?: {
      romaji?: string;
      english?: string;
      native?: string;
    };
  };
  _zoroMeta?: {
    source?: string;
    mediaType?: string;
  };
  status?: string;
  score?: number;
  progress?: number;
  [key: string]: unknown;
}

interface StatusConfig {
  value: string;
  label: string;
  emoji: string;
}

interface FieldConfig {
  label: string;
  emoji: string;
  id: string;
  min?: number;
  max?: number;
  step?: number;
}

interface ButtonConfig {
  label?: string;
  class: string;
  hearts?: {
    empty: string;
    filled: string;
  };
}

interface EditConfig {
  statuses: StatusConfig[];
  fields: {
    status: FieldConfig;
    score: FieldConfig;
    progress: FieldConfig;
  };
  buttons: {
    save: ButtonConfig;
    remove: ButtonConfig;
    favorite: ButtonConfig;
    close: ButtonConfig;
  };
}

interface FormFields {
  status: { input: HTMLSelectElement };
  score: { input: HTMLInputElement };
  progress: { input: HTMLInputElement };
}

interface ActionButtons {
  save: HTMLButtonElement;
  remove: HTMLButtonElement;
}

interface ModalElements {
  container: HTMLElement;
  content: HTMLElement;
  form: HTMLFormElement;
}

interface EditProvider {
  updateEntry(entry: MediaEntry, updates: Record<string, unknown>, onSave?: (updatedEntry: MediaEntry) => void): Promise<void>;
  removeEntry(entry: MediaEntry): Promise<void>;
  invalidateCache(entry: MediaEntry): void;
  supportsFeature(feature: string): boolean;
  initializeFavoriteButton?(entry: MediaEntry, button: HTMLElement): Promise<void>;
  toggleFavorite?(entry: MediaEntry, button: HTMLElement): Promise<void>;
}

interface MountContainer {
  appendChild(node: Node): Node;
}

class Edit {
  private plugin: Plugin;
  private saving: boolean;
  private config: EditConfig;
  private renderer: RenderEditModal;
  private support: SupportEditModal;
  private anilistProvider: AniListEditModal;
  private malProvider: MALEditModal;
  private simklProvider: SimklEditModal;
  private providers: Record<string, EditProvider>;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.saving = false;
    this.config = {
      statuses: [
        { value: 'CURRENT', label: 'Current', emoji: '📺' },
        { value: 'PLANNING', label: 'Planning', emoji: '📋' },
        { value: 'COMPLETED', label: 'Completed', emoji: '✅' },
        { value: 'DROPPED', label: 'Dropped', emoji: '❌' },
        { value: 'PAUSED', label: 'On hold', emoji: '⏸️' },
        { value: 'REPEATING', label: 'Repeating', emoji: '🔄' }
      ],
      fields: {
        status: { label: 'Status', emoji: '', id: 'zoro-status' },
        score: { label: 'Score', emoji: '', id: 'zoro-score', min: 1, max: 10, step: 1 },
        progress: { label: 'Progress', emoji: '', id: 'zoro-progress' }
      },
      buttons: {
        save: { label: 'Save', class: 'zoro-save-btn' },
        remove: { label: '️Remove', class: 'zoro-remove-btn' },
        favorite: { class: 'zoro-fav-btn', hearts: { empty: '', filled: '' } },
        close: { class: 'zoro-modal-close' }
      }
    };

    this.renderer = new RenderEditModal(this.config);
    this.support = new SupportEditModal(plugin, this.renderer);
    this.anilistProvider = new AniListEditModal(plugin) as EditProvider;
    this.malProvider = new MALEditModal(plugin) as EditProvider;
    this.simklProvider = new SimklEditModal(plugin) as EditProvider;
    
    this.providers = {
      'anilist': this.anilistProvider,
      'mal': this.malProvider,
      'simkl': this.simklProvider
    };
  }

  createEditModal(
    entry: MediaEntry, 
    onSave?: (updatedEntry: MediaEntry) => void, 
    onCancel?: () => void, 
    source: string = 'anilist'
  ): null {
    // Route to Side Panel inline always
    try {
      const media = entry?.media;
      const mediaType = entry?._zoroMeta?.mediaType || media?.type || media?.format || 'ANIME';
      const resolvedSource = entry?._zoroMeta?.source || source || 'anilist';
      
      // TODO: confirm plugin method signature and return type
      if (this.plugin && 'connectedNotes' in this.plugin && 
          typeof (this.plugin as any).connectedNotes === 'object' &&
          'openSidePanelWithContext' in (this.plugin as any).connectedNotes) {
        (this.plugin as any).connectedNotes.openSidePanelWithContext({ media, entry, source: resolvedSource, mediaType })
          .then((view: any) => view.showEditForEntry(entry, { source: resolvedSource }));
      }
    } catch (e) {
      console.error('[Zoro][Edit] Failed to route to Side Panel for modal call', e);
    }
    return null;
  }

  createInlineEdit(
    entry: MediaEntry, 
    onSave?: (updatedEntry: MediaEntry) => void, 
    onCancel?: () => void, 
    source: string = 'anilist', 
    mountContainer: MountContainer | null = null
  ): ModalElements {
    // Force TMDb movie/TV to use Simkl provider for editing
    const isTmdb = (entry._zoroMeta?.source || source) === 'tmdb';
    const mt = (entry._zoroMeta?.mediaType || '').toUpperCase();
    const actualSource = (isTmdb && (mt === 'MOVIE' || mt === 'MOVIES' || mt === 'TV' || mt === 'SHOW' || mt === 'SHOWS'))
      ? 'simkl'
      : (entry._zoroMeta?.source || source);
    const provider = this.providers[actualSource];

    // Build inline container structure (no overlay) - styling handled by CSS
    const container = document.createElement('div');
    container.className = 'zoro-edit-modal zoro-inline';
    const content = document.createElement('div');
    content.className = 'zoro-modal-content';
    const form = document.createElement('form');
    form.className = 'zoro-edit-form';
    content.appendChild(form);
    container.appendChild(content);

    // Compose UI via existing renderer helpers
    const title = this.renderer.createTitle(entry);
    const closeBtn = this.renderer.createCloseButton(() => {
      try { container.remove(); } catch {}
      if (typeof onCancel === 'function') onCancel();
    });
    const favoriteBtn = this.renderer.createFavoriteButton(entry, actualSource, (entryToFav, btn, src) => this.toggleFavorite(entryToFav, btn, src));
    const formFields = this.renderer.createFormFields(entry, actualSource);
    const quickButtons = this.renderer.createQuickProgressButtons(entry, formFields.progress.input, formFields.status.input);
    const actionButtons = this.renderer.createActionButtons(entry, () => this.handleRemoveInline(entry, container, actualSource), this.config, actualSource);

    // Assemble DOM
    this.renderer.assembleModal(content, form, {
      title,
      closeBtn,
      favoriteBtn,
      formFields,
      quickButtons,
      actionButtons
    });

    // Wire up submit for inline (no overlay lifecycle)
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (this.saving) return;
      this.saving = true;
      this.support.setSavingState(actionButtons.save);

      try {
        const updates = this.support.extractFormData(formFields);
        await provider.updateEntry(entry, updates, onSave);
        provider.invalidateCache(entry);
        this.support.refreshUI(entry);
        new Notice('✅ Saved');
      } catch (err: any) {
        this.support.showModalError(form, `Save failed: ${err.message}`);
        this.support.resetSaveButton(actionButtons.save);
        this.saving = false;
        return;
      }

      this.support.resetSaveButton(actionButtons.save);
      this.saving = false;
    };

    // Initialize favorites if supported
    if (provider.supportsFeature('favorites') && provider.initializeFavoriteButton) {
      this.initializeFavoriteButton(entry, favoriteBtn, actualSource);
    } else {
      favoriteBtn.style.display = 'none';
    }

    if (mountContainer && mountContainer.appendChild) {
      // Direct mount to provided container
      mountContainer.appendChild(container);
    } else {
      // Route to Side Panel - but actually mount the form to the sidebar's embed container
      try {
        const media = entry?.media;
        const mediaType = entry?._zoroMeta?.mediaType || media?.type || media?.format || 'ANIME';
        const resolvedSource = entry?._zoroMeta?.source || source || 'anilist';
        
        // TODO: confirm plugin method signature and view interface
        if (this.plugin && 'connectedNotes' in this.plugin && 
            typeof (this.plugin as any).connectedNotes === 'object' &&
            'openSidePanelWithContext' in (this.plugin as any).connectedNotes) {
          (this.plugin as any).connectedNotes.openSidePanelWithContext({ media, entry, source: resolvedSource, mediaType })
            .then((view: any) => {
              // FIXED: Mount the existing form instead of calling showEditForEntry
              if (view.embedEl) {
                view.embedEl.appendChild(container);
                view.currentMode = 'edit';
                view.showContentContainer(false);
                view.showEmbedContainer(true);
              }
            });
        }
      } catch (e) {
        console.error('[Zoro][Edit] Failed to route to Side Panel for inline edit', e);
      }
    }

    return { container, content, form };
  }

  async handleRemoveInline(entry: MediaEntry, container: HTMLElement, source: string): Promise<void> {
    if (!confirm('Remove this entry?')) return;
    const removeBtn = container.querySelector('.zoro-remove-btn') as HTMLButtonElement;
    this.support.setRemovingState(removeBtn);

    try {
      const provider = this.providers[source];
      if (!provider.supportsFeature('remove')) {
        throw new Error(`${source.toUpperCase()} does not support removing entries via API`);
      }
      await provider.removeEntry(entry);
      provider.invalidateCache(entry);
      this.support.refreshUI(entry);
      try { container.remove(); } catch {}
      new Notice('✅ Removed');
    } catch (e: any) {
      this.support.showModalError(container.querySelector('.zoro-edit-form') as HTMLFormElement, `Remove failed: ${e.message}`);
      this.support.resetRemoveButton(removeBtn);
    }
  }

  async initializeFavoriteButton(entry: MediaEntry, favBtn: HTMLElement, source: string): Promise<void> {
    const provider = this.providers[source];
    if (provider.initializeFavoriteButton) {
      await provider.initializeFavoriteButton(entry, favBtn);
    }
  }

  async toggleFavorite(entry: MediaEntry, favBtn: HTMLElement, source: string): Promise<void> {
    const provider = this.providers[source];
    if (provider.toggleFavorite) {
      await provider.toggleFavorite(entry, favBtn);
    }
  }

  async handleSave(
    entry: MediaEntry, 
    onSave: ((updatedEntry: MediaEntry) => void) | undefined, 
    saveBtn: HTMLButtonElement, 
    formFields: FormFields, 
    modal: ModalElements, 
    source: string
  ): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.support.setSavingState(saveBtn);
    
    const form = modal.form;
    
    try {
      const updates = this.support.extractFormData(formFields);
      const provider = this.providers[source];
      
      await provider.updateEntry(entry, updates, onSave);
      
      provider.invalidateCache(entry);
      this.support.refreshUI(entry);
      this.support.closeModal(modal.container, () => {});
      
      new Notice('✅ Saved');
    } catch (err: any) {
      this.support.showModalError(form, `Save failed: ${err.message}`);
      this.support.resetSaveButton(saveBtn);
      this.saving = false;
      return;
    }
    
    this.support.resetSaveButton(saveBtn);
    this.saving = false;
  }

  async handleRemove(entry: MediaEntry, modalElement: HTMLElement, source: string): Promise<void> {
    if (!confirm('Remove this entry?')) return;
    
    const removeBtn = modalElement.querySelector('.zoro-remove-btn') as HTMLButtonElement;
    this.support.setRemovingState(removeBtn);
    
    try {
      const provider = this.providers[source];
      
      if (!provider.supportsFeature('remove')) {
        throw new Error(`${source.toUpperCase()} does not support removing entries via API`);
      }
      
      await provider.removeEntry(entry);
      
      provider.invalidateCache(entry);
      this.support.refreshUI(entry);
      this.support.closeModal(modalElement, () => {});
      
      new Notice('✅ Removed');
    } catch (e: any) {
      this.support.showModalError(modalElement.querySelector('.zoro-edit-form') as HTMLFormElement, `Remove failed: ${e.message}`);
      this.support.resetRemoveButton(removeBtn);
    }
  }

  closeModal(modalElement: HTMLElement, onCancel?: () => void): void {
    this.support.closeModal(modalElement, onCancel);
  }
}

export { Edit };
