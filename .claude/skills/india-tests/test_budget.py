"""india-budget: size an NSE day trade from a SYNTHETIC plan, and the weights split.

Every number below is worked out by hand from the synthetic plan
(fixtures/india-budget/plan-synth.json: the US TSLA reel moved onto the NSE tick
grid and India time, renamed SYNTH; not NSE data) and the example config.
"""
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr

from _load import load, ROOT, FIX

size = load("india-budget", "size")

CFG = os.path.join(ROOT, "india-budget", "config.example.json")
PLAN = os.path.join(FIX, "india-budget", "plan-synth.json")
ORDERS = os.path.join(FIX, "india-risk", "orders-synth.json")
TARGETS = os.path.join(ROOT, "india-budget", "targets.example.json")
NOW = "2026-10-19 10:00"          # India time: the synthetic entry bar (09:55-10:00) has closed
TODAY = "2026-10-19"
QUOTE_UTC = "2026-10-19T05:07:13Z"   # 10:37:13 India time
# the CONVENTIONS config, key for key, plus limit_buffer_pct
CONTRACT_CFG = {
    "budget": 100000, "cash_buffer_pct": 10, "max_position_pct": 50, "max_order_inr": 80000,
    "min_order_inr": 500, "max_loss_per_trade_inr": 1000, "max_daily_loss_inr": 3000,
    "max_trades_per_day": 3, "max_orders_per_day": 10, "min_reward_risk": 1.0, "require_stop": True,
    "include_costs_in_risk": True, "no_entries_before": "09:30", "no_entries_after": "14:30",
    "flat_by": "15:00", "product": "INTRADAY", "allowed_series": ["EQ"], "brokerage_flat_inr": 20,
    "brokerage_pct": 0.03, "broker": "paper", "paper": True, "blocked": [], "allow_options": False,
    "allow_margin": False, "allow_short": False, "limit_buffer_pct": 0.1,
}
# synthetic quotes for the weights example (not NSE prices)
PRICES = {"SYN-A": 1234.50, "SYN-B": 362.15, "SYN-C": 88.40, "SYN-D": 2510.00}
MY_FILES = [os.path.join(ROOT, "india-budget", f) for f in ("size.py", "SKILL.md", "config.example.json",
                                                            "targets.example.json")]


def cfg(**over):
    with open(CFG) as fh:
        c = json.load(fh)
    c.update(over)
    return c


def plan(**over):
    with open(PLAN) as fh:
        p = json.load(fh)
    p.update(over)
    return p


def rows(path=TARGETS):
    with open(path) as fh:
        return size.parse_weights(json.load(fh))


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = size.main(argv)
    return code, out.getvalue(), err.getvalue()


def prices_doc(price, quote_time=QUOTE_UTC):
    return {"as_of": quote_time, "source": "yahoo", "prices": {"SYNTH": price},
            "detail": {"SYNTH": {"prev_close": 354.70, "time": quote_time, "source": "yahoo"}}}


