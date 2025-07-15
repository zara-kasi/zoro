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
