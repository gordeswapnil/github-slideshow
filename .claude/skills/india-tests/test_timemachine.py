"""Tests for india-timemachine/timemachine.py.

SYNTH-60d5m.json.gz is SYNTHETIC: the US pack's real TSLA 60-day 5-minute chart
re-timed onto the NSE clock by fixtures/retime.py (09:30 ET -> 09:15 IST, bars at
or after 15:30 IST dropped, so 75 bars a session; NSE holidays 2026-09-14 and
2026-10-02 dropped, so 57 full sessions before 2026-10-19 instead of 59). Prices
are US prices relabelled as rupees. Every expected number below was recomputed
from this file; the fingerprints pin this port's own output, not the US reel's.
"""
import gzip
import hashlib
import io
import json
import os
import random
import shutil
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout, redirect_stderr

from _load import load, FIX

tm = load("india-timemachine", "timemachine")

DIR = os.path.join(FIX, "india-timemachine")
SYNTH = os.path.join(DIR, "SYNTH-60d5m.json.gz")   # synthetic Yahoo v8 chart, range=60d interval=5m, to 10:34 IST
with gzip.open(SYNTH, "rt", encoding="utf-8") as _fh:
    TEXT = _fh.read()
NOW = "2026-10-19 10:50"
NOW_UTC = tm.parse_now(NOW)

# the synthetic plan as india-exit writes it (CONVENTIONS.md): the 09:55 bar closed above the
# 09:15-09:30 range at 10:00; stop = the range midpoint 358.325 rounded down to the 0.05 tick,
# target = 1R (364.18 + 5.88 = 370.06) rounded down to the tick
PLAN = {"created_by": "india-exit", "symbol": "SYNTH", "exchange": "NSE", "timezone": "IST", "side": "buy",
        "date": "2026-10-19", "setup": "orb", "entry": 364.18, "entry_time": "10:00", "entry_bar": 8,
        "interval": "5m", "opening_range": {"high": 362.18, "low": 354.47, "minutes": 15},
        "stop": 358.30, "stop_rule": "or_mid", "stop_label": "opening-range midpoint",
        "target": 370.05, "target_r": 1.0, "target_label": "1R (one times the risk)",
        "risk_per_share": 5.88, "reward_risk": 1.0, "flat_by": "15:00"}
ORDER = {"symbol": "SYNTH", "exchange": "NSE", "side": "buy", "qty": 160, "order_type": "LIMIT", "price": 364.55,
         "trigger_price": None, "product": "INTRADAY", "validity": "DAY", "stop_loss": 358.30, "target": 370.05,
         "bracket": True, "plan": {"entry": 364.18, "stop": 358.30, "target": 370.05}}

# this port's run of the synthetic plan, seed 19 (regression pins)
BANDS = "ba575214c2c6b6e2"
PATHS = "eb14184164329326"
TRADES = "449094aad705ddfb"
HIST = {"lo": 352.89, "hi": 376.23,
        "bins": [101, 95, 134, 171, 257, 337, 458, 554, 618, 689, 774, 792, 776, 767, 681, 636, 488, 393, 332, 255,
                 217, 148, 106, 64]}


def sha(x):
    return hashlib.sha256(json.dumps(x).encode("utf-8")).hexdigest()[:16]


def plan(**kw):
    raw = dict(PLAN)
    raw.update(kw)
    return tm.normalize_plan(raw)


def machine(p=None, text=TEXT, now=NOW_UTC, **kw):
    return tm.time_machine(text, p or plan(), now, **kw)


def edited(fn):
    """The fixture's chart JSON, changed by fn(result), back as text."""
    doc = json.loads(TEXT)
    fn(doc["chart"]["result"][0])
    return json.dumps(doc)


def keep_bars(result, keep):
    q = result["indicators"]["quote"][0]
    idx = [i for i, ts in enumerate(result["timestamp"]) if keep(ts)]
    result["timestamp"] = [result["timestamp"][i] for i in idx]
    for k in q:
        q[k] = [q[k][i] for i in idx]


def ist(ts):
    return tm.to_ist(tm.utc_of(ts))


def ist_ts(text):
    local = tm.datetime.datetime.strptime(text, "%Y-%m-%d %H:%M")
    return int((tm.ist_to_utc(local) - tm.EPOCH).total_seconds())


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = tm.main(argv)
    return code, out.getvalue(), err.getvalue()


