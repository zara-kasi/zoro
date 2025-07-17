function createEditModal(entry, onSave, onCancel) {
  createModal(entry, onSave, onCancel, 'Save', 'Edit');
}

function createAddModal(entry, onSave, onCancel) {
  createModal(entry, onSave, onCancel, 'Add to List', 'Add');
}

function createModal(entry, onSave, onCancel, saveText, titlePrefix) {
  const modal = document.createElement('div');
  modal.className = 'zoro-edit-modal';
  const overlay = document.createElement('div');
  overlay.className = 'zoro-modal-overlay';
  const content = document.createElement('div');
  content.className = 'zoro-modal-content';
  const form = document.createElement('form');
  form.onsubmit = async e => { e.preventDefault(); await trySave(); };
  const title = document.createElement('h3');
  title.textContent = `${titlePrefix}: ${entry.media.title.english || entry.media.title.romaji}`;

  const statusGroup = createSelectGroup('Status', 'zoro-status', ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'], entry.status);
  const scoreGroup = createInputGroup('Score (0–10)', 'zoro-score', 'number', entry.score ?? '', '0-10');
  const progressGroup = createInputGroup('Progress', 'zoro-progress', 'number', entry.progress || 0, '0-' + (entry.media.episodes || entry.media.chapters || 999));

  const quick = document.createElement('div');
  quick.className = 'quick-progress-buttons';
  ['+1', '-1', 'Complete'].forEach(txt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = txt;
    btn.onclick = () => {
      const input = progressGroup.querySelector('input');
      const max = parseInt(input.max);
      let val = parseInt(input.value) || 0;
      if (txt === '+1' && val < max) val++;
      if (txt === '-1' && val > 0) val--;
      if (txt === 'Complete') val = max;
      input.value = val;
      if (txt === 'Complete') statusGroup.querySelector('select').value = 'COMPLETED';
    };
    quick.appendChild(btn);
  });

  const buttons = document.createElement('div');
  buttons.className = 'zoro-modal-buttons';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = saveText;
  saveBtn.type = 'submit';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => { closeModal(); onCancel(); };
  buttons.append(saveBtn, cancelBtn);

  form.append(title, statusGroup, scoreGroup, progressGroup, quick, buttons);
  content.appendChild(form);
  modal.append(overlay, content);
  document.body.appendChild(modal);

  overlay.onclick = cancelBtn.onclick;

  let saving = false;
  async function trySave() {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    const status = statusGroup.querySelector('select').value;
    const score = scoreGroup.querySelector('input').value;
    const progress = progressGroup.querySelector('input').value;
    const scoreVal = parseFloat(score);
    if (score && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10)) {
      alert('⚠ Score must be between 0 and 10.');
      resetSaveBtn();
      return;
    }
    try {
      await onSave({ status, score: score === '' ? null : scoreVal, progress: parseInt(progress) || 0 });
      closeModal();
    } catch (err) {
      alert(`❌ Failed: ${err.message}`);
    }
    resetSaveBtn();
  }

  function resetSaveBtn() {
    saveBtn.disabled = false;
    saveBtn.textContent = saveText;
    saving = false;
  }

  function closeModal() {
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    document.removeEventListener('keydown', escListener);
  }

  function escListener(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); onCancel(); }
  }
  document.addEventListener('keydown', escListener);
}

function createAuthenticationPrompt(plugin) {
  const modal = document.createElement('div');
  modal.className = 'zoro-edit-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Authentication Required');
  const overlay = document.createElement('div');
  overlay.className = 'zoro-modal-overlay';
  const content = document.createElement('div');
  content.className = 'zoro-modal-content auth-prompt';
  content.innerHTML = `
    <h3 class="zoro-auth-title">🔐 Authentication Required</h3>
    <p class="zoro-auth-message">You need to authenticate with AniList to edit your anime/manga entries. This will allow you to update your progress, scores, and status directly from Obsidian.</p>
    <div class="zoro-auth-features">
      <h4 class="zoro-auth-features-title">Features after authentication:</h4>
      <ul class="zoro-auth-feature-list">
        <li>Edit progress, scores, and status</li>
        <li>Access private lists and profiles</li>
        <li>Quick progress buttons (+1, -1, Complete)</li>
        <li>Auto-detect your username</li>
        <li>Real-time updates</li>
      </ul>
    </div>
    <div class="zoro-modal-buttons">
      <button class="zoro-auth-button">🔑 Authenticate with AniList</button>
      <button class="zoro-cancel-button">Cancel</button>
    </div>
  `;
  modal.append(overlay, content);
  document.body.appendChild(modal);
  const authBtn = content.querySelector('.zoro-auth-button');
  const cancelBtn = content.querySelector('.zoro-cancel-button');
  const closeModal = () => { if (modal.parentNode) modal.parentNode.removeChild(modal); };
  authBtn.onclick = () => {
    closeModal();
    plugin.app.setting.open();
    plugin.app.setting.openTabById(plugin.manifest.id);
    new Notice('📝 Please configure authentication in the plugin settings');
  };
  cancelBtn.onclick = closeModal;
  overlay.onclick = closeModal;
  authBtn.focus();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function createSelectGroup(label, id, options, selected) {
  const div = document.createElement('div');
  div.className = 'form-group';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.setAttribute('for', id);
  const sel = document.createElement('select');
  sel.id = id;
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === selected) o.selected = true;
    sel.appendChild(o);
  });
  div.append(lbl, sel);
  return div;
}

function createInputGroup(label, id, type, value, placeholder) {
  const div = document.createElement('div');
  div.className = 'form-group';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.setAttribute('for', id);
  const inp = document.createElement('input');
  inp.type = type;
  inp.id = id;
  inp.value = value;
  inp.placeholder = placeholder;
  div.append(lbl, inp);
  return div;
}

module.exports = { createEditModal, createAddModal, createAuthenticationPrompt };
