/**
 * CI-side generator for `wiki/projects/repo-locations.md`.
 *
 * Why this exists: the MCP server's `sync_repos` tool also generates this
 * file, but only runs locally on demand. That meant the file could go stale
 * for weeks. This script runs in the nightly Actions workflow so the file
 * stays fresh from the GitHub side automatically. Local filesystem paths
 * are absent from the CI-generated output (we don't know the user's
 * machine layout); `sync_repos` is still the way to enrich the file with
 * local paths after a clone.
 *
 * Outputs to the path given in `--out`. Designed to be wired into
 * update-index.yml so the result lands in the private content repo
 * alongside the other generated artifacts.
 *
 * Env vars required:
 *   GITHUB_TOKEN     A token with `repo` scope (so private repos are
 *                    visible). The workflow already provides one.
 *   GITHUB_USERNAME  The account to list repos for. Used to filter
 *                    organization-owned repos out of the result.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Octokit } from '@octokit/rest';

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  pushed_at: string | null;
  language: string | null;
  private: boolean;
}

function getArg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required argument: --${name}`);
  process.exit(1);
}

async function fetchAllRepos(octokit: Octokit, username: string): Promise<Repo[]> {
  const repos: Repo[] = [];
  for await (const { data: page } of octokit.paginate.iterator(
    octokit.repos.listForAuthenticatedUser,
    { per_page: 100, sort: 'pushed', direction: 'desc' },
  )) {
    for (const r of page) {
      if (r.owner?.login?.toLowerCase() !== username.toLowerCase()) continue;
      repos.push({
        name: r.name,
        description: r.description ?? null,
        html_url: r.html_url,
        pushed_at: r.pushed_at,
        language: r.language ?? null,
        private: r.private ?? false,
      });
    }
  }
  return repos.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function renderMarkdown(repos: Repo[]): string {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  const lines: string[] = [];
  lines.push('---');
  lines.push('title: "Repository Locations"');
  lines.push('tags: ["index", "repositories", "auto-generated"]');
  lines.push('description: "Mapping of repositories to GitHub URLs, with visibility. Local paths are absent — run the MCP sync_repos tool to enrich."');
  lines.push(`updated: "${today}"`);
  lines.push('visibility: "private"');
  lines.push('---');
  lines.push('');
  lines.push('# Repository Locations');
  lines.push('');
  lines.push('This page is **auto-generated** during the nightly Actions index build. Do not edit manually.');
  lines.push('');
  lines.push(`**Last updated:** ${now}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Visibility | Count |');
  lines.push('|------------|-------|');
  lines.push(`| Public | ${repos.filter(r => !r.private).length} |`);
  lines.push(`| Private | ${repos.filter(r => r.private).length} |`);
  lines.push(`| **Total** | **${repos.length}** |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## All Repositories');
  lines.push('');
  lines.push('Local filesystem paths are not populated in CI builds. Run the MCP `sync_repos` tool locally to add them.');
  lines.push('');
  lines.push('| Repository | Visibility | GitHub | Language | Last Push |');
  lines.push('|------------|-----------|--------|----------|-----------|');
  for (const r of repos) {
    const vis = r.private ? 'private' : 'public';
    const lang = r.language ?? '-';
    const lastPush = r.pushed_at ? r.pushed_at.split('T')[0] : '-';
    lines.push(`| **${r.name}** | ${vis} | [GitHub](${r.html_url}) | ${lang} | ${lastPush} |`);
  }
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME;
  const outPath = getArg('out');

  if (!token) {
    console.error('GITHUB_TOKEN env var is required');
    process.exit(1);
  }
  if (!username) {
    console.error('GITHUB_USERNAME env var is required');
    process.exit(1);
  }

  console.log(`Fetching repos for ${username}...`);
  const octokit = new Octokit({ auth: token });
  const repos = await fetchAllRepos(octokit, username);
  console.log(`  Found ${repos.length} repos (${repos.filter(r => !r.private).length} public, ${repos.filter(r => r.private).length} private)`);

  const md = renderMarkdown(repos);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, md, 'utf-8');
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
