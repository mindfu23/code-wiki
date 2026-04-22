/**
 * Merge-preserving frontmatter updater.
 *
 * Rule: never remove a term a human added. When the inference proposes
 * additions, merge them in; when the inference would have proposed
 * different terms (removing existing ones), log a drift notice but leave
 * existing terms intact.
 *
 * Only mutates the `taxonomy:` block + `updated:` date. Leaves everything
 * else (title, description, tags, body, etc.) exactly as-is.
 */

import matter from 'gray-matter';
import yaml from 'js-yaml';

export interface InferredTaxonomy {
  type?: string;
  stack?: string[];
  platform?: string[];
  deployTarget?: string[];
  domain?: string[];
  visibility?: string;
  lifecycle?: string;
  completionState?: string;
  dependsOn?: string[];
}

export interface MergeDiff {
  /** Field → terms newly added by inference that weren't present before */
  added: Record<string, string[]>;
  /** Field → terms already present that inference didn't re-propose (left intact) */
  kept: Record<string, string[]>;
  /** Whether anything actually changed in the output frontmatter */
  changed: boolean;
}

const ARRAY_FIELDS: (keyof InferredTaxonomy)[] = [
  'stack', 'platform', 'deployTarget', 'domain', 'dependsOn',
];
const SCALAR_FIELDS: (keyof InferredTaxonomy)[] = [
  'type', 'visibility', 'lifecycle', 'completionState',
];

function unionArrays(existing: string[] | undefined, proposed: string[] | undefined): {
  merged: string[] | undefined;
  added: string[];
  kept: string[];
} {
  const e = new Set(existing ?? []);
  const p = new Set(proposed ?? []);
  const added = [...p].filter((x) => !e.has(x));
  const kept = [...e].filter((x) => !p.has(x));
  const merged = [...new Set([...e, ...p])].sort();
  return {
    merged: merged.length > 0 ? merged : undefined,
    added,
    kept,
  };
}

/**
 * Produce a merged taxonomy block. Existing human-added terms are always
 * preserved; inference only adds. Scalar fields (type, visibility) are
 * preserved if already set, otherwise inferred value wins.
 */
export function mergeTaxonomy(
  existing: InferredTaxonomy | undefined,
  proposed: InferredTaxonomy,
): { merged: InferredTaxonomy; diff: MergeDiff } {
  const e = existing ?? {};
  const merged: InferredTaxonomy = {};
  const diff: MergeDiff = { added: {}, kept: {}, changed: false };

  for (const field of ARRAY_FIELDS) {
    const { merged: combined, added, kept } = unionArrays(
      e[field] as string[] | undefined,
      proposed[field] as string[] | undefined,
    );
    if (combined) (merged[field] as string[]) = combined;
    if (added.length > 0) {
      diff.added[field] = added;
      diff.changed = true;
    }
    if (kept.length > 0) diff.kept[field] = kept;
  }

  for (const field of SCALAR_FIELDS) {
    const existingVal = e[field];
    const proposedVal = proposed[field];
    // Preserve existing human value; otherwise take inferred.
    if (existingVal !== undefined && existingVal !== null && existingVal !== '') {
      (merged[field] as string) = existingVal as string;
    } else if (proposedVal !== undefined && proposedVal !== null && proposedVal !== '') {
      (merged[field] as string) = proposedVal as string;
      diff.added[field] = [proposedVal as string];
      diff.changed = true;
    }
  }

  return { merged, diff };
}

/**
 * Apply a merged taxonomy + today's date to the frontmatter of a markdown
 * file, preserving every OTHER line exactly as-is. Does a surgical
 * string replacement on just the `taxonomy:` block and `updated:` line,
 * leaving title/description/tags/whatever untouched.
 *
 * This avoids gray-matter's default YAML stringify reformatting the
 * whole frontmatter (which produces noisy diffs for irrelevant fields).
 */
