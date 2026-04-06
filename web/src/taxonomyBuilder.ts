/**
 * Taxonomy builder — compiles source YAML/Markdown into JSON outputs.
 * Run via: npm run build:taxonomy
 *
 * Reads wiki/_taxonomy/ (schema, terms, relationships) and inline edges
 * from wiki/ content frontmatter. Produces two JSON outputs:
 *   - taxonomy.json       (public, visibility-filtered)
 *   - taxonomy-full.json  (complete, including private content)
 *
 * Mirror parsing logic exists in web/src/taxonomyValidator.ts — keep in sync.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import {
  TaxonomySchema,
  TaxonomyTerm,
  TaxonomyEdge,
  EdgeType,
  ContentTaxonomy,
  TaxonomyIndex,
  ContentTagRecord,
} from './taxonomyTypes.js';

// ---------------------------------------------------------------------------
// Parsing helpers (shared structure with validator — keep in sync)
// ---------------------------------------------------------------------------

async function loadSchema(taxonomyDir: string): Promise<TaxonomySchema> {
  const raw = await fs.readFile(path.join(taxonomyDir, 'schema.yml'), 'utf-8');
  return yaml.load(raw) as TaxonomySchema;
}

async function loadTerms(termsDir: string): Promise<TaxonomyTerm[]> {
  const entries = await fs.readdir(termsDir, { withFileTypes: true });
  const terms: TaxonomyTerm[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(termsDir, entry.name);
    const raw = await fs.readFile(filePath, 'utf-8');
    const { data } = matter(raw);
    terms.push(data as TaxonomyTerm);
  }

  return terms;
}

async function loadRelationships(filePath: string): Promise<TaxonomyEdge[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = yaml.load(raw) as { edges?: TaxonomyEdge[] };
    return (parsed?.edges ?? []).map(e => ({
      source: e.source,
      target: e.target,
      type: e.type as EdgeType,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scan wiki content for inline edges and taxonomy frontmatter
// ---------------------------------------------------------------------------

async function scanContentFiles(wikiDir: string): Promise<{
  contentTags: ContentTagRecord[];
  inlineEdges: TaxonomyEdge[];
}> {
  const contentTags: ContentTagRecord[] = [];
  const inlineEdges: TaxonomyEdge[] = [];

  const categories = await fs.readdir(wikiDir, { withFileTypes: true });

  for (const cat of categories) {
    if (!cat.isDirectory() || cat.name.startsWith('_') || cat.name.startsWith('.')) continue;
    const catDir = path.join(wikiDir, cat.name);

    let files;
    try {
      files = await fs.readdir(catDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md') || file.name.startsWith('_')) continue;
      const filePath = path.join(catDir, file.name);
      const raw = await fs.readFile(filePath, 'utf-8');
      const { data } = matter(raw);
      const relPath = `${cat.name}/${file.name}`;

      if (!data.taxonomy) continue;

      const tax = data.taxonomy as ContentTaxonomy;
      contentTags.push({
        path: relPath,
        title: (data.title as string) || file.name.replace('.md', ''),
        taxonomy: tax,
      });

      // Extract inline edges
      if (tax.dependsOn) {
        for (const target of tax.dependsOn) {
          inlineEdges.push({ source: relPath, target, type: 'dependsOn' });
        }
      }
      if (tax.usesModule) {
        for (const target of tax.usesModule) {
          inlineEdges.push({ source: relPath, target, type: 'usesModule' });
        }
      }
      if (tax.appliesTo) {
        for (const target of tax.appliesTo) {
          inlineEdges.push({ source: relPath, target, type: 'appliesTo' });
        }
      }
    }
  }

  return { contentTags, inlineEdges };
}

// ---------------------------------------------------------------------------
// Edge computation
// ---------------------------------------------------------------------------

function computeInverseEdges(edges: TaxonomyEdge[]): TaxonomyEdge[] {
  const inverses: TaxonomyEdge[] = [];

  for (const edge of edges) {
    // Symmetric edges (related) get a reverse copy
    if (edge.type === 'related') {
      inverses.push({ source: edge.target, target: edge.source, type: 'related' });
    }
    // Directional edges: build can compute "used by" from "uses" at query time
    // We don't store inverses for directional edges — they're computed on read
  }

  return inverses;
}

// ---------------------------------------------------------------------------
// Visibility filtering
// ---------------------------------------------------------------------------

function filterPublic(index: TaxonomyIndex): TaxonomyIndex {
  const publicTags = index.contentTags.filter(
    ct => !ct.taxonomy.visibility || ct.taxonomy.visibility === 'public'
  );
  const publicPaths = new Set(publicTags.map(ct => ct.path));

  // Keep edges that don't reference private content paths
  const publicEdges = index.edges.filter(e => {
    // Structural edges (term-to-term) are always public
    if (!e.source.includes('/') && !e.target.includes('/')) return true;
    // Inline edges: only keep if the content file is public
    if (e.source.includes('/') && !publicPaths.has(e.source)) return false;
    if (e.target.includes('/') && !publicPaths.has(e.target)) return false;
    return true;
  });

  return {
    ...index,
    contentTags: publicTags,
    edges: publicEdges,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function buildTaxonomy(): Promise<void> {
  const wikiDir = path.resolve(process.cwd(), '../wiki');
  const taxonomyDir = path.join(wikiDir, '_taxonomy');
  const termsDir = path.join(taxonomyDir, 'terms');
  const outputDir = path.resolve(process.cwd(), 'public/data');

  console.log('Building taxonomy...');

  // Load sources
  const schema = await loadSchema(taxonomyDir);
  const terms = await loadTerms(termsDir);
  const structuralEdges = await loadRelationships(path.join(taxonomyDir, 'relationships.yml'));
  const { contentTags, inlineEdges } = await scanContentFiles(wikiDir);

  // Combine edges + compute inverses
  const allEdges = [
    ...structuralEdges,
    ...inlineEdges,
    ...computeInverseEdges(structuralEdges),
  ];

  // Build facet index (facet name -> active term IDs)
  const facets: Record<string, string[]> = {};
  for (const [name] of Object.entries(schema.facets)) {
    facets[name] = terms
      .filter(t => t.facet === name && t.curationState === 'active')
      .map(t => t.term);
  }

  const fullIndex: TaxonomyIndex = {
    schemaVersion: schema.schemaVersion,
    terms: terms.filter(t => t.curationState === 'active'),
    edges: allEdges,
    facets,
    contentTags,
    buildTime: new Date().toISOString(),
  };

  const publicIndex = filterPublic(fullIndex);

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Write outputs
  await fs.writeFile(
    path.join(outputDir, 'taxonomy.json'),
    JSON.stringify(publicIndex, null, 2)
  );
  await fs.writeFile(
    path.join(outputDir, 'taxonomy-full.json'),
    JSON.stringify(fullIndex, null, 2)
  );

  console.log(`Taxonomy built:`);
  console.log(`  ${terms.length} terms (${terms.filter(t => t.curationState === 'active').length} active)`);
  console.log(`  ${allEdges.length} edges`);
  console.log(`  ${contentTags.length} tagged content files`);
  console.log(`  Output: ${outputDir}/taxonomy.json, taxonomy-full.json`);
}

buildTaxonomy().catch((err) => {
  console.error('Taxonomy build failed:', err);
  process.exit(1);
});
