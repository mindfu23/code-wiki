/**
 * GitHub metrics collector.
 * Fetches commit activity, Actions workflow runs, traffic, and issues
 * for all repos belonging to the configured GitHub user.
 */

import { BaseCollector } from './baseCollector.js';
import { Config, GitHubMetrics, GitHubRepoMetrics, WorkflowRunSummary } from '../../types/index.js';
import { globalRateLimiter } from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';

interface GitHubApiRepo {
  name: string;
  full_name: string;
  language: string | null;
  open_issues_count: number;
  pushed_at: string;
  private: boolean;
}

interface GitHubApiCommit {
  sha: string;
  commit: { author: { date: string } };
}

interface GitHubApiWorkflowRun {
  id: number;
  name: string;
  workflow_id: number;
  conclusion: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  run_started_at: string;
}

interface GitHubApiTraffic {
  count: number;
  uniques: number;
}

export class GitHubCollector extends BaseCollector<GitHubMetrics> {
  private config: Config;

  constructor(config: Config) {
    super('GitHubCollector');
    this.config = config;
  }

  protected async doCollect(): Promise<GitHubMetrics> {
    const repos = await this.fetchRepos();
    const repoMetrics: GitHubRepoMetrics[] = [];

    // Process repos in batches of 5 to avoid rate limits
    for (let i = 0; i < repos.length; i += 5) {
      const batch = repos.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(repo => this.collectRepoMetrics(repo))
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          repoMetrics.push(result.value);
        }
      }
    }

    return {
      collectedAt: new Date().toISOString(),
      repos: repoMetrics,
    };
  }

  private async fetchRepos(): Promise<GitHubApiRepo[]> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `https://api.github.com/users/${this.config.githubUsername}/repos?sort=pushed&per_page=100&type=owner`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        throw new Error(`GitHub repos API error: ${response.status}`);
      }

      return response.json() as Promise<GitHubApiRepo[]>;
    }, 'GitHub repos');
  }

  private async collectRepoMetrics(repo: GitHubApiRepo): Promise<GitHubRepoMetrics> {
    const [commits30d, workflows, traffic] = await Promise.allSettled([
      this.fetchCommitCount(repo.full_name),
      this.fetchWorkflowRuns(repo.full_name),
      this.fetchTraffic(repo.full_name),
    ]);

    return {
      name: repo.name,
      lastCommitDate: repo.pushed_at,
      language: repo.language,
      openIssues: repo.open_issues_count,
      commits30d: commits30d.status === 'fulfilled' ? commits30d.value : 0,
      workflows: workflows.status === 'fulfilled' ? workflows.value : [],
      traffic: traffic.status === 'fulfilled' ? traffic.value : undefined,
    };
  }

  private async fetchCommitCount(fullName: string): Promise<number> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `https://api.github.com/repos/${fullName}/commits?since=${since}&per_page=1`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        if (response.status === 409) return 0; // Empty repo
        throw new Error(`GitHub commits API error: ${response.status}`);
      }

      // Use Link header to get total count
      const linkHeader = response.headers.get('Link');
      if (linkHeader) {
        const lastMatch = linkHeader.match(/&page=(\d+)>; rel="last"/);
        if (lastMatch) return parseInt(lastMatch[1], 10);
      }

      // No Link header means results fit in one page
      const commits = await response.json() as unknown[];
      return commits.length;
    }, 'GitHub commits');
  }

  private async fetchWorkflowRuns(fullName: string): Promise<WorkflowRunSummary[]> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `https://api.github.com/repos/${fullName}/actions/runs?per_page=30`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        if (response.status === 404) return []; // No Actions configured
        throw new Error(`GitHub Actions API error: ${response.status}`);
      }

      const data = await response.json() as { workflow_runs: GitHubApiWorkflowRun[] };
      if (!data.workflow_runs || data.workflow_runs.length === 0) return [];

      // Group by workflow, take latest run per workflow
      const byWorkflow = new Map<number, GitHubApiWorkflowRun[]>();
      for (const run of data.workflow_runs) {
        const existing = byWorkflow.get(run.workflow_id) || [];
        existing.push(run);
        byWorkflow.set(run.workflow_id, existing);
      }

      const summaries: WorkflowRunSummary[] = [];
      for (const [workflowId, runs] of byWorkflow) {
        const latest = runs[0]; // Already sorted by created_at desc
        const startTime = new Date(latest.run_started_at || latest.created_at).getTime();
        const endTime = new Date(latest.updated_at).getTime();

        summaries.push({
          name: latest.name,
          workflowId,
          lastRun: latest.created_at,
          conclusion: latest.conclusion || latest.status,
          durationSeconds: Math.round((endTime - startTime) / 1000),
          runCount30d: runs.length,
        });
      }

      return summaries;
    }, 'GitHub Actions');
  }

  private async fetchTraffic(fullName: string): Promise<{ views: number; clones: number; uniqueVisitors: number } | undefined> {
    try {
      const [viewsResult, clonesResult] = await Promise.allSettled([
        globalRateLimiter.withBackoff(async () => {
          const response = await fetch(
            `https://api.github.com/repos/${fullName}/traffic/views`,
            { headers: this.headers() }
          );
          if (!response.ok) return null;
          return response.json() as Promise<GitHubApiTraffic>;
        }, 'GitHub traffic views'),
        globalRateLimiter.withBackoff(async () => {
          const response = await fetch(
            `https://api.github.com/repos/${fullName}/traffic/clones`,
            { headers: this.headers() }
          );
          if (!response.ok) return null;
          return response.json() as Promise<GitHubApiTraffic>;
        }, 'GitHub traffic clones'),
      ]);

      const views = viewsResult.status === 'fulfilled' ? viewsResult.value : null;
      const clones = clonesResult.status === 'fulfilled' ? clonesResult.value : null;

      if (!views && !clones) return undefined;

      return {
        views: views?.count || 0,
        clones: clones?.count || 0,
        uniqueVisitors: views?.uniques || 0,
      };
    } catch {
      // Traffic API requires push access; fail gracefully
      return undefined;
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.githubToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'code-wiki-observatory',
    };
  }
}
