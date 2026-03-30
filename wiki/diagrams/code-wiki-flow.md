---
title: "Code Wiki — Data Flow"
tags: ["architecture", "mcp", "knowledge-base"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for Code Wiki: MCP server + Netlify SPA + GitHub Actions index pipeline."
source_repo: "code-wiki"
---

# Code Wiki Data Flow

Personal knowledge base with dual interfaces: web SPA and MCP server for AI agents.

```mermaid
flowchart LR
    User([User]) --> SPA["Vanilla SPA<br/>Netlify"]
    Claude["Claude Code"] --> MCP["MCP Server<br/>TypeScript"]
    MCP -->|read| Wiki["Wiki Markdown<br/>Files"]
    MCP -->|git ops| GH["GitHub API"]
    SPA -->|fetch| NF["Netlify Functions"]
    NF -->|OAuth| GH
    NF -->|read| Index["Static JSON<br/>Index"]
    NF -->|metrics| Netlify["Netlify API"]
    GA["GitHub Actions"] -->|rebuild| Index
    SPA --> User
```

## Key Services
- **MCP Server**: Exposes wiki search, document retrieval, and health tools to Claude Code
- **Netlify Functions**: API proxy for OAuth, index serving, and metrics
- **GitHub Actions**: Daily index rebuild from wiki markdown + repo metadata
- **Observatory**: Dashboard pulling deploy status from Netlify and GitHub APIs
