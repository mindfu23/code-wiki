/**
 * Generates the repo-locations.md wiki page
 * Maps local repositories to their file system paths and GitHub URLs
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Config, RepoMetadata, GitHubRepo } from '../types/index.js';
import { globalRateLimiter } from './rateLimiter.js';
import { logger } from './logger.js';

interface RepoLocation {
  name: string;
  localPath?: string;
  githubUrl?: string;
  description?: string;
  languages: string[];
  lastCommitDate?: string;
  status: 'local-only' | 'github-only' | 'synced';
  visibility?: 'public' | 'private';
}

/**
 * Fetch GitHub repos for the configured user.
 *
 * Uses /user/repos (authenticated endpoint) rather than /users/{username}/repos
 * so private repos are included. The public endpoint silently omits private
 * repos even with a token attached — a well-known gotcha that previously
 * caused this generator to under-report the inventory by ~37% (~22 of 59
 * repos were private and went missing).
 *
 * Pagination via Link headers: GitHub caps per_page at 100, so accounts with
 * more than 100 repos need to follow the `rel="next"` Link header.
 */
async function fetchGitHubRepos(config: Config): Promise<GitHubRepo[]> {
  if (!config.githubUsername || !config.githubToken) {
    return [];
  }

  try {
    const all: GitHubRepo[] = [];
    let url: string | null =
      'https://api.github.com/user/repos?sort=pushed&per_page=100&affiliation=owner';

    while (url) {
      const nextUrl: string | null = await globalRateLimiter.withBackoff(async () => {
        const response = await fetch(url as string, {
          headers: {
            Authorization: `Bearer ${config.githubToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'code-wiki-mcp-server',
          },
        });

        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status}`);
        }

        const page = (await response.json()) as GitHubRepo[];
        all.push(...page);

        // Parse RFC 5988 Link header for next page, if any.
        const link = response.headers.get('link');
        if (!link) return null;
        const match = link.match(/<([^>]+)>;\s*rel="next"/);
        return match ? match[1] : null;
      }, 'GitHub API');

      url = nextUrl;
    }

    return all.filter(repo => {
      const [owner] = repo.full_name.split('/');
      return owner.toLowerCase() === config.githubUsername.toLowerCase();
    });
  } catch (error) {
    logger.warn('RepoLocationsGenerator', 'Failed to fetch GitHub repos', error);
    return [];
  }
}

/**
 * Generate the repo locations page content
 */
export async function generateRepoLocationsPage(
  localRepos: RepoMetadata[],
  config: Config
): Promise<string> {
  const locations: RepoLocation[] = [];
  const localReposByName = new Map(localRepos.map(r => [r.name.toLowerCase(), r]));

  // Fetch GitHub repos if credentials available
  const githubRepos = await fetchGitHubRepos(config);
  const githubReposByName = new Map(githubRepos.map(r => [r.name.toLowerCase(), r]));

  // Process local repos
  for (const repo of localRepos) {
    const githubRepo = githubReposByName.get(repo.name.toLowerCase());

    locations.push({
      name: repo.name,
      localPath: repo.path,
      githubUrl: repo.remoteUrl || githubRepo?.html_url,
      description: repo.description || githubRepo?.description || undefined,
      languages: repo.languages,
      lastCommitDate: repo.lastCommitDate,
      status: githubRepo ? 'synced' : 'local-only',
      visibility: githubRepo ? (githubRepo.private ? 'private' : 'public') : undefined,
    });
  }

  // Add GitHub-only repos
  for (const [nameLower, githubRepo] of githubReposByName) {
    if (!localReposByName.has(nameLower)) {
      locations.push({
        name: githubRepo.name,
        localPath: undefined,
        githubUrl: githubRepo.html_url,
        description: githubRepo.description || undefined,
        languages: githubRepo.language ? [githubRepo.language.toLowerCase()] : [],
        lastCommitDate: githubRepo.pushed_at,
        status: 'github-only',
        visibility: githubRepo.private ? 'private' : 'public',
      });
    }
  }

  // Sort by name
  locations.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  // Generate markdown
  const now = new Date().toISOString();
  const syncedRepos = locations.filter(r => r.status === 'synced');
  const localOnlyRepos = locations.filter(r => r.status === 'local-only');
  const githubOnlyRepos = locations.filter(r => r.status === 'github-only');

  let content = `---
title: "Repository Locations"
tags: ["index", "repositories", "auto-generated"]
description: "Mapping of repositories to local file system paths and GitHub URLs"
updated: "${now.split('T')[0]}"
visibility: "private"
---

# Repository Locations

This page is **auto-generated** during indexing. Do not edit manually.

**Last updated:** ${now}

## Summary

| Status | Count |
|--------|-------|
| Synced (local + GitHub) | ${syncedRepos.length} |
| Local only | ${localOnlyRepos.length} |
| GitHub only (not cloned) | ${githubOnlyRepos.length} |
| **Total** | **${locations.length}** |

---

## Synced Repositories

These repositories exist both locally and on GitHub.

| Repository | Visibility | Local Path | GitHub | Languages |
|------------|-----------|------------|--------|-----------|
`;

  for (const repo of syncedRepos) {
    const githubLink = repo.githubUrl ? `[GitHub](${repo.githubUrl})` : '-';
    const langs = repo.languages.length > 0 ? repo.languages.join(', ') : '-';
    const vis = repo.visibility ?? '-';
    content += `| **${repo.name}** | ${vis} | \`${repo.localPath}\` | ${githubLink} | ${langs} |\n`;
  }

  if (syncedRepos.length === 0) {
    content += `| _No synced repositories_ | | | |\n`;
  }

  content += `
---

## Local Only Repositories

These repositories exist locally but are not linked to a GitHub remote.

| Repository | Local Path | Languages |
|------------|------------|-----------|
`;

  for (const repo of localOnlyRepos) {
    const langs = repo.languages.length > 0 ? repo.languages.join(', ') : '-';
    content += `| **${repo.name}** | \`${repo.localPath}\` | ${langs} |\n`;
  }

  if (localOnlyRepos.length === 0) {
    content += `| _No local-only repositories_ | | |\n`;
  }

  content += `
---

## GitHub Only Repositories

These repositories exist on GitHub but are not cloned locally.
Use \`sync_repos\` to clone them, or clone manually.

| Repository | Visibility | GitHub URL | Language | Last Updated |
|------------|-----------|------------|----------|--------------|
`;

  for (const repo of githubOnlyRepos) {
    const githubLink = repo.githubUrl ? `[${repo.name}](${repo.githubUrl})` : repo.name;
    const lang = repo.languages.length > 0 ? repo.languages[0] : '-';
    const lastUpdate = repo.lastCommitDate ? repo.lastCommitDate.split('T')[0] : '-';
    const vis = repo.visibility ?? '-';
    content += `| ${githubLink} | ${vis} | ${repo.githubUrl || '-'} | ${lang} | ${lastUpdate} |\n`;
  }

  if (githubOnlyRepos.length === 0) {
    content += `| _All GitHub repositories are cloned locally_ | | | |\n`;
  }

  content += `
---

## Full Repository Details

`;

  for (const repo of locations) {
    content += `### ${repo.name}\n\n`;
    content += `- **Status:** ${repo.status}\n`;
    if (repo.visibility) {
      content += `- **Visibility:** ${repo.visibility}\n`;
    }
    if (repo.localPath) {
      content += `- **Local Path:** \`${repo.localPath}\`\n`;
    }
    if (repo.githubUrl) {
      content += `- **GitHub:** ${repo.githubUrl}\n`;
    }
    if (repo.description) {
      content += `- **Description:** ${repo.description}\n`;
    }
    if (repo.languages.length > 0) {
      content += `- **Languages:** ${repo.languages.join(', ')}\n`;
    }
    if (repo.lastCommitDate) {
      content += `- **Last Commit:** ${repo.lastCommitDate}\n`;
    }
    content += '\n';
  }

  return content;
}

/**
 * Write the repo locations page to the wiki
 */
export async function writeRepoLocationsPage(
  localRepos: RepoMetadata[],
  config: Config
): Promise<void> {
  const content = await generateRepoLocationsPage(localRepos, config);
  const outputPath = path.join(config.wikiDirectory, 'projects', 'repo-locations.md');

  // Ensure directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await fs.writeFile(outputPath, content, 'utf-8');
  logger.info('RepoLocationsGenerator', `Updated repo-locations.md with ${localRepos.length} local repos`);
}
