class MoreDetailsPanel {
  constructor(plugin) {
    this.plugin = plugin;
    this.openDetailPanel = new OpenDetailPanel(plugin);
       this.customExternalURL = new CustomExternalURL(plugin);
  
  }

  async showPanel(media, entry = null, triggerElement) {
    return await this.openDetailPanel.showPanel(media, entry, triggerElement);
  }

  closePanel() {
    this.openDetailPanel.closePanel();
  }

  get currentPanel() {
    return this.openDetailPanel.currentPanel;
  }
}

export { MoreDetailsPanel };