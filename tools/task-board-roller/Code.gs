/**
 * Task Board Roller
 *
 * A Google Apps Script that keeps a Google Docs task board rolling forward:
 *
 *   - Every day it re-dates the "Today" heading.
 *   - At the start of each week, month, quarter and year it re-dates that
 *     section's heading.
 *   - On those rollovers it pulls dated items forward into the section they
 *     now belong to (This year -> This quarter -> This month -> This week),
 *     and gathers items whose date has passed into a "Carried over" group at
 *     the end of This week, so nothing silently sits in the past.
 *   - Optionally it adds a fresh recurring line (for example
 *     "Weekly review") to a section when its period rolls over.
 *
 * It never deletes an item and never marks anything done. Undated items are
 * left exactly where they are.
 *
 * Install, use and removal are in README.md next to this file.
 */

// ---------------------------------------------------------------------------
// Settings. Change these to fit your board.
// ---------------------------------------------------------------------------

var CONFIG = {
  // Time zone used to decide what "today" is.
  TIME_ZONE: 'America/Los_Angeles',

  // First day of the week: 0 = Sunday, 1 = Monday ... 6 = Saturday.
  WEEK_STARTS_ON: 1,

  // Hour of the day (0-23, in TIME_ZONE) the daily run happens.
  RUN_HOUR: 4,

  // Leave blank when the script is bound to the doc (Extensions > Apps Script).
  // For a standalone script, put the doc's id here (the long part of its URL).
  DOC_ID: '',

  // true = only log what would change; the doc is not touched.
  DRY_RUN: false,

  // Section headings are found by how their text starts (case-insensitive).
  // Only Heading 1 and Heading 2 paragraphs count as section headings.
  SECTIONS: {
    today: 'Today',
    week: 'This week',
    month: 'This month',
    quarter: 'This quarter',
    year: 'This year',
  },

  // New heading text for each section. Tokens:
  //   {dow} {mon} {d}           today, e.g. Sat Nov 14
  //   {startDow} {startMon} {startD} {endDow} {endMon} {endD}   the week
  //   {monthName} {year} {q} {quarterEndMonthName}
  TITLES: {
    today: 'Today ({dow} {mon} {d})',
    week: 'This week ({startDow} {startMon} {startD} to {endDow} {endMon} {endD})',
    month: 'This month ({monthName})',
    quarter: 'This quarter (Q{q} {year}, through {quarterEndMonthName})',
    year: 'This year / {year}',
  },

  // Move items whose date has arrived into the nearer section.
  PULL_FORWARD: true,

  // Gather items whose date has passed into a group at the end of This week.
  CARRY_OVER_PASSED: true,
  CARRY_OVER_LABEL: 'Carried over {dow} {mon} {d} (dates passed; check off, move or drop)',
  // Groups whose label starts with this are left alone (already carried over).
  CARRY_OVER_PREFIX: 'Carried over',

  // Label for a new group when a pulled item has no matching group.
  FALLBACK_GROUP_LABEL: 'Other',

  // A recurring line added to a section when its period rolls over, unless
  // the section already has a line with exactly this text, e.g. 'Weekly review'.
  // '' turns it off.
  RECURRING_LINE: '',
  RECURRING_SECTIONS: ['week', 'month', 'quarter'],
};

var STATE_KEY = 'TASK_BOARD_ROLLER_STATE';
var HANDLER = 'rollTaskBoard';

// ---------------------------------------------------------------------------
// Things you run from the Apps Script editor (or the Task Board menu).
// ---------------------------------------------------------------------------

/** Run once: installs the daily timer. Safe to run again. */
function setupTriggers() {
  removeTriggers();
  ScriptApp.newTrigger(HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.RUN_HOUR)
    .inTimezone(CONFIG.TIME_ZONE)
    .create();
  console.log('Daily run set for about ' + CONFIG.RUN_HOUR + ':00 ' + CONFIG.TIME_ZONE + '.');
}

/** Removes this script's timer. The doc is left as it is. */
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === HANDLER) ScriptApp.deleteTrigger(t);
  });
}

