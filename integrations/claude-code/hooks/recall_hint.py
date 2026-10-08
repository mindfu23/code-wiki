#!/usr/bin/env python3
"""Claude Code UserPromptSubmit hook: point the model at relevant notes before it starts.

Scores each note in the configured knowledge directories against the prompt and, when a
note clears the threshold, injects up to three one-line pointers ("read this first").
It injects pointers, not content, so the cost stays at roughly 60 tokens per hit.

Configuration (environment, e.g. the `env` block of your Claude Code settings):
  CODE_WIKI_KNOWLEDGE_DIRS   directories of markdown notes, separated by ':' or ','.
                             `~` is expanded. Unset or empty -> the hook does nothing.
  CODE_WIKI_RECALL_MIN_SCORE optional score threshold. Default scales with the number of
                             notes (about 9 at 300 notes); calibrate with --query.
  CODE_WIKI_RECALL_LOG       optional JSONL hit log path, or "off".
                             Default: ~/.cache/code-wiki/recall-hits-<host>.jsonl

A note is any `*.md` file with YAML-style frontmatter. Fields used: `name`,
`description`, optional `symptoms` (literal error strings, as an inline list or a
block list). Files whose stem is all upper case (index files such as INDEX.md) are skipped.

Fail-safe: any error, missing configuration or slow filesystem results in no output and
exit status 0, so the prompt is never blocked.

CLI for testing:  recall_hint.py --query "text"   (prints the scored hits)
"""
from __future__ import annotations

import json
import math
import os
import re
import socket
import sys
import time
from pathlib import Path

MAX_HITS = 3
RELATIVE_CUTOFF = 0.6  # later hits must score at least this fraction of the top hit
DESC_CHARS = 150
MIN_PROMPT_CHARS = 15
MAX_PROMPT_CHARS = 6000

STOPWORDS = set("""
about above after again against all also always among another any anything are around because been
before being below between both but can cannot could did does doing done down during each either
else even every few find first from further get gets getting give going good had has have having
here how however into its itself just keep know last later least less like look looks made make
many may maybe might more most much must need needs never new next not now off once one only other
our out over own please quite rather really right same see seem seems should show since some
something still such sure take than that the their them then there these they thing things this
those though through thus too try trying under until upon use used uses using very want wants was
way well were what when where whether which while who whom why will with within without would yes
yet you your able added adding also across already another back based best better both came come
does done else ever fine found gave given goes gone great half help here high hold idea into just
keep kind left line long lots main mean meant mind mine move name near note okay open part past
plan point read real said says seen self sent sets side sort start stay step stop sure tell tells
test than them time told took turn type uses view want week went whole wide work works year
file files code app apps project projects issue issues problem problems error errors work working
update updates updated change changes changed version versions local standard keys current status level
place green form account missing needed source general reference category tools patterns learned
stopped testing additions unique option options feature features summary information details
""".split())

TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9._+-]*[a-z0-9]|[a-z0-9]")


def tokens(text: str) -> set[str]:
    out = set()
    for raw in TOKEN_RE.findall(text.lower()):
        for t in {raw, *re.split(r"[._+-]", raw)}:
            if not t or t in STOPWORDS:
                continue
            has_digit = any(c.isdigit() for c in t)
            if t.isdigit() and len(t) < 3:
                continue
            if len(t) >= 4 or (has_digit and len(t) >= 3):
                out.add(t)
    return out


def parse_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    meta: dict = {}
    key = None
    for line in text[3:end].splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                meta[key] = [v.strip().strip("'\"") for v in val[1:-1].split(",") if v.strip()]
            else:
                meta[key] = val.strip("'\"")
        elif key and re.match(r"^\s+-\s+", line):
            item = re.sub(r"^\s+-\s+", "", line).strip().strip("'\"")
            if not isinstance(meta.get(key), list):
                meta[key] = []
            meta[key].append(item)
    return meta


def knowledge_dirs() -> list[Path]:
    raw = os.environ.get("CODE_WIKI_KNOWLEDGE_DIRS", "")
    dirs = []
    for part in re.split(r"[:,]", raw):
        part = part.strip()
        if part:
            p = Path(os.path.expanduser(os.path.expandvars(part)))
            if p.is_dir():
                dirs.append(p)
    return dirs


