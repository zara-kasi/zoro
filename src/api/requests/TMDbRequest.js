// No obsidian import needed

class TMDbRequest {
	constructor(config) {
		this.config = config;
		this.rateLimiter = {
			requests: [],
			windowMs: 60000,
			maxRequests: 100,
			remaining: 100
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

		const buffer = (this.config?.tmdbConfig?.rateLimitBuffer ?? this.config.rateLimitBuffer) || 0.9;
		const maxAllowed = Math.floor(this.rateLimiter.maxRequests * buffer);
		
		if (this.rateLimiter.requests.length >= maxAllowed) {
			const oldestRequest = Math.min(...this.rateLimiter.requests);
			const waitTime = this.rateLimiter.windowMs - (now - oldestRequest);
			return { allowed: false, waitTime: Math.max(waitTime, 500) };
		}

		this.rateLimiter.requests.push(now);
		return { allowed: true, waitTime: 0 };
	}

	shouldRetry(error, attempt, maxAttempts) {
		if (attempt >= maxAttempts) return false;
		const msg = String(error?.message || '').toLowerCase();
		if (msg.includes('timeout') || msg.includes('network')) return true;
		if (msg.includes('429') || msg.includes('rate limit')) return attempt < 2;
		if (error.status >= 500 && error.status < 600) return true;
		if (error.status >= 400 && error.status < 500) return false;
		return true;
	}

	getRetryDelay(attempt) {
		const baseDelay = 500;
		const maxDelay = 8000;
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
	}

	getUtilization() {
		return `${((this.rateLimiter.requests.length / this.rateLimiter.maxRequests) * 100).toFixed(1)}%`;
	}
}

export { TMDbRequest };