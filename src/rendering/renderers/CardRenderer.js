"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardRenderer = void 0;
var obsidian_1 = require("obsidian");
var DOMHelper_1 = require("../helpers/DOMHelper");
var CardRenderer = /** @class */ (function () {
    function CardRenderer(parentRenderer) {
        this.parent = parentRenderer;
        this.plugin = parentRenderer.plugin;
        this.apiHelper = parentRenderer.apiHelper;
        this.formatter = parentRenderer.formatter;
    }
    CardRenderer.prototype.createMediaCard = function (data, config, options) {
        var _a, _b, _c, _d, _e, _f;
        if (options === void 0) { options = {}; }
        var isSearch = options.isSearch || false;
        var isCompact = config.layout === 'compact';
        var media = isSearch ? data : data.media;
        // Ensure we have a usable numeric id for card actions
        if (!media.id || Number.isNaN(Number(media.id))) {
            media.id = Number((media === null || media === void 0 ? void 0 : media.id) || (media === null || media === void 0 ? void 0 : media.idTmdb) || (media === null || media === void 0 ? void 0 : media.idImdb) || (media === null || media === void 0 ? void 0 : media.idMal) || ((_a = media === null || media === void 0 ? void 0 : media.ids) === null || _a === void 0 ? void 0 : _a.tmdb) || ((_b = media === null || media === void 0 ? void 0 : media.ids) === null || _b === void 0 ? void 0 : _b.imdb) || ((_c = media === null || media === void 0 ? void 0 : media.ids) === null || _c === void 0 ? void 0 : _c.simkl) || ((_d = media === null || media === void 0 ? void 0 : media.ids) === null || _d === void 0 ? void 0 : _d.id) || 0) || 0;
        }
        // For search/trending items, synthesize a lightweight entry carrying metadata for proper source/mediaType detection
        var entry = isSearch
            ? {
                media: media,
                status: 'PLANNING',
                progress: 0,
                score: null,
                id: null,
                _zoroMeta: (data === null || data === void 0 ? void 0 : data._zoroMeta) || {
                    source: this.apiHelper.validateAndReturnSource(config === null || config === void 0 ? void 0 : config.source) ||
                        ((_e = data === null || data === void 0 ? void 0 : data._zoroMeta) === null || _e === void 0 ? void 0 : _e.source) ||
                        this.apiHelper.detectFromDataStructure({ media: media }) ||
                        this.apiHelper.getFallbackSource(),
                    mediaType: (function () {
                        if (config === null || config === void 0 ? void 0 : config.mediaType)
                            return config.mediaType;
                        var fmt = String((media === null || media === void 0 ? void 0 : media.format) || '').toUpperCase();
                        if (fmt === 'MOVIE')
                            return 'MOVIE';
                        if (fmt === 'MANGA' || fmt === 'NOVEL' || fmt === 'ONE_SHOT')
                            return 'MANGA';
                        return 'ANIME';
                    })()
                }
            }
            : data;
        var source = this.apiHelper.detectSource(entry, config);
        var mediaType = this.apiHelper.detectMediaType(entry, config, media);
        var card = document.createElement('div');
        card.className = "zoro-card ".concat(isCompact ? 'compact' : '');
        card.dataset.mediaId = String(Number(media.id) || 0);
        // Create cover image if enabled
        if (this.plugin.settings.showCoverImages && ((_f = media.coverImage) === null || _f === void 0 ? void 0 : _f.large)) {
            var coverContainer = this.createCoverContainer(media, entry, isSearch, isCompact, config);
            card.appendChild(coverContainer);
        }
        // Create media info section
        var info = this.createMediaInfo(media, entry, config, isSearch, isCompact);
        card.appendChild(info);
        // Add heart for favorites
        var heart = document.createElement('span');
        heart.className = 'zoro-heart';
        heart.createEl('span', { text: '❤️' });
        if (!media.isFavourite)
            heart.style.display = 'none';
        card.appendChild(heart);
        return card;
    };
    CardRenderer.prototype.createCoverContainer = function (media, entry, isSearch, isCompact, config) {
        var _this = this;
        var coverContainer = document.createElement('div');
        coverContainer.className = 'cover-container';
        var img = document.createElement('img');
        img.src = media.coverImage.large;
        img.alt = media.title.english || media.title.romaji || 'Untitled';
        img.className = 'media-cover pressable-cover';
        img.loading = 'lazy';
        var pressTimer = null;
        var isPressed = false;
        var pressHoldDuration = 400;
        img.onmousedown = function (e) {
            e.preventDefault();
            e.stopPropagation();
            isPressed = true;
            img.classList.add('pressed');
            pressTimer = setTimeout(function () {
                if (isPressed) {
                    (function () { return __awaiter(_this, void 0, void 0, function () {
                        var source, mediaType, view, err_1;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 3, , 4]);
                                    source = this.apiHelper.detectSource(entry, config);
                                    mediaType = this.apiHelper.detectMediaType(entry, config, media);
                                    return [4 /*yield*/, this.plugin.connectedNotes.openSidePanelWithContext({ media: media, entry: entry, source: source, mediaType: mediaType })];
                                case 1:
                                    view = _a.sent();
                                    return [4 /*yield*/, view.showDetailsForMedia(media, entry)];
                                case 2:
                                    _a.sent();
                                    return [3 /*break*/, 4];
                                case 3:
                                    err_1 = _a.sent();
                                    console.error('[Zoro] Failed to open inline details', err_1);
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); })();
                    img.classList.remove('pressed');
                    isPressed = false;
                }
            }, pressHoldDuration);
        };
        var clearPressState = function () {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            img.classList.remove('pressed');
            isPressed = false;
        };
        img.onmouseup = clearPressState;
        img.onmouseleave = clearPressState;
        img.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        };
        img.oncontextmenu = function (e) {
            e.preventDefault();
            return false;
        };
        img.ondragstart = function (e) {
            e.preventDefault();
            return false;
        };
        img.ontouchstart = function (e) {
            isPressed = true;
            img.classList.add('pressed');
            pressTimer = setTimeout(function () {
                if (isPressed) {
                    e.preventDefault();
                    (function () { return __awaiter(_this, void 0, void 0, function () {
                        var source, mediaType, view, err_2;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 3, , 4]);
                                    source = this.apiHelper.detectSource(entry, config);
                                    mediaType = this.apiHelper.detectMediaType(entry, config, media);
                                    return [4 /*yield*/, this.plugin.connectedNotes.openSidePanelWithContext({ media: media, entry: entry, source: source, mediaType: mediaType })];
                                case 1:
                                    view = _a.sent();
                                    return [4 /*yield*/, view.showDetailsForMedia(media, entry)];
                                case 2:
                                    _a.sent();
                                    return [3 /*break*/, 4];
                                case 3:
                                    err_2 = _a.sent();
                                    console.error('[Zoro] Failed to open inline details (touch)', err_2);
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); })();
                    img.classList.remove('pressed');
                    isPressed = false;
                }
            }, pressHoldDuration);
        };
        var clearTouchState = function () {
            if (pressTimer) {
                clearTimeout(pressTimer);
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
            var addBtn = this.createAddButton(media, entry, config);
            coverContainer.appendChild(addBtn);
        }
        return coverContainer;
    };
    CardRenderer.prototype.createFormatBadgeForCover = function (media) {
        var formatBadge = document.createElement('div');
        formatBadge.className = 'zoro-format-badge-cover';
        formatBadge.textContent = this.formatter.formatFormat(media.format);
        return formatBadge;
    };
    CardRenderer.prototype.createCoverOverlay = function (media, entry, isSearch) {
        var _a, _b, _c, _d;
        var overlay = document.createElement('div');
        overlay.className = 'cover-overlay';
        // Progress indicator for user lists OR total count for search results
        if (this.plugin.settings.showProgress) {
            if (!isSearch && entry && entry.progress != null) {
                // Show progress for user list items
                var progress = document.createElement('span');
                progress.className = 'progress';
                var total = media.episodes || media.chapters || '?';
                progress.textContent = this.formatter.formatProgress(entry.progress, total);
                overlay.appendChild(progress);
            }
            else if (isSearch) {
                // Show total count for search results or generic indicator as fallback
                var searchInfo = document.createElement('span');
                searchInfo.className = 'progress';
                if (media.episodes || media.chapters) {
                    var count = media.episodes || media.chapters;
                    var type = media.episodes ? 'EP' : 'CH';
                    searchInfo.textContent = "".concat(count, " ").concat(type);
                }
                else {
                    searchInfo.textContent = '?';
                }
                overlay.appendChild(searchInfo);
            }
            else {
                // Generic indicator when nothing is available to show
                var fallback = document.createElement('span');
                fallback.className = 'progress';
                fallback.textContent = '—';
                overlay.appendChild(fallback);
            }
        }
        else {
            overlay.appendChild(document.createElement('span'));
        }
        // Format indicator
        if (media.format) {
            var format = document.createElement('span');
            format.className = 'format';
            format.textContent = this.formatter.formatFormat(media.format);
            overlay.appendChild(format);
        }
        else {
            overlay.appendChild(document.createElement('span')); // Empty span to maintain layout
        }
        // Rating indicator
        if (this.plugin.settings.showRatings) {
            var publicScore = isSearch ? ((_d = (_c = (_a = media.averageScore) !== null && _a !== void 0 ? _a : (_b = media._rawData) === null || _b === void 0 ? void 0 : _b.rating) !== null && _c !== void 0 ? _c : media.rating) !== null && _d !== void 0 ? _d : null) : null;
            var score = isSearch ? publicScore : entry === null || entry === void 0 ? void 0 : entry.score;
            if (score != null) {
                var rating = document.createElement('span');
                rating.className = 'score';
                rating.textContent = this.formatter.formatRating(score, isSearch);
                overlay.appendChild(rating);
            }
            else {
                overlay.appendChild(document.createElement('span'));
            }
        }
        return overlay;
    };
    CardRenderer.prototype.createMediaInfo = function (media, entry, config, isSearch, isCompact) {
        var _a;
        var info = document.createElement('div');
        info.className = 'media-info';
        // Title
        var title = this.createTitle(media, entry, config);
        info.appendChild(title);
        // Details (status, edit button - format badge removed)
        if (!isCompact) {
            var details = this.createMediaDetails(media, entry, config, isSearch);
            info.appendChild(details);
        }
        // Genres
        if (!isCompact && this.plugin.settings.showGenres && ((_a = media.genres) === null || _a === void 0 ? void 0 : _a.length)) {
            var genres = this.createGenres(media);
            info.appendChild(genres);
        }
        return info;
    };
    CardRenderer.prototype.createTitle = function (media, entry, config) {
        var title = document.createElement('h4');
        if (this.plugin.settings.hideUrlsInTitles) {
            title.textContent = this.formatter.formatTitle(media);
        }
        else {
            var titleLink = document.createElement('a');
            var source = this.apiHelper.detectSource(entry, config);
            var mediaType = this.apiHelper.detectMediaType(entry, config, media);
            // Use the proper URL method based on available plugin methods
            var safeId = Number(media.id) || 0;
            if (source === 'simkl' && safeId <= 0) {
                // Fallback: open Simkl on-site search when we lack a stable id from search results
                var q = encodeURIComponent(this.formatter.formatTitle(media));
                titleLink.href = "https://simkl.com/search/?q=".concat(q);
            }
            else {
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
    };
    CardRenderer.prototype.createCreateNoteButton = function (media, entry, config) {
        var _this = this;
        var createBtn = document.createElement('span');
        createBtn.className = 'zoro-note-obsidian';
        createBtn.createEl('span', { text: '📝' });
        createBtn.title = 'Create connected note';
        createBtn.onclick = function (e) { return __awaiter(_this, void 0, void 0, function () {
            var source, mediaType, searchIds, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        e.preventDefault();
                        e.stopPropagation();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        source = this.apiHelper.detectSource(entry, config);
                        mediaType = this.apiHelper.detectMediaType(entry, config, media);
                        searchIds = this.plugin.connectedNotes.extractSearchIds(media, entry, source);
                        // Store current media context for note creation
                        this.plugin.connectedNotes.currentMedia = media;
                        this.plugin.connectedNotes.currentEntry = entry;
                        this.plugin.connectedNotes.currentSource = source;
                        this.plugin.connectedNotes.currentMediaType = mediaType;
                        this.plugin.connectedNotes.currentUrls = this.plugin.connectedNotes.buildCurrentUrls(media, mediaType, source);
                        // Create the connected note
                        return [4 /*yield*/, this.plugin.connectedNotes.createNewConnectedNote(searchIds, mediaType)];
                    case 2:
                        // Create the connected note
                        _a.sent();
                        new obsidian_1.Notice('Created connected note');
                        return [3 /*break*/, 4];
                    case 3:
                        error_1 = _a.sent();
                        console.error('[Zoro] Create note button error:', error_1);
                        new obsidian_1.Notice('Failed to create connected note');
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        }); };
        return createBtn;
    };
    CardRenderer.prototype.createMediaDetails = function (media, entry, config, isSearch) {
        var _a, _b, _c, _d;
        var details = document.createElement('div');
        details.className = 'media-details';
        // Create info row for progress/format/rating
        var infoRow = document.createElement('div');
        infoRow.className = 'zoro-card-media-info-row';
        // Progress indicator for user lists OR total count for search results
        if (this.plugin.settings.showProgress) {
            if (!isSearch && entry && entry.progress != null) {
                // Show progress for user list items
                var progress = document.createElement('span');
                progress.className = 'zoro-card-progress-info';
                var total = media.episodes || media.chapters || '?';
                progress.textContent = this.formatter.formatProgress(entry.progress, total);
                infoRow.appendChild(progress);
            }
            else if (isSearch) {
                // Show total count for search results or generic indicator as fallback
                var searchInfo = document.createElement('span');
                searchInfo.className = 'zoro-card-progress-info';
                if (media.episodes || media.chapters) {
                    var count = media.episodes || media.chapters;
                    var type = media.episodes ? 'EP' : 'CH';
                    searchInfo.textContent = "".concat(count, " ").concat(type);
                }
                else {
                    searchInfo.textContent = '?';
                }
                infoRow.appendChild(searchInfo);
            }
        }
        // Rating indicator
        if (this.plugin.settings.showRatings) {
            var publicScore = isSearch ? ((_d = (_c = (_a = media.averageScore) !== null && _a !== void 0 ? _a : (_b = media._rawData) === null || _b === void 0 ? void 0 : _b.rating) !== null && _c !== void 0 ? _c : media.rating) !== null && _d !== void 0 ? _d : null) : null;
            var score = isSearch ? publicScore : entry === null || entry === void 0 ? void 0 : entry.score;
            if (score != null) {
                var rating = document.createElement('span');
                rating.className = 'zoro-card-score-info';
                rating.textContent = this.formatter.formatRating(score, isSearch);
                infoRow.appendChild(rating);
            }
        }
        // Format indicator
        if (media.format) {
            var format = document.createElement('span');
            format.className = 'zoro-card-format-info';
            format.textContent = this.formatter.formatFormat(media.format);
            infoRow.appendChild(format);
        }
        // Only add the info row if it has content
        if (infoRow.children.length > 0) {
            details.appendChild(infoRow);
        }
        // Action buttons row
        var actionsRow = document.createElement('div');
        actionsRow.className = 'zoro-card-media-actions-row';
        var createNoteBtn = this.createCreateNoteButton(media, entry, config);
        actionsRow.appendChild(createNoteBtn);
        var connectedNotesBtn = this.plugin.connectedNotes.createConnectedNotesButton(media, entry, config);
        actionsRow.appendChild(connectedNotesBtn);
        details.appendChild(actionsRow);
        return details;
    };
    CardRenderer.prototype.createStatusBadge = function (entry, config) {
        var _this = this;
        var statusBadge = document.createElement('span');
        var statusClass = this.formatter.getStatusClass(entry.status);
        var statusText = this.formatter.getStatusText(entry.status);
        statusBadge.className = "status-badge status-".concat(statusClass, " clickable-status");
        statusBadge.createEl('span', { text: '☑️' });
        statusBadge.onclick = function (e) { return _this.handleStatusClick(e, entry, statusBadge, config); };
        return statusBadge;
    };
    CardRenderer.prototype.createEditButton = function (media, entry, config) {
        var _this = this;
        var editBtn = document.createElement('span');
        editBtn.className = 'status-badge status-edit clickable-status';
        editBtn.textContent = 'Edit';
        editBtn.dataset.loading = 'false';
        editBtn.onclick = function (e) { return _this.handleEditClick(e, media, entry, config, editBtn); };
        return editBtn;
    };
    CardRenderer.prototype.createAddButton = function (media, entry, config) {
        var _this = this;
        var addBtn = document.createElement('span');
        addBtn.classList.add('zoro-add-button-cover');
        addBtn.createEl('span', { text: '🔖' });
        addBtn.dataset.loading = 'false';
        addBtn.onclick = function (e) { return _this.handleAddClick(e, media, entry, config, addBtn); };
        return addBtn;
    };
    CardRenderer.prototype.createGenres = function (media) {
        var genres = document.createElement('div');
        genres.className = 'genres';
        var genreList = this.formatter.formatGenres(media.genres || []);
        genreList.forEach(function (g) {
            var tag = document.createElement('span');
            tag.className = 'genre-tag';
            tag.textContent = g || 'Unknown';
            genres.appendChild(tag);
        });
        return genres;
    };
    CardRenderer.prototype.handleStatusClick = function (e, entry, badge, config) {
        e.preventDefault();
        e.stopPropagation();
        var source = this.apiHelper.detectSource(entry, config);
        var mediaType = this.apiHelper.detectMediaType(entry, config);
        if (!this.apiHelper.isAuthenticated(source)) {
            return;
        }
        // Prefer Side Panel inline edit; fallback is handled inside handleEditClick
        this.plugin.handleEditClick(e, entry, badge, { source: source, mediaType: mediaType });
    };
    CardRenderer.prototype.handleAddClick = function (e, media, entry, config, addBtn) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, Promise, function () {
            var entrySource, entryMediaType, isTmdbItem, numericId, typeUpper, isMovieOrTv, updates, ids, idFallback, mapper, frag, span, error_2, errorMessage;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        e.preventDefault();
                        e.stopPropagation();
                        entrySource = this.apiHelper.detectSource(entry, config);
                        entryMediaType = this.apiHelper.detectMediaType(entry, config, media);
                        isTmdbItem = ((((_a = entry === null || entry === void 0 ? void 0 : entry._zoroMeta) === null || _a === void 0 ? void 0 : _a.source) || '').toLowerCase() === 'tmdb') || !!((media === null || media === void 0 ? void 0 : media.idTmdb) || ((_b = media === null || media === void 0 ? void 0 : media.ids) === null || _b === void 0 ? void 0 : _b.tmdb));
                        if (isTmdbItem) {
                            entrySource = 'simkl';
                            try {
                                numericId = Number(media.id) || Number(media.idTmdb) || 0;
                                if (numericId > 0) {
                                    this.plugin.cache.set(String(numericId), { media: media }, { scope: 'mediaData' });
                                }
                            }
                            catch (_f) {
                                // Silently handle cache errors
                            }
                        }
                        if (!this.apiHelper.isAuthenticated(entrySource)) {
                            console.log("[Zoro] Not authenticated with ".concat(entrySource));
                            return [2 /*return*/];
                        }
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 9, , 10]);
                        typeUpper = String(entryMediaType || '').toUpperCase();
                        isMovieOrTv = typeUpper === 'MOVIE' || typeUpper === 'MOVIES' || typeUpper === 'TV' || typeUpper.includes('SHOW');
                        updates = { status: 'PLANNING' };
                        if (!(entrySource === 'simkl' && isTmdbItem && isMovieOrTv)) return [3 /*break*/, 6];
                        ids = { tmdb: Number(media.idTmdb || media.id) || undefined, imdb: media.idImdb || undefined };
                        if (!(typeof ((_d = (_c = this.plugin) === null || _c === void 0 ? void 0 : _c.simklApi) === null || _d === void 0 ? void 0 : _d.updateMediaListEntryWithIds) === 'function')) return [3 /*break*/, 3];
                        return [4 /*yield*/, this.plugin.simklApi.updateMediaListEntryWithIds(ids, updates, entryMediaType)];
                    case 2:
                        _e.sent();
                        return [3 /*break*/, 5];
                    case 3:
                        idFallback = Number(media.idTmdb || media.id) || 0;
                        return [4 /*yield*/, this.apiHelper.updateMediaListEntry(idFallback, updates, entrySource, entryMediaType)];
                    case 4:
                        _e.sent();
                        _e.label = 5;
                    case 5: return [3 /*break*/, 8];
                    case 6: return [4 /*yield*/, this.apiHelper.updateMediaListEntry(media.id, updates, entrySource, entryMediaType)];
                    case 7:
                        _e.sent();
                        _e.label = 8;
                    case 8:
                        // Success feedback
                        new obsidian_1.Notice('✅ Added to planning!', 3000);
                        console.log("[Zoro] Added ".concat(media.id, " to planning via add button"));
                        // remove spinner and all children (this is the key step)
                        if (typeof addBtn.replaceChildren === 'function') {
                            addBtn.replaceChildren();
                        }
                        else {
                            addBtn.innerHTML = '';
                        }
                        mapper = globalThis.__emojiIconMapper;
                        if (mapper) {
                            frag = mapper.parseToFragment('📑');
                            if (frag) {
                                addBtn.appendChild(frag);
                            }
                            else if (typeof addBtn.createEl === 'function') {
                                addBtn.createEl('span', { text: '📑' });
                            }
                            else {
                                addBtn.textContent = '📑';
                            }
                        }
                        else if (typeof obsidian_1.setIcon === 'function') {
                            span = document.createElement('span');
                            (0, obsidian_1.setIcon)(span, 'bookmark');
                            addBtn.appendChild(span);
                        }
                        else {
                            addBtn.textContent = '📑';
                        }
                        // update classes cleanly
                        addBtn.classList.remove('zoro-add-button-cover');
                        addBtn.classList.add('zoro-add-button-cover');
                        // leave pointer events disabled so user can't re-add; change to 'auto' if you want clickable
                        addBtn.style.pointerEvents = 'none';
                        // Refresh UI
                        this.parent.refreshActiveViews();
                        return [3 /*break*/, 10];
                    case 9:
                        error_2 = _e.sent();
                        console.error('[Zoro] Add failed:', error_2);
                        errorMessage = error_2 instanceof Error ? error_2.message : 'Unknown error';
                        // Reset button on error
                        addBtn.dataset.loading = 'false';
                        addBtn.innerHTML = '';
                        addBtn.classList.remove('zoro-add-button-cover');
                        addBtn.classList.add('zoro-add-button-cover');
                        addBtn.textContent = 'Add';
                        addBtn.style.pointerEvents = 'auto';
                        new obsidian_1.Notice("\u274C Failed to add: ".concat(errorMessage), 5000);
                        return [3 /*break*/, 10];
                    case 10: return [2 /*return*/];
                }
            });
        });
    };
    CardRenderer.prototype.handleEditClick = function (e, media, entry, config, editBtn) {
        return __awaiter(this, void 0, Promise, function () {
            var entrySource, entryMediaType, numericId, normalizedId, existingEntry, guessId, entryToEdit, isNewEntry, view, err_3, error_3, defaultEntry, view;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        e.preventDefault();
                        e.stopPropagation();
                        entrySource = this.apiHelper.detectSource(entry, config);
                        entryMediaType = this.apiHelper.detectMediaType(entry, config, media);
                        if (!this.apiHelper.isAuthenticated(entrySource)) {
                            console.log("[Zoro] Not authenticated with ".concat(entrySource));
                            return [2 /*return*/];
                        }
                        editBtn.dataset.loading = 'true';
                        editBtn.innerHTML = DOMHelper_1.DOMHelper.createLoadingSpinner();
                        editBtn.style.pointerEvents = 'none';
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 10, , 13]);
                        numericId = Number(media.id) || 0;
                        normalizedId = entrySource === 'simkl' ? this.plugin.simklApi.normalizeSimklId(numericId) : numericId;
                        console.log('[Zoro][Edit] entrySource', entrySource, 'entryMediaType', entryMediaType);
                        console.log('[Zoro][Edit] mediaTitle', this.formatter.formatTitle(media));
                        console.log("[Zoro] Checking user entry for media ".concat(normalizedId, " via ").concat(entrySource));
                        existingEntry = null;
                        if (!(normalizedId > 0)) return [3 /*break*/, 2];
                        return [3 /*break*/, 4];
                    case 2:
                        if (!(entrySource === 'simkl')) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.plugin.simklApi.resolveSimklIdByTitle(this.formatter.formatTitle(media), entryMediaType)];
                    case 3:
                        guessId = _a.sent();
                        if (guessId > 0) {
                            media.id = guessId;
                        }
                        _a.label = 4;
                    case 4:
                        console.log("[Zoro] User entry result:", existingEntry ? 'Found existing entry' : 'Not in user list');
                        entryToEdit = existingEntry || {
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
                        isNewEntry = !existingEntry;
                        editBtn.textContent = isNewEntry ? 'Add' : 'Edit';
                        editBtn.className = "status-badge ".concat(isNewEntry ? 'status-add' : 'status-edit', " clickable-status");
                        editBtn.dataset.loading = 'false';
                        editBtn.style.pointerEvents = 'auto';
                        console.log("[Zoro] Opening edit in Side Panel for ".concat(isNewEntry ? 'new' : 'existing', " entry"));
                        _a.label = 5;
                    case 5:
                        _a.trys.push([5, 8, , 9]);
                        return [4 /*yield*/, this.plugin.connectedNotes.openSidePanelWithContext({ media: media, entry: entryToEdit, source: entrySource, mediaType: entryMediaType })];
                    case 6:
                        view = _a.sent();
                        return [4 /*yield*/, view.showEditForEntry(entryToEdit, { source: entrySource })];
                    case 7:
                        _a.sent();
                        return [3 /*break*/, 9];
                    case 8:
                        err_3 = _a.sent();
                        console.error('[Zoro] Failed to open inline edit in Side Panel from card', err_3);
                        return [3 /*break*/, 9];
                    case 9: return [3 /*break*/, 13];
                    case 10:
                        error_3 = _a.sent();
                        console.error('[Zoro] User entry check failed:', error_3);
                        editBtn.textContent = 'Edit';
                        editBtn.dataset.loading = 'false';
                        editBtn.style.pointerEvents = 'auto';
                        new obsidian_1.Notice('⚠️ Could not check list status, assuming new entry', 3000);
                        defaultEntry = {
                            media: media,
                            status: 'PLANNING',
                            progress: 0,
                            score: null,
                            id: null
                        };
                        return [4 /*yield*/, this.plugin.connectedNotes.openSidePanelWithContext({ media: media, entry: defaultEntry, source: entrySource, mediaType: entryMediaType })];
                    case 11:
                        view = _a.sent();
                        return [4 /*yield*/, view.showEditForEntry(defaultEntry, { source: entrySource })];
                    case 12:
                        _a.sent();
                        return [3 /*break*/, 13];
                    case 13: return [2 /*return*/];
                }
            });
        });
    };
    return CardRenderer;
}());
exports.CardRenderer = CardRenderer;
