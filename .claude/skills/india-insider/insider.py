#!/usr/bin/env python3
"""Insider trades and big deals on NSE, for india-insider. Standard library only.

Two public data sets, both published by NSE after the trade:
  - Insider trades disclosed under SEBI's Prohibition of Insider Trading (PIT)
    regulations: promoters, directors and designated persons report their
    trades; NSE lists each filing and links its XBRL XML, which holds the rows.
  - Bulk and block deals: one client's large trades in one stock on one day.

    python3 insider.py pit --days 7                    # PIT filings of the last 7 days
    python3 insider.py pit --symbol SYNTH --read       # ...and the trades in each filing
    python3 insider.py deals --kind bulk               # the latest bulk deals file
    python3 insider.py deals --kind block --days 5     # block deals of the last 5 days
    python3 insider.py watch --read                    # only what is new since the last check
    python3 insider.py xml saved-filing.xml            # the trades in one saved PIT XML

Where the data comes from (NSE's own website; unofficial, undocumented endpoints):
  - PIT filings: https://www.nseindia.com/api/corporates-pit-gg?index=equities
    &from_date=DD-MM-YYYY&to_date=DD-MM-YYYY -> {"data": [{symbol, companyName,
    broadcastDateTime, typeOfSubmission, revisionRemark, appId, prevAppId,
    xmlFileName, ixbrl}, ...]}. The trade rows are in the XML at xmlFileName.
  - Deals: https://www.nseindia.com/api/historicalOR/bulk-block-short-deals
    ?optionType=bulk_deals|block_deals&from=DD-MM-YYYY&to=DD-MM-YYYY (365 days at
    most) -> {"data": [{BD_DT_DATE, BD_DT_ORDER, BD_SYMBOL, BD_SCRIP_NAME,
    BD_CLIENT_NAME, BD_BUY_SELL, BD_QTY_TRD, BD_TP_WATP, BD_REMARKS}, ...]}, and the
    latest day as CSV: https://nsearchives.nseindia.com/content/equities/bulk.csv
    (and block.csv, the same columns without Remarks).

NSE access: a cookie warm-up visit to https://www.nseindia.com/ first, a
browser-like User-Agent and Referer, and at least 1 s between requests. NSE's
bot protection can still answer 403 or never answer: the tool then stops and
says how to save the data in your own browser and pass it with --file PATH.
NSE's terms of use restrict automated collection of its data; see SKILL.md.

Formats: the field names above come from community projects, not from NSE
documentation, and were not tested live from here. Inside the PIT XML, only the
security counts, value, transaction type, holdings before and after and the
trade's from-date use element names seen in a community parser's notes on the
real files. The person, category, mode, to-date, intimation date and exchange
are looked up by names built the same way from SEBI's Form C headings, and the
output marks them unconfirmed.

State: watch remembers what it has shown in trader-india/state/insider.json, so
each filing or deal alerts once, and flags symbols in trader-india/watchlist.json
and trader-india/portfolio.json. Offline: --offline DIR reads saved responses
(pit.json, xml/<name>.xml, bulk.csv, block.csv, bulk_deals.json,
block_deals.json); the tests use it. Times are India time (IST).
"""

import argparse
import csv
import datetime as _dt
import gzip
import http.client
import http.cookiejar
import io
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib

# --- india core: begin (edit india-tests/india_core.py, then run sync_core.py)
import datetime as _core_dt
import json as _core_json
import os as _core_os
import re as _core_re
from decimal import Decimal as _CoreDec, ROUND_FLOOR as _CORE_FLOOR, ROUND_CEILING as _CORE_CEIL

IST_OFFSET = _core_dt.timedelta(hours=5, minutes=30)   # India has no daylight saving
DATA_DIR = "trader-india"
HOLIDAYS_FILE = _core_os.path.join(DATA_DIR, "holidays.json")

# NSE equity trading holidays, 2026 (circulars NSE/CMTR/71775 of 2025-12-12 and
# NSE/CMTR/72260 of 2026-01-12). Holidays that fall on a weekend are left out.
# NSE publishes the next year's list in December: add it to trader-india/holidays.json
# as {"2027-01-26": "Republic Day", ...} until this table is updated.
NSE_HOLIDAYS = {
    "2026-01-15": "Municipal Corporation elections (Maharashtra)",
    "2026-01-26": "Republic Day",
    "2026-03-03": "Holi",
    "2026-03-26": "Shri Ram Navami",
    "2026-03-31": "Shri Mahavir Jayanti",
    "2026-04-03": "Good Friday",
    "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
    "2026-05-01": "Maharashtra Day",
    "2026-05-28": "Bakri Id",
    "2026-06-26": "Muharram",
    "2026-09-14": "Ganesh Chaturthi",
    "2026-10-02": "Mahatma Gandhi Jayanti",
    "2026-10-20": "Dussehra",
    "2026-11-10": "Diwali Balipratipada",
    "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
    "2026-12-25": "Christmas",
}
CALENDAR_YEARS = (2026,)
OPEN = _core_dt.time(9, 15)       # normal market, IST
CLOSE = _core_dt.time(15, 30)
PRE_OPEN = _core_dt.time(9, 0)    # pre-open call auction 09:00-09:15
# 2026-08-03 to 2026-12-06: stocks in the closing auction session (the F&O stocks)
# stop continuous trading at 15:15. From 2026-12-07 every stock trades to 15:30.
AUCTION_EARLY_END = (_core_dt.date(2026, 8, 3), _core_dt.date(2026, 12, 6), _core_dt.time(15, 15))

# NSE tick size by price (circular NSE/CMTR/67133, from 2025-04-15). NSE sets each
# stock's tick monthly from its close on the last trading day of the previous
# month, so near a slab edge the live tick can differ: check the exchange.
TICK_SLABS = ((250, "0.01"), (1000, "0.05"), (5000, "0.10"), (10000, "0.50"), (20000, "1.00"), (None, "5.00"))

# Intraday equity charges on NSE (rates as published for 2026; check your contract note)
COSTS = {
    "stt_sell_pct": "0.025",      # securities transaction tax, sell side only
    "stamp_buy_pct": "0.003",     # stamp duty, buy side only
    "exchange_pct": "0.00307",    # NSE transaction charge incl. IPFT, each side (from 2026-03-01)
    "sebi_per_crore": "10",       # SEBI turnover fee, each side
    "gst_pct": "18",              # on brokerage + exchange charge + SEBI fee
}

SYMBOL_RE = _core_re.compile(r"^[A-Z0-9][A-Z0-9&-]{0,19}$")


class CoreError(Exception):
    pass


def to_ist(utc):
    return utc.replace(tzinfo=None) + IST_OFFSET


def ist_to_utc(local):
    return local.replace(tzinfo=None) - IST_OFFSET


def utc_now():
    return _core_dt.datetime.now(_core_dt.timezone.utc).replace(microsecond=0, tzinfo=None)


def parse_now(text):
    """ISO time -> naive UTC. A time without an offset is India time (IST)."""
    if not text:
        return utc_now()
    t = str(text).strip().replace("Z", "+00:00")
    try:
        dt = _core_dt.datetime.fromisoformat(t)
    except ValueError:
        raise CoreError('--now wants a time like "2026-10-19 10:15" (India time) or ...Z (UTC)')
    if dt.tzinfo is None:
        return ist_to_utc(dt)
    return (dt - dt.utcoffset()).replace(tzinfo=None)


def holidays(path=None):
    """NSE_HOLIDAYS plus any dates in trader-india/holidays.json."""
    out = dict(NSE_HOLIDAYS)
    p = path or HOLIDAYS_FILE
    if _core_os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as fh:
                extra = _core_json.load(fh)
        except (OSError, ValueError):
            raise CoreError("could not read %s: it should be {\"YYYY-MM-DD\": \"name\"}" % p)
        if isinstance(extra, dict):
            out.update({str(k): str(v) for k, v in extra.items()})
    return out


