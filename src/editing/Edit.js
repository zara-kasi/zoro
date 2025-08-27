import { Notice } from 'obsidian';
import { RenderEditModal } from './modals/RenderEditModal.js';
import { AniListEditModal } from './modals/AniListEditModal.js';
import { MALEditModal } from './modals/MALEditModal.js';
import { SimklEditModal } from './modals/SimklEditModal.js';
import { SupportEditModal } from './modals/SupportEditModal.js';

class Edit {
  constructor(plugin) {
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
        status: { label: 'Status', emoji: '🧿', id: 'zoro-status' },
        score: { label: 'Score', emoji: '⭐', id: 'zoro-score', min: 0, max: 10, step: 1 },
        progress: { label: 'Progress', emoji: '📊', id: 'zoro-progress' }
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
    this.anilistProvider = new AniListEditModal(plugin);
    this.malProvider = new MALEditModal(plugin);
    this.simklProvider = new SimklEditModal(plugin);
        this.providers = {
      'anilist': this.anilistProvider,
      'mal': this.malProvider,
      'simkl': this.simklProvider
    };
  }

  createEditModal(entry, onSave, onCancel, source = 'anilist') {

  // Force TMDb movie/TV to use Simkl provider for editing
  const isTmdb = (entry._zoroMeta?.source || source) === 'tmdb';
  const mt = (entry._zoroMeta?.mediaType || '').toUpperCase();
  const actualSource = (isTmdb && (mt === 'MOVIE' || mt === 'MOVIES' || mt === 'TV' || mt === 'SHOW' || mt === 'SHOWS'))
    ? 'simkl'
    : (entry._zoroMeta?.source || source);
  const provider = this.providers[actualSource];
  
  const modal = this.renderer.createModalStructure();
  const { overlay, content, form } = modal;
  
  const title = this.renderer.createTitle(entry);
  const closeBtn = this.renderer.createCloseButton(() => this.support.closeModal(modal.container, onCancel));
  const favoriteBtn = this.renderer.createFavoriteButton(entry, actualSource, (entry, btn, src) => this.toggleFavorite(entry, btn, src));
  const formFields = this.renderer.createFormFields(entry, actualSource); // Pass actualSource here
  const quickButtons = this.renderer.createQuickProgressButtons(entry, formFields.progress.input, formFields.status.input);
  const actionButtons = this.renderer.createActionButtons(entry, () => this.handleRemove(entry, modal.container, actualSource), this.config, actualSource);
  
  this.support.setupModalInteractions(modal, overlay, onCancel);
  this.support.setupFormSubmission(form, () => this.handleSave(entry, onSave, actionButtons.save, formFields, modal, actualSource));
  this.support.setupEscapeListener(onCancel, modal, () => {
    this.handleSave(entry, onSave, actionButtons.save, formFields, modal, actualSource);
  });
  
  this.renderer.assembleModal(content, form, {
    title,
    closeBtn,
    favoriteBtn,
    formFields,
    quickButtons,
    actionButtons
  });
  
  document.body.appendChild(modal.container);
  
  if (provider.supportsFeature('favorites')) {
    this.initializeFavoriteButton(entry, favoriteBtn, actualSource);
  } else {
    favoriteBtn.style.display = 'none';
  }
  
  return modal;
}

  createInlineEdit(entry, onSave, onCancel, source = 'anilist', mountContainer = null) {
    // Fallback to modal if no mount container provided
    if (!mountContainer || !mountContainer.appendChild) {
      return this.createEditModal(entry, onSave, onCancel, source);
    }

    // Force TMDb movie/TV to use Simkl provider for editing (same logic as modal)
    const isTmdb = (entry._zoroMeta?.source || source) === 'tmdb';
    const mt = (entry._zoroMeta?.mediaType || '').toUpperCase();
    const actualSource = (isTmdb && (mt === 'MOVIE' || mt === 'MOVIES' || mt === 'TV' || mt === 'SHOW' || mt === 'SHOWS'))
      ? 'simkl'
      : (entry._zoroMeta?.source || source);
    const provider = this.providers[actualSource];

    // Build inline container structure (no overlay)
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
      } catch (err) {
        this.support.showModalError(form, `Save failed: ${err.message}`);
        this.support.resetSaveButton(actionButtons.save);
        this.saving = false;
        return;
      }

      this.support.resetSaveButton(actionButtons.save);
      this.saving = false;
    };

    // Initialize favorites if supported
    if (provider.supportsFeature('favorites')) {
      this.initializeFavoriteButton(entry, favoriteBtn, actualSource);
    } else {
      favoriteBtn.style.display = 'none';
    }

    // Mount into provided container
    mountContainer.appendChild(container);
    return { container, content, form };
  }

  async handleRemoveInline(entry, container, source) {
    if (!confirm('Remove this entry?')) return;
    const removeBtn = container.querySelector('.zoro-remove-btn');
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
    } catch (e) {
      this.support.showModalError(container.querySelector('.zoro-edit-form'), `Remove failed: ${e.message}`);
      this.support.resetRemoveButton(removeBtn);
    }
  }

  async initializeFavoriteButton(entry, favBtn, source) {
    const provider = this.providers[source];
    await provider.initializeFavoriteButton(entry, favBtn);
  }

  async toggleFavorite(entry, favBtn, source) {
    const provider = this.providers[source];
    await provider.toggleFavorite(entry, favBtn);
  }

  async handleSave(entry, onSave, saveBtn, formFields, modal, source) {
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
    } catch (err) {
      this.support.showModalError(form, `Save failed: ${err.message}`);
      this.support.resetSaveButton(saveBtn);
      this.saving = false;
      return;
    }
    
    this.support.resetSaveButton(saveBtn);
    this.saving = false;
  }

  async handleRemove(entry, modalElement, source) {
    if (!confirm('Remove this entry?')) return;
    
    const removeBtn = modalElement.querySelector('.zoro-remove-btn');
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
    } catch (e) {
      this.support.showModalError(modalElement.querySelector('.zoro-edit-form'), `Remove failed: ${e.message}`);
      this.support.resetRemoveButton(removeBtn);
    }
  }

  closeModal(modalElement, onCancel) {
    this.support.closeModal(modalElement, onCancel);
  }
}

export { Edit };