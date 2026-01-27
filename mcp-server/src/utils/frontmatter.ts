/**
 * Frontmatter parsing utilities using gray-matter
 */

import matter from 'gray-matter';
import { WikiFrontmatter } from '../types/index.js';

export interface ParsedDocument {
  frontmatter: WikiFrontmatter;
  content: string;
}

/**
 * Parse a markdown file with YAML frontmatter
 */
export function parseMarkdownWithFrontmatter(fileContent: string): ParsedDocument {
  const { data, content } = matter(fileContent);

  const frontmatter: WikiFrontmatter = {
    title: typeof data.title === 'string' ? data.title : 'Untitled',
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    language: typeof data.language === 'string' ? data.language : undefined,
    updated: typeof data.updated === 'string' ? data.updated : undefined,
    source_repo: typeof data.source_repo === 'string' ? data.source_repo : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
  };

  return {
    frontmatter,
    content: content.trim(),
  };
}

/**
 * Extract a content preview (first N characters, respecting word boundaries)
 */
export function extractContentPreview(content: string, maxLength = 500): string {
  if (content.length <= maxLength) {
    return content;
  }

  // Find the last space before maxLength
  const truncated = content.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Extract title from content if not in frontmatter
 * Looks for first # heading
 */
export function extractTitleFromContent(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}
