/**
 * list_repos tool implementation
 */

import { IndexService } from '../services/indexService.js';
import { Config } from '../types/config.js';
import { loadProjectStatus, statusFor } from '../utils/projectStatus.js';

export const listReposTool = {
  name: 'list_repos',
  description: 'List all indexed local repositories with metadata including languages, file count, description and lifecycle status (e.g. dormant = paused and not maintained; deprioritize unless asked). Status comes from the private project-status registry.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sortBy: {
        type: 'string',
        enum: ['name', 'lastModified', 'language'],
        description: 'Sort order for results',
      },
      language: {
        type: 'string',
        description: 'Filter to repos using a specific language',
      },
      lifecycle: {
        type: 'string',
        description: 'Only repos with this lifecycle status (e.g. dormant, shipped)',
      },
      excludeLifecycle: {
        type: 'array',
        items: { type: 'string' },
        description: 'Leave out repos with these statuses, e.g. ["dormant", "archived"]',
      },
    },
  },
};

export async function handleListRepos(
  args: { sortBy?: string; language?: string; lifecycle?: string; excludeLifecycle?: string[] },
  indexService: IndexService,
  config?: Pick<Config, 'wikiDirectory' | 'privateWikiDirectory'>
): Promise<string> {
  let repos = indexService.getAllRepos();
  const status = config ? loadProjectStatus(config) : new Map();
  const lifecycleOf = (name: string) => statusFor(status, name)?.lifecycle;

  if (args.lifecycle) repos = repos.filter(r => lifecycleOf(r.name) === args.lifecycle);
  if (args.excludeLifecycle?.length) {
    const skip = new Set(args.excludeLifecycle);
    repos = repos.filter(r => !skip.has(lifecycleOf(r.name) ?? ''));
  }

  // Filter by language if specified
  if (args.language) {
    const langLower = args.language.toLowerCase();
    repos = repos.filter(r => r.languages.some(l => l.toLowerCase().includes(langLower)));
  }

  // Sort
  switch (args.sortBy) {
    case 'lastModified':
      repos.sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());
      break;
    case 'language':
      repos.sort((a, b) => (a.languages[0] || '').localeCompare(b.languages[0] || ''));
      break;
    case 'name':
    default:
      repos.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  // The index is a cache: lastCommit / fileCount lag until it is refreshed. Report its age
  // so callers can tell fresh metadata from stale.
  const indexedTimes = repos
    .map(r => Date.parse(r.lastIndexed))
    .filter(Number.isFinite);
  const oldestIndexed = indexedTimes.length ? Math.min(...indexedTimes) : NaN;
  const indexAgeHours = Number.isFinite(oldestIndexed)
    ? Math.round((Date.now() - oldestIndexed) / 3_600_000)
    : null;

  return JSON.stringify({
    totalRepos: repos.length,
    indexAgeHours,
    ...(indexAgeHours !== null && indexAgeHours > 24
      ? { stale: true, staleHint: 'Metadata may lag. Restart the MCP server to re-index, or run sync_repos (which also git-pulls every repo).' }
      : {}),
    repos: repos.map(r => ({
      name: r.name,
      description: r.description,
      languages: r.languages,
      fileCount: r.fileCount,
      lastCommit: r.lastCommitDate,
      hasReadme: r.hasReadme,
      remoteUrl: r.remoteUrl,
      ...(statusFor(status, r.name) ? { status: statusFor(status, r.name) } : {}),
    })),
  }, null, 2);
}
