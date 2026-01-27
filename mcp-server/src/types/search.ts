/**
 * Search request and result types
 */

export interface SearchRequest {
  query: string;
  category?: string; // Filter to wiki category
  language?: string; // Filter by programming language
  repoName?: string; // Filter to specific repo
  includeWiki?: boolean; // Include wiki results (default: true)
  includeRepos?: boolean; // Include repo results (default: true)
  limit?: number;
}

export interface SearchResult {
  type: 'wiki' | 'file';
  path: string;
  repoName?: string;
  title?: string; // For wiki docs
  category?: string; // For wiki docs
  matchLine?: string; // Line containing match
  lineNumber?: number;
  score: number; // Relevance score
  preview: string; // Context around match
  tags?: string[]; // For wiki docs
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalCount: number;
  wikiCount: number;
  repoCount: number;
  searchTimeMs: number;
}

export interface RipgrepMatch {
  path: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export type SortBy = 'relevance' | 'recency' | 'repo';
