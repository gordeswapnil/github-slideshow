#!/usr/bin/env python3
"""Position sizing for india-budget (NSE). Standard library only, no network.

Default mode: sizes ONE day trade from trader-india/plan.json (written by
india-exit) to your budget and your max loss per trade, then writes one
bracket order (LIMIT entry, stop-loss, target) to trader-india/orders.json in
the pack's broker-neutral format. It never places anything: india-risk checks
the order and india-broker asks you yes or no.

    python3 size.py                                  # trader-india/plan.json + trader-india/config.json
    python3 size.py --write                          # write trader-india/orders.json
    python3 size.py --limit 364.50 --write           # your own limit price (rounded up to the tick)
    python3 size.py --market                         # a MARKET order (india-risk warns on it)
    python3 size.py --now "2026-10-19 10:00" --json  # pin the clock (India time)

The order is a marketable LIMIT by default: the entry plus limit_buffer_pct
(0.1%), rounded UP to the NSE tick. The entry is the plan's entry, or a fresh
price from trader-india/prices.json (under 15 minutes old) when that is
higher. Risk is measured from the limit price, the worst fill the order allows.

How many shares. Whole shares only (NSE has no fractional shares).

    shares = the largest whole number that fits ALL of
      max loss       shares x (limit price - stop) + the round-trip charges at the stop
                     (when include_costs_in_risk) <= max_loss_per_trade_inr
      position cap   shares x limit price <= budget x max_position_pct
      max order      shares x limit price <= max_order_inr
      cash           shares x limit price <= budget minus the cash buffer
                     (and no more than the cash in trader-india/portfolio.json, if you have
                     one). Only while allow_margin is false.

Zero shares because the stop is too far for your max loss is a plain refusal:
no order is written. So is a reward:risk under min_reward_risk.

Weights mode (kept from the US pack's v1): split a budget across a list of
NSE stocks by weight, in whole shares, as plain LIMIT buys with no stop.

    python3 size.py --weights SYN-A=40,SYN-B=25,SYN-C=20,SYN-D=15 --prices trader-india/prices.json
    python3 size.py --targets my-weights.json --budget 100000 --write

  1. cash buffer   budget x cash_buffer_pct stays in cash, never invested
  2. weights       renormalised to 100 over the stocks you keep (blocked
                   symbols are dropped first; --top N keeps the N biggest)
  3. cap           no stock gets more than max_position_pct of the budget;
                   anything over the cap is shared out to the others by weight
  4. whole shares  each slice buys whole shares at its LIMIT price (the quote
                   plus limit_buffer_pct, rounded up to the tick), then spare
                   cash buys one more share at a time while it lasts
  5. min order     a slice under min_order_inr is dropped and its weight shared out

Money that cannot be invested is reported as "left idle", never hidden.
"""

import argparse
import datetime
import json
import math
import os
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

# The pack's config.example.json. Missing keys fall back to these.
DEFAULTS = {
    "budget": None,
    "cash_buffer_pct": 10,
    "max_position_pct": 50,
    "max_order_inr": 80000,
    "min_order_inr": 500,
    "max_loss_per_trade_inr": 1000,
    "max_daily_loss_inr": 3000,
    "max_trades_per_day": 3,
    "max_orders_per_day": 10,
    "min_reward_risk": 1.0,
    "require_stop": True,
    "include_costs_in_risk": True,
    "no_entries_before": "09:30",
    "no_entries_after": "14:30",
    "flat_by": "15:00",
    "product": "INTRADAY",
    "limit_buffer_pct": 0.1,
    "allowed_series": ["EQ"],
    "brokerage_flat_inr": 20,
    "brokerage_pct": 0.03,
    "broker": "paper",
    "paper": True,
    "blocked": [],
    "allow_options": False,
    "allow_margin": False,
    "allow_short": False,
}
EPS = 1e-9
FRESH_MINUTES = 15
SETUP_WORDS = {"orb": "opening-range breakout", "flag": "flag", "bounce": "oversold bounce",
               "level": "level breakout"}
