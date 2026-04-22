/**
 * Taxonomy auto-inference — scans every project in the workspace and
 * proposes (or applies) taxonomy frontmatter on the corresponding wiki
 * entry. Merge-preserving: never removes human-added terms.
 *
 * See HANDOFF-taxonomy-auto-inference.md for the full design.
 *
 * Usage:
 *   npm run seed-taxonomy                     # dry-run, all projects
 *   npm run seed-taxonomy -- --project Name   # one project
 *   npm run seed-taxonomy:apply               # write changes
 *   npm run seed-taxonomy:apply -- --create-stubs   # also create new stubs
 *
 * Or directly:
 *   npx tsx scripts/seed-taxonomy.ts [options]
 *
 * Options:
 *   --project <name>       Scope to a single project by name
 *   --apply                Write changes (default is dry-run)
 *   --create-stubs         Create minimal wiki entries for projects lacking one
 *   --source <path>        Override repo-locations.md path
 *   --private-dir <path>   Override private content repo path
 *   --verbose              Log every scanned manifest and mapped dep
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';

import { parseRepoLocations, findRepoLocations, RepoEntry } from './lib/parseRepoLocations.js';
import { discoverManifests, ManifestHit } from './lib/discoverManifests.js';
import { lookupDep, MANIFEST_SIGNALS, DepMapping, mergeMappings } from './lib/depMappings.js';
import {
  mergeTaxonomy,
  applyTaxonomyToContent,
  formatDiff,
  InferredTaxonomy,
  MergeDiff,
} from './lib/mergeFrontmatter.js';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  project?: string;
  apply: boolean;
  createStubs: boolean;
  source?: string;
  privateDir?: string;
  verbose: boolean;
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = { apply: false, createStubs: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--apply':         opts.apply = true; break;
      case '--create-stubs':  opts.createStubs = true; break;
      case '--verbose':       opts.verbose = true; break;
      case '--project':       opts.project = argv[++i]; break;
      case '--source':        opts.source = argv[++i]; break;
      case '--private-dir':   opts.privateDir = argv[++i]; break;
      case '--help':
      case '-h':
        console.log(HELP_TEXT);
        process.exit(0);
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(2);
        }
    }
  }
  return opts;
}

const HELP_TEXT = `
Taxonomy auto-inference for code-wiki.

Usage: npx tsx scripts/seed-taxonomy.ts [options]

Options:
  --project <name>       Scope to a single project by name
  --apply                Write frontmatter changes (default is dry-run)
  --create-stubs         Create minimal wiki entries for projects without one
  --source <path>        Override repo-locations.md path
  --private-dir <path>   Override private content repo path
  --verbose              Log every manifest and dependency processed

Freshness note: repo-locations.md is regenerated daily. After creating a
new repo, hit the "Refresh" button in the code-wiki web UI, wait ~2–3 min,
then re-run this script with --create-stubs.
`.trim();

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/**
 * Inspect all discovered manifests for a project and accumulate a DepMapping.
 * Logs unmapped deps when verbose.
 */
async function inferFromManifests(
  manifests: ManifestHit[],
  opts: CliOptions,
): Promise<DepMapping> {
  let agg: DepMapping = {};

  for (const hit of manifests) {
    if (opts.verbose) console.log(`    scan ${hit.relPath}`);

    // Presence-based signal (e.g. netlify.toml → netlify deployTarget)
    const signal = MANIFEST_SIGNALS[hit.kind];
    if (signal) agg = mergeMappings(agg, signal);

    // Dependency-based signal (package.json / pubspec.yaml)
    if (hit.kind === 'package.json') {
      const raw = await fs.readFile(hit.absPath, 'utf-8');
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const deps = {
        ...(parsed.dependencies as Record<string, string> | undefined),
        ...(parsed.devDependencies as Record<string, string> | undefined),
      };
      for (const depName of Object.keys(deps)) {
        const mapping = lookupDep(depName);
        if (mapping) {
          agg = mergeMappings(agg, mapping);
        } else if (opts.verbose) {
          console.log(`      unmapped dep: ${depName}`);
        }
      }
    }
    // pubspec.yaml dep parsing is intentionally light — `pubspec.yaml`'s
    // MANIFEST_SIGNAL already sets dart-flutter. Deep Flutter dep parsing
    // (stockfish, etc.) remains a manual override for now.
  }

  return agg;
}

