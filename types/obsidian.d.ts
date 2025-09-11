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

  export interface App {
    workspace: any;
    // add more as you need when migrating other modules
  }

  export interface WorkspaceLeaf {
    setViewState(state: any): void;
  }

  export type TFile = any;
}