class TheReel(unittest.TestCase):
    """₹1,00,000, 10% buffer, 50% cap, ₹1,000 max loss incl. charges.

    limit = tick_up(364.20 x 1.001 = 364.5642) = 364.60 (tick 0.05); risk 364.60 - 358.30 = 6.30.
    position cap ₹50,000 / 364.60 = 137.1 -> 137 shares, the smallest of the four limits."""

    def test_config_example_is_the_contract(self):
        with open(CFG) as fh:
            self.assertEqual(json.load(fh), CONTRACT_CFG)

    def test_the_plan_fixture_is_on_the_tick_grid_in_india_time(self):
        p = plan()
        self.assertEqual((p["symbol"], p["exchange"], p["timezone"], p["flat_by"]), ("SYNTH", "NSE", "IST", "15:00"))
        for k in ("entry", "stop", "target"):
            self.assertEqual(size.tick_down(p[k]), p[k], k)
        o = p["opening_range"]
        # stop = the opening-range midpoint (362.20 + 354.45) / 2 = 358.325, down to the 0.05 tick
        self.assertEqual(size.tick_down((o["high"] + o["low"]) / 2), p["stop"])
        # 2R target = 364.20 + 2 x 5.90 = 376.00
        self.assertAlmostEqual(p["entry"] + 2 * p["risk_per_share"], p["target"], places=6)
        self.assertIn("SYNTHETIC", p["note"])

    def test_synth_is_137_shares_bound_by_the_position_cap(self):
        s = size.size_trade(plan(), cfg(), today=TODAY)
        self.assertEqual((s["order_type"], s["limit_price"], s["entry"], s["entry_from"]),
                         ("LIMIT", 364.60, 364.60, "limit"))
        self.assertEqual(s["risk_per_share"], 6.30)
        # max loss: q x 6.30 + charges <= 1,000. Charges are about 0.3835 a share (52.53 / 137), so
        # q <= 1000 / 6.6835 = 149.6: 149 x 6.30 = 938.70 + 57.14 = 995.84 fits, 150 does not (1,002.52).
        # position cap 50,000 / 364.60 = 137.1; max order 80,000 / 364.60 = 219.4;
        # cash (1,00,000 - 10,000) / 364.60 = 246.8
        self.assertEqual([(l["name"], l["shares"]) for l in s["limits"]],
                         [("max loss", 149), ("position cap", 137), ("max order", 219), ("cash", 246)])
        self.assertEqual((s["qty"], s["bound_by"]), (137, "position cap"))
        self.assertEqual([l["name"] for l in s["limits"] if l["binds"]], ["position cap"])
        self.assertEqual(s["cost"], 49950.20)                 # 137 x 364.60
        self.assertEqual(s["loss_gross"], 863.10)             # 137 x 6.30
        # charges, buy 49,950.20 and sell 49,087.10 (137 x 358.30):
        #   brokerage 0.03% of each side (both under ₹20): 14.98506 + 14.72613 = 29.71119
        #   STT 0.025% of the sell = 12.271775; stamp 0.003% of the buy = 1.498506
        #   exchange 0.00307% of 99,037.30 = 3.040445; SEBI ₹10 a crore = 0.099037
        #   GST 18% of (29.71119 + 3.040445 + 0.099037) = 5.913121
        #   total 52.534074 -> 52.53
        self.assertEqual(s["costs_at_stop"], 52.53)
        self.assertEqual(s["max_loss"], 915.63)               # 863.10 + 52.53
        # reward:risk (376.00 - 364.60) / 6.30 = 11.40 / 6.30 = 1.81. Net: charges at the target
        # are 54.09 (sell 51,512.00), so (137 x 11.40 - 54.09) / 915.63 = 1,507.71 / 915.63 = 1.65
        self.assertEqual((s["reward_risk"], s["costs_at_target"], s["reward_risk_net"]), (1.81, 54.09, 1.65))
        self.assertEqual(s["cash_buffer"], 10000)
        self.assertIsNone(s["refusal"])

    def test_the_bracket_order(self):
        o = size.bracket_order(size.size_trade(plan(), cfg(), today=TODAY))
        why = o.pop("why")
        self.assertEqual(o, {
            "symbol": "SYNTH", "exchange": "NSE", "side": "buy", "qty": 137, "order_type": "LIMIT",
            "price": 364.60, "trigger_price": None, "product": "INTRADAY", "validity": "DAY",
            "stop_loss": 358.30, "target": 376.00, "bracket": True,
            "plan": {"entry": 364.20, "stop": 358.30, "target": 376.00, "risk_per_share": 6.30,
                     "costs_at_stop": 52.53, "max_loss": 915.63, "setup": "orb", "entry_time": "10:00",
                     "flat_by": "15:00"}})
        self.assertEqual(list(o)[:12], list(size.ORDER_FIELDS))   # the core's order fields, in order
        self.assertIn("137 shares, bound by your position cap", why)
        self.assertIn("137 x 6.30 + ₹52.53 charges = ₹915.63 at the stop", why)
        self.assertIsInstance(o["qty"], int)

    def test_the_fixture_orders_file_is_what_it_writes(self):
        with open(ORDERS) as fh:
            doc = json.load(fh)
        self.assertEqual(size.bracket_order(size.size_trade(plan(), cfg(), today=TODAY)), doc["orders"][0])
        self.assertEqual(doc["note"], size.ORDERS_NOTE)
        self.assertEqual(doc["created_by"], "india-budget")

    def test_cli_writes_one_bracket_order(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "trader-india", "orders.json")
            code, text, _ = run(["--plan", PLAN, "--config", CFG, "--portfolio", os.path.join(d, "none"),
                                 "--now", NOW, "--write", out])
            self.assertEqual(code, 0)
            self.assertIn("Size: 137 shares of SYNTH = ₹49,950.20 at 364.60", text)
            self.assertIn("137 x 6.30 = ₹863.10 + ₹52.53 charges = ₹915.63", text)
            self.assertIn("Limit price 364.60: the plan's entry 364.20 plus your 0.1% buffer, rounded up to "
                          "the 0.05 tick", text)
            self.assertIn("net of charges 1.65", text)
            self.assertIn("lower circuit", text)
            self.assertIn("<- binds", text)
            self.assertIn("Flat by 15:00 India time", text)
            self.assertIn("not financial advice", text)
            with open(out, encoding="utf-8") as fh:
                doc = json.load(fh)
            self.assertEqual((doc["status"], doc["paper"], doc["created_by"]), ("proposed", True, "india-budget"))
            self.assertEqual(doc["created_at"], "2026-10-19T04:30:00Z")      # 10:00 India time
            self.assertEqual(doc["source"], "trader-india/plan.json (SYNTH orb 2026-10-19)")
            self.assertEqual(len(doc["orders"]), 1)
            self.assertEqual(doc["orders"][0]["plan"]["max_loss"], 915.63)
            with open(ORDERS, encoding="utf-8") as fh:
                self.assertEqual(doc, json.load(fh))

    def test_cli_json(self):
        code, text, _ = run(["--plan", PLAN, "--config", CFG, "--portfolio", "/nonexistent", "--now", NOW,
                             "--json"])
        self.assertEqual(code, 0)
        out = json.loads(text)
        self.assertEqual((out["sizing"]["qty"], out["orders"][0]["price"]), (137, 364.60))


