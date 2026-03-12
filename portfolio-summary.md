# Portfolio Project Summary — Resume Handoff Document

> **Purpose:** Comprehensive inventory of ~50 projects across two workspaces, tagged by professional skill area and industry relevance, for use by a resume-tailoring agent.

---

## How to Use This Document

Each project entry includes:
- **What it is** — one-line description
- **Tech stack** — languages, frameworks, platforms
- **Skills demonstrated** — tagged for resume matching
- **Industry fit** — which job types this project best supports

### Skill Tags Key
| Tag | Meaning |
|-----|---------|
| `AI-INTEGRATION` | Multi-provider LLM orchestration, prompt engineering, vision AI |
| `USER-EMPATHY` | Accessibility, UX research, solving real user pain points |
| `PROBLEM-SOLVING` | Novel algorithms, architectural decisions, creative engineering |
| `TECHNICAL-WRITING` | Documentation, guides, API docs, workflow specs |
| `CROSS-PLATFORM` | Web + mobile + desktop from shared codebases |
| `DESIGN` | UI/UX design, data visualization, visual systems |
| `DEVOPS` | CI/CD, Docker, cloud deployment, automation |
| `DATA-PIPELINE` | ETL, scraping, aggregation, caching strategies |
| `GAME-DEV` | Game engines, game mechanics, interactive fiction |
| `DOMAIN-EXPERTISE` | Deep knowledge of a specific application domain |

---

## WORKSPACE 1: github-copilot/ (47 projects)

---

### AI-Powered Writing & Editing Tools

#### EthicalAIditor
AI writing editor exclusively using ethically-trained LLMs. Manuscript editing, style analysis, RAG-based assistance, on-device inference.
- **Stack:** React 19, Vite, Tailwind, HuggingFace, Friendli.ai, Cloudflare Workers (D1/Vectorize), Electron, Capacitor, Vercel AI SDK
- **Skills:** `AI-INTEGRATION` `USER-EMPATHY` `CROSS-PLATFORM` `DOMAIN-EXPERTISE` `DESIGN`
- **Industry fit:** AI/ML, publishing, edtech, ethical AI
- **Notable:** Custom Capacitor Llama.cpp plugin for on-device inference; RAG pipeline with Cloudflare Vectorize; multi-provider fallback chains; ethical sourcing as core product differentiator

#### ManuscriptReview (Manuscript Koala)
AI-powered manuscript review for fiction writers with adjustable feedback tone (Gentlest → Harsh), character tracking, plot hole detection.
- **Stack:** React 18, TypeScript, Vite, Tailwind, Zustand, Capacitor 5; FastAPI backend on Cloud Run
- **Skills:** `AI-INTEGRATION` `USER-EMPATHY` `CROSS-PLATFORM` `DESIGN` `DOMAIN-EXPERTISE`
- **Industry fit:** Publishing, edtech, SaaS, creative tools
- **Notable:** Tone system demonstrates deep understanding of user psychology; live at manuscript-koala.netlify.app

#### Novelizer
Multi-agent AI novel writing system with 5-stage pipeline (Research → Plot → Writer → Editor → Reviser), consensus mode, quality verification loops.
- **Stack:** Python/FastAPI backend, React 19 frontend, Claude Opus + Gemini + Perplexity, spaCy NER
- **Skills:** `AI-INTEGRATION` `PROBLEM-SOLVING` `DATA-PIPELINE` `TECHNICAL-WRITING`
- **Industry fit:** AI/ML, publishing, workflow automation
- **Notable:** Premium consensus mode (multiple drafts + evaluation/synthesis); cost estimation ($2.50-$6.00/chapter); complex multi-agent orchestration

---

### AI Chat & Multi-Model Platforms

#### Metabot (Quantum Retriever)
Queries ChatGPT, Claude, Gemini, and Perplexity simultaneously, synthesizes results, compares responses. Web + React Native mobile.
- **Stack:** Express + TypeScript backend, React + Vite web, React Native/Expo mobile, 4 AI SDKs, Radix UI
- **Skills:** `AI-INTEGRATION` `CROSS-PLATFORM` `DESIGN` `PROBLEM-SOLVING` `USER-EMPATHY`
- **Industry fit:** AI/ML, research tools, enterprise software
- **Notable:** Parallel multi-model querying with synthesis; key differences analysis; export to Markdown/PDF/ZIP; cost estimation

