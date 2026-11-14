# Task Board Roller

A small Google Apps Script that keeps a Google Docs task board rolling forward
on its own. It runs inside your Google account on a daily timer, so it needs
no server, no API keys and no AI assistant.

## What it does

Every day (around 4 AM in your time zone) it:

- Re-dates the **Today** heading, e.g. `Today (Mon Nov 16)`.

At the start of each new week, month, quarter and year it also:

- Re-dates that section's heading:
  `This week (Mon Nov 16 to Sun Nov 22)`, `This month (December)`,
  `This quarter (Q1 2027, through March)`, `This year / 2027`.
- **Pulls dated items forward** into the section they now belong to:
  This year → This quarter → This month → This week. An item lands in the
  group with the same label (for example *Classes*), in date order. If the
  section has no such group, a new one is made at the end.
- **Carries over passed items.** Any item whose date is before today is moved
  into a group at the end of This week called
  `Carried over Mon Nov 16 (dates passed; check off, move or drop)`.
  Groups whose label starts with `Carried over` are left alone after that.
- **Files done items.** Items that are ticked or start with `X ` move out of
  This week, This month, This quarter and This year into **Done**, under a
  Heading 3 for the day (`11/16/26`), newest day at the top. The `X ` is
  dropped. Today is left alone, so you can see what you finished today.
- **Adds a recurring line** (optional) to a section when its period rolls over,
  unless the section already has a line with exactly that text.

Every run also turns plain bullets in Today through This year into checklist
items, and anything it adds or moves joins a checklist, so new items keep
their checkboxes.

It never deletes an item, never ticks anything off itself, and never touches
undated items or any section it doesn't recognise. Running it twice in a day
does nothing the second time.

### Checkboxes: one limit to know

Google's APIs can't read whether a checklist box is ticked. Google Docs strikes
a ticked item through by default, and that strikethrough is what the script
sees. So an item counts as done when:

- its box is ticked and its text is struck through (the default), or
- it starts with `X ` (an X and a space), ticked or not.

If you've turned off the strikethrough for ticked items, use the `X ` instead.

## How it reads the board

- **Sections** are Heading 1 or Heading 2 paragraphs whose text starts with
  `Today`, `This week`, `This month`, `This quarter` or `This year`. Anything
  after the name (the dates in brackets) is replaced on rollover.
- **Groups** are plain-text lines inside a section, like `Classes` or `Jobs`.
- **Dated items** are bullets that *start* with a date followed by a colon or
  dash. These all work:

  ```
  Nov 22: Java module 7
  Mon Dec 7: Manuscript slot
  Thurs Nov 12 - Java
  11/22: Call back
  Jan 5, 2028: Far-off plan
  1/5/27: Far-off plan
  ```

  A date in the middle of a line (`was due Nov 2`) doesn't count. Without a
  year, the script uses the nearest such date, so add the year for anything
  more than about six months away.
- Nested bullets under a dated item move with it.
- **Done** is the Heading 1 or 2 called `Done`. Its day headings are Heading 3.

## Install (about five minutes)

