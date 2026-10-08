#!/usr/bin/env python3
"""Report which knowledge notes need re-verification.

A note is *volatile* when its text carries facts that rot: prices, model ids, quotas, "as of"
statements, policy dates. Volatile notes should carry `verified: YYYY-MM-DD` frontmatter. This
lists volatile notes that have no `verified:` date, and notes whose date is older than the limit.

Usage:
  knowledge_freshness.py [--days 90] [--out FILE]      (dirs from CODE_WIKI_KNOWLEDGE_DIRS)

Read-only. Intended for a monthly local schedule; the report is for a human or an agent to act on.
"""
from __future__ import annotations

import datetime as dt
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "hooks"))
import recall_hint  # noqa: E402  (shared note loading / frontmatter parsing)

# Categories of fact that rot. A note is flagged only when it hits at least two categories, which
# keeps durable lessons that merely mention a price or a rate limit out of the report.
CATEGORIES = {
    "provider pricing": re.compile(r"per 1M|/1M|/MTok|\$[0-9.]+ ?/ ?(mo|month|request|1k)|\bpricing\b", re.I),
    "model ids": re.compile(r"\b(gpt|claude|gemini|grok|deepseek|llama|sonar|o[134])-[0-9a-z]", re.I),
    "quotas / tiers": re.compile(r"\bquota\b|\bfree tier\b|\brate limit|\bpaid tier\b|\bplan\b.*\$", re.I),
    "retirements": re.compile(r"\bretired\b|\bdeprecat|\bdiscontinued\b|\bsunset\b", re.I),
    "as-of facts": re.compile(r"\bas of (19|20)\d\d|\bcurrent(ly)? (price|limit|model|default)", re.I),
}
MIN_CATEGORIES = 2


def main() -> int:
    args = sys.argv[1:]
    days = int(args[args.index("--days") + 1]) if "--days" in args else 90
    out = args[args.index("--out") + 1] if "--out" in args else None
    today = dt.date.today()
    unverified, overdue, ok = [], [], 0
    for d in recall_hint.knowledge_dirs():
        for f in sorted(d.glob("*.md")):
            if f.stem.upper() == f.stem:
                continue
            try:
                text = f.read_text(errors="replace")
            except OSError:
                continue
            meta = recall_hint.parse_frontmatter(text[:4000])
            verified = str(meta.get("verified") or "")
            if verified:
                try:
                    age = (today - dt.date.fromisoformat(verified[:10])).days
                except ValueError:
                    age = None
                if age is not None and age > days:
                    overdue.append((age, f.name))
                else:
                    ok += 1
            else:
                cats = [name for name, rx in CATEGORIES.items() if rx.search(text)]
                if len(cats) >= MIN_CATEGORIES:
                    unverified.append((f.name, ", ".join(cats)))
    lines = [f"Knowledge freshness report, {today} (limit {days} days)",
             f"verified and current: {ok} | overdue: {len(overdue)} | volatile without `verified:`: {len(unverified)}", ""]
    if overdue:
        lines.append("## Overdue (re-check, then update `verified:`)")
        lines += [f"- {name} — verified {age} days ago" for age, name in sorted(overdue, reverse=True)]
        lines.append("")
    if unverified:
        lines.append("## Volatile, never verified (check, then add `verified: YYYY-MM-DD`)")
        lines += [f"- {name} — signals: {hits}" for name, hits in unverified]
    report = "\n".join(lines) + "\n"
    if out:
        tmp = Path(out).with_suffix(".tmp")
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(report)
        os.replace(tmp, out)
    else:
        sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
