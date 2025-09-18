import type { App, Plugin } from 'obsidian';
import { PluginSettingTab, Setting, Notice, setIcon, ButtonComponent, TextComponent, DropdownComponent, ToggleComponent } from 'obsidian';
import { AuthModal } from '../auth/AuthModal';
import { GRID_COLUMN_OPTIONS, GRID_COLUMN_LABELS } from '../core/constants';

// Type definitions for plugin components
interface ZoroPlugin extends Plugin {
  app: App; // Add explicit app property
  settings: ZoroSettings;
  auth: AuthService;
  malAuth: AuthService;
  simklAuth: AuthService;
  sample: SampleService;
  cache: CacheService;
  export: ExportService;
  moreDetailsPanel: MoreDetailsPanel;
  saveSettings(): Promise<void>;
  manifest: {
    author: string;
    version: string;
  };
}

interface ZoroSettings {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  malClientId?: string;
  malClientSecret?: string;
  malAccessToken?: string;
  simklClientId?: string;
  simklClientSecret?: string;
  simklAccessToken?: string;
  defaultApiSource: string;
  defaultApiUserOverride: boolean;
  notePath?: string;
  insertCodeBlockOnNote: boolean;
  customPropertyNames?: {
    title?: string;
    aliases?: string;
    format?: string;
    status?: string;
    rating?: string;
    favorite?: string;
    total_episodes?: string;
    total_chapters?: string;
    episodes_watched?: string;
    chapters_read?: string;
    volumes_read?: string;
    cover?: string;
    genres?: string;
  };
  defaultLayout: string;
  gridColumns: string | number; // Legacy support for numeric values
  defaultUsername: string;
  showLoadingIcon: boolean;
  hideUrlsInTitles: boolean;
  showCoverImages: boolean;
  showRatings: boolean;
  showProgress: boolean;
  showGenres: boolean;
  forceScoreFormat: boolean;
  customSearchUrls?: {
    [mediaType: string]: string[];
  };
  autoFormatSearchUrls: boolean;
  theme?: string;
  tmdbApiKey?: string;
}

interface AuthService {
  isLoggedIn: boolean;
  loginWithFlow(): Promise<void>;
  logout(): Promise<void>;
  forceScoreFormat(): Promise<void>;
}

interface SampleService {
  createSampleFolders(): Promise<void>;
}

interface CacheService {
  getStats(): CacheStats;
  clearAll(): Promise<number>;
}

interface CacheStats {
  hitRate: string;
  cacheSize: number;
  hits: number;
  misses: number;
}

interface ExportService {
  exportUnifiedListsToCSV(): Promise<void>;
  exportMALListsToCSV(): Promise<void>;
  exportSimklListsToCSV(): Promise<void>;
}

interface MoreDetailsPanel {
  customExternalURL: CustomExternalURLService;
}

interface CustomExternalURLService {
  addUrl(mediaType: string): Promise<void>;
  updateUrl(mediaType: string, index: number, value: string): Promise<void>;
  removeUrl(mediaType: string, index: number): Promise<void>;
  formatSearchUrl(url: string): string;
  learnTemplateFromExample(url: string, example: string): { spacePattern: string } | null;
  extractBasicTemplate(url: string): { spacePattern: string } | null;
  extractDomainName(url: string): string;
}

// Extended Setting interface to include descEl property
interface ExtendedSetting extends Setting {
  descEl: HTMLElement;
}

// Extended ButtonComponent interface for methods that may not be in the official types
interface ExtendedButtonComponent extends ButtonComponent {
  setCta?(): this;
  removeCta?(): this;
  setWarning?(): this;
  setClass?(cls: string): this;
  setDisabled?(disabled: boolean): this;
}

// Extended TextComponent interface for setPlaceholder method
interface ExtendedTextComponent extends TextComponent {
  setPlaceholder?(placeholder: string): this;
}

