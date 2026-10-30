// Dependency report parsers and rendering (web/src/dependencyParsers.ts,
// web/src/buildDependencyReport.ts, the Dependencies section in buildStatusDigest.ts).
// Run: npx tsx --test scripts/tests/dependencies.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickManifests, parsePackageJson, parsePackageLock, parsePubspec, parsePubspecLock,
  parseRequirementsTxt, parsePyproject, parseGoMod, goModPackages, parseCargoToml,
  parseTomlPackageLock, parseManifest, updateStatus,
} from '../../web/src/dependencyParsers.js';
import { applyCache, toAdvisory, pickFixed, shouldScan, type ScanCache } from '../../web/src/buildDependencyReport.js';
import { renderDependencies, summarizeDeps } from '../../web/src/buildStatusDigest.js';
import { findModels } from '../../web/src/codeScan.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

test('pickManifests finds nested surfaces, pairs lockfiles and skips vendored trees', () => {
  const { manifests, unparsed } = pickManifests([
    'package.json', 'package-lock.json', 'netlify/functions/requirements.txt',
    'mobile/package.json', 'node_modules/react/package.json', 'examples/demo/package.json',
    'a/b/c/package.json', 'android/app/build.gradle.kts', 'pubspec.yaml', 'pubspec.lock',
  ]);
  assert.deepEqual(manifests.map(m => [m.path, m.lockfile]), [
    ['package.json', 'package-lock.json'],
    ['pubspec.yaml', 'pubspec.lock'],
    ['mobile/package.json', null],
    ['netlify/functions/requirements.txt', null],
  ]);
  assert.deepEqual(unparsed, ['android/app/build.gradle.kts']);
});

test('package.json + lockfile v3: direct deps get installed versions; transitive go to the scan list', () => {
  const pkg = JSON.stringify({
    dependencies: { react: '^18.2.0', mylib: 'github:me/mylib', local: 'file:../x' },
    devDependencies: { typescript: '5.3.3' },
  });
  const lock = JSON.stringify({ lockfileVersion: 3, packages: {
    '': { name: 'app' },
    'node_modules/react': { version: '18.3.1' },
    'node_modules/typescript': { version: '5.3.3' },
    'node_modules/loose-envify': { version: '1.4.0' },
    'node_modules/a/node_modules/react': { version: '17.0.0' },
    'node_modules/linked': { link: true },
  } });
  const { deps, locked } = parseManifest('package.json', pkg, lock);
  const react = deps.find(d => d.name === 'react')!;
  assert.equal(react.installed, '18.3.1');
  assert.equal(deps.find(d => d.name === 'mylib')!.declared, null);
  assert.equal(deps.find(d => d.name === 'typescript')!.dev, true);
  assert.equal(locked.length, 4);
  assert.ok(locked.some(p => p.name === 'react' && p.version === '17.0.0'));
});

test('package-lock v1 nested dependencies are walked', () => {
  const lock = parsePackageLock(JSON.stringify({ lockfileVersion: 1, dependencies: {
    a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } },
  } }));
  assert.equal(lock.get('a'), '1.0.0');
  assert.equal(lock.get('b'), undefined);
  assert.equal(lock.all.length, 2);
  assert.deepEqual(parsePackageJson('{"dependencies":{"x":"npm:y@1.0.0"}}')[0].declared, 'npm:y@1.0.0');
});

test('pubspec skips sdk/git/path deps and takes versions from pubspec.lock', () => {
  const spec = `
name: app
environment:
  sdk: ^3.0.0
dependencies:
  flutter:
    sdk: flutter
  riverpod: ^3.1.0
  local_pkg:
    path: ../local
  hosted_map:
    version: ^1.2.0
dev_dependencies:
  flutter_lints: ^5.0.0
`;
  const lock = `
packages:
  riverpod:
    dependency: "direct main"
    source: hosted
    version: "3.1.2"
  flutter:
    dependency: "direct main"
    source: sdk
    version: "0.0.0"
  meta:
    dependency: transitive
    source: hosted
    version: "1.16.0"
`;
  const deps = parsePubspec(spec);
  assert.deepEqual(deps.map(d => d.name), ['riverpod', 'hosted_map', 'flutter_lints']);
  const { deps: merged, locked } = parseManifest('pubspec.yaml', spec, lock);
  assert.equal(merged[0].installed, '3.1.2');
  assert.deepEqual(locked.map(p => p.name), ['riverpod', 'meta']);
  assert.equal(parsePubspecLock(lock).get('flutter'), undefined);
});

