/**
 * Rebuild Index API - Triggers GitHub Actions workflow to rebuild the wiki index
 * Requires authentication (logged-in user)
 * Uses REPO_ACCESS_TOKEN to dispatch the workflow
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import * as crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;
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

interface SessionData {
  access_token: string;
  user_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  exp: number;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name && rest.length > 0) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  });
  return cookies;
}

function decryptSession(token: string): SessionData | null {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) return null;
  try {
    const [ivB64, encryptedB64, authTagB64] = token.split('.');
    if (!ivB64 || !encryptedB64 || !authTagB64) return null;

    const key = Buffer.from(SESSION_SECRET.slice(0, 32), 'utf-8');
    const iv = Buffer.from(ivB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    const data = JSON.parse(decrypted) as SessionData;
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

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

  // Require authentication
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.wiki_session;
  if (!sessionToken) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required' }),
    };
  }

  const session = decryptSession(sessionToken);
  if (!session) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Invalid or expired session' }),
    };
  }

  // Check server-side config
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
    // Trigger the update-index.yml workflow via GitHub API
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
