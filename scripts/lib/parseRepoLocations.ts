/**
 * Parser for the auto-generated `repo-locations.md` file in the private
 * content repo. Extracts the repo inventory (name, local path, GitHub URL,
 * synced/local-only status) so downstream tooling can iterate over every
 * project without hardcoding a list.
 *
 * Format of repo-locations.md (see indexBuilder.ts in web/src/):
 *   - Two sections with markdown tables: "Synced Repositories" and
 *     "Local Only Repositories"
 *   - Each row: | **RepoName** | `/abs/local/path` | [GitHub](url) | langs |
 *
 * This parser is intentionally tolerant of the stale `Last updated:` header
 * bug (HANDOFF-rearchitecture.md decision #16): it reads the body, never
 * the header line.
 */

import * as fs from 'fs/promises';

export type RepoStatus = 'synced' | 'local-only' | 'github-only';
export type RepoVisibility = 'public' | 'private';

export interface RepoEntry {
  name: string;
  localPath?: string;
  githubUrl?: string;
  status: RepoStatus;
  languages?: string[];
  visibility?: RepoVisibility;
}

const SECTION_HEADINGS: Record<string, RepoStatus> = {
  '## Synced Repositories': 'synced',
  '## Local Only Repositories': 'local-only',
  '## GitHub Only Repositories': 'github-only',
};

// Name cell (always first): | **RepoName** |
const NAME_RE = /^\|\s*\*\*(?<name>[^*]+)\*\*\s*\|/;
// Path cell: either `/abs/path` or '-'
const PATH_CELL_RE = /(?:`(?<path>[^`]+)`|-)/;
// GitHub cell: either [GitHub](url) or '-'
const GITHUB_CELL_RE = /(?:\[GitHub\]\((?<url>[^)]+)\)|-)/;
// Visibility cell: a bare "public" or "private"
const VISIBILITY_CELL_RE = /^(?<vis>public|private)$/i;

function splitCells(line: string): string[] {
  // Split on '|' but ignore leading/trailing empties from the border pipes.
  return line
    .split('|')
    .map((c) => c.trim())
    .slice(1, -1); // drop leading/trailing empty from border pipes
}

export async function parseRepoLocations(filePath: string): Promise<RepoEntry[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.split('\n');
  const entries: RepoEntry[] = [];

  let currentStatus: RepoStatus | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Section boundary
    if (trimmed.startsWith('## ')) {
      currentStatus = SECTION_HEADINGS[trimmed] ?? null;
      continue;
    }

    // Skip header/separator/empty lines outside a section
    if (!currentStatus) continue;
    if (!trimmed.startsWith('|')) continue;
    if (trimmed.includes('---')) continue;           // markdown separator
    if (/^\|\s*Repository\s*\|/.test(trimmed)) continue; // table header

    // Match the name cell
    const nameMatch = NAME_RE.exec(trimmed);
    if (!nameMatch?.groups) continue;
    const name = nameMatch.groups.name.trim();

    const cells = splitCells(trimmed);
    // cells[0] = "**name**" — skip
    // Next cells vary by table format:
    //   Synced:    [path, github, langs]
    //   Local:     [path, langs]
    //   GitHubOnly: [github, langs]  (if/when such a section exists)

    let localPath: string | undefined;
    let githubUrl: string | undefined;
    let langs: string | undefined;
    let visibility: RepoVisibility | undefined;

    for (let i = 1; i < cells.length; i++) {
      const cell = cells[i];
      const pathMatch = PATH_CELL_RE.exec(cell);
      const ghMatch = GITHUB_CELL_RE.exec(cell);
      const visMatch = VISIBILITY_CELL_RE.exec(cell);
      if (pathMatch?.groups?.path) {
        localPath = pathMatch.groups.path.trim();
      } else if (ghMatch?.groups?.url) {
        githubUrl = ghMatch.groups.url.trim();
      } else if (visMatch?.groups?.vis) {
        visibility = visMatch.groups.vis.toLowerCase() as RepoVisibility;
      } else if (!langs && cell !== '-') {
        // Last non-placeholder cell is assumed to be the language list
        langs = cell;
      }
    }

    const languages = langs
      ? langs.split(',').map((l) => l.trim()).filter((l) => l && l !== '-')
      : [];

    entries.push({
      name,
      localPath,
      githubUrl,
      status: currentStatus,
      languages: languages.length > 0 ? languages : undefined,
      visibility,
    });
  }

  return entries;
}

/**
 * Best-effort search for repo-locations.md across the conventional locations.
 * Order: (1) explicit path, (2) PRIVATE_CONTENT_DIR env var, (3) sibling
 * clone, (4) nested clone inside public repo.
 */
export async function findRepoLocations(explicitPath?: string): Promise<string | null> {
  const candidates = [
    explicitPath,
    process.env.PRIVATE_CONTENT_DIR
      ? `${process.env.PRIVATE_CONTENT_DIR}/wiki/projects/repo-locations.md`
      : undefined,
    // Sibling clone (default local-dev layout per HANDOFF-rearchitecture.md)
    `${process.cwd()}/../code-wiki-content/wiki/projects/repo-locations.md`,
    // Nested clone at a gitignored path
    `${process.cwd()}/private-content/wiki/projects/repo-locations.md`,
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
