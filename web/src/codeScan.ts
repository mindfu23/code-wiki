/**
 * Reads a repo's source (not just its manifests) for the external APIs and
 * AI models it uses. Manifests only show SDK packages, so an API called over
 * plain fetch (common in Netlify functions) and the model IDs an app sends
 * (e.g. "gemini-2.0-flash") are invisible to buildDependencyReport.ts
 * without this.
 *
 * APIs come from the existing detector in scripts/lib/codeSignals.ts, the
 * same one seed-taxonomy.ts runs against local checkouts. Models are matched
 * here with one `git grep -o`. Both need a git checkout, so the nightly job
 * makes a shallow clone of each repo into a temp dir and deletes it after.
 *
 * Nothing here logs repo names, file contents or the token: clone errors are
 * reported as a bare failure, because git's error text repeats the command
 * line, which carries the auth header.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as codeSignalsModule from '../../scripts/lib/codeSignals.js';

// Same CommonJS interop as depMappings in buildDependencyReport.ts.
const codeSignals = ((codeSignalsModule as unknown as { default?: typeof codeSignalsModule }).default ?? codeSignalsModule);
export const { inferServicesFromCode } = codeSignals;

/**
 * Model IDs as apps write them in code, one alternative per family. POSIX ERE
 * for git grep -E (no \s or \b, see codeSignals.ts); matched case-insensitively
 * as whole words, so a match can't start or end inside a longer identifier.
 * Hugging Face models are only caught under well-known orgs, since a bare
 * "owner/name" would match any path.
 */
export const MODEL_PATTERNS: Record<string, string> = {
  openai: String.raw`gpt-(3\.5|4|4o|4\.1|4\.5|5)[a-z0-9.-]*|chatgpt-4o-latest|o[1-4](-mini|-pro|-preview)?-?[0-9-]*|text-embedding-(3-small|3-large|ada-002)|dall-e-[23]|gpt-image-1|whisper-1|tts-1(-hd)?`,
  anthropic: String.raw`claude-(instant|[0-9]|opus|sonnet|haiku)[a-z0-9.-]*`,
  google: String.raw`gemini-([0-9][a-z0-9.-]*|pro(-vision)?|ultra|exp-[a-z0-9.-]+)|gemma-?[0-9][a-z0-9.:-]*|text-embedding-00[0-9]|imagen-[0-9][a-z0-9.-]*|veo-[0-9][a-z0-9.-]*`,
  xai: String.raw`grok-([0-9]|beta|vision|code)[a-z0-9.-]*`,
  deepseek: String.raw`deepseek-(chat|reasoner|coder|v[0-9]|r1)[a-z0-9.-]*`,
  perplexity: String.raw`(llama-3(\.[0-9])?-)?sonar(-small|-medium|-large|-pro|-reasoning|-reasoning-pro|-deep-research)?(-online|-chat)?`,
  mistral: String.raw`(mistral|mixtral|codestral|ministral|pixtral|magistral)-[a-z0-9][a-z0-9.-]*`,
  qwen: String.raw`qwen[0-9.]*-[a-z0-9][a-z0-9.-]*`,
  // Big orgs also publish npm scopes and import paths (@google/genai, openai/resources),
  // so their model names must contain a digit, as nearly all do (google/flan-t5-base).
  huggingface: String.raw`(meta-llama|mistralai|google|qwen|deepseek-ai|microsoft|openai|facebook|stabilityai|black-forest-labs|bigscience|nomic-ai|baai)/[a-z0-9._-]*[0-9][a-z0-9._-]*|(tiiuae|huggingfaceh4|sentence-transformers|prosusai|yiyanghkust|fingpt|cardiffnlp|distilbert)/[a-z0-9][a-z0-9._-]*`,
};

// Same exclusions as codeSignals.ts (docs, env files, lockfiles, generated
// output), plus tests, whose model names are often fixtures rather than use.
const EXCLUDES = [
  ':!*.md', ':!*.txt', ':!*.example', ':!**/.env*', ':!*.lock', ':!*lock.json', ':!*.min.js', ':!*.map',
  ':!**/node_modules/**', ':!**/dist/**', ':!**/build/**', ':!**/fixtures/**',
  ':!**/test/**', ':!**/tests/**', ':!**/__tests__/**', ':!*.test.*', ':!*.spec.*', ':!*_test.*',
];
const MAX_MODELS = 25;

/** Distinct model IDs referenced in tracked source, lower-cased, sorted. Never throws. */
export function findModels(localPath: string, timeoutMs = 10_000): string[] {
  const pattern = Object.values(MODEL_PATTERNS).map(p => `(${p})`).join('|');
  let out = '';
  try {
    out = execFileSync('git', ['-C', localPath, 'grep', '-I', '-i', '-h', '-o', '-w', '-E', pattern, '--', ...EXCLUDES], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    // Exit 1 = no match. Otherwise keep whatever was printed before the error.
    out = (err as { stdout?: string }).stdout ?? '';
  }
  const models = new Set<string>();
  for (const raw of out.split('\n')) {
    const m = raw.trim().toLowerCase().replace(/[.:-]+$/, '');
    // Bare family words ("sonar", "o1") are too likely to be something else unless versioned.
    if (!m || m === 'sonar' || /^o[1-4]$/.test(m) || m.length < 4) continue;
    models.add(m);
  }
  return [...models].sort().slice(0, MAX_MODELS);
}

export interface CodeScan {
  services: string[];
  models: string[];
}

/**
 * Shallow-clones `owner/repo` at its default branch into a temp dir, runs both
 * detectors and removes the clone. Returns null if the clone fails or times
 * out (e.g. a very large repo).
 */
export async function scanRepoCode(owner: string, repo: string, token: string, timeoutMs = 180_000): Promise<CodeScan | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-scan-'));
  try {
    const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
    execFileSync('git', [
      '-c', `http.extraHeader=AUTHORIZATION: basic ${auth}`,
      'clone', '--quiet', '--depth', '1', '--single-branch', '--no-tags',
      `https://github.com/${owner}/${repo}.git`, path.join(dir, 'src'),
    ], { stdio: 'ignore', timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } });
    const src = path.join(dir, 'src');
    return { services: inferServicesFromCode(src), models: findModels(src) };
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
