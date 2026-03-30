---
title: "EthicalAIditor — Data Flow"
tags: ["architecture", "ai", "document-editing"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for EthicalAIditor: AI-powered document editing and ethical analysis."
source_repo: "EthicalAIditor"
---

# EthicalAIditor Data Flow

AI-powered document editing and ethical analysis tool with .docx import/export.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Vite + Tailwind"]
    User -->|upload .docx| React
    React -->|fetch| NF["Netlify Functions<br/>API Proxy"]
    NF -->|API key| Claude["Claude API"]
    NF -->|API key| Pleias["Pleias API"]
    Claude --> NF
    Pleias --> NF
    NF --> React
    React -->|export .docx| User
```

## Key Services
- **Netlify Functions**: API proxy for Claude and Pleias
- **Claude API**: AI-powered editing suggestions and analysis
- **Pleias API**: Ethical analysis and bias detection
- **Document processing**: .docx import/export via client-side parsing
