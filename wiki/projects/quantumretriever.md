---
title: "QuantumRetriever"
description: "Multi-provider AI research assistant with response synthesis and caching"
tags: [ai, react, multi-provider, research]
updated: "2026-04-06"
source_repo: "Metabot"
taxonomy:
  type: project
  stack: [react, typescript, vite, netlify-functions, expo, react-native]
  platform: [web, ios, android]
  deployTarget: [netlify, apple-app-store, google-play]
  domain: [ai-tooling]
  visibility: public
  lifecycle: shipped
  dependsOn: [anthropic-api, google-gemini-api, huggingface-api, openai-api, perplexity-api]
---

Multi-provider AI research assistant. Sends queries to multiple AI providers simultaneously, synthesizes responses, and caches results for efficiency.

Lives in the Metabot repository (projectName differs from repoName). Web frontend with Netlify Functions backend proxying to 5+ AI provider APIs.
