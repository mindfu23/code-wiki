/**
 * Dashboard Data API — aggregates GitHub + Netlify metrics for the Observatory dashboard.
 * Calls GitHub and Netlify APIs directly from the serverless function.
 */

import { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    // Fetch GitHub repos and Netlify sites in parallel
    const [repos, netlifySites] = await Promise.all([
      fetchGitHubRepos(githubUsername, githubToken),
      netlifyToken ? fetchNetlifySites(netlifyToken) : Promise.resolve([]),
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

    // Fetch Actions + deploys for repos that have them (in parallel batches)
    const projects: ProjectHealthRow[] = [];

    for (let i = 0; i < repos.length; i += 10) {
      const batch = repos.slice(i, i + 10);
      const batchResults = await Promise.allSettled(
        batch.map(async (repo) => {
          const site = repoToSite.get(repo.name.toLowerCase());

          // Fetch Actions runs
          const runs = await fetchWorkflowRuns(repo.full_name, githubToken);
          let actionsStatus: ProjectHealthRow['actionsStatus'] = 'unknown';
          if (runs.length > 0) {
            const hasFailure = runs.some((r: { conclusion: string | null }) => r.conclusion === 'failure');
            const allSuccess = runs.every(
              (r: { conclusion: string | null; status: string }) =>
                r.conclusion === 'success' || r.conclusion === 'skipped'
            );
            actionsStatus = hasFailure ? 'error' : allSuccess ? 'healthy' : 'warning';
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
            name: repo.name,
            lastCommitDate: repo.pushed_at,
            commitCount30d: 0, // Would need per-repo commit count API call
            language: repo.language,
            deployStatus,
            deployPlatform,
            lastDeployDate,
            deploySuccessRate,
            actionsStatus,
            trafficLevel: 'none' as const,
            openIssues: repo.open_issues_count,
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
