class MALRequest {
  constructor(config, plugin) {
    this.config = config;
    this.plugin = plugin;
    this.rateLimiter = {
      requests: [],
      windowMs: 60000,
      maxRequests: 60,
      remaining: 60
    };
    this.authState = {
      lastAuthCheck: 0,
      authCheckInterval: 300000,
      consecutiveAuthFailures: 0,
      lastRequest: 0
    };
    this.metrics = {
      requests: 0,
      errors: 0,
      avgTime: 0,
      authErrors: 0
    };
  }

  checkRateLimit() {
    const now = Date.now();
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.malConfig.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { allowed: false, waitTime: Math.max(waitTime, 2000) };
    }

    this.rateLimiter.requests.push(now);
    this.authState.lastRequest = now;
    return { allowed: true, waitTime: 0 };
  }

  async validateAuth() {
    const now = Date.now();
    
    if (now - this.authState.lastAuthCheck < this.authState.authCheckInterval) {
      return { valid: true };
    }

    try {
      if (this.plugin.malAuth && typeof this.plugin.malAuth.ensureValidToken === 'function') {
        await this.plugin.malAuth.ensureValidToken();
        this.authState.lastAuthCheck = now;
        this.authState.consecutiveAuthFailures = 0;
        return { valid: true };
      }

      if (!this.plugin.settings?.malAccessToken) {
        return { 
          valid: false, 
          error: 'No MAL access token available' 
        };
      }

      return { valid: true };
    } catch (error) {
      this.authState.consecutiveAuthFailures++;
      this.metrics.authErrors++;
      return { 
        valid: false, 
        error: error.message || 'MAL authentication failed' 
      };
    }
  }

  shouldRetry(error, attempt, maxAttempts) {
    if (attempt >= maxAttempts) return false;
    
    if (error.message.includes('auth') || error.message.includes('401')) {
      return attempt < this.config.malConfig.maxAuthRetries;
    }
    
    if (error.status >= 400 && error.status < 500) return false;
    if (error.message.includes('timeout')) return true;
    return true;
  }

  getRetryDelay(attempt) {
    const baseDelay = 2000;
    const maxDelay = 15000;
    
    const timeSinceLastRequest = Date.now() - this.authState.lastRequest;
    if (timeSinceLastRequest < 1000) {
      return Math.max(baseDelay, 1500);
    }
    
    if (this.authState.consecutiveAuthFailures > 0) {
      return baseDelay * (1 + this.authState.consecutiveAuthFailures * 0.5);
    }
    
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  updateMetrics(processingTime, isError = false) {
    this.metrics.requests++;
    if (isError) {
      this.metrics.errors++;
    } else {
      this.metrics.avgTime = (this.metrics.avgTime + processingTime) / 2;
    }
  }

  getUtilization() {
    return `${((this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100).toFixed(1)}%`;
  }

  getAuthStatus() {
    return this.authState.consecutiveAuthFailures === 0 ? 'healthy' : 'degraded';
  }
}

export { MALRequest };