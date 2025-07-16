const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { ClientIdModal, ClientSecretModal } = require('./modals');
const { createSampleNotes } = require('../utils/sampleNotes');

class ZoroSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('➕ Sample Notes')
      .setDesc('Creates notes to view your anime and manga data.')
      .addButton(btn => btn.setButtonText('Create Note').onClick(() => createSampleNotes(this.plugin)));

    new Setting(containerEl)
      .setName('👤 Username')
      .setDesc('Lets you access your public profile and stats.')
      .addText(t => t.setPlaceholder('Enter your AniList username').setValue(this.plugin.settings.defaultUsername).onChange(async v => {
        this.plugin.settings.defaultUsername = v.trim();
        await this.plugin.saveSettings();
      }));

    const auth = new Setting(containerEl).setName('🔓 Optional Login').setDesc('Access private lists & edit entries.');
    auth.addButton(btn => {
      this.authBtn = btn;
      this.updateAuthBtn();
      btn.onClick(async () => {
        const s = this.plugin.settings;
        if (!s.clientId) new ClientIdModal(this.app, v => { s.clientId = v; this.plugin.saveSettings(); this.updateAuthBtn(); }).open();
        else if (!s.clientSecret) new ClientSecretModal(this.app, v => { s.clientSecret = v; this.plugin.saveSettings(); this.updateAuthBtn(); }).open();
        else await this.plugin.authenticateUser();
      });
    });

    new Setting(containerEl).setName('🧊 Layout').addDropdown(d => d.addOption('card', 'Card').addOption('table', 'Table').setValue(this.plugin.settings.defaultLayout).onChange(async v => { this.plugin.settings.defaultLayout = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('🌆 Cover').addToggle(t => t.setValue(this.plugin.settings.showCoverImages).onChange(async v => { this.plugin.settings.showCoverImages = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('⭐ Ratings').addToggle(t => t.setValue(this.plugin.settings.showRatings).onChange(async v => { this.plugin.settings.showRatings = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('📈 Progress').addToggle(t => t.setValue(this.plugin.settings.showProgress).onChange(async v => { this.plugin.settings.showProgress = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('🎭 Genres').addToggle(t => t.setValue(this.plugin.settings.showGenres).onChange(async v => { this.plugin.settings.showGenres = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('🔲 Grid Columns').addSlider(s => s.setLimits(1, 6, 1).setValue(this.plugin.settings.gridColumns).onChange(async v => { this.plugin.settings.gridColumns = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('🪤 Hidden Settings').addButton(b => b.setButtonText('View Documentation').onClick(() => window.open('https://github.com/zara-kasi/zoro/blob/main/README.md', '_blank')));
  }

  updateAuthBtn() {
    if (!this.authBtn) return;
    const s = this.plugin.settings;
    if (!s.clientId) this.authBtn.setButtonText('Enter Client ID');
    else if (!s.clientSecret) this.authBtn.setButtonText('Enter Client Secret');
    else if (!s.accessToken) this.authBtn.setButtonText('Authenticate Now');
    else this.authBtn.setButtonText(`✅ Account Connected`);
  }
}

module.exports = { ZoroSettingTab };
