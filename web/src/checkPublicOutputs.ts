/**
 * Leak gate: fails the build if a public output names private content.
 *
 * The builders filter private repos and docs out of everything served
 * publicly, and each filter has its own code path. This check doesn't trust
 * any of them. It reads what is private from index-full.json (same run),
 * then scans every public output for:
 *   - a private repo's name, as an exact JSON string value or as the repo
 *     segment of a github.com URL
 *   - a private doc's relative path
 *   - a private doc's body (exact content match)
 *   - an absolute home-directory path (macOS or Linux), other than the
 *     Actions runner's own checkout directory
 *
 * Exact-value matching (not substring search) keeps short or common repo
 * names from tripping on ordinary prose.
 *
 * Output is per-file counts only, never the matched text, because this runs
 * in a public CI log.
 *
 * Usage: npm run check:public-outputs [-- --dir public/data]
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { WikiIndex } from './types.js';
import { CI_LOG } from './ciLog.js';

const PUBLIC_FILES = [/^index\.json$/, /^category-.+\.json$/, /^taxonomy\.json$/, /^diagram-signals\.json$/];
const HOME_PATH = /\/(?:Users\/[A-Za-z0-9._-]+|home\/(?!runner\/)[A-Za-z0-9._-]+)\//;
const GITHUB_REPO = /github\.com\/[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)/gi;
// Bodies shorter than this are too generic to count as a match ("TODO", a lone heading).
const MIN_BODY_CHARS = 200;

type Kind = 'repo name' | 'doc path' | 'doc body' | 'home path';

function getArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const hash = (s: string): string => createHash('sha256').update(s.trim()).digest('hex');

export interface PrivateSet {
  names: Set<string>;   // lower-cased repo names
  paths: Set<string>;   // doc relative paths
  bodies: Set<string>;  // sha256 of doc bodies
}

export function privateSetFrom(full: WikiIndex): PrivateSet {
  const names = new Set(full.repos.filter(r => r.visibility === 'private').map(r => r.name.toLowerCase()));
  const privDocs = full.documents.filter(d => d.visibility === 'private');
  const paths = new Set(privDocs.map(d => d.relativePath));
  const bodies = new Set(privDocs.filter(d => (d.content ?? '').trim().length >= MIN_BODY_CHARS).map(d => hash(d.content)));
  return { names, paths, bodies };
}

/** Counts of leaks by kind in one parsed JSON value, plus the offending values (for local runs only). */
export function scan(value: unknown, priv: PrivateSet): { hits: Map<Kind, number>; samples: string[] } {
  const hits = new Map<Kind, number>();
  const samples: string[] = [];
  let current = '';
  const hit = (k: Kind) => {
    hits.set(k, (hits.get(k) ?? 0) + 1);
    if (samples.length < 20) samples.push(`${k}: ${current.slice(0, 120)}`);
  };

  // inRepoFiles: inside a repo's markdownFiles list, where a path like README.md is that
  // repo's own file, not a wiki doc, so doc-path matches there would be false positives.
  const visit = (v: unknown, key?: string, inRepoFiles = false): void => {
    if (typeof v === 'string') {
      current = v;
      const repoName = v.replace(/\.git$/i, '').toLowerCase();
      if (priv.names.has(repoName)) hit('repo name');
      for (const m of v.matchAll(GITHUB_REPO)) {
        if (priv.names.has(m[1].replace(/\.git$/i, '').toLowerCase())) hit('repo name');
      }
      if (!inRepoFiles && priv.paths.has(v)) hit('doc path');
      if (key === 'content' && v.trim().length >= MIN_BODY_CHARS && priv.bodies.has(hash(v))) hit('doc body');
      if (HOME_PATH.test(v)) hit('home path');
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item, undefined, inRepoFiles);
    } else if (v && typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) visit(item, k, inRepoFiles || k === 'markdownFiles');
    }
  };
  visit(value);
  return { hits, samples };
}

async function main(): Promise<void> {
  const dir = getArg('dir', path.join('public', 'data'));
  const fullPath = path.join(dir, 'index-full.json');

  let full: WikiIndex;
  try {
    full = JSON.parse(await fs.readFile(fullPath, 'utf-8')) as WikiIndex;
  } catch {
    console.error(`Leak gate: cannot read ${fullPath}; run build:index first.`);
    process.exit(1);
  }
  const priv = privateSetFrom(full);
  console.log(`Leak gate: checking public outputs against ${priv.names.size} private repos and ${priv.paths.size} private docs`);

  const files = (await fs.readdir(dir)).filter(f => PUBLIC_FILES.some(re => re.test(f))).sort();
  let failed = false;
  for (const file of files) {
    const { hits, samples } = scan(JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8')), priv);
    if (hits.size === 0) {
      console.log(`  OK    ${file}`);
    } else {
      failed = true;
      const summary = [...hits].map(([k, n]) => `${n} ${k}`).join(', ');
      console.log(`  LEAK  ${file}: ${summary}`);
      if (!CI_LOG) for (const sample of samples) console.log(`          ${sample}`);
    }
  }
  if (files.length === 0) {
    console.error('Leak gate: no public output files found; nothing was checked.');
    process.exit(1);
  }
  if (failed) {
    console.error('Leak gate FAILED: a public output references private content. Run locally (without CI=1) to investigate.');
    process.exit(1);
  }
  console.log(`Leak gate passed (${files.length} files).`);
}

// Run only as a script, so tests can import the scanner.
if (process.argv[1] && /checkPublicOutputs\.(ts|js)$/.test(process.argv[1])) {
  main().catch(err => {
    console.error('Leak gate failed to run:', (err as Error).message);
    process.exit(1);
  });
}