#### ShamAIn
Custom GPT chat app with Firebase auth, Stripe/RevenueCat subscriptions, multi-provider AI backend, conversation history.
- **Stack:** React 18 + Vite (web), React Native/Expo (mobile), Firebase Auth/Firestore, Stripe, RevenueCat
- **Skills:** `AI-INTEGRATION` `CROSS-PLATFORM` `PROBLEM-SOLVING` `DESIGN`
- **Industry fit:** SaaS, fintech (payments), mobile apps
- **Notable:** Full monetization stack (Stripe web + RevenueCat mobile); offline message queuing; push notifications

#### GPTWrapper
Freemium AI chat with usage tracking, subscription management, Ko-fi support integration.
- **Stack:** React 18, Vite, Firebase, Netlify Functions, Stripe, RevenueCat, React Native
- **Skills:** `AI-INTEGRATION` `CROSS-PLATFORM` `PROBLEM-SOLVING`
- **Industry fit:** SaaS, consumer apps

---

### Game Development

#### game-fusionball
Futuristic arena sport where the player IS the ball — control transfers to teammates on pass at ball velocity. Inspired by Speedball 2.
- **Stack:** Unreal Engine 5.5-5.7, C++, Gameplay Abilities System, StateTree AI, Niagara VFX, Lumen
- **Skills:** `GAME-DEV` `PROBLEM-SOLVING` `DESIGN` `AI-INTEGRATION`
- **Industry fit:** Gaming (AAA/indie), simulation, sports tech
- **Notable:** Original possession-transfer mechanic; multi-layered scoring; GAS-powered abilities; StateTree + Behavior Tree NPC AI; targets PC + console + mobile

#### weirdchess
Flutter chess app with 12 playable variants (Standard, Atomic, Chess960, Three-Check, Fog of War, Grand Chess, Jetan/Martian Chess, etc.) plus AI opponent and LLM commentary.
- **Stack:** Flutter/Dart, Riverpod 3.x, GoRouter, flutter_svg
- **Skills:** `GAME-DEV` `CROSS-PLATFORM` `PROBLEM-SOLVING` `AI-INTEGRATION` `DESIGN`
- **Industry fit:** Gaming, edtech, mobile apps
- **Notable:** 12 fully-implemented chess variants including 10×10 boards; alpha-beta AI engine; LLM commentary with variant-specific personalities; live at weirdchess.netlify.app

#### game-wizard-pi
Interactive fiction engine with AI-enhanced narration. Story pack system (JSON scene graphs), CSV import, pure-function state machine.
- **Stack:** React 19, Vite 7, React Router 7, Netlify Functions, multi-provider LLM
- **Skills:** `GAME-DEV` `AI-INTEGRATION` `PROBLEM-SOLVING` `DESIGN` `TECHNICAL-WRITING`
- **Industry fit:** Gaming (narrative), edtech, interactive media
- **Notable:** Fully playable without AI (narration is optional enhancement); shared story files with Unity companion

#### game-wizard-pi-unity
Unity companion to game-wizard-pi — 2D isometric visuals reading same JSON story files as React app.
- **Stack:** Unity 6 LTS, C#, 2D Tilemaps, TextMeshPro, ScriptableObjects
- **Skills:** `GAME-DEV` `CROSS-PLATFORM` `PROBLEM-SOLVING`
- **Industry fit:** Gaming, interactive media
- **Notable:** Direct port of React engine logic to C# with identical behavior; symlinked story files demonstrate cross-engine architecture

---

### Finance & Business Tools

#### ValueApe
AI-powered stock screener with backtesting, watchlists, portfolio analysis, automated trading strategy research.
- **Stack:** React 19, TypeScript, Vite, Tailwind v4, Radix UI, Supabase, Cloudflare Workers + D1, Recharts + D3, Vitest
- **Skills:** `DATA-PIPELINE` `AI-INTEGRATION` `DESIGN` `PROBLEM-SOLVING` `DOMAIN-EXPERTISE`
- **Industry fit:** Fintech, data analytics, trading platforms
- **Notable:** Cloudflare D1 macro scheduler; financial glossary scraper with embeddings; complex data pipeline with web scraping

