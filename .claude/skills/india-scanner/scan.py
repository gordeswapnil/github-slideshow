#!/usr/bin/env python3
"""Chart Scanner for india-scanner: scan NSE charts for setups. Standard library only.

    python3 scan.py universe                          # NSE's EQUITY_L.csv -> trader-india/universe.txt
    python3 scan.py universe --file ~/Downloads/EQUITY_L.csv   # the file you saved in a browser
    python3 scan.py daily                             # before 09:15: daily setups -> trader-india/watchlist.json
    python3 scan.py daily --symbols RELIANCE,TCS,M&M  # or --watchlist FILE, or --limit 200
    python3 scan.py orb                               # after 09:35 IST: opening-range breakouts so far
    python3 scan.py orb --at 10:00 --or-minutes 15    # cut the clock at 10:00 India time
    python3 scan.py orb --offline SYNTH-wall5m-2026-10-19.json.gz --now "2026-10-19 10:00" --min-price 0

universe  Reads NSE's list of listed equities, EQUITY_L.csv
          (https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv; the
          legacy host is archives.nseindia.com, use --url for it). Header:
          SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE,
          MARKET LOT, ISIN NUMBER, FACE VALUE (the spaces are stripped). Keeps
          the rows whose SERIES is in allowed_series (config, default EQ):
          BE and BZ are trade-for-trade (delivery only, no intraday). One
          request with a browser-like User-Agent and a timeout. NSE's site runs
          bot protection and often answers scripts with HTTP 403, an HTML page
          or nothing at all: then this says so and asks you to download the
          file in your browser and pass --file. NSE's terms of use restrict
          automated collection of its data, so it never retries.

daily     Pre-market scan of daily CLOSES (Yahoo spark for SYMBOL.NS: 20
          symbols a request, 3 months of 1-day bars, closes only). Liquidity
          from the spark meta, in rupees: regularMarketPrice >= --min-price
          (20) and price x regularMarketVolume (the traded value) >=
          --min-value (10 crore, 10,00,00,000). Setups, from closes only:
            breakout_20d     the last close is above every close of the 20 before it
            bull_flag        up more than 10 % over the 10 sessions before the
                             last 5, then the last 5 closes inside a 5 % range
            reclaim_ma20     closed under the 20-day average, then closed above it
            oversold         RSI 14 (Wilder) under 30
            oversold_bounce  RSI 14 was under 30 yesterday and today closed up
          Today's daily bar is dropped until the 15:30 close.

orb       Opening-range breakouts, 5-minute bars. The range is the first
          --or-minutes (15) of the session: 09:15 to 09:30 India time. Stage
          1: spark closes for every symbol (1 day of 5-minute bars, 20 a
          request); a chart goes on only if a completed bar after the range
          closed at or above the highest close of the range (a necessary
          condition). Stage 2: each candidate's v8 chart (real highs and
          lows): range high = the highest high of the range bars, a hit = the
          first completed bar to CLOSE above it, at that bar's close time.
          Stage 2 fetches at most --max-confirm (200) charts, the most traded
          candidates first (rupees traded so far), and says so when it stops
          short. A chart is usable only when every 5-minute bar from 09:15 to
          the cutoff is there (a missing bar is a halt, a price-band freeze or
          no trades). Floors: --min-price 20 (last close), --min-value 0.
          No new hits after no_entries_after (config, default 14:30).

Bars: null closes are dropped, a bar off the 5-minute grid (the live tick,
like 10:43:07) is dropped, and a bar counts only once it is complete
(start + 5 minutes <= the clock). Times are India time (IST, UTC+5:30, no
daylight saving). --now pins the clock ("2026-10-19 10:00" India time; ...Z
for UTC). NSE holidays come from the shared core plus trader-india/holidays.json.

Yahoo's endpoints are free, unofficial and can lag. query2 first, query1 on
a 429 or 5xx, one retry after a pause on a 429. A polite pause between
requests (--pause). Partial results are reported as partial.

--offline PATH reads files instead of the network: daily and orb take a
folder of <SYMBOL>.json v8 chart files or spark responses, or one file that
is a spark response, a v8 chart, or a bundle {"SYNTH": <v8 json>, ...}.
.json.gz is fine.

Every hit in trader-india/watchlist.json carries `series` (EQ, ...) from the
universe file (SYMBOL|Name|SERIES), else from an input watchlist's hits, else null.

A scan is a list of charts that match a rule, not a list of stocks to buy.
Exit code 0 when the scan found something, 1 when it did not or could not run.
"""

import argparse
import csv
import datetime
import gzip
import http.client
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

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
        flat = D(brokerage_flat)
        if brokerage_pct is None:
            return flat
        return min(flat, value * D(brokerage_pct) / hundred)

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

UA = "Mozilla/5.0 (compatible; india-trader-skill/1.0)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0.0.0 Safari/537.36")
NSE_HEADERS = {"User-Agent": BROWSER_UA, "Accept": "text/csv,text/plain,*/*;q=0.8",
               "Accept-Language": "en-IN,en;q=0.9"}
EQUITY_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
LEGACY_EQUITY_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
NSE_TIMEOUT = 20
YAHOO_HOSTS = ("https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com")
SPARK_MAX = 20      # Yahoo's spark answers 400 above 20 symbols
PAUSE = 0.3         # seconds between requests: be polite to free endpoints
BACKOFF = 5.0       # seconds to wait before the one retry after a 429
SLEEP = time.sleep  # tests swap this out
BAR_MIN = 5
MAX_CONFIRM = 200   # stage-2 v8 charts per orb scan, most traded first
MIN_DAILY_BARS = 30
CRORE = 10000000
MIN_PRICE = 20.0             # rupees: keeps the lowest-priced shares out (this pack's choice)
MIN_VALUE_DAILY = 10 * CRORE  # rupees traded in the last session: the real liquidity floor
DEFAULT_UNIVERSE = os.path.join(DATA_DIR, "universe.txt")
DEFAULT_WATCHLIST = os.path.join(DATA_DIR, "watchlist.json")
DEFAULT_CONFIG = os.path.join(DATA_DIR, "config.json")
DEFAULT_SERIES = ("EQ",)
NO_ENTRIES_AFTER = "14:30"
NOTE = "A scan is a list of charts that match a rule, not a list of stocks to buy."
EPOCH = datetime.datetime(1970, 1, 1)
SERIES_WHY = {"BE": "trade-for-trade", "BZ": "trade-for-trade"}

