import { PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import { AuthModal } from '../auth/AuthModal.js';
import { GRID_COLUMN_OPTIONS, GRID_COLUMN_LABELS } from '../core/constants.js';

class ZoroSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty()

    const section = (title, startOpen = false) => {
      const head = containerEl.createEl('h2', { text: title });
      head.style.cursor = 'pointer';
      head.style.userSelect = 'none';
      head.style.margin = '1.2em 0 0.4em 0';
      const body = containerEl.createDiv();
      body.style.marginLeft = '1em';
      body.style.display = startOpen ? 'block' : 'none';
      head.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });
      return body;
    };

    const Account = section('👤 Account');
    const Setup = section('🧭 Setup');
    const Note = section('🗒️ Note');
    const Display = section('📺 Display');
    const More = section('✨  More');
    const Shortcut = section('🚪 Shortcut');
    const Data = section('💾 Data');
    const Cache = section('🔁 Cache');
    const About = section('ℹ️ About');

    

    const authSetting = new Setting(Account)
  .setName('✳️ AniList')
  .setDesc('Connect your AniList account to manage your anime and manga lists.');

const authDescEl = authSetting.descEl;
authDescEl.createEl('br');
const authLinkEl = authDescEl.createEl('a', {
  text: 'Learn more',
  href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md'
});
authLinkEl.setAttr('target', '_blank');
authLinkEl.setAttr('rel', 'noopener noreferrer');
authLinkEl.style.textDecoration = 'none';

authSetting.addButton(button => {
  this.authButton = button;
  this.updateAuthButton();
  button.onClick(async () => {
    await this.handleAuthButtonClick();
  });
});
   
   const malAuthSetting = new Setting(Account)
  .setName('🗾 MyAnimeList')
  .setDesc('Connect your MAL account to manage your anime and manga lists');

const descEl = malAuthSetting.descEl;
descEl.createEl('br');
const linkEl = descEl.createEl('a', {
  text: 'Learn more',
  href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/mal-auth-setup.md'
});
linkEl.setAttr('target', '_blank');
linkEl.setAttr('rel', 'noopener noreferrer');
linkEl.style.textDecoration = 'none';

malAuthSetting.addButton(btn => {  
  this.malAuthButton = btn;  
  this.updateMALAuthButton();  
  btn.onClick(async () => {  
    await this.handleMALAuthButtonClick();  
  });  
}); 
   
   const simklAuthSetting = new Setting(Account)
  .setName('🎬 SIMKL')
  .setDesc('Connect your SIMKL account to manage your anime, movies, and TV shows.');

const simklDescEl = simklAuthSetting.descEl;
simklDescEl.createEl('br');
const simklLinkEl = simklDescEl.createEl('a', {
  text: 'Learn more',
  href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/simkl-auth-setup.md'
});
simklLinkEl.setAttr('target', '_blank');
simklLinkEl.setAttr('rel', 'noopener noreferrer');
simklLinkEl.style.textDecoration = 'none';

simklAuthSetting.addButton(btn => {
  this.simklAuthButton = btn;
  this.updateSimklAuthButton();
  btn.onClick(async () => {
    await this.handleSimklAuthButtonClick();
  });
});
    
    
    
    new Setting(Setup)
      .setName('⚡ Sample Folder')
      .setDesc('Builds a complete Zoro folder structure with notes, no manual setup needed. (Recommended)')
      .addButton(button =>
        button
          .setButtonText('Create')
          .onClick(async () => {
            await this.plugin.sample.createSampleFolders();
          })
      );
      
      new Setting(Setup)
      .setName('🕹️ Default Source')
      .setDesc(
  "Choose which service to use by default when none is specified.\n" +
  "Anime — AniList, MAL, or SIMKL\n" +
  "Manga — AniList or MAL\n" +
  "Movies & TV — Always SIMKL\n" +
  "Recommended: AniList"
)
      .addDropdown(dropdown => dropdown
        .addOption('anilist', 'AniList')
        .addOption('mal', 'MyAnimeList')
        .addOption('simkl', 'SIMKL')
        .setValue(this.plugin.settings.defaultApiSource)
        .onChange(async (value) => {
          this.plugin.settings.defaultApiSource = value;
          this.plugin.settings.defaultApiUserOverride = true;
          await this.plugin.saveSettings();
        }));
        
        new Setting(Note)
      .setName('🗂️ Note path')
      .setDesc('Folder path where new connected notes will be created')
      .addText(text => text
        .setPlaceholder('folder/subfolder')
        .setValue(this.plugin.settings.notePath || '')
        .onChange(async (value) => {
          let cleanPath = value.trim();
          if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
          }
          if (cleanPath.endsWith('/')) {
            cleanPath = cleanPath.substring(0, cleanPath.length - 1);
          }
          
          this.plugin.settings.notePath = cleanPath;
          await this.plugin.saveSettings();
        }));
        
        new Setting(Note)
  .setName('🎴 Media block')
