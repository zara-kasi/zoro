import { Plugin, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, ZoroSettings } from './core/constants';
import { ZoroError } from './core/ZoroError';

export default class ZoroPlugin extends Plugin {
  settings: ZoroSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    new Notice('Zoro (TS sample) loaded!', 3000);

    // initialize the singleton error handler with strongly-typed plugin
    ZoroError.instance(this);

    // TODO: register commands / settings tabs / UI components here
  }

  onunload(): void {
    ZoroError.instance(this).destroy();
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<ZoroSettings> | undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}