// Extended HTMLElement interfaces for type safety
interface SafeHTMLElement extends HTMLElement {
  createDiv(options?: string | { cls?: string; attr?: Record<string, string> }): HTMLDivElement;
  createEl<K extends keyof HTMLElementTagNameMap>(tagName: K, options?: { cls?: string; attr?: Record<string, string>; text?: string }): HTMLElementTagNameMap[K];
  empty(): void;
}

export class ZoroSettingTab extends PluginSettingTab {
  app: App; // Explicit app property declaration
  private plugin: ZoroPlugin;
  private authButton?: ExtendedButtonComponent;
  private malAuthButton?: ExtendedButtonComponent;
  private simklAuthButton?: ExtendedButtonComponent;

  constructor(app: App, plugin: ZoroPlugin) {
    super(app, plugin);
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const safeContainerEl = containerEl as SafeHTMLElement;
    safeContainerEl.empty();

    const section = (title: string, startOpen: boolean = false): HTMLElement => {
      const head = safeContainerEl.createEl('h2', { text: title });
      head.style.cursor = 'pointer';
      head.style.userSelect = 'none';
      head.style.margin = '1.2em 0 0.4em 0';
      const body = safeContainerEl.createDiv() as SafeHTMLElement;
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
    const Exp = section('⚠️ Beta');
    const About = section('ℹ️ About');

    // AniList Authentication
    const authSetting = new Setting(Account)
      .setName('✳️ AniList')
      .setDesc('Connect your AniList account to manage your anime and manga lists.') as ExtendedSetting;

    const authDescEl = authSetting.descEl;
    authDescEl.createEl('br');
    const authLinkEl = authDescEl.createEl('a', {
      text: 'Guide 📖',
      href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md'
    });
    authLinkEl.setAttr('target', '_blank');
    authLinkEl.setAttr('rel', 'noopener noreferrer');
    authLinkEl.style.textDecoration = 'none';

    authSetting.addButton((button: ButtonComponent) => {
      this.authButton = button as ExtendedButtonComponent;
      this.updateAuthButton();
      button.onClick(async () => {
        await this.handleAuthButtonClick();
      });
    });

    // MyAnimeList Authentication
    const malAuthSetting = new Setting(Account)
      .setName('🗾 MyAnimeList')
      .setDesc('Connect your MAL account to manage your anime and manga lists') as ExtendedSetting;

    const descEl = malAuthSetting.descEl;
    descEl.createEl('br');
    const linkEl = descEl.createEl('a', {
      text: 'Guide 📖',
      href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/mal-auth-setup.md'
    });
    linkEl.setAttr('target', '_blank');
    linkEl.setAttr('rel', 'noopener noreferrer');
    linkEl.style.textDecoration = 'none';

    malAuthSetting.addButton((btn: ButtonComponent) => {
      this.malAuthButton = btn as ExtendedButtonComponent;
      this.updateMALAuthButton();
      btn.onClick(async () => {
        await this.handleMALAuthButtonClick();
      });
    });

    // SIMKL Authentication
    const simklAuthSetting = new Setting(Account)
      .setName('🎬 SIMKL')
      .setDesc('Connect your SIMKL account to manage your anime, movies, and TV shows.') as ExtendedSetting;

    const simklDescEl = simklAuthSetting.descEl;
    simklDescEl.createEl('br');
    const simklLinkEl = simklDescEl.createEl('a', {
      text: 'Guide 📖',
      href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/simkl-auth-setup.md'
    });
    simklLinkEl.setAttr('target', '_blank');
    simklLinkEl.setAttr('rel', 'noopener noreferrer');
    simklLinkEl.style.textDecoration = 'none';

    simklAuthSetting.addButton((btn: ButtonComponent) => {
      this.simklAuthButton = btn as ExtendedButtonComponent;
      this.updateSimklAuthButton();
      btn.onClick(async () => {
        await this.handleSimklAuthButtonClick();
      });
    });

    // Setup Section
    new Setting(Setup)
      .setName('⚡ Sample Folder')
      .setDesc('Builds a complete Zoro folder structure with notes, no manual setup needed. (Recommended)')
      .addButton((button: ButtonComponent) =>
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
      .addDropdown((dropdown: DropdownComponent) => dropdown
        .addOption('anilist', 'AniList')
        .addOption('mal', 'MyAnimeList')
        .addOption('simkl', 'SIMKL')
        .setValue(this.plugin.settings.defaultApiSource)
        .onChange(async (value: string) => {
          this.plugin.settings.defaultApiSource = value;
          this.plugin.settings.defaultApiUserOverride = true;
          await this.plugin.saveSettings();
        }));

    // Note Section
    new Setting(Note)
      .setName('🗂️ Note path')
      .setDesc('Folder path where new connected notes will be created')
      .addText((text: TextComponent) => {
        const extendedText = text as ExtendedTextComponent;
        if (extendedText.setPlaceholder) {
          extendedText.setPlaceholder('folder/subfolder');
        }
        return text
          .setValue(this.plugin.settings.notePath || '')
          .onChange(async (value: string) => {
            let cleanPath = value.trim();
            if (cleanPath.startsWith('/')) {
              cleanPath = cleanPath.substring(1);
            }
            if (cleanPath.endsWith('/')) {
              cleanPath = cleanPath.substring(0, cleanPath.length - 1);
            }

            this.plugin.settings.notePath = cleanPath;
            await this.plugin.saveSettings();
          });
      });

    new Setting(Note)
      .setName('🎴 Media block')
      .setDesc('Auto-insert a code block to show cover, rating, and details in new notes')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.insertCodeBlockOnNote)
        .onChange(async (value: boolean) => {
          this.plugin.settings.insertCodeBlockOnNote = value;
          await this.plugin.saveSettings();
        }));

    // Custom Property Names
    const propertySettings = [
      { key: 'title', name: 'Title', placeholder: 'title' },
      { key: 'aliases', name: 'Aliases', placeholder: 'aliases' },
      { key: 'format', name: 'Format', placeholder: 'format' },
      { key: 'status', name: 'Status', placeholder: 'status' },
      { key: 'rating', name: 'Rating', placeholder: 'rating' },
      { key: 'favorite', name: 'Favorite', placeholder: 'favorite' },
      { key: 'total_episodes', name: 'Total episodes', placeholder: 'total_episodes' },
      { key: 'total_chapters', name: 'Total chapters', placeholder: 'total_chapters' },
      { key: 'episodes_watched', name: 'Episodes watched', placeholder: 'episodes_watched' },
      { key: 'chapters_read', name: 'Chapters read', placeholder: 'chapters_read' },
      { key: 'volumes_read', name: 'Volumes read', placeholder: 'volumes_read' },
      { key: 'cover', name: 'Cover', placeholder: 'cover' },
      { key: 'genres', name: 'Genres', placeholder: 'genres' },
    ] as const;

    propertySettings.forEach(({ key, name, placeholder }) => {
      new Setting(Note)
        .setName(name)
        .setDesc(`Frontmatter property for ${key}`)
        .addText((text: TextComponent) => {
          const extendedText = text as ExtendedTextComponent;
          if (extendedText.setPlaceholder) {
            extendedText.setPlaceholder(placeholder);
          }
          return text
            .setValue(this.plugin.settings?.customPropertyNames?.[key] ?? '')
            .onChange(async (value: string) => {
              this.plugin.settings = this.plugin.settings || {};
              this.plugin.settings.customPropertyNames = this.plugin.settings.customPropertyNames || {};
              this.plugin.settings.customPropertyNames[key] = value.trim();
              await this.plugin.saveSettings();
            });
        });
    });

    // Display Section
    new Setting(Display)
      .setName('🧊 Layout')
      .setDesc('Choose the default layout for media lists')
      .addDropdown((dropdown: DropdownComponent) => dropdown
        .addOption('card', 'Card Layout')
        .addOption('table', 'Table Layout')
        .setValue(this.plugin.settings.defaultLayout)
        .onChange(async (value: string) => {
          this.plugin.settings.defaultLayout = value;
          await this.plugin.saveSettings();
        }));

    new Setting(Display)
      .setName('🔲 Grid Columns')
      .setDesc('Choose grid layout: Default uses responsive columns, or force a specific number of columns')
      .addDropdown((dropdown: DropdownComponent) => {
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

        dropdown.onChange(async (value: string) => {
          this.plugin.settings.gridColumns = value;
          await this.plugin.saveSettings();
          this.updateGridColumns(value);
        });
      });

    // More Section
    new Setting(More)
      .setName('🆔 Public profile')
      .setDesc("View your AniList profile and stats — no login needed.")
      .addText((text: TextComponent) => {
        const extendedText = text as ExtendedTextComponent;
        if (extendedText.setPlaceholder) {
          extendedText.setPlaceholder('AniList username');
        }
        return text
          .setValue(this.plugin.settings.defaultUsername)
          .onChange(async (value: string) => {
            this.plugin.settings.defaultUsername = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(More)
      .setName('⏳ Loading Icon')
      .setDesc('Show loading animation during API requests')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.showLoadingIcon)
        .onChange(async (value: boolean) => {
          this.plugin.settings.showLoadingIcon = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🔗 Plain Titles')
      .setDesc('Show titles as plain text instead of clickable links.')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.hideUrlsInTitles)
        .onChange(async (value: boolean) => {
          this.plugin.settings.hideUrlsInTitles = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🌆 Cover')
      .setDesc('Display cover images for anime/manga')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.showCoverImages)
        .onChange(async (value: boolean) => {
          this.plugin.settings.showCoverImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('⭐ Ratings')
      .setDesc('Display user ratings/scores')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.showRatings)
        .onChange(async (value: boolean) => {
          this.plugin.settings.showRatings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('📈 Progress')
      .setDesc('Display progress information')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.showProgress)
        .onChange(async (value: boolean) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🎭 Genres')
      .setDesc('Display genre tags')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value: boolean) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));

    new Setting(More)
      .setName('🧮 Score Scale')
      .setDesc('Ensures all ratings use the 0–10 point scale.')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.forceScoreFormat)
        .onChange(async (value: boolean) => {
          this.plugin.settings.forceScoreFormat = value;
          await this.plugin.saveSettings();
          if (value && this.plugin.auth.isLoggedIn) {
            await this.plugin.auth.forceScoreFormat();
          }
        }));

    // Shortcut Section
    this.renderShortcutSection(Shortcut);

    // Data Section
    this.renderDataSection(Data);

    // Cache Section
    new Setting(Cache)
      .setName('📊 Cache Stats')
      .setDesc('Show live cache usage and hit-rate in a pop-up.')
      .addButton((btn: ButtonComponent) => btn
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
      .addButton((btn: ButtonComponent) => {
        const extendedBtn = btn as ExtendedButtonComponent;
        btn.setButtonText('Clear All Cache');
        if (extendedBtn.setWarning) {
          extendedBtn.setWarning();
        }
        btn.onClick(async () => {
          const cleared = await this.plugin.cache.clearAll();
          new Notice(`✅ Cache cleared (${cleared} entries)`, 3000);
        });
      });

    // About Section
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
      .addButton((button: ButtonComponent) => {
        const extendedButton = button as ExtendedButtonComponent;
        button.setButtonText('Open GitHub');
        if (extendedButton.setClass) {
          extendedButton.setClass('mod-cta');
        }
        button.onClick(() => {
          window.open('https://github.com/zara-kasi/zoro', '_blank');
        });
      });
  }

  private renderShortcutSection(container: HTMLElement): void {
    const shortcutSetting = new Setting(container)
      .setName(' Open on site')
      .setDesc('Adds a customizable external-link button to the More Details panel that opens a site-specific search for the current title.') as ExtendedSetting;

    // Add the documentation link after the description
    const shortcutDescEl = shortcutSetting.descEl;
    shortcutDescEl.createEl('br');
    const shortcutLinkEl = shortcutDescEl.createEl('a', {
      text: 'Guide 📖',
      href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/shortcuts.md'
    });
    shortcutLinkEl.setAttr('target', '_blank');
    shortcutLinkEl.setAttr('rel', 'noopener noreferrer');
    shortcutLinkEl.style.textDecoration = 'none';

    shortcutSetting.addButton((button: ButtonComponent) => {
      const extendedButton = button as ExtendedButtonComponent;
      button.setButtonText('Add Anime URL');
      if (extendedButton.setClass) {
        extendedButton.setClass('mod-cta');
      }
      button.onClick(async () => {
        await this.plugin.moreDetailsPanel.customExternalURL.addUrl('ANIME');
        this.refreshCustomUrlSettings();
      });
    });

    // Create container for anime URLs
    const safeContainer = container as SafeHTMLElement;
    const animeUrlContainer = safeContainer.createDiv({ cls: 'custom-url-container' }) as SafeHTMLElement;
    animeUrlContainer.setAttribute('data-media-type', 'ANIME');
    this.renderCustomUrls(animeUrlContainer, 'ANIME');

    new Setting(container)
      .addButton((button: ButtonComponent) => {
        const extendedButton = button as ExtendedButtonComponent;
        button.setButtonText('Add Manga URL');
        if (extendedButton.setClass) {
          extendedButton.setClass('mod-cta');
        }
        button.onClick(async () => {
          await this.plugin.moreDetailsPanel.customExternalURL.addUrl('MANGA');
          this.refreshCustomUrlSettings();
        });
      });

    // Create container for manga URLs
    const mangaUrlContainer = safeContainer.createDiv({ cls: 'custom-url-container' }) as SafeHTMLElement;
    mangaUrlContainer.setAttribute('data-media-type', 'MANGA');
    this.renderCustomUrls(mangaUrlContainer, 'MANGA');

    new Setting(container)
      .addButton((button: ButtonComponent) => {
        const extendedButton = button as ExtendedButtonComponent;
        button.setButtonText('Add Movie/TV URL');
        if (extendedButton.setClass) {
          extendedButton.setClass('mod-cta');
        }
        button.onClick(async () => {
          await this.plugin.moreDetailsPanel.customExternalURL.addUrl('MOVIE_TV');
          this.refreshCustomUrlSettings();
        });
      });

    // Create container for movie/TV URLs
    const movieTvUrlContainer = safeContainer.createDiv({ cls: 'custom-url-container' }) as SafeHTMLElement;
    movieTvUrlContainer.setAttribute('data-media-type', 'MOVIE_TV');
    this.renderCustomUrls(movieTvUrlContainer, 'MOVIE_TV');

    new Setting(container)
      .setName('Auto-Format')
      .setDesc('Automatically format URLs to search format. When disabled, URLs will be used exactly as entered.')
      .addToggle((toggle: ToggleComponent) => toggle
        .setValue(this.plugin.settings.autoFormatSearchUrls)
        .onChange(async (value: boolean) => {
          this.plugin.settings.autoFormatSearchUrls = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderDataSection(container: HTMLElement): void {
    const exportSetting = new Setting(container)
      .setName('📥 Export your data')
      .setDesc("Everything you've watched, rated, and maybe ghosted — neatly exported into a CSV & standard export format from AniList, MAL and Simkl.")
      .addButton((btn: ButtonComponent) => {
        const extendedBtn = btn as ExtendedButtonComponent;
        btn.setButtonText('AniList');
        if (extendedBtn.setClass) {
          extendedBtn.setClass('mod-cta');
        }
        btn.onClick(async () => {
          try {
            await this.plugin.export.exportUnifiedListsToCSV();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            new Notice(`❌ Export failed: ${message}`, 6000);
          }
        });
      }) as ExtendedSetting;

    const exportDescEl = exportSetting.descEl;
    exportDescEl.createEl('br');
    const exportLinkEl = exportDescEl.createEl('a', {
      text: 'Guide 📖',
      href: 'https://github.com/zara-kasi/zoro/blob/main/Docs/export_overview.md'
    });
    exportLinkEl.setAttr('target', '_blank');
    exportLinkEl.setAttr('rel', 'noopener noreferrer');
    exportLinkEl.style.textDecoration = 'none';

    new Setting(container)
      .addButton((btn: ButtonComponent) => {
        const extendedBtn = btn as ExtendedButtonComponent;
        btn.setButtonText('MAL');
        if (extendedBtn.setClass) {
          extendedBtn.setClass('mod-cta');
        }
        btn.onClick(async () => {
          try {
            await this.plugin.export.exportMALListsToCSV();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            new Notice(`❌ MAL export failed: ${message}`, 6000);
          }
        });
      });

    new Setting(container)
      .addButton((btn: ButtonComponent) => {
        const extendedBtn = btn as ExtendedButtonComponent;
        btn.setButtonText('SIMKL');
        if (extendedBtn.setClass) {
          extendedBtn.setClass('mod-cta');
        }
        btn.onClick(async () => {
          if (!this.plugin.simklAuth.isLoggedIn) {
            new Notice('❌ Please authenticate with SIMKL first.', 4000);
            return;
          }

          if (extendedBtn.setDisabled) {
            extendedBtn.setDisabled(true);
          }
          btn.setButtonText('Exporting...');

          try {
            await this.plugin.export.exportSimklListsToCSV();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            new Notice(`❌ SIMKL export failed: ${message}`, 6000);
          } finally {
            if (extendedBtn.setDisabled) {
              extendedBtn.setDisabled(false);
            }
            btn.setButtonText('SIMKL');
          }
        });
      });
  }

  private updateAuthButton(): void {
    if (!this.authButton) return;
    const { settings } = this.plugin;
    if (!settings.clientId) {
      this.authButton.setButtonText('Enter Client ID');
      if (this.authButton.removeCta) this.authButton.removeCta();
    } else if (!settings.clientSecret) {
      this.authButton.setButtonText('Enter Client Secret');
      if (this.authButton.removeCta) this.authButton.removeCta();
    } else if (!settings.accessToken) {
      this.authButton.setButtonText('Authenticate Now');
      if (this.authButton.setCta) this.authButton.setCta();
    } else {
      this.authButton.setButtonText('Sign Out');
      if (this.authButton.setWarning) this.authButton.setWarning();
      if (this.authButton.removeCta) this.authButton.removeCta();
    }
  }

  private async handleAuthButtonClick(): Promise<void> {
    const { settings } = this.plugin;
    if (!settings.clientId) {
      const modal = AuthModal.clientId(this.app, async (clientId: string) => {
        if (clientId?.trim()) {
          settings.clientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateAuthButton();
        }
      });
      modal.open();
    } else if (!settings.clientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret: string) => {
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

  private updateMALAuthButton(): void {
    if (!this.malAuthButton) return;
    const { settings } = this.plugin;
    if (!settings.malClientId) {
      this.malAuthButton.setButtonText('Enter Client ID');
      if (this.malAuthButton.removeCta) this.malAuthButton.removeCta();
    } else if (!settings.malClientSecret) {
      this.malAuthButton.setButtonText('Enter Client Secret');
      if (this.malAuthButton.removeCta) this.malAuthButton.removeCta();
    } else if (!settings.malAccessToken) {
      this.malAuthButton.setButtonText('Authenticate Now');
      if (this.malAuthButton.setCta) this.malAuthButton.setCta();
    } else {
      this.malAuthButton.setButtonText('Sign Out');
      if (this.malAuthButton.setWarning) this.malAuthButton.setWarning();
      if (this.malAuthButton.removeCta) this.malAuthButton.removeCta();
    }
  }

  private async handleMALAuthButtonClick(): Promise<void> {
    const { settings } = this.plugin;
    if (!settings.malClientId) {
      const modal = AuthModal.clientId(this.app, async (clientId: string) => {
        if (clientId?.trim()) {
          settings.malClientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateMALAuthButton();
        }
      });
      modal.open();
    } else if (!settings.malClientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret: string) => {
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

  private updateSimklAuthButton(): void {
    if (!this.simklAuthButton) return;
    const { settings } = this.plugin;
    if (!settings.simklClientId) {
      this.simklAuthButton.setButtonText('Enter Client ID');
      if (this.simklAuthButton.removeCta) this.simklAuthButton.removeCta();
    } else if (!settings.simklClientSecret) {
      this.simklAuthButton.setButtonText('Enter Client Secret');
      if (this.simklAuthButton.removeCta) this.simklAuthButton.removeCta();
    } else if (!settings.simklAccessToken) {
      this.simklAuthButton.setButtonText('Authenticate Now');
      if (this.simklAuthButton.setCta) this.simklAuthButton.setCta();
    } else {
      this.simklAuthButton.setButtonText('Sign Out');
      if (this.simklAuthButton.setWarning) this.simklAuthButton.setWarning();
      if (this.simklAuthButton.removeCta) this.simklAuthButton.removeCta();
    }
  }

  private async handleSimklAuthButtonClick(): Promise<void> {
    const { settings } = this.plugin;
    if (!settings.simklClientId) {
      const modal = AuthModal.clientId(this.app, async (clientId: string) => {
        if (clientId?.trim()) {
          settings.simklClientId = clientId.trim();
          await this.plugin.saveSettings();
          this.updateSimklAuthButton();
        }
      });
      modal.open();
    } else if (!settings.simklClientSecret) {
      const modal = AuthModal.clientSecret(this.app, async (clientSecret: string) => {
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

  private updateGridColumns(value: string): void {
    const gridElements = document.querySelectorAll('.zoro-cards-grid') as NodeListOf<HTMLElement>;
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
      } catch {
        // Ignore errors when updating grid styles
      }
    });
  }

  private renderCustomUrls(container: SafeHTMLElement, mediaType: string): void {
    container.empty();
    const urls = this.plugin.settings.customSearchUrls?.[mediaType] || [];
    urls.forEach((url, index) => {
      this.createUrlSetting(container, mediaType, url, index);
    });
  }

  private createUrlSetting(container: SafeHTMLElement, mediaType: string, url: string, index: number): void {
    const urlDiv = container.createDiv({ cls: 'url-setting-item' });
    const safeUrlDiv = urlDiv as SafeHTMLElement;
    const inputContainer = safeUrlDiv.createDiv({ cls: 'url-input-container' });
    const safeInputContainer = inputContainer as SafeHTMLElement;
    let displayValue = url;
    let placeholder = 'https://example.com/search?q=';
    
    if (url.startsWith('{') && url.endsWith('}')) {
      try {
        const templateData = JSON.parse(url) as { originalUrl?: string };
        if (templateData.originalUrl) {
          displayValue = templateData.originalUrl;
          placeholder = 'Learned template from example';
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    
    const input = safeInputContainer.createEl('input', {
      attr: {
        type: 'text',
        placeholder: placeholder,
        value: displayValue
      },
      cls: 'custom-url-input'
    });
    
    const removeBtn = safeInputContainer.createEl('button', {
      text: '×',
      cls: 'url-remove-button-inside'
    });
    
    input.addEventListener('input', async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const newValue = target.value;
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
      const preview = safeUrlDiv.createDiv({ cls: 'url-preview' });
      const domainName = this.plugin.moreDetailsPanel.customExternalURL.extractDomainName(url);
      preview.textContent = `Preview: ${domainName}`;
    }
  }

  private refreshCustomUrlSettings(): void {
    const safeContainerEl = this.containerEl as SafeHTMLElement;
    const animeContainer = safeContainerEl.querySelector('[data-media-type="ANIME"]') as SafeHTMLElement | null;
    if (animeContainer) this.renderCustomUrls(animeContainer, 'ANIME');
    
    const mangaContainer = safeContainerEl.querySelector('[data-media-type="MANGA"]') as SafeHTMLElement | null;
    if (mangaContainer) this.renderCustomUrls(mangaContainer, 'MANGA');
    
    const movieTvContainer = safeContainerEl.querySelector('[data-media-type="MOVIE_TV"]') as SafeHTMLElement | null;
    if (movieTvContainer) this.renderCustomUrls(movieTvContainer, 'MOVIE_TV');
  }
}