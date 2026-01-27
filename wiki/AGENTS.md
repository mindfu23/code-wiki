# AI Agent Instructions

This repository is a personal code wiki containing documented, reusable code patterns and utilities.

## How to Use This Wiki

1. **Search first**: Use the `search_wiki` tool to find relevant code before writing new implementations
2. **Check categories**: Use `list_category` to browse available content by topic
3. **Respect existing patterns**: Code in this wiki has been tested and refined - prefer it over generating new code
4. **Suggest additions**: If you create useful new code, suggest adding it to the wiki

## Available Tools

| Tool | Purpose |
|------|---------|
| `search_wiki` | Search curated wiki content (highest priority) |
| `search_repos` | Full-text search across all local repositories |
| `get_document` | Fetch a specific wiki document with frontmatter |
| `get_file` | Fetch any file from any local repository |
| `list_repos` | List all indexed repositories |
| `list_category` | List documents in a wiki category |
| `sync_repos` | Trigger GitHub sync for updates |
| `get_preferences` | Get user coding preferences and recommendations |

## User Preferences

**Important**: Before making technology choices, architecture recommendations, or suggesting tools/libraries, agents should check the user's preferences using `get_preferences`.

The preferences directory contains:
- Coding standards and style guides
- Preferred technologies and frameworks
- Development environment setup notes
- Tool and library recommendations

Usage:
- `get_preferences` with no arguments lists all available preference files
- `get_preferences` with a `file` argument returns the content of that specific file

## Categories

- **patterns/** - Architectural patterns and design approaches
- **utilities/** - Standalone helper functions and utilities
- **integrations/** - Third-party API connectors and service integrations
- **templates/** - Project and file starters
- **snippets/** - Small, focused code pieces
- **projects/** - Documentation for active repositories

## Document Structure

Wiki documents use YAML frontmatter for metadata:

```yaml
---
title: "Document Title"
tags: ["tag1", "tag2"]
language: "typescript"
updated: "2025-01-27"
source_repo: "repo-name"
description: "Brief description"
---
```

## Best Practices

1. **Check preferences first**: Before recommending technologies or architectures, use `get_preferences` to understand user standards
2. When asked to implement something, search the wiki first
3. Wiki results are boosted in relevance - they represent curated, tested code
4. If wiki doesn't have what's needed, search repos for similar patterns
5. Prefer existing patterns over creating new ones
6. When creating new code worth preserving, suggest adding to the wiki