class SynthPlan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = machine()

    def test_the_odds(self):
        m = self.doc["mc"]
        self.assertEqual((m["replays"], m["seed"], m["window"], m["until"], m["until_from"]),
                         (10000, 19, 2, "15:00", "the plan's flat_by"))
        self.assertEqual(m["pool_sessions"], 57)
        self.assertEqual(m["bars_left"], 60)                # bars 9 to 68: 10:00 to 15:00
        self.assertEqual((m["pool_from"], m["pool_to"]), ("2026-07-27", "2026-10-16"))
        self.assertEqual((m["p_target"], m["p_stop"], m["p_neither"], m["p_green"]), (0.2608, 0.2126, 0.5266, 0.5296))
        self.assertEqual((m["median_close"], m["p5_close"], m["p95_close"]), (364.52, 356.5, 372.87))
        self.assertEqual((m["avg_R"], m["avg_R_net"]), (0.053, -0.012))
        self.assertEqual(m["r_at_target"], 0.9983)          # 5.87 / 5.88: the target is on the 0.05 tick grid

    def test_pinned_output(self):
        m = self.doc["mc"]
        self.assertEqual(sha(m["bands"]), BANDS)
        self.assertEqual(len(m["sample_paths"]), 160)
        self.assertEqual(sha(m["sample_paths"]), PATHS)
        self.assertEqual(m["hist"], HIST)
        self.assertEqual(m["bands"][-1], [356.73, 361.2, 364.36, 367.69, 372.7])

    def test_the_history_replay(self):
        h = self.doc["history"]
        self.assertEqual((h["sessions"], h["triggered"]), (57, 32))
        self.assertEqual((h["target"], h["stop"], h["close"], h["green"]), (13, 15, 4, 15))
        self.assertEqual((h["avg_R"], h["avg_R_net"]), (-0.05, -0.17))
        self.assertEqual(h["rule"], {"setup": "orb", "or_minutes": 15, "stop_rule": "or_mid", "target_r": 1.0})
        slim = [{"date": t["date"], "entry": t["entry"], "outcome": t["outcome"], "R": t["R"]} for t in h["trades"]]
        self.assertEqual(sha(slim), TRADES)
        # range 302.60 to 307.19, midpoint 304.895 down to the 0.05 tick 304.85; the 11:30 bar closed 307.97;
        # 1R target 307.97 + 3.12 = 311.09 down to 311.05
        self.assertEqual(h["trades"][0], {"date": "2026-07-28", "time": "11:35", "entry": 307.97, "stop": 304.85,
                                          "target": 311.05, "outcome": "target", "R": 0.99, "R_net": 0.88})
        for t in h["trades"]:
            self.assertTrue(t["R_net"] < t["R"], t)

    def test_the_verdict(self):
        self.assertEqual(self.doc["verdict"], "Leans toward the target: target first 26.1 % vs stop first 21.3 %.")
        gap, share, even = tm.lean(self.doc["mc"])
        self.assertEqual((round(share, 3), round(even, 4), round(gap, 4)), (0.551, 0.5004, 0.0505))  # just over 5
        self.assertEqual(self.doc["verdict_notes"],
                         ["52.7 % of the replays hit neither by 15:00; the price at 15:00 decides those.",
                          "Charges turn the average R from +0.053 to -0.012 net of costs."])

    def test_bands_start_at_the_entry(self):
        m = self.doc["mc"]
        self.assertEqual(m["bands"][0], [364.18] * 5)
        self.assertEqual(len(m["bands"]), 61)
        self.assertEqual((m["band_times"][0], m["band_times"][-1], len(m["band_times"])), ("10:00", "15:00", 61))
        self.assertTrue(all(p[0] == 364.18 and len(p) == 61 for p in m["sample_paths"]))

    def test_the_plan_is_carried_through(self):
        p = self.doc["plan"]
        self.assertEqual((p["symbol"], p["entry"], p["stop"], p["target"], p["entry_bar"], p["entry_time"]),
                         ("SYNTH", 364.18, 358.30, 370.05, 8, "10:00"))
        self.assertEqual((p["risk_per_share"], p["target_r"], p["flat_by"], p["exchange"], p["timezone"]),
                         (5.88, 1.0, "15:00", "NSE", "IST"))
        self.assertEqual(self.doc["warnings"], [])
        self.assertEqual((self.doc["created_by"], self.doc["data"]["symbol"]), ("india-timemachine", "SYNTH.NS"))

    def test_the_text_report(self):
        text = "\n".join(tm.report(self.doc))
        for line in ("SYNTH buy on NSE, Monday 2026-10-19: entry ₹364.18 at 10:00 IST (bar 8), stop ₹358.30, "
                     "target ₹370.05 (1R, risk ₹5.88 a share).",
                     "10,000 replays of the rest of the session, 10:00 to 15:00 IST (the plan's flat_by), "
                     "60 five-minute bars, seed 19.", "57 full sessions",
                     "target first   26.1 %", "stop first     21.3 %", "neither        52.7 %   still open at 15:00",
                     "green          53.0 %", "median 364.52, 90 % of replays between 356.50 and 372.87",
                     "Average R: +0.053", "₹0.38 round trip at the stop (0.065R), ₹0.39 at the target (0.066R)",
                     "Average R net of costs: -0.012. Net of costs the target has to come first in 53.3 % of the "
                     "replays that hit one side (50.0 % before costs).",
                     "fired 32 times: 13 target, 15 stop, 4 neither. Average R -0.050 (-0.170 net of costs)",
                     "Leans toward the target: target first 26.1 % vs stop first 21.3 %.\n52.7 % of the replays "
                     "hit neither by 15:00; the price at 15:00 decides those.\nCharges turn the average R",
                     "not a prediction", "momentum and volatility clustering", "small sample", "--seed 19"):
            self.assertIn(line, text)
        for word in ("profit", "P&L", "guarantee", "real time", "tick by tick", chr(0x2014)):
            self.assertNotIn(word, text)


