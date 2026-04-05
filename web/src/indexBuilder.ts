/**
 * Build-time index generator for Code Wiki
 * Generates a static JSON index from wiki content for use in Netlify functions
 *
 * Supports two modes:
 * - Local: Scans local filesystem for doc files (default)
 * - GitHub API: Uses GitHub Trees API to fetch doc files (set USE_GITHUB_API=true)
 *
 * Supported file types: .md, .txt, .rst, .adoc, .asciidoc, .org
 */

import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { Octokit } from '@octokit/rest';
import { WikiDocument, RepoInfo, RepoDocFile, WikiIndex } from './types.js';
import {
  assessCompletion,
  detectSentinels,
  emptySentinels,
  type RepoSentinels,
} from '../netlify/functions/_shared/completionAssessment.js';

/**
 * Load environment variables from a .env file if they're not already set.
 * Falls back to ../mcp-server/.env so local builds pick up GitHub credentials
 * without needing a separate web/.env file.
 */
function loadEnvFallback(): void {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../mcp-server/.env'),
  ];

  for (const envPath of envPaths) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        // Only set if not already defined in environment
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      console.log(`Loaded env fallback from ${envPath}`);
    } catch {
      // File doesn't exist, skip
    }
  }
}

loadEnvFallback();

// Supported documentation file extensions
const DOC_EXTENSIONS = ['.md', '.txt', '.rst', '.adoc', '.asciidoc', '.org'] as const;

// Files to skip during indexing (conversation logs, large generated files that may contain secrets)
const SKIP_FILE_PATTERNS = [
  /^specstory/i,
  /^\.specstory/i,
  /conversation-log/i,
  /chat-history/i,
];

function shouldSkipFile(filename: string): boolean {
  const base = path.basename(filename, path.extname(filename));
  return SKIP_FILE_PATTERNS.some(pattern => pattern.test(base));
}

