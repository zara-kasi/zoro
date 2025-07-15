export export function createAddModal(entry, onSave, onCancel) {
  const modal = document.createElement('div');
  modal.className = 'zoro-edit-modal';

  const overlay = document.createElement('div');
  overlay.className = 'zoro-modal-overlay';

  const content = document.createElement('div');
  content.className = 'zoro-modal-content';

  const form = document.createElement('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    await trySave();
  };

  const title = document.createElement('h3');
  title.textContent = `Add: ${entry.media.title.english || entry.media.title.romaji}`;

  // --- Status Field ---
  const statusGroup = document.createElement('div');
  statusGroup.className = 'form-group';

  const statusLabel = document.createElement('label');
  statusLabel.textContent = 'Status';
  statusLabel.setAttribute('for', 'zoro-add-status');

  const statusSelect = document.createElement('select');
  statusSelect.id = 'zoro-add-status';

  ['PLANNING', 'CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].forEach(status => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    if (status === 'PLANNING') option.selected = true; // Default to PLANNING
    statusSelect.appendChild(option);
  });

  statusGroup.appendChild(statusLabel);
  statusGroup.appendChild(statusSelect);

  // --- Score Field ---
  const scoreGroup = document.createElement('div');
  scoreGroup.className = 'form-group';

  const scoreLabel = document.createElement('label');
  scoreLabel.textContent = 'Score (0–10)';
  scoreLabel.setAttribute('for', 'zoro-add-score');

  const scoreInput = document.createElement('input');
  scoreInput.type = 'number';
  scoreInput.id = 'zoro-add-score';
  scoreInput.min = '0';
  scoreInput.max = '10';
  scoreInput.step = '0.1';
  scoreInput.value = '';
  scoreInput.placeholder = 'e.g. 8.5';

  scoreGroup.appendChild(scoreLabel);
  scoreGroup.appendChild(scoreInput);

  // --- Progress Field ---
  const progressGroup = document.createElement('div');
  progressGroup.className = 'form-group';

  const progressLabel = document.createElement('label');
  progressLabel.textContent = 'Progress';
  progressLabel.setAttribute('for', 'zoro-add-progress');

  const progressInput = document.createElement('input');
  progressInput.type = 'number';
  progressInput.id = 'zoro-add-progress';
  progressInput.min = '0';
  progressInput.max = entry.media.episodes || entry.media.chapters || 999;
  progressInput.value = 0;
  progressInput.placeholder = 'Progress';

  progressGroup.appendChild(progressLabel);
  progressGroup.appendChild(progressInput);

  // --- Quick Buttons ---
  const quickProgressDiv = document.createElement('div');
  quickProgressDiv.className = 'quick-progress-buttons';

  const plusOneBtn = document.createElement('button');
  plusOneBtn.type = 'button';
  plusOneBtn.textContent = '+1';
  plusOneBtn.onclick = () => {
    const current = parseInt(progressInput.value) || 0;
    const max = progressInput.max;
    if (current < max) progressInput.value = current + 1;
  };

  const minusOneBtn = document.createElement('button');
  minusOneBtn.type = 'button';
  minusOneBtn.textContent = '-1';
  minusOneBtn.onclick = () => {
    const current = parseInt(progressInput.value) || 0;
    if (current > 0) progressInput.value = current - 1;
  };

  const completeBtn = document.createElement('button');
  completeBtn.type = 'button';
  completeBtn.textContent = 'Complete & Add';
  completeBtn.onclick = () => {
    progressInput.value = entry.media.episodes || entry.media.chapters || 1;
    statusSelect.value = 'COMPLETED';
  };

  quickProgressDiv.append(plusOneBtn, minusOneBtn, completeBtn);

  // --- Buttons ---
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'zoro-modal-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Add to List';
  saveBtn.type = 'submit';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    onCancel();
    document.body.removeChild(modal);
  };

  buttonContainer.append(saveBtn, cancelBtn);

  form.append(title, statusGroup, scoreGroup, progressGroup, quickProgressDiv, buttonContainer);
  content.appendChild(form);
  modal.append(overlay, content);
  document.body.appendChild(modal);

  overlay.onclick = () => {
    onCancel();
    document.body.removeChild(modal);
  };

  // Keyboard accessibility
  document.addEventListener('keydown', escListener);
  function escListener(e) {
    if (e.key === 'Escape') {
      onCancel();
      document.body.removeChild(modal);
      document.removeEventListener('keydown', escListener);
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      trySave();
    }
  }

  // Save logic
  let saving = false;
  async function trySave() {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Adding...';

    const scoreVal = parseFloat(scoreInput.value);
    if (scoreInput.value && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
      alert("⚠ Score must be between 0 and 10.");
      resetSaveBtn();
      return;
    }

    try {
      await onSave({
        status: statusSelect.value,
        score: scoreInput.value === '' ? null : scoreVal,
        progress: parseInt(progressInput.value) || 0
      });
      document.body.removeChild(modal);
      document.removeEventListener('keydown', escListener);
    } catch (err) {
      alert(`❌ Failed to add: ${err.message}`);
    }

    resetSaveBtn();
  }

  function resetSaveBtn() {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Add to List';
    saving = false;
  }
}

