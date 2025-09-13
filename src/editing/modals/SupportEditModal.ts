/**
 * SupportEditModal - Support utilities for edit modal operations
 * Migrated from SupportEditModal.js → SupportEditModal.ts
 * - Added Plugin typing from obsidian
 * - Typed method parameters and validation structures
 * - Added interfaces for form data and validation results
 */
import { Notice } from 'obsidian';
import type { Plugin } from 'obsidian';
import { DOMHelper } from '../../rendering/helpers/DOMHelper.js';

// Core interfaces
interface ValidationResult {
  valid: boolean;
  error?: string;
  value?: number | null;
}

interface FormFields {
  status: { input: HTMLSelectElement };
  score: { input: HTMLInputElement };
  progress: { input: HTMLInputElement };
}

interface ExtractedFormData {
  status: string;
  score: number | null;
  progress: number;
}

interface MediaEntry {
  id?: number;
  status?: string;
  score?: number | null;
  progress?: number;
  source?: string;
  media: {
    id: number;
    episodes?: number;
    chapters?: number;
  };
}

interface PluginWithZoro extends Plugin {
  currentApi?: string;
  render: {
    createListSkeleton(count: number): HTMLElement;
  };
  processZoroCodeBlock(content: string, container: HTMLElement, options: Record<string, unknown>): void;
}

interface RenderEditModal {
  // TODO: Add proper interface for renderer methods used
  [key: string]: unknown;
}

function isPluginWithZoro(plugin: Plugin): plugin is PluginWithZoro {
  return 'render' in plugin && 'processZoroCodeBlock' in plugin;
}

export class SupportEditModal {
  private plugin: PluginWithZoro;
  private renderer: RenderEditModal;

  constructor(plugin: Plugin, renderer: RenderEditModal) {
    if (!isPluginWithZoro(plugin)) {
      throw new Error('Plugin must have render and processZoroCodeBlock properties for Zoro integration');
    }
    this.plugin = plugin;
    this.renderer = renderer;
  }

  validateScore(scoreValue: string): ValidationResult {
    const scoreVal = parseFloat(scoreValue);
    if (scoreValue && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
      return { valid: false, error: "Score must be between 0 and 10" };
    }
    return { valid: true, value: scoreValue === '' ? null : scoreVal };
  }

  extractFormData(formFields: FormFields): ExtractedFormData {
    const scoreValidation = this.validateScore(formFields.score.input.value);
    if (!scoreValidation.valid) {
      throw new Error(scoreValidation.error || 'Invalid score');
    }
    return {
      status: formFields.status.input.value,
      score: scoreValidation.value || null,
      progress: parseInt(formFields.progress.input.value) || 0
    };
  }
  
  setupFormSubmission(form: HTMLFormElement, handleSaveFunction: () => Promise<void>): void {
    form.onsubmit = async (e) => {
      e.preventDefault();
      await handleSaveFunction();
    };
  }

  showModalError(form: HTMLFormElement, msg: string): void {
    form.querySelector('.zoro-modal-error')?.remove();
    const banner = document.createElement('div');
    banner.className = 'zoro-modal-error';
    banner.textContent = msg;
    form.appendChild(banner);
  }

  resetSaveButton(saveBtn: HTMLButtonElement): void {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }

  setSavingState(saveBtn: HTMLButtonElement): void {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  setRemovingState(removeBtn: HTMLButtonElement): void {
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

  resetRemoveButton(removeBtn: HTMLButtonElement): void {
    removeBtn.disabled = false;
    removeBtn.textContent = '🗑️';
  }

  detectSource(entry: MediaEntry): string {
    if (this.plugin.currentApi === 'mal' || entry.source === 'mal') {
      return 'mal';
    }
    return 'anilist';
  }

  refreshUI(entry: MediaEntry): void {
    const card = document.querySelector(`.zoro-container [data-media-id="${entry.media.id}"]`) as HTMLElement | null;
    if (card) {
      const statusBadge = card.querySelector('.clickable-status') as HTMLElement | null;
      if (statusBadge && entry.status) {
        statusBadge.textContent = entry.status;
        statusBadge.className = `status-badge status-${entry.status.toLowerCase()} clickable-status`;
      }
      
      const scoreEl = card.querySelector('.score') as HTMLElement | null;
      if (scoreEl) {
        scoreEl.textContent = entry.score != null ? `★ ${entry.score}` : '';
      }
      
      const progressEl = card.querySelector('.progress') as HTMLElement | null;
      if (progressEl) {
        const total = entry.media.episodes || entry.media.chapters || '?';
        progressEl.textContent = `${entry.progress}/${total}`;
      }
    } else {
      const container = Array.from(document.querySelectorAll('.zoro-container'))
        .find(c => c.querySelector(`[data-media-id="${entry.media.id}"]`)) as HTMLElement | undefined;
      
      if (container) {
        const block = container.closest('.markdown-rendered')?.querySelector('code') as HTMLElement | null;
        if (block) {
          container.innerHTML = '';
          container.appendChild(this.plugin.render.createListSkeleton(1));
          this.plugin.processZoroCodeBlock(block.textContent || '', container, {});
        }
      }
    }
  }

  closeModal(modalElement: HTMLElement, onCancel?: () => void): void {
    try { 
      modalElement.remove(); 
    } catch {}
    if (typeof onCancel === 'function') {
      onCancel();
    }
  }
}
