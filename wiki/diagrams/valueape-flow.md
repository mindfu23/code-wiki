---
title: "ValueApe — Data Flow"
tags: ["architecture", "ai", "finance", "multi-provider"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for ValueApe: multi-provider stock analysis with AI recommendations, sentiment analysis, and cloud sync."
source_repo: "ValueApe"
---

# ValueApe Data Flow

Stock analysis dashboard with multi-provider data, AI recommendations, FinGPT sentiment analysis, and Cloudflare D1 cloud sync.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Vite + Tailwind"]

    subgraph NF["Netlify Functions"]
      AP["api-proxy"]
      YP["yahoo-proxy"]
      GP["gemini-proxy"]
      PP["perplexity-query"]
      FP["fingpt-proxy"]
      Auth["auth-*<br/>Supabase"]
      Sync["sync-data"]
    end

    React --> AP & YP & GP & PP & FP & Auth & Sync

    subgraph Stock["Stock Data Providers"]
      Yahoo["Yahoo Finance<br/>(primary)"]
      AV["Alpha Vantage"]
      FH["Finnhub"]
      TG["Tiingo"]
      FMP["FMP"]
    end

    YP --> Yahoo
    AP --> AV & FH & TG & FMP

    subgraph AI["AI / LLM"]
      Gemini["Gemini<br/>(query parsing)"]
      Perplexity["Perplexity<br/>(recommendations)"]
      HF["HuggingFace<br/>FinBERT / FinGPT"]
    end

    GP --> Gemini
    PP --> Perplexity
    FP --> HF

    React -->|direct| SEC["SEC EDGAR<br/>Filings"]

    subgraph Storage["Storage"]
      LS["localStorage"]
      IDB["IndexedDB"]
      D1["Cloudflare D1<br/>(cloud sync)"]
    end

    React --> LS & IDB
    Sync --> D1
    Auth --> Supa["Supabase"]
    React --> User
```

## Key Services
- **Netlify Functions**: Server-side proxies protecting all API keys (api-proxy, yahoo-proxy, gemini-proxy, perplexity-query, fingpt-proxy)
- **Stock data providers**: Yahoo Finance (primary, crumb/cookie auth), Alpha Vantage, Finnhub, Tiingo, FMP (all with fallback chain)
- **AI/LLM**: Gemini for natural language query parsing, Perplexity for AI stock recommendations, HuggingFace FinBERT/FinGPT for sentiment analysis
- **SEC EDGAR**: Direct client-side access (no API key required, 10 req/sec rate limit)
- **Storage**: localStorage + IndexedDB client-side, Cloudflare D1 for cloud sync, Supabase for auth

## Query Modes
- **Quick mode**: Single primary data provider, fastest response
- **Synthesis mode**: Fetches from all available providers, averages numeric fields
- **Difference mode**: Fetches from all providers, highlights >10% deviations