/** The daily job. Also safe to run by hand: it only acts on what changed. */
function rollTaskBoard() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('Another run is in progress; skipping.');
    return;
  }
  try {
    var today = todayIn_(CONFIG.TIME_ZONE);
    var state = loadState_();
    var adapter = CONFIG.DRY_RUN ? MemoryAdapter.fromBlocks(docAdapter_().scan()) : docAdapter_();
    var result = rollover(adapter, today, state, CONFIG);
    result.log.forEach(function (line) { console.log(line); });
    if (CONFIG.DRY_RUN) {
      console.log('Dry run: nothing was changed.');
    } else {
      saveState_(result.state);
    }
  } finally {
    lock.releaseLock();
  }
}

/** Shows what a run would do today, without changing the doc or the saved state. */
function preview() {
  previewOn('');
}

/**
 * Shows what a run on a given date would do, e.g. previewOn('2026-11-16').
 * Nothing in the doc or the saved state changes.
 */
function previewOn(isoDate) {
  var day = isoDate ? parseIso_(isoDate) : todayIn_(CONFIG.TIME_ZONE);
  var mem = MemoryAdapter.fromBlocks(docAdapter_().scan());
  var result = rollover(mem, day, loadState_(), CONFIG);
  var text = ['Preview for ' + isoDay(day) + ':'].concat(result.log.length ? result.log : ['(no changes)']).join('\n');
  console.log(text);
  try { DocumentApp.getUi().alert(text); } catch (e) { /* not opened from the doc */ }
  return text;
}

/** Shows the periods the script last rolled to. */
function showState() {
  console.log(JSON.stringify(loadState_(), null, 2));
}

/** Forgets the saved periods; the next run only records today's periods again. */
function resetState() {
  PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
  console.log('State cleared.');
}

/** Adds a Task Board menu when the doc opens (bound scripts only). */
function onOpen() {
  try {
    DocumentApp.getUi()
      .createMenu('Task Board')
      .addItem('Roll forward now', HANDLER)
      .addItem('Preview today\'s roll (no changes)', 'preview')
      .addToUi();
  } catch (e) { /* not bound to a doc */ }
}

// ---------------------------------------------------------------------------
// Rollover logic. Works on any adapter (the real doc, or an in-memory copy).
// ---------------------------------------------------------------------------

/**
 * Rolls the board forward to `today`.
 * @param adapter  DocAdapter or MemoryAdapter
 * @param today    {y, m, d}
 * @param state    saved period keys from the last run, or null
 * @param cfg      CONFIG
 * @return {state, log}
 */
function rollover(adapter, today, state, cfg) {
  var log = [];
  var keys = periodKeys(today, cfg);

  if (!state || !state.day) {
    retitle_(adapter, 'today', today, cfg, log);
    log.push('First run: recorded the current day, week, month, quarter and year. ' +
      'Sections roll from the next new period on.');
    return { state: keys, log: log };
  }

  var changed = {
    day: state.day !== keys.day,
    week: state.week !== keys.week,
    month: state.month !== keys.month,
    quarter: state.quarter !== keys.quarter,
    year: state.year !== keys.year,
  };
  var anyPeriod = changed.week || changed.month || changed.quarter || changed.year;

  if (changed.day) retitle_(adapter, 'today', today, cfg, log);
  ['week', 'month', 'quarter', 'year'].forEach(function (s) {
    if (changed[s]) retitle_(adapter, s, today, cfg, log);
  });

  if (anyPeriod && cfg.CARRY_OVER_PASSED) carryOverPassed_(adapter, today, cfg, log);

  if (cfg.PULL_FORWARD) {
    var r = periodRanges(today, cfg);
    if (changed.quarter) pullForward_(adapter, ['year'], 'quarter', r.quarter, cfg, log);
    if (changed.month) pullForward_(adapter, ['year', 'quarter'], 'month', r.month, cfg, log);
    if (changed.week) pullForward_(adapter, ['year', 'quarter', 'month'], 'week', r.week, cfg, log);
  }

  if (cfg.RECURRING_LINE) {
    (cfg.RECURRING_SECTIONS || []).forEach(function (s) {
      if (changed[s]) ensureRecurringLine_(adapter, s, cfg, log);
    });
  }

  if (!log.length) log.push('Nothing to roll today.');
  return { state: keys, log: log };
}

