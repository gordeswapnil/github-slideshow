#!/usr/bin/env python3
"""Results reader for india-analyst. Standard library only.

Reads a company's quarterly results as NSE lists them (NSE's results
comparison) and lays out what changed, quarter by quarter: net sales (revenue
from operations), total income, net profit, net margin and diluted EPS, each
against the same quarter a year earlier and the quarter before, with the
trailing twelve months. It also reads NSE's list of results filings to tell
standalone from consolidated, when each result was released (during market
hours or not) and where the filing is.

    python3 results.py RELIANCE
    python3 results.py RELIANCE TCS --quarters 8
    python3 results.py SYNTH --file results.json --filings-file filings.json
    python3 results.py RELIANCE --json
    python3 results.py RELIANCE TCS --metrics trader-india/metrics.json

Sources (NSE; no key, but a browser session: the tool loads
https://www.nseindia.com/ once for its cookies, then asks, at least a second
apart):
  https://www.nseindia.com/api/results-comparision?symbol=<SYMBOL>   (NSE's spelling)
  https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&symbol=<SYMBOL>
NSE's bot protection often refuses scripts (HTTP 403, or no answer). Then open
those URLs in your own browser, save each page as a .json file and pass them
with --file PATH (results comparison) and --filings-file PATH (filings list).
NSE's terms of use restrict automated collection: keep requests occasional.

How the table is built:
  - A quarter is a row covering about three months (80 to 100 days). Rows for
    six, nine or twelve months are left out and counted in a note.
  - Quarters are labelled on India's April-March financial year: the quarter
    ending 31 December 2025 is Q3 FY26.
  - Figures are printed as NSE shows them (usually rupees in lakh; check the
    filing). EPS is in rupees for the quarter, not annualised.
  - Standalone or consolidated: the comparison rows do not say. When a row's
    re_seq_num matches a seqNumber in the filings list, that filing's
    "consolidated" field labels it. Otherwise the basis is "not stated".
  - When a period appears twice for the same basis, the row NSE created last wins.

--metrics FILE merges one row per symbol into a JSON file (TTM net sales, net
profit and EPS, net margin, growth). Offline: --offline DIR reads
results-comparision-<SYMBOL>.json and financial-results-<SYMBOL>.json from DIR.

Numbers only: this tool never says whether a stock is a buy.
"""

import argparse
import datetime as _dt
import gzip
import http.client
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
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
NSE_RESULTS_PAGE = "https://www.nseindia.com/companies-listing/corporate-filings-financial-results"
RESULTS_URL = "https://www.nseindia.com/api/results-comparision?symbol=%s"
FILINGS_URL = ("https://www.nseindia.com/api/corporates-financial-results?index=equities"
               "&period=Quarterly&symbol=%s")
NSE_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
          "Chrome/124.0.0.0 Safari/537.36")
NSE_PAUSE = 1.0
UNITS = "as NSE shows them (usually ₹ lakh; check the filing)"
SOURCE = "NSE results comparison"

# NSE's field names for each figure, tried in order (the first one with a number wins).
FIELDS = {
    "net_sales": ("re_net_sale",),
    "total_income": ("re_total_inc", "re_tot_inc"),
    "net_profit": ("re_net_profit", "re_con_pro_loss", "re_proloss_ord_act"),
    "eps_diluted": ("re_dilut_eps_for_cont_dic_opr", "re_diluted_eps", "re_dil_eps_bfr_exi"),
    "eps_basic": ("re_basic_eps_for_cont_dic_opr", "re_basic_eps", "re_bsc_eps_bfr_exi"),
    "other_income": ("re_oth_inc_new", "re_oth_inc"),
    "pbt": ("re_pro_loss_bef_tax",),
    "exceptional": ("re_excepn_items_new", "re_excepn_items"),
    "face_value": ("re_face_val",),
}
AUDIT_CODES = {"U": "unaudited", "A": "audited"}   # re_res_type: meaning inferred, not documented
OTHER_INCOME_FLAG = 25.0   # flag other income above this share of profit before tax (percent)


