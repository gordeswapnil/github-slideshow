#!/usr/bin/env python3
"""Price alerts and the NSE clock for india-alerts. India time (IST).
Standard library only.

    python3 alerts.py clock                          # is the NSE open? pre-open, next open / close
    python3 alerts.py quote RELIANCE --write         # quotes -> trader-india/prices.json
    python3 alerts.py quote --holdings --write       # every symbol in your portfolio and plan
    python3 alerts.py add --from-plan                # stop, target and flat-by from trader-india/plan.json
    python3 alerts.py add --symbol SYNTH --stop 358.30
    python3 alerts.py add --symbol SYNTH --target 370.05
    python3 alerts.py add --at 15:00 --label "flat by" --symbol SYNTH
    python3 alerts.py add --symbol INFY --pct 3
    python3 alerts.py add --opening-bell
    python3 alerts.py check                          # rings what hit, once; exit 1 if nothing rang
    python3 alerts.py check --now "2026-10-19 15:00" --offline india-tests/fixtures/india-alerts
    python3 alerts.py list
    python3 alerts.py reset synth-plan-stop

Rule types:
  above / target  the price is at or above "price"
  below / stop    the price is at or below "price"
  pct_move        the price moved "pct" percent or more from the previous close
                  (or from "ref" if you give one); "direction": "up" or "down"
  opening_bell    the NSE normal market opened today (09:15; rings once per trading day)
  time            the India clock passed "at" (HH:MM, 24-hour IST) on a trading
                  day (rings once per trading day)

A rule with "date" is only watched on that India date (rules from a plan are
for the plan's day only). An above / below alert rings ONCE and then stays
quiet until you reset it, unless the rule has "rearm": true (it re-arms when
the price crosses back). A pct_move alert rings at most once per day.

Quotes (free, delayed, unofficial; for alerts only, never for timing an order):
  https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=1d
  (the NSE symbol plus .NS, URL-encoded: M&M is M%26M.NS). Falls back to query1
  on a 429 or a 5xx; one retry with a pause on a 429; one request per symbol,
  half a second apart. --offline DIR reads DIR/yahoo-<SYMBOL>.json (or .json.gz).
  Yahoo does not carry the stock's price band (circuit limits) or its series.

NSE calendar: the shared core's (normal market 09:15-15:30 IST, pre-open call
auction 09:00-09:15, the 2026 NSE holidays, plus any dates in
trader-india/holidays.json). India has no daylight saving. For a year the
list does not cover (2027 until NSE publishes it in December) the clock says so.
"""

import argparse
import datetime
import gzip
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

UA = "Mozilla/5.0 (compatible; india-day-trader-skill/1.0)"
PAUSE = 0.5    # seconds between requests: be polite to free endpoints
BACKOFF = 2.0  # seconds to wait before the one retry after a 429
YAHOO_HOSTS = ("query2.finance.yahoo.com", "query1.finance.yahoo.com")
HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
DEFAULT_FLAT_BY = "15:00"
SQUARE_OFF = "15:10"     # Angel One and Dhan square off intraday (MIS) positions (from 2026-08-03)
RULES_FILE = os.path.join(DATA_DIR, "alerts.json")
STATE_FILE = os.path.join(DATA_DIR, "state", "alerts.json")
PRICES_FILE = os.path.join(DATA_DIR, "prices.json")
PLAN_FILE = os.path.join(DATA_DIR, "plan.json")
PORTFOLIO_FILE = os.path.join(DATA_DIR, "portfolio.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")


class AlertError(CoreError):
    pass


def calendar_note(day):
    return ("The NSE holiday list covers %s only, not %d: NSE publishes the next year's list in December. Add it "
            "to %s as {\"%d-01-26\": \"Republic Day\", ...} so holidays are known; until then every weekday "
            "counts as open." % (" and ".join(map(str, CALENDAR_YEARS)), day.year, HOLIDAYS_FILE, day.year))


