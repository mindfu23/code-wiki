---
title: "WeirdChess"
description: "Chess variant game with AI commentary, built with Flutter for web, iOS and Android"
tags: [flutter, chess, ai, games]
updated: "2026-10-08"
source_repo: "WeirdChess"
taxonomy:
  stack: [dart-flutter, netlify-functions]
  platform: [android, ios, web]
  deployTarget: [apple-app-store, google-play, netlify]
  domain: [ai-tooling, games]
  dependsOn: [anthropic-api, google-gemini-api, huggingface-api, openai-api, stockfish]
  type: project
  visibility: public
  lifecycle: shipped
---

Chess variant game with AI-powered commentary. Players choose from different chess rule variants while an AI provides entertaining analysis of moves and game state.

Built with Flutter for cross-platform deployment: web (Netlify), iOS (App Store), and Android (Google Play). Uses Stockfish chess engine for move analysis via WASM.
