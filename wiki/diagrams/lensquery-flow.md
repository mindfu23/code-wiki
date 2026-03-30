---
title: "LensQuery — Data Flow"
tags: ["architecture", "ai", "photography", "tauri"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for LensQuery: cross-platform photo library query tool with Tauri desktop and web interfaces."
source_repo: "LensQuery"
---

# LensQuery Data Flow

Cross-platform photo library query tool — Tauri desktop app + web SPA.

```mermaid
flowchart LR
    User([User]) --> Tauri["Tauri Shell<br/>Rust + React"]
    User --> Web["Web SPA<br/>Vite + React"]
    Tauri -->|read catalog| LR["Lightroom DB<br/>SQLite"]
    Tauri -->|read catalog| C1["Capture One<br/>Sessions"]
    Tauri -->|thumbnails| FS["Local Filesystem"]
    Tauri -->|analyze| API["API Server"]
    Web -->|analyze| API
    API -->|API key| Claude["Claude API"]
    API -->|API key| Gemini["Gemini API"]
    Claude --> API
    Gemini --> API
    API --> Tauri
    API --> Web
```

## Key Services
- **Tauri shell (Rust)**: Native desktop app with filesystem access for catalogs and thumbnails
- **Web SPA**: Browser-based interface for remote access
- **API Server**: Backend for AI-powered image analysis
- **Claude + Gemini**: Multi-provider image analysis
- **Lightroom + Capture One**: Read catalog databases (SQLite for LR, session files for C1)
