import { Notice } from 'obsidian';

class ZoroError {
  // Singleton pattern - only one error handler instance per plugin
  static instance(plugin) {
    if (!ZoroError._singleton) ZoroError._singleton = new ZoroError(plugin);
    return ZoroError._singleton;
  }

  constructor(plugin) {
    this.plugin = plugin;
    this.noticeRateLimit = new Map(); // track when we last showed each error message
    this.recoveryStrategies = new Map(); // different ways to handle failures
    this.initRecoveryStrategies(); // set up the recovery options
  }

  // Main way to show error messages to users - keeps them friendly and not spammy
  static notify(message, severity = 'error', duration = null) {
    const instance = ZoroError.instance();
    
    // Don't spam the user with the same error over and over
    if (!instance.isRateLimited(message)) {
      const userMessage = instance.getUserMessage(message, severity);
      const noticeDuration = duration || instance.getNoticeDuration(severity);
      new Notice(userMessage, noticeDuration); // show the popup notification
    }
    
    // Still log everything to console so developers can debug
    if (severity === 'error' || severity === 'fatal') {
      console.error(`[Zoro] ${message}`);
    }
    
    return new Error(message); // return actual Error object
  }

  // Wraps risky functions and tries to recover automatically before bothering the user
  static async guard(fn, recoveryStrategy = null) {
    const instance = ZoroError.instance();
    
    try {
      return await fn(); // try the original function first
    } catch (error) {
      // Something went wrong - let's see if we can fix it silently
      if (recoveryStrategy && instance.recoveryStrategies.has(recoveryStrategy)) {
        try {
          const result = await instance.recoveryStrategies.get(recoveryStrategy)(error, fn);
          if (result !== null) return result; // recovery worked!
        } catch (recoveryError) {
          // Recovery failed too, oh well we tried
        }
      }
      
      // Couldn't fix it automatically, so tell the user nicely
      const userMessage = instance.getUserMessage(error.message || String(error), 'error');
      if (!instance.isRateLimited(error.message)) {
        new Notice(userMessage, 6000);
      }
      
      throw error; // still throw the original error for code that needs to handle it
    }
  }

  // Keep trying something a few times before giving up - useful for network stuff
  static async withRetry(fn, maxRetries = 2) {
    const instance = ZoroError.instance();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(); // maybe it'll work this time
      } catch (error) {
        if (attempt === maxRetries) {
          // Okay we really tried, time to give up
          const message = `Operation failed after ${maxRetries} attempts`;
          ZoroError.notify(message, 'error');
          throw error;
        }
        
        // Wait a bit before trying again, longer each time
        await instance.sleep(1000 * attempt);
      }
    }
  }

  // Set up different ways to handle common problems
  initRecoveryStrategies() {
    // If network is down, try using cached data instead
    this.recoveryStrategies.set('cache', async (error, originalFn) => {
      if (this.isNetworkError(error)) {
        const cachedResult = this.plugin.cache?.getLastKnown?.();
        if (cachedResult) {
          ZoroError.notify('Using offline data', 'info', 3000); // let user know we're using old data
          return cachedResult;
        }
      }
      return null; // couldn't recover this way
    });

    // For temporary problems, wait a bit and try once more
    this.recoveryStrategies.set('retry', async (error, originalFn) => {
      if (this.isTemporaryError(error)) {
        await this.sleep(1500); // give it a moment
        return await originalFn(); // try again
      }
      return null;
    });

    // When all else fails, return something basic that won't crash the app
    this.recoveryStrategies.set('degrade', async (error) => {
      return { error: true, message: 'Limited functionality available' };
    });
  }

  // Turn scary technical error messages into friendly user messages
  getUserMessage(message, severity) {
    const lowerMessage = message.toLowerCase();
    
    // Internet problems - very common
    if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || 
        lowerMessage.includes('connection') || lowerMessage.includes('timeout')) {
      return '🌐 Connection issue. Check your internet and try again.';
    }
    
    // Login/permission issues
    if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized') || 
        lowerMessage.includes('forbidden')) {
      return '🔑 Login required. Please check your credentials.';
    }
    
    // Being rate limited by APIs
    if (lowerMessage.includes('rate') || lowerMessage.includes('too many')) {
      return '🚦 Please wait a moment before trying again.';
    }
    
    // Cache problems
    if (lowerMessage.includes('cache')) {
      return '💾 Data refresh needed. Please try again.';
    }
    
    // Server is having a bad day
    if (lowerMessage.includes('server') || lowerMessage.includes('503') || 
        lowerMessage.includes('502') || lowerMessage.includes('500')) {
      return '🔧 Service temporarily unavailable. Please try again later.';
    }
    
    // Generic messages with nice emojis based on how bad it is
    const prefixes = {
      fatal: '🧨 Critical error occurred',   // really bad
      error: '❌ Something went wrong',       // bad but not end of world
      warn: '⚠️ Minor issue detected',        // heads up
      info: 'ℹ️ Information'                 // just FYI
    };
    
    return `${prefixes[severity] || prefixes.error}. Please try again.`;
  }

  // Don't spam users with the same error message over and over
  isRateLimited(message) {
    const now = Date.now();
    const key = this.getMessageKey(message); // normalize the message
    const lastShown = this.noticeRateLimit.get(key) || 0;
    
    if (now - lastShown < 5000) { // 5 seconds cooldown
      return true; // too soon, don't show again
    }
    
    this.noticeRateLimit.set(key, now); // remember when we showed this
    
    // Don't let the rate limit map get too big and eat memory
    if (this.noticeRateLimit.size > 50) {
      this.cleanupRateLimit();
    }
    
    return false; // okay to show this message
  }

  // How long to show different types of notifications
  getNoticeDuration(severity) {
    const durations = {
      fatal: 10000,  // critical stuff stays longer
      error: 6000,   // regular errors
      warn: 4000,    // warnings are shorter
      info: 3000     // info disappears quickly
    };
    return durations[severity] || 5000; // default 5 seconds
  }

  // Check if this looks like a network problem
  isNetworkError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('network') || message.includes('fetch') || 
           message.includes('timeout') || message.includes('connection');
  }

  // Check if this is probably temporary and worth retrying
  isTemporaryError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('temporary') || message.includes('retry') ||
           message.includes('503') || message.includes('502'); // common temporary HTTP errors
  }

  // Create a simplified version of error messages for rate limiting
  // This way "Error 404 on page 1" and "Error 404 on page 2" are treated as the same
  getMessageKey(message) {
    return message.replace(/\d+/g, '').replace(/[^\w\s]/g, '').trim().toLowerCase();
  }

  // Clean up old rate limit entries so we don't leak memory
  cleanupRateLimit() {
    const now = Date.now();
    const cutoff = now - 60000; // anything older than 1 minute
    
    for (const [key, timestamp] of this.noticeRateLimit.entries()) {
      if (timestamp < cutoff) {
        this.noticeRateLimit.delete(key); // remove old entries
      }
    }
  }

  // Simple promise-based sleep function
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clean up when the plugin gets disabled
  destroy() {
    this.noticeRateLimit.clear();
    this.recoveryStrategies.clear();
  }
}

export { ZoroError };