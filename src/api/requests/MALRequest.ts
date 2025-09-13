import type { Plugin } from 'obsidian';

// Configuration and state interfaces
interface MALRequestConfig {
  malConfig: {
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
}

interface RequestMetrics {
  requests: number;
  errors: number;
  avgTime: number;
  authErrors: number;
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

// Plugin settings interface for MAL-specific fields
interface MALPluginSettings {
  malAccessToken: string;
  [key: string]: unknown;
}

// MAL authentication interface
interface MALAuth {
  ensureValidToken(): Promise<boolean>;
}

// Plugin interface with required methods and properties
interface ZoroPlugin extends Plugin {
  settings: MALPluginSettings;
  malAuth?: MALAuth;
}

export class MALRequest {
  private readonly config: MALRequestConfig;
  private readonly plugin: ZoroPlugin;
  private readonly rateLimiter: RateLimiter;
  private readonly authState: AuthState;
  private readonly metrics: RequestMetrics;

  constructor(config: MALRequestConfig, plugin: ZoroPlugin) {
    this.config = config;
    this.plugin = plugin;
    
    this.rateLimiter = {
      requests: [],
      windowMs: 60000, // 1 minute window
      maxRequests: 60, // MAL API limit (lower than AniList)
      remaining: 60
    };
    
    this.authState = {
      lastAuthCheck: 0,
      authCheckInterval: 300000, // 5 minutes
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

  checkRateLimit(): RateLimitCheck {
    const now = Date.now();
    
    // Remove requests outside the current window
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    // Calculate max allowed requests with buffer
    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.malConfig.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { 
        allowed: false, 
        waitTime: Math.max(waitTime, 2000) // Minimum 2 second wait for MAL
      };
    }

    // Add current request to tracking
    this.rateLimiter.requests.push(now);
    this.authState.lastRequest = now;
    return { allowed: true, waitTime: 0 };
  }

  async validateAuth(): Promise<AuthValidation> {
    const now = Date.now();
    
    // Skip validation if recently checked
    if (now - this.authState.lastAuthCheck < this.authState.authCheckInterval) {
      return { valid: true };
    }

    try {
      // Try to validate token through MAL auth handler
      if (this.plugin.malAuth && typeof this.plugin.malAuth.ensureValidToken === 'function') {
        await this.plugin.malAuth.ensureValidToken();
        this.authState.lastAuthCheck = now;
        this.authState.consecutiveAuthFailures = 0;
        return { valid: true };
      }

      // Fallback check for access token presence
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
      const errorMessage = error instanceof Error ? error.message : 'MAL authentication failed';
      return { 
        valid: false, 
        error: errorMessage
      };
    }
  }

  shouldRetry(error: RequestError, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) return false;
    
    // Special handling for authentication errors
    if (error.message.includes('auth') || error.message.includes('401')) {
      return attempt < this.config.malConfig.maxAuthRetries;
    }
    
    // Don't retry client errors (4xx) except auth
    if (error.status && error.status >= 400 && error.status < 500) return false;
    
    // Retry on timeout errors
    if (error.message.includes('timeout')) return true;
    
    // Retry on server errors (5xx) and network errors
    return true;
  }

  getRetryDelay(attempt: number): number {
    const baseDelay = 2000; // 2 second base (higher than AniList)
    const maxDelay = 15000; // 15 second max
    
    // Ensure minimum spacing between requests
    const timeSinceLastRequest = Date.now() - this.authState.lastRequest;
    if (timeSinceLastRequest < 1000) {
      return Math.max(baseDelay, 1500);
    }
    
    // Increase delay if we have consecutive auth failures
    if (this.authState.consecutiveAuthFailures > 0) {
      return baseDelay * (1 + this.authState.consecutiveAuthFailures * 0.5);
    }
    
    // Standard exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
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
  }

  getUtilization(): string {
    const utilizationPercent = (this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100;
    return `${utilizationPercent.toFixed(1)}%`;
  }

  getAuthStatus(): 'healthy' | 'degraded' {
    return this.authState.consecutiveAuthFailures === 0 ? 'healthy' : 'degraded';
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
    status: 'healthy' | 'degraded';
  } {
    return {
      consecutiveFailures: this.authState.consecutiveAuthFailures,
      totalAuthErrors: this.metrics.authErrors,
      lastCheck: this.authState.lastAuthCheck > 0 ? new Date(this.authState.lastAuthCheck) : null,
      status: this.getAuthStatus()
    };
  }

  // Reset metrics (useful for testing or periodic cleanup)
  resetMetrics(): void {
    this.metrics.requests = 0;
    this.metrics.errors = 0;
    this.metrics.avgTime = 0;
    this.metrics.authErrors = 0;
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
}

