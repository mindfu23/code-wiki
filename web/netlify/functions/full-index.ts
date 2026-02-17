/**
 * Full Index API - Returns complete index including private repos
 *
 * Access modes (controlled by PRIVATE_REPO_ACCESS env var):
 * - owner-only (default): Only wiki owner sees private repos
 * - github-permissions: Check user's GitHub access to each private repo
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import * as crypto from 'crypto';
import { Octokit } from '@octokit/rest';

const SESSION_SECRET = process.env.SESSION_SECRET;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || '';
const PRIVATE_REPO_ACCESS = process.env.PRIVATE_REPO_ACCESS || 'owner-only';

interface SessionData {
  access_token: string;
  user_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  exp: number;
}

interface RepoInfo {
  name: string;
  description?: string;
  githubUrl?: string;
  localPath?: string;
  languages: string[];
  lastCommitDate?: string;
  status: 'synced' | 'local-only' | 'github-only';
  visibility?: 'public' | 'private';
  markdownFiles?: Array<{
    relativePath: string;
    name: string;
    fileType: string;
  }>;
  notes?: string;
}

interface WikiIndex {
  documents: unknown[];
  repos: RepoInfo[];
  categories: string[];
  buildTime: string;
  version: string;
}

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
 * Check if user has access to a GitHub repo using their token
 */
async function checkRepoAccess(octokit: Octokit, owner: string, repo: string): Promise<boolean> {
  try {
    await octokit.repos.get({ owner, repo });
    return true;
  } catch (err: any) {
    if (err.status === 404 || err.status === 403) {
      return false;
    }
    throw err;
  }
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

  // Check authentication
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.wiki_session;

  if (!sessionToken) {
    // Not authenticated - return public index
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required for private repos' }),
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

  try {
    // Fetch the full index from the CDN (functions can't access static files directly)
    const host = event.headers.host || 'localhost';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const indexUrl = `${protocol}://${host}/data/index-full.json`;

    const indexResponse = await fetch(indexUrl);
    if (!indexResponse.ok) {
      throw { code: 'ENOENT', message: `Failed to fetch index: ${indexResponse.status}` };
    }
    const fullIndex: WikiIndex = await indexResponse.json();

    // Determine which repos to include based on access mode
    if (PRIVATE_REPO_ACCESS === 'github-permissions') {
      // Dynamic mode: Check GitHub permissions for each private repo
      const octokit = new Octokit({ auth: session.access_token });

      const accessibleRepos: RepoInfo[] = [];

      for (const repo of fullIndex.repos) {
        if (repo.visibility !== 'private') {
          // Public repo - always include
          accessibleRepos.push(repo);
        } else if (repo.githubUrl) {
          // Private repo - check GitHub access
          const parsed = parseGitHubUrl(repo.githubUrl);
          if (parsed) {
            const hasAccess = await checkRepoAccess(octokit, parsed.owner, parsed.repo);
            if (hasAccess) {
              accessibleRepos.push(repo);
            }
          }
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            ...fullIndex,
            repos: accessibleRepos,
          },
          accessMode: 'github-permissions',
          user: session.login,
        }),
      };
    } else {
      // Static mode (default): Only owner sees private repos
      if (!GITHUB_REPO_OWNER) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'GITHUB_REPO_OWNER not configured' }),
        };
      }

      const isOwner = session.login.toLowerCase() === GITHUB_REPO_OWNER.toLowerCase();

      if (isOwner) {
        // Owner gets full index
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: fullIndex,
            accessMode: 'owner-only',
            user: session.login,
            isOwner: true,
          }),
        };
      } else {
        // Non-owner gets public repos only
        const publicRepos = fullIndex.repos.filter(r => r.visibility !== 'private');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: {
              ...fullIndex,
              repos: publicRepos,
            },
            accessMode: 'owner-only',
            user: session.login,
            isOwner: false,
          }),
        };
      }
    }
  } catch (err: any) {
    console.error('Error reading index:', err);

    if (err.code === 'ENOENT') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Full index not found. Run build:index first.' }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load index' }),
    };
  }
};

export { handler };