PRODUCT_ALIASES = {"MIS": "INTRADAY", "INTRADAY": "INTRADAY", "CNC": "DELIVERY", "DELIVERY": "DELIVERY"}
PLAN_FILE = os.path.join(DATA_DIR, "plan.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
PRICES_FILE = os.path.join(DATA_DIR, "prices.json")
PORTFOLIO_FILE = os.path.join(DATA_DIR, "portfolio.json")
ORDERS_FILE = os.path.join(DATA_DIR, "orders.json")
ORDERS_NOTE = ("Proposals only. Nothing is placed until india-risk passes each order and you say yes "
               "to it in the chat.")


class SizeError(Exception):
    pass


# ---------------------------------------------------------------- time

def parse_utc(text):
    """"2026-10-19T05:07:13Z" -> naive UTC, or None."""
    if not text:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = (dt - dt.utcoffset()).replace(tzinfo=None)
    return dt


def utc_iso(now_utc=None):
    now_utc = now_utc or utc_now()
    return now_utc.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- inputs

def read_json(path, what):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        raise SizeError("no %s at %s" % (what, path))
    except json.JSONDecodeError as e:
        raise SizeError("%s is not valid JSON: %s" % (path, e))


def load_config(path):
    cfg = dict(DEFAULTS)
    if path and os.path.exists(path):
        cfg.update(read_json(path, "config"))
    return cfg


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _sym(text):
    try:
        return norm_symbol(text)
    except CoreError as e:
        raise SizeError(str(e))


def parse_weights(data):
    """Accept a weights file, a {symbol: weight} dict or a list of rows.

    Returns [{"symbol", "name", "weight"}] with weight as a float."""
    if isinstance(data, dict) and "weights" in data:
        data = data["weights"]
    rows = []
    if isinstance(data, dict):
        for t, w in data.items():
            rows.append({"symbol": t, "name": "", "weight": w})
    elif isinstance(data, list):
        for i, r in enumerate(data):
            if not isinstance(r, dict):
                raise SizeError("weights[%d] is not an object" % i)
            t = r.get("symbol") or r.get("ticker")
            w = r.get("weight", r.get("weight_pct", r.get("pct")))
            if not t or w is None:
                raise SizeError("weights[%d] needs a symbol and a weight" % i)
            rows.append({"symbol": t, "name": r.get("name", ""), "weight": w})
    else:
        raise SizeError("weights must be a list or an object")
    out = []
    for r in rows:
        try:
            w = float(r["weight"])
        except (TypeError, ValueError):
            raise SizeError("weight for %s is not a number: %r" % (r["symbol"], r["weight"]))
        out.append({"symbol": _sym(r["symbol"]), "name": r["name"] or "", "weight": w})
    return out


def weights_from_arg(text):
    """SYN-A=40,M&M=10 -> {symbol: weight}"""
    out = {}
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            raise SizeError("--weights wants SYMBOL=WEIGHT pairs, got %r" % part)
        t, w = part.split("=", 1)
        out[t.strip().upper()] = w.strip()
    return out


def load_prices(path):
    if not path:
        return {}
    data = read_json(path, "prices")
    prices = data.get("prices", data) if isinstance(data, dict) else {}
    out = {}
    for t, p in (prices or {}).items():
        v = _f(p)
        if v is None or v <= 0:
            continue
        try:
            out[norm_symbol(from_yahoo(t))] = v
        except CoreError:
            continue
    return out


def price_time(doc, sym):
    """When this symbol's price is from: the quote's own time (detail[sym].time), else when it
    was fetched (detail[sym].fetched), else the file's as_of."""
    det = ((doc or {}).get("detail") or {}).get(sym) or {}
    for key in ("time", "fetched"):
        t = parse_utc(det.get(key))
        if t:
            return t
    return parse_utc((doc or {}).get("as_of"))


def fresh_price(doc, sym, now_utc, minutes=FRESH_MINUTES):
    """(price, price_utc, fresh) for sym from a prices.json doc, or (None, None, False)."""
    if not isinstance(doc, dict):
        return None, None, False
    p = _f((doc.get("prices") or {}).get(sym))
    if p is None or p <= 0:
        return None, None, False
    t = price_time(doc, sym)
    if t is None:
        return p, None, False
    age = (now_utc - t).total_seconds()
    return p, t, -60 <= age <= minutes * 60


# ---------------------------------------------------------------- money helpers

def round_paise(x):
    """Round a price to the paisa (half up)."""
    return math.floor(float(x) * 100 + 0.5 + EPS) / 100.0


def shares_for(inr_amount, per_share):
    """Whole shares that fit in inr_amount at per_share, in exact integer paise."""
    u, p = int(round(float(inr_amount) * 100)), int(round(float(per_share) * 100))
    if p <= 0 or u <= 0:
        return 0
    return u // p


def _price(x):
    """358.3 -> "358.30"."""
    return "%.2f" % round_paise(x)


def _num(x):
    x = round(float(x), 4)
    return str(int(round(x))) if abs(x - round(x)) < 1e-9 else ("%.4f" % x).rstrip("0")


def rs(x):
    """Rupees: whole rupees without paise (₹1,000), else to the paisa (₹915.63)."""
    x = float(x)
    return inr(x, 0) if abs(x - round(x)) < 0.005 else inr(x)


def limit_for(price, buffer_pct, side="buy"):
    """The marketable limit: price plus (buy) or minus (sell) buffer_pct, onto the tick
    (up for a buy, down for a sell, so it never understates the worst fill)."""
    p = Decimal(str(price))
    b = Decimal(str(buffer_pct or 0)) / Decimal(100)
    if side == "buy":
        return tick_up(p * (1 + b))
    return tick_down(p * (1 - b))


def charges(qty, buy, sell, c):
    """Round-trip charges (core intraday_costs) with the config's brokerage plan."""
    flat = c.get("brokerage_flat_inr")
    flat = 20 if flat is None else flat
    pct = c.get("brokerage_pct")
    if pct is None:             # flat fee only (the core needs a number: 100% never undercuts it)
        pct = 100
    return intraday_costs(int(qty), buy, sell, flat, pct)


def loss_at_stop(qty, ref, stop, c):
    """(max_loss, gross, charges_at_stop) for qty shares bought at ref and sold at stop."""
    gross = qty * int(round((ref - stop) * 100)) / 100.0
    cost = charges(qty, ref, stop, c)["total"] if qty > 0 else 0.0
    total = gross + (cost if c.get("include_costs_in_risk", True) else 0.0)
    return round(total, 2), round(gross, 2), cost


def max_loss_shares(max_loss, ref, stop, c):
    """The largest whole qty whose loss at the stop (charges included when
    include_costs_in_risk) fits max_loss. The loss only grows with qty, so a binary search."""
    hi = shares_for(max_loss, ref - stop)     # without charges: an upper bound
    lo = 0
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if loss_at_stop(mid, ref, stop, c)[0] <= max_loss + 0.005:
            lo = mid
        else:
            hi = mid - 1
    return lo


def product_of(c):
    p = str(c.get("product") or "INTRADAY").strip().upper()
    return PRODUCT_ALIASES.get(p, p)


# ---------------------------------------------------------------- plan mode (the default)

def size_trade(plan, cfg, budget=None, limit=None, price=None, cash=None, today=None, market=False):
    """Pure function: one plan + your rules -> the sizing (a dict). qty may be 0.

    limit   your own limit price (None = the entry plus limit_buffer_pct, rounded up to the tick)
    price   a FRESH latest price; the entry is the higher of it and the plan's entry
    cash    the cash in trader-india/portfolio.json, if there is one
    today   India date (YYYY-MM-DD); a plan for another day is refused
    market  a MARKET order instead of a LIMIT (india-risk warns on it)"""
    c = dict(DEFAULTS)
    c.update(cfg or {})
    if not isinstance(plan, dict):
        raise SizeError("the plan is not a JSON object")
    if not str(plan.get("symbol") or "").strip():
        raise SizeError("the plan has no symbol (run india-exit)")
    sym = _sym(plan["symbol"])
    side = str(plan.get("side") or "buy").strip().lower()
    if side != "buy":
        raise SizeError("this pack sizes long (buy) day trades only; the plan says %r" % side)
    ex = str(plan.get("exchange") or "NSE").strip().upper()
    if ex != "NSE":
        raise SizeError("this pack trades NSE only; the plan says exchange %r" % plan.get("exchange"))
    if today and plan.get("date") and str(plan["date"]) != today:
        raise SizeError("the plan is for %s and today is %s in India: make a new plan with india-exit"
                        % (plan["date"], today))
    entry_plan, stop_in, target_in = _f(plan.get("entry")), _f(plan.get("stop")), _f(plan.get("target"))
    for name, v in (("entry", entry_plan), ("stop", stop_in), ("target", target_in)):
        if v is None or v <= 0:
            raise SizeError("the plan needs a positive %s (run india-exit); a bracket order needs entry, "
                            "stop and target" % name)
    blocked = set()
    for b in (c.get("blocked") or []):
        try:
            blocked.add(norm_symbol(b))
        except CoreError:
            blocked.add(str(b).upper())
    if sym in blocked:
        raise SizeError("%s is on your blocked list" % sym)
    if market and limit is not None:
        raise SizeError("a MARKET order has no limit price: use --limit or --market, not both")

    budget = float(budget if budget is not None else (c.get("budget") or 0))
    if budget <= 0:
        raise SizeError("no budget: pass --budget or set \"budget\" in trader-india/config.json")
    buf_pct = float(c.get("cash_buffer_pct") or 0)
    if not 0 <= buf_pct < 100:
        raise SizeError("cash_buffer_pct must be between 0 and 100")
    lim_buf = float(c.get("limit_buffer_pct") or 0)
    if not 0 <= lim_buf < 5:
        raise SizeError("limit_buffer_pct must be between 0 and 5 (it is a percent: 0.1 means 0.1%)")

    notes = []
    stop, target = tick_down(stop_in), tick_down(target_in)
    if abs(stop - stop_in) > EPS:
        notes.append("The plan's stop %s is not on the NSE tick grid: rounded down to %s." % (stop_in, _price(stop)))
    if abs(target - target_in) > EPS:
        notes.append("The plan's target %s is not on the NSE tick grid: rounded down to %s."
                     % (target_in, _price(target)))

    entry_plan = round_paise(entry_plan)
    fresh = round_paise(price) if price is not None else None
    if fresh is not None and fresh > entry_plan + EPS:
        base, base_from = fresh, "price"
    else:
        base, base_from = entry_plan, "plan"
    if market:
        order_type, lim, lim_from = "MARKET", None, None
        ref, ref_from = base, base_from
    else:
        order_type = "LIMIT"
        if limit is not None:
            lim, lim_from = tick_up(limit), "yours"
            if abs(lim - float(limit)) > EPS:
                notes.append("Your limit %s is not on the NSE tick grid: rounded up to %s." % (limit, _price(lim)))
        else:
            lim, lim_from = limit_for(base, lim_buf), "buffer"
        ref, ref_from = max((lim, "limit"), (entry_plan, "plan"), (fresh or 0, "price"), key=lambda x: x[0])
        if lim < base - EPS:
            notes.append("Your limit %s is under the %s %s: the order waits for the price to come back, "
                         "and the risk is still measured from %s."
                         % (_price(lim), "latest price" if base_from == "price" else "plan's entry",
                            _price(base), _price(ref)))
    if stop >= ref - EPS:
        raise SizeError("the stop %s is not below the entry %s; a long trade needs its stop underneath"
                        % (_price(stop), _price(ref)))
    if target <= ref + EPS:
        raise SizeError("the target %s is not above the entry %s: the move has already happened. "
                        "Skip it or make a new plan with india-exit" % (_price(target), _price(ref)))
    risk_c = int(round((ref - stop) * 100))
    reward_c = int(round((target - ref) * 100))
    risk = risk_c / 100.0

    cash_buffer = round(budget * buf_pct / 100.0, 2)
    available = budget - cash_buffer
    cash_note = "budget %s minus the %s cash buffer" % (rs(budget), rs(cash_buffer))
    if cash is not None and cash - cash_buffer < available - 0.005:
        available = cash - cash_buffer
        cash_note = "cash %s in trader-india/portfolio.json minus the %s buffer" % (rs(cash), rs(cash_buffer))
    available = max(round(available, 2), 0.0)

    limits = []
    max_loss = _f(c.get("max_loss_per_trade_inr"))
    with_costs = bool(c.get("include_costs_in_risk", True))
    if max_loss:
        limits.append({"name": "max loss", "inr": max_loss, "per": risk,
                       "shares": max_loss_shares(max_loss, ref, stop, c),
                       "how": "%s max loss / %s risk a share%s" % (rs(max_loss), _price(risk),
                                                                    " + charges" if with_costs else "")})
    cap_pct = _f(c.get("max_position_pct"))
    if cap_pct:
        cap = round(budget * cap_pct / 100.0, 2)
        limits.append({"name": "position cap", "inr": cap, "per": ref, "shares": shares_for(cap, ref),
                       "how": "%s%% of %s = %s / %s" % (_num(cap_pct), rs(budget), rs(cap), _price(ref))})
    max_order = _f(c.get("max_order_inr"))
    if max_order:
        limits.append({"name": "max order", "inr": max_order, "per": ref, "shares": shares_for(max_order, ref),
                       "how": "%s / %s" % (rs(max_order), _price(ref))})
    if not c.get("allow_margin"):
        limits.append({"name": "cash", "inr": available, "per": ref, "shares": shares_for(available, ref),
                       "how": "%s = %s / %s" % (cash_note, rs(available), _price(ref))})
    else:
        notes.append("allow_margin is true: your cash does not cap the size (this would use the broker's "
                     "intraday leverage, borrowed money).")

    qty = max(0, min(l["shares"] for l in limits))
    bound = [l["name"] for l in limits if l["shares"] == qty]
    for l in limits:
        l["binds"] = l["name"] == bound[0]
    cost = round(qty * ref, 2)
    loss, gross, at_stop = loss_at_stop(qty, ref, stop, c)
    at_target = charges(qty, ref, target, c)["total"] if qty > 0 else 0.0
    rr = round(reward_c / float(risk_c), 2)
    rr_net = None
    if qty > 0:
        rr_net = round((qty * reward_c / 100.0 - at_target) / (gross + at_stop), 2)
    refusal = None
    if qty == 0:
        if bound[0] == "max loss":
            one = charges(1, ref, stop, c)["total"]
            refusal = ("one share risks %s (entry %s minus stop %s)%s, more than your %s max loss per trade. "
                       "No order. Skip this trade, or plan a closer stop with india-exit."
                       % (rs(risk), _price(ref), _price(stop),
                          (" plus %s in charges" % rs(one)) if with_costs else "", rs(max_loss)))
        else:
            refusal = ("one share of %s costs %s, more than your %s limit (%s). No order."
                       % (sym, rs(ref), bound[0], [l["how"] for l in limits if l["name"] == bound[0]][0]))
    elif _f(c.get("min_reward_risk")) and reward_c < _f(c["min_reward_risk"]) * risk_c - EPS:
        refusal = ("reward:risk %.2f (target %s, entry %s, stop %s) is under your minimum %s, so india-risk "
                   "would block it. No order. Skip it, or make a new plan with india-exit."
                   % (reward_c / float(risk_c), _price(target), _price(ref), _price(stop), _num(c["min_reward_risk"])))
    elif cost < float(c.get("min_order_inr") or 0) - 0.005:
        refusal = ("%d share%s of %s is %s, under your %s minimum order. No order."
                   % (qty, "" if qty == 1 else "s", sym, rs(cost), rs(c["min_order_inr"])))
    return {
        "symbol": sym, "exchange": "NSE", "side": "buy", "setup": plan.get("setup", ""), "date": plan.get("date"),
        "entry_time": plan.get("entry_time", ""), "entry_plan": entry_plan, "price_latest": fresh,
        "entry_base": base, "entry_base_from": base_from,
        "order_type": order_type, "limit_price": lim, "limit_from": lim_from, "limit_buffer_pct": lim_buf,
        "entry": ref, "entry_from": ref_from, "stop": stop, "target": target,
        "risk_per_share": risk, "reward_risk": rr, "reward_risk_net": rr_net,
        "stop_label": plan.get("stop_label", ""), "target_label": plan.get("target_label", ""),
        "budget": budget, "cash_buffer_pct": buf_pct, "cash_buffer": cash_buffer, "cash_available": available,
        "max_loss_per_trade_inr": max_loss, "include_costs_in_risk": with_costs, "limits": limits,
        "qty": qty, "bound_by": bound[0], "cost": cost, "loss_gross": gross, "costs_at_stop": at_stop,
        "costs_at_target": at_target, "max_loss": loss, "product": product_of(c),
        "flat_by": plan.get("flat_by") or c.get("flat_by"), "notes": notes, "refusal": refusal,
    }


def bracket_order(s):
    """The one proposed order in trader-india/orders.json format, plus why and plan (notes)."""
    if s["refusal"] or s["qty"] <= 0:
        return None
    setup = SETUP_WORDS.get(s["setup"], s["setup"] or "day trade")
    bound = {"max loss": "%s max loss per trade" % rs(s["max_loss_per_trade_inr"] or 0),
             "position cap": "position cap", "max order": "max order",
             "cash": "cash after the buffer"}[s["bound_by"]]
    loss_how = "%d x %s" % (s["qty"], _price(s["risk_per_share"]))
    if s["include_costs_in_risk"]:
        loss_how += " + %s charges" % rs(s["costs_at_stop"])
    why = ("%s on %s: %d shares, bound by your %s (%s = %s at the stop)"
           % (setup, s["symbol"], s["qty"], bound, loss_how, rs(s["max_loss"])))
    return {
        "symbol": s["symbol"],
        "exchange": "NSE",
        "side": "buy",
        "qty": int(s["qty"]),
        "order_type": s["order_type"],
        "price": s["limit_price"],
        "trigger_price": None,
        "product": s["product"],
        "validity": "DAY",
        "stop_loss": s["stop"],
        "target": s["target"],
        "bracket": True,
        "why": why,
        "plan": {"entry": s["entry_plan"], "stop": s["stop"], "target": s["target"],
                 "risk_per_share": s["risk_per_share"], "costs_at_stop": s["costs_at_stop"],
                 "max_loss": s["max_loss"], "setup": s["setup"], "entry_time": s["entry_time"],
                 "flat_by": s["flat_by"]},
    }


def plan_report(s, order, notes=()):
    lines = []
    setup = SETUP_WORDS.get(s["setup"], s["setup"] or "setup")
    lines.append("%s buy on NSE, %s, entry %s%s" % (s["symbol"], setup, _price(s["entry_plan"]),
                                                   (" at %s India time" % s["entry_time"]) if s["entry_time"] else ""))
    lines.append("Stop %s%s. Target %s%s." % (_price(s["stop"]), (": " + s["stop_label"]) if s["stop_label"] else "",
                                             _price(s["target"]),
                                             (": " + s["target_label"]) if s["target_label"] else ""))
    for n in list(notes) + list(s.get("notes") or []):
        lines.append(n)
    if s["order_type"] == "LIMIT":
        if s["limit_from"] == "buffer":
            lines.append("Limit price %s: the %s %s plus your %s%% buffer, rounded up to the %s tick."
                         % (_price(s["limit_price"]),
                            "latest price" if s["entry_base_from"] == "price" else "plan's entry",
                            _price(s["entry_base"]), _num(s["limit_buffer_pct"]),
                            _num(tick_size(s["limit_price"]))))
        else:
            lines.append("Limit price %s (yours)." % _price(s["limit_price"]))
    else:
        lines.append("MARKET order: india-risk warns on it (Angel One reportedly bars API market orders "
                     "from 2026-04-01; Dhan turns them into limits).")
    src = {"plan": "the plan's entry", "price": "the latest price, above the plan's entry",
           "limit": "the limit price, the worst fill the order allows"}[s["entry_from"]]
    lines.append("Risk measured from %s (%s): %s a share (%s minus stop %s). Reward:risk %.2f."
                 % (_price(s["entry"]), src, _price(s["risk_per_share"]), _price(s["entry"]), _price(s["stop"]),
                    s["reward_risk"]))
    lines.append("")
    lines.append("Limits (whole shares; the smallest one wins):")
    for l in s["limits"]:
        lines.append("  %-13s %-66s %4d shares%s" % (l["name"], l["how"], l["shares"],
                                                      "  <- binds" if l["binds"] else ""))
    lines.append("")
    if order is None:
        lines.append("No order: " + s["refusal"])
        lines.append("Education and tooling, not financial advice.")
        return "\n".join(lines)
    loss_how = "%d x %s = %s" % (s["qty"], _price(s["risk_per_share"]), rs(s["loss_gross"]))
    if s["include_costs_in_risk"]:
        loss_how += " + %s charges = %s" % (rs(s["costs_at_stop"]), rs(s["max_loss"]))
    else:
        loss_how += " (charges of %s at the stop not counted: include_costs_in_risk is false)" % rs(s["costs_at_stop"])
    lines.append("Size: %d shares of %s = %s at %s. Max loss at the stop: %s."
                 % (s["qty"], s["symbol"], rs(s["cost"]), _price(s["entry"]), loss_how))
    lines.append("Charges at the target: %s. Reward:risk %.2f, net of charges %.2f."
                 % (rs(s["costs_at_target"]), s["reward_risk"], s["reward_risk_net"]))
    lines.append("A stop is an order, not a promise: in a fast market it can fill below %s, and if %s hits its "
                 "lower circuit (price band) it may not fill at all. Yahoo data does not carry the band."
                 % (_price(s["stop"]), s["symbol"]))
    lines.append("")
    lines.append("Proposed bracket order (nothing has been placed):")
    how = "LIMIT %s" % _price(order["price"]) if order["order_type"] == "LIMIT" else "MARKET"
    lines.append("  BUY %d %s on NSE, %s, %s, DAY, stop-loss %s, target %s"
                 % (order["qty"], order["symbol"], how, order["product"], _price(order["stop_loss"]),
                    _price(order["target"])))
    if s["flat_by"]:
        lines.append("Flat by %s India time: anything still open then gets closed (india-alerts rings, "
                     "india-broker flatten), before the broker's own intraday square-off." % s["flat_by"])
    lines.append("")
    lines.append("Next: india-risk checks it, then india-broker asks you yes or no.")
    lines.append("Education and tooling, not financial advice.")
    return "\n".join(lines)


# ---------------------------------------------------------------- weights mode (v1)

def normalise(rows, blocked=(), top=None):
    """Drop blocked and non-positive weights, keep the top N, renormalise to 100."""
    bl = set()
    for b in (blocked or []):
        try:
            bl.add(norm_symbol(b))
        except CoreError:
            bl.add(str(b).upper())
    dropped, keep, seen = [], [], set()
    for r in rows:
        if r["symbol"] in seen:
            raise SizeError("%s is listed twice in the weights" % r["symbol"])
        seen.add(r["symbol"])
        if r["symbol"] in bl:
            dropped.append({"symbol": r["symbol"], "reason": "on your blocked list"})
        elif r["weight"] <= 0:
            dropped.append({"symbol": r["symbol"], "reason": "weight is zero or negative"})
        else:
            keep.append(dict(r))
    keep.sort(key=lambda r: -r["weight"])
    if top:
        for r in keep[top:]:
            dropped.append({"symbol": r["symbol"], "reason": "outside the top %d" % top})
        keep = keep[:top]
    total = sum(r["weight"] for r in keep)
    for r in keep:
        r["source_weight"] = r["weight"]
        r["weight"] = 100.0 * r["weight"] / total if total else 0.0
    return keep, dropped


def allocate(rows, investable, cap):
    """Exact (unrounded) rupees per symbol with the cap enforced.

    Proportional to weight; any stock over the cap is pinned at the cap and
    the rest of the money is shared over the others, repeated until no stock
    is over. Returns ({symbol: rupees}, set of capped symbols)."""
    alloc, capped = {}, set()
    active = list(rows)
    money_left = investable
    while active:
        wsum = sum(r["weight"] for r in active)
        trial = {r["symbol"]: money_left * r["weight"] / wsum for r in active}
        over = [r for r in active if trial[r["symbol"]] > cap + EPS]
        if not over:
            alloc.update(trial)
            break
        for r in over:
            alloc[r["symbol"]] = cap
            capped.add(r["symbol"])
            money_left -= cap
        active = [r for r in active if r["symbol"] not in capped]
        if money_left <= EPS:
            for r in active:
                alloc[r["symbol"]] = 0.0
            break
    return alloc, capped


def round_to_paise(exact, capped, order, cap):
    """Round each slice to the paisa and keep the total (rounded DOWN to the paisa,
    so it never spends money you do not have). The leftover paise go to the biggest
    stocks that are not capped, never pushing anyone over the cap."""
    def units(x):
        return int(math.floor(x * 100 + EPS))

    cap_u = units(cap)
    total_u = units(sum(exact.values()))
    out = {}
    for t, v in exact.items():
        out[t] = cap_u if t in capped else int(math.floor(v * 100 + 0.5 + EPS))
    diff = total_u - sum(out.values())
    takers = [t for t in order if t not in capped]
    guard = 0
    while diff != 0 and takers and guard < 100000:
        moved = False
        for t in takers:
            if diff == 0:
                break
            if diff > 0 and out[t] + 1 <= cap_u:
                out[t] += 1
                diff -= 1
                moved = True
            elif diff < 0 and out[t] > 0:
                out[t] -= 1
                diff += 1
                moved = True
        if not moved:
            break
        guard += 1
    return {t: round(u / 100.0, 2) for t, u in out.items()}


def whole_shares(slices, prices, order, cap, cash):
    """Whole shares: floor each slice, then buy one more share at a time for the
    stock furthest below its slice while cash lasts and the cap holds."""
    shares = {}
    for t in order:
        shares[t] = int(math.floor(slices[t] / prices[t] + EPS)) if slices[t] > 0 else 0
    left = cash - sum(shares[t] * prices[t] for t in order)
    while True:
        best, gap = None, None
        for t in order:
            p = prices[t]
            if p > left + EPS or (shares[t] + 1) * p > cap + EPS:
                continue
            g = slices[t] - shares[t] * p
            if best is None or g > gap + EPS:
                best, gap = t, g
        if best is None:
            break
        shares[best] += 1
        left -= prices[best]
    return shares


def size(rows, cfg, budget=None, prices=None, top=None):
    """Weights mode. Pure function: weights + rules + quotes -> the full sizing result (a dict)."""
    c = dict(DEFAULTS)
    c.update(cfg or {})
    budget = float(budget if budget is not None else (c.get("budget") or 0))
    if budget <= 0:
        raise SizeError("no budget: pass --budget or set \"budget\" in trader-india/config.json")
    buf_pct = float(c.get("cash_buffer_pct") or 0)
    cap_pct = float(c.get("max_position_pct") or 100)
    min_order = float(c.get("min_order_inr") or 0)
    lim_buf = float(c.get("limit_buffer_pct") or 0)
    if not 0 <= buf_pct < 100:
        raise SizeError("cash_buffer_pct must be between 0 and 100")
    if not 0 < cap_pct <= 100:
        raise SizeError("max_position_pct must be above 0 and at most 100")
    prices = prices or {}

    keep, dropped = normalise(rows, c.get("blocked"), top)
    if not keep:
        raise SizeError("nothing to size: no weights left after the blocked list")
    missing = [r["symbol"] for r in keep if not prices.get(r["symbol"])]
    if missing:
        raise SizeError("whole shares need a price for: %s (add them to trader-india/prices.json, "
                        "e.g. with india-alerts, or pass --prices FILE)" % ", ".join(missing))
    limits = {r["symbol"]: limit_for(prices[r["symbol"]], lim_buf) for r in keep}

    cash_buffer = round(budget * buf_pct / 100.0, 2)
    investable = round(budget - cash_buffer, 2)
    cap = round(budget * cap_pct / 100.0, 2)

    while True:
        live = [dict(r) for r in keep]
        tot = sum(r["source_weight"] for r in live)
        for r in live:
            r["weight"] = 100.0 * r["source_weight"] / tot
        exact, capped = allocate(live, investable, cap)
        order = [r["symbol"] for r in sorted(live, key=lambda r: -exact[r["symbol"]])]
        slices = round_to_paise(exact, capped, order, cap)
        shares = whole_shares(slices, limits, order, cap, sum(slices.values()))
        spend = {t: round(shares[t] * limits[t], 2) for t in order}
        small = [r for r in live if spend[r["symbol"]] < min_order - EPS]
        if not small:
            break
        worst = min(small, key=lambda r: (r["source_weight"], r["symbol"]))
        t = worst["symbol"]
        if shares[t] == 0:
            reason = ("one share at its limit %s costs more than its %s slice; it cannot be bought in "
                      "whole shares" % (_price(limits[t]), rs(slices[t])))
        else:
            reason = "its %s is under your %s minimum order" % (rs(spend[t]), rs(min_order))
        dropped.append({"symbol": t, "reason": reason})
        keep = [r for r in keep if r["symbol"] != t]
        if not keep:
            raise SizeError("every slice is under your minimum order; raise the budget or hold fewer stocks")

    positions = []
    for r in sorted(live, key=lambda r: -r["weight"]):
        t = r["symbol"]
        positions.append({"symbol": t, "name": r["name"], "weight": round(r["weight"], 2),
                          "source_weight": r["source_weight"], "slice": slices[t], "price": prices[t],
                          "limit_price": limits[t], "shares": shares[t], "inr": spend[t],
                          "capped": t in capped})
    invested = round(sum(p["inr"] for p in positions), 2)
    return {
        "budget": budget, "cash_buffer_pct": buf_pct, "cash_buffer": cash_buffer,
        "investable": investable, "max_position_pct": cap_pct, "cap": cap,
        "min_order_inr": min_order, "limit_buffer_pct": lim_buf, "product": product_of(c),
        "positions": positions, "invested": invested,
        "idle": round(investable - invested, 2), "dropped": dropped,
    }


def orders_from(result, source=""):
    """Weights mode: proposed plain LIMIT buys, one per position, in trader-india/orders.json format."""
    out = []
    for p in result["positions"]:
        if p["shares"] <= 0:
            continue
        why = "%.2f%% of the split" % p["weight"]
        if source:
            why = "%s, weights from %s" % (why, source)
        if p["capped"]:
            why += "; capped at %s%% of the %s budget" % (_num(result["max_position_pct"]), rs(result["budget"]))
        out.append({"symbol": p["symbol"], "exchange": "NSE", "side": "buy", "qty": int(p["shares"]),
                    "order_type": "LIMIT", "price": p["limit_price"], "trigger_price": None,
                    "product": result["product"], "validity": "DAY", "stop_loss": None, "target": None,
                    "bracket": False, "why": why})
    return out


def report(result, orders, source=""):
    """Weights mode table."""
    r = result
    lines = []
    if source:
        lines.append("Weights from: %s" % source)
    lines.append("Budget %s, cash buffer %s%% = %s, investing %s, cap %s%% = %s per stock"
                 % (rs(r["budget"]), _num(r["cash_buffer_pct"]), rs(r["cash_buffer"]),
                    rs(r["investable"]), _num(r["max_position_pct"]), rs(r["cap"])))
    lines.append("Each buy is a LIMIT at the quote plus %s%%, rounded up to the tick." % _num(r["limit_buffer_pct"]))
    lines.append("")
    lines.append("%-12s %-18s %8s %13s %10s %7s %13s  note" % ("symbol", "name", "weight", "slice", "limit",
                                                             "shares", "cost"))
    for p in r["positions"]:
        row = "%-12s %-18s %7.2f%% %13s %10s %7d %13s" % (p["symbol"], (p["name"] or "")[:18], p["weight"],
                                                         rs(p["slice"]), _price(p["limit_price"]), p["shares"],
                                                         rs(p["inr"]))
        if p["capped"]:
            row += "  capped at %s%%" % _num(r["max_position_pct"])
        lines.append(row)
    lines.append("%-12s %-18s %8s %13s %10s %7s %13s" % ("", "invested", "", "", "", "", rs(r["invested"])))
    lines.append("%-12s %-18s %8s %13s %10s %7s %13s" % ("", "cash buffer", "", "", "", "", rs(r["cash_buffer"])))
    lines.append("%-12s %-18s %8s %13s %10s %7s %13s" % ("", "left idle", "", "", "", "", rs(r["idle"])))
    if r["idle"] >= 1:
        lines.append("")
        lines.append("Left idle %s: whole shares do not divide evenly, or every stock is at its cap." % rs(r["idle"]))
    for d in r["dropped"]:
        lines.append("Dropped %s: %s" % (d["symbol"], d["reason"]))
    lines.append("")
    lines.append("Proposed orders (nothing has been placed):")
    for o in orders:
        lines.append("  BUY %d %s on NSE, LIMIT %s, %s, DAY" % (o["qty"], o["symbol"], _price(o["price"]),
                                                             o["product"]))
    lines.append("")
    lines.append("These buys have no stop. india-risk blocks them while \"require_stop\" is true, and blocks a "
                 "DELIVERY product unless your config allows it: use a separate config (--config) for a "
                 "long-term split.")
    lines.append("Next: india-risk checks every order, then india-broker asks you yes or no for each one.")
    lines.append("Education and tooling, not financial advice.")
    return "\n".join(lines)


# ---------------------------------------------------------------- orders file

def write_orders(path, orders, cfg, source="", now_utc=None):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    doc = {
        "created_by": "india-budget",
        "created_at": utc_iso(now_utc),
        "status": "proposed",
        "paper": bool(cfg.get("paper", True)),
        "note": ORDERS_NOTE,
        "source": source,
        "orders": orders,
    }
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------- main

def _now(text):
    try:
        return parse_now(text)
    except CoreError as e:
        raise SizeError(str(e))


def run_plan(a, cfg):
    now = _now(a.now)
    today = to_ist(now).date().isoformat()
    plan = read_json(a.plan, "plan (run india-exit first, or use --weights for a split)")
    limit = None
    if a.limit is not None:
        limit = _f(a.limit)
        if limit is None or limit <= 0:
            raise SizeError("--limit wants a price, like --limit 364.50")
    sym = ""
    try:
        sym = norm_symbol((plan or {}).get("symbol")) if isinstance(plan, dict) else ""
    except CoreError:
        sym = ""
    notes, price = [], None
    ppath = a.prices or (PRICES_FILE if os.path.exists(PRICES_FILE) else None)
    if ppath and sym:
        pdoc = read_json(ppath, "prices")
        p, t, fresh = fresh_price(pdoc, sym, now)
        if p is not None and fresh:
            price = p
            if round_paise(p) > round_paise(_f(plan.get("entry")) or 0):
                notes.append("%s last %s (as of %s India time) is above the plan's entry %s, so the risk "
                             "is bigger: the entry is %s." % (sym, _price(p), to_ist(t).strftime("%H:%M"),
                                                              _price(plan.get("entry")), _price(p)))
        elif p is not None:
            notes.append("%s in %s is %s: not used (older than %d minutes). The entry is the plan's."
                         % (sym, ppath, ("from " + to_ist(t).strftime("%Y-%m-%d %H:%M") + " India time")
                            if t else "undated", FRESH_MINUTES))
    cash = None
    if a.portfolio and os.path.exists(a.portfolio):
        pf = read_json(a.portfolio, "portfolio")
        cash = _f(pf.get("cash")) if isinstance(pf, dict) else None
    s = size_trade(plan, cfg, a.budget, limit, price, cash, today, market=a.market)
    order = bracket_order(s)
    if order and a.write:
        src = "%s (%s %s %s)" % (PLAN_FILE, s["symbol"], s["setup"] or "plan", s["date"] or today)
        write_orders(a.write, [order], cfg, src, now)
    if a.json:
        print(json.dumps({"sizing": s, "orders": [order] if order else [], "notes": notes}, indent=2,
                         ensure_ascii=False))
    else:
        print(plan_report(s, order, notes))
        if order and a.write:
            print("Wrote 1 proposed bracket order to %s" % a.write)
    return 0 if order else 1


def run_weights(a, cfg):
    source = ""
    if a.weights:
        rows = parse_weights(weights_from_arg(a.weights))
    else:
        data = read_json(a.targets, "weights file")
        rows = parse_weights(data)
        if isinstance(data, dict):
            source = data.get("source", "")
    ppath = a.prices or (PRICES_FILE if os.path.exists(PRICES_FILE) else None)
    prices = load_prices(ppath)
    result = size(rows, cfg, a.budget, prices, a.top)
    orders = orders_from(result, source)
    if a.write:
        write_orders(a.write, orders, cfg, source, _now(a.now))
    if a.json:
        print(json.dumps({"result": result, "orders": orders}, indent=2, ensure_ascii=False))
    else:
        print(report(result, orders, source))
        if a.write:
            print("Wrote %d proposed orders to %s" % (len(orders), a.write))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Size an NSE day trade to your budget and max loss (india-budget).")
    ap.add_argument("--plan", default=PLAN_FILE, help="the trade plan (default %s)" % PLAN_FILE)
    ap.add_argument("--config", default=CONFIG_FILE, help="rules (default %s)" % CONFIG_FILE)
    ap.add_argument("--budget", type=float, help="override the budget in the config (rupees)")
    g0 = ap.add_mutually_exclusive_group()
    g0.add_argument("--limit", metavar="PRICE", help="your own limit price instead of the entry plus the buffer")
    g0.add_argument("--market", action="store_true", help="a MARKET order instead of a LIMIT (india-risk warns)")
    ap.add_argument("--prices", help="prices JSON (default %s if it exists)" % PRICES_FILE)
    ap.add_argument("--portfolio", default=PORTFOLIO_FILE, help="your account; its cash caps the size if it exists")
    ap.add_argument("--now", help="pretend it is this India time, e.g. \"2026-10-19 10:00\"")
    ap.add_argument("--write", nargs="?", const=ORDERS_FILE, metavar="PATH",
                    help="write the proposed order (default %s)" % ORDERS_FILE)
    ap.add_argument("--json", action="store_true", help="print JSON instead of the report")
    g = ap.add_argument_group("weights mode (split a budget across a list)")
    g.add_argument("--weights", help="inline weights: SYN-A=40,SYN-B=25")
    g.add_argument("--targets", help="a weights file: {\"weights\": [{\"symbol\", \"weight\"}]}")
    g.add_argument("--top", type=int, help="keep only the N biggest weights")
    a = ap.parse_args(argv)
    try:
        cfg = load_config(a.config)
        if a.weights or a.targets:
            if a.limit is not None or a.market:
                raise SizeError("--limit and --market work on a plan, not with --weights or --targets")
            return run_weights(a, cfg)
        if a.top:
            raise SizeError("--top works with --weights or --targets")
        return run_plan(a, cfg)
    except (SizeError, CoreError) as e:
        print("size.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
