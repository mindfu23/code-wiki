# Code Wiki — Taxonomy v1 Implementation Handoff

> **Status:** Implemented. Schema, 59 terms, 12 relationship edges, validator, and compiled taxonomy outputs are all in place. Initial landing in commit `e001149` (*taxonomy feature update for public and private repos, and relationships between repos*), with `b2bf3fe` (*taxonomy build step added*) wiring it into the web build. See `HANDOFF-taxonomy-auto-inference.md` for the follow-up scanner work.

**Created:** 2026-04-05
**Purpose:** Implementation handoff for the taxonomy layer designed across a long design session (2026-04-04 → 2026-04-05). The schema is fully specified; the work is mechanical once Phase 1 rearchitecture is complete.

> **Prerequisite:** `HANDOFF-rearchitecture.md` must ship and be verified first. Do not begin this work until Phase 1 is complete, deployed, and all six success criteria in that handoff are met. Layering new taxonomy content on the un-cleaned architecture would require double-migration.

> This supersedes the earlier `HANDOFF-taxonomy-design.md`, which was the brief for the design session that produced this plan. That earlier doc is still useful background but is out of date on several decisions — this doc is authoritative for implementation.

---

## What's already decided

The design session locked in every structural decision. Nothing in the schema is open for re-litigation unless the implementing agent finds a concrete reason the design can't be built as specified.

### Schema

The full schema draft is in this handoff's appendix, or can be reconstructed from the session transcript. Summary:

- **6 facets** (all stable classifiers): `type`, `stack`, `platform`, `deployTarget`, `domain`, `visibility`.
- **2 state fields** (changeable): `lifecycle` on content files, `curationState` on term files.
- **2 channels** (single-source, multi-channel publishing): `internal` (for agents and structured lookup) and `userview` (for human browsing).
- **6 relationship types:** `usesModule`, `dependsOn`, `appliesTo` (inline on entity files) + `supersedes`, `broader`, `related` (in central `relationships.yml`).
- **5 SKOS-aligned note types:** `definition` (required, 500-char hard cap, 250-char soft warn), `scopeNote` (required), `editorialNote` (optional, internal channel only), `historyNote` (optional, tracks the TERM'S own vocabulary history not the subject's history), `changeNote` (optional).
- **`type: help`** added as a facet value for end-user help docs.
- **`schemaVersion: 1`** with additive-vs-breaking change rules documented.
- **Conventions:** `kebab-case` for term IDs, `Title Case` for labels.

### Validator rules

9 enforced rules + 1 diagnostic report + 1 deliberately deferred. See appendix or session transcript for full list. Key ones:
- **Fail-build rules (6):** unknown facet value, required frontmatter missing, facet/term-file mismatch, unknown edge endpoint, cycles in acyclic relationships, definition-length hard cap, private+userview channel collision.
- **Warn rules (3):** symmetric edge canonical ordering, definition-length soft warn, orphan synonyms.
- **Report-only (1):** untagged content files (summary line at end of build, not per-file).
- **Deferred (1):** unknown canonical term used in prose bodies. Too noisy in practice; revisit only if drift emerges.

### v1 scope

Five projects to tag first:
1. **WeirdChess** (Flutter, shipped, games, AI tooling)
2. **QuantumRetriever** (in `Metabot` folder — forces `projectName` vs `repoName` distinction)
3. **code-wiki itself** (dogfooding keystone)
4. **TrollJar** (pre-release, browser extension, social impact)
5. **NeoGeoSeo** (pre-release, browser extension, SEO)

Plus `wiki/projects/` and `wiki/patterns/` backfill. Rest of wiki can backfill later.

### Edge storage

**Hybrid:** attribute edges (`dependsOn`, `usesModule`, `appliesTo`) live INLINE on entity files; structural edges (`supersedes`, `broader`, `related`) live in `wiki/_taxonomy/relationships.yml`. One-sided storage; build computes inverses at compile time.

### Channels and conditional content

Per-type defaults in the schema. Block-level conditional content via HTML-comment fences inside Markdown: `<!-- channel:internal-only --> ... <!-- /channel -->`.

### Phase-2 deliverables (NOT in v1)

Explicitly deferred:
- Weekly workspace update notes from git history grouped by taxonomy facets.
- Mermaid term-hierarchy diagram.
- Glossary view (single-page alphabetized render).
- Vocabulary `CHANGELOG.md` started at v1.1.
- Potential end-user channel value and `appliesToVersion` field for help doc publishing.
- SKOS `.ttl` export.
- Inference script backfill for projects beyond the v1 5.

### Explicit non-scope