# ---------------------------------------------------------------- quotes (Yahoo chart JSON, SYMBOL.NS)

def yahoo_url(sym, host=YAHOO_HOSTS[0]):
    return "https://%s/v8/finance/chart/%s?range=1d&interval=1d" % (
        host, urllib.parse.quote(yahoo_symbol(sym), safe=""))


def parse_yahoo(text, sym):
    sym = norm_symbol(sym)
    try:
        data = json.loads(text)
        res = data["chart"]["result"]
    except (ValueError, KeyError, TypeError):
        raise AlertError("Yahoo returned something unexpected for %s" % sym)
    if not res:
        err = (data.get("chart") or {}).get("error") or {}
        raise AlertError("Yahoo has no data for %s: %s" % (sym, err.get("description", "unknown symbol")))
    m = res[0].get("meta", {})
    held = from_yahoo(m.get("symbol") or yahoo_symbol(sym))
    if held != sym:
        raise AlertError("the quote for %s holds %s" % (sym, held))
    price = m.get("regularMarketPrice")
    if price is None:
        raise AlertError("Yahoo has no price for %s" % sym)
    t = m.get("regularMarketTime")
    when = (datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if t else "")
    q = (res[0].get("indicators", {}).get("quote") or [{}])[0]
    opens = [x for x in (q.get("open") or []) if x is not None]
    return {"symbol": sym, "price": float(price), "open": opens[0] if opens else None,
            "high": m.get("regularMarketDayHigh"), "low": m.get("regularMarketDayLow"),
            "prev_close": m.get("previousClose") or m.get("chartPreviousClose"), "time": when,
            "currency": m.get("currency"), "source": "yahoo"}


_urlopen = urllib.request.urlopen   # tests swap these two
_sleep = time.sleep


def _get(url, timeout=20):
    """(HTTP status, body). A network failure is an AlertError."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with _urlopen(req, timeout=timeout) as r:
            return 200, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        finally:
            try:
                e.close()
            except Exception:
                pass
        return e.code, body
    except urllib.error.URLError as e:
        raise AlertError("could not reach %s: %s" % (url.split("/")[2], e.reason))


def fetch_yahoo(sym, timeout=20):
    """query2 first. A 429 waits BACKOFF seconds and tries once more; a 429 or a 5xx
    after that moves on to query1. A 404 comes back as Yahoo's own error JSON."""
    last = None
    for host in YAHOO_HOSTS:
        url = yahoo_url(sym, host)
        code, text = _get(url, timeout)
        if code == 429:
            _sleep(BACKOFF)
            code, text = _get(url, timeout)
        if code == 200:
            return text
        if code == 404 and text.strip().startswith("{"):
            return text
        last = (url, code)
        if code != 429 and code < 500:
            break
    raise AlertError("%s answered HTTP %d" % (last[0].split("?")[0], last[1]))


def _offline_text(folder, sym):
    base = os.path.join(folder, "yahoo-%s.json" % sym)
    if os.path.exists(base):
        with open(base, encoding="utf-8") as fh:
            return fh.read()
    if os.path.exists(base + ".gz"):
        with gzip.open(base + ".gz", "rt", encoding="utf-8") as fh:
            return fh.read()
    raise AlertError("no offline quote file %s" % base)


def get_quotes(symbols, offline=None, pause=PAUSE):
    """{SYMBOL: quote} and [errors]. One request per symbol, with a pause between."""
    quotes, errors = {}, []
    asked = 0
    for raw in symbols:
        try:
            sym = norm_symbol(raw)
            if offline:
                text = _offline_text(offline, sym)
            else:
                if asked and pause:
                    _sleep(pause)
                asked += 1
                text = fetch_yahoo(sym)
            quotes[sym] = parse_yahoo(text, sym)
        except CoreError as e:
            errors.append(str(e))
    return quotes, errors


