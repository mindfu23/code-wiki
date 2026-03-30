---
title: "Novelizer — Data Flow"
tags: ["architecture", "ai", "writing"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for Novelizer: novel writing assistant with document import/export."
source_repo: "Novelizer"
---

# Novelizer Data Flow

Novel writing assistant with AI-powered editing and manuscript import/export.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Vite + Tailwind"]
    User -->|upload manuscript| React
    React -->|fetch| NF["Netlify Functions"]
    NF -->|API key| Claude["Claude API"]
    Claude --> NF
    NF --> React
    React -->|export| User
```

## Key Services
- **Netlify Functions**: API proxy for Claude
- **Claude API**: Writing assistance, editing suggestions, manuscript analysis
- **Document handling**: Manuscript import/export
