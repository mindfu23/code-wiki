/**
 * Full Taxonomy API — Returns the complete taxonomy.json including private
 * project entries and dependsOn edges.
 *
 * Access:
 * - Requires a session with canReadPrivate (owner OAuth, or viewer passcode).
 *   Anonymous gets 401. The function never serves private content as a
 *   static asset — taxonomy-full.json is overlaid to `private-data/` by
 *   netlify-build.sh and bundled with this function only.
 *
 * Matches the security model of full-index.ts. See the
 * "Tiered access" section of the README for the canonical mapping of
 * session kind → capabilities.
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import * as fs from 'fs';
import * as path from 'path';
import { getAccessLevel } from './_shared/auth.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

/**
 * Load taxonomy-full.json from the filesystem. Tries private-data first
 * (post-fix layout) then falls back to public/data (legacy) so the function
 * keeps working on deploys where netlify-build.sh has not yet been updated.
 */
function loadFullTaxonomy(): unknown | null {
  const candidates = [
    path.join(process.cwd(), 'private-data/taxonomy-full.json'),
    path.resolve('./private-data/taxonomy-full.json'),
    path.join(process.cwd(), 'public/data/taxonomy-full.json'),
    path.resolve('./public/data/taxonomy-full.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const access = getAccessLevel(event);
  if (!access.canReadPrivate) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required for full taxonomy' }),
    };
  }

  const fullTaxonomy = loadFullTaxonomy();
  if (!fullTaxonomy) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Full taxonomy not found. Run build:taxonomy first.' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      data: fullTaxonomy,
      identity: access.identity,
    }),
  };
};

export { handler };
