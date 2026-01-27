/**
 * Index service for building and managing the search index
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Config, RepoIndex, RepoMetadata, WikiDocument, createEmptyIndex, CURRENT_INDEX_VERSION } from '../types/index.js';
import { CacheService } from './cacheService.js';
import { WikiService } from './wikiService.js';
import { findGitRepos, getLatestCommit, getRemoteUrl, isGitRepo } from '../utils/gitUtils.js';
import { logger } from '../utils/logger.js';
import { writeRepoLocationsPage } from '../utils/repoLocationsGenerator.js';

// Language detection by file extension
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
};

export class IndexService {
  private config: Config;
  private cacheService: CacheService;
  private wikiService: WikiService;
  private index: RepoIndex;
  private isIndexing = false;

  constructor(config: Config, cacheService: CacheService, wikiService: WikiService) {
    this.config = config;
    this.cacheService = cacheService;
    this.wikiService = wikiService;
    this.index = createEmptyIndex();
  }

  /**
   * Get the current index
   */
  getIndex(): RepoIndex {
    return this.index;
  }

  /**
   * Set the index (used when loading from cache)
   */
  setIndex(index: RepoIndex): void {
    this.index = index;
  }

  /**
   * Check if the current index is stale
   */
  isIndexStale(maxAgeMinutes: number): boolean {
    return this.cacheService.isIndexStale(this.index, maxAgeMinutes);
  }

  /**
   * Build a full index of all repositories and wiki content
   */
  async buildFullIndex(): Promise<RepoIndex> {
    if (this.isIndexing) {
      logger.info('IndexService', 'Index build already in progress');
      return this.index;
    }

    this.isIndexing = true;
    logger.info('IndexService', 'Starting full index build');

    try {
      const repos: RepoMetadata[] = [];

      // Scan all source directories
      for (const sourceDir of this.config.sourceDirectories) {
        logger.info('IndexService', `Scanning ${sourceDir}`);

        // Check if the source directory itself is a git repo
        if (await isGitRepo(sourceDir)) {
          const dirName = path.basename(sourceDir);
          if (!dirName.includes('code-wiki')) {
            const metadata = await this.indexRepo(sourceDir);
            if (metadata) {
              repos.push(metadata);
            }
          }
        }

        // Also scan for repos inside the directory
        const repoPaths = await findGitRepos(sourceDir);

        for (const repoPath of repoPaths) {
          // Skip the code-wiki repo itself to avoid self-referencing
          if (repoPath.includes('code-wiki')) {
            continue;
          }

          const metadata = await this.indexRepo(repoPath);
          if (metadata) {
            repos.push(metadata);
          }
        }
      }

      // Index wiki content
      const wikiDocuments = await this.wikiService.getAllDocuments();

      this.index = {
        repos,
        wikiDocuments,
        lastFullIndex: new Date().toISOString(),
        version: CURRENT_INDEX_VERSION,
      };

      // Save to cache
      await this.cacheService.saveIndex(this.index);

      // Generate repo-locations.md wiki page
      try {
        await writeRepoLocationsPage(repos, this.config);
      } catch (error) {
        logger.warn('IndexService', 'Failed to generate repo-locations.md', error);
      }

      logger.info('IndexService', `Index built: ${repos.length} repos, ${wikiDocuments.length} wiki docs`);
      return this.index;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Index a single repository
   */
  private async indexRepo(repoPath: string): Promise<RepoMetadata | null> {
    try {
      const name = path.basename(repoPath);
      const remoteUrl = await getRemoteUrl(repoPath);
      const commit = await getLatestCommit(repoPath);
      const languages = await this.detectLanguages(repoPath);
      const fileCount = await this.countFiles(repoPath);
      const hasReadme = await this.hasFile(repoPath, 'README.md');
      const description = await this.extractDescription(repoPath);

      return {
        name,
        path: repoPath,
        remoteUrl,
        lastCommit: commit?.sha || 'unknown',
        lastCommitDate: commit?.date || new Date().toISOString(),
        lastIndexed: new Date().toISOString(),
        languages,
        fileCount,
        hasReadme,
        description,
      };
    } catch (error) {
      logger.error('IndexService', `Failed to index ${repoPath}`, error);
      return null;
    }
  }

  /**
   * Detect languages used in a repository
   */
  private async detectLanguages(repoPath: string): Promise<string[]> {
    const languages = new Set<string>();

    try {
      const entries = await this.walkDirectory(repoPath, 2); // Max depth of 2

      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase();
        const lang = LANGUAGE_EXTENSIONS[ext];
        if (lang) {
          languages.add(lang);
        }
      }
    } catch (error) {
      logger.debug('IndexService', `Failed to detect languages for ${repoPath}`);
    }

    return Array.from(languages);
  }

  /**
   * Walk directory to a maximum depth
   */
  private async walkDirectory(dir: string, maxDepth: number, currentDepth = 0): Promise<string[]> {
    if (currentDepth >= maxDepth) return [];

    const results: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden directories and common non-source directories
        if (entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name === 'build' ||
            entry.name === '__pycache__') {
          continue;
        }

        const fullPath = path.join(dir, entry.name);

        if (entry.isFile()) {
          results.push(fullPath);
        } else if (entry.isDirectory()) {
          const subResults = await this.walkDirectory(fullPath, maxDepth, currentDepth + 1);
          results.push(...subResults);
        }
      }
    } catch {
      // Ignore permission errors
    }

    return results;
  }

  /**
   * Count source files in a repository (approximate)
   */
  private async countFiles(repoPath: string): Promise<number> {
    const files = await this.walkDirectory(repoPath, 3);
    return files.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return LANGUAGE_EXTENSIONS[ext] !== undefined;
    }).length;
  }

  /**
   * Check if a file exists in the repo
   */
  private async hasFile(repoPath: string, filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(repoPath, filename));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract description from README or package.json
   */
  private async extractDescription(repoPath: string): Promise<string | undefined> {
    // Try package.json first
    try {
      const pkgPath = path.join(repoPath, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.description) {
        return pkg.description;
      }
    } catch {
      // No package.json or invalid
    }

    // Try README.md
    try {
      const readmePath = path.join(repoPath, 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');
      const lines = content.split('\n');

      // Find first non-heading, non-empty line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') && !trimmed.startsWith('[')) {
          return trimmed.slice(0, 200);
        }
      }
    } catch {
      // No README
    }

    return undefined;
  }

  /**
   * Update index for a single repository
   */
  async updateRepoIndex(repoPath: string): Promise<void> {
    const metadata = await this.indexRepo(repoPath);
    if (!metadata) return;

    // Update or add repo in index
    const existingIndex = this.index.repos.findIndex(r => r.path === repoPath);
    if (existingIndex >= 0) {
      this.index.repos[existingIndex] = metadata;
    } else {
      this.index.repos.push(metadata);
    }

    // Save updated index
    await this.cacheService.saveIndex(this.index);
  }

  /**
   * Refresh wiki documents in the index
   */
  async refreshWikiIndex(): Promise<void> {
    this.index.wikiDocuments = await this.wikiService.getAllDocuments();
    await this.cacheService.saveIndex(this.index);
  }

  /**
   * Get repository by name
   */
  getRepoByName(name: string): RepoMetadata | undefined {
    return this.index.repos.find(r => r.name === name);
  }

  /**
   * Get all repositories
   */
  getAllRepos(): RepoMetadata[] {
    return this.index.repos;
  }

  /**
   * Get all wiki documents
   */
  getAllWikiDocuments(): WikiDocument[] {
    return this.index.wikiDocuments;
  }
}
