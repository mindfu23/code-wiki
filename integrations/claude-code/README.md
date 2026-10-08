# Claude Code hooks: surface your own notes at the right moment

Two dependency-free Python hooks that put relevant notes from a local knowledge store (any folder of
markdown notes with frontmatter, e.g. an agent-memory folder or wiki notes) in front of Claude Code
**when they apply**, instead of hoping the model goes looking for them.

| Hook | Event | What it does |
|---|---|---|
| `hooks/recall_hint.py` | `UserPromptSubmit` | Scores notes against the prompt; injects up to 3 one-line **pointers** (path + description) above a threshold. ~60 tokens per hit, nothing when nothing matches. |
| `hooks/project_context.py` | `SessionStart` | A briefing of up to ~10 lines on the repo you're in: stack, platforms, deploy targets and services **detected live from its manifests**, facets from its taxonomy record (if any), warnings from `session_checks` (e.g. retired model ids found by `git grep` in tracked, non-markdown files), and up to 3 notes that name the project. Writes nothing into the repo. |
| `hooks/action_guard.py` | `PreToolUse` | Matches the tool call (Bash command, file path, written content) against your rules; adds a one-line gotcha plus a pointer. Inform-only: never blocks or edits the call. Each rule fires once per session. |

Both are fail-safe: missing config, bad input or any error results in no output and exit status 0.

## Why pointers, not content

Measured on a ~300-note store: when the answer sat in a note, the model often never opened the index
that would have led it there. A pointer injected at prompt time fixed that at a fraction of the cost of
searching: on two benchmark tasks, correct answers with roughly half the tokens of the same setup without
the hook.

## Note format

```markdown
---
name: short-slug
description: "One line that says what the note is about — this is what gets matched and shown"
symptoms: ["literal error string", "another exact phrase"]   # optional, strongly weighted
---
Body (not read by the hooks).
```

Files whose name is all upper case (`INDEX.md`, `README.md`) are skipped. `symptoms` is the most
effective lever: put the exact error text you would paste into a prompt.

## Setup

1. Rules for the action guard: copy `hooks/action-rules.example.json` to
   `~/.config/code-wiki/action-rules.json` and edit (keep it out of any repo).
2. Register the hooks in `~/.claude/settings.json` (user settings, not a project file). The guard against a
   missing script matters: a hook exiting with status 2 blocks the prompt.

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "timeout": 5,
      "command": "f=\"$HOME/path/to/code-wiki/integrations/claude-code/hooks/recall_hint.py\"; [ -f \"$f\" ] || exit 0; CODE_WIKI_KNOWLEDGE_DIRS=\"$HOME/path/to/notes\" /usr/bin/env python3 \"$f\" || true" }] }],
    "PreToolUse": [{ "matcher": "Bash|Write|Edit|MultiEdit", "hooks": [{ "type": "command", "timeout": 5,
      "command": "f=\"$HOME/path/to/code-wiki/integrations/claude-code/hooks/action_guard.py\"; [ -f \"$f\" ] || exit 0; CODE_WIKI_KNOWLEDGE_DIRS=\"$HOME/path/to/notes\" /usr/bin/env python3 \"$f\" || true" }] }]
  }
}
```

   Add `project_context.py` as a `SessionStart` hook the same way (no matcher; set
   `CODE_WIKI_TAXONOMY_DIRS` as well if you have project records).
3. Calibrate against your own notes:

```bash
CODE_WIKI_KNOWLEDGE_DIRS=~/path/to/notes python3 hooks/recall_hint.py --query "paste a real error or question"
```

For agents that can't run hooks, `project_context.py --cwd DIR --write FILE` writes the same briefing to
FILE, but only if git confirms FILE is ignored. Otherwise it refuses and exits 1.

`session_checks` live in the same rules file as the action guard:

```json
{ "session_checks": [
  { "id": "retired-model", "pattern": "old-model-(1\\.0|1\\.5)", "message": "retired model ids in use", "note_file": "optional_note.md" }
] }
```

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `CODE_WIKI_KNOWLEDGE_DIRS` | both | unset → hooks do nothing. `:` or `,` separated, `~` expanded |
| `CODE_WIKI_RECALL_MIN_SCORE` | recall | scales with note count (≈9 at 300 notes) |
| `CODE_WIKI_RECALL_LOG` | recall | `~/.cache/code-wiki/recall-hits-<host>.jsonl`; `off` disables |
| `CODE_WIKI_ACTION_RULES` | guard, context | `~/.config/code-wiki/action-rules.json` |
| `CODE_WIKI_TAXONOMY_DIRS` | context | unset → no taxonomy record lookup. Directories of project records (`taxonomy:` frontmatter) |

Logs, caches and per-session state live under `~/.cache/code-wiki/`, named per host, so a folder synced
between machines never shares them.

## Privacy

Everything the hooks read or write is local. Keep your notes folder, rules file and settings out of
any git repository; this directory contains only generic code, fake-content fixtures and examples.

## Tests

```bash
cd integrations/claude-code/hooks && python3 -m unittest discover -s tests
```