def write_prices(path, quotes, now_utc):
    old = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                old = json.load(fh)
        except (ValueError, OSError):
            old = {}
    prices = dict(old.get("prices", {}))
    detail = dict(old.get("detail", {}))
    stamp = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    for s, q in quotes.items():
        prices[s] = q["price"]
        detail[s] = {"prev_close": q.get("prev_close"), "time": q.get("time"), "source": q.get("source"),
                     "fetched": stamp}
    doc = {"as_of": stamp, "source": "yahoo", "currency": "INR",
           "note": ("Delayed NSE quotes (rupees) for alerts and sizing checks. Your broker's price is the one that "
                    "fills. detail.fetched is when each price was read."),
           "prices": prices, "detail": detail}
    _write(path, doc)
    return doc


def _write(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def _read(path, default):
    if not path or not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise AlertError("%s is not valid JSON: %s" % (path, e))


# ---------------------------------------------------------------- rules

PRICE_TYPES = {"above", "below", "stop", "target", "pct_move", "opening_bell", "time"}
NO_QUOTE = {"opening_bell", "time"}


def _hhmm(text):
    m = HHMM.match(str(text or "").strip())
    if not m:
        return None
    return datetime.time(int(m.group(1)), int(m.group(2)))


def validate(rule):
    t = rule.get("type")
    if t not in PRICE_TYPES:
        raise AlertError("rule %s: unknown type %r" % (rule.get("id"), t))
    if t not in NO_QUOTE and not rule.get("symbol"):
        raise AlertError("rule %s needs a symbol" % rule.get("id"))
    if rule.get("symbol"):
        norm_symbol(rule["symbol"])
    if t in ("above", "below", "stop", "target") and not isinstance(rule.get("price"), (int, float)):
        raise AlertError("rule %s needs a numeric price" % rule.get("id"))
    if t == "pct_move" and not isinstance(rule.get("pct"), (int, float)):
        raise AlertError("rule %s needs a numeric pct" % rule.get("id"))
    if t == "time" and _hhmm(rule.get("at")) is None:
        raise AlertError("rule %s needs \"at\" as a 24-hour India time like \"15:00\"" % rule.get("id"))
    if rule.get("date") and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(rule["date"])):
        raise AlertError("rule %s: date must be YYYY-MM-DD" % rule.get("id"))


def active(rule, today):
    """A rule with a "date" is watched on that India date only."""
    return not rule.get("date") or str(rule["date"]) == today


def _rang_today(stamp, today):
    """Did a rule that rang at this UTC stamp ring on this India date?"""
    if not stamp:
        return False
    try:
        utc = datetime.datetime.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return stamp[:10] == today
    return to_ist(utc).date().isoformat() == today


