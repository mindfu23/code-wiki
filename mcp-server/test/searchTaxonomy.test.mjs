// find_dependents must see project records in both the public wiki and the private content wiki.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSearchTaxonomy } from '../dist/tools/searchTaxonomy.js';

const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const deps = async (config) =>
  JSON.parse(await handleSearchTaxonomy({ action: 'find_dependents', query: 'widget-api' }, config))
    .dependent_projects.map(d => d.title).sort();

test('find_dependents reads public and private project records', async () => {
  assert.deepEqual(await deps({ wikiDirectory: path.join(fx, 'wiki') }), ['PublicWidgetApp']);
  assert.deepEqual(
    await deps({ wikiDirectory: path.join(fx, 'wiki'), privateWikiDirectory: path.join(fx, 'private-wiki') }),
    ['PrivateWidgetApp', 'PublicWidgetApp'],
  );
});

test('a missing private wiki falls back to public records', async () => {
  assert.deepEqual(
    await deps({ wikiDirectory: path.join(fx, 'wiki'), privateWikiDirectory: path.join(fx, 'does-not-exist') }),
    ['PublicWidgetApp'],
  );
});
