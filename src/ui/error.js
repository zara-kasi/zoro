function renderError(el, message, context = '', onRetry, settings) {
  el.empty?.();
  el.classList.add('zoro-error-container');
  const wrapper = document.createElement('div');
  wrapper.className = 'zoro-error-box';
  wrapper.innerHTML = `<strong>❌ ${context || 'Something went wrong'}</strong>
                       <pre>${message}</pre>`;
  if (typeof onRetry === 'function') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'zoro-retry-btn';
    retryBtn.textContent = '🔄 Retry';
    retryBtn.onclick = onRetry;
    wrapper.appendChild(retryBtn);
  }
  el.appendChild(wrapper);
}

module.exports = { renderError };
