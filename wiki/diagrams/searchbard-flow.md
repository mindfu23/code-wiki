---
title: "SearchBard — Data Flow"
tags: ["architecture", "ai", "search"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for SearchBard: AI-powered search with multi-provider fallback."
source_repo: "SearchBard"
---

# SearchBard Data Flow

AI-powered search with multi-provider fallback.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Vite + Tailwind"]
    React -->|fetch| NF["Netlify Functions"]
    NF -->|API key| Perplexity["Perplexity API"]
    NF -->|fallback| Claude["Claude API"]
    Perplexity --> NF
    Claude --> NF
    NF --> React
    React --> User
```

## Key Services
- **Netlify Functions**: API proxy with provider fallback logic
- **Perplexity API**: Primary search provider (web-grounded)
- **Claude API**: Fallback when Perplexity is unavailable
