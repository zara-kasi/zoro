// No obsidian import needed

class AniListRequest {
  constructor(config) {
    this.config = config;
    this.rateLimiter = {
      requests: [],
      windowMs: 60000,
      maxRequests: 90,
      remaining: 90
    };
    this.metrics = {
      requests: 0,
      errors: 0,
      avgTime: 0
    };
  }

  checkRateLimit() {
    const now = Date.now();
    this.rateLimiter.requests = this.rateLimiter.requests.filter(
      time => now - time < this.rateLimiter.windowMs
    );

    const maxAllowed = Math.floor(this.rateLimiter.maxRequests * this.config.rateLimitBuffer);
    
    if (this.rateLimiter.requests.length >= maxAllowed) {
      const oldestRequest = Math.min(...this.rateLimiter.requests);
      const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
      return { allowed: false, waitTime: Math.max(waitTime, 1000) };
    }

    this.rateLimiter.requests.push(now);
    return { allowed: true, waitTime: 0 };
  }

  shouldRetry(error, attempt, maxAttempts) {
    if (attempt >= maxAttempts) return false;
    if (error.message.includes('timeout')) return true;
    if (error.status >= 400 && error.status < 500) return false;
    return true;
  }

  getRetryDelay(attempt) {
    const baseDelay = 1000;
    const maxDelay = 10000;
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
}

export { AniListRequest };