test('requirements.txt: pins, ranges, extras, markers, comments and options', () => {
  const deps = parseRequirementsTxt([
    '# comment', '-r base.txt', 'requests==2.31.0', 'Flask>=2.0  # web', 'uvicorn[standard]==0.29.0; python_version>"3.8"',
    'git+https://github.com/x/y', 'huggingface_hub', '',
  ].join('\n'));
  assert.deepEqual(deps.map(d => [d.name, d.declared, d.installed]), [
    ['requests', '==2.31.0', '2.31.0'],
    ['flask', '>=2.0', null],
    ['uvicorn', '==0.29.0', '0.29.0'],
    ['huggingface-hub', null, null],
  ]);
});

test('pyproject: PEP 621 list and Poetry tables, with poetry.lock versions', () => {
  const pep = `[project]\nname = "x"\ndependencies = [\n  "fastapi>=0.110",\n  "pydantic==2.6.0",\n]\n\n[tool.ruff]\nline-length = 100\n`;
  assert.deepEqual(parsePyproject(pep).map(d => d.name), ['fastapi', 'pydantic']);
  const poetry = `[tool.poetry.dependencies]\npython = "^3.11"\nhttpx = "^0.27"\nlangchain = { version = "0.2.1", extras = ["x"] }\nmine = { path = "../mine" }\n\n[tool.poetry.group.dev.dependencies]\npytest = "^8"\n`;
  const lock = `[[package]]\nname = "httpx"\nversion = "0.27.2"\n\n[[package]]\nname = "anyio"\nversion = "4.4.0"\n`;
  const { deps, locked } = parseManifest('pyproject.toml', poetry, lock);
  assert.deepEqual(deps.map(d => [d.name, d.installed, d.dev]), [
    ['httpx', '0.27.2', false], ['langchain', '0.2.1', false], ['pytest', null, true],
  ]);
  assert.equal(locked.length, 2);
});

test('go.mod: direct requires only, but every require is scanned', () => {
  const mod = `module github.com/me/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/net v0.20.0 // indirect\n)\n\nrequire github.com/BurntSushi/toml v1.3.2\n`;
  assert.deepEqual(parseGoMod(mod).map(d => d.name), ['github.com/gin-gonic/gin', 'github.com/BurntSushi/toml']);
  assert.equal(goModPackages(mod).length, 3);
});