def calendar_known(d, path=None):
    """True when the holiday list covers d's year (built in, or added by the user)."""
    if d.year in CALENDAR_YEARS:
        return True
    return any(k.startswith("%d-" % d.year) for k in holidays(path))


def trading_day(d, path=None):
    """(is_trading_day, reason). Weekends and the NSE holiday list."""
    if d.weekday() >= 5:
        return False, "weekend"
    name = holidays(path).get(d.isoformat())
    if name:
        return False, "NSE holiday: " + name
    return True, ""


def session(d, path=None):
    """(open_time, close_time) in India time, or None if closed all day."""
    ok, _ = trading_day(d, path)
    return (OPEN, CLOSE) if ok else None


def continuous_end(d, auction_stock=False):
    """When continuous trading ends: 15:15 for closing-auction (F&O) stocks
    between 2026-08-03 and 2026-12-06, else 15:30."""
    a, b, t = AUCTION_EARLY_END
    if auction_stock and a <= d <= b:
        return t
    return CLOSE


def market_status(now_utc, path=None):
    local = to_ist(now_utc)
    d = local.date()
    ok, reason = trading_day(d, path)
    st = {"now_india": local.strftime("%Y-%m-%d %H:%M"), "date": d.isoformat(),
          "weekday": local.strftime("%A"), "calendar_known": calendar_known(d, path),
          "open": False, "reason": reason}
    s = session(d, path)
    if s:
        o, c = s
        st["opens"], st["closes"] = o.strftime("%H:%M"), c.strftime("%H:%M")
        if o <= local.time() < c:
            st["open"], st["reason"] = True, "normal market"
        elif PRE_OPEN <= local.time() < o:
            st["reason"] = "pre-open call auction"
        elif local.time() < o:
            st["reason"] = "before the pre-open"
        else:
            st["reason"] = "after the close"
    nd = d if (s and local.time() < s[0]) else d + _core_dt.timedelta(days=1)
    for _ in range(15):
        if session(nd, path):
            st["next_open"] = "%s %s" % (nd.isoformat(), OPEN.strftime("%H:%M"))
            break
        nd += _core_dt.timedelta(days=1)
    return st


def tick_size(price):
    """The NSE tick for a price, as a Decimal (see TICK_SLABS)."""
    p = _CoreDec(str(price))
    for edge, tick in TICK_SLABS:
        if edge is None or p < edge:
            return _CoreDec(tick)
    return _CoreDec(TICK_SLABS[-1][1])


def _to_tick(price, rounding, tick=None):
    p = _CoreDec(str(price))
    t = _CoreDec(str(tick)) if tick else tick_size(p)
    return float((p / t).to_integral_value(rounding=rounding) * t)


def tick_down(price, tick=None):
    """Round down to the tick (a long stop, a long target)."""
    return _to_tick(price, _CORE_FLOOR, tick)


def tick_up(price, tick=None):
    """Round up to the tick (a short stop, a buy entry trigger)."""
    return _to_tick(price, _CORE_CEIL, tick)


def norm_symbol(text):
    """'reliance', 'RELIANCE.NS', 'NSE:RELIANCE' -> 'RELIANCE'. Raises on junk."""
    s = str(text or "").strip().upper()
    if s.startswith("NSE:"):
        s = s[4:]
    if s.endswith(".NS"):
        s = s[:-3]
    if s.endswith("-EQ"):
        s = s[:-3]
    if not SYMBOL_RE.match(s):
        raise CoreError("%r is not an NSE symbol (letters, digits, & and -, like RELIANCE or M&M)" % text)
    return s


def yahoo_symbol(sym):
    """NSE symbol -> Yahoo Finance symbol: RELIANCE -> RELIANCE.NS."""
    return norm_symbol(sym) + ".NS"


def from_yahoo(ysym):
    s = str(ysym or "").upper()
    return s[:-3] if s.endswith(".NS") else s


def inr(x, decimals=2):
    """Rupees with Indian digit grouping: 123456.5 -> '₹1,23,456.50'."""
    if x is None:
        return "n/a"
    neg = x < 0
    s = "%.*f" % (decimals, abs(float(x)))
    whole, _, frac = s.partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return ("-" if neg else "") + "₹" + whole + ("." + frac if frac else "")


def intraday_costs(qty, buy_price, sell_price, brokerage_flat=20, brokerage_pct=0.03, rates=None):
    """Estimated charges for one round trip (one buy, one sell) of an NSE intraday
    equity trade. Brokerage per executed order is the lower of brokerage_flat and
    brokerage_pct % of the order value (the common discount-broker plan)."""
    r = dict(COSTS)
    r.update(rates or {})
    D = lambda v: _CoreDec(str(v))
    q = D(qty)
    buy, sell = q * D(buy_price), q * D(sell_price)
    hundred = D(100)

    def brok(value):
        pct = value * D(brokerage_pct) / hundred
        flat = D(brokerage_flat)
        return min(flat, pct) if brokerage_pct is not None else flat

    brokerage = brok(buy) + brok(sell)
    stt = sell * D(r["stt_sell_pct"]) / hundred
    stamp = buy * D(r["stamp_buy_pct"]) / hundred
    exch = (buy + sell) * D(r["exchange_pct"]) / hundred
    sebi = (buy + sell) * D(r["sebi_per_crore"]) / D(10000000)
    gst = (brokerage + exch + sebi) * D(r["gst_pct"]) / hundred
    total = brokerage + stt + stamp + exch + sebi + gst
    q2 = lambda v: float(v.quantize(_CoreDec("0.01")))
    return {"brokerage": q2(brokerage), "stt": q2(stt), "stamp_duty": q2(stamp),
            "exchange": q2(exch), "sebi": q2(sebi), "gst": q2(gst), "total": q2(total)}


# The fields of one order in trader-india/orders.json that decide what reaches the
# broker. india-risk records a verdict per fingerprint; india-broker only shows an
# order whose fingerprint passed today. "why" and "plan" are notes, not order fields.
ORDER_FIELDS = ("symbol", "exchange", "side", "qty", "order_type", "price", "trigger_price",
                "product", "validity", "stop_loss", "target", "bracket")


def fingerprint(order):
    """The exact order that was checked, as 16 hex characters."""
    import hashlib as _core_hashlib
    core = {k: order[k] for k in ORDER_FIELDS if k in order and order[k] is not None}
    blob = _core_json.dumps(core, sort_keys=True, separators=(",", ":"))
    return _core_hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]
# --- india core: end

NSE_HOME = "https://www.nseindia.com/"
PIT_PAGE = "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading"
PIT_URL = ("https://www.nseindia.com/api/corporates-pit-gg?index=equities"
           "&from_date=%s&to_date=%s")
DEALS_URL = ("https://www.nseindia.com/api/historicalOR/bulk-block-short-deals"
             "?optionType=%s_deals&from=%s&to=%s")
# The deals page's own address is not confirmed, so the deals Referer is the home page.
DEALS_REFERER = NSE_HOME
CSV_URL = "https://nsearchives.nseindia.com/content/equities/%s.csv"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
KINDS = ("bulk", "block")
MAX_DAYS = 365
KEEP_DAYS = 60
# SEBI PIT Regulation 7(2): 2 trading days for the insider to tell the company,
# 2 more for the company to tell the exchange (check the current rule).
DISCLOSE_TRADING_DAYS = 4

STATE_FILE = os.path.join(DATA_DIR, "state", "insider.json")
WATCHLIST_FILE = os.path.join(DATA_DIR, "watchlist.json")
PORTFOLIO_FILE = os.path.join(DATA_DIR, "portfolio.json")
XML_CACHE = os.path.join(DATA_DIR, "state", "pit-xml")

PIT_NOTE = ("Public disclosures under SEBI's insider-trading (PIT) rules, posted after the trade: "
            "the insider has 2 trading days to tell the company and the company 2 more to tell "
            "NSE. Not inside information, and not a real-time signal.")
DEALS_NOTE = ("Bulk and block deals are public, published by NSE after the trade. The client is "
              "the account named to the exchange, not always the final owner. Not inside "
              "information.")
