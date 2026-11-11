"""india-risk: the pre-trade check on NSE orders.

The reel order is fixtures/india-risk/orders-synth.json, written by india-budget
from the SYNTHETIC plan (the US TSLA reel moved onto the NSE tick grid and India
time, renamed SYNTH; not NSE data). Every expected number is worked out by hand.
"""
import datetime
import io
import json
import os
import re
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr

from _load import load, ROOT, FIX

check = load("india-risk", "check")
size = load("india-budget", "size")

CFG_PATH = os.path.join(ROOT, "india-budget", "config.example.json")
ORDERS_PATH = os.path.join(FIX, "india-risk", "orders-synth.json")
WATCH_PATH = os.path.join(FIX, "india-risk", "watchlist-synth.json")
PLAN_PATH = os.path.join(FIX, "india-budget", "plan-synth.json")
NO_HOLIDAYS = os.path.join(FIX, "india-risk", "absent-holidays.json")   # never created
NOW = "2026-10-19 10:00"                 # India time
TODAY = "2026-10-19"
QUOTE_TIME = datetime.datetime(2026, 10, 19, 5, 7, 13)   # a synthetic 366.50 quote at 10:37:13 India time
EQ = {"SYNTH": "EQ"}
BAND = ("price band: a stop can fail to fill if SYNTH hits its lower circuit (NSE price band); Yahoo data "
        "does not carry the band, so check it on nseindia.com")
# day-trade checks off: the long-term checks still hold
V1 = {"budget": 100000, "cash_buffer_pct": 10, "max_position_pct": 50, "max_order_inr": 80000, "min_order_inr": 500,
      "max_orders_per_day": 10, "require_stop": False, "no_entries_before": None, "no_entries_after": None,
      "max_trades_per_day": 0, "max_daily_loss_inr": 0, "max_loss_per_trade_inr": 0, "min_reward_risk": 0}
V1_TODAY = "2026-10-13"
SPLIT_PRICES = {"SYN-A": 1234.50, "SYN-B": 362.15, "SYN-C": 88.40, "SYN-D": 2510.00}


def at(text):
    return check.parse_now(text)


def cfg(**over):
    with open(CFG_PATH) as fh:
        c = json.load(fh)
    c.update(over)
    return c


def v1(**over):
    c = dict(V1)
    c.update(over)
    return c


def synth(**over):
    with open(ORDERS_PATH, encoding="utf-8") as fh:
        o = json.load(fh)["orders"][0]
    o.update(over)
    return o


def run_check(orders, c=None, now=NOW, **kw):
    kw.setdefault("holidays_path", NO_HOLIDAYS)
    kw.setdefault("series", EQ)
    return check.check(orders, cfg() if c is None else c, now=at(now) if isinstance(now, str) else now, **kw)


def order(sym, qty, price, side="buy", stop=None, target=None, bracket=False, **over):
    o = {"symbol": sym, "exchange": "NSE", "side": side, "qty": qty, "order_type": "LIMIT", "price": price,
         "trigger_price": None, "product": "INTRADAY", "validity": "DAY", "stop_loss": stop, "target": target,
         "bracket": bracket}
    o.update(over)
    return o


def placed(sym, side="buy", day=TODAY, max_loss=915.63, kind=None, status="placed"):
    r = {"symbol": sym, "side": side, "status": status, "date": day, "at": day + "T10:05:00+05:30"}
    if max_loss is not None:
        r["max_loss"] = max_loss
    if kind:
        r["kind"] = kind
    return r


def verdicts(res):
    return [r["verdict"] for r in res["results"]]


def reasons(res, i=0):
    return " | ".join(res["results"][i]["reasons"])


def warnings(res, i=0):
    return " | ".join(res["results"][i]["warnings"])


