#!/usr/bin/env python3
"""Pre-trade risk check for india-risk (NSE). Standard library only, no network.

Reads the proposed orders (trader-india/orders.json) and checks every one
against your rules (trader-india/config.json), your account
(trader-india/portfolio.json), prices (trader-india/prices.json), each
symbol's series (trader-india/watchlist.json) and what was placed today
(trader-india/state/broker.json). Each order gets PASS or BLOCK with the
reasons. Orders are checked in file order as if each PASS had filled, so buys
that are fine one by one but break a limit together are caught.

    python3 check.py                                 # the trader-india/ files, writes trader-india/state/risk.json
    python3 check.py --now "2026-10-19 10:00"        # pin the clock (India time)
    python3 check.py --orders trader-india/orders.json --json
    python3 check.py --no-write                      # check without recording the verdicts

Entries and exits. An ENTRY opens or adds to a position (a buy, or a sell
that would go short). An EXIT only reduces what you hold. Getting out must
always be possible: an exit is checked for format, tick grid, asset and short
sales only; every other rule turns into a warning for it.

What blocks an order (every order):

  format        missing symbol, not the plain NSE symbol, exchange not NSE, side
                not buy or sell, qty not a positive whole number, a rupee
                (notional) amount, unknown order_type / product / validity, a
                LIMIT without a price, an SL / SL-M without a trigger_price; a
                bracket that is not DAY or misses its stop_loss or target
  tick          price, trigger_price, stop_loss or target off the NSE tick grid
  asset         options unless "allow_options": true; futures, crypto and
                anything that is not an NSE equity symbol
  short         selling more than you hold, unless "allow_short": true

What blocks an entry (on top):

  blocked       a symbol on your "blocked" list
  product       not one your config allows ("product": "INTRADAY": no CNC /
                delivery for a day trade)
  series        the symbol's series is known and not in allowed_series (EQ:
                BE / BZ are trade-for-trade, no intraday). Unknown: a warning
  size          under min_order_inr, over max_order_inr
  position      the stock would be over max_position_pct of the account
  cash          the buy would dip into your cash buffer, or need margin
  duplicate     the same symbol and side twice in this batch, or already
                placed today (trader-india/state/broker.json)
  daily limit   max_orders_per_day orders placed today
  stop          no stop while "require_stop": true; a stop on the wrong side
  loss          qty x (risk price - stop), plus the round-trip charges at the
                stop when include_costs_in_risk, over max_loss_per_trade_inr.
                The risk price is the HIGHER of the plan's entry, the limit
                price and a fresh price (under 15 minutes old)
  reward:risk   (target - risk price) / (risk price - stop) under min_reward_risk
                (also shown net of charges)
  daily loss    the max losses at the stops of today's entries plus this one
                over max_daily_loss_inr (win or lose, each counts in full)
  trades        max_trades_per_day entries already placed today
  window        before no_entries_before (09:30) or after no_entries_after
                (14:30) India time, or the market is closed (weekend, NSE
                holiday, outside 09:15 to 15:30)

Warnings: a MARKET order, a stop that can fail at the lower circuit, an
unknown series, a price too old to use, a holiday list that does not cover
the year, a LIVE account.

Exit code 0 when every order passes, 1 when any order is blocked. The verdicts
go to trader-india/state/risk.json with the core fingerprint of each order, so
india-broker only shows an order as ready if THIS exact order passed today.
"""

import argparse
import datetime
import json
import os
import re
import sys
from decimal import Decimal

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

DEFAULTS = {
    "budget": None, "cash_buffer_pct": 10, "max_position_pct": 50, "max_order_inr": 80000,
    "min_order_inr": 500, "max_loss_per_trade_inr": 1000, "max_daily_loss_inr": 3000, "max_trades_per_day": 3,
    "max_orders_per_day": 10, "min_reward_risk": 1.0, "require_stop": True, "include_costs_in_risk": True,
    "no_entries_before": "09:30", "no_entries_after": "14:30", "flat_by": "15:00",
    "product": "INTRADAY", "limit_buffer_pct": 0.1, "allowed_series": ["EQ"],
    "brokerage_flat_inr": 20, "brokerage_pct": 0.03,
    "paper": True, "blocked": [], "allow_options": False, "allow_margin": False, "allow_short": False,
}
PRICE_FIELDS = ("price", "trigger_price", "stop_loss", "target")
ORDER_TYPES = {"LIMIT": "LIMIT", "MARKET": "MARKET", "SL": "SL", "SL-M": "SL-M", "SL-L": "SL",
               "STOPLOSS_LIMIT": "SL", "STOPLOSS_MARKET": "SL-M", "STOP_LOSS": "SL", "STOP_LOSS_MARKET": "SL-M"}
PRODUCTS = {"INTRADAY": "INTRADAY", "MIS": "INTRADAY", "DELIVERY": "DELIVERY", "CNC": "DELIVERY",
            "MARGIN": "MARGIN", "NRML": "MARGIN", "MTF": "MTF"}
