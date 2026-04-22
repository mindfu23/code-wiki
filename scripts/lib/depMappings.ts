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
 * Exact-match mappings: `package.json` dependency name → inference.
 * Only include terms that exist in wiki/_taxonomy/terms/.
 */
export const EXACT_DEPS: Record<string, DepMapping> = {
  // --- JS/TS stack ---
  'react':            { stack: ['react'], platform: ['web'] },
  'react-dom':        { stack: ['react'], platform: ['web'] },
  'react-native':     { stack: ['react-native'], platform: ['ios', 'android'] },
  'vite':             { stack: ['vite'], platform: ['web'] },
  'typescript':       { stack: ['typescript'] },
  'expo':             { stack: ['expo'], platform: ['ios', 'android'] },
  'express':          { stack: ['node-express'] },
  '@netlify/functions': { stack: ['netlify-functions'] },

  // --- Service SDKs ---
  '@anthropic-ai/sdk':       { service: ['anthropic-api'] },
  'openai':                   { service: ['openai-api'] },
  '@google/generative-ai':    { service: ['google-gemini-api'] },
  '@octokit/rest':            { service: ['github-api'] },
  'googleapis':               { service: ['google-sheets-api'] },
  '@huggingface/inference':   { service: ['huggingface-api'] },

  // --- Python SDKs (seen in requirements.txt) ---
  'anthropic':  { service: ['anthropic-api'] },
};

/**
 * Prefix-match mappings: matches any dep whose name starts with the prefix.
 * Key is the prefix (no trailing `*`).
 */
export const PREFIX_DEPS: Record<string, DepMapping> = {
  '@capacitor/': { platform: ['ios', 'android'] },
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
  'netlify.toml':   { deployTarget: ['netlify'] },
  'wrangler.toml':  { deployTarget: ['cloudflare-workers'], stack: ['cloudflare-workers'] },
  'app.json':       { stack: ['expo'], platform: ['ios', 'android'] },
  'app.config.js':  { stack: ['expo'], platform: ['ios', 'android'] },
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
