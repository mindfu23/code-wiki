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
import * as path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { Octokit } from '@octokit/rest';
import { WikiDocument, RepoInfo, RepoDocFile, WikiIndex } from './types.js';

// Supported documentation file extensions
const DOC_EXTENSIONS = ['.md', '.txt', '.rst', '.adoc', '.asciidoc', '.org'] as const;

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
}

async function findMarkdownFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subFiles = await findMarkdownFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
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

    return {
      path: filePath,
      relativePath,
      title: frontmatter.title || fileName,
      description: frontmatter.description,
      tags: frontmatter.tags || [],
      language: frontmatter.language,
      updated: frontmatter.updated,
      sourceRepo: frontmatter.source_repo,
      content: body,
      contentPreview: body.slice(0, 300).replace(/\n/g, ' ').trim(),
      category,
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

async function scanRepoForDocFiles(repoPath: string): Promise<RepoDocFile[]> {
  const docFiles: RepoDocFile[] = [];

  async function scanDir(dir: string, baseDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip hidden directories, node_modules, and common non-source directories
        if (entry.isDirectory()) {
          const skipDirs = ['.git', 'node_modules', '.next', 'dist', 'build', '.cache', 'coverage', '__pycache__', 'venv', '.venv'];
          if (!entry.name.startsWith('.') && !skipDirs.includes(entry.name)) {
            await scanDir(fullPath, baseDir);
          }
        } else if (entry.isFile() && isDocFile(entry.name)) {
          const relativePath = path.relative(baseDir, fullPath);
          const fileType = getFileType(entry.name);
          if (fileType) {
            docFiles.push({
              relativePath,
              name: entry.name,
              fileType,
            });
          }
        }
      }
    } catch (error) {
      // Directory might not exist or be inaccessible
    }
  }

  await scanDir(repoPath, repoPath);
  return docFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Fetch documentation files from a GitHub repo using the Trees API
 * This is efficient - one API call per repo to get the entire file tree
 * Supports: .md, .txt, .rst, .adoc, .asciidoc, .org
 */
async function fetchRepoDocFilesFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepoDocFile[]> {
  const docFiles: RepoDocFile[] = [];

  // Directories to skip (same as local scan)
  const skipDirs = ['node_modules', '.next', 'dist', 'build', '.cache', 'coverage', '__pycache__', 'venv', '.venv'];

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

    // Filter for doc files, excluding common non-source directories
    for (const item of tree.tree) {
      if (item.type === 'blob' && item.path && isDocFile(item.path)) {
        // Check if path contains any skip directories
        const pathParts = item.path.split('/');
        const shouldSkip = pathParts.some(part => skipDirs.includes(part) || part.startsWith('.'));

        if (!shouldSkip) {
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

  return docFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
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
 * Merge GitHub-discovered repos with repo-locations.md data
 * GitHub is the source of truth for: existence, visibility, description, languages
 * repo-locations.md provides: local paths, notes, status overrides
 */
function mergeRepoData(
  githubRepos: RepoInfo[],
  localRepos: RepoInfo[]
): RepoInfo[] {
  const merged: RepoInfo[] = [];
  const localRepoMap = new Map<string, RepoInfo>();

  // Index local repos by name (case-insensitive)
  for (const repo of localRepos) {
    localRepoMap.set(repo.name.toLowerCase(), repo);
  }

  // Start with GitHub repos as the source of truth
  for (const ghRepo of githubRepos) {
    const localRepo = localRepoMap.get(ghRepo.name.toLowerCase());

    if (localRepo) {
      // Merge: GitHub wins for visibility/description, local wins for paths/notes
      merged.push({
        ...ghRepo,
        localPath: localRepo.localPath,
        notes: localRepo.notes,
        status: localRepo.localPath ? 'synced' : 'github-only',
        // Keep GitHub's languages but could merge if needed
      });
      localRepoMap.delete(ghRepo.name.toLowerCase());
    } else {
      // GitHub-only repo
      merged.push(ghRepo);
    }
  }

  // Add any local-only repos (not on GitHub)
  for (const localRepo of localRepoMap.values()) {
    if (!localRepo.githubUrl) {
      // Truly local-only
      merged.push({
        ...localRepo,
        status: 'local-only',
        visibility: 'private', // Local-only repos are treated as private
      });
    }
    // Skip local repos with GitHub URLs that weren't found - they may have been deleted
  }

  return merged;
}

async function buildIndex(): Promise<void> {
  console.log('Building Code Wiki index...');
  console.log(`Wiki directory: ${WIKI_DIR}`);

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Find all markdown files
  const files = await findMarkdownFiles(WIKI_DIR);
  console.log(`Found ${files.length} markdown files`);

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

    // Merge with local repo data (for paths, notes)
    repos = mergeRepoData(githubRepos, localRepoData);
    console.log(`Total repos after merge: ${repos.length} (${repos.filter(r => r.visibility === 'public').length} public, ${repos.filter(r => r.visibility === 'private').length} private)`);

    // Fetch documentation files for each repo
    console.log('\nFetching documentation files...');
    for (const repo of repos) {
      if (repo.githubUrl) {
        const parsed = parseGitHubUrl(repo.githubUrl);
        if (parsed) {
          repo.markdownFiles = await fetchRepoDocFilesFromGitHub(octokit, parsed.owner, parsed.repo);
          totalDocFiles += repo.markdownFiles.length;
        }
      } else if (repo.localPath) {
        // Local-only repo
        repo.markdownFiles = await scanRepoForDocFiles(repo.localPath);
        totalDocFiles += repo.markdownFiles.length;
      }
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
          repo.markdownFiles = await fetchRepoDocFilesFromGitHub(octokit, parsed.owner, parsed.repo);
          totalDocFiles += repo.markdownFiles.length;
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
      if (repo.localPath) {
        repo.markdownFiles = await scanRepoForDocFiles(repo.localPath);
        totalDocFiles += repo.markdownFiles.length;
      }

      // Fetch visibility from GitHub if we have a token and URL
      if (octokit && repo.githubUrl) {
        const parsed = parseGitHubUrl(repo.githubUrl);
        if (parsed) {
          repo.visibility = await fetchRepoVisibility(octokit, parsed.owner, parsed.repo);
        }
      }
    }
  }

  console.log(`Found ${totalDocFiles} documentation files across all repos`);

  // Separate public and private repos
  const publicRepos = repos.filter(r => r.visibility !== 'private');
  const privateRepos = repos.filter(r => r.visibility === 'private');

  console.log(`Repos: ${publicRepos.length} public, ${privateRepos.length} private`);

  // Build full index (includes all repos - for authenticated owner)
  const fullIndex: WikiIndex = {
    documents,
    repos,
    categories: Array.from(categories).sort(),
    buildTime: new Date().toISOString(),
    version: '1.0.0',
  };

  // Build public index (excludes private repos - for public access)
  const publicIndex: WikiIndex = {
    documents,
    repos: publicRepos,
    categories: Array.from(categories).sort(),
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
  for (const category of categories) {
    const categoryDocs = documents.filter(d => d.category === category);
    const categoryPath = path.join(OUTPUT_DIR, `category-${category}.json`);
    await fs.writeFile(categoryPath, JSON.stringify(categoryDocs, null, 2));
  }

  console.log(`Build complete: ${documents.length} documents, ${repos.length} total repos (${publicRepos.length} public, ${privateRepos.length} private), ${categories.size} categories`);
}

buildIndex().catch(console.error);
