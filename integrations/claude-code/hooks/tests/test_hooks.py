"""Tests for recall_hint.py and action_guard.py. Run: python3 -m unittest discover -s tests"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOOKS = HERE.parent
NOTES = HERE / "fixtures" / "notes"


def run(script, payload, **env):
    e = {k: v for k, v in os.environ.items() if not k.startswith("CODE_WIKI_")}
    e.update(env)
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    p = subprocess.run([sys.executable, str(HOOKS / script)], input=raw, capture_output=True,
                       text=True, env=e, timeout=10)
    return p.returncode, p.stdout


class RecallHintTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {"CODE_WIKI_KNOWLEDGE_DIRS": str(NOTES), "CODE_WIKI_RECALL_LOG": "off",
                    "HOME": self.tmp.name}

    def tearDown(self):
        self.tmp.cleanup()

    def test_relevant_note_is_pointed_to(self):
        rc, out = run("recall_hint.py", {"prompt": "I ran netlify deploy --dir=dist and VITE_ values are undefined on the live site"}, **self.env)
        self.assertEqual(rc, 0)
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("example_netlify_deploy_note.md", ctx)
        self.assertNotIn("example_widget_api_403.md", ctx)

    def test_symptom_string_matches(self):
        rc, out = run("recall_hint.py", {"prompt": "Every call fails: 'owner subscription required' from the widget service"}, **self.env)
        self.assertIn("example_widget_api_403.md", json.loads(out)["hookSpecificOutput"]["additionalContext"])

    def test_index_files_skipped(self):
        rc, out = run("recall_hint.py", {"prompt": "netlify widget 403 deploy question about the index"}, **self.env)
        self.assertNotIn("INDEX.md", out)

    def test_short_or_unrelated_prompt_is_silent(self):
        for prompt in ("ok, great", "Please summarize the history of the Roman aqueducts in two paragraphs."):
            rc, out = run("recall_hint.py", {"prompt": prompt}, **self.env)
            self.assertEqual((rc, out), (0, ""))

    def test_prompt_hint_injected_on_match(self):
        env = dict(self.env); env["CODE_WIKI_ACTION_RULES"] = str(HOOKS / "action-rules.example.json")
        rc, out = run("recall_hint.py", {"prompt": "Which of my repos still call the widget service?"}, **env)
        self.assertIn("Routing hint: for questions across projects", json.loads(out)["hookSpecificOutput"]["additionalContext"])
        rc, out = run("recall_hint.py", {"prompt": "Please refactor this function for clarity and speed."}, **env)
        self.assertNotIn("Routing hint", out)

    def test_unconfigured_or_bad_input_is_silent(self):
        env = dict(self.env); env.pop("CODE_WIKI_KNOWLEDGE_DIRS")
        self.assertEqual(run("recall_hint.py", {"prompt": "netlify deploy dist vite"}, **env), (0, ""))
        self.assertEqual(run("recall_hint.py", "not json", **self.env), (0, ""))


class ActionGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {"HOME": self.tmp.name, "CODE_WIKI_KNOWLEDGE_DIRS": str(NOTES),
                    "CODE_WIKI_ACTION_RULES": str(HOOKS / "action-rules.example.json")}

    def tearDown(self):
        self.tmp.cleanup()

    def bash(self, cmd, session="s1"):
        return run("action_guard.py", {"session_id": session, "tool_name": "Bash",
                                       "tool_input": {"command": cmd}}, **self.env)

    def test_matching_command_adds_context_with_note_path(self):
        rc, out = self.bash("npx netlify deploy --prod --dir=dist")
        d = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(d["hookEventName"], "PreToolUse")
        self.assertIn("--no-build", d["additionalContext"])
        self.assertIn("example_netlify_deploy_note.md", d["additionalContext"])
        self.assertNotIn("permissionDecision", d)  # inform only, never block

    def test_unless_suppresses(self):
        self.assertEqual(self.bash("npx netlify deploy --prod --dir=dist --no-build"), (0, ""))

    def test_fires_once_per_session(self):
        self.assertNotEqual(self.bash("netlify deploy --dir=dist", "s2")[1], "")
        self.assertEqual(self.bash("netlify deploy --dir=dist", "s2")[1], "")
        self.assertNotEqual(self.bash("netlify deploy --dir=dist", "s3")[1], "")

    def test_content_and_path_rule(self):
        payload = {"session_id": "s4", "tool_name": "Write",
                   "tool_input": {"file_path": "/tmp/x.py", "content": "import urllib.request\nurllib.request.urlopen(u)"}}
        self.assertIn("certifi", run("action_guard.py", payload, **self.env)[1])
        payload["tool_input"]["file_path"] = "/tmp/x.js"; payload["session_id"] = "s5"
        self.assertEqual(run("action_guard.py", payload, **self.env), (0, ""))

    def test_missing_rules_or_bad_input_is_silent(self):
        env = dict(self.env); env["CODE_WIKI_ACTION_RULES"] = str(Path(self.tmp.name) / "none.json")
        self.assertEqual(run("action_guard.py", {"tool_name": "Bash", "tool_input": {"command": "netlify deploy"}}, **env), (0, ""))
        self.assertEqual(run("action_guard.py", "garbage", **self.env), (0, ""))


class ProjectContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name) / "widget-app"
        (root / "src").mkdir(parents=True)
        (root / "package.json").write_text(json.dumps({"dependencies": {"react": "19", "@google/genai": "1"},
                                                       "devDependencies": {"vite": "6"}}))
        (root / "netlify.toml").write_text("[build]\n")
        (root / "src" / "ai.ts").write_text("const model = 'gemini-2.0-flash'\n")
        (root / "NOTES.md").write_text("old docs mention gemini-1.5-pro\n")
        (root / "src" / "remap.ts").write_text("const RETIRED = { 'gemini-2.0-flash': 'gemini-2.5-flash' }\n")
        (root / "src" / "ai.test.ts").write_text("expect(map('gemini-2.0-flash'))\n")
        (root / ".gitignore").write_text("context.local.md\n")
        for cmd in (["init", "-q"], ["add", "-A"]):
            subprocess.run(["git", "-C", str(root), *cmd], check=True)
        rules = Path(self.tmp.name) / "rules.json"
        rules.write_text(json.dumps({"session_checks": [{"id": "old-model", "pattern": "gemini-(1\\.5|2\\.0)",
                                                          "message": "retired model ids in use",
                                                          "unless_line": "gemini-2\\.5", "exclude": ["*.test.*"],
                                                          "note_file": "example_widget_api_403.md"}]}))
        self.root = root
        self.env = {"HOME": self.tmp.name, "CODE_WIKI_KNOWLEDGE_DIRS": str(NOTES),
                    "CODE_WIKI_TAXONOMY_DIRS": str(HERE / "fixtures" / "projects"),
                    "CODE_WIKI_ACTION_RULES": str(rules)}

    def tearDown(self):
        self.tmp.cleanup()

    def ctx(self, cwd):
        rc, out = run("project_context.py", {"cwd": str(cwd)}, **self.env)
        self.assertEqual(rc, 0)
        return json.loads(out)["hookSpecificOutput"]["additionalContext"] if out else ""

    def test_detects_stack_record_checks_and_notes(self):
        c = self.ctx(self.root / "src")  # subdirectory resolves to the repo root
        self.assertIn("for WidgetApp", c)
        for s in ("react", "vite", "netlify", "gemini-api", "widget-api", "lifecycle: shipped"):
            self.assertIn(s, c)
        self.assertIn("retired model ids in use [src/ai.ts]", c)
        self.assertNotIn("NOTES.md", c)  # markdown is not runtime code
        self.assertNotIn("remap.ts", c)  # unless_line: the line already maps to the replacement
        self.assertNotIn("ai.test.ts", c)  # exclude glob
        self.assertIn("example_widget_app_release.md", c)

    def test_outside_a_repo_is_silent(self):
        outside = Path(self.tmp.name) / "plain"
        outside.mkdir()
        self.assertEqual(self.ctx(outside), "")

    def test_write_only_to_ignored_path(self):
        e = {k: v for k, v in os.environ.items() if not k.startswith("CODE_WIKI_")}
        e.update(self.env)
        cmd = [sys.executable, str(HOOKS / "project_context.py"), "--cwd", str(self.root), "--write"]
        bad = subprocess.run(cmd + [str(self.root / "CONTEXT.md")], capture_output=True, text=True, env=e)
        self.assertEqual(bad.returncode, 1)
        self.assertFalse((self.root / "CONTEXT.md").exists())
        good = subprocess.run(cmd + [str(self.root / "context.local.md")], capture_output=True, text=True, env=e)
        self.assertEqual(good.returncode, 0)
        self.assertIn("WidgetApp", (self.root / "context.local.md").read_text())


if __name__ == "__main__":
    unittest.main()
