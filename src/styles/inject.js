function injectCSS() {
  const styleId = 'zoro-plugin-styles';
  const existing = document.getElementById(styleId);
  if (existing) existing.remove();
  const css = `
    .zoro-container { font-family: var(--font-interface); }
    .zoro-cards-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(var(--zoro-grid-columns, 2), 1fr); }
    .zoro-card { border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; }
    .media-cover { width: 100%; height: auto; }
    .media-info { padding: 0.5rem; }
    .format-badge, .status-badge, .score, .progress { margin-right: 0.25rem; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.75rem; }
    .status-badge.clickable-status:hover { opacity: 0.8; }
    .add-to-list-btn:hover { opacity: 0.8; }
    .zoro-table { width: 100%; border-collapse: collapse; }
    .zoro-table th, .zoro-table td { padding: 0.4rem; border-bottom: 1px solid var(--background-modifier-border); }
    .zoro-error-box { color: var(--text-error); background: var(--background-modifier-error); padding: 0.5rem; border-radius: 4px; }
    .zoro-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 9999; }
    .zoro-modal-content { background: var(--background-primary); margin: 10vh auto; padding: 1rem; border-radius: 8px; max-width: 400px; }
    .form-group { margin-bottom: 0.75rem; display: flex; flex-direction: column; }
    .quick-progress-buttons button { margin-right: 0.25rem; }
  `;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = css;
  document.head.appendChild(style);
}

module.exports = { injectCSS };