PRODUCT_WORDS = {"INTRADAY": "INTRADAY (MIS)", "DELIVERY": "DELIVERY (CNC)", "MARGIN": "MARGIN (NRML)",
                 "MTF": "MTF (margin trading facility)"}
VALIDITY = {"DAY", "IOC"}
OPTION = re.compile(r"^[A-Z0-9&-]+\d{2}[A-Z0-9]{1,5}\d+(\.\d+)?(CE|PE)$")
FUTURE = re.compile(r"^[A-Z0-9&-]+\d{2}[A-Z]{3}FUT$")
CRYPTO = re.compile(r"^(BTC|ETH|USDT|USDC|SOL|XRP|DOGE|BNB|ADA|MATIC|SHIB)(USD|USDT|INR)?$")
HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
PAISA = 0.005
FRESH_MINUTES = 15
REF_WORDS = {"plan": "the plan's entry", "price": "the latest price", "limit": "the limit price",
             "trigger price": "the trigger price", "stale price": "an old price"}
STATE_FILE = os.path.join(DATA_DIR, "state", "broker.json")
RISK_FILE = os.path.join(DATA_DIR, "state", "risk.json")


class RiskError(Exception):
    pass


# ---------------------------------------------------------------- time and the window

def _now(text):
    try:
        return parse_now(text)
    except CoreError as e:
        raise RiskError(str(e))


def parse_utc(text):
    if not text:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = (dt - dt.utcoffset()).replace(tzinfo=None)
    return dt


def hhmm(value, key):
    """"09:30" -> time(9, 30); None or "" -> None (that bound is off)."""
    if value in (None, "", False):
        return None
    m = HHMM.match(str(value).strip())
    if not m:
        raise RiskError("%s must be an India time like \"09:30\", got %r" % (key, value))
    return datetime.time(int(m.group(1)), int(m.group(2)))


def calendar_warning(d):
    return ("the NSE holiday list here covers %s only and NSE publishes the next year's list in "
            "December, so a %d holiday looks like a trading day: add the dates to %s as "
            "{\"%d-01-26\": \"Republic Day\"}, from nseindia.com"
            % (" and ".join(map(str, CALENDAR_YEARS)), d.year, HOLIDAYS_FILE, d.year))


def window_check(now_ist, c, hpath=None):
    """(reasons, warnings) for an entry now (India time). Empty when the window is off."""
    before = hhmm(c.get("no_entries_before"), "no_entries_before")
    after = hhmm(c.get("no_entries_after"), "no_entries_after")
    if before is None and after is None:
        return [], []
    warns = []
    d, t = now_ist.date(), now_ist.time().replace(second=0, microsecond=0)
    try:
        if not calendar_known(d, hpath):
            warns.append(calendar_warning(d))
        ok, why = trading_day(d, hpath)
    except CoreError as e:
        raise RiskError(str(e))
    stamp = now_ist.strftime("%a %Y-%m-%d %H:%M")
    if not ok:
        return ["window: the market is closed today (%s, %s India time)" % (why, stamp)], warns
    if now_ist.time() < OPEN or now_ist.time() >= CLOSE:
        extra = " (pre-open call auction)" if PRE_OPEN <= now_ist.time() < OPEN else ""
        return ["window: the market is closed (%s India time%s; the normal market is %s to %s)"
                % (stamp, extra, OPEN.strftime("%H:%M"), CLOSE.strftime("%H:%M"))], warns
    if before is not None and t < before:
        return ["window: no new entries before %s India time (it is %s)" % (before.strftime("%H:%M"),
                                                                            t.strftime("%H:%M"))], warns
    if after is not None and t > after:
        return ["window: no new entries after %s India time (it is %s)" % (after.strftime("%H:%M"),
                                                                           t.strftime("%H:%M"))], warns
    return [], warns


# ---------------------------------------------------------------- files and helpers

def read_json(path, what, required=True):
    if not path or not os.path.exists(path):
        if required:
            raise RiskError("no %s at %s" % (what, path))
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as e:
        raise RiskError("%s is not valid JSON: %s" % (path, e))


def _f(x):
    if isinstance(x, bool):
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def rs(x):
    """Rupees: whole rupees without paise (₹1,000), else to the paisa (₹915.63)."""
    x = float(x)
    return inr(x, 0) if abs(x - round(x)) < PAISA else inr(x)


def _p(x):
    return "%.2f" % float(x)


def _pct(x):
    x = float(x)
    return str(int(x)) if x == int(x) else ("%.2f" % x)


def _num(x):
    x = float(x)
    return str(int(x)) if x == int(x) else ("%.4f" % x).rstrip("0")


def _paise(x):
    """A price to the paisa, half up (366.475 -> 366.48)."""
    return int(float(x) * 100 + 0.5 + 1e-9) / 100.0


def on_tick(v):
    """(on the grid, tick) for a price, with the core tick_size."""
    d = Decimal(str(v))
    t = tick_size(d)
    return (d % t) == 0, t


