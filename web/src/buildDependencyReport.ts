/**
 * CI-side dependency report for every active app: which frameworks each one
 * is built on, every direct dependency with its declared and installed
 * version, how far each is behind the latest release, and known
 * vulnerabilities in everything the lockfiles resolve.
 *
 * Why this exists: stack tags on the wiki's project pages come from
 * scripts/seed-taxonomy.ts, which only runs by hand against local checkouts,
 * so most apps have none and none have versions. This reads the manifests
 * straight from GitHub nightly, so every app with a status page gets them.
 *
 * Two parts with different cadences:
 *   - Nightly: find manifests and lockfiles in each repo through the GitHub
 *     API, parse direct deps and installed versions, infer stack tags with
 *     the same mappings seed-taxonomy uses, count open Dependabot PRs. Then a
 *     shallow clone of each repo is scanned for external APIs (including ones
 *     called over plain HTTP) and AI model IDs (codeScan.ts) and deleted.
 *   - Weekly scan (registries + OSV): latest version of every direct dep, and
 *     OSV advisories for every locked package. Results go into a lookup cache
 *     (`--cache`, committed to the private content repo at
 *     data/dependency-scan.json) that the nightly part re-applies, so a page
 *     always shows the last scan's findings for its current versions.
 *     `--scan auto` (default) scans when the cache is older than SCAN_EVERY_DAYS.
 *
 * Output (`--out`) is a JSON report that buildStatusDigest.ts reads with
 * `--deps` to add a Dependencies section to each status page and a roll-up
 * page. It is written to /tmp in CI and never committed.
 *
 * Privacy: the cache holds package names and versions but no repo names, and
 * lives in the private content repo outside web/public/data (which Netlify
 * publishes). Logs name no repos or packages in CI (see ciLog.ts). The weekly
 * scan sends package names and versions, never repo names or code, to the
 * public registries and to api.osv.dev.
 *
 * Usage:
 *   npm run build:deps -- --out /tmp/dependency-report.json --cache /tmp/private-content/data/dependency-scan.json
 *   Optional: --index <index-full.json> --days <N> --scan auto|always|never --code-scan on|off
 *             --models-out <path>  also write the model feed: every checkable
 *               model id found in code, with an app count but no repo names,
 *               for a liveness monitor such as Watchtower (MODEL_FEED_URL)
 *
 * Env vars: GITHUB_TOKEN (reads every repo, as for the status digest), GITHUB_USERNAME.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import type { RepoInfo } from './types.js';
import { nm, errMsg } from './ciLog.js';
import { selectActiveRepos } from './buildStatusDigest.js';
import { scanRepoCode, buildModelFeed } from './codeScan.js';
import {
  pickManifests,
  parseManifest,
  updateStatus,
  compareVersions,
  type Dep,
  type Ecosystem,
  type LockedPackage,
  type UpdateStatus,
} from './dependencyParsers.js';
import * as depMappingsModule from '../../scripts/lib/depMappings.js';
import type { DepMapping } from '../../scripts/lib/depMappings.js';

// scripts/ has no "type": "module", so from this ES module the mappings file
// loads as CommonJS and its exports arrive under `default`. Same mappings
// seed-taxonomy.ts uses, so tags match what it would write.
const depMappings = ((depMappingsModule as unknown as { default?: typeof depMappingsModule }).default ?? depMappingsModule);
const { lookupDep, mergeMappings, MANIFEST_SIGNALS } = depMappings;

const SCAN_EVERY_DAYS = 6;
// Same abort threshold as the status digest: mostly a token that can't see private repos.
const MAX_FAILURE_RATE = 0.2;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const OSV_BATCH = 1000;
const MAX_ADVISORY_FETCHES = 600;
const HTTP_CONCURRENCY = 8;
const UA = 'code-wiki-dependency-report (+https://github.com/mindfu23/code-wiki)';

export interface DepRow extends Dep {
  latest: string | null;
  status: UpdateStatus;
}

export interface VulnRow {
  id: string;
  aliases: string[];
  ecosystem: Ecosystem;
  package: string;
  version: string;
  severity: string;
  summary: string;
  fixed: string | null;
  direct: boolean;
}

export interface RepoDependencies {
  repo: string;
  languages: string[];
  stack: string[];
  /** External APIs, from SDK packages and from the code scan. */
  services: string[];
  /** AI model IDs referenced in source (code scan only). */
  models: string[];
  /** False when the repo couldn't be cloned for the code scan (APIs then come from packages only). */
  codeScanned: boolean;
  manifests: { path: string; ecosystem: Ecosystem; lockfile: string | null; deps: DepRow[] }[];
  unparsed: string[];
  dependabotOpenPrs: number | null;
  vulns: VulnRow[];
  /** Distinct package versions the lockfiles (or exact pins) resolve, direct and transitive. */
  locked: number;
  /** Of those, the ones the last scan didn't cover (added since, or no scan yet). */
  unscanned: number;
  failed: boolean;
}

