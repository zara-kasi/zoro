// Rendering and CSS injection
function renderAniListData(el, data, config) {
  el.empty();
  el.className = 'zoro-container';
  // render logic...
}

function renderError(el, msg) {
  el.innerHTML = `<div class="zoro-error">${msg}</div>`;
}

const additionalCSS = `
.zoro-container { padding: 10px; }
`;

// Export
module.exports = {
  renderAniListData,
  renderError,
  additionalCSS
};