def charges(qty, buy, sell, c):
    """Round-trip charges (core intraday_costs) with the config's brokerage plan."""
    flat = c.get("brokerage_flat_inr")
    flat = 20 if flat is None else flat
    pct = c.get("brokerage_pct")
    if pct is None:             # flat fee only (the core needs a number: 100% never undercuts it)
        pct = 100
    return intraday_costs(qty, buy, sell, flat, pct)


def norm_product(p):
    return PRODUCTS.get(str(p or "").strip().upper())


def allowed_products(c):
    raw = c.get("product") or "INTRADAY"
    items = raw if isinstance(raw, (list, tuple)) else [raw]
    return [norm_product(x) or str(x).upper() for x in items]


def account(cfg, portfolio, prices):
    """Starting account: cash and position values. No portfolio = a fresh
    account funded with the budget."""
    warnings = []
    if portfolio is None:
        budget = _f(cfg.get("budget"))
        if not budget:
            raise RiskError("no trader-india/portfolio.json and no budget in the config: "
                            "nothing to check the orders against")
        return {"cash": budget, "shares": {}, "values": {}}, warnings
    cash = _f(portfolio.get("cash"))
    if cash is None:
        raise RiskError("portfolio.json needs a \"cash\" number")
    shares, values = {}, {}
    for p in portfolio.get("positions", []):
        t = str(p.get("symbol") or p.get("ticker") or "").upper()
        if not t:
            continue
        try:
            t = norm_symbol(t)
        except CoreError:
            pass
        n = _f(p.get("shares", p.get("qty")))
        if n is None:
            n = sum(_f(l.get("shares")) or 0 for l in p.get("lots", []))
        shares[t] = shares.get(t, 0) + n
        if prices.get(t):
            values[t] = shares[t] * prices[t]
        else:
            basis = sum(_f(l.get("cost")) or 0 for l in p.get("lots", []))
            values[t] = basis
            warnings.append("no price for %s: valued at its cost basis %s" % (t, rs(basis)))
    return {"cash": cash, "shares": shares, "values": values}, warnings


def rec_day(rec):
    return str(rec.get("date") or str(rec.get("at", ""))[:10])


def rec_is_entry(rec):
    """india-broker logs the kind india-risk gave; older records: a buy is an entry."""
    k = rec.get("kind")
    if k:
        return k == "entry"
    return str(rec.get("side", "")).lower() == "buy"


def placed_today(state, today):
    """Orders recorded as placed today by india-broker."""
    return [rec for rec in (state or {}).get("orders", [])
            if rec.get("status") == "placed" and rec_day(rec) == today]


def series_map(doc):
    """{SYMBOL: series} from a watchlist.json: {"hits": [{"symbol", "series"}]} or a plain list."""
    out = {}
    items = doc.get("hits", []) if isinstance(doc, dict) else (doc or [])
    for x in items if isinstance(items, list) else []:
        if isinstance(x, dict) and x.get("symbol") and x.get("series"):
            try:
                out[norm_symbol(x["symbol"])] = str(x["series"]).strip().upper()
            except CoreError:
                continue
    return out


# ---------------------------------------------------------------- the check

