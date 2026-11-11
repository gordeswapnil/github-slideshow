#!/usr/bin/env python3
"""News monitor for india-news. Standard library only.

Watches NSE corporate announcements and Yahoo Finance headlines for the NSE
stocks you watch or hold, and prints only what is new since the last check,
newest first, in India time, with how far each stock has moved today, a tag
on every item and a results-day warning when a board meeting on results is
today, soon, or has just happened.

    python3 news.py                                      # watchlist + plan + portfolio symbols
    python3 news.py --tickers RELIANCE TCS M&M
    python3 news.py --tickers SYNTH --all --hours 72     # everything in the last 3 days, seen or not
    python3 news.py --tickers SYNTH --file announcements.json   # JSON you saved from NSE in your browser
    python3 news.py --no-nse                             # headlines only
    python3 news.py --no-moves                           # skip the price line per symbol

Your symbols, when --tickers is not given: every hit in trader-india/watchlist.json
(india-scanner), the symbol in trader-india/plan.json (india-exit) and the
positions in trader-india/portfolio.json.

Sources, one request each per symbol, at least a second apart for NSE:
  - NSE corporate announcements (what the company filed with the exchange):
    https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=<SYMBOL>
    NSE wants a browser session: the tool loads https://www.nseindia.com/ once
    for its cookies first. NSE's bot protection often refuses scripts anyway
    (HTTP 403, or no answer): then the tool says so and you can open that URL
    in your own browser, save the JSON and pass it with --file PATH.
    NSE's terms of use restrict automated collection: keep checks occasional.
  - Yahoo Finance headline RSS for <SYMBOL>.NS (coverage of Indian stocks is
    patchy; an empty feed just means no Yahoo headlines):
    https://feeds.finance.yahoo.com/rss/2.0/headline?s=<SYMBOL>.NS&region=IN&lang=en-IN
  - The move: Yahoo Finance's chart endpoint (unofficial, delayed), the last
    price against the previous close:
    https://query2.finance.yahoo.com/v8/finance/chart/<SYMBOL>.NS?range=1d&interval=5m

Times print in India time (IST). State: trader-india/state/news.json remembers
what you have seen (by NSE seq_id or headline link, 30 days), so an item shows
once. Offline: --offline DIR reads nse-announcements-<SYMBOL>.json,
yahoo-<SYMBOL>.xml and chart-<SYMBOL>.json from DIR. The tests use it.

Filings and headlines are leads, not facts: open the filing before acting,
and treat nothing here as advice.
"""

import argparse
import datetime as _dt
import email.utils
import gzip
import http.client
import http.cookiejar
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
NSE_FILINGS_PAGE = "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
NSE_ANN = "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=%s"
YAHOO = "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%s&region=IN&lang=en-IN"
CHART = "https://%s.finance.yahoo.com/v8/finance/chart/%s?range=1d&interval=5m"
NSE_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
          "Chrome/124.0.0.0 Safari/537.36")
YAHOO_UA = "Mozilla/5.0 (compatible; india-news/1.0)"
EPOCH = _dt.datetime(1970, 1, 1)
KEEP_DAYS = 30
LOOKBACK_DAYS = 14   # NSE announcements asked for: board meeting notices come days ahead
MOVE_PCT = 3.0       # a stock this far from the previous close is flagged as moving
PRICE_BANDS = (5.0, 10.0, 20.0)
NSE_PAUSE = 1.0      # seconds between NSE requests, at least

