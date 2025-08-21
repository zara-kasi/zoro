import { Notice } from 'obsidian';

class RenderEditModal {
  constructor(config) {
    this.config = config;
  }

  createModalStructure() {
    const container = document.createElement('div');
    container.className = 'zoro-edit-modal';
    
    const overlay = document.createElement('div');
    overlay.className = 'zoro-modal-overlay';
    
    const content = document.createElement('div');
    content.className = 'zoro-modal-content';
    
    const form = document.createElement('form');
    form.className = 'zoro-edit-form';
    
    content.appendChild(form);
    container.append(overlay, content);
    
    return { container, overlay, content, form };
  }
  
  createTitle(entry) {
    const title = document.createElement('h3');
    title.className = 'zoro-modal-title';
    title.textContent = entry.media.title.english || entry.media.title.romaji;
    return title;
  }
  
  createCloseButton(onClick) {
    const btn = document.createElement('button');
    btn.className = 'panel-close-btn';
    btn.innerHTML = '×';
    btn.title = 'Close';
    btn.onclick = onClick;
    return btn;
  }

  createFavoriteButton(entry, source, onToggle) {
    const favBtn = document.createElement('button');
    favBtn.className = this.config.buttons.favorite.class;
    favBtn.type = 'button';
    favBtn.title = 'Toggle Favorite';
    
    if (source === 'mal') {
      favBtn.style.display = 'none';
      return favBtn;
    }
    
    favBtn.className = entry.media.isFavourite ? 
      'zoro-fav-btn zoro-heart' : 
      'zoro-fav-btn zoro-no-heart';
    
    favBtn.onclick = () => onToggle(entry, favBtn, source);
    return favBtn;
  }
  
  createFormFields(entry, source = 'anilist') {
    const statusField = this.createStatusField(entry, source);
    const scoreField = this.createScoreField(entry);
    const progressField = this.createProgressField(entry);
    
    return {
      status: statusField,
      score: scoreField,
      progress: progressField
    };
  }
  
  createFormField({ type, label, emoji, id, value, options = {}, className = '' }) {
    const group = document.createElement('div');
    group.className = `zoro-form-group zoro-${type}-group ${className}`.trim();

    const labelEl = document.createElement('label');
    labelEl.className = `zoro-form-label zoro-${type}-label`;
    labelEl.textContent = `${emoji} ${label}`;
    labelEl.setAttribute('for', id);

    let input;
    
    if (type === 'select') {
      input = this.createSelectInput(id, value, options);
    } else if (type === 'number') {
      input = this.createNumberInput(id, value, options);
    } else {
      input = this.createTextInput(id, value, options);
    }

    group.appendChild(labelEl);
    group.appendChild(input);
    return { group, input, label: labelEl };
  }

  createSelectInput(id, selectedValue, { items = [] }) {
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

  createNumberInput(id, value, { min, max, step, placeholder }) {
    const input = document.createElement('input');
    input.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-input`;
    input.type = 'number';
    input.id = id;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (step !== undefined) input.step = step;
    input.value = value ?? '';
    if (placeholder) input.placeholder = placeholder;
    return input;
  }
  
  createTextInput(id, value, { placeholder }) {
    const input = document.createElement('input');
    input.className = `zoro-form-input zoro-${id.replace('zoro-', '')}-input`;
    input.type = 'text';
    input.id = id;
    input.value = value ?? '';
    if (placeholder) input.placeholder = placeholder;
    return input;
  }
  
  createStatusField(entry, source = 'anilist') {
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

  createScoreField(entry) {
    const config = this.config.fields.score;
    return this.createFormField({
      type: 'number',
      label: `${config.label} (${config.min}–${config.max})`,
      emoji: config.emoji,
      id: config.id,
      value: entry.score,
      options: {
        min: config.min,
        max: config.max,
        step: config.step,
        placeholder: `e.g. ${config.max/2 + config.max/5}` 
      }
    });
  }

  createProgressField(entry) {
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

  createQuickProgressButtons(entry, progressInput, statusSelect) {
    const container = document.createElement('div');
    container.className = 'zoro-quick-progress-buttons';

    const plusBtn = this.createQuickButton('+1', 'zoro-plus-btn', () => {
      const current = parseInt(progressInput.value) || 0;
      const max = progressInput.max;
      if (current < max) progressInput.value = current + 1;
    });

    const minusBtn = this.createQuickButton('-1', 'zoro-minus-btn', () => {
      const current = parseInt(progressInput.value) || 0;
      if (current > 0) progressInput.value = current - 1;
    });

    const completeBtn = this.createQuickButton('Complete', 'zoro-complete-btn', () => {
      progressInput.value = entry.media.episodes || entry.media.chapters || 1;
      statusSelect.value = 'COMPLETED';
    });

    container.append(plusBtn, minusBtn, completeBtn);
    return { container, plus: plusBtn, minus: minusBtn, complete: completeBtn };
  }
  
  createQuickButton(label, className, onClick) {
    const button = document.createElement('button');
    button.className = `zoro-quick-btn ${className}`;
    button.type = 'button';
    button.textContent = label;
    button.onclick = onClick;
    return button;
  }

  createActionButtons(entry, onRemove, config, source = 'anilist') {
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
  
  createActionButton({ label, className, type = 'button', onClick, disabled = false }) {
    const button = document.createElement('button');
    button.className = `zoro-modal-btn ${className}`;
    button.type = type;
    button.textContent = label;
    button.disabled = disabled;
    if (onClick) button.onclick = onClick;
    return button;
  }

  assembleModal(content, form, elements) {
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

export { RenderEditModal };