#!/usr/bin/env node

/**
 * Standalone metrics collection script.
 * Run by GitHub Actions to collect and persist observatory metrics.
 * Saves to web/public/data/metrics/ (single authoritative location)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { loadConfig, loadMetricsConfig, createEmptySnapshot, MetricsSnapshot } from '../types/index.js';
import { GitHubCollector } from '../services/collectors/githubCollector.js';
import { NetlifyCollector } from '../services/collectors/netlifyCollector.js';
import { CloudflareCollector } from '../services/collectors/cloudflareCollector.js';
import { GcpCollector } from '../services/collectors/gcpCollector.js';
import { SupabaseCollector } from '../services/collectors/supabaseCollector.js';
import { N8nCollector } from '../services/collectors/n8nCollector.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  // Load env
  dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

  const config = loadConfig();
  const metricsConfig = loadMetricsConfig();

  logger.info('CollectMetrics', 'Starting metrics collection');

  const snapshot = createEmptySnapshot();

  // Initialize available collectors
  const collectors: Array<{ name: string; collector: { collect(): Promise<unknown> } }> = [];

  if (config.githubToken && config.githubUsername) {
    collectors.push({ name: 'github', collector: new GitHubCollector(config) });
  }
  if (metricsConfig.netlifyAccessToken) {
    collectors.push({ name: 'netlify', collector: new NetlifyCollector(metricsConfig) });
  }
  if (metricsConfig.cloudflareApiToken && metricsConfig.cloudflareAccountId) {
    collectors.push({ name: 'cloudflare', collector: new CloudflareCollector(metricsConfig) });
  }
  if (metricsConfig.gcpServiceAccountKeyPath) {
    collectors.push({ name: 'gcp', collector: new GcpCollector(metricsConfig) });
  }
  if (metricsConfig.supabaseAccessToken && metricsConfig.supabaseProjectRefs.length > 0) {
    collectors.push({ name: 'supabase', collector: new SupabaseCollector(metricsConfig) });
  }
  if (metricsConfig.n8nApiUrl && metricsConfig.n8nApiKey) {
    collectors.push({ name: 'n8n', collector: new N8nCollector(metricsConfig) });
  }

  logger.info('CollectMetrics', `Active collectors: ${collectors.map(c => c.name).join(', ') || 'none'}`);

  // Run all collectors in parallel
  const results = await Promise.allSettled(
    collectors.map(async ({ name, collector }) => {
      const data = await collector.collect();
      return { name, data };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.data) {
      (snapshot.sources as Record<string, unknown>)[result.value.name] = result.value.data;
    } else if (result.status === 'rejected') {
      logger.error('CollectMetrics', `Collector failed`, result.reason);
    }
  }

  snapshot.collectedAt = new Date().toISOString();

  // Save to single authoritative location (web/public/data/metrics/)
  // Previously dual-wrote to mcp-server/data/metrics/ as well — consolidated
  // as part of Phase 1 rearchitecture (see HANDOFF-rearchitecture.md decision #5).
  const date = new Date().toISOString().split('T')[0];
  const jsonContent = JSON.stringify(snapshot, null, 2);

  const outputDir = path.join(__dirname, '..', '..', '..', 'web', 'public', 'data', 'metrics');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, `metrics-${date}.json`), jsonContent, 'utf-8');
  await fs.writeFile(path.join(outputDir, 'latest.json'), jsonContent, 'utf-8');
  logger.info('CollectMetrics', `Saved to ${outputDir}`);

  logger.info('CollectMetrics', `Collection complete. Sources: ${Object.keys(snapshot.sources).join(', ')}`);
}

main().catch(error => {
  logger.error('CollectMetrics', 'Fatal error', error);
  process.exit(1);
});
