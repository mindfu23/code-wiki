/**
 * Configuration types for the Code Wiki MCP Server
 */

export interface Config {
  /** Directories containing git repos to index */
  sourceDirectories: string[];
  /** Path to curated wiki content */
  wikiDirectory: string;
  /** Path to preferences/recommendations directory (optional) */
  preferencesDirectory?: string;
  /** Where to store index.json and sync-state.json */
  cacheDirectory: string;
  /** GitHub username for sync (optional) */
  githubUsername: string;
  /** GitHub PAT for private repos (optional) */
  githubToken?: string;
  /** Background sync interval in minutes (default: 60) */
  syncIntervalMinutes: number;
  /** Build index on startup (default: true) */
  indexOnStartup: boolean;
  /** Maximum search results to return (default: 50) */
  maxSearchResults: number;
  /** Score multiplier for wiki results (default: 2.0) */
  wikiBoostMultiplier: number;
  /** Max age of cached index before rebuild (default: 60 minutes) */
  cacheMaxAgeMinutes: number;
}

export interface RateLimitConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface MetricsConfig {
  netlifyAccessToken?: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
  gcpServiceAccountKeyPath?: string;
  supabaseAccessToken?: string;
  supabaseProjectRefs: string[];
  n8nApiUrl?: string;
  n8nApiKey?: string;
  metricsCollectionIntervalMinutes: number;
  metricsTtlMinutes: number;
}

export function loadMetricsConfig(): MetricsConfig {
  return {
    netlifyAccessToken: process.env.NETLIFY_ACCESS_TOKEN,
    cloudflareApiToken: process.env.CF_API_TOKEN,
    cloudflareAccountId: process.env.CF_ACCOUNT_ID,
    gcpServiceAccountKeyPath: process.env.GCP_SERVICE_ACCOUNT_KEY_PATH,
    supabaseAccessToken: process.env.SUPABASE_ACCESS_TOKEN,
    supabaseProjectRefs: (process.env.SUPABASE_PROJECT_REFS || '').split(',').map(s => s.trim()).filter(Boolean),
    n8nApiUrl: process.env.N8N_API_URL,
    n8nApiKey: process.env.N8N_API_KEY,
    metricsCollectionIntervalMinutes: parseInt(process.env.METRICS_INTERVAL_MINUTES || '360', 10),
    metricsTtlMinutes: parseInt(process.env.METRICS_TTL_MINUTES || '60', 10),
  };
}

export function loadConfig(): Config {
  return {
    sourceDirectories: (process.env.SOURCE_DIRS || '').split(',').map(s => s.trim()).filter(Boolean),
    wikiDirectory: process.env.WIKI_DIR || './wiki',
    preferencesDirectory: process.env.PREFERENCES_DIR || undefined,
    cacheDirectory: process.env.CACHE_DIR || './data',
    githubUsername: process.env.GITHUB_USERNAME || '',
    githubToken: process.env.GH_API_TOKEN || process.env.GITHUB_TOKEN,
    syncIntervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES || '60', 10),
    indexOnStartup: process.env.INDEX_ON_STARTUP !== 'false',
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS || '50', 10),
    wikiBoostMultiplier: parseFloat(process.env.WIKI_BOOST_MULTIPLIER || '2.0'),
    cacheMaxAgeMinutes: parseInt(process.env.CACHE_MAX_AGE_MINUTES || '60', 10),
  };
}
