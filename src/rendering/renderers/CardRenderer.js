import { Notice, setIcon } from 'obsidian';
import { DOMHelper } from '../helpers/DOMHelper.js';

class CardRenderer {
  constructor(parentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.apiHelper = parentRenderer.apiHelper;
    this.formatter = parentRenderer.formatter;
  }

  createMediaCard(data, config, options = {}) {
    const isSearch = options.isSearch || false;
    const isCompact = config.layout === 'compact';
    const media = isSearch ? data : data.media;
    // Ensure we have a usable numeric id for card actions
    if (!media.id || Number.isNaN(Number(media.id))) {
      media.id = Number(media?.id || media?.idTmdb || media?.idImdb || media?.idMal || media?.ids?.tmdb || media?.ids?.imdb || media?.ids?.simkl || media?.ids?.id || 0) || 0;
    }
    // For search/trending items, synthesize a lightweight entry carrying metadata for proper source/mediaType detection
    const entry = isSearch
      ? {
          media,
          isSearch: true, // Add the isSearch flag to the entry object
          _zoroMeta: data?._zoroMeta || {
            source:
              this.apiHelper.validateAndReturnSource(config?.source) ||
              data?._zoroMeta?.source ||
              this.apiHelper.detectFromDataStructure({ media }) ||
              this.apiHelper.getFallbackSource(),
            mediaType: (() => {
              if (config?.mediaType) return config.mediaType;
              const fmt = String(media?.format || '').toUpperCase();
              if (fmt === 'MOVIE') return 'MOVIE';
              if (fmt === 'MANGA' || fmt === 'NOVEL' || fmt === 'ONE_SHOT') return 'MANGA';
              return 'ANIME';
            })()
          }
        }
      : data;
    const source = this.apiHelper.detectSource(entry, config);
    const mediaType = this.apiHelper.detectMediaType(entry, config, media);
    
    const card = document.createElement('div');
    card.className = `zoro-card ${isCompact ? 'compact' : ''}`;
    card.dataset.mediaId = String(Number(media.id) || 0);

    // Create cover image if enabled
    if (this.plugin.settings.showCoverImages && media.coverImage?.large) {
      const coverContainer = this.createCoverContainer(media, entry, isSearch, isCompact, config);
      card.appendChild(coverContainer);
    }

    // Create media info section
    const info = this.createMediaInfo(media, entry, config, isSearch, isCompact);
    card.appendChild(info);
    
    // Add heart for favorites
    const heart = document.createElement('span');
    heart.className = 'zoro-heart';
    if (!media.isFavourite) heart.style.display = 'none';
    card.appendChild(heart);

    return card;
  }

  createCoverContainer(media, entry, isSearch, isCompact, config) {
    const coverContainer = document.createElement('div');
    coverContainer.className = 'cover-container';
    
    const img = document.createElement('img');
    img.src = media.coverImage.large;
    img.alt = media.title.english || media.title.romaji;
    img.className = 'media-cover pressable-cover';
    img.loading = 'lazy';

    
    let pressTimer = null;
    let isPressed = false;
    const pressHoldDuration = 400;
    
    img.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isPressed = true;
      img.classList.add('pressed');
      
      pressTimer = setTimeout(() => {
        if (isPressed) {
          this.plugin.moreDetailsPanel.showPanel(media, entry, img);
          img.classList.remove('pressed');
          isPressed = false;
        }
      }, pressHoldDuration);
    };

