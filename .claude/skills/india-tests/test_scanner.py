"""Tests for india-scanner/scan.py.

Every chart fixture is SYNTHETIC: the US pack's real Yahoo charts re-timed onto
the NSE clock by fixtures/retime.py (09:30 ET -> 09:15 IST, NSE holidays and
bars at or after 15:30 dropped, TSLA -> SYNTH, X -> SYN-X). Prices are US prices
relabelled as rupees. The two live 5-minute files were fetched on Tue
2026-10-20, Dussehra on NSE, so they were first moved one day to Wed
2026-10-21 (every timestamp + 86,400 s) and then re-timed. The equity list
EQUITY_L-synthetic.csv carries NSE's real header and the renamed symbols; SYN-MPC
and SYN-BETEST are in series BE, SYN-ELV and SYN-BZTEST in BZ, to prove the series
filter (SYN-MPC and SYN-ELV are opening-range hits in the wall). Every expected
number below was recomputed from these files.
"""
import datetime
import io
import json
import os
import shutil
import socket
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout, redirect_stderr

from _load import load, FIX

scan = load("india-scanner", "scan")

SDIR = os.path.join(FIX, "india-scanner")
WALL = os.path.join(SDIR, "SYNTH-wall5m-2026-10-19.json.gz")       # 234 synthetic 5-min charts, Mon 2026-10-19
DAILY = os.path.join(SDIR, "SYNTH-daily-spark-2026-10-19.json")    # 19 synthetic daily charts, one spark answer
LIVE = os.path.join(SDIR, "SYNTH-spark-3mo-2026-10-20.json")       # a 20-symbol spark answer (19 came back)
SPARK5 = os.path.join(SDIR, "SYNTH-spark-5m-2026-10-21-0946.json")  # spark 5-min, as of 09:46:47 IST Wed 2026-10-21
SYNTH5 = os.path.join(SDIR, "SYNTH-5m-2026-10-21-0946.json")        # SYNTH's v8 chart, same moment
EQUITY = os.path.join(SDIR, "EQUITY_L-synthetic.csv")               # NSE's header, synthetic rows
HEADER = "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE"
REAL_ROW = "20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5"   # the format of NSE's real file
DT = datetime.datetime
D = datetime.date
UNTIL = datetime.time(14, 30)


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = scan.main(argv)
    return code, out.getvalue(), err.getvalue()


def ts(ist_text):
    """India wall-clock text -> unix seconds."""
    local = DT.strptime(ist_text, "%Y-%m-%d %H:%M:%S" if ist_text.count(":") == 2 else "%Y-%m-%d %H:%M")
    return int((scan.ist_to_utc(local) - DT(1970, 1, 1)).total_seconds())


def bars_series(day, closes, highs=None, lows=None, start="09:15"):
    """A v8-like series of 5-min bars from `start` on `day` (YYYY-MM-DD), India time."""
    t0 = DT.strptime(day + " " + start, "%Y-%m-%d %H:%M")
    t = [ts((t0 + datetime.timedelta(minutes=5 * i)).strftime("%Y-%m-%d %H:%M")) for i in range(len(closes))]
    return {"t": t, "c": list(closes), "h": list(highs or [c + 0.1 if c is not None else None for c in closes]),
            "l": list(lows or [c - 0.1 if c is not None else None for c in closes]), "o": None,
            "v": [1000] * len(closes), "meta": {}}


def read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class Universe(unittest.TestCase):
    def setUp(self):
        self.rows = scan.parse_equity_list(read_text(EQUITY))
        self.kept, self.counts, self.series = scan.build_universe(self.rows)

    def test_the_synthetic_list(self):
        self.assertEqual(self.counts, {"rows": 238, "series BE": 2, "series BZ": 2, "keep": 234})
        syms = [s for s, _ in self.kept]
        self.assertIn("SYNTH", syms)
        self.assertIn("SYN-M&M", syms)                    # & is part of NSE symbols (M&M)
        for gone in ("SYN-MPC", "SYN-BETEST", "SYN-ELV", "SYN-BZTEST"):   # BE / BZ: trade-for-trade
            self.assertNotIn(gone, syms)
        self.assertEqual(dict(self.kept)["SYN-BRK-B"], "Synthetic Test Stock BRK-B, Class B Limited")  # quoted comma
        self.assertEqual(set(self.series.values()), {"EQ"})
        self.assertEqual(sorted(self.series), syms)

    def test_header_spaces_are_stripped(self):
        self.assertEqual(read_text(EQUITY).splitlines()[0], HEADER)
        self.assertEqual(sorted(self.rows[0]), sorted(h.strip() for h in HEADER.split(",")))
        self.assertEqual(self.rows[0]["SERIES"], "EQ")

    def test_the_real_format_and_a_browser_bom(self):
        rows = scan.parse_equity_list("﻿" + HEADER + "\r\n" + REAL_ROW + "\r\n\r\n")
        self.assertEqual(rows, [{"SYMBOL": "20MICRONS", "NAME OF COMPANY": "20 Microns Limited", "SERIES": "EQ",
                                 "DATE OF LISTING": "06-OCT-2008", "PAID UP VALUE": "5", "MARKET LOT": "1",
                                 "ISIN NUMBER": "INE144J01027", "FACE VALUE": "5"}])
        self.assertEqual(scan.build_universe(rows)[0], [("20MICRONS", "20 Microns Limited")])

    def test_allowed_series(self):
        kept, counts, series = scan.build_universe(self.rows, ["EQ", "BE"])
        self.assertEqual((len(kept), counts["series BZ"]), (236, 2))
        self.assertIn("SYN-MPC", dict(kept))
        self.assertEqual((series["SYN-MPC"], series["SYNTH"]), ("BE", "EQ"))

    def test_not_the_equity_list(self):
        for text, words in (("<html><body>Access Denied</body></html>", "web page"),
                            ("", "empty"),
                            ("Symbol|Security Name|Market Category\nAAPL|Apple Inc.|Q\n", "not NSE's EQUITY_L.csv")):
            with self.assertRaises(scan.ScanError) as cm:
                scan.parse_equity_list(text)
            self.assertIn(words, str(cm.exception))

    def test_bad_symbols_are_counted_not_kept(self):
        rows = scan.parse_equity_list(HEADER + "\nGOOD,Good Ltd,EQ,,,,,\nBAD SYM,Bad Ltd,EQ,,,,,\n")
        kept, counts, series = scan.build_universe(rows)
        self.assertEqual((kept, counts["not an NSE symbol"], series), ([("GOOD", "Good Ltd")], 1, {"GOOD": "EQ"}))

    def test_no_us_universe_logic_left(self):
        for name in ("NASDAQ_FILES", "parse_symdir", "classify", "eastern_offset", "NYSE_HOLIDAYS"):
            self.assertFalse(hasattr(scan, name), name)


