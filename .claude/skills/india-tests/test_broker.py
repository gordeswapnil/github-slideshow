"""Tests for india-broker/ticket.py. Every order, price and ID here is synthetic:
SYNTH, SYN-X and SYN&M are not NSE stocks, and the security IDs are made up."""
import io
import json
import os
import re
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr

from _load import load, ROOT, FIX

ticket = load("india-broker", "ticket")

BF = os.path.join(FIX, "india-broker")
ORDERS_PATH = os.path.join(BF, "orders-synth.json")
CFG_PATH = os.path.join(BF, "config-paper.json")
RISK_PATH = os.path.join(BF, "risk-synth-pass.json")
PF_PATH = os.path.join(BF, "portfolio-synth.json")
PRICES_PATH = os.path.join(BF, "prices-synth.json")
PLAN_PATH = os.path.join(BF, "plan-synth.json")
IDS_PATH = os.path.join(BF, "security_ids-synth.json")
DHAN_CSV = os.path.join(BF, "dhan-scrip-master-synth.csv")
ANGEL_JSON = os.path.join(BF, "angel-scrip-master-synth.json")
SKILL_DIR = os.path.join(ROOT, "india-broker")

NOW = "2026-10-19 09:55"          # India time, a Monday (2026-10-20 is Dussehra)
TODAY = "2026-10-19"
FP = "92feb92367c35e18"
SYNTH_PLAIN = ("BUY 137 SYNTH (NSE), limit ₹364.55, intraday (MIS), good for today / stop-loss ₹358.30 / "
               "target ₹370.00 / max loss about ₹908.78 if the stop fills at ₹358.30 (₹856.25 at the stop + "
               "₹52.53 estimated charges); it can fill worse in a fast market, or not at all if the stock is "
               "stuck at its price band")
DHAN_SUPER = {"dhanClientId": "<your Dhan client id>", "correlationId": FP, "transactionType": "BUY",
              "exchangeSegment": "NSE_EQ", "productType": "INTRADAY", "orderType": "LIMIT",
              "securityId": "99990001", "quantity": 137, "price": 364.55, "targetPrice": 370.0,
              "stopLossPrice": 358.3, "trailingJump": 0}
ANGEL_ENTRY = {"variety": "NORMAL", "tradingsymbol": "SYNTH-EQ", "symboltoken": "88880001",
               "transactiontype": "BUY", "exchange": "NSE", "ordertype": "LIMIT", "producttype": "INTRADAY",
               "duration": "DAY", "price": "364.55", "squareoff": "0", "stoploss": "0", "quantity": "137"}
ANGEL_STOP = {"variety": "STOPLOSS", "tradingsymbol": "SYNTH-EQ", "symboltoken": "88880001",
              "transactiontype": "SELL", "exchange": "NSE", "ordertype": "STOPLOSS_LIMIT",
              "producttype": "INTRADAY", "duration": "DAY", "price": "358.05", "triggerprice": "358.30",
              "squareoff": "0", "stoploss": "0", "quantity": "137"}
CFG = dict(ticket.DEFAULTS)


def synth(**over):
    with open(ORDERS_PATH, encoding="utf-8") as fh:
        o = json.load(fh)["orders"][0]
    o.update(over)
    return o


def sell(qty=137, price=365.70, sym="SYNTH"):
    return {"symbol": sym, "exchange": "NSE", "side": "sell", "qty": qty, "order_type": "LIMIT", "price": price,
            "trigger_price": None, "product": "INTRADAY", "validity": "DAY", "stop_loss": None, "target": None,
            "bracket": False}


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = ticket.main(argv)
    return code, out.getvalue(), err.getvalue()


def bodies(text):
    """Every top-level JSON object printed in a ticket, in order."""
    out, dec, i = [], json.JSONDecoder(), 0
    while True:
        i = text.find("{", i)
        if i < 0:
            return out
        try:
            obj, end = dec.raw_decode(text[i:])
            out.append(obj)
            i += end
        except ValueError:
            i += 1


class Fixtures(unittest.TestCase):
    def test_the_fixture_is_synthetic_and_consistent(self):
        o = synth()
        self.assertEqual(ticket.fingerprint(o), FP)
        with open(RISK_PATH, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["results"][0]["fingerprint"], FP)
        self.assertIn("synthetic", o["why"])
        # the order is on the NSE tick grid: limit = plan entry + 0.1%, rounded up to the 0.05 tick
        self.assertEqual(ticket.tick_up(364.18 * 1.001), 364.55)
        self.assertEqual(ticket.view(o)["notes"], [])

    def test_the_core_block_is_the_shared_one(self):
        with open(os.path.join(ROOT, "india-tests", "india_core.py"), encoding="utf-8") as fh:
            ref = fh.read()
        with open(os.path.join(SKILL_DIR, "ticket.py"), encoding="utf-8") as fh:
            mine = fh.read()
        a, b = "# --- india core: begin", "# --- india core: end"
        self.assertEqual(mine[mine.index(a):mine.index(b)], ref[ref.index(a):ref.index(b)])
        self.assertIs(ticket.fingerprint, ticket.fingerprint)
        self.assertEqual(ticket.ORDER_FIELDS[0], "symbol")