def evaluate(rules, quotes, status, state, now_utc):
    """Pure function. Returns (rings, new_state). Each ring: {id, symbol, message}."""
    state = json.loads(json.dumps(state or {}))
    rung = state.setdefault("rung", {})
    today = status["date"]
    local = to_ist(now_utc)
    stamp = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    rings = []
    for r in rules:
        validate(r)
        rid = r.get("id") or "%s-%s" % (r.get("symbol", "market"), r["type"])
        if not active(r, today):
            continue
        typ = {"stop": "below", "target": "above"}.get(r["type"], r["type"])
        if typ == "opening_bell":
            if status["open"] and not _rang_today(rung.get(rid), today):
                rings.append({"id": rid, "symbol": "", "message": "Opening bell: the NSE normal market is open "
                              "(%s India time, closes at %s)." % (status["now_india"], status["closes"])})
                rung[rid] = stamp
            continue
        if typ == "time":
            at = _hhmm(r.get("at"))
            if status.get("opens") and local.time() >= at and not _rang_today(rung.get(rid), today):
                label = r.get("label") or "time alert"
                msg = "%s%s: it is %s India time (set for %s)" % (label[:1].upper(), label[1:],
                                                                  local.strftime("%H:%M"), at.strftime("%H:%M"))
                msg += (", the market closes at %s." % status["closes"]) if status["open"] else \
                    ", the market has closed."
                sym = norm_symbol(r["symbol"]) if r.get("symbol") else ""
                if sym:
                    msg += (" If %s is still open, close it: india-broker flatten --symbol %s builds the sell "
                            "ticket, then india-risk and your yes. Brokers such as Angel One and Dhan square off "
                            "intraday (MIS) positions at %s themselves, with a charge." % (sym, sym, SQUARE_OFF))
                rings.append({"id": rid, "symbol": sym, "message": msg})
                rung[rid] = stamp
            continue
        sym = norm_symbol(r["symbol"])
        q = quotes.get(sym)
        if not q:
            continue
        p = q["price"]
        if typ in ("above", "below"):
            hit = p >= r["price"] if typ == "above" else p <= r["price"]
            if hit and rid not in rung:
                word = "at or above" if typ == "above" else "at or below"
                label = {"stop": "stop", "target": "target"}.get(r["type"], "alert level")
                rings.append({"id": rid, "symbol": sym, "message": "%s %s %s: %s your %s %s%s."
                              % (sym, "is" if status["open"] else "last", inr(p), word, label, inr(r["price"]),
                                 (" (" + r["note"] + ")") if r.get("note") else "")})
                rung[rid] = stamp
            elif not hit and rid in rung and r.get("rearm"):
                del rung[rid]
        elif typ == "pct_move":
            ref = r.get("ref") or q.get("prev_close") or q.get("open")
            if not ref:
                continue
            move = 100.0 * (p / float(ref) - 1)
            want = r.get("direction")
            hit = abs(move) >= r["pct"] and (not want or (want == "up") == (move > 0))
            if hit and not _rang_today(rung.get(rid), today):
                rings.append({"id": rid, "symbol": sym, "message": "%s moved %+.2f%% to %s (from %s)."
                              % (sym, move, inr(p), inr(float(ref)))})
                rung[rid] = stamp
    state["last_check"] = stamp
    return rings, state


def _n(x):
    x = float(x)
    return str(int(x)) if x == int(x) else "%.2f" % x


def rules_from_plan(plan, cfg_flat_by=None):
    """trader-india/plan.json -> a stop alert, a target alert and a flat-by time alert, for the plan's day."""
    if not isinstance(plan, dict) or not plan.get("symbol"):
        raise AlertError("the plan has no symbol (run india-exit first)")
    if plan.get("exchange") and str(plan["exchange"]).upper() != "NSE":
        raise AlertError("the plan is for %s, not NSE (run india-exit)" % plan["exchange"])
    if plan.get("timezone") and str(plan["timezone"]).upper() != "IST":
        raise AlertError("the plan's times are %s, not India time (run india-exit)" % plan["timezone"])
    sym = norm_symbol(plan["symbol"])
    out = []
    for key, typ, word in (("stop", "stop", "plan stop"), ("target", "target", "plan target")):
        v = plan.get(key)
        if not isinstance(v, (int, float)) or v <= 0:
            raise AlertError("the plan has no %s (run india-exit)" % key)
        label = plan.get("%s_label" % key)
        out.append({"id": "%s-plan-%s" % (sym.lower(), key), "symbol": sym, "type": typ, "price": float(v),
                    "note": word + (": " + label if label else "")})
    flat = plan.get("flat_by") or cfg_flat_by or DEFAULT_FLAT_BY
    if _hhmm(flat) is None:
        raise AlertError("the plan's flat_by %r is not a 24-hour India time like 15:00" % flat)
    out.append({"id": "%s-flat-by" % sym.lower(), "symbol": sym, "type": "time", "at": flat,
                "label": "flat by"})
    if plan.get("date"):
        for r in out:
            r["date"] = str(plan["date"])
    return out


# ---------------------------------------------------------------- commands

