/**
 * CI-side generator for per-app status pages: `wiki/status/<repo>.md`.
 *
 * Why this exists: the nightly index records which status files each repo
 * has (TODO.md, HANDOFF.md, ROADMAP.md, ...) but not what they say, so an
 * agent reading the private content repo can see that an app moved but not
 * what's next on it. This script copies the text of those files, plus the
 * most recent commit messages and the open issue count, into one page per
 * active repo, and writes an `overview.md` table across all of them.
 *
 * Input is the `index-full.json` that `build:index` writes earlier in the
 * same workflow, so the repo list, doc file paths and lifecycle stage come
 * from the index rather than a second tree walk.
 *
 * Every page is written with `visibility: "private"`, because private repos'
 * TODOs must never reach the public index.json. On the next night's run the
 * overlay copies these pages into `wiki/` before `build:index`, and the
 * builder keeps them out of the public index.
 *
 * Usage:
 *   npm run build:status-digest -- --out /tmp/private-content/wiki/status
 *   Optional: --index <path to index-full.json> (default public/data/index-full.json)
 *             --days <N>  only repos pushed in the last N days (default 120)
 *
 * Env vars required:
 *   GITHUB_TOKEN     A token that can read every repo (contents + metadata,
 *                    including private repos). The workflow already provides
 *                    REPO_ACCESS_TOKEN for this.
 *   GITHUB_USERNAME  The account that owns the repos.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import type { RepoInfo } from './types.js';

// Basenames that count as status notes. Matched case-insensitively against
// the file name only, e.g. TODO.md, TODO_alt.md, HANDOFF-rearchitecture.md,
// NEXT_STEPS.md, PIECE-UPDATE-STATUS.md, MUSIX_NEXT_BRIEFING.md.
const STATUS_FILE = /^(.*[-_])?(todo|handoff|next|next[-_]steps|roadmap|status|briefing)([-_].*)?\.(md|txt)$/i;

// When a repo has more matches than MAX_FILES_PER_REPO, keep the ones most
// likely to say what's next: TODO / NEXT / STATUS before ROADMAP, and
// HANDOFF / BRIEFING last, since those are often historical write-ups.
function statusRank(fileName: string): number {
  const n = fileName.toLowerCase();
  if (n.includes('todo')) return 0;
  if (n.includes('next')) return 1;
  if (n.includes('status')) return 2;
  if (n.includes('roadmap')) return 3;
  return 4;
}

// Generated or vendored trees that happen to contain matching names.
const SKIP_DIRS = /(^|\/)(node_modules|vendor|fastlane|dist|build|\.github)\//i;

// Stages from completionAssessment that aren't worth a status page.
const SKIP_STAGES = new Set(['abandoned', 'reference']);

const MAX_FILES_PER_REPO = 4;
const MAX_CHARS_PER_FILE = 3000;
const COMMITS_PER_REPO = 5;

// The content repo itself is docs only and would quote its own pages back.
const SKIP_REPOS = new Set(['code-wiki-content']);

interface StatusPage {
  repo: RepoInfo;
  stage: string;
  openIssues: number | null;
  commits: { date: string; message: string }[];
  files: { path: string; text: string; truncated: boolean }[];
}

function getArg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required argument: --${name}`);
  process.exit(1);
}

function pickStatusFiles(repo: RepoInfo): string[] {
  const candidates = (repo.markdownFiles ?? [])
    .map(f => f.relativePath)
    .filter(p => !SKIP_DIRS.test(p))
    // At most one directory deep, so a repo's own notes win over nested
    // project files (e.g. a manuscript chapter whose title has "next" in it).
    .filter(p => p.split('/').length <= 2)
    .filter(p => STATUS_FILE.test(path.basename(p)));
  candidates.sort((a, b) =>
    statusRank(path.basename(a)) - statusRank(path.basename(b)) ||
    a.split('/').length - b.split('/').length ||
    a.localeCompare(b));
  return candidates.slice(0, MAX_FILES_PER_REPO);
}

// First line only; full bodies belong in git, not the digest. For a GitHub
// merge commit the first line is just "Merge pull request #N from ...", so
// use the PR title GitHub puts in the body instead.
function commitSummary(message: string): string {
  const lines = message.split('\n').map(l => l.trim()).filter(Boolean);
  const first = lines[0] ?? '';
  const pr = first.match(/^Merge pull request (#\d+)/);
  if (pr && lines[1]) return `${lines[1]} (${pr[1]})`;
  return first;
}

async function fetchFileText(octokit: Octokit, owner: string, repo: string, filePath: string): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath });
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null;
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch (err) {
    console.warn(`  Could not read ${repo}/${filePath}: ${(err as Error).message}`);
    return null;
  }
}

async function buildPage(octokit: Octokit, owner: string, repo: RepoInfo): Promise<StatusPage> {
  const stage = repo.completion?.stage ?? 'unknown';

  let openIssues: number | null = null;
  try {
    const { data } = await octokit.repos.get({ owner, repo: repo.name });
    // GitHub counts open pull requests in this number too.
    openIssues = data.open_issues_count;
  } catch (err) {
    console.warn(`  Could not read metadata for ${repo.name}: ${(err as Error).message}`);
  }

  const commits: StatusPage['commits'] = [];
  try {
    const { data } = await octokit.repos.listCommits({ owner, repo: repo.name, per_page: COMMITS_PER_REPO });
    for (const c of data) {
      commits.push({
        date: (c.commit.author?.date ?? c.commit.committer?.date ?? '').split('T')[0],
        message: commitSummary(c.commit.message),
      });
    }
  } catch (err) {
    console.warn(`  Could not list commits for ${repo.name}: ${(err as Error).message}`);
  }

  const files: StatusPage['files'] = [];
  for (const filePath of pickStatusFiles(repo)) {
    const text = await fetchFileText(octokit, owner, repo.name, filePath);
    if (text === null) continue;
    const truncated = text.length > MAX_CHARS_PER_FILE;
    files.push({ path: filePath, text: truncated ? text.slice(0, MAX_CHARS_PER_FILE) : text, truncated });
  }

  return { repo, stage, openIssues, commits, files };
}

// Status files are markdown already; demote their headings two levels so
// they nest under this page's "## <file>" sections, and keep fenced code
// intact.
function nestMarkdown(text: string): string {
  let inFence = false;
  return text
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (!inFence && /^#{1,4}\s/.test(line)) return '##' + line;
      return line;
    })
    .join('\n')
    .trimEnd();
}

function renderPage(page: StatusPage, today: string): string {
  const { repo } = page;
  const lastPush = repo.lastCommitDate ? repo.lastCommitDate.split('T')[0] : '-';
  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: "Status: ${repo.name}"`);
  lines.push('tags: ["status", "auto-generated"]');
  lines.push(`description: "Nightly status digest for ${repo.name}: stage, recent commits, and its TODO / handoff notes."`);
  lines.push(`updated: "${today}"`);
  lines.push(`source_repo: "${repo.name}"`);
  lines.push('visibility: "private"');
  lines.push('---');
  lines.push('');
  lines.push(`# ${repo.name}`);
  lines.push('');
  lines.push('This page is **auto-generated** nightly from the repo. Edit the repo\'s own files, not this page.');
  lines.push('');
  if (repo.description) {
    lines.push(`> ${repo.description}`);
    lines.push('');
  }
  lines.push('| Stage | Last push | Open issues + PRs | Visibility |');
  lines.push('|-------|-----------|-------------------|------------|');
  lines.push(`| ${page.stage} | ${lastPush} | ${page.openIssues ?? '-'} | ${repo.visibility ?? 'public'} |`);
  lines.push('');
  lines.push('## Recent commits');
  lines.push('');
  if (page.commits.length === 0) {
    lines.push('_None found._');
  } else {
    for (const c of page.commits) lines.push(`- ${c.date}: ${c.message}`);
  }
  lines.push('');
  if (page.files.length === 0) {
    lines.push('## Status notes');
    lines.push('');
    lines.push('_This repo has no TODO, HANDOFF, NEXT, ROADMAP or STATUS file._');
    lines.push('');
  }
  for (const f of page.files) {
    lines.push(`## ${f.path}`);
    lines.push('');
    lines.push(nestMarkdown(f.text));
    if (f.truncated) {
      lines.push('');
      lines.push(`_Trimmed to the first ${MAX_CHARS_PER_FILE} characters. Full file: ${repo.githubUrl ?? repo.name}/blob/HEAD/${f.path}_`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderOverview(pages: StatusPage[], today: string, days: number): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('title: "App Status Overview"');
  lines.push('tags: ["status", "index", "auto-generated"]');
  lines.push(`description: "One row per active repo (pushed in the last ${days} days): stage, last push, open issues, and which status notes it has."`);
  lines.push(`updated: "${today}"`);
  lines.push('visibility: "private"');
  lines.push('---');
  lines.push('');
  lines.push('# App Status Overview');
  lines.push('');
  lines.push(`Auto-generated nightly. Covers repos pushed in the last ${days} days, excluding abandoned and reference repos. Each row links to that repo's status page.`);
  lines.push('');
  lines.push('| Repo | Stage | Last push | Open issues + PRs | Latest commit | Status notes |');
  lines.push('|------|-------|-----------|-------------------|---------------|--------------|');
  for (const p of pages) {
    const lastPush = p.repo.lastCommitDate ? p.repo.lastCommitDate.split('T')[0] : '-';
    const latest = p.commits[0]?.message.replace(/\|/g, '\\|') ?? '-';
    const notes = p.files.length ? p.files.map(f => path.basename(f.path)).join(', ') : 'none';
    lines.push(`| [${p.repo.name}](${p.repo.name}.md) | ${p.stage} | ${lastPush} | ${p.openIssues ?? '-'} | ${latest} | ${notes} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME;
  const outDir = getArg('out');
  const indexPath = getArg('index', path.join('public', 'data', 'index-full.json'));
  const days = parseInt(getArg('days', '120'), 10);

  if (!token) {
    console.error('GITHUB_TOKEN env var is required');
    process.exit(1);
  }
  if (!username) {
    console.error('GITHUB_USERNAME env var is required');
    process.exit(1);
  }

  const index = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as { repos: RepoInfo[] };
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const active = index.repos
    .filter(r => !SKIP_REPOS.has(r.name))
    .filter(r => !SKIP_STAGES.has(r.completion?.stage ?? ''))
    .filter(r => r.lastCommitDate && Date.parse(r.lastCommitDate) >= cutoff)
    .sort((a, b) => (b.lastCommitDate ?? '').localeCompare(a.lastCommitDate ?? ''));
  console.log(`Building status pages for ${active.length} of ${index.repos.length} repos (pushed in the last ${days} days)...`);

  const octokit = new Octokit({ auth: token });
  const pages: StatusPage[] = [];
  for (const repo of active) {
    const page = await buildPage(octokit, username, repo);
    console.log(`  ${repo.name}: ${page.commits.length} commits, ${page.files.length} status files`);
    pages.push(page);
  }

  // Start clean so repos that went quiet or were renamed don't leave stale
  // pages behind.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const today = new Date().toISOString().split('T')[0];
  for (const page of pages) {
    await fs.writeFile(path.join(outDir, `${page.repo.name}.md`), renderPage(page, today), 'utf-8');
  }
  await fs.writeFile(path.join(outDir, 'overview.md'), renderOverview(pages, today, days), 'utf-8');
  console.log(`Wrote ${pages.length + 1} files to ${outDir}`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
