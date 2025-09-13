import type { Plugin } from 'obsidian';

// Configuration and state interfaces
interface SimklRequestConfig {
  simklConfig: {
    rateLimitBuffer: number;
    maxAuthRetries: number;
    timeoutMs?: number;
  };
}

interface RateLimiter {
  requests: number[];
  readonly windowMs: number;
  readonly maxRequests: number;
  remaining: number;
}

interface AuthState {
  lastAuthCheck: number;
  readonly authCheckInterval: number;
  consecutiveAuthFailures: number;
  lastRequest: number;
  tokenExpiry: number | null;
}

interface RequestMetrics {
  requests: number;
  errors: number;
  avgTime: number;
  authErrors: number;
  searchRequests: number;
  userRequests: number;
}

interface DetailedMetrics extends RequestMetrics {
  rateLimiter: {
    current: number;
    max: number;
    utilization: string;
  };
  auth: {
    status: string;
    failures: number;
    lastCheck: string;
    tokenExpiry: string | null;
  };
  requestTypes: {
    search: number;
    user: number;
    searchRatio: string;
  };
}

interface RateLimitCheck {
  allowed: boolean;
  waitTime: number;
}

interface AuthValidation {
  valid: boolean;
  error?: string;
}

interface RequestError extends Error {
  status?: number;
  response?: unknown;
}

// Plugin settings interface for Simkl-specific fields
interface SimklPluginSettings {
  simklAccessToken: string;
  [key: string]: unknown;
}

// Simkl authentication interface
interface SimklAuth {
  ensureValidToken(): Promise<boolean>;
}

// Plugin interface with required methods and properties
interface ZoroPlugin extends Plugin {
  settings: SimklPluginSettings;
  simklAuth?: SimklAuth;
}

export class SimklRequest {
  private readonly config: SimklRequestConfig;
  private readonly plugin: ZoroPlugin;
  private readonly rateLimiter: RateLimiter;
  private readonly authState: AuthState;
  private readonly metrics: RequestMetrics;

  // Context tracking for request-specific behavior
  private lastRequestWasSearch: boolean = false;
  private lastErrorWasRateLimit: boolean = false;

  constructor(config: SimklRequestConfig, plugin: ZoroPlugin) {
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

  checkRateLimit(): RateLimitCheck {
    const now = Date.now();
    
    // Remove requests outside the current window
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    // Calculate max allowed requests with buffer
    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.simklConfig.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { 
        allowed: false, 
        waitTime: Math.max(waitTime, 1500) // Slightly longer wait than AniList
      };
    }

    // Add current request to tracking
    this.rateLimiter.requests.push(now);
    this.authState.lastRequest = now;
    return { allowed: true, waitTime: 0 };
  }

  async validateAuth(): Promise<AuthValidation> {
    const now = Date.now();
    
    // Skip auth validation for search requests (they don't require auth)
    if (this.lastRequestWasSearch) {
      return { valid: true };
    }
    
    // Skip validation if recently checked
    if (now - this.authState.lastAuthCheck < this.authState.authCheckInterval) {
      return { valid: true };
    }

    try {
      // Try to validate token through Simkl auth handler
      if (this.plugin.simklAuth && typeof this.plugin.simklAuth.ensureValidToken === 'function') {
        await this.plugin.simklAuth.ensureValidToken();
        this.authState.lastAuthCheck = now;
        this.authState.consecutiveAuthFailures = 0;
        return { valid: true };
      }

      // Fallback check for access token presence
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
      const errorMessage = error instanceof Error ? error.message : 'Simkl authentication failed';
      return { 
        valid: false, 
        error: errorMessage
      };
    }
  }

  shouldRetry(error: RequestError, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) return false;
    
