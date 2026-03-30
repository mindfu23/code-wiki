---
title: "PhotoPhreaker — Data Flow"
tags: ["architecture", "ai", "photography", "desktop"]
language: "python"
updated: "2026-03-30"
description: "Architecture flow for PhotoPhreaker: AI image decomposition with Topaz and Photoshop integration."
source_repo: "PhotoPhreaker"
---

# PhotoPhreaker Data Flow

AI image decomposition with Topaz AI and Adobe Photoshop integration.

```mermaid
flowchart LR
    User([User]) --> UI["Desktop UI<br/>Python"]
    User -->|input images| UI
    UI -->|process| Topaz["Topaz AI"]
    UI -->|process| PS["Photoshop<br/>Scripting"]
    UI -->|analyze| Claude["Claude API"]
    Topaz --> UI
    PS --> UI
    Claude --> UI
    UI -->|output images| FS["Local Filesystem"]
    UI --> User
```

## Key Services
- **Python desktop UI**: Local application for image processing pipeline
- **Topaz AI**: AI-powered image enhancement and upscaling
- **Photoshop scripting**: Automated layer manipulation and compositing
- **Claude API**: Image analysis and decomposition guidance
- **Local filesystem**: Input/output image storage
