// OperationExecutors.ts - Individual operation handlers

import { 
  ProcessorConfig, 
  ApiInstance, 
  ProcessorData, 
  UserStats,
  SearchInterface,
  MediaEntry,
  MediaListCollection,
  ZoroPlugin
} from './ProcessorTypes';
import { DataProcessor } from './DataProcessor';

export abstract class BaseOperationExecutor {
  protected dataProcessor: DataProcessor;

  constructor(dataProcessor: DataProcessor) {
    this.dataProcessor = dataProcessor;
  }

  abstract execute(api: ApiInstance, config: ProcessorConfig): Promise<ProcessorData>;
}

export class StatsOperationExecutor extends BaseOperationExecutor {
  async execute(api: ApiInstance, config: ProcessorConfig): Promise<UserStats> {
    let data: any;

    if (config.source === 'mal') {
      const response = await api.fetchMALData?.({ ...config, type: 'stats' });
      data = response?.User || response;
    } else if (config.source === 'simkl') {
      const response = await api.fetchSimklData?.({ ...config, type: 'stats' });
      data = response?.User || response;
    } else {
      const response = await api.fetchAniListData?.(config);
      data = response?.User || response;
    }

    return this.dataProcessor.injectMetadata(data, config);
  }
}

export class SearchOperationExecutor extends BaseOperationExecutor {
  async execute(api: ApiInstance, config: ProcessorConfig): Promise<SearchInterface> {
    return { isSearchInterface: true, config };
  }
}

export class SingleOperationExecutor extends BaseOperationExecutor {
  async execute(api: ApiInstance, config: ProcessorConfig): Promise<MediaEntry> {
    if (!config.mediaId && !config.externalIds) {
      throw new Error('❌ Media ID or externalIds is required for single media view');
    }

    let data: any;

    if (config.source === 'mal') {
      const response = await api.fetchMALData?.({ ...config, type: 'item' });
      const media = response?.Media;
      data = media ? { id: null, status: null, score: null, progress: 0, media } : null;
    } else if (config.source === 'simkl') {
      const response = await api.fetchSimklData?.({ ...config, type: 'single' });
      data = response?.MediaList;
    } else {
      const response = await api.fetchAniListData?.({ ...config, type: 'single' });
      const media = response?.Media;
      data = media ? { id: null, status: null, score: null, progress: 0, media } : null;
    }

    return this.dataProcessor.injectMetadata(data, config);
  }
}

export class ListOperationExecutor extends BaseOperationExecutor {
  async execute(api: ApiInstance, config: ProcessorConfig): Promise<MediaEntry[]> {
    let response: MediaListCollection;

    if (config.source === 'mal') {
      response = await api.fetchMALData?.({ ...config, type: 'list' });
    } else if (config.source === 'simkl') {
      response = await api.fetchSimklData?.({ ...config, type: 'list' });
    } else {
      response = await api.fetchAniListData?.({ ...config, type: 'list' });
    }

    const entries = response?.MediaListCollection?.lists?.flatMap(l => l.entries) || [];
    return this.dataProcessor.injectMetadata(entries, config);
  }
}

export class TrendingOperationExecutor extends BaseOperationExecutor {
  private plugin: ZoroPlugin;

  constructor(dataProcessor: DataProcessor, plugin: ZoroPlugin) {
    super(dataProcessor);
    this.plugin = plugin;
  }

  async execute(api: ApiInstance | null, config: ProcessorConfig): Promise<MediaEntry[]> {
    // Import Trending class dynamically to avoid circular dependencies
    const { Trending } = await import('../features/Trending.js');
    const trending = new Trending(this.plugin);
    
    const data = await trending.fetchTrending(
      config.source, 
      config.mediaType, 
      config.limit || 40
    );
    
    return this.dataProcessor.injectTrendingMetadata(data, config);
  }
}

export class OperationExecutorFactory {
  private dataProcessor: DataProcessor;
  private plugin: ZoroPlugin;

  constructor(dataProcessor: DataProcessor, plugin: ZoroPlugin) {
    this.dataProcessor = dataProcessor;
    this.plugin = plugin;
  }

  createExecutor(operationType: string): BaseOperationExecutor {
    switch (operationType) {
      case 'stats':
        return new StatsOperationExecutor(this.dataProcessor);
      case 'search':
        return new SearchOperationExecutor(this.dataProcessor);
      case 'single':
        return new SingleOperationExecutor(this.dataProcessor);
      case 'list':
        return new ListOperationExecutor(this.dataProcessor);
      case 'trending':
        return new TrendingOperationExecutor(this.dataProcessor, this.plugin);
      default:
        throw new Error(`❌ Unknown operation type: ${operationType}`);
    }
  }
}