UNCONFIRMED_NOTE = ("Person, category, mode, to-date, intimation date and exchange are read from "
                    "XML element names not confirmed against a real NSE file: check them in the "
                    "filing itself, or run `insider.py xml FILE --raw` to see every field.")


class InsiderError(Exception):
    pass


class NseError(InsiderError):
    """NSE did not hand over the data. The message carries the browser route."""


# ---------------------------------------------------------------- small helpers

EMPTY = {"", "-", "--", "null", "none", "na", "n.a.", "nil"}


def clean(v):
    """Whitespace-collapsed text, or None for NSE's blanks ('-', 'NA', '')."""
    if v is None:
        return None
    s = " ".join(str(v).split())
    return None if s.lower() in EMPTY else s


def sym(text):
    """An NSE symbol from the data, kept as given (upper case) if it is unusual."""
    s = clean(text)
    if not s:
        return None
    try:
        return norm_symbol(s)
    except CoreError:
        return s.upper()


def num(v):
    """'1,08,709' / '₹826.15' / 826.15 -> float, or None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[,\s₹]", "", str(v))
    if s.lower().startswith("rs."):
        s = s[3:]
    try:
        return float(s)
    except ValueError:
        return None


def whole(v):
    x = num(v)
    return int(round(x)) if x is not None else None


def count(n):
    """Shares with Indian grouping: 108709 -> '1,08,709'."""
    if n is None:
        return "?"
    return ("-" if n < 0 else "") + inr(abs(n), 0).replace("₹", "")


def crore(x):
    return "n/a" if x is None else "%s crore" % inr(x / 1e7)


MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
STAMP_RE = re.compile(r"^(\d{1,2})[-/ ]([A-Za-z]{3,9}|\d{1,2})[-/ ](\d{4})"
                      r"(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$")


def parse_stamp(text):
    """An NSE date or time stamp -> naive India-time datetime, or None.

    '10-Nov-2026 18:42:10', '01-DEC-2025', '10-11-2026 18:42' and
    '2026-11-10 18:42:10' are read as India time. ISO with an offset or Z
    ('2025-11-30T18:30:00.000+00:00', as BD_DT_ORDER) is converted to India time."""
    s = clean(text)
    if not s:
        return None
    m = STAMP_RE.match(s)
    if m:
        mon = m.group(2)
        month = int(mon) if mon.isdigit() else MONTHS.get(mon[:3].upper())
        try:
            return _dt.datetime(int(m.group(3)), month or 0, int(m.group(1)),
                                int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0))
        except ValueError:
            return None
    try:
        t = _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is not None:
        return to_ist((t - t.utcoffset()).replace(tzinfo=None))
    return t


def parse_day(text):
    t = parse_stamp(text)
    return t.date() if t else None


def iso_day(text):
    d = parse_day(text)
    return d.isoformat() if d else None


def ddmmyyyy(d):
    return d.strftime("%d-%m-%Y")


def window(today, days):
    if days is None or days < 1 or days > MAX_DAYS:
        raise InsiderError("--days must be 1 to %d (NSE's limit for one request)" % MAX_DAYS)
    return today - _dt.timedelta(days=days - 1), today


def trading_days_after(start, end):
    """NSE trading days after `start`, up to and including `end`."""
    if not start or not end or end < start or (end - start).days > 400:
        return None
    n, d = 0, start
    while d < end:
        d += _dt.timedelta(days=1)
        if trading_day(d)[0]:
            n += 1
    return n


def read_bytes(path):
    with open(path, "rb") as fh:
        return fh.read()


def read_json_file(path):
    try:
        return json.loads(read_bytes(path).decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise InsiderError("%s is not JSON (%s). Save NSE's answer as .json, or for deals the "
                           ".csv download." % (path, exc))


def ist_label(now_utc):
    return to_ist(now_utc).strftime("%Y-%m-%d %H:%M") + " India time"


# ---------------------------------------------------------------- NSE access

def browser_route(url, why):
    return ("NSE did not hand over the data (%s):\n  %s\n"
            "NSE's bot protection often blocks scripts. Get it with your own browser instead:\n"
            "  1. open https://www.nseindia.com/ (this sets NSE's cookies),\n"
            "  2. open the address above in the same browser and save what it shows\n"
            "     (Save Page As .json, or the .csv download),\n"
            "  3. run the same command again with --file PATH." % (why, url))


class _Fail(Exception):
    pass


class NseClient(object):
    """Cookie warm-up, browser-like headers, at least `gap` seconds between requests."""

    def __init__(self, timeout=20, gap=1.0, opener=None, sleep=time.sleep, clock=time.monotonic):
        self.jar = http.cookiejar.CookieJar()
        self.opener = opener or urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))
        self.timeout, self.gap, self.sleep, self.clock = timeout, gap, sleep, clock
        self.last = None
        self.warmed = False
        self.requests = []

    def _get(self, url, referer, accept):
        if self.last is not None:
            wait = self.gap - (self.clock() - self.last)
            if wait > 0:
                self.sleep(wait)
        req = urllib.request.Request(url, headers={
            "User-Agent": UA, "Accept": accept, "Accept-Language": "en-IN,en;q=0.9",
            "Accept-Encoding": "gzip, deflate", "Referer": referer, "Connection": "keep-alive"})
        self.requests.append(req)
        try:
            resp = self.opener.open(req, timeout=self.timeout)
            try:
                body = resp.read()
                enc = (resp.headers.get("Content-Encoding") or "").lower()
            finally:
                resp.close()
        except urllib.error.HTTPError as exc:
            raise _Fail("HTTP %s" % exc.code)
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, socket.timeout):
                raise _Fail("no answer in %d s" % self.timeout)
            raise _Fail("could not connect: %s" % exc.reason)
        except socket.timeout:
            raise _Fail("no answer in %d s" % self.timeout)
        except (OSError, http.client.HTTPException) as exc:
            raise _Fail("the connection failed: %s" % (exc or type(exc).__name__))
        finally:
            self.last = self.clock()
        return self._decode(body, enc)

    @staticmethod
    def _decode(body, enc):
        try:
            if enc == "gzip" or body[:2] == b"\x1f\x8b":
                return gzip.decompress(body)
            if enc == "deflate":
                try:
                    return zlib.decompress(body)
                except zlib.error:
                    return zlib.decompress(body, -zlib.MAX_WBITS)
        except (OSError, EOFError, zlib.error):
            raise _Fail("the answer was compressed and broken")
        if enc == "br":
            raise _Fail("the answer was brotli-compressed, which Python's standard library cannot read")
        return body

    def warm(self, url):
        if self.warmed:
            return
        try:
            self._get(NSE_HOME, NSE_HOME,
                      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        except _Fail as exc:
            raise NseError(browser_route(url, "the warm-up visit to www.nseindia.com failed: %s" % exc))
        self.warmed = True

    def get_json(self, url, referer):
        self.warm(url)
        try:
            body = self._get(url, referer, "application/json, text/plain, */*")
        except _Fail as exc:
            raise NseError(browser_route(url, str(exc)))
        try:
            return json.loads(body.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            raise NseError(browser_route(url, "the answer was not JSON, often the bot "
                                              "protection's page"))

    def get_bytes(self, url, referer, warm=True):
        if warm:
            self.warm(url)
        try:
            return self._get(url, referer, "text/csv,application/xml,text/plain,*/*")
        except _Fail as exc:
            raise NseError(browser_route(url, str(exc)))


def new_client():
    return NseClient()


class Net(object):
    """Creates the NSE client on first use, so offline and --file runs never touch it."""

    def __init__(self):
        self._client = None

    def __call__(self):
        if self._client is None:
            self._client = new_client()
        return self._client


# ---------------------------------------------------------------- PIT filings

def pit_rows(doc):
    """Filings from the PIT endpoint's JSON ({"data": [...]} or a bare list), newest first."""
    data = doc.get("data") if isinstance(doc, dict) else doc
    if not isinstance(data, list):
        raise InsiderError('not the PIT format: expected {"data": [...]} with appId, symbol, '
                           'broadcastDateTime, xmlFileName')
    rows = [r for r in data if isinstance(r, dict)]
    if rows and not any("appId" in r or "xmlFileName" in r for r in rows):
        raise InsiderError("not the PIT format: no appId or xmlFileName in the rows "
                           "(is this a deals file? use `deals --file`)")
    out = []
    for r in rows:
        stamp = parse_stamp(r.get("broadcastDateTime"))
        sub = clean(r.get("typeOfSubmission"))
        prev = clean(r.get("prevAppId"))
        if prev == "0":
            prev = None
        out.append({
            "app_id": clean(r.get("appId")),
            "symbol": sym(r.get("symbol")),
            "company": clean(r.get("companyName")),
            "broadcast": stamp.strftime("%Y-%m-%d %H:%M") if stamp else None,
            "broadcast_raw": clean(r.get("broadcastDateTime")),
            "submission": sub,
            "revision": bool(prev) or "revis" in (sub or "").lower(),
            "prev_app_id": prev,
            "revision_remark": clean(r.get("revisionRemark")),
            "xml_url": clean(r.get("xmlFileName")),
            "ixbrl_url": clean(r.get("ixbrl")),
        })
    out.sort(key=lambda f: (f["broadcast"] or "", f["app_id"] or ""), reverse=True)
    return out