# India-specific categories, read from the NSE subject (desc) and text
# (attchmntText), or a headline's title and summary. Order is the print order.
CATEGORIES = [
    ("results", r"financial results?|(?<!voting )\bresults?\b|\bearnings\b|net profit|revenue from operations"),
    ("board meeting", r"board meeting|meeting of the board|outcome of (?:the )?board|board of directors (?:will|shall) meet"),
    ("corporate action", r"\bdividend|\bbonus\b|stock split|\bsplit\b|sub-?division|\bbuy-?back\b|record date|\bex-date\b"),
    ("fund raising", r"\bQIP\b|qualified institutions? placement|rights issue|rights entitlement|"
                     r"preferential (?:issue|allotment)|fund[- ]?rais|raising (?:of )?funds|raise funds|"
                     r"non-convertible debentures?|\bNCDs?\b|\bwarrants\b|\bFPO\b|follow[- ]on public offer|"
                     r"commercial paper"),
    ("deal", r"acqui(?:re|res|red|ring|sition)|\bmerger\b|amalgamation|scheme of arrangement|de-?merger|"
             r"joint venture|takeover|divest|stake sale|slump sale|share purchase agreement|majority stake"),
    ("credit rating", r"credit rating|rating agency|ratings? (?:reaffirmed|revised|upgraded|downgraded|assigned|withdrawn)|"
                      r"\bCRISIL\b|\bICRA\b|CARE Ratings|India Ratings|Brickwork|Acuit|Infomerics"),
    ("auditor", r"\bauditors?\b|statutory audit|audit firm|qualified opinion|modified opinion|audit qualification"),
    ("management change", r"\bKMP\b|key managerial|change in (?:directorate|management)|\bCEO\b|\bCFO\b|\bMD\b|"
                          r"managing director|chief (?:executive|financial|operating) officer|whole[- ]?time director|"
                          r"independent director|company secretary|compliance officer|\bresign|\bappoint|cessation|"
                          r"steps? down|re-?designat"),
    ("pledge/encumbrance", r"\bpledge|encumbrance|invocation of|non-disposal undertaking"),
    ("insider/SAST", r"\bSAST\b|regulation 29\b|regulation 31\b|insider trading|\bPIT\b|regulation 7\s*\(2\)|"
                     r"open offer|promoter (?:group )?(?:buy|sell|acqui|purchas|sale)"),
    ("regulatory", r"\bSEBI\b[^.]{0,60}?\b(?:orders?\b(?!\s+to\b)|penalt|show[- ]cause|adjudicat|settlement|warning)|"
                   r"\bpenalt|show[- ]cause|adjudicat|litigation|\bcourt\b|tribunal|\bNCLT\b|\bNCLAT\b|arbitration|"
                   r"tax demand|demand (?:order|notice)|assessment order|enforcement directorate|\braids?\b|"
                   r"search (?:and|&) seizure|insolvency|\bCIRP\b|warning letter|\bprobe\b|investigation"),
    ("analyst/investor meet", r"\banalysts?\b|investors? meet|institutional investor|con(?:ference)?\.?\s*call|"
                              r"earnings call|investor presentation|investor day|roadshow"),
    ("clarification", r"clarification|clarif(?:y|ies|ied)|news verification|spurt in (?:volume|price)|"
                      r"(?:price|volume) movement|movement in (?:the )?(?:price|volume)"),
    ("circuit/surveillance", r"upper circuit|lower circuit|price band|\bASM\b|\bGSM\b|surveillance|"
                             r"trade[- ]for[- ]trade|\bT2T\b|suspension of trading|trading (?:suspended|halted)|"
                             r"\bhalt(?:s|ed)?\b"),
    ("analyst rating", r"\bupgrade[sd]?\b|\bdowngrade[sd]?\b|target price|price target|\boutperform\b|"
                       r"\bunderperform\b|\boverweight\b|\bunderweight\b|"
                       r"\b(?:buy|sell|hold|accumulate|reduce) rating\b|initiates? coverage"),
    ("macro", r"\bRBI\b|repo rate|monetary policy|\bMPC\b|\bSensex\b|\bNifty\b|\bFIIs?\b|\bFPIs?\b|\bDIIs?\b|"
              r"\bGDP\b|\bCPI\b|\bWPI\b|inflation|Union Budget|\brupee\b|crude oil|\bFed\b|\bFOMC\b|tariffs?"),
    ("routine", r"trading window|newspaper|share certificates?|regulation 74\s*\(5\)|compliance certificate|"
                r"investor complaints|\bESOP|\bESOS|employee stock option|change in (?:registrar|RTA)|"
                r"secretarial compliance|book closure|shareholders? meeting|\bAGM\b|\bEGM\b|postal ballot|"
                r"e-voting|voting results|scrutini[sz]er|annual report|business responsibility|\bBRSR\b|"
                r"statement of deviation|monitoring agency"),
]
# A filing whose subject is one of these is routine whatever its text mentions
# (a trading-window notice names the coming results; a newspaper copy names the meeting).
ROUTINE_SUBJECT = (r"trading window|newspaper|share certificates?|regulation 74\s*\(5\)|compliance certificate|"
                   r"investor complaints")
# What the "!" mark means: a filing in one of these categories can move the price.
IMPORTANT = {"results", "corporate action", "fund raising", "deal", "credit rating", "auditor",
             "management change", "pledge/encumbrance", "regulatory", "clarification",
             "circuit/surveillance"}
