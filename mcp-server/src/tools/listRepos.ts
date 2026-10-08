/**
 * list_repos tool implementation
 */

import { IndexService } from '../services/indexService.js';

export const listReposTool = {
  name: 'list_repos',
  description: 'List all indexed local repositories with metadata including languages, file count, and description',
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
    },
  },
};

export async function handleListRepos(
  args: { sortBy?: string; language?: string },
  indexService: IndexService
): Promise<string> {
  let repos = indexService.getAllRepos();

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
    })),
  }, null, 2);
}
