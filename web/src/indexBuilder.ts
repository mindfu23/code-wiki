/**
 * Build-time index generator for Code Wiki
 * Generates a static JSON index from wiki content for use in Netlify functions
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { WikiDocument, RepoInfo, WikiIndex } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIKI_DIR = process.env.WIKI_DIR || path.resolve(__dirname, '../../wiki');
const OUTPUT_DIR = path.resolve(__dirname, '../public/data');

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
    const category = path.dirname(relativePath).split(path.sep)[0] || 'root';

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