class Costs(unittest.TestCase):
    def test_per_share_by_default(self):
        c = machine(replays=200)["costs"]
        self.assertEqual((c["qty"], c["per_share"], c["brokerage_flat_inr"], c["brokerage_pct"]), (None, True, 20, 0.03))
        self.assertEqual(c["at_stop"], {"brokerage": 0.22, "stt": 0.09, "stamp_duty": 0.01, "exchange": 0.02,
                                        "sebi": 0.0, "gst": 0.04, "total": 0.38, "R": 0.0646})
        self.assertEqual((c["at_target"]["total"], c["at_target"]["R"]), (0.39, 0.0663))
        # net of costs a target is worth 0.9983 - 0.0663 R and a stop costs 1.0646 R: 1.0646 / 1.9966
        self.assertEqual(c["break_even_net"], 0.5332)

    def test_160_shares_by_hand(self):
        doc = machine(qty=160, qty_from="--qty", replays=2000)
        c = doc["costs"]
        # buy 160 x 364.18 = 58,268.80, sell 160 x 358.30 = 57,328.00. Brokerage 0.03 % of each (under ₹20):
        # 17.48 + 17.20; STT 0.025 % of the sell 14.33; stamp 0.003 % of the buy 1.75; exchange 0.00307 % of
        # 1,15,596.80 = 3.55; SEBI ₹10 a crore 0.12; GST 18 % of (34.68 + 3.55 + 0.12) = 6.90
        self.assertEqual(c["at_stop"], {"brokerage": 34.68, "stt": 14.33, "stamp_duty": 1.75, "exchange": 3.55,
                                        "sebi": 0.12, "gst": 6.9, "total": 61.33, "R": 0.0652})  # / (160 x 5.88)
        self.assertEqual((c["qty"], c["qty_from"], c["per_share"]), (160, "--qty", False))
        self.assertEqual((doc["mc"]["avg_R_net"], doc["history"]["avg_R_net"]), (-0.025, -0.171))
        self.assertIn("Costs on 160 shares (from --qty): ₹61.33 round trip at the stop (0.065R)",
                      "\n".join(tm.report(doc)))

    def test_one_share_is_the_most_in_r(self):
        per_share = machine(replays=200)["costs"]["at_stop"]["R"]
        big = machine(qty=1000, qty_from="--qty", replays=200)["costs"]["at_stop"]
        self.assertEqual((big["brokerage"], big["total"], big["R"]), (40.0, 174.73, 0.0297))   # two ₹20 caps
        self.assertLess(big["R"], per_share)

    def test_brokerage_from_the_config(self):
        c = machine(brokerage=(0, 0), replays=200)["costs"]["at_stop"]
        self.assertEqual((c["brokerage"], c["gst"], c["total"]), (0.0, 0.0, 0.13))
        doc = machine(brokerage=(20, None), replays=200)       # flat ₹20 an order, no percentage
        self.assertEqual((doc["costs"]["at_stop"]["brokerage"], doc["costs"]["at_stop"]["R"]), (40.0, 8.0493))
        self.assertIn("give --qty", doc["warnings"][0])
        self.assertIn("flat brokerage of ₹20.00 an order", "\n".join(tm.report(doc)))
        self.assertEqual(tm.brokerage_of({"brokerage_pct": None}, "c.json"), (20.0, None))
        for bad in ({"brokerage_pct": "lots"}, {"brokerage_flat_inr": -1}):
            with self.assertRaises(tm.TMError):
                tm.brokerage_of(bad, "c.json")

    def test_qty_from_the_plan(self):
        doc = machine(plan(qty=75), replays=200)
        self.assertEqual((doc["costs"]["qty"], doc["costs"]["qty_from"]), (75, "the plan"))

    def test_qty_from_orders(self):
        d = tempfile.mkdtemp()
        try:
            path = os.path.join(d, "orders.json")

            def orders(*items):
                with open(path, "w") as fh:
                    json.dump({"created_by": "india-budget", "orders": list(items)}, fh)
                return tm.qty_from_orders(path, plan())
            self.assertEqual(orders(ORDER), (160, path))
            self.assertEqual(orders(dict(ORDER, symbol="OTHER"), dict(ORDER, qty=90)), (90, path))
            self.assertEqual(orders(dict(ORDER, side="sell")), (None, None))
            self.assertEqual(orders(dict(ORDER, plan={"entry": 370.0, "stop": 360.0})), (None, None))  # another plan
            self.assertEqual(orders(dict(ORDER, qty="lots")), (None, None))
            self.assertEqual(orders(dict(ORDER, plan=None)), (160, path))    # no plan to compare: symbol and side
            with open(path, "w") as fh:
                fh.write("{broken")
            self.assertEqual(tm.qty_from_orders(path, plan()), (None, None))
            self.assertEqual(tm.qty_from_orders(os.path.join(d, "none.json"), plan()), (None, None))
        finally:
            shutil.rmtree(d)


class Seeds(unittest.TestCase):
    def test_same_seed_same_numbers(self):
        self.assertEqual(machine(replays=2000, seed=5)["mc"], machine(replays=2000, seed=5)["mc"])

    def test_another_seed_gives_other_numbers(self):
        m = machine(seed=7)["mc"]
        self.assertNotEqual((m["p_target"], m["p_stop"], m["median_close"]), (0.2608, 0.2126, 364.52))
        self.assertAlmostEqual(m["p_target"] + m["p_stop"] + m["p_neither"], 1.0, places=6)
        self.assertNotEqual(sha(m["bands"]), BANDS)

    def test_the_draws_are_stable_across_pythons(self):
        r = random.Random(19)
        self.assertEqual([r.randint(-2, 2) for _ in range(8)], [-2, 2, -2, 2, -1, 1, 0, 2])
        self.assertEqual(r.choice(range(59)), 18)

    def test_window_and_replays(self):
        a = machine(replays=500, window=0)["mc"]
        self.assertEqual((a["replays"], a["window"]), (500, 0))
        self.assertNotEqual(a["bands"], machine(replays=500)["mc"]["bands"])
        with self.assertRaises(tm.TMError):
            machine(replays=0)
        with self.assertRaises(tm.TMError):
            machine(window=11)


