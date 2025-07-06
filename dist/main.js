/**
 * ANIList Integration Obsidian Plugin
 * Fixed version with proper TypeScript types and error handling
 */
import { Plugin } from 'obsidian';
import { AniListSettingTab } from './settings';
import { AniListAPI } from './api';

interface AniListSettings {
    username: string;
    defaultListType: string;
    showImages: boolean;
    showRatings: boolean;
    showProgress: boolean;
    cardLayout: boolean;
}

interface AniListConfig {
    username: string;
    listType: string;
    showImages: boolean;
    showRatings: boolean;
    showProgress: boolean;
    [key: string]: any;
}

const DEFAULT_SETTINGS: AniListSettings = {
    username: '',
    defaultListType: 'CURRENT',
    showImages: true,
    showRatings: true,
    showProgress: true,
    cardLayout: true,
};

export default class AniListPlugin extends Plugin {
    settings: AniListSettings;
    api: AniListAPI;

    async onload() {
        await this.loadSettings();
        this.api = new AniListAPI();
        this.addSettingTab(new AniListSettingTab(this.app, this));

        // Register processors
        this.registerMarkdownCodeBlockProcessor('anilist', this.processAniListBlock.bind(this));
        this.registerMarkdownPostProcessor(this.processInlineAniList.bind(this));
        
        console.log('AniList plugin loaded');
    }

