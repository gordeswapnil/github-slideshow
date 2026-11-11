"""india-news: NSE announcements, Yahoo headlines and the day's move, in India time.

Every fixture is synthetic (SYNTH, SYN-AUTO, SYN-PHARMA): NSE announcement
records and a Yahoo RSS feed written by hand in the field format of the real
responses, and a Yahoo chart re-timed from the US pack by fixtures/retime.py.
None of it is NSE or Yahoo data.
"""
import datetime
import io
import json
import os
import socket
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout

from _load import FIX, ROOT, load

news = load("india-news", "news")
DIR = os.path.join(FIX, "india-news")
MORNING = "2026-10-19 09:40"      # India time (a naive --now is IST)
AFTERNOON = "2026-10-19 14:00"


def raw(name):
    with open(os.path.join(DIR, name), "rb") as fh:
        return fh.read()


def records(name):
    with open(os.path.join(DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


def run(args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = news.main(args)
    return code, out.getvalue(), err.getvalue()


def utc(*a):
    return datetime.datetime(*a)


def fixture_items(watch=None):
    watch = watch or {"SYNTH": None, "SYN-AUTO": None}
    items = (news.parse_announcements(records("nse-announcements-SYNTH.json"), "SYNTH")
             + news.parse_announcements(records("nse-announcements-SYN-AUTO.json"), "SYN-AUTO")
             + news.parse_rss(raw("yahoo-SYNTH.xml"), "SYNTH"))
    return news.dedupe(news.tag(items, watch))


class Feeds(unittest.TestCase):
    def test_nse_announcements(self):
        items = news.parse_announcements(records("nse-announcements-SYNTH.json"), "SYNTH")
        self.assertEqual(len(items), 8)
        first = items[0]
        self.assertEqual(first["id"], "nse:900001107")
        self.assertEqual(first["source"], "NSE")
        self.assertEqual(first["title"], "Analysts/Institutional Investor Meet/Con. Call Updates")
        # sort_date 2026-10-19 10:05:31 is India time: 04:35:31 UTC
        self.assertEqual(first["time"], utc(2026, 10, 19, 4, 35, 31))
        self.assertTrue(first["link"].startswith("https://nsearchives.nseindia.com/corporate/SYNTH_"))
        self.assertEqual(first["company"], "SYNTH Industries Limited")
        self.assertIn("synthetic test record", first["summary"])

    def test_nse_time_fallbacks_and_missing_pdf(self):
        auto = news.parse_announcements(records("nse-announcements-SYN-AUTO.json"), "SYN-AUTO")
        by = {i["seq_id"]: i for i in auto}
        self.assertEqual(by["900002202"]["time"], utc(2026, 10, 19, 2, 25))   # no sort_date: an_dt
        self.assertEqual(by["900002199"]["link"], news.NSE_FILINGS_PAGE)      # no attchmntFile
        self.assertEqual(news.nse_time({"dt": "18102026221142"}), utc(2026, 10, 18, 16, 41, 42))
        self.assertIsNone(news.nse_time({"dt": "soon"}))
        # a record for another company is not ours; junk symbols are skipped
        mixed = records("browser-saved-announcements.json") + [{"symbol": "not a symbol!"}]
        self.assertEqual([i["ticker"] for i in news.parse_announcements(mixed, "SYNTH")], ["SYNTH", "SYNTH"])
        self.assertEqual(len(news.parse_announcements(mixed)), 3)

    def test_yahoo_rss(self):
        items = news.parse_rss(raw("yahoo-SYNTH.xml"), "SYNTH")
        self.assertEqual(len(items), 6)
        first = items[0]
        self.assertEqual(first["title"], "SYNTH Industries Q2 preview: what to expect")
        self.assertEqual(first["time"], utc(2026, 10, 19, 5, 30))
        self.assertEqual(first["id"], "rss:https://finance.yahoo.com/news/synthetic-test-0006.html")
        self.assertEqual(news.parse_rss(raw("yahoo-SYN-AUTO.xml"), "SYN-AUTO"), [])   # empty feed
        with self.assertRaises(news.NewsError):
            news.parse_rss(b"<rss><channel>", "SYNTH")

    def test_urls_use_nse_symbols_and_india_feeds(self):
        self.assertEqual(news.yahoo_rss_url("M&M"),
                         "https://feeds.finance.yahoo.com/rss/2.0/headline?s=M%26M.NS&region=IN&lang=en-IN")
        self.assertIn("/chart/BAJAJ-AUTO.NS?range=1d", news.chart_url("bajaj-auto"))
        self.assertEqual(news.nse_url("M&M", datetime.date(2026, 10, 5), datetime.date(2026, 10, 19)),
                         "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=M%26M"
                         "&from_date=05-10-2026&to_date=19-10-2026")

    def test_times(self):
        self.assertEqual(news.parse_time("Mon, 19 Oct 2026 04:02:00 +0000"), utc(2026, 10, 19, 4, 2))
        self.assertEqual(news.parse_time("2026-10-19T09:32:00+05:30"), utc(2026, 10, 19, 4, 2))
        self.assertIsNone(news.parse_time("soon"))
        self.assertEqual(news.to_ist(utc(2026, 10, 19, 4, 2)).strftime("%H:%M"), "09:32")


class Categories(unittest.TestCase):
    def t(self, subject, text=""):
        return news.categorise(subject, text)

    def test_india_categories(self):
        self.assertEqual(self.t("Board Meeting Intimation",
                                "Board Meeting to be held on 30-Oct-2026 to consider and approve the Quarterly "
                                "Unaudited Financial results and Dividend."),
                         ["results", "board meeting", "corporate action"])
        self.assertEqual(self.t("Bonus issue", "record date for the bonus 1:1"), ["corporate action"])
        self.assertEqual(self.t("Buy back", "proposal for buyback of equity shares"), ["corporate action"])
        self.assertIn("fund raising", self.t("Fund Raising", "raising of funds through Qualified "
                                                             "Institutions Placement (QIP)"))
        self.assertIn("fund raising", self.t("Allotment", "preferential allotment of warrants"))
        self.assertIn("fund raising", self.t("Rights issue", "rights issue of equity shares"))
        self.assertEqual(self.t("Acquisition", "acquisition of a 51% stake"), ["deal"])
        self.assertEqual(self.t("Scheme of Arrangement", "scheme of arrangement and amalgamation"), ["deal"])
        self.assertEqual(self.t("Credit Rating", "ratings upgraded by the agency"), ["credit rating"])
        self.assertEqual(self.t("Resignation of Statutory Auditor", "the statutory auditor has resigned"),
                         ["auditor"])
        self.assertEqual(self.t("Change in Management", "resignation of Mr. A. Sample as Chief Financial "
                                                        "Officer and Key Managerial Personnel"),
                         ["management change"])
        self.assertEqual(self.t("Appointment", "appointment of a whole-time director"), ["management change"])
        self.assertEqual(self.t("Disclosure of Encumbrance", "Regulation 31(1) of SEBI (SAST) Regulations "
                                                             "regarding creation of pledge"),
                         ["pledge/encumbrance", "insider/SAST"])
        self.assertIn("insider/SAST", self.t("Insider trading", "disclosure under regulation 7(2) of PIT"))
        self.assertEqual(self.t("Updates", "received an order from SEBI imposing a penalty of Rs 5 lakh"),
                         ["regulatory"])
        self.assertIn("regulatory", self.t("Litigation", "an order of the NCLT"))
        self.assertIn("analyst/investor meet",
                      self.t("Analysts/Institutional Investor Meet/Con. Call Updates", "schedule of meetings"))
        self.assertIn("clarification", self.t("Clarification sought from the company",
                                              "with reference to significant movement in price"))
        self.assertEqual(self.t("SYNTH hits upper circuit"), ["circuit/surveillance"])
        self.assertEqual(self.t("RBI keeps the repo rate unchanged"), ["macro"])
        self.assertEqual(self.t("Brokerage upgrades SYNTH, raises target price"), ["analyst rating"])

    def test_routine_and_false_friends(self):
        # a trading-window notice names the coming results, a newspaper copy names the meeting: routine
        self.assertEqual(self.t("Closure of Trading Window",
                                "until 48 hours after the declaration of the financial results"), ["routine"])
        self.assertEqual(self.t("Copy of Newspaper Publication", "notice of the board meeting"), ["routine"])
        self.assertEqual(self.t("Shareholders meeting", "voting results of the AGM"), ["routine"])
        # the SAST regulations' title is not a takeover deal
        self.assertEqual(self.t("Disclosure under SEBI Takeover Regulations",
                                "Regulation 29(2) of SEBI (Substantial Acquisition of Shares and Takeovers) "
                                "Regulations, 2011"), ["insider/SAST"])
        # the generic Regulation 30 intimation, "in order to", says nothing
        self.assertEqual(self.t("Updates", "Intimation under Regulation 30 of the SEBI (LODR) Regulations, 2015"), [])
        self.assertEqual(self.t("Updates", "under SEBI (LODR) Regulations in order to comply"), [])
        # routine only when nothing else is there
        self.assertEqual(self.t("Postal Ballot", "postal ballot to approve a preferential issue"), ["fund raising"])

    def test_touches_and_marks(self):
        items = fixture_items()
        macro = next(i for i in items if i["title"].startswith("Sensex, Nifty"))
        self.assertEqual(macro["touches"], ["SYN-AUTO", "SYNTH"])
        self.assertEqual(macro["tags"], ["macro"])
        self.assertFalse(macro["important"])      # only filings carry the "!" mark
        by = {i["id"]: i for i in items}
        self.assertTrue(by["nse:900001106"]["important"])     # credit rating
        self.assertFalse(by["nse:900001105"]["important"])    # trading window: routine
        self.assertFalse(by["nse:900001100"]["important"])    # SAST disclosure
        self.assertTrue(by["nse:900002199"]["important"])     # SEBI penalty
        self.assertEqual(news.watch_from_files("/none", "/none", "/none"), {})

    def test_dedupe_merges_the_same_story(self):
        a = news.parse_rss(raw("yahoo-SYNTH.xml"), "SYNTH")
        b = news.parse_rss(raw("yahoo-SYNTH.xml"), "SYN-AUTO")
        items = news.dedupe(news.tag(a + b, {"SYNTH": None, "SYN-AUTO": None}))
        self.assertEqual(len(items), 6)
        self.assertEqual(items[0]["touches"], ["SYN-AUTO", "SYNTH"])
        # two different NSE "Updates" the same day stay two items
        recs = records("nse-announcements-SYN-AUTO.json")
        twin = dict(recs[1], seq_id="900002299", attchmntText="Another update. (synthetic test record)",
                    attchmntFile="")
        got = news.dedupe(news.tag(news.parse_announcements([recs[1], twin], "SYN-AUTO"), {"SYN-AUTO": None}))
        self.assertEqual(len(got), 2)


class ResultsDay(unittest.TestCase):
    def test_meeting_dates(self):
        md = news.meeting_date
        self.assertEqual(md("Board Meeting to be held on 30-Oct-2026 to consider"), datetime.date(2026, 10, 30))
        self.assertEqual(md("meeting scheduled on Wednesday, 21st October, 2026"), datetime.date(2026, 10, 21))
        self.assertEqual(md("to be held on 21/10/2026"), datetime.date(2026, 10, 21))
        self.assertEqual(md("will be held on October 21, 2026"), datetime.date(2026, 10, 21))
        self.assertIsNone(md("no date here"))
        self.assertIsNone(md("to be held on 31-Feb-2026"))

    def test_today_and_next_trading_day(self):
        risks = {r["symbol"]: r for r in news.results_risk(fixture_items(), {"SYNTH": None, "SYN-AUTO": None},
                                                             news.parse_now(MORNING))}
        self.assertEqual(risks["SYN-AUTO"]["level"], "today")
        self.assertIn("RESULTS TODAY  SYN-AUTO: the board meets on results today (2026-10-19)",
                      risks["SYN-AUTO"]["message"])
        self.assertIn("posted 2026-10-14 18:20 IST", risks["SYN-AUTO"]["message"])
        # 2026-10-20 is an NSE holiday (Dussehra), so Wednesday 21st is the next trading day
        self.assertEqual(risks["SYNTH"]["level"], "soon")
        self.assertIn("on 2026-10-21 (Wednesday), the next trading day", risks["SYNTH"]["message"])

    def test_results_out_during_market_hours(self):
        risks = {r["symbol"]: r for r in news.results_risk(fixture_items(), {"SYNTH": None, "SYN-AUTO": None},
                                                             news.parse_now(AFTERNOON))}
        self.assertEqual(risks["SYN-AUTO"]["level"], "out")
        self.assertIn("results posted to NSE at 2026-10-19 13:05 IST, during market hours today",
                      risks["SYN-AUTO"]["message"])

    def item(self, when_ist, subject, text):
        it = {"id": "x" + when_ist, "source": "NSE", "kind": "filing", "ticker": "SYNTH", "title": subject,
              "summary": text, "link": "", "time": news.ist_to_utc(
                  datetime.datetime.strptime(when_ist, "%Y-%m-%d %H:%M"))}
        return news.tag([it], {"SYNTH": None})[0]

    def test_results_overnight_and_later_meetings(self):
        out = self.item("2026-10-16 18:30", "Outcome of Board Meeting", "the Board approved the financial results")
        r = news.results_risk([out], {"SYNTH": None}, news.parse_now("2026-10-19 09:00"))[0]
        self.assertEqual(r["level"], "out")
        self.assertIn("outside market hours: the next open can gap", r["message"])
        # results older than the last session's close are old news
        self.assertEqual(news.results_risk([out], {"SYNTH": None}, news.parse_now("2026-10-21 09:00")), [])
        sat = self.item("2026-10-19 08:00", "Board Meeting Intimation",
                        "Board Meeting to be held on 24-Oct-2026 to consider the financial results")
        r = news.results_risk([sat], {"SYNTH": None}, news.parse_now(MORNING))[0]
        self.assertIn("a non-trading day (weekend): the next open can gap", r["message"])
        later = self.item("2026-10-19 08:00", "Board Meeting Intimation",
                          "Board Meeting to be held on 23-Oct-2026 to consider the financial results")
        r = news.results_risk([later], {"SYNTH": None}, news.parse_now(MORNING))[0]
        self.assertIn("3 trading days away", r["message"])    # 21st, 22nd, 23rd (20th is a holiday)
        vague = self.item("2026-10-19 08:00", "Board Meeting Intimation",
                          "prior intimation of a meeting to consider the financial results")
        r = news.results_risk([vague], {"SYNTH": None}, news.parse_now(MORNING))[0]
        self.assertIn("the date could not be read", r["message"])


class Check(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = os.path.join(self.tmp.name, "state", "news.json")
        none = os.path.join(self.tmp.name, "none.json")
        self.base = ["--offline", DIR, "--state", self.state,
                     "--portfolio", none, "--watchlist", none, "--plan", none]

    def tearDown(self):
        self.tmp.cleanup()

    def test_new_items_once_newest_first_in_india_time(self):
        code, out, err = run(["--tickers", "SYNTH", "SYN-AUTO", "--json", "--now", MORNING] + self.base)
        self.assertEqual(code, 0, err)
        data = json.loads(out)
        times = [i["time"] for i in data["items"]]
        self.assertEqual(times, sorted(times, reverse=True))
        # 4 SYNTH filings + 4 SYNTH headlines + 3 SYN-AUTO filings in the last 48 hours;
        # the 10:05 filing and the 11:00 headline are after the 09:40 clock
        self.assertEqual(len(data["items"]), 11)
        self.assertEqual(data["items"][0]["time_india"], "2026-10-19 09:32")
        self.assertEqual(data["checked_india"], "2026-10-19 09:40")
        self.assertEqual({r["symbol"]: r["level"] for r in data["results_risk"]},
                         {"SYNTH": "soon", "SYN-AUTO": "today"})
        self.assertTrue(any("SYN-AUTO: no Yahoo headlines" in n for n in data["notes"]))
        with open(self.state) as fh:
            seen = json.load(fh)["seen"]
        self.assertIn("nse:900001106", seen)                                       # keyed by seq_id
        self.assertIn("rss:https://finance.yahoo.com/news/synthetic-test-0001.html", seen)   # and by link
        self.assertNotIn("nse:900002203", seen)      # 13:05, after the pinned clock: still new later
        code, out, _ = run(["--tickers", "SYNTH", "SYN-AUTO", "--now", MORNING] + self.base)
        self.assertEqual(code, 1)
        self.assertIn("Nothing new.", out)
        self.assertIn("RESULTS TODAY  SYN-AUTO", out)      # the warning stays while it applies
        # later the same day: only the three items published since
        code, out, err = run(["--tickers", "SYNTH", "SYN-AUTO", "--json", "--now", AFTERNOON] + self.base)
        self.assertEqual(code, 0, err)
        data = json.loads(out)
        self.assertEqual([i["id"] for i in data["items"]],
                         ["nse:900002203", "rss:https://finance.yahoo.com/news/synthetic-test-0006.html",
                          "nse:900001107"])
        self.assertEqual({r["symbol"]: r["level"] for r in data["results_risk"]},
                         {"SYNTH": "soon", "SYN-AUTO": "out"})

    def test_text_output(self):
        code, out, err = run(["--tickers", "SYNTH", "SYN-AUTO", "--now", MORNING, "--dry-run"] + self.base)
        self.assertEqual(code, 0, err)
        lines = out.splitlines()
        self.assertEqual(lines[0], "NSE 2026-10-19 (Monday), 09:40 IST: normal market until 15:30.")
        self.assertIn("! 2026-10-19 09:05 IST  SYNTH       NSE           Credit Rating", out)
        self.assertIn("  2026-10-19 08:12 IST  SYNTH       NSE           Closure of Trading Window", out)
        self.assertIn("tags: results, board meeting, corporate action", out)
        self.assertIn("RESULTS SOON   SYNTH", out)
        self.assertIn("Checked 2026-10-19 09:40 IST", out)
        self.assertIn("Not financial advice", out)
        self.assertNotIn(" ET", out)
        self.assertNotIn(chr(0x2014), out)
        self.assertFalse(os.path.exists(self.state))      # --dry-run

    def test_the_move(self):
        m = news.parse_chart(raw("chart-SYNTH.json"), "SYNTH")
        self.assertEqual(m["prev_close"], 354.72)
        self.assertEqual(m["pct"], 3.31)
        self.assertEqual(news.to_ist(m["time"]).strftime("%H:%M"), "10:37")   # the US 10:52 bar, re-timed
        line = news.render_moves([m])[0]
        self.assertRegex(line, r"^SYNTH\s+₹366\.4[78] \+3\.31% vs previous close ₹354\.72 at 10:37 IST  MOVING$")
        quiet = dict(m, pct=1.2)
        self.assertNotIn("MOVING", news.render_moves([quiet])[0])
        self.assertIn("MOVING", news.render_moves([quiet], move_pct=1.0)[0])
        self.assertIn("near a 5% price band?", news.render_moves([dict(m, pct=4.85)])[0])
        self.assertIn("near a 10% price band?", news.render_moves([dict(m, pct=-9.95)])[0])
        self.assertIn("near a 20% price band?", news.render_moves([dict(m, pct=20.0)])[0])
        self.assertEqual(news.band_hint(6.0), "")
        with self.assertRaises(news.NewsError):
            news.parse_chart(b'{"chart": {"result": null}}', "SYN-X")
        # no chart file offline: no move line and no note
        code, out, _ = run(["--tickers", "SYN-AUTO", "--now", MORNING, "--dry-run"] + self.base)
        self.assertNotIn("vs previous close", out)
        self.assertNotIn("price for", out)

    def test_symbols_from_watchlist_and_plan(self):
        wl = os.path.join(self.tmp.name, "watchlist.json")
        with open(wl, "w") as fh:
            json.dump({"created_by": "india-scanner",
                       "hits": [{"symbol": "SYN-AUTO", "setups": ["orb"]}, {"symbol": "not ok!"}]}, fh)
        plan = os.path.join(self.tmp.name, "plan.json")
        with open(plan, "w") as fh:
            json.dump({"created_by": "india-exit", "symbol": "SYNTH"}, fh)
        self.assertEqual(sorted(news.watch_from_files("/nonexistent.json", wl, plan)), ["SYN-AUTO", "SYNTH"])
        args = list(self.base)
        args[args.index("--watchlist") + 1] = wl
        code, out, err = run(["--json", "--dry-run", "--now", MORNING] + args)
        self.assertEqual(code, 0, err)
        touched = {t for i in json.loads(out)["items"] for t in i["touches"]}
        self.assertEqual(touched, {"SYN-AUTO"})

    def test_no_symbols_or_bad_ones(self):
        code, _, err = run(self.base)
        self.assertEqual(code, 2)
        self.assertIn("no symbols", err)
        code, _, err = run(["--tickers", "not ok!"] + self.base)
        self.assertEqual(code, 2)
        self.assertIn("is not an NSE symbol", err)

    def test_state_forgets_after_30_days(self):
        state = {"seen": {"nse:old": "2026-08-01T00:00:00Z"}}
        now = news.parse_now(MORNING)
        news.remember([], state, now)
        self.assertNotIn("nse:old", state["seen"])
        self.assertEqual(state["last_check"], "2026-10-19T04:10:00Z")


class SavedFile(unittest.TestCase):
    """--file: the JSON the user saved by opening NSE's API URL in a browser."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        none = os.path.join(self.tmp.name, "none.json")
        self.base = ["--state", os.path.join(self.tmp.name, "news.json"), "--now", MORNING,
                     "--portfolio", none, "--watchlist", none, "--plan", none,
                     "--no-yahoo", "--no-moves", "--dry-run", "--json"]
        self.saved = os.path.join(DIR, "browser-saved-announcements.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_symbols_come_from_the_file(self):
        code, out, err = run(["--file", self.saved] + self.base)
        self.assertEqual(code, 0, err)
        items = json.loads(out)["items"]
        self.assertEqual(sorted({i["ticker"] for i in items}), ["SYN-PHARMA", "SYNTH"])
        qip = next(i for i in items if i["ticker"] == "SYN-PHARMA")
        self.assertIn("fund raising", qip["tags"])

    def test_only_the_symbols_asked_for(self):
        code, out, err = run(["--tickers", "SYNTH", "--file", self.saved] + self.base)
        self.assertEqual(code, 0, err)
        self.assertEqual({i["ticker"] for i in json.loads(out)["items"]}, {"SYNTH"})

    def test_a_saved_web_page_is_refused_clearly(self):
        page = os.path.join(self.tmp.name, "page.json")
        with open(page, "w") as fh:
            fh.write("<html><body>Access Denied</body></html>")
        code, _, err = run(["--tickers", "SYNTH", "--file", page] + self.base)
        self.assertEqual(code, 2)
        self.assertIn("is not JSON", err)


class NseClient(unittest.TestCase):
    """The live path, with the network replaced: warm-up, headers, pauses, refusals."""

    def fetcher(self, answers):
        f = news.Fetcher()
        f.calls = []

        def fake(url, headers, gap):
            f.calls.append((url, headers, gap))
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a
        f._open = fake
        return f

    def test_warm_up_then_the_api_call(self):
        f = self.fetcher([b"<html>home</html>", json.dumps(records("nse-announcements-SYNTH.json")).encode()])
        items = news.collect(f, {"SYNTH": None}, news.parse_now(MORNING), yahoo=False)
        self.assertEqual(len(items), 8)
        (home, h1, g1), (api, h2, g2) = f.calls
        self.assertEqual(home, "https://www.nseindia.com/")
        self.assertTrue(api.startswith("https://www.nseindia.com/api/corporate-announcements?index=equities"
                                       "&symbol=SYNTH&from_date=05-10-2026&to_date=19-10-2026"))
        self.assertEqual(h2["Referer"], "https://www.nseindia.com/companies-listing/corporate-filings-announcements")
        self.assertTrue(h2["User-Agent"].startswith("Mozilla/5.0 (Windows"))
        self.assertGreaterEqual(min(g1, g2), 1.0)
        self.assertGreaterEqual(news.Fetcher(nse_pause=0.1).nse_pause, 1.0)

    def test_a_refusal_stops_further_nse_calls(self):
        err = urllib.error.HTTPError("https://www.nseindia.com/", 403, "Forbidden", {}, None)
        f = self.fetcher([err])
        errors = []
        items = news.collect(f, {"SYNTH": None, "SYN-AUTO": None}, news.parse_now(MORNING),
                             yahoo=False, errors=errors)
        self.assertEqual(items, [])
        self.assertEqual(len(f.calls), 1)
        self.assertIn("NSE answered HTTP 403", errors[0])
        self.assertIn("--file PATH", errors[0])
        self.assertIn("symbol=SYN-AUTO", errors[0])
        self.assertIn("not asked for SYNTH", errors[1])

    def test_no_answer_and_not_json(self):
        for answer, words in ((socket.timeout("timed out"), "NSE did not answer (timed out)"),
                              (b"<html>Access Denied</html>", "not JSON")):
            f = self.fetcher([b"", answer])
            with self.assertRaises(news.Blocked) as cm:
                f.nse_json(news.nse_url("SYNTH"), "x")
            self.assertIn(words, str(cm.exception))
            self.assertIn("--file PATH", str(cm.exception))


class Files(unittest.TestCase):
    def test_skill_files_are_clean(self):
        for rel in ("india-news/SKILL.md", "india-news/news.py"):
            with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
                text = fh.read()
            self.assertNotIn(chr(0x2014), text, rel)
            self.assertNotIn("trader/", text.replace("trader-india/", ""), rel)
        with open(os.path.join(ROOT, "india-news", "SKILL.md"), encoding="utf-8") as fh:
            skill = fh.read()
        self.assertIn("name: india-news", skill)
        self.assertIn("terms of use", skill)
        self.assertIn("synthetic", skill)


if __name__ == "__main__":
    unittest.main()
