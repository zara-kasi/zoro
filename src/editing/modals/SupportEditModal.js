const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

class SupportEditModal {
  constructor(plugin, renderer) {
    this.plugin = plugin;
    this.renderer = renderer;
  }

  validateScore(scoreValue) {
    const scoreVal = parseFloat(scoreValue);
    if (scoreValue && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
      return { valid: false, error: "Score must be between 0 and 10" };
    }
    return { valid: true, value: scoreValue === '' ? null : scoreVal };
  }

  extractFormData(formFields) {
    const scoreValidation = this.validateScore(formFields.score.input.value);
    if (!scoreValidation.valid) {
      throw new Error(scoreValidation.error);
    }

    return {
      status: formFields.status.input.value,
      score: scoreValidation.value,
      progress: parseInt(formFields.progress.input.value) || 0
    };
  }

  setupModalInteractions(modal, overlay, onCancel) {
    overlay.onclick = () => this.closeModal(modal.container, onCancel);
  }

  setupFormSubmission(form, handleSaveFunction) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      await handleSaveFunction();
    };
  }

  setupEscapeListener(onCancel, modal, saveFunction) {
    const escListener = (e) => {
      if (e.key === 'Escape') {
        this.closeModal(modal.container, onCancel);
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        saveFunction();
      }
    };
    
    this.plugin.addGlobalListener(document, 'keydown', escListener);
    modal._escListener = escListener;
  }

  closeModal(modalElement, onCancel) {
    if (modalElement && modalElement.parentNode) {
      modalElement.parentNode.removeChild(modalElement);
    }
    if (modalElement._escListener) {
      document.removeEventListener('keydown', modalElement._escListener);
    }
    this.plugin.removeAllGlobalListeners();
    onCancel();
  }

  showModalError(form, msg) {
    form.querySelector('.zoro-modal-error')?.remove();
    const banner = document.createElement('div');
    banner.className = 'zoro-modal-error';
    banner.textContent = msg;
    form.appendChild(banner);
  }

  resetSaveButton(saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }

  setSavingState(saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  setRemovingState(removeBtn) {
    removeBtn.disabled = true;
    removeBtn.innerHTML = `
<div class="global-loading-glow">
  <div class="tomoe-container">
    <span class="tomoe"></span>
    <span class="tomoe"></span>
    <span class="tomoe"></span>
  </div>
</div>
`;
  }

  resetRemoveButton(removeBtn) {
    removeBtn.disabled = false;
    removeBtn.textContent = '🗑️';
  }

  detectSource(entry) {
    if (this.plugin.currentApi === 'mal' || entry.source === 'mal') {
      return 'mal';
    }
    return 'anilist';
  }

  refreshUI(entry) {
    const card = document.querySelector(`.zoro-container [data-media-id="${entry.media.id}"]`);
    if (card) {
      const statusBadge = card.querySelector('.clickable-status');
      if (statusBadge) {
        statusBadge.textContent = entry.status;
        statusBadge.className = `status-badge status-${entry.status.toLowerCase()} clickable-status`;
      }
      const scoreEl = card.querySelector('.score');
      if (scoreEl) scoreEl.textContent = entry.score != null ? `★ ${entry.score}` : '';
      
      const progressEl = card.querySelector('.progress');
      if (progressEl) {
        const total = entry.media.episodes || entry.media.chapters || '?';
        progressEl.textContent = `${entry.progress}/${total}`;
      }
    } else {
      const container = Array.from(document.querySelectorAll('.zoro-container'))
                              .find(c => c.querySelector(`[data-media-id="${entry.media.id}"]`));
      if (container) {
        const block = container.closest('.markdown-rendered')?.querySelector('code');
        if (block) {
          container.innerHTML = '';
          container.appendChild(this.plugin.render.createListSkeleton(1));
          this.plugin.processZoroCodeBlock(block.textContent, container, {});
        }
      }
    }
  }
}

export { SupportEditModal };