import { Notice, setIcon } from 'obsidian';
import type { Plugin } from 'obsidian';
import { DOMHelper } from '../helpers/DOMHelper';

interface MediaTitle {
  english?: string;
  romaji?: string;
  native?: string;
}

interface CoverImage {
  medium?: string;
  large?: string;
}

interface MediaIds {
  tmdb?: number;
  imdb?: string;
  simkl?: number;
  id?: number;
}

interface Media {
  id: number;
  title: MediaTitle;
  coverImage?: CoverImage;
  format?: string;
  status?: string;
  episodes?: number;
  chapters?: number;
  meanScore?: number;
  averageScore?: number;
  rating?: number;
  startDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
  genres?: string[];
  isFavourite?: boolean;
  idTmdb?: number;
  idImdb?: string;
  idMal?: number;
  ids?: MediaIds;
  _rawData?: {
    rating?: number;
  };
}

interface ZoroMeta {
  source?: string;
  mediaType?: string;
}

interface MediaEntry {
  media: Media;
  status: string;
  progress?: number;
  score?: number | null;
  id?: number | null;
  _zoroMeta?: ZoroMeta;
}

interface RenderConfig {
  layout?: 'cards' | 'compact' | 'table';
  source?: string;
  mediaType?: string;
}

interface CardOptions {
  isSearch?: boolean;
}

interface ParentRenderer {
  plugin: Plugin & {
    settings: {
      showCoverImages: boolean;
      showProgress: boolean;
      showRatings: boolean;
      showGenres: boolean;
      hideUrlsInTitles: boolean;
    };
    connectedNotes: {
      openSidePanelWithContext(context: { media: Media; entry: MediaEntry; source: string; mediaType: string }): Promise<any>;
      extractSearchIds(media: Media, entry: MediaEntry, source: string): any;
      currentMedia: Media | null;
      currentEntry: MediaEntry | null;
      currentSource: string | null;
      currentMediaType: string | null;
      currentUrls: any;
      buildCurrentUrls(media: Media, mediaType: string, source: string): any;
      createNewConnectedNote(searchIds: any, mediaType: string): Promise<void>;
      createConnectedNotesButton(media: Media, entry: MediaEntry, config: RenderConfig): HTMLElement;
    };
    cache: {
      set(key: string, value: any, options?: { scope?: string }): void;
    };
    simklApi?: {
      updateMediaListEntryWithIds?(ids: MediaIds, updates: any, mediaType: string): Promise<void>;
      normalizeSimklId(id: number): number;
      resolveSimklIdByTitle(title: string, mediaType: string): Promise<number>;
    };
    handleEditClick(e: Event, entry: MediaEntry, element: HTMLElement, config: any): void;
    getSourceSpecificUrl?(id: number, mediaType: string, source: string): string;
  };
  apiHelper: {
    validateAndReturnSource(source?: string): string;
    detectFromDataStructure(data: any): string;
    getFallbackSource(): string;
    detectSource(entry: MediaEntry, config: RenderConfig): string;
    detectMediaType(entry: MediaEntry, config: RenderConfig, media?: Media): string;
    isAuthenticated(source: string): boolean;
    updateMediaListEntry(id: number, updates: any, source: string, mediaType: string): Promise<void>;
    getSourceSpecificUrl(id: number, mediaType: string, source: string): string;
    getSourceUrl(id: number, mediaType: string, source: string): string;
  };
  formatter: {
    formatTitle(media: Media): string;
    formatFormat(format?: string): string;
    formatProgress(progress: number, total: number | string): string;
    formatRating(score: number, isSearch?: boolean): string;
    formatGenres(genres: string[]): string[];
    getStatusClass(status: string): string;
    getStatusText(status: string): string;
  };
  refreshActiveViews(): void;
}

export class CardRenderer {
  private parent: ParentRenderer;
  private plugin: ParentRenderer['plugin'];
  private apiHelper: ParentRenderer['apiHelper'];
  private formatter: ParentRenderer['formatter'];