def holdings(a):
    syms = []
    pf = _read(a.portfolio, {})
    for p in pf.get("positions", []) if isinstance(pf, dict) else []:
        syms.append(str(p.get("ticker") or p.get("symbol") or ""))
    plan = _read(a.plan, {})
    if isinstance(plan, dict) and plan.get("symbol"):
        syms.append(str(plan["symbol"]))
    return [s for s in syms if s]


def _dedupe(items):
    out = []
    for s in items:
        if s and s not in out:
            out.append(s)
    return out


def _norm_all(items):
    out = []
    for s in items:
        out.append(norm_symbol(s))
    return _dedupe(out)


def cmd_clock(a):
    now = parse_now(a.now)
    st = market_status(now)
    day = datetime.date.fromisoformat(st["date"])
    end = continuous_end(day, auction_stock=True)
    if st.get("opens") and end < CLOSE:
        st["auction_stocks_end"] = end.strftime("%H:%M")
    if a.json:
        print(json.dumps(st, indent=2))
    else:
        print("India time %s (%s): NSE %s, %s." % (st["now_india"], st["weekday"],
                                                   "OPEN" if st["open"] else "closed", st["reason"]))
        if st.get("opens"):
            print("Today: pre-open call auction %s to %s, normal market %s to %s." % (
                PRE_OPEN.strftime("%H:%M"), st["opens"], st["opens"], st["closes"]))
            if st.get("auction_stocks_end"):
                print("Until %s, stocks in the closing auction session (the F&O stocks) stop continuous trading "
                      "at %s." % (AUCTION_EARLY_END[1].isoformat(), st["auction_stocks_end"]))
        if not st["open"] and st.get("next_open"):
            print("Next open: %s India time." % st["next_open"])
        if not st["calendar_known"]:
            print(calendar_note(day))
    return 0 if st["open"] else 1


def cmd_quote(a):
    syms = _norm_all(list(a.symbols) + (holdings(a) if a.holdings else []))
    if not syms:
        raise AlertError("which symbols? alerts.py quote RELIANCE INFY, or --holdings")
    now = parse_now(a.now)
    quotes, errors = get_quotes(syms, a.offline)
    if a.write and quotes:
        write_prices(a.write, quotes, now)
    if a.json:
        print(json.dumps({"quotes": quotes, "errors": errors}, indent=2))
    else:
        for s in syms:
            q = quotes.get(s)
            if q:
                chg = ""
                if q.get("prev_close"):
                    chg = " (%+.2f%% vs prev close %s)" % (100.0 * (q["price"] / q["prev_close"] - 1),
                                                          inr(q["prev_close"]))
                print("%-10s %s%s  %s  [%s]" % (s, inr(q["price"]), chg, q.get("time", ""), q["source"]))
        for e in errors:
            print("error: " + e)
        if a.write and quotes:
            print("Wrote %d price(s) to %s." % (len(quotes), a.write))
        print("Quotes are free, delayed and unofficial: for alerts only. Your broker's price is the one that fills.")
    return 0 if quotes else 1