class ExplicitYes(unittest.TestCase):
    def yes(self, reply, order=None, batch=("SYNTH", "SYN-X", "SYN&M")):
        return ticket.parse_yes(reply, order or synth(), CFG, batch)[0]

    def test_plain_yes_counts(self):
        for r in ("yes", "Yes.", "YES", "y", "yes place it", "Yes, buy it", "yes SYNTH", "yes 137 SYNTH",
                  "yes 364.55", "yes 358.30", "yes max loss 908.78", "yes ₹908.78", "yes target 370",
                  "yes 358.05"):
            self.assertTrue(self.yes(r), r)

    def test_anything_else_does_not(self):
        for r in ("", "sure", "ok", "okay", "haan", "go", "do it", "yeah", "yep", "absolutely", "send it",
                  "yes to all", "yes, all of them", "yes to the rest", "yes both", "yes SYN-X", "yes SYN&M",
                  "yes 138", "yes 100 SYNTH", "yes but make it 100", "yes?", "no", "not yes", "yes, wait",
                  "yes if it is under 364", "yes, stop 358.30", "yes 1,00,000"):
            self.assertFalse(self.yes(r), r)

    def test_amount_must_match_this_order(self):
        o = sell(qty=3, price=95.5, sym="SYN-X")
        self.assertTrue(self.yes("yes sell 3 SYN-X", o))
        self.assertTrue(self.yes("yes SYN-X at 95.50", o))
        self.assertFalse(self.yes("yes sell 4", o))
        self.assertFalse(self.yes("yes sell 3 SYNTH", o))

    def test_a_symbol_with_digits_or_an_ampersand(self):
        o = sell(qty=10, price=1520.0, sym="SYN&M")
        self.assertTrue(self.yes("yes 10 SYN&M", o))
        o = sell(qty=5, price=880.0, sym="3SYNTH")
        self.assertTrue(self.yes("yes 3SYNTH", o, ["3SYNTH", "SYNTH"]))
        self.assertFalse(self.yes("yes SYNTH", o, ["3SYNTH", "SYNTH"]))