class ResultsError(Exception):
    pass


class Blocked(ResultsError):
    pass


def nse_help(urls, why):
    return ("%s. NSE's bot protection often refuses scripts. Open %s in your own browser (load "
            "https://www.nseindia.com/ first), save the page as a .json file and run again with "
            "--file PATH (and --filings-file PATH for the filings list)" % (why, " and ".join(urls)))


class Fetcher(object):
    def __init__(self, offline=None, nse_pause=NSE_PAUSE, timeout=20):
        self.offline = offline
        self.nse_pause = max(float(nse_pause), NSE_PAUSE)
        self.timeout = timeout
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.warmed = False
        self._last = 0.0

    def _open(self, url, headers):
        wait = self.nse_pause - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()
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

    def json(self, url, name, required=True):
        """One NSE API call (after one cookie warm-up), or a file from --offline DIR.
        A missing optional offline file gives None."""
        if self.offline:
            path = os.path.join(self.offline, name)
            if not os.path.isfile(path):
                if required:
                    raise ResultsError("offline: no file %s" % path)
                return None
            return load_file(path)
        headers = {"User-Agent": NSE_UA, "Accept": "application/json, text/plain, */*",
                   "Accept-Language": "en-IN,en;q=0.9", "Accept-Encoding": "gzip, deflate",
                   "Referer": NSE_RESULTS_PAGE}
        try:
            if not self.warmed:
                self._open(NSE_HOME, dict(headers, Accept="text/html,application/xhtml+xml,*/*;q=0.8"))
                self.warmed = True
            data = self._open(url, headers)
        except urllib.error.HTTPError as exc:
            raise Blocked(nse_help([url], "NSE answered HTTP %s" % exc.code))
        except urllib.error.URLError as exc:
            raise Blocked(nse_help([url], "could not reach NSE (%s)" % exc.reason))
        except (OSError, http.client.HTTPException) as exc:
            raise Blocked(nse_help([url], "NSE did not answer (%s)" % (str(exc) or exc.__class__.__name__)))
        try:
            return json.loads(data.decode("utf-8-sig"))
        except ValueError:
            raise Blocked(nse_help([url], "NSE sent a page that is not JSON (its bot check)"))


def load_file(path):
    try:
        with open(path, encoding="utf-8-sig") as fh:
            return json.load(fh)
    except OSError as exc:
        raise ResultsError("could not read %s: %s" % (path, exc))
    except ValueError:
        raise ResultsError("%s is not JSON. Save the API URL's page itself, not the NSE web page "
                           "around it" % path)


# ---------------------------------------------------------------- parsing

