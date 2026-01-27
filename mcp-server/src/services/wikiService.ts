/**
 * Wiki service for parsing and managing curated wiki content
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { WikiDocument, WikiFrontmatter } from '../types/index.js';
import { parseMarkdownWithFrontmatter, extractContentPreview, extractTitleFromContent } from '../utils/frontmatter.js';
import { logger } from '../utils/logger.js';

export const WIKI_CATEGORIES = ['patterns', 'utilities', 'integrations', 'templates', 'snippets', 'projects'] as const;
export type WikiCategory = typeof WIKI_CATEGORIES[number];

export class WikiService {
  private wikiDir: string;

  constructor(wikiDir: string) {
    this.wikiDir = wikiDir;
  }

  /**
   * Get all wiki documents
   */
  async getAllDocuments(): Promise<WikiDocument[]> {
    const documents: WikiDocument[] = [];

    for (const category of WIKI_CATEGORIES) {
      const categoryDocs = await this.getDocumentsByCategory(category);
      documents.push(...categoryDocs);
    }

    return documents;
  }

  /**
   * Get documents in a specific category
   */
  async getDocumentsByCategory(category: WikiCategory): Promise<WikiDocument[]> {
    const categoryPath = path.join(this.wikiDir, category);
    const documents: WikiDocument[] = [];

    try {
      const entries = await fs.readdir(categoryPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
          const filePath = path.join(categoryPath, entry.name);
          const doc = await this.parseDocument(filePath, category);
          if (doc) {
            documents.push(doc);
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('WikiService', `Failed to read category ${category}`, error);
      }
    }

    return documents;
  }

  /**
   * Parse a single wiki document
   */
  async parseDocument(filePath: string, category: WikiCategory): Promise<WikiDocument | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stat = await fs.stat(filePath);
      const { frontmatter, content: body } = parseMarkdownWithFrontmatter(content);

      // Try to extract title from content if not in frontmatter
      if (frontmatter.title === 'Untitled') {
        const extractedTitle = extractTitleFromContent(body);
        if (extractedTitle) {
          frontmatter.title = extractedTitle;
        } else {
          // Use filename as title
          frontmatter.title = path.basename(filePath, '.md').replace(/-/g, ' ');
        }
      }

      return {
        path: filePath,
        relativePath: path.relative(this.wikiDir, filePath),
        category,
        frontmatter,
        contentPreview: extractContentPreview(body),
        lastModified: stat.mtime.toISOString(),
      };
    } catch (error) {
      logger.error('WikiService', `Failed to parse ${filePath}`, error);
      return null;
    }
  }

  /**
   * Get a document by its relative path
   */
  async getDocument(relativePath: string): Promise<{ frontmatter: WikiFrontmatter; content: string } | null> {
    const filePath = path.join(this.wikiDir, relativePath);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseMarkdownWithFrontmatter(content);

      // Extract title from content if needed
      if (parsed.frontmatter.title === 'Untitled') {
        const extractedTitle = extractTitleFromContent(parsed.content);
        if (extractedTitle) {
          parsed.frontmatter.title = extractedTitle;
        }
      }

      return parsed;
    } catch (error) {
      logger.error('WikiService', `Failed to get document ${relativePath}`, error);
      return null;
    }
  }

  /**
   * List available categories
   */
  listCategories(): WikiCategory[] {
    return [...WIKI_CATEGORIES];
  }

  /**
   * Check if wiki directory exists
   */
  async exists(): Promise<boolean> {
    try {
      const stat = await fs.stat(this.wikiDir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
