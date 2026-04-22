# Code-wiki: MCP Integration Overview

Code-wiki is a personal knowledge-and-infrastructure hub that exposes itself to AI coding agents (Claude Code, Cursor, any MCP-compatible client) through a built-in Model Context Protocol server. This document explains what it provides, how it's structured, and why that structure is useful for agentic collaboration.

## What the MCP server offers

The `mcp-server/` directory is a TypeScript MCP server built with `@modelcontextprotocol/sdk`. It's wired up via an `.mcp.json` at the repo root that points to the compiled `dist/index.js`. Any MCP-aware agent can discover and call its tools.

The tools fall into four capability groups:

| Group | Tools | What agents get |
|---|---|---|
| **Knowledge retrieval** | `search_wiki`, `get_document`, `list_category`, `get_file` | Curated patterns, snippets, integrations, and templates — human-written knowledge, not raw code |
| **Codebase intelligence** | `search_repos`, `list_repos`, `sync_repos` | Ripgrep-powered full-text search across all indexed repositories, with canonical names and local paths |
| **Operational state** | `project_health`, `deploy_status`, `infra_overview` | Live deployment state (Netlify/Cloudflare/GCP), last-commit dates, convention-compliance checks |
| **Graph + standards** | `search_taxonomy`, `get_project_flow`, `get_preferences` | A faceted knowledge graph, Mermaid architecture diagrams, and user-defined coding standards |

## Why this is useful for agentic workflows

### Cross-project state without context pollution

Instead of an agent reading every project's `CLAUDE.md` and `package.json` to build a mental model of a portfolio, `infra_overview` and `project_health` return aggregated snapshots in a single tool call. Background collectors run on a schedule and persist daily metrics files, so agents poll cached snapshots rather than hitting upstream APIs at request time.

**Example:** An agent asked "which of my projects had a failed deploy this week?" answers from one `deploy_status` call instead of scanning dozens of dashboards.

### Public / private content split

Code-wiki's content is split across two repositories:

- A **public repo** holding source wiki markdown, taxonomy schema, diagram templates, the MCP server source, and the web app
- A **private content repo** holding generated indexes, metrics snapshots, and auto-built registry files (e.g. a list of local project paths)

The private repo is cloned at build time by the deploy pipeline using a read-only token and is never tracked in public git history. This lets agents query private-repo metadata — including internal project names and local paths — without any of it leaking into the public codebase.

### Preferences-as-tool, not preferences-as-docs

The `get_preferences` tool lets agents fetch user-defined coding standards on demand (preferred tech stack, deployment playbooks, mobile-submission checklists, etc.). Instead of stuffing every system prompt with a preferences blob, the agent pulls only what's relevant to the current task.

**Example:** Before recommending a framework for a new app, an agent calls `get_preferences(file: "standard-setups.md")` and tailors its recommendation to what the user already uses.

### Staleness detection

Documentation rots. Code-wiki ships two mechanisms to flag when it has:

- **Diagram staleness** — architecture diagrams carry signal hashes computed from their subject's source directories and dependencies. When the source drifts, the diagram is flagged as stale.
- **Project staleness** — `project_health` exposes `lastCommitDate` per repo, so agents can tell fresh projects from abandoned ones.

Combined, these give agents a credible "is this still true?" signal rather than trusting markdown blindly.

### Taxonomy as a knowledge graph

`search_taxonomy` queries a lightweight, controlled-vocabulary knowledge graph with multiple facets (type, stack, platform, deployment target, domain, visibility, service) and edge types (`dependsOn`, `related`, `supersedes`, etc.).

**Example:** "Find every project that depends on a given external API" becomes one `search_taxonomy` call with `action: find_dependents`, instead of a grep-and-infer sweep across the whole workspace.

### Auto-discovered registry

The list of projects an agent can see is built automatically from the user's GitHub account — no manual registry maintenance. Renamed repos are resolved automatically, multiple local paths for the same repo are tracked, and visibility (public/private) is read from GitHub rather than set by hand.

## Why code-wiki anchors an agent ecosystem

Many users end up running several MCP servers — one for their domain data, one for spreadsheets or notes, one for a specific vertical. Code-wiki plays a different role: it's the **portfolio layer** that makes agents coherent *across* a user's whole body of work.

Concretely, with code-wiki connected an agent can:

- Answer "which of my projects deploy to platform X?" without scanning every config file
- Respect the user's preferred stack and conventions without the user repeating them each session
- See a historical view of the portfolio (via daily metrics snapshots), not just a point-in-time one
- Reason about cross-project relationships (shared services, superseded projects, related work) via the taxonomy
- Know when architecture docs have drifted from reality

For a user maintaining more than a handful of projects, code-wiki becomes the closest thing to a **portfolio OS for AI agents** — a single surface where any MCP-capable client can understand the shape of the work, current operational state, and the conventions the user wants followed.

## Who this is for

Code-wiki is useful if you:

- Maintain several (say 5+) personal or work projects and want AI agents to reason about them as a portfolio rather than in isolation
- Already use MCP-capable tools (Claude Code, Cursor, etc.) and want to give them structured, queryable context instead of sprawling instruction files
- Want a single place for coding standards, architecture diagrams, reusable snippets, and operational dashboards — where "single place" also means "single API for agents"
- Deploy to multiple platforms (Netlify, Cloudflare, GCP, etc.) and want one tool call that summarizes state across all of them

If you only have one or two projects, the overhead probably outweighs the benefit. Code-wiki's value compounds with portfolio size.
