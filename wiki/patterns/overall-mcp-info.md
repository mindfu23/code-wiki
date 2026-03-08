---
title: "Overall MCP info"
description: "Info on my personal MCP setups"
updated: "2026-03-08"
visibility: "private"
---

## MCP Server Setup
All custom MCP servers are Node.js (ES modules) using @modelcontextprotocol/sdk. Configuration lives in two files:

~/.claude/mcp.json — Global MCPs (loaded in every session)
~/.claude/settings.json — Settings-level MCPs

### Global MCPs (~/.claude/mcp.json)
**1. code-wiki**

Location: ~/.claude/mcp-servers/code-wiki/index.js
Purpose: Stores and retrieves development preferences and coding standards as markdown files in ~/.claude/preferences/
Tools: get_preferences, set_preference
Use case: When Claude needs to check your tech stack preferences, deployment standards, or UI guidelines before making recommendations

**2. novel-tools**

Location: ~/.claude/mcp-servers/novel-tools/index.js
Purpose: Wraps Python novel-editing-tools scripts (at ~/Documents/visual-studio-code/antigravity-and-others/novel-editing-tools/) as MCP tools
Tools: research, fact_check, world_build, generate_names, check_grammar, check_style, compare_versions, ingest_manuscript, plan_revisions, fix_typos
Use case: AI-assisted novel editing — research, grammar/style checking, manuscript ingestion, revision planning, and .docx typo fixing

**3. lorebook**

Location: ~/.claude/mcp-servers/lorebook/index.js
Purpose: Selective context injection for long-form fiction. Maintains a per-project lorebook (characters, settings, plot threads, themes) and returns only entries relevant to the text being worked on, based on keyword matching. Reduces token usage by injecting only what's needed.
Tools: init_lorebook, add_entry, update_entry, remove_entry, get_entry, list_entries, get_context_for_text, search_entries, get_lorebook_summary
Storage: <project>/.lorebook/lorebook.json
Use case: When writing or editing a chapter, call get_context_for_text with the chapter text to get only the relevant world-building data instead of the entire manuscript's context

## Settings-level MCPs (~/.claude/settings.json)

**google-sheets**

Command: mcp-google-sheets
Auth: Google service account credentials (GCP project spatial-racer-263823)
Use case: Reading/writing Google Sheets data from within Claude Code sessions