"""india-insider: SEBI PIT insider filings and NSE bulk/block deals.

Every fixture in fixtures/india-insider/ is SYNTHETIC (SYNTH symbols, fake
names, example.invalid links), built in the formats the lead and a community
parser describe. None of it is NSE data.
"""
import datetime
import gzip
import io
import json
import os
import re
import shutil
import socket
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout

from _load import FIX, HERE, ROOT, load

ins = load("india-insider", "insider")
DIR = os.path.join(FIX, "india-insider")
SKILL = os.path.join(ROOT, "india-insider")
NOW = "2026-11-11 20:00"          # a Wednesday, India time; 2026-11-10 is an NSE holiday


def fx(*parts):
    return os.path.join(DIR, *parts)


def raw(name):
    with open(fx(name), "rb") as fh:
        return fh.read()


def run(args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = ins.main(args)
    return code, out.getvalue(), err.getvalue()


class Lists(object):
    """A temp folder with your lists: SYNTH held, SYN-X on the watchlist."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.wl = os.path.join(self.tmp, "watchlist.json")
        self.pf = os.path.join(self.tmp, "portfolio.json")
        with open(self.wl, "w") as fh:
            json.dump({"hits": [{"symbol": "SYN-X"}, {"symbol": "SYNTH"}]}, fh)
        with open(self.pf, "w") as fh:
            json.dump({"cash": 50000, "positions": [{"symbol": "SYNTH", "qty": 10}]}, fh)
        self.lists = ["--watchlist", self.wl, "--portfolio", self.pf, "--now", NOW]


# ---------------------------------------------------------------- PIT filings

class PitFilings(Lists, unittest.TestCase):
    def test_rows_newest_first_in_india_time(self):
        rows = ins.pit_rows(json.loads(raw("pit.json")))
        self.assertEqual([r["app_id"] for r in rows], ["9000101", "9000102", "9000103", "9000090"])
        top = rows[0]
        self.assertEqual(top["symbol"], "SYNTH")
        self.assertEqual(top["broadcast"], "2026-11-11 18:42")
        self.assertEqual(top["xml_url"], "https://example.invalid/synthetic-pit/pit-9000101.xml")
        self.assertFalse(top["revision"])
        self.assertIsNone(top["prev_app_id"])

    def test_revision_and_nse_blanks(self):
        rev = next(r for r in ins.pit_rows(json.loads(raw("pit.json"))) if r["app_id"] == "9000103")
        self.assertEqual(rev["symbol"], "SYN&Y")
        self.assertTrue(rev["revision"])
        self.assertEqual(rev["prev_app_id"], "9000099")
        self.assertEqual(rev["revision_remark"], "Corrected number of shares")
        self.assertIsNone(rev["ixbrl_url"])   # "-" is a blank

    def test_window_and_symbol_filter_offline(self):
        code, out, _ = run(["pit", "--offline", DIR, "--days", "7"] + self.lists)
        self.assertEqual(code, 0)
        self.assertIn("2026-11-05 to 2026-11-11 (India time): 3", out)
        self.assertNotIn("9000090", out)          # broadcast 2026-11-02, outside 7 days
        code, out, _ = run(["pit", "--offline", DIR, "--days", "10", "--symbol", "synth",
                            "--json"] + self.lists)
        doc = json.loads(out)
        self.assertEqual([f["app_id"] for f in doc["filings"]], ["9000101", "9000090"])
        self.assertEqual(doc["from"], "2026-11-02")

    def test_flags_and_links(self):
        code, out, _ = run(["pit", "--offline", DIR] + self.lists)
        self.assertIn("2026-11-11 18:42 IST  SYNTH", out)
        self.assertIn("<- you hold SYNTH", out)               # held wins over the watchlist
        self.assertIn("<- SYN-X is on your watchlist", out)
        self.assertIn("revision of app 9000099: Corrected number of shares", out)
        self.assertIn("xml:   https://example.invalid/synthetic-pit/pit-9000102.xml", out)
        self.assertIn("Add --read", out)
        self.assertIn("Not inside information", out)
        self.assertIn("not a real-time signal", out)

    def test_read_attaches_trades_and_reports_a_missing_xml(self):
        code, out, _ = run(["pit", "--offline", DIR, "--read", "--json"] + self.lists)
        doc = json.loads(out)
        by = {f["app_id"]: f for f in doc["filings"]}
        self.assertEqual(len(by["9000101"]["trades"]), 2)
        self.assertEqual(len(by["9000102"]["trades"]), 2)
        self.assertIn("offline: no", by["9000103"]["xml_error"])
        code, out, _ = run(["pit", "--offline", DIR, "--read"] + self.lists)
        self.assertIn("promoter buying in the market: SYNTH PROMOTER TRUST (Promoter Group) "
                      "bought 50,000 shares worth ₹4,13,07,500.00 (about ₹826.15 a share)",
                      out)
        self.assertIn("could not read the XML: offline: no", out)
        self.assertIn("not confirmed against a real NSE file", out)

    def test_read_limit(self):
        code, out, _ = run(["pit", "--offline", DIR, "--read", "--read-limit", "1"] + self.lists)
        self.assertIn("XML read for the first 1 only", out)
        self.assertEqual(out.count("    - "), 2)            # only 9000101's two rows

    def test_file_route_finds_xml_next_to_the_saved_json(self):
        folder = os.path.join(self.tmp, "saved")
        os.makedirs(os.path.join(folder, "xml"))
        shutil.copy(fx("pit.json"), os.path.join(folder, "pit-from-browser.json"))
        shutil.copy(fx("xml", "pit-9000101.xml"), os.path.join(folder, "xml"))
        code, out, _ = run(["pit", "--file", os.path.join(folder, "pit-from-browser.json"),
                            "--symbol", "SYNTH", "--read", "--read-limit", "1",
                            "--xml-cache", ""] + self.lists)
        self.assertEqual(code, 0)
        self.assertIn("from %s" % os.path.join(folder, "pit-from-browser.json"), out)
        self.assertIn("9000090", out)                       # --file: no date window
        self.assertIn("SYNTH PROMOTER TRUST", out)

    def test_wrong_files_say_so(self):
        with self.assertRaises(ins.InsiderError) as cm:
            ins.pit_rows(json.loads(raw("bulk_deals.json")))
        self.assertIn("deals file", str(cm.exception))
        with self.assertRaises(ins.InsiderError):
            ins.pit_rows({"rows": []})
        code, _, err = run(["pit", "--file", fx("bulk.csv")] + self.lists)
        self.assertEqual(code, 2)
        self.assertIn("is not JSON", err)

    def test_nothing_found_is_exit_1(self):
        code, out, _ = run(["pit", "--offline", DIR, "--symbol", "SYNQ"] + self.lists)
        self.assertEqual(code, 1)
        self.assertIn(": 0", out)


# ---------------------------------------------------------------- PIT XML

class PitXml(unittest.TestCase):
    def test_flat_xbrl_rows_by_context(self):
        rep = ins.parse_pit_xml(raw(os.path.join("xml", "pit-9000101.xml")),
                                datetime.date(2026, 11, 11))
        self.assertEqual(len(rep["rows"]), 2)
        self.assertEqual(rep["header"]["NameOfTheCompany"], "Synth Industries Limited (synthetic)")
        buy = rep["rows"][0]
        self.assertEqual(buy["group"], "Disclosure1")
        self.assertEqual((buy["person"], buy["category"]), ("SYNTH PROMOTER TRUST", "Promoter Group"))
        self.assertEqual((buy["side"], buy["mode"], buy["mode_kind"]), ("buy", "Market Purchase", "market"))
        self.assertEqual(buy["shares"], 50000)
        self.assertEqual(buy["value"], 41307500.0)
        self.assertEqual(buy["price"], 826.15)
        self.assertEqual((buy["held_before"], buy["held_after"]), (12000000, 12050000))
        self.assertEqual((buy["pct_before"], buy["pct_after"]), ("12.00", "12.05"))   # as filed
        self.assertEqual((buy["trade_from"], buy["trade_to"]), ("2026-11-06", "2026-11-06"))
        self.assertEqual(buy["intimated"], "2026-11-09")
        self.assertEqual(buy["signal"], "promoter buying in the market")
        self.assertEqual(sorted(buy["unconfirmed"]),
                         ["category", "exchange", "intimated", "mode", "person", "trade_to"])
        # context and unit definitions are not facts
        self.assertNotIn("identifier", buy["facts"])
        self.assertNotIn("measure", rep["header"])

    def test_disclosure_delay_counts_nse_trading_days(self):
        rep = ins.parse_pit_xml(raw(os.path.join("xml", "pit-9000101.xml")),
                                datetime.date(2026, 11, 11))
        buy, esop = rep["rows"]
        # Fri 2026-11-06 -> Wed 2026-11-11: Mon 9, (Tue 10 Diwali Balipratipada), Wed 11
        self.assertEqual((buy["days_to_disclose"], buy["trading_days_to_disclose"]), (5, 2))
        self.assertFalse(buy["slow"])
        self.assertEqual(esop["trading_days_to_disclose"], 4)
        self.assertEqual(esop["signal"], "not a market trade (ESOP)")
        self.assertEqual(esop["unconfirmed"], ["person", "category", "mode"])

    def test_pledge_sale_and_both_spellings(self):
        rep = ins.parse_pit_xml(raw(os.path.join("xml", "pit-9000102.xml")),
                                datetime.date(2026, 11, 9))
        pledge, sale = rep["rows"]
        self.assertEqual(pledge["side"], "pledge created")
        self.assertEqual(pledge["signal"], "promoter pledge created")
        self.assertEqual(pledge["held_after"], 5000000)        # "PostAcquisition" spelling
        self.assertEqual(pledge["trading_days_to_disclose"], 10)
        self.assertTrue(pledge["slow"])
        self.assertEqual((sale["side"], sale["signal"]), ("sell", "promoter selling in the market"))
        self.assertEqual(sale["price"], 150.0)
        lines = ins.describe_trade(pledge)
        self.assertIn("pledged 2,00,000 shares worth ₹3,00,00,000.00", lines[0])
        self.assertIn("dated 2026-10-26", lines[0])
        self.assertIn("more than the usual 2 + 2", lines[0])
        self.assertEqual(lines[1], "holds 50,00,000 -> 50,00,000 shares")

    def test_wrapper_elements_and_unknown_names(self):
        xml = (b"<root><Disclosure1><SecuritiesAcquiredOrDisposedNumberOfSecurity>1,000"
               b"</SecuritiesAcquiredOrDisposedNumberOfSecurity>"
               b"<SecuritiesAcquiredOrDisposedTransactionType>Revocation"
               b"</SecuritiesAcquiredOrDisposedTransactionType>"
               b"<NameOfAcquirerOrSeller>SYNTH SOMEONE (FAKE)</NameOfAcquirerOrSeller>"
               b"</Disclosure1><Note>header</Note></root>")
        rep = ins.parse_pit_xml(xml)
        self.assertEqual(len(rep["rows"]), 1)
        row = rep["rows"][0]
        self.assertEqual(row["group"], "Disclosure1")
        self.assertEqual(row["shares"], 1000)
        self.assertEqual(row["side"], "pledge released")
        self.assertEqual(row["person"], "SYNTH SOMEONE (FAKE)")   # found by the loose rule
        self.assertIn("person", row["unconfirmed"])
        self.assertIsNone(row["trading_days_to_disclose"])        # no filing date given
        self.assertEqual(rep["header"], {"Note": "header"})

    def test_no_rows_and_bad_xml(self):
        self.assertEqual(ins.parse_pit_xml(b"<a><b>1</b></a>")["rows"], [])
        with self.assertRaises(ins.InsiderError):
            ins.parse_pit_xml(b"<html>Access Denied")

    def test_side_and_mode_words(self):
        self.assertEqual(ins.side_of("Pledge Invoked"), "pledge invoked")
        self.assertEqual(ins.side_of("Market Purchase"), "buy")
        self.assertEqual(ins.side_of("Disposal"), "sell")
        self.assertEqual(ins.side_of("Others"), "other")
        self.assertEqual(ins.mode_of("Off Market"), "off-market")
        self.assertEqual(ins.mode_of("Inter-se Transfer"), "inter-se transfer")
        self.assertEqual(ins.mode_of("On Market"), "market")
        self.assertEqual(ins.mode_of("Preferential Offer"), "allotment")

    def test_xml_cli_raw(self):
        code, out, _ = run(["xml", fx("xml", "pit-9000102.xml"), "--filed", "2026-11-09", "--raw"])
        self.assertEqual(code, 0)
        self.assertIn("2 rows", out)
        self.assertIn("SecuritiesAcquiredOrDisposedTransactionType = Pledge Created", out)
        self.assertIn("NameOfTheCompany = Syn-X Chemicals Limited (synthetic)", out)
        code, out, _ = run(["xml", fx("xml", "pit-9000101.xml"), "--json"])
        self.assertEqual(len(json.loads(out)["rows"]), 2)

    def test_unknown_year_warns_about_the_calendar(self):
        xml = raw(os.path.join("xml", "pit-9000101.xml")).replace(b"2026-11-06", b"2027-01-04")
        path = os.path.join(tempfile.mkdtemp(), "f.xml")
        self.addCleanup(shutil.rmtree, os.path.dirname(path))
        with open(path, "wb") as fh:
            fh.write(xml)
        code, out, err = run(["xml", path, "--filed", "2027-01-08"])
        self.assertEqual(code, 0)
        self.assertIn("holidays.json", err)
        self.assertIn("4 trading days later", out)   # Tue 5 .. Fri 8, weekends only


# ---------------------------------------------------------------- bulk and block deals

class Deals(Lists, unittest.TestCase):
    def test_bulk_csv(self):
        rows = ins.parse_deals_bytes(raw("bulk.csv"), None, fx("bulk.csv"))
        self.assertEqual(len(rows), 4)
        first = rows[0]
        self.assertEqual(first, {"kind": "bulk", "date": "2026-11-11", "symbol": "SYNTH",
                                 "name": "Synth Industries Limited (synthetic)",
                                 "client": "SYNTH CLIENT FUND LLP", "side": "buy", "qty": 108709,
                                 "price": 826.15, "value": 89809940.35, "remarks": None})
        self.assertEqual(rows[2]["qty"], 250000)                # "2,50,000" in the file
        self.assertEqual(rows[3]["remarks"], "Synthetic remark")

    def test_block_csv_has_no_remarks_column(self):
        text = raw("block.csv").decode("utf-8")
        rows, kind = ins.deals_from_csv(text)
        self.assertEqual(kind, "block")
        self.assertEqual([(r["side"], r["qty"], r["value"]) for r in rows],
                         [("buy", 400000, 330000000.0), ("sell", 400000, 330000000.0)])
        self.assertEqual(ins.crore(rows[0]["value"]), "₹33.00 crore")
        self.assertEqual(ins.deals_from_csv(raw("bulk.csv").decode("utf-8"))[1], "bulk")

    def test_api_json_dates_match_the_utc_order_stamp(self):
        doc = json.loads(raw("bulk_deals.json"))
        rows = ins.deals_from_doc(doc, "bulk")
        for r, src in zip(rows, doc["data"]):
            # BD_DT_ORDER is midnight India time written in UTC (18:30 the day before)
            self.assertEqual(ins.parse_day(src["BD_DT_ORDER"]).isoformat(), r["date"])
        self.assertEqual(rows[2]["date"], "2026-11-09")
        self.assertEqual(ins.parse_day("01-DEC-2025"), datetime.date(2025, 12, 1))
        self.assertEqual(ins.parse_stamp("2025-11-30T18:30:00.000+00:00"),
                         datetime.datetime(2025, 12, 1, 0, 0))

    def test_same_client_both_sides(self):
        rows = ins.tag_both_sides(ins.parse_deals_bytes(raw("bulk.csv"), "bulk"))
        self.assertTrue(rows[0]["both_sides"] and rows[1]["both_sides"])
        self.assertEqual(rows[0]["net_qty"], 5000)
        self.assertNotIn("both_sides", rows[2])
        out = "\n".join(ins.render_deal(rows[0], {}))
        self.assertIn("net +5,000 shares", out)
        self.assertIn("1,08,709 @ ₹826.15 = ₹8,98,09,940.35 (₹8.98 crore)", out)

    def test_one_day_reads_the_csv_more_days_the_api(self):
        code, out, _ = run(["deals", "--offline", DIR, "--kind", "bulk"] + self.lists)
        self.assertEqual(code, 0)
        self.assertIn("bulk.csv", out)
        self.assertIn("SYNQ", out)
        code, out, _ = run(["deals", "--offline", DIR, "--kind", "bulk", "--days", "3",
                            "--json"] + self.lists)
        doc = json.loads(out)
        self.assertTrue(doc["sources"][0].endswith("bulk_deals.json"))
        self.assertEqual({d["date"] for d in doc["deals"]}, {"2026-11-11", "2026-11-09"})  # not 11-03

    def test_both_kinds_filters_and_flags(self):
        code, out, _ = run(["deals", "--offline", DIR] + self.lists)
        self.assertIn("NSE bulk and block deals", out)
        self.assertIn("BLOCK SYNTH      BUY  4,00,000 @ ₹825.00 = ₹33,00,00,000.00", out)
        self.assertIn("<- you hold SYNTH", out)
        self.assertIn("<- SYN-X is on your watchlist", out)
        self.assertIn("not always the final owner", out)
        code, out, _ = run(["deals", "--offline", DIR, "--client", "promoter trust",
                            "--json"] + self.lists)
        self.assertEqual(sorted((d["kind"], d["symbol"]) for d in json.loads(out)["deals"]),
                         [("block", "SYNTH"), ("bulk", "SYN-X")])
        code, out, _ = run(["deals", "--offline", DIR, "--symbol", "NOPE"] + self.lists)
        self.assertEqual(code, 1)

    def test_file_kind_from_name_header_or_flag(self):
        code, out, _ = run(["deals", "--file", fx("block.csv"), "--json"] + self.lists)
        self.assertEqual({d["kind"] for d in json.loads(out)["deals"]}, {"block"})
        tmp = os.path.join(self.tmp, "saved.json")
        shutil.copy(fx("block_deals.json"), tmp)
        code, _, err = run(["deals", "--file", tmp] + self.lists)
        self.assertEqual(code, 2)
        self.assertIn("--kind bulk or --kind block", err)
        code, out, _ = run(["deals", "--file", tmp, "--kind", "block", "--json"] + self.lists)
        self.assertEqual(len(json.loads(out)["deals"]), 3)    # --file: no date window
        code, _, err = run(["deals", "--file", fx("pit.json")] + self.lists)
        self.assertIn("is this a PIT file", err)

    def test_limits(self):
        code, _, err = run(["deals", "--offline", DIR, "--days", "366"] + self.lists)
        self.assertEqual(code, 2)
        self.assertIn("1 to 365", err)
        with self.assertRaises(ins.InsiderError) as cm:
            ins.deals_from_csv("Date,Symbol\n11-NOV-2026,SYNTH\n")
        self.assertIn("no client", str(cm.exception))


# ---------------------------------------------------------------- watch

class Watch(Lists, unittest.TestCase):
    def base(self, offline=DIR, state=None):
        self.state = state or os.path.join(self.tmp, "state", "insider.json")
        return ["watch", "--offline", offline, "--state", self.state] + self.lists

    def test_alerts_once(self):
        code, out, _ = run(self.base())
        self.assertEqual(code, 0)
        self.assertIn("Flagging: SYN-X (watchlist), SYNTH (held)", out)
        self.assertIn("NEW SEBI PIT insider filing: 2026-11-11 18:42 IST  SYNTH", out)
        self.assertIn("NEW bulk deal: 2026-11-09  BULK  SYN-X", out)
        self.assertIn("NEW block deal: 2026-11-11  BLOCK SYNTH", out)
        self.assertNotIn("9000090", out)                 # outside the 7-day window
        with open(self.state) as fh:
            saved = json.load(fh)
        self.assertEqual(saved["last_check"], "2026-11-11T14:30:00Z")   # 20:00 IST in UTC
        self.assertEqual(saved["seen"]["pit:9000101"], "2026-11-11")
        self.assertEqual(len(saved["seen"]), 8)          # 3 PIT + 3 bulk + 2 block
        code, out, _ = run(self.base())
        self.assertEqual(code, 1)
        self.assertIn("Nothing new since 2026-11-11 20:00 India time.", out)

    def test_held_first_then_watchlist_then_the_rest(self):
        code, out, _ = run(self.base() + ["--json"])
        pit = [f["app_id"] for f in json.loads(out)["new"]["pit"]]
        self.assertEqual(pit, ["9000101", "9000102", "9000103"])

    def test_only_the_new_filing_next_time(self):
        run(self.base())
        later = os.path.join(self.tmp, "later")
        shutil.copytree(DIR, later)
        with open(os.path.join(later, "pit.json")) as fh:
            doc = json.load(fh)
        doc["data"].insert(0, dict(doc["data"][0], appId="9000104", broadcastDateTime="11-Nov-2026 21:10:00",
                                   xmlFileName="https://example.invalid/synthetic-pit/pit-9000104.xml"))
        with open(os.path.join(later, "pit.json"), "w") as fh:
            json.dump(doc, fh)
        code, out, _ = run(self.base(later) + ["--now", "2026-11-11 21:30", "--json"])
        self.assertEqual(code, 0)
        doc = json.loads(out)
        self.assertEqual([f["app_id"] for f in doc["new"]["pit"]], ["9000104"])
        self.assertEqual(doc["new"]["bulk"], [])

    def test_mine_and_limit(self):
        code, out, _ = run(self.base() + ["--mine", "--json"])
        doc = json.loads(out)
        self.assertEqual([f["symbol"] for f in doc["new"]["pit"]], ["SYNTH", "SYN-X"])
        self.assertEqual(doc["not_shown"]["pit"], 1)
        with open(self.state) as fh:
            self.assertIn("pit:9000103", json.load(fh)["seen"])   # checked, so not shown again
        os.remove(self.state)
        code, out, _ = run(self.base() + ["--limit", "0", "--kinds", "pit"])
        self.assertIn("SYN&Y", out)
        self.assertNotIn("bulk deal", out)

    def test_read_and_dry_run(self):
        code, out, _ = run(self.base() + ["--read", "--dry-run"])
        self.assertEqual(code, 0)
        self.assertIn("promoter pledge created: SYNTH HOLDINGS PRIVATE LIMITED (FAKE)", out)
        self.assertFalse(os.path.exists(self.state))

    def test_one_source_missing_is_reported_not_fatal(self):
        part = os.path.join(self.tmp, "part")
        shutil.copytree(DIR, part)
        os.remove(os.path.join(part, "block_deals.json"))
        code, out, err = run(self.base(part))
        self.assertEqual(code, 0)
        self.assertIn("could not check block", err)
        with open(self.state) as fh:
            seen = json.load(fh)["seen"]
        self.assertFalse(any(k.startswith("block:") for k in seen))

    def test_saved_files_kind_detected(self):
        bulk = os.path.join(self.tmp, "deals-today.csv")
        shutil.copy(fx("bulk.csv"), bulk)
        code, out, _ = run(["watch", "--file", fx("pit.json"), "--file", bulk,
                            "--file", "block=" + fx("block_deals.json"),
                            "--state", os.path.join(self.tmp, "s.json"), "--json"] + self.lists)
        doc = json.loads(out)
        self.assertEqual(len(doc["new"]["pit"]), 4)      # a saved file has no date window
        self.assertEqual(len(doc["new"]["bulk"]), 4)
        self.assertEqual(len(doc["new"]["block"]), 3)

    def test_old_state_entries_are_pruned(self):
        os.makedirs(os.path.dirname(os.path.join(self.tmp, "state", "x")))
        state = os.path.join(self.tmp, "state", "insider.json")
        with open(state, "w") as fh:
            json.dump({"seen": {"pit:1": "2026-06-01", "pit:2": "2026-11-01"},
                       "last_check": "2026-11-10T10:00:00Z"}, fh)
        run(self.base(state=state))
        with open(state) as fh:
            seen = json.load(fh)["seen"]
        self.assertNotIn("pit:1", seen)
        self.assertIn("pit:2", seen)

    def test_lists_in_other_shapes(self):
        with open(self.wl, "w") as fh:
            json.dump(["syn-x", "NSE:SYNQ", "not a symbol!"], fh)
        with open(self.pf, "w") as fh:
            json.dump({"positions": [{"ticker": "SYNTH.NS"}]}, fh)
        self.assertEqual(ins.my_symbols(self.wl, self.pf),
                         {"SYN-X": "watchlist", "SYNQ": "watchlist", "SYNTH": "held"})
        with open(self.pf, "w") as fh:
            fh.write("{broken")
        warnings = []
        self.assertEqual(ins.my_symbols(self.wl, self.pf, warnings)["SYNQ"], "watchlist")
        self.assertIn("could not read", warnings[0])


# ---------------------------------------------------------------- NSE access (no network)

class FakeResp(object):
    def __init__(self, body, headers=None):
        self.body, self.headers = body, headers or {}

    def read(self):
        return self.body

    def close(self):
        pass


class FakeOpener(object):
    """Answers by URL prefix; an Exception instance is raised instead."""

    def __init__(self, answers):
        self.answers, self.seen = answers, []

    def open(self, req, timeout=None):
        self.seen.append((req.full_url, dict(req.header_items()), timeout))
        for prefix, ans in self.answers:
            if req.full_url.startswith(prefix):
                if isinstance(ans, Exception):
                    raise ans
                return ans
        raise urllib.error.URLError("no fake answer for %s" % req.full_url)


class Clock(object):
    def __init__(self):
        self.t, self.slept = 100.0, []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.slept.append(round(s, 3))
        self.t += s


def client(answers):
    clock = Clock()
    c = ins.NseClient(opener=FakeOpener(answers), sleep=clock.sleep, clock=clock)
    return c, clock


PIT_JSON = raw("pit.json")


class NseAccess(Lists, unittest.TestCase):
    def test_warm_up_referer_browser_agent_and_a_pause(self):
        c, clock = client([(ins.NSE_HOME + "api/", FakeResp(PIT_JSON)),
                           (ins.NSE_HOME, FakeResp(b"<html>home</html>"))])
        url = ins.PIT_URL % ("05-11-2026", "11-11-2026")
        doc = c.get_json(url, ins.PIT_PAGE)
        self.assertEqual(len(doc["data"]), 4)
        (u1, h1, _), (u2, h2, t2) = c.opener.seen
        self.assertEqual(u1, "https://www.nseindia.com/")
        self.assertEqual(u2, "https://www.nseindia.com/api/corporates-pit-gg?index=equities"
                             "&from_date=05-11-2026&to_date=11-11-2026")
        self.assertEqual(h2["Referer"],
                         "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading")
        self.assertTrue(h2["User-agent"].startswith("Mozilla/5.0"))
        self.assertEqual(clock.slept, [1.0])
        self.assertEqual(t2, 20)
        c.get_json(url, ins.PIT_PAGE)                     # warmed once only
        self.assertEqual(len(c.opener.seen), 3)

    def test_gzip_is_unpacked(self):
        c, _ = client([(ins.NSE_HOME + "api/", FakeResp(gzip.compress(PIT_JSON),
                                                        {"Content-Encoding": "gzip"})),
                       (ins.NSE_HOME, FakeResp(b"ok"))])
        self.assertIn("data", c.get_json(ins.PIT_URL % ("a", "b"), ins.PIT_PAGE))

    def test_403_timeout_and_html_give_the_browser_route(self):
        url = ins.PIT_URL % ("05-11-2026", "11-11-2026")
        cases = [
            (urllib.error.HTTPError(url, 403, "Forbidden", {}, None), "HTTP 403"),
            (socket.timeout("timed out"), "no answer in 20 s"),
            (urllib.error.URLError(socket.timeout("timed out")), "no answer in 20 s"),
            (FakeResp(b"<html>Access Denied</html>"), "not JSON"),
        ]
        for answer, why in cases:
            c, _ = client([(ins.NSE_HOME + "api/", answer), (ins.NSE_HOME, FakeResp(b"ok"))])
            with self.assertRaises(ins.NseError) as cm:
                c.get_json(url, ins.PIT_PAGE)
            msg = str(cm.exception)
            self.assertIn(why, msg)
            self.assertIn(url, msg)
            self.assertIn("--file PATH", msg)
            self.assertIn("open https://www.nseindia.com/", msg)

    def test_a_failed_warm_up_names_the_data_address(self):
        c, _ = client([(ins.NSE_HOME, urllib.error.HTTPError(ins.NSE_HOME, 403, "x", {}, None))])
        url = ins.DEALS_URL % ("bulk", "09-11-2026", "11-11-2026")
        with self.assertRaises(ins.NseError) as cm:
            c.get_json(url, ins.NSE_HOME)
        self.assertIn("warm-up visit", str(cm.exception))
        self.assertIn("optionType=bulk_deals&from=09-11-2026&to=11-11-2026", str(cm.exception))

    def _with(self, answers):
        c, _ = client(answers)
        old = ins.new_client
        ins.new_client = lambda: c
        self.addCleanup(setattr, ins, "new_client", old)
        return c

    def test_cli_exit_2_with_advice_when_blocked(self):
        self._with([(ins.NSE_HOME, urllib.error.HTTPError(ins.NSE_HOME, 403, "x", {}, None))])
        code, out, err = run(["pit"] + self.lists)
        self.assertEqual(code, 2)
        self.assertIn("--file PATH", err)
        self.assertIn("from_date=05-11-2026&to_date=11-11-2026", err)

    def test_one_day_of_deals_tries_the_csv_then_the_api(self):
        c = self._with([
            ("https://nsearchives.nseindia.com/", urllib.error.HTTPError("x", 403, "x", {}, None)),
            (ins.NSE_HOME + "api/", FakeResp(raw("bulk_deals.json"))),
            (ins.NSE_HOME, FakeResp(b"ok"))])
        code, out, _ = run(["deals", "--kind", "bulk", "--json"] + self.lists)
        self.assertEqual(code, 0)
        urls = [u for u, _, _ in c.opener.seen]
        self.assertEqual(urls[0], "https://nsearchives.nseindia.com/content/equities/bulk.csv")
        self.assertEqual(urls[-1], ins.DEALS_URL % ("bulk", "11-11-2026", "11-11-2026"))
        self.assertEqual({d["date"] for d in json.loads(out)["deals"]}, {"2026-11-11"})

    def test_xml_download_is_cached(self):
        cache = os.path.join(self.tmp, "cache")
        self._with([("https://example.invalid/", FakeResp(raw(os.path.join("xml", "pit-9000101.xml")))),
                    (ins.NSE_HOME + "api/", FakeResp(PIT_JSON)),
                    (ins.NSE_HOME, FakeResp(b"ok"))])
        code, out, _ = run(["pit", "--symbol", "SYNTH", "--read", "--read-limit", "1",
                            "--xml-cache", cache] + self.lists)
        self.assertEqual(code, 0)
        self.assertIn("SYNTH PROMOTER TRUST", out)
        self.assertTrue(os.path.isfile(os.path.join(cache, "pit-9000101.xml")))

    def test_offline_never_builds_a_client(self):
        def boom():
            raise AssertionError("network used offline")
        old = ins.new_client
        ins.new_client = boom
        self.addCleanup(setattr, ins, "new_client", old)
        self.assertEqual(run(["watch", "--offline", DIR, "--read", "--dry-run",
                              "--state", os.path.join(self.tmp, "s.json")] + self.lists)[0], 0)


# ---------------------------------------------------------------- the skill folder

class SkillFolder(unittest.TestCase):
    def read(self, *parts):
        with open(os.path.join(*parts), encoding="utf-8") as fh:
            return fh.read()

    def test_embeds_the_shared_core_verbatim(self):
        ref = self.read(HERE, "india_core.py")
        src = self.read(SKILL, "insider.py")
        begin, end = "# --- india core: begin", "# --- india core: end"
        block = lambda t: t[t.index(begin):t.index(end) + len(end)]
        self.assertEqual(block(src), block(ref))

    def test_skill_md(self):
        text = self.read(SKILL, "SKILL.md")
        fm = re.match(r"^---\n(.*?)\n---\n", text, re.S).group(1)
        self.assertIn("name: india-insider\n", fm + "\n")
        self.assertGreater(len(fm), 200)
        low = " ".join(text.lower().split())
        for phrase in ("not financial advice", "yes", "71%", "terms of use", "not inside information",
                       "0.5%", "check the current rule", "08:45-09:00", "14:05-14:20", "25 crore",
                       "pledge", "--file", "trader-india/state/insider.json", "synthetic",
                       "unconfirmed"):
            self.assertIn(phrase, low, phrase)
        for gone in ("pelosi", "congress", "stock act", "senate", "house clerk", "trader/",
                     "trader-pelosi", "new york"):
            self.assertNotIn(gone, low, gone)

    def test_no_em_dashes_and_python_3_8(self):
        files = [os.path.join(SKILL, f) for f in os.listdir(SKILL) if f.endswith((".py", ".md"))]
        files.append(os.path.join(HERE, "test_insider.py"))
        for base, _, names in os.walk(DIR):
            files += [os.path.join(base, n) for n in names]
        for path in files:
            self.assertNotIn("—", self.read(path), path)
        src = self.read(SKILL, "insider.py")
        for bad in ("import zoneinfo", "removeprefix(", "removesuffix("):
            self.assertNotIn(bad, src)
        self.assertNotRegex(src, r"(?<![\w.])(list|dict|tuple)\[")
        self.assertNotRegex(src, r"(?m)^\s+match \w+.*:$")
        self.assertNotIn("trader/", src.replace("trader-india/", ""))

    def test_fixtures_are_synthetic(self):
        for name in ("pit.json", "bulk_deals.json", "block_deals.json"):
            self.assertIn("SYNTHETIC", json.loads(raw(name))["_fixture"])
        for name in ("pit-9000101.xml", "pit-9000102.xml"):
            self.assertIn(b"SYNTHETIC", raw(os.path.join("xml", name)))
        for name in ("bulk.csv", "block.csv"):
            for row in raw(name).decode("utf-8").splitlines()[1:]:
                self.assertIn(",SYN", row)


if __name__ == "__main__":
    unittest.main()
