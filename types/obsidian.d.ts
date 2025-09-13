declare module 'obsidian' {
  export class Plugin {
    app: App;
    manifest: any;
    constructor();
    loadData<T = any>(): Promise<T>;
    saveData(data: any): Promise<void>;
    register(): void;
  }

  export class Notice {
    constructor(message: string, timeout?: number);
    hide(): void;
  }

  export interface RequestUrlResponse {
    status: number;
    text(): Promise<string>;
    json<T = any>(): Promise<T>;
    headers?: Record<string, string>;
  }

  export function requestUrl(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    contentType?: string;
  }): Promise<RequestUrlResponse>;

  export class Modal {
    contentEl: HTMLElement;
    constructor(app: App);
    open(): void;
    close(): void;
  }

  export class Vault {
    getName(): string;
    getAbstractFileByPath(path: string): TFile | null;
    read(file: TFile): Promise<string>;
    create(path: string, data: string): Promise<TFile>;
    modify(file: TFile, data: string): Promise<void>;
    delete(file: TFile): Promise<void>;
  }

  export class PluginSettingTab {
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin);
    display(): void;
    hide(): void;
  }

  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    addText(cb: (text: TextComponent) => any): this;
    addToggle(cb: (toggle: ToggleComponent) => any): this;
    addDropdown(cb: (dropdown: DropdownComponent) => any): this;
    addButton(cb: (button: ButtonComponent) => any): this;
  }

  export class TextComponent {
    setValue(value: string): this;
    onChange(callback: (value: string) => any): this;
  }

  export class ToggleComponent {
    setValue(value: boolean): this;
    onChange(callback: (value: boolean) => any): this;
  }

  export class DropdownComponent {
    addOption(value: string, text: string): this;
    setValue(value: string): this;
    onChange(callback: (value: string) => any): this;
  }

  export class ButtonComponent {
    setButtonText(text: string): this;
    onClick(callback: () => any): this;
  }

  export interface App {
    workspace: Workspace;
    vault: Vault;
    plugins: any;
  }

  export interface Workspace {
    getActiveFile(): TFile | null;
    getLeavesOfType(type: string): WorkspaceLeaf[];
    getActiveViewOfType<T>(type: any): T | null;
    activeLeaf: WorkspaceLeaf | null;
  }

  export interface WorkspaceLeaf {
    setViewState(state: any): void;
    view: any;
  }

  export interface TFile {
    path: string;
    name: string;
    basename: string;
    extension: string;
    parent: TFolder;
    stat: {
      ctime: number;
      mtime: number;
      size: number;
    };
  }

  export interface TFolder {
    path: string;
    name: string;
    children: (TFile | TFolder)[];
  }

  export interface CachedMetadata {
    frontmatter?: any;
    links?: LinkCache[];
    embeds?: EmbedCache[];
    tags?: TagCache[];
    headings?: HeadingCache[];
    sections?: SectionCache[];
  }

  export interface LinkCache {
    link: string;
    displayText?: string;
    position: Pos;
  }

  export interface EmbedCache {
    link: string;
    displayText?: string;
    position: Pos;
  }

  export interface TagCache {
    tag: string;
    position: Pos;
  }

  export interface HeadingCache {
    heading: string;
    level: number;
    position: Pos;
  }

  export interface SectionCache {
    type: string;
    position: Pos;
  }

  export interface Pos {
    start: Loc;
    end: Loc;
  }

  export interface Loc {
    line: number;
    col: number;
    offset: number;
  }

  export class ItemView {
    contentEl: HTMLElement;
    constructor(leaf: WorkspaceLeaf);
    getViewType(): string;
    getDisplayText(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
  }

  export function setIcon(el: HTMLElement, iconName: string): void;

  export class Component {
    load(): void;
    unload(): void;
    register(cb: () => any): void;
    registerEvent(eventRef: EventRef): void;
  }

  export interface EventRef {
    // Event reference type
  }

  export class Events {
    on(name: string, callback: (...args: any[]) => any, ctx?: any): EventRef;
    off(name: string, callback: (...args: any[]) => any): void;
    trigger(name: string, ...args: any[]): void;
  }

  // Common utility types
  export type TAbstractFile = TFile | TFolder;
}