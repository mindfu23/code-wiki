/**
 * Rate limiter with exponential backoff for GitHub API calls
 */

import { RateLimitConfig } from '../types/index.js';
import { logger } from './logger.js';

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    return status === 403 || status === 429;
  }
  return false;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private lastCallTime = 0;
  private minIntervalMs = 100; // Minimum time between calls

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async withBackoff<T>(fn: () => Promise<T>, context = 'API'): Promise<T> {
    let retryCount = 0;

    while (true) {
      // Ensure minimum interval between calls
      const now = Date.now();
      const timeSinceLastCall = now - this.lastCallTime;
      if (timeSinceLastCall < this.minIntervalMs) {
        await sleep(this.minIntervalMs - timeSinceLastCall);
      }

      try {
        this.lastCallTime = Date.now();
        const result = await fn();
        return result;
      } catch (error) {
        if (isRateLimitError(error) && retryCount < this.config.maxRetries) {
          retryCount++;
          const delay = Math.min(
            this.config.baseDelayMs * Math.pow(2, retryCount - 1),
            this.config.maxDelayMs
          );
          logger.warn('RateLimiter', `Rate limited, retry ${retryCount}/${this.config.maxRetries} after ${delay}ms`, { context });
          await sleep(delay);
        } else {
          throw error;
        }
      }
    }
  }
}

export const globalRateLimiter = new RateLimiter();