test('Cargo.toml + Cargo.lock: registry packages only', () => {
  const toml = `[package]\nname = "x"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\ntokio = "1"\nlocal = { path = "../l" }\n\n[dev-dependencies]\ninsta = "1.34"\n`;
  assert.deepEqual(parseCargoToml(toml).map(d => [d.name, d.dev]), [['serde', false], ['tokio', false], ['insta', true]]);
  const lock = `[[package]]\nname = "x"\nversion = "0.1.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;
  assert.deepEqual([...parseTomlPackageLock(lock, 'crates.io').entries()], [['serde', '1.0.200']]);
});

test('updateStatus: major, minor, patch, 0.x minor counts as major, ahead counts as current', () => {
  assert.equal(updateStatus({ declared: '^18.2.0', installed: '18.3.1' }, '19.0.0'), 'major');
  assert.equal(updateStatus({ declared: '^18.2.0', installed: '18.3.1' }, '18.4.0'), 'minor');
  assert.equal(updateStatus({ declared: '^18.2.0', installed: '18.3.1' }, '18.3.2'), 'patch');
  assert.equal(updateStatus({ declared: '^0.27', installed: null }, '0.28.0'), 'major');
  assert.equal(updateStatus({ declared: '2.0.0', installed: '2.1.0' }, '2.0.5'), 'current');
  assert.equal(updateStatus({ declared: '*', installed: null }, '1.0.0'), 'unknown');
  assert.equal(updateStatus({ declared: 'v1.9.1', installed: 'v1.9.1' }, 'v1.10.0'), 'minor');
});

test('toAdvisory and pickFixed read OSV records', () => {
  const adv = toAdvisory({
    id: 'GHSA-xxxx', summary: 'Prototype pollution\nmore', aliases: ['CVE-2020-1'],
    database_specific: { severity: 'HIGH' },
    affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }],
  });
  assert.equal(adv.severity, 'HIGH');
  assert.equal(adv.summary, 'Prototype pollution');
  assert.deepEqual(adv.fixed, { 'npm:lodash': ['4.17.21'] });
  assert.equal(pickFixed(['3.0.1', '4.17.21', '4.17.12'], '4.17.15'), '4.17.21');
  assert.equal(pickFixed(undefined, '1.0.0'), null);
});

test('applyCache marks findings, direct vs transitive, and versions the scan has not seen', () => {
  const cache: ScanCache = {
    version: 1, scannedAt: '2026-11-02T00:00:00Z',
    latest: { 'npm:lodash': '4.17.21', 'npm:react': '19.0.0' },
    scanned: ['npm:lodash@4.17.15', 'npm:react@18.3.1'],
    vulnerable: { 'npm:lodash@4.17.15': ['GHSA-xxxx'] },
    advisories: { 'GHSA-xxxx': { summary: 'Prototype pollution', severity: 'HIGH', aliases: ['CVE-2020-1'], fixed: { 'npm:lodash': ['4.17.21'] } } },
  };
  const r = applyCache({
    base: { repo: 'App', languages: ['TypeScript'], stack: ['react'], services: ['openai-api'], models: ['gpt-4o-mini'], codeScanned: true, manifests: [], unparsed: [], dependabotOpenPrs: 2, vulns: [], locked: 0, unscanned: 0, failed: false },
    rawDeps: [{ path: 'package.json', ecosystem: 'npm', lockfile: 'package-lock.json', deps: [
      { ecosystem: 'npm', name: 'react', declared: '^18.2.0', installed: '18.3.1', dev: false },
    ] }],
    locked: [
      { ecosystem: 'npm', name: 'react', version: '18.3.1' },
      { ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
      { ecosystem: 'npm', name: 'new-thing', version: '1.0.0' },
    ],
    directKeys: new Set(['npm:react@18.3.1']),
  }, cache);
  assert.equal(r.manifests[0].deps[0].status, 'major');
  assert.equal(r.vulns.length, 1);
  assert.deepEqual([r.vulns[0].fixed, r.vulns[0].direct], ['4.17.21', false]);
  assert.deepEqual([r.locked, r.unscanned], [3, 1]);
  assert.deepEqual(summarizeDeps(r), { direct: 1, majorsBehind: 1, vulns: 1, serious: 1, directVulns: 0, vulnPackages: 1, seriousPackages: 1 });

  const md = renderDependencies(r, cache.scannedAt, 'https://github.com/me/App').join('\n');
  assert.match(md, /1 vulnerable packages, 1 with a high or critical advisory \(1 advisories in all, 1 high or critical, 0 in direct dependencies\)/);
  assert.match(md, /\| lodash \| 4\.17\.15 \| high \| GHSA-xxxx \(CVE-2020-1\): Prototype pollution \| 4\.17\.21 \| no \|/);
  assert.match(md, /\| react \| \^18\.2\.0 \| 18\.3\.1 \| 19\.0\.0 \| \*\*major behind\*\* \|/);
  assert.match(md, /2 open Dependabot PRs/);
  assert.match(md, /- APIs and services: openai-api\n- AI models in code: gpt-4o-mini/);
});

test('shouldScan: weekly in auto mode, forced and disabled modes', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const cache = { scannedAt: '2026-11-02T00:00:00Z' } as ScanCache;
  assert.equal(shouldScan('auto', null, now), true);
  assert.equal(shouldScan('auto', cache, now), true);
  assert.equal(shouldScan('auto', { scannedAt: '2026-11-08T00:00:00Z' } as ScanCache, now), false);
  assert.equal(shouldScan('never', null, now), false);
  assert.equal(shouldScan('always', cache, now), true);
  // A scan with failed OSV batches is retried the next night, not a week later.
  assert.equal(shouldScan('auto', { scannedAt: '2026-11-08T00:00:00Z', incomplete: true } as ScanCache, now), true);
});

test('findModels picks model IDs out of source, skips docs, lockfiles and package paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'models-'));
  const files: Record<string, string> = {
    'src/ai.ts': [
      "const MODEL = 'gemini-2.0-flash';",
      "await openai.chat.completions.create({ model: \"gpt-4o-mini\" });",
      "import { GoogleGenAI } from '@google/genai';",
      "import Anthropic from '@anthropic-ai/sdk'; const m = `claude-sonnet-4-5`;",
      "const r = { model: 'o3-mini' }; // and the word sonar alone",
      "hf('ProsusAI/finbert'); hf('meta-llama/Llama-3.1-8B-Instruct');",
      "const pplx = 'sonar-pro'; const x = 'claude-code'; fetch('/.netlify/functions/gemini-proxy');",
      "const base = 'https://api.groq.com/openai/v1';",
    ].join('\n'),
    'functions/x.py': 'client.models.generate_content(model="gemini-1.5-pro-002")\n',
    'README.md': 'We tried gpt-3.5-turbo once.\n',
    'package-lock.json': '{"gpt-4-should-not-count": 1}\n',
    'tests/ai.test.ts': "const fixture = 'gpt-4.1-nano';\n",
  };
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', '.']);
  assert.deepEqual(findModels(dir), [
    'claude-sonnet-4-5', 'gemini-1.5-pro-002', 'gemini-2.0-flash', 'gpt-4o-mini',
    'meta-llama/llama-3.1-8b-instruct', 'o3-mini', 'prosusai/finbert', 'sonar-pro',
  ]);
  assert.deepEqual(findModels(join(dir, 'missing')), []);
});
