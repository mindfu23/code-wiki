/**
 * Save Repo Doc API - Creates documentation files in external repositories
 * Uses user's GitHub token to commit to repos they have write access to
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Octokit } from '@octokit/rest';
import { getAccessLevel } from './_shared/auth.js';

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

  // Verify authentication and write capability. Save endpoints require a real
  // GitHub OAuth session — passcode-redeemed viewer sessions cannot commit.
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
