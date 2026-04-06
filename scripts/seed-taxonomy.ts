/**
 * Taxonomy inference script — reads project manifests and proposes
 * taxonomy frontmatter for the 5 v1 target projects.
 *
 * Run: npx tsx scripts/seed-taxonomy.ts
 * Output: proposed YAML frontmatter blocks to stdout for human review.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';

const WORKSPACE = '/Users/jamesbeach/Documents/visual-studio-code/github-copilot';

interface ProjectConfig {
  name: string;
  projectName: string;     // Display name
  repoName: string;        // GitHub repo name
  dir: string;             // Absolute path
  manifests: string[];     // Relative paths to check
}

const PROJECTS: ProjectConfig[] = [
  {
    name: 'WeirdChess',
    projectName: 'WeirdChess',
    repoName: 'WeirdChess',
    dir: path.join(WORKSPACE, 'WeirdChess'),
    manifests: ['pubspec.yaml', 'netlify.toml'],
  },
  {
    name: 'QuantumRetriever',
    projectName: 'QuantumRetriever',
    repoName: 'Metabot',
    dir: path.join(WORKSPACE, 'Metabot'),
    manifests: ['package.json', 'netlify.toml', 'web/package.json'],
  },
  {
    name: 'code-wiki',
    projectName: 'code-wiki',
    repoName: 'code-wiki',
    dir: path.join(WORKSPACE, 'code-wiki'),
    manifests: ['web/package.json', 'mcp-server/package.json', 'netlify.toml'],
  },
  {
    name: 'TrollJar',
    projectName: 'TrollJar',
    repoName: 'TrollJar',
    dir: path.join(WORKSPACE, 'TrollJar'),
    manifests: ['manifest.json', 'package.json', 'netlify.toml'],
  },
  {
    name: 'NeoGeoSeo',
    projectName: 'NeoGeoSeo',
    repoName: 'NeoGeoSeo',
    dir: path.join(WORKSPACE, 'NeoGeoSeo'),
    manifests: ['geo-assessor-extension/manifest.json', 'geo-assessor-extension/package.json'],
  },
];

// Dependency -> taxonomy term mappings
const DEP_TO_STACK: Record<string, string> = {
  'react': 'react',
  'react-dom': 'react',
  'react-native': 'react-native',
  'expo': 'expo',
  'express': 'node-express',
  'vite': 'vite',
  '@netlify/functions': 'netlify-functions',
  'typescript': 'typescript',
};

const DEP_TO_SERVICE: Record<string, string> = {
  '@anthropic-ai/sdk': 'anthropic-api',
  'openai': 'openai-api',
  '@google/generative-ai': 'google-gemini-api',
  '@octokit/rest': 'github-api',
  'googleapis': 'google-sheets-api',
};

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readYamlSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return yaml.load(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function inferProject(config: ProjectConfig): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`# ${config.projectName} (repo: ${config.repoName})`);
  console.log(`${'='.repeat(60)}`);

  const stack = new Set<string>();
  const platform = new Set<string>();
  const deployTarget = new Set<string>();
  const domain = new Set<string>();
  const services = new Set<string>();

  for (const manifest of config.manifests) {
    const fullPath = path.join(config.dir, manifest);

    if (manifest === 'pubspec.yaml') {
      const data = await readYamlSafe(fullPath);
      if (data) {
        stack.add('dart-flutter');
        const deps = data.dependencies as Record<string, unknown> | undefined;
        if (deps) {
          console.log(`  Found pubspec.yaml with ${Object.keys(deps).length} dependencies`);
        }
      }
    } else if (manifest.endsWith('package.json')) {
      const data = await readJsonSafe(fullPath);
      if (data) {
        const allDeps = {
          ...(data.dependencies as Record<string, string> || {}),
          ...(data.devDependencies as Record<string, string> || {}),
        };
        console.log(`  Found ${manifest} with ${Object.keys(allDeps).length} dependencies`);

        for (const dep of Object.keys(allDeps)) {
          if (DEP_TO_STACK[dep]) stack.add(DEP_TO_STACK[dep]);
          if (DEP_TO_SERVICE[dep]) services.add(DEP_TO_SERVICE[dep]);
        }

        // Infer TypeScript from tsconfig or TS deps
        if (allDeps.typescript || allDeps['@types/node']) stack.add('typescript');
        if (allDeps.react) stack.add('react');
      }
    } else if (manifest === 'netlify.toml' || manifest.endsWith('netlify.toml')) {
      try {
        await fs.access(fullPath);
        deployTarget.add('netlify');
        console.log(`  Found ${manifest}`);
      } catch { /* skip */ }
    } else if (manifest.endsWith('manifest.json')) {
      const data = await readJsonSafe(fullPath);
      if (data && data.manifest_version) {
        platform.add('browser-extension');
        deployTarget.add('chrome-web-store');
        deployTarget.add('firefox-addons');
        console.log(`  Found browser extension manifest (v${data.manifest_version})`);
      }
    }
  }

  // Check for Flutter -> multi-platform
  if (stack.has('dart-flutter')) {
    platform.add('web');
    platform.add('ios');
    platform.add('android');
    deployTarget.add('apple-app-store');
    deployTarget.add('google-play');
  }

  // Check for MCP server
  if (config.name === 'code-wiki') {
    platform.add('web');
    platform.add('mcp-server');
    domain.add('developer-tools');
    domain.add('knowledge-management');
    services.add('github-api');
    services.add('netlify-api');
  }

  // Infer web platform from React/Vite
  if (stack.has('react') || stack.has('vite')) {
    platform.add('web');
  }

  // Manual domain hints based on known project purposes
  const domainHints: Record<string, string[]> = {
    WeirdChess: ['games', 'ai-tooling'],
    QuantumRetriever: ['ai-tooling'],
    TrollJar: ['social-impact'],
    NeoGeoSeo: ['seo'],
  };
  if (domainHints[config.name]) {
    for (const d of domainHints[config.name]) domain.add(d);
  }

  // Manual service hints
  const serviceHints: Record<string, string[]> = {
    WeirdChess: ['stockfish'],
  };
  if (serviceHints[config.name]) {
    for (const s of serviceHints[config.name]) services.add(s);
  }

  // Output proposed frontmatter
  const taxonomy = {
    type: 'project',
    stack: [...stack].sort(),
    platform: [...platform].sort(),
    deployTarget: [...deployTarget].sort(),
    domain: [...domain].sort(),
    visibility: 'public', // All 5 v1 projects are public repos
    lifecycle: 'shipped',  // Default; review per project
    dependsOn: [...services].sort(),
  };

  console.log(`\nProposed frontmatter for wiki entry:\n`);
  console.log('```yaml');
  console.log('taxonomy:');
  console.log(`  type: ${taxonomy.type}`);
  console.log(`  stack: [${taxonomy.stack.join(', ')}]`);
  console.log(`  platform: [${taxonomy.platform.join(', ')}]`);
  console.log(`  deployTarget: [${taxonomy.deployTarget.join(', ')}]`);
  console.log(`  domain: [${taxonomy.domain.join(', ')}]`);
  console.log(`  visibility: ${taxonomy.visibility}`);
  console.log(`  lifecycle: ${taxonomy.lifecycle}`);
  if (taxonomy.dependsOn.length > 0) {
    console.log(`  dependsOn: [${taxonomy.dependsOn.join(', ')}]`);
  }
  console.log('```');
}

async function main(): Promise<void> {
  console.log('Taxonomy Inference Script — v1 Projects');
  console.log('========================================');
  console.log('Review each proposal and adjust before adding to wiki entries.\n');

  for (const project of PROJECTS) {
    await inferProject(project);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Done. Review proposals above and add to wiki/projects/ entries.');
}

main().catch(console.error);
