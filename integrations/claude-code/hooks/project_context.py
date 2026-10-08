#!/usr/bin/env python3
"""Claude Code SessionStart hook: a short, current briefing about the project you are in.

At session start it identifies the git repository containing `cwd`, then builds a block of
at most ~10 lines from three sources:
  1. Live detection from the repo's own manifests (package.json, netlify.toml, wrangler.*,
     pubspec.yaml, requirements.txt, pyproject.toml, Dockerfile, android/, ios/). Always
     current, needs no maintenance.
  2. The project's taxonomy record, if one exists (markdown with `taxonomy:` frontmatter whose
     `source_repo` or `title` matches the repo), adding facets and relationships.
  3. Session checks: regexes run over the repo's tracked files (git grep, time-boxed), e.g.
     retired model ids, each with a message and an optional note pointer.
Then it adds up to three pointers to knowledge-store notes about this project (scored with
recall_hint's matcher against the project name and detected terms).

Writes no files into any repo. For agents that cannot run hooks, `--write PATH` writes the
block to PATH, but only if git confirms PATH is ignored (fails closed otherwise).

Configuration (environment):
  CODE_WIKI_KNOWLEDGE_DIRS  notes directories (':' or ',' separated)        [optional]
  CODE_WIKI_TAXONOMY_DIRS   directories holding project records              [optional]
  CODE_WIKI_ACTION_RULES    rules file; its "session_checks" list is used
                            (default ~/.config/code-wiki/action-rules.json)  [optional]

CLI:  project_context.py --cwd DIR            print the block
      project_context.py --cwd DIR --write F  write it to F if F is git-ignored
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import recall_hint  # noqa: E402

MAX_NOTES = 3
GREP_TIMEOUT_S = 1.5

# dependency name (regex, matched against package/requirement names) -> label
DEP_LABELS = [
    (r"^react$", "react"), (r"^vite$", "vite"), (r"^typescript$", "typescript"), (r"^next$", "next"),
    (r"^vue$", "vue"), (r"^svelte$|^@sveltejs/kit$", "svelte"), (r"^tailwindcss$", "tailwind"),
    (r"^@capacitor/core$", "capacitor"), (r"^expo$", "expo"), (r"^react-native$", "react-native"),
    (r"^@google/(generative-ai|genai)$|^google-genai$|^google-generativeai$", "gemini-api"),
    (r"^@anthropic-ai/sdk$|^anthropic$", "anthropic-api"), (r"^openai$", "openai-api"),
    (r"^@supabase/supabase-js$|^supabase$", "supabase"), (r"^stripe$", "stripe"),
    (r"^@huggingface/inference$|^huggingface[-_]hub$", "huggingface-api"),
    (r"^ai$|^@ai-sdk/", "vercel-ai-sdk"), (r"^fastapi$", "fastapi"), (r"^flask$", "flask"),
    (r"^@netlify/functions$", "netlify-functions"), (r"^wrangler$", "cloudflare-workers"),
]


def git_root(cwd: str) -> Path | None:
    try:
        out = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=2)
    except (OSError, subprocess.SubprocessError):
        return None
    return Path(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None


def remote_name(root: Path) -> str | None:
    try:
        url = subprocess.run(["git", "-C", str(root), "remote", "get-url", "origin"],
                             capture_output=True, text=True, timeout=2).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"[/:]([^/:]+?)(\.git)?$", url)
    return m.group(1) if m else None


def label_deps(names) -> set[str]:
    labels = set()
    for n in names:
        for pat, label in DEP_LABELS:
            if re.search(pat, n.strip().lower()):
                labels.add(label)
    return labels


def detect(root: Path) -> dict:
    stack, deploy, services, platform = set(), set(), set(), set()
    pj = root / "package.json"
    if pj.is_file():
        try:
            d = json.loads(pj.read_text())
            names = list((d.get("dependencies") or {}).keys()) + list((d.get("devDependencies") or {}).keys())
            stack.add("node")
            labels = label_deps(names)
            for lab in labels:
                (services if lab.endswith("-api") or lab in ("supabase", "stripe") else stack).add(lab)
        except (OSError, ValueError):
            pass
    for req in ("requirements.txt", "pyproject.toml"):
        p = root / req
        if p.is_file():
            stack.add("python")
            try:
                names = re.findall(r"^\s*\"?([A-Za-z0-9_.\-]+)", p.read_text(errors="replace"), re.M)
            except OSError:
                names = []
            for lab in label_deps(names):
                (services if lab.endswith("-api") or lab == "supabase" else stack).add(lab)
    if (root / "pubspec.yaml").is_file():
        stack.add("flutter")
    if (root / "netlify.toml").is_file():
        deploy.add("netlify")
    if any((root / f).is_file() for f in ("wrangler.toml", "wrangler.json", "wrangler.jsonc")):
        deploy.add("cloudflare-workers")
    if (root / "Dockerfile").is_file() or (root / "cloudbuild.yaml").is_file():
        deploy.add("container (Cloud Run?)")
    if any((root / f).exists() for f in ("capacitor.config.ts", "capacitor.config.json")):
        stack.add("capacitor")
    if (root / "android").is_dir():
        platform.add("android")
    if (root / "ios").is_dir():
        platform.add("ios")
    if "cloudflare-workers" in stack:
        stack.discard("cloudflare-workers")
        deploy.add("cloudflare-workers")
    return {"stack": sorted(stack), "deploy": sorted(deploy), "services": sorted(services),
            "platform": sorted(platform)}


def split_dirs(var: str) -> list[Path]:
    out = []
    for part in re.split(r"[:,]", os.environ.get(var, "")):
        part = part.strip()
        if part:
            p = Path(os.path.expanduser(part))
            if p.is_dir():
                out.append(p)
    return out


def find_record(names: set[str]) -> dict | None:
    wanted = {n.lower() for n in names if n}
    for d in split_dirs("CODE_WIKI_TAXONOMY_DIRS"):
        for f in sorted(d.glob("*.md")):
            try:
                text = f.read_text(errors="replace")
            except OSError:
                continue
            if not text.startswith("---") or "taxonomy:" not in text[:3000]:
                continue
            head = text[3:text.find("\n---", 3)]
            m_src = re.search(r"^source_repo:\s*['\"]?([^'\"\n]+)", head, re.M)
            m_title = re.search(r"^title:\s*['\"]?([^'\"\n]+)", head, re.M)
            keys = {(m_src.group(1) if m_src else "").strip().lower(), (m_title.group(1) if m_title else "").strip().lower()}
            if wanted & keys:
                return {"file": f.name, "title": (m_title.group(1).strip() if m_title else f.stem),
                        "facets": parse_taxonomy(head)}
    return None


def parse_taxonomy(head: str) -> dict:
    """Pull list/scalar fields out of the `taxonomy:` block (inline [a, b] or block lists)."""
    block = head.split("taxonomy:", 1)[1]
    facets: dict[str, list[str]] = {}
    key = None
    for line in block.splitlines():
        if line and not line.startswith(" "):
            break  # end of the indented taxonomy block
        m = re.match(r"^\s{2}([A-Za-z]+):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val.startswith("["):
                facets[key] = [v.strip().strip("'\"") for v in val.strip("[]").split(",") if v.strip()]
            elif val:
                facets[key] = [val.strip("'\"")]
            else:
                facets[key] = []
        elif key and re.match(r"^\s{4}-\s+", line):
            facets[key].append(re.sub(r"^\s{4}-\s+", "", line).strip().strip("'\""))
    return facets


def session_checks(root: Path) -> list[str]:
    rules_file = Path(os.path.expanduser(os.environ.get(
        "CODE_WIKI_ACTION_RULES", "~/.config/code-wiki/action-rules.json")))
    try:
        checks = json.loads(rules_file.read_text()).get("session_checks", [])
    except (OSError, ValueError):
        return []
    lines = []
    for c in checks:
        pat, msg = c.get("pattern"), c.get("message")
        if not pat or not msg:
            continue
        try:
            out = subprocess.run(["git", "-C", str(root), "grep", "-I", "-l", "-i", "-E", pat, "--",
                                  ":!*.lock", ":!*lock.json", ":!*.min.js", ":!*.md", ":!dist", ":!build"],
                                 capture_output=True, text=True, timeout=GREP_TIMEOUT_S)
        except (OSError, subprocess.SubprocessError):
            continue
        files = [f for f in out.stdout.splitlines() if f]
        if files:
            shown = ", ".join(files[:3]) + (f" (+{len(files) - 3} more)" if len(files) > 3 else "")
            line = f"⚠ {msg} [{shown}]"
            if c.get("note_file"):
                p = next((str(d / c["note_file"]) for d in split_dirs("CODE_WIKI_KNOWLEDGE_DIRS")
                          if (d / c["note_file"]).is_file()), None)
                if p:
                    line += f" (details: {p})"
            lines.append(line)
    return lines


def note_pointers(names: set[str], terms: list[str]) -> list[str]:
    dirs = recall_hint.knowledge_dirs()
    if not dirs:
        return []
    notes = recall_hint.load_notes(dirs)
    name_tokens = set()
    for n in names:
        name_tokens |= {t for t in recall_hint.tokens(n) if len(t) >= 5}
    if not name_tokens:
        return []
    term_tokens = recall_hint.tokens(" ".join(terms))
    ranked = []
    for note in notes:
        name_hits = len(name_tokens & note["name_tokens"]) * 2 + len(name_tokens & note["tokens"])
        if name_hits:  # only notes that name this project; generic platform notes are other hooks' job
            ranked.append((name_hits, len(term_tokens & note["tokens"]), note))
    ranked.sort(key=lambda x: (-x[0], -x[1], x[2]["file"]))
    out = []
    for _, _, n in ranked[:MAX_NOTES]:
        desc = re.sub(r"^#+\s*", "", n["desc"]).replace(" ## ", " · ").replace(" # ", " · ")
        desc = desc if len(desc) <= 120 else desc[:119].rstrip() + "…"
        out.append(f"- {n['path']} — {desc}")
    return out


def build(cwd: str) -> str:
    root = git_root(cwd)
    if not root:
        return ""
    names = {root.name}
    rn = remote_name(root)
    if rn:
        names.add(rn)
    det = detect(root)
    rec = find_record(names)
    if rec:
        names.add(rec["title"])
    title = rec["title"] if rec else (rn or root.name)
    parts = []
    if det["stack"]:
        parts.append("stack: " + ", ".join(det["stack"]))
    if det["platform"]:
        parts.append("platform: " + ", ".join(det["platform"]))
    if det["deploy"]:
        parts.append("deploy: " + ", ".join(det["deploy"]))
    services = set(det["services"])
    if rec:
        services |= set(rec["facets"].get("dependsOn", []))
    services = {s for s in services if f"{s}-api" not in services}
    if services:
        parts.append("services: " + ", ".join(sorted(services)))
    lines = [f"Project context (code-wiki) for {title}" + (f" — {'; '.join(parts)}" if parts else "")]
    if rec:
        f = rec["facets"]
        extra = [f"{k}: {', '.join(v)}" for k, v in f.items()
                 if k in ("lifecycle", "completionState", "domain", "related", "usesModule") and v]
        if extra:
            lines.append("Taxonomy record: " + "; ".join(extra))
    lines += session_checks(root)
    terms = det["stack"] + det["deploy"] + sorted(services)
    lines += note_pointers(names, terms)
    if len(lines) == 1 and not parts:
        return ""
    return "\n".join(lines)


def write_ignored(text: str, dest: str) -> int:
    p = Path(dest).resolve()
    root = git_root(str(p.parent))
    if root:
        ok = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", str(p)]).returncode == 0
        if not ok:
            print(f"refusing to write {p}: not ignored by git in {root}", file=sys.stderr)
            return 1
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(text + "\n")
    os.replace(tmp, p)
    return 0


def main() -> int:
    args = sys.argv[1:]
    if "--cwd" in args:
        cwd = args[args.index("--cwd") + 1]
        text = build(cwd)
        if "--write" in args:
            return write_ignored(text, args[args.index("--write") + 1])
        print(text)
        return 0
    try:
        payload = json.load(sys.stdin)
        text = build(str(payload.get("cwd") or os.getcwd()))
        if text:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                                     "additionalContext": text}}))
    except Exception:  # never interfere with session start
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
