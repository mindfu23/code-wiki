# Code Wiki - Future Enhancements

## File Type Rendering

Currently, non-markdown files (.txt, .rst, .adoc, .org) link directly to GitHub for viewing/editing. Future enhancements could add in-app rendering:

### Syntax Highlighting for Code-like Files
- [ ] Add Prism.js or highlight.js for syntax highlighting
- [ ] Display .txt, .yaml, .json, .toml as syntax-highlighted code blocks
- [ ] Add copy-to-clipboard button for code blocks

### reStructuredText (.rst) Support
- [ ] Add rst-to-html renderer (e.g., rst2html, docutils-js)
- [ ] Parse RST directives and roles
- [ ] Handle RST-specific features (admonitions, code blocks, etc.)

### AsciiDoc (.adoc, .asciidoc) Support
- [ ] Add AsciiDoctor.js for rendering
- [ ] Support AsciiDoc-specific features (includes, macros)
- [ ] Handle document attributes

### Org Mode (.org) Support
- [ ] Add org-mode parser (e.g., orga, org-js)
- [ ] Support org-specific features (TODO items, tables, code blocks)
- [ ] Handle org-babel code execution display

## Additional File Types to Consider

- [ ] `.mdx` - MDX (Markdown + JSX) - requires JSX processing
- [ ] `.ipynb` - Jupyter Notebooks - JSON with embedded markdown/code
- [ ] `LICENSE`, `CHANGELOG` (no extension) - detect by filename
- [ ] `.yaml`, `.yml` - YAML config files (useful for documentation)
- [ ] `.json` - JSON files (useful for config documentation)

## UI/UX Improvements

### File Browser Enhancements
- [ ] Add file type filter dropdown (show only .md, only .rst, etc.)
- [ ] Add search within file list
- [ ] Collapsible repo sections
- [ ] Tree view option (show directory structure)

### In-App Viewing
- [ ] Fetch and display file content directly from GitHub API
- [ ] Side-by-side raw/rendered view toggle
- [ ] Inline editing for authenticated users (all file types)

## Search Enhancements

- [ ] Search across all file types (not just wiki .md files)
- [ ] Full-text search within repo documentation files
- [ ] Filter search results by file type

### All Files Search Mode
- [ ] Add dropdown with "Documents" (default) vs "All Files" options
- [ ] Index all file paths in repos (not just doc files) - store as `allFiles: string[]`
- [ ] "All Files" mode searches all filenames (.py, .js, .ts, etc.) and links to GitHub edit
- [ ] Pagination: Show first 100 results with "Next 100" link
- [ ] Cap at 500 results with "Too many results" message
- [ ] Remove "Include repo files" checkbox when "All Files" is selected (redundant)

## Performance

- [ ] Lazy load file lists for repos with many files
- [ ] Virtual scrolling for large file lists
- [ ] Cache GitHub API responses in browser localStorage

## Integration Ideas

- [ ] VS Code extension to open files directly in editor
- [ ] CLI tool to search across repos from terminal
- [ ] MCP server integration for AI-assisted documentation search

## Observatory — Project Health Dashboard

### Phase 1: Core + GitHub + Netlify (complete)

- [x] Metrics type definitions (`mcp-server/src/types/metrics.ts`)
- [x] Base collector pattern with error handling and timing
- [x] GitHub collector (commits, Actions runs, traffic, open issues)
- [x] Netlify collector (sites, deploys, success rates)
- [x] MetricsService orchestrating collectors with `Promise.allSettled()`
- [x] MCP tools: `project_health`, `deploy_status`, `infra_overview`
- [x] Web dashboard with sortable project health matrix table
- [x] Language distribution doughnut chart (Chart.js)
- [x] Deploy status bar chart with healthy/warning/error/not-deployed breakdown
- [x] Status message below deploy chart ("All deploys are currently healthy")
- [x] Descriptive error summary ("2 with GitHub Actions errors" instead of generic)
- [x] Issues column linked to GitHub issues page
- [x] Access control: public visitors see public repos only; owner sees all (matches full-index auth pattern)
- [x] Dashboard data function merges GitHub API + wiki index for complete project coverage
- [x] Secret sanitization in index builder (strips API key patterns, skips SpecStory/conversation log files)
- [x] `export-bronze` Netlify function for Databricks ingestion (JSON/NDJSON, filterable by source)
- [x] `collectMetrics.ts` standalone script for GitHub Actions
- [x] `.github/workflows/collect-metrics.yml` — automated collection every 6 hours
- [x] Databricks integration guide (`wiki/integrations/databricks-observatory.md`)

### Phase 2: Remaining Collectors + MCP Tools

- [ ] Cloudflare Workers collector (analytics via CF GraphQL API)
- [ ] GCP collector (Cloud Run + Compute Engine metrics, manual JWT auth)
- [ ] Supabase collector (DB size, auth users, API counts)
- [ ] n8n collector (workflow executions, success rates, durations)
- [ ] Obtain and configure credentials: CF_API_TOKEN, CF_ACCOUNT_ID, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REFS, N8N_API_URL, N8N_API_KEY
- [ ] Add GitHub Secrets for collect-metrics.yml workflow (NETLIFY_ACCESS_TOKEN, CF_API_TOKEN, etc.)

### Phase 3: Trends + Databricks

- [ ] Historical trend charts (commit activity over time, deploy success trends)
- [x] Databricks Community Edition signup and cluster setup
- [x] Create Databricks notebook: fetch from export-bronze endpoint
- [x] Build bronze → silver → gold Delta tables
- [ ] Create SQL dashboard visualizations in Databricks
