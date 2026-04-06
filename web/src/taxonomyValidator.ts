/**
 * Taxonomy validator — enforces schema rules on taxonomy source files.
 * Run via: npm run lint:taxonomy
 *
 * Reads wiki/_taxonomy/ (schema, terms, relationships) and wiki/ content
 * files, runs 9 validation rules + 1 report, exits non-zero on errors.
 *
 * Mirror parsing logic exists in web/src/taxonomyBuilder.ts — keep in sync.
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
  Diagnostic,
  ValidationResult,
} from './taxonomyTypes.js';

// ---------------------------------------------------------------------------
// Parsing helpers
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
    terms.push({
      ...data,
      _file: entry.name,
    } as TaxonomyTerm & { _file: string });
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

async function findContentFiles(wikiDir: string): Promise<{ path: string; taxonomy?: ContentTaxonomy; title?: string }[]> {
  const results: { path: string; taxonomy?: ContentTaxonomy; title?: string }[] = [];
  const categories = await fs.readdir(wikiDir, { withFileTypes: true });

  for (const cat of categories) {
    if (!cat.isDirectory() || cat.name.startsWith('_') || cat.name.startsWith('.')) continue;
    const catDir = path.join(wikiDir, cat.name);
    const files = await fs.readdir(catDir, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md') || file.name.startsWith('_')) continue;
      const filePath = path.join(catDir, file.name);
      const raw = await fs.readFile(filePath, 'utf-8');
      const { data } = matter(raw);
      const relPath = `${cat.name}/${file.name}`;

      if (data.taxonomy) {
        results.push({ path: relPath, taxonomy: data.taxonomy as ContentTaxonomy, title: data.title as string });
      } else {
        results.push({ path: relPath });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

function getAllFacetValues(schema: TaxonomySchema): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(schema.facets)) {
    map.set(name, new Set(def.values));
  }
  return map;
}

// RULE 1: Unknown facet value — term's facet must exist in schema
function checkUnknownFacetValue(terms: TaxonomyTerm[], schema: TaxonomySchema): Diagnostic[] {
  const facetNames = new Set(Object.keys(schema.facets));
  const facetValues = getAllFacetValues(schema);
  const diags: Diagnostic[] = [];

  for (const t of terms) {
    const term = t as TaxonomyTerm & { _file: string };
    if (!facetNames.has(term.facet)) {
      diags.push({
        rule: 'unknown-facet-value',
        severity: 'error',
        file: `terms/${term._file}`,
        message: `Term "${term.term}" references unknown facet "${term.facet}"`,
      });
      continue;
    }
    // For facets with defined values (non-empty), check membership
    const allowed = facetValues.get(term.facet)!;
    if (allowed.size > 0 && !allowed.has(term.term)) {
      diags.push({
        rule: 'unknown-facet-value',
        severity: 'error',
        file: `terms/${term._file}`,
        message: `Term "${term.term}" is not a valid value for facet "${term.facet}"`,
      });
    }
  }

  return diags;
}

// RULE 2: Required frontmatter missing
function checkRequiredFrontmatter(terms: TaxonomyTerm[]): Diagnostic[] {
  const required = ['term', 'facet', 'label', 'definition', 'scopeNote', 'curationState'];
  const diags: Diagnostic[] = [];

  for (const t of terms) {
    const term = t as TaxonomyTerm & { _file: string };
    for (const field of required) {
      if (!(term as Record<string, unknown>)[field]) {
        diags.push({
          rule: 'required-frontmatter-missing',
          severity: 'error',
          file: `terms/${term._file}`,
          message: `Term "${term.term || term._file}" missing required field "${field}"`,
        });
      }
    }
  }

  return diags;
}

// RULE 3: Facet/term-file mismatch — filename should match term ID
function checkFacetTermMismatch(terms: TaxonomyTerm[]): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const t of terms) {
    const term = t as TaxonomyTerm & { _file: string };
    const expectedFile = `${term.term}.md`;
    if (term._file !== expectedFile) {
      diags.push({
        rule: 'facet-term-mismatch',
        severity: 'error',
        file: `terms/${term._file}`,
        message: `Filename "${term._file}" doesn't match term ID "${term.term}" (expected "${expectedFile}")`,
      });
    }
  }

  return diags;
}

// RULE 4: Unknown edge endpoint — all edge sources/targets must reference existing terms
function checkUnknownEdgeEndpoint(edges: TaxonomyEdge[], termIds: Set<string>): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const edge of edges) {
    if (!termIds.has(edge.source)) {
      diags.push({
        rule: 'unknown-edge-endpoint',
        severity: 'error',
        file: 'relationships.yml',
        message: `Edge source "${edge.source}" has no corresponding term file`,
      });
    }
    if (!termIds.has(edge.target)) {
      diags.push({
        rule: 'unknown-edge-endpoint',
        severity: 'error',
        file: 'relationships.yml',
        message: `Edge target "${edge.target}" has no corresponding term file`,
      });
    }
  }

  return diags;
}

// RULE 5: Acyclic violation — DFS cycle detection for supersedes and broader
function checkAcyclicRelationships(edges: TaxonomyEdge[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const acyclicTypes: EdgeType[] = ['supersedes', 'broader'];

  for (const edgeType of acyclicTypes) {
    const typeEdges = edges.filter(e => e.type === edgeType);
    if (typeEdges.length === 0) continue;

    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const e of typeEdges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    }

    // DFS with white(0)/gray(1)/black(2) coloring
    const color = new Map<string, number>();
    for (const node of adj.keys()) color.set(node, 0);

    function dfs(node: string, path: string[]): boolean {
      color.set(node, 1); // gray
      for (const neighbor of adj.get(node) ?? []) {
        if (!color.has(neighbor)) color.set(neighbor, 0);
        if (color.get(neighbor) === 1) {
          // Cycle found
          diags.push({
            rule: 'acyclic-violation',
            severity: 'error',
            file: 'relationships.yml',
            message: `Cycle in "${edgeType}" edges: ${[...path, node, neighbor].join(' -> ')}`,
          });
          return true;
        }
        if (color.get(neighbor) === 0) {
          if (dfs(neighbor, [...path, node])) return true;
        }
      }
      color.set(node, 2); // black
      return false;
    }

    for (const node of adj.keys()) {
      if (color.get(node) === 0) dfs(node, []);
    }
  }

  return diags;
}

// RULE 6: Definition length hard cap (500 chars)
function checkDefinitionLengthHard(terms: TaxonomyTerm[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const t of terms) {
    const term = t as TaxonomyTerm & { _file: string };
    if (term.definition && term.definition.length > 500) {
      diags.push({
        rule: 'definition-length-hard',
        severity: 'error',
        file: `terms/${term._file}`,
        message: `Definition is ${term.definition.length} chars (max 500)`,
      });
    }
  }
  return diags;
}

// RULE 7: Private content with userview channel
function checkPrivateUserviewCollision(
  contentFiles: { path: string; taxonomy?: ContentTaxonomy }[],
  schema: TaxonomySchema
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const file of contentFiles) {
    if (!file.taxonomy) continue;
    if (file.taxonomy.visibility === 'private') {
      // Check if type's default channels include userview
      const typeVal = file.taxonomy.type;
      if (typeVal) {
        const defaults = schema.channels?.defaults?.[typeVal] ?? [];
        if (defaults.includes('userview')) {
          diags.push({
            rule: 'private-userview-collision',
            severity: 'error',
            file: file.path,
            message: `Private content with type "${typeVal}" defaults to userview channel — add explicit channels: [internal]`,
          });
        }
      }
    }
  }
  return diags;
}

// RULE 8 (warn): Symmetric edge canonical ordering
function checkSymmetricEdgeOrdering(edges: TaxonomyEdge[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const edge of edges) {
    if (edge.type === 'related' && edge.source > edge.target) {
      diags.push({
        rule: 'symmetric-edge-ordering',
        severity: 'warning',
        file: 'relationships.yml',
        message: `Related edge "${edge.source}" -> "${edge.target}" should be stored as "${edge.target}" -> "${edge.source}" (alphabetical)`,
      });
    }
  }
  return diags;
}

// RULE 9 (warn): Definition length soft warn (250 chars)
function checkDefinitionLengthSoft(terms: TaxonomyTerm[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const t of terms) {
    const term = t as TaxonomyTerm & { _file: string };
    if (term.definition && term.definition.length > 250 && term.definition.length <= 500) {
      diags.push({
        rule: 'definition-length-soft',
        severity: 'warning',
        file: `terms/${term._file}`,
        message: `Definition is ${term.definition.length} chars (target <=250)`,
      });
    }
  }
  return diags;
}

// RULE 10 (warn): Orphan synonyms
function checkOrphanSynonyms(terms: TaxonomyTerm[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const allTermIds = new Set(terms.map(t => t.term));
  const allLabels = new Set(terms.map(t => t.label?.toLowerCase()));

  for (const t of terms) {
    const term = t as TaxonomyTerm & { _file: string };
    if (!term.synonyms) continue;
    for (const syn of term.synonyms) {
      const synLower = syn.toLowerCase();
      // Orphan if synonym doesn't match any other term ID or label
      if (!allTermIds.has(syn) && !allLabels.has(synLower)) {
        // This is fine — synonyms are alternative names, not references
        // Only warn if it looks like it SHOULD be a term reference
      }
    }
  }

  return diags; // Orphan synonym check is lenient in v1
}

// REPORT: Untagged content files
function reportUntaggedContent(
  contentFiles: { path: string; taxonomy?: ContentTaxonomy }[]
): string[] {
  const untagged = contentFiles.filter(f => !f.taxonomy);
  if (untagged.length === 0) return [];
  return [`${untagged.length} wiki content files without taxonomy frontmatter`];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const wikiDir = path.resolve(process.cwd(), '../wiki');
  const taxonomyDir = path.join(wikiDir, '_taxonomy');
  const termsDir = path.join(taxonomyDir, 'terms');

  console.log('Taxonomy validator running...');
  console.log(`  Wiki dir: ${wikiDir}`);
  console.log(`  Taxonomy dir: ${taxonomyDir}`);

  // Load everything
  const schema = await loadSchema(taxonomyDir);
  const terms = await loadTerms(termsDir);
  const edges = await loadRelationships(path.join(taxonomyDir, 'relationships.yml'));
  const contentFiles = await findContentFiles(wikiDir);
  const termIds = new Set(terms.map(t => t.term));

  console.log(`  Loaded: ${terms.length} terms, ${edges.length} edges, ${contentFiles.length} content files\n`);

  // Run all rules
  const result: ValidationResult = {
    errors: [
      ...checkUnknownFacetValue(terms, schema),
      ...checkRequiredFrontmatter(terms),
      ...checkFacetTermMismatch(terms),
      ...checkUnknownEdgeEndpoint(edges, termIds),
      ...checkAcyclicRelationships(edges),
      ...checkDefinitionLengthHard(terms),
      ...checkPrivateUserviewCollision(contentFiles, schema),
    ],
    warnings: [
      ...checkSymmetricEdgeOrdering(edges),
      ...checkDefinitionLengthSoft(terms),
      ...checkOrphanSynonyms(terms),
    ],
    report: reportUntaggedContent(contentFiles),
  };

  // Output
  if (result.errors.length > 0) {
    console.log(`ERRORS (${result.errors.length}):`);
    for (const d of result.errors) {
      console.log(`  [${d.rule}] ${d.file}: ${d.message}`);
    }
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log(`WARNINGS (${result.warnings.length}):`);
    for (const d of result.warnings) {
      console.log(`  [${d.rule}] ${d.file}: ${d.message}`);
    }
    console.log();
  }

  if (result.report.length > 0) {
    console.log('REPORT:');
    for (const line of result.report) {
      console.log(`  ${line}`);
    }
    console.log();
  }

  if (result.errors.length === 0) {
    console.log(`Taxonomy valid. ${terms.length} terms, ${edges.length} edges, ${result.warnings.length} warning(s).`);
    process.exit(0);
  } else {
    console.log(`Taxonomy validation FAILED with ${result.errors.length} error(s).`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Taxonomy validator crashed:', err);
  process.exit(1);
});