    img.onmouseup = img.onmouseleave = (e) => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      img.classList.remove('pressed');
      isPressed = false;
    };
    
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    
    img.oncontextmenu = (e) => {
      e.preventDefault();
      return false;
    };
    
    img.ondragstart = (e) => {
      e.preventDefault();
      return false;
    };
    
    img.ontouchstart = (e) => {
      isPressed = true;
      img.classList.add('pressed');
      
      pressTimer = setTimeout(() => {
        if (isPressed) {
          e.preventDefault();
          this.plugin.moreDetailsPanel.showPanel(media, entry, img);
          img.classList.remove('pressed');
          isPressed = false;
        }
      }, pressHoldDuration);
    };

    img.ontouchend = img.ontouchcancel = img.ontouchmove = (e) => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      img.classList.remove('pressed');
      isPressed = false;
    };
    
    img.title = 'Press and hold for more details';
    
    coverContainer.appendChild(img);
    
    // Add format badge to cover if available
    if (media.format) {
      const formatBadge = this.createFormatBadgeForCover(media);
      coverContainer.appendChild(formatBadge);
    }
    if (isSearch) {
  // For search and trending cards, show both Add and Edit
  const addBtn = this.createAddButton(media, entry, config);
  coverContainer.appendChild(addBtn);
}
    
    const needsOverlay = (!isSearch && entry && this.plugin.settings.showProgress) || 
                       (this.plugin.settings.showRatings && (
                          (isSearch && (media.averageScore != null || media._rawData?.rating != null || media.rating != null)) ||
                          (!isSearch && entry?.score != null)
                        ));
                        
    if (needsOverlay) {
      const overlay = this.createCoverOverlay(media, entry, isSearch);
      coverContainer.appendChild(overlay);
    }
    
    return coverContainer;
  }

  createFormatBadgeForCover(media) {
    const formatBadge = document.createElement('div');
    formatBadge.className = 'zoro-format-badge-cover';
    formatBadge.textContent = this.formatter.formatFormat(media.format);
    return formatBadge;
  }

  createCoverOverlay(media, entry, isSearch) {
    const overlay = document.createElement('div');
    overlay.className = 'cover-overlay';
    
    // Progress indicator
    if (!isSearch && entry && this.plugin.settings.showProgress) {
      const progress = document.createElement('span');
      progress.className = 'progress';
      const total = media.episodes || media.chapters || '?';
      progress.textContent = this.formatter.formatProgress(entry.progress, total);
      overlay.appendChild(progress);
    } else {
      overlay.appendChild(document.createElement('span'));
    }
    
    // Rating indicator
    if (this.plugin.settings.showRatings) {
      const publicScore = isSearch ? (media.averageScore ?? media._rawData?.rating ?? media.rating ?? null) : null;
      const score = isSearch ? publicScore : entry?.score;
      if (score != null) {
        const rating = document.createElement('span');
        rating.className = 'score';
        rating.textContent = this.formatter.formatRating(score, isSearch);
        overlay.appendChild(rating);
      } else {
        overlay.appendChild(document.createElement('span'));
      }
    }
    
    return overlay;
  }

  createMediaInfo(media, entry, config, isSearch, isCompact) {
    const info = document.createElement('div');
    info.className = 'media-info';

    // Title
    const title = this.createTitle(media, entry, config);
    info.appendChild(title);

    // Details (status, edit button - format badge removed)
    if (!isCompact) {
      const details = this.createMediaDetails(media, entry, config, isSearch);
      info.appendChild(details);
    }

    // Genres
    if (!isCompact && this.plugin.settings.showGenres && media.genres?.length) {
      const genres = this.createGenres(media);
      info.appendChild(genres);
    }

    return info;
  }

  createTitle(media, entry, config) {
    const title = document.createElement('h4');

    if (this.plugin.settings.hideUrlsInTitles) {
      title.textContent = this.formatter.formatTitle(media);
    } else {
      const titleLink = document.createElement('a');
      const source = this.apiHelper.detectSource(entry, config);
      const mediaType = this.apiHelper.detectMediaType(entry, config, media);
      
      // Use the proper URL method based on available plugin methods
      const safeId = Number(media.id) || 0;
      if (source === 'simkl' && safeId <= 0) {
        // Fallback: open Simkl on-site search when we lack a stable id from search results
        const q = encodeURIComponent(this.formatter.formatTitle(media));
        titleLink.href = `https://simkl.com/search/?q=${q}`;
      } else {
        titleLink.href = this.plugin.getSourceSpecificUrl 
          ? this.apiHelper.getSourceSpecificUrl(safeId, mediaType, source)
          : this.apiHelper.getSourceUrl(safeId, mediaType, source);
      }
      
      titleLink.target = '_blank';
      titleLink.textContent = this.formatter.formatTitle(media);
      titleLink.className = 'media-title-link';
      title.appendChild(titleLink);
    }

    return title;
  }
  
  createMediaDetails(media, entry, config, isSearch) {
    const details = document.createElement('div');
    details.className = 'media-details';

    // Format badge removed from here - now on cover image

    // Status badge or edit button
    if (!isSearch && entry && entry.status) {
      const statusBadge = this.createStatusBadge(entry, config);
      details.appendChild(statusBadge);
    }

    // CONNECTED NOTES BUTTON - ADD THIS
    const connectedNotesBtn = this.plugin.connectedNotes.createConnectedNotesButton(media, entry, config);
    details.appendChild(connectedNotesBtn);

    return details;
  }
  
  createStatusBadge(entry, config) {
    const statusBadge = document.createElement('span');
    const statusClass = this.formatter.getStatusClass(entry.status);
    const statusText = this.formatter.getStatusText(entry.status);
    
    statusBadge.className = `status-badge status-${statusClass} clickable-status`;
    statusBadge.createEl('span', { text: '📝' });
    statusBadge.onclick = (e) => this.handleStatusClick(e, entry, statusBadge, config);
    
    return statusBadge;
  }

    createEditButton(media, entry, config) {
    const editBtn = document.createElement('span');
    editBtn.className = 'status-badge status-edit clickable-status';
    editBtn.textContent = 'Edit';
    editBtn.dataset.loading = 'false';
    editBtn.onclick = (e) => this.handleEditClick(e, media, entry, config, editBtn);
    
    return editBtn;
  }

  createAddButton(media, entry, config) {
  const addBtn = document.createElement('span');
  addBtn.classList.add('zoro-add-button-cover');
  addBtn.createEl('span', { text: '🔖' });
  addBtn.dataset.loading = 'false';
  addBtn.onclick = (e) => this.handleAddClick(e, media, entry, config, addBtn);
  

  return addBtn;
}


  createGenres(media) {
    const genres = document.createElement('div');
    genres.className = 'genres';
    
    const genreList = this.formatter.formatGenres(media.genres);
    genreList.forEach(g => {
      const tag = document.createElement('span');
      tag.className = 'genre-tag';
      tag.textContent = g || 'Unknown';
      genres.appendChild(tag);
    });
    
    return genres;
  }

  handleStatusClick(e, entry, badge, config) {
    e.preventDefault();
    e.stopPropagation();
    
    const source = this.apiHelper.detectSource(entry, config);
    const mediaType = this.apiHelper.detectMediaType(entry, config);
    
    if (!this.apiHelper.isAuthenticated(source)) {
      this.plugin.prompt.createAuthenticationPrompt(source);
      return;
    }
    
    this.plugin.handleEditClick(e, entry, badge, { source, mediaType });
  }

  async handleAddClick(e, media, entry, config, addBtn) {
  e.preventDefault(); e.stopPropagation();

  let entrySource = this.apiHelper.detectSource(entry, config);
  const entryMediaType = this.apiHelper.detectMediaType(entry, config, media);

  // Check if this is a search item or trending item
  // Search items come from SIMKL API and should use SIMKL ID
  // Trending items come from TMDB API and should use TMDB ID
  const isSearchItem = entry?.isSearch === true || config?.isSearch === true;
  const isTrendingItem = !isSearchItem;
  
  // Debug logging
  console.log('[Add Button Debug]', {
    entryIsSearch: entry?.isSearch,
    configIsSearch: config?.isSearch,
    isSearchItem,
    isTrendingItem,
    entrySource: entry?._zoroMeta?.source,
    mediaType: entryMediaType,
    mediaId: media.id,
    mediaIdTmdb: media.idTmdb
  });
  
  // For trending items (from TMDB), route to SIMKL but use TMDB ID
  if (isTrendingItem && (entry?._zoroMeta?.source || '').toLowerCase() === 'tmdb') {
    entrySource = 'simkl';
    try {
      const numericId = Number(media.id) || Number(media.idTmdb) || 0;
      if (numericId > 0) {
        this.plugin.cache.set(String(numericId), { media }, { scope: 'mediaData' });
      }
    } catch {}
  }

  if (!this.apiHelper.isAuthenticated(entrySource)) {
    console.log(`[Zoro] Not authenticated with ${entrySource}`);
    this.plugin.prompt.createAuthenticationPrompt(entrySource);
    return;
  }

  // show spinner
  addBtn.dataset.loading = 'true';
  addBtn.innerHTML = DOMHelper.createLoadingSpinner();
  addBtn.style.pointerEvents = 'none';

  try {
    const typeUpper = String(entryMediaType || '').toUpperCase();
    const isMovieOrTv = typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper.includes('SHOW');

    // Set the correct _zUseTmdbId flag
    let updates;
    if (entrySource === 'simkl' && isMovieOrTv) {
      if (isTrendingItem && (entry?._zoroMeta?.source || '').toLowerCase() === 'tmdb') {
        // TMDB trending item: use TMDB ID
        updates = { status: 'PLANNING', score: 0, _zUseTmdbId: true };
        console.log('[Add Button Debug] TMDB trending item, using TMDB ID');
      } else {
        // SIMKL search item: use SIMKL ID
        updates = { status: 'PLANNING', score: 0, _zUseTmdbId: false };
        console.log('[Add Button Debug] SIMKL search item, using SIMKL ID');
      }
    } else {
      updates = { status: 'PLANNING', progress: 0 };
      console.log('[Add Button Debug] Non-SIMKL item, using default updates');
    }
    
    console.log('[Add Button Debug] Final updates:', updates);

    // For TMDB trending items, use TMDB ID; for SIMKL search items, use SIMKL ID
    if (entrySource === 'simkl' && isMovieOrTv) {
      if (isTrendingItem && (entry?._zoroMeta?.source || '').toLowerCase() === 'tmdb') {
        // TMDB trending item: use TMDB ID
        const ids = { tmdb: Number(media.idTmdb || media.id) || undefined, imdb: media.idImdb || undefined };
        if (typeof this.plugin?.simklApi?.updateMediaListEntryWithIds === 'function') {
          await this.plugin.simklApi.updateMediaListEntryWithIds(ids, updates, entryMediaType);
        } else {
          const idFallback = Number(media.idTmdb || media.id) || 0;
          await this.apiHelper.updateMediaListEntry(idFallback, updates, entrySource, entryMediaType);
        }
      } else {
        // SIMKL search item: use SIMKL ID
        await this.apiHelper.updateMediaListEntry(media.id, updates, entrySource, entryMediaType);
      }
    } else {
      await this.apiHelper.updateMediaListEntry(media.id, updates, entrySource, entryMediaType);
    }

    // Success feedback
    new Notice('✅ Added to planning!', 3000);
    console.log(`[Zoro] Added ${media.id} to planning via add button`);

    // ---- STOP SPINNER & SHOW SUCCESS ICON ----
    addBtn.dataset.loading = 'false';

    // remove spinner and all children (this is the key step)
    if (typeof addBtn.replaceChildren === 'function') {
      addBtn.replaceChildren();
    } else {
      addBtn.innerHTML = '';
    }

    // Add success icon via mapper/createEl/fallback
    const mapper = globalThis.__emojiIconMapper;
    if (mapper) {
      const frag = mapper.parseToFragment('📑');
      if (frag) {
        addBtn.appendChild(frag);
      } else if (typeof addBtn.createEl === 'function') {
        addBtn.createEl('span', { text: '📑' });
      } else {
        addBtn.textContent = '📑';
      }
    } else if (typeof setIcon === 'function') {
      const span = document.createElement('span');
      setIcon(span, 'bookmark'); // choose appropriate icon name
      addBtn.appendChild(span);
    } else {
      addBtn.textContent = '📑';
    }

    // update classes cleanly
    addBtn.classList.remove('zoro-add-button-cover');
    addBtn.classList.add('zoro-add-button-cover');

    // leave pointer events disabled so user can't re-add; change to 'auto' if you want clickable
    addBtn.style.pointerEvents = 'none';

    // Refresh UI
    this.parent.refreshActiveViews();

  } catch (error) {
    console.error('[Zoro] Add failed:', error);

    // Reset button on error
    addBtn.dataset.loading = 'false';
    addBtn.innerHTML = '';
    addBtn.classList.remove('zoro-add-button-cover');
    addBtn.classList.add('zoro-add-button-cover');
    addBtn.textContent = 'Add';
    addBtn.style.pointerEvents = 'auto';

    new Notice(`❌ Failed to add: ${error.message}`, 5000);
  }
}

  async handleEditClick(e, media, entry, config, editBtn) {
    e.preventDefault();
    e.stopPropagation();
    
    const entrySource = this.apiHelper.detectSource(entry, config);
    const entryMediaType = this.apiHelper.detectMediaType(entry, config, media);

    if (!this.apiHelper.isAuthenticated(entrySource)) {
      console.log(`[Zoro] Not authenticated with ${entrySource}`);
      this.plugin.prompt.createAuthenticationPrompt(entrySource);
      return;
    }

    editBtn.dataset.loading = 'true';
    editBtn.innerHTML = DOMHelper.createLoadingSpinner();
    editBtn.style.pointerEvents = 'none';

    try {
      const numericId = Number(media.id) || 0;
          const normalizedId = entrySource === 'simkl' ? this.plugin.simklApi.normalizeSimklId(numericId) : numericId;
    console.log('[Zoro][Edit] entrySource', entrySource, 'entryMediaType', entryMediaType);
    console.log('[Zoro][Edit] mediaTitle', this.formatter.formatTitle(media));
    console.log(`[Zoro] Checking user entry for media ${normalizedId} via ${entrySource}`);
    
    let existingEntry = null;
      if (normalizedId > 0) {
      } else if (entrySource === 'simkl') {
        // Attempt to resolve a Simkl ID by title before editing
        const guessId = await this.plugin.simklApi.resolveSimklIdByTitle(this.formatter.formatTitle(media), entryMediaType);
        if (guessId > 0) {
          media.id = guessId;
        }
      }
      console.log(`[Zoro] User entry result:`, existingEntry ? 'Found existing entry' : 'Not in user list');
      
      const entryToEdit = existingEntry || {
        media: media,
        status: 'PLANNING',
        progress: 0,
        score: null,
        id: null,
        _zoroMeta: {
          source: entrySource,
          mediaType: entryMediaType
        }
      };

      const isNewEntry = !existingEntry;
      editBtn.textContent = isNewEntry ? 'Add' : 'Edit';
      editBtn.className = `status-badge ${isNewEntry ? 'status-add' : 'status-edit'} clickable-status`;
      editBtn.dataset.loading = 'false';
      editBtn.style.pointerEvents = 'auto';

      console.log(`[Zoro] Opening edit modal for ${isNewEntry ? 'new' : 'existing'} entry`);

      this.plugin.edit.createEditModal(
        entryToEdit,
        async (updates) => {
          try {
            // Ensure we have a numeric id before attempting update
            const updateId = Number(media.id) || 0;
            if (entrySource === 'simkl' && updateId <= 0) {
              const retryId = await this.plugin.simklApi.resolveSimklIdByTitle(this.formatter.formatTitle(media), entryMediaType);
              if (retryId > 0) media.id = retryId;
            }
            console.log(`[Zoro] Updating media ${media.id} with:`, updates);
            await this.apiHelper.updateMediaListEntry(media.id, updates, entrySource, this.apiHelper.detectMediaType(entry, config, media));
            
            const successMessage = isNewEntry ? '✅ Added to list!' : '✅ Updated!';
            new Notice(successMessage, 3000);
            console.log(`[Zoro] ${successMessage}`);
            
            editBtn.textContent = 'Edit';
            editBtn.className = 'status-badge status-edit clickable-status';
            
            this.parent.refreshActiveViews();
            
          } catch (updateError) {
            console.error('[Zoro] Update failed:', updateError);
            new Notice(`❌ Update failed: ${updateError.message}`, 5000);
          }
        },
        () => {
          console.log('[Zoro] Edit modal cancelled');
          editBtn.textContent = 'Edit';
          editBtn.className = 'status-badge status-edit clickable-status';
          editBtn.dataset.loading = 'false';
          editBtn.style.pointerEvents = 'auto';
        },
        entrySource
      );

    } catch (error) {
      console.error('[Zoro] User entry check failed:', error);
      
      editBtn.textContent = 'Edit';
      editBtn.dataset.loading = 'false';
      editBtn.style.pointerEvents = 'auto';
      
      new Notice('⚠️ Could not check list status, assuming new entry', 3000);
      
      const defaultEntry = {
        media: media,
        status: 'PLANNING',
        progress: 0,
        score: null,
        id: null
      };

      this.plugin.edit.createEditModal(
        defaultEntry,
        async (updates) => {
          try {
            await this.apiHelper.updateMediaListEntry(media.id, updates, entrySource);
            new Notice('✅ Added to list!', 3000);
            this.parent.refreshActiveViews();
          } catch (updateError) {
            console.error('[Zoro] Update failed:', updateError);
            new Notice(`❌ Failed to add: ${updateError.message}`, 5000);
          }
        },
        () => {
          console.log('[Zoro] Fallback edit modal cancelled');
        },
        entrySource
      );
    }
  }
}

export { CardRenderer };