export function createAddModal(entry, onSave, onCancel) {
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