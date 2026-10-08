/**
 * Reads the MCP server's local repo index (mcp-server/data/index.json, gitignored) to map
 * repos to local checkout paths.
 *
 * Local paths are machine-specific, so they live only in this local cache. The nightly
 * Actions build regenerates repo-locations.md in the cloud, where no local paths exist.
 * Paths read here are used for manifest scanning only and are never written to any repo.
 */

import * as fs from 'fs/promises';

export interface LocalIndexRepo {
  /** GitHub repo name from the origin URL when there is one, else the folder name */
  name: string;
  localPath: string;
}

export async function findLocalIndex(explicitPath?: string): Promise<string | null> {
  const candidates = [
    explicitPath,
    process.env.CODE_WIKI_LOCAL_INDEX,
    process.env.CACHE_DIR ? `${process.env.CACHE_DIR}/index.json` : undefined,
    `${process.cwd()}/mcp-server/data/index.json`,
  ].filter((p): p is string => typeof p === 'string');
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function parseLocalIndex(filePath: string): Promise<LocalIndexRepo[]> {
  let data: { repos?: Array<{ name?: string; path?: string; remoteUrl?: string }> };
  try {
    data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return [];
  }
  const out: LocalIndexRepo[] = [];
  for (const r of data.repos ?? []) {
    if (!r.path) continue;
    const fromRemote = r.remoteUrl?.match(/[/:]([^/:]+?)(?:\.git)?$/)?.[1];
    const name = fromRemote || r.name;
    if (name) out.push({ name, localPath: r.path });
  }
  return out;
}