class TicketShape(unittest.TestCase):
    def test_plain_words_in_rupees_on_the_tick_grid(self):
        o = synth()
        self.assertEqual(ticket.plain(ticket.view(o), o, CFG), SYNTH_PLAIN)
        f = sell()
        self.assertEqual(ticket.plain(ticket.view(f), f, CFG),
                         "SELL 137 SYNTH (NSE), limit ₹365.70, intraday (MIS), good for today")

    def test_max_loss_includes_the_charges(self):
        o = synth()
        r = ticket.risk_of(ticket.view(o), o, CFG)
        self.assertEqual((r["ref"], r["per_share"], r["at_stop"], r["costs"], r["total"]),
                         (364.55, 6.25, 856.25, 52.53, 908.78))
        self.assertEqual(r["costs"], ticket.intraday_costs(137, 364.55, 358.30, 20, 0.03)["total"])
        no_costs = dict(CFG, include_costs_in_risk=False)
        self.assertEqual(ticket.risk_of(ticket.view(o), o, no_costs)["total"], 856.25)
        # a plan entry above the limit is the worse fill, so it is the one measured
        hi = synth(plan=dict(synth()["plan"], entry=365.00))
        self.assertEqual(ticket.risk_of(ticket.view(hi), hi, CFG)["per_share"], 6.70)
        self.assertIsNone(ticket.risk_of(ticket.view(sell()), sell(), CFG))

    def test_off_grid_and_malformed_orders(self):
        v = ticket.view(synth(price=364.57))
        self.assertIn("not on the NSE tick grid", v["notes"][0])
        self.assertEqual(ticket.view(synth(qty=2.5))["problems"][0][:3], "qty")
        self.assertTrue(ticket.view(synth(order_type="BRACKET"))["problems"])
        self.assertTrue(ticket.view(synth(stop_loss=365.0))["problems"])
        self.assertTrue(ticket.view(synth(exchange="BSE"))["problems"])
        self.assertTrue(ticket.view(synth(symbol="not a symbol!"))["problems"])

    def test_dhan_bracket_is_one_super_order(self):
        o = synth()
        reqs = ticket.requests_for(ticket.view(o), FP, "dhan", {"SYNTH": {"dhan": "99990001"}}, CFG)
        self.assertEqual(len(reqs), 1)
        self.assertEqual(reqs[0]["url"], "https://api.dhan.co/v2/super/orders")
        self.assertEqual(reqs[0]["body"], DHAN_SUPER)
        self.assertEqual(list(reqs[0]["body"]), list(DHAN_SUPER))

    def test_dhan_plain_order(self):
        f = sell()
        reqs = ticket.requests_for(ticket.view(f), "abc", "dhan", {}, CFG)
        self.assertEqual(reqs[0]["url"], "https://api.dhan.co/v2/orders")
        self.assertEqual(reqs[0]["body"], {
            "dhanClientId": "<your Dhan client id>", "correlationId": "abc", "transactionType": "SELL",
            "exchangeSegment": "NSE_EQ", "productType": "INTRADAY", "orderType": "LIMIT", "validity": "DAY",
            "securityId": "<no Dhan security ID for SYNTH: run ticket.py ids>", "quantity": 137,
            "disclosedQuantity": 0, "price": 365.7, "triggerPrice": 0.0})

    def test_angel_one_entry_then_the_stop_and_no_target_sell(self):
        o = synth()
        reqs = ticket.requests_for(ticket.view(o), FP, "angelone", {"SYNTH": {"angelone": "88880001"}}, CFG)
        self.assertEqual([r["body"] for r in reqs], [ANGEL_ENTRY, ANGEL_STOP])
        self.assertEqual(reqs[1]["when"], "only after the entry fills")
        self.assertFalse(any(r["body"]["transactiontype"] == "SELL" and r["body"]["ordertype"] == "LIMIT"
                             for r in reqs))
        for r in reqs:      # Angel One wants every value as a string
            self.assertTrue(all(isinstance(x, str) for x in r["body"].values()))
        # the stop-limit sits stop_limit_ticks ticks under the trigger, on the grid
        self.assertEqual(ticket.stop_limit_price(358.30, "sell", CFG), 358.05)
        self.assertEqual(ticket.stop_limit_price(358.30, "sell", dict(CFG, stop_limit_ticks=2)), 358.20)
        self.assertEqual(ticket.stop_limit_price(245.10, "sell", CFG), 245.05)
        self.assertEqual(ticket.stop_limit_price(1200.0, "buy", CFG), 1200.5)

    def test_the_why_and_plan_never_reach_a_broker(self):
        o = synth()
        for b in ("dhan", "angelone"):
            blob = json.dumps(ticket.requests_for(ticket.view(o), FP, b, {}, CFG))
            self.assertNotIn("opening-range", blob)
            self.assertNotIn("risk_per_share", blob)