export function createEditModal(entry, onSave, onCancel) {
    const modal = document.createElement('div');
    // RENAMED from anilist-edit-modal to zoro-edit-modal
    modal.className = 'zoro-edit-modal';

    const overlay = document.createElement('div');
    // RENAMED from anilist-modal-overlay to zoro-modal-overlay
    overlay.className = 'zoro-modal-overlay';

    const content = document.createElement('div');
    // RENAMED from anilist-modal-content to zoro-modal-content
    content.className = 'zoro-modal-content';

    const form = document.createElement('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      await trySave();
    };

    const title = document.createElement('h3');
    title.textContent = entry.media.title.english || entry.media.title.romaji;

    // --- Status Field ---
    const statusGroup = document.createElement('div');
    statusGroup.className = 'form-group';

    const statusLabel = document.createElement('label');
    statusLabel.textContent = 'Status';
    // RENAMED from anilist-status to zoro-status
    statusLabel.setAttribute('for', 'zoro-status');

    const statusSelect = document.createElement('select');
    // RENAMED from anilist-status to zoro-status
    statusSelect.id = 'zoro-status';

    ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].forEach(status => {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      if (status === entry.status) option.selected = true;
      statusSelect.appendChild(option);
    });

    statusGroup.appendChild(statusLabel);
    statusGroup.appendChild(statusSelect);

    // --- Score Field ---
    const scoreGroup = document.createElement('div');
    scoreGroup.className = 'form-group';

    const scoreLabel = document.createElement('label');
    scoreLabel.textContent = 'Score (0–5)';
    // RENAMED from anilist-score to zoro-score
    scoreLabel.setAttribute('for', 'zoro-score');

    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    // RENAMED from anilist-score to zoro-score
    scoreInput.id = 'zoro-score';
    scoreInput.min = '0';
    scoreInput.max = '10';
    scoreInput.step = '0.1';
    scoreInput.value = entry.score ?? '';
    scoreInput.placeholder = 'e.g. 8.5';

    scoreGroup.appendChild(scoreLabel);
    scoreGroup.appendChild(scoreInput);

    // --- Progress Field ---
    const progressGroup = document.createElement('div');
    progressGroup.className = 'form-group';

    const progressLabel = document.createElement('label');
    progressLabel.textContent = 'Progress';
    // RENAMED from anilist-progress to zoro-progress
    progressLabel.setAttribute('for', 'zoro-progress');

    const progressInput = document.createElement('input');
    progressInput.type = 'number';
    // RENAMED from anilist-progress to zoro-progress
    progressInput.id = 'zoro-progress';
    progressInput.min = '0';
    progressInput.max = entry.media.episodes || entry.media.chapters || 999;
    progressInput.value = entry.progress || 0;
    progressInput.placeholder = 'Progress';

    progressGroup.appendChild(progressLabel);
    progressGroup.appendChild(progressInput);

    // --- Quick Buttons ---
    const quickProgressDiv = document.createElement('div');
    quickProgressDiv.className = 'quick-progress-buttons';

    const plusOneBtn = document.createElement('button');
    plusOneBtn.type = 'button';
    plusOneBtn.textContent = '+1';
    plusOneBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      const max = progressInput.max;
      if (current < max) progressInput.value = current + 1;
    };

    const minusOneBtn = document.createElement('button');
    minusOneBtn.type = 'button';
    minusOneBtn.textContent = '-1';
    minusOneBtn.onclick = () => {
      const current = parseInt(progressInput.value) || 0;
      if (current > 0) progressInput.value = current - 1;
    };

    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.textContent = 'Complete';
    completeBtn.onclick = () => {
      progressInput.value = entry.media.episodes || entry.media.chapters || 1;
      statusSelect.value = 'COMPLETED';
    };

    quickProgressDiv.append(plusOneBtn, minusOneBtn, completeBtn);

    // --- Buttons ---
    const buttonContainer = document.createElement('div');
    // RENAMED from anilist-modal-buttons to zoro-modal-buttons
    buttonContainer.className = 'zoro-modal-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.type = 'submit';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };

    buttonContainer.append(saveBtn, cancelBtn);

    form.append(title, statusGroup, scoreGroup, progressGroup, quickProgressDiv, buttonContainer);
    content.appendChild(form);
    modal.append(overlay, content);
    document.body.appendChild(modal);

    overlay.onclick = () => {
      onCancel();
      document.body.removeChild(modal);
    };

    // Keyboard accessibility
    document.addEventListener('keydown', escListener);
    function escListener(e) {
      if (e.key === 'Escape') {
        onCancel();
        document.body.removeChild(modal);
        document.removeEventListener('keydown', escListener);
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        trySave();
      }
    }

    // Save logic
    let saving = false;
    async function trySave() {
      if (saving) return;
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const scoreVal = parseFloat(scoreInput.value);
      if (scoreInput.value && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
        alert("⚠ Score must be between 0 and 10.");
        resetSaveBtn();
        return;
      }

      try {
        await onSave({
          status: statusSelect.value,
          score: scoreInput.value === '' ? null : scoreVal,
          progress: parseInt(progressInput.value) || 0
        });
        document.body.removeChild(modal);
        document.removeEventListener('keydown', escListener);
      } catch (err) {
        alert(`❌ Failed to save: ${err.message}`);
      }

      resetSaveBtn();
    }

    function resetSaveBtn() {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      saving = false;
    }
  }

