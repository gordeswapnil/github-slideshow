"""The shared core: India time, the NSE calendar, ticks, symbols, rupees, costs."""
import datetime
import json
import os
import tempfile
import unittest

from _load import HERE
import importlib.util

spec = importlib.util.spec_from_file_location("india_core", os.path.join(HERE, "india_core.py"))
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class Time(unittest.TestCase):
    def test_naive_now_is_india_time(self):
        self.assertEqual(core.parse_now("2026-10-19 09:15"), datetime.datetime(2026, 10, 19, 3, 45))
        self.assertEqual(core.parse_now("2026-10-19T03:45:00Z"), datetime.datetime(2026, 10, 19, 3, 45))

    def test_no_daylight_saving(self):
        for month in (1, 4, 7, 11):
            utc = datetime.datetime(2026, month, 5, 3, 45)
            self.assertEqual(core.to_ist(utc).time(), datetime.time(9, 15))

    def test_bad_now(self):
        with self.assertRaises(core.CoreError):
            core.parse_now("monday morning")


class Calendar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.none = os.path.join(self.tmp, "absent.json")

    def test_sixteen_weekday_holidays_in_2026(self):
        self.assertEqual(len(core.NSE_HOLIDAYS), 16)
        for d in core.NSE_HOLIDAYS:
            self.assertLess(datetime.date.fromisoformat(d).weekday(), 5, d)

    def test_holiday_weekend_and_open(self):
        st = core.market_status(core.parse_now("2026-11-10 10:00"), self.none)
        self.assertFalse(st["open"])
        self.assertIn("Diwali", st["reason"])
        self.assertEqual(st["next_open"], "2026-11-11 09:15")
        st = core.market_status(core.parse_now("2026-11-14 10:00"), self.none)
        self.assertEqual(st["reason"], "weekend")
        st = core.market_status(core.parse_now("2026-11-11 10:00"), self.none)
        self.assertTrue(st["open"])

    def test_pre_open_and_close(self):
        self.assertEqual(core.market_status(core.parse_now("2026-11-11 09:05"), self.none)["reason"],
                         "pre-open call auction")
        self.assertEqual(core.market_status(core.parse_now("2026-11-11 15:30"), self.none)["reason"],
                         "after the close")

    def test_dussehra_skipped_for_next_open(self):
        st = core.market_status(core.parse_now("2026-10-19 16:00"), self.none)
        self.assertEqual(st["next_open"], "2026-10-21 09:15")

    def test_2027_unknown_until_the_user_adds_it(self):
        d = datetime.date(2027, 1, 26)
        self.assertFalse(core.calendar_known(d, self.none))
        self.assertTrue(core.trading_day(d, self.none)[0])
        p = os.path.join(self.tmp, "holidays.json")
        with open(p, "w") as fh:
            json.dump({"2027-01-26": "Republic Day"}, fh)
        self.assertTrue(core.calendar_known(d, p))
        self.assertEqual(core.trading_day(d, p), (False, "NSE holiday: Republic Day"))

    def test_auction_stocks_stop_at_1515_until_december(self):
        self.assertEqual(core.continuous_end(datetime.date(2026, 11, 11), True), datetime.time(15, 15))
        self.assertEqual(core.continuous_end(datetime.date(2026, 12, 7), True), datetime.time(15, 30))
        self.assertEqual(core.continuous_end(datetime.date(2026, 11, 11), False), datetime.time(15, 30))


class Ticks(unittest.TestCase):
    def test_slabs(self):
        cases = {99.99: "0.01", 249.99: "0.01", 250: "0.05", 999.99: "0.05", 1000: "0.10",
                 4999: "0.10", 5000: "0.50", 10000: "1.00", 20000: "5.00", 45000: "5.00"}
        for price, tick in cases.items():
            self.assertEqual(str(core.tick_size(price)), tick, price)

    def test_rounding(self):
        self.assertEqual(core.tick_down(364.18), 364.15)
        self.assertEqual(core.tick_up(364.18), 364.2)
        self.assertEqual(core.tick_down(2913.44), 2913.4)
        self.assertEqual(core.tick_up(12345.01), 12346.0)
        self.assertEqual(core.tick_down(358.3), 358.3)       # already on the grid


class Symbols(unittest.TestCase):
    def test_forms(self):
        for raw in ("reliance", "RELIANCE.NS", "NSE:RELIANCE", "RELIANCE-EQ", " Reliance "):
            self.assertEqual(core.norm_symbol(raw), "RELIANCE")
        self.assertEqual(core.yahoo_symbol("m&m"), "M&M.NS")
        self.assertEqual(core.yahoo_symbol("BAJAJ-AUTO"), "BAJAJ-AUTO.NS")
        self.assertEqual(core.from_yahoo("M&M.NS"), "M&M")

    def test_junk(self):
        for bad in ("", "RELI ANCE", "AAPL$", "A" * 21):
            with self.assertRaises(core.CoreError):
                core.norm_symbol(bad)


class Rupees(unittest.TestCase):
    def test_indian_grouping(self):
        self.assertEqual(core.inr(999), "₹999.00")
        self.assertEqual(core.inr(1000), "₹1,000.00")
        self.assertEqual(core.inr(123456.5), "₹1,23,456.50")
        self.assertEqual(core.inr(12345678.9), "₹1,23,45,678.90")
        self.assertEqual(core.inr(-1500, 0), "-₹1,500")
        self.assertEqual(core.inr(None), "n/a")


class Costs(unittest.TestCase):
    def test_round_trip(self):
        # 100 shares bought at 2,500 and sold at 2,520: buy 2,50,000, sell 2,52,000
        c = core.intraday_costs(100, 2500, 2520)
        self.assertEqual(c["brokerage"], 40.0)       # 0.03% of each side is over 20, so 20 + 20
        self.assertEqual(c["stt"], 63.0)             # 0.025% of 2,52,000
        self.assertEqual(c["stamp_duty"], 7.5)       # 0.003% of 2,50,000
        self.assertEqual(c["exchange"], 15.41)       # 0.00307% of 5,02,000 = 15.4114
        self.assertEqual(c["sebi"], 0.5)             # 10 per crore of 5,02,000 = 0.502
        self.assertEqual(c["gst"], 10.06)            # 18% of (40 + 15.4114 + 0.502)
        self.assertEqual(c["total"], 136.48)

    def test_small_order_pays_the_percentage(self):
        c = core.intraday_costs(8, 364.18, 370.04)   # 0.03% of 2,913 is under 20
        self.assertEqual(c["brokerage"], 1.76)
        self.assertLess(c["total"], 5)


class Fingerprint(unittest.TestCase):
    def test_notes_do_not_change_it_but_fields_do(self):
        o = {"symbol": "SYNTH", "side": "buy", "qty": 160, "price": 364.55, "why": "a", "plan": {}}
        same = dict(o, why="b", plan={"x": 1})
        self.assertEqual(core.fingerprint(o), core.fingerprint(same))
        self.assertNotEqual(core.fingerprint(o), core.fingerprint(dict(o, qty=161)))
        self.assertEqual(len(core.fingerprint(o)), 16)


if __name__ == "__main__":
    unittest.main()
