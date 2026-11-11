"""india-alerts tests. Fixtures in fixtures/india-alerts/ are SYNTHETIC, not NSE data:

yahoo-SYN-*.json, yahoo-SYNTH.json  the US pack's Yahoo quote files run through
    fixtures/retime.py: prices unchanged, times moved so the US open lands on 09:15 IST,
    AAPL -> SYN-AAPL.NS, TSLA -> SYNTH.NS. SYNTH's quote is 366.475 at 10:37:13 IST
    (05:07:13Z); the SYN-* closes are from 2026-10-13, stamped 15:45 IST.
yahoo-SYN-ZZZZ.json   Yahoo's own answer for an unknown symbol.
plan-SYNTH.json       trader-india/plan.json as india-exit writes it for the synthetic
    reel (stop 358.30, target 370.05, flat by 15:00); test_exit checks it stays so.
"""

import datetime
import gzip
import io
import json
import os
import shutil
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout, redirect_stderr

from _load import load, ROOT, FIX

alerts = load("india-alerts", "alerts")

QDIR = os.path.join(FIX, "india-alerts")
PLAN = os.path.join(QDIR, "plan-SYNTH.json")
DT = datetime.datetime
UA = "Mozilla/5.0 (compatible; india-day-trader-skill/1.0)"
HERE = os.path.dirname(os.path.abspath(__file__))


def ist(text):
    return alerts.parse_now(text)


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = alerts.main(argv)
    return code, out.getvalue(), err.getvalue()


def plan_rules():
    with open(PLAN, encoding="utf-8") as fh:
        return alerts.rules_from_plan(json.load(fh))


def safety_block():
    with open(os.path.join(HERE, "CONVENTIONS.md"), encoding="utf-8") as fh:
        text = fh.read()
    a = text.index("```\n## Safety") + 4
    return text[a:text.index("\n```", a)] + "\n"