class Costs(unittest.TestCase):
    def test_the_search_finds_the_largest_qty_that_fits(self):
        c = cfg()
        self.assertEqual(size.loss_at_stop(149, 364.60, 358.30, c)[0], 995.84)    # 938.70 + 57.14
        self.assertEqual(size.loss_at_stop(150, 364.60, 358.30, c)[0], 1002.52)   # 945.00 + 57.52
        self.assertEqual(size.max_loss_shares(1000, 364.60, 358.30, c), 149)
        self.assertEqual(size.max_loss_shares(1000, 364.60, 358.30, cfg(include_costs_in_risk=False)), 158)

    def test_charges_cost_shares_on_a_wide_stop(self):
        # stop at the opening-range low 354.45: risk 364.60 - 354.45 = 10.15 a share
        s = size.size_trade(plan(stop=354.45), cfg(), today=TODAY)
        # charges about 0.38099 a share, so q <= 1000 / 10.53099 = 94.96:
        # 94 x 10.15 = 954.10 + 35.81 = 989.91; 95 would be 964.25 + 36.19 = 1,000.44
        self.assertEqual((s["qty"], s["bound_by"], s["costs_at_stop"], s["max_loss"]), (94, "max loss", 35.81, 989.91))
        # reward:risk (376.00 - 364.60) / 10.15 = 1.12
        self.assertEqual(s["reward_risk"], 1.12)
        s = size.size_trade(plan(stop=354.45), cfg(include_costs_in_risk=False), today=TODAY)
        # without charges: 1000 / 10.15 = 98.5 -> 98; the loss is 98 x 10.15 = 994.70 (charges 37.34 not counted)
        self.assertEqual((s["qty"], s["max_loss"], s["costs_at_stop"]), (98, 994.70, 37.34))
        self.assertIn("not counted", size.plan_report(s, size.bracket_order(s)))


