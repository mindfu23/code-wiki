/**
 * get_preferences tool implementation
 * Retrieves user preferences and recommendations for agents
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Config } from '../types/index.js';

export const getPreferencesTool = {
  name: 'get_preferences',
  description: 'Get user coding preferences, setup recommendations, and development standards. Agents should check this before making technology or architecture recommendations.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      file: {
        type: 'string',
        description: 'Specific preference file to read (e.g., "standard-setups.md"). If not provided, lists all available preference files.',
      },
    },
  },
};

export async function handleGetPreferences(
  args: { file?: string },
  config: Config
): Promise<string> {
  if (!config.preferencesDirectory) {
    return JSON.stringify({
      error: 'Preferences directory not configured',
      suggestion: 'Set PREFERENCES_DIR in the .env file',
    }, null, 2);
  }

  const prefsDir = config.preferencesDirectory;

  // Check if directory exists
  try {
    await fs.access(prefsDir);
  } catch {
    return JSON.stringify({
      error: 'Preferences directory not found',
      path: prefsDir,
    }, null, 2);
  }

  // If no specific file requested, list all files
  if (!args.file) {
    try {
      const entries = await fs.readdir(prefsDir, { withFileTypes: true });
      const files = entries
        .filter(e => e.isFile() && !e.name.startsWith('.'))
        .map(e => e.name);

      return JSON.stringify({
        preferencesDirectory: prefsDir,
        availableFiles: files,
        usage: 'Call get_preferences with a specific file name to read its contents',
        recommendation: 'Check these preferences before making setup or architecture recommendations',
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        error: 'Failed to list preferences directory',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, null, 2);
    }
  }

  // Read specific file
  const filePath = path.join(prefsDir, args.file);

  // Security check: ensure file is within preferences directory
  const resolvedPath = path.resolve(filePath);
  const resolvedPrefsDir = path.resolve(prefsDir);
  if (!resolvedPath.startsWith(resolvedPrefsDir)) {
    return JSON.stringify({
      error: 'Invalid path: file must be within preferences directory',
    }, null, 2);
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const stat = await fs.stat(filePath);

    return JSON.stringify({
      file: args.file,
      path: filePath,
      lastModified: stat.mtime.toISOString(),
      content,
    }, null, 2);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return JSON.stringify({
        error: 'File not found',
        file: args.file,
        suggestion: 'Use get_preferences without a file argument to see available files',
      }, null, 2);
    }

    return JSON.stringify({
      error: 'Failed to read file',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, null, 2);
  }
}
