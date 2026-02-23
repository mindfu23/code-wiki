# Docsy McDocsface

A personal code wiki with MCP server integration for AI agents. Provides searchable documentation across GitHub repositories with curated wiki content.

## Features

- **GitHub-based indexing**: Indexes documentation files from your GitHub repositories
- **Web interface**: Search and browse wiki content and repo documentation
- **Curated wiki**: Store reusable patterns, utilities, and snippets
- **MCP integration**: AI agents can search and retrieve code via MCP tools
- **Automatic updates**: GitHub Actions rebuilds the index daily or on changes

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

The `wiki/projects/repo-locations.md` file is optional - use it only if you need to add local paths or notes to specific repos.

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

4. **Configure Claude Code** - Add to `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "code-wiki": {
         "command": "node",
         "args": ["/path/to/code-wiki/mcp-server/dist/index.js"]
       }
     }
   }
   ```

5. **Install ripgrep** (recommended for fast local search):
   ```bash
   brew install ripgrep
   ```

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
└── projects/          # Project docs (public scaffolding + repo-locations.md)
```

## Personal Wiki Documents

The `wiki/personal/` directory holds all your personal documents — things like tech stack preferences, project to-do lists, and code snippets that you don't want in the public open-source repo. It is:

- **Gitignored** by the parent repo — your personal docs won't be pushed to your fork's public remote
- **Its own local git repo** — your docs have full version control (history, diffs, branching)
- **Automatically indexed** — the index builder scans `wiki/personal/` and assigns categories based on subdirectory names (e.g., `personal/projects/` → category "projects")
- **Private by default** — all docs in `wiki/personal/` are automatically marked `visibility: private`, so they only appear behind authentication
- **Preserved across CI rebuilds** — GitHub Actions carries forward personal docs from the previous build

### Setting Up Personal Docs (after forking)

1. **Create the directory and initialize a local git repo:**
   ```bash
   mkdir -p wiki/personal
   cd wiki/personal
   git init
   ```

2. **Create subdirectories matching wiki categories:**
   ```bash
   mkdir -p preferences projects snippets
   ```
   Subdirectory names map to wiki categories. Use any existing category name (preferences, projects, snippets, patterns, utilities, etc.) or create new ones.

3. **Add your personal docs** — frontmatter is optional since `wiki/personal/` docs default to private:
   ```markdown
   ---
   title: "My Tech Stack"
   ---

   # My Tech Stack Preferences
   Your content here...
   ```

4. **Commit in the personal repo:**
   ```bash
   cd wiki/personal
   git add -A
   git commit -m "Add personal docs"
   ```

5. **Rebuild the index** to include your personal docs:
   ```bash
   cd web
   npm run build:index
   ```
   Then commit the updated index files in the parent repo — this deploys your personal docs to your Netlify site (behind authentication).

### How It Works

- `wiki/personal/` is listed in the root `.gitignore`, so the parent repo ignores it entirely
- The index builder scans `wiki/personal/` as a separate wiki root — subdirectory names become categories
- All docs found in `wiki/personal/` are automatically set to `visibility: private` (overridable via frontmatter)
- Private docs are excluded from `index.json` (public) and only appear in `index-full.json` (served behind authentication)
- When GitHub Actions rebuilds the index (where `wiki/personal/` doesn't exist), it preserves private docs from the previous `index-full.json`
- The public `_index.md` scaffolding files in `wiki/projects/`, `wiki/snippets/`, etc. define category metadata for the web UI — personal docs merge into these categories seamlessly

### Claude Code / MCP Integration

To make your preference docs available to Claude Code via the MCP server's `get_preferences` tool:

```bash
# Symlink preferences to Claude's standard location
rm -rf ~/.claude/preferences
ln -s /path/to/code-wiki/wiki/personal/preferences ~/.claude/preferences
```

### Optional: Private Remote Backup

If you want to back up your personal docs to a private GitHub repo:

```bash
cd wiki/personal
git remote add origin git@github.com:your-username/my-wiki-preferences.git
git push -u origin main
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
