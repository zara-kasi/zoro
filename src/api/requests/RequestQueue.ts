/**
 * Multi-service request queue with priority handling, rate limiting, and authentication
 * Migrated from RequestQueue.js → RequestQueue.ts
 * - Added comprehensive types for queue management and service configurations
 * - Typed all API service handlers and their specific behaviors
 * - Added proper error handling with service-specific retry logic
 */

import type { Plugin } from 'obsidian';
import { AniListRequest } from './AniListRequest';
import { MALRequest } from './MALRequest';
import { SimklRequest } from './SimklRequest';


// Queue and request types
type Priority = 'high' | 'normal' | 'low';
type ServiceName = 'anilist' | 'mal' | 'simkl' | 'tmdb';

interface RequestOptions {
  priority?: Priority;
  timeout?: number;
  retries?: number;
  metadata?: Record<string, unknown>;
  service?: ServiceName;
}

interface RequestItem {
  requestFn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  id: string;
  priority: Priority;
  timeout: number;
  retries: number;
  metadata: Record<string, unknown>;
  queueTime: number;
  startTime: number | null;
  attempt: number;
  maxAttempts: number;
  service: ServiceName;
}

interface QueueConfig {
  baseDelay: number;
  maxDelay: number;
  minDelay: number;
  maxConcurrent: number;
  maxRetries: number;
  timeoutMs: number;
  rateLimitBuffer: number;
  malConfig: {
    baseDelay: number;
    maxConcurrent: number;
    rateLimitBuffer: number;
    authRetryDelay: number;
    maxAuthRetries: number;
  };
  simklConfig: {
    baseDelay: number;
    maxConcurrent: number;
    rateLimitBuffer: number;
    authRetryDelay: number;
    maxAuthRetries: number;
  };
}

interface QueueState {
  isProcessing: boolean;
  activeRequests: Map<string, RequestItem>;
  completedRequests: number;
  failedRequests: number;
  concurrentCount: number;
}

interface QueueMetrics {
  requestsQueued: number;
  requestsProcessed: number;
  requestsFailed: number;
  queuePeakSize: number;
  rateLimitHits: number;
  retries: number;
  startTime: number;
}

interface LoaderState {
  visible: boolean;
  requestCount: number;
  lastUpdate: number;
  debounceTimeout: NodeJS.Timeout | null;
}

interface ServiceMetrics {
  requests: number;
  errors: number;
  avgTime: number;
  authErrors?: number;
}

interface RateLimitStatus {
  requests: number;
  maxRequests: number;
  remaining: number;
  utilization: string;
}

interface AuthValidation {
  valid: boolean;
  error?: string;
}

// Service handler interfaces
interface ServiceHandler {
  checkRateLimit(): { allowed: boolean; waitTime: number };
  shouldRetry(error: Error, attempt: number, maxAttempts: number): boolean;
  getRetryDelay(attempt: number): number;
  updateMetrics(processingTime: number, isError?: boolean): void;
  getUtilization(): string;
  rateLimiter: {
    requests: number[];
    maxRequests: number;
    remaining: number;
  };
  metrics: ServiceMetrics;
}

interface MALServiceHandler extends ServiceHandler {
  validateAuth(): Promise<AuthValidation>;
  getAuthStatus(): 'healthy' | 'degraded';
  authState: {
    lastAuthCheck: number;
    consecutiveAuthFailures: number;
    lastRequest: number;
    authCheckInterval: number;
  };
}

interface SimklServiceHandler extends ServiceHandler {
  validateAuth(): Promise<AuthValidation>;
  setRequestContext(isSearchRequest: boolean): void;
  handleRateLimitError(): void;
  getAuthStatus(): 'healthy' | 'degraded';
  getDetailedMetrics(): ServiceMetrics & { additionalData?: unknown };
  updateTokenExpiry(expiresIn: number): void;
  authState: {
    lastAuthCheck: number;
    consecutiveAuthFailures: number;
    lastRequest: number;
    tokenExpiry: number | null;
    authCheckInterval: number;
  };
}

// Plugin settings interface
interface PluginSettings {
  showLoadingIcon: boolean;
  [key: string]: unknown;
}

