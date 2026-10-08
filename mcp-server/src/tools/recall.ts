/**
 * recall tool: one ranked search across local knowledge notes, the wiki and taxonomy terms.
 *
 * Returns pointers (path + one-line description + source + age), not document bodies, so a
 * call stays cheap; the caller reads whichever pointer applies.
 *
 * Knowledge notes come from CODE_WIKI_KNOWLEDGE_DIRS (local only; never read by the web build).
 * Scoring mirrors integrations/claude-code/hooks/recall_hint.py — keep the two in sync.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Config } from '../types/index.js';

export const recallTool = {
  name: 'recall',
  description:
    'Search the local knowledge store (agent notes, gotchas, decisions), the wiki and taxonomy terms in one call. ' +
    'Use before debugging an error, touching an unfamiliar project, or repeating a task that may have been solved before. ' +
    'Paste error text verbatim: notes record exact symptoms. Returns ranked pointers (path, description, source, age); read the ones that apply.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Error text, symptom, project name or question.' },
      sources: {
        type: 'array',
        items: { type: 'string', enum: ['knowledge', 'wiki', 'taxonomy'] },
        description: 'Limit to these sources (default: all).',
      },
      limit: { type: 'number', description: 'Maximum results (default 5, max 15).' },
    },
    required: ['query'],
  },
};

type Source = 'knowledge' | 'wiki' | 'taxonomy';

interface Note {
  source: Source;
  path: string;
  file: string;
  title: string;
  desc: string;
  symptoms: string[];
  tokens: Set<string>;
  nameTokens: Set<string>;
  verified?: string;
  mtime: number;
}

const STOPWORDS = new Set(`
about above after again against all also always among another any anything are around because been
before being below between both but can cannot could did does doing done down during each either
else even every few find first from further get gets getting give going good had has have having
here how however into its itself just keep know last later least less like look looks made make
many may maybe might more most much must need needs never new next not now off once one only other
our out over own please quite rather really right same see seem seems should show since some
something still such sure take than that the their them then there these they thing things this
those though through thus too try trying under until upon use used uses using very want wants was
way well were what when where whether which while who whom why will with within without would yes
yet you your able added adding also across already another back based best better both came come
does done else ever fine found gave given goes gone great half help here high hold idea into just
keep kind left line long lots main mean meant mind mine move name near note okay open part past
plan point read real said says seen self sent sets side sort start stay step stop sure tell tells
test than them time told took turn type uses view want week went whole wide work works year
file files code app apps project projects issue issues problem problems error errors work working
update updates updated change changes changed version versions local standard keys current status level
place green form account missing needed source general reference category tools patterns learned
stopped testing additions unique option options feature features summary information details
`.split(/\s+/).filter(Boolean));

const TOKEN_RE = /[a-z0-9][a-z0-9._+-]*[a-z0-9]|[a-z0-9]/g;

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(TOKEN_RE) || []) {
    for (const t of new Set([raw, ...raw.split(/[._+-]/)])) {
      if (!t || STOPWORDS.has(t)) continue;
      const hasDigit = /\d/.test(t);
      if (/^\d+$/.test(t) && t.length < 3) continue;
      if (t.length >= 4 || (hasDigit && t.length >= 3)) out.add(t);
    }
  }
  return out;
}

function parseFrontmatter(text: string): Record<string, string | string[]> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const meta: Record<string, string | string[]> = {};
  let key: string | null = null;
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) {
      key = m[1];
      const val = m[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        meta[key] = val.slice(1, -1).split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      } else {
        meta[key] = val.replace(/^['"]|['"]$/g, '');
      }
    } else if (key && /^\s+-\s+/.test(line)) {
      const item = line.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, '');
      const cur = meta[key];
      meta[key] = Array.isArray(cur) ? [...cur, item] : [item];
    }
  }
  return meta;
}

export function knowledgeDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || '';
  return (env.CODE_WIKI_KNOWLEDGE_DIRS || '')
    .split(/[:,]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => (p.startsWith('~') ? path.join(home, p.slice(1)) : p));
}

async function listMarkdown(dir: string, recursive: boolean): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && recursive) out.push(...(await listMarkdown(full, true)));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

async function loadNote(file: string, source: Source): Promise<Note | null> {
  const stem = path.basename(file, '.md');
  if (stem.toUpperCase() === stem) return null; // INDEX.md, MEMORY.md, README.md, ...
  let head: string;
  let mtime = 0;
  try {
    const fh = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(4000);
      const { bytesRead } = await fh.read(buf, 0, 4000, 0);
      head = buf.subarray(0, bytesRead).toString('utf-8');
      mtime = (await fh.stat()).mtimeMs;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
  const meta = parseFrontmatter(head);
  const title = String(meta.title || meta.name || stem);
  let desc = String(meta.description || '');
  if (!desc || desc.startsWith('(TODO')) {
    const body = head.startsWith('---') ? head.split('\n---').slice(1).join('\n---').replace(/^[-\s]*/, '') : head;
    desc = body.replace(/^#+\s*/gm, '').split(/\s+/).join(' ').slice(0, 200);
  }
  const symptoms = ([] as string[]).concat(meta.symptoms || []).filter(Boolean);
  const stemWords = stem.replace(/[_-]/g, ' ');
  return {
    source,
    path: file,
    file: path.basename(file),
    title,
    desc,
    symptoms,
    tokens: tokens(`${stemWords} ${stemWords} ${title} ${desc} ${symptoms.join(' ')}`),
    nameTokens: tokens(`${stemWords} ${title}`),
    verified: typeof meta.verified === 'string' ? meta.verified : undefined,
    mtime,
  };
}