/** Narrow Flutter platforms based on which platform dirs exist in the repo. */
async function narrowFlutterPlatforms(projectRoot: string, platforms: string[] | undefined): Promise<string[] | undefined> {
  if (!platforms?.includes('ios') && !platforms?.includes('android') && !platforms?.includes('web')) {
    return platforms;
  }
  const hasDir = async (d: string) => {
    try { await fs.access(path.join(projectRoot, d)); return true; } catch { return false; }
  };
  const out = new Set(platforms ?? []);
  if (!(await hasDir('ios')))     out.delete('ios');
  if (!(await hasDir('android'))) out.delete('android');
  if (!(await hasDir('web')))     out.delete('web');
  // dart-flutter web isn't guaranteed to have web/ dir in older projects; leave web if inferred
  return out.size > 0 ? [...out].sort() : undefined;
}

/**
 * Build an InferredTaxonomy for a single project given its repo entry
 * and discovered manifests. Applies heuristics + known-project hints.
 */
async function inferProjectTaxonomy(
  entry: RepoEntry,
  opts: CliOptions,
): Promise<{ inferred: InferredTaxonomy; manifests: ManifestHit[] }> {
  const manifests = entry.localPath
    ? await discoverManifests(entry.localPath)
    : [];

  let agg = await inferFromManifests(manifests, opts);

  // Flutter → narrow platforms to actual presence of ios/android/web dirs
  if (agg.stack?.includes('dart-flutter') && entry.localPath) {
    const narrowed = await narrowFlutterPlatforms(entry.localPath, agg.platform);
    agg = { ...agg, platform: narrowed };
  }

  // Default visibility: map RepoEntry.status → taxonomy visibility value
  //   synced + public github URL   → public
  //   local-only                    → internal
  //   github-only (assume private)  → private
  // We default to 'public' for synced repos because the taxonomy schema
  // doesn't distinguish public/private at this level. Users who flip a
  // repo private should update the wiki frontmatter manually (Phase B
  // of visibility migration will auto-sync).
  let visibility = 'public';
  if (entry.status === 'local-only') visibility = 'internal';

  const inferred: InferredTaxonomy = {
    type: 'project',
    stack: agg.stack,
    platform: agg.platform,
    deployTarget: agg.deployTarget,
    dependsOn: agg.service,
    visibility,
    lifecycle: 'shipped', // Default; users override to experimental/archived
  };

  return { inferred, manifests };
}

// ---------------------------------------------------------------------------
// Wiki file resolution
// ---------------------------------------------------------------------------

/**
 * Return the absolute path where a wiki entry for this repo lives, and a
 * flag indicating whether the file currently exists. Prefers the public
 * wiki; falls back to the private overlay.
 *
 * Resolution order:
 *   1. wiki/projects/{kebab-name}.md in public repo
 *   2. wiki/projects/{kebab-name}.md in private content repo (if configured)
 *
 * Projects whose wiki file exists under a different base name (e.g. the
 * wiki entry "quantumretriever.md" describes the Metabot repo) are
 * resolved by scanning `source_repo:` frontmatter in the next step.
 */
function kebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

async function findExistingWikiEntry(
  repoName: string,
  publicWikiDir: string,
  privateWikiDir: string | null,
): Promise<{ absPath: string; repoKind: 'public' | 'private' } | null> {
  // First: scan both dirs for files whose `source_repo:` frontmatter matches.
  for (const [dir, repoKind] of [
    [publicWikiDir, 'public' as const],
    ...(privateWikiDir ? [[privateWikiDir, 'private' as const]] : []),
  ] as Array<[string, 'public' | 'private']>) {
    try {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        const absPath = path.join(dir, f);
        const raw = await fs.readFile(absPath, 'utf-8');
        const { data } = matter(raw);
        if (typeof data.source_repo === 'string' &&
            data.source_repo.toLowerCase() === repoName.toLowerCase()) {
          return { absPath, repoKind };
        }
      }
    } catch {
      /* dir missing — continue */
    }
  }

  // Fallback: kebab-cased filename match
  const candidate = `${kebab(repoName)}.md`;
  for (const [dir, repoKind] of [
    [publicWikiDir, 'public' as const],
    ...(privateWikiDir ? [[privateWikiDir, 'private' as const]] : []),
  ] as Array<[string, 'public' | 'private']>) {
    const absPath = path.join(dir, candidate);
    try { await fs.access(absPath); return { absPath, repoKind }; } catch { /* next */ }
  }

  return null;
}

