/**
 * Combines the two complementary repo inventory sources:
 *   - index-full.json (authoritative, always fresh, no localPath)
 *   - repo-locations.md (stale, but contributes localPath for synced repos)
 *
 * Strategy: index-full.json provides the canonical list; repo-locations.md
 * enriches each entry with localPath when a matching name exists.
 * Falls back to repo-locations.md alone if index-full.json isn't found.
 * Fails gracefully if neither exists.
 */

import { parseRepoLocations, findRepoLocations, RepoEntry } from './parseRepoLocations.js';
import { parseIndexFull, findIndexFull, IndexFullRepo } from './parseIndexFull.js';

export interface CombinedRepo extends IndexFullRepo {
  /** Set when the repo was matched in repo-locations.md */
  foundInLocationsMd: boolean;
  /** Set when the repo was found in index-full.json */
  foundInIndexJson: boolean;
}

export interface CombineResult {
  repos: CombinedRepo[];
  sources: {
    indexFullPath: string | null;
    repoLocationsPath: string | null;
    indexFullCount: number;
    repoLocationsCount: number;
  };
  /** True if index-full.json has strictly more repos than repo-locations.md */
  repoLocationsStale: boolean;
}

/**
 * Load and merge. Caller is responsible for handling the
 * null-sources case (both missing).
 */
export async function combineRepoSources(
  opts: { indexFullPath?: string; repoLocationsPath?: string } = {},
): Promise<CombineResult> {
  const indexFullPath = await findIndexFull(opts.indexFullPath);
  const repoLocationsPath = await findRepoLocations(opts.repoLocationsPath);

  const indexFullEntries = indexFullPath ? await parseIndexFull(indexFullPath) : [];
  const repoLocationsEntries: RepoEntry[] = repoLocationsPath
    ? await parseRepoLocations(repoLocationsPath)
    : [];

  const locationsByName = new Map<string, RepoEntry>();
  for (const e of repoLocationsEntries) {
    locationsByName.set(e.name.toLowerCase(), e);
  }
  const indexByName = new Map<string, IndexFullRepo>();
  for (const e of indexFullEntries) {
    indexByName.set(e.name.toLowerCase(), e);
  }

  // Union of names across both sources. Prefer index-full data when
  // available, fall back to repo-locations for repos only found there
  // (shouldn't happen often; may occur when local-only repos exist in
  // the markdown but were filtered out of the JSON).
  const allNames = new Set<string>([
    ...indexByName.keys(),
    ...locationsByName.keys(),
  ]);

  const combined: CombinedRepo[] = [];
  for (const lowerName of allNames) {
    const fromIndex = indexByName.get(lowerName);
    const fromLocations = locationsByName.get(lowerName);

    if (fromIndex) {
      combined.push({
        ...fromIndex,
        localPath: fromLocations?.localPath ?? fromIndex.localPath,
        foundInIndexJson: true,
        foundInLocationsMd: !!fromLocations,
      });
    } else if (fromLocations) {
      // Only in repo-locations.md (e.g. truly local-only repo not in index)
      combined.push({
        name: fromLocations.name,
        localPath: fromLocations.localPath,
        githubUrl: fromLocations.githubUrl,
        status: fromLocations.status,
        languages: fromLocations.languages,
        foundInIndexJson: false,
        foundInLocationsMd: true,
      });
    }
  }

  // Stable sort by name for deterministic output
  combined.sort((a, b) => a.name.localeCompare(b.name));

  return {
    repos: combined,
    sources: {
      indexFullPath,
      repoLocationsPath,
      indexFullCount: indexFullEntries.length,
      repoLocationsCount: repoLocationsEntries.length,
    },
    repoLocationsStale:
      indexFullEntries.length > 0 &&
      indexFullEntries.length > repoLocationsEntries.length,
  };
}