let cache: { key: string; at: number; notes: Note[] } | null = null;

async function loadAll(config: Config): Promise<Note[]> {
  const sets: Array<[string, Source, boolean]> = [];
  for (const d of knowledgeDirs()) sets.push([d, 'knowledge', false]);
  for (const d of [config.wikiDirectory, config.privateWikiDirectory].filter(Boolean)) {
    sets.push([d, 'wiki', true]);
  }
  const key = JSON.stringify(sets);
  if (cache && cache.key === key && Date.now() - cache.at < 30_000) return cache.notes;
  const notes: Note[] = [];
  for (const [dir, source, recursive] of sets) {
    for (const f of await listMarkdown(dir, recursive)) {
      const isTerm = f.includes(`${path.sep}_taxonomy${path.sep}terms${path.sep}`);
      if (source === 'wiki' && f.includes(`${path.sep}_taxonomy${path.sep}`) && !isTerm) continue;
      const n = await loadNote(f, isTerm ? 'taxonomy' : source);
      if (n) notes.push(n);
    }
  }
  cache = { key, at: Date.now(), notes };
  return notes;
}

export function scoreNotes(query: string, notes: Note[]): Array<{ score: number; note: Note; matched: string[] }> {
  const q = tokens(query);
  if (!q.size || !notes.length) return [];
  const n = notes.length;
  const df = new Map<string, number>();
  for (const note of notes) for (const t of note.tokens) df.set(t, (df.get(t) || 0) + 1);
  const qLower = query.toLowerCase();
  const out: Array<{ score: number; note: Note; matched: string[] }> = [];
  for (const note of notes) {
    const matched = [...q].filter(t => note.tokens.has(t)).sort();
    let s = 0;
    for (const t of matched) {
      const idf = Math.log((n + 1) / ((df.get(t) || 0) + 0.5));
      s += idf * (note.nameTokens.has(t) ? 1.5 : 1);
    }
    const sym = note.symptoms.filter(x => x.length >= 4 && qLower.includes(x.toLowerCase()));
    s += 12 * sym.length;
    if (matched.length >= 2 || sym.length) out.push({ score: Math.round(s * 100) / 100, note, matched: [...matched, ...sym.map(x => `"${x}"`)] });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function ageDays(note: Note): number | null {
  const t = note.verified ? Date.parse(note.verified) : note.mtime;
  return Number.isFinite(t) && t > 0 ? Math.floor((Date.now() - t) / 86_400_000) : null;
}

export async function handleRecall(
  args: { query: string; sources?: Source[]; limit?: number },
  config: Config
): Promise<string> {
  if (!args?.query?.trim()) return JSON.stringify({ error: 'query is required' });
  const limit = Math.min(Math.max(args.limit || 5, 1), 15);
  let notes = await loadAll(config);
  if (args.sources?.length) notes = notes.filter(n => args.sources!.includes(n.source));
  const hits = scoreNotes(args.query, notes).slice(0, limit);
  return JSON.stringify({
    query: args.query,
    searched: notes.length,
    knowledgeConfigured: knowledgeDirs().length > 0,
    results: hits.map(h => ({
      source: h.note.source,
      path: h.note.path,
      title: h.note.title,
      description: h.note.desc.length > 200 ? h.note.desc.slice(0, 199) + '…' : h.note.desc,
      score: h.score,
      matched: h.matched,
      ageDays: ageDays(h.note),
      ...(h.note.verified ? { verified: h.note.verified } : {}),
    })),
    ...(hits.length ? {} : { hint: 'No match. Try the literal error text, a project name, or fewer words.' }),
  }, null, 2);
}