class InTempDir(unittest.TestCase):
    """Every test runs in an empty folder, so no trader-india/holidays.json leaks in."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.cwd = os.getcwd()
        os.chdir(self.d)

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.d)


class Clock(InTempDir):
    def test_parse_now_is_india_time_all_year(self):
        self.assertEqual(ist("2026-10-13T09:15"), DT(2026, 10, 13, 3, 45))
        self.assertEqual(ist("2026-10-19 10:00"), DT(2026, 10, 19, 4, 30))
        self.assertEqual(ist("2026-12-01T09:15"), DT(2026, 12, 1, 3, 45))      # no daylight saving
        self.assertEqual(ist("2026-10-13T10:15:01Z"), DT(2026, 10, 13, 10, 15, 1))
        with self.assertRaises(alerts.CoreError):
            ist("tomorrow")

    def test_market_status(self):
        st = alerts.market_status(ist("2026-10-13T10:00"))
        self.assertTrue(st["open"])
        self.assertEqual((st["reason"], st["opens"], st["closes"]), ("normal market", "09:15", "15:30"))
        pre = alerts.market_status(ist("2026-10-13T09:05"))
        self.assertFalse(pre["open"])
        self.assertEqual(pre["reason"], "pre-open call auction")
        self.assertEqual(pre["next_open"], "2026-10-13 09:15")
        self.assertEqual(alerts.market_status(ist("2026-10-13T08:30"))["reason"], "before the pre-open")
        self.assertTrue(alerts.market_status(ist("2026-10-13T09:15"))["open"])
        self.assertTrue(alerts.market_status(ist("2026-10-13T15:29"))["open"])
        after = alerts.market_status(ist("2026-10-13T15:30"))
        self.assertFalse(after["open"])
        self.assertEqual(after["next_open"], "2026-10-14 09:15")
        dussehra = alerts.market_status(ist("2026-10-20T11:00"))
        self.assertFalse(dussehra["open"])
        self.assertIn("Dussehra", dussehra["reason"])
        self.assertEqual(dussehra["next_open"], "2026-10-21 09:15")
        self.assertEqual(alerts.market_status(ist("2026-10-19T15:45"))["next_open"], "2026-10-21 09:15")
        self.assertIn("Diwali Balipratipada", alerts.market_status(ist("2026-11-10T10:00"))["reason"])
        xmas = alerts.market_status(ist("2026-12-25T10:00"))
        self.assertEqual(xmas["next_open"], "2026-12-28 09:15")
        self.assertEqual(alerts.market_status(ist("2026-10-17T10:00"))["reason"], "weekend")
        self.assertTrue(alerts.market_status(ist("2026-12-31T10:00"))["calendar_known"])
        self.assertFalse(alerts.market_status(ist("2027-01-04T10:00"))["calendar_known"])

    def test_clock_shows_the_pre_open_and_the_auction_rule(self):
        code, text, _ = run(["clock", "--now", "2026-10-19 09:05"])
        self.assertEqual(code, 1)
        self.assertIn("India time 2026-10-19 09:05 (Monday): NSE closed, pre-open call auction.", text)
        self.assertIn("pre-open call auction 09:00 to 09:15, normal market 09:15 to 15:30", text)
        self.assertIn("stop continuous trading at 15:15", text)                # until 2026-12-06
        self.assertIn("Next open: 2026-10-19 09:15 India time.", text)
        code, text, _ = run(["clock", "--now", "2026-12-07 10:00"])
        self.assertEqual(code, 0)
        self.assertIn("NSE OPEN, normal market", text)
        self.assertNotIn("15:15", text)
        code, text, _ = run(["clock", "--now", "2026-12-25T10:00"])
        self.assertEqual(code, 1)
        self.assertIn("NSE holiday: Christmas", text)
        code, text, _ = run(["clock", "--now", "2026-10-19 10:00", "--json"])
        st = json.loads(text)
        self.assertEqual((st["now_india"], st["open"], st["auction_stocks_end"]), ("2026-10-19 10:00", True, "15:15"))

    def test_clock_warns_about_an_unknown_year_and_takes_holidays_json(self):
        code, text, _ = run(["clock", "--now", "2027-01-26 10:00"])
        self.assertEqual(code, 0)                                          # not known yet: counted as open
        self.assertIn("covers 2026 only, not 2027", text)
        self.assertIn("trader-india/holidays.json", text)
        os.mkdir("trader-india")
        with open(os.path.join("trader-india", "holidays.json"), "w") as fh:
            json.dump({"2027-01-26": "Republic Day"}, fh)
        code, text, _ = run(["clock", "--now", "2027-01-26 10:00"])
        self.assertEqual(code, 1)
        self.assertIn("NSE holiday: Republic Day", text)
        self.assertNotIn("covers 2026 only", text)
        with open(os.path.join("trader-india", "holidays.json"), "w") as fh:
            fh.write("{nope")
        code, _, err = run(["clock", "--now", "2027-01-26 10:00"])
        self.assertEqual(code, 1)
        self.assertIn("could not read trader-india/holidays.json", err)


class Quotes(unittest.TestCase):
    def test_the_fixtures_are_synthetic(self):
        with open(os.path.join(QDIR, "yahoo-SYNTH.json")) as fh:
            d = json.load(fh)
        self.assertIn("SYNTHETIC", d["_provenance"])
        m = d["chart"]["result"][0]["meta"]
        self.assertEqual((m["symbol"], m["currency"], m["exchangeTimezoneName"]), ("SYNTH.NS", "INR", "Asia/Kolkata"))

    def test_yahoo_fixtures(self):
        with open(os.path.join(QDIR, "yahoo-SYN-AAPL.json")) as fh:
            q = alerts.parse_yahoo(fh.read(), "SYN-AAPL")
        self.assertEqual((q["symbol"], q["price"], q["prev_close"], q["currency"]), ("SYN-AAPL", 341.27, 340.97, "INR"))
        self.assertEqual(q["time"], "2026-10-13T10:15:01Z")
        with open(os.path.join(QDIR, "yahoo-SYNTH.json")) as fh:
            text = fh.read()
        q = alerts.parse_yahoo(text, "synth.ns")
        self.assertEqual((q["price"], q["prev_close"], round(q["open"], 2)), (366.475, 354.72, 357.48))
        self.assertEqual(q["time"], "2026-10-19T05:07:13Z")                  # 10:37:13 India time
        with self.assertRaises(alerts.AlertError) as cm:
            alerts.parse_yahoo(text, "RELIANCE")
        self.assertIn("holds SYNTH", str(cm.exception))

    def test_urls_and_user_agent(self):
        self.assertEqual(alerts.UA, UA)
        self.assertEqual(alerts.yahoo_url("reliance"),
                         "https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=1d")
        self.assertEqual(alerts.yahoo_url("M&M"),
                         "https://query2.finance.yahoo.com/v8/finance/chart/M%26M.NS?range=1d&interval=1d")
        self.assertIn("/chart/BAJAJ-AUTO.NS?", alerts.yahoo_url("NSE:bajaj-auto"))
        self.assertIn("//query1.finance.yahoo.com/", alerts.yahoo_url("SYNTH", alerts.YAHOO_HOSTS[1]))

    def test_offline_quotes_and_errors(self):
        q, errors = alerts.get_quotes(["SYN-AAPL", "SYN-KO", "SYN-ZZZZ", "NOPE", "not a symbol"], QDIR)
        self.assertEqual(sorted(q), ["SYN-AAPL", "SYN-KO"])
        self.assertEqual(q["SYN-KO"]["price"], 90.11)
        self.assertEqual(len(errors), 3)
        self.assertIn("No data found", errors[0])
        self.assertIn("no offline quote file", errors[1])
        self.assertIn("is not an NSE symbol", errors[2])

    def test_offline_gz(self):
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(QDIR, "yahoo-SYNTH.json"), "rb") as src:
                with gzip.open(os.path.join(d, "yahoo-SYNTH.json.gz"), "wb") as dst:
                    dst.write(src.read())
            q, errors = alerts.get_quotes(["SYNTH"], d)
            self.assertEqual((q["SYNTH"]["price"], errors), (366.475, []))
        finally:
            shutil.rmtree(d)


class FakeNet(object):
    """Stands in for urllib: answers each request with the next status code."""

    def __init__(self, codes, body=None):
        self.codes, self.calls, self.sleeps = list(codes), [], []
        with open(os.path.join(QDIR, "yahoo-SYNTH.json")) as fh:
            self.body = body or fh.read()

    def urlopen(self, req, timeout=None):
        self.calls.append((req.full_url.split("/")[2], req.get_header("User-agent"), req.full_url))
        code = self.codes.pop(0)
        if code != 200:
            fp = io.BytesIO(b'{"chart":{"result":null,"error":{"code":"Not Found",'
                            b'"description":"No data found, symbol may be delisted"}}}' if code == 404 else b"")
            raise urllib.error.HTTPError(req.full_url, code, "x", {}, fp)
        return io.BytesIO(self.body.encode("utf-8"))


class Network(unittest.TestCase):
    def setUp(self):
        self.saved = (alerts._urlopen, alerts._sleep)

    def tearDown(self):
        alerts._urlopen, alerts._sleep = self.saved

    def net(self, codes):
        f = FakeNet(codes)
        alerts._urlopen = f.urlopen
        alerts._sleep = f.sleeps.append
        return f

    def hosts(self, f):
        return [c[0].split(".")[0] for c in f.calls]

    def test_query2_first_with_the_user_agent_and_dot_ns(self):
        f = self.net([200])
        q, errors = alerts.get_quotes(["SYNTH"])
        self.assertEqual((q["SYNTH"]["price"], errors), (366.475, []))
        self.assertEqual(f.calls, [("query2.finance.yahoo.com", UA,
                                    "https://query2.finance.yahoo.com/v8/finance/chart/SYNTH.NS?range=1d&interval=1d")])

    def test_one_retry_with_a_pause_on_429(self):
        f = self.net([429, 200])
        self.assertEqual(alerts.get_quotes(["SYNTH"])[0]["SYNTH"]["price"], 366.475)
        self.assertEqual(self.hosts(f), ["query2", "query2"])
        self.assertEqual(f.sleeps, [alerts.BACKOFF])

    def test_falls_back_to_query1_on_429_and_5xx(self):
        f = self.net([429, 429, 200])
        self.assertIn("SYNTH", alerts.get_quotes(["SYNTH"])[0])
        self.assertEqual(self.hosts(f), ["query2", "query2", "query1"])
        f = self.net([503, 200])
        self.assertIn("SYNTH", alerts.get_quotes(["SYNTH"])[0])
        self.assertEqual(self.hosts(f), ["query2", "query1"])
        f = self.net([500, 502])
        q, errors = alerts.get_quotes(["SYNTH"])
        self.assertEqual(q, {})
        self.assertIn("query1.finance.yahoo.com/v8/finance/chart/SYNTH.NS answered HTTP 502", errors[0])

    def test_a_404_is_yahoos_answer_and_a_403_is_not_retried(self):
        f = self.net([404])
        q, errors = alerts.get_quotes(["NOPE"])
        self.assertIn("No data found", errors[0])
        self.assertEqual(self.hosts(f), ["query2"])
        f = self.net([403])
        q, errors = alerts.get_quotes(["SYNTH"])
        self.assertIn("HTTP 403", errors[0])
        self.assertEqual(self.hosts(f), ["query2"])

    def test_a_pause_between_symbols(self):
        f = self.net([200, 200])
        alerts.get_quotes(["SYNTH", "SYNTH"])
        self.assertEqual(f.sleeps, [alerts.PAUSE])


class Rules(InTempDir):
    def setUp(self):
        InTempDir.setUp(self)
        self.q, _ = alerts.get_quotes(["SYN-AAPL", "SYN-BAC", "SYN-KO", "SYNTH"], QDIR)
        self.open = alerts.market_status(ist("2026-10-13T10:00"))
        self.now = ist("2026-10-13T10:00")

    def at(self, text, rules, state=None, quotes=None):
        now = ist(text)
        return alerts.evaluate(rules, self.q if quotes is None else quotes, alerts.market_status(now),
                               state or {}, now)

    def test_a_level_rings_once(self):
        rules = [{"id": "aapl-340", "symbol": "SYN-AAPL", "type": "above", "price": 340}]
        rings, st = alerts.evaluate(rules, self.q, self.open, {}, self.now)
        self.assertEqual(len(rings), 1)
        self.assertIn("SYN-AAPL is ₹341.27: at or above your alert level ₹340.00", rings[0]["message"])
        rings, st = alerts.evaluate(rules, self.q, self.open, st, self.now)
        self.assertEqual(rings, [])

    def test_stop_and_rearm(self):
        rules = [{"id": "bac-stop", "symbol": "SYN-BAC", "type": "stop", "price": 54, "rearm": True}]
        rings, st = alerts.evaluate(rules, self.q, self.open, {}, self.now)
        self.assertIn("your stop ₹54.00", rings[0]["message"])
        self.q["SYN-BAC"]["price"] = 55.0
        rings, st = alerts.evaluate(rules, self.q, self.open, st, self.now)
        self.assertEqual(rings, [])
        self.assertNotIn("bac-stop", st["rung"])
        self.q["SYN-BAC"]["price"] = 53.5
        rings, st = alerts.evaluate(rules, self.q, self.open, st, self.now)
        self.assertEqual(len(rings), 1)

    def test_pct_move_from_previous_close(self):
        big = [{"id": "bac-3", "symbol": "SYN-BAC", "type": "pct_move", "pct": 3}]
        self.assertEqual(alerts.evaluate(big, self.q, self.open, {}, self.now)[0], [])
        small = [{"id": "bac-1", "symbol": "SYN-BAC", "type": "pct_move", "pct": 1, "direction": "down"}]
        rings, st = alerts.evaluate(small, self.q, self.open, {}, self.now)
        self.assertIn("-1.14%", rings[0]["message"])                           # 53.96 / 54.58 - 1
        self.assertEqual(alerts.evaluate(small, self.q, self.open, st, self.now)[0], [])
        up = [{"id": "bac-up", "symbol": "SYN-BAC", "type": "pct_move", "pct": 1, "direction": "up"}]
        self.assertEqual(alerts.evaluate(up, self.q, self.open, {}, self.now)[0], [])
        synth = [{"id": "synth-3", "symbol": "SYNTH", "type": "pct_move", "pct": 3}]
        rings, _ = self.at("2026-10-19 10:37", synth)
        self.assertIn("SYNTH moved +3.31% to ₹366.48 (from ₹354.72)", rings[0]["message"])

    def test_opening_bell_at_0915_once_per_trading_day(self):
        rules = [{"id": "bell", "type": "opening_bell"}]
        pre = alerts.market_status(ist("2026-10-13T09:10"))                    # pre-open: not yet
        self.assertEqual(alerts.evaluate(rules, {}, pre, {}, ist("2026-10-13T09:10"))[0], [])
        rings, st = self.at("2026-10-13 09:15", rules)
        self.assertIn("Opening bell: the NSE normal market is open (2026-10-13 09:15 India time, closes at 15:30)",
                      rings[0]["message"])
        self.assertEqual(self.at("2026-10-13 11:00", rules, st)[0], [])
        self.assertEqual(len(self.at("2026-10-14 09:16", rules, st)[0]), 1)
        self.assertEqual(self.at("2026-10-20 10:00", rules)[0], [])           # Dussehra

    def test_the_plan_gives_a_stop_a_target_and_flat_by(self):
        rules = plan_rules()
        self.assertEqual([(r["id"], r["type"]) for r in rules],
                         [("synth-plan-stop", "stop"), ("synth-plan-target", "target"), ("synth-flat-by", "time")])
        self.assertEqual((rules[0]["price"], rules[1]["price"]), (358.30, 370.05))
        self.assertEqual((rules[2]["at"], rules[2]["label"]), ("15:00", "flat by"))
        self.assertTrue(all(r["date"] == "2026-10-19" for r in rules))
        rings, st = self.at("2026-10-19 10:37", rules)          # the synthetic 10:37 quote, 366.475
        self.assertEqual(rings, [])
        q = json.loads(json.dumps(self.q))
        q["SYNTH"]["price"] = 358.10
        rings, st = self.at("2026-10-19 11:30", rules, st, q)
        self.assertEqual([r["id"] for r in rings], ["synth-plan-stop"])
        self.assertIn("SYNTH is ₹358.10: at or below your stop ₹358.30 (plan stop: opening-range midpoint)",
                      rings[0]["message"])
        q["SYNTH"]["price"] = 370.05
        self.assertEqual([r["id"] for r in self.at("2026-10-19 12:00", rules, st, q)[0]], ["synth-plan-target"])

    def test_a_plan_without_flat_by_gets_1500_and_a_us_plan_is_refused(self):
        with open(PLAN, encoding="utf-8") as fh:
            plan = json.load(fh)
        del plan["flat_by"]
        self.assertEqual(alerts.rules_from_plan(plan)[2]["at"], "15:00")
        self.assertEqual(alerts.rules_from_plan(plan, "14:45")[2]["at"], "14:45")
        with self.assertRaises(alerts.AlertError):
            alerts.rules_from_plan(dict(plan, exchange="NYSE"))
        with self.assertRaises(alerts.AlertError):
            alerts.rules_from_plan(dict(plan, timezone="ET"))
        with self.assertRaises(alerts.AlertError):
            alerts.rules_from_plan(dict(plan, flat_by="3pm"))

    def test_flat_by_rings_once_per_trading_day(self):
        rules = plan_rules()[2:]
        self.assertEqual(self.at("2026-10-19 14:59", rules)[0], [])
        rings, st = self.at("2026-10-19 15:00", rules)
        self.assertEqual(len(rings), 1)
        m = rings[0]["message"]
        self.assertIn("Flat by: it is 15:00 India time (set for 15:00), the market closes at 15:30", m)
        self.assertIn("india-broker flatten --symbol SYNTH", m)
        self.assertIn("Angel One and Dhan square off intraday (MIS) positions at 15:10", m)
        self.assertEqual(self.at("2026-10-19 15:20", rules, st)[0], [])
        rings, _ = self.at("2026-10-19 15:45", rules)
        self.assertIn("the market has closed", rings[0]["message"])
        self.assertEqual(self.at("2026-10-21 15:01", rules, st)[0], [])     # plan rules: their day only

    def test_time_alerts_are_india_time_on_trading_days_only(self):
        rule = [{"id": "t", "type": "time", "at": "15:00", "label": "check"}]
        self.assertEqual(self.at("2026-10-17 15:01", rule)[0], [])         # Saturday: no session
        self.assertEqual(self.at("2026-10-20 15:01", rule)[0], [])         # Dussehra
        rings, st = self.at("2026-12-01 15:00", rule)
        self.assertEqual(len(rings), 1)
        self.assertEqual(st["rung"]["t"], "2026-12-01T09:30:00Z")          # 15:00 IST is 09:30 UTC all year
        self.assertNotIn("india-broker", rings[0]["message"])               # no symbol, no flatten hint

    def test_the_example_rules_are_valid(self):
        with open(os.path.join(ROOT, "india-alerts", "alerts.example.json"), encoding="utf-8") as fh:
            ex = json.load(fh)
        self.assertIn("synthetic", ex["_example"].lower())
        for r in ex["rules"]:
            alerts.validate(r)
        self.assertEqual([r for r in ex["rules"] if r["id"].startswith("synth-plan") or r["id"] == "synth-flat-by"],
                         plan_rules())

    def test_bad_rules(self):
        with self.assertRaises(alerts.AlertError):
            alerts.evaluate([{"id": "x", "type": "moon"}], {}, self.open, {}, self.now)
        with self.assertRaises(alerts.AlertError):
            alerts.evaluate([{"id": "x", "type": "above", "symbol": "SYN-AAPL"}], {}, self.open, {}, self.now)
        with self.assertRaises(alerts.AlertError):
            alerts.evaluate([{"id": "x", "type": "time", "at": "3pm"}], {}, self.open, {}, self.now)
        with self.assertRaises(alerts.CoreError):
            alerts.evaluate([{"id": "x", "type": "above", "symbol": "no good", "price": 1}], {}, self.open, {},
                            self.now)
        with self.assertRaises(alerts.AlertError):
            alerts.rules_from_plan({"symbol": "SYNTH", "stop": 358.30})


class Cli(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.cwd = os.getcwd()
        os.chdir(self.d)
        self.rules = os.path.join(self.d, "alerts.json")
        self.state = os.path.join(self.d, "state", "alerts.json")
        self.prices = os.path.join(self.d, "prices.json")

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.d)

    def check(self, now):
        return run(["check", "--rules", self.rules, "--state", self.state, "--prices-out", self.prices,
                    "--offline", QDIR, "--now", now])

    def test_the_synthetic_trade_from_the_plan(self):
        code, text, _ = run(["add", "--from-plan", "--plan", PLAN, "--rules", self.rules, "--state", self.state,
                             "--config", os.path.join(self.d, "none")])
        self.assertEqual(code, 0)
        self.assertIn("Added synth-flat-by", text)
        self.assertEqual(run(["add", "--rules", self.rules, "--opening-bell"])[0], 0)

        code, text, _ = self.check("2026-10-19 10:37")
        self.assertEqual(code, 0)                                      # the opening bell rings first
        self.assertIn("ALERT Opening bell", text)
        code, text, _ = self.check("2026-10-19 10:38")
        self.assertEqual(code, 1)
        self.assertIn("NSE OPEN (2026-10-19 10:38 India time, normal market).", text)
        self.assertIn("Nothing hit. 4 rule(s) watched today, SYNTH ₹366.48.", text)
        with open(self.prices, encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(doc["prices"], {"SYNTH": 366.475})
        self.assertEqual((doc["currency"], doc["source"]), ("INR", "yahoo"))
        self.assertEqual(doc["detail"]["SYNTH"]["time"], "2026-10-19T05:07:13Z")
        self.assertEqual(doc["detail"]["SYNTH"]["fetched"], "2026-10-19T05:08:00Z")

        code, text, _ = self.check("2026-10-19 15:00")
        self.assertEqual(code, 0)
        self.assertIn("ALERT Flat by", text)
        self.assertIn("not an order", text)
        self.assertIn("lower price band", text)
        self.assertEqual(self.check("2026-10-19 15:02")[0], 1)
        code, text, _ = self.check("2026-10-20 10:00")                 # Dussehra: no bell
        self.assertEqual(code, 1)
        self.assertIn("NSE closed", text)
        code, text, _ = self.check("2026-10-21 09:20")
        self.assertIn("ALERT Opening bell", text)
        code, text, _ = self.check("2026-10-21 09:25")
        self.assertIn("Nothing hit. 1 rule(s) watched today.", text)

        # a new plan replaces the plan rules and re-arms them
        code, text, _ = run(["add", "--from-plan", "--plan", PLAN, "--rules", self.rules, "--state", self.state])
        with open(self.rules) as fh:
            ids = [r["id"] for r in json.load(fh)["rules"]]
        self.assertEqual(sorted(ids), ["opening-bell", "synth-flat-by", "synth-plan-stop", "synth-plan-target"])
        with open(self.state) as fh:
            self.assertNotIn("synth-flat-by", json.load(fh)["rung"])

    def test_the_default_paths_are_trader_india(self):
        os.mkdir("trader-india")
        shutil.copy(PLAN, os.path.join("trader-india", "plan.json"))
        self.assertEqual(run(["add", "--from-plan"])[0], 0)
        self.assertTrue(os.path.exists(os.path.join("trader-india", "alerts.json")))
        code, text, _ = run(["check", "--offline", QDIR, "--now", "2026-10-19 10:38"])
        self.assertEqual(code, 1)
        self.assertTrue(os.path.exists(os.path.join("trader-india", "prices.json")))
        self.assertTrue(os.path.exists(os.path.join("trader-india", "state", "alerts.json")))

    def test_a_portfolio_evening_and_morning(self):
        for args in (["--opening-bell"], ["--symbol", "SYN-AAPL", "--above", "350"], ["--symbol", "SYN-BAC", "--stop", "50"]):
            code, _, _ = run(["add", "--rules", self.rules] + args)
            self.assertEqual(code, 0)
        code, _, err = run(["add", "--rules", self.rules, "--symbol", "SYN-AAPL", "--above", "350"])
        self.assertEqual(code, 1)
        self.assertIn("already exists", err)

        code, text, _ = self.check("2026-10-13T19:00")
        self.assertEqual(code, 1)
        self.assertIn("Nothing hit", text)
        with open(self.prices) as fh:
            doc = json.load(fh)
        self.assertEqual(doc["prices"], {"SYN-AAPL": 341.27, "SYN-BAC": 53.96})

        code, text, _ = self.check("2026-10-14T09:10")                # pre-open: the bell waits
        self.assertEqual(code, 1)
        code, text, _ = self.check("2026-10-14T09:16")
        self.assertEqual(code, 0)
        self.assertIn("ALERT Opening bell", text)
        code, text, _ = self.check("2026-10-14T09:30")
        self.assertEqual(code, 1)

        code, text, _ = run(["list", "--rules", self.rules, "--state", self.state])
        self.assertIn("rang", text)
        self.assertEqual(run(["reset", "opening-bell", "--state", self.state])[0], 0)
        self.assertEqual(run(["reset", "opening-bell", "--state", self.state])[0], 1)

    def test_add_time_and_target(self):
        code, text, _ = run(["add", "--rules", self.rules, "--at", "15:00", "--label", "flat by", "--symbol", "synth"])
        self.assertEqual(code, 0)
        code, text, _ = run(["add", "--rules", self.rules, "--symbol", "m&m", "--target", "3072.70",
                             "--date", "2026-10-19"])
        self.assertEqual(code, 0)
        with open(self.rules, encoding="utf-8") as fh:
            rules = json.load(fh)["rules"]
        self.assertEqual(rules[0], {"id": "time-1500", "type": "time", "at": "15:00", "label": "flat by",
                                    "symbol": "SYNTH"})
        self.assertEqual(rules[1], {"id": "m&m-target-3072.70", "symbol": "M&M", "type": "target",
                                    "price": 3072.7, "date": "2026-10-19"})
        self.assertEqual(run(["add", "--rules", self.rules, "--at", "3pm"])[0], 1)
        code, _, err = run(["add", "--rules", self.rules, "--symbol", "not ok", "--above", "1"])
        self.assertIn("is not an NSE symbol", err)
        code, _, err = run(["add", "--rules", self.rules, "--from-plan", "--plan", os.path.join(self.d, "none")])
        self.assertEqual(code, 1)
        self.assertIn("no plan", err)

    def test_quote_write_merges(self):
        code, text, _ = run(["quote", "SYN-AAPL", "SYN-KO", "--offline", QDIR, "--write", self.prices,
                             "--now", "2026-10-13T10:15:01Z"])
        self.assertEqual(code, 0)
        self.assertIn("SYN-AAPL   ₹341.27 (+0.09% vs prev close ₹340.97)", text)
        self.assertIn("delayed", text)
        run(["quote", "syn-bac.ns", "--offline", QDIR, "--write", self.prices])
        with open(self.prices, encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(sorted(doc["prices"]), ["SYN-AAPL", "SYN-BAC", "SYN-KO"])
        self.assertEqual(doc["detail"]["SYN-KO"]["prev_close"], 89.79)
        self.assertEqual(doc["detail"]["SYN-KO"]["fetched"], "2026-10-13T10:15:01Z")

    def test_quote_holdings_from_portfolio_and_plan(self):
        pf = os.path.join(self.d, "portfolio.json")
        with open(pf, "w") as fh:
            json.dump({"cash": 0, "positions": [{"symbol": "SYN-KO", "qty": 1}, {"ticker": "SYNTH.NS"}]}, fh)
        code, text, _ = run(["quote", "--holdings", "--portfolio", pf, "--plan", PLAN, "--offline", QDIR, "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(json.loads(text)["quotes"]), ["SYN-KO", "SYNTH"])

    def test_check_without_rules(self):
        code, _, err = run(["check", "--rules", self.rules, "--offline", QDIR])
        self.assertEqual(code, 1)
        self.assertIn("no rules", err)

    def test_check_warns_about_an_unknown_year(self):
        run(["add", "--rules", self.rules, "--opening-bell"])
        code, text, _ = self.check("2027-01-04 10:00")
        self.assertIn("trader-india/holidays.json", text)


class SkillDoc(unittest.TestCase):
    def test_skill_md(self):
        with open(os.path.join(ROOT, "india-alerts", "SKILL.md"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertTrue(text.startswith("---\nname: india-alerts\n"))
        self.assertGreater(len(text.splitlines()), 60)
        self.assertEqual(text[text.index("## Safety"):], safety_block())
        low = " ".join(text.lower().split())
        for must in ("09:15", "pre-open", "15:30", "15:00", "india time", "trader-india/plan.json",
                     "trader-india/prices.json", "trader-india/holidays.json", "synthetic", ".ns",
                     "delayed", "price band", "not an order", "₹358.30", "₹370.05", "₹366.48",
                     "${claude_skill_dir}"):
            self.assertIn(must, low)
        for never in ("—", "real " + "time", "pro" + "fit", "new york", "nyse", "stooq"):
            self.assertNotIn(never, low)


if __name__ == "__main__":
    unittest.main()
