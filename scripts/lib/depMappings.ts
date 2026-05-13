/**
 * Dependency → taxonomy term mappings for auto-inference.
 *
 * Only maps to terms that actually exist in `wiki/_taxonomy/terms/`. If a
 * dependency doesn't appear here, it's logged as unmapped; the user can
 * extend this file (and add the corresponding term definition) as the
 * vocabulary grows.
 *
 * Conventions:
 *   - Exact-match keys: full dependency name (npm name, Python package, etc.)
 *   - Prefix-match keys: end with '*' to match any dep starting with that prefix
 *     (e.g. '@capacitor/*' matches @capacitor/core, @capacitor/ios, etc.)
 *   - Values are term IDs (kebab-case, matching files in terms/)
 */

export interface DepMapping {
  /** Stack/language/framework terms inferred from this dep */
  stack?: string[];
  /** Service terms for dependsOn edges */
  service?: string[];
  /** Platform terms (web, ios, android, etc.) */
  platform?: string[];
  /** deployTarget terms implied by this dep's presence */
  deployTarget?: string[];
}

/**
 * Exact-match mappings: dependency name → inference. Used for both
 * package.json deps (npm) and requirements.txt deps (Python).
 *
 * Only include terms that exist in wiki/_taxonomy/terms/. Stack terms must
 * also be listed under `facets.stack.values` in wiki/_taxonomy/schema.yml,
 * or the validator will reject them. The `service` facet is open-ended in
 * the schema, so new service terms only require their own term file.
 */
export const EXACT_DEPS: Record<string, DepMapping> = {
  // --- JS/TS stack (must match values in schema.yml: facets.stack.values) ---
  'react':                  { stack: ['react'], platform: ['web'] },
  'react-dom':              { stack: ['react'], platform: ['web'] },
  'react-native':           { stack: ['react-native'], platform: ['ios', 'android'] },
  'vite':                   { stack: ['vite'], platform: ['web'] },
  'typescript':             { stack: ['typescript'] },
  'expo':                   { stack: ['expo'], platform: ['ios', 'android'] },
  'express':                { stack: ['node-express'] },
  '@netlify/functions':     { stack: ['netlify-functions'] },

  // --- npm service SDKs ---
  '@anthropic-ai/sdk':      { service: ['anthropic-api'] },
  'openai':                 { service: ['openai-api'] },
  '@google/generative-ai':  { service: ['google-gemini-api'] },
  '@octokit/rest':          { service: ['github-api'] },
  '@octokit/core':          { service: ['github-api'] },
  'octokit':                { service: ['github-api'] },
  'googleapis':             { service: ['google-sheets-api'] },
  '@huggingface/inference': { service: ['huggingface-api'] },
  '@supabase/supabase-js':  { service: ['supabase-api'] },
  'firebase':               { service: ['firebase-api'] },
  'firebase-admin':         { service: ['firebase-api'] },
  'firebase-functions':     { service: ['firebase-api'] },
  'stripe':                 { service: ['stripe-api'] },

  // --- Python service SDKs (seen in requirements.txt / pyproject.toml) ---
  'anthropic':              { service: ['anthropic-api'] },
  'google-generativeai':    { service: ['google-gemini-api'] },
  'huggingface_hub':        { service: ['huggingface-api'] },
  'transformers':           { service: ['huggingface-api'] },
  'langchain-anthropic':    { service: ['anthropic-api', 'langchain-api'] },
  'langchain-google-genai': { service: ['google-gemini-api', 'langchain-api'] },
  'langchain-community':    { service: ['langchain-api'] },
  'langchain-core':         { service: ['langchain-api'] },
  'langchain':              { service: ['langchain-api'] },

  // --- Python stack hints (use existing 'python' term; framework granularity
  //     would require schema expansion, deferred) ---
  'fastapi':                { stack: ['python'] },
  'flask':                  { stack: ['python'] },
  'django':                 { stack: ['python'] },
  'streamlit':              { stack: ['python'] },
};

/**
 * Prefix-match mappings: matches any dep whose name starts with the prefix.
 * Key is the prefix (no trailing `*`).
 */
export const PREFIX_DEPS: Record<string, DepMapping> = {
  '@capacitor/':   { platform: ['ios', 'android'] },
  '@expo/':        { stack: ['expo'], platform: ['ios', 'android'] },
  'firebase/':     { service: ['firebase-api'] },     // for sub-packages if ever in deps
  'firebase-':     { service: ['firebase-api'] },     // firebase-functions-test, etc.
  'langchain-':    { service: ['langchain-api'] },    // catches future langchain-* variants
};

/**
 * File-presence signals: if a manifest file of this type exists, infer these.
 * Used for manifest kinds where the mere presence is meaningful (e.g. a
 * netlify.toml means this project deploys to Netlify).
 *
 * Key: manifest kind (matches ManifestHit['kind']).
 */
export const MANIFEST_SIGNALS: Record<string, DepMapping> = {
  'pubspec.yaml': {
    stack: ['dart-flutter'],
    // Flutter is inherently multi-platform; actual platform subset is
    // narrowed by looking at which platform dirs exist in the project.
  },
  'requirements.txt': { stack: ['python'] },
  'pyproject.toml':   { stack: ['python'] },
  'netlify.toml':     { deployTarget: ['netlify'] },
  'wrangler.toml':    { deployTarget: ['cloudflare-workers'], service: ['cloudflare-api'] },
  'app.json':         { stack: ['expo'], platform: ['ios', 'android'] },
  'app.config.js':    { stack: ['expo'], platform: ['ios', 'android'] },
  // Dockerfile is too generic to infer a deploy target safely (could be
  // Cloud Run, Fly, Railway, local docker-compose, etc). Left unmapped on
  // purpose. Tag manually per project if Cloud Run is the actual target.
};

/**
 * Lookup helper. Applies exact-match first, then prefix-match.
 * Returns null when the dep is unrecognized so callers can log it.
 */
export function lookupDep(depName: string): DepMapping | null {
  if (EXACT_DEPS[depName]) return EXACT_DEPS[depName];

  for (const [prefix, mapping] of Object.entries(PREFIX_DEPS)) {
    if (depName.startsWith(prefix)) return mapping;
  }

  return null;
}

/**
 * Merge two DepMappings by union-ing their term arrays. Used to accumulate
 * findings across many dependencies / manifests on a single project.
 */
export function mergeMappings(a: DepMapping, b: DepMapping): DepMapping {
  const union = (xs?: string[], ys?: string[]) => {
    const s = new Set<string>();
    xs?.forEach((x) => s.add(x));
    ys?.forEach((y) => s.add(y));
    return s.size > 0 ? [...s].sort() : undefined;
  };

  return {
    stack: union(a.stack, b.stack),
    service: union(a.service, b.service),
    platform: union(a.platform, b.platform),
    deployTarget: union(a.deployTarget, b.deployTarget),
  };
}
