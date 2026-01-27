/**
 * Index API function for Code Wiki
 * Returns the full wiki index
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import * as fs from 'fs';
import * as path from 'path';

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Load index - try multiple paths for different environments
function loadIndex(): object | null {
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

  // Load index
  const index = loadIndex();
  if (!index) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Index not available' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(index),
  };
};

export { handler };