  constructor(parentRenderer: ParentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.apiHelper = parentRenderer.apiHelper;
    this.formatter = parentRenderer.formatter;
  }

  createMediaCard(data: MediaEntry | Media, config: RenderConfig, options: CardOptions = {}): HTMLElement {
    const isSearch = options.isSearch || false;
    const isCompact = config.layout === 'compact';
    const media = isSearch ? (data as Media) : (data as MediaEntry).media;
    
    // Ensure we have a usable numeric id for card actions
    if (!media.id || Number.isNaN(Number(media.id))) {
      media.id = Number(media?.id || media?.idTmdb || media?.idImdb || media?.idMal || media?.ids?.tmdb || media?.ids?.imdb || media?.ids?.simkl || media?.ids?.id || 0) || 0;
    }
    
    // For search/trending items, synthesize a lightweight entry carrying metadata for proper source/mediaType detection
    const entry = isSearch
      ? {
          media,
          status: 'PLANNING',
          progress: 0,
          score: null,
          id: null,
          _zoroMeta: (data as any)?._zoroMeta || {
            source:
              this.apiHelper.validateAndReturnSource(config?.source) ||
              (data as any)?._zoroMeta?.source ||
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
        } as MediaEntry
      : (data as MediaEntry);
      
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
    const heartSpan = document.createElement('span');
    heartSpan.textContent = '❤️';
    heart.appendChild(heartSpan);
    if (!media.isFavourite) heart.style.display = 'none';
    card.appendChild(heart);
    
    return card;
  }

  createCoverContainer(media: Media, entry: MediaEntry, isSearch: boolean, isCompact: boolean, config: RenderConfig): HTMLElement {
    const coverContainer = document.createElement('div');
    coverContainer.className = 'cover-container';
    
    const img = document.createElement('img');
    img.src = media.coverImage!.large!;
    img.alt = media.title.english || media.title.romaji || 'Untitled';
    img.className = 'media-cover pressable-cover';
    img.loading = 'lazy';

    let pressTimer: number | null = null;
    let isPressed = false;
    const pressHoldDuration = 400;
    
    img.onmousedown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isPressed = true;
      img.classList.add('pressed');
      
      pressTimer = window.setTimeout(() => {
        if (isPressed) {
          (async () => {
            try {
              const source = this.apiHelper.detectSource(entry, config);
              const mediaType = this.apiHelper.detectMediaType(entry, config, media);
              const view = await this.plugin.connectedNotes.openSidePanelWithContext({ media, entry, source, mediaType });
              await view.showDetailsForMedia(media, entry);
            } catch (err) {
              console.error('[Zoro] Failed to open inline details', err);
            }
          })();
          img.classList.remove('pressed');
          isPressed = false;
        }
      }, pressHoldDuration);
    };

    const clearPressState = () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
      img.classList.remove('pressed');
      isPressed = false;
    };

    img.onmouseup = clearPressState;
    img.onmouseleave = clearPressState;
    
