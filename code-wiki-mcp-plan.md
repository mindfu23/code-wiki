# Code Wiki + MCP Server Implementation Plan

## Overview

Create a private GitHub repository (`code-wiki`) containing documented, reusable code patterns and utilities, paired with an MCP (Model Context Protocol) server that provides AI agents secure read access to this knowledge base.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│   MCP Server    │────▶│  Private Repo   │
│ (Claude, etc.)  │     │ (Node.js/Python)│     │  (code-wiki)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        GitHub API
                        (PAT auth)
```

---

## Phase 1: Create the code-wiki Repository Structure

### 1.1 Initialize Private Repository

```bash
# Create new private repo on GitHub named "code-wiki"
# Clone locally
git clone git@github.com:USERNAME/code-wiki.git
cd code-wiki
```

### 1.2 Directory Structure

```
code-wiki/
├── README.md                 # Overview and usage instructions
├── manifest.json             # Machine-readable index for MCP server
├── AGENTS.md                 # Instructions for AI agents using this wiki
│
├── patterns/                 # Reusable code patterns
│   ├── _index.md
│   ├── error-handling.md
│   ├── api-client.md
│   └── ...
│
├── utilities/                # Standalone utility functions
│   ├── _index.md
│   ├── date-helpers.md
│   ├── string-utils.md
│   └── ...
│
├── integrations/             # API integrations and service connectors
│   ├── _index.md
│   ├── github-api.md
│   ├── openai-api.md
│   ├── n8n-workflows.md
│   └── ...
│
├── templates/                # Project/file templates
│   ├── _index.md
│   ├── vite-shadcn-starter.md
│   ├── mcp-server-template.md
│   └── ...
│
├── snippets/                 # Small, focused code snippets
│   ├── _index.md
│   └── ...
│
└── projects/                 # Links/docs for your actual repos
    ├── _index.md
    ├── shamanic-guide.md
    └── ...
```

### 1.3 Document Template

Each markdown file should follow this structure for consistent parsing:

```markdown
---
title: "API Client Pattern"
tags: ["typescript", "api", "fetch", "error-handling"]
language: "typescript"
updated: "2025-01-27"
source_repo: "my-project"  # optional: link to origin repo
---

# API Client Pattern

## Purpose
Brief description of what this solves and when to use it.

## Dependencies
- List any npm packages or requirements

## Code

\`\`\`typescript
// Complete, runnable code here
export class ApiClient {
  // ...
}
\`\`\`

## Usage Example

\`\`\`typescript
const client = new ApiClient({ baseUrl: "https://api.example.com" });
const data = await client.get("/users");
\`\`\`

## Notes
- Any gotchas, variations, or related patterns
- Links to related documents in the wiki
```

### 1.4 Create manifest.json

This file allows the MCP server to quickly index available content:

```json
{
  "version": "1.0.0",
  "updated": "2025-01-27",
  "categories": [
    {
      "name": "patterns",
      "description": "Reusable code patterns and architectures",
      "documents": [
        {
          "path": "patterns/api-client.md",
          "title": "API Client Pattern",
          "tags": ["typescript", "api", "fetch"],
          "summary": "Type-safe API client with error handling and retries"
        }
      ]
    }
  ]
}
```

### 1.5 Create AGENTS.md

```markdown
# AI Agent Instructions

This repository is a personal code wiki. When using this wiki:

1. **Search first**: Use the `search_wiki` tool to find relevant code before writing new implementations
2. **Check manifest**: The `manifest.json` contains a structured index of all content
3. **Respect structure**: Code in this wiki has been tested and refined - prefer it over generating new code
4. **Suggest additions**: If you create useful new code, suggest adding it to the wiki

## Available Categories
- `patterns/` - Architectural patterns and design approaches
- `utilities/` - Standalone helper functions
- `integrations/` - Third-party API connectors
- `templates/` - Project and file starters
- `snippets/` - Small, focused code pieces
- `projects/` - Documentation for active repositories
```

---

## Phase 2: GitHub Personal Access Token Setup

### 2.1 Create Fine-Grained PAT

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens
2. Click "Generate new token"
3. Configure:
   - **Name**: `code-wiki-mcp-server`
   - **Expiration**: Set appropriate duration (recommend 90 days, with reminder to rotate)
   - **Repository access**: Select "Only select repositories" → choose `code-wiki`
   - **Permissions**:
     - Contents: Read-only
     - Metadata: Read-only

