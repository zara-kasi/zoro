const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

class OpenDetailPanel {
  constructor(plugin) {
    this.plugin = plugin;
    this.currentPanel = null;
    this.boundOutsideClickHandler = this.handleOutsideClick.bind(this);
    this.renderer = new RenderDetailPanel(plugin);
    this.dataSource = new DetailPanelSource(plugin);
  }

  async showPanel(media, entry = null, triggerElement) {
    this.closePanel();
    const panel = this.renderer.createPanel(media, entry);
    this.currentPanel = panel;
    this.renderer.positionPanel(panel, triggerElement);
    const closeBtn = panel.querySelector('.panel-close-btn');
    if (closeBtn) closeBtn.onclick = () => this.closePanel();
    document.body.appendChild(panel);
    document.addEventListener('click', this.boundOutsideClickHandler);
    this.plugin.requestQueue.showGlobalLoader();

    if (this.dataSource.shouldFetchDetailedData(media)) {
      this.dataSource.fetchAndUpdateData(media.id, entry, (detailedMedia, malData, imdbData) => {
        if (this.currentPanel === panel) this.renderer.updatePanelContent(panel, detailedMedia, malData, imdbData);
      }).finally(() => this.plugin.requestQueue.hideGlobalLoader());
    } else {
      this.plugin.requestQueue.hideGlobalLoader();
    }
    return panel;
  }

  handleOutsideClick(event) {
    if (this.currentPanel && !this.currentPanel.contains(event.target)) this.closePanel();
  }

  closePanel() {
    if (this.currentPanel) {
      this.renderer.cleanupCountdowns(this.currentPanel);
      document.removeEventListener('click', this.boundOutsideClickHandler);
      this.currentPanel.remove();
      this.currentPanel = null;
    }
  }
}