def cmd_check(a):
    doc = _read(a.rules, None)
    if not doc or not doc.get("rules"):
        raise AlertError("no rules in %s: add some with alerts.py add --from-plan" % a.rules)
    rules = doc["rules"]
    now = parse_now(a.now)
    status = market_status(now)
    watched = [r for r in rules if active(r, status["date"])]
    syms = _norm_all([str(r.get("symbol", "")) for r in watched if r.get("type") not in NO_QUOTE])
    quotes, errors = (get_quotes(syms, a.offline) if syms else ({}, []))
    state = _read(a.state, {})
    rings, state = evaluate(rules, quotes, status, state, now)
    if not a.no_write:
        _write(a.state, state)
        if quotes:
            write_prices(a.prices_out, quotes, now)
    if a.json:
        print(json.dumps({"market": status, "rings": rings, "errors": errors,
                          "quotes": {s: q["price"] for s, q in quotes.items()}}, indent=2, ensure_ascii=False))
    else:
        print("NSE %s (%s India time, %s)." % ("OPEN" if status["open"] else "closed", status["now_india"],
                                               status["reason"]))
        for r in rings:
            print("ALERT " + r["message"])
        if not rings:
            print("Nothing hit. %d rule(s) watched today%s." % (
                len(watched), (", " + ", ".join("%s %s" % (s, inr(quotes[s]["price"])) for s in syms if s in quotes))
                if quotes else ""))
        for e in errors:
            print("error: " + e)
        if rings:
            print("An alert is information, not an order. A bracket's stop-loss and target sit at the broker (or "
                  "as separate orders): check your positions and record any fill (ticket.py fill). A stock locked "
                  "at its lower price band (circuit) can leave a stop unfilled, so check the position is really "
                  "closed. To close it yourself: ticket.py flatten, then india-risk and your yes.")
        if not status["calendar_known"]:
            print(calendar_note(datetime.date.fromisoformat(status["date"])))
    return 0 if rings else 1


def cmd_add(a):
    doc = _read(a.rules, {"rules": []})
    doc.setdefault("rules", [])
    if a.from_plan:
        plan = _read(a.plan, None)
        if plan is None:
            raise AlertError("no plan at %s (run india-exit first)" % a.plan)
        cfg = _read(a.config, {}) if a.config else {}
        new = rules_from_plan(plan, (cfg or {}).get("flat_by"))
        ids = {r["id"] for r in new}
        doc["rules"] = [r for r in doc["rules"] if r.get("id") not in ids] + new
        state = _read(a.state, {})
        if state.get("rung"):
            for i in ids:
                state["rung"].pop(i, None)
            _write(a.state, state)
        _write(a.rules, doc)
        for r in new:
            print("Added %s: %s" % (r["id"], json.dumps(r, ensure_ascii=False)))
        print("Run alerts.py check every few minutes while the trade is open (a scheduled task or /loop). "
              "Free quotes are delayed; the stop-loss and target orders at the broker are what actually get you out.")
        return 0
    if a.opening_bell:
        rule = {"id": a.id or "opening-bell", "type": "opening_bell"}
    elif a.at:
        if _hhmm(a.at) is None:
            raise AlertError("--at wants a 24-hour India time like 15:00")
        rule = {"id": a.id or ("time-%s" % a.at.replace(":", "")), "type": "time", "at": a.at,
                "label": a.label or "time alert"}
        if a.symbol:
            rule["symbol"] = norm_symbol(a.symbol)
    else:
        if not a.symbol:
            raise AlertError("--symbol is required (or --from-plan, --at, --opening-bell)")
        sym = norm_symbol(a.symbol)
        if a.above is not None:
            rule = {"type": "above", "price": a.above}
        elif a.below is not None:
            rule = {"type": "below", "price": a.below}
        elif a.stop is not None:
            rule = {"type": "stop", "price": a.stop}
        elif a.target is not None:
            rule = {"type": "target", "price": a.target}
        elif a.pct is not None:
            rule = {"type": "pct_move", "pct": a.pct}
            if a.direction:
                rule["direction"] = a.direction
        else:
            raise AlertError("give one of --above, --below, --stop, --target or --pct")
        val = rule.get("price", rule.get("pct"))
        rule = dict({"id": a.id or ("%s-%s-%s" % (sym.lower(), rule["type"], _n(val)))}, symbol=sym, **rule)
        if a.rearm:
            rule["rearm"] = True
        if a.note:
            rule["note"] = a.note
    if a.date:
        rule["date"] = a.date
    validate(rule)
    if any(r.get("id") == rule["id"] for r in doc["rules"]):
        raise AlertError("a rule with id %s already exists" % rule["id"])
    doc["rules"].append(rule)
    _write(a.rules, doc)
    print("Added %s: %s" % (rule["id"], json.dumps(rule, ensure_ascii=False)))
    return 0