    img.onclick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    
    img.oncontextmenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };
    
    img.ondragstart = (e: DragEvent) => {
      e.preventDefault();
      return false;
    };
    
    img.ontouchstart = (e: TouchEvent) => {
      isPressed = true;
      img.classList.add('pressed');
      
      pressTimer = window.setTimeout(() => {
        if (isPressed) {
          e.preventDefault();
          (async () => {
            try {
              const source = this.apiHelper.detectSource(entry, config);
              const mediaType = this.apiHelper.detectMediaType(entry, config, media);
              const view = await this.plugin.connectedNotes.openSidePanelWithContext({ media, entry, source, mediaType });
              await view.showDetailsForMedia(media, entry);
            } catch (err) {
              console.error('[Zoro] Failed to open inline details (touch)', err);
            }
          })();
          img.classList.remove('pressed');
          isPressed = false;
        }
      }, pressHoldDuration);
    };

    const clearTouchState = () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
      img.classList.remove('pressed');
      isPressed = false;
    };

    img.ontouchend = clearTouchState;
    img.ontouchcancel = clearTouchState;
    img.ontouchmove = clearTouchState;
    
    img.title = 'Press and hold for more details';
    
    coverContainer.appendChild(img);
    
    // Add format badge to cover if available
    if (isSearch) {
      // For search and trending cards, show both Add and Edit
      const addBtn = this.createAddButton(media, entry, config);
      coverContainer.appendChild(addBtn);
    }
    
    return coverContainer;
  }

  createFormatBadgeForCover(media: Media): HTMLElement {
    const formatBadge = document.createElement('div');
    formatBadge.className = 'zoro-format-badge-cover';
    formatBadge.textContent = this.formatter.formatFormat(media.format);
    return formatBadge;
  }

  createCoverOverlay(media: Media, entry: MediaEntry, isSearch: boolean): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'cover-overlay';
    
    // Progress indicator for user lists OR total count for search results
    if (this.plugin.settings.showProgress) {
      if (!isSearch && entry && entry.progress != null) {
        // Show progress for user list items
        const progress = document.createElement('span');
        progress.className = 'progress';
        const total = media.episodes || media.chapters || '?';
        progress.textContent = this.formatter.formatProgress(entry.progress, total);
        overlay.appendChild(progress);
      } else if (isSearch) {
        // Show total count for search results or generic indicator as fallback
        const searchInfo = document.createElement('span');
        searchInfo.className = 'progress';
        
        if (media.episodes || media.chapters) {
          const count = media.episodes || media.chapters;
          const type = media.episodes ? 'EP' : 'CH';
          searchInfo.textContent = `${count} ${type}`;
        } else {
          searchInfo.textContent = '?';
        }
        
        overlay.appendChild(searchInfo);
      } else {
        // Generic indicator when nothing is available to show
        const fallback = document.createElement('span');
        fallback.className = 'progress';
        fallback.textContent = '—';
        overlay.appendChild(fallback);
      }
    } else {
      overlay.appendChild(document.createElement('span'));
    }
    
    // Format indicator
    if (media.format) {
      const format = document.createElement('span');
      format.className = 'format';
      format.textContent = this.formatter.formatFormat(media.format);
      overlay.appendChild(format);
    } else {
      overlay.appendChild(document.createElement('span')); // Empty span to maintain layout
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

  createMediaInfo(media: Media, entry: MediaEntry, config: RenderConfig, isSearch: boolean, isCompact: boolean): HTMLElement {
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

  createTitle(media: Media, entry: MediaEntry, config: RenderConfig): HTMLElement {
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
  
  createCreateNoteButton(media: Media, entry: MediaEntry, config: RenderConfig): HTMLElement {
    const createBtn = document.createElement('span');
    createBtn.className = 'zoro-note-obsidian';
    const noteSpan = document.createElement('span');
    noteSpan.textContent = '📝';
    createBtn.appendChild(noteSpan);
    createBtn.title = 'Create connected note';
    
    createBtn.onclick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      try {
        // Extract source and media type using existing logic
        const source = this.apiHelper.detectSource(entry, config);
        const mediaType = this.apiHelper.detectMediaType(entry, config, media);
        
        // Extract search IDs using the same logic as ConnectedNotes
        const searchIds = this.plugin.connectedNotes.extractSearchIds(media, entry, source);
        
        // Store current media context for note creation
        this.plugin.connectedNotes.currentMedia = media;
        this.plugin.connectedNotes.currentEntry = entry;
        this.plugin.connectedNotes.currentSource = source;
        this.plugin.connectedNotes.currentMediaType = mediaType;
        this.plugin.connectedNotes.currentUrls = this.plugin.connectedNotes.buildCurrentUrls(media, mediaType, source);
        
        // Create the connected note
        await this.plugin.connectedNotes.createNewConnectedNote(searchIds, mediaType);
        
        new Notice('Created connected note');
        
      } catch (error) {
        console.error('[Zoro] Create note button error:', error);
        new Notice('Failed to create connected note');
      }
    };
    
    return createBtn;
  }

  createMediaDetails(media: Media, entry: MediaEntry, config: RenderConfig, isSearch: boolean): HTMLElement {
    const details = document.createElement('div');
    details.className = 'media-details';

    // Create info row for progress/format/rating
    const infoRow = document.createElement('div');
    infoRow.className = 'zoro-card-media-info-row';

    // Progress indicator for user lists OR total count for search results
    if (this.plugin.settings.showProgress) {
      if (!isSearch && entry && entry.progress != null) {
        // Show progress for user list items
        const progress = document.createElement('span');
        progress.className = 'zoro-card-progress-info';
        const total = media.episodes || media.chapters || '?';
        progress.textContent = this.formatter.formatProgress(entry.progress, total);
        infoRow.appendChild(progress);
      } else if (isSearch) {
        // Show total count for search results or generic indicator as fallback
        const searchInfo = document.createElement('span');
        searchInfo.className = 'zoro-card-progress-info';
        
        if (media.episodes || media.chapters) {
          const count = media.episodes || media.chapters;
          const type = media.episodes ? 'EP' : 'CH';
          searchInfo.textContent = `${count} ${type}`;
        } else {
          searchInfo.textContent = '?';
        }
        
        infoRow.appendChild(searchInfo);
      }
    }

    // Rating indicator
    if (this.plugin.settings.showRatings) {
      const publicScore = isSearch ? (media.averageScore ?? media._rawData?.rating ?? media.rating ?? null) : null;
      const score = isSearch ? publicScore : entry?.score;
      if (score != null) {
        const rating = document.createElement('span');
        rating.className = 'zoro-card-score-info';
        rating.textContent = this.formatter.formatRating(score, isSearch);
        infoRow.appendChild(rating);
      }
    }
    
    // Format indicator
    if (media.format) {
      const format = document.createElement('span');
      format.className = 'zoro-card-format-info';
      format.textContent = this.formatter.formatFormat(media.format);
      infoRow.appendChild(format);
    }

    // Only add the info row if it has content
    if (infoRow.children.length > 0) {
      details.appendChild(infoRow);
    }
    
    // Action buttons row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'zoro-card-media-actions-row';
    
    const createNoteBtn = this.createCreateNoteButton(media, entry, config);
    actionsRow.appendChild(createNoteBtn);
    
    const connectedNotesBtn = this.plugin.connectedNotes.createConnectedNotesButton(media, entry, config);
    actionsRow.appendChild(connectedNotesBtn);
    
    details.appendChild(actionsRow);

    return details;
  }
  
  createStatusBadge(entry: MediaEntry, config: RenderConfig): HTMLElement {
    const statusBadge = document.createElement('span');
    const statusClass = this.formatter.getStatusClass(entry.status);
    const statusText = this.formatter.getStatusText(entry.status);
    
    statusBadge.className = `status-badge status-${statusClass} clickable-status`;
    const badgeSpan = document.createElement('span');
    badgeSpan.textContent = '☑️';
    statusBadge.appendChild(badgeSpan);
    statusBadge.onclick = (e: MouseEvent) => this.handleStatusClick(e, entry, statusBadge, config);
    
    return statusBadge;
  }

  createEditButton(media: Media, entry: MediaEntry, config: RenderConfig): HTMLElement {
    const editBtn = document.createElement('span');
    editBtn.className = 'status-badge status-edit clickable-status';
    editBtn.textContent = 'Edit';
    editBtn.dataset.loading = 'false';
    editBtn.onclick = (e: MouseEvent) => this.handleEditClick(e, media, entry, config, editBtn);
    
    return editBtn;
  }

  createAddButton(media: Media, entry: MediaEntry, config: RenderConfig): HTMLElement {
    const addBtn = document.createElement('span');
    addBtn.classList.add('zoro-add-button-cover');
    const addSpan = document.createElement('span');
    addSpan.textContent = '🔖';
    addBtn.appendChild(addSpan);
    addBtn.dataset.loading = 'false';
    addBtn.onclick = (e: MouseEvent) => this.handleAddClick(e, media, entry, config, addBtn);
    
    return addBtn;
  }

  createGenres(media: Media): HTMLElement {
    const genres = document.createElement('div');
    genres.className = 'genres';
    
    const genreList = this.formatter.formatGenres(media.genres || []);
    genreList.forEach(g => {
      const tag = document.createElement('span');
      tag.className = 'genre-tag';
      tag.textContent = g || 'Unknown';
      genres.appendChild(tag);
    });
    
    return genres;
  }

  handleStatusClick(e: MouseEvent, entry: MediaEntry, badge: HTMLElement, config: RenderConfig): void {
    e.preventDefault();
    e.stopPropagation();
    
    const source = this.apiHelper.detectSource(entry, config);
    const mediaType = this.apiHelper.detectMediaType(entry, config);
    
    if (!this.apiHelper.isAuthenticated(source)) {
      return;
    }
    
    // Prefer Side Panel inline edit; fallback is handled inside handleEditClick
    this.plugin.handleEditClick(e, entry, badge, { source, mediaType });
  }

  async handleAddClick(e: MouseEvent, media: Media, entry: MediaEntry, config: RenderConfig, addBtn: HTMLElement): Promise<void> {
    e.preventDefault(); 
    e.stopPropagation();

    let entrySource = this.apiHelper.detectSource(entry, config);
    const entryMediaType = this.apiHelper.detectMediaType(entry, config, media);

    const isTmdbItem = ((entry?._zoroMeta?.source || '').toLowerCase() === 'tmdb') || !!(media?.idTmdb || media?.ids?.tmdb);
    if (isTmdbItem) {
      entrySource = 'simkl';
      try {
        const numericId = Number(media.id) || Number(media.idTmdb) || 0;
        if (numericId > 0) {
          this.plugin.cache.set(String(numericId), { media }, { scope: 'mediaData' });
        }
      } catch {
        // Silently handle cache errors
      }
    }

    if (!this.apiHelper.isAuthenticated(entrySource)) {
      console.log(`[Zoro] Not authenticated with ${entrySource}`);
      return;
    }

    try {
      const typeUpper = String(entryMediaType || '').toUpperCase();
      const isMovieOrTv = typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper.includes('SHOW');

      const updates = { status: 'PLANNING' };

      // For TMDb movie/TV routed to Simkl, call the explicit ID update path
      if (entrySource === 'simkl' && isTmdbItem && isMovieOrTv) {
        const ids = { tmdb: Number(media.idTmdb || media.id) || undefined, imdb: media.idImdb || undefined };
        if (typeof this.plugin?.simklApi?.updateMediaListEntryWithIds === 'function') {
          await this.plugin.simklApi.updateMediaListEntryWithIds(ids, updates, entryMediaType);
        } else {
          const idFallback = Number(media.idTmdb || media.id) || 0;
          await this.apiHelper.updateMediaListEntry(idFallback, updates, entrySource, entryMediaType);
        }
      } else {
        await this.apiHelper.updateMediaListEntry(media.id, updates, entrySource, entryMediaType);
      }

      // Success feedback
      new Notice('✅ Added to planning!', 3000);
      console.log(`[Zoro] Added ${media.id} to planning via add button`);

      // remove spinner and all children (this is the key step)
      if (typeof (addBtn as any).replaceChildren === 'function') {
        (addBtn as any).replaceChildren();
      } else {
        addBtn.innerHTML = '';
      }

      // Add success icon via mapper/createEl/fallback
      const mapper = (globalThis as any).__emojiIconMapper;
      if (mapper) {
        const frag = mapper.parseToFragment('📑');
        if (frag) {
          addBtn.appendChild(frag);
        } else {
          const span = document.createElement('span');
          span.textContent = '📑';
          addBtn.appendChild(span);
        }
      } else if (typeof setIcon === 'function') {
        const span = document.createElement('span');
        setIcon(span, 'bookmark');
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Reset button on error
      addBtn.dataset.loading = 'false';
      addBtn.innerHTML = '';
      addBtn.classList.remove('zoro-add-button-cover');
      addBtn.classList.add('zoro-add-button-cover');
      addBtn.textContent = 'Add';
      addBtn.style.pointerEvents = 'auto';

      new Notice(`❌ Failed to add: ${errorMessage}`, 5000);
    }
  }

  async handleEditClick(e: MouseEvent, media: Media, entry: MediaEntry, config: RenderConfig, editBtn: HTMLElement): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    
    const entrySource = this.apiHelper.detectSource(entry, config);
    const entryMediaType = this.apiHelper.detectMediaType(entry, config, media);

    if (!this.apiHelper.isAuthenticated(entrySource)) {
      console.log(`[Zoro] Not authenticated with ${entrySource}`);
      return;
    }

    editBtn.dataset.loading = 'true';
    editBtn.innerHTML = DOMHelper.createLoadingSpinner();
    editBtn.style.pointerEvents = 'none';

    try {
      const numericId = Number(media.id) || 0;
      const normalizedId = entrySource === 'simkl' ? this.plugin.simklApi!.normalizeSimklId(numericId) : numericId;
      console.log('[Zoro][Edit] entrySource', entrySource, 'entryMediaType', entryMediaType);
      console.log('[Zoro][Edit] mediaTitle', this.formatter.formatTitle(media));
      console.log(`[Zoro] Checking user entry for media ${normalizedId} via ${entrySource}`);
      
      let existingEntry: MediaEntry | null = null;
      if (normalizedId > 0) {
        // TODO: Check for existing entry in user list
      } else if (entrySource === 'simkl') {
        // Attempt to resolve a Simkl ID by title before editing
        const guessId = await this.plugin.simklApi!.resolveSimklIdByTitle(this.formatter.formatTitle(media), entryMediaType);
        if (guessId > 0) {
          media.id = guessId;
        }
      }
      
      console.log(`[Zoro] User entry result:`, existingEntry ? 'Found existing entry' : 'Not in user list');
      
      const entryToEdit: MediaEntry = existingEntry || {
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

      console.log(`[Zoro] Opening edit in Side Panel for ${isNewEntry ? 'new' : 'existing'} entry`);
      try {
        const view = await this.plugin.connectedNotes.openSidePanelWithContext({ media, entry: entryToEdit, source: entrySource, mediaType: entryMediaType });
        await view.showEditForEntry(entryToEdit, { source: entrySource });
      } catch (err) {
        console.error('[Zoro] Failed to open inline edit in Side Panel from card', err);
      }

    } catch (error) {
      console.error('[Zoro] User entry check failed:', error);
      
      editBtn.textContent = 'Edit';
      editBtn.dataset.loading = 'false';
      editBtn.style.pointerEvents = 'auto';
      
      new Notice('⚠️ Could not check list status, assuming new entry', 3000);
      
      const defaultEntry: MediaEntry = {
        media: media,
        status: 'PLANNING',
        progress: 0,
        score: null,
        id: null
      };

      const view = await this.plugin.connectedNotes.openSidePanelWithContext({ media, entry: defaultEntry, source: entrySource, mediaType: entryMediaType });
      await view.showEditForEntry(defaultEntry, { source: entrySource });
    }
  }
}