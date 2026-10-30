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
 * Failure behaviour: if more than MAX_FAILURE_RATE of repos can't be read
 * (usually a token that can't see private repos) or no repo is active, the
 * script exits non-zero without touching the output directory, so a bad run
 * never commits gutted pages over good ones.
 *
 * Logs name no repos in CI (see ciLog.ts): this repo's Actions logs are public.
 *
 * Usage:
 *   npm run build:status-digest -- --out /tmp/private-content/wiki/status
 *   Optional: --index <path to index-full.json> (default public/data/index-full.json)
 *             --days <N>  only repos pushed in the last N days (default 120)
 *             --deps <path to the JSON from build:deps>  adds a Dependencies
 *               section to each page and a dependencies.md roll-up; skipped
 *               quietly if the file is missing (that step failed or didn't run)
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
import { nm, errMsg } from './ciLog.js';
import type { DependencyReport, RepoDependencies } from './buildDependencyReport.js';

// Basenames that count as status notes. Matched case-insensitively against
// the file name only, e.g. TODO.md, TODO_alt.md, HANDOFF-rearchitecture.md,
// NEXT_STEPS.md, PIECE-UPDATE-STATUS.md, MUSIX_NEXT_BRIEFING.md.
const STATUS_FILE = /^(.*[-_])?(todo|handoff|next|next[-_]steps|roadmap|status|briefing)([-_].*)?\.(md|txt)$/i;

// When a repo has more matches than MAX_FILES_PER_REPO, keep the ones most
// likely to say what's next: TODO / NEXT / STATUS before ROADMAP, and
// HANDOFF / BRIEFING last, since those are often historical write-ups.
// Within each kind the plain name (HANDOFF.md) beats prefixed or suffixed
// variants (HANDOFF-rearchitecture.md), which tend to be older one-offs.
const EXACT_STATUS_FILE = /^(todo|handoff|next|next[-_]steps|roadmap|status|briefing)\.(md|txt)$/i;

function statusRank(fileName: string): number {
  const n = fileName.toLowerCase();
  const kind = n.includes('todo') ? 0 : n.includes('next') ? 1 : n.includes('status') ? 2 : n.includes('roadmap') ? 3 : 4;
  return kind * 2 + (EXACT_STATUS_FILE.test(fileName) ? 0 : 1);
}

// Generated or vendored trees that happen to contain matching names.
const SKIP_DIRS = /(^|\/)(node_modules|vendor|fastlane|dist|build|\.github)\//i;

// Stages from completionAssessment that aren't worth a status page.
const SKIP_STAGES = new Set(['abandoned', 'reference']);

const MAX_FILES_PER_REPO = 4;
const MAX_CHARS_PER_FILE = 3000;
const COMMITS_PER_REPO = 5;
// Above this share of repos with a failed GitHub call, the run aborts.
const MAX_FAILURE_RATE = 0.2;

// The content repo itself is docs only and would quote its own pages back.
const SKIP_REPOS = new Set(['code-wiki-content']);

interface StatusPage {
  repo: RepoInfo;
  stage: string;
  openIssues: number | null;
  commits: { date: string; message: string }[];
  files: { path: string; text: string; truncated: boolean }[];
  /** True if any GitHub call for this repo failed (the page would be incomplete). */
  failed: boolean;
}

/**
 * The repos that get a status page: pushed in the last `days` days and not
 * abandoned, reference-only or the content repo itself. Newest push first.
 * buildDependencyReport.ts uses the same list so both cover the same apps.
 */
export function selectActiveRepos(repos: RepoInfo[], days: number, now = Date.now()): RepoInfo[] {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return repos
    .filter(r => !SKIP_REPOS.has(r.name))
    .filter(r => !SKIP_STAGES.has(r.completion?.stage ?? ''))
    .filter(r => r.lastCommitDate && Date.parse(r.lastCommitDate) >= cutoff)
    .sort((a, b) => (b.lastCommitDate ?? '').localeCompare(a.lastCommitDate ?? ''));
}

function getArg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required argument: --${name}`);
  process.exit(1);
}

export function pickStatusFiles(repo: RepoInfo): string[] {
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
    console.warn(`  Could not read ${nm(`${repo}/${filePath}`)}: ${errMsg(err)}`);
    return null;
  }
}

async function buildPage(octokit: Octokit, owner: string, repo: RepoInfo): Promise<StatusPage> {
  const stage = repo.completion?.stage ?? 'unknown';

  let failed = false;
  let openIssues: number | null = null;
  try {
    const { data } = await octokit.repos.get({ owner, repo: repo.name });
    // GitHub counts open pull requests in this number too.
    openIssues = data.open_issues_count;
  } catch (err) {
    console.warn(`  Could not read metadata for ${nm(repo.name)}: ${errMsg(err)}`);
    failed = true;
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
    console.warn(`  Could not list commits for ${nm(repo.name)}: ${errMsg(err)}`);
    failed = true;
  }

  const files: StatusPage['files'] = [];
  for (const filePath of pickStatusFiles(repo)) {
    const text = await fetchFileText(octokit, owner, repo.name, filePath);
    if (text === null) {
      failed = true;
      continue;
    }
    const truncated = text.length > MAX_CHARS_PER_FILE;
    files.push({ path: filePath, text: truncated ? text.slice(0, MAX_CHARS_PER_FILE) : text, truncated });
  }

  return { repo, stage, openIssues, commits, files, failed };
}

// Status files are markdown already; demote their headings two levels so
// they nest under this page's "## <file>" sections (capped at h6), and keep
// fenced code intact. Truncation can cut a file inside a code fence; close it
// so the rest of the page doesn't render as code.
export function nestMarkdown(text: string): string {
  let fence: string | null = null;
  const out = text.split('\n').map(line => {
    const marker = line.match(/^\s*(```|~~~)/)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      return line;
    }
    if (fence === null) {
      const h = line.match(/^(\s{0,3})(#{1,6})(\s.*)?$/);
      if (h) return h[1] + '#'.repeat(Math.min(6, h[2].length + 2)) + (h[3] ?? '');
    }
    return line;
  });
  if (fence !== null) out.push(fence);
  return out.join('\n').trimEnd();
}

