/**
 * get_file tool implementation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { IndexService } from '../services/indexService.js';

export const getFileTool = {
  name: 'get_file',
  description: 'Fetch a file from any local repository by repo name and file path',
  inputSchema: {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository name',
      },
      path: {
        type: 'string',
        description: 'Path to the file within the repository',
      },
    },
    required: ['repo', 'path'],
  },
};

export async function handleGetFile(
  args: { repo: string; path: string },
  indexService: IndexService
): Promise<string> {
  const repo = indexService.getRepoByName(args.repo);

  if (!repo) {
    const availableRepos = indexService.getAllRepos().map(r => r.name).slice(0, 10);
    return JSON.stringify({
      error: 'Repository not found',
      repo: args.repo,
      availableRepos,
      suggestion: 'Use list_repos to see all available repositories',
    }, null, 2);
  }

  const filePath = path.join(repo.path, args.path);

  // Security check: ensure the file is within the repo directory
  const resolvedPath = path.resolve(filePath);
  const resolvedRepoPath = path.resolve(repo.path);
  if (!resolvedPath.startsWith(resolvedRepoPath)) {
    return JSON.stringify({
      error: 'Invalid path: path traversal not allowed',
      path: args.path,
    }, null, 2);
  }

  try {
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      // List directory contents
      const entries = await fs.readdir(filePath, { withFileTypes: true });
      return JSON.stringify({
        type: 'directory',
        repo: args.repo,
        path: args.path,
        contents: entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        })),
      }, null, 2);
    }

    // Check file size to avoid loading huge files
    if (stat.size > 1024 * 1024) { // 1MB limit
      return JSON.stringify({
        error: 'File too large',
        path: args.path,
        size: stat.size,
        suggestion: 'Use search_repos to find specific content in large files',
      }, null, 2);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const extension = path.extname(args.path).toLowerCase();

    return JSON.stringify({
      type: 'file',
      repo: args.repo,
      path: args.path,
      extension,
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
      content,
    }, null, 2);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return JSON.stringify({
        error: 'File not found',
        repo: args.repo,
        path: args.path,
        suggestion: 'Use search_repos to find files matching a pattern',
      }, null, 2);
    }

    return JSON.stringify({
      error: 'Failed to read file',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, null, 2);
  }
}
