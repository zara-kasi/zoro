export function handleEditClick(e, entry, statusEl) {
    e.preventDefault();
    e.stopPropagation();

    this.createEditModal(
      entry,
      async updates => {
        try {
          await this.updateMediaListEntry(entry.media.id, updates);
          new Notice('✅ Updated!');
          this.cache.clear();
          const parent = statusEl.closest('.zoro-container');
          if (parent) {
            const block = parent.closest('.markdown-rendered')?.querySelector('code');
            if (block) this.processZoroCodeBlock(block.textContent, parent, {});
          }
        } catch (err) {
          new Notice(`❌ Update failed: ${err.message}`);
        }
      },
      () => {
        new Notice('Edit canceled.');
      }
    );
  }

export function renderError(el, message, context = '', onRetry = null) {
    el.empty?.(); // clear if Obsidian's `el` object has `.empty()` method
    el.classList.add('zoro-error-container');

    const wrapper = document.createElement('div');
    wrapper.className = 'zoro-error-box';

    const title = document.createElement('strong');
    title.textContent = `❌ ${context || 'Something went wrong'}`;
    wrapper.appendChild(title);

    const msg = document.createElement('pre');
    msg.textContent = message; // safe, no innerHTML
    wrapper.appendChild(msg);

    // Optional Retry button
    if (this.settings?.accessToken) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = () => {
        // You might re-call the source renderer here
        new Notice('Retry not implemented yet');
      };
      wrapper.appendChild(retryBtn);
    }

    // FIXED: Added onRetry functionality
    if (typeof onRetry === 'function') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'zoro-retry-btn';
      retryBtn.textContent = '🔄 Retry';
      retryBtn.onclick = onRetry;
      wrapper.appendChild(retryBtn);
    }

    el.appendChild(wrapper);
  }
  
  export async function fetchData(config) {
  this.showLoader();
  try {
    // API call
  } catch (error) {
    // Handle error
  } finally {
    this.hideLoader();
  }
}
  
  
 export function renderZoroData(el, data, config) {
    el.empty();
    el.className = 'zoro-container';
    
    if (config.type === 'stats') {
      this.renderUserStats(el, data.User);
    } else if (config.type === 'single') {
      this.renderSingleMedia(el, data.MediaList, config);
    } else {
      const entries = data.MediaListCollection.lists.flatMap(list => list.entries);
      if (config.layout === 'table') {
        this.renderTableLayout(el, entries);
      } else {
        this.renderMediaList(el, entries, config);
      }
    }
  }
  
  export async function processZoroSearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
config.search = '';


      if (this.settings.debugMode) {
        console.log('[Zoro] Search block config:', config);
      }

      // Show loading placeholder
      el.createEl('div', { text: '🔍 Searching Zoro...', cls: 'zoro-loading-placeholder' });
      
      

      await this.renderSearchInterface(el, config);
    } catch (error) {
      console.error('[Zoro] Search block processing error:', error);
      this.renderError(el, error.message || 'Failed to process Zoro search block.');
    }
  }