class PlanRules(unittest.TestCase):
    def test_zero_shares_is_a_plain_refusal(self):
        s = size.size_trade(plan(stop=300.0), cfg(max_loss_per_trade_inr=50), today=TODAY)
        self.assertEqual(s["qty"], 0)
        # one share risks 364.60 - 300.00 = 64.60, plus 0.35 charges, over ₹50
        self.assertIn("one share risks ₹64.60 (entry 364.60 minus stop 300.00) plus ₹0.35 in charges, more than "
                      "your ₹50 max loss per trade", s["refusal"])
        self.assertIsNone(size.bracket_order(s))
        with tempfile.TemporaryDirectory() as d:
            p, c = os.path.join(d, "plan.json"), os.path.join(d, "config.json")
            with open(p, "w") as fh:
                json.dump(plan(stop=300.0), fh)
            with open(c, "w") as fh:
                json.dump(cfg(max_loss_per_trade_inr=50), fh)
            out = os.path.join(d, "orders.json")
            code, text, _ = run(["--plan", p, "--config", c, "--portfolio", os.path.join(d, "none"),
                                 "--now", NOW, "--write", out])
            self.assertEqual(code, 1)
            self.assertIn("No order:", text)
            self.assertFalse(os.path.exists(out))

    def test_each_limit_can_bind(self):
        s = size.size_trade(plan(), cfg(max_order_inr=20000), today=TODAY)
        self.assertEqual((s["qty"], s["bound_by"]), (54, "max order"))            # 20,000 / 364.60 = 54.9
        s = size.size_trade(plan(), cfg(), cash=20000, today=TODAY)
        # cash 20,000 minus the 10,000 buffer = 10,000 / 364.60 = 27.4
        self.assertEqual((s["qty"], s["bound_by"], s["cash_available"]), (27, "cash", 10000))
        s = size.size_trade(plan(stop=354.45), cfg(), today=TODAY)
        self.assertEqual((s["qty"], s["bound_by"]), (94, "max loss"))

    def test_allow_margin_drops_the_cash_limit(self):
        s = size.size_trade(plan(), cfg(allow_margin=True), cash=20000, today=TODAY)
        self.assertNotIn("cash", [l["name"] for l in s["limits"]])
        self.assertEqual((s["qty"], s["bound_by"]), (137, "position cap"))
        self.assertTrue(any("borrowed money" in n for n in s["notes"]))

    def test_a_fresh_higher_price_means_a_bigger_risk(self):
        s = size.size_trade(plan(), cfg(), price=366.50, today=TODAY)
        # limit = tick_up(366.50 x 1.001 = 366.8665) = 366.90; risk 366.90 - 358.30 = 8.60
        self.assertEqual((s["entry_base_from"], s["limit_price"], s["risk_per_share"]), ("price", 366.90, 8.60))
        # max loss: 111 x 8.60 = 954.60 + 42.67 charges = 997.27; 112 would be 963.20 + 43.06 = 1,006.26
        self.assertEqual((s["qty"], s["bound_by"], s["costs_at_stop"], s["max_loss"]), (111, "max loss", 42.67, 997.27))
        # reward:risk (376.00 - 366.90) / 8.60 = 9.10 / 8.60 = 1.06: still over the 1.0 minimum
        self.assertEqual(s["reward_risk"], 1.06)
        self.assertIsNone(s["refusal"])
        lower = size.size_trade(plan(), cfg(), price=363.00, today=TODAY)
        self.assertEqual((lower["limit_price"], lower["qty"]), (364.60, 137))

    def test_a_1r_target_falls_under_the_minimum_once_the_buffer_is_paid(self):
        # the US reel's 1R target, on the grid: 364.20 + 5.90 = 370.10.
        # From the limit: (370.10 - 364.60) / 6.30 = 5.50 / 6.30 = 0.87 < 1
        s = size.size_trade(plan(target=370.10), cfg(), today=TODAY)
        self.assertIn("reward:risk 0.87 (target 370.10, entry 364.60, stop 358.30) is under your minimum 1",
                      s["refusal"])
        self.assertIsNone(size.bracket_order(s))
        self.assertIsNotNone(size.bracket_order(size.size_trade(plan(target=370.10), cfg(min_reward_risk=0.8),
                                                                today=TODAY)))

    def test_prices_file_is_used_only_when_fresh(self):
        with tempfile.TemporaryDirectory() as d:
            pp = os.path.join(d, "prices.json")
            with open(pp, "w") as fh:
                json.dump(prices_doc(366.50), fh)
            base = ["--plan", PLAN, "--config", CFG, "--portfolio", os.path.join(d, "none"), "--prices", pp, "--json"]
            code, text, _ = run(base + ["--now", "2026-10-19 10:40"])      # quote 2m47s old
            out = json.loads(text)
            self.assertEqual((code, out["sizing"]["qty"], out["orders"][0]["price"]), (0, 111, 366.90))
            self.assertIn("above the plan's entry", out["notes"][0])
            self.assertIn("10:37 India time", out["notes"][0])
            out = json.loads(run(base + ["--now", "2026-10-19 11:15"])[1])  # 38 minutes old
            self.assertEqual((out["sizing"]["qty"], out["orders"][0]["price"]), (137, 364.60))
            self.assertIn("not used", out["notes"][0])

    def test_the_portfolio_cash_caps_the_size(self):
        with tempfile.TemporaryDirectory() as d:
            pf = os.path.join(d, "portfolio.json")
            with open(pf, "w") as fh:
                json.dump({"cash": 20000, "positions": []}, fh)
            out = json.loads(run(["--plan", PLAN, "--config", CFG, "--portfolio", pf, "--now", NOW, "--json"])[1])
            self.assertEqual((out["sizing"]["qty"], out["sizing"]["bound_by"]), (27, "cash"))

    def test_your_limit_and_a_market_order(self):
        s = size.size_trade(plan(), cfg(), limit=364.52, today=TODAY)
        # rounded up to the tick: 364.55; risk 364.55 - 358.30 = 6.25
        self.assertEqual((s["limit_price"], s["risk_per_share"], s["limit_from"]), (364.55, 6.25, "yours"))
        self.assertTrue(any("rounded up to 364.55" in n for n in s["notes"]))
        s = size.size_trade(plan(), cfg(), limit=364.00, today=TODAY)
        # under the plan's entry: the risk is still measured from 364.20
        self.assertEqual((s["entry"], s["entry_from"], s["risk_per_share"]), (364.20, "plan", 5.90))
        m = size.bracket_order(size.size_trade(plan(), cfg(), market=True, today=TODAY))
        self.assertEqual((m["order_type"], m["price"]), ("MARKET", None))
        # a market order is sized at the plan's entry: 137 x 5.90 = 808.30 + 52.51 charges = 860.81
        self.assertEqual(m["plan"]["max_loss"], 860.81)
        with self.assertRaises(SystemExit):          # argparse: --limit and --market exclude each other
            run(["--plan", PLAN, "--config", CFG, "--now", NOW, "--limit", "364.6", "--market"])

    def test_an_off_grid_plan_is_rounded_onto_the_ticks(self):
        s = size.size_trade(plan(stop=358.32, target=376.03), cfg(), today=TODAY)
        self.assertEqual((s["stop"], s["target"]), (358.30, 376.00))
        self.assertEqual(len(s["notes"]), 2)

    def test_bad_plans(self):
        for p, word in ((plan(stop=365.0), "not below the entry"),
                        (plan(target=364.50), "already happened"),
                        (plan(target=None), "positive target"),
                        (plan(side="sell"), "long (buy) day trades only"),
                        (plan(symbol=""), "no symbol"),
                        (plan(symbol="SYN TH"), "not an NSE symbol"),
                        (plan(exchange="BSE"), "NSE only")):
            with self.assertRaises(size.SizeError) as e:
                size.size_trade(p, cfg(), today=TODAY)
            self.assertIn(word, str(e.exception))
        with self.assertRaises(size.SizeError) as e:
            size.size_trade(plan(), cfg(), price=376.00, today=TODAY)
        self.assertIn("already happened", str(e.exception))
        with self.assertRaises(size.SizeError) as e:
            size.size_trade(plan(), cfg(blocked=["synth"]), today=TODAY)
        self.assertIn("blocked list", str(e.exception))
        with self.assertRaises(size.SizeError) as e:
            size.size_trade(plan(), cfg(), today="2026-10-21")
        self.assertIn("make a new plan", str(e.exception))

    def test_under_the_minimum_order(self):
        cheap = plan(symbol="SYN-X", entry=4.00, stop=3.00, target=6.00)
        s = size.size_trade(cheap, cfg(max_loss_per_trade_inr=2), today=TODAY)
        # limit tick_up(4.004) = 4.01 (tick 0.01 under ₹250); 1 share risks 1.01, 2 would risk 2.02 > 2
        self.assertEqual((s["limit_price"], s["qty"]), (4.01, 1))
        self.assertIn("1 share of SYN-X is ₹4.01, under your ₹500 minimum order", s["refusal"])
        self.assertIsNone(size.bracket_order(s))

    def test_missing_plan_and_weights_only_flags(self):
        code, _, err = run(["--plan", "/nonexistent/plan.json", "--config", CFG, "--now", NOW])
        self.assertEqual(code, 1)
        self.assertIn("no plan", err)
        code, _, err = run(["--plan", PLAN, "--config", CFG, "--now", NOW, "--top", "2"])
        self.assertEqual(code, 1)
        self.assertIn("--weights", err)
        code, _, err = run(["--plan", PLAN, "--config", CFG, "--now", "tomorrow"])
        self.assertEqual(code, 1)
        self.assertIn("India time", err)
        self.assertNotIn("Traceback", err)


