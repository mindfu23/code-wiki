/**
 * Document API function for Code Wiki
 * Returns a specific wiki document
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
  updated?: string;
  sourceRepo?: string;
  content: string;
  contentPreview: string;
  category: string;
}

interface WikiIndex {
  documents: WikiDocument[];
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

  // Get document path from query or path parameter
  const params = event.queryStringParameters || {};
  let docPath = params.path || params.doc || '';

  // Also check URL path (for /api/document/path/to/doc.md style)
  if (!docPath && event.path) {
    const match = event.path.match(/\/document\/(.+)/);
    if (match) {
      docPath = decodeURIComponent(match[1]);
    }
  }

  if (!docPath) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Document path required' }),
    };
  }

  // Load index
  const index = loadIndex();
  if (!index) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Index not available' }),
    };
  }

  // Find document
  const doc = index.documents.find(d =>
    d.relativePath === docPath ||
    d.relativePath === decodeURIComponent(docPath)
  );

  if (!doc) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Document not found' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      data: doc,
    }),
  };
};

export { handler };
