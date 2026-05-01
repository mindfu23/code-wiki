/**
 * Rebuild Index API - Triggers GitHub Actions workflow to rebuild the wiki index.
 *
 * Restricted to the owner (canAdmin). Previously this only required "any valid
 * session", which meant any GitHub-authenticated visitor could trigger a workflow
 * dispatch on the owner's repo using the server-side REPO_ACCESS_TOKEN.
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { getAccessLevel } from './_shared/auth.js';

const REPO_ACCESS_TOKEN = process.env.REPO_ACCESS_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || '';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'code-wiki';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const access = getAccessLevel(event);
  if (!access.session) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required' }),
    };
  }
  if (!access.canAdmin) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Admin privileges required' }),
    };
  }

  if (!REPO_ACCESS_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'REPO_ACCESS_TOKEN not configured on server' }),
    };
  }
  if (!GITHUB_REPO_OWNER) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'GITHUB_REPO_OWNER not configured on server' }),
    };
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/update-index.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${REPO_ACCESS_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (response.status === 204) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Index rebuild triggered. Changes will appear in about a minute.',
        }),
      };
    }

    const errorText = await response.text();
    console.error(`GitHub API error: ${response.status} ${errorText}`);
    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify({
        error: `Failed to trigger rebuild (GitHub API returned ${response.status})`,
      }),
    };
  } catch (err: any) {
    console.error('Error triggering workflow:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to trigger index rebuild' }),
    };
  }
};

export { handler };