class TheReel(unittest.TestCase):
    """137 SYNTH, LIMIT 364.60, stop 358.30, target 376.00 on a fresh ₹1,00,000 paper account."""

    def test_the_synth_bracket_passes_every_check(self):
        res = run_check([synth()])
        r = res["results"][0]
        self.assertEqual(r["verdict"], "PASS", r["reasons"])
        self.assertEqual(r["reasons"], [])
        self.assertEqual(r["warnings"], [BAND])
        # the risk price is the higher of the plan's entry 364.20 and the limit 364.60
        self.assertEqual((r["kind"], r["entry_ref"], r["entry_ref_from"], r["stop"], r["target"]),
                         ("entry", 364.60, "limit", 358.30, 376.00))
        # 137 x 6.30 = 863.10 + 52.53 charges at the stop (worked out in test_budget) = 915.63
        self.assertEqual((r["risk_per_share"], r["costs_at_stop"], r["max_loss"]), (6.30, 52.53, 915.63))
        # 11.40 / 6.30 = 1.81; net (1,561.80 - 54.09) / 915.63 = 1.65
        self.assertEqual((r["reward_risk"], r["reward_risk_net"]), (1.81, 1.65))
        self.assertEqual(r["value_inr"], 49950.20)             # 137 x 364.60
        self.assertEqual(res["cash_after"], 50049.80)          # 1,00,000 - 49,950.20
        self.assertEqual((res["date"], res["now_india"], res["paper"]), (TODAY, "2026-10-19 10:00", True))
        self.assertEqual(r["max_loss"], synth()["plan"]["max_loss"])   # the same figure india-budget wrote

    def test_budget_and_risk_agree(self):
        with open(PLAN_PATH) as fh:
            plan = json.load(fh)
        for over, price in (({}, None), ({"stop": 354.45}, None), ({}, 366.50)):
            p = dict(plan, **over)
            s = size.size_trade(p, cfg(), price=price, today=TODAY)
            o = size.bracket_order(s)
            kw = {"prices": {"SYNTH": price}, "price_times": {"SYNTH": QUOTE_TIME}} if price else {}
            r = run_check([o], now="2026-10-19 10:40", **kw)["results"][0]
            self.assertEqual(r["verdict"], "PASS", (over, price, r["reasons"]))
            self.assertEqual(r["max_loss"], s["max_loss"], (over, price))
        # the run-up case: 111 shares, LIMIT 366.90, 111 x 8.60 + 42.67 = 997.27
        self.assertEqual((o["qty"], o["price"], r["max_loss"]), (111, 366.90, 997.27))

    def test_150_shares_is_blocked_by_the_max_loss_only(self):
        res = run_check([synth(qty=150)], cfg(max_position_pct=100))
        # 150 x 6.30 = 945.00 + 57.52 charges = 1,002.52
        self.assertEqual(res["results"][0]["reasons"],
                         ["loss: 150 shares x 6.30 risk a share + ₹57.52 charges = ₹1,002.52 at the stop, over your "
                          "₹1,000 max loss per trade"])
        # without the charges 945.00 fits
        res = run_check([synth(qty=150)], cfg(max_position_pct=100, include_costs_in_risk=False))
        self.assertEqual((verdicts(res), res["results"][0]["max_loss"]), (["PASS"], 945.0))

    def test_138_shares_is_over_the_position_cap(self):
        res = run_check([synth(qty=138)])
        # 138 x 364.60 = 50,314.80 > 50% of 1,00,000
        self.assertEqual(res["results"][0]["reasons"],
                         ["position: SYNTH would be ₹50,314.80, 50.3% of the ₹1,00,000 account, over your 50% cap"])

    def test_the_fingerprint_is_the_core_one(self):
        o = synth()
        self.assertEqual(check.fingerprint(o), size.fingerprint(o))
        self.assertEqual(check.fingerprint(dict(o, why="anything", plan={})), check.fingerprint(o))
        self.assertNotEqual(check.fingerprint(dict(o, qty=138)), check.fingerprint(o))
        self.assertNotEqual(check.fingerprint(dict(o, stop_loss=358.0)), check.fingerprint(o))
        self.assertEqual(run_check([o])["results"][0]["fingerprint"], check.fingerprint(o))

    def test_cli(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "state", "risk.json")
            none = os.path.join(d, "none")
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = check.main(["--orders", ORDERS_PATH, "--config", CFG_PATH, "--portfolio", none,
                                   "--prices", none, "--state", none, "--watchlist", WATCH_PATH,
                                   "--holidays", none, "--now", NOW, "--out", out])
            text = buf.getvalue()
            self.assertEqual(code, 0)
            self.assertIn("PASS  #1 buy SYNTH 137 shares, entry", text)
            self.assertIn("entry 364.60 (the limit price), stop 358.30, target 376.00: risk 6.30 a share", text)
            self.assertIn("max loss ₹915.63 = 137 x 6.30 + ₹52.53 charges (limit ₹1,000), reward:risk 1.81 (min 1), "
                          "net of charges 1.65", text)
            self.assertIn("today before this: 0 of 3 trades, ₹0 of ₹3,000 daily loss", text)
            self.assertIn("1 passed, 0 blocked at 2026-10-19 10:00 India time", text)
            self.assertIn("₹50,049.80 (paper account)", text)
            self.assertIn("not financial advice", text)
            self.assertNotIn("series:", text)                   # the watchlist says EQ
            with open(out, encoding="utf-8") as fh:
                rec = json.load(fh)
            self.assertEqual(rec["date"], TODAY)
            self.assertEqual(rec["results"][0]["kind"], "entry")
            self.assertEqual(rec["results"][0]["fingerprint"], check.fingerprint(synth()))