SETUPS = [
    ("breakout_20d", "20-day closing-high breakout"),
    ("bull_flag", "bull flag"),
    ("reclaim_ma20", "reclaimed the 20-day average"),
    ("oversold", "oversold (RSI under 30)"),
    ("oversold_bounce", "oversold bounce"),
]
LABEL = dict(SETUPS)


class ScanError(Exception):
    pass


# ---------------------------------------------------------------- time

def ts_to_ist(ts):
    """Unix seconds -> naive India time. Never uses the machine's time zone."""
    return to_ist(EPOCH + datetime.timedelta(seconds=int(ts)))


def now_utc(text):
    try:
        return parse_now(text)
    except CoreError as e:
        raise ScanError(str(e))


def parse_hhmm(text, flag="--at"):
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", text or "")
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ScanError("%s wants a 24-hour India time like 10:00" % flag)
    return datetime.time(int(m.group(1)), int(m.group(2)))


def hm(t):
    """datetime or time -> '09:55' (24-hour, India time)."""
    return "%02d:%02d" % (t.hour, t.minute)


def day_label(d):
    return "%s %s" % (d.strftime("%a"), d.isoformat())


def calendar_warning(d):
    if calendar_known(d):
        return None
    return ("NSE's %d holiday list is not in this tool yet, so a holiday would look like a trading day. "
            "When NSE publishes it, add trader-india/holidays.json, e.g. {\"%d-01-26\": \"Republic Day\"}."
            % (d.year, d.year))


# ---------------------------------------------------------------- network

def http_get(url, timeout=20, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig", "replace")


def yahoo_get(path):
    """GET a Yahoo Finance path. query2 first, query1 on a 429 or 5xx, and one
    more round after BACKOFF seconds if a 429 was seen. 4xx other than 429 is final."""
    last = "no answer"
    for attempt in (0, 1):
        saw_429 = False
        for host in YAHOO_HOSTS:
            try:
                return http_get(host + path)
            except urllib.error.HTTPError as e:
                last = "HTTP %d" % e.code
                try:
                    body = e.read().decode("utf-8", "replace") if 400 <= e.code < 500 and e.code != 429 else ""
                except Exception:
                    body = ""
                finally:
                    e.close()
                if e.code == 429:
                    saw_429 = True
                    continue
                if e.code >= 500:
                    continue
                if body.strip().startswith("{"):
                    return body  # Yahoo's JSON error ("No data found"), parsed by the caller
                raise ScanError("Yahoo answered %s for %s" % (last, path.split("?")[0]))
            except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
                last = str(getattr(e, "reason", e))
                continue
        if attempt == 0 and saw_429:
            SLEEP(BACKOFF)
            continue
        break
    raise ScanError("Yahoo answered %s for %s" % (last, path.split("?")[0]))


def to_yahoo(sym):
    """NSE symbol -> URL-safe Yahoo symbol: M&M -> M%26M.NS."""
    return urllib.parse.quote(yahoo_symbol(sym), safe="")


def spark_path(symbols, rng, interval):
    return "/v7/finance/spark?symbols=%s&range=%s&interval=%s" % (
        ",".join(to_yahoo(s) for s in symbols), rng, interval)


def chart_path(sym, rng, interval):
    return "/v8/finance/chart/%s?range=%s&interval=%s" % (to_yahoo(sym), rng, interval)


# ---------------------------------------------------------------- parsing

def nse_sym(text):
    try:
        return norm_symbol(text)
    except CoreError as e:
        raise ScanError(str(e))


def series_from_result(res):
    """A Yahoo chart result (v8 or one spark response) -> plain lists."""
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0] or {}
    t = res.get("timestamp") or []
    n = len(t)

    def col(k):
        v = q.get(k)
        return list(v) + [None] * (n - len(v)) if isinstance(v, list) else None
    return {"t": list(t), "c": col("close") or [None] * n, "o": col("open"), "h": col("high"),
            "l": col("low"), "v": col("volume"), "meta": res.get("meta") or {}}


def parse_spark(text_or_doc, wanted=None):
    """Spark JSON -> {SYMBOL: series}. Symbols Yahoo does not know are simply missing
    from the answer. `wanted` maps Yahoo symbols back to ours (M&M.NS -> M&M)."""
    doc = json.loads(text_or_doc) if isinstance(text_or_doc, str) else text_or_doc
    sp = (doc or {}).get("spark") if isinstance(doc, dict) else None
    if not isinstance(sp, dict):
        raise ScanError("Yahoo's spark answer is not the shape this tool knows")
    err = sp.get("error")
    out = {}
    for item in sp.get("result") or []:
        resp = item.get("response") or []
        if not resp:
            continue
        ysym = str(item.get("symbol") or (resp[0].get("meta") or {}).get("symbol") or "").upper()
        sym = (wanted or {}).get(ysym) or from_yahoo(ysym)
        out[sym] = series_from_result(resp[0])
    if err and not out:
        raise ScanError("Yahoo spark: %s" % (err.get("description") or err.get("code") or err))
    return out


def parse_chart(text_or_doc, sym=""):
    """v8 chart JSON -> series. Raises ScanError for Yahoo's 'no data' answers."""
    try:
        doc = json.loads(text_or_doc) if isinstance(text_or_doc, str) else text_or_doc
        chart = doc["chart"]
    except (ValueError, KeyError, TypeError):
        raise ScanError("Yahoo returned something unexpected for %s" % sym)
    res = chart.get("result")
    if not res:
        err = chart.get("error") or {}
        raise ScanError("no data for %s: %s" % (sym, err.get("description", "unknown symbol")))
    return series_from_result(res[0])


