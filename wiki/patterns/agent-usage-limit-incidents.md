---
title: "Agent pipeline usage-limit incidents (usage-guard)"
tags: ["agents", "usage-limits", "claude-code", "codex", "pipelines", "error-handling"]
language: "python"
updated: "2026-10-22"
source_repo: "generic_modules"
description: "Unattended agent pipelines stop on a subscription usage limit, write an incident note with spend diagnostics, and refuse to resume until it is diagnosed"
---

# Agent pipeline usage-limit incidents

**Module:** `generic_modules/usage-guard/` (`usage_guard.py`, `hook.py`, `README.md`). Python stdlib only.

**Use it for:** any unattended pipeline that runs on a subscription limit (Claude Code `claude -p`, Codex
`codex exec`, API scripts), especially if it shares the limit with interactive use.

## Why

A pipeline that *waits* out a usage limit keeps refilling the shared 5-hour window as soon as it resets. That
locks the user out of interactive agent use, and nobody learns why the window ran out. Stopping and leaving a note
makes the overrun something to diagnose, not something that happens silently.

## Pattern

1. Record every model call: `record_call(source, project, step, model, cost_usd, in, out)` appends to the
   shared ledger `~/.claude/usage-guard/ledger.jsonl`.
2. On a limit error (`looks_like_limit(text)`), call `incident(...)`. It writes
   `<project>/run-logs/INCIDENT-<stamp>.md` with spend by model, process and project, the running agent
   processes, the last 20 calls, and blank Diagnosis and Resolution sections.
3. Raise `UsageLimitStop(path)`. It subclasses `BaseException`, so `except Exception` retry loops can't swallow
   it. Exit cleanly from the top level.
4. Gate restarts: `gate(project_dir)` raises `IncidentOpen` until the note says `Status: resolved`. Override
   with a `--resume-after-incident` flag.
5. Surface incidents to the agent. For Claude Code, the UserPromptSubmit hook `hook.py` is installed in
   `~/.claude/settings.json`. Other agents run `python usage_guard.py list` at session start.

## Agents without the hook (Copilot, Codex, Cursor, Gastown, …)

- Before resuming any long-running pipeline, run
  `python ~/Documents/visual-studio-code/github-copilot/generic_modules/usage-guard/usage_guard.py list`.
- If an incident is open, read the note and fill in its Diagnosis. Then run `usage_guard.py resolve <note> "…"`.
- Use `usage_guard.py snapshot 5` to see recent pipeline spend by model and process.

## Gotchas

- The ledger sees only pipelines that call `record_call`. Interactive use and other tools are invisible to it,
  so a small ledger total in the note points to *outside* use.
- Long-running processes hold old module code. Restart them after enabling `on_usage_limit: stop`.
- Match the limit text loosely. CLIs report limits in JSON `result` fields with a non-zero exit, and some fail
  with zero tokens and no message at all.

First user: novelist (`antigravity-and-others/novel-editing-tools/novelist`, `run.on_usage_limit: stop`).