class IndiaRules(unittest.TestCase):
    def test_entry_window_india_time(self):
        cases = [("2026-10-19 09:29", "no new entries before 09:30 India time (it is 09:29)"),
                 ("2026-10-19 14:31", "no new entries after 14:30 India time (it is 14:31)"),
                 ("2026-10-19 09:10", "the market is closed (Mon 2026-10-19 09:10 India time (pre-open call auction)"),
                 ("2026-10-19 08:00", "the market is closed (Mon 2026-10-19 08:00 India time;"),
                 ("2026-10-19 15:30", "the market is closed"),
                 ("2026-10-17 10:00", "the market is closed today (weekend"),
                 ("2026-10-20 10:00", "the market is closed today (NSE holiday: Dussehra"),
                 ("2026-11-10 10:00", "the market is closed today (NSE holiday: Diwali Balipratipada"),
                 ("2026-10-19T03:59:00Z", "no new entries before 09:30 India time (it is 09:29)")]
        for now, want in cases:
            self.assertIn("window: " + want, reasons(run_check([synth()], now=now)), now)
        for now in ("2026-10-19 09:30", "2026-10-19 14:30", "2026-10-19T04:00:00Z", "2026-10-19T09:00:59Z"):
            self.assertEqual(verdicts(run_check([synth()], now=now)), ["PASS"], now)
        res = run_check([synth()], cfg(no_entries_before=None, no_entries_after=None), now="2026-10-17 10:00")
        self.assertEqual(verdicts(res), ["PASS"])
        with self.assertRaises(check.RiskError):
            run_check([synth()], cfg(no_entries_before="9.30am"))

    def test_the_window_is_india_time_with_no_daylight_saving(self):
        self.assertEqual(check.to_ist(at("2026-10-19 10:00")), datetime.datetime(2026, 10, 19, 10, 0))
        self.assertEqual(at("2026-10-19 10:00"), datetime.datetime(2026, 10, 19, 4, 30))
        self.assertEqual(at("2026-12-01 10:00"), datetime.datetime(2026, 12, 1, 4, 30))

    def test_2027_holidays_are_unknown_until_added(self):
        o = synth()
        res = run_check([o], now="2027-01-26 10:00")
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertIn("covers 2026 only", " ".join(res["warnings"]))
        self.assertIn("trader-india/holidays.json", " ".join(res["warnings"]))
        with tempfile.TemporaryDirectory() as d:
            h = os.path.join(d, "holidays.json")
            with open(h, "w") as fh:
                json.dump({"2027-01-26": "Republic Day"}, fh)
            res = run_check([o], now="2027-01-26 10:00", holidays_path=h)
            self.assertIn("window: the market is closed today (NSE holiday: Republic Day", reasons(res))
            self.assertEqual(res["warnings"], [])

    def test_intraday_product_only(self):
        res = run_check([synth(product="CNC")])
        self.assertIn("product: DELIVERY (CNC) is not allowed by your config (\"product\": \"INTRADAY\")", reasons(res))
        self.assertEqual(verdicts(run_check([synth(product="MIS")])), ["PASS"])
        self.assertEqual(verdicts(run_check([synth(product="CNC")], cfg(product=["INTRADAY", "DELIVERY"]))),
                         ["PASS"])
        self.assertIn("format: no product", reasons(run_check([synth(product=None)])))
        self.assertIn("format: unknown product", reasons(run_check([synth(product="BO")])))
        self.assertIn("product: MARGIN (NRML)", reasons(run_check([synth(product="NRML")])))

    def test_series(self):
        res = run_check([synth()], series={"SYNTH": "BE"})
        self.assertIn("series: SYNTH trades in the BE series, not in your allowed_series EQ (trade-for-trade",
                      reasons(res))
        res = run_check([synth()], series={})
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertIn("series: not known for SYNTH; check it is EQ on nseindia.com", warnings(res))
        self.assertEqual(verdicts(run_check([synth()], cfg(allowed_series=["EQ", "BE"]), series={"SYNTH": "BE"})),
                         ["PASS"])
        self.assertEqual(verdicts(run_check([synth(series="BZ")], series={})), ["BLOCK"])
        self.assertEqual(check.series_map(json.load(open(WATCH_PATH))),
                         {"SYNTH": "EQ", "SYN-BE": "BE", "SYN-A": "EQ"})

    def test_prices_off_the_tick_grid(self):
        for field, value, tick in (("price", 364.58, "0.05"), ("stop_loss", 358.32, "0.05"),
                                   ("target", 376.03, "0.05"), ("price", 1235.75, "0.10")):
            res = run_check([synth(**{field: value})])
            self.assertIn("tick: %s %s is not on the NSE tick grid (%s at this price)" % (field, value, tick),
                          reasons(res), field)
        o = synth(order_type="SL", trigger_price=364.52)
        self.assertIn("tick: trigger_price 364.52", reasons(run_check([o])))
        self.assertEqual(verdicts(run_check([synth(order_type="SL", trigger_price=364.50)])), ["PASS"])
        self.assertEqual(verdicts(run_check([order("SYNTH", 2, 249.99, plan={})], v1(), series=EQ,
                                            now=None, today=V1_TODAY, prices={})), ["PASS"])

    def test_a_market_order_warns(self):
        res = run_check([synth(order_type="MARKET", price=None)])
        r = res["results"][0]
        self.assertEqual(r["verdict"], "PASS")
        self.assertIn("MARKET order: Angel One reportedly prohibits API market orders from 2026-04-01", warnings(res))
        # measured from the plan's entry: 137 x 5.90 = 808.30 + 52.51 charges = 860.81
        self.assertEqual((r["entry_ref"], r["entry_ref_from"], r["max_loss"]), (364.20, "plan", 860.81))

    def test_no_pattern_day_trader_rule(self):
        trades = [placed("SYN-%d" % i, day=d) for i, d in enumerate(("2026-10-13", "2026-10-14", "2026-10-15"))]
        trades += [placed("SYN-%d" % i, side="sell", day=d, kind="exit", status="filled", max_loss=None)
                   for i, d in enumerate(("2026-10-13", "2026-10-14", "2026-10-15"))]
        res = run_check([synth()], cfg(pdt_guard=True), state={"orders": trades})
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertIn("India has no pattern-day-trader rule", " ".join(res["warnings"]))
        self.assertFalse(hasattr(check, "day_trades"))

    def test_a_fresh_higher_price_is_the_risk_price(self):
        res = run_check([synth()], prices={"SYNTH": 366.50}, now="2026-10-19 10:40",
                        price_times={"SYNTH": QUOTE_TIME})
        r = res["results"][0]
        # max(plan 364.20, limit 364.60, fresh 366.50) = 366.50; risk 8.20
        self.assertEqual((r["entry_ref"], r["entry_ref_from"], r["risk_per_share"]), (366.50, "price", 8.20))
        # 137 x 8.20 = 1,123.40; charges buy 50,210.50 / sell 49,087.10:
        # brokerage 15.06315 + 14.72613, STT 12.271775, stamp 1.506315, NSE 3.048436, SEBI 0.099298,
        # GST 18% of 32.937014 = 5.928663: total 52.643766 -> 52.64; 1,123.40 + 52.64 = 1,176.04
        self.assertIn("loss: 137 shares x 8.20 risk a share + ₹52.64 charges = ₹1,176.04", reasons(res))
        self.assertIn("is above the plan's entry 364.20", r["info"][0])

    def test_a_stale_or_future_price_is_not_used(self):
        for now in ("2026-10-19 11:15", "2026-10-19 10:00"):
            res = run_check([synth()], prices={"SYNTH": 366.50}, now=now, price_times={"SYNTH": QUOTE_TIME})
            self.assertEqual(verdicts(res), ["PASS"], now)
            self.assertEqual(res["results"][0]["entry_ref"], 364.60)
            self.assertIn("older than 15 minutes", warnings(res))

    def test_a_lower_price_does_not_shrink_the_risk(self):
        res = run_check([synth()], prices={"SYNTH": 360.00})
        self.assertEqual(res["results"][0]["entry_ref"], 364.60)


