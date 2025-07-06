var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { PluginSettingTab, Setting } from 'obsidian';
export class AniListSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'AniList Plugin Settings' });
        // Username setting
        new Setting(containerEl)
            .setName('Default Username')
            .setDesc('Your AniList username (used when no username is specified)')
            .addText(text => text
            .setPlaceholder('Enter your AniList username')
            .setValue(this.plugin.settings.username)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.username = value;
            yield this.plugin.saveSettings();
        })));
        // Default list type
        new Setting(containerEl)
            .setName('Default List Type')
            .setDesc('The default list to display when no type is specified')
            .addDropdown(dropdown => dropdown
            .addOption('CURRENT', 'Currently Watching')
            .addOption('COMPLETED', 'Completed')
            .addOption('PLANNING', 'Plan to Watch')
            .addOption('DROPPED', 'Dropped')
            .addOption('PAUSED', 'Paused')
            .setValue(this.plugin.settings.defaultListType)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.defaultListType = value;
            yield this.plugin.saveSettings();
        })));
        // Display options
        containerEl.createEl('h3', { text: 'Display Options' });
        new Setting(containerEl)
            .setName('Show Cover Images')
            .setDesc('Display cover images for anime/manga')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.showImages)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showImages = value;
            yield this.plugin.saveSettings();
        })));
        new Setting(containerEl)
            .setName('Show Ratings')
            .setDesc('Display your personal ratings')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.showRatings)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showRatings = value;
            yield this.plugin.saveSettings();
        })));
        new Setting(containerEl)
            .setName('Show Progress')
            .setDesc('Display watch/read progress')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.showProgress)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showProgress = value;
            yield this.plugin.saveSettings();
        })));
        new Setting(containerEl)
            .setName('Card Layout')
            .setDesc('Use card layout instead of table layout')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.cardLayout)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.cardLayout = value;
            yield this.plugin.saveSettings();
        })));
        // Cache management
        containerEl.createEl('h3', { text: 'Cache Management' });
        new Setting(containerEl)
            .setName('Clear Cache')
            .setDesc('Clear cached AniList data (data is cached for 5 minutes)')
            .addButton(button => button
            .setButtonText('Clear Cache')
            .setCta()
            .onClick(() => __awaiter(this, void 0, void 0, function* () {
            this.plugin.api.clearCache();
            button.setButtonText('Cache Cleared!');
            setTimeout(() => {
                button.setButtonText('Clear Cache');
            }, 2000);
        })));
        // Usage instructions
        containerEl.createEl('h3', { text: 'Usage Instructions' });
        const usageDiv = containerEl.createEl('div', { cls: 'anilist-usage' });
        usageDiv.createEl('h4', { text: 'Code Block Syntax:' });
        usageDiv.createEl('pre', { text: '```anilist\nusername: yourusername\nlistType: CURRENT\nshowImages: true\nshowRatings: true\nshowProgress: true\n```' });
        usageDiv.createEl('h4', { text: 'Inline Syntax:' });
        usageDiv.createEl('p', { text: 'Link to specific anime/manga:' });
        usageDiv.createEl('code', { text: '![[anilist:username/anime/123456]]' });
        usageDiv.createEl('p', { text: 'Show user stats:' });
        usageDiv.createEl('code', { text: '![[anilist:username/stats]]' });
        usageDiv.createEl('h4', { text: 'Available List Types:' });
        const listTypes = usageDiv.createEl('ul');
        listTypes.createEl('li', { text: 'CURRENT - Currently watching' });
        listTypes.createEl('li', { text: 'COMPLETED - Completed anime' });
        listTypes.createEl('li', { text: 'PLANNING - Plan to watch' });
        listTypes.createEl('li', { text: 'DROPPED - Dropped anime' });
        listTypes.createEl('li', { text: 'PAUSED - Paused anime' });
        usageDiv.createEl('h4', { text: 'Code Block Parameters:' });
        const params = usageDiv.createEl('ul');
        params.createEl('li', { text: 'username: AniList username (optional if default is set)' });
        params.createEl('li', { text: 'listType: List type to display (optional)' });
        params.createEl('li', { text: 'showImages: true/false (optional)' });
        params.createEl('li', { text: 'showRatings: true/false (optional)' });
        params.createEl('li', { text: 'showProgress: true/false (optional)' });
        // Add some basic styling
        const style = containerEl.createEl('style');
        style.textContent = `
            .anilist-usage {
                background: var(--background-secondary);
                padding: 1rem;
                border-radius: 8px;
                margin-top: 1rem;
            }
            .anilist-usage h4 {
                margin-top: 1rem;
                margin-bottom: 0.5rem;
                color: var(--text-accent);
            }
            .anilist-usage pre {
                background: var(--background-primary);
                padding: 0.5rem;
                border-radius: 4px;
                overflow-x: auto;
            }
            .anilist-usage code {
                background: var(--background-primary);
                padding: 0.2rem 0.4rem;
                border-radius: 4px;
            }
            .anilist-usage ul {
                margin-left: 1rem;
            }
        `;
    }
}
