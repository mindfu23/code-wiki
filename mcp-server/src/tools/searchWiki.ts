/**
 * search_wiki tool implementation
 */

import { SearchService } from '../services/searchService.js';

export const searchWikiTool = {
  name: 'search_wiki',
  description: 'Search curated wiki content for patterns, utilities, and code snippets. Returns highest-priority results from the code wiki.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search terms to find in wiki documents',
      },
      category: {
        type: 'string',
        enum: ['patterns', 'utilities', 'integrations', 'templates', 'snippets', 'projects'],
        description: 'Filter to a specific category',
      },
      language: {
        type: 'string',
        description: 'Filter by programming language (e.g., typescript, python)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 20)',
      },
    },
    required: ['query'],
  },
};

export async function handleSearchWiki(
  args: { query: string; category?: string; language?: string; limit?: number },
  searchService: SearchService
): Promise<string> {
  const response = await searchService.search({
    query: args.query,
    category: args.category,
    language: args.language,
    limit: args.limit || 20,
    includeWiki: true,
    includeRepos: false,
  });

  if (response.results.length === 0) {
    return JSON.stringify({
      message: 'No wiki documents found matching your query',
      query: args.query,
      suggestions: [
        'Try broader search terms',
        'Check available categories with list_category tool',
        'Use search_repos to search across all repositories',
      ],
    }, null, 2);
  }

  return JSON.stringify({
    query: args.query,
    totalResults: response.totalCount,
    searchTimeMs: response.searchTimeMs,
    results: response.results.map(r => ({
      title: r.title,
      category: r.category,
      path: r.path,
      tags: r.tags,
      preview: r.preview,
      relevanceScore: r.score,
    })),
  }, null, 2);
}
