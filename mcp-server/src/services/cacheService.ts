/**
 * Cache service for persisting index and sync state to disk
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { RepoIndex, SyncState, CURRENT_INDEX_VERSION, createEmptyIndex, createEmptySyncState } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class CacheService {
  private cacheDir: string;
  private indexPath: string;
  private syncStatePath: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.indexPath = path.join(cacheDir, 'index.json');
    this.syncStatePath = path.join(cacheDir, 'sync-state.json');
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.error('CacheService', 'Failed to create cache directory', error);
    }
  }

  /**
   * Load index from disk
   */
  async loadIndex(): Promise<RepoIndex | null> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      const index = JSON.parse(content) as RepoIndex;

      // Validate schema version
      if (index.version !== CURRENT_INDEX_VERSION) {
        logger.info('CacheService', `Index version mismatch (${index.version} vs ${CURRENT_INDEX_VERSION}), will rebuild`);
        return null;
      }

      logger.info('CacheService', `Loaded cached index with ${index.repos.length} repos and ${index.wikiDocuments.length} wiki docs`);
      return index;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('CacheService', 'No cached index found');
      } else {
        logger.warn('CacheService', 'Failed to load index, will rebuild', error);
      }
      return null;
    }
  }

  /**
   * Save index to disk
   */
  async saveIndex(index: RepoIndex): Promise<void> {
    try {
      await this.ensureCacheDir();
      const content = JSON.stringify(index, null, 2);
      await fs.writeFile(this.indexPath, content, 'utf-8');
      logger.info('CacheService', `Saved index with ${index.repos.length} repos`);
    } catch (error) {
      logger.error('CacheService', 'Failed to save index', error);
    }
  }

  /**
   * Load sync state from disk
   */
  async loadSyncState(): Promise<SyncState> {
    try {
      const content = await fs.readFile(this.syncStatePath, 'utf-8');
      return JSON.parse(content) as SyncState;
    } catch {
      return createEmptySyncState();
    }
  }

  /**
   * Save sync state to disk
   */
  async saveSyncState(state: SyncState): Promise<void> {
    try {
      await this.ensureCacheDir();
      const content = JSON.stringify(state, null, 2);
      await fs.writeFile(this.syncStatePath, content, 'utf-8');
    } catch (error) {
      logger.error('CacheService', 'Failed to save sync state', error);
    }
  }

  /**
   * Check if the cached index is stale
   */
  isIndexStale(index: RepoIndex | null, maxAgeMinutes: number): boolean {
    if (!index) return true;

    const lastIndexTime = new Date(index.lastFullIndex).getTime();
    const now = Date.now();
    const ageMinutes = (now - lastIndexTime) / (1000 * 60);

    return ageMinutes > maxAgeMinutes;
  }

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    try {
      await fs.unlink(this.indexPath).catch(() => {});
      await fs.unlink(this.syncStatePath).catch(() => {});
      logger.info('CacheService', 'Cache cleared');
    } catch (error) {
      logger.error('CacheService', 'Failed to clear cache', error);
    }
  }
}
