/**
 * Taxonomy type definitions — shared by validator and builder.
 * Mirror subset exists in mcp-server/src/types/taxonomy.types.ts
 */

// --- Schema shape (parsed from schema.yml) ---

export interface TaxonomySchema {
  schemaVersion: number;
  conventions: { termIdFormat: string; labelFormat: string };
  facets: Record<string, FacetDefinition>;
  stateFields: Record<string, StateFieldDefinition>;
  channels: {
    internal: { description: string };
    userview: { description: string };
    defaults: Record<string, string[]>;
  };
  relationships: Record<string, RelationshipDefinition>;
  notes: Record<string, NoteDefinition>;
  validator: {
    rules: ValidatorRuleDefinition[];
    report: { id: string; description: string }[];
    deferred: { id: string; description: string }[];
  };
  build: {
    sources: { taxonomyDir: string; wikiDir: string };
    outputs: { public: string; full: string };
  };
}

export interface FacetDefinition {
  cardinality: 'single' | 'multi';
  values: string[];
}

export interface StateFieldDefinition {
  appliesTo: 'content' | 'terms';
  values: string[];
}

export interface RelationshipDefinition {
  storage: 'inline' | 'relationships-file';
  direction: string;
  acyclic: boolean;
  description: string;
}

export interface NoteDefinition {
  required: boolean;
  hardMaxLength?: number;
  softWarnLength?: number;
  channel?: string;
  description: string;
}

export interface ValidatorRuleDefinition {
  id: string;
  severity: 'error' | 'warning';
  description: string;
}

// --- Term file shape (parsed from terms/*.md frontmatter) ---

export interface TaxonomyTerm {
  term: string;           // kebab-case ID (filename without .md)
  facet: string;           // Which facet this term belongs to
  label: string;           // Title Case display name
  definition: string;      // Required, <=500 chars
  scopeNote: string;       // Required, what's in/out of scope
  curationState: 'proposed' | 'active' | 'deprecated';
  channels?: string[];     // Overrides per-type default
  synonyms?: string[];     // Alternative names
  editorialNote?: string;
  historyNote?: string;
  changeNote?: string;
  cost?: string;          // Billing description (service terms only)
  costLink?: string;      // URL to pricing page
  notes?: string;         // Owner-editable notes
}

// --- Edge shape (from relationships.yml or inline frontmatter) ---

export type EdgeType = 'usesModule' | 'dependsOn' | 'appliesTo' | 'supersedes' | 'broader' | 'related';

export interface TaxonomyEdge {
  source: string;   // Term ID or content file relative path
  target: string;   // Term ID or content file relative path
  type: EdgeType;
}

// --- Content file taxonomy frontmatter (on wiki content files) ---

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

// --- Compiled output shape ---

export interface TaxonomyIndex {
  schemaVersion: number;
  terms: TaxonomyTerm[];
  edges: TaxonomyEdge[];
  facets: Record<string, string[]>;  // facet name -> list of active term IDs
  contentTags: ContentTagRecord[];   // tagged content files
  buildTime: string;
}

export interface ContentTagRecord {
  path: string;           // Relative path in wiki/
  title: string;
  taxonomy: ContentTaxonomy;
}

// --- Validator output ---

export interface Diagnostic {
  rule: string;
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

export interface ValidationResult {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  report: string[];
}
