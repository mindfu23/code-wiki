#!/usr/bin/env node
// Local checks for Code.gs: date parsing, titles, and full rollovers on a
// sample board held in memory. Run with: node test/run-tests.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'Code.gs' });
const R = sandbox.module.exports;
const CFG = JSON.parse(JSON.stringify(R.CONFIG));
CFG.RECURRING_LINE = 'Weekly review';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + (e && e.message)); process.exitCode = 1; }
}
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const iso = (c) => (c ? R.isoDay(c) : null);
const plain = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- dates
test('reads leading dates in the formats the board uses', () => {
  const ref = D('2026-11-14');
  const cases = {
    'Nov 15: Java module': '2026-11-15',
    'Sun Nov 15: homework': '2026-11-15',
    'Tues Nov 10: half day': '2026-11-10',
    'Thurs Nov 12: Java': '2026-11-12',
    'Mon Dec 7: manuscript': '2026-12-07',
    'Dec 2: Java': '2026-12-02',
    'Jan 5: plan': '2027-01-05',
    'January 5, 2028: far plan': '2028-01-05',
    '11/22: thing': '2026-11-22',
    '1/5/27: thing': '2027-01-05',
    'Nov 22 - thing': '2026-11-22',
  };
  for (const [text, want] of Object.entries(cases)) {
    assert.strictEqual(iso(R.parseLeadingDate(text, ref)), want, text);
  }
});

test('leaves undated and mid-sentence dates alone', () => {
  const ref = D('2026-11-14');
  for (const text of [
    'Check on your benefits status (was due Nov 2)',
    'See about signing up for the 3/26 performance',
    'Maybe 3 things',
    'Digital Illustration homework every Sun and Wed evening',
    'Nov 15 10am thing',
    'Feb 30: not a date',
    'Weekly review',
  ]) {
    assert.strictEqual(R.parseLeadingDate(text, ref), null, text);
  }
});

test('week starts on the configured day', () => {
  assert.strictEqual(iso(R.weekStart(D('2026-11-14'), 1)), '2026-11-09'); // Sat -> Mon
  assert.strictEqual(iso(R.weekStart(D('2026-11-16'), 1)), '2026-11-16'); // Mon
  assert.strictEqual(iso(R.weekStart(D('2026-11-14'), 0)), '2026-11-08'); // Sun start
  assert.strictEqual(iso(R.weekStart(D('2026-11-14'), 6)), '2026-11-14'); // Sat start
  assert.strictEqual(iso(R.weekStart(D('2027-01-01'), 1)), '2026-12-28'); // across a year
});

test('titles', () => {
  const t = (k, d) => R.formatTitle(CFG.TITLES[k], D(d), CFG);
  assert.strictEqual(t('today', '2026-11-14'), 'Today (Sat Nov 14)');
  assert.strictEqual(t('week', '2026-11-16'), 'This week (Mon Nov 16 to Sun Nov 22)');
  assert.strictEqual(t('week', '2026-12-28'), 'This week (Mon Dec 28 to Sun Jan 3)');
  assert.strictEqual(t('month', '2026-12-01'), 'This month (December)');
  assert.strictEqual(t('quarter', '2027-01-01'), 'This quarter (Q1 2027, through March)');
  assert.strictEqual(t('year', '2027-01-01'), 'This year / 2027');
});

test('period keys change only at boundaries', () => {
  const k = (d) => plain(R.periodKeys(D(d), CFG));
  assert.deepStrictEqual(k('2026-11-15'), { day: '2026-11-15', week: '2026-11-09', month: '2026-11', quarter: '2026-Q4', year: '2026' });
  assert.strictEqual(k('2026-11-16').week, '2026-11-16');
  assert.strictEqual(k('2026-12-31').quarter, '2026-Q4');
  assert.strictEqual(k('2027-01-01').quarter, '2027-Q1');
});

// ---------------------------------------------------------------- sample board
const H = (text, level = 2) => ({ type: 'heading', level, text });
const P = (text) => ({ type: 'para', text });
const I = (text, nesting = 0) => ({ type: 'item', text, nesting });

