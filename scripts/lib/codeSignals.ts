/**
 * Infer external services from a repo's tracked source (not just its manifests).
 *
 * Manifests miss services called over plain HTTP or installed outside the manifest
 * (e.g. `pip install` in a workflow). This greps tracked, non-documentation files for API
 * hosts and SDK imports and maps hits to taxonomy `service` terms.
 */

import { execFileSync } from 'child_process';

/** service term -> POSIX extended regex (case-insensitive). macOS git grep -E has no \s or \b:
 *  use [[:space:]] and explicit boundaries. tests/codeSignals.test.ts guards this. */
export const CODE_SERVICE_SIGNALS: Record<string, string> = {
  'google-gemini-api': String.raw`generativelanguage\.googleapis\.com|@google/(genai|generative-ai)|from google import genai|google\.generativeai`,
  'anthropic-api': String.raw`api\.anthropic\.com|@anthropic-ai/sdk|^[[:space:]]*(import|from) anthropic([^A-Za-z0-9_]|$)`,
  'openai-api': String.raw`api\.openai\.com|from ['"]openai['"]|require\(['"]openai['"]\)|^[[:space:]]*(import|from) openai([^A-Za-z0-9_]|$)`,
  'perplexity-api': String.raw`api\.perplexity\.ai`,
  'xai-api': String.raw`api\.x\.ai`,
  'deepseek-api': String.raw`api\.deepseek\.com`,
  'huggingface-api': String.raw`api-inference\.huggingface\.co|router\.huggingface\.co|@huggingface/inference|huggingface_hub`,
  'spotify-api': String.raw`api\.spotify\.com|accounts\.spotify\.com`,
  'stripe-api': String.raw`api\.stripe\.com|from ['"]stripe['"]|^[[:space:]]*import stripe([^A-Za-z0-9_]|$)`,
  'google-sheets-api': String.raw`sheets\.googleapis\.com|^[[:space:]]*import gspread([^A-Za-z0-9_]|$)`,
  'github-api': String.raw`api\.github\.com|@octokit/`,
  'supabase-api': String.raw`\.supabase\.co([^A-Za-z0-9_]|$)|@supabase/supabase-js`,
  'netlify-api': String.raw`api\.netlify\.com`,
  'cloudflare-api': String.raw`api\.cloudflare\.com`,
};

const EXCLUDES = [
  ':!*.md', ':!*.txt', ':!*.example', ':!**/.env*', ':!*.lock', ':!*lock.json', ':!*.min.js', ':!*.map',
  ':!**/node_modules/**', ':!**/dist/**', ':!**/build/**', ':!**/fixtures/**',
];

/** Returns service terms with at least one tracked-file hit. Never throws. */
export function inferServicesFromCode(localPath: string, timeoutMs = 3000): string[] {
  const found: string[] = [];
  for (const [service, pattern] of Object.entries(CODE_SERVICE_SIGNALS)) {
    try {
      execFileSync('git', ['-C', localPath, 'grep', '-q', '-I', '-i', '-E', pattern, '--', ...EXCLUDES], {
        stdio: 'ignore',
        timeout: timeoutMs,
      });
      found.push(service); // exit 0 = at least one match
    } catch {
      /* exit 1 = no match; anything else (not a repo, timeout) = no signal */
    }
  }
  return found.sort();
}
