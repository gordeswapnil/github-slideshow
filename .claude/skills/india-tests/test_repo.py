"""Pack-wide rules for the India skills."""
import json
import os
import re
import subprocess
import sys
import unittest

from _load import HERE, ROOT

SKILLS = ["india-scanner", "india-news", "india-entry", "india-exit", "india-timemachine",
          "india-risk", "india-budget", "india-broker", "india-alerts", "india-analyst",
          "india-insider"]
# skills on the way to an order carry the safety block
ORDER_PATH = ["india-scanner", "india-entry", "india-exit", "india-timemachine", "india-budget",
              "india-insider", "india-risk", "india-broker", "india-alerts"]
US_WORDS = ("New York", "NYSE", "Nasdaq Trader", "EDGAR", "Alpaca", "Pelosi", "pdt_guard",
            "_usd", "trader/")


def frontmatter(path):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    return (m.group(1) if m else ""), text


def pack_files():
    for s in SKILLS + ["india-tests"]:
        base_dir = os.path.join(ROOT, s)
        for base, dirs, files in os.walk(base_dir):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for f in files:
                if f.endswith((".md", ".py", ".json", ".csv", ".txt", ".xml")):
                    yield os.path.join(base, f)


class Pack(unittest.TestCase):
    def test_eleven_india_skills(self):
        found = sorted(d for d in os.listdir(ROOT)
                       if d.startswith("india-") and os.path.isfile(os.path.join(ROOT, d, "SKILL.md")))
        self.assertEqual(found, sorted(SKILLS))

    def test_frontmatter(self):
        for s in SKILLS:
            fm, text = frontmatter(os.path.join(ROOT, s, "SKILL.md"))
            self.assertIn("name: %s\n" % s, fm + "\n", s)
            self.assertRegex(fm, r"description: ", s)
            self.assertGreater(len(fm), 200, "%s description is too thin" % s)
            self.assertGreater(len(text.splitlines()), 50, s)
            self.assertRegex(fm, r"(?i)\b(nse|india|indian)\b", s)

    def test_order_path_skills_carry_the_safety_rule(self):
        for s in ORDER_PATH:
            _, text = frontmatter(os.path.join(ROOT, s, "SKILL.md"))
            low = " ".join(text.lower().split())
            self.assertIn("not financial advice", low, s)
            self.assertIn("71%", low, s)
            self.assertIn("static ip", low, s)
            self.assertIn("yes", low, s)

    def test_every_script_embeds_the_same_core(self):
        out = subprocess.run([sys.executable, os.path.join(HERE, "sync_core.py"), "--check"],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stdout)
        for s in SKILLS:
            scripts = [f for f in os.listdir(os.path.join(ROOT, s)) if f.endswith(".py")]
            self.assertTrue(scripts, s)
            for f in scripts:
                with open(os.path.join(ROOT, s, f), encoding="utf-8") as fh:
                    self.assertIn("# --- india core: begin", fh.read(), "%s/%s" % (s, f))

    def test_no_us_leftovers_in_the_skills(self):
        for s in SKILLS:
            for f in os.listdir(os.path.join(ROOT, s)):
                path = os.path.join(ROOT, s, f)
                if not os.path.isfile(path):
                    continue
                with open(path, encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
                for w in US_WORDS:
                    self.assertNotIn(w, text, "%s/%s mentions %r" % (s, f, w))

    def test_no_em_dashes(self):
        for path in pack_files():
            with open(path, encoding="utf-8", errors="replace") as fh:
                self.assertNotIn(chr(0x2014), fh.read(), os.path.relpath(path, ROOT))

    def test_every_tool_runs_on_python_3_8(self):
        for s in SKILLS:
            folder = os.path.join(ROOT, s)
            for f in os.listdir(folder):
                if not f.endswith(".py"):
                    continue
                with open(os.path.join(folder, f), encoding="utf-8") as fh:
                    src = fh.read()
                where = "%s/%s" % (s, f)
                for bad in ("import zoneinfo", "from zoneinfo", ".removeprefix(", ".removesuffix("):
                    self.assertNotIn(bad, src, where)
                self.assertNotRegex(src, r"(?m)^\s+match \w+.*:$", where)
                for bad in ("list[", "dict[", "tuple["):
                    self.assertNotRegex(src, r"(?<![\w.])%s" % re.escape(bad), where)

    def test_example_config_is_safe_by_default(self):
        with open(os.path.join(ROOT, "india-budget", "config.example.json")) as fh:
            cfg = json.load(fh)
        for k in ("max_loss_per_trade_inr", "max_daily_loss_inr", "max_trades_per_day",
                  "min_reward_risk", "require_stop", "no_entries_after", "flat_by",
                  "include_costs_in_risk"):
            self.assertIn(k, cfg, k)
        self.assertIs(cfg["paper"], True)
        self.assertEqual(cfg["broker"], "paper")
        self.assertIs(cfg["require_stop"], True)
        self.assertIs(cfg["include_costs_in_risk"], True)
        for k in ("allow_short", "allow_margin", "allow_options"):
            self.assertIs(cfg.get(k, False), False, k)
        self.assertEqual(cfg["product"], "INTRADAY")
        self.assertEqual(cfg["allowed_series"], ["EQ"])
        self.assertLess(cfg["flat_by"], "15:10")        # before the brokers' auto square-off

    def test_fixtures_never_claim_to_be_nse_data(self):
        for path in pack_files():
            rel = os.path.relpath(path, os.path.join(HERE, "fixtures"))
            if rel.startswith("..") or not path.endswith(".json"):
                continue
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            if '"chart"' in text or '"spark"' in text:
                self.assertIn("SYNTHETIC", text, rel)


if __name__ == "__main__":
    unittest.main()
