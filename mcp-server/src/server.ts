/**
 * MCP Server implementation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Config } from './types/index.js';
import { IndexService } from './services/indexService.js';
import { SearchService } from './services/searchService.js';
import { WikiService } from './services/wikiService.js';
import { SyncService } from './services/syncService.js';

// Tools
import { searchWikiTool, handleSearchWiki } from './tools/searchWiki.js';
import { searchReposTool, handleSearchRepos } from './tools/searchRepos.js';
import { getDocumentTool, handleGetDocument } from './tools/getDocument.js';
import { getFileTool, handleGetFile } from './tools/getFile.js';
import { listReposTool, handleListRepos } from './tools/listRepos.js';
import { listCategoryTool, handleListCategory } from './tools/listCategory.js';
import { syncReposTool, handleSyncRepos } from './tools/syncRepos.js';
import { getPreferencesTool, handleGetPreferences } from './tools/getPreferences.js';

import { logger } from './utils/logger.js';

export class CodeWikiServer {
  private server: Server;
  private config: Config;
  private indexService: IndexService;
  private searchService: SearchService;
  private wikiService: WikiService;
  private syncService: SyncService;

  constructor(
    config: Config,
    indexService: IndexService,
    searchService: SearchService,
    wikiService: WikiService,
    syncService: SyncService
  ) {
    this.config = config;
    this.indexService = indexService;
    this.searchService = searchService;
    this.wikiService = wikiService;
    this.syncService = syncService;

    this.server = new Server(
      {
        name: 'code-wiki-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        searchWikiTool,
        searchReposTool,
        getDocumentTool,
        getFileTool,
        listReposTool,
        listCategoryTool,
        syncReposTool,
        getPreferencesTool,
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: string;

        switch (name) {
          case 'search_wiki':
            result = await handleSearchWiki(
              args as { query: string; category?: string; language?: string; limit?: number },
              this.searchService
            );
            break;

          case 'search_repos':
            result = await handleSearchRepos(
              args as { query: string; repo?: string; language?: string; limit?: number },
              this.searchService
            );
            break;

          case 'get_document':
            result = await handleGetDocument(
              args as { path: string },
              this.wikiService
            );
            break;

          case 'get_file':
            result = await handleGetFile(
              args as { repo: string; path: string },
              this.indexService
            );
            break;

          case 'list_repos':
            result = await handleListRepos(
              args as { sortBy?: string; language?: string },
              this.indexService
            );
            break;

          case 'list_category':
            result = await handleListCategory(
              args as { category?: string },
              this.wikiService,
              this.indexService
            );
            break;

          case 'sync_repos':
            result = await handleSyncRepos(
              args as { force?: boolean },
              this.syncService
            );
            break;

          case 'get_preferences':
            result = await handleGetPreferences(
              args as { file?: string },
              this.config
            );
            break;

          default:
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ error: `Unknown tool: ${name}` }),
              }],
              isError: true,
            };
        }

        return {
          content: [{
            type: 'text' as const,
            text: result,
          }],
        };
      } catch (error) {
        logger.error('Server', `Tool ${name} failed`, error);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Tool execution failed',
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
          }],
          isError: true,
        };
      }
    });

    // List resources (wiki documents as resources)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const wikiDocs = this.indexService.getAllWikiDocuments();

      return {
        resources: wikiDocs.map(doc => ({
          uri: `wiki://${doc.relativePath}`,
          name: doc.frontmatter.title,
          description: doc.frontmatter.description || doc.contentPreview.slice(0, 100),
          mimeType: 'text/markdown',
        })),
      };
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const path = uri.replace('wiki://', '');

      const doc = await this.wikiService.getDocument(path);

      if (!doc) {
        throw new Error(`Resource not found: ${path}`);
      }

      // Return full document with frontmatter as YAML header
      const frontmatterYaml = [
        '---',
        `title: "${doc.frontmatter.title}"`,
        `tags: [${doc.frontmatter.tags.map(t => `"${t}"`).join(', ')}]`,
        doc.frontmatter.language ? `language: "${doc.frontmatter.language}"` : null,
        doc.frontmatter.updated ? `updated: "${doc.frontmatter.updated}"` : null,
        doc.frontmatter.source_repo ? `source_repo: "${doc.frontmatter.source_repo}"` : null,
        '---',
      ].filter(Boolean).join('\n');

      return {
        contents: [{
          uri,
          mimeType: 'text/markdown',
          text: `${frontmatterYaml}\n\n${doc.content}`,
        }],
      };
    });
  }

  getServer(): Server {
    return this.server;
  }
}