- News aggregation / external content feeds. Belongs in a different project (candidate: extend SearchBard).
- Integration with `~/.claude` memory system. Keep the line clean between memory (runtime) and taxonomy (versioned curated knowledge).
- Health scores combining axes into a composite number. Gameable, wrong.
- Public JSON API for third-party consumers.
- Recommendation engine over facet overlaps.
- Full-text + facet search as primary value prop. Value is in cross-project queries grep can't answer.

### Agent authority policy

Agents may READ the taxonomy freely via MCP. Agents may PROPOSE changes to taxonomy files but all writes go through review (PR or explicit confirmation). No direct autonomous writes to `wiki/_taxonomy/` or to project frontmatter. Validator is the safety net; this policy is the belt.

### 30-day self-test

Scheduled review 30 days after v1 lands. Three honest questions:
1. Did I actually run any of the 5 target workspace queries during normal work, not just to test?
2. Did any agent session benefit from pulling a taxonomy record to prime context?
3. Did I update any `lifecycle` field without being reminded?

If all three are no, the taxonomy failed its self-test. **Don't expand to more projects. Redesign or stop.**

---

## Implementation plan

### Step 0: Preflight
1. **Verify Phase 1 is complete.** Read `HANDOFF-rearchitecture.md` success criteria and confirm all six are met. Do not proceed until they are.
2. Read this entire handoff.
3. Read the `code-wiki` README, especially the (updated by Phase 1) section on the private content repo.
4. Read the memory file `~/.claude/projects/-Users-jamesbeach-Documents-visual-studio-code/memory/taxonomy-design-patterns.md` for the general design patterns.
5. Read `HANDOFF-taxonomy-design.md` for background context (but know this current handoff supersedes it on specific decisions).
6. Re-verify the 5 v1 project repos exist where expected.

### Step 1: Write `wiki/_taxonomy/schema.yml`
Create the file with all the decisions above. The consolidated draft produced during the design session is a good starting template — if it's in the session transcript or saved somewhere, use it. Otherwise reconstruct from the summary above.

Key structural elements:
- `schemaVersion: 1`
- `conventions:` block
- `facets:` block with 6 facets and their allowed values
- `stateFields:` block with `lifecycle` and `curationState`
- `channels:` block with `internal` and `userview`, per-type defaults
- `relationships:` block defining all 6 edge types with their storage location (`inline` or `relationships-file`)
- `notes:` block with SKOS subset
- `validator:` block listing all rules with severity
- `build:` block specifying source vs output paths

The schema should be heavily commented so future-James understands every decision. Comments next to fields are where they're most likely to be read.

### Step 2: Write `wiki/_taxonomy/relationships.yml`
Start with the structural edges obvious from the schema itself (e.g., `chrome-web-store broader browser-extension`, `apple-app-store broader mobile`). Leave the file mostly empty; it grows organically as terms are added.

### Step 3: Write the generic term files
Create `wiki/_taxonomy/terms/` and populate with term files for every facet value and every external service referenced via `dependsOn`. Each file is Markdown with frontmatter:

```yaml
---
term: browser-extension
facet: platform
label: "Browser Extension"
definition: >
  A packaged extension running inside a web browser's extension runtime.
scopeNote: >
  Includes Manifest V2 and V3. Excludes userscripts (Tampermonkey etc.),
  which are tagged `utility`.
curationState: active
channels: [internal, userview]
---

Optional prose body here.
```

Required fields: `term`, `facet`, `label`, `definition`, `scopeNote`, `curationState`. Optional: `synonyms`, `editorialNote`, `historyNote`, `changeNote`, `channels` (inherits from defaults if omitted).

Expected count at v1: ~60 terms total (facet values + external services).

### Step 4: Write the validator
Implementation lives in `web/src/taxonomyValidator.ts` (or similar). Reads source files, runs all 9 rules, outputs human-readable error/warning list, exits non-zero on fail-severity violations. Add `npm run lint:taxonomy` to `web/package.json`.

Roughly 300 lines of TypeScript; most rules are ~20 lines each. Acyclic check is the only one with algorithmic content (standard DFS).

### Step 5: Write the inference script
Create `scripts/seed-taxonomy.ts` that reads `package.json` / `pubspec.yaml` / `manifest.json` / `netlify.toml` / `Cargo.toml` files in the 5 v1 project repos and proposes frontmatter blocks per project. Output is human-reviewable suggestions, not auto-commits.

Expected: ~10 minutes of script writing, ~15 minutes of review to tag all 5 v1 projects.

### Step 6: Write the taxonomy build step
Create `web/src/taxonomyBuilder.ts` (modeled on existing `indexBuilder.ts`). Reads source YAML + term Markdown + relationships YAML, produces two JSON outputs:
- `web/public/data/taxonomy.json` — public, visibility-filtered
- `web/public/data/taxonomy-full.json` — full, including `visibility: private` content

