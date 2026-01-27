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

export function loadConfig(): Config {
  return {
    sourceDirectories: (process.env.SOURCE_DIRS || '').split(',').map(s => s.trim()).filter(Boolean),
    wikiDirectory: process.env.WIKI_DIR || './wiki',
    preferencesDirectory: process.env.PREFERENCES_DIR || undefined,
    cacheDirectory: process.env.CACHE_DIR || './data',
    githubUsername: process.env.GITHUB_USERNAME || '',
    githubToken: process.env.GITHUB_TOKEN,
    syncIntervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES || '60', 10),
    indexOnStartup: process.env.INDEX_ON_STARTUP !== 'false',
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS || '50', 10),
    wikiBoostMultiplier: parseFloat(process.env.WIKI_BOOST_MULTIPLIER || '2.0'),
    cacheMaxAgeMinutes: parseInt(process.env.CACHE_MAX_AGE_MINUTES || '60', 10),
  };
}
