// No obsidian imports needed here
import { OpenDetailPanel } from './OpenDetailPanel.js';
import { CustomExternalURL } from './CustomExternalURL.js';

class MoreDetailsPanel {
  constructor(plugin) {
    this.plugin = plugin;
    this.openDetailPanel = new OpenDetailPanel(plugin);
       this.customExternalURL = new CustomExternalURL(plugin);
  
  }

  async showPanel(media, entry = null, triggerElement, mountContainer = null) {
    return await this.openDetailPanel.showPanel(media, entry, triggerElement, mountContainer);
  }

  closePanel() {
    this.openDetailPanel.closePanel();
  }

  get currentPanel() {
    return this.openDetailPanel.currentPanel;
  }
}

export { MoreDetailsPanel };