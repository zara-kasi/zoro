import { Setting, Notice, setIcon } from 'obsidian';

interface EmojiIconMapperOptions {
  map?: [string, string][];
  iconSize?: number;
  gap?: number;
}

interface InitOptions {
  patchSettings?: boolean;
  patchCreateEl?: boolean;
  patchNotice?: boolean;
}

interface Match {
  start: number;
  end: number;
  iconName: string;
}

interface Stats {
  totalMappings: number;
  patched: boolean;
  patchCount: number;
}

interface CreateElAttrs {
  text?: string | number | null;
  [key: string]: unknown;
}

interface PatchedMethods {
  [key: string]: Function;
}

// Extend global to include our mapper
declare global {
  var __emojiIconMapper: EmojiIconMapper | undefined;
  var Notice: typeof Notice;
}

export class EmojiIconMapper {
  private readonly map: Map<string, string>;
  private _sortedKeys: string[];
  private _emojiRegex: RegExp;
  private readonly _iconRegex: RegExp;
  private readonly _colonRegex: RegExp;
  private readonly _patches: Map<object, PatchedMethods>;
  private _patched: boolean;
  private readonly iconSize: number;
  private readonly gap: number;
  private readonly _iconStyle: string;

  constructor(opts: EmojiIconMapperOptions = {}) {
    this.map = new Map(Object.entries({
      '👤': 'user',
      '🧭': 'compass',
      '📺': 'monitor',
      '🌌': 'palette',
      '✨': 'sparkles',
      '📤': 'upload',
      '🔁': 'refresh-cw',
      '🚧': 'construction',
      'ℹ️': 'info',
      '🆔': 'id-card',
      '✳️': 'shell',
      '🗾': 'origami',
      '⚡': 'zap',
      '🗝️': 'key',
      '🧊': 'layout-grid',
      '🔲': 'columns-3',
      '⏳': 'loader',
      '🔗': 'link',
      '🌆': 'image',
      '⭐': 'star',
      '📈': 'trending-up',
      '🎭': 'tag',
      '🧮': 'calculator',
      '🧾': 'file-text',
      '🎨': 'palette',
      '📥': 'download',
      '🗑': 'trash',
      '📊': 'bar-chart',
      '🧹': 'trash-2',
      '🎬': 'film',
      '🗝': 'key',
      '🔑': 'key',
      '🔒': 'lock',
      '🔍': 'search',
      '🌐': 'globe',
      '🛰️': 'globe',
      '🌀': 'refresh-cw',
      '🌟': 'star',
      '🗑️': 'trash-2',
      '⌛': 'hourglass',
      '📃': 'file-text',
      '📉': 'trending-down',
      '🧿': 'list',
      '🧨': 'zap',
      'ℹ': 'info',
      '➕': 'circle-plus',
      '📝': 'square-pen',
      '⛓️': 'workflow',
      '💾': 'database-backup',
      '🌓': 'swatch-book',
      '🗒️': 'notebook-pen', 
      '🗂️': 'folder-open',
      '🔮': 'align-right',
      '🎴': 'file-input',
      '🚪': 'door-open',
      '📖': 'square-arrow-out-up-right',
      '✅': 'check',
      '📋': 'clipboard-list',
      '🔖': 'bookmark',
      '📑': 'bookmark-check',
      '⚠️': 'triangle-alert',
      '🕹️': 'settings-2',
      '☑️': 'list-checks',
      '🫔': 'wrap-text',
      '❤️': 'heart',
      '🤍': 'heart-crack',
      '🔐': 'user-lock',
      ...Object.fromEntries(opts.map || [])
    }));
    
    this._sortedKeys = [...this.map.keys()].sort((a, b) => b.length - a.length);
    this._emojiRegex = new RegExp(`(${this._sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    this._iconRegex = /\[icon:([a-z0-9-]+)\]/gi;
    this._colonRegex = /:([a-z0-9-]+):/gi;
    this._patches = new Map();
    this._patched = false;
    this.iconSize = opts.iconSize ?? 30;
    this.gap = opts.gap ?? 6;
    this._iconStyle = `display:inline-flex;align-items:center;justify-content:center;width:${this.iconSize}px;height:${this.iconSize}px;vertical-align:middle`;
  }

  init(opts: InitOptions = {}): this {
    const { patchSettings = true, patchCreateEl = true, patchNotice = false } = opts;
    
    if (this._patched) return this;
    
    this._injectStyles();
    patchSettings && this._patchSettings();
    patchCreateEl && this._patchCreateEl();
    patchNotice && this._patchNotice();
    
    this._patched = true;
    globalThis.__emojiIconMapper = this;
    return this;
  }

  unpatch(): this {
    if (!this._patched) return this;
    
    for (const [target, original] of this._patches) {
      try { 
        Object.assign(target, original); 
      } catch {
        // Silently handle assignment failures
      }
    }
    
    this._patches.clear();
    this._patched = false;
    return this;
  }

  parseToFragment(text: string | null | undefined): DocumentFragment | null {
    if (!text?.trim?.()) return null;
    
    if (!this._hasTokens(text)) return null;
    
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    
    const matches = this._getAllMatches(text);
    if (!matches.length) return null;
    
    matches.forEach(({ start, end, iconName }) => {
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      
      fragment.appendChild(this._createIcon(iconName));
      lastIndex = end;
    });
    
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    
    return fragment;
  }

  private _hasTokens(text: string): boolean {
    this._emojiRegex.lastIndex = 0;
    return text.includes('[icon:') || text.includes(':') || this._emojiRegex.test(text);
  }

  private _getAllMatches(text: string): Match[] {
    const matches: Match[] = [];
    
    this._iconRegex.lastIndex = 0;
    for (const match of text.matchAll(this._iconRegex)) {
      matches.push({
        start: match.index!,
        end: match.index! + match[0].length,
        iconName: match[1]
      });
    }
    
    this._colonRegex.lastIndex = 0;
    for (const match of text.matchAll(this._colonRegex)) {
      matches.push({
        start: match.index!,
        end: match.index! + match[0].length,
        iconName: match[1]
      });
    }
    
    this._emojiRegex.lastIndex = 0;
    for (const match of text.matchAll(this._emojiRegex)) {
      const iconName = this.map.get(match[0]);
      if (iconName) {
        matches.push({
          start: match.index!,
          end: match.index! + match[0].length,
          iconName
        });
      }
    }
    
    return matches
      .sort((a, b) => a.start - b.start)
      .filter((match, i, arr) => 
        i === 0 || match.start >= arr[i - 1].end
      );
  }

  private _createIcon(name: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.style.cssText = this._iconStyle;
    
    try {
      if (typeof setIcon === 'function' && name) {
        setIcon(span, name);
      } else {
        span.textContent = name ? `[${name}]` : '';
      }
    } catch {
      span.textContent = '';
    }
    
    return span;
  }

  private _injectStyles(): void {
    const styleId = 'emoji-icon-mapper-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `.eim-inline{display:inline-flex;gap:${this.gap}px;align-items:center;line-height:1}`;
    document.head.appendChild(style);
  }

  private _createPatchedMethod(original: Function, processor?: Function): Function {
    const self = this;
    return function(this: unknown, value: unknown) {
      if (typeof value === 'string') {
        const fragment = self.parseToFragment(value);
        if (fragment) {
          const wrapper = document.createElement('span');
          wrapper.className = 'eim-inline';
          wrapper.appendChild(fragment);
          return original.call(this, wrapper);
        }
      }
      return original.call(this, value);
    };
  }

  private _patchSettings(): void {
    if (typeof Setting === 'undefined') return;
    
    const proto = Setting.prototype;
    const original = {
      setName: proto.setName,
      setDesc: proto.setDesc
    };
    
    proto.setName = this._createPatchedMethod(original.setName);
    proto.setDesc = this._createPatchedMethod(original.setDesc);
    
    this._patches.set(proto, original);
  }

  private _patchCreateEl(): void {
    if (!Element.prototype.createEl) return;
    
    const proto = Element.prototype;
    const original = { createEl: proto.createEl };
    const self = this;
    
    proto.createEl = function(this: Element, tag: string, attrs?: CreateElAttrs, options?: unknown): HTMLElement {
      if (attrs?.text != null) {
        const { text, ...restAttrs } = attrs;
        const element = original.createEl.call(this, tag, restAttrs, options);
        
        if (typeof text === 'string') {
          const fragment = self.parseToFragment(text);
          element.appendChild(fragment || document.createTextNode(text));
        } else {
          element.appendChild(document.createTextNode(String(text)));
        }
        
        return element;
      }
      return original.createEl.apply(this, arguments as any);
    };
    
    this._patches.set(proto, original);
  }

  private _patchNotice(): void {
    if (typeof Notice === 'undefined') return;
    
    const OriginalNotice = Notice;
    const self = this;
    
    function PatchedNotice(text: string, duration?: number): Notice {
      const instance = new OriginalNotice('', duration);
      const element = (instance as any).noticeEl || (instance as any).containerEl;
      
      if (element && typeof text === 'string') {
        const fragment = self.parseToFragment(text);
        element.appendChild(fragment || document.createTextNode(text));
      }
      
      return instance;
    }
    
    Object.setPrototypeOf(PatchedNotice, OriginalNotice);
    PatchedNotice.prototype = OriginalNotice.prototype;
    
    globalThis.Notice = PatchedNotice as typeof Notice;
    this._patches.set(globalThis, { Notice: OriginalNotice });
  }

  addMap(mappings: Map<string, string> | Record<string, string>): this {
    const entries = mappings instanceof Map ? mappings : Object.entries(mappings);
    
    for (const [key, value] of entries) {
      this.map.set(key, value);
    }
    
    this._sortedKeys = [...this.map.keys()].sort((a, b) => b.length - a.length);
    this._emojiRegex = new RegExp(
      `(${this._sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 
      'g'
    );
    this._iconRegex = /\[icon:([a-z0-9-]+)\]/gi;
    this._colonRegex = /:([a-z0-9-]+):/gi;
    
    return this;
  }

  getStats(): Stats {
    return {
      totalMappings: this.map.size,
      patched: this._patched,
      patchCount: this._patches.size
    };
  }
}