def pit_in_window(rows, start, end):
    """Rows broadcast between start and end (dates, India time). Undated rows stay."""
    out = []
    for r in rows:
        d = parse_day(r["broadcast"])
        if d is None or start <= d <= end:
            out.append(r)
    return out


def pit_key(f):
    return "pit:%s" % (f.get("app_id") or "%s@%s" % (f.get("symbol"), f.get("broadcast_raw")))


def load_pit(net, today, days, file=None, offline=None):
    """(filings, where they came from)."""
    start, end = window(today, days)
    if file:
        return pit_rows(read_json_file(file)), file
    if offline:
        path = os.path.join(offline, "pit.json")
        if not os.path.isfile(path):
            raise InsiderError("offline: no %s" % path)
        return pit_in_window(pit_rows(read_json_file(path)), start, end), path
    url = PIT_URL % (ddmmyyyy(start), ddmmyyyy(end))
    return pit_rows(net().get_json(url, PIT_PAGE)), url


# ---------------------------------------------------------------- PIT XML

# Element local names seen in a community parser's notes on NSE's real PIT XBRL
# (the "Acquistion" misspelling is NSE's; the correct spelling is accepted too).
CONFIRMED = {
    "shares": ("SecuritiesAcquiredOrDisposedNumberOfSecurity",),
    "value": ("SecuritiesAcquiredOrDisposedValueOfSecurity",),
    "transaction_type": ("SecuritiesAcquiredOrDisposedTransactionType",),
    "pct_traded": ("SecuritiesAcquiredOrDisposedPercentageOfShareholding",),
    "held_before": ("SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity",),
    "pct_before": ("SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding",),
    "held_after": ("SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity",
                   "SecuritiesHeldPostAcquisitionOrDisposalNumberOfSecurity"),
    "pct_after": ("SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding",
                  "SecuritiesHeldPostAcquisitionOrDisposalPercentageOfShareholding"),
    "trade_from": ("DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate",),
}
# SEBI Form C headings written the same way. Plausible, never seen in a real file:
# the output marks every value found this way as unconfirmed.
UNCONFIRMED = {
    "person": ("NameOfThePerson", "NameOfPerson"),
    "category": ("CategoryOfPerson",),
    "mode": ("ModeOfAcquisitionOrDisposal",),
    "trade_to": ("DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate",),
    "intimated": ("DateOfIntimationToCompany",),
    "exchange": ("ExchangeOnWhichTheTradeWasExecuted",),
}
LOOSE = {
    "person": lambda n: "name" in n and "company" not in n and "exchange" not in n,
    "category": lambda n: "category" in n,
    "mode": lambda n: n.startswith("mode"),
    "trade_to": lambda n: n.endswith("todate") and ("acquisition" in n or "sale" in n),
    "intimated": lambda n: "intimation" in n,
    "exchange": lambda n: n.startswith("exchange"),
}
TRADE_KEYS = ("shares", "value", "transaction_type")
WRAPPER = re.compile(r"^disclosure\d+$", re.I)
SKIP_SUBTREES = {"context", "unit", "footnotelink"}


