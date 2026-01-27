/**
 * Categories API function for Code Wiki
 * Returns wiki categories and their documents
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import * as fs from 'fs';
import * as path from 'path';

interface WikiDocument {
  relativePath: string;
  title: string;
  description?: string;
  tags: string[];
  language?: string;
  category: string;
}

interface WikiIndex {
  documents: WikiDocument[];
  categories: string[];
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

  // Get specific category from query
  const params = event.queryStringParameters || {};
  const categoryFilter = params.category || '';

  // Load index
  const index = loadIndex();
  if (!index) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Index not available' }),
    };
  }

  // If specific category requested, return its documents
  if (categoryFilter) {
    const docs = index.documents
      .filter(d => d.category === categoryFilter)
      .map(d => ({
        path: d.relativePath,
        title: d.title,
        description: d.description,
        tags: d.tags,
        language: d.language,
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          category: categoryFilter,
          documents: docs,
          count: docs.length,
        },
      }),
    };
  }

  // Return all categories with counts
  const categoryCounts: Record<string, number> = {};
  index.documents.forEach(doc => {
    categoryCounts[doc.category] = (categoryCounts[doc.category] || 0) + 1;
  });

  const categories = index.categories.map(cat => ({
    name: cat,
    count: categoryCounts[cat] || 0,
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      data: {
        categories,
        total: categories.length,
      },
    }),
  };
};

export { handler };
