// Settings UI tab
const { PluginSettingTab, Setting, Notice } = require('obsidian');

class ZoroSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('👤 Username')
      .addText(text => text.setValue(this.plugin.settings.defaultUsername)
        .onChange(async v => { this.plugin.settings.defaultUsername = v; await this.plugin.saveSettings(); }));
    // ... other settings
    new Setting(containerEl)
      .setName('🔓 Authenticate')
      .addButton(btn => btn.setButtonText('Authenticate').onClick(async () => {
        await this.plugin.authenticateUser();
      }));
  }
}

module.exports = {
  ZoroSettingTab
};
