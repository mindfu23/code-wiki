/**
 * Save Document API - Commits wiki document to GitHub
 * Uses user's GitHub token for commit attribution
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Octokit } from '@octokit/rest';
import * as crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || '';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'code-wiki';
const WIKI_PATH_PREFIX = 'wiki/';

// Validate required configuration
function validateConfig(): string | null {
  if (!GITHUB_REPO_OWNER) {
    return 'GITHUB_REPO_OWNER environment variable is not configured. Please set it in your Netlify dashboard.';
  }
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    return 'SESSION_SECRET environment variable is not configured or too short (min 32 chars).';
  }
  return null;
}

interface SessionData {
  access_token: string;
  user_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  exp: number;
}

interface SaveRequest {
  path: string;
  content: string;
  commitMessage: string;
  isNew?: boolean;
}

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

// Parse cookies from header
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

// Decrypt session data
function decryptSession(token: string): SessionData | null {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.error('SESSION_SECRET not configured');
    return null;
  }

  try {
    const [ivB64, encryptedB64, authTagB64] = token.split('.');
    if (!ivB64 || !encryptedB64 || !authTagB64) {
      return null;
    }

    const key = Buffer.from(SESSION_SECRET.slice(0, 32), 'utf-8');
    const iv = Buffer.from(ivB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    const data = JSON.parse(decrypted) as SessionData;

    // Check expiration
    if (data.exp < Date.now()) {
      return null;
    }

    return data;
  } catch (err) {
    console.error('Session decryption failed:', err);
    return null;
  }
}

// Sanitize path to prevent directory traversal
function sanitizePath(path: string): string | null {
  // Remove leading slashes and normalize
  let sanitized = path.replace(/^\/+/, '').replace(/\\/g, '/');

  // Prevent directory traversal
  if (sanitized.includes('..') || sanitized.includes('//')) {
    return null;
  }

  // Ensure it ends with .md
  if (!sanitized.endsWith('.md')) {
    sanitized += '.md';
  }

  // Validate path components
  const parts = sanitized.split('/');
  for (const part of parts) {
    if (!part || part.startsWith('.')) {
      return null;
    }
  }

  return sanitized;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Validate configuration
  const configError = validateConfig();
  if (configError) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: configError }),
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Verify authentication
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
      body: JSON.stringify({ error: 'Invalid or expired session. Please log in again.' }),
    };
  }

  // Parse request body
  let request: SaveRequest;
  try {
    request = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  // Validate request
  if (!request.path || !request.content || !request.commitMessage) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing required fields: path, content, commitMessage' }),
    };
  }

  // Sanitize path
  const sanitizedPath = sanitizePath(request.path);
  if (!sanitizedPath) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid document path' }),
    };
  }

  const fullPath = WIKI_PATH_PREFIX + sanitizedPath;

  try {
    // Initialize Octokit with user's token
    const octokit = new Octokit({ auth: session.access_token });

    // Get current file SHA (if exists) - required for updates
    let existingSha: string | undefined;
    try {
      const { data: existingFile } = await octokit.repos.getContent({
        owner: GITHUB_REPO_OWNER,
        repo: GITHUB_REPO_NAME,
        path: fullPath,
      });

      if (!Array.isArray(existingFile) && existingFile.type === 'file') {
        existingSha = existingFile.sha;
      }
    } catch (err: any) {
      if (err.status !== 404) {
        throw err;
      }
      // File doesn't exist - this is a new file
    }

    // Build committer/author info
    const authorName = session.name || session.login;
    const authorEmail = session.email || `${session.login}@users.noreply.github.com`;

    // Commit the file
    const commitResponse = await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      path: fullPath,
      message: request.commitMessage,
      content: Buffer.from(request.content).toString('base64'),
      sha: existingSha,
      committer: {
        name: authorName,
        email: authorEmail,
      },
      author: {
        name: authorName,
        email: authorEmail,
      },
    });

    // Trigger Netlify rebuild if build hook is configured
    const buildHook = process.env.NETLIFY_BUILD_HOOK;
    if (buildHook) {
      try {
        await fetch(buildHook, { method: 'POST' });
        console.log('Triggered Netlify rebuild');
      } catch (err) {
        console.error('Failed to trigger rebuild:', err);
        // Don't fail the save if rebuild trigger fails
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        commit: {
          sha: commitResponse.data.commit.sha,
          url: commitResponse.data.commit.html_url,
          message: request.commitMessage,
        },
        file: {
          path: fullPath,
          sha: commitResponse.data.content?.sha,
        },
      }),
    };
  } catch (err: any) {
    console.error('GitHub commit error:', err);

    // Handle specific GitHub errors
    if (err.status === 401) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'GitHub authentication failed. Please log in again.' }),
      };
    }

    if (err.status === 403) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'Permission denied. You may not have write access to this repository.',
        }),
      };
    }

    if (err.status === 409) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          error: 'Conflict: The file was modified by someone else. Please refresh and try again.',
        }),
      };
    }

    if (err.status === 422) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'Invalid content. Please check your document.' }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to save document. Please try again.' }),
    };
  }
};

export { handler };
