#!/usr/bin/env python3
"""Claude Code PreToolUse hook: surface a known gotcha right before the action that triggers it.

Rules come from a local JSON file. Each rule matches a tool call (by tool name, command
text, file path or written content) and, on a match, adds a short note plus a pointer to
the relevant knowledge-store note. The hook informs; it never blocks or changes the call.
Each rule fires at most once per session, so the note is not repeated on every edit.

Configuration (environment):
  CODE_WIKI_ACTION_RULES     rules file; default ~/.config/code-wiki/action-rules.json
  CODE_WIKI_KNOWLEDGE_DIRS   directories searched for a rule's "note_file" (':' or ',' separated)

Rule fields (all regexes are Python `re`, case-insensitive):
  id            unique id (required)
  tools         regex on the tool name, e.g. "^Bash$" or "^(Write|Edit|MultiEdit)$" (required)
  command       regex that must match Bash `command`
  path          regex that must match the file path being written/edited
  content       regex that must match the text being written (Write content / Edit new_string)
  unless        regex; if it matches the same text (command or content), the rule does not fire
  message       one-line note shown to the model (required)
  note_file     optional file name to point at, resolved in CODE_WIKI_KNOWLEDGE_DIRS

See action-rules.example.json. Fail-safe: any error -> no output, exit 0.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path


def rules_path() -> Path:
    return Path(os.path.expanduser(os.environ.get(
        "CODE_WIKI_ACTION_RULES", "~/.config/code-wiki/action-rules.json")))


def resolve_note(name: str) -> str | None:
    for part in re.split(r"[:,]", os.environ.get("CODE_WIKI_KNOWLEDGE_DIRS", "")):
        part = part.strip()
        if part:
            p = Path(os.path.expanduser(part)) / name
            if p.is_file():
                return str(p)
    return None


def written_text(tool_input: dict) -> str:
    parts = [str(tool_input.get("content") or ""), str(tool_input.get("new_string") or "")]
    for e in tool_input.get("edits") or []:
        if isinstance(e, dict):
            parts.append(str(e.get("new_string") or ""))
    return "\n".join(p for p in parts if p)


def matches(rule: dict, tool_name: str, tool_input: dict) -> bool:
    flags = re.IGNORECASE
    if not re.search(rule["tools"], tool_name, flags):
        return False
    command = str(tool_input.get("command") or "")
    path = str(tool_input.get("file_path") or tool_input.get("notebook_path") or "")
    text = written_text(tool_input)
    if "command" in rule and not re.search(rule["command"], command, flags):
        return False
    if "path" in rule and not re.search(rule["path"], path, flags):
        return False
    if "content" in rule and not re.search(rule["content"], text, flags):
        return False
    if "unless" in rule and re.search(rule["unless"], command or text, flags):
        return False
    return True


def seen_file(session_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", session_id)[:64] or "nosession"
    return Path(os.path.expanduser(f"~/.cache/code-wiki/guard-seen/{safe}.json"))


def evaluate(payload: dict, rules: list[dict]) -> tuple[list[str], list[str]]:
    tool_name = str(payload.get("tool_name") or "")
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return [], []
    sf = seen_file(str(payload.get("session_id") or ""))
    try:
        seen = set(json.loads(sf.read_text()))
    except (OSError, ValueError):
        seen = set()
    notes, fired = [], []
    for rule in rules:
        rid = rule.get("id")
        if not rid or rid in seen or "tools" not in rule or "message" not in rule:
            continue
        try:
            if not matches(rule, tool_name, tool_input):
                continue
        except re.error:
            continue
        line = f"- {rule['message']}"
        if rule.get("note_file"):
            p = resolve_note(rule["note_file"])
            if p:
                line += f" (details: {p})"
        notes.append(line)
        fired.append(rid)
    if fired:
        try:
            sf.parent.mkdir(parents=True, exist_ok=True)
            tmp = sf.with_suffix(".tmp")
            tmp.write_text(json.dumps(sorted(seen | set(fired))))
            os.replace(tmp, sf)
        except OSError:
            pass
    return notes, fired


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        rp = rules_path()
        if not rp.is_file():
            return 0
        rules = json.loads(rp.read_text()).get("rules", [])
        notes, fired = evaluate(payload, rules)
        if notes:
            context = "Known gotcha for this action, from the local knowledge store:\n" + "\n".join(notes)
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": context}}))
            log = Path(os.path.expanduser("~/.cache/code-wiki/guard-hits.jsonl"))
            try:
                log.parent.mkdir(parents=True, exist_ok=True)
                with open(log, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                         "tool": payload.get("tool_name"), "rules": fired}) + "\n")
            except OSError:
                pass
    except Exception:  # never interfere with the tool call
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
