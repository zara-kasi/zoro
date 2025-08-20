const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, setIcon } = require('obsidian');

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
    const Theme = section('🌓 Theme');
    const More = section('✨  More');
    const Shortcut = section('🚪 Shortcut');
    const Data = section('💾 Data');
    const Cache = section('🔁 Cache');
    const Exp = section('🚧 Beta');
    const About = section('ℹ️ About');

    new Setting(Account)
      .setName('🆔 Public profile')
      .setDesc("View your AniList profile and stats — no login needed.")
      .addText(text => text
        .setPlaceholder('AniList username')
        .setValue(this.plugin.settings.defaultUsername)
        .onChange(async (value) => {
          this.plugin.settings.defaultUsername = value.trim();
          await this.plugin.saveSettings();
        }));

    const authSetting = new Setting(Account)
  .setName('✳️ AniList')
  .setDesc('Lets you peek at your private profile and actually change stuff.');

const authDescEl = authSetting.descEl;
authDescEl.createEl('br');
const authLinkEl = authDescEl.createEl('a', {
  text: 'Guide 📖',
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
  .setDesc('Lets you edit and view your MAL entries.');

// Add the documentation link after the description
const descEl = malAuthSetting.descEl;
descEl.createEl('br');
const linkEl = descEl.createEl('a', {
  text: 'Guide 📖',
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
.setDesc('Auto-insert cover, rating, and details in new notes')
  .addToggle(toggle => toggle
    .setValue(this.plugin.settings.insertCodeBlockOnNote)
    .onChange(async (value) => {
      this.plugin.settings.insertCodeBlockOnNote = value;
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
      .setDesc('Number of columns in card grid layout')
      .addSlider(slider => slider
        .setLimits(1, 6, 1)
        .setValue(this.plugin.settings.gridColumns)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.gridColumns = value;
          await this.plugin.saveSettings();
          this.updateGridColumns(value);
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
        
        new Setting(Shortcut)
  .setName(' Open on site')
  .setDesc('Adds a customizable external-link button to the More Details panel that opens a site-specific search for the current title.')
  .addButton(button => button
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
  .setName('🔧 Auto-Format Search URLs')
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
  text: 'Guide 📖',
  href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/export-doc.md'
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
      
  
    new Setting(Theme)
      .setName('🎨 Apply')
      .setDesc('Choose from available themes')
      .addDropdown(async dropdown => {
        dropdown.addOption('', 'Default');
        const localThemes = await this.plugin.theme.getAvailableThemes();
        localThemes.forEach(t => dropdown.addOption(t, t));
        dropdown.setValue(this.plugin.settings.theme || '');
        dropdown.onChange(async name => {
          this.plugin.settings.theme = name;
          await this.plugin.saveSettings();
          await this.plugin.theme.applyTheme(name);
        });
      });

    new Setting(Theme)
  .setName('📥 Download')
  .setDesc('Download themes from GitHub repository')
  .addDropdown(dropdown => {
    dropdown.addOption('', 'Select');
    
    this.plugin.theme.fetchRemoteThemes().then(remoteThemes => {
      remoteThemes.forEach(t => dropdown.addOption(t, t));
    });
    
    dropdown.onChange(async name => {
      if (!name) return;
      
      const success = await this.plugin.theme.downloadTheme(name);
      if (success) {
        // Auto-apply the downloaded theme
        this.plugin.settings.theme = name;
        await this.plugin.saveSettings();
        await this.plugin.theme.applyTheme(name);
        
        // Refresh the Apply dropdown to show the new theme
        this.display();
      }
      dropdown.setValue('');
    });
  });

    new Setting(Theme)
      .setName('🗑 Delete')
      .setDesc('Remove downloaded themes from local storage')
      .addDropdown(async dropdown => {
        dropdown.addOption('', 'Select');
        const localThemes = await this.plugin.theme.getAvailableThemes();
        localThemes.forEach(t => dropdown.addOption(t, t));
        
        dropdown.onChange(async name => {
          if (!name) return;
          
          const success = await this.plugin.theme.deleteTheme(name);
          if (success) {
            // If deleted theme was currently active, remove it
            if (this.plugin.settings.theme === name) {
              this.plugin.settings.theme = '';
              await this.plugin.saveSettings();
              await this.plugin.theme.applyTheme('');
            }
          }
          dropdown.setValue('');
        });
      });
      
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
      

    const simklAuthSetting = new Setting(Exp)
      .setName('🎬 SIMKL')
      .setDesc('Track and sync your anime/movie/TV show progress with SIMKL.');

    simklAuthSetting.addButton(btn => {
      this.simklAuthButton = btn;
      this.updateSimklAuthButton();
      btn.onClick(async () => {
        await this.handleSimklAuthButtonClick();
      });
    });
    
    new Setting(Exp)
      .setName('Default API Source')
      .setDesc('Choose which API to use by default when no source is specified in code blocks')
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
        
        new Setting(Exp)
    .setName('TMDb API Key')
    .setDesc(
      createFragment((frag) => {
        frag.appendText('Your The Movie Database (TMDb) API key for trending movies & TV shows. ');
        const link = frag.createEl('a', {
          text: 'Get one free at TMDb',
          href: 'https://www.themoviedb.org/settings/api'
        });
        link.setAttr('target', '_blank');
        frag.appendText('.');
      })
    )
    .addText(text => text
      .setPlaceholder('Enter your TMDb API key...')
      .setValue(this.plugin.settings.tmdbApiKey)
      .onChange(async (value) => {
        this.plugin.settings.tmdbApiKey = value.trim();
        await this.plugin.saveSettings();
      })
    );

  


    new Setting(About)
      .setName('Author')
      .setDesc(this.plugin.manifest.author);
    new Setting(About)
      .setName('Version')
      .setDesc(this.plugin.manifest.version);
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
      grid.style.setProperty('--zoro-grid-columns', String(value));
      grid.style.setProperty('--grid-cols', String(value));
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
  
  // Input container with flexbox layout
  const inputContainer = urlDiv.createDiv('url-input-container');
  
  // Display URL or template data
  let displayValue = url;
  let placeholder = 'https://example.com/search?q=';
  
  // Check if this is a learned template
  if (url.startsWith('{') && url.endsWith('}')) {
    try {
      const templateData = JSON.parse(url);
      if (templateData.originalUrl) {
        displayValue = templateData.originalUrl;
        placeholder = 'Learned template from example';
      }
    } catch (e) {
      // If parsing fails, use original URL
    }
  }
  
  const input = inputContainer.createEl('input', {
    type: 'text',
    placeholder: placeholder,
    value: displayValue,
    cls: 'custom-url-input'
  });
  
  // Remove button inside the input container
  const removeBtn = inputContainer.createEl('button', {
    text: '×',
    cls: 'url-remove-button-inside'
  });
  
  // Auto-format on input (only if enabled)
  input.addEventListener('input', async (e) => {
    const newValue = e.target.value;
    const updated = await this.plugin.moreDetailsPanel.customExternalURL.updateUrl(mediaType, index, newValue);
    
    // Show feedback based on auto-formatting setting
    if (this.plugin.settings.autoFormatSearchUrls) {
      const formatted = this.plugin.moreDetailsPanel.customExternalURL.formatSearchUrl(newValue);
      if (formatted !== newValue && formatted) {
        input.title = `Auto-formatted: ${formatted}`;
      } else {
        input.title = '';
      }
    } else {
      // Check if this could be a template
      if (newValue.toLowerCase().includes('zoro')) {
        const template = this.plugin.moreDetailsPanel.customExternalURL.learnTemplateFromExample(newValue, 'zoro zoro');
        if (template) {
          input.title = `Template learned! Pattern: "${template.spacePattern}"`;
        } else {
          // Try basic template extraction
          const basicTemplate = this.plugin.moreDetailsPanel.customExternalURL.extractBasicTemplate(newValue);
          if (basicTemplate) {
            input.title = `Basic template extracted! Pattern: "${basicTemplate.spacePattern}"`;
          } else {
            input.title = 'Auto-formatting disabled - using exact URL';
          }
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
  
  // Preview domain name
  if (url && url.trim()) {
    const preview = urlDiv.createDiv('url-preview');
    const domainName = this.plugin.moreDetailsPanel.customExternalURL.extractDomainName(url);
    preview.textContent = `Preview: ${domainName}`;
  }
  
  }

updateGridColumns(value) {
const gridElements = document.querySelectorAll('.zoro-cards-grid');
gridElements.forEach(grid => {
  try {
    grid.style.setProperty('--zoro-grid-columns', String(value));
    grid.style.setProperty('--grid-cols', String(value));
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

// Input container with flexbox layout
const inputContainer = urlDiv.createDiv('url-input-container');

// Display URL or template data
let displayValue = url;
let placeholder = 'https://example.com/search?q=';

// Check if this is a learned template
if (url.startsWith('{') && url.endsWith('}')) {
  try {
    const templateData = JSON.parse(url);
    if (templateData.originalUrl) {
      displayValue = templateData.originalUrl;
      placeholder = 'Learned template from example';
    }
  } catch (e) {
    // If parsing fails, use original URL
  }
}

const input = inputContainer.createEl('input', {
  type: 'text',
  placeholder: placeholder,
  value: displayValue,
  cls: 'custom-url-input'
});

// Remove button inside the input container
const removeBtn = inputContainer.createEl('button', {
  text: '×',
  cls: 'url-remove-button-inside'
});

// Auto-format on input (only if enabled)
input.addEventListener('input', async (e) => {
  const newValue = e.target.value;
  const updated = await this.plugin.moreDetailsPanel.customExternalURL.updateUrl(mediaType, index, newValue);
  
  // Show feedback based on auto-formatting setting
  if (this.plugin.settings.autoFormatSearchUrls) {
    const formatted = this.plugin.moreDetailsPanel.customExternalURL.formatSearchUrl(newValue);
    if (formatted !== newValue && formatted) {
      input.title = `Auto-formatted: ${formatted}`;
    } else {
      input.title = '';
    }
  } else {
    // Check if this could be a template
    if (newValue.toLowerCase().includes('zoro')) {
      const template = this.plugin.moreDetailsPanel.customExternalURL.learnTemplateFromExample(newValue, 'zoro zoro');
      if (template) {
        input.title = `Template learned! Pattern: "${template.spacePattern}"`;
      } else {
        // Try basic template extraction
        const basicTemplate = this.plugin.moreDetailsPanel.customExternalURL.extractBasicTemplate(newValue);
        if (basicTemplate) {
          input.title = `Basic template extracted! Pattern: "${basicTemplate.spacePattern}"`;
        } else {
          input.title = 'Auto-formatting disabled - using exact URL';
        }
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

// Preview domain name
if (url && url.trim()) {
  const preview = urlDiv.createDiv('url-preview');
  const domainName = this.plugin.moreDetailsPanel.customExternalURL.extractDomainName(url);
  preview.textContent = `Preview: ${domainName}`;
}
}

refreshCustomUrlSettings() {
// Refresh anime URLs
const animeContainer = this.containerEl.querySelector('[data-media-type="ANIME"]');
if (animeContainer) {
  this.renderCustomUrls(animeContainer, 'ANIME');
}

// Refresh manga URLs  
const mangaContainer = this.containerEl.querySelector('[data-media-type="MANGA"]');
if (mangaContainer) {
  this.renderCustomUrls(mangaContainer, 'MANGA');
}

// Refresh movie/TV URLs
const movieTvContainer = this.containerEl.querySelector('[data-media-type="MOVIE_TV"]');
if (movieTvContainer) {
  this.renderCustomUrls(movieTvContainer, 'MOVIE_TV');
}
}
}

module.exports = { ZoroSettingTab };