#### apiTracker
Dashboard tracking API usage and spend across AI providers (OpenAI, Anthropic, Perplexity, Gemini) with browser extension.
- **Stack:** React 19, Vite, Tailwind, Neon Postgres, Netlify Functions; Chrome/Firefox/Safari extensions
- **Skills:** `DESIGN` `CROSS-PLATFORM` `PROBLEM-SOLVING` `DATA-PIPELINE`
- **Industry fit:** Developer tools, SaaS, fintech (cost management)
- **Notable:** Multi-platform browser extension build system; real-time cost analysis

---

### Image & Visual Processing

#### PhotoPhreaker
AI image decomposition tool — splits photos into RGBA layers for physical art (acrylic transparency stacks, lenticular 3D).
- **Stack:** Python CLI, OpenCV, depth estimation ML models, PIL, Photoshop integration
- **Skills:** `AI-INTEGRATION` `PROBLEM-SOLVING` `DOMAIN-EXPERTISE` `DESIGN`
- **Industry fit:** Creative tools, image processing, physical art/manufacturing
- **Notable:** Depth map ML; k-means color decomposition; CMYK separation; lenticular 3D calibration; Canon Dual Fisheye 360/VR180 processing; print-ready export with registration marks

#### LensQuery
Natural language image library search for photographers — query photo catalogs with phrases like "show me the strongest bokeh."
- **Stack:** React 18, TypeScript, Tauri 2.0 (Rust), sql.js, Vision LLMs (Claude/OpenAI/Gemini/Ollama), GCP Cloud Run
- **Skills:** `AI-INTEGRATION` `PROBLEM-SOLVING` `CROSS-PLATFORM` `DOMAIN-EXPERTISE` `DATA-PIPELINE`
- **Industry fit:** Photography, creative tools, AI/ML, desktop software
- **Notable:** Smart EXIF pre-filtering reduces API costs; tiling strategy (4-9 images per API call); Lightroom/Capture One/Apple Photos catalog parsing; Tauri desktop + mobile + web rollout

#### SacredGeometryOutliner
Transforms photos into sacred geometric line art using edge detection, golden ratio, and sacred angle snapping.
- **Stack:** Vanilla JS, Canvas API, TensorFlow.js COCO-SSD
- **Skills:** `AI-INTEGRATION` `PROBLEM-SOLVING` `DESIGN` `DOMAIN-EXPERTISE`
- **Industry fit:** Creative tools, generative art, edtech
- **Notable:** AI subject detection; Sobel edge detection; golden ratio proportions; Douglas-Peucker simplification; SVG/PNG export

#### CoverJudge
Scan book covers or enter URLs to identify books, get AI summaries, check library availability, generate affiliate links.
- **Stack:** React 19, Vite, Multi-AI (OpenAI/Claude/Gemini/Perplexity), Google Vision OCR, Google Books API, Open Library
- **Skills:** `AI-INTEGRATION` `DATA-PIPELINE` `USER-EMPATHY` `CROSS-PLATFORM`
- **Industry fit:** Publishing, retail, library tech
- **Notable:** Multi-API aggregation (Google Books + Open Library + WorldCat); affiliate link generation

#### meme-renamer
AI-powered image renaming tool with duplicate finder and visual comparison GUI.
- **Stack:** Python, Multi-AI vision (GPT-4o/Claude/Gemini), Pillow, imagehash, NLTK
- **Skills:** `AI-INTEGRATION` `PROBLEM-SOLVING` `USER-EMPATHY`
- **Industry fit:** Digital asset management, productivity tools
- **Notable:** Perceptual hashing for duplicate detection; ~$0.15-0.20 for 4,000 images

---

### Design & Creative Tools