def check(orders, cfg, portfolio=None, prices=None, state=None, today=None, now=None, price_times=None,
          series=None, holidays_path=None):
    """Pure function. Returns {"results": [...], "pass": n, "block": n, "warnings": [...]}.

    now            naive UTC (default: the real clock); its India date is "today"
    price_times    {SYM: naive UTC time of that price}; None = every price counts as fresh
    series         {SYM: "EQ"} (from trader-india/watchlist.json); a missing symbol is unknown
    holidays_path  extra NSE holidays (default trader-india/holidays.json)"""
    c = dict(DEFAULTS)
    c.update(cfg or {})
    prices = {str(k).upper(): float(v) for k, v in (prices or {}).items() if _f(v)}
    series = {str(k).upper(): str(v).upper() for k, v in (series or {}).items() if v}
    allowed_series = [str(s).upper() for s in (c.get("allowed_series") or [])]
    now_utc = now or utc_now()
    now_ist = to_ist(now_utc)
    today = today or now_ist.date().isoformat()
    acct, top_warn = account(c, portfolio, prices)
    blocked = set()
    for b in c.get("blocked") or []:
        try:
            blocked.add(norm_symbol(b))
        except CoreError:
            blocked.add(str(b).upper())
    done_today = placed_today(state, today)
    count_today = len(done_today)
    entries_today = [r for r in done_today if rec_is_entry(r)]
    loss_today = 0.0
    for r in entries_today:
        ml = _f(r.get("max_loss"))
        if ml is None:
            top_warn.append("an entry placed today (%s %s) has no max loss in the log; not counted in "
                            "the daily loss" % (r.get("side"), r.get("symbol")))
        else:
            loss_today += ml
    placed_keys = {(str(r.get("symbol", "")).upper(), str(r.get("side", "")).lower()) for r in done_today}
    win_reasons, win_warns = window_check(now_ist, c, holidays_path)
    with_costs = bool(c.get("include_costs_in_risk", True))
    products_ok = allowed_products(c)
    seen = set()
    results = []
    batch_entries, batch_loss = 0, 0.0
    if not c.get("paper", True):
        top_warn.append("LIVE account (\"paper\": false): these orders use real money")
    top_warn.extend(win_warns)

    def fresh(sym):
        if sym not in prices:
            return None
        if price_times is None:
            return prices[sym]
        t = price_times.get(sym)
        if t is None:
            return None
        age = (now_utc - t).total_seconds()
        return prices[sym] if -60 <= age <= FRESH_MINUTES * 60 else None

    for i, o in enumerate(orders, 1):
        reasons, warns, info = [], [], []
        later = []                       # entry-only reasons, turned into warnings for an exit
        if not isinstance(o, dict):
            o = {}
        raw_sym = str(o.get("symbol") or "").strip().upper()
        sym = raw_sym
        side = str(o.get("side", "")).strip().lower()
        typ_raw = str(o.get("order_type") or "").strip().upper()
        typ = ORDER_TYPES.get(typ_raw)
        validity = str(o.get("validity") or "DAY").strip().upper()
        product = norm_product(o.get("product"))
        qty = o.get("qty")
        plan = o.get("plan") if isinstance(o.get("plan"), dict) else {}
        bracket = o.get("bracket")
        value = None

        # format
        if not raw_sym:
            reasons.append("format: no symbol")
        if side not in ("buy", "sell"):
            reasons.append("format: side must be buy or sell, got %r" % o.get("side"))
        q = _f(qty)
        if qty is None:
            reasons.append("format: no qty (whole shares)")
        elif q is None or q <= 0:
            reasons.append("format: qty must be a positive number of shares, got %r" % qty)
        elif abs(q - round(q)) > 1e-9:
            reasons.append("format: NSE equity orders take whole shares only, got qty %r" % qty)
        elif not isinstance(qty, int) or isinstance(qty, bool):
            warns.append("send qty as a JSON whole number (%d), the way trader-india/orders.json types it"
                         % int(round(q)))
        if q is not None and q > 0 and abs(q - round(q)) <= 1e-9:
            q = float(int(round(q)))
        else:
            q = None
        if o.get("notional") is not None:
            reasons.append("format: a rupee (notional) amount is not an NSE order: give qty in whole shares")
        prices_in = {}
        for k in PRICE_FIELDS:
            if o.get(k) is None:
                continue
            v = _f(o.get(k))
            if v is None or v <= 0:
                reasons.append("format: %s must be a positive number, got %r" % (k, o.get(k)))
                continue
            prices_in[k] = v
            if not isinstance(o.get(k), (int, float)):
                warns.append("send %s as a JSON number (%s), not a string" % (k, o.get(k)))
            ok, tick = on_tick(o.get(k))
            if not ok:
                reasons.append("tick: %s %s is not on the NSE tick grid (%s at this price); round it to the "
                               "tick. Near a slab edge the stock's own tick can differ: check the exchange"
                               % (k, o.get(k), tick))
        if typ is None:
            reasons.append("format: order_type must be LIMIT, MARKET, SL or SL-M, got %r" % o.get("order_type"))
        if validity not in VALIDITY:
            reasons.append("format: validity must be DAY or IOC, got %r" % o.get("validity"))
        if o.get("product") is None:
            reasons.append("format: no product (INTRADAY for a day trade)")
        elif product is None:
            reasons.append("format: unknown product %r (INTRADAY / MIS or DELIVERY / CNC)" % o.get("product"))
        ex = str(o.get("exchange") or "").strip().upper()
        if not ex:
            reasons.append("format: no exchange (this pack trades NSE)")
        elif ex in ("NFO", "BFO"):
            reasons.append("asset: %s is a derivatives segment; this pack trades NSE equities only" % ex)
        elif ex != "NSE":
            reasons.append("format: exchange %s; this pack trades NSE only" % ex)
        if typ in ("LIMIT", "SL") and "price" not in prices_in:
            reasons.append("format: a %s order needs a price" % typ)
        if typ in ("SL", "SL-M") and "trigger_price" not in prices_in:
            reasons.append("format: an %s order needs a trigger_price" % typ)
        if typ == "SL" and "price" in prices_in and "trigger_price" in prices_in and side in ("buy", "sell"):
            tp, lp = prices_in["trigger_price"], prices_in["price"]
            if (side == "buy" and tp > lp + PAISA) or (side == "sell" and tp < lp - PAISA):
                reasons.append("format: an SL %s needs its trigger_price %s %s its price %s"
                               % (side, _p(tp), "at or under" if side == "buy" else "at or over", _p(lp)))
        if typ == "MARKET":
            warns.append("MARKET order: Angel One reportedly prohibits API market orders from 2026-04-01 and "
                         "Dhan converts them to limit orders; send a LIMIT (india-budget writes one)")
            if "price" in prices_in:
                warns.append("a MARKET order ignores its price %s" % _p(prices_in["price"]))
        if bracket not in (True, False, None):
            reasons.append("format: bracket must be true or false, got %r" % bracket)
        bracket = bracket is True
        if bracket:
            if validity != "DAY":
                reasons.append("format: a bracket order must be DAY, got %r" % o.get("validity"))
            if "stop_loss" not in prices_in or "target" not in prices_in:
                reasons.append("format: a bracket order needs both stop_loss and target")

        # asset and symbol
        if raw_sym:
            if OPTION.match(raw_sym):
                if not c.get("allow_options"):
                    reasons.append("asset: %s is an option contract; options are off (\"allow_options\": false)"
                                   % raw_sym)
                else:
                    warns.append("option order: options can lose 100% of what you pay")
            elif FUTURE.match(raw_sym):
                reasons.append("asset: %s is a futures contract; this pack trades NSE equities only" % raw_sym)
            elif "/" in raw_sym or CRYPTO.match(raw_sym):
                reasons.append("asset: %s looks like crypto; this pack trades NSE equities only" % raw_sym)
            else:
                try:
                    sym = norm_symbol(raw_sym)
                    if sym != raw_sym:
                        reasons.append("format: symbol must be the plain NSE symbol (%s, not %s)" % (sym, raw_sym))
                except CoreError:
                    reasons.append("asset: %s does not look like an NSE equity symbol; this pack trades NSE "
                                   "equities only" % raw_sym)

        # the risk price: the worst price one share can cost to get in
        plan_entry = _f(plan.get("entry"))
        live = fresh(sym)
        cands = []
        if plan_entry:
            cands.append((plan_entry, "plan"))
        if typ in ("LIMIT", "SL") and prices_in.get("price"):
            cands.append((prices_in["price"], "limit"))
        if typ in ("SL", "SL-M") and prices_in.get("trigger_price"):
            cands.append((prices_in["trigger_price"], "trigger price"))
        if live:
            cands.append((live, "price"))
        ref, ref_from = None, None
        if cands:
            ref, ref_from = (min if side == "sell" else max)(cands, key=lambda x: x[0])
            ref = _paise(ref)
            if ref_from == "price" and plan_entry:
                info.append("%s last %s is %s the plan's entry %s: the risk is measured from %s"
                            % (sym, _p(ref), "under" if side == "sell" else "above", _p(plan_entry), _p(ref)))
        elif sym in prices:
            ref, ref_from = prices[sym], "stale price"
        if sym in prices and live is None and price_times is not None:
            warns.append("the %s price in trader-india/prices.json is older than %d minutes (or from the "
                         "future): not used" % (sym, FRESH_MINUTES))
        if q and ref:
            value = q * ref

        # entry or exit
        held = acct["shares"].get(sym, 0.0)
        held_value = acct["values"].get(sym, 0.0)
        exiting = False
        if side == "sell" and held > 1e-9 and q is not None:
            exiting = q <= held + 1e-9
        elif side == "buy" and held < -1e-9 and q is not None:
            exiting = q <= -held + 1e-9
        kind = "exit" if exiting else "entry"
        if kind == "entry" and value is None and q:
            later.append("price: no price for %s to size a %s-share order; add it to "
                         "trader-india/prices.json (india-alerts)" % (sym, _num(q)))

        # blocked list, product, series, size
        if sym in blocked:
            later.append("blocked: %s is on your blocked list" % sym)
        if product and product not in products_ok:
            later.append("product: %s is not allowed by your config (\"product\": %s); a day trade is INTRADAY"
                         % (PRODUCT_WORDS.get(product, product), json.dumps(c.get("product"))))
        elif product == "MTF" and not c.get("allow_margin"):
            later.append("product: MTF is borrowed money (\"allow_margin\": false)")
        if kind == "exit" and product and product != "INTRADAY":
            warns.append("product %s: make sure it matches the position you are closing" % product)
        ser = series.get(sym) or str(o.get("series") or plan.get("series") or "").strip().upper() or None
        if raw_sym and not OPTION.match(raw_sym):
            if ser is None:
                if kind == "entry":
                    warns.append("series: not known for %s; check it is %s on nseindia.com (BE / BZ are "
                                 "trade-for-trade: no intraday)" % (sym, " / ".join(allowed_series) or "EQ"))
            elif allowed_series and ser not in allowed_series:
                later.append("series: %s trades in the %s series, not in your allowed_series %s%s"
                             % (sym, ser, " / ".join(allowed_series),
                                " (trade-for-trade: every buy is for delivery, no intraday)"
                                if ser in ("BE", "BZ") else ""))
        if value is not None:
            if value < float(c.get("min_order_inr") or 0) - PAISA:
                later.append("size: %s is under your %s minimum order" % (rs(value), rs(c["min_order_inr"])))
            if c.get("max_order_inr") and value > float(c["max_order_inr"]) + PAISA:
                later.append("size: %s is over your %s max order" % (rs(value), rs(c["max_order_inr"])))

        # account effects, simulated in order
        cash = acct["cash"]
        total = cash + sum(acct["values"].values())
        buffer_inr = total * float(c.get("cash_buffer_pct") or 0) / 100.0
        if value is not None and side == "buy" and kind == "entry":
            after_cash = cash - value
            if not c.get("allow_margin"):
                if after_cash < -PAISA:
                    later.append("cash: needs %s but only %s cash; that would be margin (the broker's "
                                 "intraday leverage, borrowed money)" % (rs(value), rs(cash)))
                elif after_cash < buffer_inr - PAISA:
                    later.append("cash: leaves %s cash, under your %s%% buffer of %s"
                                 % (rs(max(after_cash, 0)), _pct(c["cash_buffer_pct"]), rs(buffer_inr)))
            elif after_cash < -PAISA:
                warns.append("margin: needs %s with %s cash; the rest is borrowed from the broker "
                             "(\"allow_margin\": true)" % (rs(value), rs(cash)))
            pos_after = held_value + value
            limit = total * float(c.get("max_position_pct") or 100) / 100.0
            if total > 0 and pos_after > limit + PAISA:
                later.append("position: %s would be %s, %.1f%% of the %s account, over your %s%% cap"
                             % (sym, rs(pos_after), 100.0 * pos_after / total, rs(total),
                                _pct(c["max_position_pct"])))
        if side == "sell" and sym and kind == "entry":
            over = (q > held + 1e-9) if q is not None else (held <= 0)
            if over and not c.get("allow_short"):
                reasons.append("short: selling more %s than you hold (%s shares); short selling is off. "
                               "If you bought it, record the fill first (india-broker)" % (sym, _num(held)))

        # day-trade checks: stop, loss, reward:risk, daily loss, trades, window
        max_loss = risk_ps = rr = rr_net = stop = target = at_stop = None
        if kind == "entry" and side in ("buy", "sell"):
            long = side == "buy"
            leg_stop = prices_in.get("stop_loss") if bracket else None
            plan_stop = _f(plan.get("stop"))
            stop = prices_in.get("stop_loss") or plan_stop
            target = prices_in.get("target") or _f(plan.get("target"))
            if leg_stop and plan_stop and abs(leg_stop - plan_stop) > PAISA:
                warns.append("the bracket stop %s differs from the plan's stop %s: the bracket's is the one "
                             "the broker uses" % (_p(leg_stop), _p(plan_stop)))
            if stop and not leg_stop:
                warns.append("the stop %s is not placed with this order (bracket is false): set a stop alert "
                             "(india-alerts) and place it yourself" % _p(stop))
            if not stop:
                if c.get("require_stop", True):
                    later.append("stop: no stop. Every entry needs one (\"require_stop\": true): a bracket "
                                 "stop_loss, from india-exit and india-budget")
                else:
                    warns.append("no stop: the max loss is not capped, so it is not counted in the daily loss")
            elif ref:
                if (long and stop >= ref - PAISA) or (not long and stop <= ref + PAISA):
                    later.append("stop: the stop %s must be %s the entry %s for a %s"
                                 % (_p(stop), "below" if long else "above", _p(ref), side))
                else:
                    risk_c = int(round(abs(ref - stop) * 100))
                    risk_ps = risk_c / 100.0
                    shares = int(q) if q is not None else 0
                    gross = round(shares * risk_c / 100.0, 2)
                    buy_p, sell_p = (ref, stop) if long else (stop, ref)
                    at_stop = charges(shares, buy_p, sell_p, c)["total"] if shares else 0.0
                    max_loss = round(gross + (at_stop if with_costs else 0.0), 2)
                    warns.append("price band: a stop can fail to fill if %s hits its %s circuit (NSE price "
                                 "band); Yahoo data does not carry the band, so check it on nseindia.com"
                                 % (sym, "lower" if long else "upper"))
                    cap = _f(c.get("max_loss_per_trade_inr"))
                    if cap and max_loss > cap + PAISA:
                        later.append("loss: %d shares x %s risk a share%s = %s at the stop, over your %s max loss "
                                     "per trade" % (shares, _p(risk_ps),
                                                    (" + %s charges" % rs(at_stop)) if with_costs else "",
                                                    rs(max_loss), rs(cap)))
                    min_rr = _f(c.get("min_reward_risk"))
                    if target:
                        if (long and target <= ref + PAISA) or (not long and target >= ref - PAISA):
                            later.append("target: the target %s must be %s the entry %s"
                                         % (_p(target), "above" if long else "below", _p(ref)))
                        else:
                            reward_c = int(round(abs(target - ref) * 100))
                            rr = round(reward_c / float(risk_c), 2)
                            if shares:
                                tb, ts = (ref, target) if long else (target, ref)
                                at_target = charges(shares, tb, ts, c)["total"]
                                rr_net = round((shares * reward_c / 100.0 - at_target) / (gross + at_stop), 2)
                            if min_rr and rr < min_rr - 1e-9:
                                later.append("reward:risk: %.2f (target %s, entry %s, stop %s) is under your "
                                             "minimum %s" % (rr, _p(target), _p(ref), _p(stop), _num(min_rr)))
                    elif min_rr:
                        later.append("reward:risk: no target to measure it against (min_reward_risk %s)"
                                     % _num(min_rr))
            daily = _f(c.get("max_daily_loss_inr"))
            if daily and max_loss is not None:
                used = loss_today + batch_loss
                if used + max_loss > daily + PAISA:
                    later.append("daily loss: %s already at risk today plus %s for this one = %s, over your %s "
                                 "daily loss limit" % (rs(used), rs(max_loss), rs(used + max_loss), rs(daily)))
            cap_t = int(c.get("max_trades_per_day") or 0)
            if cap_t and len(entries_today) + batch_entries >= cap_t:
                later.append("trades: %d entries placed today plus %d passed earlier in this batch, your limit "
                             "is %d a day" % (len(entries_today), batch_entries, cap_t))
            later.extend(win_reasons)
            if stop and ref and risk_ps:
                info.append("entry %s (%s), stop %s, target %s: risk %s a share"
                            % (_p(ref), REF_WORDS.get(ref_from, ref_from), _p(stop),
                               _p(target) if target else "none", _p(risk_ps)))
                cap = _f(c.get("max_loss_per_trade_inr"))
                info.append("max loss %s = %d x %s%s%s, reward:risk %s%s%s"
                            % (rs(max_loss), int(q or 0), _p(risk_ps),
                               (" + %s charges" % rs(at_stop)) if with_costs else
                               (" (charges %s not counted)" % rs(at_stop or 0)),
                               (" (limit %s)" % rs(cap)) if cap else "",
                               ("%.2f" % rr) if rr is not None else "n/a",
                               (" (min %s)" % _num(c["min_reward_risk"])) if _f(c.get("min_reward_risk")) else "",
                               (", net of charges %.2f" % rr_net) if rr_net is not None else ""))
            if daily or cap_t:
                info.append("today before this: %d of %s trades, %s of %s daily loss"
                            % (len(entries_today) + batch_entries, cap_t or "unlimited",
                               rs(loss_today + batch_loss), rs(daily) if daily else "no limit on"))

        # duplicates and the daily order limit
        key = (sym, side)
        if key in seen:
            later.append("duplicate: a second %s %s in this batch" % (side, sym))
        if key in placed_keys:
            later.append("duplicate: a %s %s was already placed today" % (side, sym))
        passed_so_far = sum(1 for r in results if r["verdict"] == "PASS")
        cap_n = int(c.get("max_orders_per_day") or 0)
        if cap_n and count_today + passed_so_far >= cap_n:
            later.append("daily limit: %d placed today plus %d passed earlier in this batch, "
                         "your limit is %d a day" % (count_today, passed_so_far, cap_n))
        seen.add(key)

        if kind == "entry":
            reasons.extend(later)
        else:
            warns.extend("exit, not blocked: " + x for x in later)

        verdict = "BLOCK" if reasons else "PASS"
        if verdict == "PASS":
            if kind == "entry" and side in ("buy", "sell"):
                batch_entries += 1
                batch_loss += max_loss or 0.0
            if side == "buy":
                if value is not None:
                    acct["cash"] -= value
                    acct["values"][sym] = acct["values"].get(sym, 0.0) + value
                if q is not None:
                    acct["shares"][sym] = held + q
            elif side == "sell":
                if value is not None:
                    acct["cash"] += value
                    acct["values"][sym] = max(acct["values"].get(sym, 0.0) - value, 0.0)
                if q is not None:
                    acct["shares"][sym] = held - q
        results.append({
            "index": i, "symbol": sym, "side": side, "kind": kind,
            "amount": "%s shares" % (_num(q) if q is not None else qty),
            "order_type": typ, "product": product, "series": ser,
            "value_inr": round(value, 2) if value is not None else None,
            "entry_ref": round(ref, 2) if ref else None, "entry_ref_from": ref_from,
            "stop": stop, "target": target, "risk_per_share": risk_ps, "costs_at_stop": at_stop,
            "max_loss": max_loss, "reward_risk": rr, "reward_risk_net": rr_net,
            "fingerprint": fingerprint(o), "verdict": verdict,
            "reasons": reasons, "warnings": warns, "info": info,
        })

    return {
        "date": today,
        "now_india": now_ist.strftime("%Y-%m-%d %H:%M"),
        "paper": bool(c.get("paper", True)),
        "results": results,
        "pass": sum(1 for r in results if r["verdict"] == "PASS"),
        "block": sum(1 for r in results if r["verdict"] == "BLOCK"),
        "warnings": top_warn,
        "cash_after": round(acct["cash"], 2),
        "today": {"orders_placed": count_today, "entries_placed": len(entries_today),
                  "loss_at_risk": round(loss_today, 2)},
    }