    async processAniListBlock(source: string, el: HTMLElement, ctx: any) {
        try {
            const config = this.parseConfig(source);
            
            // Validate required fields
            if (!config.username) {
                throw new Error('Username is required');
            }
            
            const data = await this.api.getUserList(config.username, config.listType);
            
            // Validate API response
            if (!data?.data?.MediaListCollection?.lists?.[0]?.entries) {
                throw new Error('Invalid API response or empty list');
            }
            
            el.empty();
            el.addClass('anilist-container');
            
            if (this.settings.cardLayout) {
                this.renderCardLayout(el, data, config);
            } else {
                this.renderListLayout(el, data, config);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            el.createEl('span', {
                text: `[AniList Error: ${msg}]`,
                cls: 'anilist-error',
            });
            console.error('AniList plugin error:', e);
        }
    }

    async processInlineAniList(el: HTMLElement, ctx: any) {
        const inlineRegex = /!\[\[anilist:([^\/]+)\/(\w+)(?:\/(\d+))?\]\]/g;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let node: Node | null;
        
        while ((node = walker.nextNode())) {
            if (inlineRegex.test(node.textContent || '')) {
                textNodes.push(node as Text);
            }
        }

        for (const textNode of textNodes) {
            const text = textNode.textContent || '';
            const matches = Array.from(text.matchAll(inlineRegex));
            if (!matches.length) continue;

            const frag = document.createDocumentFragment();
            let lastIndex = 0;

            for (const match of matches) {
                if (match.index !== undefined && match.index > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                const inlineEl = document.createElement('span');
                inlineEl.addClass('anilist-inline');
                const [, username, type, id] = match;

                if (id) {
                    await this.renderInlineMedia(inlineEl, username, type, parseInt(id));
                } else {
                    await this.renderInlineList(inlineEl, username, type);
                }

                frag.appendChild(inlineEl);
                lastIndex = (match.index || 0) + match[0].length;
            }

            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            textNode.parentNode?.replaceChild(frag, textNode);
        }
    }

    parseConfig(source: string): AniListConfig {
        const config: AniListConfig = {
            username: this.settings.username,
            listType: this.settings.defaultListType,
            showImages: this.settings.showImages,
            showRatings: this.settings.showRatings,
            showProgress: this.settings.showProgress,
        };

        source.split('\n').forEach((line) => {
            const [key, value] = line
                .split(':')
                .map((s) => s.trim());
            
            if (key && value !== undefined) {
                // Safe property assignment
                if (key in config) {
                    (config as any)[key] = value;
                }
            }
        });

        return config;
    }

    renderCardLayout(container: HTMLElement, data: any, config: AniListConfig) {
        const grid = container.createEl('div', {
            cls: 'anilist-grid',
        });

        const entries = data.data.MediaListCollection.lists[0].entries;
        if (!entries || entries.length === 0) {
            container.createEl('div', {
                text: 'No entries found',
                cls: 'anilist-empty',
            });
            return;
        }

        for (const entry of entries) {
            const card = grid.createEl('div', {
                cls: 'anilist-card',
            });

            if (config.showImages && entry.media?.coverImage?.medium) {
                const img = card.createEl('img', {
                    cls: 'anilist-cover',
                });
                img.src = entry.media.coverImage.medium;
                img.alt = entry.media.title?.romaji || 'Cover image';
            }

            const content = card.createEl('div', {
                cls: 'anilist-content',
            });

            content.createEl('h3', {
                text: entry.media?.title?.romaji || 'Unknown title',
                cls: 'anilist-title',
            });

            if (config.showProgress && entry.progress) {
                const prog = content.createEl('div', {
                    cls: 'anilist-progress',
                });
                prog.createEl('span', {
                    text: `Progress: ${entry.progress}`,
                });
                if (entry.media?.episodes) {
                    prog.createEl('span', {
                        text: ` / ${entry.media.episodes}`,
                    });
                }
            }

            if (config.showRatings && entry.score) {
                content.createEl('div', {
                    text: `Rating: ${entry.score}/10`,
                    cls: 'anilist-rating',
                });
            }

            if (entry.media?.genres && entry.media.genres.length) {
                const genres = content.createEl('div', {
                    cls: 'anilist-genres',
                });
                entry.media.genres.forEach((g: string) => {
                    genres.createEl('span', {
                        text: g,
                        cls: 'anilist-genre-tag',
                    });
                });
            }
        }
    }

    renderListLayout(container: HTMLElement, data: any, config: AniListConfig) {
        const table = container.createEl('table', {
            cls: 'anilist-table',
        });

        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        headerRow.createEl('th', { text: 'Title' });
        if (config.showProgress) headerRow.createEl('th', { text: 'Progress' });
        if (config.showRatings) headerRow.createEl('th', { text: 'Rating' });
        headerRow.createEl('th', { text: 'Status' });

        const tbody = table.createEl('tbody');
        const entries = data.data.MediaListCollection.lists[0].entries;
        
        for (const entry of entries) {
            const row = tbody.createEl('tr');

            const titleCell = row.createEl('td');
            titleCell.createEl('a', {
                text: entry.media?.title?.romaji || 'Unknown title',
                href: entry.media?.siteUrl || '#',
                cls: 'anilist-link',
            });

            if (config.showProgress) {
                const p = entry.media?.episodes
                    ? `${entry.progress || 0}/${entry.media.episodes}`
                    : entry.progress?.toString() || '-';
                row.createEl('td', { text: p });
            }

            if (config.showRatings) {
                row.createEl('td', {
                    text: entry.score ? `${entry.score}/10` : '-',
                });
            }

            row.createEl('td', {
                text: entry.status || 'Unknown',
                cls: 'anilist-status',
            });
        }
    }

    async renderInlineMedia(container: HTMLElement, username: string, type: string, id: number) {
        try {
            const data = await this.api.getMediaById(id);
            const media = data.data.Media;

            const link = container.createEl('a', {
                text: media.title?.romaji || 'Unknown title',
                href: media.siteUrl || '#',
                cls: 'anilist-inline-link',
            });

            if (media.coverImage?.medium) {
                link.style.backgroundImage = `url(${media.coverImage.medium})`;
                link.addClass('anilist-inline-with-image');
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            container.createEl('span', {
                text: `[AniList Error: ${msg}]`,
                cls: 'anilist-error',
            });
        }
    }

    async renderInlineList(container: HTMLElement, username: string, type: string) {
        try {
            const data = await this.api.getUserStats(username);
            const stats = data.data.User.statistics.anime;

            container.createEl('span', {
                text: `${username}'s anime: ${stats.count} watched, ${stats.minutesWatched} minutes`,
                cls: 'anilist-inline-stats',
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            container.createEl('span', {
                text: `[AniList Error: ${msg}]`,
                cls: 'anilist-error',
            });
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) || {});
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
