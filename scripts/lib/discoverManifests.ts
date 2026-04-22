/**
 * Discovers buildable manifests inside a project root, including common
 * sub-surfaces like `web/`, `mobile/`, `api/`, `backend/`, etc. Returns a
 * flat list of `ManifestHit`s that callers can then inspect and merge.
 *
 * Why this matters: QuantumRetriever has its mobile app at `Metabot/mobile/`
 * with its own package.json. The old hardcoded seed-taxonomy.ts would miss
 * it entirely. This walker handles nested manifests naturally.
 *
 * Performance: does NOT recurse into node_modules, build, dist, .git, etc.
 * Only walks the explicit subdirs we care about, one level deep.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export type ManifestKind =
  | 'package.json'         // Node/JS/TS
  | 'pubspec.yaml'         // Dart/Flutter
  | 'requirements.txt'     // Python
  | 'pyproject.toml'       // Python (modern)
  | 'Cargo.toml'           // Rust
  | 'go.mod'               // Go
  | 'netlify.toml'         // Netlify
  | 'wrangler.toml'        // Cloudflare Workers
  | 'fly.toml'             // Fly.io
  | 'manifest.json'        // Browser extension (has manifest_version)
  | 'Dockerfile'           // Generic container
  | 'app.json'             // Expo (legacy)
  | 'app.config.js';       // Expo (modern)

export interface ManifestHit {
  kind: ManifestKind;
  absPath: string;
  relPath: string;   // Relative to project root
  subdir: string;    // '' for root, 'mobile', 'web', etc.
}

// Subdirectories that commonly hold a distinct buildable surface.
const SUB_SURFACES = [
  'web',
  'mobile',
  'api',
  'backend',
  'frontend',
  'client',
  'server',
  'app',
  'ios',      // Flutter/RN have these — but they don't hold new manifests we care about
  'android',  // same
] as const;

// Names we look for directly (not content-sniffed).
const MANIFEST_NAMES: ManifestKind[] = [
  'package.json',
  'pubspec.yaml',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'netlify.toml',
  'wrangler.toml',
  'fly.toml',
  'manifest.json',
  'Dockerfile',
  'app.json',
  'app.config.js',
];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scans a single directory for all known manifest files.
 */
async function scanDir(
  projectRoot: string,
  subdir: string,
): Promise<ManifestHit[]> {
  const hits: ManifestHit[] = [];
  const dirAbs = subdir ? path.join(projectRoot, subdir) : projectRoot;

  if (!(await exists(dirAbs))) return hits;

  for (const name of MANIFEST_NAMES) {
    const absPath = path.join(dirAbs, name);
    if (await exists(absPath)) {
      hits.push({
        kind: name,
        absPath,
        relPath: subdir ? `${subdir}/${name}` : name,
        subdir,
      });
    }
  }

  return hits;
}

/**
 * Walk a project root + its known sub-surfaces, returning every manifest found.
 */
export async function discoverManifests(projectRoot: string): Promise<ManifestHit[]> {
  const out: ManifestHit[] = [];
  out.push(...(await scanDir(projectRoot, '')));
  for (const sub of SUB_SURFACES) {
    out.push(...(await scanDir(projectRoot, sub)));
  }
  return out;
}