class Bars(unittest.TestCase):
    def setUp(self):
        self.result = tm.chart_result(TEXT, "SYNTH.NS")

    def test_the_in_progress_tick_is_dropped(self):
        meta, bars, dropped = tm.parse_bars(self.result, NOW_UTC)
        self.assertEqual(dropped, {"no_price": 0, "off_grid": 1, "not_complete": 1, "outside_hours": 0})
        last = bars[-1]
        self.assertEqual((last["date"], last["start"], last["slot"]), ("2026-10-19", "10:25", 14))
        self.assertEqual(tm.parse_bars(self.result, tm.parse_now(None))[1][-1]["start"], "10:25")
        entry = [b for b in bars if b["date"] == "2026-10-19" and b["slot"] == 8][0]
        self.assertEqual((entry["start"], entry["c"]), ("09:55", 364.1759948730469))
        self.assertEqual(len([b for b in bars if b["date"] == "2026-10-16"]), 75)   # 09:15 to 15:25

    def test_now_pins_the_clock(self):
        bars = tm.parse_bars(self.result, tm.parse_now("2026-10-19 09:57"))[1]
        self.assertEqual(len([b for b in bars if b["date"] == "2026-10-19"]), 8)    # 09:15 to 09:50
        with self.assertRaises(tm.TMError) as cm:
            machine(now=tm.parse_now("2026-10-19 09:57"))
        self.assertIn("not in the data", str(cm.exception))
        self.assertIn("09:50 bar", str(cm.exception))
        self.assertEqual(machine(now=tm.parse_now("2026-10-19 10:00"), replays=200)["mc"]["pool_sessions"], 57)

    def test_no_daylight_saving(self):
        stamps = [ist_ts("2026-10-30 09:15"), ist_ts("2026-11-02 09:15"),   # either side of the US clock change
                  ist_ts("2026-11-02 08:15"),                               # before the pre-open
                  ist_ts("2026-11-02 15:00"), ist_ts("2026-11-02 15:30")]   # the last full hour, the close
        self.assertEqual([(t - stamps[0]) % 86400 for t in stamps[:2]], [0, 0])   # 03:45Z both days
        res = {"meta": {"symbol": "X.NS"}, "timestamp": stamps,
               "indicators": {"quote": [{"open": [1] * 5, "high": [1] * 5, "low": [1] * 5, "close": [1] * 5,
                                         "volume": [0] * 5}]}}
        meta, bars, dropped = tm.parse_bars(res, tm.parse_now("2026-11-03T00:00Z"))
        self.assertEqual([(b["date"], b["start"], b["slot"]) for b in bars],
                         [("2026-10-30", "09:15", 0), ("2026-11-02", "09:15", 0), ("2026-11-02", "15:00", 69)])
        self.assertEqual(dropped["outside_hours"], 2)

    def test_a_short_session_is_left_out(self):
        def cut(res):   # 2026-09-04 stops after the 12:40 bar: 42 bars, a gap in the data
            keep_bars(res, lambda ts: not (ist(ts).date().isoformat() == "2026-09-04"
                                           and ist(ts).hour * 60 + ist(ts).minute >= 12 * 60 + 45))
        doc = machine(text=edited(cut), replays=300)
        self.assertEqual(doc["mc"]["pool_sessions"], 56)
        self.assertEqual(doc["data"]["short_sessions_left_out"], [{"date": "2026-09-04", "bars": 42}])
        self.assertEqual(doc["history"]["sessions"], 56)
        self.assertNotIn("2026-09-04", [t["date"] for t in doc["history"]["trades"]])
        self.assertIn("Left out 1 short session", "\n".join(tm.report(doc)))

    def test_nse_holidays_are_not_sessions(self):
        days = {b["date"] for b in tm.parse_bars(self.result, NOW_UTC)[1]}
        self.assertNotIn("2026-09-14", days)                # Ganesh Chaturthi
        self.assertNotIn("2026-10-02", days)                # Mahatma Gandhi Jayanti
        self.assertEqual(len(days), 58)                      # 57 full sessions plus the plan's day

    def test_today_is_not_in_the_pool(self):
        doc = machine(replays=200)
        self.assertEqual(doc["mc"]["pool_to"], "2026-10-16")
        self.assertNotIn("2026-10-19", [t["date"] for t in doc["history"]["trades"]])

    def test_a_missing_price_is_dropped(self):
        def hole(res):
            res["indicators"]["quote"][0]["close"][5] = None   # 2026-07-27 09:40
        doc = machine(text=edited(hole), replays=200)
        self.assertEqual(doc["data"]["dropped"]["no_price"], 1)
        self.assertEqual(doc["mc"]["pool_sessions"], 56)

    def test_empty_and_broken_data(self):
        empty = json.dumps({"chart": {"result": [{"meta": {"symbol": "SYNTH.NS"}, "timestamp": [],
                                                  "indicators": {"quote": [{}]}}], "error": None}})
        with self.assertRaises(tm.TMError) as cm:
            machine(text=empty)
        self.assertIn("no complete 5-minute bars", str(cm.exception))
        gone = json.dumps({"chart": {"result": None, "error": {"code": "Not Found",
                                                               "description": "No data found, symbol may be delisted"}}})
        with self.assertRaises(tm.TMError) as cm:
            machine(text=gone)
        self.assertIn("No data found", str(cm.exception))
        with self.assertRaises(tm.TMError):
            machine(text="<html>rate limited</html>")

    def test_fewer_than_20_sessions_is_refused(self):
        def trim(res):
            keep_bars(res, lambda ts: ist(ts).date().isoformat() >= "2026-09-21")
        with self.assertRaises(tm.TMError) as cm:
            machine(text=edited(trim))
        self.assertIn("only 19 full session(s)", str(cm.exception))
        self.assertIn("at least 20", str(cm.exception))

        def twenty(res):
            keep_bars(res, lambda ts: ist(ts).date().isoformat() >= "2026-09-18")
        self.assertEqual(machine(text=edited(twenty), replays=200)["mc"]["pool_sessions"], 20)

    def test_the_data_must_be_the_plans_symbol(self):
        with self.assertRaises(tm.TMError) as cm:
            machine(plan(symbol="RELIANCE"))
        self.assertIn("data is for SYNTH", str(cm.exception))
        self.assertEqual(plan(symbol="synth.ns")["symbol"], "SYNTH")


