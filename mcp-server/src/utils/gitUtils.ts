/**
 * Git utilities using simple-git
 */

import { simpleGit, SimpleGit } from 'simple-git';
import { GitStatus, PullResult, CloneResult } from '../types/index.js';
import { logger } from './logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const gitDir = path.join(dirPath, '.git');
    const stat = await fs.stat(gitDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get git status for a repository
 */
export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  const git: SimpleGit = simpleGit(repoPath);

  try {
    const status = await git.status();
    const branch = status.current || 'unknown';

    return {
      ahead: status.ahead,
      behind: status.behind,
      hasChanges: !status.isClean(),
      currentBranch: branch,
    };
  } catch (error) {
    logger.error('gitUtils', `Failed to get status for ${repoPath}`, error);
    return {
      ahead: 0,
      behind: 0,
      hasChanges: false,
      currentBranch: 'unknown',
    };
  }
}

/**
 * Get the remote URL for a repository
 */
export async function getRemoteUrl(repoPath: string): Promise<string | undefined> {
  const git: SimpleGit = simpleGit(repoPath);

  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    return origin?.refs?.fetch;
  } catch (error) {
    logger.debug('gitUtils', `No remote found for ${repoPath}`);
    return undefined;
  }
}

/**
 * Get the latest commit info
 */
export async function getLatestCommit(repoPath: string): Promise<{ sha: string; date: string } | undefined> {
  const git: SimpleGit = simpleGit(repoPath);

  try {
    const log = await git.log({ maxCount: 1 });
    if (log.latest) {
      return {
        sha: log.latest.hash,
        date: log.latest.date,
      };
    }
  } catch (error) {
    logger.debug('gitUtils', `Failed to get latest commit for ${repoPath}`);
  }
  return undefined;
}

/**
 * Fetch updates from remote
 */
export async function fetchUpdates(repoPath: string): Promise<boolean> {
  const git: SimpleGit = simpleGit(repoPath);

  try {
    await git.fetch();
    return true;
  } catch (error) {
    logger.warn('gitUtils', `Failed to fetch ${repoPath}`, error);
    return false;
  }
}

/**
 * Pull updates from remote
 */
export async function pullUpdates(repoPath: string): Promise<PullResult> {
  const git: SimpleGit = simpleGit(repoPath);

  try {
    const result = await git.pull();
    const updated = result.summary.changes > 0 || result.summary.insertions > 0 || result.summary.deletions > 0;

    return {
      success: true,
      updated,
      message: updated
        ? `Updated: ${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`
        : 'Already up to date',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('gitUtils', `Failed to pull ${repoPath}`, error);
    return {
      success: false,
      updated: false,
      message,
    };
  }
}

/**
 * Clone a repository
 */
export async function cloneRepo(url: string, targetDir: string): Promise<CloneResult> {
  try {
    await simpleGit().clone(url, targetDir);
    return {
      success: true,
      path: targetDir,
      message: `Cloned to ${targetDir}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('gitUtils', `Failed to clone ${url}`, error);
    return {
      success: false,
      path: targetDir,
      message,
    };
  }
}

/**
 * Find all git repositories in a directory (non-recursive, only immediate children)
 */
export async function findGitRepos(parentDir: string): Promise<string[]> {
  const repos: string[] = [];

  try {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const repoPath = path.join(parentDir, entry.name);
        if (await isGitRepo(repoPath)) {
          repos.push(repoPath);
        }
      }
    }
  } catch (error) {
    logger.error('gitUtils', `Failed to scan ${parentDir}`, error);
  }

  return repos;
}
