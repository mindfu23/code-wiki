/**
 * Ripgrep service for fast file content search
 */

import { spawn } from 'child_process';
import { RipgrepMatch } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface RipgrepOptions {
  /** File type filter (e.g., 'js', 'ts', 'py') */
  fileType?: string;
  /** Glob pattern to include */
  glob?: string;
  /** Maximum matches per file */
  maxMatchesPerFile?: number;
  /** Maximum total matches */
  maxTotalMatches?: number;
  /** Case insensitive search */
  ignoreCase?: boolean;
  /** Search hidden files */
  hidden?: boolean;
}

interface RipgrepJsonMatch {
  type: 'match';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    submatches: Array<{ start: number; end: number }>;
  };
}

export class RipgrepService {
  private rgPath: string;

  constructor(rgPath = 'rg') {
    this.rgPath = rgPath;
  }

  /**
   * Check if ripgrep is available
   */
  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn(this.rgPath, ['--version']);
      proc.on('error', () => resolve(false));
      proc.on('close', code => resolve(code === 0));
    });
  }

  /**
   * Search for a pattern across directories
   */
  async search(pattern: string, paths: string[], options: RipgrepOptions = {}): Promise<RipgrepMatch[]> {
    const args = this.buildArgs(pattern, options);
    args.push(...paths);

    return new Promise((resolve, reject) => {
      const matches: RipgrepMatch[] = [];
      const maxMatches = options.maxTotalMatches || 100;

      const proc = spawn(this.rgPath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', error => {
        logger.error('RipgrepService', 'Ripgrep process error', error);
        reject(error);
      });

      proc.on('close', code => {
        // ripgrep returns 1 when no matches found, which is not an error
        if (code !== 0 && code !== 1) {
          logger.warn('RipgrepService', `Ripgrep exited with code ${code}`, stderr);
        }

        // Parse JSON output
        const lines = stdout.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (matches.length >= maxMatches) break;

          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'match') {
              const match = parsed as RipgrepJsonMatch;
              const submatch = match.data.submatches[0];

              matches.push({
                path: match.data.path.text,
                lineNumber: match.data.line_number,
                lineContent: match.data.lines.text.replace(/\n$/, ''),
                matchStart: submatch?.start || 0,
                matchEnd: submatch?.end || 0,
              });
            }
          } catch {
            // Skip invalid JSON lines
          }
        }

        resolve(matches);
      });
    });
  }

  /**
   * Search for files matching a pattern (returns file paths only)
   */
  async searchFiles(pattern: string, paths: string[], options: RipgrepOptions = {}): Promise<string[]> {
    const args = [
      '--files-with-matches',
      '--no-heading',
    ];

    if (options.ignoreCase) {
      args.push('--ignore-case');
    }

    if (options.fileType) {
      args.push('--type', options.fileType);
    }

    if (options.glob) {
      args.push('--glob', options.glob);
    }

    args.push(pattern);
    args.push(...paths);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.rgPath, args);
      let stdout = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('error', error => {
        reject(error);
      });

      proc.on('close', () => {
        const files = stdout.split('\n').filter(line => line.trim());
        resolve(files);
      });
    });
  }

  /**
   * Build ripgrep arguments
   */
  private buildArgs(pattern: string, options: RipgrepOptions): string[] {
    const args = [
      '--json', // JSON output for structured parsing
      '--no-heading',
      '--with-filename',
      '--line-number',
    ];

    if (options.ignoreCase) {
      args.push('--ignore-case');
    }

    if (options.fileType) {
      args.push('--type', options.fileType);
    }

    if (options.glob) {
      args.push('--glob', options.glob);
    }

    if (options.maxMatchesPerFile) {
      args.push('--max-count', String(options.maxMatchesPerFile));
    }

    if (!options.hidden) {
      args.push('--no-hidden');
    }

    // Always ignore common directories
    args.push('--glob', '!node_modules');
    args.push('--glob', '!.git');
    args.push('--glob', '!dist');
    args.push('--glob', '!build');
    args.push('--glob', '!*.min.js');
    args.push('--glob', '!*.min.css');
    args.push('--glob', '!package-lock.json');
    args.push('--glob', '!yarn.lock');

    args.push(pattern);

    return args;
  }
}