class UniverseNetwork(unittest.TestCase):
    """NSE's site answers scripts with 403s, web pages or nothing: one request, then the browser route."""

    def setUp(self):
        self.calls = []
        self._get = scan.http_get
        self.d = tempfile.mkdtemp()
        self.out = os.path.join(self.d, "universe.txt")

    def tearDown(self):
        scan.http_get = self._get
        shutil.rmtree(self.d)

    def answer(self, what):
        def fake(url, timeout=20, headers=None):
            self.calls.append((url, timeout, headers))
            if isinstance(what, Exception):
                raise what
            return what
        scan.http_get = fake

    def test_one_polite_request(self):
        self.answer(read_text(EQUITY))
        code, text, _ = run(["universe", "--out", self.out, "--config", os.path.join(self.d, "none.json")])
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 1)
        url, timeout, headers = self.calls[0]
        self.assertEqual(url, "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv")
        self.assertEqual(timeout, 20)
        self.assertTrue(headers["User-Agent"].startswith("Mozilla/5.0 (Windows NT"))
        self.assertIn("Kept 234 stocks in series EQ", text)
        self.assertIn("2 series BE (trade-for-trade: delivery only, no intraday)", text)

    def test_failures_say_download_it_in_the_browser(self):
        for what in (urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(b"")),
                     socket.timeout("timed out"),
                     urllib.error.URLError("connection reset"),
                     "<!DOCTYPE html><html><head><title>Access Denied</title></head></html>"):
            self.calls = []
            self.answer(what)
            code, text, err = run(["universe", "--out", self.out])
            self.assertEqual(code, 1, what)
            self.assertEqual(len(self.calls), 1, what)          # never retried
            self.assertEqual(len(err.strip().splitlines()), 1, err)
            self.assertIn("in your browser", err)
            self.assertIn("--file", err)
            self.assertIn("EQUITY_L.csv", err)
            self.assertNotIn("Traceback", err)
            self.assertFalse(os.path.exists(self.out))
        self.answer(urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(b"")))
        self.assertIn("HTTP 403", run(["universe", "--out", self.out])[2])

    def test_the_file_route_needs_no_network(self):
        self.answer(AssertionError("no network with --file"))
        code, text, _ = run(["universe", "--file", EQUITY, "--out", self.out, "--series", "EQ,BZ"])
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [])
        self.assertIn("Kept 236 stocks in series EQ, BZ", text)
        code, _, err = run(["universe", "--file", os.path.join(self.d, "nope.csv")])
        self.assertEqual(code, 1)
        self.assertIn("no file at", err)

    def test_config_allowed_series(self):
        cfg = os.path.join(self.d, "config.json")
        with open(cfg, "w") as fh:
            json.dump({"allowed_series": ["EQ", "BE"]}, fh)
        code, text, _ = run(["universe", "--file", EQUITY, "--out", self.out, "--config", cfg, "--json"])
        doc = json.loads(text)
        self.assertEqual((code, doc["count"], doc["allowed_series"], doc["dropped"]),
                         (0, 236, ["EQ", "BE"], {"series BZ": 2}))


class Time(unittest.TestCase):
    def test_india_clock(self):
        self.assertEqual(scan.ts_to_ist(1792381500), DT(2026, 10, 19, 9, 15))   # SYNTH's first wall bar
        self.assertEqual(scan.parse_now("2026-10-19 10:00"), DT(2026, 10, 19, 4, 30))
        self.assertEqual(scan.parse_now("2026-12-01 10:00"), DT(2026, 12, 1, 4, 30))   # no daylight saving
        self.assertEqual(scan.parse_now("2026-10-19T04:30:00Z"), DT(2026, 10, 19, 4, 30))
        self.assertEqual(scan.hm(DT(2026, 10, 19, 9, 5)), "09:05")
        with self.assertRaises(scan.ScanError):
            scan.now_utc("tomorrow")
        with self.assertRaises(scan.ScanError):
            scan.parse_hhmm("25:00")
        with self.assertRaises(scan.ScanError):
            scan.parse_hhmm("10:00 AM")

    def test_calendar_warning(self):
        self.assertIsNone(scan.calendar_warning(D(2026, 12, 1)))
        self.assertIn("trader-india/holidays.json", scan.calendar_warning(D(2027, 1, 4)))