// Patterns that match known API key formats — replaced with "[REDACTED]" before indexing
const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhf_[A-Za-z0-9]{20,}\b/g, label: 'HuggingFace token' },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, label: 'OpenAI key' },
  { pattern: /\bpplx-[A-Za-z0-9]{20,}\b/g, label: 'Perplexity key' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, label: 'GitHub PAT' },
  { pattern: /\bghp_[A-Za-z0-9]{30,}\b/g, label: 'GitHub token' },
  { pattern: /\bnfp_[A-Za-z0-9]{30,}\b/g, label: 'Netlify token' },
  { pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/g, label: 'Google API key' },
  { pattern: /\bxai-[A-Za-z0-9]{20,}\b/g, label: 'xAI/Grok key' },
  { pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g, label: 'Anthropic key' },
  // Generic: VARIABLE=<long-alphanumeric-value> in export/env-var contexts
  { pattern: /(?<=(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*["']?)[A-Za-z0-9_-]{25,}(?=["']?\s)/gi, label: 'env-var secret' },
];

function sanitizeSecrets(content: string): string {
  let sanitized = content;
  for (const { pattern } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

function getFileType(filename: string): RepoDocFile['fileType'] | null {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.md')) return 'md';
  if (ext.endsWith('.txt')) return 'txt';
  if (ext.endsWith('.rst')) return 'rst';
  if (ext.endsWith('.adoc') || ext.endsWith('.asciidoc')) return 'adoc';
  if (ext.endsWith('.org')) return 'org';
  return null;
}

function isDocFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return DOC_EXTENSIONS.some(ext => lower.endsWith(ext));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Netlify, base dir is 'web', so wiki is at '../wiki' from cwd
// Locally when running from web/, it's also '../wiki'
const WIKI_DIR = process.env.WIKI_DIR || path.resolve(process.cwd(), '../wiki');
const OUTPUT_DIR = path.resolve(process.cwd(), 'public/data');

// Personal wiki directory - gitignored, tracked in its own local git repo.
// Contains personal docs in category subdirectories (e.g., personal/preferences/, personal/projects/).
// Categories are derived from subdirectory names, same as the main wiki.
const PERSONAL_WIKI_DIR = process.env.PERSONAL_WIKI_DIR || path.join(WIKI_DIR, 'personal');

// GitHub API mode - used in CI when local repos aren't available
const USE_GITHUB_API = process.env.USE_GITHUB_API === 'true';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// GitHub username for auto-discovery (falls back to GITHUB_REPO_OWNER)
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || process.env.GITHUB_REPO_OWNER || '';

interface Frontmatter {
  title?: string;
  description?: string;
  tags?: string[];
  language?: string;
  updated?: string;
  source_repo?: string;
  visibility?: string;
}

async function findMarkdownFiles(dir: string, baseDir: string = dir, skipDirs: string[] = []): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && !skipDirs.includes(entry.name)) {
        const subFiles = await findMarkdownFiles(fullPath, baseDir, []);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md') && !shouldSkipFile(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

async function parseWikiDocument(filePath: string, wikiDir: string): Promise<WikiDocument | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data, content: body } = matter(content);
    const frontmatter = data as Frontmatter;

    const relativePath = path.relative(wikiDir, filePath);
    const dirName = path.dirname(relativePath).split(path.sep)[0];
    const category = (!dirName || dirName === '.') ? 'general' : dirName;

    // Skip index files from search results but include them for category listing
    const fileName = path.basename(filePath, '.md');

    // Sanitize content to strip any API keys or tokens before indexing
    const sanitizedBody = sanitizeSecrets(body);

    return {
      path: filePath,
      relativePath,
      title: frontmatter.title || fileName,
      description: frontmatter.description,
      tags: frontmatter.tags || [],
      language: frontmatter.language,
      updated: frontmatter.updated,
      sourceRepo: frontmatter.source_repo,
      content: sanitizedBody,
      contentPreview: sanitizedBody.slice(0, 300).replace(/\n/g, ' ').trim(),
      category,
      visibility: frontmatter.visibility === 'private' ? 'private' : 'public',
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return null;
  }
}

async function parseRepoLocations(wikiDir: string): Promise<RepoInfo[]> {
  const repoLocationsPath = path.join(wikiDir, 'projects', 'repo-locations.md');
  const repos: RepoInfo[] = [];

  try {
    const content = await fs.readFile(repoLocationsPath, 'utf-8');
    const { content: body } = matter(content);

    // Parse the Full Repository Details section
    const detailsSection = body.split('## Full Repository Details')[1];
    if (!detailsSection) return repos;

    const repoBlocks = detailsSection.split('### ').filter(block => block.trim());

    for (const block of repoBlocks) {
      const lines = block.split('\n').filter(line => line.trim());
      if (lines.length === 0) continue;

      const name = lines[0].trim();
      const repo: RepoInfo = {
        name,
        languages: [],
        status: 'local-only',
        visibility: 'public',  // Default to public
      };

      for (const line of lines.slice(1)) {
        if (line.startsWith('- **Status:**')) {
          const status = line.replace('- **Status:**', '').trim();
          repo.status = status as RepoInfo['status'];
        } else if (line.startsWith('- **Local Path:**')) {
          repo.localPath = line.replace('- **Local Path:**', '').trim().replace(/`/g, '');
        } else if (line.startsWith('- **GitHub:**')) {
          repo.githubUrl = line.replace('- **GitHub:**', '').trim();
        } else if (line.startsWith('- **Description:**')) {
          repo.description = line.replace('- **Description:**', '').trim();
        } else if (line.startsWith('- **Languages:**')) {
          repo.languages = line.replace('- **Languages:**', '').trim().split(', ').filter(Boolean);
        } else if (line.startsWith('- **Last Commit:**')) {
          repo.lastCommitDate = line.replace('- **Last Commit:**', '').trim();
        } else if (line.startsWith('- **Notes:**')) {
          repo.notes = line.replace('- **Notes:**', '').trim();
        } else if (line.startsWith('- **Visibility:**')) {
          const vis = line.replace('- **Visibility:**', '').trim().toLowerCase();
          repo.visibility = vis === 'private' ? 'private' : 'public';
        }
      }

      if (repo.name) {
        repos.push(repo);
      }
    }
  } catch (error) {
    console.log('No repo-locations.md found, skipping repo index');
  }

  // Filter out local-only repos (repos without a GitHub URL)
  const githubRepos = repos.filter(repo => repo.githubUrl);
  const skippedCount = repos.length - githubRepos.length;
  if (skippedCount > 0) {
    console.log(`Skipping ${skippedCount} local-only repos (not on GitHub)`);
  }

  return githubRepos;
}

/**
 * Scan a local repo for doc files AND collect every non-skipped file path
 * so sentinels can be computed in the same traversal. Returns doc files
 * (for the existing `markdownFiles` field) and the full relative-path list
 * (consumed by `detectSentinels`).
 */
async function scanRepoForDocFiles(
  repoPath: string
): Promise<{ docFiles: RepoDocFile[]; allPaths: string[] }> {
  const docFiles: RepoDocFile[] = [];
  const allPaths: string[] = [];

  // Allow traversal into .github (for workflow CI detection) while still
  // skipping other dotted directories and common build/dep folders.
  const SKIP_DIRS = new Set([
    '.git', 'node_modules', '.next', 'dist', 'build',
    '.cache', 'coverage', '__pycache__', 'venv', '.venv',
    'vendor', '.turbo', '.parcel-cache',
  ]);

  async function scanDir(dir: string, baseDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          // Allow .github (CI detection); skip other dotfiles
          if (entry.name.startsWith('.') && entry.name !== '.github') continue;
          await scanDir(fullPath, baseDir);
        } else if (entry.isFile()) {
          const relativePath = path.relative(baseDir, fullPath);
          allPaths.push(relativePath);

          if (isDocFile(entry.name) && !shouldSkipFile(entry.name)) {
            const fileType = getFileType(entry.name);
            if (fileType) {
              docFiles.push({ relativePath, name: entry.name, fileType });
            }
          }
        }
      }
    } catch {
      // Directory might not exist or be inaccessible
    }
  }

  await scanDir(repoPath, repoPath);
  docFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { docFiles, allPaths };
}

/**
 * Fetch the full file tree for a GitHub repo via the Trees API (one request).
 * Returns both the filtered doc-file list AND the full set of relative paths
 * so callers can run sentinel detection in the same pass.
 *
 * Supports doc file types: .md, .txt, .rst, .adoc, .asciidoc, .org
 */
async function fetchRepoDocFilesFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ docFiles: RepoDocFile[]; allPaths: string[] }> {
  const docFiles: RepoDocFile[] = [];
  const allPaths: string[] = [];

  // Allow .github/workflows for CI detection; otherwise skip dotfiles and heavy build dirs.
  const SKIP_DIRS = new Set([
    'node_modules', '.next', 'dist', 'build', '.cache',
    'coverage', '__pycache__', 'venv', '.venv',
    'vendor', '.turbo', '.parcel-cache',
  ]);

  try {
    // Get the default branch first
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    // Get the entire tree recursively (one API call)
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: 'true',
    });

    for (const item of tree.tree) {
      if (item.type !== 'blob' || !item.path) continue;

      const pathParts = item.path.split('/');
      const inSkipDir = pathParts.some(
        (part) => SKIP_DIRS.has(part) || (part.startsWith('.') && part !== '.github')
      );
      if (inSkipDir) continue;

      allPaths.push(item.path);

      if (isDocFile(item.path)) {
        const fileType = getFileType(item.path);
        if (fileType) {
          docFiles.push({
            relativePath: item.path,
            name: path.basename(item.path),
            fileType,
          });
        }
      }
    }
  } catch (error) {
    const err = error as { status?: number };
    if (err.status === 404) {
      console.log(`  Repository ${owner}/${repo} not found or not accessible`);
    } else if (err.status === 409) {
      // Empty repository - no files to index
      console.log(`  Repository ${owner}/${repo} is empty (no commits yet)`);
    } else {
      console.error(`  Error fetching tree for ${owner}/${repo}:`, error);
    }
  }

  docFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { docFiles, allPaths };
}

/**
 * Parse GitHub URL to extract owner and repo name
 * Handles: https://github.com/owner/repo, https://github.com/owner/repo.git
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

/**
 * Fetch repo visibility from GitHub API
 * Returns 'public' or 'private'
 */
async function fetchRepoVisibility(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<'public' | 'private'> {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    // GitHub API returns visibility as 'public', 'private', or 'internal'
    return data.visibility === 'public' ? 'public' : 'private';
  } catch (err: any) {
    if (err.status === 404) {
      // Repo not found or not accessible - treat as private
      return 'private';
    }
    throw err;
  }
}

/**
 * Fetch ALL repos from GitHub for a user
 * This enables auto-discovery - no need to manually list repos
 */
async function fetchAllGitHubRepos(
  octokit: Octokit,
  username: string
): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];

  try {
    // Fetch all repos (paginated, up to 100 per page)
    const iterator = octokit.paginate.iterator(octokit.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });

    for await (const { data: pageRepos } of iterator) {
      for (const repo of pageRepos) {
        // Only include repos owned by the specified username
        if (repo.owner?.login?.toLowerCase() !== username.toLowerCase()) {
          continue;
        }

        repos.push({
          name: repo.name,
          description: repo.description || undefined,
          githubUrl: repo.html_url,
          languages: repo.language ? [repo.language] : [],
          lastCommitDate: repo.pushed_at || repo.updated_at || undefined,
          status: 'github-only',
          visibility: repo.visibility === 'public' ? 'public' : 'private',
        });
      }
    }

    console.log(`  Discovered ${repos.length} repos from GitHub (${repos.filter(r => r.visibility === 'public').length} public, ${repos.filter(r => r.visibility === 'private').length} private)`);
  } catch (err: any) {
    if (err.status === 401) {
      console.error('  GitHub authentication failed. Check your GITHUB_TOKEN.');
    } else {
      console.error('  Error fetching repos from GitHub:', err.message);
    }
  }

  return repos;
}

/**
 * Normalize a GitHub URL to a canonical `owner/repo` key (lowercased).
 * Strips `.git` suffixes, trailing slashes, and case variation so two local
 * entries pointing at the same repo via slightly different URLs collapse together.
 * Returns the original URL lowercased if parsing fails (rare).
 */
function normalizeGitHubUrl(url: string): string {
  const parsed = parseGitHubUrl(url);
  if (!parsed) return url.toLowerCase();
  return `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`;
}

/**
 * Resolve a GitHub repo reference through the API, following 301 redirects
 * for renamed repos. Octokit follows redirects by default, so a request for a
 * repo that has been renamed returns the canonical owner/name of the new repo.
 * Returns null for 404 (deleted / transferred / no access).
 */
async function resolveGitHubRepo(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ canonicalOwner: string; canonicalRepo: string; visibility: 'public' | 'private' } | null> {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return {
      canonicalOwner: data.owner.login,
      canonicalRepo: data.name,
      visibility: data.visibility === 'public' ? 'public' : 'private',
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * Attach a local entry's paths, notes, and alias name to an existing merged repo.
 * Used when we discover that a local entry is really a duplicate or an old name
 * for a repo that's already in the merged list.
 */
function attachLocalToMergedEntry(mergedEntry: RepoInfo, localRepo: RepoInfo): void {
  if (localRepo.localPath) {
    const existingPaths = mergedEntry.localPaths
      ?? (mergedEntry.localPath ? [mergedEntry.localPath] : []);
    if (!existingPaths.includes(localRepo.localPath)) {
      existingPaths.push(localRepo.localPath);
    }
    mergedEntry.localPaths = existingPaths;
    if (!mergedEntry.localPath) mergedEntry.localPath = existingPaths[0];
  }
  if (localRepo.notes && !mergedEntry.notes) {
    mergedEntry.notes = localRepo.notes;
  }
  if (localRepo.name.toLowerCase() !== mergedEntry.name.toLowerCase()) {
    mergedEntry.aliases = mergedEntry.aliases ?? [];
    if (!mergedEntry.aliases.includes(localRepo.name)) {
      mergedEntry.aliases.push(localRepo.name);
    }
  }
  if (mergedEntry.status === 'github-only' && (mergedEntry.localPaths?.length ?? 0) > 0) {
    mergedEntry.status = 'synced';
  }
}

/**
 * Merge GitHub-discovered repos with repo-locations.md data.
 *
 * GitHub is the source of truth for existence, canonical name, visibility,
 * description, and languages. repo-locations.md contributes local paths and notes.
 *
 * The merge handles three cases that naive name-matching gets wrong:
 *   1. **Renamed repos** — a local entry (e.g. "BookLarner") that was renamed on
 *      GitHub (to "CoverJudge") no longer matches any API-returned name. We resolve
 *      the old URL through the API; GitHub follows the redirect and returns the
 *      canonical name, so we can attach the local entry as an alias instead of
 *      creating a phantom duplicate.
 *   2. **Duplicate local clones** — two local folders whose git remotes point at
 *      the same GitHub URL (e.g. a scratch copy "friendli-assessment" alongside
 *      the primary "takehome_q") collapse into a single entry with multiple
 *      `localPaths`, rather than appearing as separate repos.
 *   3. **Unseen-in-API entries** — a local entry with a GitHub URL that the API
 *      didn't return gets its visibility resolved via a direct `repos.get` call
 *      instead of blindly defaulting to private (the previous behavior
 *      misclassified renamed public repos as private).
 *
 * An `octokit` client is required for cases 1 and 3 to do the resolution calls.
 * Without it, the merge falls back to name-matching only, and orphan local
 * entries with GitHub URLs default to private — the pre-fix behavior.
 */
async function mergeRepoData(
  githubRepos: RepoInfo[],
  localRepos: RepoInfo[],
  octokit?: Octokit
): Promise<RepoInfo[]> {
  const processedLocal = new Set<string>();
  const mergedEntries: RepoInfo[] = [];

  // First pass: for each GitHub repo, find all local entries that match by name
  // OR by normalized GitHub URL (fix #3: de-dupe by URL, not name).
  for (const ghRepo of githubRepos) {
    const ghKey = ghRepo.githubUrl ? normalizeGitHubUrl(ghRepo.githubUrl) : null;
    const matches: RepoInfo[] = [];

    for (const localRepo of localRepos) {
      if (processedLocal.has(localRepo.name.toLowerCase())) continue;

      const nameMatch = localRepo.name.toLowerCase() === ghRepo.name.toLowerCase();
      const urlMatch = ghKey
        && localRepo.githubUrl
        && normalizeGitHubUrl(localRepo.githubUrl) === ghKey;

      if (nameMatch || urlMatch) {
        matches.push(localRepo);
        processedLocal.add(localRepo.name.toLowerCase());
      }
    }

    // Start with the GitHub record as the source of truth.
    const entry: RepoInfo = { ...ghRepo };
    for (const localRepo of matches) {
      attachLocalToMergedEntry(entry, localRepo);
      if (localRepo.name.toLowerCase() !== ghRepo.name.toLowerCase()) {
        console.log(`  Associated local "${localRepo.name}" with GitHub repo "${ghRepo.name}" via shared URL`);
      }
    }
    mergedEntries.push(entry);
  }

  // Build an index of merged entries by normalized URL for the second pass.
  const mergedByUrl = new Map<string, RepoInfo>();
  for (const entry of mergedEntries) {
    if (entry.githubUrl) {
      mergedByUrl.set(normalizeGitHubUrl(entry.githubUrl), entry);
    }
  }

  // Second pass: handle local entries that weren't matched above.
  for (const localRepo of localRepos) {
    if (processedLocal.has(localRepo.name.toLowerCase())) continue;

    if (!localRepo.githubUrl) {
      // Truly local-only (no remote) — keep as private local entry.
      mergedEntries.push({
        ...localRepo,
        status: 'local-only',
        visibility: 'private',
      });
      continue;
    }

    // Local entry has a GitHub URL but didn't match any API result by name or URL.
    // Possibilities: (a) the repo was renamed on GitHub, (b) it was deleted/
    // transferred, (c) it's a private repo our token can't see.
    // Fix #1 + #2: resolve via API to distinguish these cases.
    if (octokit) {
      const parsed = parseGitHubUrl(localRepo.githubUrl);
      if (parsed) {
        try {
          const resolved = await resolveGitHubRepo(octokit, parsed.owner, parsed.repo);
          if (resolved) {
            const canonicalKey = `${resolved.canonicalOwner.toLowerCase()}/${resolved.canonicalRepo.toLowerCase()}`;
            const existing = mergedByUrl.get(canonicalKey);
            if (existing) {
              // Rename or duplicate remote: the canonical repo is already in the merged list.
              // Attach this local entry as an alias and move on.
              attachLocalToMergedEntry(existing, localRepo);
              console.log(`  Merged stale alias "${localRepo.name}" into "${existing.name}" (renamed or duplicate remote)`);
              processedLocal.add(localRepo.name.toLowerCase());
              continue;
            }
            // Genuinely unseen repo (e.g. auto-discovery didn't list it but we can still fetch it).
            // Use the canonical name and real visibility from the API — not the blind "private" default.
            const newEntry: RepoInfo = {
              ...localRepo,
              name: resolved.canonicalRepo,
              visibility: resolved.visibility,
              aliases: resolved.canonicalRepo.toLowerCase() !== localRepo.name.toLowerCase()
                ? [localRepo.name]
                : undefined,
            };
            mergedEntries.push(newEntry);
            mergedByUrl.set(canonicalKey, newEntry);
            processedLocal.add(localRepo.name.toLowerCase());
            console.log(`  Resolved orphan local "${localRepo.name}" → canonical "${resolved.canonicalRepo}" (${resolved.visibility})`);
            continue;
          }
          // 404: repo no longer exists. Drop silently with a note — stale markdown entry.
          console.log(`  Dropping stale local entry "${localRepo.name}" (GitHub URL returns 404)`);
          processedLocal.add(localRepo.name.toLowerCase());
          continue;
        } catch (err: unknown) {
          const msg = (err as { message?: string }).message ?? String(err);
          console.log(`  Could not resolve ${parsed.owner}/${parsed.repo}: ${msg}`);
        }
      }
    }

    // Fallback when no octokit is provided or resolution failed: default to private
    // (preserves pre-fix behavior so the builder still works without a token).
    mergedEntries.push({
      ...localRepo,
      visibility: 'private',
    });
  }

  return mergedEntries;
}

/**
 * Populate `markdownFiles`, `sentinels`, and `completion` on a repo by scanning
 * its file tree (via GitHub API if possible, local filesystem otherwise).
 * Returns the number of doc files found so the caller can tally totals.
 */
async function populateRepoSignals(
  repo: RepoInfo,
  octokit: Octokit | null
): Promise<number> {
  let docFiles: RepoDocFile[] = [];
  let allPaths: string[] = [];

  // Prefer GitHub API when we can — it gives the canonical tree regardless of
  // whether the local clone is current.
  if (octokit && repo.githubUrl) {
    const parsed = parseGitHubUrl(repo.githubUrl);
    if (parsed) {
      const result = await fetchRepoDocFilesFromGitHub(octokit, parsed.owner, parsed.repo);
      docFiles = result.docFiles;
      allPaths = result.allPaths;
    }
  }

  // Fall back to local scan if GitHub didn't give us anything and we have a local path.
  if (allPaths.length === 0 && repo.localPath) {
    const result = await scanRepoForDocFiles(repo.localPath);
    docFiles = result.docFiles;
    allPaths = result.allPaths;
  }

  repo.markdownFiles = docFiles;
  repo.sentinels = allPaths.length > 0 ? detectSentinels(allPaths) : emptySentinels();
  repo.completion = assessCompletion(repo.sentinels, {
    description: repo.description,
    lastCommitDate: repo.lastCommitDate,
    // No live metrics at index-build time — dashboard-data.ts refines these
    // per-request using the Observatory collectors.
  });

  return docFiles.length;
}

async function buildIndex(): Promise<void> {
  console.log('Building Code Wiki index...');
  console.log(`Wiki directory: ${WIKI_DIR}`);

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Find all markdown files in main wiki (skip 'personal' dir — scanned separately)
  const files = await findMarkdownFiles(WIKI_DIR, WIKI_DIR, ['personal']);
  console.log(`Found ${files.length} markdown files in wiki`);

  // Parse all documents
  const documents: WikiDocument[] = [];
  const categories = new Set<string>();

  for (const file of files) {
    const doc = await parseWikiDocument(file, WIKI_DIR);
    if (doc) {
      documents.push(doc);
      categories.add(doc.category);
    }
  }

  // Scan personal wiki directory (gitignored, only exists locally).
  // Personal docs use the same category structure (subdirectory = category).
  // They default to visibility: private so they only appear in the authenticated index.
  let personalWikiExists = false;
  try {
    await fs.access(PERSONAL_WIKI_DIR);
    personalWikiExists = true;
    const personalFiles = await findMarkdownFiles(PERSONAL_WIKI_DIR);
    console.log(`Found ${personalFiles.length} personal markdown files in ${PERSONAL_WIKI_DIR}`);

    for (const file of personalFiles) {
      const doc = await parseWikiDocument(file, PERSONAL_WIKI_DIR);
      if (doc) {
        // Default personal docs to private visibility
        if (!doc.visibility || doc.visibility === 'public') {
          doc.visibility = 'private';
        }
        documents.push(doc);
        categories.add(doc.category);
      }
    }
  } catch {
    // Personal wiki directory doesn't exist (e.g., in CI) — that's fine
  }

  // Parse repo-locations.md for local paths and notes
  const localRepoData = await parseRepoLocations(WIKI_DIR);
  console.log(`Found ${localRepoData.length} repos in repo-locations.md`);

  // Determine repo discovery mode
  let repos: RepoInfo[] = [];
  let totalDocFiles = 0;

  if (GITHUB_TOKEN && GITHUB_USERNAME) {
    // Auto-discovery mode: Fetch ALL repos from GitHub
    console.log(`\nAuto-discovering repos for GitHub user: ${GITHUB_USERNAME}`);

    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    // Fetch all repos from GitHub
    const githubRepos = await fetchAllGitHubRepos(octokit, GITHUB_USERNAME);

    // If auto-discovery returned results, merge with local data.
    // The merge resolves renamed repos via GitHub redirects, de-dupes local
    // clones that share a remote URL, and fetches actual visibility for
    // orphan entries instead of defaulting to "private".
    if (githubRepos.length > 0) {
      repos = await mergeRepoData(githubRepos, localRepoData, octokit);
      console.log(`Total repos after merge: ${repos.length} (${repos.filter(r => r.visibility === 'public').length} public, ${repos.filter(r => r.visibility === 'private').length} private)`);
    } else {
      console.log('Auto-discovery returned no repos (token may not have user scope). Falling back to repo-locations.md...');
      repos = localRepoData.filter(r => r.githubUrl);
      console.log(`Using ${repos.length} repos from repo-locations.md`);
    }

    // Fetch documentation files and structural sentinels for each repo.
    // populateRepoSignals fills markdownFiles + sentinels + completion in one pass.
    console.log('\nFetching documentation files...');
    for (const repo of repos) {
      totalDocFiles += await populateRepoSignals(repo, octokit);
    }
  } else if (USE_GITHUB_API) {
    // Legacy mode: Use repo-locations.md with GitHub API
    console.log('Using GitHub API mode (no auto-discovery - set GITHUB_USERNAME to enable)...');

    if (!GITHUB_TOKEN) {
      console.warn('Warning: GITHUB_TOKEN not set. API rate limits will be very restrictive.');
    }

    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    repos = localRepoData.filter(r => r.githubUrl); // Only repos with GitHub URLs

    for (const repo of repos) {
      if (repo.githubUrl) {
        const parsed = parseGitHubUrl(repo.githubUrl);
        if (parsed) {
          console.log(`  Fetching ${parsed.owner}/${parsed.repo}...`);
          repo.visibility = await fetchRepoVisibility(octokit, parsed.owner, parsed.repo);
          totalDocFiles += await populateRepoSignals(repo, octokit);
        }
      }
    }
  } else {
    // Local filesystem mode
    console.log('Using local filesystem mode...');
    repos = localRepoData;

    // Create Octokit for visibility checks if token is available
    const octokit = GITHUB_TOKEN ? new Octokit({ auth: GITHUB_TOKEN }) : null;
    if (octokit) {
      console.log('GitHub token available - will fetch visibility from GitHub API');
    } else {
      console.log('No GitHub token - using visibility from repo-locations.md (default: public)');
    }

    for (const repo of repos) {
      // Fetch visibility from GitHub if we have a token and URL (before scanning,
      // so completion assessment sees correct visibility in logs if needed later)
      if (octokit && repo.githubUrl) {
        const parsed = parseGitHubUrl(repo.githubUrl);
        if (parsed) {
          repo.visibility = await fetchRepoVisibility(octokit, parsed.owner, parsed.repo);
        }
      }

      totalDocFiles += await populateRepoSignals(repo, octokit);
    }
  }

  console.log(`Found ${totalDocFiles} documentation files across all repos`);

  // Preserve personal (private) docs from previous build when the personal wiki
  // directory is absent (e.g., in CI/GitHub Actions where gitignored files don't exist).
  // When the personal directory IS present, its contents are scanned directly above.
  let preservedDocs: WikiDocument[] = [];
  const preservedCategories = new Set<string>();
  if (!personalWikiExists) {
    try {
      const existingFullIndex = JSON.parse(
        await fs.readFile(path.join(OUTPUT_DIR, 'index-full.json'), 'utf-8')
      ) as WikiIndex;

      // Preserve individual private docs not found in the current scan
      const scannedPaths = new Set(documents.map(d => d.relativePath));
      for (const doc of existingFullIndex.documents) {
        if (doc.visibility === 'private' && !scannedPaths.has(doc.relativePath)) {
          preservedDocs.push(doc);
          preservedCategories.add(doc.category);
        }
      }

      if (preservedDocs.length > 0) {
        console.log(`Preserved ${preservedDocs.length} personal docs from previous build (categories: ${Array.from(preservedCategories).join(', ')})`);
      }
    } catch {
      // No existing full index, nothing to preserve
    }
  }

  // Merge preserved docs into the full document set
  const allDocuments = [...documents, ...preservedDocs];
  const allCategories = new Set([...categories, ...preservedCategories]);

  // Separate public and private repos
  const publicRepos = repos.filter(r => r.visibility !== 'private');
  const privateRepos = repos.filter(r => r.visibility === 'private');

  // Separate public and private documents (from current scan only — preserved docs are private)
  const publicDocuments = documents.filter(d => d.visibility !== 'private');
  const privateDocuments = allDocuments.filter(d => d.visibility === 'private');

  console.log(`Repos: ${publicRepos.length} public, ${privateRepos.length} private`);
  console.log(`Docs: ${publicDocuments.length} public, ${privateDocuments.length} private`);

  // Build full index (includes all repos and docs - for authenticated owner)
  const fullIndex: WikiIndex = {
    documents: allDocuments,
    repos,
    categories: Array.from(allCategories).sort(),
    buildTime: new Date().toISOString(),
    version: '1.0.0',
  };

  // Build public index (excludes private repos and docs - for public access)
  const publicIndex: WikiIndex = {
    documents: publicDocuments,
    repos: publicRepos,
    categories: Array.from(allCategories).sort(),
    buildTime: new Date().toISOString(),
    version: '1.0.0',
  };

  // Write public index (served statically)
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  await fs.writeFile(indexPath, JSON.stringify(publicIndex, null, 2));
  console.log(`Public index written to ${indexPath}`);

  // Write full index (served via authenticated endpoint)
  const fullIndexPath = path.join(OUTPUT_DIR, 'index-full.json');
  await fs.writeFile(fullIndexPath, JSON.stringify(fullIndex, null, 2));
  console.log(`Full index written to ${fullIndexPath}`);

  // Write individual category files for faster loading
  for (const category of allCategories) {
    const categoryDocs = allDocuments.filter(d => d.category === category);
    const categoryPath = path.join(OUTPUT_DIR, `category-${category}.json`);
    await fs.writeFile(categoryPath, JSON.stringify(categoryDocs, null, 2));
  }

  console.log(`Build complete: ${allDocuments.length} documents (${publicDocuments.length} public, ${privateDocuments.length} private), ${repos.length} total repos (${publicRepos.length} public, ${privateRepos.length} private), ${allCategories.size} categories`);
}

buildIndex().catch(console.error);