.setDesc('Auto-insert a code block to show cover, rating, and details in new notes')
  .addToggle(toggle => toggle
    .setValue(this.plugin.settings.insertCodeBlockOnNote)
    .onChange(async (value) => {
      this.plugin.settings.insertCodeBlockOnNote = value;
      await this.plugin.saveSettings();
    }));
    
    // Paste these blocks into your settings tab display() method.

// Title
new Setting(Note)
  .setName('Title')
  .setDesc('Frontmatter property for title')
  .addText(text => text
    .setPlaceholder('title')
    .setValue(this.plugin.settings?.customPropertyNames?.title ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.title = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Aliases
new Setting(Note)
  .setName('Aliases')
  .setDesc('Frontmatter property for aliases')
  .addText(text => text
    .setPlaceholder('aliases')
    .setValue(this.plugin.settings?.customPropertyNames?.aliases ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.aliases = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Format
new Setting(Note)
  .setName('Format')
  .setDesc('Frontmatter property for format')
  .addText(text => text
    .setPlaceholder('format')
    .setValue(this.plugin.settings?.customPropertyNames?.format ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.format = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Status
new Setting(Note)
  .setName('Status')
  .setDesc('Frontmatter property for status')
  .addText(text => text
    .setPlaceholder('status')
    .setValue(this.plugin.settings?.customPropertyNames?.status ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.status = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Rating
new Setting(Note)
  .setName('Rating')
  .setDesc('Frontmatter property for rating')
  .addText(text => text
    .setPlaceholder('rating')
    .setValue(this.plugin.settings?.customPropertyNames?.rating ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.rating = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Favorite
new Setting(Note)
  .setName('Favorite')
  .setDesc('Frontmatter property for favorite')
  .addText(text => text
    .setPlaceholder('favorite')
    .setValue(this.plugin.settings?.customPropertyNames?.favorite ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.favorite = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Total episodes
new Setting(Note)
  .setName('Total episodes')
  .setDesc('Frontmatter property for total_episodes')
  .addText(text => text
    .setPlaceholder('total_episodes')
    .setValue(this.plugin.settings?.customPropertyNames?.total_episodes ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.total_episodes = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Total chapters
new Setting(Note)
  .setName('Total chapters')
  .setDesc('Frontmatter property for total_chapters')
  .addText(text => text
    .setPlaceholder('total_chapters')
    .setValue(this.plugin.settings?.customPropertyNames?.total_chapters ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.total_chapters = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Episodes watched
new Setting(Note)
  .setName('Episodes watched')
  .setDesc('Frontmatter property for episodes_watched')
  .addText(text => text
    .setPlaceholder('episodes_watched')
    .setValue(this.plugin.settings?.customPropertyNames?.episodes_watched ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.episodes_watched = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Chapters read
new Setting(Note)
  .setName('Chapters read')
  .setDesc('Frontmatter property for chapters_read')
  .addText(text => text
    .setPlaceholder('chapters_read')
    .setValue(this.plugin.settings?.customPropertyNames?.chapters_read ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.chapters_read = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Volumes read
new Setting(Note)
  .setName('Volumes read')
  .setDesc('Frontmatter property for volumes_read')
  .addText(text => text
    .setPlaceholder('volumes_read')
    .setValue(this.plugin.settings?.customPropertyNames?.volumes_read ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.volumes_read = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Cover
new Setting(Note)
  .setName('Cover')
  .setDesc('Frontmatter property for cover')
  .addText(text => text
    .setPlaceholder('cover')
    .setValue(this.plugin.settings?.customPropertyNames?.cover ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.cover = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));

// Genres
new Setting(Note)
  .setName('Genres')
  .setDesc('Frontmatter property for genres')
  .addText(text => text
    .setPlaceholder('genres')
    .setValue(this.plugin.settings?.customPropertyNames?.genres ?? '')
    .onChange(async (value) => {
      this.plugin.settings = this.plugin.settings || {};
      this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
      this.plugin.settings.customPropertyNames.genres = (typeof value === 'string' ? value.trim() : '');
      await this.plugin.saveSettings();
    }));
        

    new Setting(Display)
      .setName('🧊 Layout')
      .setDesc('Choose the default layout for media lists')
      .addDropdown(dropdown => dropdown
        .addOption('card', 'Card Layout')
        .addOption('table', 'Table Layout')
        .setValue(this.plugin.settings.defaultLayout)
        .onChange(async (value) => {
          this.plugin.settings.defaultLayout = value;
          await this.plugin.saveSettings();
        }));

    new Setting(Display)
      .setName('🔲 Grid Columns')
      .setDesc('Choose grid layout: Default uses responsive columns, or force a specific number of columns')
      .addDropdown(dropdown => {
        // Add all options to the dropdown
        Object.entries(GRID_COLUMN_LABELS).forEach(([value, label]) => {
          dropdown.addOption(value, label);
        });
        
        // Set current value, with fallback for legacy numeric values
        const currentValue = this.plugin.settings.gridColumns;
        if (typeof currentValue === 'number') {
          // Migrate from old numeric system to new string system
          dropdown.setValue(String(currentValue));
        } else {
          dropdown.setValue(currentValue || GRID_COLUMN_OPTIONS.DEFAULT);
        }
        
        dropdown.onChange(async (value) => {
          this.plugin.settings.gridColumns = value;
          await this.plugin.saveSettings();
          this.updateGridColumns(value);
        });
      });
        
        new Setting(More)
      .setName('🆔 Public profile')
      .setDesc("View your AniList profile and stats — no login needed.")
      .addText(text => text
        .setPlaceholder('AniList username')
        .setValue(this.plugin.settings.defaultUsername)
        .onChange(async (value) => {
          this.plugin.settings.defaultUsername = value.trim();
          await this.plugin.saveSettings();
        }));
        
        new Setting(More)
      .setName('⏳ Loading Icon')
      .setDesc('Show loading animation during API requests')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showLoadingIcon)
        .onChange(async (value) => {
          this.plugin.settings.showLoadingIcon = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🔗 Plain Titles')
      .setDesc('Show titles as plain text instead of clickable links.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.hideUrlsInTitles)
        .onChange(async (value) => {
          this.plugin.settings.hideUrlsInTitles = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🌆 Cover')
      .setDesc('Display cover images for anime/manga')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCoverImages)
        .onChange(async (value) => {
          this.plugin.settings.showCoverImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('⭐ Ratings')
      .setDesc('Display user ratings/scores')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showRatings)
        .onChange(async (value) => {
          this.plugin.settings.showRatings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('📈 Progress')
      .setDesc('Display progress information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgress)
        .onChange(async (value) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🎭 Genres')
      .setDesc('Display genre tags')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(More)
      .setName('🧮 Score Scale')
      .setDesc('Ensures all ratings use the 0–10 point scale.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.forceScoreFormat)
        .onChange(async (value) => {
          this.plugin.settings.forceScoreFormat = value;
          await this.plugin.saveSettings();
          if (value && this.plugin.auth.isLoggedIn) {
            await this.plugin.auth.forceScoreFormat();
          }
        }));
        
        const shortcutSetting = new Setting(Shortcut)
  .setName(' Open on site')
  .setDesc('Adds a customizable external-link button to the More Details panel that opens a site-specific search for the current title.');

// Add the documentation link after the description
const shortcutDescEl = shortcutSetting.descEl;
shortcutDescEl.createEl('br');
const shortcutLinkEl = shortcutDescEl.createEl('a', {
  text: 'Learn more',
  href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/shortcuts.md'
});
shortcutLinkEl.setAttr('target', '_blank');
shortcutLinkEl.setAttr('rel', 'noopener noreferrer');
shortcutLinkEl.style.textDecoration = 'none';

shortcutSetting.addButton(button => button
  .setButtonText('Add Anime URL')
  .setClass('mod-cta')
  .onClick(async () => {
    await this.plugin.moreDetailsPanel.customExternalURL.addUrl('ANIME');
    this.refreshCustomUrlSettings();
  }));

// Create container for anime URLs
const animeUrlContainer = Shortcut.createDiv('custom-url-container');
animeUrlContainer.setAttribute('data-media-type', 'ANIME');
this.renderCustomUrls(animeUrlContainer, 'ANIME');

new Setting(Shortcut)
  .addButton(button => button
    .setButtonText('Add Manga URL')
    .setClass('mod-cta')
    .onClick(async () => {
      await this.plugin.moreDetailsPanel.customExternalURL.addUrl('MANGA');
      this.refreshCustomUrlSettings();
    }));

// Create container for manga URLs
const mangaUrlContainer = Shortcut.createDiv('custom-url-container');
mangaUrlContainer.setAttribute('data-media-type', 'MANGA');
this.renderCustomUrls(mangaUrlContainer, 'MANGA');

new Setting(Shortcut)
  .addButton(button => button
    .setButtonText('Add Movie/TV URL')
    .setClass('mod-cta')
    .onClick(async () => {
      await this.plugin.moreDetailsPanel.customExternalURL.addUrl('MOVIE_TV');
      this.refreshCustomUrlSettings();
    }));

// Create container for movie/TV URLs
const movieTvUrlContainer = Shortcut.createDiv('custom-url-container');
movieTvUrlContainer.setAttribute('data-media-type', 'MOVIE_TV');
this.renderCustomUrls(movieTvUrlContainer, 'MOVIE_TV');

new Setting(Shortcut)
  .setName('Auto-Format')
  .setDesc('Automatically format URLs to search format. When disabled, URLs will be used exactly as entered.')
  .addToggle(toggle => toggle
    .setValue(this.plugin.settings.autoFormatSearchUrls)
    .onChange(async (value) => {
      this.plugin.settings.autoFormatSearchUrls = value;
      await this.plugin.saveSettings();
    }));
    
    const exportSetting = new Setting(Data)
  .setName('📥 Export your data')
  .setDesc("Everything you've watched, rated, and maybe ghosted — neatly exported into a CSV & standard export format from AniList, MAL and Simkl.")
  .addButton(btn => btn
    .setButtonText('AniList')
    .setClass('mod-cta')
    .onClick(async () => {
      try {
        await this.plugin.export.exportUnifiedListsToCSV();
      } catch (err) {
        new Notice(`❌ Export failed: ${err.message}`, 6000);
      }
    })
  );

const exportDescEl = exportSetting.descEl;
exportDescEl.createEl('br');
const exportLinkEl = exportDescEl.createEl('a', {
  text: 'Learn more',
  href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/export_overview.md'
});
exportLinkEl.setAttr('target', '_blank');
exportLinkEl.setAttr('rel', 'noopener noreferrer');
exportLinkEl.style.textDecoration = 'none';
  
new Setting(Data)
  .addButton(btn => btn
    .setButtonText('MAL')
    .setClass('mod-cta')
    .onClick(async () => {
      try {
        await this.plugin.export.exportMALListsToCSV();
      } catch (err) {
        new Notice(`❌ MAL export failed: ${err.message}`, 6000);
      }
    })
  );

new Setting(Data)
  .addButton(btn => btn
    .setButtonText('SIMKL')
    .setClass('mod-cta')
    .onClick(async () => {
      if (!this.plugin.simklAuth.isLoggedIn) {
        new Notice('❌ Please authenticate with SIMKL first.', 4000);
        return;
      }
      
      btn.setDisabled(true);
      btn.setButtonText('Exporting...');
      
      try {
        await this.plugin.export.exportSimklListsToCSV();
      } catch (err) {
        new Notice(`❌ SIMKL export failed: ${err.message}`, 6000);
      } finally {
        btn.setDisabled(false);
        btn.setButtonText('SIMKL');
      }
    })
  );
      
      new Setting(Cache)
      .setName('📊 Cache Stats')
      .setDesc('Show live cache usage and hit-rate in a pop-up.')
      .addButton(btn => btn
        .setButtonText('Show Stats')
        .onClick(() => {
          const s = this.plugin.cache.getStats();
          new Notice(
            `Cache: ${s.hitRate} | ${s.cacheSize} entries | Hits ${s.hits} | Misses ${s.misses}`,
            8000
          );
          console.table(s);
        })
      );

    new Setting(Cache)
  .setName('🧹 Clear Cache')
  .setDesc('Delete all cached data (user, media, search results).')
  .addButton(btn => btn
    .setButtonText('Clear All Cache')
    .setWarning()
    .onClick(async () => {
      const cleared = await this.plugin.cache.clearAll();
      new Notice(`✅ Cache cleared (${cleared} entries)`, 3000);
    })
  );
      
        
         
   
    new Setting(About)
      .setName('Author')
      .setDesc(this.plugin.manifest.author);
    new Setting(About)
      .setName('Privacy')
      .setDesc('Zoro only talks to the APIs to fetch & update your media data. Nothing else is sent or shared—your data stays local.');

    new Setting(About)
      .setName('GitHub')
      .setDesc('Get more info or report an issue.')
      .addButton(button =>
        button
          .setClass('mod-cta')
          .setButtonText('Open GitHub')
          .onClick(() => {
            window.open('https://github.com/zara-kasi/zoro', '_blank');
          })
      );
  }

  updateAuthButton() {
    if (!this.authButton) return;
    const { settings } = this.plugin;
    if (!settings.clientId) {
      this.authButton.setButtonText('Enter Client ID');
      this.authButton.removeCta();
    } else if (!settings.clientSecret) {
      this.authButton.setButtonText('Enter Client Secret');
      this.authButton.removeCta();
    } else if (!settings.accessToken) {
      this.authButton.setButtonText('Authenticate Now');
      this.authButton.setCta();
    } else {
      this.authButton.setButtonText('Sign Out');
      this.authButton.setWarning().removeCta();
    }
  }

  async handleAuthButtonClick() {
    const { settings } = this.plugin;
    if (!settings.clientId) {
      const modal = AuthModal.clientId(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.clientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateAuthButton();
        }
      });
      modal.open();
    } else if (!settings.clientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret) => {
        if (clientSecret?.trim()) {
          settings.clientSecret = clientSecret.trim();
          await this.plugin.saveSettings();
          this.updateAuthButton();
        }
      });
      modal.open();
    } else if (!settings.accessToken) {
      await this.plugin.auth.loginWithFlow();
      this.updateAuthButton();
    } else {
      if (confirm('⚠️ Are you sure you want to sign out?')) {
        await this.plugin.auth.logout();
        this.updateAuthButton();
      }
    }
  }

  updateMALAuthButton() {
    if (!this.malAuthButton) return;
    const { settings } = this.plugin;
    if (!settings.malClientId) {
      this.malAuthButton.setButtonText('Enter Client ID');
      this.malAuthButton.removeCta();
    } else if (!settings.malClientSecret) {
      this.malAuthButton.setButtonText('Enter Client Secret');
      this.malAuthButton.removeCta();
    } else if (!settings.malAccessToken) {
      this.malAuthButton.setButtonText('Authenticate Now');
      this.malAuthButton.setCta();
    } else {
      this.malAuthButton.setButtonText('Sign Out');
      this.malAuthButton.setWarning().removeCta();
    }
  }

  async handleMALAuthButtonClick() {
    const { settings } = this.plugin;
    if (!settings.malClientId) {
      const modal = AuthModal.clientId(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.malClientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateMALAuthButton();
        }
      });
      modal.open();
    } else if (!settings.malClientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret) => {
        if (clientSecret?.trim()) {
          settings.malClientSecret = clientSecret.trim();
          await this.plugin.saveSettings();
          this.updateMALAuthButton();
        }
      });
      modal.open();
    } else if (!settings.malAccessToken) {
      await this.plugin.malAuth.loginWithFlow();
      this.updateMALAuthButton();
    } else {
      if (confirm('⚠️ Are you sure you want to sign out?')) {
        await this.plugin.malAuth.logout();
        this.updateMALAuthButton();
      }
    }
  }
  
  updateSimklAuthButton() {
    if (!this.simklAuthButton) return;
    const { settings } = this.plugin;
    if (!settings.simklClientId) {
      this.simklAuthButton.setButtonText('Enter Client ID');
      this.simklAuthButton.removeCta();
    } else if (!settings.simklClientSecret) {
      this.simklAuthButton.setButtonText('Enter Client Secret');
      this.simklAuthButton.removeCta();
    } else if (!settings.simklAccessToken) {
      this.simklAuthButton.setButtonText('Authenticate Now');
      this.simklAuthButton.setCta();
    } else {
      this.simklAuthButton.setButtonText('Sign Out');
      this.simklAuthButton.setWarning().removeCta();
    }
  }

  async handleSimklAuthButtonClick() {
    const { settings } = this.plugin;
    if (!settings.simklClientId) {
      const modal = AuthModal.clientId(this.app, async (clientId) => {
        if (clientId?.trim()) {
          settings.simklClientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateSimklAuthButton();
        }
      });
      modal.open();
    } else if (!settings.simklClientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret) => {
        if (clientSecret?.trim()) {
          settings.simklClientSecret = clientSecret.trim();
          await this.plugin.saveSettings();
          this.updateSimklAuthButton();
        }
      });
      modal.open();
    } else if (!settings.simklAccessToken) {
      await this.plugin.simklAuth.loginWithFlow();
      this.updateSimklAuthButton();
    } else {
      if (confirm('⚠️ Are you sure you want to sign out?')) {
        await this.plugin.simklAuth.logout();
        this.updateSimklAuthButton();
      }
    }
  }
  
  updateGridColumns(value) {
    const gridElements = document.querySelectorAll('.zoro-cards-grid');
    gridElements.forEach(grid => {
      try {
        if (value === GRID_COLUMN_OPTIONS.DEFAULT) {
          // For "Default", remove the inline styles to let CSS handle responsive behavior
          grid.style.removeProperty('--zoro-grid-columns');
          grid.style.removeProperty('--grid-cols');
          grid.style.removeProperty('grid-template-columns');
        } else {
          // For fixed column values, set the CSS variables
          grid.style.setProperty('--zoro-grid-columns', String(value));
          grid.style.setProperty('--grid-cols', String(value));
          // Also set grid-template-columns directly to ensure it takes precedence
          grid.style.setProperty('grid-template-columns', `repeat(${value}, minmax(0, 1fr))`, 'important');
        }
      } catch {}
    });
  }

  renderCustomUrls(container, mediaType) {
    container.empty();
    const urls = this.plugin.settings.customSearchUrls?.[mediaType] || [];
    urls.forEach((url, index) => {
      this.createUrlSetting(container, mediaType, url, index);
    });
  }

  createUrlSetting(container, mediaType, url, index) {
    const urlDiv = container.createDiv('url-setting-item');
    const inputContainer = urlDiv.createDiv('url-input-container');
    let displayValue = url;
    let placeholder = 'https://example.com/search?q=';
    if (url.startsWith('{') && url.endsWith('}')) {
      try {
        const templateData = JSON.parse(url);
        if (templateData.originalUrl) {
          displayValue = templateData.originalUrl;
          placeholder = 'Learned template from example';
        }
      } catch {}
    }
    const input = inputContainer.createEl('input', {
      type: 'text',
      placeholder: placeholder,
      value: displayValue,
      cls: 'custom-url-input'
    });
    const removeBtn = inputContainer.createEl('button', {
      text: '×',
      cls: 'url-remove-button-inside'
    });
    input.addEventListener('input', async (e) => {
      const newValue = e.target.value;
      await this.plugin.moreDetailsPanel.customExternalURL.updateUrl(mediaType, index, newValue);
      if (this.plugin.settings.autoFormatSearchUrls) {
        const formatted = this.plugin.moreDetailsPanel.customExternalURL.formatSearchUrl(newValue);
        input.title = formatted !== newValue && formatted ? `Auto-formatted: ${formatted}` : '';
      } else {
        if (newValue.toLowerCase().includes('zoro')) {
          const template = this.plugin.moreDetailsPanel.customExternalURL.learnTemplateFromExample(newValue, 'zoro zoro');
          if (template) {
            input.title = `Template learned! Pattern: "${template.spacePattern}"`;
          } else {
            const basicTemplate = this.plugin.moreDetailsPanel.customExternalURL.extractBasicTemplate(newValue);
            input.title = basicTemplate ? `Basic template extracted! Pattern: "${basicTemplate.spacePattern}"` : 'Auto-formatting disabled - using exact URL';
          }
        } else {
          input.title = 'Auto-formatting disabled - using exact URL';
        }
      }
    });
    removeBtn.addEventListener('click', async () => {
      await this.plugin.moreDetailsPanel.customExternalURL.removeUrl(mediaType, index);
      this.refreshCustomUrlSettings();
    });
    if (url && url.trim()) {
      const preview = urlDiv.createDiv('url-preview');
      const domainName = this.plugin.moreDetailsPanel.customExternalURL.extractDomainName(url);
      preview.textContent = `Preview: ${domainName}`;
    }
  }

  refreshCustomUrlSettings() {
    const animeContainer = this.containerEl.querySelector('[data-media-type="ANIME"]');
    if (animeContainer) this.renderCustomUrls(animeContainer, 'ANIME');
    const mangaContainer = this.containerEl.querySelector('[data-media-type="MANGA"]');
    if (mangaContainer) this.renderCustomUrls(mangaContainer, 'MANGA');
    const movieTvContainer = this.containerEl.querySelector('[data-media-type="MOVIE_TV"]');
    if (movieTvContainer) this.renderCustomUrls(movieTvContainer, 'MOVIE_TV');
  }
}

export { ZoroSettingTab };