4. Copy the token immediately (it won't be shown again)

### 2.2 Store Token Securely

For local development, add to environment:

```bash
# Add to ~/.zshrc or ~/.bashrc
export CODE_WIKI_GITHUB_TOKEN="github_pat_xxxxxxxxxxxx"
```

Or use a `.env` file (ensure it's in `.gitignore`):

```
CODE_WIKI_GITHUB_TOKEN=github_pat_xxxxxxxxxxxx
CODE_WIKI_REPO_OWNER=your-username
CODE_WIKI_REPO_NAME=code-wiki
```

---

## Phase 3: MCP Server Implementation

### 3.1 Project Setup

```bash
mkdir code-wiki-mcp-server
cd code-wiki-mcp-server
npm init -y
```

### 3.2 package.json

```json
{
  "name": "code-wiki-mcp-server",
  "version": "1.0.0",
  "description": "MCP server for accessing private code-wiki repository",
  "type": "module",
  "main": "src/index.js",
  "bin": {
    "code-wiki-mcp": "./src/index.js"
  },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@octokit/rest": "^20.0.0",
    "dotenv": "^16.0.0",
    "gray-matter": "^4.0.3"
  }
}
```

### 3.3 src/index.js - Main MCP Server

```javascript
#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Octokit } from "@octokit/rest";
import matter from "gray-matter";
import dotenv from "dotenv";

dotenv.config();

const GITHUB_TOKEN = process.env.CODE_WIKI_GITHUB_TOKEN;
const REPO_OWNER = process.env.CODE_WIKI_REPO_OWNER;
const REPO_NAME = process.env.CODE_WIKI_REPO_NAME || "code-wiki";

if (!GITHUB_TOKEN || !REPO_OWNER) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Cache for manifest and file contents
let manifestCache = null;
let manifestCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper: Fetch file content from GitHub
async function fetchFile(path) {
  try {
    const response = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: path,
    });
    
    if (response.data.type !== "file") {
      throw new Error(`Path ${path} is not a file`);
    }
    
    const content = Buffer.from(response.data.content, "base64").toString("utf-8");
    return content;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

// Helper: Get manifest with caching
async function getManifest() {
  const now = Date.now();
  if (manifestCache && (now - manifestCacheTime) < CACHE_TTL) {
    return manifestCache;
  }
  
  const content = await fetchFile("manifest.json");
  if (content) {
    manifestCache = JSON.parse(content);
    manifestCacheTime = now;
  }
  return manifestCache;
}

// Helper: List directory contents
async function listDirectory(path) {
  try {
    const response = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: path,
    });
    
    if (!Array.isArray(response.data)) {
      return [];
    }
    
    return response.data
      .filter(item => item.type === "file" && item.name.endsWith(".md"))
      .map(item => item.path);
  } catch (error) {
    return [];
  }
}

// Helper: Search across wiki content
async function searchWiki(query, category = null) {
  const manifest = await getManifest();
  const results = [];
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);
  
  for (const cat of manifest.categories) {
    if (category && cat.name !== category) continue;
    
    for (const doc of cat.documents) {
      const titleMatch = queryTerms.some(term => 
        doc.title.toLowerCase().includes(term)
      );
      const tagMatch = doc.tags?.some(tag => 
        queryTerms.some(term => tag.toLowerCase().includes(term))
      );
      const summaryMatch = doc.summary && queryTerms.some(term =>
        doc.summary.toLowerCase().includes(term)
      );
      
      if (titleMatch || tagMatch || summaryMatch) {
        results.push({
          path: doc.path,
          title: doc.title,
          tags: doc.tags,
          summary: doc.summary,
          category: cat.name,
          relevance: (titleMatch ? 3 : 0) + (tagMatch ? 2 : 0) + (summaryMatch ? 1 : 0)
        });
      }
    }
  }
  
  return results.sort((a, b) => b.relevance - a.relevance);
}

// Create MCP Server
const server = new Server(
  {
    name: "code-wiki-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_wiki",
      description: "Search the code wiki for patterns, utilities, and snippets. Returns matching documents with relevance ranking.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search terms (matches against titles, tags, and summaries)"
          },
          category: {
            type: "string",
            description: "Optional: limit search to a category (patterns, utilities, integrations, templates, snippets, projects)",
            enum: ["patterns", "utilities", "integrations", "templates", "snippets", "projects"]
          }
        },
        required: ["query"]
      }
    },
    {
      name: "get_document",
      description: "Retrieve the full content of a wiki document by its path",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the document (e.g., 'patterns/api-client.md')"
          }
        },
        required: ["path"]
      }
    },
    {
      name: "list_category",
      description: "List all documents in a wiki category",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Category name",
            enum: ["patterns", "utilities", "integrations", "templates", "snippets", "projects"]
          }
        },
        required: ["category"]
      }
    },
    {
      name: "get_manifest",
      description: "Get the full wiki manifest showing all available content organized by category",
      inputSchema: {
        type: "object",
        properties: {}
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case "search_wiki": {
        const results = await searchWiki(args.query, args.category);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(results, null, 2)
          }]
        };
      }
      
      case "get_document": {
        const content = await fetchFile(args.path);
        if (!content) {
          return {
            content: [{
              type: "text",
              text: `Document not found: ${args.path}`
            }],
            isError: true
          };
        }
        
        // Parse frontmatter
        const { data: frontmatter, content: body } = matter(content);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              path: args.path,
              frontmatter,
              content: body
            }, null, 2)
          }]
        };
      }
      
      case "list_category": {
        const manifest = await getManifest();
        const category = manifest.categories.find(c => c.name === args.category);
        
        if (!category) {
          return {
            content: [{
              type: "text",
              text: `Category not found: ${args.category}`
            }],
            isError: true
          };
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(category, null, 2)
          }]
        };
      }
      
      case "get_manifest": {
        const manifest = await getManifest();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(manifest, null, 2)
          }]
        };
      }
      
      default:
        return {
          content: [{
            type: "text",
            text: `Unknown tool: ${name}`
          }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Define resources (direct file access)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const manifest = await getManifest();
  const resources = [];
  
  for (const category of manifest.categories) {
    for (const doc of category.documents) {
      resources.push({
        uri: `wiki://${doc.path}`,
        name: doc.title,
        description: doc.summary,
        mimeType: "text/markdown"
      });
    }
  }
  
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const path = uri.replace("wiki://", "");
  
  const content = await fetchFile(path);
  if (!content) {
    throw new Error(`Resource not found: ${path}`);
  }
  
  return {
    contents: [{
      uri,
      mimeType: "text/markdown",
      text: content
    }]
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Code Wiki MCP Server running on stdio");
}

