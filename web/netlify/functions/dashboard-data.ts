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
import * as fs from 'fs';
import * as path from 'path';
import {
  assessCompletion,
  emptySentinels,
  type RepoSentinels,
  type CompletionAssessment,
} from './_shared/completionAssessment.js';
import { getAccessLevel } from './_shared/auth.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

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
  githubUrl?: string;
  /** Direct link to the most recent failing Actions run, when actionsStatus is
   *  error or warning. Falls back to the repo's /actions tab when we know CI
   *  is configured but can't pinpoint a specific failing run. Absent for repos
   *  with no CI history. */
  actionsUrl?: string;
  /** Lifecycle-stage classification — static sentinels from the index,
   *  refined with live deploy/actions/issues data at request time. */
  completion?: CompletionAssessment;
}

// --- GitHub API helpers ---

async function fetchGitHubRepos(username: string, token: string) {
  // Use the authenticated /user/repos endpoint to discover both public AND private repos.
  // The /users/{username}/repos endpoint only returns public repos regardless of auth.
  const repos: Array<{
    name: string;
    full_name: string;
    html_url: string;
    language: string | null;
    open_issues_count: number;
    pushed_at: string;
  }> = [];

  let page = 1;
  while (true) {
    const response = await fetch(
      `https://api.github.com/user/repos?sort=pushed&per_page=100&type=owner&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'code-wiki-observatory',
        },
      }
    );
    if (!response.ok) throw new Error(`GitHub API: ${response.status}`);
    const pageRepos = await response.json() as typeof repos;
    // Filter to only repos owned by the target username
    const ownedRepos = pageRepos.filter(
      r => r.full_name.split('/')[0].toLowerCase() === username.toLowerCase()
    );
    repos.push(...ownedRepos);
    if (pageRepos.length < 100) break;
    page++;
  }
  return repos;
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
      workflow_runs: Array<{
        conclusion: string | null;
        status: string;
        html_url: string;
      }>;
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
  sentinels?: RepoSentinels;
  completion?: CompletionAssessment;
}

function loadWikiIndex(includePrivate: boolean): IndexRepoInfo[] {
  // Public visitors get index.json (public-safe). Owner / viewer / editor sessions
  // get index-full.json which lives in private-data/ (not under public/data/) so the
  // file is not exposed as a static CDN asset. Falls back to public/data/ for
  // backward compatibility with deploys made before the static-leak fix.
  const indexFile = includePrivate ? 'index-full.json' : 'index.json';
  const possiblePaths = includePrivate
    ? [
        path.join(process.cwd(), `private-data/${indexFile}`),
        path.resolve(`./private-data/${indexFile}`),
        path.join(process.cwd(), `public/data/${indexFile}`),
        path.resolve(`./public/data/${indexFile}`),
      ]
    : [
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
    // Owner, viewer-passcode, and editor-passcode sessions all see the full index.
    const access = getAccessLevel(event);
    const includePrivate = access.canReadPrivate;

    // Fetch GitHub repos, Netlify sites, and wiki index in parallel
    const [githubRepos, netlifySites, wikiRepos] = await Promise.all([
      fetchGitHubRepos(githubUsername, githubToken),
      netlifyToken ? fetchNetlifySites(netlifyToken) : Promise.resolve([]),
      Promise.resolve(loadWikiIndex(includePrivate)),
    ]);

    console.log(`[dashboard-data] GitHub repos: ${githubRepos.length}, wiki repos: ${wikiRepos.length}, includePrivate: ${includePrivate}`);

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
          let actionsUrl: string | undefined;
          if (ghRepo) {
            const runs = await fetchWorkflowRuns(ghRepo.full_name, githubToken);
            if (runs.length > 0) {
              const hasFailure = runs.some((r) => r.conclusion === 'failure');
              const allSuccess = runs.every(
                (r) => r.conclusion === 'success' || r.conclusion === 'skipped'
              );
              actionsStatus = hasFailure ? 'error' : allSuccess ? 'healthy' : 'warning';

              // Deep-link the Actions badge: point at the first failing run
              // (most recent, since the API returns newest-first) so clicking
              // the red dot jumps directly to the error page in GitHub. For
              // warning or healthy states we link to the most recent run.
              // Repos with no run history get no link (plain dot).
              const failingRun = runs.find((r) => r.conclusion === 'failure');
              actionsUrl = failingRun?.html_url ?? runs[0]?.html_url;
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

          // Completion assessment: start from the sentinels captured at index
          // build time, then refine with the live metrics we just collected.
          // If the wiki index has no sentinels for this repo (e.g. a GitHub-only
          // repo the index builder hasn't seen yet), fall back to empty sentinels
          // so the assessment is driven purely by live data + commit recency.
          const sentinels = wikiRepo?.sentinels ?? emptySentinels();
          const completion = assessCompletion(sentinels, {
            description: (wikiRepo as unknown as { description?: string } | undefined)?.description,
            lastCommitDate: lastCommitDate || undefined,
            live: {
              deployStatus,
              deployPlatform: deployPlatform || undefined,
              actionsStatus,
              openIssues,
              lastDeployDate: lastDeployDate || undefined,
              deploySuccessRate,
            },
          });

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
            githubUrl: ghRepo?.html_url,
            actionsUrl,
            completion,
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
