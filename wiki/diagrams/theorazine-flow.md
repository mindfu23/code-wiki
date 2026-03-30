---
title: "Theorazine — Data Flow"
tags: ["architecture", "ai", "calculator"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for Theorazine: calculator and theory exploration tool with Perplexity integration."
source_repo: "Theorazine"
---

# Theorazine Data Flow

Calculator and theory exploration tool with Perplexity AI integration.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Vite + Tailwind"]
    React -->|fetch| NF["Netlify Functions"]
    NF -->|API key| Perplexity["Perplexity API"]
    Perplexity --> NF
    NF --> React
    React -->|persist| LS["LocalStorage"]
    React --> User
```

## Key Services
- **Netlify Functions**: API proxy for Perplexity
- **Perplexity API**: Theory exploration and research queries
- **LocalStorage**: Calculator state and history persistence
