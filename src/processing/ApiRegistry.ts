// ApiRegistry.ts - Manages API instances and validates operations

import { 
  ApiSource, 
  OperationType, 
  ApiInstance, 
  ZoroPlugin,
  OperationMap 
} from './ProcessorTypes';

export class ApiRegistry {
  private plugin: ZoroPlugin;
  private apiRegistry: Map<ApiSource, ApiInstance>;

  private readonly operationMap: OperationMap = {
    'anilist': ['stats', 'search', 'single', 'list', 'trending'],
    'mal': ['stats', 'search', 'single', 'list', 'trending'],
    'simkl': ['stats', 'search', 'single', 'list', 'trending']
  };

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
    this.apiRegistry = new Map();
    this.initializeApis();
  }

  private initializeApis(): void {
    if (this.plugin.api) {
      this.apiRegistry.set('anilist', this.plugin.api);
    }
    
    if (this.plugin.malApi) {
      this.apiRegistry.set('mal', this.plugin.malApi);
    }
    
    if (this.plugin.simklApi) {
      this.apiRegistry.set('simkl', this.plugin.simklApi);
    }
  }

  getApiInstance(source: ApiSource): ApiInstance {
    const normalizedSource = source?.toLowerCase() as ApiSource;
    
    if (!this.apiRegistry.has(normalizedSource)) {
      const availableSources = Array.from(this.apiRegistry.keys()).join(', ');
      throw new Error(`❌ Unsupported API source: ${source}. Available sources: ${availableSources}`);
    }
    
    return this.apiRegistry.get(normalizedSource)!;
  }

  getSupportedOperations(source: ApiSource): OperationType[] {
    return this.operationMap[source?.toLowerCase()] || [];
  }

  validateOperation(source: ApiSource, operation: OperationType): void {
    const supportedOps = this.getSupportedOperations(source);
    
    if (!supportedOps.includes(operation)) {
      throw new Error(`❌ Operation '${operation}' is not supported by ${source.toUpperCase()}. Supported operations: ${supportedOps.join(', ')}`);
    }
  }

  isApiAvailable(source: ApiSource): boolean {
    return this.apiRegistry.has(source);
  }

  getAvailableSources(): ApiSource[] {
    return Array.from(this.apiRegistry.keys());
  }
}