// Plugin interface with required methods and properties
interface ZoroPlugin extends Plugin {
  settings: PluginSettings;
}

// Placeholder for missing service classes - these would need to be migrated too
class TMDbRequest implements ServiceHandler {
  rateLimiter = { requests: [], maxRequests: 100, remaining: 100 };
  metrics = { requests: 0, errors: 0, avgTime: 0 };
  
  constructor(config: QueueConfig) {}
  checkRateLimit() { return { allowed: true, waitTime: 0 }; }
  shouldRetry() { return false; }
  getRetryDelay() { return 1000; }
  updateMetrics() {}
  getUtilization() { return '0%'; }
}

export class RequestQueue {
  private readonly plugin: ZoroPlugin;
  private readonly queues: Record<Priority, RequestItem[]>;
  private readonly config: QueueConfig;
  private readonly state: QueueState;
  private readonly services: {
    anilist: ServiceHandler;
    mal: MALServiceHandler;
    simkl: SimklServiceHandler;
    tmdb: ServiceHandler;
  };
  private readonly metrics: QueueMetrics;
  private readonly requestTracker: Map<string, { queueTime: number; priority: Priority; service: ServiceName }>;
  private readonly loaderState: LoaderState;

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
    
    this.queues = {
      high: [],
      normal: [],
      low: []
    };
    
    this.config = {
      baseDelay: 700,
      maxDelay: 5000,
      minDelay: 100,
      maxConcurrent: 3,
      maxRetries: 3,
      timeoutMs: 30000,
      rateLimitBuffer: 0.8,
      malConfig: {
        baseDelay: 1000,
        maxConcurrent: 2,
        rateLimitBuffer: 0.7,
        authRetryDelay: 2000,
        maxAuthRetries: 2
      },
      simklConfig: {
        baseDelay: 500,
        maxConcurrent: 3,
        rateLimitBuffer: 0.9,
        authRetryDelay: 2000,
        maxAuthRetries: 3
      }
    };
    
    this.state = {
      isProcessing: false,
      activeRequests: new Map(),
      completedRequests: 0,
      failedRequests: 0,
      concurrentCount: 0
    };
    
    this.services = {
      anilist: new AniListRequest(this.config),
      mal: new MALRequest(this.config, plugin) as MALServiceHandler,
      simkl: new SimklRequest(this.config, plugin) as SimklServiceHandler,
      tmdb: new TMDbRequest(this.config)
    };
    
    this.metrics = {
      requestsQueued: 0,
      requestsProcessed: 0,
      requestsFailed: 0,
      queuePeakSize: 0,
      rateLimitHits: 0,
      retries: 0,
      startTime: Date.now()
    };
    
    this.requestTracker = new Map();
    
    this.loaderState = {
      visible: false,
      requestCount: 0,
      lastUpdate: 0,
      debounceTimeout: null
    };
    