export function applyTaxonomyToContent(
  rawContent: string,
  mergedTaxonomy: InferredTaxonomy,
  updateDate: boolean,
): string {
  const { fmLines, body, fmOpen, fmClose } = splitFrontmatter(rawContent);
  if (fmLines === null) {
    // No frontmatter — synthesize one from scratch (stub creation path)
    return synthesizeNew(mergedTaxonomy, body);
  }

  const newTaxonomyLines = renderTaxonomyBlock(mergedTaxonomy);
  const today = new Date().toISOString().split('T')[0];

  const out: string[] = [];
  let i = 0;
  let taxonomyReplaced = false;
  let updatedReplaced = false;

  while (i < fmLines.length) {
    const line = fmLines[i];

    // Replace the updated: line if we're asked to bump the date
    if (updateDate && /^updated\s*:/.test(line)) {
      // Detect quote style of the existing value (if any) so we preserve it
      const quote = /:\s*"/.test(line) ? '"' : /:\s*'/.test(line) ? "'" : '';
      out.push(`updated: ${quote}${today}${quote}`);
      updatedReplaced = true;
      i++;
      continue;
    }

    // Replace the taxonomy: block (taxonomy: key + all indented lines below it)
    if (/^taxonomy\s*:/.test(line)) {
      out.push(...newTaxonomyLines);
      taxonomyReplaced = true;
      i++;
      // Skip continuation lines of the old taxonomy block (indented)
      while (i < fmLines.length && /^(\s{2,}|\s*-)/.test(fmLines[i])) {
        i++;
      }
      continue;
    }

    out.push(line);
    i++;
  }

  // Append any missing fields that weren't present in the original frontmatter
  if (!taxonomyReplaced) out.push(...newTaxonomyLines);
  if (updateDate && !updatedReplaced) out.push(`updated: '${today}'`);

  return `${fmOpen}\n${out.join('\n')}\n${fmClose}\n${body}`;
}

interface FrontmatterSplit {
  fmLines: string[] | null;
  body: string;
  fmOpen: string;
  fmClose: string;
}

function splitFrontmatter(content: string): FrontmatterSplit {
  // Accept both --- (YAML) frontmatter styles. Minimal parser.
  const match = /^(---\r?\n)([\s\S]*?)\r?\n(---\r?\n?)([\s\S]*)$/.exec(content);
  if (!match) {
    return { fmLines: null, body: content, fmOpen: '---', fmClose: '---' };
  }
  const [, open, inner, close, body] = match;
  return {
    fmLines: inner.split(/\r?\n/),
    body,
    fmOpen: open.trimEnd(),
    fmClose: close.trimEnd(),
  };
}

/**
 * Render a taxonomy object as YAML lines with inline arrays for leaves.
 * Excludes undefined fields; drops empty arrays.
 */
function renderTaxonomyBlock(taxonomy: InferredTaxonomy): string[] {
  // flowLevel=2 keeps leaf arrays inline ([a, b, c]) while the outer
  // object is block style (key: \n  subkey: ...).
  const cleaned = Object.fromEntries(
    Object.entries(taxonomy).filter(([, v]) =>
      v !== undefined && v !== null &&
      !(Array.isArray(v) && v.length === 0),
    ),
  );
  const dumped = yaml.dump({ taxonomy: cleaned }, {
    flowLevel: 2,
    lineWidth: 10000,
    noRefs: true,
    quotingType: '"',
  }).trimEnd();
  return dumped.split('\n');
}

/**
 * Synthesize a new markdown file with a freshly-written frontmatter.
 * Used only when the input had no frontmatter block to begin with
 * (usually the stub-creation path is preferred instead).
 */
function synthesizeNew(taxonomy: InferredTaxonomy, body: string): string {
  const fm = matter.stringify(body, {
    updated: new Date().toISOString().split('T')[0],
    taxonomy,
  });
  return fm;
}

/**
 * Human-readable diff summary for stdout. Produces something like:
 *     + stack: [expo, react-native]
 *     + platform: [ios, android]
 *       kept (not proposed by inference, preserved): domain [games, ai-tooling]
 */
export function formatDiff(diff: MergeDiff): string {
  const lines: string[] = [];
  for (const [field, terms] of Object.entries(diff.added)) {
    lines.push(`    + ${field}: [${terms.join(', ')}]`);
  }
  for (const [field, terms] of Object.entries(diff.kept)) {
    lines.push(`      kept: ${field} [${terms.join(', ')}] (human-added, preserved)`);
  }
  if (lines.length === 0) return '    (no changes — fully inferred state already matches)';
  return lines.join('\n');
}