**Note:** after Phase 1, these files live in the private content repo, not the public repo. Adjust paths accordingly.

Add `npm run build:taxonomy` to `web/package.json`. Wire into the main build command so it runs alongside `build:index`.

### Step 7: Tag the five v1 projects
Using the inference script output as a starting point:
1. Add frontmatter to each project's entry file in `wiki/projects/` (which lives in the private content repo now).
2. Create project-specific term files if needed (e.g., `weirdchess.md`, `quantumretriever.md`).
3. Populate `dependsOn` edges inline on each project file pointing at the generic service term files.
4. Run `npm run lint:taxonomy` and fix anything flagged.
5. Run `npm run build:taxonomy` and verify output is what you expect.

### Step 8: Write an MCP tool for taxonomy queries
Add a `search_taxonomy` (or `get_taxonomy_record`) tool to the MCP server at `mcp-server/src/tools/`. The tool reads the source YAML/Markdown directly (NOT the compiled JSON — prevents stale-state races) and compiles in-memory on load.

Initial query capabilities:
- Get a project's full taxonomy record (all facets, all edges).
- List all projects matching a facet filter (e.g., `platform: browser-extension`).
- List all edges of a given type.
- Find all projects that `dependsOn` a specific service.

### Step 9: Update the README
Add a "Taxonomy" section documenting:
- What the taxonomy does
- Schema overview (facets, state fields, relationships)
- How to add a new project entry
- How to add a new term
- How the validator works
- Link to the design rationale in a case-study doc (if/when written)

### Step 10: Set up the 30-day self-test
Write the review date in a calendar, TODO list, or wherever you'll see it. Do not skip. The kill criterion is the whole point of this being a measurable deliverable and not an aspirational artifact.

---

## Out of scope for v1 (deferred to phase 2 or beyond)

- Weekly update notes from git history.
- Mermaid term diagram.
- Glossary view.
- Vocabulary changelog.
- SKOS `.ttl` export.
- Expanding beyond the 5 v1 projects.
- The portfolio case-study doc (write AFTER the taxonomy has stabilized).
- Any tooling to analyze/auto-tag repos beyond the v1 inference script.

---

## Success criteria for v1

Taxonomy v1 is done when:
1. `schema.yml` exists and is complete.
2. All 5 v1 projects have taxonomy frontmatter.
3. `npm run lint:taxonomy` passes.
4. `npm run build:taxonomy` produces both output JSON files.
5. The MCP server exposes at least one working taxonomy tool.
6. README documents the taxonomy layer.
7. At least one agent session has successfully used the taxonomy to prime context.
8. The 30-day self-test is scheduled.

---

## First-message prompt for a fresh session

> *"I'm implementing taxonomy v1 for code-wiki. Read `HANDOFF-taxonomy-v1.md` at the repo root for the plan. First verify Phase 1 (from `HANDOFF-rearchitecture.md`) is complete — do not proceed if it isn't. Then read the README, the design-patterns memory file, and the original design handoff for context. Work through the plan step by step; the schema decisions are all locked and should not be re-opened."*

---

## Appendix: full schema field reference

*[For full schema draft, see session transcript or reconstruct from the "What's already decided" section above. Schema is ~240 lines including comments.]*

### Facet values quick reference

- **type:** project, pattern, snippet, template, integration, utility, diagram, preference, term, help
- **stack:** typescript, javascript, dart-flutter, python, react, react-native, vite, expo, node-express, netlify-functions
- **platform:** web, mobile, ios, android, desktop, browser-extension, mcp-server, cli
- **deployTarget:** netlify, cloudflare-workers, gcp-cloud-run, chrome-web-store, firefox-addons, edge-addons, apple-app-store, google-play, self-hosted, local-only
- **domain:** games, ai-tooling, developer-tools, content-tools, seo, social-impact, knowledge-management, observability
- **visibility:** public, private, internal

### State field values

- **lifecycle** (on content): experimental, pre-release, shipped, mature, deprecated, archived
- **curationState** (on terms): proposed, active, deprecated

### Channels

- **internal** — MCP server + web UI, structured lookup
- **userview** — Readable render for browsing

### Relationship types

| Relationship | Storage | Direction | Acyclic? |
|---|---|---|---|
| usesModule | inline | content → pattern/utility/snippet/template | — |
| dependsOn | inline | project/pattern → term | — |
| appliesTo | inline | pattern/snippet/template/integration/help → project | — |
| supersedes | relationships.yml | term → term | yes |
| broader | relationships.yml | term → term | yes |
| related | relationships.yml | term ↔ term (symmetric) | — |
