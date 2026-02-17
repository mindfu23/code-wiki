/**
 * Save Document API - Commits wiki document to GitHub
 * Uses user's GitHub token for commit attribution
 * Also updates the index.json so new documents appear immediately
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Octokit } from '@octokit/rest';
import * as crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || '';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'code-wiki';
const WIKI_PATH_PREFIX = 'wiki/';

// Document structure matching the index
interface WikiDocument {
  path: string;
  relativePath: string;
  title: string;
  description?: string;
  tags: string[];
  language?: string;
  updated?: string;
  content: string;
  contentPreview: string;
  category: string;
}

interface WikiIndex {
  documents: WikiDocument[];
  repos: unknown[];
  categories: string[];
  buildTime: string;
  version: string;
}

// Simple frontmatter parser (no external dependency)
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const data: Record<string, unknown> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = content.slice(3, endIndex).trim();
      body = content.slice(endIndex + 3).trim();

      // Parse YAML-like frontmatter
      frontmatter.split('\n').forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim();
          let value = line.slice(colonIndex + 1).trim();

          // Remove quotes
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          // Parse arrays like [tag1, tag2]
          if (value.startsWith('[') && value.endsWith(']')) {
            const items = value.slice(1, -1).split(',').map(s => {
              let item = s.trim();
              if ((item.startsWith('"') && item.endsWith('"')) ||
                  (item.startsWith("'") && item.endsWith("'"))) {
                item = item.slice(1, -1);
              }
              return item;
            }).filter(Boolean);
            data[key] = items;
          } else {
            data[key] = value;
          }
        }
      });
    }
  }

  return { data, body };
}

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

    // Update the index.json with the new/updated document
    // This makes the document immediately available without waiting for GitHub Actions
    let indexUpdated = false;
    try {
      // Parse the document content to extract metadata
      const { data: frontmatter, body } = parseFrontmatter(request.content);

      // Build document entry
      const category = sanitizedPath.split('/')[0] || 'uncategorized';
      const fileName = sanitizedPath.split('/').pop()?.replace('.md', '') || '';

      const docEntry: WikiDocument = {
        path: fullPath,
        relativePath: sanitizedPath,
        title: (frontmatter.title as string) || fileName,
        description: frontmatter.description as string | undefined,
        tags: (frontmatter.tags as string[]) || [],
        language: frontmatter.language as string | undefined,
        updated: (frontmatter.updated as string) || new Date().toISOString().split('T')[0],
        content: body,
        contentPreview: body.slice(0, 300).replace(/\n/g, ' ').trim(),
        category,
      };

      // Update both index.json and index-full.json
      for (const indexPath of ['web/public/data/index.json', 'web/public/data/index-full.json']) {
        try {
          // Fetch current index
          const { data: indexFile } = await octokit.repos.getContent({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME,
            path: indexPath,
          });

          if (Array.isArray(indexFile) || indexFile.type !== 'file' || !indexFile.content) {
            continue;
          }

          const indexContent = Buffer.from(indexFile.content, 'base64').toString('utf-8');
          const index: WikiIndex = JSON.parse(indexContent);

          // Find existing document or add new one
          const existingIndex = index.documents.findIndex(d => d.relativePath === sanitizedPath);
          if (existingIndex >= 0) {
            index.documents[existingIndex] = docEntry;
          } else {
            index.documents.push(docEntry);
          }

          // Update build time
          index.buildTime = new Date().toISOString();

          // Commit updated index
          await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME,
            path: indexPath,
            message: `Update index: ${request.isNew ? 'add' : 'update'} ${sanitizedPath}`,
            content: Buffer.from(JSON.stringify(index, null, 2)).toString('base64'),
            sha: indexFile.sha,
            committer: {
              name: 'Docsy McDocsface',
              email: 'docsy@users.noreply.github.com',
            },
          });

          indexUpdated = true;
        } catch (indexErr: any) {
          console.error(`Failed to update ${indexPath}:`, indexErr.message);
          // Continue - document was saved, index update is optional
        }
      }

      if (indexUpdated) {
        console.log('Index updated with new document');
      }
    } catch (indexErr) {
      console.error('Failed to update index:', indexErr);
      // Don't fail the save if index update fails - document is saved
    }

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
        indexUpdated,
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
