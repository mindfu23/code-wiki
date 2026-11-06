// Advisory snapshot for the weekly package check (web/src/buildAdvisorySnapshot.ts).
// Run: npx tsx --test scripts/tests/advisories.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvisorySnapshot } from '../../web/src/buildAdvisorySnapshot.js';
import type { DependencyReport, RepoDependencies, VulnRow } from '../../web/src/buildDependencyReport.js';

const vuln = (o: Partial<VulnRow>): VulnRow => ({
  id: 'GHSA-aaaa', aliases: [], ecosystem: 'npm', package: 'pkg', version: '1.0.0',
  severity: 'HIGH', summary: '', fixed: null, direct: true, ...o,
});
const repo = (name: string, vulns: VulnRow[], failed = false): RepoDependencies => ({
  repo: name, languages: [], stack: [], services: [], models: [], codeScanned: true, manifests: [],
  unparsed: [], dependabotOpenPrs: 0, vulns, locked: 0, unscanned: 0, failed,
});

test('keeps only high and critical, sorted by app, severity, package; drops run timestamps', () => {
  const report: DependencyReport = {
    generatedAt: '2026-11-06T00:28:00Z',
    scannedAt: '2026-11-06T00:27:00Z',
    repos: [
      repo('Zed', [vuln({ package: 'b', severity: 'HIGH' }), vuln({ package: 'a', severity: 'MODERATE' })]),
      repo('Alpha', [
        vuln({ package: 'z', severity: 'HIGH', aliases: ['GHSA-x', 'CVE-2026-1'], summary: '  spaced\n  out ', fixed: '2.0.0' }),
        vuln({ package: 'y', severity: 'CRITICAL', direct: false }),
        vuln({ package: 'y', severity: 'CRITICAL', direct: false }), // same key twice (two lockfiles)
        vuln({ package: 'q', severity: 'LOW' }),
      ]),
    ],
  };
  const snap = buildAdvisorySnapshot(report);
  assert.equal(snap.scannedAt, '2026-11-06');
  assert.deepEqual(snap.findings.map(f => [f.app, f.severity, f.package]), [
    ['Alpha', 'CRITICAL', 'y'],
    ['Alpha', 'HIGH', 'z'],
    ['Zed', 'HIGH', 'b'],
  ]);
  const z = snap.findings[1];
  assert.equal(z.cve, 'CVE-2026-1');
  assert.equal(z.summary, 'spaced out');
  assert.equal(z.fixed, '2.0.0');
  assert.ok(!JSON.stringify(snap).includes('00:28'), 'no generatedAt in the snapshot');
});

test('apps the run could not read are listed as unreadable, not as clean', () => {
  const snap = buildAdvisorySnapshot({
    generatedAt: 'x', scannedAt: '2026-11-06T00:00:00Z',
    repos: [repo('Broken', [vuln({})], true), repo('Fine', [vuln({})])],
  });
  assert.deepEqual(snap.unreadable, ['Broken']);
  assert.deepEqual(snap.findings.map(f => f.app), ['Fine']);
});

test('same input gives byte-identical output', () => {
  const report: DependencyReport = {
    generatedAt: 'a', scannedAt: '2026-11-06T00:00:00Z',
    repos: [repo('A', [vuln({ id: 'GHSA-2' }), vuln({ id: 'GHSA-1' })])],
  };
  const again = { ...report, generatedAt: 'b', repos: [repo('A', [vuln({ id: 'GHSA-1' }), vuln({ id: 'GHSA-2' })])] };
  assert.equal(JSON.stringify(buildAdvisorySnapshot(report)), JSON.stringify(buildAdvisorySnapshot(again)));
});
