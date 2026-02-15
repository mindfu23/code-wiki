# Code Wiki

A personal code wiki with MCP server integration for AI agents. Provides local-first code search across repositories with curated wiki content.

## Features

- **Local-first indexing**: Indexes all your local git repositories
- **Full-text search**: Uses ripgrep for fast code search across repos
- **Curated wiki**: Store reusable patterns, utilities, and snippets
- **MCP integration**: AI agents can search and retrieve code via MCP tools
- **GitHub sync**: Background sync to pull updates and detect new repos

## Setup

### 1. Install dependencies

```bash
cd mcp-server
npm install
```

### 2. Configure environment

Edit `mcp-server/.env` with your paths:

```bash
SOURCE_DIRS=/path/to/your/repos,/another/path
WIKI_DIR=/path/to/code-wiki/wiki
GITHUB_USERNAME=your-username
GITHUB_TOKEN=ghp_xxx  # Optional, for private repos
```

### 3. Build the server

```bash
cd mcp-server
npm run build
```

### 4. Configure Claude Code

Add to your Claude Code MCP settings (`.mcp.json` or settings):

```json
{
  "mcpServers": {
    "code-wiki": {
      "command": "node",
      "args": ["/Users/jamesbeach/Documents/visual-studio-code/github-copilot/code-wiki/mcp-server/dist/index.js"]
    }
  }
}
```

### 5. Install ripgrep (recommended)

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