def _local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def xml_facts(data):
    """[(group, name, value)] for every leaf fact of a PIT XML, in file order.

    The group is the fact's contextRef (NSE's flat XBRL: contextRef="Disclosure1"),
    or the name of a <DisclosureN> wrapper element. Namespaces are ignored."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise InsiderError("the PIT file is not valid XML: %s" % exc)
    out = []

    def walk(el, group):
        name = _local(el.tag)
        if name.lower() in SKIP_SUBTREES:
            return
        kids = list(el)
        if kids:
            inner = name if WRAPPER.match(name) else group
            for k in kids:
                walk(k, inner)
            return
        text = " ".join("".join(el.itertext()).split())
        if text and name:
            out.append((el.get("contextRef") or group or "", name, text))

    walk(root, "")
    return out


def _find(pairs, key):
    names = CONFIRMED.get(key) or UNCONFIRMED.get(key)
    want = {n.lower() for n in names}
    for n, v in pairs:
        if n.lower() in want:
            return v
    loose = LOOSE.get(key)
    if loose:
        for n, v in pairs:
            if loose(n.lower()):
                return v
    return None


def side_of(text):
    t = (text or "").lower()
    if not t:
        return None
    if "revo" in t or "release" in t:
        return "pledge released"
    if "invo" in t:
        return "pledge invoked"
    if "pledge" in t:
        return "pledge created"
    if any(w in t for w in ("buy", "purchase", "acqui", "bought")):
        return "buy"
    if any(w in t for w in ("sell", "sale", "sold", "dispos")):
        return "sell"
    return "other"


def mode_of(text):
    t = (text or "").lower().replace("-", " ")
    if not t:
        return None
    if "esop" in t or "esos" in t or "employee" in t:
        return "ESOP"
    if "gift" in t:
        return "gift"
    if "inter se" in t or "interse" in t:
        return "inter-se transfer"
    if "pledge" in t or "invocation" in t or "revocation" in t:
        return "pledge"
    if "off market" in t or "offmarket" in t:
        return "off-market"
    if "block" in t:
        return "block deal"
    if "market" in t:
        return "market"
    if any(w in t for w in ("preferential", "allot", "rights", "bonus", "warrant", "conversion")):
        return "allotment"
    if "transmission" in t or "inherit" in t:
        return "transmission"
    return "other"


def signal_of(row):
    side, mode = row["side"], row["mode_kind"]
    cat = (row["category"] or "").lower()
    who = ("promoter" if "promoter" in cat else "director" if "director" in cat
           else "KMP" if ("kmp" in cat or "key managerial" in cat) else "insider")
    if side and side.startswith("pledge"):
        return "%s %s" % (who, side)
    if mode in ("ESOP", "gift", "inter-se transfer", "allotment", "transmission", "off-market"):
        return "not a market trade (%s)" % mode
    if side in ("buy", "sell"):
        verb = "buying" if side == "buy" else "selling"
        if mode in ("market", "block deal"):
            return "%s %s in the market" % (who, verb)
        return "%s %s, mode not given" % (who, verb) if mode is None else "%s %s (%s)" % (who, verb, mode)
    return None


def trade_row(pairs, filed=None, group=""):
    """One disclosure (a person's trade) from its facts."""
    g = lambda k: _find(pairs, k)
    shares, value = whole(g("shares")), num(g("value"))
    ttype, mode = g("transaction_type"), g("mode")
    row = {
        "group": group, "person": g("person"), "category": g("category"),
        "transaction_type": ttype, "side": side_of(ttype), "mode": mode, "mode_kind": mode_of(mode),
        "shares": shares, "value": value,
        "price": round(value / shares, 2) if value and shares else None,
        "pct_traded": g("pct_traded"),
        "held_before": whole(g("held_before")), "pct_before": g("pct_before"),
        "held_after": whole(g("held_after")), "pct_after": g("pct_after"),
        "trade_from": iso_day(g("trade_from")), "trade_to": iso_day(g("trade_to")),
        "intimated": iso_day(g("intimated")), "exchange": g("exchange"),
        "days_to_disclose": None, "trading_days_to_disclose": None, "slow": None,
        "calendar_known": True,
    }
    row["unconfirmed"] = [k for k in UNCONFIRMED if row.get(k) is not None]
    last = parse_day(row["trade_to"] or row["trade_from"])
    if filed and last:
        row["days_to_disclose"] = (filed - last).days
        td = trading_days_after(last, filed)
        row["trading_days_to_disclose"] = td
        row["slow"] = td is not None and td > DISCLOSE_TRADING_DAYS
        row["calendar_known"] = calendar_known(last) and calendar_known(filed)
    row["signal"] = signal_of(row)
    facts = {}
    for n, v in pairs:
        facts.setdefault(n, v)
    row["facts"] = facts
    return row


def parse_pit_xml(data, filed=None):
    """{"rows": [one per disclosure], "header": {...}} from a PIT XML.

    A disclosure is a context (or <DisclosureN> wrapper) holding a security
    count, a value or a transaction type; every other fact is header."""
    facts = xml_facts(data)
    groups, order = {}, []
    for grp, name, value in facts:
        if grp not in groups:
            groups[grp] = []
            order.append(grp)
        groups[grp].append((name, value))
    trade_names = {n.lower() for k in TRADE_KEYS for n in CONFIRMED[k]}
    rows_at = [g for g in order if any(n.lower() in trade_names for n, _ in groups[g])]
    header = {}
    for g in order:
        if g not in rows_at:
            for n, v in groups[g]:
                header.setdefault(n, v)
    return {"rows": [trade_row(groups[g], filed, g) for g in rows_at], "header": header}


SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")


def xml_name(url):
    base = os.path.basename(urllib.parse.urlparse(url).path) or "filing.xml"
    return SAFE_NAME.sub("_", base)


def filed_day(filing):
    return parse_day(filing.get("broadcast"))


def read_filing_xml(net, filing, offline=None, xml_dir=None, cache=XML_CACHE):
    """(parsed XML, where it was read). Looks in saved folders before NSE."""
    url = filing.get("xml_url")
    if not url:
        raise InsiderError("the filing has no XML link")
    name = xml_name(url)
    if offline:
        places = [os.path.join(offline, "xml", name)]
    else:
        places = []
        if xml_dir:
            places += [os.path.join(xml_dir, name), os.path.join(xml_dir, "xml", name)]
        if cache:
            places.append(os.path.join(cache, name))
    for p in places:
        if os.path.isfile(p):
            return parse_pit_xml(read_bytes(p), filed_day(filing)), p
    if offline:
        raise InsiderError("offline: no %s" % places[0])
    data = net().get_bytes(url, PIT_PAGE)
    try:
        rep = parse_pit_xml(data, filed_day(filing))
    except InsiderError:
        raise NseError(browser_route(url, "the answer was not the XML, often the bot "
                                          "protection's page"))
    if cache:
        os.makedirs(cache, exist_ok=True)
        with open(os.path.join(cache, name), "wb") as fh:
            fh.write(data)
    return rep, url


def read_xmls(net, filings, limit, offline=None, xml_dir=None, cache=XML_CACHE):
    """Attach "trades" (or "xml_error") to the first `limit` filings."""
    blocked = None
    for f in filings[:limit]:
        if blocked:
            f["xml_error"] = "skipped: NSE refused an earlier XML"
            continue
        try:
            rep, where = read_filing_xml(net, f, offline, xml_dir, cache)
            f["trades"], f["xml_read_from"] = rep["rows"], where
        except NseError as exc:
            f["xml_error"] = str(exc)
            blocked = exc
        except InsiderError as exc:
            f["xml_error"] = str(exc)
    return max(0, len(filings) - limit)


# ---------------------------------------------------------------- bulk and block deals

def make_deal(kind, day, symbol, name, client, side, qty, price, remarks):
    q, p = whole(qty), num(price)
    s = (clean(side) or "").lower()
    side = "buy" if s.startswith("b") else "sell" if s.startswith("s") else (s or None)
    return {"kind": kind, "date": day.isoformat() if day else None, "symbol": sym(symbol),
            "name": clean(name), "client": clean(client), "side": side, "qty": q, "price": p,
            "value": round(q * p, 2) if q is not None and p is not None else None,
            "remarks": clean(remarks)}


def deals_from_doc(doc, kind):
    """Deals from the historical endpoint's JSON ({"data": [{BD_...}, ...]})."""
    data = doc.get("data") if isinstance(doc, dict) else doc
    if not isinstance(data, list):
        raise InsiderError('not the deals format: expected {"data": [...]} with BD_SYMBOL, '
                           'BD_CLIENT_NAME, BD_BUY_SELL, BD_QTY_TRD, BD_TP_WATP')
    rows = [r for r in data if isinstance(r, dict)]
    if rows and not any("BD_SYMBOL" in r for r in rows):
        raise InsiderError("not the deals format: no BD_SYMBOL in the rows "
                           "(is this a PIT file? use `pit --file`)")
    out = []
    for r in rows:
        if not clean(r.get("BD_SYMBOL")):
            continue
        day = parse_day(r.get("BD_DT_DATE")) or parse_day(r.get("BD_DT_ORDER"))
        out.append(make_deal(kind, day, r.get("BD_SYMBOL"), r.get("BD_SCRIP_NAME"),
                             r.get("BD_CLIENT_NAME"), r.get("BD_BUY_SELL"), r.get("BD_QTY_TRD"),
                             r.get("BD_TP_WATP"), r.get("BD_REMARKS")))
    return out


CSV_COLUMNS = (("date", "date"), ("symbol", "symbol"), ("security", "name"),
               ("client", "client"), ("buy", "side"), ("quantity", "qty"),
               ("tradeprice", "price"), ("remarks", "remarks"))


def deals_from_csv(text, kind=None):
    """(deals, kind) from NSE's bulk.csv / block.csv. Kind None: Remarks column -> bulk."""
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None) or []
    cols = {}
    for i, h in enumerate(header):
        key = re.sub(r"[^a-z]", "", h.lower())
        for prefix, field in CSV_COLUMNS:
            if key.startswith(prefix) and field not in cols:
                cols[field] = i
    missing = [f for f in ("date", "symbol", "client", "side", "qty", "price") if f not in cols]
    if missing:
        raise InsiderError("not the NSE deals CSV: no %s column (header: %s)"
                           % (", ".join(missing), ", ".join(h.strip() for h in header) or "empty"))
    if kind is None:
        kind = "bulk" if "remarks" in cols else "block"
    out = []
    for row in reader:
        if not row or not any(c.strip() for c in row):
            continue
        cell = lambda f: row[cols[f]].strip() if f in cols and cols[f] < len(row) else None
        if not clean(cell("symbol")):
            continue
        out.append(make_deal(kind, parse_day(cell("date")), cell("symbol"), cell("name"),
                             cell("client"), cell("side"), cell("qty"), cell("price"),
                             cell("remarks")))
    return out, kind


def kind_from_name(name):
    base = os.path.basename(name or "").lower()
    for k in KINDS:
        if k in base:
            return k
    return None


def parse_deals_bytes(data, kind=None, name=""):
    """Deals from saved bytes: the API's JSON or the archive CSV."""
    text = data.decode("utf-8-sig", "replace")
    head = text.lstrip()[:1]
    if head in ("{", "["):
        try:
            doc = json.loads(text)
        except ValueError as exc:
            raise InsiderError("%s is not valid JSON: %s" % (name or "the deals file", exc))
        kind = kind or kind_from_name(name)
        rows = deals_from_doc(doc, kind or "?")
        if kind is None and rows:
            raise InsiderError("%s does not say bulk or block: add --kind bulk or --kind block "
                               "(watch: --file bulk=PATH)" % (name or "the JSON"))
        return rows
    if head == "<":
        raise InsiderError("%s is a web page, not the deals CSV or JSON" % (name or "the answer"))
    return deals_from_csv(text, kind or kind_from_name(name))[0]


