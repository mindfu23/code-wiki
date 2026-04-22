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
 * file, preserving everything else. Returns the new file content as a
 * string. Does not write to disk — caller decides.
 */
export function applyTaxonomyToContent(
  rawContent: string,
  mergedTaxonomy: InferredTaxonomy,
  updateDate: boolean,
): string {
  const parsed = matter(rawContent);
  const data = { ...parsed.data };

  data.taxonomy = mergedTaxonomy;
  if (updateDate) {
    data.updated = new Date().toISOString().split('T')[0];
  }

  return matter.stringify(parsed.content, data);
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