    // Simkl-specific error handling
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return attempt < 2; // Only retry rate limits once
    }
    
    if (error.message.includes('auth') || error.message.includes('401') || error.message.includes('403')) {
      return attempt < this.config.simklConfig.maxAuthRetries;
    }
    
    // Server errors (5xx) - retry
    if (error.status && error.status >= 500 && error.status < 600) return true;
    
    // Client errors (4xx except auth) - don't retry
    if (error.status && error.status >= 400 && error.status < 500) return false;
    
    // Network/timeout errors - retry
    if (error.message.includes('timeout') || error.message.includes('network')) return true;
    
    return true;
  }

  getRetryDelay(attempt: number): number {
    const baseDelay = 600; // faster base for Simkl
    const maxDelay = 6000;
    
    // Ensure minimum spacing between requests
    const timeSinceLastRequest = Date.now() - this.authState.lastRequest;
    if (timeSinceLastRequest < 500) {
      return Math.max(baseDelay, 800);
    }
    
    // Increase delay if we have consecutive auth failures
    if (this.authState.consecutiveAuthFailures > 0) {
      return baseDelay * (1 + this.authState.consecutiveAuthFailures * 0.5);
    }
    
    // Special handling for rate limit errors
    if (this.lastErrorWasRateLimit) {
      return Math.max(baseDelay * 2, 3000);
    }
    
    // Standard exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 800;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  updateMetrics(processingTime: number, isError: boolean = false): void {
    this.metrics.requests++;
    
    if (isError) {
      this.metrics.errors++;
    } else {
      // Update running average of response times
      this.metrics.avgTime = (this.metrics.avgTime + processingTime) / 2;
    }
    
    // Track request types for better insights
    if (this.lastRequestWasSearch) {
      this.metrics.searchRequests++;
    } else {
      this.metrics.userRequests++;
    }
  }

  getUtilization(): string {
    const utilizationPercent = (this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100;
    return `${utilizationPercent.toFixed(1)}%`;
  }

  getAuthStatus(): 'healthy' | 'degraded' | 'unhealthy' {
    if (this.authState.consecutiveAuthFailures === 0) return 'healthy';
    if (this.authState.consecutiveAuthFailures < 3) return 'degraded';
    return 'unhealthy';
  }

  // Simkl-specific method to set request context
  setRequestContext(isSearch: boolean = false): void {
    this.lastRequestWasSearch = isSearch;
  }

  // Simkl-specific method to handle rate limit errors
  handleRateLimitError(): void {
    this.lastErrorWasRateLimit = true;
    setTimeout(() => {
      this.lastErrorWasRateLimit = false;
    }, 30000); // Reset flag after 30 seconds
  }

  // Method to update token expiry information
  updateTokenExpiry(expiresIn: number): void {
    if (expiresIn) {
      this.authState.tokenExpiry = Date.now() + (expiresIn * 1000);
    }
  }

  // Get detailed metrics including Simkl-specific data
  getDetailedMetrics(): DetailedMetrics {
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

  // Additional utility methods for monitoring
  getMetrics(): Readonly<RequestMetrics> {
    return { ...this.metrics };
  }

  getRateLimitStatus(): { 
    current: number; 
    max: number; 
    utilization: string;
    resetIn: number;
  } {
    const now = Date.now();
    const oldestRequest = this.rateLimiter.requests.length > 0 
      ? Math.min(...this.rateLimiter.requests) 
      : now;
    const resetIn = Math.max(0, this.rateLimiter.windowMs - (now - oldestRequest));

    return {
      current: this.rateLimiter.requests.length,
      max: this.rateLimiter.maxRequests,
      utilization: this.getUtilization(),
      resetIn
    };
  }

  getAuthMetrics(): {
    consecutiveFailures: number;
    totalAuthErrors: number;
    lastCheck: Date | null;
    status: 'healthy' | 'degraded' | 'unhealthy';
    tokenExpiry: Date | null;
  } {
    return {
      consecutiveFailures: this.authState.consecutiveAuthFailures,
      totalAuthErrors: this.metrics.authErrors,
      lastCheck: this.authState.lastAuthCheck > 0 ? new Date(this.authState.lastAuthCheck) : null,
      status: this.getAuthStatus(),
      tokenExpiry: this.authState.tokenExpiry ? new Date(this.authState.tokenExpiry) : null
    };
  }

  // Reset metrics (useful for testing or periodic cleanup)
  resetMetrics(): void {
    this.metrics.requests = 0;
    this.metrics.errors = 0;
    this.metrics.avgTime = 0;
    this.metrics.authErrors = 0;
    this.metrics.searchRequests = 0;
    this.metrics.userRequests = 0;
  }

  // Reset auth failure tracking
  resetAuthState(): void {
    this.authState.consecutiveAuthFailures = 0;
    this.authState.lastAuthCheck = 0;
  }

  // Get error rate as percentage
  getErrorRate(): number {
    return this.metrics.requests > 0 
      ? (this.metrics.errors / this.metrics.requests) * 100 
      : 0;
  }

  // Get auth error rate as percentage
  getAuthErrorRate(): number {
    return this.metrics.requests > 0 
      ? (this.metrics.authErrors / this.metrics.requests) * 100 
      : 0;
  }

  // Get search request ratio
  getSearchRequestRatio(): number {
    return this.metrics.requests > 0 
      ? (this.metrics.searchRequests / this.metrics.requests) * 100 
      : 0;
  }
}
