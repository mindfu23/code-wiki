/**
 * list_category tool implementation
 */

import { WikiService, WIKI_CATEGORIES, WikiCategory } from '../services/wikiService.js';
import { IndexService } from '../services/indexService.js';

export const listCategoryTool = {
  name: 'list_category',
  description: 'List all documents in a wiki category or list all available categories',
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        enum: ['patterns', 'utilities', 'integrations', 'templates', 'snippets', 'projects'],
        description: 'Category to list. If not provided, lists all categories with document counts.',
      },
    },
  },
};

export async function handleListCategory(
  args: { category?: string },
  wikiService: WikiService,
  indexService: IndexService
): Promise<string> {
  const wikiDocs = indexService.getAllWikiDocuments();

  if (!args.category) {
    // List all categories with counts
    const categoryCounts = WIKI_CATEGORIES.map(cat => ({
      name: cat,
      documentCount: wikiDocs.filter(d => d.category === cat).length,
    }));

    return JSON.stringify({
      categories: categoryCounts,
      totalDocuments: wikiDocs.length,
    }, null, 2);
  }

  // Validate category
  if (!WIKI_CATEGORIES.includes(args.category as WikiCategory)) {
    return JSON.stringify({
      error: 'Invalid category',
      provided: args.category,
      validCategories: WIKI_CATEGORIES,
    }, null, 2);
  }

  // List documents in category
  const categoryDocs = wikiDocs.filter(d => d.category === args.category);

  if (categoryDocs.length === 0) {
    return JSON.stringify({
      category: args.category,
      message: 'No documents in this category yet',
      suggestion: 'Add documents to wiki/' + args.category + '/',
    }, null, 2);
  }

  return JSON.stringify({
    category: args.category,
    documentCount: categoryDocs.length,
    documents: categoryDocs.map(d => ({
      path: d.relativePath,
      title: d.frontmatter.title,
      tags: d.frontmatter.tags,
      language: d.frontmatter.language,
      description: d.frontmatter.description,
      lastModified: d.lastModified,
    })),
  }, null, 2);
}
