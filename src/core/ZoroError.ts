/**
 * ZoroError - Error handling and user notification system
 * Migrated from ZoroError.js → ZoroError.ts
 * - Added types for plugin, recovery strategies, and error handling
 * - Converted singleton pattern with proper typing
 * - Added interfaces for recovery functions and error categories
 */

import { Notice } from 'obsidian';
import type { Plugin } from 'obsidian';

type ErrorSeverity = 'fatal' | 'error' | 'warn' | 'info';

type RecoveryResult<T = unknown> = T | null;

type RecoveryFunction<T = unknown> = (
  error: Error, 
  originalFn: () => Promise<T>
) => Promise<RecoveryResult<T>>;

interface CacheProvider {
  getLastKnown?(): unknown;
}

interface PluginWithCache extends Plugin {
  cache?: CacheProvider;
}

export class ZoroError {
  private static _singleton: ZoroError | null = null;
  
  private readonly plugin: PluginWithCache;
  private readonly noticeRateLimit = new Map<string, number>();
  private readonly recoveryStrategies = new Map<string, RecoveryFunction>();

  // Singleton pattern - only one error handler instance per plugin
  static instance(plugin?: PluginWithCache): ZoroError {
    if (!ZoroError._singleton) {
      if (!plugin) {
        throw new Error('ZoroError singleton requires plugin instance on first call');
      }
      ZoroError._singleton = new ZoroError(plugin);
    }
    return ZoroError._singleton;
  }

  private constructor(plugin: PluginWithCache) {
    this.plugin = plugin;
    this.initRecoveryStrategies();
  }

  // Main way to show error messages to users - keeps them friendly and not spammy
  static notify(message: string, severity: ErrorSeverity = 'error', duration: number | null = null): Error {
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
  static async guard<T>(
    fn: () => Promise<T>, 
    recoveryStrategy: string | null = null
  ): Promise<T> {
    const instance = ZoroError.instance();
    
    try {
      return await fn(); // try the original function first
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      // Something went wrong - let's see if we can fix it silently
      if (recoveryStrategy && instance.recoveryStrategies.has(recoveryStrategy)) {
        try {
          const recoveryFn = instance.recoveryStrategies.get(recoveryStrategy)!;
          const result = await recoveryFn(err, fn);
          if (result !== null) return result as T; // recovery worked!
        } catch (recoveryError) {
          // Recovery failed too, oh well we tried
        }
      }
      
      // Couldn't fix it automatically, so tell the user nicely
      const userMessage = instance.getUserMessage(err.message || String(err), 'error');
      if (!instance.isRateLimited(err.message)) {
        new Notice(userMessage, 6000);
      }
      
      throw err; // still throw the original error for code that needs to handle it
    }
  }

  // Keep trying something a few times before giving up - useful for network stuff
  static async withRetry<T>(fn: () => Promise<T>, maxRetries: number = 2): Promise<T> {
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
    
    // TypeScript requires this but it should never be reached
    throw new Error('Unreachable code in withRetry');
  }

  // Set up different ways to handle common problems
  private initRecoveryStrategies(): void {
    // If network is down, try using cached data instead
    this.recoveryStrategies.set('cache', async (error: Error) => {
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
    this.recoveryStrategies.set('retry', async (error: Error, originalFn) => {
      if (this.isTemporaryError(error)) {
        await this.sleep(1500); // give it a moment
        return await originalFn(); // try again
      }
      return null;
    });

    // When all else fails, return something basic that won't crash the app
    this.recoveryStrategies.set('degrade', async () => {
      return { error: true, message: 'Limited functionality available' };
    });
  }

  // Turn scary technical error messages into friendly user messages
  private getUserMessage(message: string, severity: ErrorSeverity): string {
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
    const prefixes: Record<ErrorSeverity, string> = {
      fatal: '🧨 Critical error occurred',   // really bad
      error: '❌ Something went wrong',       // bad but not end of world
      warn: '⚠️ Minor issue detected',        // heads up
      info: 'ℹ️ Information'                 // just FYI
    } as const;
    
    return `${prefixes[severity] || prefixes.error}. Please try again.`;
  }

  // Don't spam users with the same error message over and over
  private isRateLimited(message: string): boolean {
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
  private getNoticeDuration(severity: ErrorSeverity): number {
    const durations: Record<ErrorSeverity, number> = {
      fatal: 10000,  // critical stuff stays longer
      error: 6000,   // regular errors
      warn: 4000,    // warnings are shorter
      info: 3000     // info disappears quickly
    } as const;
    return durations[severity] || 5000; // default 5 seconds
  }

  // Check if this looks like a network problem
  private isNetworkError(error: Error): boolean {
    const message = error.message?.toLowerCase() || '';
    return message.includes('network') || message.includes('fetch') || 
           message.includes('timeout') || message.includes('connection');
  }

  // Check if this is probably temporary and worth retrying
  private isTemporaryError(error: Error): boolean {
    const message = error.message?.toLowerCase() || '';
    return message.includes('temporary') || message.includes('retry') ||
           message.includes('503') || message.includes('502'); // common temporary HTTP errors
  }

  // Create a simplified version of error messages for rate limiting
  // This way "Error 404 on page 1" and "Error 404 on page 2" are treated as the same
  private getMessageKey(message: string): string {
    return message.replace(/\d+/g, '').replace(/[^\w\s]/g, '').trim().toLowerCase();
  }

  // Clean up old rate limit entries so we don't leak memory
  private cleanupRateLimit(): void {
    const now = Date.now();
    const cutoff = now - 60000; // anything older than 1 minute
    
    for (const [key, timestamp] of this.noticeRateLimit.entries()) {
      if (timestamp < cutoff) {
        this.noticeRateLimit.delete(key); // remove old entries
      }
    }
  }

  // Simple promise-based sleep function
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clean up when the plugin gets disabled
  destroy(): void {
    this.noticeRateLimit.clear();
    this.recoveryStrategies.clear();
    ZoroError._singleton = null;
  }
}