function retitle_(adapter, section, today, cfg, log) {
  var doc = analyze(adapter.scan(), cfg);
  var h = doc.headings[section];
  if (h == null) {
    log.push('No "' + cfg.SECTIONS[section] + '" heading found; skipped re-dating it.');
    return;
  }
  var title = formatTitle(cfg.TITLES[section], today, cfg);
  if (doc.blocks[h].text === title) return;
  adapter.setText(h, title);
  log.push('Re-dated "' + doc.blocks[h].text + '" to "' + title + '".');
}

/** Moves top-level items dated before today into This week's carried-over group. */
function carryOverPassed_(adapter, today, cfg, log) {
  var label = formatTitle(cfg.CARRY_OVER_LABEL, today, cfg);
  var t = serial(today);
  var guard = 0;
  while (guard++ < 500) {
    var doc = analyze(adapter.scan(), cfg);
    if (doc.headings.week == null) return;
    var unit = findUnit_(doc, ['week', 'month', 'quarter', 'year'], function (u) {
      if (u.group && startsWithCI(u.group, cfg.CARRY_OVER_PREFIX)) return false;
      var dt = parseLeadingDate(u.text, today);
      return dt && serial(dt) < t;
    });
    if (!unit) return;
    var target = groupAnchor_(doc, 'week', label, null, false, cfg);
    moveUnit_(adapter, doc, unit, target);
    log.push('Carried over "' + unit.text + '" from ' + sectionName_(unit.section, cfg) + '.');
  }
}

/** Moves top-level items dated inside `range` from the source sections into `toSection`. */
function pullForward_(adapter, fromSections, toSection, range, cfg, log) {
  var guard = 0;
  while (guard++ < 500) {
    var doc = analyze(adapter.scan(), cfg);
    if (doc.headings[toSection] == null) return;
    var unit = findUnit_(doc, fromSections, function (u) {
      var dt = parseLeadingDate(u.text, range.start);
      if (!dt) return false;
      var s = serial(dt);
      return s >= serial(range.start) && s <= serial(range.end);
    });
    if (!unit) return;
    var dt = parseLeadingDate(unit.text, range.start);
    var target = pickTargetGroup_(doc, toSection, unit.group, cfg);
    var anchor = groupAnchor_(doc, toSection, target.label, dt, target.create, cfg);
    moveUnit_(adapter, doc, unit, anchor);
    log.push('Moved "' + unit.text + '" from ' + sectionName_(unit.section, cfg) +
      ' to ' + sectionName_(toSection, cfg) + (target.label ? ' (' + target.label + ')' : '') + '.');
  }
}

function ensureRecurringLine_(adapter, section, cfg, log) {
  var doc = analyze(adapter.scan(), cfg);
  if (doc.headings[section] == null) return;
  var want = cfg.RECURRING_LINE.trim().toLowerCase();
  var has = doc.blocks.some(function (b) {
    return b.section === section && b.kind === 'item' && b.text.trim().toLowerCase() === want;
  });
  if (has) return;
  // End of the section, but above any carried-over groups.
  var last = null, listRef = null;
  doc.blocks.forEach(function (b, i) {
    if (b.section !== section || b.kind === 'heading') return;
    if (b.group && startsWithCI(b.group, cfg.CARRY_OVER_PREFIX)) return;
    if (b.kind === 'item') { last = i; listRef = i; }
  });
  if (last == null) last = doc.headings[section];
  adapter.insertItem(last, cfg.RECURRING_LINE, listRef);
  log.push('Added "' + cfg.RECURRING_LINE + '" to ' + sectionName_(section, cfg) + '.');
}

// ---------------------------------------------------------------------------
// Reading the board's structure.
// ---------------------------------------------------------------------------

