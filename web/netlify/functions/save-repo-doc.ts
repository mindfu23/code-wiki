/**
 * Save Repo Doc API - Creates documentation files in external repositories
 * Uses user's GitHub token to commit to repos they have write access to
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Octokit } from '@octokit/rest';
import * as crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;

interface SessionData {
  access_token: string;
  user_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  exp: number;
}

interface SaveRepoDocRequest {
  repoName: string;
  githubUrl: string;
  filename: string;
  content: string;
}

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

// Supported doc file extensions
const VALID_EXTENSIONS = ['.md', '.txt', '.rst', '.adoc', '.asciidoc', '.org'];

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

/**
 * Parse GitHub URL to extract owner and repo name
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

/**
 * Sanitize filename to prevent path traversal
 */
function sanitizeFilename(filename: string): string | null {
  // Remove any path components
  const basename = filename.split('/').pop() || filename;

  // Prevent traversal
  if (basename.includes('..') || basename.startsWith('.')) {
    return null;
  }

  // Check extension
  const hasValidExt = VALID_EXTENSIONS.some(ext =>
    basename.toLowerCase().endsWith(ext)
  );
  if (!hasValidExt) {
    return null;
  }

  return basename;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
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
  let request: SaveRepoDocRequest;
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
  if (!request.repoName || !request.githubUrl || !request.filename || !request.content) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing required fields: repoName, githubUrl, filename, content' }),
    };
  }

  // Parse GitHub URL
  const parsed = parseGitHubUrl(request.githubUrl);
  if (!parsed) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid GitHub URL' }),
    };
  }

  // Sanitize filename
  const sanitizedFilename = sanitizeFilename(request.filename);
  if (!sanitizedFilename) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid filename. Must be a valid doc file extension: ' + VALID_EXTENSIONS.join(', ')
      }),
    };
  }

  try {
    // Initialize Octokit with user's token
    const octokit = new Octokit({ auth: session.access_token });

    // Check if file already exists
    let existingSha: string | undefined;
    try {
      const { data: existingFile } = await octokit.repos.getContent({
        owner: parsed.owner,
        repo: parsed.repo,
        path: sanitizedFilename,
      });

      if (!Array.isArray(existingFile) && existingFile.type === 'file') {
        existingSha = existingFile.sha;
      }
    } catch (err: any) {
      if (err.status !== 404) {
        throw err;
      }
      // File doesn't exist - that's expected for new files
    }

    // Build committer/author info
    const authorName = session.name || session.login;
    const authorEmail = session.email || `${session.login}@users.noreply.github.com`;

    // Build commit message
    const commitMessage = existingSha
      ? `Update ${sanitizedFilename}`
      : `Add ${sanitizedFilename}`;

    // Commit the file
    const commitResponse = await octokit.repos.createOrUpdateFileContents({
      owner: parsed.owner,
      repo: parsed.repo,
      path: sanitizedFilename,
      message: commitMessage,
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        commit: {
          sha: commitResponse.data.commit.sha,
          url: commitResponse.data.commit.html_url,
          message: commitMessage,
        },
        file: {
          path: sanitizedFilename,
          sha: commitResponse.data.content?.sha,
          url: commitResponse.data.content?.html_url,
        },
        repo: {
          owner: parsed.owner,
          name: parsed.repo,
        },
      }),
    };
  } catch (err: any) {
    console.error('GitHub commit error:', err);

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

    if (err.status === 404) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: 'Repository not found or not accessible.',
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

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create documentation. Please try again.' }),
    };
  }
};

export { handler };