def report(res):
    lines = []
    for w in res["warnings"]:
        lines.append("WARNING: " + w)
    if res["warnings"]:
        lines.append("")
    for r in res["results"]:
        lines.append("%-5s #%d %s %s %s, %s" % (r["verdict"], r["index"], r["side"], r["symbol"], r["amount"],
                                                r["kind"]))
        for x in r.get("info", []):
            lines.append("          " + x)
        for x in r["reasons"]:
            lines.append("        - " + x)
        for x in r["warnings"]:
            lines.append("        ~ " + x)
    lines.append("")
    lines.append("%d passed, %d blocked at %s India time. Cash after the passed orders: %s (%s account)."
                 % (res["pass"], res["block"], res["now_india"], rs(res["cash_after"]),
                    "paper" if res["paper"] else "LIVE"))
    if res["block"]:
        lines.append("Blocked orders do not go to the broker. Fix the order or your rules, then check again.")
    else:
        lines.append("Every order passed. india-broker still asks you yes or no for each one.")
    lines.append("Education and tooling, not financial advice.")
    return "\n".join(lines)


def load_prices(pdoc):
    """prices.json -> ({SYM: price}, {SYM: price time as naive UTC or None}).

    The price time is the quote's own time (detail.time), else when it was fetched
    (detail.fetched), else the file's as_of."""
    if not isinstance(pdoc, dict):
        return {}, {}
    prices = pdoc.get("prices", pdoc)
    if not isinstance(prices, dict):
        return {}, {}
    out, times = {}, {}
    as_of = parse_utc(pdoc.get("as_of"))
    detail = pdoc.get("detail") or {}
    for s, p in prices.items():
        if _f(p) is None:
            continue
        key = from_yahoo(s)
        d = detail.get(s) or detail.get(key) or {}
        out[key] = float(p)
        times[key] = parse_utc(d.get("time")) or parse_utc(d.get("fetched")) or as_of
    return out, times


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check proposed NSE orders against your limits (india-risk).")
    ap.add_argument("--orders", default=os.path.join(DATA_DIR, "orders.json"))
    ap.add_argument("--config", default=os.path.join(DATA_DIR, "config.json"))
    ap.add_argument("--portfolio", default=os.path.join(DATA_DIR, "portfolio.json"),
                    help="your account; if missing, a fresh account funded with the budget")
    ap.add_argument("--prices", default=os.path.join(DATA_DIR, "prices.json"))
    ap.add_argument("--watchlist", default=os.path.join(DATA_DIR, "watchlist.json"),
                    help="each symbol's series (hits[].series), from india-scanner")
    ap.add_argument("--state", default=STATE_FILE, help="what india-broker placed today")
    ap.add_argument("--holidays", default=HOLIDAYS_FILE, help="extra NSE holidays {\"YYYY-MM-DD\": \"name\"}")
    ap.add_argument("--now", help="pretend it is this India time, e.g. \"2026-10-19 10:00\"")
    ap.add_argument("--today", help="YYYY-MM-DD (default: today in India)")
    ap.add_argument("--out", default=RISK_FILE, help="where the verdicts are recorded")
    ap.add_argument("--no-write", action="store_true", help="do not record the verdicts")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        now = _now(a.now)
        if a.today and not re.match(r"^\d{4}-\d{2}-\d{2}$", a.today):
            raise RiskError("--today wants a date like 2026-10-19")
        doc = read_json(a.orders, "orders file (run india-budget first)")
        orders = doc.get("orders", doc) if isinstance(doc, dict) else doc
        if not isinstance(orders, list) or not orders:
            raise RiskError("no orders in %s" % a.orders)
        cfg = read_json(a.config, "config", required=False) or {}
        portfolio = read_json(a.portfolio, "portfolio", required=False)
        pdoc = read_json(a.prices, "prices", required=False) or {}
        prices, times = load_prices(pdoc)
        series = series_map(read_json(a.watchlist, "watchlist", required=False))
        state = read_json(a.state, "broker state", required=False)
        res = check(orders, cfg, portfolio, prices, state, a.today, now, times, series, a.holidays)
        if pdoc.get("as_of"):
            res["prices_as_of"] = pdoc["as_of"]
        if not a.no_write:
            d = os.path.dirname(a.out)
            if d:
                os.makedirs(d, exist_ok=True)
            rec = dict(res)
            rec["checked_at"] = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
            rec["orders_file"] = a.orders
            tmp = a.out + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(rec, fh, indent=2, ensure_ascii=False)
                fh.write("\n")
            os.replace(tmp, a.out)
    except (RiskError, CoreError) as e:
        print("check.py: %s" % e, file=sys.stderr)
        return 1
    print(json.dumps(res, indent=2, ensure_ascii=False) if a.json else report(res))
    return 1 if res["block"] else 0


if __name__ == "__main__":
    sys.exit(main())