/**
 * Labels each block with its section, group and kind.
 *   kind: 'heading' | 'label' | 'blank' | 'item' | 'other'
 *   section: 'today' | 'week' | 'month' | 'quarter' | 'year' | null
 *   group: text of the plain-text label above it in its section, or null
 */
function analyze(blocks, cfg) {
  var headings = {};
  var section = null, group = null;
  var out = blocks.map(function (b, i) {
    var text = b.text || '';
    var kind;
    if (b.type === 'heading' && b.level <= 2) {
      section = null;
      group = null;
      Object.keys(cfg.SECTIONS).forEach(function (key) {
        if (section == null && startsWithCI(text.trim(), cfg.SECTIONS[key])) section = key;
      });
      if (section && headings[section] == null) headings[section] = i;
      else if (section) section = null; // a second heading with the same name: leave it alone
      return { kind: 'heading', text: text, section: section, group: null, nesting: 0 };
    }
    if (b.type === 'item') {
      kind = 'item';
    } else if (b.type === 'para' || b.type === 'heading') {
      if (text.trim() === '') kind = 'blank';
      else { kind = 'label'; group = text.trim(); }
    } else {
      kind = 'other';
    }
    return { kind: kind, text: text, section: section, group: group, nesting: b.nesting || 0 };
  });
  return { blocks: out, headings: headings };
}

/** Finds the first top-level item (plus its nested children) that matches. */
function findUnit_(doc, sections, test) {
  var bs = doc.blocks;
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i];
    if (b.kind !== 'item' || sections.indexOf(b.section) < 0) continue;
    if (i > 0 && bs[i - 1].kind === 'item' && bs[i - 1].section === b.section && b.nesting > 0) continue;
    var unit = { start: i, end: i, text: b.text.trim(), section: b.section, group: b.group, nesting: b.nesting };
    var j = i + 1;
    while (j < bs.length && bs[j].kind === 'item' && bs[j].nesting > b.nesting) { unit.end = j; j++; }
    if (test(unit)) return unit;
    i = unit.end;
  }
  return null;
}

/** Decides which group in the target section a pulled item lands in. */
function pickTargetGroup_(doc, section, sourceGroup, cfg) {
  var labels = {};
  var hasLeadingItems = false, hasLabels = false;
  doc.blocks.forEach(function (b) {
    if (b.section !== section) return;
    if (b.kind === 'label' && !startsWithCI(b.group, cfg.CARRY_OVER_PREFIX)) {
      labels[b.group.toLowerCase()] = b.group;
      hasLabels = true;
    }
    if (b.kind === 'item' && b.group == null) hasLeadingItems = true;
  });
  if (sourceGroup && labels[sourceGroup.toLowerCase()]) {
    return { label: labels[sourceGroup.toLowerCase()], create: false };
  }
  if (hasLeadingItems || !hasLabels) return { label: null, create: false };
  var name = sourceGroup || cfg.FALLBACK_GROUP_LABEL;
  if (labels[name.toLowerCase()]) return { label: labels[name.toLowerCase()], create: false };
  return { label: name, create: true };
}

/**
 * Works out where to insert inside a group: after the last top-level item
 * whose date is on or before `date` (or after the last item when `date` is
 * null), otherwise at the top of the group.
 * Returns {anchor, listRef, newLabel, spaced}.
 */