// YAML double-quoted scalar. JSON string escaping is valid YAML.
const yamlStr = (v: string): string => JSON.stringify(v);

// Date part of an ISO timestamp, or '-'.
const day = (iso?: string): string => (iso ? iso.split('T')[0] : '-');

// Per-repo so a recall query matches the repo it's about, not every status page.
function pageDescription(page: StatusPage): string {
  const about = page.repo.description ? ` ${page.repo.description.slice(0, 160)}` : '';
  return `${page.repo.name} (${page.stage}):${about}`.trim();
}

// `updated` is the repo's last push rather than today's date, so a page only
// changes (and the content repo only gets a commit) when the repo does.
function renderPage(page: StatusPage, deps?: RepoDependencies, scannedAt?: string | null): string {
  const { repo } = page;
  const lastPush = day(repo.lastCommitDate);
  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: ${yamlStr(`Status: ${repo.name}`)}`);
  lines.push('tags: ["status", "auto-generated"]');
  lines.push(`description: ${yamlStr(pageDescription(page))}`);
  lines.push(`updated: ${yamlStr(lastPush)}`);
  lines.push(`source_repo: ${yamlStr(repo.name)}`);
  lines.push('visibility: "private"');
  lines.push('---');
  lines.push('');
  lines.push(`# ${repo.name}`);
  lines.push('');
  lines.push('This page is **auto-generated** nightly from the repo. Edit the repo\'s own files, not this page. ' +
    'The web index picks it up on the following night\'s run; the MCP server reads it as soon as the local content clone is pulled.');
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
  if (deps) lines.push(...renderDependencies(deps, scannedAt ?? null, repo.githubUrl));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Dependencies (from build:deps)
// ---------------------------------------------------------------------------

const MAX_VULN_ROWS = 15;
const STATUS_LABEL: Record<string, string> = {
  major: '**major behind**', minor: 'minor behind', patch: 'patch behind', current: 'current', unknown: '-',
};
const cell = (v: string | null | undefined): string => (v ? v.replace(/\|/g, '\\|') : '-');
const isSerious = (sev: string) => sev === 'CRITICAL' || sev === 'HIGH';

export interface DepSummary {
  direct: number;
  majorsBehind: number;
  vulns: number;
  serious: number;
  directVulns: number;
}

export function summarizeDeps(d: RepoDependencies): DepSummary {
  const all = d.manifests.flatMap(m => m.deps);
  return {
    direct: all.length,
    majorsBehind: all.filter(x => x.status === 'major').length,
    vulns: d.vulns.length,
    serious: d.vulns.filter(v => isSerious(v.severity)).length,
    directVulns: d.vulns.filter(v => v.direct).length,
  };
}

const advisoryLabel = (v: { id: string; aliases: string[] }) => {
  const cve = v.aliases.find(a => a.startsWith('CVE-'));
  return cve ? `${v.id} (${cve})` : v.id;
};

export function renderDependencies(d: RepoDependencies, scannedAt: string | null, githubUrl?: string): string[] {
  const s = summarizeDeps(d);
  const lines: string[] = ['## Dependencies', ''];
  const facts = [
    d.languages.length ? `Languages: ${d.languages.join(', ')}` : '',
    d.stack.length ? `Stack: ${d.stack.join(', ')}` : '',
    d.services.length ? `Services: ${d.services.join(', ')}` : '',
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(' · '), '');

  if (d.failed) {
    lines.push('_Some dependency files couldn\'t be read on the last run, so this section may be incomplete._', '');
  }
  if (d.manifests.length === 0) {
    if (d.failed) return lines;
    lines.push(d.unparsed.length
      ? `_No dependency files this report can read yet. Build files found: ${d.unparsed.join(', ')}._`
      : '_No dependency manifests found._');
    lines.push('');
    return lines;
  }

  const parts = [`${s.direct} direct dependencies`];
  if (scannedAt) {
    parts.push(`${s.majorsBehind} a major version behind`);
    if (s.vulns) parts.push(`${s.vulns} known vulnerabilities (${s.serious} high or critical, ${s.directVulns} in direct dependencies)`);
    else if (d.locked > d.unscanned) parts.push(`no known vulnerabilities in ${d.locked - d.unscanned} scanned packages`);
  }
  if (d.dependabotOpenPrs) parts.push(`${d.dependabotOpenPrs} open Dependabot PRs`);
  lines.push(parts.join('; ') + '.');
  lines.push(scannedAt
    ? `Latest versions and advisories are from the weekly scan on ${scannedAt.split('T')[0]} (OSV).${d.unscanned ? ` ${d.unscanned} package versions changed since then and are checked next scan.` : ''}`
    : '_Not scanned yet: latest versions and advisories appear after the first weekly scan._');
  lines.push('');

  if (d.vulns.length) {
    lines.push('### Known vulnerabilities', '');
    lines.push('| Package | Version | Severity | Advisory | Fixed in | Direct |');
    lines.push('|---------|---------|----------|----------|----------|--------|');
    for (const v of d.vulns.slice(0, MAX_VULN_ROWS)) {
      lines.push(`| ${cell(v.package)} | ${cell(v.version)} | ${v.severity.toLowerCase()} | ${advisoryLabel(v)}${v.summary ? `: ${cell(v.summary)}` : ''} | ${cell(v.fixed)} | ${v.direct ? 'yes' : 'no'} |`);
    }
    if (d.vulns.length > MAX_VULN_ROWS) lines.push('', `_And ${d.vulns.length - MAX_VULN_ROWS} more, mostly lower severity._`);
    lines.push('');
  }

  for (const m of d.manifests) {
    const lock = m.lockfile ? `, installed versions from ${m.lockfile}` : ', no lockfile';
    lines.push(`### ${m.path} (${m.ecosystem}${lock})`, '');
    if (m.deps.length === 0) {
      lines.push('_No dependencies listed._', '');
      continue;
    }
    lines.push('| Package | Declared | Installed | Latest | Status |');
    lines.push('|---------|----------|-----------|--------|--------|');
    const rows = [...m.deps].sort((a, b) => Number(a.dev) - Number(b.dev) || a.name.localeCompare(b.name));
    for (const dep of rows) {
      lines.push(`| ${cell(dep.name)}${dep.dev ? ' (dev)' : ''} | ${cell(dep.declared ?? 'git/path')} | ${cell(dep.installed)} | ${cell(dep.latest)} | ${STATUS_LABEL[dep.status]} |`);
    }
    lines.push('');
  }
  if (d.unparsed.length) {
    lines.push(`Also found, not read yet: ${d.unparsed.join(', ')}.`, '');
  }
  if (githubUrl && d.dependabotOpenPrs) {
    lines.push(`Dependabot PRs: ${githubUrl}/pulls?q=is%3Apr+is%3Aopen+author%3Aapp%2Fdependabot`, '');
  }
  return lines;
}

export function renderDependencyRollup(report: DependencyReport, pages: { repo: RepoInfo }[]): string {
  const byRepo = new Map(report.repos.map(r => [r.repo, r]));
  const rows = pages
    .map(p => byRepo.get(p.repo.name))
    .filter((r): r is RepoDependencies => !!r)
    .map(r => ({ r, s: summarizeDeps(r) }))
    .sort((a, b) => b.s.serious - a.s.serious || b.s.vulns - a.s.vulns || b.s.majorsBehind - a.s.majorsBehind || a.r.repo.localeCompare(b.r.repo));
  const scanned = report.scannedAt ? report.scannedAt.split('T')[0] : null;

  const lines: string[] = [];
  lines.push('---');
  lines.push('title: "Dependency Updates and Vulnerabilities"');
  lines.push('tags: ["status", "dependencies", "security", "auto-generated"]');
  lines.push(`description: ${yamlStr('Which apps have known vulnerabilities, dependencies a major version behind, or open Dependabot PRs; worst first. Read this for a weekly update check.')}`);
  lines.push(`updated: ${yamlStr(scanned ?? day(report.generatedAt))}`);
  lines.push('visibility: "private"');
  lines.push('---');
  lines.push('');
  lines.push('# Dependency Updates and Vulnerabilities');
  lines.push('');
  lines.push('Auto-generated. Dependency lists are refreshed nightly from each repo\'s manifests and lockfiles; ' +
    (scanned ? `latest versions and OSV advisories are from the weekly scan on ${scanned}.` : 'latest versions and advisories appear after the first weekly scan.') +
    ' Each app links to its status page for the full list.');
  lines.push('');
  lines.push('| App | Stack | Direct deps | Major behind | Vulnerabilities (high+) | Dependabot PRs |');
  lines.push('|-----|-------|-------------|--------------|-------------------------|----------------|');
  for (const { r, s } of rows) {
    if (r.failed && r.manifests.length === 0) {
      lines.push(`| [${r.repo}](${r.repo}.md) | ${r.languages.slice(0, 2).join(', ') || '-'} | couldn't read this run | - | - | ${r.dependabotOpenPrs ?? '-'} |`);
      continue;
    }
    const vulns = scanned ? `${s.vulns} (${s.serious})` : '-';
    lines.push(`| [${r.repo}](${r.repo}.md) | ${r.stack.join(', ') || r.languages.slice(0, 2).join(', ') || '-'} | ${s.direct} | ${scanned ? s.majorsBehind : '-'} | ${vulns} | ${r.dependabotOpenPrs ?? '-'} |`);
  }
  lines.push('');

  const serious = rows.flatMap(({ r }) => r.vulns.filter(v => isSerious(v.severity)).map(v => ({ repo: r.repo, v })));
  if (serious.length) {
    lines.push('## High and critical advisories', '');
    for (const { repo, v } of serious.slice(0, 30)) {
      lines.push(`- ${repo}: ${v.package} ${v.version}, ${v.severity.toLowerCase()}, ${advisoryLabel(v)}${v.summary ? ` (${v.summary})` : ''}${v.fixed ? `. Fixed in ${v.fixed}` : ''}${v.direct ? '' : '. Transitive'}`);
    }
    if (serious.length > 30) lines.push(`- And ${serious.length - 30} more; see each app's page.`);
    lines.push('');
  }
  const noManifest = rows.filter(({ r }) => r.manifests.length === 0 && !r.failed).map(({ r }) => r.repo);
  if (noManifest.length) {
    lines.push(`No readable dependency files: ${noManifest.join(', ')}.`, '');
  }
  return lines.join('\n');
}

function renderOverview(pages: StatusPage[], days: number): string {
  const newest = pages.map(p => day(p.repo.lastCommitDate)).filter(d => d !== '-').sort().pop() ?? '-';
  const lines: string[] = [];
  lines.push('---');
  lines.push('title: "App Status Overview"');
  lines.push('tags: ["status", "index", "auto-generated"]');
  lines.push(`description: ${yamlStr(`Status of every active repo (pushed in the last ${days} days): stage, last push, open issues, latest commit, and which status notes it has.`)}`);
  lines.push(`updated: ${yamlStr(newest)}`);
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
    const lastPush = day(p.repo.lastCommitDate);
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
  const depsPath = getArg('deps', '');

  if (!token) {
    console.error('GITHUB_TOKEN env var is required');
    process.exit(1);
  }
  if (!username) {
    console.error('GITHUB_USERNAME env var is required');
    process.exit(1);
  }

  const index = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as { repos: RepoInfo[] };
  const active = selectActiveRepos(index.repos, days);
  console.log(`Building status pages for ${active.length} of ${index.repos.length} repos (pushed in the last ${days} days)...`);
  if (active.length === 0) {
    // An empty list is far likelier to be a broken index than a quiet portfolio.
    console.error('No active repos found; leaving existing status pages untouched.');
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const pages: StatusPage[] = [];
  for (const [i, repo] of active.entries()) {
    const page = await buildPage(octokit, username, repo);
    console.log(`  ${nm(repo.name)} (${i + 1}/${active.length}): ${page.commits.length} commits, ${page.files.length} status files${page.failed ? ', INCOMPLETE' : ''}`);
    pages.push(page);
  }

  const failedCount = pages.filter(p => p.failed).length;
  if (failedCount / pages.length > MAX_FAILURE_RATE) {
    console.error(`${failedCount} of ${pages.length} repos had failed GitHub calls (limit ${MAX_FAILURE_RATE * 100}%). ` +
      'Check that GITHUB_TOKEN can read private repos. Leaving existing status pages untouched.');
    process.exit(1);
  }

  // Start clean so repos that went quiet or were renamed don't leave stale
  // pages behind.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  let depReport: DependencyReport | null = null;
  if (depsPath) {
    try {
      depReport = JSON.parse(await fs.readFile(depsPath, 'utf-8')) as DependencyReport;
    } catch {
      console.warn('No dependency report found; writing pages without a Dependencies section.');
    }
  }
  const depsByRepo = new Map((depReport?.repos ?? []).map(r => [r.repo, r]));

  for (const page of pages) {
    const md = renderPage(page, depsByRepo.get(page.repo.name), depReport?.scannedAt);
    await fs.writeFile(path.join(outDir, `${page.repo.name}.md`), md, 'utf-8');
  }
  await fs.writeFile(path.join(outDir, 'overview.md'), renderOverview(pages, days), 'utf-8');
  if (depReport) {
    await fs.writeFile(path.join(outDir, 'dependencies.md'), renderDependencyRollup(depReport, pages), 'utf-8');
  }
  if (failedCount) console.warn(`${failedCount} page(s) are incomplete because a GitHub call failed.`);
  console.log(`Wrote ${pages.length + (depReport ? 2 : 1)} files to ${outDir}`);
}

// Run only as a script, so tests can import the helpers above.
if (process.argv[1] && /buildStatusDigest\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('Failed:', errMsg(err));
    process.exit(1);
  });
}
