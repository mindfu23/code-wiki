// The project-status registry sets lifecycle (e.g. dormant) without a wiki page, and wins over page frontmatter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectStatus, statusFor } from '../dist/utils/projectStatus.js';
import { handleSearchTaxonomy } from '../dist/tools/searchTaxonomy.js';
import { handleListRepos } from '../dist/tools/listRepos.js';

const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const config = { wikiDirectory: path.join(fx, 'wiki'), privateWikiDirectory: path.join(fx, 'private-wiki') };

test('registry loads valid entries case-insensitively and drops unknown values', () => {
  const m = loadProjectStatus(config);
  assert.deepEqual(statusFor(m, 'privatewidgetapp'), { lifecycle: 'dormant', since: '2026-10-31', note: 'Paused' });
  assert.equal(statusFor(m, 'BadApp'), undefined);
});

test('no private wiki means an empty registry', () => {
  assert.equal(loadProjectStatus({ wikiDirectory: config.wikiDirectory }).size, 0);
});

test('find_dependents reports the registry lifecycle over page frontmatter', async () => {
  const out = JSON.parse(await handleSearchTaxonomy({ action: 'find_dependents', query: 'widget-api' }, config));
  const priv = out.dependent_projects.find(d => d.title === 'PrivateWidgetApp');
  assert.equal(priv.lifecycle, 'dormant');
});

test('list_repos attaches status and filters by lifecycle', async () => {
  const repo = (name) => ({ name, description: '', languages: [], fileCount: 1, lastCommitDate: '', hasReadme: true, remoteUrl: '', lastIndexed: new Date().toISOString() });
  const indexService = { getAllRepos: () => [repo('PrivateWidgetApp'), repo('LiveApp')] };
  const all = JSON.parse(await handleListRepos({}, indexService, config));
  assert.equal(all.repos.find(r => r.name === 'PrivateWidgetApp').status.lifecycle, 'dormant');
  assert.equal(all.repos.find(r => r.name === 'LiveApp').status, undefined);
  const dormant = JSON.parse(await handleListRepos({ lifecycle: 'dormant' }, indexService, config));
  assert.deepEqual(dormant.repos.map(r => r.name), ['PrivateWidgetApp']);
  const active = JSON.parse(await handleListRepos({ excludeLifecycle: ['dormant'] }, indexService, config));
  assert.deepEqual(active.repos.map(r => r.name), ['LiveApp']);
});