function groupAnchor_(doc, section, label, date, mustCreate, cfg) {
  var bs = doc.blocks;
  var head = doc.headings[section];
  var inGroup = [], labelIdx = null, sectionEnd = head;
  var spaced = false;
  for (var i = head + 1; i < bs.length && bs[i].kind !== 'heading'; i++) {
    sectionEnd = i;
    var b = bs[i];
    if (b.kind === 'label' && i + 1 < bs.length && bs[i + 1].kind === 'blank' && b.section === section) spaced = true;
    if (label == null ? b.group == null : (b.group != null && b.group.toLowerCase() === label.toLowerCase())) {
      if (b.kind === 'label' && labelIdx == null) labelIdx = i;
      inGroup.push(i);
    }
  }
  // Step back over trailing blank lines at the end of the section.
  while (sectionEnd > head && bs[sectionEnd].kind === 'blank') sectionEnd--;

  if (label != null && labelIdx == null) {
    // New group at the end of the section.
    return { anchor: sectionEnd, listRef: null, newLabel: label, spaced: mustCreate ? spaced : false };
  }

  var items = inGroup.filter(function (i) { return bs[i].kind === 'item'; });
  var top = label == null ? head : labelIdx;
  if (label != null && bs[top + 1] && bs[top + 1].kind === 'blank') top = top + 1;
  if (!items.length) return { anchor: top, listRef: null, newLabel: null, spaced: false };

  var listRef = items[0];
  if (date == null) return { anchor: lastOfUnit_(bs, items[items.length - 1]), listRef: listRef, newLabel: null, spaced: false };

  var anchor = top, t = serial(date);
  items.forEach(function (i) {
    if (bs[i].nesting > 0) return;
    var d = parseLeadingDate(bs[i].text, date);
    if (d && serial(d) <= t) anchor = lastOfUnit_(bs, i);
  });
  return { anchor: anchor, listRef: listRef, newLabel: null, spaced: false };
}

function lastOfUnit_(bs, i) {
  var n = bs[i].nesting, j = i;
  while (j + 1 < bs.length && bs[j + 1].kind === 'item' && bs[j + 1].nesting > n) j++;
  return j;
}

function moveUnit_(adapter, doc, unit, target) {
  var anchor = target.anchor, added = 0;
  if (target.newLabel) {
    if (target.spaced) { anchor = adapter.insertPara(anchor, ''); added++; }
    anchor = adapter.insertPara(anchor, target.newLabel); added++;
    if (target.spaced) { anchor = adapter.insertPara(anchor, ''); added++; }
  }
  // New paragraphs above the item push it down.
  var shift = target.anchor < unit.start ? added : 0;
  var idx = [];
  for (var i = unit.start; i <= unit.end; i++) idx.push(i + shift);
  adapter.moveItems(idx, anchor, target.listRef);
}

function sectionName_(key, cfg) { return cfg.SECTIONS[key] || key; }

// ---------------------------------------------------------------------------
// Dates. Plain calendar dates {y, m, d}; m is 1-12. No time zones inside.
// ---------------------------------------------------------------------------