def deals_in_window(rows, start, end):
    out = []
    for r in rows:
        d = parse_day(r["date"])
        if d is None or start <= d <= end:
            out.append(r)
    return out


def deal_key(d):
    return "%s:%s:%s:%s:%s:%s:%s" % (d["kind"], d["date"], d["symbol"], d["client"], d["side"],
                                     d["qty"], d["price"])


def tag_both_sides(deals):
    """Mark a client who bought and sold the same stock on the same day."""
    groups = {}
    for d in deals:
        groups.setdefault((d["kind"], d["date"], d["symbol"], d["client"]), []).append(d)
    for ds in groups.values():
        sides = {d["side"] for d in ds}
        if {"buy", "sell"} <= sides:
            net = sum((d["qty"] or 0) * (1 if d["side"] == "buy" else -1) for d in ds)
            for d in ds:
                d["both_sides"], d["net_qty"] = True, net
    return deals


def load_deals(net, kind, today, days, file=None, offline=None, source="auto"):
    """(deals, where they came from). One day: the archive CSV first, then the API."""
    start, end = window(today, days)
    if file:
        return parse_deals_bytes(read_bytes(file), kind, file), file
    use_csv = source == "csv" or (source == "auto" and days == 1)
    if offline:
        csv_path = os.path.join(offline, "%s.csv" % kind)
        api_path = os.path.join(offline, "%s_deals.json" % kind)
        if use_csv and os.path.isfile(csv_path):
            return parse_deals_bytes(read_bytes(csv_path), kind, csv_path), csv_path
        if source == "csv":
            raise InsiderError("offline: no %s" % csv_path)
        if not os.path.isfile(api_path):
            raise InsiderError("offline: no %s" % api_path)
        rows = parse_deals_bytes(read_bytes(api_path), kind, api_path)
        return deals_in_window(rows, start, end), api_path
    if use_csv:
        url = CSV_URL % kind
        try:
            return parse_deals_bytes(net().get_bytes(url, NSE_HOME, warm=False), kind, url), url
        except InsiderError:
            if source == "csv":
                raise
    url = DEALS_URL % (kind, ddmmyyyy(start), ddmmyyyy(end))
    rows = deals_from_doc(net().get_json(url, DEALS_REFERER), kind)
    return deals_in_window(rows, start, end), url


# ---------------------------------------------------------------- your lists

def _load_list_file(path, warnings):
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        warnings.append("could not read %s (%s): nothing from it is flagged" % (path, exc))
        return None


def _symbols_in(items):
    for it in items or []:
        if isinstance(it, dict):
            s = it.get("symbol") or it.get("ticker")
        else:
            s = it if isinstance(it, str) else None
        if s:
            try:
                yield norm_symbol(s)
            except CoreError:
                pass


def my_symbols(watchlist=WATCHLIST_FILE, portfolio=PORTFOLIO_FILE, warnings=None):
    """{symbol: "held" or "watchlist"}: your holdings win over the watchlist."""
    warnings = warnings if warnings is not None else []
    out = {}
    wl = _load_list_file(watchlist, warnings)
    if isinstance(wl, dict):
        items = wl.get("hits") or wl.get("symbols") or wl.get("watchlist") or []
    else:
        items = wl if isinstance(wl, list) else []
    for s in _symbols_in(items):
        out[s] = "watchlist"
    pf = _load_list_file(portfolio, warnings)
    if isinstance(pf, dict):
        for s in _symbols_in(pf.get("positions") or pf.get("holdings") or []):
            out[s] = "held"
    return out


def flag_text(symbol, flags):
    tag = flags.get(symbol)
    if tag == "held":
        return "  <- you hold %s" % symbol
    if tag == "watchlist":
        return "  <- %s is on your watchlist" % symbol
    return ""


def symbol_filter(values):
    return {norm_symbol(v) for v in values} if values else None


# ---------------------------------------------------------------- output

VERBS = {"buy": "bought", "sell": "sold", "pledge created": "pledged",
         "pledge released": "released a pledge on", "pledge invoked": "had a pledge invoked on"}


def describe_trade(r):
    """Two lines: what happened, then the holding before and after."""
    who = r["person"] or "(person not found in the XML)"
    if r["category"]:
        who += " (%s)" % r["category"]
    verb = VERBS.get(r["side"]) or ("%s:" % r["transaction_type"] if r["transaction_type"]
                                    else "traded")
    text = "%s %s %s shares" % (who, verb, count(r["shares"]))
    if r["value"] is not None:
        text += " worth %s" % inr(r["value"])
        if r["price"]:
            text += " (about %s a share)" % inr(r["price"])
    if r["mode"]:
        text += ", mode: %s" % r["mode"]
    if r["trade_from"]:
        text += ", %s %s" % ("dated" if (r["side"] or "").startswith("pledge") else "traded",
                             r["trade_from"])
        if r["trade_to"] and r["trade_to"] != r["trade_from"]:
            text += " to %s" % r["trade_to"]
    if r["trading_days_to_disclose"] is not None:
        text += ", on NSE %d trading days later" % r["trading_days_to_disclose"]
        if r["slow"]:
            text += " (more than the usual 2 + 2)"
    if r["signal"]:
        text = "%s: %s" % (r["signal"], text)
    lines = [text]
    if r["held_before"] is not None or r["held_after"] is not None:
        hold = "holds %s -> %s shares" % (count(r["held_before"]), count(r["held_after"]))
        if r["pct_before"] or r["pct_after"]:
            hold += " (%s -> %s, shareholding as filed)" % (r["pct_before"] or "?",
                                                            r["pct_after"] or "?")
        lines.append(hold)
    return lines


def render_filing(f, flags, prefix=""):
    when = ("%s IST" % f["broadcast"]) if f["broadcast"] else (
        "%s (as NSE gave it)" % (f["broadcast_raw"] or "time not given"))
    out = ["%s%s  %s  %s, %s, app %s%s" % (
        prefix, when, f["symbol"] or "?", f["company"] or "?", f["submission"] or "type not given",
        f["app_id"] or "?", flag_text(f["symbol"], flags))]
    if f["revision"]:
        rev = "    revision"
        if f["prev_app_id"]:
            rev += " of app %s" % f["prev_app_id"]
        if f["revision_remark"]:
            rev += ": %s" % f["revision_remark"]
        out.append(rev)
    if f["xml_url"]:
        out.append("    xml:   %s" % f["xml_url"])
    if f["ixbrl_url"]:
        out.append("    ixbrl: %s" % f["ixbrl_url"])
    for t in f.get("trades") or []:
        lines = describe_trade(t)
        out.append("    - " + lines[0])
        out.extend("      " + x for x in lines[1:])
    if "trades" in f and not f["trades"]:
        out.append("    - no disclosure rows found in the XML: open it, or run `insider.py xml "
                   "FILE --raw`")
    if f.get("xml_error"):
        out.append("    could not read the XML: %s" % f["xml_error"].replace("\n", "\n    "))
    return out


def render_deal(d, flags, prefix=""):
    out = ["%s%s  %-5s %-10s %-4s %s @ %s = %s (%s)  %s%s" % (
        prefix, d["date"] or "date ?", d["kind"].upper(), d["symbol"], (d["side"] or "?").upper(),
        count(d["qty"]), inr(d["price"]), inr(d["value"]), crore(d["value"]),
        d["client"] or "client ?", flag_text(d["symbol"], flags))]
    if d.get("both_sides"):
        out.append("      the same client bought and sold %s that day (net %s shares): often "
                   "arbitrage or market making, not a new holding"
                   % (d["symbol"], ("+" if d["net_qty"] > 0 else "") + count(d["net_qty"])))
    if d.get("remarks"):
        out.append("      remarks: %s" % d["remarks"])
    return out


