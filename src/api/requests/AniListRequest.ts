/**
 * AniList API request handler with rate limiting and retry logic
 * Migrated from AniListRequest.js → AniListRequest.ts
 * - Added comprehensive types for configuration and metrics
 * - Typed rate limiting and retry mechanisms
 * - Added proper error handling with typed responses
 */

// Configuration and state interfaces
interface AniListRequestConfig {
  rateLimitBuffer: number;
  maxRetries?: number;
  timeoutMs?: number;
}

interface RateLimiter {
  requests: number[];
  readonly windowMs: number;
  readonly maxRequests: number;
  remaining: number;
}

interface RequestMetrics {
  requests: number;
  errors: number;
  avgTime: number;
}

interface RateLimitCheck {
  allowed: boolean;
  waitTime: number;
}

interface RequestError extends Error {
  status?: number;
  response?: unknown;
}

export class AniListRequest {
  private readonly config: AniListRequestConfig;
  private readonly rateLimiter: RateLimiter;
  private readonly metrics: RequestMetrics;

  constructor(config: AniListRequestConfig) {
    this.config = config;
    
    this.rateLimiter = {
      requests: [],
      windowMs: 60000, // 1 minute window
      maxRequests: 90, // AniList API limit
      remaining: 90
    };
    
    this.metrics = {
      requests: 0,
      errors: 0,
      avgTime: 0
    };
  }

  checkRateLimit(): RateLimitCheck {
    const now = Date.now();
    
    // Remove requests outside the current window
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    // Calculate max allowed requests with buffer
    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { 
        allowed: false, 
        waitTime: Math.max(waitTime, 1000) // Minimum 1 second wait
      };
    }

    // Add current request to tracking
    this.rateLimiter.requests.push(now);
    return { allowed: true, waitTime: 0 };
  }

  shouldRetry(error: RequestError, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) return false;
    
    // Retry on timeout errors
    if (error.message.includes('timeout')) return true;
    
    // Don't retry client errors (4xx)
    if (error.status && error.status >= 400 && error.status < 500) return false;
    
    // Retry on server errors (5xx) and network errors
    return true;
  }

  getRetryDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second base
    const maxDelay = 10000; // 10 second max
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add random jitter to avoid thundering herd
    
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

  // Reset metrics (useful for testing or periodic cleanup)
  resetMetrics(): void {
    this.metrics.requests = 0;
    this.metrics.errors = 0;
    this.metrics.avgTime = 0;
  }

  // Get error rate as percentage
  getErrorRate(): number {
    return this.metrics.requests > 0 
      ? (this.metrics.errors / this.metrics.requests) * 100 
      : 0;
  }
}

export { AniListRequest };