class Spark(unittest.TestCase):
    def test_a_spark_answer(self):
        wanted = {scan.yahoo_symbol(s): s for s in ["SYN-AAPL", "SYNTH", "SYN-BRK-B", "SYN-ZZZZQX"]}
        data = scan.parse_spark(read_text(LIVE), wanted)
        self.assertEqual(len(data), 19)            # 20 asked; Yahoo silently dropped a made-up symbol
        self.assertNotIn("SYN-ZZZZQX", data)
        self.assertIn("SYN-BRK-B", data)           # SYN-BRK-B.NS comes back as ours
        t = data["SYNTH"]
        self.assertEqual(len(t["t"]), 63)          # 65 US sessions less 2026-09-14 and 2026-10-02 (NSE holidays)
        self.assertIsNone(t["h"])                  # spark is closes only
        self.assertEqual(t["c"][-1], 368.06)
        self.assertEqual(t["meta"]["regularMarketVolume"], 38651173)
        self.assertEqual(t["meta"]["currency"], "INR")
        self.assertEqual(data["SYN-AMC"]["meta"]["regularMarketPrice"], 2.98)
        closes = scan.daily_closes(t, scan.parse_now("2026-10-20 09:14"))     # Dussehra morning
        self.assertEqual(closes[-1], (D(2026, 10, 19), 368.06))
        closes = scan.daily_closes(t, scan.parse_now("2026-10-19 12:00"))     # Monday's bar still in progress
        self.assertEqual(closes[-1][0], D(2026, 10, 16))

    def test_spark_errors(self):
        too_many = '{"spark":{"result":null,"error":{"code":"Bad Request",' \
                   '"description":"Number of symbols needs to be less than or equal to 20"}}}'
        with self.assertRaises(scan.ScanError) as cm:
            scan.parse_spark(too_many)
        self.assertIn("less than or equal to 20", str(cm.exception))
        self.assertEqual(scan.parse_spark('{"spark":{"result":[],"error":null}}'), {})
        with self.assertRaises(scan.ScanError):
            scan.parse_spark('{"chart":{}}')

    def test_urls_add_ns_and_encode(self):
        self.assertEqual(scan.spark_path(["M&M", "bajaj-auto", "SYNTH.NS"], "3mo", "1d"),
                         "/v7/finance/spark?symbols=M%26M.NS,BAJAJ-AUTO.NS,SYNTH.NS&range=3mo&interval=1d")
        self.assertEqual(scan.chart_path("M&M", "1d", "5m"), "/v8/finance/chart/M%26M.NS?range=1d&interval=5m")
        data = scan.parse_spark({"spark": {"result": [{"symbol": "M&M.NS", "response": [
            {"meta": {"symbol": "M&M.NS"}, "timestamp": [], "indicators": {"quote": [{"close": []}]}}]}]}})
        self.assertEqual(list(data), ["M&M"])


class Network(unittest.TestCase):
    """429s and 5xx from Yahoo without the network."""

    def setUp(self):
        self.calls, self.sleeps = [], []
        self._get, self._sleep = scan.http_get, scan.SLEEP
        scan.SLEEP = self.sleeps.append
        self.body = read_text(LIVE)

    def tearDown(self):
        scan.http_get, scan.SLEEP = self._get, self._sleep

    def answers(self, codes):
        codes = list(codes)

        def fake(url, timeout=20, headers=None):
            self.calls.append(url.split("/v")[0])
            code = codes.pop(0) if codes else 200
            if code != 200:
                raise urllib.error.HTTPError(url, code, "x", {}, io.BytesIO(b""))
            return self.body
        scan.http_get = fake

    def test_429_falls_back_then_waits_once(self):
        self.answers([429, 429, 200])
        self.assertEqual(scan.yahoo_get("/v7/finance/spark?symbols=SYNTH.NS&range=3mo&interval=1d"), self.body)
        self.assertEqual(self.calls, ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com",
                                      "https://query2.finance.yahoo.com"])
        self.assertEqual(self.sleeps, [scan.BACKOFF])

    def test_5xx_goes_to_query1_without_waiting(self):
        self.answers([503, 200])
        scan.yahoo_get("/v8/finance/chart/SYNTH.NS?range=1d&interval=5m")
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.sleeps, [])

    def test_429_for_good_is_reported_as_partial(self):
        self.answers([200] + [429] * 10)
        real = sorted(scan.parse_spark(self.body))
        syms = real + ["SYN-ZZZZQX"] + ["SYN-X%02d" % i for i in range(20)]
        data, failed = scan.fetch_spark(syms, "3mo", "1d", 0.3)
        self.assertEqual(len(data), 19)
        self.assertEqual(failed["SYN-ZZZZQX"], "no data from Yahoo")
        self.assertEqual(len(failed), 21)
        self.assertIn("HTTP 429", failed["SYN-X00"])
        self.assertEqual(self.sleeps, [0.3, scan.BACKOFF])  # a pause between batches, one backoff
        hits, counts, _ = scan.scan_daily(data, syms, scan.parse_now("2026-10-20 09:14"), 20, 10 * scan.CRORE)
        self.assertEqual((counts["requested"], counts["fetched"]), (40, 19))

    def test_a_404_is_final(self):
        self.answers([404])
        with self.assertRaises(scan.ScanError):
            scan.yahoo_get("/v8/finance/chart/NOPE.NS?range=1d&interval=5m")
        self.assertEqual(len(self.calls), 1)


