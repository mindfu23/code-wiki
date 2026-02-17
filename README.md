# Code Wiki

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

### GitHub-Only Indexing

The web index **only includes repositories with GitHub URLs**. This is intentional:

1. **Simpler setup for forks**: Users who fork this repo don't need local file access
2. **Consistent builds**: GitHub Actions and local builds produce the same results
3. **Direct editing**: All search results link to GitHub for easy editing

Repositories without a GitHub URL in `wiki/projects/repo-locations.md` are automatically skipped during index builds.

### Running the Index Builder

```bash
cd web
npm install
npm run build:index
```

This scans `wiki/projects/repo-locations.md` and fetches documentation files from each GitHub repo using the GitHub Trees API.

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

2. **Add your repositories** to `wiki/projects/repo-locations.md`:
   ```markdown
   ### my-project
   - **Status:** active
   - **GitHub:** https://github.com/username/my-project
   - **Description:** My awesome project
   - **Languages:** TypeScript, Python
   ```

3. **Set environment variables** in Netlify (optional, for GitHub OAuth editing):
   - `GITHUB_CLIENT_ID` - GitHub OAuth app client ID
   - `GITHUB_CLIENT_SECRET` - GitHub OAuth app secret
   - `SESSION_SECRET` - Random string for session encryption

4. **GitHub Actions** automatically rebuilds the index:
   - Daily at midnight UTC
   - When `repo-locations.md` changes
   - Or trigger manually from the Actions tab

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
├── preferences/       # Development preferences (symlinked to ~/.claude/preferences)
├── patterns/          # Architectural patterns
├── utilities/         # Helper functions
├── integrations/      # API connectors
├── templates/         # Project starters
├── snippets/          # Small code pieces
└── projects/          # Project documentation
```

## Preferences Symlink

The `wiki/preferences/` folder is symlinked to `~/.claude/preferences/` so that:

1. The MCP server can read preferences from the standard Claude location
2. Editing preferences in this repo automatically updates what Claude sees
3. Preferences stay version-controlled in git

### Setup (one-time)

```bash
# Remove existing preferences folder and create symlink
rm -rf ~/.claude/preferences
ln -s /Users/jamesbeach/Documents/visual-studio-code/github-copilot/code-wiki/wiki/preferences ~/.claude/preferences
```

### How It Works

- Edit files in `wiki/preferences/*.md` in this repo
- Changes are immediately available to Claude Code (no sync needed)
- The `~/.claude/CLAUDE.md` file instructs Claude to check these preferences
- The MCP server's `get_preferences` tool reads from this location

### Current Preference Files

| File | Purpose |
|------|---------|
| `standard-setups.md` | Tech stack, UI guidelines, deployment checks |
| `gcp-cloud-run-deployment.md` | Google Cloud Run deployment guide |

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
