# Code Wiki — Taxonomy / Ontology Design Handoff

**Created:** 2026-04-04
**Purpose:** Design brief for a new session focused on creating the taxonomy/ontology layer for code-wiki. This is a forward-looking handoff, not a session close — no code has been written yet. The prior thread was exploratory; this doc captures the decisions made so the design session can start immediately without re-deriving them.

> Note: a separate `HANDOFF.md` exists at the repo root for a prior session on a different topic. Do not confuse the two.

---

## Background

James is adding a taxonomy layer to code-wiki that will eventually support an ontology-flavored relationship graph on top. Motivations (in priority order):

1. **Portfolio for content-design / tech-writing job search.** This is the primary driver. Demonstrates structured-content thinking, controlled vocabulary design, and governance — the skills content-ops and senior content-design roles actually hire for.
2. **Self-understanding as a solo producer / PM.** Across ~47 projects, cross-project questions (reuse coverage, blast radius, lifecycle debt, portfolio coherence) are currently answered by grep + memory. Taxonomy + relationships would formalize this.
3. **Agent assistance.** Giving Claude (and other agents) a controlled vocabulary, status fields, and a small relationship graph to constrain outputs and filter recommendations. Agents benefit most from *constraint enforcement*, not from richer retrieval.

---

## Decisions already made (do not re-litigate)

### Format & storage
- **Source of truth: YAML for schema + Markdown-with-frontmatter for per-term entries.** YAML chosen for comment support; Markdown dogfoods code-wiki's existing content model.
- **Build artifact: JSON** (`web/public/data/taxonomy.json`), compiled from sources. Consumed by web UI, MCP server (remotely), apiTracker, etc.
- **Optional later: SKOS `.ttl` export** for portfolio credibility. Not in v1.
- **CSV is not a storage format.** Only an import/export bridge if Sheets round-tripping is ever added.

### Architecture
- **Local-first validation.** `npm run lint:taxonomy` runs locally and in CI. Authoring never depends on GitHub Actions running.
- **MCP server reads YAML/Markdown sources directly** and compiles in-memory on load. Does NOT read the built `taxonomy.json`. This prevents stale-state races between local edits and remote Action runs.
- **Build artifacts ride the existing pipeline.** `update-index.yml` gets two new steps (`lint:taxonomy`, `build:taxonomy`) and a new `paths:` entry for `wiki/_taxonomy/**`. These additions are **deferred** until after the design is done — do not build them during the design session.
- **Frontmatter is additive.** New facet fields extend existing frontmatter (`title`, `description`, `updated`, `visibility`); they do not replace or duplicate it. Files without new fields remain valid; validator flags them as "untagged."

### Scope boundary (clarifying term to use)
- **Taxonomy-plus, not full ontology.** Controlled vocabulary + facets + a *small* set of typed relationships (status, supersedes, usesModule, dependsOn, etc.). Call it a "lightweight knowledge graph" or "taxonomy with typed relationships" externally — NOT "ontology" in the formal OWL/reasoner sense.
- **Relationship to memory system:** `~/.claude/.../memory/` = agent runtime state and ephemeral context. Wiki taxonomy = versioned, curated, potentially public knowledge. Keep the line clean; do not duplicate facts across both.

### Dual-audience publishing (important — this is the portfolio centerpiece)
- **Single-source, multi-channel publishing.** One authoritative content store, two rendered outputs:
  - **Internal/agent view** — terse, structured, MCP-queryable, optimized for lookup. Build this **first**.
  - **Portfolio view** — narrative case-study rendering of the same source content, optimized for hiring-manager readability. Build **second**, after the internal version has stabilized.
- This is the named professional practice (DITA / content ops) and is the strongest portfolio framing. Sequence matters: portfolio-first would freeze a bad schema in place.

### v1 scope — which projects get tagged first
Five projects, chosen for variety + maturity:

1. **WeirdChess** — `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/WeirdChess`
2. **QuantumRetriever** (lives in **Metabot** folder/repo) — `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/Metabot`
3. **code-wiki itself** (dogfooding keystone) — this repo
4. **TrollJar** (pre-release) — `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/TrollJar`
5. **NeoGeoSeo** (pre-release) — `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/NeoGeoSeo`

Rationale: completed apps have stable surface area; the two pre-release ones test the highest-value agent workflow ("does the taxonomy help me ship this cleanly?"). Also forces `projectName` vs `repoName` to be distinct fields from day one (Metabot/QuantumRetriever is the asymmetric case).

Wiki content in scope beyond these 5 projects: `wiki/projects/` and `wiki/patterns/`. The rest of `wiki/` can backfill later.

---

## Open questions the design session must resolve

These are **not** decided yet and are the actual work of the next session:

