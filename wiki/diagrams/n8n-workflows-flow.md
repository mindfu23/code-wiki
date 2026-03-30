---
title: "n8n Workflows — Data Flow"
tags: ["architecture", "automation", "novel-pipeline"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for n8n Workflows: novel orchestration pipeline on self-hosted GCP."
source_repo: "n8n_workflows"
---

# n8n Workflows Data Flow

Novel orchestration pipeline — self-hosted n8n on GCP e2-micro instance.

```mermaid
flowchart LR
    Trigger["Manual / Schedule"] --> n8n["n8n<br/>GCP e2-micro"]
    n8n -->|read chapters| Sheets["Google Sheets"]
    n8n -->|API key| Claude["Claude API"]
    Claude -->|chapter text| n8n
    n8n -->|write chapter| Docs["Google Docs"]
    n8n -->|log| Sheets
    Caddy["Caddy Proxy"] --> n8n
```

## Key Services
- **n8n**: Self-hosted on GCP e2-micro (1GB RAM), Docker Compose
- **Caddy**: Reverse proxy with automatic HTTPS
- **Claude API**: Chapter generation and editing
- **Google Sheets**: Chapter metadata, project logs, orchestration state
- **Google Docs**: Final chapter output
