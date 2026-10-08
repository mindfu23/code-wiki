// Run: npm test   (builds, then node --test). Uses only fake fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, 'fixtures');
process.env.CODE_WIKI_KNOWLEDGE_DIRS = path.join(fx, 'knowledge');
const { handleRecall } = await import('../dist/tools/recall.js');
const config = { wikiDirectory: path.join(fx, 'wiki'), privateWikiDirectory: '' };
const recall = async (args) => JSON.parse(await handleRecall(args, config));

test('ranks the matching knowledge note first, with age from verified', async () => {
  const r = await recall({ query: 'ran netlify deploy --dir=dist and the VITE_ values are undefined' });
  assert.equal(r.results[0].source, 'knowledge');
  assert.match(r.results[0].path, /example_deploy_rebuild_note\.md$/);
  assert.equal(r.results[0].verified, '2026-09-01');
  assert.equal(typeof r.results[0].ageDays, 'number');
});

test('literal symptom string matches', async () => {
  const r = await recall({ query: "error: 'owner subscription required'" });
  assert.match(r.results[0].path, /example_widget_api_403\.md$/);
});

test('searches wiki and taxonomy terms; sources filter applies; index files skipped', async () => {
  const wiki = await recall({ query: 'retry flaky HTTP calls with backoff' });
  assert.equal(wiki.results[0].source, 'wiki');
  const term = await recall({ query: 'widget api service', sources: ['taxonomy'] });
  assert.ok(term.results.length >= 1 && term.results.every(x => x.source === 'taxonomy'));
  const all = await recall({ query: 'netlify widget 403 deploy', limit: 15 });
  assert.ok(all.results.every(x => !x.path.endsWith('INDEX.md')));
});

test('no match returns a hint, not an error', async () => {
  const r = await recall({ query: 'roman aqueduct masonry techniques' });
  assert.equal(r.results.length, 0);
  assert.ok(r.hint);
});

test('web build never reads the local knowledge store', () => {
  const repo = path.resolve(here, '..', '..');
  const out = spawnSync('git', ['-C', repo, 'grep', '-l', 'CODE_WIKI_KNOWLEDGE_DIRS', '--', 'web/'], { encoding: 'utf-8' });
  assert.equal(out.stdout.trim(), '', `web/ must not reference CODE_WIKI_KNOWLEDGE_DIRS:\n${out.stdout}`);
});

test('scoring matches the Python hook on the same notes (keep in sync)', async (t) => {
  const py = path.resolve(here, '..', '..', 'integrations', 'claude-code', 'hooks', 'recall_hint.py');
  const q = 'ran netlify deploy --dir=dist and the VITE_ values are undefined';
  let out;
  try {
    out = execFileSync('python3', [py, '--query', q], { encoding: 'utf-8', env: { ...process.env } });
  } catch {
    t.skip('python3 not available');
    return;
  }
  const pyTop = out.trim().split('\n')[0].trim().split(/\s+/);
  const ts = await recall({ query: q, sources: ['knowledge'] });
  assert.equal(path.basename(ts.results[0].path), pyTop[1]);
  assert.equal(ts.results[0].score, Number(pyTop[0]));
});