def cmd_list(a):
    doc = _read(a.rules, {"rules": []})
    state = _read(a.state, {})
    if not doc.get("rules"):
        print("No rules yet.")
        return 1
    for r in doc["rules"]:
        rid = r.get("id")
        rung = state.get("rung", {}).get(rid)
        print("%-24s %s%s" % (rid, json.dumps({k: v for k, v in r.items() if k != "id"}, ensure_ascii=False),
                              ("  (rang %s)" % rung) if rung else ""))
    return 0


def cmd_reset(a):
    state = _read(a.state, {})
    if a.id not in state.get("rung", {}):
        print("%s has not rung (nothing to reset)." % a.id)
        return 1
    del state["rung"][a.id]
    _write(a.state, state)
    print("Re-armed %s." % a.id)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Price alerts and the NSE clock (india-alerts).")
    sub = ap.add_subparsers(dest="cmd")

    def net(p):
        p.add_argument("--offline", metavar="DIR", help="read yahoo-<SYMBOL>.json files, no network")
        p.add_argument("--now", help="pretend it is this time (no offset = India time)")
        p.add_argument("--json", action="store_true")

    p = sub.add_parser("clock", help="is the NSE open?")
    p.add_argument("--now", help="pretend it is this time (no offset = India time)")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("quote", help="latest delayed quotes")
    net(p)
    p.add_argument("symbols", nargs="*", help="NSE symbols, e.g. RELIANCE M&M")
    p.add_argument("--holdings", action="store_true", help="add symbols from your portfolio and plan")
    p.add_argument("--portfolio", default=PORTFOLIO_FILE)
    p.add_argument("--plan", default=PLAN_FILE)
    p.add_argument("--write", nargs="?", const=PRICES_FILE, metavar="PATH",
                   help="save to prices.json (default %s)" % PRICES_FILE)
    p = sub.add_parser("check", help="check every rule, ring what hit")
    net(p)
    p.add_argument("--rules", default=RULES_FILE)
    p.add_argument("--state", default=STATE_FILE)
    p.add_argument("--prices-out", default=PRICES_FILE)
    p.add_argument("--no-write", action="store_true")
    p = sub.add_parser("add", help="add a rule")
    p.add_argument("--rules", default=RULES_FILE)
    p.add_argument("--state", default=STATE_FILE)
    p.add_argument("--symbol", help="NSE symbol")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--above", type=float)
    g.add_argument("--below", type=float)
    g.add_argument("--stop", type=float)
    g.add_argument("--target", type=float)
    g.add_argument("--pct", type=float)
    g.add_argument("--opening-bell", action="store_true")
    g.add_argument("--at", metavar="HH:MM", help="a time alert, 24-hour India time")
    g.add_argument("--from-plan", action="store_true", help="stop, target and flat-by from the plan")
    p.add_argument("--plan", default=PLAN_FILE)
    p.add_argument("--config", default=CONFIG_FILE, help="flat_by when the plan has none (default 15:00)")
    p.add_argument("--label", help="what a time alert says, e.g. \"flat by\"")
    p.add_argument("--date", help="watch this rule on this India date only (YYYY-MM-DD)")
    p.add_argument("--direction", choices=["up", "down"])
    p.add_argument("--rearm", action="store_true")
    p.add_argument("--note")
    p.add_argument("--id")
    p = sub.add_parser("list", help="list the rules")
    p.add_argument("--rules", default=RULES_FILE)
    p.add_argument("--state", default=STATE_FILE)
    p = sub.add_parser("reset", help="re-arm a rule that rang")
    p.add_argument("id")
    p.add_argument("--state", default=STATE_FILE)
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"clock": cmd_clock, "quote": cmd_quote, "check": cmd_check, "add": cmd_add,
                "list": cmd_list, "reset": cmd_reset}[a.cmd](a)
    except CoreError as e:
        print("alerts.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
