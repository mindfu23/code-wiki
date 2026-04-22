---
title: "QuantumRetriever"
description: "Multi-provider AI research assistant with response synthesis and caching"
tags: [ai, react, multi-provider, research]
updated: "2026-04-22"
source_repo: "Metabot"
taxonomy:
  stack: [expo, netlify-functions, node-express, react, react-native, typescript, vite]
  platform: [android, ios, web]
  deployTarget: [apple-app-store, google-play, netlify]
  domain: [ai-tooling]
  dependsOn: [anthropic-api, google-gemini-api, huggingface-api, openai-api, perplexity-api]
  type: project
  visibility: public
  lifecycle: shipped
---

Multi-provider AI research assistant. Sends queries to multiple AI providers simultaneously, synthesizes responses, and caches results for efficiency.

Lives in the Metabot repository (projectName differs from repoName). Web frontend with Netlify Functions backend proxying to 5+ AI provider APIs.
