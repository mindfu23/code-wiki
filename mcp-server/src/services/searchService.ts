/**
 * Search service for orchestrating wiki and repo searches
 */

import * as path from 'path';
import { Config, SearchRequest, SearchResult, SearchResponse, WikiDocument } from '../types/index.js';
import { IndexService } from './indexService.js';
import { RipgrepService, RipgrepOptions } from './ripgrepService.js';
import { logger } from '../utils/logger.js';

export class SearchService {
  private config: Config;
  private indexService: IndexService;
  private ripgrepService: RipgrepService;

  constructor(config: Config, indexService: IndexService, ripgrepService: RipgrepService) {
    this.config = config;
    this.indexService = indexService;
    this.ripgrepService = ripgrepService;
  }

  /**
   * Unified search across wiki and repositories
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    const startTime = Date.now();
    const results: SearchResult[] = [];
    const limit = request.limit || this.config.maxSearchResults;

    const includeWiki = request.includeWiki !== false;
    const includeRepos = request.includeRepos !== false;

    // Search wiki first (higher priority)
    if (includeWiki) {
      const wikiResults = await this.searchWiki(request.query, request.category, request.language);
      results.push(...wikiResults);
    }

    // Search repositories
    if (includeRepos) {
      const repoResults = await this.searchRepos(request.query, request.repoName, request.language);
      results.push(...repoResults);
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    const limitedResults = results.slice(0, limit);

    const searchTimeMs = Date.now() - startTime;

    return {
      query: request.query,
      results: limitedResults,
      totalCount: results.length,
      wikiCount: limitedResults.filter(r => r.type === 'wiki').length,
      repoCount: limitedResults.filter(r => r.type === 'file').length,
      searchTimeMs,
    };
  }

  /**
   * Search wiki content
   */
  async searchWiki(query: string, category?: string, language?: string): Promise<SearchResult[]> {
    const documents = this.indexService.getAllWikiDocuments();
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0);

    for (const doc of documents) {
      // Filter by category if specified
      if (category && doc.category !== category) {
        continue;
      }

      // Filter by language if specified
      if (language && doc.frontmatter.language !== language) {
        continue;
      }

      const score = this.calculateWikiScore(doc, queryTerms);

      if (score > 0) {
        results.push({
          type: 'wiki',
          path: doc.relativePath,
          title: doc.frontmatter.title,
          category: doc.category,
          tags: doc.frontmatter.tags,
          score: score * this.config.wikiBoostMultiplier, // Apply wiki boost
          preview: doc.contentPreview,
        });
      }
    }

    return results;
  }

  /**
   * Calculate relevance score for a wiki document
   */
  private calculateWikiScore(doc: WikiDocument, queryTerms: string[]): number {
    let score = 0;
    const titleLower = doc.frontmatter.title.toLowerCase();
    const contentLower = doc.contentPreview.toLowerCase();
    const tags = doc.frontmatter.tags.map(t => t.toLowerCase());
    const description = (doc.frontmatter.description || '').toLowerCase();

    for (const term of queryTerms) {
      // Title match (highest value)
      if (titleLower.includes(term)) {
        score += 50;
        // Exact title match bonus
        if (titleLower === term || titleLower.startsWith(term + ' ') || titleLower.endsWith(' ' + term)) {
          score += 25;
        }
      }

      // Tag match (high value)
      if (tags.some(tag => tag.includes(term))) {
        score += 30;
        // Exact tag match bonus
        if (tags.includes(term)) {
          score += 15;
        }
      }

      // Description match
      if (description.includes(term)) {
        score += 20;
      }

      // Content match (frequency based)
      const contentMatches = (contentLower.match(new RegExp(term, 'g')) || []).length;
      score += Math.min(contentMatches * 5, 25); // Cap at 25 points
    }

    // Recency boost (if updated date is available)
    if (doc.frontmatter.updated) {
      const daysSinceUpdate = this.daysSince(doc.frontmatter.updated);
      score += Math.max(0, 20 - daysSinceUpdate * 0.5); // Up to 20 points for recent docs
    }

    return score;
  }

  /**
   * Search repositories using ripgrep
   */
  async searchRepos(query: string, repoName?: string, language?: string): Promise<SearchResult[]> {
    const repos = this.indexService.getAllRepos();
    let searchPaths: string[];

    if (repoName) {
      const repo = repos.find(r => r.name === repoName);
      if (!repo) {
        return [];
      }
      searchPaths = [repo.path];
    } else {
      searchPaths = repos.map(r => r.path);
    }

    const options: RipgrepOptions = {
      maxMatchesPerFile: 5,
      maxTotalMatches: this.config.maxSearchResults,
      ignoreCase: true,
    };

    // Map language to ripgrep file type
    if (language) {
      const typeMap: Record<string, string> = {
        typescript: 'ts',
        javascript: 'js',
        python: 'py',
        ruby: 'ruby',
        go: 'go',
        rust: 'rust',
        java: 'java',
      };
      options.fileType = typeMap[language] || language;
    }

    try {
      const matches = await this.ripgrepService.search(query, searchPaths, options);
      const results: SearchResult[] = [];

      for (const match of matches) {
        // Determine which repo this file belongs to
        const repo = repos.find(r => match.path.startsWith(r.path));
        const repoNameFound = repo?.name || 'unknown';
        const relativePath = repo ? path.relative(repo.path, match.path) : match.path;

        results.push({
          type: 'file',
          path: relativePath,
          repoName: repoNameFound,
          matchLine: match.lineContent,
          lineNumber: match.lineNumber,
          score: this.calculateRepoScore(match.lineContent, query),
          preview: this.createMatchPreview(match.lineContent, match.matchStart, match.matchEnd),
        });
      }

      return results;
    } catch (error) {
      logger.error('SearchService', 'Ripgrep search failed', error);
      return [];
    }
  }

  /**
   * Calculate relevance score for a repository match
   */
  private calculateRepoScore(lineContent: string, query: string): number {
    let score = 10; // Base score for any match

    const lineLower = lineContent.toLowerCase();
    const queryLower = query.toLowerCase();

    // Exact match bonus
    if (lineLower.includes(queryLower)) {
      score += 20;
    }

    // Function/class definition bonus
    if (/\b(function|class|const|let|var|def|fn|func)\b/.test(lineContent)) {
      score += 15;
    }

    // Export statement bonus
    if (/\b(export|module\.exports)\b/.test(lineContent)) {
      score += 10;
    }

    // Interface/type definition bonus
    if (/\b(interface|type|struct|enum)\b/.test(lineContent)) {
      score += 10;
    }

    return score;
  }

  /**
   * Create a preview with context around the match
   */
  private createMatchPreview(lineContent: string, matchStart: number, matchEnd: number): string {
    const maxLength = 150;
    const line = lineContent.trim();

    if (line.length <= maxLength) {
      return line;
    }

    // Try to center the match in the preview
    const matchCenter = (matchStart + matchEnd) / 2;
    const start = Math.max(0, matchCenter - maxLength / 2);
    const end = Math.min(line.length, start + maxLength);

    let preview = line.slice(start, end);

    if (start > 0) {
      preview = '...' + preview;
    }
    if (end < line.length) {
      preview = preview + '...';
    }

    return preview;
  }

  /**
   * Calculate days since a date
   */
  private daysSince(dateStr: string): number {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}