    this.startBackgroundTasks();
  }

  add<T = unknown>(requestFn: () => Promise<T>, options: RequestOptions = {}): Promise<T> {
    const {
      priority = 'normal',
      timeout = this.config.timeoutMs,
      retries = this.config.maxRetries,
      metadata = {},
      service = 'anilist'
    } = options;
    
    const requestId = this.generateRequestId();
    const queueTime = Date.now();
    
    const adjustedOptions = this.adjustOptionsForService(service, {
      timeout, retries, priority, metadata
    });
    
    return new Promise<T>((resolve, reject) => {
      const requestItem: RequestItem = {
        requestFn: requestFn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        id: requestId,
        priority,
        timeout: adjustedOptions.timeout,
        retries: adjustedOptions.retries,
        metadata: { ...metadata, service },
        queueTime,
        startTime: null,
        attempt: 0,
        maxAttempts: adjustedOptions.retries + 1,
        service
      };
      
      this.queues[priority].push(requestItem);
      this.metrics.requestsQueued++;
      this.updateQueueMetrics();
      
      // Update loader state immediately when request is queued
      this.updateLoaderState(true);
      
      // Start processing
      this.process();
      
      this.requestTracker.set(requestId, {
        queueTime,
        priority,
        service
      });
    });
  }
  
  private adjustOptionsForService(service: ServiceName, options: {
    timeout: number;
    retries: number;
    priority: Priority;
    metadata: Record<string, unknown>;
  }): typeof options {
    if (service === 'mal') {
      return {
        timeout: Math.max(options.timeout, 30000),
        retries: Math.min(options.retries, this.config.malConfig.maxAuthRetries),
        priority: options.priority,
        metadata: options.metadata
      };
    }
    
    if (service === 'simkl') {
      return {
        timeout: Math.max(options.timeout, 25000), // Simkl can be slower than AniList
        retries: Math.min(options.retries, this.config.simklConfig.maxAuthRetries),
        priority: options.priority,
        metadata: options.metadata
      };
    }
    
    return options;
  }
  
  private async process(): Promise<void> {
    if (this.state.isProcessing || this.getTotalQueueSize() === 0) {
      if (this.getTotalQueueSize() === 0) {
        this.updateLoaderState(false);
      }
      return;
    }
    
    this.state.isProcessing = true;
    this.updateLoaderState(true);
    
    try {
      const requestItem = this.getNextRequest();
      if (!requestItem) {
        this.state.isProcessing = false;
        this.updateLoaderState(false);
        return;
      }
      
      if (!this.canProcessRequest(requestItem)) {
        this.queues[requestItem.priority].unshift(requestItem);
        this.state.isProcessing = false;
        setTimeout(() => this.process(), this.config.minDelay);
        return;
      }
      
      const serviceHandler = this.services[requestItem.service];
      const rateLimitCheck = serviceHandler.checkRateLimit();
      
      if (!rateLimitCheck.allowed) {
        this.queues[requestItem.priority].unshift(requestItem);
        this.state.isProcessing = false;
        this.metrics.rateLimitHits++;
        
        setTimeout(() => this.process(), rateLimitCheck.waitTime);
        return;
      }
      
      // Service-specific auth validation
      if (requestItem.service === 'mal') {
        const malService = this.services.mal;
        const authCheck = await malService.validateAuth();
        if (!authCheck.valid) {
          this.handleMalAuthFailure(requestItem, authCheck.error);
          return;
        }
      } else if (requestItem.service === 'simkl') {
        const simklService = this.services.simkl;
        // Set request context for Simkl (helps with auth decisions)
        const isSearchRequest = requestItem.metadata?.type === 'search';
        simklService.setRequestContext(Boolean(isSearchRequest));
        
        // Only validate auth for non-search requests
        if (!isSearchRequest) {
          const authCheck = await simklService.validateAuth();
          if (!authCheck.valid) {
            this.handleSimklAuthFailure(requestItem, authCheck.error);
            return;
          }
        }
      }
      
      await this.executeRequest(requestItem, serviceHandler);
      
    } finally {
      this.state.isProcessing = false;
      
      if (this.getTotalQueueSize() > 0) {
        setTimeout(() => this.process(), this.config.minDelay);
      } else {
        this.updateLoaderState(false);
      }
    }
  }
  
  private canProcessRequest(requestItem: RequestItem): boolean {
    const service = requestItem.service || 'anilist';
    const currentServiceRequests = Array.from(this.state.activeRequests.values())
      .filter(req => req.service === service).length;
    
    const maxConcurrent = this.getMaxConcurrentForService(service);
    
    return this.state.concurrentCount < this.config.maxConcurrent && 
           currentServiceRequests < maxConcurrent;
  }
  
  private getMaxConcurrentForService(service: ServiceName): number {
    switch (service) {
      case 'mal':
        return this.config.malConfig.maxConcurrent;
      case 'simkl':
        return this.config.simklConfig.maxConcurrent;
      default:
        return this.config.maxConcurrent;
    }
  }
  
  private async executeRequest(requestItem: RequestItem, serviceHandler: ServiceHandler): Promise<void> {
    const { requestFn, resolve, reject, id, timeout } = requestItem;
    
    this.state.concurrentCount++;
    this.state.activeRequests.set(id, requestItem);
    requestItem.startTime = Date.now();
    requestItem.attempt++;
    
    const waitTime = requestItem.startTime - requestItem.queueTime;
    
    try {
      const timeoutPromise = new Promise<never>((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('Request timeout')), timeout);
      });
      
      const result = await Promise.race([requestFn(), timeoutPromise]);
      
      const processingTime = Date.now() - requestItem.startTime!;
      this.handleRequestSuccess(requestItem, result, processingTime, waitTime, serviceHandler);
      resolve(result);
      
    } catch (error) {
      const processingTime = Date.now() - requestItem.startTime!;
      const err = error instanceof Error ? error : new Error(String(error));
      const shouldRetry = await this.handleRequestError(requestItem, err, processingTime, waitTime, serviceHandler);
      
      if (shouldRetry) {
        const retryDelay = serviceHandler.getRetryDelay(requestItem.attempt);
        setTimeout(() => {
          this.queues[requestItem.priority].unshift(requestItem);
          this.process();
        }, retryDelay);
        this.metrics.retries++;
      } else {
        reject(err);
      }
    } finally {
      this.state.concurrentCount--;
      this.state.activeRequests.delete(id);
      this.requestTracker.delete(id);
      
      this.updateLoaderState();
    }
  }

  private handleMalAuthFailure(requestItem: RequestItem, errorMessage?: string): void {
    const malService = this.services.mal;
    
    if (malService.authState.consecutiveAuthFailures >= this.config.malConfig.maxAuthRetries) {
      requestItem.reject(new Error(`MAL authentication persistently failing: ${errorMessage || 'Unknown error'}`));
      this.state.isProcessing = false;
      this.updateLoaderState(false);
      return;
    }
    
    setTimeout(() => {
      this.queues[requestItem.priority].unshift(requestItem);
      this.state.isProcessing = false;
      this.process();
    }, this.config.malConfig.authRetryDelay);
  }

  private handleSimklAuthFailure(requestItem: RequestItem, errorMessage?: string): void {
    const simklService = this.services.simkl;
    
    if (simklService.authState.consecutiveAuthFailures >= this.config.simklConfig.maxAuthRetries) {
      requestItem.reject(new Error(`Simkl authentication persistently failing: ${errorMessage || 'Unknown error'}`));
      this.state.isProcessing = false;
      this.updateLoaderState(false);
      return;
    }
    
    setTimeout(() => {
      this.queues[requestItem.priority].unshift(requestItem);
      this.state.isProcessing = false;
      this.process();
    }, this.config.simklConfig.authRetryDelay);
  }

  private handleRequestSuccess(requestItem: RequestItem, result: unknown, processingTime: number, waitTime: number, serviceHandler: ServiceHandler): void {
    this.state.completedRequests++;
    serviceHandler.updateMetrics(processingTime);
    this.metrics.requestsProcessed++;
  }
  
  private async handleRequestError(requestItem: RequestItem, error: Error, processingTime: number, waitTime: number, serviceHandler: ServiceHandler): Promise<boolean> {
    this.state.failedRequests++;
    serviceHandler.updateMetrics(processingTime, true);
    
    // Simkl-specific error handling
    if (requestItem.service === 'simkl' && error.message.includes('rate limit')) {
      const simklService = this.services.simkl;
      simklService.handleRateLimitError();
    }
    
    const shouldRetry = serviceHandler.shouldRetry(error, requestItem.attempt, requestItem.maxAttempts);
    
    if (!shouldRetry) {
      this.metrics.requestsFailed++;
    }
    
    return shouldRetry;
  }

  private updateLoaderState(forceShow: boolean | null = null): void {
    if (this.loaderState.debounceTimeout) {
      clearTimeout(this.loaderState.debounceTimeout);
      this.loaderState.debounceTimeout = null;
    }
    
    const totalRequests = this.getTotalQueueSize() + this.state.concurrentCount;
    let shouldShow: boolean;
    
    if (forceShow !== null) {
      shouldShow = forceShow;
    } else {
      shouldShow = totalRequests > 0;
    }
    
    if (shouldShow && !this.loaderState.visible) {
      this.showGlobalLoader();
    } else if (!shouldShow && this.loaderState.visible) {
      this.loaderState.debounceTimeout = setTimeout(() => {
        if (this.getTotalQueueSize() + this.state.concurrentCount === 0) {
          this.hideGlobalLoader();
        }
      }, 300);
    }
    
    this.loaderState.requestCount = totalRequests;
    this.loaderState.lastUpdate = Date.now();
    
    if (this.loaderState.visible) {
      this.updateLoaderCounter();
    }
  }
  
  private showGlobalLoader(): void {
    if (!this.plugin?.settings?.showLoadingIcon) return;
    
    const loader = document.getElementById('zoro-global-loader');
    if (loader) {
      loader.classList.add('zoro-show');
      this.loaderState.visible = true;
      this.updateLoaderCounter();
    }
  }
  
  private hideGlobalLoader(): void {
    const loader = document.getElementById('zoro-global-loader');
    if (loader) {
      loader.classList.remove('zoro-show');
      loader.removeAttribute('data-count');
      this.loaderState.visible = false;
    }
  }
  
  private updateLoaderCounter(): void {
    const loader = document.getElementById('zoro-global-loader');
    if (loader && this.loaderState.visible) {
      const queueSize = this.getTotalQueueSize() + this.state.concurrentCount;
      if (queueSize > 1) {
        loader.setAttribute('data-count', String(queueSize));
      } else {
        loader.removeAttribute('data-count');
      }
    }
  }
  
  private updateQueueMetrics(): void {
    const totalQueued = this.getTotalQueueSize();
    this.metrics.queuePeakSize = Math.max(this.metrics.queuePeakSize, totalQueued);
  }

  getMetrics(): {
    uptime: string;
    queue: {
      current: Record<Priority, number>;
      total: number;
      peak: number;
      processed: number;
      failed: number;
      retries: number;
    };
    performance: {
      successRate: string;
    };
    rateLimit: {
      anilist: RateLimitStatus;
      mal: RateLimitStatus;
      simkl: RateLimitStatus;
      hits: number;
    };
    concurrency: {
      active: number;
      max: number;
    };
    services: {
      anilist: ServiceMetrics;
      mal: ServiceMetrics;
      simkl: ServiceMetrics;
    };
    mal: {
      lastAuthCheck: string;
      authFailures: number;
      lastRequest: string;
    };
    simkl: {
      lastAuthCheck: string;
      authFailures: number;
      lastRequest: string;
      authStatus: string;
      tokenExpiry: string | null;
    };
    loader: {
      visible: boolean;
      requestCount: number;
    };
  } {
    const now = Date.now();
    const uptime = now - this.metrics.startTime;
    const totalRequests = this.metrics.requestsProcessed + this.metrics.requestsFailed;
    const successRate = totalRequests > 0 ? (this.metrics.requestsProcessed / totalRequests) : 1;
    
    return {
      uptime: this.formatDuration(uptime),
      queue: {
        current: this.getQueueSizes(),
        total: this.getTotalQueueSize(),
        peak: this.metrics.queuePeakSize,
        processed: this.metrics.requestsProcessed,
        failed: this.metrics.requestsFailed,
        retries: this.metrics.retries
      },
      performance: {
        successRate: `${(successRate * 100).toFixed(2)}%`
      },
      rateLimit: {
        anilist: {
          requests: this.services.anilist.rateLimiter.requests.length,
          maxRequests: this.services.anilist.rateLimiter.maxRequests,
          remaining: this.services.anilist.rateLimiter.remaining,
          utilization: this.services.anilist.getUtilization()
        },
        mal: {
          requests: this.services.mal.rateLimiter.requests.length,
          maxRequests: this.services.mal.rateLimiter.maxRequests,
          remaining: this.services.mal.rateLimiter.remaining,
          utilization: this.services.mal.getUtilization()
        },
        simkl: {
          requests: this.services.simkl.rateLimiter.requests.length,
          maxRequests: this.services.simkl.rateLimiter.maxRequests,
          remaining: this.services.simkl.rateLimiter.remaining,
          utilization: this.services.simkl.getUtilization()
        },
        hits: this.metrics.rateLimitHits
      },
      concurrency: {
        active: this.state.concurrentCount,
        max: this.config.maxConcurrent
      },
      services: {
        anilist: this.services.anilist.metrics,
        mal: this.services.mal.metrics,
        simkl: this.services.simkl.getDetailedMetrics()
      },
      mal: {
        lastAuthCheck: new Date(this.services.mal.authState.lastAuthCheck).toISOString(),
        authFailures: this.services.mal.authState.consecutiveAuthFailures,
        lastRequest: this.services.mal.authState.lastRequest ? 
          new Date(this.services.mal.authState.lastRequest).toISOString() : 'never'
      },
      simkl: {
        lastAuthCheck: new Date(this.services.simkl.authState.lastAuthCheck).toISOString(),
        authFailures: this.services.simkl.authState.consecutiveAuthFailures,
        lastRequest: this.services.simkl.authState.lastRequest ? 
          new Date(this.services.simkl.authState.lastRequest).toISOString() : 'never',
        authStatus: this.services.simkl.getAuthStatus(),
        tokenExpiry: this.services.simkl.authState.tokenExpiry ?
          new Date(this.services.simkl.authState.tokenExpiry).toISOString() : null
      },
      loader: {
        visible: this.loaderState.visible,
        requestCount: this.loaderState.requestCount
      }
    };
  }

  private getNextRequest(): RequestItem | null {
    const priorities: Priority[] = ['high', 'normal', 'low'];
    for (const priority of priorities) {
      if (this.queues[priority].length > 0) {
        return this.queues[priority].shift()!;
      }
    }
    return null;
  }
  
  private getTotalQueueSize(): number {
    return Object.values(this.queues).reduce((total, queue) => total + queue.length, 0);
  }
  
  private getQueueSizes(): Record<Priority, number> {
    const sizes: Record<Priority, number> = {} as Record<Priority, number>;
    Object.keys(this.queues).forEach(priority => {
      sizes[priority as Priority] = this.queues[priority as Priority].length;
    });
    return sizes;
  }
  
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    queueSize: number;
    errorRate: string;
    activeRequests: number;
    rateLimitUtilization: Record<ServiceName, string>;
    authStatus: {
      mal: string;
      simkl: string;
    };
  } {
    const queueSize = this.getTotalQueueSize();
    const errorRate = this.metrics.requestsFailed / (this.metrics.requestsProcessed + this.metrics.requestsFailed);
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const malAuthFailures = this.services.mal.authState.consecutiveAuthFailures;
    const simklAuthFailures = this.services.simkl.authState.consecutiveAuthFailures;
    
    if (queueSize > 50 || errorRate > 0.1 || malAuthFailures > 1 || simklAuthFailures > 1) {
      status = 'degraded';
    }
    if (queueSize > 100 || errorRate > 0.25 || 
        malAuthFailures >= this.config.malConfig.maxAuthRetries ||
        simklAuthFailures >= this.config.simklConfig.maxAuthRetries) {
      status = 'unhealthy';
    }
    
    return {
      status,
      queueSize,
      errorRate: `${(errorRate * 100).toFixed(2)}%`,
      activeRequests: this.state.concurrentCount,
      rateLimitUtilization: {
        anilist: this.services.anilist.getUtilization(),
        mal: this.services.mal.getUtilization(),
        simkl: this.services.simkl.getUtilization(),
        tmdb: this.services.tmdb.getUtilization()
      },
      authStatus: {
        mal: this.services.mal.getAuthStatus(),
        simkl: this.services.simkl.getAuthStatus()
      }
    };
  }
  
  private startBackgroundTasks(): void {
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
  }
  
  private cleanup(): void {
    const now = Date.now();
    
    // Clean up rate limiter data for all services
    Object.values(this.services).forEach(service => {
      service.rateLimiter.requests = service.rateLimiter.requests.filter(
        time => now - time < 120000 // Keep 2 minutes of history
      );
    });
    
    // Cleanup MAL auth state
    if (now - this.services.mal.authState.lastAuthCheck > this.services.mal.authState.authCheckInterval * 2) {
      this.services.mal.authState.consecutiveAuthFailures = 0;
    }
    
    // Cleanup Simkl auth state
    if (now - this.services.simkl.authState.lastAuthCheck > this.services.simkl.authState.authCheckInterval * 2) {
      this.services.simkl.authState.consecutiveAuthFailures = 0;
    }
  }
  
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
  
  pause(): void {
    this.state.isProcessing = true;
  }
  
  resume(): void {
    this.state.isProcessing = false;
    this.process();
  }

  clear(priority: Priority | null = null): number {
    if (priority) {
      const cleared = this.queues[priority].length;
      this.queues[priority] = [];
      this.updateLoaderState();
      return cleared;
    } else {
      let total = 0;
      const priorities: Priority[] = ['high', 'normal', 'low'];
      priorities.forEach(p => {
        total += this.queues[p].length;
        this.queues[p] = [];
      });
      this.updateLoaderState();
      return total;
    }
  }
  
  clearMalRequests(): number {
    let cleared = 0;
    const priorities: Priority[] = ['high', 'normal', 'low'];
    
    priorities.forEach(priority => {
      const malRequests = this.queues[priority].filter(req => req.service === 'mal');
      this.queues[priority] = this.queues[priority].filter(req => req.service !== 'mal');
      cleared += malRequests.length;
      
      malRequests.forEach(req => {
        req.reject(new Error('MAL requests cleared due to authentication issues'));
      });
    });
    
    this.updateLoaderState();
    return cleared;
  }
  
  clearSimklRequests(): number {
    let cleared = 0;
    const priorities: Priority[] = ['high', 'normal', 'low'];
    
    priorities.forEach(priority => {
      const simklRequests = this.queues[priority].filter(req => req.service === 'simkl');
      this.queues[priority] = this.queues[priority].filter(req => req.service !== 'simkl');
      cleared += simklRequests.length;
      
      simklRequests.forEach(req => {
        req.reject(new Error('Simkl requests cleared due to authentication issues'));
      });
    });
    
    this.updateLoaderState();
    return cleared;
  }
  
  clearRequestsByService(serviceName: ServiceName): number {
    if (!(['anilist', 'mal', 'simkl', 'tmdb'] as ServiceName[]).includes(serviceName)) {
      throw new Error(`Unknown service: ${serviceName}`);
    }
    
    let cleared = 0;
    const priorities: Priority[] = ['high', 'normal', 'low'];
    
    priorities.forEach(priority => {
      const serviceRequests = this.queues[priority].filter(req => req.service === serviceName);
      this.queues[priority] = this.queues[priority].filter(req => req.service !== serviceName);
      cleared += serviceRequests.length;
      
      serviceRequests.forEach(req => {
        req.reject(new Error(`${serviceName} requests cleared`));
      });
    });
    
    this.updateLoaderState();
    return cleared;
  }
  
  // Get service-specific queue statistics
  getServiceQueueStats(): Record<ServiceName, Record<Priority | 'total', number>> {
    const stats: Record<ServiceName, Record<Priority | 'total', number>> = {
      anilist: { high: 0, normal: 0, low: 0, total: 0 },
      mal: { high: 0, normal: 0, low: 0, total: 0 },
      simkl: { high: 0, normal: 0, low: 0, total: 0 },
      tmdb: { high: 0, normal: 0, low: 0, total: 0 }
    };
    
    const priorities: Priority[] = ['high', 'normal', 'low'];
    priorities.forEach(priority => {
      this.queues[priority].forEach(req => {
        const service = req.service || 'anilist';
        stats[service][priority]++;
        stats[service].total++;
      });
    });
    
    return stats;
  }
  
  // Update token expiry for Simkl
  updateSimklTokenExpiry(expiresIn: number): void {
    this.services.simkl.updateTokenExpiry(expiresIn);
  }
  
  async destroy(): Promise<void> {
    // Clear debounce timeout
    if (this.loaderState.debounceTimeout) {
      clearTimeout(this.loaderState.debounceTimeout);
    }
    
    // Wait for all active requests to complete
    const activeRequests = Array.from(this.state.activeRequests.values());
    if (activeRequests.length > 0) {
      await Promise.allSettled(
        activeRequests.map(req => 
          new Promise<void>(resolve => {
            const originalResolve = req.resolve;
            const originalReject = req.reject;
            req.resolve = (...args: unknown[]) => { 
              originalResolve(...args); 
              resolve(); 
            };
            req.reject = (...args: unknown[]) => { 
              originalReject(...args); 
              resolve(); 
            };
          })
        )
      );
    }
    
    // Clear all queues
    this.clear();
    this.hideGlobalLoader();
  }
}

export { RequestQueue };