class DayTradeChecks(unittest.TestCase):
    def test_a_stop_is_required(self):
        o = synth(stop_loss=None, target=None, bracket=False, plan={"entry": 364.20})
        self.assertIn("stop: no stop", reasons(run_check([o])))
        res = run_check([o], cfg(require_stop=False, min_reward_risk=0))
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertIn("no stop", warnings(res))

    def test_a_stop_that_is_not_placed_with_the_order_warns(self):
        o = synth(stop_loss=None, target=None, bracket=False)
        res = run_check([o])
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertIn("the stop 358.30 is not placed with this order", warnings(res))
        self.assertEqual(res["results"][0]["max_loss"], 915.63)

    def test_stop_and_target_on_the_right_side(self):
        self.assertIn("must be below the entry 364.60", reasons(run_check([synth(stop_loss=365.00)])))
        self.assertIn("target: the target 364.50 must be above the entry 364.60",
                      reasons(run_check([synth(target=364.50)])))

    def test_reward_risk(self):
        # the 1R target 370.10: (370.10 - 364.60) / 6.30 = 0.87
        res = run_check([synth(target=370.10)])
        self.assertIn("reward:risk: 0.87 (target 370.10, entry 364.60, stop 358.30) is under your minimum 1",
                      reasons(res))
        self.assertEqual(verdicts(run_check([synth(target=370.10)], cfg(min_reward_risk=0.8))), ["PASS"])

    def test_daily_loss_and_trades_per_day(self):
        two = {"orders": [placed("SYN-A"), placed("SYN-B")]}
        res = run_check([synth()], state=two)
        self.assertEqual(verdicts(res), ["PASS"])
        # 2 x 915.63 = 1,831.26 already at risk
        self.assertIn("today before this: 2 of 3 trades, ₹1,831.26 of ₹3,000 daily loss", res["results"][0]["info"][-1])
        three = {"orders": [placed("SYN-A"), placed("SYN-B"), placed("SYN-C")]}
        why = reasons(run_check([synth()], state=three))
        self.assertIn("trades: 3 entries placed today", why)
        # 3 x 915.63 = 2,746.89; + 915.63 = 3,662.52 > 3,000
        self.assertIn("daily loss: ₹2,746.89 already at risk today plus ₹915.63 for this one = ₹3,662.52, over your "
                      "₹3,000", why)
        yesterday = {"orders": [placed(s, day="2026-10-16") for s in ("SYN-A", "SYN-B", "SYN-C")]}
        self.assertEqual(verdicts(run_check([synth()], state=yesterday)), ["PASS"])

    def test_exits_and_declines_do_not_count_as_trades(self):
        st = {"orders": [placed("SYN-A"), placed("SYN-A", side="sell", kind="exit", max_loss=None),
                         placed("SYN-B", status="declined"), placed("SYN-C", status="failed")]}
        res = run_check([synth()], state=st)
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertEqual(res["today"]["entries_placed"], 1)

    def test_the_batch_counts_toward_the_daily_limits(self):
        orders = [order(s, 1, 900.00, stop=100.00, target=1700.00, bracket=True)
                  for s in ("SYN-A", "SYN-B", "SYN-C", "SYN-D")]
        res = run_check(orders)
        self.assertEqual(verdicts(res), ["PASS", "PASS", "PASS", "BLOCK"])
        # each: 1 x 800.00 + 0.44 charges (brokerage 0.27 + 0.03, STT 0.025, stamp 0.027, NSE 0.0307,
        # SEBI 0.001, GST 0.059706 = 0.443406) = 800.44; three = 2,401.32; + 800.44 = 3,201.76
        self.assertEqual(res["results"][0]["max_loss"], 800.44)
        why = reasons(res, 3)
        self.assertIn("trades: 0 entries placed today plus 3 passed earlier", why)
        self.assertIn("daily loss: ₹2,401.32 already at risk today plus ₹800.44 for this one = ₹3,201.76", why)

    def test_a_short_entry_when_allowed(self):
        short = order("SYNTH", 100, 364.20, side="sell", stop=370.00, target=352.60, bracket=True,
                      plan={"entry": 364.20})
        self.assertIn("short: selling more SYNTH than you hold", reasons(run_check([short])))
        res = run_check([short], cfg(allow_short=True))
        r = res["results"][0]
        # risk 370.00 - 364.20 = 5.80; 100 x 5.80 = 580.00 + 38.95 charges (buy 37,000, sell 36,420) = 618.95;
        # reward:risk (364.20 - 352.60) / 5.80 = 2.00
        self.assertEqual((r["verdict"], r["kind"], r["max_loss"], r["reward_risk"]), ("PASS", "entry", 618.95, 2.0))
        self.assertIn("upper circuit", warnings(res))
        res = run_check([dict(short, stop_loss=360.00)], cfg(allow_short=True))
        self.assertIn("must be above the entry 364.20 for a sell", reasons(res))

    def test_order_format(self):
        self.assertIn("whole shares only", reasons(run_check([synth(qty=8.5)])))
        self.assertIn("qty must be a positive number", reasons(run_check([synth(qty=0)])))
        self.assertIn("format: no qty", reasons(run_check([synth(qty=None)])))
        res = run_check([synth(qty="137", stop_loss="358.30")])
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertIn("send qty as a JSON whole number", warnings(res))
        self.assertIn("send stop_loss as a JSON number", warnings(res))
        self.assertIn("a bracket order must be DAY", reasons(run_check([synth(validity="IOC")])))
        self.assertIn("validity must be DAY or IOC", reasons(run_check([synth(validity="GTC")])))
        self.assertIn("needs both stop_loss and target", reasons(run_check([synth(target=None)])))
        self.assertIn("bracket must be true or false", reasons(run_check([synth(bracket="yes")])))
        self.assertIn("rupee (notional) amount", reasons(run_check([synth(notional=50000)])))
        self.assertIn("order_type must be LIMIT, MARKET, SL or SL-M", reasons(run_check([synth(order_type="STOP")])))
        self.assertIn("a LIMIT order needs a price", reasons(run_check([synth(price=None)])))
        self.assertIn("an SL order needs a trigger_price", reasons(run_check([synth(order_type="SL")])))
        self.assertIn("trigger_price 364.70 at or under its price 364.60",
                      reasons(run_check([synth(order_type="SL", trigger_price=364.70)])))
        self.assertIn("side must be buy or sell", reasons(run_check([synth(side="hold")])))

    def test_symbol_and_exchange(self):
        self.assertIn("plain NSE symbol (SYNTH, not SYNTH.NS)", reasons(run_check([synth(symbol="SYNTH.NS")])))
        self.assertIn("this pack trades NSE only", reasons(run_check([synth(exchange="BSE")])))
        self.assertIn("format: no exchange", reasons(run_check([synth(exchange=None)])))
        self.assertIn("derivatives segment", reasons(run_check([synth(exchange="NFO")])))
        self.assertIn("format: no symbol", reasons(run_check([synth(symbol="")])))
        res = run_check([order("M&M", 1, 3000.00, plan={})], v1(), now=None, today=V1_TODAY, series={"M&M": "EQ"})
        self.assertEqual(verdicts(res), ["PASS"])


