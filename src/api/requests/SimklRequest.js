// No obsidian import needed

class SimklRequest {
  constructor(config, plugin) {
    this.config = config;
    this.plugin = plugin;
    this.rateLimiter = {
      requests: [],
      windowMs: 60000, // 1 minute window
      maxRequests: 100, // Simkl allows more requests than MAL but less than AniList
      remaining: 100
    };
    this.authState = {
      lastAuthCheck: 0,
      authCheckInterval: 600000, // 10 minutes - longer than MAL since Simkl tokens are more stable
      consecutiveAuthFailures: 0,
      lastRequest: 0,
      tokenExpiry: null
    };
    this.metrics = {
      requests: 0,
      errors: 0,
      avgTime: 0,
      authErrors: 0,
      searchRequests: 0, // Track search vs auth requests separately
      userRequests: 0
    };
  }

  checkRateLimit() {
    const now = Date.now();
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.simklConfig.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { allowed: false, waitTime: Math.max(waitTime, 1500) }; // Slightly longer wait than AniList
    }

    this.rateLimiter.requests.push(now);
    this.authState.lastRequest = now;
    return { allowed: true, waitTime: 0 };
  }

  async validateAuth() {
    const now = Date.now();
    
    // Skip auth validation for search requests (they don't require auth)
    if (this.lastRequestWasSearch) {
      return { valid: true };
    }
    
    if (now - this.authState.lastAuthCheck < this.authState.authCheckInterval) {
      return { valid: true };
    }

    try {
      if (this.plugin.simklAuth && typeof this.plugin.simklAuth.ensureValidToken === 'function') {
        await this.plugin.simklAuth.ensureValidToken();
        this.authState.lastAuthCheck = now;
        this.authState.consecutiveAuthFailures = 0;
        return { valid: true };
      }

      if (!this.plugin.settings?.simklAccessToken) {
        return { 
          valid: false, 
          error: 'No Simkl access token available' 
        };
      }

      // Check if token is expired (if we have expiry info)
      if (this.authState.tokenExpiry && now > this.authState.tokenExpiry) {
        return {
          valid: false,
          error: 'Simkl token has expired'
        };
      }

      this.authState.lastAuthCheck = now;
      return { valid: true };
    } catch (error) {
      this.authState.consecutiveAuthFailures++;
      this.metrics.authErrors++;
      return { 
        valid: false, 
        error: error.message || 'Simkl authentication failed' 
      };
    }
  }

  shouldRetry(error, attempt, maxAttempts) {
    if (attempt >= maxAttempts) return false;
    
    // Simkl-specific error handling
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return attempt < 2; // Only retry rate limits once
    }
    
    if (error.message.includes('auth') || error.message.includes('401') || error.message.includes('403')) {
      return attempt < this.config.simklConfig.maxAuthRetries;
    }
    
    // Server errors (5xx) - retry
    if (error.status >= 500 && error.status < 600) return true;
    
    // Client errors (4xx except auth) - don't retry
    if (error.status >= 400 && error.status < 500) return false;
    
    // Network/timeout errors - retry
    if (error.message.includes('timeout') || error.message.includes('network')) return true;
    
    return true;
  }

  getRetryDelay(attempt) {
    const baseDelay = 600; // faster base for Simkl
    const maxDelay = 6000;
    
    const timeSinceLastRequest = Date.now() - this.authState.lastRequest;
    if (timeSinceLastRequest < 500) {
      return Math.max(baseDelay, 800);
    }
    
    if (this.authState.consecutiveAuthFailures > 0) {
      return baseDelay * (1 + this.authState.consecutiveAuthFailures * 0.5);
    }
    
    if (this.lastErrorWasRateLimit) {
      return Math.max(baseDelay * 2, 3000);
    }
    
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 800;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  updateMetrics(processingTime, isError = false) {
    this.metrics.requests++;
    if (isError) {
      this.metrics.errors++;
    } else {
      this.metrics.avgTime = (this.metrics.avgTime + processingTime) / 2;
    }
    
    // Track request types for better insights
    if (this.lastRequestWasSearch) {
      this.metrics.searchRequests++;
    } else {
      this.metrics.userRequests++;
    }
  }

  getUtilization() {
    return `${((this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100).toFixed(1)}%`;
  }

  getAuthStatus() {
    if (this.authState.consecutiveAuthFailures === 0) return 'healthy';
    if (this.authState.consecutiveAuthFailures < 3) return 'degraded';
    return 'unhealthy';
  }

  // Simkl-specific method to set request context
  setRequestContext(isSearch = false) {
    this.lastRequestWasSearch = isSearch;
  }

  // Simkl-specific method to handle rate limit errors
  handleRateLimitError() {
    this.lastErrorWasRateLimit = true;
    setTimeout(() => {
      this.lastErrorWasRateLimit = false;
    }, 30000); // Reset flag after 30 seconds
  }

  // Method to update token expiry information
  updateTokenExpiry(expiresIn) {
    if (expiresIn) {
      this.authState.tokenExpiry = Date.now() + (expiresIn * 1000);
    }
  }

  // Get detailed metrics including Simkl-specific data
  getDetailedMetrics() {
    return {
      ...this.metrics,
      rateLimiter: {
        current: this.rateLimiter.requests.length,
        max: this.rateLimiter.maxRequests,
        utilization: this.getUtilization()
      },
      auth: {
        status: this.getAuthStatus(),
        failures: this.authState.consecutiveAuthFailures,
        lastCheck: new Date(this.authState.lastAuthCheck).toISOString(),
        tokenExpiry: this.authState.tokenExpiry ? 
          new Date(this.authState.tokenExpiry).toISOString() : null
      },
      requestTypes: {
        search: this.metrics.searchRequests,
        user: this.metrics.userRequests,
        searchRatio: this.metrics.requests > 0 ? 
          `${((this.metrics.searchRequests / this.metrics.requests) * 100).toFixed(1)}%` : '0%'
      }
    };
  }
}

export { SimklRequest };