export interface DependencyReport {
  generatedAt: string;
  scannedAt: string | null;
  repos: RepoDependencies[];
}

export interface Advisory {
  summary: string;
  severity: string;
  aliases: string[];
  /** "eco:name" → fixed versions listed by the advisory. */
  fixed: Record<string, string[]>;
}

export interface ScanCache {
  version: 1;
  scannedAt: string;
  /** "eco:name" → latest release, or null when the registry had no answer. */
  latest: Record<string, string | null>;
  /** Every "eco:name@version" the scan checked, so a clean result can be told from a missing one. */
  scanned: string[];
  /** "eco:name@version" → advisory ids, only for vulnerable versions. */
  vulnerable: Record<string, string[]>;
  advisories: Record<string, Advisory>;
  /** Set when some OSV batches failed, so the next night scans again instead of waiting a week. */
  incomplete?: boolean;
}

const pkgKey = (eco: string, name: string) => `${eco}:${name}`;
const verKey = (eco: string, name: string, version: string) => `${eco}:${name}@${version}`;

function getArg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required argument: --${name}`);
  process.exit(1);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// GitHub: manifests per repo
// ---------------------------------------------------------------------------

async function fetchRaw(octokit: Octokit, owner: string, repo: string, ref: string, filePath: string): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref, mediaType: { format: 'raw' } });
    // With the raw media type Octokit returns the file body as a string, though its types say otherwise.
    const raw = data as unknown;
    const text = typeof raw === 'string' ? raw : null;
    return text && text.length <= MAX_FILE_BYTES ? text : null;
  } catch (err) {
    console.warn(`  Could not read ${nm(`${repo}/${filePath}`)}: ${errMsg(err)}`);
    return null;
  }
}

export interface Collected {
  base: RepoDependencies;
  rawDeps: { path: string; ecosystem: Ecosystem; lockfile: string | null; deps: Dep[] }[];
  locked: LockedPackage[];
  directKeys: Set<string>;
}

/** With `token`, also clones the repo to scan its code for APIs and AI models (see codeScan.ts). */
export async function collectRepo(octokit: Octokit, owner: string, repo: RepoInfo, token?: string): Promise<Collected> {
  const base: RepoDependencies = {
    repo: repo.name, languages: repo.languages ?? [], stack: [], services: [], models: [], codeScanned: false, manifests: [],
    unparsed: [], dependabotOpenPrs: null, vulns: [], locked: 0, unscanned: 0, failed: false,
  };
  const out: Collected = { base, rawDeps: [], locked: [], directKeys: new Set() };

  let ref: string;
  let paths: string[];
  try {
    const { data: meta } = await octokit.repos.get({ owner, repo: repo.name });
    ref = meta.default_branch;
    const { data: tree } = await octokit.git.getTree({ owner, repo: repo.name, tree_sha: ref, recursive: 'true' });
    if (tree.truncated) console.warn(`  File list for ${nm(repo.name)} was truncated; some manifests may be missed.`);
    paths = tree.tree.filter(t => t.type === 'blob' && t.path).map(t => t.path as string);
  } catch (err) {
    // An empty repo has no tree (409); that's not a failure.
    if ((err as { status?: number }).status === 409) return out;
    console.warn(`  Could not list files for ${nm(repo.name)}: ${errMsg(err)}`);
    base.failed = true;
    return out;
  }

  const { manifests, unparsed } = pickManifests(paths);
  base.unparsed = unparsed;

  let mapping: DepMapping = {};
  for (const m of manifests) {
    const text = await fetchRaw(octokit, owner, repo.name, ref, m.path);
    if (text === null) { base.failed = true; continue; }
    const lockText = m.lockfile ? await fetchRaw(octokit, owner, repo.name, ref, m.lockfile) : null;
    // The lockfile is in the tree, so not reading it means missing versions and a partial scan.
    if (m.lockfile && lockText === null) base.failed = true;
    let parsed;
    try {
      parsed = parseManifest(m.path, text, lockText);
    } catch (err) {
      // A malformed manifest is the repo's problem, not the run's.
      console.warn(`  Could not parse a manifest in ${nm(repo.name)}: ${errMsg(err)}`);
      continue;
    }
    out.rawDeps.push({ ...m, deps: parsed.deps });
    out.locked.push(...parsed.locked);
    for (const d of parsed.deps) {
      if (d.installed) out.directKeys.add(verKey(d.ecosystem, d.name, d.installed));
      // PyPI names are normalised to hyphens; the mappings use the names as published.
      const hit = lookupDep(d.name) ?? lookupDep(d.name.replace(/-/g, '_'));
      if (hit) mapping = mergeMappings(mapping, hit);
    }
    const signal = MANIFEST_SIGNALS[path.posix.basename(m.path)];
    if (signal) mapping = mergeMappings(mapping, signal);
  }
  for (const p of unparsed) {
    const signal = MANIFEST_SIGNALS[path.posix.basename(p)];
    if (signal) mapping = mergeMappings(mapping, signal);
  }
  const services = new Set(mapping.service ?? []);
  if (token) {
    const code = await scanRepoCode(owner, repo.name, token);
    if (code) {
      base.codeScanned = true;
      code.services.forEach(x => services.add(x));
      base.models = code.models;
    } else {
      console.warn(`  Could not clone ${nm(repo.name)} for the code scan; APIs come from packages only.`);
    }
  }
  base.stack = [...(mapping.stack ?? [])].sort();
  base.services = [...services].sort();

  try {
    const prs = await octokit.paginate(octokit.pulls.list, { owner, repo: repo.name, state: 'open', per_page: 100 });
    base.dependabotOpenPrs = prs.filter(p => p.user?.login === 'dependabot[bot]').length;
  } catch (err) {
    console.warn(`  Could not list pull requests for ${nm(repo.name)}: ${errMsg(err)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weekly scan: registries + OSV
// ---------------------------------------------------------------------------

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
    } catch {
      // Retry once, then give up on this lookup.
    }
  }
  return null;
}

