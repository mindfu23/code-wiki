---
title: "Gastown — Data Flow"
tags: ["architecture", "ai", "agents", "go"]
language: "go"
updated: "2026-03-30"
description: "Architecture flow for Gastown: multi-agent orchestration CLI written in Go."
source_repo: "gastown"
---

# Gastown Data Flow

Multi-agent orchestration CLI written in Go.

```mermaid
flowchart LR
    User([User]) --> CLI["Go CLI"]
    CLI -->|spawn| Agents["Agent Processes"]
    Agents -->|API key| Claude["Claude API"]
    Agents -->|API key| GPT["OpenAI API"]
    Claude --> Agents
    GPT --> Agents
    Agents -->|results| CLI
    CLI -->|file ops| FS["Local Filesystem"]
    CLI --> User
```

## Key Services
- **Go CLI**: Orchestrates multiple AI agent processes
- **Claude + OpenAI APIs**: Multi-provider LLM backends for agents
- **Local filesystem**: Agent work products and file operations
