/**
 * Search API function for Code Wiki
 * Searches wiki documents and repos
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import * as fs from 'fs';
import * as path from 'path';

interface WikiDocument {
  path: string;
  relativePath: string;
  title: string;
  description?: string;
  tags: string[];
  language?: string;
  content: string;
  contentPreview: string;
  category: string;
}

interface RepoInfo {
  name: string;
  description?: string;
  githubUrl?: string;
  languages: string[];
  status: string;
}

interface WikiIndex {
  documents: WikiDocument[];
  repos: RepoInfo[];
  categories: string[];
}

interface SearchResult {
  type: 'wiki' | 'repo';
  title: string;
  path: string;
  preview: string;
  score: number;
  tags?: string[];
  language?: string;
}

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Load index - try multiple paths for different environments
function loadIndex(): WikiIndex | null {
  const possiblePaths = [
    path.join(process.cwd(), 'public/data/index.json'),
    path.join(process.cwd(), 'data/index.json'),
    path.resolve('./public/data/index.json'),
    path.resolve('./data/index.json'),
  ];

  for (const indexPath of possiblePaths) {
    try {
      if (fs.existsSync(indexPath)) {
        const data = fs.readFileSync(indexPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      // Try next path
    }
  }

  console.error('Index not found in any expected location');
  return null;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Parse query parameters
  const params = event.queryStringParameters || {};
  const query = (params.q || params.query || '').toLowerCase().trim();
  const category = params.category || '';
  const language = params.language || '';
  const limit = parseInt(params.limit || '50', 10);

  // Load index
  const index = loadIndex();
  if (!index) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Index not available' }),
    };
  }

  const results: SearchResult[] = [];

  // Search documents
  for (const doc of index.documents) {
    if (category && doc.category !== category) continue;
    if (language && doc.language !== language) continue;

    let score = 0;
    const searchText = `${doc.title} ${doc.description || ''} ${doc.tags.join(' ')} ${doc.content}`.toLowerCase();

    if (query) {
      if (doc.title.toLowerCase().includes(query)) score += 50;
      if (doc.tags.some(t => t.toLowerCase().includes(query))) score += 30;
      if (searchText.includes(query)) score += 10;
      if (score === 0) continue;
    } else if (category || language) {
      score = 10;
    } else {
      continue; // Need at least one filter
    }

    // Boost wiki results
    score *= 2;

    results.push({
      type: 'wiki',
      title: doc.title,
      path: doc.relativePath,
      preview: doc.contentPreview,
      score,
      tags: doc.tags,
      language: doc.language,
    });
  }

  // Search repos
  for (const repo of index.repos) {
    if (language && !repo.languages.includes(language)) continue;

    let score = 0;
    const searchText = `${repo.name} ${repo.description || ''} ${repo.languages.join(' ')}`.toLowerCase();

    if (query) {
      if (repo.name.toLowerCase().includes(query)) score += 50;
      if (searchText.includes(query)) score += 10;
      if (score === 0) continue;
    } else if (language) {
      score = 5;
    } else {
      continue;
    }

    results.push({
      type: 'repo',
      title: repo.name,
      path: repo.githubUrl || '',
      preview: repo.description || 'No description',
      score,
      tags: repo.languages,
    });
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      data: {
        results: results.slice(0, limit),
        total: results.length,
        query,
      },
    }),
  };
};

export { handler };
