# Code Wiki — Phase 1 Rearchitecture Handoff

**Created:** 2026-04-05
**Purpose:** Sequenced plan to move all generated content derived from James's GitHub account out of the public `code-wiki` repo and into a new private content repo. Must ship **before** the taxonomy work in `HANDOFF-taxonomy-v1.md` can cleanly land.

> This is a forward-looking handoff. The session that produced it was a long design conversation (spanning a prior taxonomy-design thread) that surfaced an architectural issue the user wanted to address. No code has been written yet.

---

## Decisions made during implementation (2026-04-05)

These decisions were confirmed by the user at the start of the implementing session and resolve most of the "Open questions" section at the bottom of this document. They OVERRIDE the defaults in the original plan where they conflict.

1. **Private content repo name**: `code-wiki-content`. Lives at `github.com/mindfu23/code-wiki-content` (private). Already cloned locally at `/Users/jamesbeach/Documents/visual-studio-code/github-copilot/code-wiki-content/`.
2. **Git history treatment**: Option 1 (fix forward, no rewrite).
3. **`update-index.yml` workflow**: Pattern B — keep daily cadence in Actions, commit outputs to `code-wiki-content` via a write-scoped PAT. User may revisit cadence later.
4. **`collect-metrics.yml` workflow**: Pattern B — same treatment as update-index.
5. **Metrics consolidation**: Single location at `code-wiki-content/web/public/data/metrics/`. The dual-write to `mcp-server/data/metrics/` (currently in [collectMetrics.ts](mcp-server/src/scripts/collectMetrics.ts) lines 83–93) is dropped entirely. MCP server reads from the web/public location.
6. **Local dev overlay**: Nested clone at a gitignored path inside the public repo (not sibling, not symlink).
7. **`save-document.ts` immediate-index-update**: DROP the 80-line block at [save-document.ts:326-431](web/netlify/functions/save-document.ts#L326-L431). Rely on `NETLIFY_BUILD_HOOK` trigger at [save-document.ts:434-443](web/netlify/functions/save-document.ts#L434-L443). Saves take ~30s–1min to appear on the live site instead of being instant. Acceptable trade-off.
8. **Private-aware save routing**: Anything that mentions or includes information from a private repo is treated as private and saved to the private content repo. This applies both to documents (via frontmatter `visibility: private`) and to derived files like `repo-locations.md`.
9. **`.mcp.json`**: Template as `.mcp.json.example` with a placeholder path (currently hardcodes `/Users/jamesbeach/.../mcp-server/dist/index.js`). Add `.mcp.json` to `.gitignore`. Document in README.
10. **`wiki/projects/repo-locations.md`**: MOVES to the private content repo. Contains ValueApe (`**Visibility:** private`), absolute local filesystem paths, and inventory-style disclosure of all repos. `save-note.ts` must be updated to target the private content repo accordingly.
11. **`web/public/manifest.json`**: Generic PWA manifest for "Docsy McDocsface" — STAYS in the public repo.
12. **`save-repo-doc.ts`**: Unaffected by migration — commits to external (non-code-wiki) repos.
13. **`full-index.ts`**: Unaffected — fetches `/data/index-full.json` from the deployed CDN URL, which still works post-overlay because Netlify's build merges the private content into `web/public/data/` before publishing.
14. **Visibility-change detection (public↔private repo flips)**: User flagged this as a concern. DEFERRED to Phase 3 (post-taxonomy). A taxonomy layer with `visibility` as a first-class facet makes this a trivial diff check; doing it in Phase 1 means throwaway code.
15. **PAT scope rotation for `REPO_ACCESS_TOKEN`**: During preflight the implementing session discovered that `REPO_ACCESS_TOKEN` lacks full `repo` scope. Today's build log shows `Discovered 26 repos from GitHub (26 public, 0 private)` — `octokit.repos.listForAuthenticatedUser` is returning zero private repos. As a result `repo-locations.md` is missing ~13 private repos (NeoGeoSeo, Datastic, CreatiCoach, StoryLoft, WebToFigma, ambient-gallery, RedditUF, TrollJar, NewsJuicer, JobSearcher, FinGPT, hello, DataScience) and the 11 private repos that DO appear only survive because they were carried forward from older runs. **Rotation deferred until after Phase 1 merges** so the expanded `index-full.json` never lands in public git history.
16. **Stale header bug in `repo-locations.md`**: The "Last updated: 2026-01-27T18:36:17.624Z" line at the top of the generated file is a stale hardcoded literal — the file IS regenerated nightly but the header text isn't refreshed. Fix opportunistically when touching indexBuilder output logic.

---

## Why this phase exists

During the taxonomy design session, we discovered that the current code-wiki architecture commits generated content derived from James's private repos back into the public `code-wiki` repo's git history via two scheduled workflows:

- [`.github/workflows/update-index.yml`](.github/workflows/update-index.yml) — runs daily, commits changes under `web/public/data/`.
- [`.github/workflows/collect-metrics.yml`](.github/workflows/collect-metrics.yml) — runs every 6 hours, commits to both `web/public/data/metrics/` and `mcp-server/data/metrics/`.

The committed artifacts include:
- `index-full.json` (full wiki index including private-visibility docs — protected at the rendered-site level by the auth-gated function, but present in git history for anyone who clones the public repo).
- Per-repo metrics: commit counts, workflow runs, deploy statuses, issue counts, languages — for both public AND private repos.
- Per-category derived JSON files.
- Diagram staleness signals.

The current auth pattern (`full-index.ts`) **gates the served endpoint, not the underlying file.** That's a documented design choice for the current architecture, not a bug — but the user explicitly decided they want stronger separation, and they want the open-source repo to be genuinely clean for forkers.

**The user has decided:** there will be ONE documented architecture going forward (private content in a separate repo), and NO lower-security alternative offered to forkers. Default higher security.

---

## Decisions already made (do not re-litigate)

### Architecture direction
- **One public repo (`code-wiki`) + one private content repo** per user. New private repo will be created for James (suggested name: `code-wiki-content`, but the user may pick something else).
- **`wiki/personal/` pattern is the conceptual precedent.** The new architecture extends the existing nested-private-repo convention already documented in the README's "Personal Wiki Documents" section.
- **Netlify clones both repos at build time** via a fine-grained GitHub PAT stored in Netlify env vars (scoped read-only to just the private content repo).
- **Deployed URL does not change.** `mindfu23code-wiki.netlify.app` stays as-is; only the build command and env vars change on the Netlify site.
- **No alternative "all-in-one" path offered to forkers.** Documented architecture is the single default.

### What moves to the private content repo
- All hand-authored private content (existing `wiki/personal/` content, personal project entries).
- All generated output files currently committed under `web/public/data/` and `mcp-server/data/metrics/`.
- Any future taxonomy content with `visibility: private` (Phase 2 concern, but the repo must exist first).

### What stays in the public code-wiki repo
- All source code (mcp-server/src/, web/src/, web/netlify/functions/).
- Schema definitions, generic (reusable) terms, synthetic examples.
- Workflows (restructured — see below).
- README, documentation, this handoff.

### Decided NOT to do
- **Do not rewrite git history with `git filter-repo` or BFG** unless the user explicitly requests it. History rewriting is destructive and doesn't propagate to forks/caches. Default is Option 1: fix forward, leave existing history as-is.
- **Do not delete and recreate the repo (Option 3).** The user did not choose this. Default is Option 1 unless the user tells a fresh session otherwise.
- **Do not merge Phase 1 and Phase 2 into one large change.** Phase 1 is independently valuable and should ship and be verified before Phase 2 begins.

---

## Complete inventory of files to move

Verified by running `git ls-files` in the public repo. All of these are currently tracked in the public repo and should be moved to the private content repo:

### `web/public/data/` (12 tracked files)
- `index.json`
- `index-full.json`
- `category-diagrams.json`
- `category-general.json`
- `category-integrations.json`
- `category-patterns.json`
- `category-preferences.json`
- `category-projects.json`
- `category-snippets.json`
- `category-templates.json`
- `category-utilities.json`
- `diagram-signals.json`

### `web/public/data/metrics/` (8 tracked files)
- `latest.json`
- `metrics-2026-03-30.json` through `metrics-2026-04-05.json`

### `mcp-server/data/metrics/` (8 tracked files — duplicate of above)
- Same set as `web/public/data/metrics/`. Verified `latest.json` in both locations is byte-identical. Consolidate during migration — decide on a single authoritative location.

### `web/public/manifest.json`
- Verify this is actually a generic web app manifest (it probably is, given the filename pattern) and NOT a file derived from repo data. If generic, leave in public repo. If derived, move.

### `.mcp.json` (at repo root)
- Not verified during the design session. Read it and decide whether it contains local paths or references to private setup. If generic, leave public. If personal, either move or template as `.mcp.json.example`.

**Total: ~28 generated files need to move.**

---

## Step-by-step implementation plan

These steps are ordered for safety — earlier steps are reversible; later steps are harder to undo. Verify after each step before proceeding.

### Step 0: Preflight
1. Read this entire document before touching any code.
2. Read the `code-wiki` README fully (it's ~500 lines). Pay special attention to the "Personal Wiki Documents" section (lines ~391–467) which describes the existing `wiki/personal/` pattern that Phase 1 extends.
3. Read `HANDOFF-taxonomy-design.md` for the broader context on why this matters.
4. Read the existing memory note at `~/.claude/projects/-Users-jamesbeach-Documents-visual-studio-code/memory/project_code_wiki_rearchitecture.md`.
5. Verify the current state of the public repo matches what's documented here — specifically, re-run `git ls-files web/public/data/ mcp-server/data/metrics/` to confirm the file list hasn't drifted.
6. Confirm with the user: (a) the name they want for the private content repo, (b) that they want to proceed with the default "leave git history alone, fix forward" approach.

### Step 1: Read the save-function code
Before doing any migration, read these files to understand what needs changing:
- [web/netlify/functions/save-document.ts](web/netlify/functions/save-document.ts)
- [web/netlify/functions/save-note.ts](web/netlify/functions/save-note.ts)
- [web/netlify/functions/save-repo-doc.ts](web/netlify/functions/save-repo-doc.ts)
- [web/src/indexBuilder.ts](web/src/indexBuilder.ts) (full file — only first 120 lines were read during design)
- [mcp-server/src/scripts/collectMetrics.ts](mcp-server/src/scripts/collectMetrics.ts)
- [web/netlify/functions/full-index.ts](web/netlify/functions/full-index.ts) (already read during design, but re-verify)

The design session did NOT read these in detail, so there may be implementation wrinkles not captured here. **Stop and flag to the user if any of them contain logic that makes the migration significantly harder than the plan below assumes.**

### Step 2: Create the private content repo
1. Create a new **private** GitHub repo on James's account. Suggested name: `code-wiki-content`. Initialize with an empty `README.md` briefly describing its purpose (e.g. "Private content overlay for code-wiki. See code-wiki repo for setup.").
2. Structure it to mirror the public repo's layout at the paths that will be overlaid:
   ```
   code-wiki-content/
   ├── wiki/
   │   ├── personal/              (existing content if any)
   │   ├── projects/              (private project entries)
   │   └── _taxonomy/             (empty, for Phase 2)
   ├── web/
   │   └── public/
   │       └── data/              (generated outputs land here)
   │           └── metrics/
   └── mcp-server/
       └── data/
           └── metrics/           (OR eliminated — see Step 5)
   ```

### Step 3: Copy existing generated files into the new repo
1. On James's local machine, copy the currently committed files from the public repo into the corresponding paths in the new private content repo. Do NOT delete them from the public repo yet.
2. Commit to the private content repo with a first commit like `"initial: import existing generated content from public repo"`.
3. Push to the private remote.

### Step 4: Create a fine-grained GitHub PAT for Netlify
1. Create a fine-grained PAT in James's GitHub account, scoped to ONLY `code-wiki-content` with `Contents: Read` permission. Nothing else.
2. Store it in Netlify environment variables as `PRIVATE_CONTENT_TOKEN` (or similar consistent name).
3. Also add a new env var pointing at the repo: `PRIVATE_CONTENT_REPO=jamesbeach/code-wiki-content` (or whatever it's named).
4. **Do NOT commit the token anywhere.** Never echo it in build scripts. Verify it doesn't appear in Netlify build logs after the first test deploy.

### Step 5: Consolidate duplicate metrics storage
Before migrating the collector, decide which location should be authoritative:
- **Option A:** Keep only `web/public/data/metrics/`. The MCP server reads from this shared location.
- **Option B:** Keep only `mcp-server/data/metrics/`. The web functions fetch from here.
- **Option C:** Keep both, but writes go to ONE location and the other is a symlink or copy. This is the current (implicit, probably accidental) setup.

Recommended: Option A. Delete the `mcp-server/data/metrics/` writes entirely and have the MCP server read from the same location the web uses. This is one fewer write path to maintain.

### Step 6: Write the Netlify build overlay script
Create `scripts/netlify-build.sh` in the public repo, something like:
```bash
#!/bin/bash
set -e

# Clone private content repo
git clone --depth 1 \
  "https://x-access-token:${PRIVATE_CONTENT_TOKEN}@github.com/${PRIVATE_CONTENT_REPO}.git" \
  /tmp/private-content

# Overlay private content onto public tree
rsync -a /tmp/private-content/wiki/ ./wiki/
rsync -a /tmp/private-content/web/public/data/ ./web/public/data/

# Run validator and build as usual
cd web
npm run build
```

Points to verify:
- `set -e` fails the build on any error (including private repo clone failure).
- Token is never echoed.
- Existing build steps still run after overlay.
- **Local dev parity:** decide how `npm run dev` locally will handle this. Simplest path is to clone the private content repo as a sibling directory or as a nested directory at a gitignored path, and have the local dev setup overlay from there. Document in README.

Update Netlify's build command to call `./scripts/netlify-build.sh` instead of `npm run build`.

### Step 7: Restructure `update-index.yml`
The current workflow: checkout → build → commit back to public repo → trigger Netlify. Change to one of two patterns:

- **Pattern A (recommended):** Delete the build step from the Actions workflow entirely. The workflow becomes a thin cron trigger that calls Netlify's build hook on schedule. Netlify runs the build. Workflow shrinks from ~80 lines to ~15 lines.
- **Pattern B:** Keep the build in Actions, but have it write to the private content repo via a write-scoped PAT instead of committing to the public repo. This requires a second PAT with write access to the private content repo.

Pattern A is cleaner because it means generated content is produced by exactly one system (Netlify), not two. Pattern B is a fallback if Netlify's build environment turns out to lack something the current Actions workflow provides.

### Step 8: Restructure `collect-metrics.yml`
Same treatment, but this one is higher-priority because it commits every 6 hours. Read the current workflow at [.github/workflows/collect-metrics.yml](.github/workflows/collect-metrics.yml). The build step runs `node dist/scripts/collectMetrics.js` inside `mcp-server/`.

Options:
- **Pattern A (recommended):** Move metrics collection to run on Netlify as part of the build, OR run it as a scheduled Netlify function (Netlify supports scheduled functions as a feature).
- **Pattern B:** Keep the workflow in Actions, but commit to the private content repo with a write-scoped PAT.

The user may not want metrics coupled to Netlify deploy cadence (which is hook-triggered, not every-6-hours), so Pattern B might actually be right for this one specifically. Confirm with user.

### Step 9: Rewrite save-functions for dual-repo target
The functions currently commit to the public repo. They need to decide PER FILE whether to write to the public or private content repo, based on the file's path.

Proposed logic (in a shared helper):
- If the path is under `wiki/personal/`, `wiki/projects/` (after Phase 2), or any `visibility: private` file → write to private content repo.
- Otherwise → write to public repo.
- Edits to generated files (`web/public/data/*`) should NOT be possible via the UI — those are build outputs. Return an error.
- If the user tries to save a private file and `PRIVATE_CONTENT_REPO` is not configured, return an error explaining how to set it up.

The save-functions currently use the logged-in user's GitHub OAuth token (which has `repo` scope). The same token works for committing to the private content repo IF the user has write access to it, which they do because they own it.

### Step 10: Add gitignore entries and un-track files
In the public repo:
```gitignore
# Generated build outputs (now in private content repo)
web/public/data/index.json
web/public/data/index-full.json
web/public/data/category-*.json
web/public/data/diagram-signals.json
web/public/data/metrics/
mcp-server/data/metrics/
```

Then:
```bash
git rm --cached web/public/data/index.json
git rm --cached web/public/data/index-full.json
git rm --cached web/public/data/category-*.json
git rm --cached web/public/data/diagram-signals.json
git rm -r --cached web/public/data/metrics/
git rm -r --cached mcp-server/data/metrics/
```

Commit with a clear message: `"refactor: move generated artifacts to private content repo"`.

**CRITICAL:** `git rm --cached` removes tracking going forward but does NOT remove the files from disk. The existing files on your local machine are preserved; they just stop being tracked. This is the safe choice. If you want them physically removed from your local machine too (to force re-downloading from the private content repo), do that as a separate manual step after confirming the overlay works.

### Step 11: Update the README
- Replace the "Personal Wiki Documents" section with a new "Private Content Repo" section that documents the new architecture.
- Document the required Netlify env vars: `PRIVATE_CONTENT_REPO`, `PRIVATE_CONTENT_TOKEN`.
- Document the local dev setup (how to clone the private content repo locally alongside the public one).
- Include a short "Is this safe?" section explaining the invariant: public repo never runs with private-repo write credentials; Netlify clones private content at build time only; forkers can optionally not create a private content repo and run with only the public half.
- Update the `wiki/` directory structure diagram to reflect the new layout.

### Step 12: Test deploy
1. Deploy to Netlify with the new setup.
2. Verify the live site at `mindfu23code-wiki.netlify.app` still shows all content correctly.
3. Log in as the owner via GitHub OAuth; verify private content still appears.
4. Log out; verify private content is hidden.
5. Test editing a public file via the web UI; verify it commits to the public repo.
6. Test editing a private file via the web UI; verify it commits to the private content repo.
7. Run `git log` on the public repo after a few hours; verify no bot commits are landing anymore.

### Step 13: Verify local dev
1. On local machine, clone both repos.
2. Run the local build; verify it produces the merged view.
3. Run the MCP server; verify it sees both public and private content.
4. Run `git status` in the public repo; verify no generated files are showing as modified.

### Step 14: Update CLAUDE.md if needed
If the project's [CLAUDE.md](CLAUDE.md) references any of the moved file locations, update those references.

---

## Open questions for the implementing session

These were NOT fully resolved during design and need confirmation before or during implementation:

1. **Name of the private content repo.** Default suggestion: `code-wiki-content`. User may pick something else.
2. **How to handle the metrics-collection workflow** — move to Netlify (Pattern A) or keep in Actions with a write PAT to private repo (Pattern B)? User preference not pinned down.
3. **`.mcp.json` treatment.** Read the file, decide whether it's generic or contains personal references, act accordingly.
4. **`web/public/manifest.json`** verification — is this a generic web manifest or a derived file?
5. **Local dev overlay mechanism** — sibling clone, nested clone in a gitignored path, or symlink? The choice affects documentation but not correctness.
6. **Whether to consolidate `mcp-server/data/metrics/` into `web/public/data/metrics/`** (Step 5). Recommended yes; user has not explicitly confirmed.

---

## Out of scope for Phase 1

Do NOT do any of these during Phase 1:
- Taxonomy layer implementation (that's Phase 2 — `HANDOFF-taxonomy-v1.md`).
- Rewriting git history to remove old committed generated content. Default is "leave history alone, fix forward" unless the user explicitly asks for a rewrite.
- Changing the auth-gated function pattern. `full-index.ts` stays as-is; its serving behavior is unchanged.
- Any UI/UX redesign. This is a plumbing refactor only.
- Introducing new features. Phase 1's job is "current behavior, cleaner architecture."

---

## Success criteria

Phase 1 is done when:
1. No new commits from `github-actions[bot]` land in the public repo. (`git log --author="github-actions" --since="1 week ago"` returns empty a week after the switch.)
2. `git ls-files` on the public repo returns no files under `web/public/data/*.json` or `mcp-server/data/metrics/`.
3. The deployed site at `mindfu23code-wiki.netlify.app` still works correctly for both authenticated and unauthenticated visitors.
4. Editing both public and private content via the web UI works and commits to the correct repo.
5. README documents the new architecture and a fresh forker could follow it to set up their own deployment.
6. Local MCP server sees both public and private content merged.

Only after ALL six are verified should Phase 2 (taxonomy) begin.

---

## First-message prompt for a fresh session

A focused opening for the implementing session:

> *"I'm doing Phase 1 of the code-wiki rearchitecture. Read `HANDOFF-rearchitecture.md` at the repo root for the full plan. Then before any code changes, read the README, the save-function files, and the full `indexBuilder.ts`. Confirm my intended private content repo name and the default Option 1 (leave git history alone) before doing anything destructive. Step through the plan one step at a time; pause at each step for verification before proceeding."*
