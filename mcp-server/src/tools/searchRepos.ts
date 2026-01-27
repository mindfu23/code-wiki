/**
 * search_repos tool implementation
 */

import { SearchService } from '../services/searchService.js';

export const searchReposTool = {
  name: 'search_repos',
  description: 'Full-text search across all local repositories. Searches code by function names, class names, API calls, etc. Uses ripgrep for fast searching.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search pattern (supports regex)',
      },
      repo: {
        type: 'string',
        description: 'Filter to a specific repository by name',
      },
      language: {
        type: 'string',
        description: 'Filter by programming language (e.g., typescript, javascript, python)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
    },
    required: ['query'],
  },
};

export async function handleSearchRepos(
  args: { query: string; repo?: string; language?: string; limit?: number },
  searchService: SearchService
): Promise<string> {
  const response = await searchService.search({
    query: args.query,
    repoName: args.repo,
    language: args.language,
    limit: args.limit || 50,
    includeWiki: false,
    includeRepos: true,
  });

  if (response.results.length === 0) {
    return JSON.stringify({
      message: 'No matches found in repositories',
      query: args.query,
      suggestions: [
        'Try different search terms',
        'Remove language filter if set',
        'Use list_repos to see available repositories',
      ],
    }, null, 2);
  }

  return JSON.stringify({
    query: args.query,
    totalResults: response.totalCount,
    searchTimeMs: response.searchTimeMs,
    results: response.results.map(r => ({
      repo: r.repoName,
      file: r.path,
      line: r.lineNumber,
      match: r.matchLine,
      preview: r.preview,
    })),
  }, null, 2);
}