var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function serial(c) { return Math.round(Date.UTC(c.y, c.m - 1, c.d) / 86400000); }
function fromSerial(n) {
  var dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function addDays(c, n) { return fromSerial(serial(c) + n); }
function dow(c) { return new Date(serial(c) * 86400000).getUTCDay(); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoDay(c) { return c.y + '-' + pad2(c.m) + '-' + pad2(c.d); }
function quarterOf(c) { return Math.floor((c.m - 1) / 3) + 1; }
function daysInMonth(y, m) { return fromSerial(serial({ y: m === 12 ? y + 1 : y, m: m === 12 ? 1 : m + 1, d: 1 }) - 1).d; }
function startsWithCI(s, prefix) { return String(s).toLowerCase().indexOf(String(prefix).toLowerCase()) === 0; }

function weekStart(c, startsOn) { return addDays(c, -((dow(c) - startsOn + 7) % 7)); }

function periodRanges(c, cfg) {
  var ws = weekStart(c, cfg.WEEK_STARTS_ON);
  var q = quarterOf(c), qm = (q - 1) * 3 + 1;
  return {
    week: { start: ws, end: addDays(ws, 6) },
    month: { start: { y: c.y, m: c.m, d: 1 }, end: { y: c.y, m: c.m, d: daysInMonth(c.y, c.m) } },
    quarter: { start: { y: c.y, m: qm, d: 1 }, end: { y: c.y, m: qm + 2, d: daysInMonth(c.y, qm + 2) } },
    year: { start: { y: c.y, m: 1, d: 1 }, end: { y: c.y, m: 12, d: 31 } },
  };
}

function periodKeys(c, cfg) {
  return {
    day: isoDay(c),
    week: isoDay(weekStart(c, cfg.WEEK_STARTS_ON)),
    month: c.y + '-' + pad2(c.m),
    quarter: c.y + '-Q' + quarterOf(c),
    year: String(c.y),
  };
}

function formatTitle(template, c, cfg) {
  var ws = weekStart(c, cfg.WEEK_STARTS_ON), we = addDays(ws, 6);
  var q = quarterOf(c);
  var tokens = {
    dow: DOW[dow(c)], mon: MON[c.m - 1], d: c.d,
    startDow: DOW[dow(ws)], startMon: MON[ws.m - 1], startD: ws.d,
    endDow: DOW[dow(we)], endMon: MON[we.m - 1], endD: we.d,
    monthName: MONTH_NAMES[c.m - 1], year: c.y, q: q,
    quarterEndMonthName: MONTH_NAMES[q * 3 - 1],
  };
  return template.replace(/\{(\w+)\}/g, function (all, k) {
    return Object.prototype.hasOwnProperty.call(tokens, k) ? String(tokens[k]) : all;
  });
}

var DATE_RE_ = new RegExp(
  '^\\s*(?:(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?,?\\s+)?' +
  '(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?' +
  '|(\\d{1,2})\\/(\\d{1,2}))' +
  '(?:(?:,\\s*|\\s+)(\\d{4})|\\/(\\d{4}|\\d{2}))?\\s*[:\\-\\u2013\\u2014]', 'i');

/**
 * Reads a date at the very start of an item, followed by a colon or dash:
 *   "Nov 22: ...", "Mon Dec 7: ...", "Thurs Nov 12 - ...", "11/22: ...",
 *   "Jan 5, 2027: ...", "1/5/27: ...". Anything else (including dates mid-sentence) is undated.
 * Without a year, the date closest to `ref` is used, so add the year for
 * dates more than about six months away.
 */
function parseLeadingDate(text, ref) {
  var m = DATE_RE_.exec(String(text || ''));
  if (!m) return null;
  var month, day;
  if (m[1]) {
    month = MON.map(function (s) { return s.toLowerCase(); }).indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    day = parseInt(m[2], 10);
  } else {
    month = parseInt(m[3], 10);
    day = parseInt(m[4], 10);
  }
  if (month < 1 || month > 12) return null;
  var year = null;
  var y = m[5] || m[6];
  if (y) year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  if (year != null) {
    if (day < 1 || day > daysInMonth(year, month)) return null;
    return { y: year, m: month, d: day };
  }
  var best = null, r = serial(ref);
  [ref.y - 1, ref.y, ref.y + 1].forEach(function (y) {
    if (day < 1 || day > daysInMonth(y, month)) return;
    var c = { y: y, m: month, d: day };
    if (!best || Math.abs(serial(c) - r) < Math.abs(serial(best) - r)) best = c;
  });
  return best;
}

function parseIso_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error('Use a date like 2026-11-16');
  return { y: +m[1], m: +m[2], d: +m[3] };
}

// ---------------------------------------------------------------------------
// Adapters: the same small set of edits on the real doc or an in-memory copy.
//   scan() -> [{type: 'heading'|'para'|'item'|'other', level, text, nesting}]
//   setText(i, text)
//   insertPara(afterIndex, text) -> new index
//   insertItem(afterIndex, text, listRefIndex|null) -> new index
//   moveItems(indices, afterIndex, listRefIndex|null)
// ---------------------------------------------------------------------------

function docAdapter_() {
  var doc = CONFIG.DOC_ID ? DocumentApp.openById(CONFIG.DOC_ID) : DocumentApp.getActiveDocument();
  if (!doc) throw new Error('No doc: bind the script to the doc or set CONFIG.DOC_ID.');
  var body = doc.getBody();
  var H = DocumentApp.ParagraphHeading;
  var levels = {};
  levels[H.TITLE] = 1; levels[H.HEADING1] = 1; levels[H.HEADING2] = 2; levels[H.HEADING3] = 3;
  levels[H.HEADING4] = 4; levels[H.HEADING5] = 5; levels[H.HEADING6] = 6; levels[H.SUBTITLE] = 2;

  function ensureNotLast(el) {
    if (body.getChildIndex(el) === body.getNumChildren() - 1) body.appendParagraph('');
  }

  return {
    scan: function () {
      var out = [];
      for (var i = 0; i < body.getNumChildren(); i++) {
        var el = body.getChild(i);
        var type = el.getType();
        if (type === DocumentApp.ElementType.PARAGRAPH) {
          var p = el.asParagraph();
          var h = p.getHeading();
          if (h !== H.NORMAL && levels[h]) out.push({ type: 'heading', level: levels[h], text: p.getText() });
          else out.push({ type: 'para', text: p.getText() });
        } else if (type === DocumentApp.ElementType.LIST_ITEM) {
          var li = el.asListItem();
          out.push({ type: 'item', text: li.getText(), nesting: li.getNestingLevel() });
        } else {
          out.push({ type: 'other', text: '' });
        }
      }
      return out;
    },
    setText: function (i, text) {
      body.getChild(i).asParagraph().setText(text);
    },
    insertPara: function (after, text) {
      var p = body.insertParagraph(after + 1, text);
      p.setHeading(H.NORMAL);
      return after + 1;
    },
    insertItem: function (after, text, listRef) {
      var ref = listRef != null ? body.getChild(listRef).asListItem() : null;
      var li = body.insertListItem(after + 1, text);
      if (ref) li.setListId(ref);
      else li.setGlyphType(DocumentApp.GlyphType.BULLET);
      li.setNestingLevel(0);
      return after + 1;
    },
    moveItems: function (indices, after, listRef) {
      var originals = indices.map(function (i) { return body.getChild(i).asListItem(); });
      var anchor = body.getChild(after);
      var ref = listRef != null ? body.getChild(listRef).asListItem() : null;
      var base = Math.min.apply(null, originals.map(function (li) { return li.getNestingLevel(); }));
      originals.forEach(function (li, k) {
        var copy = body.insertListItem(body.getChildIndex(anchor) + 1 + k, li.copy());
        if (ref) copy.setListId(ref);
        copy.setNestingLevel(li.getNestingLevel() - base);
      });
      originals.forEach(function (li) { ensureNotLast(li); li.removeFromParent(); });
    },
  };
}

/** An in-memory board, used for previews and tests. */
var MemoryAdapter = {
  fromBlocks: function (blocks) {
    var bs = blocks.map(function (b) { return JSON.parse(JSON.stringify(b)); });
    return {
      blocks: bs,
      scan: function () { return bs.map(function (b) { return JSON.parse(JSON.stringify(b)); }); },
      setText: function (i, text) { bs[i].text = text; },
      insertPara: function (after, text) { bs.splice(after + 1, 0, { type: 'para', text: text }); return after + 1; },
      insertItem: function (after, text) { bs.splice(after + 1, 0, { type: 'item', text: text, nesting: 0 }); return after + 1; },
      moveItems: function (indices, after) {
        var moved = indices.map(function (i) { return bs[i]; });
        var base = Math.min.apply(null, moved.map(function (b) { return b.nesting || 0; }));
        var anchorObj = bs[after];
        var copies = moved.map(function (b) {
          var c = JSON.parse(JSON.stringify(b)); c.nesting = (b.nesting || 0) - base; return c;
        });
        var at = bs.indexOf(anchorObj) + 1;
        Array.prototype.splice.apply(bs, [at, 0].concat(copies));
        moved.forEach(function (b) { bs.splice(bs.indexOf(b), 1); });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Apps Script plumbing.
// ---------------------------------------------------------------------------

function todayIn_(tz) {
  return parseIso_(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
}

function loadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state));
}

// Lets the local test harness load this file under Node.
if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG: CONFIG, rollover: rollover, analyze: analyze, MemoryAdapter: MemoryAdapter,
    parseLeadingDate: parseLeadingDate, periodKeys: periodKeys, periodRanges: periodRanges,
    formatTitle: formatTitle, weekStart: weekStart, isoDay: isoDay,
  };
}