class Exits(unittest.TestCase):
    PF = {"cash": 50049.80, "positions": [{"symbol": "SYNTH", "shares": 137,
                                            "lots": [{"date": TODAY, "shares": 137, "cost": 49950.20}]}]}
    # india-broker's flatten: LIMIT at the last 370.00 minus 0.1% = 369.63, down to the tick = 369.60
    SELL = order("SYNTH", 137, 369.60, side="sell")

    def test_getting_out_is_never_blocked_by_the_day_limits(self):
        full = {"orders": [placed("SYNTH"), placed("SYN-A"), placed("SYN-B")] +
                          [placed("SYN-T%d" % i, max_loss=1) for i in range(6)] +
                          [placed("SYNTH", side="sell", kind="exit", max_loss=None)]}
        c = cfg(blocked=["SYNTH"], max_order_inr=100, max_daily_loss_inr=50)
        res = run_check([self.SELL], c, portfolio=self.PF, state=full, now="2026-10-19 15:00")
        r = res["results"][0]
        self.assertEqual((r["verdict"], r["kind"]), ("PASS", "exit"), r["reasons"])
        why = warnings(res)
        for word in ("blocked:", "duplicate:", "daily limit:", "size:"):
            self.assertIn("exit, not blocked: " + word, why)
        self.assertNotIn("price band", why)
        self.assertNotIn("series", why)
        res = run_check([self.SELL], portfolio=self.PF, now="2026-10-17 12:00")
        self.assertEqual(verdicts(res), ["PASS"])

    def test_a_partial_exit_and_the_rest(self):
        part = dict(self.SELL, qty=68)
        res = run_check([part, part], portfolio=self.PF)
        self.assertEqual(verdicts(res), ["PASS", "PASS"])
        self.assertEqual([r["kind"] for r in res["results"]], ["exit", "exit"])
        self.assertIn("exit, not blocked: duplicate", warnings(res, 1))
        res = run_check([part, part, part], portfolio=self.PF)
        self.assertEqual(verdicts(res), ["PASS", "PASS", "BLOCK"])      # 68 + 68 = 136, then only 1 is left
        self.assertIn("short:", reasons(res, 2))

    def test_format_tick_and_short_still_apply_to_a_sell(self):
        self.assertIn("needs a price", reasons(run_check([dict(self.SELL, price=None)], portfolio=self.PF)))
        self.assertIn("tick: price 369.63", reasons(run_check([dict(self.SELL, price=369.63)], portfolio=self.PF)))
        res = run_check([dict(self.SELL, qty=138)], portfolio=self.PF)
        self.assertIn("short: selling more SYNTH than you hold (137 shares)", reasons(res))
        self.assertIn("record the fill first", reasons(run_check([self.SELL])))

    def test_a_market_exit_warns_but_passes(self):
        res = run_check([dict(self.SELL, order_type="MARKET", price=None)], portfolio=self.PF,
                        prices={"SYNTH": 370.00})
        self.assertEqual(verdicts(res), ["PASS"])
        self.assertIn("MARKET order", warnings(res))

    def test_buy_then_sell_in_one_batch(self):
        res = run_check([synth(), self.SELL])
        self.assertEqual(verdicts(res), ["PASS", "PASS"])
        self.assertEqual(res["results"][1]["kind"], "exit")