class Daily(unittest.TestCase):
    # Recomputed from the synthetic closes through Fri 2026-10-16 (62 sessions after NSE holidays):
    EXPECT = {
        "SYN-BLK": ["breakout_20d"],    # 1134.38 > 1120.78, the best close of the 20 before
        "SYN-CI": ["breakout_20d"],     # 302.30 > 298.81
        "SYN-XOM": ["breakout_20d"],    # 178.98 > 177.01
        "SYN-HD": ["breakout_20d"],     # 309.63 > 308.24
        "SYN-KO": ["breakout_20d"],     # 93.90 > 92.00
        "SYN-CCL": ["bull_flag"],       # up 20.9 % over the 10 sessions, last 5 closes in a 3.2 % range
        "SYN-RCL": ["bull_flag"],       # up 18.1 %, 2.6 % range
        "SYN-F": ["reclaim_ma20"],      # 12.31 under 12.49, then 12.43 over 12.43 (12.427)
        "SYN-JPM": ["reclaim_ma20"],    # 335.53 under 337.00, then 339.72 over 336.52
        "SYN-GE": ["reclaim_ma20"],     # 312.00 under 313.10, then 313.83 over 313.11
        "SYN-BAC": ["oversold"],        # RSI 24.0
        "SYN-PLUG": ["oversold"],       # RSI 21.5
        "SYN-MS": ["oversold"],         # RSI 25.8
        "SYN-RIVN": ["oversold"],       # RSI 21.4
        "SYN-PNC": ["oversold_bounce"],  # RSI 27.1 on Thursday, closed up Friday (214.94 -> 217.39), RSI 33.7
    }

    def setUp(self):
        self.data, self.errors = scan.load_offline(DAILY)
        self.syms = sorted(self.data)

    def test_setups_before_the_open(self):
        self.assertEqual(len(self.syms), 19)
        hits, counts, last = scan.scan_daily(self.data, self.syms, scan.parse_now("2026-10-19 09:00"), 0, 0)
        self.assertEqual({h["symbol"]: h["setups"] for h in hits}, self.EXPECT)
        self.assertEqual(last, D(2026, 10, 16))
        self.assertEqual(counts, {"requested": 19, "fetched": 19, "illiquid": 0, "short": 0, "scanned": 19,
                                  "hits": 15})
        blk = [h for h in hits if h["symbol"] == "SYN-BLK"][0]
        self.assertEqual((blk["price"], blk["rsi"], blk["close_date"], blk["value_inr"]),
                         (1134.38, 63.0, "2026-10-16", 119109791))
        self.assertEqual(hits[0]["symbol"], "SYN-BAC")    # most rupees traded first: 51.05 x 8,531,643
        self.assertEqual([h["value_inr"] for h in hits], sorted((h["value_inr"] for h in hits), reverse=True))

    def test_the_in_progress_bar_is_dropped(self):
        before = scan.scan_daily(self.data, self.syms, scan.parse_now("2026-10-19 09:00"), 0, 0)
        during = scan.scan_daily(self.data, self.syms, scan.parse_now("2026-10-19 10:35"), 0, 0)
        self.assertEqual(before, during)
        bars = scan.daily_closes(self.data["SYNTH"], scan.parse_now("2026-10-19 15:29"))
        self.assertEqual(bars[-1], (D(2026, 10, 16), 354.7200012207031))
        bars = scan.daily_closes(self.data["SYNTH"], scan.parse_now("2026-10-19 15:30"))
        self.assertEqual(bars[-1], (D(2026, 10, 19), 365.7950134277344))

    def test_a_holiday_completes_nothing(self):
        s = {"t": [ts("2026-10-19 09:15"), ts("2026-10-21 09:15")], "c": [10.0, 11.0], "meta": {}}
        self.assertEqual(len(scan.daily_closes(s, scan.parse_now("2026-10-20 12:00"))), 1)   # Dussehra
        self.assertEqual(len(scan.daily_closes(s, scan.parse_now("2026-10-21 15:29"))), 1)
        self.assertEqual(len(scan.daily_closes(s, scan.parse_now("2026-10-21 15:30"))), 2)

    def test_liquidity_filter_in_rupees(self):
        # meta is Yahoo's as of 10:34:56 IST Monday, so the volume is the day's so far
        hits, counts, _ = scan.scan_daily(self.data, self.syms, scan.parse_now("2026-10-19 10:35"), 20,
                                          10 * scan.CRORE)
        self.assertEqual(sorted(h["symbol"] for h in hits),
                         ["SYN-BAC", "SYN-BLK", "SYN-GE", "SYN-HD", "SYN-JPM", "SYN-KO", "SYN-MS", "SYN-XOM"])
        # under ₹20: SYN-F 12.32, SYN-PLUG 1.41, SYN-RIVN 12.27; under ₹10 crore traded: SYN-CCL 8.69,
        # SYN-CI 4.94, SYN-PNC 6.18, SYN-RCL 9.73 crore. SYN-BLK passes at 11.91 crore (106,202 x 1,121.54).
        self.assertEqual(counts["illiquid"], 7)
        self.assertEqual(counts["scanned"], 12)
        hits, counts, _ = scan.scan_daily(self.data, self.syms, scan.parse_now("2026-10-19 10:35"), 20,
                                          10 * scan.CRORE, min_volume=1000000)
        self.assertNotIn("SYN-BLK", [h["symbol"] for h in hits])

    def test_short_and_empty_charts(self):
        s = {"t": [ts("2026-10-%02d 09:15" % d) for d in range(5, 15)], "c": [100.0] * 10,
             "meta": {"regularMarketPrice": 100, "regularMarketVolume": 5000000}}
        hits, counts, last = scan.scan_daily({"X": s, "E": {"t": [], "c": [], "meta": {}}}, ["X", "E", "GONE"],
                                             scan.parse_now("2026-10-21 09:00"), 20, 10 * scan.CRORE)
        self.assertEqual(hits, [])
        self.assertEqual((counts["fetched"], counts["short"], counts["illiquid"], counts["scanned"]), (2, 1, 1, 0))
        self.assertIsNone(last)

    def test_rsi(self):
        self.assertIsNone(scan.rsi([1.0] * 10))
        self.assertEqual(scan.rsi([float(x) for x in range(1, 40)]), 100.0)
        closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
                  46.28, 46.28]
        self.assertAlmostEqual(scan.rsi(closes), 70.46, places=1)  # Wilder's textbook example


