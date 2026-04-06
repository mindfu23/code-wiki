# Docsy McDocsface

A personal code wiki with MCP server integration for AI agents. Provides searchable documentation across GitHub repositories with curated wiki content.

## Features

- **GitHub-based indexing**: Indexes documentation files from your GitHub repositories, with GitHub as the source of truth for existence, canonical name, and visibility
- **Web interface**: Search and browse wiki content and repo documentation
- **Curated wiki**: Store reusable patterns, utilities, and snippets
- **MCP integration**: AI agents can search and retrieve code via MCP tools
- **Automatic updates**: GitHub Actions rebuilds the index daily or on changes
- **Observatory**: Cross-project infrastructure health dashboard aggregating GitHub and Netlify metrics, including per-repo lifecycle-stage classification (stub → scaffold → in-progress → deployed → mature, plus stale/abandoned/reference)
- **Flows**: Per-project Mermaid architecture diagrams with automatic staleness detection

## Web Interface

The web interface at [your-site.netlify.app](https://your-site.netlify.app) provides:

- Full-text search across wiki documents
- Search across documentation files in GitHub repos (toggle on by default)
- Click-to-edit: Search results link directly to GitHub's edit page
- Category browsing for wiki content
- Repository documentation browser

### Automatic Repository Discovery

When you set `GITHUB_USERNAME` (or `GITHUB_REPO_OWNER`) and `GITHUB_TOKEN`, the index builder **automatically discovers all your GitHub repositories**:

- **No manual listing required**: All public and private repos are found automatically
- **Correct visibility on first build**: Public/private status comes directly from GitHub
- **Stays in sync**: Changes to repo visibility on GitHub are picked up on next build

The `wiki/projects/repo-locations.md` file is optional - use it only if you need to add local paths or notes to specific repos. Note: this file now lives in the private content repo (see [Private Content Repo](#private-content-repo) below).

### How Syncing Works

The index builder treats GitHub as the authoritative source of truth and layers local data from `wiki/projects/repo-locations.md` on top of it. The merge is designed to handle the common drift cases that naive name-matching gets wrong:

1. **Renamed repos are detected automatically.** When you rename a repo on GitHub (e.g. `BookLarner` → `CoverJudge`), the old name may still exist as a stale entry in `repo-locations.md` or via a local checkout whose git remote points at the old URL. The builder resolves any unmatched entry through the GitHub API; since GitHub returns the canonical current name after following its rename redirect, the builder recognizes the match, attaches the old name as an alias on the canonical entry, and avoids creating a phantom duplicate. Console output: `Merged stale alias "OldName" into "NewName" (renamed or duplicate remote)`.

2. **Unseen-in-API entries get their real visibility from GitHub, not a default.** Previously, any local entry whose GitHub URL wasn't returned by the authenticated user's repo listing was blindly marked `visibility: private`. That misclassified renamed public repos. The builder now makes a direct `repos.get` call on orphan entries, so visibility reflects what GitHub actually reports. Only entries that 404 or fail to resolve fall back to the private default.

3. **De-dupes local checkouts by canonical GitHub URL, not folder name.** If two local directories both have git remotes pointing at the same GitHub repo (for example, a scratch clone alongside your primary working copy), they collapse into a single merged entry. The canonical entry uses the GitHub repo's name, and both local paths are preserved in a new `localPaths` array on `RepoInfo`. Console output: `Associated local "scratch-copy-name" with GitHub repo "canonical-name" via shared URL`.

A "local-only" repo still means a directory with no git remote at all — these continue to be skipped from the indexed list (the console shows `Skipping N local-only repos (not on GitHub)`). A directory with a remote, even a stale or incorrect one, is treated as belonging to whichever canonical repo that URL resolves to after the API pass.

### Running the Index Builder

```bash
cd web
npm install
GITHUB_USERNAME=your-username GITHUB_TOKEN=$(gh auth token) npm run build:index
```

This automatically discovers all repos for your GitHub user and fetches their documentation files.

### Supported File Types

The indexer finds these documentation file types in your repos:

| Extension | Format |
|-----------|--------|
| `.md` | Markdown |
| `.txt` | Plain text |
| `.rst` | reStructuredText |
| `.adoc`, `.asciidoc` | AsciiDoc |
| `.org` | Org Mode |

Note that when using this app as an index for local agents and MCPs, you should git pull the latest updated index before starting in order to have the latest information for all the repos in your account. 

## Setup

### Web Interface Setup

1. **Fork this repository** and deploy to Netlify

2. **Your repos are discovered automatically** - just set `GITHUB_USERNAME` in environment variables (step 3). Optionally, add local paths or notes to `wiki/projects/repo-locations.md`:
   ```markdown
   ### my-project
   - **Local Path:** `/path/to/my-project`
   - **Notes:** My personal notes about this project
   ```

3. **Set environment variables** in Netlify Dashboard → Site settings → Environment variables:

   > **Note:** These Netlify environment variables are different from GitHub repository secrets (step 5). Netlify vars are used by the web app; GitHub secrets are used by GitHub Actions.

   **Required:**
   | Variable | Description |
   |----------|-------------|
   | `GITHUB_REPO_OWNER` | Your GitHub username - used for repo discovery AND edit authorization |
   | `GITHUB_TOKEN` | Personal access token with `repo` scope - enables auto-discovery of all your repos. Create at [GitHub Developer Settings](https://github.com/settings/tokens). |

   **Required for editing features:**
   | Variable | Description |
   |----------|-------------|
   | `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
   | `GITHUB_CLIENT_SECRET` | GitHub OAuth App secret |
   | `SESSION_SECRET` | Random 32+ character string for session encryption |

   **Private content repo (recommended):**
   | Variable | Description |
   |----------|-------------|
   | `PRIVATE_CONTENT_TOKEN` | Fine-grained PAT with Contents: Read-only, scoped to your private content repo |
   | `PRIVATE_CONTENT_REPO` | Owner/repo for private content (e.g. `yourname/code-wiki-content`) |

   See [Private Content Repo](#private-content-repo) below for full setup.

   **Optional:**
   | Variable | Description |
   |----------|-------------|
   | `GITHUB_REPO_NAME` | Repository name (default: `code-wiki`) |
   | `NETLIFY_ACCESS_TOKEN` | For Netlify site listing in Quick View |
   | `NETLIFY_BUILD_HOOK` | Trigger rebuild after edits |
   | `PRIVATE_REPO_ACCESS` | Access mode for private repos (see below) |

   **Generate a session secret:**
   ```bash
   openssl rand -hex 32
   ```

   **Create a GitHub OAuth App:**
   1. Go to GitHub → Settings → Developer settings → OAuth Apps → New
   2. Set Homepage URL to your Netlify site URL
   3. Set Authorization callback URL to: `https://your-site.netlify.app/.netlify/functions/oauth-callback`

4. **GitHub Actions** automatically rebuilds the index:
   - Daily at midnight UTC
   - When `repo-locations.md` changes
   - Or trigger manually from the Actions tab

5. **(Recommended) Enable auto-discovery in GitHub Actions** - Add a Personal Access Token as a repository secret:

   **Create the token:**
   1. Go to [GitHub Developer Settings → Personal Access Tokens](https://github.com/settings/tokens)
   2. Click **"Generate new token"** → **"Generate new token (classic)"**
   3. Give it a descriptive name (e.g., "code-wiki auto-discovery")
   4. Select the **`repo`** scope (full control) - this is required to discover ALL your repos including private ones
   5. Click "Generate token" and copy it immediately

   **Verify your token:** A correct fine-grained PAT starts with `github_pat_`. Classic tokens start with `ghp_`.

   **Add as a repository secret:**
   1. Go to your code-wiki repo → **Settings** → **Secrets and variables** → **Actions**
   2. Click **"New repository secret"**
   3. Name: `REPO_ACCESS_TOKEN`
   4. Value: Paste your token (starting with `github_pat_` or `ghp_`)
   5. Click "Add secret"

   **Why this is needed:** The default `GITHUB_TOKEN` in Actions only has access to the current repository. `REPO_ACCESS_TOKEN` allows the workflow to list ALL your repositories for auto-discovery.

   Without this secret, GitHub Actions will fall back to using repos listed in `repo-locations.md`.

   **Additional Actions secret for private content repo:**
   | Secret | Description |
   |--------|-------------|
   | `PRIVATE_CONTENT_WRITE_TOKEN` | Fine-grained PAT with Contents: Read and write, scoped to your private content repo |

   This token allows the GitHub Actions workflows (`update-index.yml`, `collect-metrics.yml`) to commit generated content to the private content repo instead of the public repo. See [Private Content Repo](#private-content-repo) for details.

### Private Repository Visibility

Private repositories are **automatically detected** and hidden from unauthenticated visitors. When you set `GITHUB_REPO_OWNER` and `GITHUB_TOKEN`:
- All your repos (public AND private) are discovered automatically
- Visibility is pulled directly from GitHub - no manual marking needed
- Changes to repo visibility on GitHub sync on next build

**Choose an access mode** via `PRIVATE_REPO_ACCESS` env var:

   | Mode | Description |
   |------|-------------|
   | `owner-only` (default) | Only the wiki owner (`GITHUB_REPO_OWNER`) sees private repos |
   | `github-permissions` | Users see private repos they have GitHub access to |

   **owner-only** (recommended):
   - Fast - no API calls needed
   - Simple - you control visibility via `GITHUB_REPO_OWNER`
   - Best for personal wikis

   **github-permissions**:
   - Dynamic - respects GitHub collaborator permissions
   - Slower - requires GitHub API calls on each page load
   - Best for team wikis where multiple people need access

**How it works:**
- Public visitors see only public repos (from static `index.json`)
- When logged in, the app fetches from `/.netlify/functions/full-index`
- The endpoint filters repos based on the access mode

**Troubleshooting: Private repos not appearing when logged in**

Open your browser's developer console (F12) and look for the log message:
```
Loaded full index (owner-only, isOwner: true)
```

If `isOwner: false`, your GitHub username doesn't match `GITHUB_REPO_OWNER`:
1. Check `GITHUB_REPO_OWNER` in Netlify environment variables
2. Ensure it matches your GitHub login exactly (case-insensitive)
3. Redeploy after changing

### MCP Server Setup (Optional)

The MCP server provides local code search for AI agents like Claude Code.

1. **Install dependencies**:
   ```bash
   cd mcp-server
   npm install
   ```

2. **Configure environment** - Edit `mcp-server/.env`:
   ```bash
   SOURCE_DIRS=/path/to/your/repos,/another/path
   WIKI_DIR=/path/to/code-wiki/wiki
   GITHUB_USERNAME=your-username
   GITHUB_TOKEN=ghp_xxx  # Optional, for private repos
   ```

3. **Build the server**:
   ```bash
   cd mcp-server
   npm run build
   ```

4. **Configure Claude Code** - Copy `.mcp.json.example` to `.mcp.json` and update the path:
   ```bash
   cp .mcp.json.example .mcp.json
   # Edit .mcp.json to set the correct absolute path to mcp-server/dist/index.js
   ```

5. **Install ripgrep** (recommended for fast local search):
   ```bash
   brew install ripgrep
   ```

## Observatory — Project Health Dashboard

The Observatory provides infrastructure observability across all your projects, accessible from the "Observatory" nav link. It aggregates data from GitHub and Netlify APIs into a unified health dashboard.

### Features

- **Project Health Matrix** — sortable table showing deploy status, GitHub Actions status, open issues (linked to GitHub), and deploy success rate for every project
- **Language Distribution chart** — doughnut chart of languages across all projects
- **Deploy Status chart** — bar chart of healthy/warning/error/not-deployed counts, with status message when all deploys are healthy
- **Access-controlled** — unauthenticated visitors see only public repos; the wiki owner (authenticated via GitHub OAuth) sees all repos including private
- **Secret sanitization** — the index builder automatically strips known API key patterns (OpenAI, HuggingFace, GitHub PATs, Netlify tokens, etc.) and skips conversation log files (SpecStory, chat history) to prevent accidental credential exposure
- **MCP tools** — `project_health`, `deploy_status`, and `infra_overview` tools for querying project metrics from Claude Code
- **Bronze data export** — `export-bronze` endpoint serves raw metrics as JSON/NDJSON for Databricks ingestion
- **Automated collection** — GitHub Actions workflow collects metrics every 6 hours and commits snapshots for historical analysis
- **Databricks integration guide** — wiki doc with full medallion architecture (bronze → silver → gold) setup for Databricks Community Edition

### Observatory Environment Variables

Set these in your Netlify dashboard and/or `.env` file:

| Variable | Description | Required |
|----------|-------------|----------|
| `NETLIFY_ACCESS_TOKEN` | Netlify Personal Access Token for deploy status | For deploy monitoring |
| `CF_API_TOKEN` | Cloudflare API token | Phase 2 |
| `CF_ACCOUNT_ID` | Cloudflare account ID | Phase 2 |
| `GCP_SERVICE_ACCOUNT_KEY_PATH` | Path to GCP service account JSON | Phase 2 |
| `SUPABASE_ACCESS_TOKEN` | Supabase management API token | Phase 2 |
| `N8N_API_URL` | n8n instance URL | Phase 2 |
| `N8N_API_KEY` | n8n API key | Phase 2 |

> Further observability improvements (Cloudflare Workers analytics, GCP Cloud Run metrics, Supabase monitoring, n8n workflow tracking, historical trend charts) are TBD — see `TODO.md` for the roadmap.

### Completion Stage — lifecycle classification per project

The Project Health Matrix includes a **Completion** column that classifies each repo into one of eight lifecycle stages. The classifier combines static structural signals collected from each repo's file tree (at index build time) with live deploy and activity metrics pulled by the Observatory collectors (at request time). Every classification carries a tooltip listing the contributing reasons so the judgment is always traceable back to the underlying data.

#### The eight stages

| Stage | Color | Meaning |
|---|---|---|
| **Mature** | dark green | Deployed, healthy, actively maintained, CI passing, high deploy success rate |
| **Deployed** | green | Shipped and reachable; stable but not necessarily polished |
| **In Progress** | amber | Real source code and recent commits, but no working deploy yet |
| **Scaffold** | blue | Project initialized — README, package manifest, maybe some code — but not yet substantial |
| **Stub** | gray | Idea placeholder with almost no structure (no README, no manifest, no source) |
| **Reference** | purple | Docs-only repository (README + markdown, no source code) — classified separately so reference material doesn't get mis-labeled as abandoned |
| **Stale** | orange | Was deployed at some point, but no commits in 90+ days |
| **Abandoned** | red | Started but never shipped, and no activity in 180+ days |

#### The rubric

Each repo is scored on four axes, with every "+1" contributing a human-readable entry to the tooltip's reasons list:

**Scaffold (0–4)** — does this exist as a project at all?
- +1 has README at repo root
- +1 has a description
- +1 has a package manifest (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `composer.json`, `pubspec.yaml`) — root **or** one level deep, so monorepo layouts like `web/package.json` are detected
- +1 has at least one source file

**Implementation (0–3)** — has real work been done beyond scaffolding?
- +1 source file count ≥ 5
- +1 source file count ≥ 20 (non-trivial size)
- +1 committed in the last 90 days

**Deployed (0–4)** — is it reachable by users?
- +1 has a deploy config file (`netlify.toml`, `vercel.json`, `Dockerfile`, `fly.toml`, `app.yaml`, `railway.toml`, `render.yaml`, `wrangler.toml`, `serverless.yml`) — root or one level deep
- +1 has a live deploy platform detected by the Observatory (Netlify in Phase 1; Cloudflare/GCP/Supabase in Phase 2)
- +1 current deploy status is healthy
- +1 deploy success rate ≥ 80%

**Maintained (0–4)** — is someone still actively working on it?
- +1 committed in the last 30 days
- +1 CI passing (or `.github/workflows/` present when live CI status is unavailable)
- +1 fewer than 5 open issues
- +1 deployed in the last 30 days, **or** project has no deploy platform (non-deployed projects aren't penalized on deploy recency)

#### Stage selection

The four axis scores plus commit and deploy recency are combined into a single stage using this order of checks (first match wins):

1. **Reference** — has README, zero source files, no package manifest (pure docs repo)
2. **Abandoned** — no commits in 180+ days and deployed < 2
3. **Stale** — no commits in 90+ days but deployed ≥ 2
4. **Mature** — maintained ≥ 3 and deployed = 4 (all four deploy signals present)
5. **Deployed** — deployed ≥ 2 and maintained ≥ 2
6. **In Progress** — implementation ≥ 2
7. **Scaffold** — scaffold ≥ 2
8. **Stub** — everything else

The ordering is deliberately "worst-first" for inactivity signals (abandoned, stale) and "best-first" for positive signals (mature, deployed), so a project that was once shipped but is now silent surfaces as stale rather than being generously counted as deployed.

#### Where the data comes from

- **Static signals** (sentinels, source file count, package manifest, deploy config, CI, tests, env example) are detected during the normal index build in the same tree traversal that already collects doc files — zero extra API calls. They're written to `index-full.json` / `index.json` as a `sentinels` object on each repo entry, plus a baseline `completion` assessment.
- **Live signals** (deploy status, deploy success rate, actions status, open issues, last deploy date) are pulled by the Observatory's `dashboard-data` function per request and used to refine the baseline assessment. This means the Completion column reflects *current* platform state, not just what was true at the last index build.
- **MCP exposure** — the `sentinels` and `completion` fields are part of the public `RepoInfo` type, so they're automatically available to any MCP tool that queries the wiki index. Agents can ask "which of my projects are stale?" without re-deriving the rubric.

#### Caveats

The rubric is heuristic and has predictable failure modes:

- **Subfolder deploys** beyond one level deep (e.g. `services/backend/deploy/Dockerfile`) won't be detected. Move the config up or add a root-level marker file.
- **Private infrastructure** not yet covered by Observatory collectors (Cloudflare Workers, GCP Cloud Run, Supabase projects, mobile app store submissions) will undercount on the deployed axis until those collectors ship. The static `hasDeployConfig` signal provides a partial credit of 1/4 in the meantime.
- **Forks and scratch clones** (now correctly de-duped by the URL-based merge) appear once under the canonical repo, so their aliases don't distort the pipeline view.
- **Unusual project layouts** (documentation-only with source, CI-only repos, asset repositories) may classify in counterintuitive ways — the tooltip's reasons list is the fastest way to understand any surprising result.

The classifier's job isn't to be right in every case — it's to be *consistently wrong in understandable ways* so that when a stage looks off, you can trace it to a rule in [web/src/completionAssessment.ts](web/src/completionAssessment.ts) and either correct the data or adjust the rubric.

## Flows — Project Architecture Diagrams

The Flows page provides per-project Mermaid architecture diagrams, accessible from the "Flows" nav link. Each diagram is a hand-curated or AI-generated snapshot of a project's data flow, component boundaries, and external integrations, saved as a markdown file with a fenced Mermaid block.

### Features

- **Per-project diagrams** — each repo with a registered diagram gets its own Flows entry at `wiki/diagrams/{id}-flow.md`. The page renders the Mermaid client-side so diagrams remain version-controlled as plain text.
- **Stack filtering** — diagrams are tagged with stack metadata (React, Python, Go, Tauri, WordPress, etc.) and the Flows page offers one-click filters to narrow the list by stack.
- **Automatic staleness detection** — `npm run build:signals` runs `src/diagramSignals.ts`, which hashes structural signals for each diagrammed project (dependency names from `package.json` / `requirements.txt`, function files under `netlify/functions/`, top-level `src/` directories) and compares them against the last stored snapshot. When signals change, the diagram is flagged as stale so the owner knows to regenerate it.
- **Visibility auto-detection** — diagrams inherit their project's visibility from the index merge described above, so private-repo diagrams only appear when the owner is authenticated.
- **GitHub Actions integration** — staleness checks can run on a schedule (e.g. nightly alongside the index rebuild) and write `public/data/diagram-signals.json`, which the Flows UI consumes to show per-diagram stale/fresh state.

### Adding a New Project Diagram

1. Add an entry to `PROJECT_DIAGRAMS` in `web/public/app.js` with `repoName` matching the GitHub repo name, plus its stack tag.
2. Create `wiki/diagrams/{id}-flow.md` containing a fenced ```` ```mermaid ```` block with the diagram source.
3. Add the repo to `DIAGRAM_REPOS` in `web/src/diagramSignals.ts` so staleness detection starts tracking it.
4. Run `npm run build` in `web/` to refresh both the index and the staleness signals, then commit the generated JSON output.

### Flows Environment Variables

`build:signals` uses the same `GITHUB_TOKEN` and `GITHUB_USERNAME` as the main index builder — no additional configuration is required.

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_wiki` | Search curated wiki content |
| `search_repos` | Full-text search across all repositories |
| `get_document` | Fetch a wiki document with frontmatter |
| `get_file` | Fetch any file from any repository |
| `list_repos` | List all indexed repositories |
| `list_category` | List wiki category contents |
| `sync_repos` | Trigger GitHub sync |
| `project_health` | Per-project health: commits, deploys, CI/CD, conventions |
| `deploy_status` | Deploy status filtered by project or platform |
| `infra_overview` | Aggregated infrastructure health summary |

## Wiki Structure

```
wiki/
├── AGENTS.md          # Instructions for AI agents
├── personal/          # Personal docs (separate local git repo, gitignored)
│   ├── preferences/   #   Tech stack, deployment guides, etc.
│   ├── projects/      #   Personal to-do lists, project notes
│   └── snippets/      #   Personal code snippets
├── patterns/          # Architectural patterns (public scaffolding)
├── utilities/         # Helper functions (public scaffolding)
├── integrations/      # API connectors (public scaffolding)
├── templates/         # Project starters (public scaffolding)
├── snippets/          # Code snippets (public scaffolding)
├── diagrams/          # Per-project Mermaid architecture diagrams
└── projects/          # Project docs (public scaffolding)
```

## Private Content Repo

All generated content derived from your GitHub account (indexes, metrics, repo inventory) lives in a **separate private repository**, not in this public repo. This ensures that private repo names, local filesystem paths, and other sensitive data never appear in the public repo's git history.

### Architecture

```
code-wiki (public)              code-wiki-content (private)
├── web/src/                    ├── web/public/data/
│   └── indexBuilder.ts         │   ├── index.json
├── web/netlify/functions/      │   ├── index-full.json
├── web/scripts/                │   ├── category-*.json
│   └── netlify-build.sh        │   ├── diagram-signals.json
├── wiki/                       │   └── metrics/
│   ├── patterns/               │       ├── latest.json
│   ├── snippets/               │       └── metrics-YYYY-MM-DD.json
│   └── ...                     ├── wiki/projects/
├── .github/workflows/          │   └── repo-locations.md
│   ├── update-index.yml        └── README.md
│   └── collect-metrics.yml
└── mcp-server/
```

**How it works:**
- **GitHub Actions** runs the index builder and metrics collector on schedule, then commits the generated output to the private content repo via `PRIVATE_CONTENT_WRITE_TOKEN`.
- **Netlify** clones the private content repo at build time (via `PRIVATE_CONTENT_TOKEN`) and overlays it onto the public tree before compiling functions. The overlay script is at `web/scripts/netlify-build.sh`.
- **The public repo never runs with private-repo write credentials.** Netlify clones private content read-only at build time; forkers can skip the private content repo entirely and run with only the public half.
- **No generated files are tracked in the public repo.** They are gitignored and only exist in the private content repo.

### Setting Up the Private Content Repo

1. **Create a private GitHub repo** (e.g. `code-wiki-content`) with this structure:
   ```
   code-wiki-content/
   ├── web/public/data/
   │   └── metrics/
   ├── wiki/projects/
   └── README.md
   ```

2. **Create two fine-grained PATs:**
   - **Read token** (for Netlify builds): Contents: Read-only, scoped to `code-wiki-content`
   - **Write token** (for Actions workflows): Contents: Read and write, scoped to `code-wiki-content`

3. **Add environment variables to Netlify:**
   | Variable | Value |
   |----------|-------|
   | `PRIVATE_CONTENT_TOKEN` | The read PAT (secret) |
   | `PRIVATE_CONTENT_REPO` | `yourname/code-wiki-content` |

4. **Add secret to GitHub Actions** (code-wiki repo → Settings → Secrets → Actions):
   | Secret | Value |
   |--------|-------|
   | `PRIVATE_CONTENT_WRITE_TOKEN` | The write PAT |

5. **Deploy** — the next Netlify build will clone the private content repo and overlay it.

### Local Development

For local development, clone the private content repo into a gitignored path inside the public repo:

```bash
cd /path/to/code-wiki
git clone git@github.com:yourname/code-wiki-content.git private-content
```

The `private-content/` directory is gitignored. To run the index builder locally with private content:

```bash
cd web
WIKI_DIR=../wiki GITHUB_USERNAME=yourname GITHUB_TOKEN=$(gh auth token) npm run build:index
```

The MCP server reads metrics from `web/public/data/metrics/` — after a local build, the files will be in place.

### Is This Safe?

- The public repo **never** contains private repo names, local paths, or generated metrics in its git history (going forward from the Phase 1 rearchitecture).
- Netlify clones private content **read-only** at build time. The token has no write access.
- GitHub Actions writes to the private content repo via a **separate write-scoped token** that only has access to `code-wiki-content`.
- **Forkers** can skip the private content repo entirely. The overlay script gracefully handles missing `PRIVATE_CONTENT_TOKEN` — it prints a message and continues with the public-only build.

## Personal Wiki Documents

The `wiki/personal/` directory holds personal documents (tech stack preferences, project notes, code snippets). It is:

- **Gitignored** by the parent repo
- **Its own local git repo** — full version control independent of the parent
- **Automatically indexed** — the index builder scans it and assigns categories by subdirectory name
- **Private by default** — all docs are marked `visibility: private`

### Setting Up Personal Docs (after forking)

```bash
mkdir -p wiki/personal/{preferences,projects,snippets}
cd wiki/personal
git init
```

Add markdown files, commit in the personal repo, then rebuild the index.

### Claude Code / MCP Integration

To make preference docs available to Claude Code via the MCP server's `get_preferences` tool:

```bash
ln -s /path/to/code-wiki/wiki/personal/preferences ~/.claude/preferences
```

## Adding Wiki Content

Create markdown files with YAML frontmatter:

```markdown
---
title: "API Client Pattern"
tags: ["typescript", "api", "fetch"]
language: "typescript"
updated: "2025-01-27"
---

# API Client Pattern

Your content here...
```

## Development

```bash
# Watch mode
npm run dev

# Type checking
npm run typecheck

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```
