# Code Wiki — Taxonomy Auto-Inference (Generalized seed-taxonomy)

**Created:** 2026-04-22
**Purpose:** Generalize `scripts/seed-taxonomy.ts` from a hand-curated 5-project bootstrap helper into a full auto-inference tool that proposes (and optionally writes) taxonomy frontmatter for every project in the workspace — public and private.

> Forward-looking handoff. No code has been written yet. Read this fully before implementing and confirm design decisions with the user.

---

## What exists now

- `scripts/seed-taxonomy.ts` has a hardcoded `PROJECTS` array of 5 entries (WeirdChess, QuantumRetriever, code-wiki, TrollJar, NeoGeoSeo).
- Each entry hand-specifies which manifest files to read (`pubspec.yaml`, `package.json`, `netlify.toml`, `manifest.json`).
- Two dictionaries map dependencies to terms: `DEP_TO_STACK` (8 entries), `DEP_TO_SERVICE` (5 entries).
- Output is stdout-only — YAML frontmatter blocks printed for a human to paste into wiki entries.
- Validator at `web/src/taxonomyValidator.ts` currently reports **19 wiki content files without taxonomy frontmatter**. A generalized inference tool would close most of that gap.

## Why generalize

- Hand-curated 5-project list doesn't scale to the full inventory (37+ repos per `code-wiki-content/wiki/projects/repo-locations.md`).
- Current script misses sub-projects inside a repo (e.g. QuantumRetriever's mobile app lives at `Metabot/mobile/` — not declared in the manifests list, so the script would miss `ios`/`android` platforms entirely, as was observed during taxonomy review).
- Dep dictionary is too thin: common libraries like `@supabase/supabase-js`, `@capacitor/core`, `next`, `tailwindcss`, `fastapi` aren't mapped, so they silently go undetected.
- Forkers get a tool that only helps if they rename their projects to match one of the five hardcoded names.

---

## Design decisions to confirm before coding

### 1. Project enumeration source — DECIDED

**Decision (2026-04-22): Parse `code-wiki-content/wiki/projects/repo-locations.md`.** That file is auto-regenerated nightly at 00:00 UTC by `update-index.yml` and can be refreshed on demand from the web UI (see "Freshness" below). It has canonical repo names, local paths, and visibility — everything the inference tool needs.

**Fallback for forkers without a private content repo set up**: walk `WORKSPACE_DIR` for `.git` directories and treat each as a project. Visibility defaults to `public` with a warning; users can override manually.

### Freshness behavior to respect

- **~24h staleness window.** `repo-locations.md` is rebuilt daily. A repo created between rebuilds won't appear until the next run.
- **Manual refresh is already wired up.** The web UI has a "Refresh" button (`#refresh-quickview-btn` at `web/public/app.js:162`) that POSTs to `/api/rebuild-index`, which calls `workflow_dispatch` on `update-index.yml`. Users who just created a repo should hit Refresh, wait ~2–3 min, then re-run the taxonomy script. Document this in the script's `--help` output.
- **`--create-stubs` handles the "only new repos" case naturally.** If a repo is in `repo-locations.md` but has no wiki entry, `--create-stubs` processes it; if it already has one, the merge strategy (decision #4) leaves existing frontmatter intact. No separate `--only-new` flag needed.
- **PAT scope drift silently omits repos** (see `HANDOFF-rearchitecture.md` decision #15). If a repo disappears from `repo-locations.md` between runs, the taxonomy script should NOT delete its wiki entry — drift in the inventory is a known-unknown. Deletion is a manual operation.
- **Stale header bug** (decision #16): the `Last updated:` literal at the top of `repo-locations.md` isn't actually refreshed by the build. Ignore it; trust the file body.

### 2. Sub-project discovery

A repo can contain multiple buildable surfaces (e.g. `web/`, `mobile/`, `backend/`, `api/`).

**Recommendation:** walk a fixed set of subdirs (`web/`, `mobile/`, `api/`, `backend/`, `frontend/`, `client/`, `server/`) and any top-level dir containing `package.json`/`pubspec.yaml`/`requirements.txt`/`Cargo.toml`. Merge findings into one per-project taxonomy (so QuantumRetriever gets `web, ios, android` from `web/package.json` + `mobile/package.json`).

### 3. Expanded vocabulary

Current 13 mappings is ~10% of what's needed. Expand to at least:

- **Stack** (from `package.json` / `pubspec.yaml` / `requirements.txt`): `tailwindcss`, `next`, `vue`, `svelte`, `@capacitor/core`, `fastapi`, `flask`, `django`, `stockfish`, `openai`, `redux`, `zustand`
- **Services**: `@supabase/supabase-js`, `stripe`, `firebase`, `@huggingface/inference`, `@aws-sdk/*` (map to `aws-api`), `pg` (→ `postgresql`)
- **Platform hints**: `@capacitor/*` → `ios + android`, `tailwindcss`/`vite`/`react` → `web`, `electron` → `desktop`
- **Build target hints**: `netlify.toml` → `netlify`, `wrangler.toml` → `cloudflare-workers`, `fly.toml` → `fly-io`, `Dockerfile` + GCP config → `gcp-cloud-run`, iOS `Podfile` → `apple-app-store`, Android `build.gradle` with upload config → `google-play`

Unknown deps should be logged as `unmapped` with a hint to add them, not silently ignored.

### 4. Frontmatter merge strategy — DECIDED

**Decision (2026-04-22): Merge-preserving.** Never remove a term a human added. When inference proposes additions, report them; when it proposes removals, log them but leave existing terms in place. Emit a human-readable diff so the user can see what would change before `--apply`.

### 5. Public vs private routing for new/updated entries

When the script writes (with `--apply`), it must respect the new private-content architecture:

- If the target project has `visibility: public` in its inferred frontmatter → write to public `wiki/projects/{name}.md`
- If `visibility: private` → write to `code-wiki-content/wiki/projects/{name}.md`
- If the existing wiki entry lives in one repo and the newly inferred visibility says the other repo, **flag for migration** (see `HANDOFF-visibility-migration.md`) — don't silently move

Visibility itself should be inferred: default from the GitHub repo's visibility if known, otherwise `public`.

### 6. CLI interface

```
npx tsx scripts/seed-taxonomy.ts [options]

  --project <name>       Run for a single project instead of all
  --dry-run              Print proposed changes without writing (default)
  --apply                Write frontmatter changes to wiki files
  --create-stubs         Create minimal wiki entries for projects lacking one
  --source <path>        Override repo-locations.md path
  --private-dir <path>   Override path to private content repo
  --verbose              Log every scanned manifest and mapped dependency
```

Default is dry-run for safety; `--apply` is the explicit opt-in.

---

## Step-by-step implementation plan

### Step 1: Add a `repo-locations.md` parser
- New helper module: `scripts/lib/parseRepoLocations.ts`
- Returns `{ name, repoName, localPath, visibility, githubUrl }[]`
- Handle the stale-header bug flagged in `HANDOFF-rearchitecture.md` decision #16

### Step 2: Sub-project walker
- New helper: `scripts/lib/discoverManifests.ts`
- Walks a project root and returns all discovered manifest files with their relative paths
- Respects `.gitignore` (best-effort; skip `node_modules`, `build`, `dist`)

### Step 3: Expand dep dictionaries
- Move dictionaries to `scripts/lib/depMappings.ts` so they can be extended without touching the main script
- Add a `logUnmapped` flag for the verbose mode

### Step 4: Frontmatter merger
- New helper: `scripts/lib/mergeFrontmatter.ts`
- Uses `gray-matter` (already a dep — `mcp-server/package.json` has it) to parse/write
- Merge rules: preserve existing; add missing; diff to stdout; warn on removals

### Step 5: Writer with routing
- Routes to public or private repo based on inferred visibility
- When writing to private repo, require `PRIVATE_CONTENT_DIR` env var (path to local clone)
- Refuse to write if the target repo has uncommitted changes (safety)

### Step 6: Stub creator
- When `--create-stubs` is set and a project has no wiki entry, generate minimal:
  ```yaml
  ---
  title: "ProjectName"
  description: "(TODO: describe)"
  tags: []
  updated: "YYYY-MM-DD"
  source_repo: "RepoName"
  taxonomy: { inferred block }
  ---
  ```
- Always flag stubs with a clear TODO so the user remembers to fill in description

### Step 7: Validation after write
- After a write pass, run the existing `taxonomyValidator.ts`
- Abort overall run with a non-zero exit if the validator reports errors (not warnings)

### Step 8: Regression tests
- Before full rollout, run against the 5 already-annotated projects (WeirdChess, QuantumRetriever, code-wiki, TrollJar, NeoGeoSeo) in dry-run
- Expected output: diff should be minimal (possibly suggestions for additional deps newly covered by the expanded vocabulary, never removals)
- Manual review of proposed changes before `--apply`

---

## Resolved questions (2026-04-22)

1. **Update `updated:` timestamps on touched files — YES.** When the script writes a file (via `--apply`), set `updated:` to the current date (`YYYY-MM-DD`). Applies both to merged frontmatter and newly-created stubs.
2. **Add a `stub` state value to the taxonomy — YES.** Implementation note: `curationState` in the current schema (`wiki/_taxonomy/schema.yml`) has `appliesTo: terms` — it's intended for term definition files, not content files. The implementing session should either (a) add a NEW state field like `completionState: [stub, draft, complete]` with `appliesTo: content` or (b) broaden `curationState`'s applicability. Preferred: option (a), cleaner separation. Stubs created by `--create-stubs` are marked `completionState: stub`.

## Open questions

1. **Should the script ever delete terms the human added but the inference doesn't see?** Default no; maybe `--strict` flag later.
2. **How to handle monorepo-ish repos (code-wiki itself is one) where stack terms differ per subdir?** Current proposal flattens; may want to tag specific terms with subdir scope later.

---

## Out of scope for v2

- Writing term definitions in `wiki/_taxonomy/terms/` — those are hand-curated with definitions, scope notes, etc.
- Changing the taxonomy schema or validator
- Running this script in CI on a schedule (could be a future Phase 3)
- Cross-repo relationship inference (e.g. detecting that Project A `dependsOn` Project B based on imports) — much harder, separate effort

## Success criteria

Phase v2 is done when:
1. Running `npx tsx scripts/seed-taxonomy.ts --dry-run` produces proposed frontmatter for every project in `repo-locations.md`
2. Running with `--apply` writes correct frontmatter to the right repo (public or private) per inferred visibility
3. All currently-annotated projects (5 v1 targets) still pass the validator after a re-run
4. At least one previously-unannotated project is successfully auto-annotated end-to-end
5. Unmapped dependencies are logged so the vocabulary can be extended iteratively

---

## First-message prompt for implementing session

> *"Implement HANDOFF-taxonomy-auto-inference.md. Read it fully, confirm design decisions #1 and #4 with the user before writing code. Build incrementally by step (1–8). Pause after Step 3 for a checkpoint review before any writer code lands."*
