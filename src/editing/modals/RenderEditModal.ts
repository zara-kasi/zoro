/**
 * RenderEditModal - UI component builder for edit modals
 * Migrated from RenderEditModal.js → RenderEditModal.ts
 * - Added strict typing for DOM elements and configuration
 * - Typed method parameters and return values
 * - Added interfaces for form fields and modal elements
 */
import { Notice } from 'obsidian';

// Core interfaces
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

interface MediaEntry {
  id?: number;
  status?: string;
  score?: number | null;
  progress?: number;
  media: {
    id: number;
    title: {
      english?: string;
      romaji?: string;
      native?: string;
    };
    episodes?: number;
    chapters?: number;
    format?: string;
    isFavourite?: boolean;
  };
  _zoroMeta?: {
    mediaType?: string;
    source?: string;
  };
}

interface FormFieldResult {
  group: HTMLDivElement;
  input: HTMLSelectElement | HTMLInputElement;
  label: HTMLLabelElement;
}

interface FormFields {
  status: FormFieldResult;
  score: FormFieldResult;
  progress: FormFieldResult;
}

interface QuickButtons {
  container: HTMLDivElement;
  plus: HTMLButtonElement;
  minus: HTMLButtonElement;
  complete: HTMLButtonElement;
}

interface ActionButtons {
  container: HTMLDivElement;
  remove: HTMLButtonElement;
  save: HTMLButtonElement;
}

interface ModalStructure {
  container: HTMLDivElement;
  overlay: null;
  content: HTMLDivElement;
  form: HTMLFormElement;
}

interface FormFieldOptions {
  type: 'select' | 'number' | 'text';
  label: string;
  emoji: string;
  id: string;
  value?: string | number | null;
  options?: {
    items?: StatusConfig[];
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
  };
  className?: string;
}

interface SelectOptions {
  items?: StatusConfig[];
}

interface NumberOptions {
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

interface TextOptions {
  placeholder?: string;
}

interface ActionButtonOptions {
  label?: string;
  className: string;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
}

interface AssemblyElements {
  title: HTMLHeadingElement;
  closeBtn: HTMLSpanElement;
  favoriteBtn: HTMLButtonElement;
  formFields: FormFields;
  quickButtons: QuickButtons;
  actionButtons: ActionButtons;
}

export class RenderEditModal {
  private config: EditConfig;

  constructor(config: EditConfig) {
    this.config = config;
  }

  createModalStructure(): ModalStructure {
    const container = document.createElement('div');
    container.className = 'zoro-edit-modal zoro-inline';
    const content = document.createElement('div');
    content.className = 'zoro-modal-content';
    const form = document.createElement('form');
    form.className = 'zoro-edit-form';
    content.appendChild(form);
    container.append(content);
    return { container, overlay: null, content, form };
  }
  
  createTitle(entry: MediaEntry): HTMLHeadingElement {
    const title = document.createElement('h3');
    title.className = 'zoro-modal-title';
    title.textContent = entry.media.title.english || entry.media.title.romaji || 'Unknown Title';
    return title;
  }
  
  createCloseButton(onClick: () => void): HTMLSpanElement {
    const btn = document.createElement('span');
    btn.style.display = 'none';
    btn.onclick = onClick;
    return btn;
  }

  createFavoriteButton(
    entry: MediaEntry, 
    source: string, 
    onToggle: (entry: MediaEntry, btn: HTMLButtonElement, source: string) => void
  ): HTMLButtonElement {
    const favBtn = document.createElement('button');
    favBtn.className = this.config.buttons.favorite.class;
    favBtn.type = 'button';
    favBtn.title = 'Toggle Favorite';
    
    if (source === 'mal') {
      favBtn.style.display = 'none';
      return favBtn;
    }
    
    // Use emoji hearts instead of CSS classes
    if (entry.media.isFavourite) {
      favBtn.className = 'zoro-fav-btn zoro-heart';
      // TODO: confirm createEl method exists on HTMLButtonElement in Obsidian context
      (favBtn as any).createEl?.('span', { text: '❤️' }) || favBtn.appendChild(this.createSpan('❤️'));
    } else {
      favBtn.className = 'zoro-fav-btn zoro-no-heart';
      (favBtn as any).createEl?.('span', { text: '🤍' }) || favBtn.appendChild(this.createSpan('🤍'));
    }
    
    favBtn.onclick = () => onToggle(entry, favBtn, source);
    return favBtn;
  }

