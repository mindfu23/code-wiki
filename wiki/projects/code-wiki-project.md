---
title: "code-wiki"
description: "Personal code wiki with MCP server integration for AI agent search and web UI"
tags: [mcp, wiki, typescript, knowledge-management]
updated: "2026-04-06"
source_repo: "code-wiki"
taxonomy:
  type: project
  stack: [typescript, netlify-functions]
  platform: [web, mcp-server]
  deployTarget: [netlify]
  domain: [developer-tools, knowledge-management, observability]
  visibility: public
  lifecycle: shipped
  dependsOn: [github-api, netlify-api]
---

Personal code wiki with MCP server integration. Provides searchable documentation across GitHub repositories with curated wiki content, architecture diagrams, and an Observatory metrics dashboard.

MCP server exposes search, preferences, and project flow tools for Claude and other AI agents. Web UI hosted on Netlify with GitHub OAuth for private content access.