1. **Facet list and controlled values.** Starting proposal from prior thread (to challenge or accept): `type`, `stack`, `domain`, `lifecycle`, `audience`, `project`. Each needs an allowed-values list. Aim for ~40 total terms across all facets in v1 — not 400.
2. **Relationship types for the tier-1 graph.** Proposed starting set: `supersedes`, `usesModule`, `dependsOn` (service), `hasStatus`, `hasVisibility`, `appliesTo` (project). Decide which are edges on term files vs. edges on content files.
3. **Per-term Markdown file shape.** Exact frontmatter fields for `wiki/_taxonomy/terms/{term}.md`. Include: `term`, `facet`, `synonyms`, `broader`, `related`, `status`, `firstUsed`, plus prose definition and scope notes.
4. **Schema file shape.** `wiki/_taxonomy/schema.yml` structure: facets, allowed values, relationship type definitions, `schemaVersion` field (add from v1 even if unused).
5. **Validator rules for v1.** What must fail the build? Candidate rules: unknown term used in content, missing required frontmatter on term file, orphaned synonym (pointing to nonexistent canonical), circular `supersededBy`, term file facet mismatch with `schema.yml`.
6. **Naming conventions.** `kebab-case` for term IDs, `Title Case` for display labels — confirm and document.
7. **Visibility partitioning.** One vocabulary across public + private content, with `visibility` as a facet? Or private-only term namespace for internal codenames? Prior thread leaned toward option A.
8. **Success criteria.** Concrete, measurable: (a) 5 pre-written workspace questions answerable in under 30 seconds each, (b) agent uses canonical terms in generated content, (c) design doc reads well enough for portfolio linking without editing. Finalize the 5 questions during the session.
9. **Portfolio doc format.** Single dual-audience doc with layered structure? Or two docs generated from same source (short `DECISIONS.md` + longer `taxonomy-case-study.md`)? Prior thread leaned toward two-docs-from-one-source because James is actively job-hunting.

---

## What NOT to design in the next session

Hard out-of-scope for the design session (these are downstream, or premature):

- The service cost page (planned later, will join code-wiki inventory + apiTracker live spend).
- SKOS / `.ttl` export format.
- Google Sheets round-trip / import-export tooling.
- The `update-index.yml` pipeline additions (trivial once design is done).
- The MCP tool implementation itself (write the tool *interface* during design if helpful, but not the code).
- Full ontology with reasoner / OWL inference.
- Tagging beyond the 5 v1 projects + `wiki/projects/` + `wiki/patterns/`.

---

## Suggested opening for the new session

A focused first-message for the new thread could be:

> *"I'm designing the taxonomy layer for code-wiki. Read HANDOFF-taxonomy-design.md at the repo root for the brief. Start by proposing a draft `schema.yml` (facets + allowed values + relationship types) targeted at the 5 v1 projects, grounded in what you can actually see in their repos. Don't write any other files yet — the schema is the first decision and everything else follows from it."*

That framing gets the new session to ground its proposal in real project data instead of theorizing, and defers everything downstream until the schema is agreed.

---

## Key file pointers

- [wiki/](wiki/) — existing content organized into integrations, patterns, personal, preferences, projects, snippets, templates, utilities, diagrams
- [wiki/patterns/overall-mcp-info.md](wiki/patterns/overall-mcp-info.md) — example of existing frontmatter pattern to extend
- [.github/workflows/update-index.yml](.github/workflows/update-index.yml) — the pipeline the taxonomy build will eventually hook into (deferred)
- [web/src/indexBuilder.ts](web/src/indexBuilder.ts) — existing index build; model the taxonomy build script on this
- [web/src/diagramSignals.ts](web/src/diagramSignals.ts) — staleness-detection pattern to reuse for term `lastVerified` fields
- [mcp-server/](mcp-server/) — where the new `search_wiki(facets, ...)` tool will eventually live
- `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/apiTracker/` — future join target for the service cost page (not in v1)
- `/Users/jamesbeach/.claude/projects/-Users-jamesbeach-Documents-visual-studio-code/memory/MEMORY.md` — the workspace memory system. Taxonomy must complement this, not duplicate it.

### v1 project repos to ground the schema in

- `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/WeirdChess`
- `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/Metabot` (product: QuantumRetriever)
- `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/code-wiki` (this repo)
- `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/TrollJar`
- `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/NeoGeoSeo`

---

## Audiences for the taxonomy itself (context for design choices)

- **Primary (portfolio):** content-design / content-ops / tech-writing hiring managers. Expect: appreciation for controlled vocabulary, governance model, single-sourcing, clear rationale for taxonomy vs ontology choice.
- **Secondary (self):** James as solo producer/PM across many projects. Needs: cross-project queries, lifecycle/debt visibility, credential blast-radius, reuse gap detection.
- **Tertiary (agents):** Claude and other coding agents. Needs: canonical names, `status: deprecated` filtering, constrained output vocabulary, MCP query tool over the graph.

All three are served by the same source of truth. Portfolio and self audiences get prose + narrative; agents get structured fields. Single-source, multi-channel.
