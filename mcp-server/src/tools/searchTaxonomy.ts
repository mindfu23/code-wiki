/**
 * search_taxonomy tool — query the taxonomy knowledge graph.
 * Reads source YAML/Markdown directly (not compiled JSON) to avoid stale state.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { Config } from '../types/index.js';
import {
  TaxonomySchema,
  TaxonomyTerm,
  TaxonomyEdge,
  EdgeType,
  ContentTaxonomy,
  ContentTagRecord,
} from '../types/taxonomy.types.js';

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const searchTaxonomyTool = {
  name: 'search_taxonomy',
  description:
    'Query the taxonomy knowledge graph. Get project taxonomy records, filter by facet, list edges, or find dependencies. Reads source files directly for up-to-date results.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'Project name, term ID, or facet value to look up. For list_edges, use the edge type name.',
      },
      action: {
        type: 'string',
        enum: ['get_record', 'filter_facet', 'list_edges', 'find_dependents'],
        description:
          'get_record: full taxonomy for a project. filter_facet: list projects matching a facet value. list_edges: all edges of a type. find_dependents: projects depending on a service.',
      },
      facet: {
        type: 'string',
        enum: [
          'type',
          'stack',
          'platform',
          'deployTarget',
          'domain',
          'visibility',
          'service',
        ],
        description: 'Facet to filter by (for filter_facet action)',
      },
    },
    required: ['query', 'action'],
  },
};

// ---------------------------------------------------------------------------
// Parsing helpers (mirror of web/src/taxonomyValidator.ts — keep in sync)
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
    const raw = await fs.readFile(path.join(termsDir, entry.name), 'utf-8');
    const { data } = matter(raw);
    terms.push(data as TaxonomyTerm);
  }
  return terms;
}

async function loadRelationships(filePath: string): Promise<TaxonomyEdge[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = yaml.load(raw) as { edges?: TaxonomyEdge[] };
    return (parsed?.edges ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type as EdgeType,
    }));
  } catch {
    return [];
  }
}

async function scanContentFiles(
  wikiDir: string
): Promise<ContentTagRecord[]> {
  const records: ContentTagRecord[] = [];
  const categories = await fs.readdir(wikiDir, { withFileTypes: true });

  for (const cat of categories) {
    if (!cat.isDirectory() || cat.name.startsWith('_') || cat.name.startsWith('.'))
      continue;
    const catDir = path.join(wikiDir, cat.name);
    let files;
    try {
      files = await fs.readdir(catDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md') || file.name.startsWith('_'))
        continue;
      const raw = await fs.readFile(path.join(catDir, file.name), 'utf-8');
      const { data } = matter(raw);
      if (!data.taxonomy) continue;

      records.push({
        path: `${cat.name}/${file.name}`,
        title: (data.title as string) || file.name.replace('.md', ''),
        taxonomy: data.taxonomy as ContentTaxonomy,
      });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleSearchTaxonomy(
  args: { query: string; action: string; facet?: string },
  config: Config
): Promise<string> {
  const wikiDir = config.wikiDirectory || './wiki';
  const taxonomyDir = path.join(wikiDir, '_taxonomy');
  const termsDir = path.join(taxonomyDir, 'terms');

  // Verify taxonomy exists
  try {
    await fs.access(taxonomyDir);
  } catch {
    return JSON.stringify(
      {
        error: 'Taxonomy not found',
        suggestion: `Expected taxonomy at ${taxonomyDir}. Ensure wiki/_taxonomy/ exists.`,
      },
      null,
      2
    );
  }

  const terms = await loadTerms(termsDir);
  const edges = await loadRelationships(
    path.join(taxonomyDir, 'relationships.yml')
  );
  const contentTags = await scanContentFiles(wikiDir);

  switch (args.action) {
    case 'get_record': {
      // Find a project or content file by name
      const q = args.query.toLowerCase();
      const match = contentTags.find(
        (ct) =>
          ct.title.toLowerCase() === q ||
          ct.path.toLowerCase().includes(q) ||
          ct.taxonomy.type === 'project' &&
            ct.title.toLowerCase().includes(q)
      );

      if (!match) {
        // Maybe it's a term?
        const termMatch = terms.find(
          (t) => t.term === args.query || t.label.toLowerCase() === q
        );
        if (termMatch) {
          // Find edges involving this term
          const relatedEdges = edges.filter(
            (e) => e.source === termMatch.term || e.target === termMatch.term
          );
          const inlineEdges = contentTags
            .filter((ct) => ct.taxonomy.dependsOn?.includes(termMatch.term))
            .map((ct) => ({
              source: ct.path,
              target: termMatch.term,
              type: 'dependsOn',
            }));

          return JSON.stringify(
            {
              type: 'term',
              term: termMatch,
              edges: [...relatedEdges, ...inlineEdges],
            },
            null,
            2
          );
        }

        return JSON.stringify(
          {
            error: 'Not found',
            query: args.query,
            suggestion:
              'Try a project title, term ID, or content file path.',
            available_projects: contentTags.map((ct) => ct.title),
          },
          null,
          2
        );
      }

      // Collect all edges for this content file
      const fileEdges: TaxonomyEdge[] = [];
      const tax = match.taxonomy;
      if (tax.dependsOn) {
        for (const t of tax.dependsOn) {
          fileEdges.push({ source: match.path, target: t, type: 'dependsOn' });
        }
      }
      if (tax.usesModule) {
        for (const t of tax.usesModule) {
          fileEdges.push({
            source: match.path,
            target: t,
            type: 'usesModule',
          });
        }
      }
      if (tax.appliesTo) {
        for (const t of tax.appliesTo) {
          fileEdges.push({
            source: match.path,
            target: t,
            type: 'appliesTo',
          });
        }
      }

      return JSON.stringify(
        {
          type: 'content',
          path: match.path,
          title: match.title,
          taxonomy: match.taxonomy,
          edges: fileEdges,
        },
        null,
        2
      );
    }

    case 'filter_facet': {
      const facet = args.facet;
      const value = args.query;

      if (!facet) {
        return JSON.stringify(
          {
            error: 'facet parameter required for filter_facet action',
            available_facets: [
              'type',
              'stack',
              'platform',
              'deployTarget',
              'domain',
              'visibility',
              'service',
            ],
          },
          null,
          2
        );
      }

      // Filter content files that have this facet value
      const matches = contentTags.filter((ct) => {
        const tax = ct.taxonomy;
        const fieldVal = (tax as Record<string, unknown>)[facet];
        if (Array.isArray(fieldVal)) return fieldVal.includes(value);
        return fieldVal === value;
      });

      // Also list terms in this facet
      const facetTerms = terms
        .filter((t) => t.facet === facet)
        .map((t) => ({ term: t.term, label: t.label }));

      return JSON.stringify(
        {
          facet,
          value,
          matching_content: matches.map((m) => ({
            path: m.path,
            title: m.title,
            taxonomy: m.taxonomy,
          })),
          facet_terms: facetTerms,
        },
        null,
        2
      );
    }

    case 'list_edges': {
      const edgeType = args.query as EdgeType;
      const validTypes = [
        'usesModule',
        'dependsOn',
        'appliesTo',
        'supersedes',
        'broader',
        'related',
      ];

      if (!validTypes.includes(edgeType)) {
        return JSON.stringify(
          {
            error: `Unknown edge type "${edgeType}"`,
            valid_types: validTypes,
          },
          null,
          2
        );
      }

      // Structural edges from relationships.yml
      const structuralMatches = edges.filter((e) => e.type === edgeType);

      // Inline edges from content files
      const inlineMatches: TaxonomyEdge[] = [];
      if (['dependsOn', 'usesModule', 'appliesTo'].includes(edgeType)) {
        for (const ct of contentTags) {
          const vals =
            (ct.taxonomy as Record<string, unknown>)[edgeType] as
              | string[]
              | undefined;
          if (vals) {
            for (const target of vals) {
              inlineMatches.push({
                source: ct.path,
                target,
                type: edgeType,
              });
            }
          }
        }
      }

      return JSON.stringify(
        {
          edgeType,
          structural_edges: structuralMatches,
          inline_edges: inlineMatches,
          total: structuralMatches.length + inlineMatches.length,
        },
        null,
        2
      );
    }

    case 'find_dependents': {
      // Find all projects that depend on a given service/term
      const serviceTerm = args.query;

      const dependents = contentTags.filter(
        (ct) => ct.taxonomy.dependsOn?.includes(serviceTerm)
      );

      // Also check structural edges
      const structuralDeps = edges.filter(
        (e) => e.target === serviceTerm && e.type === 'dependsOn'
      );

      return JSON.stringify(
        {
          service: serviceTerm,
          dependent_projects: dependents.map((d) => ({
            path: d.path,
            title: d.title,
            lifecycle: d.taxonomy.lifecycle,
          })),
          structural_edges: structuralDeps,
          total: dependents.length,
        },
        null,
        2
      );
    }

    default:
      return JSON.stringify(
        {
          error: `Unknown action "${args.action}"`,
          valid_actions: [
            'get_record',
            'filter_facet',
            'list_edges',
            'find_dependents',
          ],
        },
        null,
        2
      );
  }
}