  private createSpan(text: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }
  
  createFormFields(entry: MediaEntry, source: string = 'anilist'): FormFields {
    const statusField = this.createStatusField(entry, source);
    const scoreField = this.createScoreField(entry);
    const progressField = this.createProgressField(entry);
    
    return {
      status: statusField,
      score: scoreField,
      progress: progressField
    };
  }
  
  createFormField(options: FormFieldOptions): FormFieldResult {
    const { type, label, emoji, id, value, options: fieldOptions = {}, className = '' } = options;
    
    const group = document.createElement('div');
    group.className = `zoro-form-group zoro-${type}-group ${className}`.trim();

    const labelEl = document.createElement('label');
    labelEl.className = `zoro-form-label zoro-${type}-label`;
    labelEl.textContent = `${emoji} ${label}`;
    labelEl.setAttribute('for', id);

    let input: HTMLSelectElement | HTMLInputElement;
    
    if (type === 'select') {
      input = this.createSelectInput(id, value, fieldOptions as SelectOptions);
    } else if (type === 'number') {
      input = this.createNumberInput(id, value, fieldOptions as NumberOptions);
    } else {
      input = this.createTextInput(id, value, fieldOptions as TextOptions);
    }

    group.appendChild(labelEl);
    group.appendChild(input);
    return { group, input, label: labelEl };
  }

  createSelectInput(id: string, selectedValue: string | number | null | undefined, options: SelectOptions): HTMLSelectElement {
    const { items = [] } = options;
    const select = document.createElement('select');
    select.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-select`;
    select.id = id;

    items.forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      if (item.value === selectedValue) option.selected = true;
      select.appendChild(option);
    });

    return select;
  }

  createNumberInput(id: string, value: string | number | null | undefined, options: NumberOptions): HTMLInputElement {
    const { min, max, step, placeholder } = options;
    const input = document.createElement('input');
    input.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-input`;
    input.type = 'number';
    input.id = id;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    input.value = value != null ? String(value) : '';
    if (placeholder) input.placeholder = placeholder;
    return input;
  }
  