/** Go module paths escape capitals as "!" + lower case (golang.org/x/mod/module). */
const goEscape = (mod: string) => mod.replace(/[A-Z]/g, c => `!${c.toLowerCase()}`);

export async function latestVersion(eco: Ecosystem, name: string): Promise<string | null> {
  switch (eco) {
    case 'npm': {
      const d = await fetchJson(`https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`) as { latest?: string } | null;
      return d?.latest ?? null;
    }
    case 'Pub': {
      const d = await fetchJson(`https://pub.dev/api/packages/${encodeURIComponent(name)}`) as { latest?: { version?: string } } | null;
      return d?.latest?.version ?? null;
    }
    case 'PyPI': {
      const d = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`) as { info?: { version?: string } } | null;
      return d?.info?.version ?? null;
    }
    case 'Go': {
      const d = await fetchJson(`https://proxy.golang.org/${goEscape(name)}/@latest`) as { Version?: string } | null;
      return d?.Version ?? null;
    }
    case 'crates.io': {
      const d = await fetchJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`) as { crate?: { max_stable_version?: string; max_version?: string } } | null;
      return d?.crate?.max_stable_version ?? d?.crate?.max_version ?? null;
    }
  }
}

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { ecosystem?: string; name?: string };
    ranges?: { events?: { fixed?: string }[] }[];
    ecosystem_specific?: { severity?: string };
  }[];
}

export function toAdvisory(v: OsvVuln): Advisory {
  const fixed: Record<string, string[]> = {};
  for (const a of v.affected ?? []) {
    if (!a.package?.ecosystem || !a.package.name) continue;
    const key = pkgKey(a.package.ecosystem, a.package.ecosystem === 'PyPI' ? a.package.name.toLowerCase().replace(/[-_.]+/g, '-') : a.package.name);
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) (fixed[key] ??= []).push(e.fixed);
  }
  const severity = (v.database_specific?.severity ?? v.affected?.find(a => a.ecosystem_specific?.severity)?.ecosystem_specific?.severity ?? 'unrated').toUpperCase();
  const summary = (v.summary ?? v.details ?? '').split('\n')[0].slice(0, 160);
  return { summary, severity, aliases: (v.aliases ?? []).slice(0, 3), fixed };
}

async function runScan(collected: Collected[], previous: ScanCache | null): Promise<ScanCache> {
  const directPkgs = new Map<string, { eco: Ecosystem; name: string }>();
  for (const c of collected) for (const m of c.rawDeps) for (const d of m.deps) {
    if (d.declared !== null) directPkgs.set(pkgKey(d.ecosystem, d.name), { eco: d.ecosystem, name: d.name });
  }
  const lockedPkgs = new Map<string, LockedPackage>();
  for (const c of collected) for (const p of c.locked) lockedPkgs.set(verKey(p.ecosystem, p.name, p.version), p);

  console.log(`Scanning: latest versions for ${directPkgs.size} direct dependencies, advisories for ${lockedPkgs.size} locked packages...`);

  const latest: Record<string, string | null> = {};
  const entries = [...directPkgs.entries()];
  const versions = await mapLimit(entries, HTTP_CONCURRENCY, ([, p]) => latestVersion(p.eco, p.name));
  entries.forEach(([key], i) => { latest[key] = versions[i] ?? previous?.latest[key] ?? null; });
  console.log(`  Registry lookups answered: ${versions.filter(Boolean).length} of ${entries.length}`);

  const scanned: string[] = [];
  const vulnerable: Record<string, string[]> = {};
  const locked = [...lockedPkgs.entries()];
  let osvFailed = false;
  for (let i = 0; i < locked.length; i += OSV_BATCH) {
    const batch = locked.slice(i, i + OSV_BATCH);
    const res = await fetchJson('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: batch.map(([, p]) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
    }) as { results?: { vulns?: { id: string }[] }[] } | null;
    if (!res?.results || res.results.length !== batch.length) { osvFailed = true; continue; }
    batch.forEach(([key], j) => {
      scanned.push(key);
      const ids = res.results![j].vulns?.map(v => v.id) ?? [];
      if (ids.length) vulnerable[key] = ids;
    });
  }
  if (osvFailed) console.warn('  Some OSV batches failed; those packages show as not yet scanned.');

  const ids = [...new Set(Object.values(vulnerable).flat())];
  const advisories: Record<string, Advisory> = {};
  const toFetch = ids.slice(0, MAX_ADVISORY_FETCHES);
  const details = await mapLimit(toFetch, HTTP_CONCURRENCY, id => fetchJson(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`) as Promise<OsvVuln | null>);
  toFetch.forEach((id, i) => {
    const d = details[i];
    advisories[id] = d ? toAdvisory(d) : previous?.advisories[id] ?? { summary: '', severity: 'UNRATED', aliases: [], fixed: {} };
  });
  for (const id of ids.slice(MAX_ADVISORY_FETCHES)) {
    advisories[id] = previous?.advisories[id] ?? { summary: '', severity: 'UNRATED', aliases: [], fixed: {} };
  }
  console.log(`  Vulnerable package versions: ${Object.keys(vulnerable).length}; distinct advisories: ${ids.length}`);

  return {
    version: 1, scannedAt: new Date().toISOString(), latest, scanned: scanned.sort(), vulnerable, advisories,
    ...(osvFailed ? { incomplete: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Applying the cache
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MODERATE', 'MEDIUM', 'LOW', 'UNRATED'];
export const severityRank = (s: string) => {
  const i = SEVERITY_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? SEVERITY_ORDER.length : i;
};

/** Smallest fixed version above the installed one, if the advisory lists any. */
export function pickFixed(versions: string[] | undefined, installed: string): string | null {
  const above = (versions ?? []).filter(v => compareVersions(v, installed) > 0).sort(compareVersions);
  return above[0] ?? null;
}

export function applyCache(c: Collected, cache: ScanCache | null): RepoDependencies {
  const r = c.base;
  r.manifests = c.rawDeps.map(m => ({
    path: m.path,
    ecosystem: m.ecosystem,
    lockfile: m.lockfile,
    deps: m.deps.map(d => {
      const latest = cache?.latest[pkgKey(d.ecosystem, d.name)] ?? null;
      return { ...d, latest, status: d.declared === null ? 'unknown' : updateStatus(d, latest) };
    }),
  }));
  r.locked = new Set(c.locked.map(p => verKey(p.ecosystem, p.name, p.version))).size;
  if (!cache) {
    r.unscanned = r.locked;
    return r;
  }
  const scanned = new Set(cache.scanned);
  const seen = new Set<string>();
  for (const p of c.locked) {
    const key = verKey(p.ecosystem, p.name, p.version);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!scanned.has(key)) { r.unscanned++; continue; }
    for (const id of cache.vulnerable[key] ?? []) {
      const adv = cache.advisories[id];
      r.vulns.push({
        id,
        aliases: adv?.aliases ?? [],
        ecosystem: p.ecosystem,
        package: p.name,
        version: p.version,
        severity: adv?.severity ?? 'UNRATED',
        summary: adv?.summary ?? '',
        fixed: pickFixed(adv?.fixed[pkgKey(p.ecosystem, p.name)], p.version),
        direct: c.directKeys.has(key),
      });
    }
  }
  r.vulns.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || Number(b.direct) - Number(a.direct) || a.package.localeCompare(b.package));
  return r;
}

export function shouldScan(mode: string, cache: ScanCache | null, now = Date.now()): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  if (!cache || cache.incomplete) return true;
  return now - Date.parse(cache.scannedAt) > SCAN_EVERY_DAYS * 24 * 60 * 60 * 1000;
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME;
  const outPath = getArg('out');
  const modelsOut = getArg('models-out', '');
  const cachePath = getArg('cache');
  const indexPath = getArg('index', path.join('public', 'data', 'index-full.json'));
  const days = parseInt(getArg('days', '120'), 10);
  const scanMode = getArg('scan', 'auto');
  // Pass --code-scan off to skip cloning repos (dependency files only).
  const codeScan = getArg('code-scan', 'on') !== 'off';

  if (!token || !username) {
    console.error('GITHUB_TOKEN and GITHUB_USERNAME env vars are required');
    process.exit(1);
  }

  const index = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as { repos: RepoInfo[] };
  const active = selectActiveRepos(index.repos, days);
  console.log(`Reading dependency manifests for ${active.length} repos...`);
  if (active.length === 0) {
    console.error('No active repos found; writing no report.');
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const collected: Collected[] = [];
  for (const [i, repo] of active.entries()) {
    const c = await collectRepo(octokit, username, repo, codeScan ? token : undefined);
    const depCount = c.rawDeps.reduce((n, m) => n + m.deps.length, 0);
    console.log(`  ${nm(repo.name)} (${i + 1}/${active.length}): ${c.rawDeps.length} manifests, ${depCount} direct deps, ` +
      `${c.base.services.length} APIs, ${c.base.models.length} models${c.base.failed ? ', INCOMPLETE' : ''}`);
    collected.push(c);
  }

  const failedCount = collected.filter(c => c.base.failed).length;
  if (failedCount / collected.length > MAX_FAILURE_RATE) {
    console.error(`${failedCount} of ${collected.length} repos had failed GitHub calls (limit ${MAX_FAILURE_RATE * 100}%). Writing no report.`);
    process.exit(1);
  }

  let cache: ScanCache | null = null;
  try {
    cache = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as ScanCache;
  } catch {
    console.log('No scan cache yet.');
  }
  if (shouldScan(scanMode, cache)) {
    const fresh = await runScan(collected, cache);
    // A scan that reached nothing (e.g. OSV down) is never saved: with no
    // cache the pages say "not scanned yet" and the next night tries again,
    // and an existing cache keeps serving its results.
    if (fresh.scanned.length > 0) {
      cache = fresh;
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(cache, null, 1) + '\n', 'utf-8');
      console.log('Scan cache updated.');
    } else {
      console.warn(cache ? 'Scan reached no advisories; keeping the previous scan cache.' : 'Scan reached no advisories; will try again next run.');
    }
  } else {
    console.log(`Using the scan from ${cache?.scannedAt.split('T')[0]}.`);
  }

  const report: DependencyReport = {
    generatedAt: new Date().toISOString(),
    scannedAt: cache?.scannedAt ?? null,
    repos: collected.map(c => applyCache(c, cache)),
  };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 1), 'utf-8');
  // Skipped when the code scan is off: an empty feed would read as "no models in use".
  if (modelsOut && codeScan) {
    const feed = buildModelFeed(report.repos.filter(r => r.codeScanned));
    await fs.mkdir(path.dirname(modelsOut), { recursive: true });
    await fs.writeFile(modelsOut, JSON.stringify(feed, null, 1) + '\n', 'utf-8');
    console.log(`Wrote model feed: ${feed.models.length} model ids.`);
  }
  const vulns = report.repos.reduce((n, r) => n + r.vulns.length, 0);
  console.log(`Wrote dependency report: ${report.repos.length} repos, ${vulns} vulnerability findings.`);
}

if (process.argv[1] && /buildDependencyReport\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('Failed:', errMsg(err));
    process.exit(1);
  });
}
