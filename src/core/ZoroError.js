class ZoroError {
  static instance(plugin) {
    if (!ZoroError._singleton) ZoroError._singleton = new ZoroError(plugin);
    return ZoroError._singleton;
  }

  constructor(plugin) {
    this.plugin = plugin;
    this.noticeRateLimit = new Map(); // Prevent notification spam
    this.recoveryStrategies = new Map();
    this.initRecoveryStrategies();
  }

  // Main entry point for creating errors with user notifications
  static notify(message, severity = 'error', duration = null) {
    const instance = ZoroError.instance();
    
    if (!instance.isRateLimited(message)) {
      const userMessage = instance.getUserMessage(message, severity);
      const noticeDuration = duration || instance.getNoticeDuration(severity);
      new Notice(userMessage, noticeDuration);
    }
    
    // Log to console for debugging (developers can check if needed)
    if (severity === 'error' || severity === 'fatal') {
      console.error(`[Zoro] ${message}`);
    }
    
    return new Error(message);
  }

  // Guard function with automatic recovery
  static async guard(fn, recoveryStrategy = null) {
    const instance = ZoroError.instance();
    
    try {
      return await fn();
    } catch (error) {
      // Try recovery first (silent)
      if (recoveryStrategy && instance.recoveryStrategies.has(recoveryStrategy)) {
        try {
          const result = await instance.recoveryStrategies.get(recoveryStrategy)(error, fn);
          if (result !== null) return result;
        } catch (recoveryError) {
          // Recovery failed, fall through to show user error
        }
      }
      
      // Show user-friendly error if recovery failed
      const userMessage = instance.getUserMessage(error.message || String(error), 'error');
      if (!instance.isRateLimited(error.message)) {
        new Notice(userMessage, 6000);
      }
      
      throw error;
    }
  }

  // Retry mechanism for network/temporary failures
  static async withRetry(fn, maxRetries = 2) {
    const instance = ZoroError.instance();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxRetries) {
          // Final attempt failed
          const message = `Operation failed after ${maxRetries} attempts`;
          ZoroError.notify(message, 'error');
          throw error;
        }
        
        // Silent retry with small delay
        await instance.sleep(1000 * attempt);
      }
    }
  }

  // Initialize simple recovery strategies
  initRecoveryStrategies() {
    // Cache fallback for network issues
    this.recoveryStrategies.set('cache', async (error, originalFn) => {
      if (this.isNetworkError(error)) {
        const cachedResult = this.plugin.cache?.getLastKnown?.();
        if (cachedResult) {
          ZoroError.notify('Using offline data', 'info', 3000);
          return cachedResult;
        }
      }
      return null;
    });

    // Simple retry for temporary failures
    this.recoveryStrategies.set('retry', async (error, originalFn) => {
      if (this.isTemporaryError(error)) {
        await this.sleep(1500);
        return await originalFn();
      }
      return null;
    });

    // Graceful degradation
    this.recoveryStrategies.set('degrade', async (error) => {
      return { error: true, message: 'Limited functionality available' };
    });
  }

  // Convert technical errors to user-friendly messages
  getUserMessage(message, severity) {
    const lowerMessage = message.toLowerCase();
    
    // Network issues
    if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || 
        lowerMessage.includes('connection') || lowerMessage.includes('timeout')) {
      return '🌐 Connection issue. Check your internet and try again.';
    }
    
    // Authentication issues
    if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized') || 
        lowerMessage.includes('forbidden')) {
      return '🔑 Login required. Please check your credentials.';
    }
    
    // Rate limiting
    if (lowerMessage.includes('rate') || lowerMessage.includes('too many')) {
      return '🚦 Please wait a moment before trying again.';
    }
    
    // Cache issues
    if (lowerMessage.includes('cache')) {
      return '💾 Data refresh needed. Please try again.';
    }
    
    // Server issues
    if (lowerMessage.includes('server') || lowerMessage.includes('503') || 
        lowerMessage.includes('502') || lowerMessage.includes('500')) {
      return '🔧 Service temporarily unavailable. Please try again later.';
    }
    
    // Default messages based on severity
    const prefixes = {
      fatal: '🧨 Critical error occurred',
      error: '❌ Something went wrong',
      warn: '⚠️ Minor issue detected',
      info: 'ℹ️ Information'
    };
    
    return `${prefixes[severity] || prefixes.error}. Please try again.`;
  }

  // Prevent notification spam
  isRateLimited(message) {
    const now = Date.now();
    const key = this.getMessageKey(message);
    const lastShown = this.noticeRateLimit.get(key) || 0;
    
    if (now - lastShown < 5000) { // 5 second cooldown
      return true;
    }
    
    this.noticeRateLimit.set(key, now);
    
    // Cleanup old entries periodically
    if (this.noticeRateLimit.size > 50) {
      this.cleanupRateLimit();
    }
    
    return false;
  }

  // Get notice duration based on severity
  getNoticeDuration(severity) {
    const durations = {
      fatal: 10000,
      error: 6000,
      warn: 4000,
      info: 3000
    };
    return durations[severity] || 5000;
  }

  // Helper methods
  isNetworkError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('network') || message.includes('fetch') || 
           message.includes('timeout') || message.includes('connection');
  }

  isTemporaryError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('temporary') || message.includes('retry') ||
           message.includes('503') || message.includes('502');
  }

  getMessageKey(message) {
    // Create a simple key for rate limiting (remove numbers and special chars)
    return message.replace(/\d+/g, '').replace(/[^\w\s]/g, '').trim().toLowerCase();
  }

  cleanupRateLimit() {
    const now = Date.now();
    const cutoff = now - 60000; // 1 minute ago
    
    for (const [key, timestamp] of this.noticeRateLimit.entries()) {
      if (timestamp < cutoff) {
        this.noticeRateLimit.delete(key);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup when plugin unloads
  destroy() {
    this.noticeRateLimit.clear();
    this.recoveryStrategies.clear();
  }
}

export { ZoroError };