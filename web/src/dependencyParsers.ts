/**
 * Pure helpers for the dependency report (buildDependencyReport.ts): which
 * files in a repo are dependency manifests, how to read the direct
 * dependencies and installed versions out of them, and how far a version is
 * behind the latest release.
 *
 * Kept free of network and filesystem calls so the parsers can be tested on
 * fixtures (scripts/tests/dependencies.test.ts).
 *
 * Coverage: npm (package.json + package-lock.json), Dart/Flutter (pubspec.yaml
 * + pubspec.lock), Python (requirements.txt, pyproject.toml + poetry.lock /
 * uv.lock), Go (go.mod) and Rust (Cargo.toml + Cargo.lock). Gradle, Swift,
 * CocoaPods and other build files are only recorded as present.
 */

import * as path from 'path';
import yaml from 'js-yaml';

/** OSV ecosystem names, which the registry lookups reuse. */
export type Ecosystem = 'npm' | 'Pub' | 'PyPI' | 'Go' | 'crates.io';

export interface Dep {
  ecosystem: Ecosystem;
  name: string;
  /** Version range as written in the manifest, e.g. "^18.2.0". Null for git/path/sdk deps. */
  declared: string | null;
  /** Version the lockfile resolved, or the exact pin when the manifest has one. */
  installed: string | null;
  dev: boolean;
}

