"""india-analyst: quarterly results from NSE's results comparison and filings list.

The fixtures are synthetic (SYNTH, SYN-AUTO): written by hand in the field
format of NSE's results-comparision and corporates-financial-results responses.
Every expected number below is worked out from those files. None of it is NSE data.
"""
import datetime
import io
import json
import os
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout

from _load import FIX, ROOT, load

res = load("india-analyst", "results")
DIR = os.path.join(FIX, "india-analyst")


def doc(name):
    with open(os.path.join(DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


def run(args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = res.main(args)
    return code, out.getvalue(), err.getvalue()


def row(frm, to, sale, total, np_, eps="1.00", seq="1", created="01-JAN-2026", face="10", **extra):
    r = {"re_from_dt": frm, "re_to_dt": to, "re_net_sale": sale, "re_total_inc": total,
         "re_net_profit": np_, "re_con_pro_loss": np_, "re_dilut_eps_for_cont_dic_opr": eps,
         "re_seq_num": seq, "re_create_dt": created, "re_face_val": face, "re_res_type": "U"}
    r.update(extra)
    return r


class Synth(unittest.TestCase):
    def setUp(self):
        self.all = res.analyse_all(doc("results-comparision-SYNTH.json"), doc("financial-results-SYNTH.json"))
        self.r = self.all[0]

    def test_latest_quarter(self):
        self.assertEqual(len(self.all), 1)
        q = self.r["rows"][0]
        self.assertEqual(q["end"], "2026-09-30")
        self.assertEqual(q["quarter"], "Q2 FY27")
        self.assertEqual(q["net_sales"], 60870)
        self.assertEqual(q["total_income"], 61820)
        self.assertEqual(q["net_profit"], 5020)
        self.assertEqual(q["eps_diluted"], 10.04)
        self.assertEqual(q["net_sales_yoy"], 16.2)       # vs 52,400 a year earlier
        self.assertEqual(q["total_income_yoy"], 16.3)    # vs 53,150
        self.assertEqual(q["net_profit_yoy"], 19.8)      # vs 4,190
        self.assertEqual(q["eps_yoy"], 19.8)             # vs 8.38
        self.assertEqual(q["net_sales_qoq"], 8.1)        # vs 56,300
        self.assertEqual(q["net_profit_qoq"], 12.1)      # vs 4,480
        self.assertEqual(q["net_margin"], 8.2)           # 5,020 / 60,870
        self.assertEqual(q["audit"], "unaudited")
        self.assertEqual((q["year_ago"], q["quarter_before"]), ("2025-09-30", "2026-06-30"))

    def test_quarters_on_the_april_march_year(self):
        self.assertEqual([r["quarter"] for r in self.r["rows"]],
                         ["Q2 FY27", "Q1 FY27", "Q4 FY26", "Q3 FY26", "Q2 FY26"])
        self.assertEqual(res.quarter_label(datetime.date(2025, 12, 31)), "Q3 FY26")
        self.assertEqual(res.quarter_label(datetime.date(2026, 3, 31)), "Q4 FY26")
        self.assertEqual(res.quarter_label(datetime.date(2026, 6, 30)), "Q1 FY27")
        self.assertEqual(res.quarter_label(datetime.date(2024, 9, 30)), "Q2 FY25")
        self.assertEqual(self.r["rows"][2]["audit"], "audited")    # Q4 is the audited one here

    def test_trailing_twelve_months(self):
        t = self.r["ttm"]
        self.assertEqual((t["from"], t["to"]), ("Q3 FY26", "Q2 FY27"))
        self.assertEqual(t["net_sales"], 233340)       # 55,120 + 61,050 + 56,300 + 60,870
        self.assertEqual(t["total_income"], 236940)
        self.assertEqual(t["net_profit"], 19370)
        self.assertEqual(t["eps_diluted"], 38.74)      # 9.12 + 10.62 + 8.96 + 10.04

    def test_basis_and_release_times_from_the_filings_list(self):
        self.assertEqual(self.r["basis"], "standalone")   # NSE marks those filings Non-Consolidated
        self.assertIn("5 of 5 quarters", self.r["basis_source"])
        f = self.r["filings"]
        self.assertEqual([(x["basis"], x["broadcast"], x["timing"]) for x in f["latest"]],
                         [("standalone", "2026-10-21 16:42", "after the close"),
                          ("consolidated", "2026-10-21 16:40", "after the close")])
        self.assertIn(("Q1 FY27", "during market hours"), [(x["quarter"], x["timing"]) for x in f["history"]])
        self.assertIsNone(f["stale"])
        self.assertEqual(f["company"], "SYNTH Industries Limited (synthetic test data)")
        # one filing was broadcast in 2025, a year the built-in NSE holiday list does not cover
        self.assertTrue(any(n.startswith("NSE holidays for 2025 are not built in") for n in self.r["notes"]))

    def test_what_changed_in_words(self):
        lines = self.r["changes"]
        self.assertEqual(lines[0], "Quarter ending 2026-09-30 (Q2 FY27): net sales 60,870 (+16.2% vs a year "
                                   "earlier), net profit 5,020 (+19.8%), diluted EPS ₹10.04 (+19.8%).")
        self.assertIn("net sales of ₹608.70 crore and net profit of ₹50.20 crore", lines[1])
        self.assertIn("Net margin 8.2% (+0.2 points vs the quarter before).", lines)
        self.assertFalse(any("Other income" in l for l in lines))     # 950 is 14% of 6,700


class SynAuto(unittest.TestCase):
    def setUp(self):
        self.r = res.analyse_all(doc("results-comparision-SYN-AUTO.json"),
                                 doc("financial-results-SYN-AUTO.json"))[0]

    def test_swing_split_and_one_offs(self):
        q = self.r["rows"][0]
        self.assertEqual((q["end"], q["quarter"], q["basis"]), ("2026-06-30", "Q1 FY27", "consolidated"))
        self.assertEqual(q["net_sales_yoy"], 18.4)        # 21,615.20 vs 18,250.40
        self.assertEqual(q["net_sales_qoq"], -5.8)        # vs 22,940.35
        self.assertIsNone(q["net_profit_yoy"])            # a loss of 320.50 a year earlier
        self.assertIsNone(q["eps_yoy"])                   # face value 10 -> 2 in between
        self.assertTrue(q["face_value_changed"])
        self.assertEqual(q["net_margin"], 6.8)
        lines = self.r["changes"]
        self.assertIn("Net profit swung from a loss of 320.50 a year earlier to a profit of 1,480.60: "
                      "a percent change is not meaningful.", lines)
        self.assertTrue(any(l.startswith("Exceptional items of 600.00") for l in lines))
        self.assertTrue(any("(re_con_pro_loss) of 1,402.35 against net profit 1,480.60" in l for l in lines))
        self.assertTrue(any("face value changed" in l for l in lines))
        self.assertIn("Net margin 6.8% (+2.4 points vs the quarter before).", lines)

    def test_non_quarters_left_out_and_no_ttm_eps_across_a_split(self):
        self.assertEqual(len(self.r["rows"]), 5)          # the 12-month row is not a quarter
        self.assertTrue(any("1 row that is not a quarter" in n for n in self.r["notes"]))
        t = self.r["ttm"]
        self.assertEqual(t["net_sales"], 84141.3)
        self.assertEqual(t["total_income"], 85061.75)
        self.assertEqual(t["net_profit"], 3366.75)
        self.assertNotIn("eps_diluted", t)
        self.assertTrue(any(n.startswith("No trailing EPS") for n in self.r["notes"]))

    def test_says_when_nse_comparison_lags_a_filing(self):
        self.assertIn("2 of 5 quarters", self.r["basis_source"])
        self.assertEqual(self.r["filings"]["stale"],
                         "NSE's results comparison stops at 2026-06-30, but a consolidated results filing "
                         "for the period ending 2026-09-30 was broadcast 2026-10-19 13:05 IST (during market "
                         "hours). Read it directly: https://nsearchives.nseindia.com/corporate/xbrl/"
                         "SYNTHETIC_TEST_8200006.xml")


class Rules(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(res.num("1,234.5"), 1234.5)
        self.assertEqual(res.num("-408500"), -408500)
        self.assertIsNone(res.num("-"))
        self.assertIsNone(res.num(None))
        self.assertEqual(res.growth(110, 100), 10.0)
        self.assertEqual(res.growth(-50, -100), 50.0)      # a smaller loss
        self.assertIsNone(res.growth(10, -5))
        self.assertIsNone(res.growth(5, 0))
        self.assertEqual(res.ndate("01-OCT-2024"), datetime.date(2024, 10, 1))
        self.assertEqual(res.amt(12826000, 0), "1,28,26,000")

    def test_release_timing_on_the_nse_clock(self):
        t = res.release_timing
        self.assertEqual(t(datetime.datetime(2026, 10, 21, 16, 42)), "after the close")
        self.assertEqual(t(datetime.datetime(2026, 7, 22, 13, 10)), "during market hours")
        self.assertEqual(t(datetime.datetime(2026, 10, 19, 9, 5)), "during the pre-open")
        self.assertEqual(t(datetime.datetime(2026, 10, 19, 8, 0)), "before the open")
        self.assertEqual(t(datetime.datetime(2026, 10, 20, 11, 0)), "on a non-trading day (NSE holiday: Dussehra)")

    def test_restated_rows_the_latest_wins(self):
        d = {"resCmpData": [row("01-JUL-2026", "30-SEP-2026", "100", "110", "10", created="21-OCT-2026", seq="1"),
                            row("01-JUL-2026", "30-SEP-2026", "120", "130", "12", created="05-NOV-2026", seq="2")]}
        r = res.analyse_all(d)[0]
        self.assertEqual(len(r["rows"]), 1)
        self.assertEqual(r["rows"][0]["net_sales"], 120)
        self.assertIn("NSE lists 2 rows for the quarter ending 2026-09-30; the one created 2026-11-05 is used.",
                      r["notes"])
        self.assertIsNone(r["basis"])

    def test_standalone_and_consolidated_apart(self):
        d = {"resCmpData": [row("01-JUL-2026", "30-SEP-2026", "100", "110", "10", seq="11"),
                            row("01-JUL-2026", "30-SEP-2026", "150", "160", "14", seq="12")]}
        filings = [{"seqNumber": "11", "consolidated": "Consolidated", "fromDate": "01-Jul-2026",
                    "toDate": "30-Sep-2026", "broadCastDate": "21-Oct-2026 11:00:00"},
                   {"seqNumber": "12", "consolidated": "Non-Consolidated", "fromDate": "01-Jul-2026",
                    "toDate": "30-Sep-2026", "broadCastDate": "21-Oct-2026 11:01:00"}]
        both = res.analyse_all(d, filings)
        self.assertEqual([(r["basis"], r["rows"][0]["net_sales"]) for r in both],
                         [("consolidated", 100), ("standalone", 150)])
        only = res.analyse_all(d, filings, basis="standalone")
        self.assertEqual([r["basis"] for r in only], ["standalone"])
        with self.assertRaises(res.ResultsError):
            res.analyse_all(d, None, basis="consolidated")

    def test_other_income_losses_and_banks(self):
        d = {"resCmpData": [row("01-JUL-2026", "30-SEP-2026", "1000", "1400", "300", re_oth_inc_new="400",
                                re_pro_loss_bef_tax="1000")]}
        lines = res.analyse_all(d)[0]["changes"]
        self.assertIn("Other income of 400 is 40% of profit before tax: part of the profit does not come from "
                      "the business.", lines)
        d = {"resCmpData": [row("01-JUL-2026", "30-SEP-2026", "1000", "1000", "-50")]}
        self.assertIn("The quarter is a net loss.", res.analyse_all(d)[0]["changes"])
        d = {"resCmpData": [row("01-JUL-2026", "30-SEP-2026", None, "1000", "100")], "bankNonBnking": "B"}
        r = res.analyse_all(d)[0]
        self.assertEqual((r["rows"][0]["net_margin"], r["rows"][0]["margin_base"]), (10.0, "total income"))
        self.assertTrue(any("(on total income: no net sales figure)" in l for l in r["changes"]))
        with self.assertRaises(res.ResultsError):
            res.analyse_all({"data": []})


class Cli(unittest.TestCase):
    def test_metrics_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "trader-india", "metrics.json")
            code, out, err = run(["SYNTH", "SYN-AUTO", "--offline", DIR, "--metrics", path])
            self.assertEqual(code, 0, err)
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        rows = {r["symbol"]: r for r in data["companies"]}
        self.assertEqual(sorted(rows), ["SYN-AUTO", "SYNTH"])
        self.assertEqual(rows["SYNTH"]["eps_ttm"], 38.74)
        self.assertEqual(rows["SYNTH"]["net_sales_growth_yoy"], 16.2)
        self.assertEqual(rows["SYNTH"]["basis"], "standalone")
        self.assertEqual(rows["SYNTH"]["units"], "as NSE shows them (usually ₹ lakh; check the filing)")
        self.assertEqual(rows["SYN-AUTO"]["period_end"], "2026-06-30")
        self.assertIsNone(rows["SYN-AUTO"]["eps_ttm"])
        self.assertIn("wrote", out)
        self.assertIn("SYNTH Industries Limited (synthetic test data) (SYNTH), NSE results comparison, "
                      "standalone.", out)
        self.assertIn("Q2 FY27  2026-09-30        60,870  +16.2%   +8.1%", out)
        self.assertIn("NOTE: NSE's results comparison stops at 2026-06-30", out)
        self.assertNotIn(chr(0x2014), out)
        self.assertNotIn("SEC", out)

    def test_json_output(self):
        code, out, err = run(["SYNTH", "--offline", DIR, "--json", "--quarters", "4"])
        self.assertEqual(code, 0, err)
        data = json.loads(out)
        self.assertEqual(len(data[0]["results"][0]["rows"]), 4)
        self.assertEqual(data[0]["results"][0]["fields"]["net_sales"], ["re_net_sale"])
        self.assertEqual(data[0]["results"][0]["fields"]["eps_diluted"], ["re_dilut_eps_for_cont_dic_opr"])

    def test_saved_files(self):
        comp = os.path.join(DIR, "results-comparision-SYNTH.json")
        code, out, err = run(["SYNTH", "--file", comp])
        self.assertEqual(code, 0, err)
        self.assertIn("NSE results comparison, basis not stated.", out)
        self.assertIn("none matched a filing", out)
        code, out, err = run(["SYNTH", "--file", comp, "--filings-file",
                              os.path.join(DIR, "financial-results-SYNTH.json")])
        self.assertEqual(code, 0, err)
        self.assertIn(", standalone.", out)
        code, _, err = run(["SYNTH", "SYN-AUTO", "--file", comp])
        self.assertEqual(code, 2)
        self.assertIn("exactly one symbol", err)
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, "page.json")
            with open(page, "w") as fh:
                fh.write("<html>Access Denied</html>")
            code, _, err = run(["SYNTH", "--file", page])
        self.assertEqual(code, 2)
        self.assertIn("is not JSON", err)

    def test_unknown_symbol_and_bad_symbol(self):
        code, _, err = run(["SYN-NONE", "--offline", DIR])
        self.assertEqual(code, 2)
        self.assertIn("offline: no file", err)
        code, out, err = run(["SYNTH", "SYN-NONE", "--offline", DIR])
        self.assertEqual(code, 1)          # one worked, one did not
        code, _, err = run(["not ok!"])
        self.assertEqual(code, 2)
        self.assertIn("is not an NSE symbol", err)


class NseClient(unittest.TestCase):
    """The live path with the network replaced: warm-up, URLs, pauses, refusals."""

    def patch(self, answers):
        calls = []
        old = res.Fetcher._open

        def fake(self_, url, headers):
            calls.append((url, headers))
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a
        res.Fetcher._open = fake
        self.addCleanup(setattr, res.Fetcher, "_open", old)
        return calls

    def test_urls_and_headers(self):
        calls = self.patch([b"", b'{"resCmpData": [], "bankNonBnking": "N"}'])
        f = res.Fetcher()
        self.assertGreaterEqual(f.nse_pause, 1.0)
        f.json(res.RESULTS_URL % "M%26M", "x")
        self.assertEqual(calls[0][0], "https://www.nseindia.com/")
        self.assertEqual(calls[1][0], "https://www.nseindia.com/api/results-comparision?symbol=M%26M")
        self.assertEqual(calls[1][1]["Referer"],
                         "https://www.nseindia.com/companies-listing/corporate-filings-financial-results")
        self.assertEqual(res.FILINGS_URL % "SYNTH", "https://www.nseindia.com/api/corporates-financial-results"
                                                    "?index=equities&period=Quarterly&symbol=SYNTH")

    def test_refused_says_how_to_save_the_json(self):
        err = urllib.error.HTTPError("https://www.nseindia.com/", 403, "Forbidden", {}, None)
        calls = self.patch([err])
        code, out, errtext = run(["SYNTH", "SYN-AUTO"])
        self.assertEqual(code, 2)
        self.assertEqual(len(calls), 1)
        self.assertIn("NSE answered HTTP 403", errtext)
        self.assertIn("results-comparision?symbol=SYNTH", errtext)
        self.assertIn("--file PATH", errtext)
        self.assertIn("SYN-AUTO: not asked for", errtext)

    def test_filings_list_refused_still_shows_the_table(self):
        with open(os.path.join(DIR, "results-comparision-SYNTH.json"), "rb") as fh:
            body = fh.read()
        err = urllib.error.HTTPError("https://www.nseindia.com/", 403, "Forbidden", {}, None)
        self.patch([b"", body, err])
        code, out, errtext = run(["SYNTH"])
        self.assertEqual(code, 0, errtext)
        self.assertIn("Q2 FY27", out)
        self.assertIn("Note: NSE's filings list: NSE answered HTTP 403", out)


class Files(unittest.TestCase):
    def test_skill_files_are_clean(self):
        for rel in ("india-analyst/SKILL.md", "india-analyst/results.py", "india-analyst/metrics.example.json"):
            with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
                text = fh.read()
            self.assertNotIn(chr(0x2014), text, rel)
            self.assertNotIn("SEC EDGAR", text, rel)
        with open(os.path.join(ROOT, "india-analyst", "SKILL.md"), encoding="utf-8") as fh:
            skill = fh.read()
        self.assertIn("name: india-analyst", skill)
        self.assertIn("terms of use", skill)
        self.assertIn("transcript", skill)
        with open(os.path.join(ROOT, "india-analyst", "metrics.example.json"), encoding="utf-8") as fh:
            example = json.load(fh)
        self.assertIn("synthetic", example["note"])


if __name__ == "__main__":
    unittest.main()
