/**
 * Full Index API - Returns complete index including private repos
 *
 * Access modes (controlled by PRIVATE_REPO_ACCESS env var):
 * - owner-only (default): canReadPrivate gate from getAccessLevel decides
 * - github-permissions: Check user's GitHub access to each private repo (OAuth required)
 *
 * The full index file is read from the filesystem at `private-data/index-full.json`
 * (overlaid by netlify-build.sh from the private content repo) — never via HTTP,
 * so the file is not exposed as a static CDN asset.
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import { getAccessLevel } from './_shared/auth.js';

const PRIVATE_REPO_ACCESS = process.env.PRIVATE_REPO_ACCESS || 'owner-only';

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

interface WikiDocument {
  visibility?: 'public' | 'private';
  [key: string]: unknown;
}

interface WikiIndex {
  documents: WikiDocument[];
  repos: RepoInfo[];
  categories: string[];
  buildTime: string;
  version: string;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

/**
 * Read index-full.json from the filesystem. Tries private-data first (post-fix layout)
 * then falls back to public/data (legacy layout) so this works on deploys where
 * netlify-build.sh has not yet been updated.
 */
function loadFullIndex(): WikiIndex | null {
  const candidates = [
    path.join(process.cwd(), 'private-data/index-full.json'),
    path.resolve('./private-data/index-full.json'),
    path.join(process.cwd(), 'public/data/index-full.json'),
    path.resolve('./public/data/index-full.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as WikiIndex;
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (match) return { owner: match[1], repo: match[2] };
  return null;
}

async function checkRepoAccess(octokit: Octokit, owner: string, repo: string): Promise<boolean> {
  try {
    await octokit.repos.get({ owner, repo });
    return true;
  } catch (err: any) {
    if (err.status === 404 || err.status === 403) return false;
    throw err;
  }
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const access = getAccessLevel(event);
  if (!access.session) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required for private repos' }),
    };
  }

  const fullIndex = loadFullIndex();
  if (!fullIndex) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Full index not found. Run build:index first.' }),
    };
  }

  try {
    if (PRIVATE_REPO_ACCESS === 'github-permissions') {
      // Dynamic mode requires a real GitHub OAuth token to query repo access.
      // Passcode sessions (no access_token) fall through to public-only view.
      if (!access.session.access_token) {
        const publicRepos = fullIndex.repos.filter((r) => r.visibility !== 'private');
        const publicDocuments = fullIndex.documents.filter((d) => d.visibility !== 'private');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: { ...fullIndex, repos: publicRepos, documents: publicDocuments },
            accessMode: 'github-permissions',
            user: access.session.login,
            note: 'github-permissions mode requires OAuth; passcode sessions get public view',
          }),
        };
      }
      const octokit = new Octokit({ auth: access.session.access_token });
      const accessibleRepos: RepoInfo[] = [];
      for (const repo of fullIndex.repos) {
        if (repo.visibility !== 'private') {
          accessibleRepos.push(repo);
        } else if (repo.githubUrl) {
          const parsed = parseGitHubUrl(repo.githubUrl);
          if (parsed && (await checkRepoAccess(octokit, parsed.owner, parsed.repo))) {
            accessibleRepos.push(repo);
          }
        }
      }
      const publicDocuments = fullIndex.documents.filter((d) => d.visibility !== 'private');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: { ...fullIndex, repos: accessibleRepos, documents: publicDocuments },
          accessMode: 'github-permissions',
          user: access.session.login,
        }),
      };
    }

    // owner-only (default): canReadPrivate gate covers owner + viewer/editor passcode tiers.
    if (access.canReadPrivate) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: fullIndex,
          accessMode: 'owner-only',
          user: access.session.login,
          isOwner: access.canAdmin,
        }),
      };
    }
    const publicRepos = fullIndex.repos.filter((r) => r.visibility !== 'private');
    const publicDocuments = fullIndex.documents.filter((d) => d.visibility !== 'private');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: { ...fullIndex, repos: publicRepos, documents: publicDocuments },
        accessMode: 'owner-only',
        user: access.session.login,
        isOwner: false,
      }),
    };
  } catch (err: any) {
    console.error('Error reading index:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load index' }),
    };
  }
};

export { handler };
