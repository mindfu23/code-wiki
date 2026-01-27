/**
 * Repos API function for Code Wiki
 * Returns repository information
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import * as fs from 'fs';
import * as path from 'path';

interface RepoInfo {
  name: string;
  description?: string;
  githubUrl?: string;
  localPath?: string;
  languages: string[];
  lastCommitDate?: string;
  status: 'synced' | 'local-only' | 'github-only';
}

interface WikiIndex {
  repos: RepoInfo[];
}

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  const status = params.status || '';
  const search = (params.search || params.q || '').toLowerCase();
  const language = params.language || '';

  // Load index
  const index = loadIndex();
  if (!index) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Index not available' }),
    };
  }

  let repos = index.repos;

  // Filter by status
  if (status) {
    repos = repos.filter(r => r.status === status);
  }

  // Filter by language
  if (language) {
    repos = repos.filter(r => r.languages.includes(language));
  }

  // Filter by search
  if (search) {
    repos = repos.filter(r =>
      r.name.toLowerCase().includes(search) ||
      (r.description && r.description.toLowerCase().includes(search))
    );
  }

  // Sort by name
  repos.sort((a, b) => a.name.localeCompare(b.name));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      data: {
        repos,
        total: repos.length,
      },
    }),
  };
};

export { handler };
