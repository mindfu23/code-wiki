/**
 * Abstract base class for metric collectors.
 * Wraps doCollect() in error handling and logging.
 */

import { logger } from '../../utils/logger.js';

export abstract class BaseCollector<T> {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  async collect(): Promise<T | null> {
    const startTime = Date.now();
    try {
      logger.info(this.name, 'Starting collection');
      const result = await this.doCollect();
      const duration = Date.now() - startTime;
      logger.info(this.name, `Collection complete in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(this.name, `Collection failed after ${duration}ms`, error);
      return null;
    }
  }

  protected abstract doCollect(): Promise<T>;
}