class WeightsMode(unittest.TestCase):
    """The v1 split, kept behind --weights / --targets, in whole shares at LIMIT prices.
    ₹1,00,000, 10% cash = ₹90,000 to invest, 50% cap = ₹50,000 a stock. Synthetic symbols and quotes."""

    def test_the_split_before_whole_shares(self):
        r = size.size(rows(), cfg(), prices=PRICES)
        # 40 / 25 / 20 / 15 % of 90,000
        self.assertEqual({p["symbol"]: p["slice"] for p in r["positions"]},
                         {"SYN-A": 36000, "SYN-B": 22500, "SYN-C": 18000, "SYN-D": 13500})
        self.assertEqual((r["cash_buffer"], r["investable"], r["cap"]), (10000, 90000, 50000))
        self.assertFalse(any(p["capped"] for p in r["positions"]))

    def test_whole_shares_at_the_limit_price(self):
        r = size.size(rows(), cfg(), prices=PRICES)
        # limits: 1234.50 x 1.001 = 1235.7345 -> 1235.80 (tick 0.10); 362.15 -> 362.51215 -> 362.55 (0.05);
        # 88.40 -> 88.4884 -> 88.49 (0.01); 2510.00 -> 2512.51 -> 2512.60 (0.10)
        self.assertEqual({p["symbol"]: p["limit_price"] for p in r["positions"]},
                         {"SYN-A": 1235.80, "SYN-B": 362.55, "SYN-C": 88.49, "SYN-D": 2512.60})
        # floor each slice: 29, 62, 203, 5 shares = 88,842.77; the 1,157.23 left buys one more share at a
        # time for the stock furthest under its slice that it can still afford: C, B, then C until
        # 86.76 is left (under one C share at 88.49)
        self.assertEqual({p["symbol"]: p["shares"] for p in r["positions"]},
                         {"SYN-A": 29, "SYN-B": 63, "SYN-C": 211, "SYN-D": 5})
        self.assertEqual((r["invested"], r["idle"]), (89913.24, 86.76))
        for p in r["positions"]:
            self.assertAlmostEqual(p["inr"], p["shares"] * p["limit_price"], places=2)

    def test_cap_redistributes_until_nobody_is_over(self):
        w = size.parse_weights({"SYN-A": 60, "SYN-B": 30, "SYN-C": 10})
        c = {"budget": 100000, "cash_buffer_pct": 0, "max_position_pct": 40, "min_order_inr": 1}
        r = size.size(w, c, prices={"SYN-A": 100, "SYN-B": 100, "SYN-C": 100})
        # A 60,000 -> capped at 40,000; B then gets 60,000 x 30/40 = 45,000 -> capped; C the 20,000 left
        self.assertEqual({p["symbol"]: p["slice"] for p in r["positions"]}, {"SYN-A": 40000, "SYN-B": 40000,
                                                                              "SYN-C": 20000})
        # limit 100.10 each: 399 / 399 / 199 shares, then C buys 2 more (400 A or B would be 40,040 > the cap)
        self.assertEqual({p["symbol"]: p["shares"] for p in r["positions"]}, {"SYN-A": 399, "SYN-B": 399,
                                                                               "SYN-C": 201})
        self.assertEqual((r["invested"], r["idle"]), (99999.90, 0.10))
        self.assertEqual(sorted(p["symbol"] for p in r["positions"] if p["capped"]), ["SYN-A", "SYN-B"])

    def test_inline_weights_and_a_tighter_cap(self):
        w = size.parse_weights(size.weights_from_arg("SYN-A=40,SYN-B=25,SYN-C=20,SYN-D=15"))
        r = size.size(w, cfg(max_position_pct=25), prices=PRICES)
        # A and B capped at 25,000; C and D share the 40,000 left 20:15 = 22,857.14 and 17,142.86
        self.assertEqual({p["symbol"]: p["slice"] for p in r["positions"]},
                         {"SYN-A": 25000, "SYN-B": 25000, "SYN-C": 22857.14, "SYN-D": 17142.86})
        for p in r["positions"]:
            self.assertLessEqual(p["inr"], 25000)

    def test_blocked_and_top_n(self):
        r = size.size(rows(), cfg(blocked=["syn-c"]), prices=PRICES)
        self.assertNotIn("SYN-C", [p["symbol"] for p in r["positions"]])
        self.assertIn("blocked", r["dropped"][0]["reason"])
        r = size.size(rows(), cfg(), prices=PRICES, top=2)
        self.assertEqual(sorted(p["symbol"] for p in r["positions"]), ["SYN-A", "SYN-B"])

    def test_slices_under_the_minimum_are_dropped_and_shared_out(self):
        w = size.parse_weights({"SYN-A": 90, "SYN-B": 7, "SYN-C": 3})
        c = {"budget": 10000, "cash_buffer_pct": 10, "max_position_pct": 100, "min_order_inr": 500}
        r = size.size(w, c, prices={"SYN-A": 10, "SYN-B": 10, "SYN-C": 10})
        # C's slice is 3% of 9,000 = 270, under ₹500: dropped, its share goes to A and B
        self.assertEqual(r["dropped"][0]["symbol"], "SYN-C")
        self.assertTrue(all(p["inr"] >= 500 for p in r["positions"]))

    def test_whole_shares_need_prices(self):
        with self.assertRaises(size.SizeError) as e:
            size.size(rows(), cfg())
        self.assertIn("need a price", str(e.exception))
        with self.assertRaises(size.SizeError):
            size.size(rows(), {"cash_buffer_pct": 10}, prices=PRICES)      # no budget

    def test_orders_are_in_the_india_format(self):
        r = size.size(rows(), cfg(), prices=PRICES)
        orders = size.orders_from(r, "example")
        self.assertEqual(orders[0], {"symbol": "SYN-A", "exchange": "NSE", "side": "buy", "qty": 29,
                                     "order_type": "LIMIT", "price": 1235.80, "trigger_price": None,
                                     "product": "INTRADAY", "validity": "DAY", "stop_loss": None,
                                     "target": None, "bracket": False, "why": orders[0]["why"]})
        for o in orders:
            self.assertEqual(size.tick_up(o["price"]), o["price"])

    def test_cli(self):
        with tempfile.TemporaryDirectory() as d:
            pp = os.path.join(d, "prices.json")
            with open(pp, "w") as fh:
                json.dump({"prices": {k + ".NS": v for k, v in PRICES.items()}}, fh)
            out = os.path.join(d, "trader-india", "orders.json")
            code, text, _ = run(["--targets", TARGETS, "--config", CFG, "--prices", pp, "--write", out,
                                 "--now", NOW])
            self.assertEqual(code, 0)
            self.assertIn("left idle", text)
            self.assertIn("require_stop", text)
            with open(out, encoding="utf-8") as fh:
                doc = json.load(fh)
            self.assertEqual([o["symbol"] for o in doc["orders"]], ["SYN-A", "SYN-B", "SYN-C", "SYN-D"])
            self.assertIn("synthetic", doc["source"])
            code, _, err = run(["--targets", "/nonexistent/targets.json", "--config", CFG])
            self.assertEqual(code, 1)
            self.assertIn("no weights file", err)


class Style(unittest.TestCase):
    def test_no_em_dashes_and_no_zoneinfo(self):
        for path in MY_FILES + [__file__, PLAN]:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            self.assertNotIn("—", text, path)
            self.assertNotIn("zoneinfo", text.replace("no zoneinfo", ""), path)

    def test_the_skill_carries_the_safety_block(self):
        with open(os.path.join(ROOT, "india-budget", "SKILL.md"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("name: india-budget", text)
        self.assertIn("## Safety", text)
        self.assertIn("71% of individual intraday traders", text)
        self.assertIn("synthetic", text.lower())
        self.assertNotIn("Berkshire", text)


if __name__ == "__main__":
    unittest.main()
