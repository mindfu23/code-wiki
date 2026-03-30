---
title: "Metabot — Data Flow"
tags: ["architecture", "ai", "multi-provider"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for Metabot: multi-AI aggregation with Express backend and React/Expo frontends."
source_repo: "Metabot"
---

# Metabot Data Flow

Multi-AI aggregation app that queries multiple LLM providers and merges responses.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Vite + Tailwind"]
    React -->|fetch| Express["Express Backend"]
    Express -->|API key| Claude["Claude API"]
    Express -->|API key| GPT["OpenAI API"]
    Express -->|API key| Gemini["Gemini API"]
    Claude --> Express
    GPT --> Express
    Gemini --> Express
    Express -->|merged response| React
    React -->|save as .md| Files["Local Files"]
    React --> User
```

## Key Services
- **Express backend**: Aggregates responses from multiple LLM providers
- **React SPA + Expo mobile**: Dual frontend (web and mobile)
- **Local file storage**: Conversations saved as .md files
