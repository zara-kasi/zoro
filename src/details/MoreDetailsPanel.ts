import { OpenDetailPanel } from './OpenDetailPanel';
import { CustomExternalURL } from './CustomExternalURL';

// Type definitions
interface Plugin {
  [key: string]: unknown; // TODO: replace with actual plugin interface
}

interface MediaData {
  [key: string]: unknown; // TODO: confirm media structure from usage
}

interface EntryData {
  [key: string]: unknown; // TODO: confirm entry structure from usage
}

export class MoreDetailsPanel {
  private plugin: Plugin;
  private openDetailPanel: OpenDetailPanel;
  private customExternalURL: CustomExternalURL;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.openDetailPanel = new OpenDetailPanel(plugin);
    this.customExternalURL = new CustomExternalURL(plugin);
  }

  async showPanel(
    media: MediaData, 
    entry: EntryData | null = null, 
    triggerElement: HTMLElement, 
    mountContainer: HTMLElement | null = null
  ): Promise<unknown> { // TODO: confirm return type from OpenDetailPanel.showPanel
    return await this.openDetailPanel.showPanel(media, entry, triggerElement, mountContainer);
  }

  closePanel(): void {
    this.openDetailPanel.closePanel();
  }

  get currentPanel(): unknown { // TODO: confirm type from OpenDetailPanel.currentPanel
    return this.openDetailPanel.currentPanel;
  }
}
