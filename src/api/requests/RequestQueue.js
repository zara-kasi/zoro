// No obsidian import needed here
import { AniListRequest } from './AniListRequest.js';
import { MALRequest } from './MALRequest.js';
import { SimklRequest } from './SimklRequest.js';
import { TMDbRequest } from './TMDbRequest.js';

class RequestQueue {
  constructor(plugin) {
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
      mal: new MALRequest(this.config, plugin),
      simkl: new SimklRequest(this.config, plugin),
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

  add(requestFn, options = {}) {
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
    
    return new Promise((resolve, reject) => {
      const requestItem = {
        requestFn,
        resolve,
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
  
  adjustOptionsForService(service, options) {
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
  
  async process() {
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
        const authCheck = await serviceHandler.validateAuth();
        if (!authCheck.valid) {
          this.handleMalAuthFailure(requestItem, authCheck.error);
          return;
        }
      } else if (requestItem.service === 'simkl') {
        // Set request context for Simkl (helps with auth decisions)
        const isSearchRequest = requestItem.metadata?.type === 'search';
        serviceHandler.setRequestContext(isSearchRequest);
        
        // Only validate auth for non-search requests
        if (!isSearchRequest) {
          const authCheck = await serviceHandler.validateAuth();
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
  
  canProcessRequest(requestItem) {
    const service = requestItem.service || 'anilist';
    const currentServiceRequests = Array.from(this.state.activeRequests.values())
      .filter(req => req.service === service).length;
    
    const maxConcurrent = this.getMaxConcurrentForService(service);
    
    return this.state.concurrentCount < this.config.maxConcurrent && 
           currentServiceRequests < maxConcurrent;
  }
  
  getMaxConcurrentForService(service) {
    switch (service) {
      case 'mal':
        return this.config.malConfig.maxConcurrent;
      case 'simkl':
        return this.config.simklConfig.maxConcurrent;
      default:
        return this.config.maxConcurrent;
    }
  }
  
  async executeRequest(requestItem, serviceHandler) {
    const { requestFn, resolve, reject, id, timeout, service } = requestItem;
    
    this.state.concurrentCount++;
    this.state.activeRequests.set(id, requestItem);
    requestItem.startTime = Date.now();
    requestItem.attempt++;
    
    const waitTime = requestItem.startTime - requestItem.queueTime;
    
    try {
      const timeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('Request timeout')), timeout);
      });
      
      const result = await Promise.race([requestFn(), timeoutPromise]);
      
      const processingTime = Date.now() - requestItem.startTime;
      this.handleRequestSuccess(requestItem, result, processingTime, waitTime, serviceHandler);
      resolve(result);
      
    } catch (error) {
      const processingTime = Date.now() - requestItem.startTime;
      const shouldRetry = await this.handleRequestError(requestItem, error, processingTime, waitTime, serviceHandler);
      
      if (shouldRetry) {
        const retryDelay = serviceHandler.getRetryDelay(requestItem.attempt);
        setTimeout(() => {
          this.queues[requestItem.priority].unshift(requestItem);
          this.process();
        }, retryDelay);
        this.metrics.retries++;
      } else {
        reject(error);
      }
    } finally {
      this.state.concurrentCount--;
      this.state.activeRequests.delete(id);
      this.requestTracker.delete(id);
      
      this.updateLoaderState();
    }
  }

  handleMalAuthFailure(requestItem, errorMessage) {
    const malService = this.services.mal;
    
    if (malService.authState.consecutiveAuthFailures >= this.config.malConfig.maxAuthRetries) {
      requestItem.reject(new Error(`MAL authentication persistently failing: ${errorMessage}`));
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

  handleSimklAuthFailure(requestItem, errorMessage) {
    const simklService = this.services.simkl;
    
    if (simklService.authState.consecutiveAuthFailures >= this.config.simklConfig.maxAuthRetries) {
      requestItem.reject(new Error(`Simkl authentication persistently failing: ${errorMessage}`));
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

  handleRequestSuccess(requestItem, result, processingTime, waitTime, serviceHandler) {
    this.state.completedRequests++;
    serviceHandler.updateMetrics(processingTime);
    this.metrics.requestsProcessed++;
  }
  
  async handleRequestError(requestItem, error, processingTime, waitTime, serviceHandler) {
    this.state.failedRequests++;
    serviceHandler.updateMetrics(processingTime, true);
    
    // Simkl-specific error handling
    if (requestItem.service === 'simkl' && error.message.includes('rate limit')) {
      serviceHandler.handleRateLimitError();
    }
    
    const shouldRetry = serviceHandler.shouldRetry(error, requestItem.attempt, requestItem.maxAttempts);
    
    if (!shouldRetry) {
      this.metrics.requestsFailed++;
    }
    
    return shouldRetry;
  }

  // Updated loader state management remains the same
  updateLoaderState(forceShow = null) {
    if (this.loaderState.debounceTimeout) {
      clearTimeout(this.loaderState.debounceTimeout);
      this.loaderState.debounceTimeout = null;
    }
    
    const totalRequests = this.getTotalQueueSize() + this.state.concurrentCount;
    let shouldShow;
    
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
  
  showGlobalLoader() {
    if (!this.plugin?.settings?.showLoadingIcon) return;
    
    const loader = document.getElementById('zoro-global-loader');
    if (loader) {
      loader.classList.add('zoro-show');
      this.loaderState.visible = true;
      this.updateLoaderCounter();
    }
  }
  
  hideGlobalLoader() {
    const loader = document.getElementById('zoro-global-loader');
    if (loader) {
      loader.classList.remove('zoro-show');
      loader.removeAttribute('data-count');
      this.loaderState.visible = false;
    }
  }
  
  updateLoaderCounter() {
    const loader = document.getElementById('zoro-global-loader');
    if (loader && this.loaderState.visible) {
      const queueSize = this.getTotalQueueSize() + this.state.concurrentCount;
      if (queueSize > 1) {
        loader.setAttribute('data-count', queueSize);
      } else {
        loader.removeAttribute('data-count');
      }
    }
  }
  
  updateQueueMetrics() {
    const totalQueued = this.getTotalQueueSize();
    this.metrics.queuePeakSize = Math.max(this.metrics.queuePeakSize, totalQueued);
  }

  getMetrics() {
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

  getNextRequest() {
    const priorities = ['high', 'normal', 'low'];
    for (const priority of priorities) {
      if (this.queues[priority].length > 0) {
        return this.queues[priority].shift();
      }
    }
    return null;
  }
  
  getTotalQueueSize() {
    return Object.values(this.queues).reduce((total, queue) => total + queue.length, 0);
  }
  
  getQueueSizes() {
    const sizes = {};
    Object.keys(this.queues).forEach(priority => {
      sizes[priority] = this.queues[priority].length;
    });
    return sizes;
  }
  
  getHealthStatus() {
    const queueSize = this.getTotalQueueSize();
    const errorRate = this.metrics.requestsFailed / (this.metrics.requestsProcessed + this.metrics.requestsFailed);
    
    let status = 'healthy';
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
        simkl: this.services.simkl.getUtilization()
      },
      authStatus: {
        mal: this.services.mal.getAuthStatus(),
        simkl: this.services.simkl.getAuthStatus()
      }
    };
  }
  
  startBackgroundTasks() {
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }
  
  cleanup() {
    const now = Date.now();
    
    Object.values(this.services).forEach(service => {
      service.rateLimiter.requests = service.rateLimiter.requests.filter(
        time => now - time < service.rateLimiter.windowMs * 2
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
  
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
  
  pause() {
    this.state.isProcessing = true;
  }
  
  resume() {
    this.state.isProcessing = false;
    this.process();
  }
  clear(priority = null) {
    if (priority) {
      const cleared = this.queues[priority].length;
      this.queues[priority] = [];
      this.updateLoaderState();
      return cleared;
    } else {
      let total = 0;
      Object.keys(this.queues).forEach(p => {
        total += this.queues[p].length;
        this.queues[p] = [];
      });
      this.updateLoaderState();
      return total;
    }
  }
  
  clearMalRequests() {
    let cleared = 0;
    Object.keys(this.queues).forEach(priority => {
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
  
  clearSimklRequests() {
    let cleared = 0;
    Object.keys(this.queues).forEach(priority => {
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
  
  clearRequestsByService(serviceName) {
    if (!['anilist', 'mal', 'simkl'].includes(serviceName)) {
      throw new Error(`Unknown service: ${serviceName}`);
    }
    
    let cleared = 0;
    Object.keys(this.queues).forEach(priority => {
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
  getServiceQueueStats() {
    const stats = {
      anilist: { high: 0, normal: 0, low: 0, total: 0 },
      mal: { high: 0, normal: 0, low: 0, total: 0 },
      simkl: { high: 0, normal: 0, low: 0, total: 0 }
    };
    
    Object.keys(this.queues).forEach(priority => {
      this.queues[priority].forEach(req => {
        const service = req.service || 'anilist';
        stats[service][priority]++;
        stats[service].total++;
      });
    });
    
    return stats;
  }
  
  // Update token expiry for Simkl
  updateSimklTokenExpiry(expiresIn) {
    this.services.simkl.updateTokenExpiry(expiresIn);
  }
  
  async destroy() {
    // Clear debounce timeout
    if (this.loaderState.debounceTimeout) {
      clearTimeout(this.loaderState.debounceTimeout);
    }
    
    const activeRequests = Array.from(this.state.activeRequests.values());
    if (activeRequests.length > 0) {
      await Promise.allSettled(
        activeRequests.map(req => 
          new Promise(resolve => {
            const originalResolve = req.resolve;
            const originalReject = req.reject;
            req.resolve = (...args) => { originalResolve(...args); resolve(); };
            req.reject = (...args) => { originalReject(...args); resolve(); };
          })
        )
      );
    }
    
    this.clear();
    this.hideGlobalLoader();
  }
}

export { RequestQueue };