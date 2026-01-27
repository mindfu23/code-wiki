/**
 * Build-time index generator for Code Wiki
 * Generates a static JSON index from wiki content for use in Netlify functions
 *
 * Supports two modes:
 * - Local: Scans local filesystem for .md files (default)
 * - GitHub API: Uses GitHub Trees API to fetch .md files (set USE_GITHUB_API=true)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { Octokit } from '@octokit/rest';
import { WikiDocument, RepoInfo, RepoMarkdownFile, WikiIndex } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Netlify, base dir is 'web', so wiki is at '../wiki' from cwd
// Locally when running from web/, it's also '../wiki'
const WIKI_DIR = process.env.WIKI_DIR || path.resolve(process.cwd(), '../wiki');
const OUTPUT_DIR = path.resolve(process.cwd(), 'public/data');

// GitHub API mode - used in CI when local repos aren't available
const USE_GITHUB_API = process.env.USE_GITHUB_API === 'true';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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
        }
      }

      if (repo.name) {
        repos.push(repo);
      }
    }
  } catch (error) {
    console.log('No repo-locations.md found, skipping repo index');
  }

  return repos;
}

async function scanRepoForMarkdownFiles(repoPath: string): Promise<RepoMarkdownFile[]> {
  const mdFiles: RepoMarkdownFile[] = [];

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
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const relativePath = path.relative(baseDir, fullPath);
          mdFiles.push({
            relativePath,
            name: entry.name,
          });
        }
      }
    } catch (error) {
      // Directory might not exist or be inaccessible
    }
  }

  await scanDir(repoPath, repoPath);
  return mdFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Fetch markdown files from a GitHub repo using the Trees API
 * This is efficient - one API call per repo to get the entire file tree
 */
async function fetchRepoMarkdownFilesFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepoMarkdownFile[]> {
  const mdFiles: RepoMarkdownFile[] = [];

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

    // Filter for .md files, excluding common non-source directories
    for (const item of tree.tree) {
      if (item.type === 'blob' && item.path && item.path.endsWith('.md')) {
        // Check if path contains any skip directories
        const pathParts = item.path.split('/');
        const shouldSkip = pathParts.some(part => skipDirs.includes(part) || part.startsWith('.'));

        if (!shouldSkip) {
          mdFiles.push({
            relativePath: item.path,
            name: path.basename(item.path),
          });
        }
      }
    }
  } catch (error) {
    const err = error as { status?: number };
    if (err.status === 404) {
      console.log(`  Repository ${owner}/${repo} not found or not accessible`);
    } else {
      console.error(`  Error fetching tree for ${owner}/${repo}:`, error);
    }
  }

  return mdFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
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

  // Parse repo locations
  const repos = await parseRepoLocations(WIKI_DIR);
  console.log(`Found ${repos.length} repositories`);

  // Scan each repo for markdown files
  let totalMdFiles = 0;

  if (USE_GITHUB_API) {
    // GitHub API mode - fetch .md files via Trees API
    console.log('Using GitHub API to fetch markdown files...');

    if (!GITHUB_TOKEN) {
      console.warn('Warning: GITHUB_TOKEN not set. API rate limits will be very restrictive.');
    }

    const octokit = new Octokit({
      auth: GITHUB_TOKEN,
    });

    for (const repo of repos) {
      if (repo.githubUrl) {
        const parsed = parseGitHubUrl(repo.githubUrl);
        if (parsed) {
          console.log(`  Fetching ${parsed.owner}/${parsed.repo}...`);
          repo.markdownFiles = await fetchRepoMarkdownFilesFromGitHub(octokit, parsed.owner, parsed.repo);
          totalMdFiles += repo.markdownFiles.length;
        }
      }
    }
  } else {
    // Local mode - scan local filesystem
    console.log('Scanning local filesystem for markdown files...');

    for (const repo of repos) {
      if (repo.localPath) {
        repo.markdownFiles = await scanRepoForMarkdownFiles(repo.localPath);
        totalMdFiles += repo.markdownFiles.length;
      }
    }
  }

  console.log(`Found ${totalMdFiles} markdown files across all repos`);

  // Build index
  const index: WikiIndex = {
    documents,
    repos,
    categories: Array.from(categories).sort(),
    buildTime: new Date().toISOString(),
    version: '1.0.0',
  };

  // Write index
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  console.log(`Index written to ${indexPath}`);

  // Write individual category files for faster loading
  for (const category of categories) {
    const categoryDocs = documents.filter(d => d.category === category);
    const categoryPath = path.join(OUTPUT_DIR, `category-${category}.json`);
    await fs.writeFile(categoryPath, JSON.stringify(categoryDocs, null, 2));
  }

  console.log(`Build complete: ${documents.length} documents, ${repos.length} repos, ${categories.size} categories`);
}

buildIndex().catch(console.error);
