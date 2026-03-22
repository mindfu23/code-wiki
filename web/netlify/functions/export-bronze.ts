/**
 * Export Bronze — serves raw metrics data for Databricks ingestion.
 * Returns JSON or NDJSON format, filterable by source and date range.
 *
 * Query params:
 *   ?source=github,netlify  (comma-separated, default: all)
 *   ?format=json|ndjson     (default: json)
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import * as fs from 'fs';
import * as path from 'path';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const params = event.queryStringParameters || {};
  const requestedSources = params.source?.split(',').map(s => s.trim()) || [];
  const format = params.format === 'ndjson' ? 'ndjson' : 'json';

  try {
    // Try loading committed metrics files
    const metricsDir = path.join(__dirname, '..', '..', 'public', 'data', 'metrics');
    let snapshot: Record<string, unknown> | null = null;

    try {
      const latestPath = path.join(metricsDir, 'latest.json');
      const content = fs.readFileSync(latestPath, 'utf-8');
      snapshot = JSON.parse(content);
    } catch {
      // No committed metrics yet — collect live
      snapshot = await collectLiveMetrics();
    }

    if (!snapshot) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'No metrics data available yet. Metrics are collected periodically via GitHub Actions.',
          sources: [],
        }),
      };
    }

    // Filter by source if requested
    const sources = (snapshot as { sources?: Record<string, unknown> }).sources || {};
    let filteredSources: Record<string, unknown>;

    if (requestedSources.length > 0) {
      filteredSources = {};
      for (const source of requestedSources) {
        if (sources[source]) {
          filteredSources[source] = sources[source];
        }
      }
    } else {
      filteredSources = sources;
    }

    // Format output
    if (format === 'ndjson') {
      const lines = Object.entries(filteredSources).map(([source, data]) =>
        JSON.stringify({ source, ...data as object })
      );
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
        body: lines.join('\n'),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        exportedAt: new Date().toISOString(),
        snapshotTime: (snapshot as { collectedAt?: string }).collectedAt,
        format: 'bronze',
        sources: filteredSources,
      }, null, 2),
    };
  } catch (error) {
    console.error('Export bronze error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function collectLiveMetrics(): Promise<Record<string, unknown> | null> {
  const githubToken = process.env.GITHUB_TOKEN || process.env.REPO_ACCESS_TOKEN;
  const githubUsername = process.env.GITHUB_USERNAME || process.env.GITHUB_REPO_OWNER;
  const netlifyToken = process.env.NETLIFY_ACCESS_TOKEN;

  if (!githubToken || !githubUsername) return null;

  const sources: Record<string, unknown> = {};

  // Minimal GitHub data
  try {
    const response = await fetch(
      `https://api.github.com/users/${githubUsername}/repos?sort=pushed&per_page=100&type=owner`,
      {
        headers: {
          Authorization: `Bearer ${token(githubToken)}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'code-wiki-observatory',
        },
      }
    );
    if (response.ok) {
      const repos = await response.json();
      sources.github = { collectedAt: new Date().toISOString(), repos };
    }
  } catch { /* skip */ }

  // Minimal Netlify data
  if (netlifyToken) {
    try {
      const response = await fetch('https://api.netlify.com/api/v1/sites', {
        headers: { Authorization: `Bearer ${netlifyToken}` },
      });
      if (response.ok) {
        const sites = await response.json();
        sources.netlify = { collectedAt: new Date().toISOString(), sites };
      }
    } catch { /* skip */ }
  }

  return { collectedAt: new Date().toISOString(), version: '1.0.0', sources };
}

function token(t: string): string { return t; }

export { handler };
