// RenderingCoordinator.ts - Coordinates rendering operations

import { 
  ProcessorConfig, 
  ProcessorData, 
  ZoroPlugin, 
  SkeletonMap,
  SearchInterface,
  TrendingOperation,
  MediaEntry,
  UserStats
} from './ProcessorTypes';

export class RenderingCoordinator {
  private plugin: ZoroPlugin;

  private readonly skeletonMap: SkeletonMap = {
    'stats': () => this.plugin.render.createStatsSkeleton(),
    'single': () => this.plugin.render.createListSkeleton(1),
    'trending': () => this.plugin.render.createListSkeleton(),
    'search': () => this.plugin.render.createListSkeleton(),
    'list': () => this.plugin.render.createListSkeleton()
  };

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
  }

  createSkeleton(config: ProcessorConfig): HTMLElement {
    const createSkeletonFn = this.skeletonMap[config.type];
    if (!createSkeletonFn) {
      return this.plugin.render.createListSkeleton();
    }

    return createSkeletonFn();
  }

  async renderData(el: HTMLElement, data: ProcessorData, config: ProcessorConfig): Promise<void> {
    const { type } = config;

    try {
      switch (type) {
        case 'stats':
          this.plugin.render.renderUserStats(el, data as UserStats, { 
            mediaType: config.mediaType || 'ANIME', 
            layout: config.layout || 'enhanced' 
          });
          break;

        case 'search':
          if ((data as SearchInterface).isSearchInterface) {
            await this.plugin.render.renderSearchInterface(el, (data as SearchInterface).config);
          } else {
            const searchData = data as any;
            this.plugin.render.renderSearchResults(el, searchData.Page?.media || [], config);
          }
          break;

        case 'single':
          this.plugin.render.renderSingleMedia(el, data as MediaEntry, config);
          break;

        case 'list':
          this.plugin.render.renderMediaList(el, data as MediaEntry[], config);
          break;

        case 'trending':
          await this.handleTrendingRender(el, data, config);
          break;

        default:
          throw new Error(`❌ Unknown rendering type: ${type}`);
      }
    } catch (error) {
      console.error('[RenderingCoordinator] Render data failed:', error);
      throw new Error(`❌ Rendering failed: ${(error as Error).message}`);
    }
  }

  private async handleTrendingRender(el: HTMLElement, data: ProcessorData, config: ProcessorConfig): Promise<void> {
    if (Array.isArray(data)) {
      console.log(`[RenderingCoordinator] Rendering trending data: ${data.length} items`);
      this.plugin.render.renderSearchResults(el, data, {
        layout: config.layout || 'card',
        mediaType: config.mediaType || 'ANIME',
        source: config.source,
        type: 'trending'
      });
    } else if ((data as TrendingOperation).isTrendingOperation) {
      console.log('[RenderingCoordinator] Using fallback trending render method');
      const { Trending } = await import('../features/Trending.js');
      const trending = new Trending(this.plugin);
      await trending.renderTrendingBlock(el, (data as TrendingOperation).config);
    } else {
      throw new Error('Invalid trending data format received');
    }
  }
}