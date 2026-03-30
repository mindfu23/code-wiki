/**
 * Diagram Staleness Detection
 *
 * Computes structural signals (dependency names, function files, src dirs) for each
 * diagrammed project and compares against the previously stored state. If signals
 * have changed, the diagram is flagged as stale.
 *
 * Run: npx tsx src/diagramSignals.ts
 * Environment: GITHUB_TOKEN, GITHUB_USERNAME (same as indexBuilder)
 */

import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { Octokit } from '@octokit/rest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env fallback (same pattern as indexBuilder)
function loadEnvFallback(): void {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../mcp-server/.env'),
  ];
  for (const envPath of envPaths) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch {
      // File doesn't exist, skip
    }
  }
}

loadEnvFallback();

// Projects to track — maps diagram id to GitHub repo name
const DIAGRAM_REPOS: Record<string, string> = {
  'metabot': 'Metabot',
  'valueape': 'ValueApe',
  'ethicalaiditor': 'EthicalAIditor',
  'datastic': 'Datastic',
  'novelizer': 'Novelizer',
  'code-wiki': 'code-wiki',
  'n8n-workflows': 'n8n_workflows',
  'lensquery': 'LensQuery',
  'searchbard': 'SearchBard',
  'theorazine': 'Theorazine',
  'gastown': 'gastown',
  'storyplot': 'StoryPlot',
  'jbwordpresstheme': 'JBWordPressTheme',
  'photophreaker': 'PhotoPhreaker',
};

interface SignalEntry {
  depsHash: string;
  functionsHash: string;
  srcDirsHash: string;
  stale: boolean;
  lastChecked: string;
}

type SignalsFile = Record<string, SignalEntry>;

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

async function fetchPackageJsonDeps(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: 'package.json' });
    if ('content' in data && data.content) {
      const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
      const pkg = JSON.parse(decoded);
      const depNames = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
      ].sort();
      return hash(depNames.join(','));
    }
  } catch {
    // No package.json or error
  }
  return hash('');
}

async function fetchDirListing(
  octokit: Octokit,
  owner: string,
  repo: string,
  dirPath: string
): Promise<string> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: dirPath });
    if (Array.isArray(data)) {
      const names = data.map(f => f.name).sort();
      return hash(names.join(','));
    }
  } catch {
    // Directory doesn't exist
  }
  return hash('');
}

async function main() {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

  if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
    console.log('Skipping diagram signals: GITHUB_TOKEN or GITHUB_USERNAME not set');
    return;
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const outputPath = path.resolve(__dirname, '../public/data/diagram-signals.json');

  // Load existing signals
  let existing: SignalsFile = {};
  try {
    const raw = await fs.readFile(outputPath, 'utf-8');
    existing = JSON.parse(raw);
  } catch {
    // No existing file
  }

  const signals: SignalsFile = {};
  const now = new Date().toISOString();

  console.log('Computing diagram staleness signals...');

  for (const [id, repoName] of Object.entries(DIAGRAM_REPOS)) {
    try {
      const depsHash = await fetchPackageJsonDeps(octokit, GITHUB_USERNAME, repoName);
      const functionsHash = await fetchDirListing(octokit, GITHUB_USERNAME, repoName, 'netlify/functions');
      const srcDirsHash = await fetchDirListing(octokit, GITHUB_USERNAME, repoName, 'src');

      const prev = existing[id];
      const changed = prev && (
        prev.depsHash !== depsHash ||
        prev.functionsHash !== functionsHash ||
        prev.srcDirsHash !== srcDirsHash
      );

      signals[id] = {
        depsHash,
        functionsHash,
        srcDirsHash,
        stale: changed || false,
        lastChecked: now,
      };

      const status = changed ? ' [STALE]' : '';
      console.log(`  ${repoName}${status}`);
    } catch (err) {
      console.warn(`  ${repoName}: error fetching signals`, (err as Error).message);
      // Preserve previous entry if fetch fails
      if (existing[id]) {
        signals[id] = { ...existing[id], lastChecked: now };
      }
    }
  }

  await fs.writeFile(outputPath, JSON.stringify(signals, null, 2));
  console.log(`\nSignals written to ${outputPath}`);

  const staleCount = Object.values(signals).filter(s => s.stale).length;
  if (staleCount > 0) {
    console.log(`${staleCount} diagram(s) may need updating.`);
  } else {
    console.log('All diagrams are up to date.');
  }
}

main().catch(err => {
  console.error('Diagram signals failed:', err);
  process.exit(1);
});
