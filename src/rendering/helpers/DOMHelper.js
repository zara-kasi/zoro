import { setIcon } from 'obsidian';

class DOMHelper {
  static createLoadingSpinner() {
    return `
      <div class="global-loading-glow">
        <div class="tomoe-container">
          <span class="tomoe"></span>
          <span class="tomoe"></span>
          <span class="tomoe"></span>
        </div>
      </div>
    `;
  }

  static createSkeletonCard() {
    const skeleton = document.createElement('div');
    skeleton.className = 'zoro-card zoro-skeleton';
    skeleton.innerHTML = `
      <div class="skeleton-cover"></div>
      <div class="media-info">
        <div class="skeleton-title"></div>
        <div class="skeleton-details">
          <span class="skeleton-badge"></span>
          <span class="skeleton-badge"></span>
        </div>
      </div>
    `;
    return skeleton;
  }

  static createListSkeleton(count = 6) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'zoro-card zoro-skeleton';
      skeleton.innerHTML = `
        <div class="skeleton-cover"></div>
        <div class="media-info">
          <div class="skeleton-title"></div>
          <div class="skeleton-details">
            <span class="skeleton-badge"></span>
            <span class="skeleton-badge"></span>
          </div>
        </div>
      `;
      fragment.appendChild(skeleton);
    }
    return fragment;
  }

  static createStatsSkeleton() {
    const container = document.createElement('div');
    container.className = 'zoro-container zoro-stats-skeleton';
    container.innerHTML = `
      <div class="zoro-user-stats">
        <div class="zoro-user-header">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-title"></div>
        </div>
        <div class="zoro-stats-grid">
          <div class="skeleton-stat-section"></div>
          <div class="skeleton-stat-section"></div>
        </div>
      </div>
    `;
    return container;
  }

  static createSearchSkeleton() {
    const container = document.createElement('div');
    container.className = 'zoro-search-container zoro-search-skeleton';
    container.innerHTML = `
      <div class="zoro-search-input-container">
        <input type="text" class="zoro-search-input" disabled placeholder="Loading search...">
      </div>
      <div class="zoro-search-results">
        <div class="zoro-cards-grid">
          ${Array(3).fill().map(() => `
            <div class="zoro-card zoro-skeleton">
              <div class="skeleton-cover"></div>
              <div class="media-info">
                <div class="skeleton-title"></div>
                <div class="skeleton-details">
                  <span class="skeleton-badge"></span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return container;
  }

  static createErrorMessage(message) {
    return `<div class="zoro-search-message">${message}</div>`;
  }

  static createFragment() {
    return document.createDocumentFragment();
  }

  static setupFragment() {
    // Create fragment with Obsidian's createEl method if available
    const fragment = document.createDocumentFragment();
    
    // Add Obsidian's createEl method to fragment if it doesn't exist
    if (!fragment.createEl && document.createEl) {
      fragment.createEl = function(tag, attr, callback) {
        const el = document.createElement(tag);
        if (attr) {
          if (attr.cls) el.className = attr.cls;
          if (attr.text) el.textContent = attr.text;
          if (attr.attr) {
            Object.entries(attr.attr).forEach(([key, value]) => {
              el.setAttribute(key, value);
            });
          }
        }
        if (callback) callback(el);
        this.appendChild(el);
        return el;
      };
    }
    
    return fragment;
  }

  static setupPressAndHold(element, callback, duration = 400) {
    let pressTimer = null;
    let isPressed = false;
    
    const startPress = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isPressed = true;
      element.classList.add('pressed');
      
      pressTimer = setTimeout(() => {
        if (isPressed) {
          callback(e);
          element.classList.remove('pressed');
          isPressed = false;
        }
      }, duration);
    };

    const endPress = (e) => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      element.classList.remove('pressed');
      isPressed = false;
    };

    // Mouse events
    element.onmousedown = startPress;
    element.onmouseup = element.onmouseleave = endPress;
    
    // Touch events
    element.ontouchstart = startPress;
    element.ontouchend = element.ontouchcancel = element.ontouchmove = endPress;
    
    // Prevent default behaviors
    element.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    
    element.oncontextmenu = (e) => {
      e.preventDefault();
      return false;
    };
    
    element.ondragstart = (e) => {
      e.preventDefault();
      return false;
    };

    return { startPress, endPress };
  }

  static addSecondaryMetric(container, label, value) {
    const metric = container.createDiv({ cls: 'zoro-secondary-metric' });
    metric.createEl('span', { 
      text: label,
      cls: 'zoro-metric-label-small'
    });
    metric.createEl('span', { 
      text: value,
      cls: 'zoro-metric-value-small'
    });
  }
}

export { DOMHelper };