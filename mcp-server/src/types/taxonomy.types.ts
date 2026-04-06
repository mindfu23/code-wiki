/**
 * Taxonomy types for MCP server.
 * Subset of web/src/taxonomyTypes.ts — keep in sync.
 */

export interface TaxonomySchema {
  schemaVersion: number;
  facets: Record<string, { cardinality: string; values: string[] }>;
  stateFields: Record<string, { appliesTo: string; values: string[] }>;
  relationships: Record<string, { storage: string; direction: string; acyclic: boolean; description: string }>;
}

export interface TaxonomyTerm {
  term: string;
  facet: string;
  label: string;
  definition: string;
  scopeNote: string;
  curationState: 'proposed' | 'active' | 'deprecated';
  channels?: string[];
  synonyms?: string[];
  editorialNote?: string;
}

export type EdgeType = 'usesModule' | 'dependsOn' | 'appliesTo' | 'supersedes' | 'broader' | 'related';

export interface TaxonomyEdge {
  source: string;
  target: string;
  type: EdgeType;
}

export interface ContentTaxonomy {
  type?: string;
  stack?: string[];
  platform?: string[];
  deployTarget?: string[];
  domain?: string[];
  visibility?: string;
  lifecycle?: string;
  dependsOn?: string[];
  usesModule?: string[];
  appliesTo?: string[];
}

export interface ContentTagRecord {
  path: string;
  title: string;
  taxonomy: ContentTaxonomy;
}

export interface TaxonomyIndex {
  schemaVersion: number;
  terms: TaxonomyTerm[];
  edges: TaxonomyEdge[];
  facets: Record<string, string[]>;
  contentTags: ContentTagRecord[];
  buildTime: string;
}
