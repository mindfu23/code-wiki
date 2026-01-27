/**
 * Sync service for GitHub repository synchronization
 */

import * as path from 'path';
import { Config, GitHubRepo, SyncState, SyncReport, SyncError, RepoSyncState, createEmptySyncState } from '../types/index.js';
import { CacheService } from './cacheService.js';
import { IndexService } from './indexService.js';
import { pullUpdates, cloneRepo, fetchUpdates, getLatestCommit, getGitStatus } from '../utils/gitUtils.js';
import { globalRateLimiter } from '../utils/rateLimiter.js';
import { logger } from '../utils/logger.js';

export class SyncService {
  private config: Config;
  private cacheService: CacheService;
  private indexService: IndexService;
  private syncState: SyncState;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;

  constructor(config: Config, cacheService: CacheService, indexService: IndexService) {
    this.config = config;
    this.cacheService = cacheService;
    this.indexService = indexService;
    this.syncState = createEmptySyncState();
  }

  /**
   * Initialize sync service (load state)
   */
  async initialize(): Promise<void> {
    this.syncState = await this.cacheService.loadSyncState();
  }

  /**
   * Start background sync at configured interval
   */
  startBackgroundSync(intervalMinutes?: number): void {
    const interval = (intervalMinutes || this.config.syncIntervalMinutes) * 60 * 1000;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Initial sync after 30 seconds
    setTimeout(() => {
      this.syncNow().catch(err => {
        logger.error('SyncService', 'Background sync failed', err);
      });
    }, 30000);

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.syncNow().catch(err => {
        logger.error('SyncService', 'Background sync failed', err);
      });
    }, interval);

    logger.info('SyncService', `Background sync started (every ${intervalMinutes || this.config.syncIntervalMinutes} minutes)`);
  }

  /**
   * Stop background sync
   */
  stopBackgroundSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('SyncService', 'Background sync stopped');
    }
  }

  /**
   * Perform immediate sync
   */
  async syncNow(force = false): Promise<SyncReport> {
    if (this.isSyncing) {
      logger.info('SyncService', 'Sync already in progress');
      return {
        checkedAt: new Date().toISOString(),
        reposChecked: 0,
        reposPulled: 0,
        reposCloned: 0,
        errors: [{ repo: '', error: 'Sync already in progress' }],
      };
    }

    this.isSyncing = true;
    const report: SyncReport = {
      checkedAt: new Date().toISOString(),
      reposChecked: 0,
      reposPulled: 0,
      reposCloned: 0,
      errors: [],
    };

    try {
      // Get repos from GitHub if token is available
      let remoteRepos: GitHubRepo[] = [];
      if (this.config.githubUsername && this.config.githubToken) {
        remoteRepos = await this.fetchGitHubRepos();
        report.reposChecked = remoteRepos.length;
      }

      // Check local repos for updates
      const localRepos = this.indexService.getAllRepos();

      for (const localRepo of localRepos) {
        const repoName = localRepo.name;

        // Check if repo needs update by fetching
        const fetched = await fetchUpdates(localRepo.path);
        if (!fetched) {
          continue;
        }

        const status = await getGitStatus(localRepo.path);

        if (status.behind > 0 || force) {
          logger.info('SyncService', `Pulling updates for ${repoName}`);
          const result = await pullUpdates(localRepo.path);

          if (result.success && result.updated) {
            report.reposPulled++;
            // Re-index the updated repo
            await this.indexService.updateRepoIndex(localRepo.path);

            this.syncState.repos[repoName] = {
              name: repoName,
              path: localRepo.path,
              lastPull: new Date().toISOString(),
              lastCommitSha: (await getLatestCommit(localRepo.path))?.sha || '',
              syncStatus: 'synced',
            };
          } else if (!result.success) {
            report.errors.push({ repo: repoName, error: result.message });

            this.syncState.repos[repoName] = {
              ...this.syncState.repos[repoName],
              name: repoName,
              path: localRepo.path,
              syncStatus: 'error',
              errorMessage: result.message,
            };
          }
        }
      }

      // Check for new repos on GitHub that aren't local
      if (remoteRepos.length > 0) {
        const localRepoNames = new Set(localRepos.map(r => r.name));

        for (const remoteRepo of remoteRepos) {
          if (!localRepoNames.has(remoteRepo.name)) {
            // New repo - clone it
            const targetDir = path.join(this.config.sourceDirectories[0], remoteRepo.name);
            logger.info('SyncService', `Cloning new repo ${remoteRepo.name}`);

            const cloneUrl = this.config.githubToken ? remoteRepo.clone_url : remoteRepo.ssh_url;
            const result = await cloneRepo(cloneUrl, targetDir);

            if (result.success) {
              report.reposCloned++;
              // Index the new repo
              await this.indexService.updateRepoIndex(targetDir);

              this.syncState.repos[remoteRepo.name] = {
                name: remoteRepo.name,
                path: targetDir,
                lastPull: new Date().toISOString(),
                lastCommitSha: '',
                syncStatus: 'synced',
              };
            } else {
              report.errors.push({ repo: remoteRepo.name, error: result.message });
            }
          }
        }
      }

      // Update sync state
      this.syncState.lastFullSync = new Date().toISOString();
      await this.cacheService.saveSyncState(this.syncState);

      logger.info('SyncService', `Sync complete: ${report.reposPulled} pulled, ${report.reposCloned} cloned, ${report.errors.length} errors`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      report.errors.push({ repo: '', error: message });
      logger.error('SyncService', 'Sync failed', error);
    } finally {
      this.isSyncing = false;
    }

    return report;
  }

  /**
   * Fetch list of repositories from GitHub API
   */
  private async fetchGitHubRepos(): Promise<GitHubRepo[]> {
    if (!this.config.githubUsername || !this.config.githubToken) {
      return [];
    }

    try {
      const repos = await globalRateLimiter.withBackoff(async () => {
        const response = await fetch(
          `https://api.github.com/users/${this.config.githubUsername}/repos?sort=pushed&per_page=100&type=owner`,
          {
            headers: {
              Authorization: `Bearer ${this.config.githubToken}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'code-wiki-mcp-server',
            },
          }
        );

        if (!response.ok) {
          const error = new Error(`GitHub API error: ${response.status}`);
          (error as any).status = response.status;
          throw error;
        }

        return response.json() as Promise<GitHubRepo[]>;
      }, 'GitHub API');

      this.syncState.lastApiCall = new Date().toISOString();

      // Filter to only repos owned by the user (not forks unless explicitly owned)
      return repos.filter(repo => {
        const [owner] = repo.full_name.split('/');
        return owner === this.config.githubUsername;
      });
    } catch (error) {
      logger.error('SyncService', 'Failed to fetch GitHub repos', error);
      return [];
    }
  }

  /**
   * Get sync state for a repository
   */
  getRepoSyncState(repoName: string): RepoSyncState | undefined {
    return this.syncState.repos[repoName];
  }

  /**
   * Get last sync time
   */
  getLastSyncTime(): string {
    return this.syncState.lastFullSync;
  }

  /**
   * Check if sync is currently in progress
   */
  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}
