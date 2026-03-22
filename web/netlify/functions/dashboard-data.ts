/**
 * Dashboard Data API — aggregates GitHub + Netlify metrics for the Observatory dashboard.
 * Merges data from: wiki index (all known repos) + GitHub API + Netlify API.
 *
 * Access control:
 * - Unauthenticated users: see only public repos (from index.json + public GitHub API)
 * - Authenticated owner: sees all repos including private (from index-full.json)
 * - Authenticated non-owner: sees only public repos
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_SECRET = process.env.SESSION_SECRET;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || '';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

interface ProjectHealthRow {
  name: string;
  lastCommitDate: string;
  commitCount30d: number;
  language: string | null;
  deployStatus: 'healthy' | 'warning' | 'error' | 'unknown';
  deployPlatform: string;
  lastDeployDate: string;
  deploySuccessRate: number;
  actionsStatus: 'healthy' | 'warning' | 'error' | 'unknown';
  trafficLevel: 'high' | 'medium' | 'low' | 'none';
  openIssues: number;
  siteUrl?: string;
}

// --- Auth helpers (same pattern as full-index.ts) ---

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

function isOwnerSession(event: HandlerEvent): boolean {
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.wiki_session;
  if (!sessionToken) return false;
  const session = decryptSession(sessionToken);
  if (!session) return false;
  return session.login.toLowerCase() === GITHUB_REPO_OWNER.toLowerCase();
}

// --- GitHub API helpers ---

async function fetchGitHubRepos(username: string, token: string) {
  const response = await fetch(
    `https://api.github.com/users/${username}/repos?sort=pushed&per_page=100&type=owner`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'code-wiki-observatory',
      },
    }
  );
  if (!response.ok) throw new Error(`GitHub API: ${response.status}`);
  return response.json() as Promise<Array<{
    name: string;
    full_name: string;
    language: string | null;
    open_issues_count: number;
    pushed_at: string;
  }>>;
}

async function fetchWorkflowRuns(fullName: string, token: string) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${fullName}/actions/runs?per_page=5`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'code-wiki-observatory',
        },
      }
    );
    if (!response.ok) return [];
    const data = await response.json() as {
      workflow_runs: Array<{ conclusion: string | null; status: string }>;
    };
    return data.workflow_runs || [];
  } catch {
    return [];
  }
}

// --- Netlify API helpers ---

interface NetlifySite {
  id: string;
  name: string;
  ssl_url: string;
  url: string;
  build_settings?: { repo_url?: string };
}

interface NetlifyDeploy {
  id: string;
  state: string;
  created_at: string;
  deploy_time: number | null;
  error_message: string | null;
}

async function fetchNetlifySites(token: string): Promise<NetlifySite[]> {
  const response = await fetch('https://api.netlify.com/api/v1/sites', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) return [];
  return response.json() as Promise<NetlifySite[]>;
}

async function fetchNetlifyDeploys(siteId: string, token: string): Promise<NetlifyDeploy[]> {
  try {
    const response = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=10`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (!response.ok) return [];
    return response.json() as Promise<NetlifyDeploy[]>;
  } catch {
    return [];
  }
}

// --- Wiki index helpers (for local-only repos) ---

interface IndexRepoInfo {
  name: string;
  description?: string;
  languages: string[];
  lastCommitDate?: string;
  status: 'synced' | 'local-only' | 'github-only';
}

function loadWikiIndex(includePrivate: boolean): IndexRepoInfo[] {
  // Owner gets index-full.json (all repos); public visitors get index.json (public only)
  const indexFile = includePrivate ? 'index-full.json' : 'index.json';
  const possiblePaths = [
    path.join(process.cwd(), `public/data/${indexFile}`),
    path.join(process.cwd(), `data/${indexFile}`),
    path.resolve(`./public/data/${indexFile}`),
    path.resolve(`./data/${indexFile}`),
  ];
  for (const indexPath of possiblePaths) {
    try {
      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        return data.repos || [];
      }
    } catch {
      // Try next path
    }
  }
  return [];
}

// --- Main handler ---

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const githubToken = process.env.GITHUB_TOKEN || process.env.REPO_ACCESS_TOKEN;
  const githubUsername = process.env.GITHUB_USERNAME || process.env.GITHUB_REPO_OWNER;
  const netlifyToken = process.env.NETLIFY_ACCESS_TOKEN;

  if (!githubToken || !githubUsername) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'GitHub credentials not configured' }),
    };
  }

  try {
    // Check if the requesting user is the wiki owner (authenticated via session cookie)
    const includePrivate = isOwnerSession(event);

    // Fetch GitHub repos, Netlify sites, and wiki index in parallel
    const [githubRepos, netlifySites, wikiRepos] = await Promise.all([
      fetchGitHubRepos(githubUsername, githubToken),
      netlifyToken ? fetchNetlifySites(netlifyToken) : Promise.resolve([]),
      Promise.resolve(loadWikiIndex(includePrivate)),
    ]);

    // Build repo-to-Netlify-site mapping
    const repoToSite = new Map<string, NetlifySite>();
    for (const site of netlifySites) {
      const repoUrl = site.build_settings?.repo_url;
      if (repoUrl) {
        const repoName = repoUrl.split('/').pop()?.replace(/\.git$/, '');
        if (repoName) repoToSite.set(repoName.toLowerCase(), site);
      }
    }

    // Build a map of GitHub repos by name for quick lookup
    const githubByName = new Map<string, typeof githubRepos[0]>();
    for (const repo of githubRepos) {
      githubByName.set(repo.name.toLowerCase(), repo);
    }

    // Build a unified set of all known project names from all sources
    const allProjectNames = new Set<string>();
    for (const repo of githubRepos) allProjectNames.add(repo.name.toLowerCase());
    for (const repo of wikiRepos) allProjectNames.add(repo.name.toLowerCase());

    // Process all projects in batches
    const allNames = Array.from(allProjectNames);
    const projects: ProjectHealthRow[] = [];

    for (let i = 0; i < allNames.length; i += 10) {
      const batch = allNames.slice(i, i + 10);
      const batchResults = await Promise.allSettled(
        batch.map(async (projectName) => {
          const ghRepo = githubByName.get(projectName);
          const wikiRepo = wikiRepos.find(r => r.name.toLowerCase() === projectName);
          const site = repoToSite.get(projectName);

          // Use GitHub data if available, otherwise fall back to wiki index
          const name = ghRepo?.name || wikiRepo?.name || projectName;
          const lastCommitDate = ghRepo?.pushed_at || wikiRepo?.lastCommitDate || '';
          const language = ghRepo?.language || (wikiRepo?.languages?.[0] ?? null);
          const openIssues = ghRepo?.open_issues_count || 0;

          // Fetch Actions runs only for GitHub repos
          let actionsStatus: ProjectHealthRow['actionsStatus'] = 'unknown';
          if (ghRepo) {
            const runs = await fetchWorkflowRuns(ghRepo.full_name, githubToken);
            if (runs.length > 0) {
              const hasFailure = runs.some((r: { conclusion: string | null }) => r.conclusion === 'failure');
              const allSuccess = runs.every(
                (r: { conclusion: string | null; status: string }) =>
                  r.conclusion === 'success' || r.conclusion === 'skipped'
              );
              actionsStatus = hasFailure ? 'error' : allSuccess ? 'healthy' : 'warning';
            }
          }

          // Fetch deploy status
          let deployStatus: ProjectHealthRow['deployStatus'] = 'unknown';
          let deployPlatform = '';
          let lastDeployDate = '';
          let deploySuccessRate = 1;
          let siteUrl: string | undefined;

          if (site && netlifyToken) {
            deployPlatform = 'netlify';
            siteUrl = site.ssl_url || site.url;
            const deploys = await fetchNetlifyDeploys(site.id, netlifyToken);
            if (deploys.length > 0) {
              lastDeployDate = deploys[0].created_at;
              deployStatus = deploys[0].state === 'ready' ? 'healthy' :
                            deploys[0].state === 'error' ? 'error' : 'warning';
              const successCount = deploys.filter(d => d.state === 'ready').length;
              deploySuccessRate = Math.round((successCount / deploys.length) * 100) / 100;
            }
          }

          return {
            name,
            lastCommitDate,
            commitCount30d: 0,
            language,
            deployStatus,
            deployPlatform,
            lastDeployDate,
            deploySuccessRate,
            actionsStatus,
            trafficLevel: 'none' as const,
            openIssues,
            siteUrl,
          };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          projects.push(result.value);
        }
      }
    }

    // Sort: errors first, then by last commit date
    projects.sort((a, b) => {
      const aErr = a.deployStatus === 'error' || a.actionsStatus === 'error' ? 0 : 1;
      const bErr = b.deployStatus === 'error' || b.actionsStatus === 'error' ? 0 : 1;
      if (aErr !== bErr) return aErr - bErr;
      return new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime();
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          projects,
          collectedAt: new Date().toISOString(),
          totalProjects: projects.length,
          deployedProjects: projects.filter(p => p.deployPlatform).length,
          projectsWithErrors: projects.filter(
            p => p.deployStatus === 'error' || p.actionsStatus === 'error'
          ).length,
        },
      }),
    };
  } catch (error) {
    console.error('Dashboard data error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

export { handler };