class V1Checks(unittest.TestCase):
    """The long-term checks still hold with the day-trade checks off (synthetic symbols)."""

    def one(self, o, **over):
        return check.check([o], v1(**over), prices=SPLIT_PRICES, today=V1_TODAY, holidays_path=NO_HOLIDAYS)["results"][0]

    def split(self):
        with open(os.path.join(ROOT, "india-budget", "targets.example.json")) as fh:
            rows = size.parse_weights(json.load(fh))
        return size.orders_from(size.size(rows, cfg(), prices=SPLIT_PRICES))

    def test_the_split_passes_on_a_fresh_account(self):
        res = check.check(self.split(), v1(), today=V1_TODAY, holidays_path=NO_HOLIDAYS)
        self.assertEqual(verdicts(res), ["PASS"] * 4)
        # 1,00,000 - 89,913.24 invested (test_budget) = 10,086.76, over the 10,000 buffer
        self.assertEqual(res["cash_after"], 10086.76)
        self.assertEqual(res["results"][0]["value_inr"], 35838.20)     # 29 x 1,235.80

    def test_a_fifth_buy_is_blocked(self):
        res = check.check(self.split() + [order("SYN-A", 10, 1235.80)], v1(), today=V1_TODAY,
                          holidays_path=NO_HOLIDAYS)
        self.assertEqual(verdicts(res), ["PASS"] * 4 + ["BLOCK"])
        why = reasons(res, 4)
        self.assertIn("cash: needs ₹12,358 but only ₹10,086.76 cash; that would be margin", why)
        self.assertIn("duplicate:", why)

    def test_the_day_trade_config_blocks_buys_without_a_stop(self):
        res = run_check(self.split())
        self.assertEqual(verdicts(res)[0], "BLOCK")
        self.assertIn("stop: no stop", reasons(res))

    def test_max_and_min_order(self):
        self.assertIn("over your ₹80,000 max order", " ".join(self.one(order("SYN-D", 40, 2512.60),
                                                                        max_position_pct=100)["reasons"]))
        self.assertIn("under your ₹500 minimum", " ".join(self.one(order("SYN-C", 2, 88.49))["reasons"]))

    def test_blocked_list(self):
        r = self.one(order("SYN-C", 10, 88.49), blocked=["syn-c"])
        self.assertEqual(r["verdict"], "BLOCK")
        self.assertIn("blocked list", r["reasons"][0])

    def test_options_off_unless_allowed(self):
        opt = order("NIFTY26NOV24000CE", 75, 120.50)
        r = self.one(opt)
        self.assertEqual(r["verdict"], "BLOCK")
        self.assertIn("option contract", " ".join(r["reasons"]))
        r = self.one(opt, allow_options=True)
        self.assertEqual(r["verdict"], "PASS", r["reasons"])
        self.assertIn("lose 100%", " ".join(r["warnings"]))

    def test_futures_and_crypto(self):
        self.assertIn("futures contract", " ".join(self.one(order("NIFTY26NOVFUT", 75, 24000.00))["reasons"]))
        self.assertIn("looks like crypto", " ".join(self.one(order("BTC/USD", 1, 5000.00))["reasons"]))
        self.assertIn("looks like crypto", " ".join(self.one(order("BTCUSDT", 1, 5000.00))["reasons"]))
        self.assertIn("NSE equity symbol", " ".join(self.one(order("SYN TH", 1, 500.00))["reasons"]))

    def test_share_orders_need_a_price(self):
        q = order("SYN-Z", 2, None, order_type="MARKET")
        self.assertIn("no price for SYN-Z", " ".join(self.one(q)["reasons"]))
        r = self.one(dict(q, symbol="SYN-A"))
        self.assertEqual(r["verdict"], "PASS")
        self.assertEqual(r["value_inr"], 2469.0)                  # 2 x 1,234.50

    def test_margin(self):
        pf = {"cash": 10000, "positions": []}
        r = check.check([order("SYN-A", 10, 1235.80)], v1(cash_buffer_pct=0, max_position_pct=100), portfolio=pf,
                        today=V1_TODAY, holidays_path=NO_HOLIDAYS)["results"][0]
        self.assertIn("that would be margin", " ".join(r["reasons"]))
        r = check.check([order("SYN-A", 10, 1235.80)], v1(cash_buffer_pct=0, max_position_pct=100, allow_margin=True),
                        portfolio=pf, today=V1_TODAY, holidays_path=NO_HOLIDAYS)["results"][0]
        self.assertEqual(r["verdict"], "PASS")
        self.assertIn("borrowed from the broker", " ".join(r["warnings"]))

    PF = {"cash": 10000.0, "positions": [{"symbol": "SYN-C", "shares": 211,
                                          "lots": [{"date": V1_TODAY, "shares": 211, "cost": 18671.39}]}]}

    def test_short_sales_are_blocked(self):
        sell = order("SYN-C", 212, 88.30, side="sell")
        r = check.check([sell], v1(), portfolio=self.PF, prices=SPLIT_PRICES, today=V1_TODAY,
                        holidays_path=NO_HOLIDAYS)["results"][0]
        self.assertIn("short:", " ".join(r["reasons"]))
        r = check.check([dict(sell, qty=11)], v1(), portfolio=self.PF, prices=SPLIT_PRICES, today=V1_TODAY,
                        holidays_path=NO_HOLIDAYS)["results"][0]
        self.assertEqual((r["verdict"], r["kind"]), ("PASS", "exit"))

    def test_a_sell_frees_cash_for_a_later_buy(self):
        # cash 10,000; the account is 10,000 + 211 x 88.40 = 28,652.40, buffer 10% = 2,865.24.
        # A 7,500 buy alone leaves 2,500: under the buffer. Selling 100 SYN-C at 88.30 first frees 8,830.
        orders = [order("SYN-C", 100, 88.30, side="sell"), order("SYN-B", 20, 375.00)]
        res = check.check(orders, v1(max_position_pct=100), portfolio=self.PF, prices=SPLIT_PRICES, today=V1_TODAY,
                          holidays_path=NO_HOLIDAYS)
        self.assertEqual(verdicts(res), ["PASS", "PASS"])
        res = check.check(orders[1:], v1(max_position_pct=100), portfolio=self.PF, prices=SPLIT_PRICES,
                          today=V1_TODAY, holidays_path=NO_HOLIDAYS)
        self.assertEqual(verdicts(res), ["BLOCK"])
        self.assertIn("under your 10% buffer", reasons(res))

    def test_daily_limit_and_already_placed_today(self):
        st = {"orders": [{"symbol": "SYN-T%d" % i, "side": "buy", "status": "placed", "at": V1_TODAY + "T10:00:00"}
                         for i in range(10)]}
        buy = order("SYN-C", 10, 88.49)
        res = check.check([buy], v1(), state=st, today=V1_TODAY, holidays_path=NO_HOLIDAYS)
        self.assertIn("daily limit", reasons(res))
        res = check.check([buy], v1(), state=st, today="2026-10-14", holidays_path=NO_HOLIDAYS)
        self.assertEqual(verdicts(res), ["PASS"])
        st = {"orders": [{"symbol": "SYN-C", "side": "buy", "status": "placed", "at": V1_TODAY + "T10:00:00"}]}
        self.assertIn("already placed today",
                      reasons(check.check([buy], v1(), state=st, today=V1_TODAY, holidays_path=NO_HOLIDAYS)))

    def test_live_account_warns(self):
        res = check.check([order("SYN-C", 10, 88.49)], v1(paper=False), today=V1_TODAY, holidays_path=NO_HOLIDAYS)
        self.assertIn("LIVE", res["warnings"][0])