def load_notes(dirs: list[Path]) -> list[dict]:
    notes = []
    for d in dirs:
        for f in sorted(d.glob("*.md")):
            if f.stem.upper() == f.stem:  # INDEX.md, MEMORY.md, ARCHIVE.md, README.md
                continue
            try:
                head = f.read_text(encoding="utf-8", errors="replace")[:4000]
            except OSError:
                continue
            meta = parse_frontmatter(head)
            desc = str(meta.get("description") or "")
            if not desc:
                body = head.split("\n---", 2)[-1] if head.startswith("---") else head
                desc = " ".join(body.split())[:200]
            symptoms = meta.get("symptoms") or []
            if isinstance(symptoms, str):
                symptoms = [symptoms]
            stem_words = f.stem.replace("_", " ").replace("-", " ")
            name = str(meta.get("name") or "")
            notes.append({
                "path": str(f),
                "file": f.name,
                "desc": desc,
                "symptoms": [s for s in symptoms if s],
                # Filename and name words count double: they are the most deliberate labels.
                "tokens": tokens(f"{stem_words} {stem_words} {name} {desc} {' '.join(symptoms)}"),
                "name_tokens": tokens(f"{stem_words} {name}"),
            })
    return notes


def score(prompt: str, notes: list[dict]) -> list[tuple[float, dict, list[str]]]:
    p_tokens = tokens(prompt)
    if not p_tokens or not notes:
        return []
    n = len(notes)
    df: dict[str, int] = {}
    for note in notes:
        for t in note["tokens"]:
            df[t] = df.get(t, 0) + 1
    p_lower = prompt.lower()
    scored = []
    for note in notes:
        matched = sorted(p_tokens & note["tokens"])
        s = 0.0
        for t in matched:
            idf = math.log((n + 1) / (df[t] + 0.5))
            s += idf * (1.5 if t in note["name_tokens"] else 1.0)
        sym = [x for x in note["symptoms"] if len(x) >= 4 and x.lower() in p_lower]
        s += 12.0 * len(sym)
        if len(matched) >= 2 or sym:
            scored.append((round(s, 2), note, matched + [f'"{x}"' for x in sym]))
    scored.sort(key=lambda x: -x[0])
    return scored


def log_hits(prompt: str, hits, elapsed_ms: float) -> None:
    dest = os.environ.get("CODE_WIKI_RECALL_LOG", "")
    if dest.lower() == "off":
        return
    if not dest:
        dest = os.path.expanduser(f"~/.cache/code-wiki/recall-hits-{socket.gethostname().split('.')[0]}.jsonl")
    try:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "ms": round(elapsed_ms, 1),
               "prompt_chars": len(prompt),
               "hits": [{"file": h[1]["file"], "score": h[0], "matched": h[2]} for h in hits]}
        with open(dest, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
    except OSError:
        pass


def threshold_for(n_notes: int) -> float:
    """Scores grow with corpus size (IDF), so the default threshold scales with it:
    about 9 for a ~300-note store, lower for small ones. An explicit setting wins."""
    explicit = os.environ.get("CODE_WIKI_RECALL_MIN_SCORE")
    if explicit:
        return float(explicit)
    return max(1.5, 9.0 * math.log(n_notes + 1) / math.log(301))


def recall(prompt: str) -> list:
    dirs = knowledge_dirs()
    if not dirs or len(prompt.strip()) < MIN_PROMPT_CHARS:
        return []
    notes = load_notes(dirs)
    hits = [h for h in score(prompt[:MAX_PROMPT_CHARS], notes) if h[0] >= threshold_for(len(notes))]
    if hits:
        top = hits[0][0]
        hits = [h for h in hits if h[0] >= RELATIVE_CUTOFF * top]
    return hits[:MAX_HITS]


def format_context(hits) -> str:
    lines = ["Possibly relevant notes from the local knowledge store (read before acting if they apply):"]
    for _, note, _ in hits:
        desc = note["desc"]
        if len(desc) > DESC_CHARS:
            desc = desc[: DESC_CHARS - 1].rstrip() + "…"
        lines.append(f"- {note['path']} — {desc}")
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--query":
        q = " ".join(sys.argv[2:])
        for s, note, matched in score(q, load_notes(knowledge_dirs()))[:8]:
            print(f"{s:6.2f}  {note['file']}  {matched}")
        return 0
    start = time.monotonic()
    try:
        payload = json.load(sys.stdin)
        prompt = str(payload.get("prompt") or "")
        hits = recall(prompt)
        elapsed = (time.monotonic() - start) * 1000
        if os.environ.get("CODE_WIKI_KNOWLEDGE_DIRS"):
            log_hits(prompt, hits, elapsed)
        if hits:
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": format_context(hits)}}))
    except Exception:  # never block the prompt
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
