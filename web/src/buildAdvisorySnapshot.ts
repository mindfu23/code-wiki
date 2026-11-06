/**
 * Writes a small, stable snapshot of every high and critical advisory per app
 * (data/advisories.json in the private content repo), from the dependency
 * report that build:deps leaves in /tmp.
 *
 * The nightly job commits it with the rest of data/, so git history holds one
 * version per night. The weekly package check in the content repo
 * (.github/workflows/package-check.yml there) diffs this week's file against
 * last week's and opens or updates one issue only when something changed. No
 * model is involved anywhere.
 *
 * The file has no timestamps besides the scan date, so it only changes when a
 * finding does: a new scan, an app updating a package, or an app added or
 * dropped.
 *
 *   npm run build:advisories -- --deps /tmp/dependency-report.json --out /tmp/private-content/data/advisories.json
 *
 * With no report (build:deps failed), it leaves the old snapshot untouched.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { DependencyReport, VulnRow } from './buildDependencyReport.js';
import { errMsg } from './ciLog.js';

export interface AdvisoryFinding {
  app: string;
  severity: 'CRITICAL' | 'HIGH';
  ecosystem: string;
  package: string;
  version: string;
  id: string;
  cve: string | null;
  fixed: string | null;
  direct: boolean;
  summary: string;
}

export interface AdvisorySnapshot {
  version: 1;
  /** Day of the OSV scan the findings come from (YYYY-MM-DD), or null before the first scan. */
  scannedAt: string | null;
  /** Apps the nightly job couldn't read this run: their findings are unknown, not cleared. */
  unreadable: string[];
  findings: AdvisoryFinding[];
}

const isSerious = (s: string): s is 'CRITICAL' | 'HIGH' => s === 'CRITICAL' || s === 'HIGH';
const SUMMARY_MAX = 140;

function toFinding(app: string, v: VulnRow): AdvisoryFinding | null {
  const severity = v.severity.toUpperCase();
  if (!isSerious(severity)) return null;
  const summary = v.summary.replace(/\s+/g, ' ').trim();
  return {
    app,
    severity,
    ecosystem: v.ecosystem,
    package: v.package,
    version: v.version,
    id: v.id,
    cve: v.aliases.find(a => a.startsWith('CVE-')) ?? null,
    fixed: v.fixed,
    direct: v.direct,
    summary: summary.length > SUMMARY_MAX ? summary.slice(0, SUMMARY_MAX - 1) + '…' : summary,
  };
}

/** Pure: report in, snapshot out, sorted so the same findings always serialize the same way. */
export function buildAdvisorySnapshot(report: DependencyReport): AdvisorySnapshot {
  const findings: AdvisoryFinding[] = [];
  const unreadable: string[] = [];
  for (const r of report.repos) {
    if (r.failed) {
      unreadable.push(r.repo);
      continue;
    }
    const seen = new Set<string>();
    for (const v of r.vulns) {
      const f = toFinding(r.repo, v);
      if (!f) continue;
      const key = `${f.ecosystem}:${f.package}@${f.version}#${f.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
  }
  const rank = (s: string) => (s === 'CRITICAL' ? 0 : 1);
  findings.sort((a, b) =>
    a.app.localeCompare(b.app) || rank(a.severity) - rank(b.severity) ||
    a.package.localeCompare(b.package) || a.version.localeCompare(b.version) || a.id.localeCompare(b.id));
  return {
    version: 1,
    scannedAt: report.scannedAt ? report.scannedAt.split('T')[0] : null,
    unreadable: unreadable.sort((a, b) => a.localeCompare(b)),
    findings,
  };
}

function getArg(name: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  console.error(`Missing required argument: --${name}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const depsPath = getArg('deps');
  const outPath = getArg('out');
  let report: DependencyReport;
  try {
    report = JSON.parse(await fs.readFile(depsPath, 'utf-8')) as DependencyReport;
  } catch {
    console.warn('No dependency report found; leaving the advisory snapshot as it was.');
    return;
  }
  if (!report.scannedAt) {
    // Without a scan every app reads as clean, which would look like everything cleared.
    console.warn('The dependency report has no scan yet; leaving the advisory snapshot as it was.');
    return;
  }
  const snap = buildAdvisorySnapshot(report);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(snap, null, 1) + '\n', 'utf-8');
  // Counts only: this repo's Actions logs are public.
  const apps = new Set(snap.findings.map(f => f.app)).size;
  console.log(`Advisory snapshot: ${snap.findings.length} high or critical finding(s) in ${apps} app(s), scan of ${snap.scannedAt}` +
    (snap.unreadable.length ? `, ${snap.unreadable.length} app(s) unreadable this run` : ''));
}

// Run only as a script, so tests can import the helpers above.
if (process.argv[1] && /buildAdvisorySnapshot\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('Failed:', errMsg(err));
    process.exit(1);
  });
}