export function createAuthenticationPrompt() {
    // Create modal wrapper
    const modal = document.createElement('div');
    modal.className = 'zoro-edit-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Authentication Required');

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'zoro-modal-overlay';

    // Modal content container
    const content = document.createElement('div');
    content.className = 'zoro-modal-content auth-prompt';

    // Title
    const title = document.createElement('h3');
    title.className = 'zoro-auth-title';
    title.textContent = '🔐 Authentication Required';

    // Message
    const message = document.createElement('p');
    message.className = 'zoro-auth-message';
    
    message.textContent = 'You need to authenticate with AniList to edit your anime/manga entries. This will allow you to update your progress, scores, and status directly from Obsidian.';

    // Feature list
    const featuresDiv = document.createElement('div');
    featuresDiv.className = 'zoro-auth-features';

    const featuresTitle = document.createElement('h4');
    featuresTitle.className = 'zoro-auth-features-title';
    featuresTitle.textContent = 'Features after authentication:';

    const featuresList = document.createElement('ul');
    featuresList.className = 'zoro-auth-feature-list';

    const features = [
      'Edit progress, scores, and status',
      'Access private lists and profiles',
      'Quick progress buttons (+1, -1, Complete)',
      'Auto-detect your username',
      'Real-time updates'
    ];

    features.forEach(feature => {
      const li = document.createElement('li');
      li.textContent = feature;
      featuresList.appendChild(li);
    });

    featuresDiv.appendChild(featuresTitle);
    featuresDiv.appendChild(featuresList);

    // Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'zoro-modal-buttons';

    const authenticateBtn = document.createElement('button');
    authenticateBtn.className = 'zoro-auth-button';
    
    authenticateBtn.textContent = '🔑 Authenticate with AniList';
    authenticateBtn.onclick = () => {
      closeModal();
      this.app.setting.open();
      this.app.setting.openTabById(this.manifest.id);
      new Notice('📝 Please configure authentication in the plugin settings');
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'zoro-cancel-button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => closeModal();

    buttonContainer.appendChild(authenticateBtn);
    buttonContainer.appendChild(cancelBtn);

    // Build modal
    content.appendChild(title);
    content.appendChild(message);
    content.appendChild(featuresDiv);
    content.appendChild(buttonContainer);

    modal.appendChild(overlay);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Focus and Esc key handling
    authenticateBtn.focus();
    document.addEventListener('keydown', handleKeyDown);

    overlay.onclick = closeModal;

    function closeModal() {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      document.removeEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    }
  }
