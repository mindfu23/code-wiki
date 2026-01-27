#!/usr/bin/env node

/**
 * Code Wiki MCP Server
 *
 * Local-first code search across repositories with curated wiki content
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { loadConfig } from './types/index.js';
import { CacheService } from './services/cacheService.js';
import { IndexService } from './services/indexService.js';
import { WikiService } from './services/wikiService.js';
import { RipgrepService } from './services/ripgrepService.js';
import { SearchService } from './services/searchService.js';
import { SyncService } from './services/syncService.js';
import { CodeWikiServer } from './server.js';
import { logger } from './utils/logger.js';

// Get the directory of this file for relative paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  // Load environment variables from .env file
  dotenv.config({ path: path.join(__dirname, '..', '.env') });

  // Also try loading from the mcp-server directory
  dotenv.config({ path: path.join(__dirname, '..', '..', 'mcp-server', '.env') });

  logger.info('Main', 'Starting Code Wiki MCP Server');

  // Load configuration
  const config = loadConfig();

  // Validate configuration
  if (config.sourceDirectories.length === 0) {
    logger.error('Main', 'No source directories configured. Set SOURCE_DIRS environment variable.');
    process.exit(1);
  }

  logger.info('Main', `Source directories: ${config.sourceDirectories.join(', ')}`);
  logger.info('Main', `Wiki directory: ${config.wikiDirectory}`);

  // Initialize services
  const cacheService = new CacheService(
    path.isAbsolute(config.cacheDirectory)
      ? config.cacheDirectory
      : path.join(__dirname, '..', config.cacheDirectory)
  );

  const wikiService = new WikiService(config.wikiDirectory);
  const indexService = new IndexService(config, cacheService, wikiService);
  const ripgrepService = new RipgrepService();
  const searchService = new SearchService(config, indexService, ripgrepService);
  const syncService = new SyncService(config, cacheService, indexService);

  // Check ripgrep availability
  const rgAvailable = await ripgrepService.isAvailable();
  if (!rgAvailable) {
    logger.warn('Main', 'ripgrep (rg) not found. Repository search will be limited. Install with: brew install ripgrep');
  }

  // Initialize sync service
  await syncService.initialize();

  // Load cached index for fast startup
  const cachedIndex = await cacheService.loadIndex();

  if (cachedIndex && !cacheService.isIndexStale(cachedIndex, config.cacheMaxAgeMinutes)) {
    indexService.setIndex(cachedIndex);
    logger.info('Main', 'Loaded cached index');
  } else {
    logger.info('Main', 'Cache is stale or missing, building index...');
  }

  // Build index in background if needed
  if (!cachedIndex || cacheService.isIndexStale(cachedIndex, config.cacheMaxAgeMinutes)) {
    // Don't await - let it run in background
    indexService.buildFullIndex().then(() => {
      logger.info('Main', 'Background index build complete');
    }).catch(err => {
      logger.error('Main', 'Background index build failed', err);
    });
  }

  // Start background sync if GitHub credentials are configured
  if (config.githubUsername && config.githubToken) {
    syncService.startBackgroundSync();
  } else {
    logger.info('Main', 'GitHub sync disabled (no token configured)');
  }

  // Create and start MCP server
  const codeWikiServer = new CodeWikiServer(
    config,
    indexService,
    searchService,
    wikiService,
    syncService
  );

  const transport = new StdioServerTransport();
  await codeWikiServer.getServer().connect(transport);

  logger.info('Main', 'Code Wiki MCP Server running on stdio');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Main', 'Shutting down...');
    syncService.stopBackgroundSync();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Main', 'Shutting down...');
    syncService.stopBackgroundSync();
    process.exit(0);
  });
}

main().catch(error => {
  logger.error('Main', 'Fatal error', error);
  process.exit(1);
});
