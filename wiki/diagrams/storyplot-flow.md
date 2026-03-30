---
title: "StoryPlot — Data Flow"
tags: ["architecture", "ai", "writing", "plotto"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for StoryPlot: interactive story plot generator based on the Plotto system."
source_repo: "StoryPlot"
---

# StoryPlot Data Flow

Interactive story plot generator based on the Plotto system.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Vite + Tailwind"]
    React -->|fetch| NF["Netlify Functions"]
    NF -->|API key| Claude["Claude API"]
    Claude --> NF
    NF --> React
    React -->|parse| XML["Plotto XML<br/>Data"]
    React --> User
```

## Key Services
- **Netlify Functions**: API proxy for Claude
- **Claude API**: Story generation and plot expansion
- **Plotto XML**: Classic plot formula database parsed client-side