class Plans(unittest.TestCase):
    def test_an_entry_not_in_the_data_is_refused(self):
        with self.assertRaises(tm.TMError) as cm:
            machine(plan(date="2026-10-21"))
        self.assertIn("no bars for that day", str(cm.exception))
        with self.assertRaises(tm.TMError) as cm:
            machine(plan(date="2026-10-20"))
        self.assertIn("NSE was closed: NSE holiday: Dussehra", str(cm.exception))
        with self.assertRaises(tm.TMError) as cm:      # the 10:30 bar has not closed in this data
            machine(plan(entry_time="10:35", entry_bar=None))
        self.assertIn("the data stops at the 10:25 bar", str(cm.exception))

    def test_plan_checks(self):
        cases = [
            (dict(entry_time="10:02", entry_bar=None), "5-minute grid"),
            (dict(entry_time="15:30", entry_bar=None), "between 09:20 and 15:25"),
            (dict(entry_bar=10), "disagrees with itself: entry_bar 10 is the 10:05 to 10:10 bar"),
            (dict(entry_time=None, entry_bar=None), "entry_time"),
            (dict(interval="1m"), "7 days of 1-min bars"),
            (dict(stop=365.0), "stop < entry < target"),
            (dict(side="short"), "buy or sell"),
            (dict(symbol=""), "NSE symbol"),
            (dict(symbol="NOT OK"), "NSE symbol"),
            (dict(entry="abc"), "number for entry"),
            (dict(date="Oct 19"), "date like"),
            (dict(opening_range={"minutes": 7}), "multiple of 5"),
            (dict(timezone="ET"), "India-time plans"),
            (dict(exchange="BSE"), "NSE plans"),
            (dict(qty=0), "whole number of shares"),
            (dict(qty=1.5), "whole number of shares"),
        ]
        for change, words in cases:
            with self.assertRaises(tm.TMError, msg=change) as cm:
                plan(**change)
            self.assertIn(words, str(cm.exception), change)

    def test_entry_bar_or_entry_time_alone(self):
        self.assertEqual(plan(entry_time=None)["entry_time"], "10:00")
        self.assertEqual(plan(entry_bar=None)["entry_bar"], 8)
        self.assertEqual(plan(entry_time="10:00 AM", entry_bar=None)["entry_bar"], 8)
        self.assertEqual(plan(entry_time="10:00am", entry_bar=None)["entry_bar"], 8)
        # entry_time is the bar's close; a plan that writes the bar's start next to its entry_bar is read too
        self.assertEqual(plan(entry_time="09:55")["entry_bar"], 8)
        self.assertEqual(plan(entry_time="09:55", entry_bar=None)["entry_bar"], 7)

    def test_until_and_flat_by(self):
        doc = machine(until="14:30", replays=500)
        m = doc["mc"]
        self.assertEqual((m["until"], m["bars_left"], m["band_times"][-1], m["until_from"]),
                         ("14:30", 54, "14:30", "--until"))
        self.assertIn("still open at 14:30", "\n".join(tm.report(doc)))
        self.assertEqual(machine(until="2:30 PM", replays=500)["mc"], m)
        self.assertEqual(machine(plan(flat_by="14:45"), replays=50)["mc"]["until_from"], "the plan's flat_by")
        self.assertEqual(machine(plan(flat_by="14:45"), replays=50)["mc"]["until"], "14:45")
        self.assertEqual((machine(plan(flat_by=None), replays=50)["mc"]["until"],
                          machine(plan(flat_by=None), replays=50)["mc"]["until_from"]), ("15:00", "the default flat-by"))
        for bad, words in (("10:00", "nothing to replay"), ("15:35", "no later than the 15:30 close"),
                           ("14:32", "5-minute grid"), ("noon", "India time")):
            with self.assertRaises(tm.TMError) as cm:
                machine(until=bad, replays=10)
            self.assertIn(words, str(cm.exception), bad)
        with self.assertRaises(tm.TMError) as cm:
            machine(plan(flat_by="16:00"), replays=10)
        self.assertIn("the plan's flat_by 16:00", str(cm.exception))

    def test_a_late_until_warns_about_square_off_and_the_auction(self):
        doc = machine(until="15:30", replays=200)
        self.assertEqual(doc["mc"]["bars_left"], 66)
        self.assertIn("after 15:10, when Angel One and Dhan square off intraday (MIS) positions", doc["warnings"][0])
        self.assertIn("F&O stocks also stop continuous trading at 15:15 until 2026-12-06", doc["warnings"][0])
        self.assertEqual(machine(until="15:10", replays=50)["warnings"], [])

    def test_an_entry_outside_its_bar_is_flagged(self):
        doc = machine(plan(entry=368.0, stop=362.0, target=374.0), replays=200)
        self.assertIn("outside that bar's range", doc["warnings"][0])

    def test_stops_and_targets_on_the_tick_grid(self):
        self.assertEqual(tm.tick_away(358.325, True), 358.30)     # a buy's stop rounds down to the 0.05 tick
        self.assertEqual(tm.tick_away(358.325, False), 358.35)    # a sell's stop rounds up
        self.assertEqual(tm.tick_away(354.4700012207031, True), 354.45)
        self.assertEqual(tm.tick_away(12.345, True), 12.34)       # under ₹250 the tick is 0.01
        self.assertEqual(tm.tick_toward(311.09, True), 311.05)    # a buy's target never rounds up
        self.assertEqual(tm.tick_toward(300.01, False), 300.05)
        for t in machine(replays=50)["history"]["trades"]:
            for px in (t["stop"], t["target"]):
                self.assertAlmostEqual(px / float(tm.tick_size(px)), round(px / float(tm.tick_size(px))), places=6)

    def test_the_stop_rule_is_worked_out_when_not_given(self):
        rule = machine(plan(stop_rule=None), replays=100)["history"]["rule"]
        self.assertEqual(rule["stop_rule"], "or_mid")
        rule = machine(plan(stop_rule=None, stop=354.45, target=373.90), replays=100)["history"]["rule"]
        self.assertEqual((rule["stop_rule"], rule["target_r"]), ("or_low", 1.0))
        rule = machine(plan(stop_rule="atr", stop=360.0, target=372.50), replays=100)["history"]["rule"]
        self.assertEqual((rule["stop_rule"], rule["stop_pct"], rule["target_r"]), ("pct", 1.1478, 1.99))

    def test_a_setup_other_than_orb_skips_the_history(self):
        doc = machine(plan(setup="flag"), replays=200)
        self.assertIsNone(doc["history"]["rule"])
        self.assertIn("orb", doc["history"]["note"])
        self.assertEqual(doc["mc"]["pool_sessions"], 57)
        self.assertIn("History: skipped", "\n".join(tm.report(doc)))

    def test_a_sell_plan_mirrors_the_rules(self):
        doc = machine(plan(side="sell", stop=370.05, target=358.30, stop_rule="or_high"), replays=2000)
        m = doc["mc"]
        self.assertAlmostEqual(m["p_target"] + m["p_stop"] + m["p_neither"], 1.0, places=6)
        self.assertEqual(m["r_at_target"], 1.0017)
        self.assertEqual(doc["history"]["rule"]["stop_rule"], "or_high")
        self.assertEqual(doc["history"]["triggered"], 25)
        for t in doc["history"]["trades"]:
            self.assertTrue(t["target"] < t["entry"] < t["stop"], t)
        self.assertEqual(doc["costs"]["at_stop"]["total"], 0.39)   # sell 364.18 first, buy back 370.05
        self.assertIn("below the entry", "\n".join(tm.report(doc)))

    def test_the_verdict_thresholds_at_1r(self):
        self.assertTrue(tm.verdict({"p_target": 0.30, "p_stop": 0.26}).startswith("Close to a coin flip"))
        self.assertTrue(tm.verdict({"p_target": 0.40, "p_stop": 0.30}).startswith("Leans toward the target"))
        self.assertTrue(tm.verdict({"p_target": 0.20, "p_stop": 0.30}).startswith("Leans toward the stop"))
        self.assertTrue(tm.verdict({"p_target": 0.60, "p_stop": 0.30}).startswith("Strongly toward the target"))
        self.assertEqual(tm.verdict({"p_target": 0.10, "p_stop": 0.60, "r_at_target": 1.0}),
                         "Strongly toward the stop: target first 10.0 % vs stop first 60.0 %.")
        self.assertEqual(tm.verdict({"p_target": 0.0, "p_stop": 0.0, "until": "14:45"}),
                         "No replay reached the target or the stop by 14:45: the price at 14:45 decides every one.")

    def test_a_2r_target_is_judged_against_its_break_even(self):
        mc = {"p_target": 0.241, "p_stop": 0.505, "p_neither": 0.254, "r_at_target": 2.0, "avg_R": 0.095}
        self.assertEqual(tm.verdict(mc), "Close to break-even: at 2R the target has to come first in 33 % of the "
                                         "replays that hit one side; it did in 32 % (target first 24.1 % vs stop "
                                         "first 50.5 %).")
        self.assertEqual(tm.verdict_notes(mc), [])
        lean = dict(mc, p_target=0.15, p_stop=0.55)
        self.assertTrue(tm.verdict(lean).startswith("Leans toward the stop: at 2R the target has to come first in "
                                                    "33 % of the replays that hit one side; it did in 21 %"))
        self.assertEqual(tm.verdict_notes(lean), ["Average R is +0.095 all the same: the replays that hit neither "
                                                  "pull it the other way."])
        self.assertEqual(tm.verdict_notes(dict(mc, avg_R_net=-0.01)),
                         ["Charges turn the average R from +0.095 to -0.010 net of costs."])
        self.assertEqual(tm.verdict_notes(dict(mc, avg_R_net=0.02)), [])
        self.assertTrue(tm.verdict(dict(mc, p_target=0.30, p_stop=0.40)).startswith("Leans toward the target"))
        self.assertTrue(tm.verdict(dict(mc, p_target=0.40, p_stop=0.40)).startswith("Strongly toward the target"))
        self.assertIn("at 1.5R the target has to come first in 40 %", tm.verdict(dict(mc, r_at_target=1.5)))

    def test_2r_on_the_fixture_near_break_even(self):
        # stop 362.00, target 368.50 (2R 368.54 down to the tick: 1.98R): 33.9 % vs 59.6 % looks lopsided,
        # but at 1.98R the target only needs a third of the replays that hit a side
        doc = machine(plan(stop=362.0, target=368.50, stop_rule="pct"))
        m = doc["mc"]
        self.assertEqual((m["r_at_target"], m["p_target"], m["p_stop"], m["avg_R"], m["avg_R_net"]),
                         (1.9817, 0.3387, 0.5963, 0.109, -0.07))
        self.assertEqual(doc["verdict"], "Close to break-even: at 1.98R the target has to come first in 34 % of the "
                                         "replays that hit one side; it did in 36 % (target first 33.9 % vs stop "
                                         "first 59.6 %).")
        self.assertEqual(doc["verdict_notes"], ["Charges turn the average R from +0.109 to -0.070 net of costs."])

    def test_2r_on_the_fixture_a_clear_lean(self):
        # the plan's entry and stop with a 2R target (375.94 down to 375.90): target first only 2.6 %
        doc = machine(plan(target=375.90))
        m = doc["mc"]
        self.assertEqual((m["r_at_target"], m["p_target"], m["p_stop"], m["p_neither"], m["avg_R"], m["avg_R_net"]),
                         (1.9932, 0.0257, 0.2132, 0.7611, 0.06, -0.006))
        self.assertEqual(doc["verdict"], "Strongly toward the stop: at 1.99R the target has to come first in 33 % of "
                                         "the replays that hit one side; it did in 11 % (target first 2.6 % vs stop "
                                         "first 21.3 %).")
        self.assertEqual(doc["verdict_notes"], [
            "76.1 % of the replays hit neither by 15:00; the price at 15:00 decides those.",
            "Average R is +0.060 all the same: the replays that hit neither pull it the other way.",
            "Charges turn the average R from +0.060 to -0.006 net of costs."])
        text = "\n".join(tm.report(doc))
        self.assertIn("\n".join([doc["verdict"]] + doc["verdict_notes"]), text)

    def test_no_us_logic_left(self):
        for name in ("eastern_offset", "NYSE_EARLY_CLOSE", "cents_away", "clock12"):
            self.assertFalse(hasattr(tm, name), name)
        self.assertEqual((tm.SESSION_BARS, tm.OPEN_MIN, tm.CLOSE_MIN), (75, 555, 930))


