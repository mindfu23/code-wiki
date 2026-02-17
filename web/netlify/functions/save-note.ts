/**
 * Save Note API - Updates repo notes in repo-locations.md via GitHub API
 * Uses user's GitHub token for commit attribution
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Octokit } from '@octokit/rest';
import * as crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'mindfu23';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'code-wiki';
const REPO_LOCATIONS_PATH = 'wiki/projects/repo-locations.md';

interface SessionData {
  access_token: string;
  user_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  exp: number;
}

interface SaveNoteRequest {
  repoName: string;
  note: string;
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

/**
 * Update the Notes field for a specific repo in repo-locations.md content
 */
function updateRepoNote(content: string, repoName: string, newNote: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inTargetRepo = false;
  let foundNotesLine = false;
  let repoSectionEnded = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for repo header (### RepoName)
    if (line.startsWith('### ')) {
      if (inTargetRepo && !foundNotesLine && !repoSectionEnded) {
        // We were in target repo but didn't find Notes line - add it before new section
        result.push(`- **Notes:** ${newNote}`);
      }
      inTargetRepo = line.substring(4).trim() === repoName;
      foundNotesLine = false;
      repoSectionEnded = false;
    }

    // Check for Notes line within target repo
    if (inTargetRepo && line.startsWith('- **Notes:**')) {
      // Replace the notes line
      result.push(`- **Notes:** ${newNote}`);
      foundNotesLine = true;
      continue;
    }

    // Check for end of repo section (empty line or new section)
    if (inTargetRepo && !foundNotesLine && (line.trim() === '' || line.startsWith('## '))) {
      // Add notes before the empty line or new section
      result.push(`- **Notes:** ${newNote}`);
      foundNotesLine = true;
      repoSectionEnded = true;
    }

    result.push(line);
  }

  // Handle case where target repo is at the very end
  if (inTargetRepo && !foundNotesLine) {
    result.push(`- **Notes:** ${newNote}`);
  }

  return result.join('\n');
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
  let request: SaveNoteRequest;
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
  if (!request.repoName) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing required field: repoName' }),
    };
  }

  // Sanitize note - allow empty string to clear note
  const sanitizedNote = (request.note || '').trim();

  try {
    // Initialize Octokit with user's token
    const octokit = new Octokit({ auth: session.access_token });

    // Get current repo-locations.md content
    const { data: existingFile } = await octokit.repos.getContent({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      path: REPO_LOCATIONS_PATH,
    });

    if (Array.isArray(existingFile) || existingFile.type !== 'file') {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'repo-locations.md not found or is not a file' }),
      };
    }

    // Decode content
    const currentContent = Buffer.from(existingFile.content, 'base64').toString('utf-8');

    // Update the note for the specified repo
    const updatedContent = updateRepoNote(currentContent, request.repoName, sanitizedNote);

    // Check if content actually changed
    if (currentContent === updatedContent) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No changes needed',
          noChange: true,
        }),
      };
    }

    // Build committer/author info
    const authorName = session.name || session.login;
    const authorEmail = session.email || `${session.login}@users.noreply.github.com`;

    // Commit the updated file
    const commitMessage = sanitizedNote
      ? `Update note for ${request.repoName}`
      : `Clear note for ${request.repoName}`;

    const commitResponse = await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      path: REPO_LOCATIONS_PATH,
      message: commitMessage,
      content: Buffer.from(updatedContent).toString('base64'),
      sha: existingFile.sha,
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
          message: commitMessage,
        },
        repoName: request.repoName,
        note: sanitizedNote,
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
      body: JSON.stringify({ error: 'Failed to save note. Please try again.' }),
    };
  }
};

export { handler };