function stubContent(repoName: string, inferred: InferredTaxonomy): string {
  const fm: Record<string, unknown> = {
    title: repoName,
    description: '(TODO: describe this project)',
    tags: [],
    updated: new Date().toISOString().split('T')[0],
    source_repo: repoName,
    taxonomy: { ...inferred, completionState: 'stub' },
  };
  const body = `(TODO: flesh out this entry. Auto-generated by scripts/seed-taxonomy.ts.)\n`;
  return matter.stringify(body, fm);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));

  const repoLocationsPath = await findRepoLocations(opts.source);
  if (!repoLocationsPath) {
    console.error(
      'Could not find repo-locations.md. Set PRIVATE_CONTENT_DIR env var, ' +
      'clone code-wiki-content as a sibling, or pass --source.',
    );
    process.exit(2);
  }
  console.log(`Reading repo inventory from: ${repoLocationsPath}`);

  const publicWikiDir = path.resolve(process.cwd(), 'wiki/projects');
  const privateWikiDir = opts.privateDir
    ? path.resolve(opts.privateDir, 'wiki/projects')
    : path.resolve(path.dirname(repoLocationsPath)); // repo-locations.md's own dir

  const allEntries = await parseRepoLocations(repoLocationsPath);
  console.log(`Loaded ${allEntries.length} repos from inventory.\n`);

  const projectLower = opts.project?.toLowerCase();
  const targets = projectLower
    ? allEntries.filter((e) => e.name.toLowerCase() === projectLower)
    : allEntries;

  if (opts.project && targets.length === 0) {
    console.error(`No repo named "${opts.project}" in the inventory.`);
    process.exit(2);
  }

  let processed = 0;
  let proposedChanges = 0;
  let stubsCreated = 0;
  let writesDone = 0;

  for (const entry of targets) {
    processed++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${processed}/${targets.length}] ${entry.name}  (${entry.status})`);
    console.log(`${'='.repeat(60)}`);

    if (!entry.localPath) {
      console.log('  (no local path — skipping manifest inference)');
      continue;
    }

    const { inferred, manifests } = await inferProjectTaxonomy(entry, opts);
    console.log(`  Scanned ${manifests.length} manifest(s)`);

    // Resolve the wiki entry file (if any)
    const existing = await findExistingWikiEntry(entry.name, publicWikiDir, privateWikiDir);

    if (existing) {
      // Merge-preserving update path
      const raw = await fs.readFile(existing.absPath, 'utf-8');
      const { data } = matter(raw);
      const existingTaxonomy = (data.taxonomy ?? {}) as InferredTaxonomy;

      const { merged, diff } = mergeTaxonomy(existingTaxonomy, inferred);
      if (diff.changed) {
        proposedChanges++;
        console.log(`  Wiki entry: ${path.relative(process.cwd(), existing.absPath)} [${existing.repoKind}]`);
        console.log('  Diff:');
        console.log(formatDiff(diff));
        if (opts.apply) {
          const newContent = applyTaxonomyToContent(raw, merged, true);
          await fs.writeFile(existing.absPath, newContent, 'utf-8');
          writesDone++;
          console.log('  ✓ Written');
        }
      } else {
        console.log('  ✓ Already in sync (no changes)');
      }
    } else if (opts.createStubs) {
      // Stub creation path — route to public or private based on visibility
      const targetDir = inferred.visibility === 'public' || inferred.visibility === undefined
        ? publicWikiDir
        : privateWikiDir;
      const stubPath = path.join(targetDir, `${kebab(entry.name)}.md`);
      console.log(`  New stub: ${path.relative(process.cwd(), stubPath)}`);
      console.log('  Proposed frontmatter:');
      console.log(formatDiff({ added: {
        stack: inferred.stack ?? [],
        platform: inferred.platform ?? [],
        deployTarget: inferred.deployTarget ?? [],
        dependsOn: inferred.dependsOn ?? [],
        visibility: inferred.visibility ? [inferred.visibility] : [],
      }, kept: {}, changed: true }));
      stubsCreated++;
      if (opts.apply) {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(stubPath, stubContent(entry.name, inferred), 'utf-8');
        writesDone++;
        console.log('  ✓ Stub written (mark completionState: stub — fill in description!)');
      }
    } else {
      console.log('  No wiki entry found. Re-run with --create-stubs to generate one.');
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Processed:        ${processed} project(s)`);
  console.log(`  Pending updates:  ${proposedChanges}`);
  console.log(`  New stubs:        ${stubsCreated}`);
  if (opts.apply) {
    console.log(`  Writes performed: ${writesDone}`);
  } else {
    console.log(`  Dry-run — pass --apply to write changes.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