main().catch(console.error);
```

### 3.4 Install Dependencies

```bash
npm install
```

---

## Phase 4: Configure MCP Server in Claude

### 4.1 Claude Desktop Configuration

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "code-wiki": {
      "command": "node",
      "args": ["/absolute/path/to/code-wiki-mcp-server/src/index.js"],
      "env": {
        "CODE_WIKI_GITHUB_TOKEN": "github_pat_xxxxxxxxxxxx",
        "CODE_WIKI_REPO_OWNER": "your-username",
        "CODE_WIKI_REPO_NAME": "code-wiki"
      }
    }
  }
}
```

### 4.2 VS Code / Claude Code Configuration

For Claude Code extension, add to your MCP settings (check current Claude Code documentation for exact location):

```json
{
  "mcp": {
    "servers": {
      "code-wiki": {
        "command": "node",
        "args": ["${workspaceFolder}/../code-wiki-mcp-server/src/index.js"],
        "env": {
          "CODE_WIKI_GITHUB_TOKEN": "${env:CODE_WIKI_GITHUB_TOKEN}",
          "CODE_WIKI_REPO_OWNER": "your-username",
          "CODE_WIKI_REPO_NAME": "code-wiki"
        }
      }
    }
  }
}
```

---

## Phase 5: Testing and Verification

### 5.1 Test MCP Server Locally

```bash
# Set environment variables
export CODE_WIKI_GITHUB_TOKEN="your-token"
export CODE_WIKI_REPO_OWNER="your-username"
export CODE_WIKI_REPO_NAME="code-wiki"

# Run server (it communicates via stdio, so you'll see "running" message on stderr)
node src/index.js
```

### 5.2 Test with MCP Inspector (Optional)

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

### 5.3 Verify in Claude

After restarting Claude Desktop/Code, test with:

- "Search my code wiki for API patterns"
- "List everything in my utilities category"
- "Get the document at patterns/api-client.md"

---

## Phase 6: Maintenance

### 6.1 Adding New Documents

1. Create markdown file following the template in section 1.3
2. Update `manifest.json` with the new document entry
3. Commit and push to GitHub

### 6.2 Automating Manifest Updates (Optional Enhancement)

Consider adding a GitHub Action that auto-generates `manifest.json` from file frontmatter:

```yaml
# .github/workflows/update-manifest.yml
name: Update Manifest

on:
  push:
    paths:
      - '**/*.md'

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node scripts/generate-manifest.js
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: auto-update manifest.json"
```

### 6.3 Token Rotation Reminder

Set a calendar reminder to rotate your GitHub PAT before expiration. Update the token in:
- Environment variables
- Claude Desktop/Code configuration

---

## Summary Checklist

- [ ] Create private `code-wiki` repository on GitHub
- [ ] Set up directory structure per section 1.2
- [ ] Create document template and initial documents
- [ ] Create `manifest.json` with all documents indexed
- [ ] Create `AGENTS.md` with usage instructions
- [ ] Generate GitHub fine-grained PAT with read-only access
- [ ] Create `code-wiki-mcp-server` project
- [ ] Implement MCP server code
- [ ] Configure MCP server in Claude Desktop/Code
- [ ] Test all tools work correctly
- [ ] Begin populating wiki with reusable code from existing repos

---

## Future Enhancements

1. **Full-text search**: Index actual file contents, not just metadata
2. **Code extraction**: Tool to extract just code blocks from documents
3. **Write capability**: Allow agents to suggest additions (via PR creation)
4. **Cross-reference**: Automatic linking between related documents
5. **Version tracking**: Show when code was last validated/tested
