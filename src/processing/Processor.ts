// Processor.ts - Main orchestrating class (TypeScript modular version)

import { Notice } from 'obsidian';
import { 
  ProcessorConfig, 
  ProcessorData, 
  ZoroPlugin 
} from './ProcessorTypes';
import { ConfigurationManager } from './ConfigurationManager';
import { ApiRegistry } from './ApiRegistry';
import { AuthenticationResolver } from './AuthenticationResolver';
import { DataProcessor } from './DataProcessor';
import { OperationExecutorFactory } from './OperationExecutors';
import { RenderingCoordinator } from './RenderingCoordinator';

export class Processor {
  private plugin: ZoroPlugin;
  private configManager: ConfigurationManager;
  private apiRegistry: ApiRegistry;
  private authResolver: AuthenticationResolver;
  private dataProcessor: DataProcessor;
  private executorFactory: OperationExecutorFactory;
  private renderCoordinator: RenderingCoordinator;

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
    
    // Initialize all modules
    this.configManager = new ConfigurationManager(plugin);
    this.apiRegistry = new ApiRegistry(plugin);
    this.authResolver = new AuthenticationResolver(plugin);
    this.dataProcessor = new DataProcessor();
    this.executorFactory = new OperationExecutorFactory(this.dataProcessor, plugin);
    this.renderCoordinator = new RenderingCoordinator(plugin);
  }

  // Public API methods (maintaining compatibility with existing code)

  /**
   * Main entry point for processing Zoro code blocks
   */
  async processZoroCodeBlock(source: string, el: HTMLElement, ctx: any): Promise<void> {
    let config: ProcessorConfig;
    
    try {
      config = this.parseCodeBlockConfig(source);
      
      this.validateOperation(config.source, config.type);
      
      const skeleton = this.createSkeleton(config);
      el.empty();
      el.appendChild(skeleton);

      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);

      await this.executeProcessing(el, config, retryFn);

    } catch (error) {
      console.error('[Processor] Code block processing error:', error);
      el.empty();
      
      const retryFn = () => this.processZoroCodeBlock(source, el, ctx);
      this.plugin.renderError(
        el,
        (error as Error).message || 'Unknown error occurred.',
        'Code block',
        retryFn
      );
    }
  }

  /**
   * Parse code block configuration
   */
  parseCodeBlockConfig(source: string): ProcessorConfig {
    return this.configManager.parseCodeBlockConfig(source);
  }

  /**
   * Validate operation support
   */
  validateOperation(source: string, operation: string): void {
    this.apiRegistry.validateOperation(source as any, operation as any);
  }

  /**
   * Create loading skeleton
   */
  createSkeleton(config: ProcessorConfig): HTMLElement {
    return this.renderCoordinator.createSkeleton(config);
  }

  /**
   * Execute the main processing pipeline
   */
  private async executeProcessing(el: HTMLElement, config: ProcessorConfig, retryFn: () => void): Promise<void> {
    try {
      // Step 1: Resolve authentication
      const resolvedConfig = await this.authResolver.resolveAuthentication(config);
      
      // Step 2: Get API instance (if needed)
      let api = null;
      if (resolvedConfig.type !== 'trending') {
        api = this.apiRegistry.getApiInstance(resolvedConfig.source);
      }
      
      // Step 3: Execute the operation
      const data = await this.executeApiOperation(api, resolvedConfig);
      
      // Step 4: Render the data
      await this.renderCoordinator.renderData(el, data, resolvedConfig);

    } catch (error) {
      console.error('[Processor] Execute processing failed:', error);
      el.empty();
      this.plugin.renderError(el, (error as Error).message, 'Failed to load', retryFn);
      throw error;
    }
  }

  /**
   * Execute API operation using appropriate executor
   */
  private async executeApiOperation(api: any, config: ProcessorConfig): Promise<ProcessorData> {
    const { type, source } = config;

    try {
      const executor = this.executorFactory.createExecutor(type);
      return await executor.execute(api, config);
    } catch (error) {
      throw new Error(`❌ ${source.toUpperCase()} API operation failed: ${(error as Error).message}`);
    }
  }

  // Legacy compatibility methods (delegate to modules)

  /**
   * Get API instance (legacy compatibility)
   */
  getApiInstance(source: string): any {
    return this.apiRegistry.getApiInstance(source as any);
  }

  /**
   * Get supported operations (legacy compatibility)
   */
  getSupportedOperations(source: string): string[] {
    return this.apiRegistry.getSupportedOperations(source as any);
  }

  /**
   * Inject metadata (legacy compatibility)
   */
  injectMetadata(data: any, config: ProcessorConfig): any {
    return this.dataProcessor.injectMetadata(data, config);
  }

  /**
   * Render data (legacy compatibility)
   */
  async renderData(el: HTMLElement, data: ProcessorData, config: ProcessorConfig): Promise<void> {
    return this.renderCoordinator.renderData(el, data, config);
  }

  /**
   * Resolve authentication (legacy compatibility)
   */
  async resolveAuthentication(config: ProcessorConfig): Promise<ProcessorConfig> {
    return this.authResolver.resolveAuthentication(config);
  }

  // Utility methods

  /**
   * Check if authentication is valid for source
   */
  private hasValidAuthForSource(source: string): boolean {
    switch (source) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'simkl':
        return !!this.plugin.settings.simklAccessToken;
      case 'anilist':
        return !!this.plugin.settings.accessToken;
      default:
        return false;
    }
  }
}