class Flow(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.orders = os.path.join(self.d, "orders.json")
        shutil.copy(ORDERS_PATH, self.orders)
        self.cfg = os.path.join(self.d, "config.json")
        shutil.copy(CFG_PATH, self.cfg)
        self.risk = os.path.join(self.d, "state", "risk.json")
        self.state = os.path.join(self.d, "state", "broker.json")
        self.pf = os.path.join(self.d, "portfolio.json")
        self.ids = os.path.join(self.d, "security_ids.json")
        self.none = os.path.join(self.d, "none")

    def tearDown(self):
        shutil.rmtree(self.d)

    def args(self, *extra, **kw):
        return list(extra) + ["--orders", self.orders, "--config", self.cfg, "--risk", self.risk,
                              "--state", self.state, "--ids", kw.get("ids", self.ids), "--now", kw.get("now", NOW)]

    def set_cfg(self, **over):
        with open(self.cfg, encoding="utf-8") as fh:
            c = json.load(fh)
        c.update(over)
        with open(self.cfg, "w", encoding="utf-8") as fh:
            json.dump(c, fh)

    def write_risk(self, verdict="PASS", date=TODAY, reasons=(), kind=None):
        """What india-risk records: one verdict per order fingerprint, for one India date."""
        with open(self.orders, encoding="utf-8") as fh:
            orders = json.load(fh)["orders"]
        os.makedirs(os.path.dirname(self.risk), exist_ok=True)
        res = [{"index": i, "symbol": o["symbol"], "side": o["side"],
                "kind": kind or ("entry" if o["side"] == "buy" else "exit"),
                "fingerprint": ticket.fingerprint(o), "verdict": verdict, "reasons": list(reasons),
                "warnings": []} for i, o in enumerate(orders, 1)]
        with open(self.risk, "w", encoding="utf-8") as fh:
            json.dump({"date": date, "results": res}, fh)

    def state_doc(self):
        with open(self.state, encoding="utf-8") as fh:
            return json.load(fh)

    def portfolio(self):
        with open(self.pf, encoding="utf-8") as fh:
            return json.load(fh)

    def test_nothing_is_ready_before_the_risk_check(self):
        code, text, _ = run(self.args("show"))
        self.assertEqual(code, 1)
        self.assertIn("NOT READY: india-risk has not checked", text)
        self.assertNotIn('Reply "yes"', text)
        code, _, err = run(self.args("approve", "--index", "1", "--reply", "yes"))
        self.assertEqual(code, 1)
        self.assertIn("not ready", err)

    def test_the_full_paper_flow(self):
        os.makedirs(os.path.dirname(self.risk), exist_ok=True)
        shutil.copy(RISK_PATH, self.risk)                   # the synthetic india-risk verdict fixture
        code, text, _ = run(self.args("show", "--index", "1"))
        self.assertEqual(code, 0)
        self.assertIn("ORDER 1 of 1, PAPER (simulated here, nothing goes to a broker), 2026-10-19 09:55 IST", text)
        for part in SYNTH_PLAIN.split(" / "):
            self.assertIn("  " + part + "\n", text)
        self.assertIn("READY: india-risk PASS", text)
        self.assertIn("ticket.py paper --index 1", text)
        self.assertNotIn("POST https://", text)          # paper with no --as shows no broker request

        code, text, _ = run(self.args("approve", "--index", "1", "--reply", "sure"))
        self.assertEqual(code, 1)
        self.assertIn("Not recorded", text)
        self.assertFalse(os.path.exists(self.state))

        code, text, _ = run(self.args("approve", "--index", "1", "--reply", "yes"))
        self.assertEqual(code, 0)
        self.assertIn("Paper mode", text)
        code, _, err = run(self.args("approve", "--index", "1", "--reply", "yes"))
        self.assertEqual(code, 1)
        self.assertIn("APPROVED", err)

        # a buy limit at 364.55 does not fill while the stock trades at 365.00
        code, text, _ = run(self.args("paper", "--index", "1", "--price", "365.00", "--portfolio", self.pf))
        self.assertEqual(code, 1)
        self.assertIn("Not filled", text)
        self.assertEqual([r["status"] for r in self.state_doc()["orders"]], ["approved"])
        self.assertFalse(os.path.exists(self.pf))

        code, text, _ = run(self.args("paper", "--index", "1", "--price", "364.40", "--portfolio", self.pf,
                                      now="2026-10-19 09:56"))
        self.assertEqual(code, 0, text)
        self.assertIn("Paper fill: BUY 137 SYNTH at ₹364.40 (simulated)", text)
        self.assertIn("max loss ₹908.78", text)
        st = self.state_doc()
        self.assertEqual([r["status"] for r in st["orders"]], ["approved", "placed", "filled"])
        appr, plc, fil = st["orders"]
        self.assertEqual((appr["reply"], appr["kind"], appr["max_loss"], appr["date"], appr["at"]),
                         ("yes", "entry", 908.78, TODAY, "2026-10-19T09:55:00+05:30"))
        self.assertEqual((plc["broker"], plc["paper"], plc["max_loss"], plc["broker_order_id"], plc["fingerprint"]),
                         ("paper", True, 908.78, "PAPER-" + FP[:8], FP))
        charges = ticket.intraday_costs(137, 364.40, 0, 20, 0.03)["total"]
        self.assertEqual((fil["price"], fil["qty"], fil["charges"]), (364.40, 137, charges))
        pf = self.portfolio()
        self.assertEqual(pf["cash"], round(100000 - 137 * 364.40 - charges, 2))
        self.assertEqual(pf["cash"], 50056.16)
        self.assertEqual(pf["positions"][0]["shares"], 137)

        code, text, _ = run(self.args("show", "--index", "1"))
        self.assertIn("DONE: placed", text)
        code, text, _ = run(["log", "--state", self.state, "--now", NOW])
        self.assertIn("1 placed today (1 on paper)", text)
        self.assertIn("max loss ₹908.78", text)
        code, _, err = run(self.args("paper", "--index", "1", "--portfolio", self.pf))
        self.assertEqual(code, 1)
        self.assertIn("no yes recorded", err)

    def test_paper_fills_at_the_limit_by_default(self):
        self.write_risk()
        run(self.args("approve", "--index", "1", "--reply", "yes 137 SYNTH"))
        code, text, _ = run(self.args("paper", "--index", "1", "--portfolio", self.pf))
        self.assertEqual(code, 0)
        self.assertIn("at ₹364.55", text)
        self.assertEqual(self.portfolio()["positions"][0]["lots"][0]["cost"], 49943.35)
        self.assertEqual(self.portfolio()["cash"], 50035.6)       # the fixture portfolio after this fill
        with open(PF_PATH, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["cash"], 50035.6)

    def test_paper_tickets_show_a_broker_shape_on_request(self):
        self.write_risk()
        code, text, _ = run(self.args("show", "--as", "dhan", ids=self.none))
        self.assertEqual(code, 0)                               # paper needs no security ID
        self.assertIn("For reference only (paper mode: nothing goes to Dhan)", text)
        b = bodies(text)[0]
        self.assertEqual(b["securityId"], "<no Dhan security ID for SYNTH: run ticket.py ids>")
        code, text, _ = run(self.args("show", "--as", "angelone", ids=IDS_PATH))
        self.assertEqual(bodies(text), [ANGEL_ENTRY, ANGEL_STOP])
        self.assertIn("NOT placed at Angel One", text)
        self.assertIn("india-alerts watches the target", text)
        code, text, _ = run(self.args("show", "--json", "--as", "dhan", ids=IDS_PATH))
        t = json.loads(text)[0]
        self.assertEqual((t["ready"], t["mode"], t["max_loss"], t["costs_at_stop"]), (True, "paper", 908.78, 52.53))
        self.assertEqual(t["requests"][0]["body"], DHAN_SUPER)

    def test_live_dhan_needs_the_security_id_and_says_why_claude_cannot_send_it(self):
        self.set_cfg(paper=False, broker="dhan")
        self.write_risk()
        code, text, _ = run(self.args("show", ids=self.none))
        self.assertEqual(code, 1)
        self.assertIn("LIVE ACCOUNT, REAL MONEY, Dhan", text)
        self.assertIn("NOT READY for live: no Dhan security ID for SYNTH", text)
        self.assertIn('"securityId": "<no Dhan security ID for SYNTH: run ticket.py ids>"', text)
        self.assertEqual(run(self.args("approve", "--index", "1", "--reply", "yes", ids=self.none))[0], 1)

        code, text, _ = run(self.args("show", ids=IDS_PATH))
        self.assertEqual(code, 0)
        self.assertIn("Dhan: ONE Super Order (entry, target and stop-loss together):", text)
        self.assertIn("POST https://api.dhan.co/v2/super/orders", text)
        self.assertEqual(bodies(text), [DHAN_SUPER])
        self.assertIn("DH-911", text)
        self.assertIn("static IP", text)
        self.assertIn("Claude cannot send it from here", text)
        code, _, err = run(self.args("show", "--as", "angelone", ids=IDS_PATH))
        self.assertEqual(code, 1)
        self.assertIn("only for paper mode", err)

        code, text, _ = run(self.args("approve", "--index", "1", "--reply", "yes", ids=IDS_PATH))
        self.assertEqual(code, 0)
        self.assertEqual(bodies(text), [DHAN_SUPER])
        self.assertIn("ticket.py result", text)
        code, _, err = run(self.args("paper", "--index", "1", "--portfolio", self.pf, ids=IDS_PATH))
        self.assertEqual(code, 1)
        self.assertIn("your config is live", err)
        code, text, _ = run(self.args("result", "--index", "1", "--status", "placed", "--broker-id", "SYN-0001",
                                      "--filled-qty", "137", "--filled-price", "364.50", "--portfolio", self.pf,
                                      ids=IDS_PATH, now="2026-10-19 09:57"))
        self.assertEqual(code, 0)
        st = self.state_doc()
        self.assertEqual([r["status"] for r in st["orders"]], ["approved", "placed", "filled"])
        self.assertEqual((st["orders"][1]["broker"], st["orders"][1]["paper"], st["orders"][1]["broker_order_id"],
                          st["orders"][1]["max_loss"]), ("dhan", False, "SYN-0001", 908.78))
        self.assertEqual(self.portfolio()["positions"][0]["shares"], 137)

    def test_live_angel_one_two_steps(self):
        self.set_cfg(paper=False, broker="angelone")
        self.write_risk()
        code, text, _ = run(self.args("show", ids=IDS_PATH))
        self.assertEqual(code, 0)
        self.assertIn("Step 1, now: the entry", text)
        self.assertIn("Step 2, only after the entry fills: the protective stop-loss (STOPLOSS_LIMIT sell, "
                      "trigger ₹358.30, limit ₹358.05)", text)
        self.assertEqual(bodies(text), [ANGEL_ENTRY, ANGEL_STOP])
        self.assertIn("Since 2026-04-01 Angel One accepts API orders", text)
        run(self.args("approve", "--index", "1", "--reply", "yes", ids=IDS_PATH))
        code, text, _ = run(self.args("result", "--index", "1", "--status", "placed", "--portfolio", self.pf,
                                      ids=IDS_PATH))
        self.assertIn("place step 2, the STOPLOSS_LIMIT sell", text)

    def test_no_credentials_in_any_output(self):
        self.set_cfg(paper=False, broker="dhan", dhan_client_id="1100SECRET", access_token="tok-SECRET",
                     totp_secret="TOTPSECRET")
        self.write_risk()
        outs = [run(self.args("show", ids=IDS_PATH)), run(self.args("show", "--json", ids=IDS_PATH)),
                run(self.args("approve", "--index", "1", "--reply", "yes", ids=IDS_PATH))]
        for code, text, err in outs:
            for secret in ("1100SECRET", "tok-SECRET", "TOTPSECRET"):
                self.assertNotIn(secret, text + err)
        self.assertIn("your config holds access_token, dhan_client_id, totp_secret: delete them", outs[0][1])
        with open(self.state, encoding="utf-8") as fh:
            self.assertNotIn("SECRET", fh.read())

    def test_result_placed_is_for_live_orders_only(self):
        self.write_risk()
        code, _, err = run(self.args("result", "--index", "1", "--status", "placed"))
        self.assertEqual(code, 1)
        self.assertIn("no yes recorded", err)
        run(self.args("approve", "--index", "1", "--reply", "yes"))
        code, _, err = run(self.args("result", "--index", "1", "--status", "placed"))
        self.assertEqual(code, 1)
        self.assertIn("ticket.py paper --index 1", err)
        self.assertEqual(run(self.args("result", "--index", "1", "--status", "denied"))[0], 0)
        code, text, _ = run(self.args("show", "--index", "1"))
        self.assertIn("DONE: denied", text)

    def test_an_edited_order_is_not_ready(self):
        self.write_risk()
        with open(self.orders, encoding="utf-8") as fh:
            doc = json.load(fh)
        doc["orders"][0]["qty"] = 138
        with open(self.orders, "w", encoding="utf-8") as fh:
            json.dump(doc, fh)
        code, text, _ = run(self.args("show", "--index", "1"))
        self.assertEqual(code, 1)
        self.assertIn("was not in the last risk check", text)

    def test_yesterdays_check_does_not_count(self):
        self.write_risk(date="2026-10-16")
        code, text, _ = run(self.args("show", "--index", "1"))
        self.assertEqual(code, 1)
        self.assertIn("not today", text)

    def test_the_india_date_decides_today(self):
        # 2026-10-19 18:40 UTC is already 2026-10-20 00:10 in India: the 19th's check is stale
        self.write_risk()
        code, text, _ = run(self.args("show", now="2026-10-19T18:40:00Z"))
        self.assertIn("not today", text)
        self.assertIn("not an NSE trading day (NSE holiday: Dussehra)", text)

    def test_blocked_orders_are_never_ready(self):
        self.write_risk(verdict="BLOCK", reasons=["window: no new entries before 09:30"])
        code, text, _ = run(self.args("show", "--index", "1"))
        self.assertIn("BLOCKED by india-risk: window: no new entries before 09:30", text)
        self.assertEqual(run(self.args("approve", "--index", "1", "--reply", "yes"))[0], 1)

    def test_decline_is_logged(self):
        self.write_risk()
        code, text, _ = run(self.args("decline", "--index", "1", "--reply", "no thanks"))
        self.assertEqual(code, 0)
        self.assertIn("Nothing was sent", text)
        code, text, _ = run(self.args("show", "--index", "1"))
        self.assertIn("DONE: declined", text)

    def test_flatten_by_the_close_on_paper(self):
        shutil.copy(PF_PATH, self.pf)
        late = "2026-10-19 14:58"
        code, text, _ = run(["flatten", "--symbol", "synth", "--orders", self.orders, "--portfolio", self.pf,
                             "--prices", PRICES_PATH, "--plan", PLAN_PATH, "--config", self.cfg, "--now", late])
        self.assertEqual(code, 0, text)
        self.assertIn("SELL 137 SYNTH (NSE), limit ₹365.70, intraday (MIS), good for today (flat by 15:00 IST)", text)
        self.assertIn("replaced 1 earlier proposal", text)
        self.assertNotIn("minutes ago", text)                   # the synthetic quote is 3 minutes old
        with open(self.orders, encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(doc["created_by"], "india-broker")
        o = doc["orders"][0]
        self.assertEqual({k: o[k] for k in ticket.ORDER_FIELDS}, sell())
        self.assertEqual(o["price"], ticket.tick_down(366.10 * (1 - 0.001)))

        self.write_risk(kind="exit")
        code, text, _ = run(self.args("show", now=late))
        self.assertEqual(code, 0)
        self.assertNotIn("max loss", text)
        self.assertEqual(run(self.args("approve", "--index", "1", "--reply", "yes sell 137 SYNTH", now=late))[0], 0)
        # a sell limit at 365.70 fills at 366.00 (better), not at 365.50 (worse)
        self.assertEqual(run(self.args("paper", "--index", "1", "--price", "365.50", "--portfolio", self.pf,
                                       now=late))[0], 1)
        code, text, _ = run(self.args("paper", "--index", "1", "--price", "366.00", "--portfolio", self.pf,
                                      now="2026-10-19 14:59"))
        self.assertEqual(code, 0, text)
        pf = self.portfolio()
        charges = ticket.intraday_costs(137, 0, 366.00, 20, 0.03)["total"]
        self.assertEqual(pf["positions"], [])
        self.assertEqual(pf["cash"], round(50035.6 + 137 * 366.00 - charges, 2))
        self.assertEqual(pf["cash"], 100145.44)
        st = self.state_doc()
        self.assertEqual(st["orders"][1]["kind"], "exit")
        self.assertNotIn("max_loss", st["orders"][1])
        code, _, err = run(["flatten", "--symbol", "SYNTH", "--orders", self.orders, "--portfolio", self.pf,
                            "--price", "366", "--now", late])
        self.assertEqual(code, 1)
        self.assertIn("nothing to flatten", err)

    def test_flatten_says_what_to_cancel_at_each_broker(self):
        common = ["--orders", self.orders, "--qty", "137", "--price", "366.10", "--portfolio", self.none,
                  "--plan", self.none, "--config", self.cfg, "--now", NOW]
        self.set_cfg(paper=False, broker="dhan")
        code, text, _ = run(["flatten", "--symbol", "SYNTH"] + common)
        self.assertEqual(code, 0)
        self.assertIn("Super Order's target and stop-loss legs", text)
        self.assertNotIn("Check it against", text)
        self.set_cfg(paper=False, broker="angelone")
        code, text, _ = run(["flatten", "--symbol", "SYNTH"] + common)
        self.assertIn("cancel the resting STOPLOSS_LIMIT sell first", text)

    def test_flatten_needs_a_price_and_a_whole_qty(self):
        code, _, err = run(["flatten", "--symbol", "SYNTH", "--qty", "137", "--orders", self.orders,
                            "--prices", self.none, "--config", self.cfg, "--now", NOW])
        self.assertEqual(code, 1)
        self.assertIn("needs the last price", err)
        self.assertEqual(run(["flatten", "--symbol", "SYNTH", "--qty", "0", "--price", "366",
                              "--orders", self.orders])[0], 1)
        self.assertEqual(run(["flatten", "--symbol", "SYNTH", "--qty", "2.5", "--price", "366",
                              "--orders", self.orders])[0], 1)

    def test_flatten_warns_on_a_stale_quote(self):
        code, text, _ = run(["flatten", "--symbol", "SYNTH", "--qty", "137", "--orders", self.orders,
                             "--prices", PRICES_PATH, "--plan", self.none, "--config", self.cfg,
                             "--now", "2026-10-19 15:20"])
        self.assertEqual(code, 0)
        self.assertIn("the last price is from 14:55 IST, 25 minutes ago", text)

    def test_ids_from_the_scrip_masters(self):
        code, text, _ = run(["ids", "SYNTH", "syn-x", "SYN&M", "--dhan-csv", DHAN_CSV, "--angel-json", ANGEL_JSON,
                             "--out", self.ids])
        self.assertEqual(code, 0, text)
        with open(self.ids, encoding="utf-8") as fh:
            ids = json.load(fh)
        self.assertEqual(ids, {"SYNTH": {"dhan": "99990001", "angelone": "88880001"},
                               "SYN-X": {"dhan": "99990004", "angelone": "88880004"},
                               "SYN&M": {"dhan": "99990005", "angelone": "88880005"}})
        with open(IDS_PATH, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["SYNTH"], ids["SYNTH"])
        self.assertIn("not credentials", text)

    def test_ids_merge_and_report_what_is_missing(self):
        with open(self.ids, "w", encoding="utf-8") as fh:
            json.dump({"OTHER": {"dhan": "1"}, "SYNTH": {"angelone": "88880001"}}, fh)
        code, text, _ = run(["ids", "SYNTH", "NOPE", "--dhan-csv", DHAN_CSV, "--out", self.ids])
        self.assertEqual(code, 1)
        self.assertIn("NOPE on Dhan", text)
        with open(self.ids, encoding="utf-8") as fh:
            ids = json.load(fh)
        self.assertEqual(ids, {"OTHER": {"dhan": "1"}, "SYNTH": {"angelone": "88880001", "dhan": "99990001"}})

    def test_ids_refuse_a_file_that_is_not_a_scrip_master(self):
        bad = os.path.join(self.d, "bad.csv")
        with open(bad, "w", encoding="utf-8") as fh:
            fh.write("symbol,id\nSYNTH,1\n")
        code, _, err = run(["ids", "SYNTH", "--dhan-csv", bad, "--out", self.ids])
        self.assertEqual(code, 1)
        self.assertIn("does not look like Dhan's scrip master", err)
        code, _, err = run(["ids", "SYNTH", "--angel-json", PRICES_PATH, "--out", self.ids])
        self.assertEqual(code, 1)
        self.assertIn("does not look like Angel One's scrip master", err)
        self.assertEqual(run(["ids", "SYNTH", "--out", self.ids])[0], 1)

    def test_fill_sell_relieves_the_oldest_lot_and_counts_charges(self):
        pf = {"cash": 0, "positions": [{"ticker": "SYN-X", "shares": 30, "lots": [
            {"id": "SYN-X-1", "date": "2026-10-16", "shares": 20, "cost": 2000.0},
            {"id": "SYN-X-2", "date": "2026-10-19", "shares": 10, "cost": 1100.0}]}]}
        with open(self.pf, "w", encoding="utf-8") as fh:
            json.dump(pf, fh)
        code, text, _ = run(["fill", "--symbol", "SYN-X", "--side", "sell", "--qty", "25", "--price", "120",
                             "--charges", "5.50", "--date", TODAY, "--portfolio", self.pf, "--config", self.cfg,
                             "--state", self.state])
        self.assertEqual(code, 0, text)
        pf = self.portfolio()
        self.assertEqual(pf["cash"], 2994.5)
        lots = pf["positions"][0]["lots"]
        self.assertEqual([(l["id"], l["shares"], l["cost"]) for l in lots], [("SYN-X-2", 5, 550.0)])
        self.assertEqual(self.state_doc()["orders"][-1]["status"], "filled")
        code, _, err = run(["fill", "--symbol", "SYN-X", "--side", "sell", "--qty", "6", "--price", "120",
                            "--portfolio", self.pf, "--config", self.cfg, "--state", self.state])
        self.assertEqual(code, 1)
        self.assertIn("this pack does not short", err)
        self.assertNotIn("Traceback", err)
        code, text, _ = run(["fill", "--symbol", "SYN-X", "--side", "sell", "--qty", "5", "--price", "120",
                             "--portfolio", self.pf, "--config", self.cfg, "--state", self.state])
        self.assertIn("estimated", text)
        self.assertEqual(self.portfolio()["positions"], [])

    def test_a_bad_broker_name_is_refused(self):
        self.set_cfg(broker="zerodha")
        code, _, err = run(self.args("show"))
        self.assertEqual(code, 1)
        self.assertIn('"broker"', err)


class SkillDoc(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(SKILL_DIR, "SKILL.md"), encoding="utf-8") as fh:
            cls.md = fh.read()

    def test_frontmatter(self):
        self.assertTrue(self.md.startswith("---\nname: india-broker\n"))
        self.assertIn("${CLAUDE_SKILL_DIR}/ticket.py", self.md)

    def test_safety_block_is_the_shared_one(self):
        with open(os.path.join(ROOT, "india-tests", "CONVENTIONS.md"), encoding="utf-8") as fh:
            conv = fh.read()
        block = conv[conv.index("## Safety"):]
        block = block[:block.index("```")].strip()
        self.assertIn(block, self.md)

    def test_it_says_what_is_not_confirmed(self):
        for words in ("not live-tested", "DH-911", "static IP", "Super Order", "STOPLOSS_LIMIT",
                      "dhan-oss/dhanhq-skills", "not paper trading", "security_ids.json"):
            self.assertIn(words, self.md)

    def test_no_em_dashes(self):
        paths = [os.path.join(SKILL_DIR, f) for f in os.listdir(SKILL_DIR) if f.endswith((".py", ".md"))]
        paths += [os.path.join(BF, f) for f in os.listdir(BF)] + [os.path.abspath(__file__)]
        for p in paths:
            with open(p, encoding="utf-8") as fh:
                self.assertNotIn("—", fh.read(), p)

    def test_no_trader_paths(self):
        with open(os.path.join(SKILL_DIR, "ticket.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertIsNone(re.search(r"[\"']trader/", src))
        self.assertNotIn("New York", src)


if __name__ == "__main__":
    unittest.main()