class Network(unittest.TestCase):
    def setUp(self):
        self.calls, self.sleeps = [], []
        self._get, self._sleep = tm._get, tm._sleep
        tm._sleep = self.sleeps.append

    def tearDown(self):
        tm._get, tm._sleep = self._get, self._sleep

    def answer(self, codes):
        codes = list(codes)

        def fake(url, timeout=20):
            self.calls.append(url.split(".finance")[0].split("//")[1])
            code = codes.pop(0)
            if code != 200:
                raise urllib.error.HTTPError(url, code, "x", {}, io.BytesIO(b""))
            return TEXT
        tm._get = fake

    def test_url_and_user_agent(self):
        self.assertEqual(tm.chart_url("synth"),
                         "https://query2.finance.yahoo.com/v8/finance/chart/SYNTH.NS?range=60d&interval=5m")
        self.assertIn("/chart/M%26M.NS?", tm.chart_url("m&m", "query1"))
        self.assertIn("/chart/BAJAJ-AUTO.NS?", tm.chart_url("BAJAJ-AUTO"))
        self.assertEqual(tm.UA, "Mozilla/5.0 (compatible; india-trader-skill/1.0)")

    def test_429_waits_retries_then_falls_back_to_query1(self):
        self.answer([429, 429, 200])
        self.assertEqual(tm.fetch_chart("SYNTH"), TEXT)
        self.assertEqual(self.calls, ["query2", "query2", "query1"])
        self.assertEqual(self.sleeps, [tm.BACKOFF, tm.PAUSE])

    def test_one_429_then_ok(self):
        self.answer([429, 200])
        self.assertEqual(tm.fetch_chart("SYNTH"), TEXT)
        self.assertEqual(self.calls, ["query2", "query2"])

    def test_5xx_falls_back(self):
        self.answer([503, 200])
        self.assertEqual(tm.fetch_chart("SYNTH"), TEXT)
        self.assertEqual(self.calls, ["query2", "query1"])

    def test_rate_limited_everywhere_is_one_plain_line(self):
        self.answer([429, 429, 429, 429])
        with self.assertRaises(tm.TMError) as cm:
            tm.fetch_chart("SYNTH")
        self.assertIn("rate limiting", str(cm.exception))

    def test_404(self):
        self.answer([404])
        with self.assertRaises(tm.TMError) as cm:
            tm.fetch_chart("ZZZZ")
        self.assertIn("ZZZZ.NS", str(cm.exception))
        self.assertIn("check the NSE symbol", str(cm.exception))

    def test_run_over_the_network_path(self):
        self.answer([200])
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, "plan.json")
            with open(p, "w") as fh:
                json.dump(PLAN, fh)
            code, text, _ = run(["run", "--plan", p, "--now", NOW, "--replays", "300",
                                 "--orders", os.path.join(d, "none.json"), "--config", os.path.join(d, "none.json")])
            self.assertEqual(code, 0)
            self.assertEqual(self.calls, ["query2"])
        finally:
            shutil.rmtree(d)