def _read_maybe_gz(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return fh.read()
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _stem(name):
    for ext in (".json.gz", ".json"):
        if name.endswith(ext):
            return name[:-len(ext)]
    return name


def _absorb(doc, name_hint, data, errors):
    """One parsed offline JSON doc -> data / errors."""
    if isinstance(doc, dict) and "spark" in doc:
        data.update(parse_spark(doc))
    elif isinstance(doc, dict) and "chart" in doc:
        sym = name_hint
        if not sym:
            try:
                sym = (doc["chart"].get("result") or [{}])[0]["meta"]["symbol"]
            except (AttributeError, KeyError, TypeError, IndexError):
                raise ScanError("an offline v8 chart without a symbol: name the file <SYMBOL>.json")
        sym = nse_sym(sym)
        try:
            data[sym] = parse_chart(doc, sym)
        except ScanError as e:
            errors[sym] = str(e)
    elif isinstance(doc, dict):
        for k, v in doc.items():
            if not str(k).startswith("_"):   # "_provenance" and other notes
                _absorb(v, k, data, errors)
    else:
        raise ScanError("offline file %s is not a spark answer, a v8 chart or a bundle" % name_hint)


def load_offline(path):
    """A folder of <SYMBOL>.json(.gz) files or one file -> ({SYMBOL: series}, {SYMBOL: error})."""
    data, errors = {}, {}
    if os.path.isdir(path):
        names = sorted(f for f in os.listdir(path) if f.endswith((".json", ".json.gz")))
        if not names:
            raise ScanError("no .json files in %s" % path)
        for f in names:
            try:
                doc = json.loads(_read_maybe_gz(os.path.join(path, f)))
            except ValueError as e:
                raise ScanError("%s is not valid JSON: %s" % (f, e))
            if isinstance(doc, dict) and ("chart" in doc or "spark" in doc):
                _absorb(doc, "" if "spark" in doc else _stem(f), data, errors)
            else:
                _absorb(doc, "", data, errors)
    elif os.path.isfile(path):
        try:
            doc = json.loads(_read_maybe_gz(path))
        except ValueError as e:
            raise ScanError("%s is not valid JSON: %s" % (path, e))
        _absorb(doc, "", data, errors)
    else:
        raise ScanError("no offline file or folder at %s" % path)
    return data, errors


# ---------------------------------------------------------------- universe (NSE EQUITY_L.csv)

def browser_hint(why, url=EQUITY_URL):
    return ("%s. NSE's site blocks many scripts. Open %s in your browser (it saves EQUITY_L.csv), "
            "then run: scan.py universe --file PATH/TO/EQUITY_L.csv" % (why, url))


def parse_equity_list(text):
    """EQUITY_L.csv text -> [row dicts], header names stripped and upper-cased."""
    text = (text or "").lstrip("﻿")
    head = text.lstrip()[:300].lower()
    if not head:
        raise ScanError("the equity list is empty")
    if head.startswith("<") or "<html" in head:
        raise ScanError("got a web page, not the CSV (NSE's bot check)")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    hdr = [h.strip().upper() for h in rows[0]]
    for need in ("SYMBOL", "NAME OF COMPANY", "SERIES"):
        if need not in hdr:
            raise ScanError("not NSE's EQUITY_L.csv (no %s column; header %s)" % (need, ",".join(rows[0])[:80]))
    out = []
    for r in rows[1:]:
        out.append({h: (r[i].strip() if i < len(r) else "") for i, h in enumerate(hdr)})
    return out


def build_universe(rows, allowed=DEFAULT_SERIES):
    """rows -> (kept [(SYMBOL, name)], counts, {SYMBOL: series}). A row is kept when its
    series is allowed and its symbol is a valid NSE symbol."""
    allowed = {s.strip().upper() for s in allowed}
    kept, counts, series_of = {}, {"rows": len(rows)}, {}

    def drop(why):
        counts[why] = counts.get(why, 0) + 1
    for r in rows:
        series = r.get("SERIES", "").upper()
        if series not in allowed:
            drop("series " + (series or "blank"))
            continue
        try:
            sym = norm_symbol(r.get("SYMBOL"))
        except CoreError:
            drop("not an NSE symbol")
            continue
        kept[sym] = " ".join(r.get("NAME OF COMPANY", "").split())
        series_of[sym] = series
    counts["keep"] = len(kept)
    return sorted(kept.items()), counts, series_of


def read_series(universe_path, watchlist_path=None):
    """{SYMBOL: series} for the hits' `series` field: the universe file first (SYMBOL|Name|SERIES,
    as `universe` writes it), then the `series` of the hits in a watchlist.json given as input.
    A symbol found in neither gets None (null)."""
    out = {}
    if watchlist_path and os.path.exists(watchlist_path):
        with open(watchlist_path, encoding="utf-8") as fh:
            text = fh.read()
        if text.lstrip().startswith("{"):
            try:
                hits = json.loads(text).get("hits") or []
            except (ValueError, AttributeError):
                hits = []
            for h in hits:
                try:
                    if isinstance(h, dict) and h.get("series"):
                        out[norm_symbol(h.get("symbol"))] = str(h["series"]).upper()
                except CoreError:
                    continue
    if universe_path and os.path.exists(universe_path):
        with open(universe_path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        for ln in lines:
            parts = [p.strip() for p in ln.split("|")]
            if not parts[0] or parts[0].startswith(("#", "{", "[")):
                continue
            try:
                sym = norm_symbol(parts[0])
            except CoreError:
                continue
            if len(parts) > 2 and parts[2]:
                out[sym] = parts[2].upper()
    return out


def with_series(hits, series_of):
    """Each hit gets `series` (EQ, ...) right after its symbol, or None when unknown."""
    return [dict([("symbol", h["symbol"]), ("series", series_of.get(h["symbol"]))],
                 **{k: v for k, v in h.items() if k != "symbol"}) for h in hits]


# ---------------------------------------------------------------- daily setups

def rsi(closes, n=14):
    """Wilder's RSI on closes."""
    if len(closes) < n + 1:
        return None
    g = [max(0.0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    lo = [max(0.0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    ag, al = sum(g[:n]) / n, sum(lo[:n]) / n
    for i in range(n, len(g)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + lo[i]) / n
    return 100 - 100 / (1 + ag / al) if al else 100.0


def daily_closes(series, now):
    """[(date, close)] of COMPLETE daily bars: null closes dropped, today's bar dropped
    until the 15:30 close, anything dated after the clock dropped."""
    local = to_ist(now)
    today = local.date()
    s = session(today)
    today_done = s is None or local.time() >= s[1]
    out = {}
    for ts, c in zip(series["t"], series["c"]):
        if c is None:
            continue
        d = ts_to_ist(ts).date()
        if d > today or (d == today and not today_done):
            continue
        out[d] = float(c)  # one bar a day: a late duplicate (the live tick) wins
    return sorted(out.items())


def find_setups(closes):
    """closes (oldest first, >= 30) -> (setup keys, numbers)."""
    c = closes
    last = c[-1]
    hi20 = max(c[-21:-1])
    ma20 = sum(c[-20:]) / 20.0
    ma20_prev = sum(c[-21:-1]) / 20.0
    run = c[-6] / c[-16] - 1
    rng5 = (max(c[-5:]) - min(c[-5:])) / last
    r = rsi(c)
    r_prev = rsi(c[:-1])
    tags = []
    if last > hi20:
        tags.append("breakout_20d")
    if run > 0.10 and rng5 < 0.05:
        tags.append("bull_flag")
    if c[-2] < ma20_prev and last > ma20:
        tags.append("reclaim_ma20")
    if r is not None and r < 30:
        tags.append("oversold")
    if r_prev is not None and r_prev < 30 and last > c[-2]:
        tags.append("oversold_bounce")
    return tags, {"rsi": r, "rsi_prev": r_prev, "high20": hi20, "ma20": ma20,
                  "run_pct": run * 100, "range5_pct": rng5 * 100}


def illiquid(price, vol, min_price, min_value, min_volume):
    if price is None or price < min_price:
        return True
    if min_volume > 0 and (vol is None or vol < min_volume):
        return True
    return min_value > 0 and (vol is None or price * vol < min_value)


def scan_daily(data, symbols, now, min_price, min_value, min_volume=0):
    """Pure. data = {SYMBOL: series}. Returns (hits, counts, last_date)."""
    hits, dates = [], {}
    counts = {"requested": len(symbols), "fetched": 0, "illiquid": 0, "short": 0, "scanned": 0}
    for sym in symbols:
        s = data.get(sym)
        if not s:
            continue
        counts["fetched"] += 1
        bars = daily_closes(s, now)
        meta = s.get("meta") or {}
        price = meta.get("regularMarketPrice")
        if price is None and bars:
            price = bars[-1][1]
        vol = meta.get("regularMarketVolume")
        if illiquid(price, vol, min_price, min_value, min_volume):
            counts["illiquid"] += 1
            continue
        if len(bars) < MIN_DAILY_BARS:
            counts["short"] += 1
            continue
        counts["scanned"] += 1
        d_last = bars[-1][0]
        dates[d_last] = dates.get(d_last, 0) + 1
        closes = [c for _, c in bars]
        tags, nums = find_setups(closes)
        if tags:
            hits.append({"symbol": sym, "setups": tags, "price": round(closes[-1], 2),
                         "close_date": d_last.isoformat(), "rsi": round(nums["rsi"], 1),
                         "volume": int(vol) if vol is not None else None,
                         "value_inr": int(round(price * vol)) if vol is not None else None})
    hits.sort(key=lambda h: (-(h["value_inr"] or 0), h["symbol"]))  # most rupees traded first
    last_date = max(dates, key=lambda d: (dates[d], d)) if dates else None
    counts["hits"] = len(hits)
    return hits, counts, last_date


# ---------------------------------------------------------------- opening-range breakout

def slot(day, k):
    return datetime.datetime.combine(day, OPEN) + datetime.timedelta(minutes=BAR_MIN * k)


def session_bars(series, day, cutoff):
    """5-minute bars of `day` that are complete at `cutoff` (naive India time),
    on the grid, with a close. Sorted, one per slot."""
    out = {}
    hs, ls = series.get("h"), series.get("l")
    for i, ts in enumerate(series["t"]):
        c = series["c"][i]
        if c is None:
            continue
        local = ts_to_ist(ts)
        if local.date() != day or local.second or local.minute % BAR_MIN:
            continue  # another day, or the live tick off the grid
        if local.time() < OPEN or local.time() >= CLOSE:
            continue  # the pre-open, or anything after 15:30
        if local + datetime.timedelta(minutes=BAR_MIN) > cutoff:
            continue  # still in progress at the cutoff
        v = series.get("v")
        out[local] = {"start": local, "c": float(c),
                      "h": None if not hs or hs[i] is None else float(hs[i]),
                      "l": None if not ls or ls[i] is None else float(ls[i]),
                      "v": (v[i] or 0) if v else 0}
    return [out[k] for k in sorted(out)]


def usable(bars, day, cutoff, n_range):
    """Every slot from 09:15 to the cutoff is there, and at least the range."""
    want = int((cutoff - slot(day, 0)).total_seconds() // (BAR_MIN * 60))
    want = min(want, int((datetime.datetime.combine(day, CLOSE) - slot(day, 0)).total_seconds()
                         // (BAR_MIN * 60)))
    if want < n_range or len(bars) != want:
        return False
    return all(b["start"] == slot(day, k) for k, b in enumerate(bars))


def orb_candidate(bars, n_range):
    """Stage 1, closes only: some completed bar after the range closed at or above
    the highest close of the range. Necessary for a breakout (range high >= any range close)."""
    top = max(b["c"] for b in bars[:n_range])
    return any(b["c"] >= top for b in bars[n_range:])


def orb_hit(bars, n_range):
    """Stage 2, real highs and lows: the first completed bar to CLOSE above the range high."""
    rng = bars[:n_range]
    if any(b["h"] is None or b["l"] is None for b in rng):
        return None
    oh = max(b["h"] for b in rng)
    ol = min(b["l"] for b in rng)
    for k in range(n_range, len(bars)):
        b = bars[k]
        if b["c"] > oh:
            closes_at = b["start"] + datetime.timedelta(minutes=BAR_MIN)
            return {"price": round(b["c"], 2), "at": hm(closes_at),
                    "bar_start": hm(b["start"]), "bar_index": k,
                    "or_high": round(oh, 2), "or_low": round(ol, 2),
                    "pct_over": round((b["c"] / oh - 1) * 100, 2), "_t": closes_at}
    return None


def orb_window(now, at, or_minutes, until, explicit_day=None):
    """-> (day, cutoff naive IST) or raise ScanError with the plain message."""
    local = to_ist(now)
    day = explicit_day or local.date()
    if or_minutes < BAR_MIN or or_minutes % BAR_MIN or or_minutes > 120:
        raise ScanError("--or-minutes wants a multiple of 5 from 5 to 120 (15 is the classic)")
    ok, why = trading_day(day)
    if not ok:
        raise ScanError("No session on %s (%s): NSE is closed. Run orb on a trading day "
                        "after the opening range, or replay a past day with --offline." % (day_label(day), why))
    range_end = slot(day, or_minutes // BAR_MIN)
    first_close = range_end + datetime.timedelta(minutes=BAR_MIN)
    close_dt = datetime.datetime.combine(day, CLOSE)
    if at is not None:
        cutoff = datetime.datetime.combine(day, at)
        if explicit_day is None and cutoff > local + datetime.timedelta(seconds=59):
            raise ScanError("--at %s is later than now (%s IST)." % (hm(at), hm(local)))
        if cutoff > close_dt:
            raise ScanError("--at %s is after the 15:30 close on %s." % (hm(at), day_label(day)))
    else:
        cutoff = local.replace(second=0, microsecond=0)
        if cutoff >= close_dt:
            raise ScanError("NSE closed at 15:30 IST on %s. Replay the session with --at 10:00." % day_label(day))
    if cutoff < first_close:
        raise ScanError("It is %s IST: the %d-minute opening range runs 09:15 to %s and the first bar after it "
                        "closes at %s. Run orb again after %s."
                        % (hm(cutoff), or_minutes, hm(range_end), hm(first_close), hm(first_close)))
    if until is not None and cutoff.time() > until:
        raise ScanError("It is %s IST, after %s, your last time for new entries (no_entries_after): an "
                        "opening-range breakout found now is expired. Run orb tomorrow after %s, or replay "
                        "today with --at 10:00." % (hm(cutoff), hm(until), hm(first_close)))
    return day, cutoff


def scan_orb(stage1, symbols, day, cutoff, or_minutes, min_price=0.0, min_value=0.0, confirm=None,
             max_confirm=None, min_volume=0):
    """stage1 = {SYMBOL: series} with closes (spark or v8). confirm(sym) -> series with highs/lows
    (None = use the stage-1 series). With confirm and max_confirm, only the max_confirm most
    traded candidates (rupees traded so far) are confirmed; the rest are counted as unconfirmed.
    Returns (hits, counts, failed {sym: why})."""
    n_range = or_minutes // BAR_MIN
    counts = {"requested": len(symbols), "fetched": 0, "unusable": 0, "illiquid": 0, "scanned": 0,
              "candidates": 0, "confirmed": 0, "unconfirmed": 0}
    hits, failed, cands = [], {}, []
    for sym in symbols:
        s = stage1.get(sym)
        if not s:
            continue
        counts["fetched"] += 1
        bars = session_bars(s, day, cutoff)
        if not usable(bars, day, cutoff, n_range):
            counts["unusable"] += 1
            continue
        vol = sum(b["v"] for b in bars) if s.get("v") else (s.get("meta") or {}).get("regularMarketVolume") or 0
        if illiquid(bars[-1]["c"], vol, min_price, min_value, min_volume):
            counts["illiquid"] += 1
            continue
        counts["scanned"] += 1
        if orb_candidate(bars, n_range):
            cands.append((sym, bars, bars[-1]["c"] * vol))
    counts["candidates"] = len(cands)
    if confirm is not None and max_confirm and len(cands) > max_confirm:
        cands.sort(key=lambda x: -x[2])
        counts["unconfirmed"] = len(cands) - max_confirm
        cands = cands[:max_confirm]
    for sym, bars, _ in cands:
        full = bars
        if confirm is not None:
            try:
                s2 = confirm(sym)
            except ScanError as e:
                failed[sym] = str(e)
                continue
            full = session_bars(s2, day, cutoff)
            if not usable(full, day, cutoff, n_range):
                failed[sym] = "the v8 chart has a missing bar"
                continue
        counts["confirmed"] += 1
        h = orb_hit(full, n_range)
        if h:
            hits.append(dict({"symbol": sym, "setups": ["orb"]}, **h))
    hits.sort(key=lambda x: (x["_t"], x["symbol"]))
    for h in hits:
        del h["_t"]
    counts["hits"] = len(hits)
    return hits, counts, failed


# ---------------------------------------------------------------- fetching and files

def progress(a, msg):
    if not getattr(a, "json", False) and not getattr(a, "quiet", False):
        print(msg, file=sys.stderr)


def fetch_spark(symbols, rng, interval, pause, a=None):
    """Batches of 20. -> ({SYMBOL: series}, {SYMBOL: error})."""
    data, failed = {}, {}
    batches = [symbols[i:i + SPARK_MAX] for i in range(0, len(symbols), SPARK_MAX)]
    for k, batch in enumerate(batches):
        if k and pause:
            SLEEP(pause)
        wanted = {yahoo_symbol(s): s for s in batch}
        try:
            got = parse_spark(yahoo_get(spark_path(batch, rng, interval)), wanted)
        except (ScanError, ValueError) as e:
            for s in batch:
                failed[s] = str(e)
            continue
        for s in batch:
            if s in got:
                data[s] = got[s]
            else:
                failed[s] = "no data from Yahoo"
        if a is not None and len(batches) > 25 and (k + 1) % 50 == 0:
            progress(a, "  spark %d of %d requests" % (k + 1, len(batches)))
    return data, failed


def read_symbols(a, offline_syms=None):
    if a.symbols:
        syms = [nse_sym(s) for s in re.split(r"[,\s]+", a.symbols) if s]
    elif a.watchlist:
        syms = symbols_from_file(a.watchlist)
    elif offline_syms is not None and not a.universe:
        syms = sorted(offline_syms)  # offline: every chart in the file, unless a list was given
    else:
        path = a.universe or DEFAULT_UNIVERSE
        if not os.path.exists(path):
            raise ScanError("no %s yet: run `scan.py universe` first, or pass --symbols" % path)
        syms = symbols_from_file(path)
    out = []
    for s in syms:
        if s not in out:
            out.append(s)
    if a.limit:
        out = out[:a.limit]
    if not out:
        raise ScanError("no symbols to scan")
    return out


def symbols_from_file(path):
    if not os.path.exists(path):
        raise ScanError("no file at %s" % path)
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if text.lstrip().startswith(("{", "[")):
        try:
            doc = json.loads(text)
        except ValueError as e:
            raise ScanError("%s is not valid JSON: %s" % (path, e))
        items = doc.get("hits", []) if isinstance(doc, dict) else doc
        return [nse_sym(x.get("symbol") if isinstance(x, dict) else x) for x in items if x]
    out = []
    for ln in text.splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            out.append(nse_sym(ln.split("|")[0]))
    return out


def read_config(path):
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            cfg = json.load(fh)
    except ValueError as e:
        raise ScanError("%s is not valid JSON: %s" % (path, e))
    return cfg if isinstance(cfg, dict) else {}


def write_json(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def _n(x):
    return "{:,}".format(x)


def _p(x):
    return "%.2f" % x


def money_floor(x):
    """10 crore -> '₹10 crore'; small amounts in plain rupees."""
    if x >= CRORE and x % (CRORE // 100) == 0:
        return "₹%s crore" % ("%g" % (x / float(CRORE)))
    return inr(x, 0)


def filters(a):
    return {"min_price_inr": a.min_price, "min_value_inr": a.min_value, "min_volume": a.min_volume}


# ---------------------------------------------------------------- commands

def cmd_universe(a):
    t0 = time.time()
    cfg = read_config(a.config)
    allowed = ([s for s in re.split(r"[,\s]+", a.series.upper()) if s] if a.series
               else [str(s).upper() for s in (cfg.get("allowed_series") or DEFAULT_SERIES)])
    if a.file:
        if not os.path.exists(a.file):
            raise ScanError("no file at %s" % a.file)
        with open(a.file, encoding="utf-8-sig", errors="replace") as fh:
            text = fh.read()
        source = a.file
    else:
        try:
            text = http_get(a.url, timeout=NSE_TIMEOUT, headers=NSE_HEADERS)
        except urllib.error.HTTPError as e:
            raise ScanError(browser_hint("NSE answered HTTP %d" % e.code, a.url))
        except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError) as e:
            raise ScanError(browser_hint("could not get the list from NSE (%s)" % (getattr(e, "reason", None) or e
                                                                                    or "no answer"), a.url))
        source = a.url
    try:
        rows = parse_equity_list(text)
    except ScanError as e:
        if a.file:
            raise
        raise ScanError(browser_hint("NSE's answer was not the equity list: %s" % e, a.url))
    kept, counts, series_of = build_universe(rows, allowed)
    if not a.no_write and kept:
        d = os.path.dirname(a.out)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            for sym, name in kept:
                fh.write("%s|%s|%s\n" % (sym, name, series_of[sym]))
    dropped = {k: v for k, v in counts.items() if k not in ("keep", "rows")}
    if a.json:
        print(json.dumps({"count": len(kept), "rows": counts["rows"], "allowed_series": allowed,
                          "source": source, "dropped": dropped,
                          "out": None if (a.no_write or not kept) else a.out,
                          "seconds": round(time.time() - t0, 1)}, indent=2))
        return 0 if kept else 1
    print("NSE equity list (EQUITY_L.csv from %s): %s rows." % (source, _n(counts["rows"])))
    print("Kept %s stocks in series %s (allowed_series)." % (_n(len(kept)), ", ".join(allowed)))
    if dropped:
        print("Dropped: " + ", ".join(
            "%s %s%s" % (_n(v), k, (" (%s: delivery only, no intraday)" % SERIES_WHY[k[7:]])
                         if k.startswith("series ") and k[7:] in SERIES_WHY else "")
            for k, v in sorted(dropped.items(), key=lambda kv: (-kv[1], kv[0]))) + ".")
    if not a.no_write and kept:
        print("Wrote %s (one SYMBOL|Name|SERIES a line)." % a.out)
    return 0 if kept else 1


def cmd_daily(a):
    t0 = time.time()
    now = now_utc(a.now)
    offline_syms = None
    if a.offline:
        data, failed = load_offline(a.offline)
        offline_syms = sorted(set(data) | set(failed))
    symbols = read_symbols(a, offline_syms)
    warn = calendar_warning(to_ist(now).date())
    if warn:
        progress(a, "Note: " + warn)
    if not a.offline:
        progress(a, "Fetching daily closes for %s symbols (%d spark requests)..."
                 % (_n(len(symbols)), (len(symbols) + SPARK_MAX - 1) // SPARK_MAX))
        data, failed = fetch_spark(symbols, "3mo", "1d", a.pause, a)
    hits, counts, last_date = scan_daily(data, symbols, now, a.min_price, a.min_value, a.min_volume)
    hits = with_series(hits, read_series(a.universe or DEFAULT_UNIVERSE, a.watchlist))
    nfailed = len(symbols) - counts["fetched"]
    as_of = ("%s close" % last_date.isoformat()) if last_date else None
    doc = {"created_by": "india-scanner", "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "mode": "daily",
           "exchange": "NSE", "timezone": "IST", "as_of": as_of, "universe": len(symbols),
           "scanned": counts["scanned"], "failed": nfailed, "source": "yahoo", "filters": filters(a),
           "note": NOTE, "hits": hits}
    if warn:
        doc["warnings"] = [warn]
    if a.offline:
        doc["offline"] = os.path.basename(a.offline.rstrip("/"))
    if not a.no_write:
        write_json(a.out, doc)
    if a.json:
        print(json.dumps(dict(doc, counts=counts, seconds=round(time.time() - t0, 1)), indent=2, ensure_ascii=False))
        return 0 if hits else 1
    local = to_ist(now)
    print("Daily scan, %s IST, closes through %s (Yahoo spark, SYMBOL.NS, daily closes only)." % (
        local.strftime("%a %Y-%m-%d %H:%M"), last_date.isoformat() if last_date else "nothing"))
    print("Fetched %s of %s charts%s. %s passed the liquidity filter (price %s or more, %s or more traded "
          "in the last session%s)%s; %s scanned."
          % (_n(counts["fetched"]), _n(len(symbols)),
             (" (%s failed or had no data)" % _n(nfailed)) if nfailed else "",
             _n(counts["fetched"] - counts["illiquid"]), inr(a.min_price, 0), money_floor(a.min_value),
             (", %s+ shares" % _n(a.min_volume)) if a.min_volume else "",
             (", %d had under %d days" % (counts["short"], MIN_DAILY_BARS)) if counts["short"] else "",
             _n(counts["scanned"])))
    if hits:
        per = [(k, sum(1 for h in hits if k in h["setups"])) for k, _ in SETUPS]
        print("%d chart%s matched a setup: %s." % (len(hits), "" if len(hits) == 1 else "s",
                                                  ", ".join("%d %s" % (n, LABEL[k]) for k, n in per if n)))
        print("Most rupees traded first (price x volume):")
    else:
        print("No setups.")
    for h in hits[:a.show]:
        print("  %-12s %12s  RSI %5.1f  %s" % (h["symbol"], inr(h["price"]), h["rsi"],
                                               ", ".join(LABEL[t] for t in h["setups"])))
    if len(hits) > a.show:
        print("  ... and %d more in the watchlist (--show N for more)." % (len(hits) - a.show))
    if not a.no_write:
        print("Wrote %s (mode daily, %d hit%s)." % (a.out, len(hits), "" if len(hits) == 1 else "s"))
    print(NOTE + " Next: pick one chart, then /india-news SYMBOL.")
    return 0 if hits else 1


def cmd_orb(a):
    t0 = time.time()
    now = now_utc(a.now)
    at = parse_hhmm(a.at) if a.at else None
    cfg = read_config(a.config)
    until = parse_hhmm(a.until or cfg.get("no_entries_after") or NO_ENTRIES_AFTER, "--until")
    data = failed = None
    explicit_day = None
    offline_syms = None
    if a.offline:
        data, failed = load_offline(a.offline)
        offline_syms = sorted(set(data) | set(failed))
        if not a.now:
            days = [ts_to_ist(s["t"][-1]).date() for s in data.values() if s["t"]]
            if days:
                explicit_day = max(days)
                if at is None:
                    raise ScanError("offline replay: give --at HH:MM or --now \"YYYY-MM-DD HH:MM\" (India time)")
    day, cutoff = orb_window(now, at, a.or_minutes, until, explicit_day)
    symbols = read_symbols(a, offline_syms)
    warn = calendar_warning(day)
    if warn:
        progress(a, "Note: " + warn)
    confirm = None
    if not a.offline:
        today = to_ist(now_utc(None)).date()
        if (today - day).days > 6:
            raise ScanError("Yahoo's free 5-minute history is short: replay %s with --offline" % day.isoformat())
        rng = "1d" if day == today else "5d"
        progress(a, "Stage 1: 5-minute closes for %s symbols (%d spark requests)..."
                 % (_n(len(symbols)), (len(symbols) + SPARK_MAX - 1) // SPARK_MAX))
        data, failed = fetch_spark(symbols, rng, "%dm" % BAR_MIN, a.pause, a)
        done = []

        def confirm(sym):
            if a.pause:
                SLEEP(a.pause)
            done.append(sym)
            if len(done) % 50 == 0:
                progress(a, "  stage 2: %d v8 charts so far" % len(done))
            return parse_chart(yahoo_get(chart_path(sym, rng, "%dm" % BAR_MIN)), sym)
    hits, counts, failed2 = scan_orb(data, symbols, day, cutoff, a.or_minutes, a.min_price, a.min_value, confirm,
                                     a.max_confirm, a.min_volume)
    hits = with_series(hits, read_series(a.universe or DEFAULT_UNIVERSE, a.watchlist))
    nfailed = len(symbols) - counts["fetched"] + len(failed2)   # no chart at all, or stage 2 failed
    range_end = slot(day, a.or_minutes // BAR_MIN)
    as_of = "%s %s IST" % (day.isoformat(), hm(cutoff))
    doc = {"created_by": "india-scanner", "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "mode": "orb",
           "exchange": "NSE", "timezone": "IST", "as_of": as_of, "universe": len(symbols),
           "scanned": counts["scanned"], "failed": nfailed, "unconfirmed": counts["unconfirmed"], "source": "yahoo",
           "or_minutes": a.or_minutes, "opening_range": "09:15-%s" % hm(range_end), "interval": "%dm" % BAR_MIN,
           "filters": filters(a), "note": NOTE, "hits": hits}
    if warn:
        doc["warnings"] = [warn]
    if a.offline:
        doc["offline"] = os.path.basename(a.offline.rstrip("/"))
    if not a.no_write:
        write_json(a.out, doc)
    if a.json:
        print(json.dumps(dict(doc, counts=counts, seconds=round(time.time() - t0, 1)), indent=2, ensure_ascii=False))
        return 0 if hits else 1
    print("Opening-range breakout scan, %s %s IST: %d-minute range (09:15 to %s), 5-minute bars, Yahoo."
          % (day_label(day), hm(cutoff), a.or_minutes, hm(range_end)))
    print("Fetched %s of %s charts%s; %s usable%s; %s candidates, %s confirmed with real highs and lows."
          % (_n(counts["fetched"]), _n(len(symbols)),
             (" (%s failed or had no data)" % _n(nfailed)) if nfailed else "",
             _n(counts["scanned"]),
             (" (%s under the price / value floor)" % _n(counts["illiquid"])) if counts["illiquid"] else "",
             _n(counts["candidates"]), _n(counts["confirmed"])))
    if counts["unconfirmed"]:
        print("PARTIAL: %s more candidates were not checked (only the %s most traded are; --max-confirm 0 "
              "checks all)." % (_n(counts["unconfirmed"]), _n(a.max_confirm)))
    if hits:
        print("%d of %s charts closed above their opening-range high by %s IST:"
              % (len(hits), ("the %s checked" % _n(counts["confirmed"])) if counts["unconfirmed"]
                 else _n(counts["scanned"]), hm(cutoff)))
        for h in hits[:a.show]:
            print("  %s  %-12s %12s  range %s to %s  %+.2f%% over" % (
                h["at"], h["symbol"], inr(h["price"]), _p(h["or_low"]), _p(h["or_high"]), h["pct_over"]))
        if len(hits) > a.show:
            print("  ... and %d more in the watchlist (--show N for more)." % (len(hits) - a.show))
    else:
        print("No chart closed above its opening-range high by %s IST." % hm(cutoff))
    if not a.no_write:
        print("Wrote %s (mode orb, %d hit%s)." % (a.out, len(hits), "" if len(hits) == 1 else "s"))
    print(NOTE + " Next: pick one chart, then /india-news SYMBOL and /india-entry SYMBOL.")
    return 0 if hits else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="Chart Scanner (india-scanner): NSE daily setups and "
                                             "opening-range breakouts.")
    sub = ap.add_subparsers(dest="cmd")

    p = sub.add_parser("universe", help="NSE's EQUITY_L.csv -> %s" % DEFAULT_UNIVERSE)
    p.add_argument("--file", metavar="PATH", help="EQUITY_L.csv saved from your browser (no network)")
    p.add_argument("--url", default=EQUITY_URL, help="where to fetch it (default %s)" % EQUITY_URL)
    p.add_argument("--series", help="series to keep, e.g. EQ (default: config allowed_series, EQ)")
    p.add_argument("--config", default=DEFAULT_CONFIG)
    p.add_argument("--out", default=DEFAULT_UNIVERSE)
    p.add_argument("--no-write", action="store_true")
    p.add_argument("--json", action="store_true")

    def common(p, min_value):
        g = p.add_mutually_exclusive_group()
        g.add_argument("--symbols", help="comma-separated NSE symbols instead of the universe")
        g.add_argument("--watchlist", metavar="FILE", help="a watchlist.json (hits) or a text file of symbols")
        p.add_argument("--universe", help="symbol list, one SYMBOL|Name|SERIES a line (default %s); "
                       "it also gives each hit its series" % DEFAULT_UNIVERSE)
        p.add_argument("--limit", type=int, help="scan only the first N symbols")
        p.add_argument("--min-price", type=float, default=MIN_PRICE, help="rupees (default %g)" % MIN_PRICE)
        p.add_argument("--min-value", type=float, default=min_value,
                       help="rupees traded, price x volume (default %s)" % money_floor(min_value))
        p.add_argument("--min-volume", type=int, default=0, help="shares (default 0: off)")
        p.add_argument("--offline", metavar="PATH", help="fixture folder or file instead of the network")
        p.add_argument("--now", help='pretend it is this time ("2026-10-19 10:00" India time, or ...Z)')
        p.add_argument("--out", default=DEFAULT_WATCHLIST)
        p.add_argument("--no-write", action="store_true")
        p.add_argument("--pause", type=float, default=PAUSE, help="seconds between requests (%.1f)" % PAUSE)
        p.add_argument("--show", type=int, default=50, help="hits to print (all are written)")
        p.add_argument("--quiet", action="store_true")
        p.add_argument("--json", action="store_true")

    p = sub.add_parser("daily", help="pre-market setups from daily closes")
    common(p, MIN_VALUE_DAILY)
    p = sub.add_parser("orb", help="opening-range breakouts so far today")
    common(p, 0.0)
    p.add_argument("--or-minutes", type=int, default=15)
    p.add_argument("--max-confirm", type=int, default=MAX_CONFIRM,
                   help="v8 charts to fetch in stage 2, most traded first (%d; 0 = all)" % MAX_CONFIRM)
    p.add_argument("--at", help="cut the clock at this India time, HH:MM (24-hour)")
    p.add_argument("--until", help="no new entries after HH:MM (default: config no_entries_after, %s)"
                   % NO_ENTRIES_AFTER)
    p.add_argument("--config", default=DEFAULT_CONFIG)
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"universe": cmd_universe, "daily": cmd_daily, "orb": cmd_orb}[a.cmd](a)
    except (ScanError, CoreError) as e:
        print("scan.py: %s" % e, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("scan.py: stopped", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