class Orb(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.errors = scan.load_offline(WALL)
        cls.syms = sorted(set(cls.data) | set(cls.errors))

    def scan_at(self, now, min_price=0, syms=None, or_minutes=15):
        day, cutoff = scan.orb_window(scan.parse_now(now), None, or_minutes, UNTIL)
        return scan.scan_orb(self.data, syms or self.syms, day, cutoff, or_minutes, min_price, 0)

    def test_the_wall_at_ten(self):
        hits, counts, failed = self.scan_at("2026-10-19 10:00")
        self.assertEqual(len(self.syms), 234)               # "_provenance" is not a chart
        self.assertEqual(counts["scanned"], 231)          # usable charts
        self.assertEqual(len(hits), 42)
        self.assertEqual(self.errors, {"SYN-SQ": "no data for SYN-SQ: No data found, symbol may be delisted"})
        self.assertEqual(counts["unusable"], 2)            # SYN-WBD (no bars), SYN-PARA (missing bars)
        synth = [h for h in hits if h["symbol"] == "SYNTH"][0]
        self.assertEqual(synth, {"symbol": "SYNTH", "setups": ["orb"], "price": 364.18, "at": "10:00",
                                 "bar_start": "09:55", "bar_index": 8, "or_high": 362.18, "or_low": 354.47,
                                 "pct_over": 0.55})
        self.assertEqual(hits[0]["symbol"], "SYN-AMC")     # sorted by time, then symbol
        self.assertEqual([h["at"] for h in hits], sorted(h["at"] for h in hits))
        self.assertEqual(hits[0]["at"], "09:35")           # the first possible bar after the 09:15-09:30 range
        self.assertEqual(sum(1 for h in hits if h["at"] == "10:00"), 11)
        lly = [h for h in hits if h["symbol"] == "SYN-LLY"][0]
        self.assertEqual((lly["price"], lly["or_high"], lly["pct_over"]), (1255.0, 1254.99, 0.0))

    def test_price_floor_in_rupees(self):
        hits, counts, _ = self.scan_at("2026-10-19 10:00", min_price=20)
        self.assertEqual(len(hits), 39)                    # SYN-AMC 2.97, SYN-CLSK 8.81, SYN-CPNG 14.39 drop out
        self.assertEqual(counts["illiquid"], 32)
        self.assertNotIn("SYN-CPNG", [h["symbol"] for h in hits])

    def test_in_progress_bar_and_no_breakout_yet(self):
        hits, _, _ = self.scan_at("2026-10-19 09:59", syms=["SYNTH"])
        self.assertEqual(hits, [])                         # the 09:55 bar is not done until 10:00
        hits, _, _ = self.scan_at("2026-10-19 10:00", syms=["SYNTH"])
        self.assertEqual(hits[0]["at"], "10:00")

    def test_the_live_tick_is_dropped(self):
        s = self.data["SYNTH"]
        self.assertEqual(scan.ts_to_ist(s["t"][-1]), DT(2026, 10, 19, 10, 43, 7))   # off the grid
        bars = scan.session_bars(s, D(2026, 10, 19), DT(2026, 10, 19, 10, 44))
        self.assertEqual(len(bars), 17)                    # 09:15 to 10:35; 10:40 in progress, the tick dropped
        self.assertTrue(scan.usable(bars, D(2026, 10, 19), DT(2026, 10, 19, 10, 44), 3))
        hits, _, _ = self.scan_at("2026-10-19 10:45", syms=["SYNTH"])
        self.assertEqual(hits[0]["price"], 364.18)         # still the first close above the range

    def test_stage_one_is_a_necessary_condition(self):
        day, cut = D(2026, 10, 19), DT(2026, 10, 19, 10, 0)
        for sym, s in self.data.items():
            bars = scan.session_bars(s, day, cut)
            if scan.usable(bars, day, cut, 3) and scan.orb_hit(bars, 3):
                self.assertTrue(scan.orb_candidate(bars, 3), sym)

    def test_confirm_uses_the_v8_highs(self):
        spark_like = {k: dict(v, h=None, l=None) for k, v in self.data.items()}  # closes only, like spark
        asked = []

        def confirm(sym):
            asked.append(sym)
            return self.data[sym]
        hits, counts, failed = scan.scan_orb(spark_like, self.syms, D(2026, 10, 19), DT(2026, 10, 19, 10, 0), 15,
                                             0, 0, confirm)
        self.assertEqual(len(hits), 42)
        self.assertEqual(counts["candidates"], len(asked))
        self.assertEqual(len(asked), 95)                   # stage 1 skipped 136 of the 231 usable charts

        def broken(sym):
            raise scan.ScanError("Yahoo answered HTTP 429 for /v8/finance/chart/%s.NS" % sym)
        hits, counts, failed = scan.scan_orb(spark_like, ["SYNTH", "SYN-KO"], D(2026, 10, 19),
                                             DT(2026, 10, 19, 10, 0), 15, 0, 0, broken)
        self.assertEqual(hits, [])
        self.assertIn("429", failed["SYNTH"])

    def test_a_missing_bar_makes_a_chart_unusable(self):
        s = bars_series("2026-10-21", [100, 102, 101, None, 105, 106, 107, 108, 109])
        bars = scan.session_bars(s, D(2026, 10, 21), DT(2026, 10, 21, 10, 0))
        self.assertFalse(scan.usable(bars, D(2026, 10, 21), DT(2026, 10, 21, 10, 0), 3))

    def test_a_30_minute_range_and_the_1530_close(self):
        closes = [100, 101, 100.5, 100.8, 101.2, 100.9, 101.5] + [101.0] * 73
        s = bars_series("2026-11-27", closes, highs=[c + 0.2 for c in closes])
        hits, counts, _ = scan.scan_orb({"X": s}, ["X"], D(2026, 11, 27), DT(2026, 11, 27, 12, 0), 30, 0, 0)
        self.assertEqual(counts["scanned"], 1)
        self.assertEqual(hits[0]["at"], "09:50")           # range 09:15 to 09:45 (high 101.4), the 09:45 bar 101.5
        self.assertEqual(hits[0]["or_high"], 101.4)
        bars = scan.session_bars(s, D(2026, 11, 27), DT(2026, 11, 27, 16, 0))
        self.assertEqual(len(bars), 75)                    # 09:15 to 15:25; the bars from 15:30 on are dropped
        self.assertEqual(bars[-1]["start"], DT(2026, 11, 27, 15, 25))
        self.assertTrue(scan.usable(bars, D(2026, 11, 27), DT(2026, 11, 27, 16, 0), 6))

    def test_window_messages(self):
        def msg(now, at=None, until=UNTIL):
            with self.assertRaises(scan.ScanError) as cm:
                scan.orb_window(scan.parse_now(now), at, 15, until)
            return str(cm.exception)
        self.assertIn("weekend", msg("2026-10-17 10:00"))
        self.assertIn("NSE holiday: Dussehra", msg("2026-10-20 10:00"))
        self.assertIn("NSE holiday: Prakash Gurpurb", msg("2026-11-24 10:00"))
        self.assertIn("Run orb again after 09:35", msg("2026-10-19 09:30"))
        self.assertIn("Run orb again after 09:35", msg("2026-10-19 09:34"))
        self.assertIn("expired", msg("2026-10-19 14:45"))          # after the default 14:30
        self.assertIn("expired", msg("2026-10-19 11:30", until=datetime.time(11, 0)))
        self.assertIn("closed at 15:30", msg("2026-10-19 16:00"))
        self.assertIn("later than now", msg("2026-10-19 09:50", at=datetime.time(10, 0)))
        self.assertIn("after the 15:30 close", msg("2026-10-19 17:00", at=datetime.time(15, 45)))
        self.assertEqual(scan.orb_window(scan.parse_now("2026-10-19 16:00"), datetime.time(10, 0), 15, UNTIL),
                         (D(2026, 10, 19), DT(2026, 10, 19, 10, 0)))
        self.assertEqual(scan.orb_window(scan.parse_now("2026-10-19 09:35"), None, 15, UNTIL)[1],
                         DT(2026, 10, 19, 9, 35))
        with self.assertRaises(scan.ScanError):
            scan.orb_window(scan.parse_now("2026-10-19 10:00"), None, 7, UNTIL)

    def test_a_2027_day_runs_with_a_warning(self):
        self.assertEqual(scan.orb_window(scan.parse_now("2027-01-26 10:00"), None, 15, UNTIL)[0], D(2027, 1, 26))
        self.assertIn("2027 holiday list", scan.calendar_warning(D(2027, 1, 26)))


class LiveFiveMinute(unittest.TestCase):
    """A spark 5-minute answer and SYNTH's v8 chart as of 09:46:47 IST, Wed 2026-10-21 (synthetic)."""

    def setUp(self):
        self.spark = scan.parse_spark(read_text(SPARK5))
        self.v8 = scan.parse_chart(read_text(SYNTH5), "SYNTH")
        self.now = scan.parse_now("2026-10-21T04:16:48Z")

    def test_in_progress_bar_and_live_tick_are_dropped(self):
        self.assertEqual(len(self.spark), 20)
        self.assertIn("SYN-BRK-B", self.spark)
        t = self.spark["SYNTH"]
        self.assertEqual(len(t["t"]), 8)                   # 09:15 ... 09:45 (in progress) + the 09:46:47 tick
        self.assertEqual(scan.ts_to_ist(t["t"][-1]), DT(2026, 10, 21, 9, 46, 47))
        day, cut = scan.orb_window(self.now, None, 15, UNTIL)
        self.assertEqual(cut, DT(2026, 10, 21, 9, 46))
        bars = scan.session_bars(t, day, cut)
        self.assertEqual([scan.hm(b["start"]) for b in bars], ["09:15", "09:20", "09:25", "09:30", "09:35", "09:40"])
        self.assertEqual(len(scan.session_bars(self.v8, day, cut)), 6)

    def test_synth_broke_its_range_at_0945(self):
        day, cut = scan.orb_window(self.now, None, 15, UNTIL)
        hits, counts, failed = scan.scan_orb(self.spark, ["SYNTH", "SYN-AMC"], day, cut, 15, 20, 0, lambda s: self.v8)
        # range 09:15 to 09:30: high 370.49 (the 09:15 bar), low 363.64; the 09:40 bar closed 370.585
        self.assertEqual(hits, [{"symbol": "SYNTH", "setups": ["orb"], "price": 370.58, "at": "09:45",
                                 "bar_start": "09:40", "bar_index": 5, "or_high": 370.49, "or_low": 363.64,
                                 "pct_over": 0.03}])
        self.assertEqual(counts["illiquid"], 1)            # SYN-AMC under the ₹20 floor

    def test_stage_two_cap_takes_the_most_traded(self):
        data, _ = scan.load_offline(WALL)
        spark_like = {k: dict(v, h=None, l=None) for k, v in data.items()}
        asked = []

        def confirm(sym):
            asked.append(sym)
            return data[sym]
        day, cut = D(2026, 10, 19), DT(2026, 10, 19, 10, 0)
        hits, counts, _ = scan.scan_orb(spark_like, sorted(data), day, cut, 15, 0, 0, confirm, max_confirm=10)
        self.assertEqual((counts["confirmed"], counts["unconfirmed"]), (10, 85))
        self.assertIn("SYNTH", asked)                      # among the most rupees traded by 10:00
        self.assertEqual(len(hits), 5)
        hits_all, _, _ = scan.scan_orb(spark_like, sorted(data), day, cut, 15, 0, 0, confirm, max_confirm=0)
        self.assertEqual(len(hits_all), 42)
        for h in hits:
            self.assertIn(h, hits_all)


class Cli(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.t = os.path.join(self.d, "trader-india")
        self.wl = os.path.join(self.t, "watchlist.json")
        self.cfg = os.path.join(self.d, "no-config.json")

    def tearDown(self):
        shutil.rmtree(self.d)

    def read(self, path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def test_universe_daily_orb_end_to_end(self):
        uni = os.path.join(self.t, "universe.txt")
        code, text, _ = run(["universe", "--file", EQUITY, "--out", uni, "--config", self.cfg])
        self.assertEqual(code, 0)
        self.assertIn("Kept 234 stocks in series EQ", text)
        lines = read_text(uni).splitlines()
        self.assertEqual(len(lines), 234)
        self.assertIn("SYN-M&M|Synthetic Test Stock SYN-M&M Limited|EQ", lines)

        # daily over that universe with the 19 daily charts: partial, and said so
        code, text, _ = run(["daily", "--universe", uni, "--offline", DAILY, "--now", "2026-10-19 09:00",
                             "--out", self.wl])
        self.assertEqual(code, 0)
        self.assertIn("Fetched 19 of 234 charts (215 failed or had no data)", text)
        self.assertIn("12 passed the liquidity filter (price ₹20 or more, ₹10 crore or more traded", text)
        doc = self.read(self.wl)
        self.assertEqual((doc["mode"], doc["universe"], doc["scanned"], doc["failed"], doc["exchange"]),
                         ("daily", 234, 12, 215, "NSE"))
        self.assertEqual(doc["filters"], {"min_price_inr": 20.0, "min_value_inr": 100000000.0, "min_volume": 0})
        self.assertEqual(doc["hits"][0], {"symbol": "SYN-BAC", "series": "EQ", "setups": ["oversold"], "price": 51.23,
                                          "close_date": "2026-10-16", "rsi": 24.0, "volume": 8531643,
                                          "value_inr": 435497717})
        self.assertEqual(len(doc["hits"]), 8)
        self.assertEqual(doc["as_of"], "2026-10-16 close")

        # the 10:00 scan over the universe: SYN-MPC (BE) and SYN-ELV (BZ) broke out but are not scanned
        code, text, _ = run(["orb", "--universe", uni, "--offline", WALL, "--now", "2026-10-19 10:00",
                             "--min-price", "0", "--out", self.wl, "--config", self.cfg])
        self.assertEqual(code, 0)
        self.assertIn("Fetched 231 of 234 charts (3 failed or had no data); 229 usable", text)
        self.assertIn("40 of 229 charts closed above their opening-range high by 10:00 IST", text)
        self.assertIn("  10:00  SYNTH             ₹364.18  range 354.47 to 362.18  +0.55% over", text)
        self.assertIn("not a list of stocks to buy", text)
        doc = self.read(self.wl)
        self.assertEqual({k: doc[k] for k in ("created_by", "created_at", "mode", "as_of", "universe", "scanned",
                                              "source", "exchange", "timezone", "opening_range")},
                         {"created_by": "india-scanner", "created_at": "2026-10-19T04:30:00Z", "mode": "orb",
                          "as_of": "2026-10-19 10:00 IST", "universe": 234, "scanned": 229, "source": "yahoo",
                          "exchange": "NSE", "timezone": "IST", "opening_range": "09:15-09:30"})
        syms = [h["symbol"] for h in doc["hits"]]
        self.assertEqual(len(syms), 40)
        self.assertNotIn("SYN-MPC", syms)
        self.assertNotIn("SYN-ELV", syms)
        self.assertIn({"symbol": "SYNTH", "series": "EQ", "setups": ["orb"], "price": 364.18, "at": "10:00",
                       "bar_start": "09:55", "bar_index": 8, "or_high": 362.18, "or_low": 354.47, "pct_over": 0.55},
                      doc["hits"])
        self.assertEqual({h["series"] for h in doc["hits"]}, {"EQ"})
        self.assertEqual(list(doc["hits"][0])[:2], ["symbol", "series"])

        # the hits read back as a watchlist, with --at instead of --now
        code, text, _ = run(["orb", "--offline", WALL, "--at", "10:00", "--watchlist", self.wl, "--min-price", "0",
                             "--json", "--no-write", "--config", self.cfg])
        self.assertEqual(code, 0)
        out = json.loads(text)
        self.assertEqual((out["universe"], out["scanned"], len(out["hits"])), (40, 40, 40))
        self.assertEqual({h["series"] for h in out["hits"]}, {"EQ"})   # carried over from the watchlist

    def test_partial_stage_two_is_said(self):
        """The networked path with a fake Yahoo that answers from the synthetic bundle."""
        bundle = json.loads(scan._read_maybe_gz(WALL))
        calls = []

        def unquote(y):
            return scan.from_yahoo(scan.urllib.parse.unquote(y))

        def get(path):
            calls.append(path)
            if path.startswith("/v7/finance/spark"):
                res = []
                for y in path.split("symbols=")[1].split("&")[0].split(","):
                    r = ((bundle.get(unquote(y)) or {}).get("chart") or {}).get("result")
                    if r:
                        closes = r[0]["indicators"]["quote"][0].get("close", [])
                        res.append({"symbol": scan.urllib.parse.unquote(y),
                                    "response": [dict(r[0], indicators={"quote": [{"close": closes}]})]})
                return json.dumps({"spark": {"result": res, "error": None}})
            return json.dumps(bundle[unquote(path.split("/chart/")[1].split("?")[0])])
        old_get, old_sleep, real_now = scan.yahoo_get, scan.SLEEP, scan.parse_now
        scan.yahoo_get, scan.SLEEP = get, (lambda s: None)
        scan.parse_now = lambda text: real_now(text or "2026-10-19 10:05")  # the machine clock, pinned
        uni = os.path.join(self.d, "u.txt")
        with open(uni, "w") as fh:
            fh.write("\n".join(sorted(k for k in bundle if not k.startswith("_"))) + "\n")
        try:
            code, text, _ = run(["orb", "--universe", uni, "--now", "2026-10-19 10:00", "--min-price", "0",
                                 "--max-confirm", "10", "--no-write", "--config", self.cfg])
        finally:
            scan.yahoo_get, scan.SLEEP, scan.parse_now = old_get, old_sleep, real_now
        self.assertEqual(code, 0)
        self.assertIn("231 usable; 95 candidates, 10 confirmed", text)
        self.assertIn("PARTIAL: 85 more candidates were not checked", text)
        self.assertIn("5 of the 10 checked charts closed above their opening-range high by 10:00 IST", text)
        self.assertEqual(sum(1 for c in calls if c.startswith("/v8/")), 10)
        self.assertEqual(sum(1 for c in calls if c.startswith("/v7/")), 12)   # 234 symbols, 20 a request
        self.assertTrue(all("range=1d&interval=5m" in c for c in calls))
        self.assertTrue(all(".NS" in c for c in calls))

    def test_plain_messages_and_exit_codes(self):
        code, _, err = run(["orb", "--offline", WALL, "--now", "2026-10-17 10:00", "--out", self.wl])
        self.assertEqual(code, 1)
        self.assertIn("No session on Sat 2026-10-17 (weekend)", err)
        self.assertNotIn("Traceback", err)
        self.assertFalse(os.path.exists(self.wl))
        code, _, err = run(["orb", "--offline", WALL, "--now", "2026-10-19 09:30", "--out", self.wl])
        self.assertIn("after 09:35", err)
        cfg = os.path.join(self.t, "config.json")
        os.makedirs(self.t)
        with open(cfg, "w") as fh:
            json.dump({"no_entries_after": "09:45"}, fh)
        code, _, err = run(["orb", "--offline", WALL, "--now", "2026-10-19 10:00", "--config", cfg])
        self.assertEqual(code, 1)
        self.assertIn("expired", err)
        code, _, err = run(["orb", "--offline", WALL])
        self.assertIn("--at HH:MM", err)
        code, text, _ = run(["orb", "--offline", WALL, "--now", "2026-10-19 09:55", "--symbols", "SYNTH",
                             "--out", self.wl, "--config", self.cfg])
        self.assertEqual(code, 1)                          # no breakout yet, but the empty list is written
        self.assertIn("No chart closed above its opening-range high by 09:55 IST", text)
        self.assertEqual(self.read(self.wl)["hits"], [])
        code, _, err = run(["daily", "--universe", os.path.join(self.d, "nope.txt")])
        self.assertEqual(code, 1)
        self.assertIn("scan.py universe", err)
        code, _, err = run(["daily", "--offline", os.path.join(self.d, "nothing-here")])
        self.assertIn("no offline file", err)
        empty = os.path.join(self.d, "empty.json")
        with open(empty, "w") as fh:
            fh.write("{}")
        code, _, err = run(["daily", "--offline", empty])
        self.assertEqual(code, 1)
        self.assertIn("no symbols to scan", err)
        code, _, err = run(["daily", "--offline", DAILY, "--symbols", "NOT A SYMBOL!"])
        self.assertEqual(code, 1)
        self.assertIn("not an NSE symbol", err)

    def test_a_2027_scan_warns_about_the_calendar(self):
        code, text, err = run(["daily", "--offline", DAILY, "--now", "2027-01-04 09:00", "--no-write"])
        self.assertIn("2027 holiday list", err)
        self.assertIn("trader-india/holidays.json", err)
        code, text, _ = run(["daily", "--offline", DAILY, "--now", "2027-01-04 09:00", "--no-write", "--json"])
        self.assertIn("2027 holiday list", json.loads(text)["warnings"][0])

    def test_series_on_every_hit(self):
        uni = os.path.join(self.d, "u.txt")
        with open(uni, "w") as fh:
            fh.write("SYN-KO|Synthetic Test Stock SYN-KO Limited|EQ\nSYN-XOM|an old line without a series\n")
        self.assertEqual(scan.read_series(uni), {"SYN-KO": "EQ"})
        code, text, _ = run(["daily", "--offline", DAILY, "--symbols", "SYN-KO,SYN-XOM,SYN-BAC", "--universe", uni,
                             "--now", "2026-10-19 09:00", "--json", "--no-write", "--min-value", "0"])
        self.assertEqual(code, 0)
        got = {h["symbol"]: h["series"] for h in json.loads(text)["hits"]}
        self.assertEqual(got, {"SYN-KO": "EQ", "SYN-XOM": None, "SYN-BAC": None})   # null: not in the universe
        code, text, _ = run(["orb", "--offline", WALL, "--now", "2026-10-19 10:00", "--symbols", "SYNTH",
                             "--universe", os.path.join(self.d, "missing.txt"), "--json", "--no-write",
                             "--config", self.cfg])
        self.assertEqual([(h["symbol"], h["series"]) for h in json.loads(text)["hits"]], [("SYNTH", None)])

    def test_offline_folder_of_v8_files(self):
        folder = os.path.join(self.d, "charts")
        os.makedirs(folder)
        bundle = json.loads(scan._read_maybe_gz(WALL))
        for sym in ("SYNTH", "SYN-AAPL", "SYN-KO", "SYN-SQ"):
            with open(os.path.join(folder, sym + ".json"), "w") as fh:
                json.dump(bundle[sym], fh)
        code, text, _ = run(["orb", "--offline", folder, "--now", "2026-10-19 10:00", "--no-write", "--json",
                             "--config", self.cfg])
        out = json.loads(text)
        self.assertEqual((out["universe"], out["scanned"], out["failed"]), (4, 3, 1))
        self.assertEqual([h["symbol"] for h in out["hits"]], ["SYN-AAPL", "SYNTH"])
        self.assertEqual(code, 0)

    def test_symbol_lists(self):
        txt = os.path.join(self.d, "list.txt")
        with open(txt, "w") as fh:
            fh.write("# my list\nSYNTH|Synthetic Test Stock SYNTH Limited\nsyn-ko\nm&m.ns\n\nSYNTH\n")
        self.assertEqual(scan.symbols_from_file(txt), ["SYNTH", "SYN-KO", "M&M", "SYNTH"])
        js = os.path.join(self.d, "wl.json")
        with open(js, "w") as fh:
            json.dump({"hits": [{"symbol": "synth"}, {"symbol": "SYN-KO"}]}, fh)
        self.assertEqual(scan.symbols_from_file(js), ["SYNTH", "SYN-KO"])
        code, text, _ = run(["daily", "--offline", DAILY, "--watchlist", txt, "--now", "2026-10-19 09:00",
                             "--json", "--no-write", "--min-value", "0"])
        out = json.loads(text)
        self.assertEqual((out["universe"], out["scanned"], out["failed"]), (3, 2, 1))   # no chart for M&M
        code, text, _ = run(["daily", "--offline", DAILY, "--limit", "3", "--now", "2026-10-19 09:00", "--json",
                             "--no-write", "--min-value", "0"])
        self.assertEqual(json.loads(text)["universe"], 3)

    def test_daily_json(self):
        code, text, _ = run(["daily", "--offline", DAILY, "--now", "2026-10-19 09:00", "--json", "--no-write",
                             "--min-value", "0", "--min-price", "0"])
        self.assertEqual(code, 0)
        out = json.loads(text)
        self.assertEqual(len(out["hits"]), 15)
        self.assertEqual(out["note"], "A scan is a list of charts that match a rule, not a list of stocks to buy.")
        self.assertEqual(out["created_by"], "india-scanner")

    def test_no_em_dashes_in_the_script(self):
        with open(os.path.join(os.path.dirname(scan.__file__), "scan.py"), encoding="utf-8") as fh:
            self.assertNotIn(chr(0x2014), fh.read())


if __name__ == "__main__":
    unittest.main()