1. Open the task board doc, then **Extensions > Apps Script**.
2. Replace the contents of `Code.gs` with this folder's `Code.gs`.
3. Turn on the Google Docs API service, which the checklist step needs:
   click **+** next to **Services**, pick **Google Docs API**, and **Add**.
   (Or, in **Project Settings**, tick *Show "appsscript.json"* and replace it
   with this folder's `appsscript.json`, which already has it.)
4. Check `CONFIG` at the top of `Code.gs` (week start day, time zone,
   recurring line), then **Save**.
5. In the function menu pick **`setupTriggers`** and press **Run**. Google asks
   you to authorize the script to edit the doc; allow it.

That's it. The first run only records today's periods and re-dates Today;
sections start rolling at the next new week, month, quarter or year.

Reload the doc and you'll also see a **Task Board** menu with
*Roll forward now* and *Preview today's roll*.

### Trying it safely

- **`preview`** shows what today's run would change, without changing anything.
- **`previewOn`** shows what a run on another date would change. Edit the
  call to try one, e.g. run it from a scratch function:
  `function tryIt() { previewOn('2026-11-16'); }`
- **`DRY_RUN: true`** in `CONFIG` makes the daily run log its changes
  (View > Executions) without editing the doc.

## Settings

All in `CONFIG` at the top of `Code.gs`:

| Setting | What it does |
| --- | --- |
| `TIME_ZONE` | Decides what "today" is. Default `America/Los_Angeles`. |
| `WEEK_STARTS_ON` | 0 Sunday, 1 Monday (default) ... 6 Saturday. |
| `RUN_HOUR` | Hour of the daily run, 0-23. Run `setupTriggers` again after changing it. |
| `DOC_ID` | Blank for a script bound to the doc. For a standalone script, the doc's id. |
| `DRY_RUN` | `true` logs changes without editing. |
| `SECTIONS` | The heading names it looks for. |
| `TITLES` | The new heading text, with tokens like `{mon} {d}`. |
| `PULL_FORWARD` | Move dated items into nearer sections. |
| `CARRY_OVER_PASSED` | Gather passed items at the end of This week. |
| `CARRY_OVER_LABEL` | The label for that group. |
| `DONE_SWEEP` | When done items move to Done: `rollover` (default, at each new week/month/quarter/year), `daily`, or `off`. |
| `DONE_FROM_SECTIONS` | Sections swept for done items. Today isn't in the list. |
| `DONE_PREFIX_PATTERN` | What counts as an "X" prefix. Default: `X` or `x` and a space. |
| `DONE_LABEL` | Day heading in Done, default `{m}/{d}/{yy}` (11/16/26). |
| `CHECKBOXES` | Keep the rolling sections as checklist items. |
| `RECURRING_LINE` | A line to re-add on rollover, e.g. `Weekly review`. Blank turns it off. |
| `RECURRING_SECTIONS` | Which sections get it: `week`, `month`, `quarter`, `year`. |

## Editing it from anywhere

The Apps Script editor is the simplest place to edit. To keep the code in Git
and push changes from any computer, use Google's
[clasp](https://github.com/google/clasp) command-line tool:

```bash
npm install -g @google/clasp
clasp login                       # once per computer
```

Turn on the Apps Script API once at
<https://script.google.com/home/usersettings>. Then, from this folder:

```bash
cp .clasp.json.example .clasp.json
# Put your script id in .clasp.json. It's in the Apps Script editor under
# Project Settings > IDs > Script ID.
clasp pull      # optional: bring down what's in the editor now
clasp push      # send Code.gs and appsscript.json up
```

`.clasp.json` holds your script id and is git-ignored. `.claspignore` makes
sure only `Code.gs` and `appsscript.json` are pushed.

Changes take effect on the next run; the timer doesn't need to be set again
unless you change `RUN_HOUR`.

## Testing locally

The date and rollover logic runs under Node against an in-memory board:

```bash
node test/run-tests.js
```

## Removing it

- **Pause:** run **`removeTriggers`**, or delete the timer under **Triggers**
  (clock icon) in the Apps Script editor.
- **Remove:** pause it, then delete the code in **Extensions > Apps Script**
  (or delete the whole project from <https://script.google.com>).
- **Revoke access:** <https://myaccount.google.com/permissions>.

Nothing in the doc depends on the script, so removing it leaves the board as
it is.

## Other handy functions

- `rollTaskBoard` runs the roll now (same as the menu item).
- `showState` logs the periods it last rolled to.
- `resetState` forgets them; the next run acts like a first run.

## Moving it to a regular GitHub script

The Apps Script timer is the simplest home for this, but the same job can run
as a scheduled GitHub Actions workflow if you'd rather have everything in
GitHub. Two ways, from least to most change:

**1. Keep the timer in Google, deploy the code from GitHub.** A small workflow
runs `clasp push` whenever `Code.gs` changes on `main`, so GitHub is the
source of truth and the Apps Script project just runs what's there. You store
your clasp login (`~/.clasprc.json`) as a repository secret. Nothing about the
roll itself changes.

**2. Run the roll itself from GitHub Actions.** A workflow on a cron schedule
runs a Node script that edits the doc through the Google Docs API:

1. In a Google Cloud project, turn on the Google Docs API and create a
   service account.
2. Share the Task Board doc with the service account's email as an editor.
3. Give the workflow access, either with a JSON key stored as a secret, or
   (better, no key to leak) with Workload Identity Federation via
   `google-github-actions/auth`.
4. Port the doc edits: the rollover logic (`rollover()` and the date helpers)
   already works on an adapter, so only a new adapter is needed that reads
   the doc with `documents.get` and writes with `documents.batchUpdate`.
   The Docs API works in character ranges rather than paragraphs, so moves
   become delete-and-insert requests, sent from the end of the doc backwards.
   Checklists use `createParagraphBullets` with `BULLET_CHECKBOX`.
5. Keep the last-rolled periods in the repo (a small JSON file the workflow
   commits) or in a Cloud Storage object, in place of Script Properties.

Trade-offs of option 2:

- **More setup and more to look after:** a Cloud project, a service account
  and a secret or identity federation, versus none for Apps Script.
- **More code:** the Docs API adapter is the bulk of the work and has to be
  written and tested.
- **Timing:** Actions cron runs in UTC and can start late at busy times, and
  GitHub turns off scheduled workflows in public repos after 60 days without
  a commit. Apps Script's timer runs in your time zone.
- **Edits show as the service account** in the doc's history, not as you.
- **In its favour:** everything lives in GitHub, runs are logged there, and
  it doesn't depend on an Apps Script project tied to the doc. The same script
  could also run from any computer or another scheduler.

Same limit either way: neither API can read a checklist tick, so the
strikethrough or `X ` rule still applies.

## Why Apps Script

It lives with the doc, runs on Google's timer for free, and edits the doc as
you. A GitHub Action could do the same job (see above), but it would need a
Google service account, a credential and a share on the doc. Apps Script needs
none of that, and clasp still gives you Git history and edits from anywhere.