function sampleBoard() {
  return [
    H('Task Board', 1),
    P('Edit here; the script keeps the dates rolling.'),
    H('Top projects'),
    I('Classes'),
    H('Today (Sat Nov 14)'),
    I('Get ahead on Sunday deadlines'),
    H('This week (Sat Nov 14 to Fri Nov 20)'),
    I('Nov 15: Java module 5'),
    I('Sun Nov 15: Illustration homework'),
    I('Nov 18: Java module 6'),
    I('Laundry'),
    P('Carried over from Nov 6 to 13 (dates passed; check off, move or drop)'),
    I('Sun Nov 8: Old homework'),
    I('Weekly review: done Friday'),
    H('This month (November)'),
    P('Classes'),
    P(''),
    I('Nov 22: Java module 7'),
    I('Nov 22: Sub-step of nothing'),
    I('Nov 29: Discussion 15'),
    I('Homework every Sun and Wed'),
    P(''),
    P('Jobs'),
    P(''),
    I('Reach out to agencies'),
    I('Nov 17: Call the recruiter'),
    I('Bring the portfolio', 1),
    P(''),
    P('People'),
    P(''),
    I('Call a friend'),
    I('Weekly review'),
    H('This quarter (Q4 2026, through December)'),
    P('Classes'),
    P(''),
    I('Dec 2: Java module 9'),
    I('Dec 18: Final presentations'),
    I('Finish the semester strong'),
    P(''),
    P('Personal'),
    P(''),
    I('Renewal due in December'),
    I('Weekly review'),
    H('This year / 2027'),
    P('Novels'),
    P(''),
    I('Jan 12: Start the redraft'),
    I('Feb 3: Line edit'),
    I('Spellpunk edit'),
    H('Done'),
    H('11/6/26', 3),
    I('Task Board set up'),
  ];
}

function texts(mem) { return mem.scan().map((b) => (b.type === 'item' ? '  '.repeat(b.nesting || 0) + '- ' : b.type === 'heading' ? (b.level > 2 ? '### ' : '# ') : '') + b.text); }
function section(mem, startsWith) {
  const all = texts(mem);
  const i = all.findIndex((t) => t.startsWith('# ' + startsWith));
  const j = all.findIndex((t, k) => k > i && t.startsWith('# '));
  return all.slice(i, j < 0 ? undefined : j);
}
function run(mem, day, state) {
  const r = R.rollover(mem, D(day), state, CFG);
  return { state: plain(r.state), log: plain(r.log) };
}

test('first run only re-dates Today and records the periods', () => {
  const mem = R.MemoryAdapter.fromBlocks(sampleBoard());
  const before = texts(mem);
  const r = run(mem, '2026-11-15', null);
  const after = texts(mem);
  assert.strictEqual(after[4], '# Today (Sun Nov 15)');
  after[4] = before[4];
  assert.deepStrictEqual(after, before);
  assert.strictEqual(r.state.week, '2026-11-09');
});

test('a plain day only re-dates Today, and a rerun changes nothing', () => {
  const mem = R.MemoryAdapter.fromBlocks(sampleBoard());
  const s0 = run(mem, '2026-11-14', null).state;
  const r = run(mem, '2026-11-15', s0);
  assert.deepStrictEqual(r.log, [
    'Re-dated "Today (Sat Nov 14)" to "Today (Sun Nov 15)".',
    'Turned 24 bullets into checklist items.',
  ]);
  const snap = texts(mem);
  const r2 = run(mem, '2026-11-15', r.state);
  assert.deepStrictEqual(r2.log, ['Nothing to roll today.']);
  assert.deepStrictEqual(texts(mem), snap);
});

test('Monday rollover: re-dates, carries over, pulls forward, adds the weekly line', () => {
  const mem = R.MemoryAdapter.fromBlocks(sampleBoard());
  const s0 = run(mem, '2026-11-15', null).state;
  const r = run(mem, '2026-11-16', s0);
  assert.deepStrictEqual(section(mem, 'This week'), [
    '# This week (Mon Nov 16 to Sun Nov 22)',
    '- Nov 17: Call the recruiter',
    '  - Bring the portfolio',
    '- Nov 18: Java module 6',
    '- Nov 22: Java module 7',
    '- Nov 22: Sub-step of nothing',
    '- Laundry',
    '- Weekly review',
    'Carried over from Nov 6 to 13 (dates passed; check off, move or drop)',
    '- Sun Nov 8: Old homework',
    '- Weekly review: done Friday',
    'Carried over Mon Nov 16 (dates passed; check off, move or drop)',
    '- Nov 15: Java module 5',
    '- Sun Nov 15: Illustration homework',
  ]);
  // Month keeps its undated items and the Nov 29 item; nothing was lost.
  const month = section(mem, 'This month');
  assert.ok(month.includes('- Nov 29: Discussion 15'));
  assert.ok(month.includes('- Homework every Sun and Wed'));
  assert.ok(!month.some((t) => t.includes('Nov 22')));
  assert.strictEqual(texts(mem).filter((t) => t.startsWith('- ') || t.startsWith('  - ')).length,
    sampleBoard().filter((b) => b.type === 'item').length + 1); // +1 weekly line
  assert.ok(r.log.some((l) => l.startsWith('Moved "Nov 22: Java module 7" from This month to This week')));
});