_SAST_NAME = re.compile(r"substantial acquisition of shares and takeovers?|takeover (?:code|regulations?)", re.I)
OUTCOME_RX = r"\boutcome\b|\bapproved\b|took on record|\badopted\b|integrated filing"
NOTICE_RX = r"to be held|will be held|is scheduled|scheduled to be held|prior intimation|\bintimation\b|to consider"
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
_DAYNAME = r"(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?"
_MEET = r"(?:held|scheduled|convened|meet)\s+on\s+" + _DAYNAME
MEETING_DATE_RX = [
    ("dmy_name", re.compile(_MEET + r"(\d{1,2})(?:st|nd|rd|th)?[\s/.-]*([A-Za-z]{3,9})[\s/.,-]*(\d{4})", re.I)),
    ("dmy_num", re.compile(_MEET + r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", re.I)),
    ("mdy_name", re.compile(_MEET + r"([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})", re.I)),
]


class NewsError(Exception):
    pass


class Blocked(NewsError):
    """NSE refused or did not answer: the user can save the JSON from a browser."""


# ---------------------------------------------------------------- inputs

def load_json(path):
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    return None


def _sym(text):
    try:
        return norm_symbol(text)
    except CoreError:
        return None


def watch_from_files(portfolio=os.path.join(DATA_DIR, "portfolio.json"),
                     watchlist=os.path.join(DATA_DIR, "watchlist.json"),
                     plan=os.path.join(DATA_DIR, "plan.json")):
    """{symbol: name or None}: the scanner's hits, the planned trade and your holdings."""
    out = {}
    wl = load_json(watchlist) or {}
    for h in wl.get("hits", []):
        sym = _sym(h.get("symbol") or h.get("ticker"))
        if sym:
            out[sym] = h.get("name")
    pl = load_json(plan) or {}
    sym = _sym(pl.get("symbol"))
    if sym:
        out.setdefault(sym, pl.get("name"))
    pf = load_json(portfolio) or {}
    for p in pf.get("positions", []):
        sym = _sym(p.get("symbol") or p.get("ticker"))
        if sym:
            out[sym] = p.get("name") or out.get(sym)
    return out


def clean_name(name):
    """'SYNTH Industries Limited' -> 'SYNTH Industries' (for spotting it in headlines)."""
    n = re.sub(r"\s+(?:limited|ltd\.?)\s*$", "", str(name or "").strip(), flags=re.I)
    return n or None


# ---------------------------------------------------------------- fetching

def nse_url(sym, start=None, end=None):
    url = NSE_ANN % urllib.parse.quote(norm_symbol(sym), safe="")
    if start and end:
        url += "&from_date=%s&to_date=%s" % (start.strftime("%d-%m-%Y"), end.strftime("%d-%m-%Y"))
    return url


def yahoo_rss_url(sym):
    return YAHOO % urllib.parse.quote(yahoo_symbol(sym), safe="")


def chart_url(sym, host="query2"):
    return CHART % (host, urllib.parse.quote(yahoo_symbol(sym), safe=""))


def nse_help(url, why):
    return ("%s. NSE's bot protection often refuses scripts. Open %s in your own browser "
            "(load https://www.nseindia.com/ first), save what it shows as a .json file and run "
            "again with --file PATH" % (why, url))


class Fetcher(object):
    def __init__(self, offline=None, pause=0.3, nse_pause=NSE_PAUSE, timeout=20):
        self.offline = offline
        self.pause = pause
        self.nse_pause = max(float(nse_pause), NSE_PAUSE)
        self.timeout = timeout
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.warmed = False
        self._last = {}

    def _offline(self, name):
        path = os.path.join(self.offline, name)
        if not os.path.isfile(path):
            raise NewsError("offline: no file %s" % path)
        with open(path, "rb") as fh:
            return fh.read()

    def _open(self, url, headers, gap):
        host = urllib.parse.urlsplit(url).netloc
        wait = gap - (time.time() - self._last.get(host, 0.0))
        if wait > 0:
            time.sleep(wait)
        self._last[host] = time.time()
        req = urllib.request.Request(url, headers=headers)
        with self.opener.open(req, timeout=self.timeout) as resp:
            data = resp.read()
            enc = (resp.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip":
            data = gzip.decompress(data)
        elif enc == "deflate":
            try:
                data = zlib.decompress(data)
            except zlib.error:
                data = zlib.decompress(data, -zlib.MAX_WBITS)
        return data

    def get(self, url, name):
        """Yahoo feeds and charts."""
        if self.offline:
            return self._offline(name)
        try:
            return self._open(url, {"User-Agent": YAHOO_UA, "Accept-Encoding": "gzip"}, self.pause)
        except urllib.error.HTTPError as exc:
            raise NewsError("HTTP %s for %s" % (exc.code, url))
        except urllib.error.URLError as exc:
            raise NewsError("could not reach %s: %s" % (url, exc.reason))
        except (OSError, http.client.HTTPException) as exc:
            raise NewsError("could not read %s: %s" % (url, exc))

    def nse_json(self, url, name):
        """One NSE API call, after a single cookie warm-up on the home page."""
        if self.offline:
            data = self._offline(name)
            try:
                return json.loads(data.decode("utf-8-sig"))
            except ValueError:
                raise NewsError("%s is not JSON" % name)
        headers = {"User-Agent": NSE_UA, "Accept": "application/json, text/plain, */*",
                   "Accept-Language": "en-IN,en;q=0.9", "Accept-Encoding": "gzip, deflate",
                   "Referer": NSE_FILINGS_PAGE}
        try:
            if not self.warmed:
                self._open(NSE_HOME, dict(headers, Accept="text/html,application/xhtml+xml,*/*;q=0.8"),
                           self.nse_pause)
                self.warmed = True
            data = self._open(url, headers, self.nse_pause)
        except urllib.error.HTTPError as exc:
            raise Blocked(nse_help(url, "NSE answered HTTP %s" % exc.code))
        except urllib.error.URLError as exc:
            raise Blocked(nse_help(url, "could not reach NSE (%s)" % exc.reason))
        except (OSError, http.client.HTTPException) as exc:
            raise Blocked(nse_help(url, "NSE did not answer (%s)" % (str(exc) or exc.__class__.__name__)))
        try:
            return json.loads(data.decode("utf-8-sig"))
        except ValueError:
            raise Blocked(nse_help(url, "NSE sent a page that is not JSON (its bot check)"))


def records_of(doc, where):
    """The list of announcement records in an NSE response or a saved file."""
    if isinstance(doc, dict) and isinstance(doc.get("data"), list):
        doc = doc["data"]
    if not isinstance(doc, list):
        raise NewsError("%s is not a list of NSE announcements" % where)
    return [r for r in doc if isinstance(r, dict)]


def load_files(paths):
    out = []
    for p in paths:
        try:
            with open(p, encoding="utf-8-sig") as fh:
                doc = json.load(fh)
        except OSError as exc:
            raise NewsError("could not read %s: %s" % (p, exc))
        except ValueError:
            raise NewsError("%s is not JSON. Save the API URL's page itself (it starts with [ ), "
                            "not the NSE web page around it" % p)
        out += records_of(doc, p)
    return out


# ---------------------------------------------------------------- parsing

def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _text(el, name):
    for c in el.iter():
        if _local(c.tag) == name:
            return (c.text or "").strip()
    return ""


def parse_time(value):
    """RFC 822 (RSS) or ISO 8601 -> naive UTC datetime, or None."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        d = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        d = None
    if d is None:
        try:
            d = _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is not None:
        d = (d - d.utcoffset()).replace(tzinfo=None)
    return d


NSE_TIME_FIELDS = (("sort_date", "%Y-%m-%d %H:%M:%S"), ("an_dt", "%d-%b-%Y %H:%M:%S"),
                   ("dt", "%d%m%Y%H%M%S"), ("exchdisstime", "%d-%b-%Y %H:%M:%S"))


def nse_time(rec):
    """An announcement's India time (sort_date, an_dt, dt or exchdisstime) -> naive UTC."""
    for key, fmt in NSE_TIME_FIELDS:
        v = rec.get(key)
        if not v:
            continue
        try:
            return ist_to_utc(_dt.datetime.strptime(str(v).strip(), fmt))
        except ValueError:
            continue
    return None


def parse_announcements(records, symbol=None):
    """NSE corporate announcements -> items (only `symbol`'s, when given)."""
    out = []
    for r in records:
        sym = _sym(r.get("symbol"))
        if not sym or (symbol and sym != symbol):
            continue
        desc = re.sub(r"\s+", " ", str(r.get("desc") or "")).strip() or "Announcement"
        text = re.sub(r"\s+", " ", str(r.get("attchmntText") or "")).strip()
        pdf = str(r.get("attchmntFile") or "").strip()
        if not pdf.startswith("http"):
            pdf = ""
        seq = str(r.get("seq_id") or "").strip()
        key = seq or pdf or "%s|%s|%s" % (sym, r.get("dt") or r.get("an_dt"), desc)
        out.append({"id": "nse:" + key, "source": "NSE", "kind": "filing", "ticker": sym,
                    "title": desc, "summary": text, "link": pdf or NSE_FILINGS_PAGE,
                    "time": nse_time(r), "company": r.get("sm_name"), "seq_id": seq or None})
    return out


def parse_rss(data, sym):
    """Yahoo headline RSS -> items. An empty feed is an empty list."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise NewsError("RSS for %s is not valid XML: %s" % (sym, exc))
    out = []
    for it in root.iter("item"):
        link = _text(it, "link")
        guid = _text(it, "guid")
        out.append({"id": "rss:" + (link or guid), "source": "Yahoo Finance", "kind": "headline",
                    "ticker": sym, "title": _text(it, "title"), "summary": _text(it, "description"),
                    "link": link, "time": parse_time(_text(it, "pubDate"))})
    return out


def parse_chart(data, sym):
    """Yahoo chart JSON -> {"ticker", "price", "prev_close", "pct", "time"} or raise."""
    try:
        doc = json.loads(data.decode("utf-8") if isinstance(data, bytes) else data)
        meta = doc["chart"]["result"][0]["meta"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise NewsError("chart for %s is not usable" % sym)
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    if not price or not prev:
        raise NewsError("chart for %s has no price" % sym)
    when = meta.get("regularMarketTime")
    return {"ticker": sym, "price": round(float(price), 2), "prev_close": round(float(prev), 2),
            "pct": round((float(price) / float(prev) - 1) * 100, 2),
            "time": EPOCH + _dt.timedelta(seconds=int(when)) if when else None}


def collect_moves(fetcher, watch, errors=None):
    errors = [] if errors is None else errors
    out = []
    for t in sorted(watch):
        name = "chart-%s.json" % t
        try:
            try:
                data = fetcher.get(chart_url(t, "query2"), name)
            except NewsError as exc:
                if fetcher.offline or not re.search(r"HTTP (429|5\d\d)", str(exc)):
                    raise
                data = fetcher.get(chart_url(t, "query1"), name)
            out.append(parse_chart(data, t))
        except NewsError as exc:
            if not (fetcher.offline and "no file" in str(exc)):
                errors.append("price for %s: %s" % (t, exc))
    return out


# ---------------------------------------------------------------- tagging

def categorise(subject, text=""):
    """Category tags for one item: its subject (NSE desc or headline title) and text."""
    hay = _SAST_NAME.sub("SAST", "%s %s" % (subject or "", text or ""))
    if re.search(ROUTINE_SUBJECT, subject or "", re.I):
        return ["routine"]
    tags = [label for label, rx in CATEGORIES if re.search(rx, hay, re.I)]
    if "credit rating" in tags and "analyst rating" in tags:
        tags.remove("analyst rating")
    if "routine" in tags and len(tags) > 1:
        tags.remove("routine")   # routine means nothing else to see
    return tags


def mention_patterns(watch):
    pats = {}
    for t, name in watch.items():
        e = re.escape(t)
        alts = [r"\(%s\)" % e, r"\bNSE\s*:\s*%s(?![\w&-])" % e, r"(?<![\w&-])%s\.NS\b" % e]
        name = clean_name(name)
        if name and len(name) >= 4:
            alts.append(r"\b%s\b" % re.escape(name).replace(r"\ ", r"[\s-]"))
        pats[t] = re.compile("|".join(alts))
    return pats


def tag(items, watch):
    """Which of your symbols each item touches, its categories, and the '!' mark."""
    pats = mention_patterns(watch)
    for it in items:
        hay = "%s %s" % (it["title"], it.get("summary") or "")
        touches = {it["ticker"]} if it["ticker"] in watch else set()
        for t, rx in pats.items():
            if rx.search(hay):
                touches.add(t)
        it["touches"] = sorted(touches)
        it["tags"] = categorise(it["title"], it.get("summary"))
        it["important"] = it["kind"] == "filing" and bool(set(it["tags"]) & IMPORTANT)
    return items


def dedupe(items):
    """One item per story: same id, or same link, or same title the same day."""
    seen, out = {}, []
    for it in items:
        keys = [it["id"], it["link"] if it["link"] != NSE_FILINGS_PAGE else "",
                "%s|%s|%s" % (it["ticker"] if it["kind"] == "filing" else "",
                              re.sub(r"\W+", " ", it["title"].lower()).strip(),
                              it["time"].date() if it["time"] else "")]
        if it["kind"] == "filing":
            keys[2] += "|" + (it.get("summary") or "")
        hit = next((seen[k] for k in keys if k and k in seen), None)
        if hit is not None:
            for t in it.get("touches", []):
                if t not in hit["touches"]:
                    hit["touches"].append(t)
            hit["touches"].sort()
            continue
        for k in keys:
            if k:
                seen[k] = it
        out.append(it)
    return out


# ---------------------------------------------------------------- results-day risk

def meeting_date(text):
    """The date in 'Board Meeting to be held on 21-Oct-2026 ...' (several spellings), or None."""
    for kind, rx in MEETING_DATE_RX:
        m = rx.search(text or "")
        if not m:
            continue
        try:
            if kind == "dmy_num":
                return _dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            if kind == "dmy_name":
                day, mon, year = m.group(1), m.group(2), m.group(3)
            else:
                mon, day, year = m.group(1), m.group(2), m.group(3)
            mon = mon.lower()
            if mon[:3] not in MONTHS:
                continue
            return _dt.date(int(year), MONTHS.index(mon[:3]) + 1, int(day))
        except ValueError:
            continue
    return None


def results_event(it):
    """For an NSE filing about results: ("out", None) when results were published,
    ("meeting", date or None) when it gives notice of the board meeting; else None."""
    if it["kind"] != "filing" or "results" not in it.get("tags", []):
        return None
    hay = "%s %s" % (it["title"], it.get("summary") or "")
    if re.search(OUTCOME_RX, hay, re.I):
        return ("out", None)
    if re.search(NOTICE_RX, hay, re.I) or "board meeting" in it.get("tags", []):
        return ("meeting", meeting_date(hay))
    return ("out", None)


def _step_trading_day(d, step):
    x = d + _dt.timedelta(days=step)
    for _ in range(20):
        if trading_day(x)[0]:
            return x
        x += _dt.timedelta(days=step)
    return x


def trading_days_until(today, d):
    """Trading days after today, up to and including d."""
    n, x = 0, today
    while x < d and n < 60:
        x += _dt.timedelta(days=1)
        if trading_day(x)[0]:
            n += 1
    return n


def _posted(it):
    return "NSE: %s, posted %s IST" % (it["title"], to_ist(it["time"]).strftime("%Y-%m-%d %H:%M"))


def results_risk(items, watch, now):
    """One warning per symbol when results are out, due today, or due soon."""
    local = to_ist(now)
    today = local.date()
    since = ist_to_utc(_dt.datetime.combine(_step_trading_day(today, -1), CLOSE))
    ahead = now + _dt.timedelta(minutes=10)
    out = []
    for sym in sorted(watch):
        released, meetings = [], []
        for it in items:
            if it["ticker"] != sym or it["time"] is None or it["time"] > ahead:
                continue
            ev = results_event(it)
            if not ev:
                continue
            if ev[0] == "out":
                if it["time"] >= since:
                    released.append(it)
            else:
                meetings.append((ev[1], it))
        if released:
            it = max(released, key=lambda i: i["time"])
            when = to_ist(it["time"])
            during = (when.date() == today and trading_day(today)[0] and OPEN <= when.time() < CLOSE)
            where = ("during market hours today" if during
                     else "outside market hours: the next open can gap")
            out.append({"symbol": sym, "level": "out", "date": when.date().isoformat(), "id": it["id"],
                        "message": "RESULTS OUT    %s: results posted to NSE at %s IST, %s. Expect bigger, "
                                   "faster swings and wider spreads than usual. (%s)" % (
                                       sym, when.strftime("%Y-%m-%d %H:%M"), where, _posted(it))})
            continue
        dated = sorted(((d, it) for d, it in meetings if d is not None and d >= today),
                       key=lambda p: (p[0], p[1]["time"]))
        undated = [it for d, it in meetings
                   if d is None and it["time"] >= now - _dt.timedelta(days=LOOKBACK_DAYS)]
        if dated:
            d, it = dated[0]
            if d == today:
                out.append({"symbol": sym, "level": "today", "date": d.isoformat(), "id": it["id"],
                            "message": "RESULTS TODAY  %s: the board meets on results today (%s). Results "
                                       "can come out during market hours and the price can jump straight "
                                       "through a stop. (%s)" % (sym, d.isoformat(), _posted(it))})
                continue
            n = trading_days_until(today, d)
            if not trading_day(d)[0]:
                when = "a non-trading day (%s): the next open can gap" % trading_day(d)[1]
            elif n == 1:
                when = "the next trading day"
            else:
                when = "%d trading days away" % n
            out.append({"symbol": sym, "level": "soon", "date": d.isoformat(), "id": it["id"],
                        "message": "RESULTS SOON   %s: the board meets on results on %s (%s), %s. Anything "
                                   "held overnight is exposed to it; a day trade closed today is not. (%s)" % (
                                       sym, d.isoformat(), d.strftime("%A"), when, _posted(it))})
        elif undated:
            it = max(undated, key=lambda i: i["time"])
            out.append({"symbol": sym, "level": "soon", "date": None, "id": it["id"],
                        "message": "RESULTS SOON   %s: a board meeting on results is scheduled, but the date "
                                   "could not be read: open the filing. (%s)" % (sym, _posted(it))})
    return out


# ---------------------------------------------------------------- the check

def collect(fetcher, watch, now, nse=True, yahoo=True, files=None, errors=None, info=None):
    errors = [] if errors is None else errors
    info = [] if info is None else info
    items = []
    if nse:
        if files:
            records = load_files(files)
            for sym in sorted(watch):
                items += parse_announcements(records, sym)
        else:
            today = to_ist(now).date()
            start = today - _dt.timedelta(days=LOOKBACK_DAYS)
            blocked, skipped = False, []
            for sym in sorted(watch):
                if blocked:
                    skipped.append(sym)
                    continue
                url = nse_url(sym, start, today)
                try:
                    doc = fetcher.nse_json(url, "nse-announcements-%s.json" % sym)
                    items += parse_announcements(records_of(doc, url), sym)
                except Blocked as exc:
                    blocked = True
                    errors.append("NSE filings for %s: %s" % (sym, exc))
                except NewsError as exc:
                    errors.append("NSE filings for %s: %s" % (sym, exc))
            if skipped:
                errors.append("NSE filings not asked for %s after that refusal (one try per run)"
                              % ", ".join(skipped))
    for it in items:
        if it["ticker"] in watch and not watch[it["ticker"]] and it.get("company"):
            watch[it["ticker"]] = clean_name(it["company"])
    if yahoo:
        for sym in sorted(watch):
            try:
                got = parse_rss(fetcher.get(yahoo_rss_url(sym), "yahoo-%s.xml" % sym), sym)
            except NewsError as exc:
                errors.append("headlines for %s: %s" % (sym, exc))
                continue
            if not got:
                info.append("%s: no Yahoo headlines (Yahoo's coverage of NSE stocks is patchy; "
                            "NSE filings are the primary source)" % sym)
            items += got
    return items


def select(items, state, now, hours=48, show_all=False):
    """Items within the window; only unseen ones unless show_all."""
    seen = state.setdefault("seen", {})
    cutoff = now - _dt.timedelta(hours=hours)
    ahead = now + _dt.timedelta(minutes=10)  # a pinned --now: nothing from after it
    out = []
    for it in items:
        if it["time"] is not None and (it["time"] < cutoff or it["time"] > ahead):
            continue
        it["new"] = it["id"] not in seen
        if it["new"] or show_all:
            out.append(it)
    out.sort(key=lambda i: (i["time"] or now), reverse=True)
    return out


def _stamp(now):
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


def remember(items, state, now, hours=48):
    """Mark what this check could show as seen (by NSE seq_id or headline link)."""
    seen = state.setdefault("seen", {})
    stamp = _stamp(now)
    ahead = now + _dt.timedelta(minutes=10)
    for it in items:
        if it["time"] is not None and it["time"] > ahead:
            continue   # published after a pinned clock: still new later
        seen.setdefault(it["id"], stamp)
    cutoff = _stamp(now - _dt.timedelta(days=KEEP_DAYS))
    state["seen"] = {k: v for k, v in seen.items() if v >= cutoff}
    state["last_check"] = stamp


def band_hint(pct):
    """'near the 10% price band?' when a move sits close to a common NSE band."""
    for b in PRICE_BANDS:
        if b - 0.3 <= abs(pct) <= b + 0.05:
            return "near a %d%% price band? check NSE" % b
    return ""


def render_market(now):
    st = market_status(now)
    line = "NSE %s (%s), %s IST: " % (st["date"], st["weekday"], to_ist(now).strftime("%H:%M"))
    if st["open"]:
        line += "normal market until %s." % st["closes"]
    else:
        line += "closed (%s)." % st["reason"]
        if st.get("next_open"):
            line += " Next open %s IST." % st["next_open"]
    return line


def render_moves(moves, move_pct=MOVE_PCT):
    out = []
    for m in moves:
        flags = []
        if abs(m["pct"]) >= move_pct:
            flags.append("MOVING")
        hint = band_hint(m["pct"])
        if hint:
            flags.append(hint)
        when = (" at %s IST" % to_ist(m["time"]).strftime("%H:%M")) if m.get("time") else ""
        out.append("%-10s %s %+.2f%% vs previous close %s%s  %s" % (
            m["ticker"], inr(m["price"]), m["pct"], inr(m["prev_close"]), when, "  ".join(flags)))
    return out


def _short(text, n=220):
    text = text or ""
    return text if len(text) <= n else text[:n - 3].rstrip() + "..."


def render(items, errors, now, moves=None, move_pct=MOVE_PCT, risks=None, info=None):
    out = [render_market(now)]
    out += render_moves(moves or [], move_pct)
    if risks:
        out.append("")
        out += [r["message"] for r in risks]
    out.append("")
    if not items:
        out.append("Nothing new.")
    for it in items:
        when = to_ist(it["time"]).strftime("%Y-%m-%d %H:%M IST") if it["time"] else "time unknown"
        mark = "!" if it.get("important") else " "
        who = ",".join(it["touches"]) or it["ticker"]
        out.append("%s %s  %-11s %-13s %s" % (mark, when, who, it["source"], it["title"]))
        if it["kind"] == "filing" and it.get("summary"):
            out.append("      " + _short(it["summary"]))
        extra = []
        if it["tags"]:
            extra.append("tags: " + ", ".join(it["tags"]))
        extra.append(it["link"])
        out.append("      " + "  ".join(extra))
    for e in errors:
        out.append("note: %s" % e)
    for i in info or []:
        out.append("note: %s" % i)
    if not calendar_known(to_ist(now).date()):
        out.append("note: the NSE holiday list for %d is not built in, so trading days are a guess: add "
                   "{\"YYYY-MM-DD\": \"name\"} lines to %s" % (to_ist(now).year, HOLIDAYS_FILE))
    out.append("Checked %s. Filings and headlines are leads, not facts; open them before acting. "
               "Not financial advice." % to_ist(now).strftime("%Y-%m-%d %H:%M IST"))
    return "\n".join(out) + "\n"


def _iso(t):
    return _stamp(t) if t else None


def _json_ready(items):
    out = []
    for it in items:
        d = dict(it)
        d["time"] = _iso(it["time"])
        d["time_india"] = to_ist(it["time"]).strftime("%Y-%m-%d %H:%M") if it["time"] else None
        out.append(d)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tickers", "--symbols", nargs="*", dest="tickers",
                    help="NSE symbols; default: watchlist + plan + portfolio")
    ap.add_argument("--portfolio", default=os.path.join(DATA_DIR, "portfolio.json"))
    ap.add_argument("--watchlist", default=os.path.join(DATA_DIR, "watchlist.json"))
    ap.add_argument("--plan", default=os.path.join(DATA_DIR, "plan.json"))
    ap.add_argument("--state", default=os.path.join(DATA_DIR, "state", "news.json"))
    ap.add_argument("--hours", type=float, default=48, help="ignore items older than this")
    ap.add_argument("--all", action="store_true", help="show seen items too")
    ap.add_argument("--file", action="append", metavar="PATH",
                    help="NSE announcements JSON saved from your browser (repeatable); NSE is then not called")
    ap.add_argument("--no-nse", action="store_true", help="headlines only")
    ap.add_argument("--no-yahoo", action="store_true", help="NSE filings only")
    ap.add_argument("--no-moves", action="store_true", help="skip the price line per symbol")
    ap.add_argument("--move-pct", type=float, default=MOVE_PCT, help="flag a move this big (percent)")
    ap.add_argument("--offline", metavar="DIR")
    ap.add_argument("--now", help="ISO time; without an offset it is India time")
    ap.add_argument("--dry-run", action="store_true", help="do not update the state file")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    try:
        now = parse_now(args.now)
        known = watch_from_files(args.portfolio, args.watchlist, args.plan)
        if args.tickers:
            watch = {norm_symbol(t): None for t in args.tickers}
            watch.update({t: known[t] for t in watch if known.get(t)})
        else:
            watch = known
        records = load_files(args.file) if args.file and not args.no_nse else []
    except (CoreError, NewsError) as exc:
        print("news: %s" % exc, file=sys.stderr)
        return 2
    if not watch and records:
        watch = {s: None for s in (_sym(r.get("symbol")) for r in records) if s}
    if not watch:
        print("news: no symbols. Pass --tickers, or run /india-scanner first (it writes "
              "trader-india/watchlist.json).", file=sys.stderr)
        return 2
    state = load_json(args.state) or {}
    errors, info = [], []
    fetcher = Fetcher(offline=args.offline)
    try:
        items = collect(fetcher, watch, now, nse=not args.no_nse, yahoo=not args.no_yahoo,
                        files=args.file, errors=errors, info=info)
    except NewsError as exc:
        print("news: %s" % exc, file=sys.stderr)
        return 2
    items = dedupe(tag(items, watch))
    risks = results_risk(items, watch, now)
    shown = select(items, state, now, hours=args.hours, show_all=args.all)
    moves = [] if args.no_moves else collect_moves(fetcher, watch, errors)
    if args.json:
        mv = [dict(m, time=_iso(m.get("time")), moving=abs(m["pct"]) >= args.move_pct,
                   band_hint=band_hint(m["pct"]) or None) for m in moves]
        print(json.dumps({"checked": _stamp(now), "checked_india": to_ist(now).strftime("%Y-%m-%d %H:%M"),
                          "market": market_status(now), "moves": mv, "results_risk": risks,
                          "items": _json_ready(shown), "notes": errors + info}, indent=2, ensure_ascii=False))
    else:
        sys.stdout.write(render(shown, errors, now, moves, args.move_pct, risks, info))
    if not args.dry_run:
        remember(items, state, now, args.hours)
        folder = os.path.dirname(args.state)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(args.state, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2)
            fh.write("\n")
    return 0 if any(i["new"] for i in shown) else 1


if __name__ == "__main__":
    sys.exit(main())