def num(v):
    """'12826000' -> 12826000.0; '', '-', None -> None."""
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    if s in ("", "-", "--", "NA", "N.A.", "null"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def ndate(text):
    """'01-OCT-2024', '01-Oct-2024', '2024-10-01' -> date, or None."""
    s = str(text or "").strip()
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d-%b-%Y %H:%M:%S"):
        try:
            return _dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def ntime(text):
    """'21-Oct-2026 16:42:10' (India time) -> naive datetime in India time, or None."""
    s = str(text or "").strip()
    for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return _dt.datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def quarter_label(end):
    """India's April-March year: a quarter ending 2025-12-31 is 'Q3 FY26'."""
    q = ((end.month - 4) % 12) // 3 + 1
    fy = end.year + 1 if end.month >= 4 else end.year
    return "Q%d FY%02d" % (q, fy % 100)


def pick(rec, key):
    for f in FIELDS[key]:
        v = num(rec.get(f))
        if v is not None:
            return v, f
    return None, None


def basis_of(text):
    t = str(text or "").strip().lower()
    if not t:
        return None
    if t.startswith("non") or "standalone" in t:
        return "standalone"
    if "consolidated" in t:
        return "consolidated"
    return t


def records(doc, where="results comparison"):
    if isinstance(doc, dict) and isinstance(doc.get("resCmpData"), list):
        return [r for r in doc["resCmpData"] if isinstance(r, dict)]
    raise ResultsError("%s has no resCmpData list (is it NSE's results-comparision JSON?)" % where)


def filing_list(doc):
    """NSE's results filings list -> list of dicts, newest broadcast first."""
    if doc is None:
        return []
    if isinstance(doc, dict) and isinstance(doc.get("data"), list):
        doc = doc["data"]
    if not isinstance(doc, list):
        raise ResultsError("the filings list is not a list (is it NSE's corporates-financial-results JSON?)")
    out = []
    for r in doc:
        if not isinstance(r, dict):
            continue
        out.append({"seq": str(r.get("seqNumber") or "").strip() or None,
                    "symbol": r.get("symbol"), "company": r.get("companyName"),
                    "start": ndate(r.get("fromDate")), "end": ndate(r.get("toDate")),
                    "relating_to": r.get("relatingTo"), "basis": basis_of(r.get("consolidated")),
                    "audited": r.get("audited"), "broadcast": ntime(r.get("broadCastDate")),
                    "xbrl": r.get("xbrl") if str(r.get("xbrl") or "").startswith("http") else None,
                    "period": r.get("period")})
    out.sort(key=lambda f: f["broadcast"] or _dt.datetime.min, reverse=True)
    return out


def parse_rows(doc, filings=None):
    """resCmpData -> (quarter rows, count of rows that are not quarters, fields used)."""
    by_seq = {f["seq"]: f for f in (filings or []) if f["seq"]}
    rows, other, used = [], [], {}
    for r in records(doc):
        start, end = ndate(r.get("re_from_dt")), ndate(r.get("re_to_dt"))
        if not start or not end:
            continue
        if not 80 <= (end - start).days <= 100:
            other.append((start, end))
            continue
        row = {"start": start.isoformat(), "end": end.isoformat(), "quarter": quarter_label(end),
               "seq": str(r.get("re_seq_num") or "").strip() or None,
               "created": (ndate(r.get("re_create_dt")) or _dt.date.min).isoformat(),
               "res_type": (str(r.get("re_res_type") or "").strip() or None)}
        for key in FIELDS:
            row[key], f = pick(r, key)
            if f:
                used.setdefault(key, [])
                if f not in used[key]:
                    used[key].append(f)
        row["alt_profit"] = num(r.get("re_con_pro_loss"))
        f = by_seq.get(row["seq"])
        row["basis"] = f["basis"] if f else None
        row["filing"] = f
        rows.append(row)
    return rows, other, used


# ---------------------------------------------------------------- analysis

def growth(a, b):
    """Percent change; None when either is missing, the base is zero, or the sign flips."""
    if a is None or b is None or b == 0 or (a < 0) != (b < 0):
        return None
    return round(100.0 * (a - b) / abs(b), 1)


def margin(part, whole):
    if part is None or not whole:
        return None
    return round(100.0 * part / whole, 1)


def _d(s):
    return _dt.date.fromisoformat(s)


def _match(rows, end, days, slack=10):
    target = _d(end) - _dt.timedelta(days=days)
    best = None
    for r in rows:
        gap = abs((_d(r["end"]) - target).days)
        if gap <= slack and (best is None or gap < best[0]):
            best = (gap, r)
    return best[1] if best else None


def dedupe_rows(rows):
    """One row per period: the one NSE created last (a restatement wins)."""
    keep, notes = {}, []
    for r in rows:
        k = r["end"]
        if k not in keep or (r["created"], r["seq"] or "") > (keep[k]["created"], keep[k]["seq"] or ""):
            if k in keep:
                notes.append(k)
            keep[k] = r
        else:
            notes.append(k)
    out = []
    for k in sorted(set(notes)):
        n = len([r for r in rows if r["end"] == k])
        out.append("NSE lists %d rows for the quarter ending %s; the one created %s is used." % (
            n, k, keep[k]["created"]))
    return sorted(keep.values(), key=lambda r: r["end"], reverse=True), out


def analyse(rows, quarters=6, basis=None, other_rows=0, fields=None, banking=None):
    """Every number in the report for one basis, as a dict."""
    rows, notes = dedupe_rows(rows)
    if not rows:
        raise ResultsError("no quarterly rows in NSE's results comparison")
    allrows = rows
    shown = rows[:quarters]
    out_rows = []
    for r in shown:
        base, base_name = r["net_sales"], "net sales"
        if not base:
            base, base_name = r["total_income"], "total income"
        yoy = _match(allrows, r["end"], 365)
        qoq = _match(allrows, r["end"], 91, slack=12)
        same_face = lambda p: p is not None and (p["face_value"] is None or r["face_value"] is None
                                                 or p["face_value"] == r["face_value"])
        row = dict(r)
        row.pop("filing", None)
        row.update({
            "net_margin": margin(r["net_profit"], base), "margin_base": base_name,
            "net_sales_yoy": growth(r["net_sales"], (yoy or {}).get("net_sales")),
            "net_sales_qoq": growth(r["net_sales"], (qoq or {}).get("net_sales")),
            "total_income_yoy": growth(r["total_income"], (yoy or {}).get("total_income")),
            "net_profit_yoy": growth(r["net_profit"], (yoy or {}).get("net_profit")),
            "net_profit_qoq": growth(r["net_profit"], (qoq or {}).get("net_profit")),
            "eps_yoy": growth(r["eps_diluted"], yoy["eps_diluted"]) if same_face(yoy) else None,
            "eps_qoq": growth(r["eps_diluted"], qoq["eps_diluted"]) if same_face(qoq) else None,
            "year_ago": yoy["end"] if yoy else None, "quarter_before": qoq["end"] if qoq else None,
            "year_ago_net_profit": (yoy or {}).get("net_profit"),
            "face_value_changed": bool(yoy and not same_face(yoy)) or bool(qoq and not same_face(qoq)),
            "audit": AUDIT_CODES.get((r["res_type"] or "").upper(), r["res_type"]),
        })
        out_rows.append(row)
    ttm, ttm_notes = {}, []
    last4 = allrows[:4]
    if len(last4) == 4 and (_d(last4[0]["end"]) - _d(last4[-1]["end"])).days < 300:
        ttm["from"], ttm["to"] = last4[-1]["quarter"], last4[0]["quarter"]
        for key in ("net_sales", "total_income", "net_profit", "eps_diluted"):
            vals = [r[key] for r in last4]
            if all(v is not None for v in vals):
                ttm[key] = round(sum(vals), 2)
        faces = {r["face_value"] for r in last4 if r["face_value"] is not None}
        if len(faces) > 1 and "eps_diluted" in ttm:
            del ttm["eps_diluted"]
            ttm_notes.append("No trailing EPS: the face value changed inside the last four quarters "
                             "(a split or consolidation), so the quarters' EPS do not add up.")
    if other_rows:
        notes.append("NSE also lists %d row%s that %s not a quarter (half-year, nine months or a year): "
                     "left out of the table." % (other_rows, "" if other_rows == 1 else "s",
                                                 "is" if other_rows == 1 else "are"))
    return {"basis": basis, "rows": out_rows, "ttm": ttm, "notes": notes + ttm_notes,
            "fields": fields or {}, "banking": banking, "units": UNITS}


def analyse_all(doc, filings=None, quarters=6, basis=None):
    """One analysis per basis found (consolidated first), or one with basis None."""
    flist = filing_list(filings)
    rows, other, used = parse_rows(doc, flist)
    banking = doc.get("bankNonBnking") if isinstance(doc, dict) else None
    labelled = {r["basis"] for r in rows if r["basis"]}
    groups = {}
    if len(labelled) == 1:
        only = labelled.pop()
        matched = len([r for r in rows if r["basis"]])
        for r in rows:
            r["basis"] = only
        groups[only] = rows
        how = ("from NSE's filings list (%d of %d quarters matched by sequence number)" % (matched, len(rows)))
    else:
        for r in rows:
            groups.setdefault(r["basis"], []).append(r)
        how = "from NSE's filings list (matched by sequence number)" if labelled else None
    if basis:
        groups = {k: v for k, v in groups.items() if k == basis}
        if not groups:
            raise ResultsError("no %s rows: NSE's comparison rows here are %s" % (
                basis, ", ".join(sorted(str(b or "basis not stated") for b in labelled)) or "basis not stated"))
    order = sorted(groups, key=lambda b: (b != "consolidated", b != "standalone", str(b)))
    out = []
    for b in order:
        res = analyse(groups[b], quarters, b, len(other), used, banking)
        res["basis_source"] = how if b else None
        res["filings"] = filings_summary(flist, res)
        res["changes"] = changes(res)
        out.append(res)
    return out


def release_timing(local):
    """When a result came out, against the NSE session (India time)."""
    if local is None:
        return None
    ok, why = trading_day(local.date())
    if not ok:
        return "on a non-trading day (%s)" % why
    t = local.time()
    if t < PRE_OPEN:
        return "before the open"
    if t < OPEN:
        return "during the pre-open"
    if t < CLOSE:
        return "during market hours"
    return "after the close"


def filings_summary(flist, res):
    """The latest quarter's filings, release times, and a note when NSE's comparison lags."""
    if not flist:
        return None
    rows = res["rows"]
    latest_end = rows[0]["end"] if rows else None
    quarterly = [f for f in flist if f["start"] and f["end"] and 80 <= (f["end"] - f["start"]).days <= 100]
    if not quarterly:
        return None
    newest_end = max(f["end"] for f in quarterly)
    newest = [f for f in quarterly if f["end"] == newest_end]

    def show(f):
        return {"quarter": quarter_label(f["end"]), "end": f["end"].isoformat(), "basis": f["basis"],
                "audited": f["audited"], "relating_to": f["relating_to"], "seq": f["seq"],
                "broadcast": f["broadcast"].strftime("%Y-%m-%d %H:%M") if f["broadcast"] else None,
                "timing": release_timing(f["broadcast"]), "xbrl": f["xbrl"]}

    same_basis = [f for f in quarterly if not res["basis"] or f["basis"] == res["basis"]]
    history = [show(f) for f in sorted(same_basis, key=lambda f: f["end"], reverse=True)]
    stale = None
    if latest_end and newest_end > _d(latest_end) + _dt.timedelta(days=20):
        f = sorted(newest, key=lambda x: (x["basis"] != res["basis"], ))[0]
        stale = ("NSE's results comparison stops at %s, but a %sresults filing for the period ending %s "
                 "was broadcast %s IST (%s). Read it directly: %s" % (
                     latest_end, (f["basis"] + " ") if f["basis"] else "", f["end"].isoformat(),
                     f["broadcast"].strftime("%Y-%m-%d %H:%M") if f["broadcast"] else "(time unknown)",
                     release_timing(f["broadcast"]) or "time unknown", f["xbrl"] or NSE_RESULTS_PAGE))
    return {"latest": [show(f) for f in newest], "history": history, "stale": stale,
            "company": next((f["company"] for f in flist if f["company"]), None)}


# ---------------------------------------------------------------- words

def amt(v, decimals=2):
    """A figure as NSE shows it, Indian digit grouping, no unit."""
    if v is None:
        return "-"
    return inr(v, decimals).replace("₹", "")


def crore(v):
    return "n/a" if v is None else inr(v / 100.0, 2) + " crore"


def changes(res):
    """Plain sentences: what changed in the latest quarter."""
    rows = res["rows"]
    if not rows:
        return []
    cur = rows[0]
    dec = _decimals(rows)
    prev = next((r for r in rows if r["end"] == cur["quarter_before"]), None)
    out = []
    line = "Quarter ending %s (%s): net sales %s" % (cur["end"], cur["quarter"], amt(cur["net_sales"], dec))
    if cur["net_sales_yoy"] is not None:
        line += " (%+.1f%% vs a year earlier)" % cur["net_sales_yoy"]
    line += ", net profit %s" % amt(cur["net_profit"], dec)
    if cur["net_profit_yoy"] is not None:
        line += " (%+.1f%%)" % cur["net_profit_yoy"]
    if cur["eps_diluted"] is not None:
        line += ", diluted EPS %s" % inr(cur["eps_diluted"])
        if cur["eps_yoy"] is not None:
            line += " (%+.1f%%)" % cur["eps_yoy"]
    out.append(line + ".")
    if cur["net_sales"] is not None or cur["net_profit"] is not None:
        out.append("If these figures are in ₹ lakh (NSE's usual unit), that is net sales of %s and net "
                   "profit of %s." % (crore(cur["net_sales"]), crore(cur["net_profit"])))
    ya = cur.get("year_ago_net_profit")
    if cur["net_profit"] is not None and ya is not None and (cur["net_profit"] < 0) != (ya < 0):
        out.append("Net profit swung from %s a year earlier to %s: a percent change is not meaningful." % (
            ("a loss of " + amt(-ya, dec)) if ya < 0 else ("a profit of " + amt(ya, dec)),
            ("a loss of " + amt(-cur["net_profit"], dec)) if cur["net_profit"] < 0
            else ("a profit of " + amt(cur["net_profit"], dec))))
    elif cur["net_profit"] is not None and cur["net_profit"] < 0:
        out.append("The quarter is a net loss.")
    if cur["net_margin"] is not None:
        s = "Net margin %.1f%%" % cur["net_margin"]
        if cur["margin_base"] != "net sales":
            s += " (on total income: no net sales figure)"
        if prev and prev["net_margin"] is not None:
            s += " (%+.1f points vs the quarter before)" % (cur["net_margin"] - prev["net_margin"])
        out.append(s + ".")
    if cur["exceptional"]:
        out.append("Exceptional items of %s are inside this quarter's profit (NSE's figure; check its "
                   "sign and note in the filing): read them before treating the profit change as growth."
                   % amt(cur["exceptional"], dec))
    if cur["other_income"] and cur["pbt"] and cur["pbt"] > 0:
        share = 100.0 * cur["other_income"] / cur["pbt"]
        if share > OTHER_INCOME_FLAG:
            out.append("Other income of %s is %.0f%% of profit before tax: part of the profit does not "
                       "come from the business." % (amt(cur["other_income"], dec), share))
    if cur["alt_profit"] is not None and cur["net_profit"] is not None \
            and abs(cur["alt_profit"] - cur["net_profit"]) > 0.005:
        out.append("NSE shows a second profit figure (re_con_pro_loss) of %s against net profit %s; "
                   "the gap is often minority interest or associates, but NSE does not document it: "
                   "check the filing." % (amt(cur["alt_profit"], dec), amt(cur["net_profit"], dec)))
    if cur["face_value_changed"]:
        out.append("The face value changed between the quarters compared (a split, bonus or "
                   "consolidation): EPS on either side are not comparable, so EPS growth is left blank.")
    if prev and cur["net_sales"] is not None and prev["net_sales"]:
        out.append("Net sales %+.1f%% vs the quarter before (many businesses are seasonal: compare with "
                   "a year earlier first)." % growth(cur["net_sales"], prev["net_sales"]))
    return out


def _p(v):
    return "-" if v is None else "%+.1f%%" % v if v else "0.0%"


def _pm(v):
    return "-" if v is None else "%.1f%%" % v


def _decimals(rows):
    vals = [r[k] for r in rows for k in ("net_sales", "total_income", "net_profit") if r[k] is not None]
    return 0 if all(float(v).is_integer() for v in vals) else 2


def render(symbol, res, name=None):
    basis = res["basis"] or "basis not stated"
    head = "%s (%s), %s, %s." % (name or symbol, symbol, SOURCE, basis)
    out = [head, "Figures %s; EPS in ₹ for the quarter." % UNITS]
    if res.get("basis_source"):
        out.append("Basis %s." % res["basis_source"])
    elif not res["basis"]:
        out.append("NSE's comparison rows do not say standalone or consolidated, and none matched a "
                   "filing in NSE's results list: check the filing before comparing with other sources.")
    out.append("")
    dec = _decimals(res["rows"])
    out.append("%-8s %-10s %13s %7s %7s %13s %12s %7s %6s %8s %7s %-9s %s" % (
        "quarter", "period end", "net sales", "yoy", "qoq", "total inc", "net profit", "yoy",
        "margin", "EPS dil", "yoy", "audit", "NSE row"))
    for r in res["rows"]:
        out.append("%-8s %-10s %13s %7s %7s %13s %12s %7s %6s %8s %7s %-9s %s" % (
            r["quarter"], r["end"], amt(r["net_sales"], dec), _p(r["net_sales_yoy"]), _p(r["net_sales_qoq"]),
            amt(r["total_income"], dec), amt(r["net_profit"], dec), _p(r["net_profit_yoy"]),
            _pm(r["net_margin"]), "-" if r["eps_diluted"] is None else "%.2f" % r["eps_diluted"],
            _p(r["eps_yoy"]), r["audit"] or "-", r["created"]))
    t = res["ttm"]
    if t:
        out.append("")
        out.append("Last 4 quarters (%s to %s): net sales %s, total income %s, net profit %s, diluted EPS %s "
                   "(sums of the quarters)." % (
                       t["from"], t["to"], amt(t.get("net_sales"), dec), amt(t.get("total_income"), dec),
                       amt(t.get("net_profit"), dec),
                       inr(t["eps_diluted"]) if t.get("eps_diluted") is not None else "-"))
    out.append("")
    out.append("What changed:")
    for line in res["changes"]:
        out.append("  - " + line)
    f = res.get("filings")
    if f:
        out.append("")
        out.append("Results filings on NSE:")
        for x in f["latest"]:
            out.append("  %s %s, %s: broadcast %s IST (%s)  %s" % (
                x["quarter"], x["basis"] or "basis not stated", x["audited"] or "audit not stated",
                x["broadcast"] or "(time unknown)", x["timing"] or "time unknown",
                x["xbrl"] or NSE_RESULTS_PAGE))
        times = ["%s %s" % (x["quarter"], x["timing"]) for x in f["history"][:6] if x["timing"]]
        if times:
            out.append("  Release times (%s): %s." % (res["basis"] or "all", "; ".join(times)))
        if f["stale"]:
            out.append("")
            out.append("NOTE: " + f["stale"])
    for n in res["notes"]:
        out.append("")
        out.append("Note: " + n)
    return "\n".join(out) + "\n"


def metrics_row(symbol, res, name=None):
    rows = res["rows"]
    cur = rows[0] if rows else {}
    t = res["ttm"]
    return {"symbol": symbol, "name": name, "basis": res["basis"], "period_end": cur.get("end"),
            "quarter": cur.get("quarter"), "units": UNITS,
            "net_sales_ttm": t.get("net_sales"), "total_income_ttm": t.get("total_income"),
            "net_profit_ttm": t.get("net_profit"), "eps_ttm": t.get("eps_diluted"),
            "net_sales_growth_yoy": cur.get("net_sales_yoy"),
            "net_profit_growth_yoy": cur.get("net_profit_yoy"), "eps_growth_yoy": cur.get("eps_yoy"),
            "net_margin": cur.get("net_margin"), "source": SOURCE}


def _json_safe(obj):
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, (_dt.date, _dt.datetime)):
        return obj.isoformat()
    return obj


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("symbols", nargs="*", help="NSE symbols, e.g. RELIANCE TCS M&M")
    ap.add_argument("--quarters", type=int, default=6)
    ap.add_argument("--basis", choices=("standalone", "consolidated"),
                    help="only rows the filings list marks this way")
    ap.add_argument("--no-filings", action="store_true", help="skip NSE's filings list")
    ap.add_argument("--file", metavar="PATH", help="results-comparision JSON saved from your browser (one symbol)")
    ap.add_argument("--filings-file", metavar="PATH",
                    help="corporates-financial-results JSON saved from your browser (one symbol)")
    ap.add_argument("--metrics", metavar="FILE", help="merge a row per symbol into this JSON")
    ap.add_argument("--offline", metavar="DIR")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if not args.symbols:
        ap.print_help()
        return 2
    try:
        symbols = [norm_symbol(s) for s in args.symbols]
    except CoreError as exc:
        print("results: %s" % exc, file=sys.stderr)
        return 2
    if (args.file or args.filings_file) and len(symbols) != 1:
        print("results: --file and --filings-file hold one company's data: give exactly one symbol",
              file=sys.stderr)
        return 2
    fetcher = Fetcher(offline=args.offline)
    done, rows, failed, blocked = [], [], 0, False
    for sym in symbols:
        if blocked:
            print("results: %s: not asked for, after NSE refused the first request" % sym, file=sys.stderr)
            failed += 1
            continue
        q = urllib.parse.quote(sym, safe="")
        try:
            doc = load_file(args.file) if args.file else \
                fetcher.json(RESULTS_URL % q, "results-comparision-%s.json" % sym)
            filings, fnote = None, None
            if args.filings_file:
                filings = load_file(args.filings_file)
            elif not args.no_filings and not args.file:
                try:
                    filings = fetcher.json(FILINGS_URL % q, "financial-results-%s.json" % sym, required=False)
                except Blocked as exc:
                    fnote = "NSE's filings list: %s" % exc
            results = analyse_all(doc, filings, args.quarters, args.basis)
        except Blocked as exc:
            print("results: %s: %s" % (sym, exc), file=sys.stderr)
            blocked = True
            failed += 1
            continue
        except ResultsError as exc:
            print("results: %s: %s" % (sym, exc), file=sys.stderr)
            failed += 1
            continue
        name = next((r["filings"]["company"] for r in results if r.get("filings") and r["filings"]["company"]),
                    None)
        for r in results:
            if fnote:
                r["notes"].append(fnote)
        done.append({"symbol": sym, "name": name, "results": results})
        rows.append(metrics_row(sym, results[0], name))
        if not args.json:
            for r in results:
                sys.stdout.write(render(sym, r, name))
                sys.stdout.write("\n")
    if args.json:
        print(json.dumps(_json_safe(done), indent=2, ensure_ascii=False))
    if args.metrics and rows:
        existing = {}
        if os.path.isfile(args.metrics):
            with open(args.metrics, encoding="utf-8") as fh:
                existing = {r.get("symbol"): r for r in json.load(fh).get("companies", [])}
        for r in rows:
            existing[r["symbol"]] = r
        folder = os.path.dirname(args.metrics)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(args.metrics, "w", encoding="utf-8") as fh:
            json.dump({"as_of": to_ist(utc_now()).date().isoformat(),
                       "companies": sorted(existing.values(), key=lambda r: r["symbol"])},
                      fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        if not args.json:
            print("wrote %s (%d companies)" % (args.metrics, len(existing)))
    return 0 if done and not failed else (1 if done else 2)


if __name__ == "__main__":
    sys.exit(main())