  createTextInput(id: string, value: string | number | null | undefined, options: TextOptions): HTMLInputElement {
    const { placeholder } = options;
    const input = document.createElement('input');
    input.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-input`;
    input.type = 'text';
    input.id = id;
    input.value = value != null ? String(value) : '';
    if (placeholder) input.placeholder = placeholder;
    return input;
  }
  
  createStatusField(entry: MediaEntry, source: string = 'anilist'): FormFieldResult {
    const config = this.config.fields.status;
    
    // Filter out REPEATING status for MAL since it doesn't support it
    let availableStatuses = this.config.statuses;
    if (source === 'mal' || source === 'simkl') {
      availableStatuses = this.config.statuses.filter(status => status.value !== 'REPEATING');
    }
    
    // For Simkl movies, also filter out CURRENT and ON_HOLD since they're not supported
    if (source === 'simkl') {
      const mediaType = entry._zoroMeta?.mediaType || (entry.media?.format === 'MOVIE' ? 'MOVIE' : 'TV');
      const isMovie = mediaType === 'MOVIE' || mediaType === 'MOVIES';
      
      if (isMovie) {
        availableStatuses = availableStatuses.filter(status => 
          !['CURRENT', 'PAUSED'].includes(status.value)
        );
      }
    }
    
    return this.createFormField({
      type: 'select',
      label: config.label,
      emoji: config.emoji,
      id: config.id,
      value: entry.status,
      options: { items: availableStatuses }
    });
  }

  createScoreField(entry: MediaEntry): FormFieldResult {
    const config = this.config.fields.score;
    
    // Generate score options from 1 to max (10)
    const scoreOptions: StatusConfig[] = [
      { value: '', label: 'Unrated', emoji: '' } // Default/empty option
    ];
    
    // Add score options from 1 to 10 (0 is not a valid score)
    for (let i = 1; i <= (config.max || 10); i += (config.step || 1)) {
      scoreOptions.push({ value: i.toString(), label: i.toString(), emoji: '' });
    }
    
    return this.createFormField({
      type: 'select',
      label: `${config.label}`,
      emoji: config.emoji,
      id: config.id,
      value: entry.score !== null && entry.score !== undefined ? entry.score.toString() : '',
      options: { items: scoreOptions }
    });
  }

  createProgressField(entry: MediaEntry): FormFieldResult {
    const config = this.config.fields.progress;
    const maxProgress = entry.media.episodes || entry.media.chapters || 999;
    
    return this.createFormField({
      type: 'number',
      label: config.label,
      emoji: config.emoji,
      id: config.id,
      value: entry.progress || 0,
      options: {
        min: 0,
        max: maxProgress,
        placeholder: 'Progress'
      }
    });
  }

  createQuickProgressButtons(entry: MediaEntry, progressInput: HTMLInputElement, statusSelect: HTMLSelectElement): QuickButtons {
    const container = document.createElement('div');
    container.className = 'zoro-quick-progress-buttons';

    const plusBtn = this.createQuickButton('+1', 'zoro-plus-btn', () => {
      const current = parseInt(progressInput.value) || 0;
      const max = parseInt(progressInput.max) || Number.MAX_SAFE_INTEGER;
      if (current < max) progressInput.value = String(current + 1);
    });

    const minusBtn = this.createQuickButton('-1', 'zoro-minus-btn', () => {
      const current = parseInt(progressInput.value) || 0;
      if (current > 0) progressInput.value = String(current - 1);
    });

    const completeBtn = this.createQuickButton('Complete', 'zoro-complete-btn', () => {
      progressInput.value = String(entry.media.episodes || entry.media.chapters || 1);
      statusSelect.value = 'COMPLETED';
    });

    container.append(plusBtn, minusBtn, completeBtn);
    return { container, plus: plusBtn, minus: minusBtn, complete: completeBtn };
  }
  
  createQuickButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `zoro-quick-btn ${className}`;
    button.type = 'button';
    button.textContent = label;
    button.onclick = onClick;
    return button;
  }

  createActionButtons(entry: MediaEntry, onRemove: () => void, config: EditConfig, source: string = 'anilist'): ActionButtons {
    const container = document.createElement('div');
    container.className = 'zoro-modal-buttons';
    
    const removeBtn = this.createActionButton({
      label: config.buttons.remove.label,
      className: config.buttons.remove.class,
      onClick: onRemove
    });
    
    if (source === 'mal') {
      removeBtn.style.display = 'none';
    }
    
    const saveBtn = this.createActionButton({
      label: config.buttons.save.label,
      className: config.buttons.save.class,
      type: 'submit'
    });
    
    container.append(removeBtn, saveBtn);
    return { container, remove: removeBtn, save: saveBtn };
  }
  
  createActionButton(options: ActionButtonOptions): HTMLButtonElement {
    const { label, className, type = 'button', onClick, disabled = false } = options;
    const button = document.createElement('button');
    button.className = `zoro-modal-btn ${className}`;
    button.type = type;
    button.textContent = label || '';
    button.disabled = disabled;
    if (onClick) button.onclick = onClick;
    return button;
  }

  assembleModal(content: HTMLDivElement, form: HTMLFormElement, elements: AssemblyElements): void {
    content.appendChild(elements.closeBtn);
    const favContainer = document.createElement('div');
    favContainer.className = 'zoro-fav-container';
    favContainer.appendChild(elements.favoriteBtn);

    form.append(
      elements.title,
      elements.favoriteBtn,
      elements.formFields.status.group,
      elements.formFields.score.group,
      elements.formFields.progress.group,
      elements.quickButtons.container,
      elements.actionButtons.container
    );
  }
}
