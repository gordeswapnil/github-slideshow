"""india-exit tests.

Bars for the ATR stop reuse fixtures/india-entry/SYNTH-2026-10-19-5m.json: SYNTHETIC
data (the US pack's 2026-10-19 five-minute bars re-timed onto the NSE session by
fixtures/retime.py and renamed SYNTH, prices unchanged). Not NSE data. Every
number below is worked out from that synthetic file and the NSE tick grid.
"""

import io
import json
import os
import re
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from decimal import Decimal

from _load import load, FIX, ROOT

exitp = load("india-exit", "exit")
entry = load("india-entry", "entry")

HERE = os.path.dirname(os.path.abspath(__file__))
SYNTH = os.path.join(FIX, "india-entry", "SYNTH-2026-10-19-5m.json")
DATA = "trader-india"

# trader-india/plan.json for the synthetic reel: the 09:55 bar (bar 8) closes at 10:00 IST
REEL_PLAN = {"created_by": "india-exit", "symbol": "SYNTH", "exchange": "NSE", "side": "buy", "date": "2026-10-19",
             "timezone": "IST", "setup": "orb", "entry": 364.18, "entry_time": "10:00", "entry_bar": 8,
             "interval": "5m", "opening_range": {"high": 362.18, "low": 354.47, "minutes": 15},
             "stop": 358.30, "stop_rule": "or_mid", "stop_label": "opening-range midpoint",
             "target": 370.05, "target_r": 1.0, "target_label": "1R (one times the risk)",
             "risk_per_share": 5.88, "reward_risk": 1.0, "flat_by": "15:00", "tick": 0.05}
REEL_ENTRY = {"created_by": "india-entry", "symbol": "SYNTH", "exchange": "NSE", "setup": "orb", "side": "buy",
              "date": "2026-10-19", "timezone": "IST", "status": "triggered", "time": "10:00", "bar_start": "09:55",
              "bar_index": 8, "price": 364.18, "level": 362.18, "interval": "5m",
              "opening_range": {"high": 362.18, "low": 354.47, "minutes": 15},
              "source": "yahoo", "checked_at": "2026-10-19T04:30:00Z"}