/** One resolved package from a lockfile (direct or transitive), for the vulnerability scan. */
export interface LockedPackage {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

/** Manifest file name → ecosystem and the lockfiles that can sit next to it. */
export const MANIFESTS: Record<string, { ecosystem: Ecosystem; lockfiles: string[] }> = {
  'package.json':     { ecosystem: 'npm', lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'] },
  'pubspec.yaml':     { ecosystem: 'Pub', lockfiles: ['pubspec.lock'] },
  'requirements.txt': { ecosystem: 'PyPI', lockfiles: [] },
  'pyproject.toml':   { ecosystem: 'PyPI', lockfiles: ['poetry.lock', 'uv.lock'] },
  'go.mod':           { ecosystem: 'Go', lockfiles: [] },
  'Cargo.toml':       { ecosystem: 'crates.io', lockfiles: ['Cargo.lock'] },
};

/** Build files this report recognises but doesn't parse yet. */
export const UNPARSED_MANIFESTS = new Set([
  'build.gradle', 'build.gradle.kts', 'libs.versions.toml', 'pom.xml',
  'Package.swift', 'Podfile', 'Gemfile', 'composer.json',
]);

// Vendored, generated or example trees whose manifests aren't the app's own.
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|\.git|\.dart_tool|\.next|\.expo|Pods|\.?venv|site-packages|__pycache__|examples?|fixtures|test[-_]?data|third[-_]party|archive)\//i;

// Deep enough for `netlify/functions/requirements.txt` or `apps/web/package.json`.
const MAX_DEPTH = 3;
export const MAX_MANIFESTS_PER_REPO = 12;

export interface ManifestPick {
  path: string;
  ecosystem: Ecosystem;
  lockfile: string | null;
}

/**
 * Given every file path in a repo, returns the manifests to read (shallowest
 * first, capped) with the lockfile beside each, plus recognised-but-unparsed
 * build files.
 */
export function pickManifests(paths: string[]): { manifests: ManifestPick[]; unparsed: string[] } {
  const present = new Set(paths);
  const usable = paths.filter(p => !SKIP_DIR.test(p) && p.split('/').length <= MAX_DEPTH);
  const byDepth = (a: string, b: string) => a.split('/').length - b.split('/').length || a.localeCompare(b);

  const manifests: ManifestPick[] = usable
    .filter(p => MANIFESTS[path.posix.basename(p)])
    .sort(byDepth)
    .slice(0, MAX_MANIFESTS_PER_REPO)
    .map(p => {
      const { ecosystem, lockfiles } = MANIFESTS[path.posix.basename(p)];
      const dir = path.posix.dirname(p);
      const lock = lockfiles.map(l => (dir === '.' ? l : `${dir}/${l}`)).find(l => present.has(l)) ?? null;
      return { path: p, ecosystem, lockfile: lock };
    });
  const unparsed = usable.filter(p => UNPARSED_MANIFESTS.has(path.posix.basename(p))).sort(byDepth);
  return { manifests, unparsed };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** First x[.y[.z]] in a string, or null. "^18.2.0" → [18, 2, 0]; "v1.4" → [1, 4, 0]. */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = v?.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The exact version a range pins, if it pins one ("==1.2.3", "1.2.3", "=1.2.3"). */
function exactPin(spec: string): string | null {
  const m = spec.trim().match(/^(?:==|=)?\s*v?(\d+(?:\.\d+){0,3}[\w.+-]*)$/);
  return m ? m[1] : null;
}

export type UpdateStatus = 'current' | 'patch' | 'minor' | 'major' | 'unknown';

/**
 * How far `installed` (or, without a lockfile, the floor of `declared`) is
 * behind `latest`. For 0.x packages a minor bump counts as major, since semver
 * treats it as breaking.
 */
export function updateStatus(dep: Pick<Dep, 'declared' | 'installed'>, latest: string | null | undefined): UpdateStatus {
  const have = parseVersion(dep.installed ?? dep.declared);
  const want = parseVersion(latest);
  if (!have || !want) return 'unknown';
  if (want[0] !== have[0]) return want[0] > have[0] ? 'major' : 'current';
  if (want[1] !== have[1]) {
    if (want[1] < have[1]) return 'current';
    return have[0] === 0 ? 'major' : 'minor';
  }
  return want[2] > have[2] ? 'patch' : 'current';
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

export function parsePackageJson(text: string): Dep[] {
  const pkg = JSON.parse(text) as Record<string, unknown>;
  const deps: Dep[] = [];
  for (const [field, dev] of [['dependencies', false], ['devDependencies', true]] as const) {
    const block = pkg[field];
    if (!block || typeof block !== 'object') continue;
    for (const [name, spec] of Object.entries(block as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      // git, file, link, workspace and URL specs don't come from the registry.
      const local = /^(git|github:|file:|link:|workspace:|https?:|\.|\/)/.test(spec) || spec.includes('/') && !spec.startsWith('npm:');
      deps.push({ ecosystem: 'npm', name, declared: local ? null : spec, installed: local ? null : exactPin(spec), dev });
    }
  }
  return deps;
}

/** All packages in a package-lock.json (lockfile v1, v2 or v3). */
export function parsePackageLock(text: string): Map<string, string> & { all: LockedPackage[] } {
  const lock = JSON.parse(text) as {
    packages?: Record<string, { version?: string; link?: boolean }>;
    dependencies?: Record<string, { version?: string; dependencies?: unknown }>;
  };
  const direct = new Map<string, string>() as Map<string, string> & { all: LockedPackage[] };
  const all: LockedPackage[] = [];
  if (lock.packages) {
    for (const [key, info] of Object.entries(lock.packages)) {
      if (!key || info.link || !info.version) continue;
      const i = key.lastIndexOf('node_modules/');
      if (i === -1) continue;
      const name = key.slice(i + 'node_modules/'.length);
      all.push({ ecosystem: 'npm', name, version: info.version });
      // Top-level install of this package (not nested under another one).
      if (key === `node_modules/${name}`) direct.set(name, info.version);
    }
  } else if (lock.dependencies) {
    const walk = (deps: Record<string, { version?: string; dependencies?: unknown }>, top: boolean) => {
      for (const [name, info] of Object.entries(deps)) {
        if (info.version && /^\d/.test(info.version)) {
          all.push({ ecosystem: 'npm', name, version: info.version });
          if (top) direct.set(name, info.version);
        }
        if (info.dependencies && typeof info.dependencies === 'object') walk(info.dependencies as typeof deps, false);
      }
    };
    walk(lock.dependencies, true);
  }
  direct.all = all;
  return direct;
}

// ---------------------------------------------------------------------------
// Dart / Flutter
// ---------------------------------------------------------------------------

export function parsePubspec(text: string): Dep[] {
  const doc = (yaml.load(text) ?? {}) as Record<string, unknown>;
  const deps: Dep[] = [];
  for (const [field, dev] of [['dependencies', false], ['dev_dependencies', true]] as const) {
    const block = doc[field];
    if (!block || typeof block !== 'object') continue;
    for (const [name, spec] of Object.entries(block as Record<string, unknown>)) {
      let declared: string | null = null;
      if (typeof spec === 'string' || typeof spec === 'number') declared = String(spec);
      else if (spec && typeof spec === 'object') {
        const s = spec as Record<string, unknown>;
        // sdk:, git: and path: deps aren't on pub.dev.
        if (s.sdk || s.git || s.path) continue;
        if (typeof s.version === 'string') declared = s.version;
      } else if (spec === null) declared = 'any';
      deps.push({ ecosystem: 'Pub', name, declared, installed: declared ? exactPin(declared) : null, dev });
    }
  }
  return deps;
}

export function parsePubspecLock(text: string): Map<string, string> & { all: LockedPackage[] } {
  const doc = (yaml.load(text) ?? {}) as { packages?: Record<string, { source?: string; version?: string }> };
  const map = new Map<string, string>() as Map<string, string> & { all: LockedPackage[] };
  map.all = [];
  for (const [name, info] of Object.entries(doc.packages ?? {})) {
    if (info.source !== 'hosted' || !info.version) continue;
    map.set(name, info.version);
    map.all.push({ ecosystem: 'Pub', name, version: info.version });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

/** PEP 503 normalised name, which PyPI and OSV both match on. */
export const normalizePyName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');

/** One PEP 508 requirement string → Dep, or null for URLs, options and blanks. */
export function parseRequirement(line: string, dev = false): Dep | null {
  const req = line.split('#')[0].split(';')[0].trim();
  if (!req || req.startsWith('-') || /^(git\+|https?:|\.|\/)/.test(req) || req.includes(' @ ')) return null;
  const m = req.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/);
  if (!m) return null;
  const spec = m[3].replace(/^\(|\)$/g, '').trim();
  return {
    ecosystem: 'PyPI',
    name: normalizePyName(m[1]),
    declared: spec || null,
    installed: spec.startsWith('==') && !spec.includes(',') && !spec.includes('*') ? spec.slice(2).trim() : null,
    dev,
  };
}

export function parseRequirementsTxt(text: string): Dep[] {
  return text.split(/\r?\n/).map(l => parseRequirement(l)).filter((d): d is Dep => d !== null);
}

/** Lines of one [section] of a TOML file (stops at the next header). */
function tomlSection(text: string, header: RegExp): { header: string; lines: string[] }[] {
  const out: { header: string; lines: string[] }[] = [];
  let cur: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (h) {
      const name = h[1].trim();
      cur = header.test(name) ? [] : null;
      if (cur) out.push({ header: name, lines: cur });
      continue;
    }
    if (cur) cur.push(line);
  }
  return out;
}

/** `name = "1.0"` or `name = { version = "1.0", ... }` lines of a TOML table. */
function tomlDepTable(lines: string[]): { name: string; spec: string | null }[] {
  const out: { name: string; spec: string | null }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const value = m[2];
    const str = value.match(/^["']([^"']*)["']/);
    if (str) { out.push({ name: m[1], spec: str[1] }); continue; }
    if (value.startsWith('{')) {
      if (/\b(path|git)\s*=/.test(value)) continue;
      const v = value.match(/\bversion\s*=\s*["']([^"']*)["']/);
      out.push({ name: m[1], spec: v ? v[1] : null });
    }
  }
  return out;
}

export function parsePyproject(text: string): Dep[] {
  const deps: Dep[] = [];
  // PEP 621: [project] dependencies = ["requests>=2", ...] (may span lines).
  for (const { lines } of tomlSection(text, /^project$/)) {
    const body = lines.join('\n');
    const arr = body.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
    if (arr) {
      for (const s of arr[1].matchAll(/["']([^"']+)["']/g)) {
        const d = parseRequirement(s[1]);
        if (d) deps.push(d);
      }
    }
  }
  // Poetry: [tool.poetry.dependencies], [tool.poetry.dev-dependencies], [tool.poetry.group.<g>.dependencies].
  for (const { header, lines } of tomlSection(text, /^tool\.poetry\.(dependencies|dev-dependencies|group\.[^.]+\.dependencies)$/)) {
    const dev = header !== 'tool.poetry.dependencies';
    for (const { name, spec } of tomlDepTable(lines)) {
      if (name.toLowerCase() === 'python') continue;
      deps.push({ ecosystem: 'PyPI', name: normalizePyName(name), declared: spec, installed: spec ? exactPin(spec) : null, dev });
    }
  }
  return deps;
}

/** `[[package]] name = ... version = ...` lockfiles: Cargo.lock, poetry.lock, uv.lock. */
export function parseTomlPackageLock(text: string, ecosystem: Ecosystem): Map<string, string> & { all: LockedPackage[] } {
  const map = new Map<string, string>() as Map<string, string> & { all: LockedPackage[] };
  map.all = [];
  for (const { lines } of tomlSection(text, /^package$/)) {
    const body = lines.join('\n');
    const name = body.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = body.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    // Path, git and workspace-member packages have no registry source.
    const source = body.match(/^\s*source\s*=\s*(.+)$/m)?.[1] ?? '';
    if (!name || !version) continue;
    if (ecosystem === 'crates.io' && !source.includes('registry')) continue;
    if (ecosystem === 'PyPI' && /virtual|editable|directory|git/.test(source)) continue;
    const key = ecosystem === 'PyPI' ? normalizePyName(name) : name;
    map.set(key, version);
    map.all.push({ ecosystem, name: key, version });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Go and Rust
// ---------------------------------------------------------------------------

export function parseGoMod(text: string): Dep[] {
  const deps: Dep[] = [];
  const add = (line: string) => {
    const m = line.trim().match(/^([^\s]+)\s+(v[^\s]+)(\s*\/\/\s*indirect)?/);
    // Indirect requirements are transitive; they still go to the vulnerability scan via the report.
    if (m && !m[3]) deps.push({ ecosystem: 'Go', name: m[1], declared: m[2], installed: m[2], dev: false });
  };
  const block = text.match(/^require\s*\(([\s\S]*?)^\)/gm) ?? [];
  for (const b of block) for (const line of b.split('\n').slice(1, -1)) add(line);
  for (const m of text.matchAll(/^require\s+([^\s(][^\n]*)$/gm)) add(m[1]);
  return deps;
}

/** All requirements in go.mod, indirect included, for the vulnerability scan. */
export function goModPackages(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  for (const m of text.matchAll(/^\s*(?:require\s+)?([a-z0-9][^\s]*\.[^\s]+)\s+(v\d[^\s]*)/gim)) {
    out.push({ ecosystem: 'Go', name: m[1], version: m[2] });
  }
  return out;
}

export function parseCargoToml(text: string): Dep[] {
  const deps: Dep[] = [];
  for (const [header, dev] of [[/^dependencies$/, false], [/^(dev|build)-dependencies$/, true]] as const) {
    for (const { lines } of tomlSection(text, header)) {
      for (const { name, spec } of tomlDepTable(lines)) {
        deps.push({ ecosystem: 'crates.io', name, declared: spec, installed: null, dev });
      }
    }
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface ParsedManifest {
  deps: Dep[];
  /** Every resolved package (direct and transitive) the vulnerability scan should check. */
  locked: LockedPackage[];
}

/**
 * Parses one manifest (and its lockfile, if fetched) into direct deps with
 * installed versions filled in from the lockfile, plus the full package list
 * for the vulnerability scan. Without a lockfile only exact pins are scanned.
 */
export function parseManifest(manifestPath: string, text: string, lockText: string | null): ParsedManifest {
  const base = path.posix.basename(manifestPath);
  let deps: Dep[] = [];
  let lock: (Map<string, string> & { all: LockedPackage[] }) | null = null;
  let extraLocked: LockedPackage[] = [];

  switch (base) {
    case 'package.json':
      deps = parsePackageJson(text);
      if (lockText) lock = parsePackageLock(lockText);
      break;
    case 'pubspec.yaml':
      deps = parsePubspec(text);
      if (lockText) lock = parsePubspecLock(lockText);
      break;
    case 'requirements.txt':
      deps = parseRequirementsTxt(text);
      break;
    case 'pyproject.toml':
      deps = parsePyproject(text);
      if (lockText) lock = parseTomlPackageLock(lockText, 'PyPI');
      break;
    case 'go.mod':
      deps = parseGoMod(text);
      extraLocked = goModPackages(text);
      break;
    case 'Cargo.toml':
      deps = parseCargoToml(text);
      if (lockText) lock = parseTomlPackageLock(lockText, 'crates.io');
      break;
  }

  if (lock) {
    for (const d of deps) d.installed = lock.get(d.name) ?? d.installed;
  }
  const locked = lock
    ? lock.all
    : extraLocked.length
      ? extraLocked
      : deps.filter(d => d.installed).map(d => ({ ecosystem: d.ecosystem, name: d.name, version: d.installed as string }));
  return { deps, locked };
}
