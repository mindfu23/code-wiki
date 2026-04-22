# Code Wiki — Visibility-Change Migration

**Created:** 2026-04-22
**Purpose:** Handle the case where a wiki entry's visibility changes between public and private, so the file ends up in the correct repo and no stale duplicate is left behind. Also: sync visibility facet to GitHub repo reality when a repo flips public↔private on GitHub itself.

> Forward-looking handoff. Called out as deferred Phase 3 work in `HANDOFF-rearchitecture.md` decision #14; now unblocked because the taxonomy layer exists.

---

## The problem

The private-content-repo architecture (`HANDOFF-rearchitecture.md` Phase 1) + the visibility-aware save-function patch (this session) together handle most routing cleanly. But two gaps remain:

### Gap 1: Wiki-level visibility flip leaves a stale duplicate

The recently patched `web/netlify/functions/save-document.ts` routes a document to the private content repo when its frontmatter declares `visibility: private`. But if the document **already exists** in the public repo under the same path, the patch only writes the new version to the private repo — it doesn't remove the old copy. End state: same file lives in both repos, with stale content in public.

Reverse direction (private → public) has the same issue.

### Gap 2: GitHub visibility changes don't propagate to the taxonomy

The taxonomy's `visibility` facet is declared manually in wiki frontmatter. If a GitHub repo flips from public to private (or vice versa), nothing in the build pipeline reconciles the wiki entry with GitHub's new reality. Eventually the wiki claims a repo is public when GitHub says otherwise, or leaks private-repo metadata through the public site's index.

---

## Scope split

These are distinct features with different complexity profiles. **Do Gap 1 first; defer Gap 2 as a separate phase.**

---

## Gap 1: Wiki-level visibility migration

### Detection

The save-function already knows the target repo based on the *new* content. What's missing: checking whether the same path exists in the *other* repo (the one that's no longer the target).

```
Given: request.path = "wiki/projects/example.md", visibility flipped to private
  1. targetRepo = PRIVATE_CONTENT_REPO (from new content's frontmatter)
  2. oldRepo   = GITHUB_REPO_NAME (the public repo)
  3. Before writing: check if oldRepo has a file at the same path
  4. If yes: this is a migration — remember to delete from oldRepo after writing
```

### Migration flow

Sequenced for safety — the destination write happens before the source delete, so a partial failure leaves the content preserved (possibly duplicated), never lost:

1. User saves document via UI with visibility flip
2. Save function detects migration scenario (file exists in old repo at same path)
3. Commit new content to new repo (normal write path)
4. If step 3 succeeds → commit deletion of old file from old repo, attributed to same user, with commit message like `"Migrate to private content repo: {path}"`
5. Return response flagging `migration: true` so the UI can confirm

If step 3 fails: return error, no migration attempted.
If step 3 succeeds but step 4 fails: return warning to the user that the new file was written but the old one needs manual cleanup. Include both SHAs in the response so the user (or a follow-up automation) can complete the migration.

### UI affordance

When a user toggles `visibility` in an edit session, the UI should surface an explicit confirmation before save:

> *"This document's visibility is changing from public to private. Saving will commit to the private content repo and delete the copy from the public repo. Continue?"*

This prevents accidental migrations and makes the behavior auditable.

### Implementation scope

- `web/netlify/functions/save-document.ts` — extend with old-repo existence check + secondary delete call
- `web/public/app.js` (or wherever the edit UI lives) — detect visibility frontmatter change vs. server copy; show confirmation
- Decide: should the save function surface a `--force` equivalent to skip UI confirmation when driven programmatically? Leaning no — keep the save function dumb; UI owns the confirmation.

### Effort estimate

~Half-day. Clean extension of the existing patched save-function. No new infrastructure.

---

## Gap 2: GitHub repo visibility sync (deferred)

### Why this is separate

Gap 1 is reactive (responds to user edits). Gap 2 is proactive (responds to GitHub state changes). Different trigger model, different failure modes, different complexity.

### Detection

The index builder at `web/src/indexBuilder.ts` already queries GitHub via `octokit.repos.listForAuthenticatedUser` and knows each repo's current visibility. Add a comparison step:

- For each wiki entry with a `source_repo` field, find the matching GitHub repo in the index builder's output
- Compare the entry's `visibility` facet with the GitHub repo's current visibility
- If they disagree, record drift in a new file (e.g. `code-wiki-content/web/public/data/visibility-drift.json`)

### Reconciliation options

Three paths, ranked from safest to most automated:

| Path | Behavior | Effort | Risk |
|---|---|---|---|
| A | Report drift only; surface in the admin view | Low | None |
| B | Report drift + auto-open a PR with the frontmatter fix | Medium | Agent opens spurious PRs on transient flips |
| C | Auto-commit the fix to the wiki entry | High | Silent changes are surprising |

**Recommendation: start with Path A.** If a repo's visibility is flipped deliberately, the owner can update the wiki entry themselves; if accidentally, the drift report is early warning.

Path A composes naturally with Gap 1: once the user accepts the drift and updates the frontmatter, Gap 1's migration flow moves the file to the correct repo.

### Implementation scope (Path A)

- `web/src/indexBuilder.ts` (or a new script) — emit `visibility-drift.json` during daily index build
- `web/public/app.js` — surface drift on the admin/owner view
- Decide: which principal is expected to act on drift reports? Keeping it at a report level avoids that decision.

### Effort estimate

~1 day for Path A. Path B or C would add ~1–2 days and require permission-scoping decisions.

---

## Sequencing recommendation

1. **Phase A (Gap 1): Wiki-level migration.** Small, bounded, immediately useful. Unblocks clean visibility toggles in the UI.
2. **Pause and use the system for a few weeks.** See how often visibility flips actually happen in practice; decide whether Gap 2 is worth the work based on observed drift.
3. **Phase B (Gap 2, Path A if pursued): Drift reporting.** Only after you have a real signal that visibility drift happens in practice.

---

## Non-goals

- Rewriting git history when a wiki entry migrates. The file appears in the new repo's history going forward; the old repo's history retains the old version. That matches the Phase 1 decision (`HANDOFF-rearchitecture.md` decision #2: fix-forward, no history rewrite).
- Migrating entire directories at once (bulk visibility change). User operates one file at a time via the UI.
- Handling visibility changes on generated content (indexes, metrics). Those are rebuilt, not migrated.

---

## Success criteria — Phase A only

1. Editing a wiki entry in the UI and flipping `visibility: public → private` commits to the private repo AND deletes from the public repo in a single save action
2. The UI confirmation explicitly describes what will happen before the save
3. If any step of the migration fails, the user sees a specific error, not silent partial success
4. Reverse direction (`private → public`) works symmetrically
5. No path-traversal or authorization escalation introduced (test with mis-scoped paths)

---

## First-message prompt for implementing session

> *"Implement Phase A of HANDOFF-visibility-migration.md (Gap 1 only). Read the full doc first. Before code changes, confirm with the user: (1) whether the UI should always show a confirmation or only on visibility flips, and (2) whether reverse direction (private → public) should be enabled in v1 or deferred. Extend web/netlify/functions/save-document.ts and the edit UI, nothing else. Phase B (Gap 2) is out of scope for this session."*