def run(mod, argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = mod.main(argv)
    return code, out.getvalue(), err.getvalue()


def c(entry_px, stop, target="2R", oh=362.18, ol=354.47, atr=None, n=None):
    sr, sp = exitp.parse_stop(stop)
    tr, tp = exitp.parse_target(target)
    return exitp.compute(entry_px, sr, sp, tr, tp, oh, ol, atr, n)


def safety_block():
    with open(os.path.join(HERE, "CONVENTIONS.md"), encoding="utf-8") as fh:
        text = fh.read()
    a = text.index("```\n## Safety") + 4
    return text[a:text.index("\n```", a)] + "\n"


class Math(unittest.TestCase):
    def test_the_synthetic_reel_or_mid_1r(self):
        p = c(364.18, "or-mid", "1R")
        self.assertEqual(p["stop"], Decimal("358.30"))           # 358.325 down to the 0.05 tick
        self.assertEqual(p["risk"], Decimal("5.88"))
        self.assertEqual(p["target"], Decimal("370.05"))         # 370.06 down to the 0.05 tick
        self.assertEqual(p["reward_risk"], Decimal("1.00"))      # 5.87 / 5.88 = 0.998
        self.assertEqual(p["tick"], Decimal("0.05"))
        self.assertEqual(p["target_label"], "1R (one times the risk)")
        self.assertIn("₹358.325, rounded down to the ₹0.05 tick", p["stop_detail"])
        self.assertIn("₹370.06, rounded down to the ₹0.05 tick", p["target_detail"])

    def test_the_default_2r_is_rounded_down_and_says_so(self):
        p = c(364.18, "or-mid")
        self.assertEqual(p["target"], Decimal("375.90"))         # 375.94 down to the tick
        self.assertEqual(p["target_r"], Decimal("2"))
        self.assertEqual(p["reward_risk"], Decimal("1.99"))      # 11.72 / 5.88: the honest ratio
        self.assertEqual(p["target_label"], "2R (two times the risk)")

    def test_raw_yahoo_floats_give_the_same_prices(self):
        p = c(364.1759948730469, "or-mid", "1R", 362.17999267578125, 354.4700012207031)
        self.assertEqual((p["entry"], p["stop"], p["target"]), (Decimal("364.18"), Decimal("358.30"), Decimal("370.05")))

    def test_other_stops(self):
        p = c(364.18, "or-low")
        self.assertEqual((p["stop"], p["risk"], p["target"]), (Decimal("354.45"), Decimal("9.73"), Decimal("383.60")))
        p = c(364.18, "price:358.329")
        self.assertEqual(p["stop"], Decimal("358.30"))              # rounds away from the entry
        p = c(364.18, "pct:1")                                      # 360.5382 -> 360.50
        self.assertEqual((p["stop"], p["risk"], p["target"]), (Decimal("360.50"), Decimal("3.68"), Decimal("371.50")))
        p = c(364.18, "atr:1.5", atr=3.2181, n=9)
        self.assertEqual(p["stop"], Decimal("359.35"))              # 364.18 - 4.82715 = 359.35285
        self.assertEqual(p["stop_label"], "1.5 x ATR(9) under the entry")

    def test_the_nse_tick_grid(self):
        p = c(100, "price:99.01", "1.5R", None, None)
        self.assertEqual(p["target"], Decimal("101.48"))            # 101.485 rounds DOWN on the 0.01 tick
        self.assertEqual(p["target_label"], "1.5R (1.5 times the risk)")
        self.assertEqual(c(252, "price:249.996", "2R", None, None)["stop"], Decimal("249.99"))   # 0.01 under 250
        self.assertEqual(c(1010, "pct:1", "2R", None, None)["stop"], Decimal("999.90"))         # 0.05 under 1,000
        self.assertEqual(c(1503.37, "pct:1", "2R", None, None)["stop"], Decimal("1488.30"))     # 0.10 tick
        self.assertEqual(c(7777.77, "pct:1", "2R", None, None)["stop"], Decimal("7699.50"))     # 0.50 tick
        p = c(12345, "pct:1", "2R", None, None)                                                  # 1.00 tick
        self.assertEqual((p["stop"], p["risk"], p["target"]), (Decimal("12221.00"), Decimal("124.00"),
                                                               Decimal("12593.00")))
        self.assertIn("₹12,221.55, rounded down to the ₹1.00 tick", p["stop_detail"])
        p = c(364.18, "or-mid", "price:372")
        self.assertEqual(p["reward_risk"], Decimal("1.33"))
        self.assertEqual(p["target_label"], "your price (1.33R)")
        self.assertEqual(p["target_r"], Decimal("1.33"))
        self.assertEqual(c(364.18, "or-mid", "price:372.04")["target"], Decimal("372.00"))

    def test_refusals_say_why(self):
        cases = [("price:364.18", "2R", "at or above the entry"),
                 ("price:365", "2R", "at or above the entry"),
                 ("or-mid", "price:364", "at or below the entry"),
                 ("or-mid", "price:364.19", "at or below the entry"),       # 364.15 on the tick
                 ("price:364.10", "2R", "too tight to survive the spread"),
                 ("pct:0.04", "2R", "too tight to survive the spread")]
        for stop, target, why in cases:
            with self.assertRaises(exitp.PlanError) as cm:
                c(364.18, stop, target)
            self.assertIn(why, str(cm.exception), stop)
        with self.assertRaises(exitp.PlanError):
            c(358.00, "or-mid")                                     # the midpoint is above this entry
        for bad in ("mid-ish", "pct:100", "price:0", "atr:-1"):
            with self.assertRaises(exitp.PlanError):
                exitp.parse_stop(bad)
        for bad in ("0R", "R", "lots", "price:x"):
            with self.assertRaises(exitp.PlanError):
                exitp.parse_target(bad)
        with self.assertRaises(exitp.PlanError):
            c(364.18, "or-mid", oh=None, ol=None)
        with self.assertRaises(exitp.PlanError):
            c(364.18, "or-mid", oh=354.47, ol=362.18)

    def test_too_tight_is_4_ticks_or_0_05_pct_whichever_is_more(self):
        # 364.18 on the 0.05 tick: 4 ticks = 0.20 beats 0.05% = 0.182
        self.assertEqual(c(364.18, "price:363.99")["stop"], Decimal("363.95"))
        self.assertEqual(c(364.18, "price:363.99")["risk"], Decimal("0.23"))
        with self.assertRaises(exitp.PlanError) as cm:
            c(364.18, "price:364.00")                               # 0.18 of risk
        self.assertIn("less than ₹0.20 (the larger of 4 ticks of ₹0.05 and 0.05% of ₹364.18)",
                      str(cm.exception))
        # 100 on the 0.01 tick: 0.05% = 0.05 beats 4 ticks = 0.04
        self.assertEqual(c(100, "price:99.95", "2R", None, None)["risk"], Decimal("0.05"))
        with self.assertRaises(exitp.PlanError):
            c(100, "price:99.96", "2R", None, None)
        # 25,000 on the 5.00 tick: 4 ticks = 20 beats 0.05% = 12.50
        self.assertEqual(c(25000, "price:24980", "2R", None, None)["risk"], Decimal("20.00"))
        with self.assertRaises(exitp.PlanError):
            c(25000, "price:24985", "2R", None, None)

    def test_atr_on_the_session_bars(self):
        ch = exitp.load_chart("SYNTH", "5m", None, SYNTH)
        day = exitp.datetime.date(2026, 10, 19)
        bars = exitp.session_bars(ch, day, "5m", upto_slot=8)
        self.assertEqual(len(bars), 9)                              # 09:15 ... the 09:55 entry bar
        trs, prev = [], None
        for b in bars:
            r = b["h"] - b["l"]
            if prev is not None:
                r = max(r, abs(b["h"] - prev), abs(b["l"] - prev))
            trs.append(r)
            prev = b["c"]
        self.assertAlmostEqual(trs[0], 362.18 - 354.47, places=4)
        atr, n = exitp.atr_of(bars)
        self.assertEqual(n, 9)
        self.assertAlmostEqual(atr, sum(trs) / 9, places=9)
        self.assertAlmostEqual(atr, 3.2182, places=4)
        # later it uses the last 14 bars; the in-progress 10:30 bar and the 10:34:45 tick never count
        all_bars = exitp.session_bars(ch, day, "5m")
        self.assertEqual(len(all_bars), 15)
        self.assertEqual(exitp.atr_of(all_bars)[1], 14)
        with self.assertRaises(exitp.PlanError) as cm:
            exitp.load_chart("RELIANCE", "5m", None, SYNTH)
        self.assertIn("holds SYNTH, not RELIANCE", str(cm.exception))
        self.assertEqual(exitp.chart_path("M&M", "1d", "5m"), "/v8/finance/chart/M%26M.NS?range=1d&interval=5m")


class Cli(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.cwd = os.getcwd()
        os.chdir(self.d)
        os.mkdir(DATA)

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.d)

    def write(self, path, doc):
        with open(path, "w") as fh:
            json.dump(doc, fh)

    def plan(self, *args, now="2026-10-19 10:01"):
        return run(exitp, ["plan", "--now", now] + list(args))

    def read_plan(self):
        with open(os.path.join(DATA, "plan.json"), encoding="utf-8") as fh:
            return json.load(fh)

    def test_entry_to_plan_end_to_end(self):
        code, _, _ = run(entry, ["check", "SYNTH", "--offline", SYNTH, "--now", "2026-10-19 10:00", "--write"])
        self.assertEqual(code, 0)
        code, text, err = self.plan("--stop", "or-mid", "--target", "1R", "--write")
        self.assertEqual(code, 0, err)
        p = self.read_plan()
        for k, v in REEL_PLAN.items():
            self.assertEqual(p[k], v, k)
        self.assertEqual(p["created_at"], "2026-10-19T04:31:00Z")
        self.assertIn("Entry         ₹364.18 at 10:00 IST (bar 8)", text)
        self.assertIn("Stop          ₹358.30  opening-range midpoint", text)
        self.assertIn("Target        ₹370.05  1R (one times the risk)", text)
        self.assertIn("Risk a share  ₹5.88 (1.61% of the entry)", text)
        self.assertIn("Reward:risk   1.0", text)
        self.assertIn("Flat by       15:00 IST", text)
        self.assertIn("not a guarantee", text)
        self.assertIn("lower price band (circuit)", text)
        self.assertIn("/india-timemachine", text)
        self.assertNotIn("pro" + "fit", text.lower())   # never on screen
        code, text, _ = self.plan("--write")                       # the defaults: or-mid, 2R
        self.assertEqual(self.read_plan()["target"], 375.90)
        self.assertEqual(self.read_plan()["target_r"], 2.0)
        self.assertEqual(self.read_plan()["reward_risk"], 1.99)
        code, text, _ = run(exitp, ["show", "--now", "2026-10-19 10:05"])
        self.assertEqual(code, 0)
        self.assertIn("₹375.90", text)
        self.assertNotIn("not today", text)
        code, text, _ = run(exitp, ["show", "--now", "2026-10-21 10:05"])
        self.assertIn("not today", text)

    def test_manual_flags_and_json(self):
        code, text, _ = self.plan("--symbol", "synth", "--entry", "364.18", "--or-high", "362.18", "--or-low", "354.47",
                                  "--time", "10:00", "--entry-bar", "8", "--date", "2026-10-19", "--target", "1R",
                                  "--json")
        self.assertEqual(code, 0)
        p = json.loads(text)
        for k, v in REEL_PLAN.items():
            self.assertEqual(p[k], v, k)
        self.assertEqual(p["warnings"], [])
        # an NSE symbol with & on the 0.10 tick: 3012.45 x 0.99 = 2982.3255 -> 2982.30
        code, text, err = self.plan("--symbol", "m&m", "--entry", "3012.45", "--stop", "pct:1", "--date",
                                    "2026-10-19", "--json")
        self.assertEqual(code, 0, err)
        p = json.loads(text)
        self.assertEqual((p["symbol"], p["setup"], p["stop"], p["risk_per_share"], p["target"], p["tick"]),
                         ("M&M", "level", 2982.3, 30.15, 3072.7, 0.1))
        self.assertEqual(json.loads(self.plan("--symbol", "RELIANCE.NS", "--entry", "1412.30", "--stop", "pct:1",
                                              "--json")[1])["symbol"], "RELIANCE")
        code, _, err = self.plan("--symbol", "NOT A SYMBOL", "--entry", "10", "--stop", "pct:1")
        self.assertEqual(code, 1)
        self.assertIn("is not an NSE symbol", err)

    def test_atr_stop_reads_bars(self):
        self.write(os.path.join(DATA, "entry.json"), REEL_ENTRY)
        code, text, err = self.plan("--stop", "atr:1.5", "--offline", SYNTH, "--json")
        self.assertEqual(code, 0, err)
        p = json.loads(text)
        self.assertEqual((p["stop"], p["risk_per_share"], p["target"]), (359.35, 4.83, 373.80))
        self.assertEqual((p["stop_rule"], p["atr_bars"]), ("atr", 9))
        self.assertAlmostEqual(p["atr"], 3.2182, places=4)
        code, _, err = self.plan("--stop", "atr:1.5", "--offline", SYNTH, "--entry-bar", "1")
        self.assertEqual(code, 1)
        self.assertIn("at least 3 closed", err)

    def test_refusals_from_the_cli(self):
        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, status="waiting", time=None, price=None,
                                                          bar_index=None, bar_start=None))
        code, _, err = self.plan()
        self.assertEqual(code, 1)
        self.assertIn("SYNTH is waiting, not triggered", err)
        code, text, _ = self.plan("--entry", "362.19", "--json")    # plan ahead at the level
        self.assertEqual(code, 0)
        p = json.loads(text)
        self.assertEqual((p["entry"], p["stop"], p["entry_time"]), (362.19, 358.30, None))

        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, setup="level", level=362.0))
        code, _, err = self.plan()
        self.assertIn("level setup has no opening-range stop", err)
        self.assertEqual(self.plan("--stop", "pct:1")[0], 0)

        code, _, err = self.plan("--side", "sell")
        self.assertIn("plans longs only", err)
        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, side="sell"))
        code, _, err = self.plan()
        self.assertIn("longs only", err)
        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, exchange="NYSE"))
        code, _, err = self.plan()
        self.assertIn("not NSE", err)
        os.remove(os.path.join(DATA, "entry.json"))
        code, _, err = self.plan()
        self.assertIn("no entry", err)
        self.assertIn("trader-india/entry.json", err)
        code, _, err = self.plan("--symbol", "SYNTH")
        self.assertIn("needs --entry", err)
        code, _, err = self.plan("--symbol", "SYNTH", "--from", "x.json", "--entry", "1")
        self.assertIn("not both", err)
        code, _, err = self.plan("--symbol", "SYNTH", "--entry", "364.18", "--or-high", "362.18")
        self.assertIn("both --or-high and --or-low", err)
        self.assertNotIn("Traceback", err)

    def test_flat_by_config_and_the_nse_afternoon(self):
        self.write(os.path.join(DATA, "entry.json"), REEL_ENTRY)
        self.assertEqual(json.loads(self.plan("--json")[1])["flat_by"], "15:00")     # the India default
        self.write(os.path.join(DATA, "config.json"), {"flat_by": "14:45", "min_reward_risk": 1.5})
        code, text, _ = self.plan("--target", "1R", "--json")
        p = json.loads(text)
        self.assertEqual(p["flat_by"], "14:45")
        self.assertIn("under your min_reward_risk 1.5", p["warnings"][0])
        os.remove(os.path.join(DATA, "config.json"))

        code, _, err = self.plan("--flat-by", "15:30")
        self.assertEqual(code, 1)
        self.assertIn("at or after the 15:30 close", err)
        code, _, err = self.plan("--flat-by", "09:15")
        self.assertIn("at or before the 09:15 open", err)
        # 15:12 is past the brokers' 15:10 MIS square-off: allowed, with a warning
        p = json.loads(self.plan("--flat-by", "15:12", "--json")[1])
        self.assertEqual(p["flat_by"], "15:12")
        self.assertIn("Angel One and Dhan square off intraday (MIS) positions", p["warnings"][0])
        # until 2026-12-06 the F&O stocks stop continuous trading at 15:15
        p = json.loads(self.plan("--flat-by", "15:20", "--json")[1])
        self.assertEqual(len(p["warnings"]), 2)
        self.assertIn("stop continuous trading at 15:15", p["warnings"][1])
        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, date="2026-12-07"))
        p = json.loads(self.plan("--flat-by", "15:20", "--json", now="2026-12-07 10:01")[1])
        self.assertEqual(len(p["warnings"]), 1)                    # the auction rule has ended
        self.assertNotIn("15:15", p["warnings"][0])

        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, time="15:05"))
        code, _, err = self.plan()
        self.assertEqual(code, 1)
        self.assertIn("no time left to hold it", err)

    def test_holidays_and_an_unknown_year(self):
        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, date="2026-10-20"))
        p = json.loads(self.plan("--json")[1])
        self.assertIn("2026-10-20 is not an NSE trading day (NSE holiday: Dussehra).", p["warnings"])
        self.write(os.path.join(DATA, "entry.json"), dict(REEL_ENTRY, date="2027-01-04"))
        p = json.loads(self.plan("--json", now="2027-01-04 10:01")[1])
        self.assertEqual(len(p["warnings"]), 1)
        self.assertIn("covers 2026 only", p["warnings"][0])
        self.assertIn("trader-india/holidays.json", p["warnings"][0])
        self.write(os.path.join(DATA, "holidays.json"), {"2027-01-26": "Republic Day"})
        self.assertEqual(json.loads(self.plan("--json", now="2027-01-04 10:01")[1])["warnings"], [])

    def test_show_without_a_plan(self):
        code, text, _ = run(exitp, ["show"])
        self.assertEqual(code, 1)
        self.assertIn("No plan", text)

    def test_the_example_plan_is_what_the_reel_writes(self):
        self.write(os.path.join(DATA, "entry.json"), REEL_ENTRY)
        p = json.loads(self.plan("--stop", "or-mid", "--target", "1R", "--json")[1])
        with open(os.path.join(ROOT, "india-exit", "plan.example.json"), encoding="utf-8") as fh:
            ex = json.load(fh)
        self.assertIn("synthetic", ex.pop("_example").lower())
        p.pop("warnings")
        self.assertEqual(ex, p)
        with open(os.path.join(FIX, "india-alerts", "plan-SYNTH.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), p)                     # india-alerts reads the same plan


class SkillDoc(unittest.TestCase):
    def test_skill_md(self):
        with open(os.path.join(ROOT, "india-exit", "SKILL.md"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertTrue(text.startswith("---\nname: india-exit\n"))
        self.assertGreater(len(text.splitlines()), 60)
        self.assertEqual(text[text.index("## Safety"):], safety_block())
        low = " ".join(text.lower().split())
        for must in ("before the entry", "a stop is a plan, not a guarantee", "lower price band", "circuit",
                     "/india-timemachine", "/india-budget", "/india-alerts", "longs only", "₹358.30",
                     "₹370.05", "₹5.88", "375.90", "too tight to survive the spread", "4 ticks",
                     "synthetic", "15:00", "15:10", "trader-india/plan.json", "${claude_skill_dir}"):
            self.assertIn(must, low)
        for never in ("—", "tick " + "by tick", "real " + "time", "pro" + "fit", "new york", "nyse"):
            self.assertNotIn(never, low)
        self.assertIsNone(re.search(r"\$\d", text))


if __name__ == "__main__":
    unittest.main()