test('December 1 rollover pulls December items into This month by group', () => {
  const mem = R.MemoryAdapter.fromBlocks(sampleBoard());
  const s0 = run(mem, '2026-11-30', null).state; // Monday Nov 30
  run(mem, '2026-12-01', s0);
  const month = section(mem, 'This month');
  assert.strictEqual(month[0], '# This month (December)');
  const ci = month.indexOf('Classes');
  assert.deepStrictEqual(month.slice(ci, ci + 4), ['Classes', '', '- Dec 2: Java module 9', '- Dec 18: Final presentations']);
  // Old November items carried to This week; undated ones stay.
  const week = section(mem, 'This week');
  assert.ok(week.includes('- Nov 29: Discussion 15'));
  assert.ok(month.includes('- Homework every Sun and Wed'));
  // The month's unfilled recurring line already exists, so no second one.
  assert.strictEqual(month.filter((t) => t === '- Weekly review').length, 1);
  assert.ok(!section(mem, 'This quarter').some((t) => t.includes('Dec 2')));
});

test('January 1 rollover cascades year -> quarter -> month -> week', () => {
  const mem = R.MemoryAdapter.fromBlocks(sampleBoard());
  const s0 = run(mem, '2026-12-31', null).state;
  run(mem, '2027-01-01', s0);
  assert.strictEqual(section(mem, 'This year')[0], '# This year / 2027');
  const quarter = section(mem, 'This quarter');
  assert.strictEqual(quarter[0], '# This quarter (Q1 2027, through March)');
  // Feb 3 lands in the quarter under a new "Novels" group at the end, spaced like the others.
  const ni = quarter.indexOf('Novels');
  assert.ok(ni > 0, 'Novels group created');
  assert.deepStrictEqual(quarter.slice(ni - 1, ni + 3), ['', 'Novels', '', '- Feb 3: Line edit']);
  // Jan 12 goes all the way to This month.
  const month = section(mem, 'This month');
  assert.ok(month.includes('- Jan 12: Start the redraft'));
  assert.ok(section(mem, 'This year').includes('- Spellpunk edit'));
});

test('Done and Top projects are never touched', () => {
  const mem = R.MemoryAdapter.fromBlocks(sampleBoard());
  let st = run(mem, '2026-11-14', null).state;
  for (let n = 15; n <= 60; n++) {
    const day = new Date(Date.UTC(2026, 10, n)).toISOString().slice(0, 10);
    st = run(mem, day, st).state;
  }
  assert.deepStrictEqual(section(mem, 'Done'), ['# Done', '### 11/6/26', '- Task Board set up']);
  assert.deepStrictEqual(section(mem, 'Top projects'), ['# Top projects', '- Classes']);
  // Every original item still exists somewhere.
  const all = texts(mem).map((t) => t.replace(/^\s*- /, ''));
  for (const b of sampleBoard()) if (b.type === 'item') assert.ok(all.includes(b.text), b.text);
});

test('a board without some sections still runs', () => {
  const mem = R.MemoryAdapter.fromBlocks([H('This week (old)'), I('Nov 15: thing'), H('Done')]);
  const s0 = run(mem, '2026-11-15', null).state;
  const r = run(mem, '2026-11-16', s0);
  assert.ok(r.log.some((l) => l.includes('No "Today" heading found')));
  assert.deepStrictEqual(section(mem, 'This week'), [
    '# This week (Mon Nov 16 to Sun Nov 22)',
    '- Weekly review',
    'Carried over Mon Nov 16 (dates passed; check off, move or drop)',
    '- Nov 15: thing',
  ]);
});

