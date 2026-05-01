/**
 * Save Document API - Commits wiki document to GitHub
 * Uses user's GitHub token for commit attribution
 * Triggers a Netlify rebuild so the document appears after the next build cycle.
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Octokit } from '@octokit/rest';
import { getAccessLevel } from './_shared/auth.js';

const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || '';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'code-wiki';
const PRIVATE_CONTENT_REPO = process.env.PRIVATE_CONTENT_REPO || '';
const WIKI_PATH_PREFIX = 'wiki/';

function parsePrivateContentRepo(): { owner: string; repo: string } | null {
  if (!PRIVATE_CONTENT_REPO) return null;
  const parts = PRIVATE_CONTENT_REPO.split('/');
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

const PRIVATE_PATH_PREFIXES = ['wiki/personal/'];
const PRIVATE_PATH_PATTERNS: RegExp[] = [/^wiki\/_taxonomy\/example-.*$/];

function hasPrivateVisibility(content: string): boolean {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return false;
  return /^\s*visibility\s*:\s*["']?private["']?\s*$/im.test(match[1]);
}

function shouldRouteToPrivate(fullPath: string, content: string): boolean {
  if (PRIVATE_PATH_PREFIXES.some((p) => fullPath.startsWith(p))) return true;
  if (PRIVATE_PATH_PATTERNS.some((r) => r.test(fullPath))) return true;
  return hasPrivateVisibility(content);
}

// Validate required configuration
function validateConfig(): string | null {
  if (!GITHUB_REPO_OWNER) {
    return 'GITHUB_REPO_OWNER environment variable is not configured. Please set it in your Netlify dashboard.';
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    return 'SESSION_SECRET environment variable is not configured or too short (min 32 chars).';
  }
  return null;
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

  // Verify authentication and write capability. Save endpoints require a real
  // GitHub OAuth session — passcode-redeemed viewer/editor sessions cannot
  // commit on behalf of a user (no access_token to attribute commits to).
  const access = getAccessLevel(event);
  if (!access.session) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required' }),
    };
  }
  if (!access.canWrite || !access.session.access_token) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'This session does not have write permission' }),
    };
  }
  const session = access.session;

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

  // Route private content to the private content repo. A document is treated
  // as private if its path is under a private prefix (e.g. wiki/personal/),
  // matches a private pattern (e.g. wiki/_taxonomy/example-*), or its
  // frontmatter declares `visibility: private`.
  const routeToPrivate = shouldRouteToPrivate(fullPath, request.content);
  let targetOwner = GITHUB_REPO_OWNER;
  let targetRepo = GITHUB_REPO_NAME;

  if (routeToPrivate) {
    const privateRepo = parsePrivateContentRepo();
    if (!privateRepo) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error:
            'This document is private (visibility: private or under a private path) ' +
            'but PRIVATE_CONTENT_REPO is not configured. Set it to owner/repo ' +
            '(e.g. mindfu23/code-wiki-content) in Netlify env vars.',
        }),
      };
    }
    targetOwner = privateRepo.owner;
    targetRepo = privateRepo.repo;
  }

  try {
    // Initialize Octokit with user's token
    const octokit = new Octokit({ auth: session.access_token });

    // Get current file SHA (if exists) - required for updates
    let existingSha: string | undefined;
    try {
      const { data: existingFile } = await octokit.repos.getContent({
        owner: targetOwner,
        repo: targetRepo,
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
      owner: targetOwner,
      repo: targetRepo,
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

    // Index files are now in the private content repo and rebuilt by GitHub Actions.
    // Instead of updating them inline, trigger a Netlify rebuild so the overlay
    // picks up the committed document on next build. See HANDOFF-rearchitecture.md decision #7.

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
