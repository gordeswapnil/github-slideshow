"""One synthetic trade through the whole India pack, as the skills hand files to each other.

entry -> exit -> budget -> risk -> broker (show, a vague reply, yes, paper fill) -> time
machine -> alerts,
plus a second risk run that sees the first trade in the broker log. Every number below
comes from the synthetic SYNTH bars (US TSLA bars re-timed onto the NSE clock), the
example config and the shared core's charges. Arithmetic, all in rupees:

    opening range 09:15-09:30: high 362.18, low 354.47; the 09:55 bar closes 364.18 (10:00)
    stop = opening-range midpoint 358.325 -> tick down (0.05) = 358.30; risk 5.88 a share
    target 2R = 364.18 + 11.76 = 375.94 -> tick down = 375.90
    limit = 364.18 x 1.001 = 364.544 -> tick up = 364.55; risk from the limit 6.25 a share
    max loss alone: 150 shares (150 x 6.25 + 57.52 charges = 995.02 <= 1,000)
    50% position cap of 1,00,000 = 50,000: 137 shares (137 x 364.55 = 49,943.35) decides it
    max loss 137 x 6.25 = 856.25 + 52.53 charges = 908.78
    paper fill at 364.40: cash 1,00,000 - 49,922.80 - 21.04 buy-side charges = 50,056.16
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from _load import ROOT, FIX

NOW = "2026-10-19 10:01"
LATER = "2026-10-19 10:02"


def run(script, *args):
    out = subprocess.run([sys.executable, os.path.join(ROOT, script)] + list(args),
                         capture_output=True, text=True)
    return out.returncode, out.stdout + out.stderr


class Flow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old = os.getcwd()
        cls.tmp = tempfile.mkdtemp()
        os.chdir(cls.tmp)
        os.makedirs("trader-india")
        shutil.copy(os.path.join(ROOT, "india-budget", "config.example.json"),
                    os.path.join("trader-india", "config.json"))
        cls.log = {}
        steps = [
            ("entry", "india-entry/entry.py", "check", "SYNTH", "--setup", "orb", "--offline",
             os.path.join(FIX, "india-entry", "SYNTH-2026-10-19-5m.json"), "--now", NOW, "--write"),
            ("exit", "india-exit/exit.py", "plan", "--write"),
            ("budget", "india-budget/size.py", "--now", NOW, "--write"),
            ("risk", "india-risk/check.py", "--now", NOW),
            ("show", "india-broker/ticket.py", "show", "--now", LATER),
            ("vague", "india-broker/ticket.py", "approve", "--index", "1", "--reply", "sure, go ahead",
             "--now", LATER),
            ("yes", "india-broker/ticket.py", "approve", "--index", "1", "--reply", "yes", "--now", LATER),
            ("paper", "india-broker/ticket.py", "paper", "--index", "1", "--price", "364.40", "--now", LATER),
            ("timemachine", "india-timemachine/timemachine.py", "run", "--offline",
             os.path.join(FIX, "india-timemachine", "SYNTH-60d5m.json.gz"), "--seed", "19"),
            ("alerts", "india-alerts/alerts.py", "add", "--from-plan"),
            ("risk2", "india-risk/check.py", "--now", LATER, "--no-write"),
        ]
        for name, script, *args in steps:
            cls.log[name] = run(script, *args)

    @classmethod
    def tearDownClass(cls):
        os.chdir(cls.old)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def read(self, rel):
        with open(os.path.join("trader-india", rel), encoding="utf-8") as fh:
            return json.load(fh)

    def test_entry_and_plan(self):
        self.assertIn("TRIGGERED 10:00", self.log["entry"][1])
        plan = self.read("plan.json")
        self.assertEqual((plan["symbol"], plan["entry"], plan["stop"], plan["target"]),
                         ("SYNTH", 364.18, 358.3, 375.9))
        self.assertEqual(plan["flat_by"], "15:00")

    def test_budget_order(self):
        o = self.read("orders.json")["orders"][0]
        self.assertEqual({k: o[k] for k in ("symbol", "exchange", "side", "qty", "order_type", "price",
                                            "product", "validity", "stop_loss", "target", "bracket")},
                         {"symbol": "SYNTH", "exchange": "NSE", "side": "buy", "qty": 137,
                          "order_type": "LIMIT", "price": 364.55, "product": "INTRADAY",
                          "validity": "DAY", "stop_loss": 358.3, "target": 375.9, "bracket": True})

    def test_risk_passes_with_costs(self):
        code, out = self.log["risk"]
        self.assertEqual(code, 0, out)
        r = self.read(os.path.join("state", "risk.json"))["results"][0]
        self.assertEqual((r["verdict"], r["max_loss"], r["costs_at_stop"]), ("PASS", 908.78, 52.53))

    def test_broker_gates(self):
        self.assertIn("READY", self.log["show"][1])
        self.assertIn("Not recorded", self.log["vague"][1])
        self.assertIn("Recorded your yes", self.log["yes"][1])
        self.assertIn("Cash now ₹50,056.16", self.log["paper"][1])
        port = self.read("portfolio.json")
        self.assertEqual(port["cash"], 50056.16)
        held = {p["ticker"]: p["shares"] for p in port["positions"]}
        self.assertEqual(held, {"SYNTH": 137})

    def test_time_machine_reads_the_plan_and_the_order(self):
        out = self.log["timemachine"][1]
        self.assertIn("10:00 to 15:00 IST", out)
        self.assertIn("Costs on 137 shares (from trader-india/orders.json)", out)
        self.assertIn("Average R net of costs", out)

    def test_alerts_from_the_plan(self):
        out = self.log["alerts"][1]
        for rid in ("synth-plan-stop", "synth-plan-target", "synth-flat-by"):
            self.assertIn(rid, out)

    def test_the_same_order_again_is_blocked_as_a_duplicate(self):
        code, out = self.log["risk2"]
        self.assertEqual(code, 1, out)
        self.assertIn("BLOCK", out)


if __name__ == "__main__":
    unittest.main()