#### Fractasy
Cross-platform fractal and sacred geometry visualizer with GPU-accelerated rendering and deep zoom.
- **Stack:** Flutter/Dart, Riverpod, Freezed, GLSL fragment shaders, arbitrary-precision math
- **Skills:** `DESIGN` `PROBLEM-SOLVING` `CROSS-PLATFORM` `GAME-DEV`
- **Industry fit:** Creative tools, edtech, visualization, gaming
- **Notable:** GPU shader programming; perturbation theory for deep zoom; Mandelbrot/Julia/Burning Ship + sacred geometry (Flower of Life, Metatron's Cube, Golden Spiral)

#### WebToFigma
Generates wireframes from existing websites and converts to Figma design files.
- **Stack:** Node.js, Puppeteer, Figma Plugin API, Express, Netlify + Browserless.io
- **Skills:** `DESIGN` `PROBLEM-SOLVING` `DATA-PIPELINE`
- **Industry fit:** Design tools, web development, product design
- **Notable:** DOM-to-Figma node tree conversion; design token extraction (colors, fonts, spacing)

#### Create
Creative productivity suite: sketchbook (drawing canvas), journal, task management, project organization.
- **Stack:** React 18, Vite, Tailwind, shadcn/ui, Konva (canvas), Express, PostgreSQL/Neon, Drizzle ORM, Passport auth, WebSockets
- **Skills:** `DESIGN` `PROBLEM-SOLVING` `CROSS-PLATFORM` `USER-EMPATHY`
- **Industry fit:** Productivity, creative tools, SaaS
- **Notable:** Full-stack with real-time collaboration via WebSockets; layered drawing canvas

#### Musix
Music composition tool based on the Schillinger system with piano roll, MIDI import/export, algorithmic transformations.
- **Stack:** Vanilla JavaScript, Vite, Tone.js, midi-parser-js, midi-writer-js
- **Skills:** `DOMAIN-EXPERTISE` `DESIGN` `PROBLEM-SOLVING`
- **Industry fit:** Music tech, edtech, creative tools
- **Notable:** Schillinger transformations (Inversion, Retrograde, Retrograde Inversion); rhythmic resultants from interference patterns; scale constraint system

#### Namerrific
Creative name generator with semantic word relationship visualization using D3 force-directed graphs.
- **Stack:** React 18, Vite, D3.js, ConceptNet API, Netlify Functions
- **Skills:** `DESIGN` `AI-INTEGRATION` `DATA-PIPELINE`
- **Industry fit:** Creative tools, branding, NLP
- **Notable:** ConceptNet semantic relationship visualization; D3 force-directed graph

#### WishfulPhysics
Fictional periodic table of elements from science fiction and fantasy universes.
- **Stack:** React, CSS, CSV data
- **Skills:** `DESIGN` `DOMAIN-EXPERTISE`
- **Industry fit:** Entertainment, edtech
- **State:** Prototype

---

### Social & Community Platforms

#### StoryLoft
Subscription-based author CRM and community platform — authors manage reader lists, publish content, coordinate book swaps.
- **Stack:** React 19, Vite, TypeScript, Tailwind, Supabase (PostgreSQL/Auth/Realtime/RLS), TipTap, Brevo/Resend email, Sentry
- **Skills:** `DESIGN` `USER-EMPATHY` `PROBLEM-SOLVING` `DOMAIN-EXPERTISE` `DATA-PIPELINE`
- **Industry fit:** Publishing, SaaS, community platforms, social media
- **Notable:** Role-based auth (author/reader/admin); fan CRM with CSV import; Phase 2 planned: Stripe, FCM push, Daily.co live events

#### Postboi
Cross-platform mobile app for composing and sharing to Instagram, Facebook, and WordPress simultaneously with AI essay drafting.
- **Stack:** Python, Kivy/KivyMD, Anthropic Claude, Pytesseract OCR, APScheduler, Buildozer (Android), kivy-ios
- **Skills:** `CROSS-PLATFORM` `AI-INTEGRATION` `PROBLEM-SOLVING` `USER-EMPATHY`
- **Industry fit:** Social media, content creation, mobile apps
- **Notable:** OCR + Claude for AI essay drafting from screenshots; concurrent uploads; scheduled posting

#### RedditUF
Modern Reddit browser with customizable display, virtualized scrolling, cleaner UI.
- **Stack:** React 19, Vite 7, react-window, Capacitor
- **Skills:** `DESIGN` `USER-EMPATHY` `CROSS-PLATFORM`
- **Industry fit:** Social media, mobile apps

#### TrollJar
Browser extension converting online outrage into charitable donations via Every.org.
- **Stack:** Chrome Extension (Manifest V3), Firefox WebExtension, Vanilla JS, Netlify Functions
- **Skills:** `USER-EMPATHY` `DESIGN` `CROSS-PLATFORM` `PROBLEM-SOLVING`
- **Industry fit:** Social impact, nonprofits, browser extensions
- **Notable:** Behavioral design — transforms negative emotions into positive action; monthly limits; cause preference learning

#### IsHe (Is He Dead Yet)
Celebrity mortality checker with AI verification and notification subscriptions.
- **Stack:** React 18, Capacitor, React Native, Netlify Functions, Claude API, News API, Cheerio
- **Skills:** `AI-INTEGRATION` `CROSS-PLATFORM` `DATA-PIPELINE`
- **Industry fit:** Entertainment, media, consumer apps

#### GNN (Good News Network)
Positive news feed app with search, filtering, user profiles.
- **Stack:** React Native/Expo SDK 54, React Navigation 7
- **Skills:** `CROSS-PLATFORM` `DESIGN` `USER-EMPATHY`
- **Industry fit:** Media, news, mobile apps

---

### Search & Discovery

#### SearchBard
Conference search portal aggregating SerpAPI, Ticketmaster, Eventbrite with deduplication and location-based filtering.
- **Stack:** React 19, TypeScript, Capacitor 7, SerpAPI/Ticketmaster/Eventbrite APIs
- **Skills:** `DATA-PIPELINE` `DESIGN` `PROBLEM-SOLVING` `CROSS-PLATFORM`
- **Industry fit:** Events, travel, enterprise search
- **Notable:** Multi-API aggregation with automatic deduplication; Haversine distance calculations; 11 subject categories

#### JobSearcher
Automated daily technical writer job search — searches 6 platforms, deduplicates, tracks applications in Google Sheets, emails reports.
- **Stack:** Python, Anthropic SDK (Claude web_search), gspread, GitHub Actions (cron)
- **Skills:** `DEVOPS` `AI-INTEGRATION` `DATA-PIPELINE` `PROBLEM-SOLVING` `TECHNICAL-WRITING`
- **Industry fit:** HR tech, workflow automation, developer tools
- **Notable:** Daily cron via GitHub Actions; day-over-day comparison; failure notifications; Google Sheets application tracking

---

### Narrative & Fiction Tools

#### StoryPlot
Multi-method story plotting tool — 7 narrative structures (Story Circle, Lester Dent, Three-Act, Kishotenketsu, Plotto, etc.) with AI-assisted form filling.
- **Stack:** React 19, Vite 6, TypeScript, Tailwind 4, docx/xlsx export, Plotto XML submodule
- **Skills:** `DOMAIN-EXPERTISE` `DESIGN` `AI-INTEGRATION` `PROBLEM-SOLVING`
- **Industry fit:** Publishing, edtech, creative tools
- **Notable:** 7 plotting methods including Plotto (1,462 conflict patterns); trope browser with AI generation; Word/Excel export

#### StoryCircle-dev
Story outlining tool based on Dan Harmon's Story Circle with mystery plotting and "fat outline" (imagery + sensory columns).
- **Stack:** React, TypeScript, docx library
- **Skills:** `DOMAIN-EXPERTISE` `DESIGN`
- **Industry fit:** Publishing, edtech
- **State:** Legacy — partially migrated to StoryPlot

#### plottoxml
Machine-readable XML edition of William Wallace Cook's "Plotto" (1928) — 1,462 generic plot conflicts with RelaxNG schema.
- **Stack:** XML, RelaxNG Compact schema, Makefile, Jing/Trang validation
- **Skills:** `TECHNICAL-WRITING` `DOMAIN-EXPERTISE` `PROBLEM-SOLVING`
- **Industry fit:** Publishing, digital humanities, data standards
- **Notable:** Data standards work — converting a 1928 reference into machine-readable format

---

### Education & Critical Thinking

#### Theorazine
Educational app calculating how long conspiracy theories could remain secret, based on Dr. David Robert Grimes' peer-reviewed research.
- **Stack:** Vanilla HTML/CSS/JS, Chart.js, Perplexity API, Netlify Functions, Service Worker
- **Skills:** `DOMAIN-EXPERTISE` `DESIGN` `USER-EMPATHY` `AI-INTEGRATION`
- **Industry fit:** Edtech, media literacy, journalism
- **Notable:** Implements published academic formula; PWA with offline support; educational content design

#### FreeWillEstimator
Psychology-based questionnaire assessing personal autonomy across multiple dimensions with Chart.js visualization.
- **Stack:** Vanilla HTML/CSS/JS, Chart.js
- **Skills:** `DOMAIN-EXPERTISE` `DESIGN` `USER-EMPATHY`
- **Industry fit:** Edtech, psychology, wellness tech

---

### Divination & Esoteric

#### WeirdTarot
Multi-system divination app — Tarot, I Ching, Elder Futhark Runes with cross-correspondences (zodiac, MBTI).
- **Stack:** React 18, Tailwind 3, PapaParse
- **Skills:** `DOMAIN-EXPERTISE` `DESIGN` `PROBLEM-SOLVING`
- **Industry fit:** Entertainment, wellness, mobile apps
- **Notable:** Authentic King Wen I Ching sequence (not simplified binary); custom deck upload via CSV; cross-system correspondences

---

### Infrastructure & Developer Tools

#### gastown
Multi-agent orchestration system coordinating 20-30+ Claude Code agents with persistent work tracking, mailboxes, identities, handoffs.
- **Stack:** Go 1.25, Cobra CLI, Charm TUI (Bubbletea/Bubbles/Lipgloss), MySQL, go-rod, OpenTelemetry
- **Skills:** `AI-INTEGRATION` `PROBLEM-SOLVING` `DEVOPS` `DESIGN`
- **Industry fit:** AI/ML, developer tools, enterprise infrastructure
- **Notable:** Multi-model agent routing (Claude, GPT-4o, Gemini, Perplexity); Gemini Imagen integration; git-backed state persistence

#### code-wiki
MCP server + web interface for personal code wiki — searchable docs across GitHub repos with preference management for AI agents.
- **Stack:** TypeScript, @modelcontextprotocol/sdk, simple-git, gray-matter, Netlify Functions, @octokit/rest
- **Skills:** `DEVOPS` `TECHNICAL-WRITING` `PROBLEM-SOLVING` `AI-INTEGRATION`
- **Industry fit:** Developer tools, knowledge management, AI infrastructure
- **Notable:** MCP (Model Context Protocol) integration; auto-discovery of GitHub repos; private doc management

#### n8n_workflows
Self-hosted n8n workflow automation on GCP free tier — job search, multi-AI routing, novel writing, stock research workflows.
- **Stack:** n8n, Docker Compose, Caddy reverse proxy, Ubuntu/GCP e2-micro
- **Skills:** `DEVOPS` `PROBLEM-SOLVING` `DATA-PIPELINE` `AI-INTEGRATION`
- **Industry fit:** DevOps, workflow automation, infrastructure
- **Notable:** GCP free-tier infrastructure; Docker Compose deployment; SSL via Caddy; backup automation

#### generic_modules
Reusable drop-in modules for React + Netlify projects: auth, health checks, browser extensions.
- **Stack:** React, TypeScript, Tailwind, Netlify Functions, Neon PostgreSQL, bcryptjs
- **Skills:** `PROBLEM-SOLVING` `DEVOPS`
- **Industry fit:** Developer tools, SaaS infrastructure

#### NewsJuicer
Google Apps Script scanning Gmail for AI newsletters, summarizing and sending compiled digests.
- **Stack:** Google Apps Script, Gmail API
- **Skills:** `DATA-PIPELINE` `PROBLEM-SOLVING`
- **Industry fit:** Content curation, automation

---

### WordPress & Web Design

#### JBWordPressTheme
WordPress FSE block theme with dark design, glassmorphism nav, tag-based portfolio filtering.
- **Stack:** WordPress 6.4+, PHP 8.0+, FSE/theme.json v3, Manrope typography, vanilla JS
- **Skills:** `DESIGN` `TECHNICAL-WRITING` `DOMAIN-EXPERTISE`
- **Industry fit:** Web design, WordPress, agencies
- **Notable:** 9 custom block patterns; 10 page templates; fluid typography with clamp(); accessibility features

---

### Media & Ambient Display

#### ambient-gallery
Cross-platform ambient photo slideshow for desktops, TVs, and tablets (Electron, Fire TV, Tizen, webOS, Google Cast).
- **Stack:** TypeScript, Preact, Vite, Electron, Android WebView, Tizen/webOS, Google Cast
- **Skills:** `CROSS-PLATFORM` `DESIGN` `PROBLEM-SOLVING`
- **Industry fit:** Smart home, media, IoT, consumer electronics
- **Notable:** 6 platform targets from single codebase; GPU-only transitions; local-first architecture
- **State:** Planning/architecture phase

---

### Technical Assessments

#### takehome_q
Python decorator validating `dict[str, int]` function arguments — Friendli.ai technical assessment.
- **Stack:** Python 3.11+, pytest
- **Skills:** `PROBLEM-SOLVING` `TECHNICAL-WRITING`
- **Industry fit:** Any (demonstrates Python depth)
- **Notable:** Thorough documentation of design decisions; explicit boolean rejection despite Python's bool-is-int

#### misc/friendli-assessment
Technical writing samples: LLM migration guides and model evaluation frameworks.
- **Skills:** `TECHNICAL-WRITING` `AI-INTEGRATION` `DOMAIN-EXPERTISE`
- **Industry fit:** AI/ML, developer relations, technical writing

#### misc/FutureSketch
Python scripts controlling WS8112 LED grids via DMX protocol for interactive sculpture.
- **Stack:** Python, DMX protocol, BeagleBone, Pixlite 4, rotary encoders
- **Skills:** `PROBLEM-SOLVING` `DOMAIN-EXPERTISE`
- **Industry fit:** IoT, hardware, interactive installations, art tech

---

## WORKSPACE 2: antigravity-and-others/ (Novel Writing Factory)

---

#### novel-editing-tools
Python CLI + API suite for AI-powered manuscript analysis: grammar, style, voice, chapter splitting, revision planning.
- **Stack:** Python 3.10+, FastAPI, Anthropic/OpenAI SDKs, python-docx, MCP server
- **Skills:** `AI-INTEGRATION` `TECHNICAL-WRITING` `PROBLEM-SOLVING` `DATA-PIPELINE` `DOMAIN-EXPERTISE`
- **Industry fit:** Publishing, AI/ML, developer tools
- **Notable:** 18 Python modules; MCP server for agent integration; 57KB portable editing workflow guide; model-specific recommendations document

#### manuscript-editor
PWA for editing markdown manuscripts stored in GitHub repos with AI assistance.
- **Stack:** Vite, vanilla JS, Marked.js, Netlify Functions, GitHub API, PWA
- **Skills:** `DESIGN` `USER-EMPATHY` `PROBLEM-SOLVING`
- **Industry fit:** Publishing, edtech, developer tools
- **Notable:** Auto-save to GitHub every 30 seconds; installable as iPad standalone app

#### agent-workspace
Non-executable workflow definitions and agent persona configs for multi-model novel creation pipelines.
- **Stack:** Markdown, JSON configs (Claude Sonnet, Gemini Pro, Perplexity, HuggingFace)
- **Skills:** `TECHNICAL-WRITING` `AI-INTEGRATION` `PROBLEM-SOLVING`
- **Industry fit:** AI/ML, workflow automation, publishing
- **Notable:** 15 workflow templates; 5+ agent persona configs with model assignments

#### possible-workflows
88KB research document on AI-assisted fiction writing automation — multi-model architectures, iterative expansion, worldbuilding methods.
- **Skills:** `TECHNICAL-WRITING` `AI-INTEGRATION` `DOMAIN-EXPERTISE`
- **Industry fit:** AI/ML, publishing, research

#### novel-workspace
Storage for 11+ novel manuscripts and 50+ short stories in various drafting stages.
- **Skills:** `DOMAIN-EXPERTISE` `TECHNICAL-WRITING`
- **Industry fit:** Publishing, creative writing
- **Notable:** Miskatonic Boys (Lovecraftian horror comedy) with supporting Lorebook; genres span sci-fi, fantasy, detective fiction, horror

#### resources/potential-gastown-rig
Gastown orchestration configs for novel generation with cost-tiered profiles ($3-5 to $60-90 per novel).
- **Stack:** JSON/TOML config, Gastown framework
- **Skills:** `AI-INTEGRATION` `PROBLEM-SOLVING` `DEVOPS`
- **Industry fit:** AI/ML, workflow automation
- **Notable:** 4 cost profiles from ultra-budget (GPT-4o-mini) to premium (Claude Opus); 30-chapter/120K-word defaults

---

## INDUSTRY CROSS-REFERENCE

### Gaming Positions
**Primary:** game-fusionball (Unreal/C++), weirdchess (Flutter), game-wizard-pi + game-wizard-pi-unity (React + Unity interactive fiction), Fractasy (GPU shaders)
**Supporting:** WishfulPhysics, WeirdTarot (game-adjacent entertainment)

### Fintech Positions
**Primary:** ValueApe (stock screener, backtesting, trading strategies), apiTracker (cost management dashboards)
**Supporting:** ShamAIn/GPTWrapper (Stripe/RevenueCat payment integration), Cloudflare Workers architecture

### AI/ML Positions
**Primary:** Metabot, Novelizer, EthicalAIditor, gastown, LensQuery, PhotoPhreaker, novel-editing-tools
**Supporting:** Nearly every project demonstrates multi-provider LLM integration, prompt engineering, or vision AI

### Publishing / Creative Tools
**Primary:** ManuscriptReview, Novelizer, StoryPlot, StoryLoft, EthicalAIditor, novel-editing-tools, plottoxml
**Supporting:** StoryCircle-dev, manuscript-editor, novel-workspace, CoverJudge, Postboi

### Technical Writing / Developer Relations
**Primary:** JobSearcher (technical writer job search), takehome_q, misc/friendli-assessment, code-wiki, possible-workflows
**Supporting:** Every project's CLAUDE.md and documentation; plottoxml (data standards); agent-workspace (workflow specs)

### Mobile / Cross-Platform
**Primary:** SierraTrails (Expo), GNN (Expo), weirdchess (Flutter), Fractasy (Flutter), game-fusionball (multi-platform)
**Supporting:** ShamAIn, RedditUF, SearchBard, ManuscriptReview, Postboi (all have Capacitor/RN variants)

### DevOps / Infrastructure
**Primary:** n8n_workflows (Docker/GCP), gastown (Go/agent orchestration), code-wiki (MCP server), generic_modules
**Supporting:** Cloudflare Workers (ValueApe, EthicalAIditor), GitHub Actions (JobSearcher)

### Design / UX
**Primary:** WebToFigma, JBWordPressTheme, ambient-gallery, Create, SacredGeometryOutliner
**Supporting:** Fractasy (generative art), TrollJar (behavioral design), Theorazine (educational UX)

### Education
**Primary:** Theorazine, FreeWillEstimator, Musix (Schillinger system)
**Supporting:** StoryPlot (narrative education), WeirdTarot (cultural systems)

### Social Impact / Nonprofit
**Primary:** TrollJar (charitable micro-donations), GNN (positive news)
**Supporting:** SierraTrails (outdoor access), EthicalAIditor (ethical AI)

### Hardware / IoT
**Primary:** misc/FutureSketch (LED sculpture, DMX, BeagleBone)
**Supporting:** ambient-gallery (smart TV/Cast platforms), PhotoPhreaker (print/physical art pipeline)

---

## CROSS-CUTTING THEMES

1. **AI-Age Software Development:** 40+ projects integrate LLMs; demonstrates fluency with prompt engineering, multi-provider fallback, cost optimization, on-device inference, RAG pipelines, MCP protocol, and multi-agent orchestration.

2. **User Empathy:** Adjustable AI feedback tone (ManuscriptReview), behavioral psychology (TrollJar transforms anger into donations), accessibility-first design (JBWordPressTheme), offline-first architecture (ambient-gallery, Theorazine PWA).

3. **Problem Solving:** Novel game mechanics (Fusionball's possession-transfer), cost-optimized tiling for vision AI (LensQuery), consensus-mode multi-draft AI writing (Novelizer), perceptual hashing for deduplication (meme-renamer).

4. **Cross-Platform Architecture:** Single codebases targeting web + iOS + Android + desktop via Capacitor, Expo, Flutter, Tauri, and Electron across 15+ projects.

5. **Domain Depth:** Photography (LensQuery, PhotoPhreaker), music theory (Musix/Schillinger), narrative structure (StoryPlot/Plotto/Story Circle), chess variants (weirdchess), sacred geometry (Fractasy, SacredGeometryOutliner), WordPress FSE (JBWordPressTheme), stock analysis (ValueApe).

6. **Technical Writing:** Comprehensive CLAUDE.md files across all projects; 57KB portable editing workflow guide; Friendli.ai assessment writing samples; data standards work (plottoxml); workflow specification documents.