class Cli(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.t = os.path.join(self.d, "trader-india")
        os.makedirs(self.t)
        self.plan = os.path.join(self.t, "plan.json")
        with open(self.plan, "w") as fh:
            json.dump(PLAN, fh, indent=2)
        self.out = os.path.join(self.t, "timemachine.json")
        self.none = ["--orders", os.path.join(self.d, "no-orders.json"), "--config", os.path.join(self.d, "no.json")]

    def tearDown(self):
        shutil.rmtree(self.d)

    def test_run_with_the_plan_end_to_end(self):
        code, text, err = run(["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--write", self.out]
                              + self.none)
        self.assertEqual(code, 0, err)
        self.assertIn("target first   26.1 %", text)
        self.assertIn("Leans toward the target: target first 26.1 % vs stop first 21.3 %.", text)
        self.assertIn("Wrote %s." % self.out, text)
        self.assertIn("/india-budget", text)
        with open(self.out, encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(sorted(k for k in ("plan", "mc", "history", "costs") if k in doc),
                         ["costs", "history", "mc", "plan"])
        self.assertEqual((doc["created_by"], doc["source"], doc["exchange"]), ("india-timemachine", "offline", "NSE"))
        self.assertEqual((doc["mc"]["p_target"], doc["mc"]["avg_R"], doc["mc"]["avg_R_net"]), (0.2608, 0.053, -0.012))
        self.assertEqual(sha(doc["mc"]["sample_paths"]), PATHS)
        self.assertEqual((doc["history"]["triggered"], doc["history"]["avg_R"]), (32, -0.05))
        self.assertEqual(doc["plan"]["from"], self.plan)

    def test_costs_take_the_qty_from_orders_or_the_flag(self):
        orders = os.path.join(self.t, "orders.json")
        with open(orders, "w") as fh:
            json.dump({"created_by": "india-budget", "orders": [ORDER]}, fh)
        cfg = os.path.join(self.d, "no.json")
        code, text, err = run(["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--replays", "2000",
                               "--orders", orders, "--config", cfg])
        self.assertEqual(code, 0, err)
        self.assertIn("Costs on 160 shares (from %s): ₹61.33 round trip at the stop (0.065R)" % orders, text)
        code, text, err = run(["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--replays", "2000",
                               "--orders", orders, "--config", cfg, "--qty", "50", "--json"])
        doc = json.loads(text)
        self.assertEqual((doc["costs"]["qty"], doc["costs"]["qty_from"]), (50, "--qty"))
        with open(cfg, "w") as fh:
            json.dump({"brokerage_flat_inr": 0, "brokerage_pct": 0}, fh)
        code, text, err = run(["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--replays", "200",
                               "--orders", orders, "--config", cfg, "--json"])
        self.assertEqual(json.loads(text)["costs"]["at_stop"]["brokerage"], 0.0)
        code, _, err = run(["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--qty", "lots"])
        self.assertEqual(code, 1)
        self.assertIn("whole number of shares", err)

    def test_json_output(self):
        code, text, _ = run(["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--json"] + self.none)
        self.assertEqual(code, 0)
        doc = json.loads(text)
        self.assertEqual(doc["mc"]["p_stop"], 0.2126)
        self.assertNotIn("sample_paths", doc["mc"])
        self.assertEqual(doc["verdict"][:23], "Leans toward the target")
        self.assertFalse(os.path.exists(self.out))

    def test_the_plan_as_flags_matches_the_file(self):
        code, text, err = run(["run", "--symbol", "synth", "--date", "2026-10-19", "--entry", "364.18",
                               "--stop", "358.30", "--target", "370.05", "--entry-time", "10:00",
                               "--offline", SYNTH, "--now", NOW, "--json"] + self.none)
        self.assertEqual(code, 0, err)
        doc = json.loads(text)
        self.assertEqual((doc["mc"]["p_target"], doc["mc"]["p_green"]), (0.2608, 0.5296))
        self.assertEqual((doc["mc"]["until"], doc["mc"]["until_from"]), ("15:00", "the default flat-by"))
        self.assertEqual(doc["plan"]["stop_rule"], "or_mid")
        self.assertEqual((doc["history"]["target"], doc["history"]["stop"], doc["history"]["avg_R"]), (13, 15, -0.05))
        code, _, err = run(["run", "--symbol", "SYNTH", "--entry", "364.18", "--offline", SYNTH])
        self.assertEqual(code, 1)
        self.assertIn("--stop", err)

    def test_offline_folder_and_default_paths(self):
        shutil.copy(SYNTH, self.d)
        cwd = os.getcwd()
        os.chdir(self.d)
        try:
            code, text, err = run(["run", "--offline", ".", "--now", NOW, "--replays", "500", "--write"])
            self.assertEqual(code, 0, err)
            self.assertTrue(os.path.exists(os.path.join("trader-india", "timemachine.json")))
            code, text, err = run(["chart", "--from"])
            self.assertEqual(code, 0, err)
            self.assertIn("* median", text)
            with open(os.path.join("trader-india", "timemachine.json"), encoding="utf-8") as fh:
                self.assertEqual(json.load(fh)["mc"]["replays"], 500)
        finally:
            os.chdir(cwd)

    def test_errors_are_one_plain_line(self):
        bad_cfg = os.path.join(self.d, "bad.json")
        with open(bad_cfg, "w") as fh:
            json.dump({"brokerage_pct": "lots"}, fh)
        for argv in (["run", "--plan", os.path.join(self.d, "nope.json")],
                     ["run", "--plan", self.plan, "--offline", os.path.join(self.d, "missing.json.gz")],
                     ["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--until", "9:00"],
                     ["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--config", bad_cfg],
                     ["run", "--plan", self.plan, "--offline", SYNTH, "--now", "tomorrow"],
                     ["chart", "--from", os.path.join(self.d, "nope.json")]):
            code, text, err = run(argv)
            self.assertEqual(code, 1, argv)
            self.assertEqual(len(err.strip().splitlines()), 1, err)
            self.assertTrue(err.startswith("timemachine.py: "), err)
            self.assertNotIn("Traceback", err)
        self.assertEqual(run([])[0], 1)

    def test_chart(self):
        run(["run", "--plan", self.plan, "--offline", SYNTH, "--now", NOW, "--write", self.out] + self.none)
        code, text, _ = run(["chart", "--from", self.out])
        self.assertEqual(code, 0)
        lines = text.splitlines()
        self.assertIn("2,000 replay paths from the 10:00 IST entry (seed 19)", lines[0])
        self.assertTrue(any(l.startswith("   370.05 |") and l.endswith("  target") for l in lines))
        self.assertTrue(any(l.startswith("   358.30 |") and l.endswith("  stop") for l in lines))
        self.assertTrue(any(l.startswith("   364.18 |*") and l.endswith("  entry") for l in lines))
        self.assertIn("10:00", text)
        self.assertIn("15:00", text)
        self.assertEqual(lines[-3:], ["Leans toward the target: target first 26.1 % vs stop first 21.3 %.",
                                      "52.7 % of the replays hit neither by 15:00; the price at 15:00 decides those.",
                                      "Charges turn the average R from +0.053 to -0.012 net of costs."])
        code, again, _ = run(["chart", "--plan", self.plan, "--offline", SYNTH, "--now", NOW] + self.none)
        self.assertEqual(again, text)

    def test_no_em_dashes_in_the_script(self):
        with open(os.path.join(os.path.dirname(tm.__file__), "timemachine.py"), encoding="utf-8") as fh:
            self.assertNotIn(chr(0x2014), fh.read())


if __name__ == "__main__":
    unittest.main()
