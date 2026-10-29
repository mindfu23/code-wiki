// Leak gate (web/src/checkPublicOutputs.ts) and status digest helpers (web/src/buildStatusDigest.ts).
// Run: npx tsx --test scripts/tests/privacyAndDigest.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateSetFrom, scan } from '../../web/src/checkPublicOutputs.js';
import { nestMarkdown, pickStatusFiles } from '../../web/src/buildStatusDigest.js';
import type { RepoInfo, WikiIndex } from '../../web/src/types.js';

const SECRET_BODY = 'Private roadmap. '.repeat(20);
const full = {
  repos: [
    { name: 'SecretApp', visibility: 'private', languages: [], status: 'github-only' },
    { name: 'OpenApp', visibility: 'public', languages: [], status: 'github-only' },
  ],
  documents: [
    { relativePath: 'projects/secret-app.md', visibility: 'private', content: SECRET_BODY },
    { relativePath: 'README.md', visibility: 'private', content: 'short' },
  ],
  categories: [], buildTime: '', version: '1',
} as unknown as WikiIndex;
const priv = privateSetFrom(full);
const kinds = (v: unknown) => Object.fromEntries(scan(v, priv).hits);

test('clean public output passes', () => {
  assert.deepEqual(kinds({ repos: [{ name: 'OpenApp', githubUrl: 'https://github.com/me/OpenApp' }] }), {});
});

test('private repo name is caught as a value, case-insensitively, and inside a GitHub URL', () => {
  assert.equal(kinds({ name: 'secretapp' })['repo name'], 1);
  assert.equal(kinds({ url: 'https://github.com/me/SecretApp.git' })['repo name'], 1);
});

test('a name inside prose is not a match (exact values only)', () => {
  assert.deepEqual(kinds({ content: 'We compared SecretApp-style flows.' }), {});
});

test('private doc path and body are caught; repo file listings are not doc paths', () => {
  assert.equal(kinds({ documents: [{ relativePath: 'projects/secret-app.md' }] })['doc path'], 1);
  assert.equal(kinds({ documents: [{ relativePath: 'x.md', content: SECRET_BODY }] })['doc body'], 1);
  assert.deepEqual(kinds({ repos: [{ markdownFiles: [{ relativePath: 'README.md' }] }] }), {});
});

test('home paths are caught except the Actions runner checkout', () => {
  // Built at runtime so the hygiene check (no literal home paths in this repo) stays clean.
  const home = (...parts: string[]) => '/' + parts.join('/');
  assert.equal(kinds({ path: home('Users', 'someone', 'code', 'x.md') })['home path'], 1);
  assert.deepEqual(kinds({ path: home('home', 'runner', 'work', 'code-wiki', 'x.md') }), {});
});

test('nestMarkdown demotes headings, caps at h6 and closes a fence cut by truncation', () => {
  assert.equal(nestMarkdown('# A\n#### B\n##### C'), '### A\n###### B\n###### C');
  assert.equal(nestMarkdown('```\n# not a heading\n```'), '```\n# not a heading\n```');
  assert.equal(nestMarkdown('intro\n~~~js\ncode'), 'intro\n~~~js\ncode\n~~~');
});

test('pickStatusFiles prefers exact names over prefixed variants', () => {
  const repo = { markdownFiles: ['HANDOFF-old.md', 'HANDOFF-older.md', 'HANDOFF.md', 'TODO.md', 'README.md', 'notes/ROADMAP.md']
    .map(relativePath => ({ relativePath, name: relativePath, fileType: 'md' })) } as unknown as RepoInfo;
  assert.deepEqual(pickStatusFiles(repo), ['TODO.md', 'notes/ROADMAP.md', 'HANDOFF.md', 'HANDOFF-old.md']);
});