// ---------------------------------------------------------------- done and checklists
function doneBoard() {
  const cb = (text, extra = {}) => Object.assign({ type: 'item', text, nesting: 0, checkbox: true }, extra);
  return [
    H('Today (Sun Nov 15)'),
    cb('X Done today but stays in Today'),
    H('This week (Mon Nov 9 to Sun Nov 15)'),
    cb('X Laundry'),
    cb('Nov 18: Java module 6'),
    cb('Struck item', { struck: true }),
    cb('Sub-step', { nesting: 1 }),
    I('Plain bullet to convert'),
    cb('Xylophone practice'),
    H('This month (November)'),
    P('Jobs'),
    cb('X Nov 10: Old interview'),
    cb('Follow up with an agency'),
    H('Done'),
    H('11/6/26', 3),
    I('Older finished thing'),
  ];
}

test('rollover moves done items to Done under a new dated heading, newest first', () => {
  const mem = R.MemoryAdapter.fromBlocks(doneBoard());
  const s0 = run(mem, '2026-11-15', null).state;
  const r = run(mem, '2026-11-16', s0);
  assert.deepStrictEqual(section(mem, 'Done'), [
    '# Done',
    '### 11/16/26',
    '- Laundry',
    '- Struck item',
    '  - Sub-step',
    '- Nov 10: Old interview',
    '### 11/6/26',
    '- Older finished thing',
  ]);
  // Today keeps its own done item; "Xylophone" isn't an X prefix.
  assert.ok(section(mem, 'Today').includes('- X Done today but stays in Today'));
  assert.ok(section(mem, 'This week').includes('- Xylophone practice'));
  // A done item with a passed date went to Done, not to Carried over.
  assert.ok(!section(mem, 'This week').some((t) => t.includes('Old interview')));
  // Moved items joined Done's plain list.
  const moved = mem.scan().find((b) => b.text === 'Laundry');
  assert.strictEqual(moved.checkbox, false);
  assert.ok(r.log.some((l) => l === 'Moved done item "Laundry" from This week to Done (11/16/26).'));
});

test('a second sweep the same day adds to that day\'s heading', () => {
  const cfg = Object.assign({}, CFG, { DONE_SWEEP: 'daily' });
  const mem = R.MemoryAdapter.fromBlocks(doneBoard());
  let st = plain(R.rollover(mem, D('2026-11-15'), null, cfg).state);
  st = plain(R.rollover(mem, D('2026-11-16'), st, cfg).state);
  // New tick later the same day, then a run the next day files it under that day.
  const bs = mem.blocks;
  bs.find((b) => b.text === 'Follow up with an agency').text = 'X Follow up with an agency';
  R.rollover(mem, D('2026-11-17'), st, cfg);
  const done = section(mem, 'Done');
  assert.deepStrictEqual(done.slice(0, 3), ['# Done', '### 11/17/26', '- Follow up with an agency']);
  assert.strictEqual(done.filter((t) => t.startsWith('### ')).length, 3);
});

test('daily sweep is off by default between rollovers', () => {
  const mem = R.MemoryAdapter.fromBlocks(doneBoard());
  const s0 = run(mem, '2026-11-12', null).state; // Thu
  run(mem, '2026-11-13', s0); // Fri, same week
  assert.ok(section(mem, 'This week').includes('- X Laundry'));
});

test('plain bullets become checklist items; moved and new items stay checklist items', () => {
  const mem = R.MemoryAdapter.fromBlocks(doneBoard());
  const s0 = run(mem, '2026-11-15', null).state;
  run(mem, '2026-11-16', s0);
  const rolling = mem.scan().filter((b) => b.type === 'item' && !['Older finished thing', 'Laundry', 'Struck item', 'Sub-step', 'Nov 10: Old interview'].includes(b.text));
  assert.ok(rolling.length > 0);
  for (const b of rolling) assert.strictEqual(b.checkbox, true, b.text);
  // Done's older items are left as they were.
  assert.strictEqual(mem.scan().find((b) => b.text === 'Older finished thing').checkbox, undefined);
  // A rerun has nothing left to convert.
  const r2 = R.rollover(mem, D('2026-11-16'), plain(R.periodKeys(D('2026-11-16'), CFG)), CFG);
  assert.deepStrictEqual(plain(r2.log), ['Nothing to roll today.']);
});

test('done-prefix and done-label tokens', () => {
  assert.strictEqual(R.formatTitle(CFG.DONE_LABEL, D('2026-11-14'), CFG), '11/14/26');
  assert.strictEqual(R.formatTitle(CFG.DONE_LABEL, D('2027-01-05'), CFG), '1/5/27');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some failed' : ''));