def trades_of(filings):
    return [t for f in filings for t in f.get("trades") or []]


def notes_for(filings, out_err):
    """The unconfirmed-field note (stdout) and a calendar warning (stderr)."""
    trades = trades_of(filings)
    lines = []
    if any(t["unconfirmed"] for t in trades):
        lines.append(UNCONFIRMED_NOTE)
    if any(not t["calendar_known"] for t in trades):
        print("insider: NSE's holiday list for that year is not built in, so trading-day counts "
              "skip weekends only. Add %s as {\"2027-01-26\": \"Republic Day\", ...}."
              % HOLIDAYS_FILE, file=out_err)
    return lines


def dump(doc):
    print(json.dumps(doc, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------- commands

def _today(a):
    now = parse_now(a.now)
    return now, to_ist(now).date()


def cmd_pit(a):
    now, today = _today(a)
    net = Net()
    filings, source = load_pit(net, today, a.days, a.file, a.offline)
    only = symbol_filter(a.symbol)
    if only:
        filings = [f for f in filings if f["symbol"] in only]
    warnings = []
    flags = my_symbols(a.watchlist, a.portfolio, warnings)
    shown = filings[:a.limit] if a.limit else filings
    unread = 0
    if a.read:
        xml_dir = a.xml_dir or (os.path.dirname(os.path.abspath(a.file)) if a.file else None)
        unread = read_xmls(net, shown, a.read_limit, a.offline, xml_dir, a.xml_cache)
    for w in warnings:
        print("insider: %s" % w, file=sys.stderr)
    start, end = window(today, a.days)
    if a.json:
        dump({"source": source, "from": None if a.file else start.isoformat(),
              "to": None if a.file else end.isoformat(), "count": len(filings),
              "filings": shown, "note": PIT_NOTE})
        return 0 if filings else 1
    span = "from %s" % a.file if a.file else "%s to %s (India time)" % (start, end)
    print("SEBI PIT insider-trading filings on NSE, %s: %d" % (span, len(filings)))
    for f in shown:
        print("\n".join(render_filing(f, flags)))
    if len(shown) < len(filings):
        print("%d more not shown: --limit 0 shows all." % (len(filings) - len(shown)))
    if unread:
        print("XML read for the first %d only: raise --read-limit for more." % a.read_limit)
    if filings and not a.read:
        print("Add --read to open each filing's XML: who, promoter or director, buy, sell or "
              "pledge, shares, value.")
    for line in notes_for(shown, sys.stderr):
        print(line)
    print(PIT_NOTE)
    return 0 if filings else 1


def _deal_kinds(a):
    if a.kind in KINDS:
        return [a.kind]
    return [None] if a.file else list(KINDS)


def cmd_deals(a):
    now, today = _today(a)
    net = Net()
    deals, sources, errors = [], [], []
    for kind in _deal_kinds(a):
        try:
            rows, src = load_deals(net, kind, today, a.days, a.file, a.offline, a.source)
        except InsiderError as exc:
            errors.append(str(exc))
            continue
        deals += rows
        sources.append(src)
    for e in errors:
        print("insider: %s" % e, file=sys.stderr)
    if errors and not sources:
        return 2
    only = symbol_filter(a.symbol)
    if only:
        deals = [d for d in deals if d["symbol"] in only]
    if a.client:
        needle = a.client.lower()
        deals = [d for d in deals if needle in (d["client"] or "").lower()]
    tag_both_sides(deals)
    deals.sort(key=lambda d: (d["date"] or "", d["value"] or 0), reverse=True)
    flags = my_symbols(a.watchlist, a.portfolio)
    shown = deals[:a.limit] if a.limit else deals
    if a.json:
        dump({"sources": sources, "count": len(deals), "deals": shown, "note": DEALS_NOTE})
        return 0 if deals else 1
    kinds = [k for k in KINDS if any(d["kind"] == k for d in deals)] or \
        [k for k in _deal_kinds(a) if k]
    print("NSE %s deals, %s: %d" % (" and ".join(kinds) or "bulk/block",
                                    ", ".join(sources), len(deals)))
    for d in shown:
        print("\n".join(render_deal(d, flags)))
    if len(shown) < len(deals):
        print("%d more not shown: --limit 0 shows all." % (len(deals) - len(shown)))
    if not deals:
        print("No deals match.")
    print(DEALS_NOTE)
    return 0 if deals else 1


def classify_file(path):
    """The kind of a saved file for watch --file: pit, bulk or block."""
    data = read_bytes(path)
    text = data.decode("utf-8-sig", "replace").lstrip()
    if text[:1] in ("{", "["):
        try:
            doc = json.loads(text)
        except ValueError as exc:
            raise InsiderError("%s is not valid JSON: %s" % (path, exc))
        rows = doc.get("data") if isinstance(doc, dict) else doc
        rows = [r for r in rows or [] if isinstance(r, dict)] if isinstance(rows, list) else []
        if any("appId" in r or "xmlFileName" in r for r in rows):
            return "pit"
        k = kind_from_name(path)
        if k:
            return k
        raise InsiderError("cannot tell what %s holds: pass it as pit=PATH, bulk=PATH or "
                           "block=PATH" % path)
    return deals_from_csv(text, kind_from_name(path))[1]


def watch_files(values):
    out = {}
    for v in values or []:
        m = re.match(r"^(pit|bulk|block)=(.+)$", v)
        kind, path = (m.group(1), m.group(2)) if m else (None, v)
        if not os.path.isfile(path):
            raise InsiderError("no such file: %s" % path)
        out[kind or classify_file(path)] = path
    return out


def load_state(path):
    doc = {}
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except ValueError:
            raise InsiderError("%s is not valid JSON: fix it or delete it (it only remembers "
                               "what was already shown)" % path)
    if not isinstance(doc, dict):
        doc = {}
    seen = doc.get("seen")
    if isinstance(seen, list):
        seen = {k: None for k in seen}
    doc["seen"] = seen if isinstance(seen, dict) else {}
    doc.setdefault("last_check", None)
    return doc


def save_state(path, state):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
        fh.write("\n")


def _ranked(rows, flags, stamp):
    """Held first, then the watchlist, then the rest; newest first inside each."""
    rows = sorted(rows, key=lambda r: stamp(r) or "", reverse=True)
    return sorted(rows, key=lambda r: {"held": 0, "watchlist": 1}.get(flags.get(r["symbol"]), 2))


def cmd_watch(a):
    now, today = _today(a)
    net = Net()
    files = watch_files(a.file)
    kinds = [k.strip() for k in a.kinds.split(",") if k.strip()]
    for k in kinds:
        if k not in ("pit",) + KINDS:
            raise InsiderError("--kinds takes pit, bulk and block, not %r" % k)
    if files:
        kinds = [k for k in ("pit",) + KINDS if k in files]
    state = load_state(a.state)
    seen = state["seen"]
    warnings = []
    flags = my_symbols(a.watchlist, a.portfolio, warnings)
    only = symbol_filter(a.symbol)
    found, errors = {}, []
    for kind in kinds:
        try:
            if kind == "pit":
                rows, _ = load_pit(net, today, a.days, files.get("pit"), a.offline)
            else:
                rows, _ = load_deals(net, kind, today, a.deal_days, files.get(kind), a.offline)
        except InsiderError as exc:
            errors.append({"kind": kind, "error": str(exc)})
            continue
        if only:
            rows = [r for r in rows if r["symbol"] in only]
        if kind != "pit":
            tag_both_sides(rows)
        found[kind] = rows
    fresh, not_shown = {}, {}
    for kind, rows in found.items():
        key = pit_key if kind == "pit" else deal_key
        stamp = (lambda r: r["broadcast"]) if kind == "pit" else (lambda r: r["date"])
        new = _ranked([r for r in rows if key(r) not in seen], flags, stamp)
        mine = [r for r in new if r["symbol"] in flags]
        others = [] if a.mine else [r for r in new if r["symbol"] not in flags]
        cut = others[:a.limit] if a.limit else others
        fresh[kind] = mine + cut
        not_shown[kind] = len(new) - len(fresh[kind])
    unread = 0
    if a.read and fresh.get("pit"):
        xml_dir = a.xml_dir or (os.path.dirname(os.path.abspath(files["pit"]))
                                if files.get("pit") else None)
        unread = read_xmls(net, fresh["pit"], a.read_limit, a.offline, xml_dir, a.xml_cache)
    for w in warnings:
        print("insider: %s" % w, file=sys.stderr)
    for e in errors:
        print("insider: could not check %s: %s" % (e["kind"], e["error"]), file=sys.stderr)
    any_new = any(fresh.values())
    if a.json:
        dump({"checked_at": ist_label(now), "mine": flags, "new": fresh, "not_shown": not_shown,
              "errors": errors, "state": a.state, "dry_run": a.dry_run,
              "notes": {"pit": PIT_NOTE, "deals": DEALS_NOTE}})
    else:
        lists = ", ".join("%s (%s)" % (s, t) for s, t in sorted(flags.items()))
        print("Checked %s. %s" % (ist_label(now), "Flagging: " + lists if lists else
                                  "Nothing to flag: no %s or %s." % (a.watchlist, a.portfolio)))
        if not any_new:
            last = state.get("last_check")
            print("Nothing new since %s." % (ist_label(parse_now(last)) if last else
                                             "the last check"))
        titles = {"pit": "SEBI PIT insider filing", "bulk": "bulk deal", "block": "block deal"}
        for kind in kinds:
            rows = fresh.get(kind) or []
            if kind == "pit":
                for f in rows:
                    print("\n".join(render_filing(f, flags, "NEW %s: " % titles[kind])))
            else:
                for d in rows:
                    print("\n".join(render_deal(d, flags, "NEW %s: " % titles[kind])))
            if not_shown.get(kind):
                print("%d more new %ss not shown (%s): --limit 0 or --json shows all; they are "
                      "marked seen." % (not_shown[kind], titles[kind],
                                        "--mine" if a.mine else "not on your lists"))
        if unread:
            print("XML read for the first %d new filings only: raise --read-limit." % a.read_limit)
        if fresh.get("pit") and not a.read:
            print("Add --read to open the XML of the new filings.")
        for line in notes_for(fresh.get("pit") or [], sys.stderr):
            print(line)
        if fresh.get("pit"):
            print(PIT_NOTE)
        if fresh.get("bulk") or fresh.get("block"):
            print(DEALS_NOTE)
    if not a.dry_run and found:
        for kind, rows in found.items():
            key = pit_key if kind == "pit" else deal_key
            for r in rows:
                day = (r["broadcast"] or "")[:10] if kind == "pit" else r["date"]
                seen[key(r)] = day or today.isoformat()
        keep = (today - _dt.timedelta(days=max(KEEP_DAYS, a.days, a.deal_days) + 7)).isoformat()
        state["seen"] = {k: v for k, v in seen.items() if not v or v >= keep}
        state["last_check"] = now.isoformat() + "Z"
        save_state(a.state, state)
    if any_new:
        return 0
    return 2 if errors else 1


def cmd_xml(a):
    if re.match(r"^https?://", a.source):
        data = new_client().get_bytes(a.source, PIT_PAGE)
    else:
        data = read_bytes(a.source)
    filed = parse_day(a.filed) if a.filed else None
    if a.filed and not filed:
        raise InsiderError("--filed wants YYYY-MM-DD")
    rep = parse_pit_xml(data, filed)
    if a.json:
        dump({"source": a.source, "rows": rep["rows"], "header": rep["header"], "note": PIT_NOTE})
        return 0 if rep["rows"] else 1
    print("PIT disclosure XML %s: %d rows" % (a.source, len(rep["rows"])))
    for r in rep["rows"]:
        lines = describe_trade(r)
        print("  - " + lines[0])
        for x in lines[1:]:
            print("    " + x)
        if a.raw:
            print("    every field in %s:" % (r["group"] or "this disclosure"))
            for n, v in r["facts"].items():
                print("      %s = %s" % (n, v))
    if a.raw and rep["header"]:
        print("  header fields:")
        for n, v in rep["header"].items():
            print("    %s = %s" % (n, v))
    if not rep["rows"]:
        print("  no disclosure rows found: add --raw to see every field")
    for line in notes_for([{"trades": rep["rows"]}], sys.stderr):
        print(line)
    print(PIT_NOTE)
    return 0 if rep["rows"] else 1


# ---------------------------------------------------------------- CLI

def _parser():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd")

    def common(p, many_files=False):
        p.add_argument("--symbol", action="append", help="only this NSE symbol; repeat for more")
        if many_files:
            p.add_argument("--file", action="append", metavar="[KIND=]PATH",
                           help="a response saved in your browser (pit=, bulk= or block=); repeat")
        else:
            p.add_argument("--file", metavar="PATH",
                           help="a response saved in your own browser (JSON or CSV); skips NSE")
        p.add_argument("--offline", metavar="DIR",
                       help="saved responses: pit.json, xml/, bulk.csv, block.csv, "
                            "bulk_deals.json, block_deals.json")
        p.add_argument("--watchlist", default=WATCHLIST_FILE)
        p.add_argument("--portfolio", default=PORTFOLIO_FILE)
        p.add_argument("--now", help='"YYYY-MM-DD HH:MM" in India time, for reproducible runs')
        p.add_argument("--json", action="store_true")

    def xml_opts(p):
        p.add_argument("--read", action="store_true", help="also read each filing's XML")
        p.add_argument("--read-limit", type=int, default=10, help="XML files to read (default 10)")
        p.add_argument("--xml-dir", help="a folder of saved PIT XML files")
        p.add_argument("--xml-cache", default=XML_CACHE, help="where downloaded XML is kept")

    p = sub.add_parser("pit", help="SEBI PIT insider-trading filings")
    common(p)
    p.add_argument("--days", type=int, default=7, help="filings of the last N days (default 7)")
    p.add_argument("--limit", type=int, default=50, help="filings to show (0 = all)")
    xml_opts(p)

    p = sub.add_parser("deals", help="bulk and block deals")
    common(p)
    p.add_argument("--kind", choices=("bulk", "block", "both"),
                   help="default both (with --file: read from the file)")
    p.add_argument("--days", type=int, default=1,
                   help="1 = the latest day (archive CSV); more = the historical API, up to 365")
    p.add_argument("--source", choices=("auto", "csv", "api"), default="auto")
    p.add_argument("--client", help="only clients whose name contains this text")
    p.add_argument("--limit", type=int, default=50, help="deals to show (0 = all)")

    p = sub.add_parser("watch", help="only what is new since the last check")
    common(p, many_files=True)
    p.add_argument("--kinds", default="pit,bulk,block")
    p.add_argument("--days", type=int, default=7, help="PIT filings of the last N days (default 7)")
    p.add_argument("--deal-days", type=int, default=3, help="deals of the last N days (default 3)")
    p.add_argument("--limit", type=int, default=25,
                   help="new items per kind not on your lists to show (0 = all)")
    p.add_argument("--mine", action="store_true", help="show only symbols on your lists")
    p.add_argument("--state", default=STATE_FILE)
    p.add_argument("--dry-run", action="store_true", help="do not update the state file")
    xml_opts(p)

    p = sub.add_parser("xml", help="the trades in one PIT XML (a saved file or its URL)")
    p.add_argument("source")
    p.add_argument("--filed", help="the filing date YYYY-MM-DD, to count the disclosure delay")
    p.add_argument("--raw", action="store_true", help="also print every field")
    p.add_argument("--json", action="store_true")
    return ap


COMMANDS = {"pit": cmd_pit, "deals": cmd_deals, "watch": cmd_watch, "xml": cmd_xml}


def main(argv=None):
    ap = _parser()
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return COMMANDS[a.cmd](a)
    except (InsiderError, CoreError, OSError) as exc:
        print("insider: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