class Cli(unittest.TestCase):
    def base(self, d, orders=ORDERS_PATH):
        none = os.path.join(d, "none")
        return ["--orders", orders, "--config", CFG_PATH, "--portfolio", none, "--state", none,
                "--watchlist", WATCH_PATH, "--holidays", none, "--no-write"]

    def test_prices_file_freshness(self):
        with tempfile.TemporaryDirectory() as d:
            pp = os.path.join(d, "prices.json")
            with open(pp, "w") as fh:
                json.dump({"as_of": "2026-10-19T05:10:00Z", "prices": {"SYNTH": 366.50},
                           "detail": {"SYNTH": {"time": "2026-10-19T05:07:13Z", "fetched": "2026-10-19T05:10:00Z"}}},
                          fh)
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(check.main(self.base(d) + ["--prices", pp, "--now", "2026-10-19 10:40"]), 1)
            self.assertIn("137 shares x 8.20 risk a share + ₹52.64 charges = ₹1,176.04", buf.getvalue())
            with redirect_stdout(io.StringIO()):
                self.assertEqual(check.main(self.base(d) + ["--prices", pp, "--now", "2026-10-19 11:15"]), 0)

    def test_the_watchlist_gives_the_series(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "orders.json")
            with open(p, "w", encoding="utf-8") as fh:
                json.dump({"orders": [synth(symbol="SYN-BE")]}, fh)
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = check.main(self.base(d, p) + ["--prices", os.path.join(d, "none"), "--now", NOW])
            self.assertEqual(code, 1)
            self.assertIn("series: SYN-BE trades in the BE series", buf.getvalue())

    def test_errors_are_one_line(self):
        for argv, want in ((["--orders", "/nonexistent.json", "--no-write"], "no orders file"),
                           (["--orders", ORDERS_PATH, "--now", "noon", "--no-write"], "--now wants"),
                           (["--orders", ORDERS_PATH, "--today", "monday", "--no-write"], "--today wants")):
            err = io.StringIO()
            with redirect_stderr(err), redirect_stdout(io.StringIO()):
                self.assertEqual(check.main(argv), 1)
            self.assertIn(want, err.getvalue())
            self.assertNotIn("Traceback", err.getvalue())


class Style(unittest.TestCase):
    def test_no_em_dashes_and_no_zoneinfo(self):
        files = [os.path.join(ROOT, "india-risk", f) for f in ("check.py", "SKILL.md")]
        files += [__file__, ORDERS_PATH, WATCH_PATH]
        for path in files:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            self.assertFalse(chr(0x2014) in text, path)        # no em dashes
            self.assertIsNone(re.search(r"^\s*(import|from)\s+zoneinfo", text, re.M), path)

    def test_the_skill_carries_the_safety_block(self):
        with open(os.path.join(ROOT, "india-risk", "SKILL.md"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("name: india-risk", text)
        self.assertIn("## Safety", text)
        self.assertIn("71% of individual intraday traders", text)
        self.assertIn("synthetic", text.lower())
        self.assertIn("static IP", text)


if __name__ == "__main__":
    unittest.main()
