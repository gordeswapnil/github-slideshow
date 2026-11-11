#!/usr/bin/env python3
"""Order tickets, paper fills and the decision log for india-broker (NSE).
Standard library only.

This tool never talks to a broker and never places a live order. It does its
work around the one moment that matters, your yes:

  show      renders each order in trader-india/orders.json as a plain ticket
            (rupees, India time, prices on the NSE tick grid, the max loss at
            the stop including estimated charges) plus the exact request for
            your broker: Dhan (a bracket is ONE Super Order) or Angel One (the
            entry LIMIT, then a STOPLOSS_LIMIT sell after the fill). An order
            is READY only if india-risk passed THIS exact order today (matched
            by fingerprint) and nobody has decided on it yet. A live ticket also
            needs the broker's security ID (see ids).
  approve   records your explicit yes for ONE order, with your reply word for
            word. It refuses "yes to all", "sure", "ok", a yes that names a
            different stock or amount, and any order that is not READY.
  decline   records a no.
  paper     simulates the fill of an approved order here (paper mode, the
            default): at the limit, or at --price if that is at or better than
            the limit, otherwise not filled. Logs it with the max loss and
            updates trader-india/portfolio.json.
  result    records what happened to a LIVE order you entered yourself:
            placed (with the broker's order id), denied, or failed.
  fill      records a fill in trader-india/portfolio.json (cash and shares).
  flatten   builds the LIMIT sell that closes a symbol's position by flat_by.
            It still goes through india-risk and your yes.
  ids       looks up Dhan security IDs and Angel One symbol tokens in the
            scrip-master files you downloaded, into trader-india/security_ids.json.
  log       prints today's decisions.

    python3 ticket.py show                      # every order, READY or not
    python3 ticket.py show --as dhan            # paper mode: also show Dhan's request
    python3 ticket.py approve --index 1 --reply "yes"
    python3 ticket.py paper --index 1 --price 364.40
    python3 ticket.py result --index 1 --status placed --broker-id 1234
    python3 ticket.py fill --symbol SYNTH --side sell --qty 137 --price 358.30
    python3 ticket.py flatten --symbol SYNTH --price 366.10
    python3 ticket.py ids --dhan-csv api-scrip-master.csv --angel-json OpenAPIScripMaster.json SYNTH
    python3 ticket.py log

Everything is written to trader-india/state/broker.json (append only). Dates
and times are India time (IST, UTC+05:30, no daylight saving); --now
"2026-10-19 09:55" pins the clock. No credentials are read, written or printed:
the broker requests carry placeholders like "<your Dhan client id>".
"""

import argparse
import csv
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

ORDERS_FILE = os.path.join(DATA_DIR, "orders.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
RISK_FILE = os.path.join(DATA_DIR, "state", "risk.json")
STATE_FILE = os.path.join(DATA_DIR, "state", "broker.json")
PORTFOLIO_FILE = os.path.join(DATA_DIR, "portfolio.json")
PRICES_FILE = os.path.join(DATA_DIR, "prices.json")
PLAN_FILE = os.path.join(DATA_DIR, "plan.json")
IDS_FILE = os.path.join(DATA_DIR, "security_ids.json")

BROKERS = ("paper", "dhan", "angelone")
BROKER_NAMES = {"paper": "paper", "dhan": "Dhan", "angelone": "Angel One"}
DEFAULTS = {"broker": "paper", "paper": True, "include_costs_in_risk": True, "brokerage_flat_inr": 20,
            "brokerage_pct": 0.03, "limit_buffer_pct": 0.1, "stop_limit_ticks": 5, "flat_by": "15:00",
            "product": "INTRADAY", "budget": None}

# Broker request shapes: from the brokers' official SDK source and docs as read in
# late 2026. NOT live-tested: no order has ever been sent from this pack.
DHAN_ORDER_URL = "https://api.dhan.co/v2/orders"
DHAN_SUPER_URL = "https://api.dhan.co/v2/super/orders"
ANGEL_ORDER_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/placeOrder"
DHAN_SCRIP_URL = "https://images.dhan.co/api-data/api-scrip-master.csv"
ANGEL_SCRIP_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
DHAN_CLIENT = "<your Dhan client id>"
DHAN_COLS = ("SEM_EXM_EXCH_ID", "SEM_INSTRUMENT_NAME", "SEM_TRADING_SYMBOL", "SEM_SMST_SECURITY_ID")
ANGEL_KEYS = ("token", "symbol", "exch_seg")

TYPE_ALIASES = {"LIMIT": "LIMIT", "MARKET": "MARKET", "SL": "SL", "STOP_LOSS": "SL", "STOPLOSS_LIMIT": "SL",
                "STOP_LIMIT": "SL", "SL-M": "SL-M", "SLM": "SL-M", "SL_M": "SL-M", "STOP_LOSS_MARKET": "SL-M",
                "STOPLOSS_MARKET": "SL-M", "STOP_MARKET": "SL-M"}
TYPE_WORDS = {"LIMIT": "limit", "MARKET": "market", "SL": "stop-limit", "SL-M": "stop-market"}
DHAN_TYPES = {"LIMIT": "LIMIT", "MARKET": "MARKET", "SL": "STOP_LOSS", "SL-M": "STOP_LOSS_MARKET"}
ANGEL_TYPES = {"LIMIT": "LIMIT", "MARKET": "MARKET", "SL": "STOPLOSS_LIMIT", "SL-M": "STOPLOSS_MARKET"}
# our product -> (Dhan productType, Angel One producttype, plain words)
PRODUCTS = {"INTRADAY": ("INTRADAY", "INTRADAY", "intraday (MIS)"), "MIS": ("INTRADAY", "INTRADAY", "intraday (MIS)"),
            "CNC": ("CNC", "DELIVERY", "delivery (CNC)"), "DELIVERY": ("CNC", "DELIVERY", "delivery (CNC)")}
VALIDITY_WORDS = {"DAY": "good for today", "IOC": "immediate or cancel"}

YES_WORDS = ("yes", "y")
BATCH_WORDS = {"all", "every", "everything", "rest", "remaining", "them", "both", "batch", "each"}
DOUBT_WORDS = {"no", "not", "dont", "don't", "wait", "cancel", "stop", "but", "maybe", "later",
               "hold", "unless", "if"}
SECRET_KEY_RE = re.compile(r"(client_?id|token|pin|totp|password|passwd|secret|api_?key|jwt)", re.I)

STATIC_IP = ("Since 2026-04-01 %s accepts API orders (place, modify, cancel) only from the static IP address "
             "you registered with it%s. This session runs on a cloud machine that is not your IP, so Claude "
             "cannot send it from here.")


class TicketError(Exception):
    pass


# ---------------------------------------------------------------- small helpers

def _f(x):
    if isinstance(x, bool):
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _num(x):
    f = float(x)
    return str(int(f)) if f == int(f) else ("%.2f" % f).rstrip("0").rstrip(".")


def _r2(x):
    return float(Decimal(str(x)).quantize(Decimal("0.01")))


def ist_iso(now_utc):
    """naive UTC -> "2026-10-19T09:55:00+05:30" (India wall clock with its offset)."""
    return to_ist(now_utc).replace(microsecond=0).isoformat() + "+05:30"


def read_json(path, what, required=True):
    if not path or not os.path.exists(path):
        if required:
            raise TicketError("no %s at %s" % (what, path))
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise TicketError("%s is not valid JSON: %s" % (path, e))


def write_json(path, data):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def rec_day(rec):
    """The trading day a decision belongs to: its "date", else the day of "at"."""
    return str(rec.get("date") or str(rec.get("at", ""))[:10])


def parse_utc(text):
    if not text:
        return None
    try:
        dt = _core_dt.datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt
    return (dt - dt.utcoffset()).replace(tzinfo=None)


# ---------------------------------------------------------------- config and mode

def load_config(path):
    cfg = read_json(path, "config", required=False) or {}
    if not isinstance(cfg, dict):
        raise TicketError("%s should be a JSON object" % path)
    c = dict(DEFAULTS)
    c.update(cfg)
    c["broker"] = str(c.get("broker") or "paper").lower().replace(" ", "").replace("_", "")
    if c["broker"] == "angel":
        c["broker"] = "angelone"
    if c["broker"] not in BROKERS:
        raise TicketError('"broker" in %s must be "paper", "dhan" or "angelone" (it is %r)' % (path, cfg.get("broker")))
    c["_secret_keys"] = sorted(k for k, v in cfg.items() if SECRET_KEY_RE.search(str(k)) and v not in (None, "", False))
    return c


def mode_of(cfg):
    """("paper" | "live", broker). Live only when "paper" is false AND a broker is named."""
    live = cfg.get("paper", True) is False and cfg["broker"] in ("dhan", "angelone")
    return ("live" if live else "paper"), cfg["broker"]


def config_notes(cfg):
    notes = []
    if cfg.get("paper", True) is False and cfg["broker"] == "paper":
        notes.append('"paper" is false but no broker is named ("broker": "dhan" or "angelone"), so this '
                     'stays paper trading')
    if cfg.get("_secret_keys"):
        notes.append("your config holds %s: delete %s. Client ids, tokens, PINs and TOTP secrets belong in "
                     "environment variables or the broker's own app, never in a file this pack reads"
                     % (", ".join(cfg["_secret_keys"]), "it" if len(cfg["_secret_keys"]) == 1 else "them"))
    return notes


def day_notes(now):
    st = market_status(now)
    notes = []
    if not st["calendar_known"]:
        notes.append("the NSE holiday list for %s is not built in yet: add the dates NSE publishes to "
                     "trader-india/holidays.json as {\"%s-01-26\": \"Republic Day\", ...}"
                     % (st["date"][:4], st["date"][:4]))
    elif st["reason"] in ("weekend",) or st["reason"].startswith("NSE holiday"):
        notes.append("%s is not an NSE trading day (%s)" % (st["date"], st["reason"]))
    return notes


# ---------------------------------------------------------------- the order

def view(order):
    """The order in one normal shape, plus what is wrong with it. Any problem keeps it NOT READY."""
    probs = []
    try:
        sym = norm_symbol(order.get("symbol"))
    except CoreError as e:
        sym = str(order.get("symbol") or "?").upper()
        probs.append(str(e))
    exch = str(order.get("exchange") or "NSE").upper()
    if exch != "NSE":
        probs.append("only NSE equity orders are covered (this one says %s)" % exch)
    side = str(order.get("side") or "").lower()
    if side not in ("buy", "sell"):
        probs.append('side must be "buy" or "sell"')
    q = _f(order.get("qty"))
    qty = int(q) if q is not None and q > 0 and q == int(q) else None
    if qty is None:
        probs.append("qty must be a whole number of shares above 0 (it is %r)" % order.get("qty"))
    raw_type = str(order.get("order_type") or "").upper().replace(" ", "_")
    typ = TYPE_ALIASES.get(raw_type)
    if not typ:
        probs.append("order_type %r is not LIMIT, MARKET, SL or SL-M" % order.get("order_type"))
    price, trig = _f(order.get("price")), _f(order.get("trigger_price"))
    if typ in ("LIMIT", "SL") and not (price and price > 0):
        probs.append("a %s order needs a price above 0" % TYPE_WORDS[typ])
    if typ in ("SL", "SL-M") and not (trig and trig > 0):
        probs.append("a %s order needs a trigger_price above 0" % TYPE_WORDS[typ])
    product = str(order.get("product") or "INTRADAY").upper()
    if product not in PRODUCTS:
        probs.append("product %r is not INTRADAY or DELIVERY" % order.get("product"))
    validity = str(order.get("validity") or "DAY").upper()
    if validity not in VALIDITY_WORDS:
        probs.append("validity %r is not DAY or IOC" % order.get("validity"))
    stop, target = _f(order.get("stop_loss")), _f(order.get("target"))
    bracket = order.get("bracket") is True
    plan_entry = _f((order.get("plan") or {}).get("entry"))
    ref = price if typ in ("LIMIT", "SL") else (trig or plan_entry)
    if bracket:
        if stop is None or target is None:
            probs.append("a bracket needs both stop_loss and target")
        elif ref and side == "buy" and not stop < ref < target:
            probs.append("a buy bracket needs stop_loss < price < target")
        elif ref and side == "sell" and not target < ref < stop:
            probs.append("a sell bracket needs target < price < stop_loss")
    notes = []
    for label, v in (("price", price if typ in ("LIMIT", "SL") else None), ("trigger", trig),
                     ("stop-loss", stop), ("target", target)):
        if v and abs(tick_down(v) - v) > 1e-9:
            notes.append("the %s %s is not on the NSE tick grid (%s for this price): the broker rejects "
                         "it. NSE sets each stock's tick monthly, so check the stock's tick"
                         % (label, _num(v), inr(float(tick_size(v)))))
    return {"sym": sym, "side": side, "qty": qty, "type": typ, "price": price, "trigger": trig,
            "product": product, "validity": validity, "stop": stop, "target": target, "bracket": bracket,
            "plan_entry": plan_entry, "problems": probs, "notes": notes}


def risk_of(v, order, cfg):
    """What this order can lose at its stop: a dict, or None (no stop, or an exit).

    Measured from the worst fill the order allows: the limit price, or the plan's
    entry when that is worse (higher for a buy). Estimated round-trip charges are
    added when include_costs_in_risk is on (the default)."""
    stop, qty = v["stop"], v["qty"]
    if stop is None or not qty or v["side"] not in ("buy", "sell"):
        return None
    lim = v["price"] if v["type"] in ("LIMIT", "SL") else v["trigger"]
    cands = [x for x in (lim, v["plan_entry"]) if x]
    if not cands:
        ml = _f((order.get("plan") or {}).get("max_loss"))
        return {"ref": None, "stop": stop, "per_share": None, "at_stop": None, "costs": None,
                "total": round(ml, 2)} if ml is not None else None
    ref = max(cands) if v["side"] == "buy" else min(cands)
    per = _r2(ref - stop) if v["side"] == "buy" else _r2(stop - ref)
    if per <= 0:
        return None
    at_stop = _r2(Decimal(str(per)) * qty)
    costs = 0.0
    if cfg.get("include_costs_in_risk", True):
        buy, sell = (ref, stop) if v["side"] == "buy" else (stop, ref)
        costs = intraday_costs(qty, buy, sell, cfg.get("brokerage_flat_inr", 20),
                               cfg.get("brokerage_pct", 0.03))["total"]
    return {"ref": ref, "stop": stop, "per_share": per, "at_stop": at_stop, "costs": costs,
            "total": _r2(at_stop + costs)}


def stop_limit_price(stop, protect_side, cfg):
    """The limit for a protective stop-limit: a few ticks past the trigger, on the grid.
    A sell stop goes stop_limit_ticks ticks below (tick_down), a buy stop above (tick_up)."""
    n = int(_f(cfg.get("stop_limit_ticks")) or 5)
    t = tick_size(stop)
    if protect_side == "sell":
        return tick_down(Decimal(str(stop)) - n * t)
    return tick_up(Decimal(str(stop)) + n * t)


def plain_parts(v, order, cfg):
    """The ticket in plain words, one part per line."""
    q = v["qty"] if v["qty"] is not None else order.get("qty")
    head = "%s %s %s (NSE)" % (v["side"].upper() or "?", q, v["sym"])
    typ = v["type"]
    if typ == "LIMIT":
        how = "limit %s" % inr(v["price"])
    elif typ == "SL":
        how = "stop-limit: trigger %s, limit %s" % (inr(v["trigger"]), inr(v["price"]))
    elif typ == "SL-M":
        how = "stop-market: trigger %s" % inr(v["trigger"])
    else:
        how = "market"
    prod = PRODUCTS.get(v["product"], (None, None, v["product"].lower()))[2]
    parts = ["%s, %s, %s, %s" % (head, how, prod, VALIDITY_WORDS.get(v["validity"], v["validity"]))]
    if v["stop"] is not None:
        parts.append("stop-loss %s%s" % (inr(v["stop"]), "" if v["bracket"] else
                                         " (not placed with this order: india-alerts watches it)"))
    if v["target"] is not None:
        parts.append("target %s%s" % (inr(v["target"]), "" if v["bracket"] else " (not placed with this order)"))
    r = risk_of(v, order, cfg)
    if r is not None:
        if r["at_stop"] is None:
            parts.append("max loss about %s if the stop fills at %s (from the plan)" % (inr(r["total"]), inr(r["stop"])))
        else:
            parts.append("max loss about %s if the stop fills at %s (%s at the stop + %s estimated charges); "
                         "it can fill worse in a fast market, or not at all if the stock is stuck at its "
                         "price band" % (inr(r["total"]), inr(r["stop"]), inr(r["at_stop"]), inr(r["costs"])))
    return parts


def plain(v, order, cfg):
    return " / ".join(plain_parts(v, order, cfg))


def amount_numbers(v, order, cfg):
    nums = [x for x in (v["qty"], v["price"], v["trigger"], v["stop"], v["target"]) if x is not None]
    r = risk_of(v, order, cfg)
    if r:
        nums += [x for x in (r["total"], r["at_stop"], r["costs"]) if x]
    if v["bracket"] and v["stop"] is not None:
        nums.append(stop_limit_price(v["stop"], "sell" if v["side"] == "buy" else "buy", cfg))
    return nums


SYM_TOKEN_RE = re.compile(r"[A-Z0-9][A-Z0-9&\-]{0,19}")


def parse_yes(reply, order, cfg=None, batch_symbols=()):
    """Is this reply an explicit yes for THIS one order? Returns (ok, why)."""
    cfg = cfg or dict(DEFAULTS)
    v = view(order)
    raw = (reply or "").strip()
    if not raw:
        return False, "the reply is empty"
    if "?" in raw:
        return False, "the reply is a question, not a yes"
    words = re.findall(r"[a-z']+", raw.lower())
    if not words or words[0] not in YES_WORDS:
        return False, "only a reply that starts with \"yes\" counts (not ok, sure, haan, go, do it)"
    if BATCH_WORDS & set(words):
        return False, "a yes covers one order at a time, not a batch"
    if DOUBT_WORDS & set(words[1:]):
        return False, "the reply has a condition or a doubt in it; ask again"
    up = raw.upper()
    known = {str(s).upper() for s in batch_symbols if s} | {v["sym"]}
    others = known - {v["sym"]}
    named = set(SYM_TOKEN_RE.findall(up)) & others
    if named:
        return False, "the reply names %s, but this order is for %s" % (", ".join(sorted(named)), v["sym"])
    for s in sorted(known, key=len, reverse=True):
        up = re.sub(r"(?<![A-Z0-9&-])" + re.escape(s) + r"(?![A-Z0-9&-])", " ", up)
    nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", up)]
    if nums:
        want = amount_numbers(v, order, cfg)
        if not any(abs(n - w) < 0.005 for n in nums for w in want):
            return False, "the reply says %s, but this order is %s" % (
                ", ".join(_num(n) for n in nums), plain(v, order, cfg))
    return True, "explicit yes for %s" % plain(v, order, cfg)


# ---------------------------------------------------------------- security IDs

def load_ids(path):
    doc = read_json(path, "security IDs", required=False) or {}
    if not isinstance(doc, dict):
        raise TicketError('%s should look like {"SYNTH": {"dhan": "...", "angelone": "..."}}' % path)
    out = {}
    for k, v in doc.items():
        try:
            s = norm_symbol(k)
        except CoreError:
            continue
        if isinstance(v, dict):
            out[s] = {b: str(v[b]).strip() for b in ("dhan", "angelone") if v.get(b) not in (None, "")}
    return out


def dhan_lookup(path, symbols):
    """Dhan scrip master CSV -> ({SYM: security id}, problems). Keeps rows with
    SEM_EXM_EXCH_ID NSE and SEM_INSTRUMENT_NAME EQUITY, matched on SEM_TRADING_SYMBOL."""
    want = set(symbols)
    hits = {}
    try:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            rd = csv.DictReader(fh)
            cols = [str(c or "").strip() for c in (rd.fieldnames or [])]
            missing = [c for c in DHAN_COLS if c not in cols]
            if missing:
                raise TicketError("%s does not look like Dhan's scrip master (no %s column). Download it from %s"
                                  % (path, ", ".join(missing), DHAN_SCRIP_URL))
            rd.fieldnames = cols
            for row in rd:
                row = {k: str(val or "").strip() for k, val in row.items() if k}
                if row.get("SEM_EXM_EXCH_ID", "").upper() != "NSE":
                    continue
                if row.get("SEM_INSTRUMENT_NAME", "").upper() != "EQUITY":
                    continue
                sym = row.get("SEM_TRADING_SYMBOL", "").upper()
                if sym in want and row.get("SEM_SMST_SECURITY_ID"):
                    hits.setdefault(sym, []).append(row)
    except OSError as e:
        raise TicketError("could not read %s: %s" % (path, e))
    out, probs = {}, []
    for sym, rows in hits.items():
        if len({r["SEM_SMST_SECURITY_ID"] for r in rows}) > 1 and any("SEM_SERIES" in r for r in rows):
            eq = [r for r in rows if r.get("SEM_SERIES", "").upper() == "EQ"]
            rows = eq or rows
        ids = sorted({r["SEM_SMST_SECURITY_ID"] for r in rows})
        if len(ids) == 1:
            out[sym] = ids[0]
        else:
            probs.append("Dhan: %s matches %d security IDs (%s); not written. Check it in the Dhan app"
                         % (sym, len(ids), ", ".join(ids)))
    return out, probs


def angel_lookup(path, symbols):
    """Angel One scrip master JSON -> ({SYM: symbol token}, problems). Keeps records
    with exch_seg NSE and symbol "<SYM>-EQ" (the EQ series: intraday is EQ only)."""
    doc = read_json(path, "Angel One scrip master", required=True)
    if not isinstance(doc, list) or (doc and not all(k in doc[0] for k in ANGEL_KEYS)):
        raise TicketError("%s does not look like Angel One's scrip master (a list of records with %s). "
                          "Download it from %s" % (path, ", ".join(ANGEL_KEYS), ANGEL_SCRIP_URL))
    want = {s + "-EQ": s for s in symbols}
    hits = {}
    for rec in doc:
        if not isinstance(rec, dict) or str(rec.get("exch_seg", "")).upper() != "NSE":
            continue
        s = want.get(str(rec.get("symbol", "")).strip().upper())
        if s and str(rec.get("token", "")).strip():
            hits.setdefault(s, set()).add(str(rec["token"]).strip())
    out, probs = {}, []
    for s, toks in hits.items():
        if len(toks) == 1:
            out[s] = toks.pop()
        else:
            probs.append("Angel One: %s-EQ matches %d tokens (%s); not written" % (s, len(toks), ", ".join(sorted(toks))))
    return out, probs


# ---------------------------------------------------------------- broker requests

def dhan_requests(v, fp, sec_id):
    sid = sec_id or "<no Dhan security ID for %s: run ticket.py ids>" % v["sym"]
    head = {"dhanClientId": DHAN_CLIENT, "correlationId": fp, "transactionType": v["side"].upper(),
            "exchangeSegment": "NSE_EQ", "productType": PRODUCTS.get(v["product"], ("?",))[0],
            "orderType": DHAN_TYPES.get(v["type"], "?")}
    if v["bracket"]:
        body = dict(head)
        body.update({"securityId": sid, "quantity": v["qty"], "price": v["price"] or 0.0,
                     "targetPrice": v["target"], "stopLossPrice": v["stop"], "trailingJump": 0})
        return [{"step": "entry, target and stop-loss together, as ONE Super Order", "when": "now",
                 "method": "POST", "url": DHAN_SUPER_URL, "body": body}]
    body = dict(head)
    body.update({"validity": v["validity"], "securityId": sid, "quantity": v["qty"], "disclosedQuantity": 0,
                 "price": v["price"] if v["type"] in ("LIMIT", "SL") else 0.0,
                 "triggerPrice": v["trigger"] or 0.0})
    return [{"step": "the order", "when": "now", "method": "POST", "url": DHAN_ORDER_URL, "body": body}]


def _s(x):
    return "%.2f" % float(x) if x else "0"


def angel_body(v, side, typ, price, trig, token, variety):
    body = {"variety": variety, "tradingsymbol": v["sym"] + "-EQ",
            "symboltoken": token or "<no Angel One symbol token for %s: run ticket.py ids>" % v["sym"],
            "transactiontype": side.upper(), "exchange": "NSE", "ordertype": ANGEL_TYPES.get(typ, "?"),
            "producttype": PRODUCTS.get(v["product"], ("?", "?"))[1], "duration": v["validity"],
            "price": _s(price)}
    if trig:
        body["triggerprice"] = _s(trig)
    body.update({"squareoff": "0", "stoploss": "0", "quantity": str(v["qty"])})
    return body


def angel_requests(v, token, cfg):
    variety = "STOPLOSS" if v["type"] in ("SL", "SL-M") else "NORMAL"
    entry = angel_body(v, v["side"], v["type"], v["price"] if v["type"] in ("LIMIT", "SL") else None,
                       v["trigger"], token, variety)
    out = [{"step": "the entry" if v["bracket"] else "the order", "when": "now", "method": "POST",
            "url": ANGEL_ORDER_URL, "body": entry}]
    if v["bracket"]:
        protect = "sell" if v["side"] == "buy" else "buy"
        lim = stop_limit_price(v["stop"], protect, cfg)
        out.append({"step": "the protective stop-loss (STOPLOSS_LIMIT %s, trigger %s, limit %s) for the "
                            "quantity that filled" % (protect, inr(v["stop"]), inr(lim)),
                    "when": "only after the entry fills",
                    "method": "POST", "url": ANGEL_ORDER_URL,
                    "body": angel_body(v, protect, "SL", lim, v["stop"], token, "STOPLOSS")})
    return out


def requests_for(v, fp, broker, ids, cfg):
    sec = ids.get(v["sym"], {}).get(broker)
    if broker == "dhan":
        return dhan_requests(v, fp, sec)
    if broker == "angelone":
        return angel_requests(v, sec, cfg)
    return []


# ---------------------------------------------------------------- state

def load_state(path):
    st = read_json(path, "broker state", required=False) or {"orders": []}
    if not isinstance(st, dict):
        raise TicketError("%s should be a JSON object with an \"orders\" list" % path)
    st.setdefault("orders", [])
    return st


def latest(state, fp, today):
    """The latest decision recorded today for this fingerprint, or None."""
    found = None
    for rec in state.get("orders", []):
        if rec.get("fingerprint") == fp and rec_day(rec) == today:
            found = rec
    return found


def risk_verdict(risk, fp, today):
    if not risk:
        return None, "india-risk has not checked these orders (run /india-risk first)"
    if risk.get("date") != today:
        return None, "the risk check is from %s, not today; run /india-risk again" % risk.get("date")
    for r in risk.get("results", []):
        if r.get("fingerprint") == fp:
            return r, None
    return None, "this exact order was not in the last risk check (it changed or is new); run /india-risk again"


def status_of(order, risk, state, today, mode, broker, ids):
    """(ready, label, risk_result)."""
    v = view(order)
    fp = fingerprint(order)
    if v["problems"]:
        return False, "NOT READY: " + "; ".join(v["problems"]), None
    rv, why = risk_verdict(risk, fp, today)
    if rv is None:
        return False, "NOT READY: " + why, None
    if rv.get("verdict") != "PASS":
        return False, "BLOCKED by india-risk: " + "; ".join(rv.get("reasons", []) or ["no reason given"]), rv
    rec = latest(state, fp, today)
    if rec:
        st = rec.get("status")
        if st == "approved":
            nxt = ("waiting for the paper fill (ticket.py paper)" if mode == "paper" else
                   "waiting for you to enter it at %s and record it (ticket.py result)" % BROKER_NAMES[broker])
            return False, "APPROVED by you at %s, %s" % (rec.get("at"), nxt), rv
        return False, "DONE: %s at %s" % (st, rec.get("at")), rv
    if mode == "live" and not ids.get(v["sym"], {}).get(broker):
        what = "Dhan security ID" if broker == "dhan" else "Angel One symbol token"
        return False, ("NOT READY for live: no %s for %s in trader-india/security_ids.json (run ticket.py ids)"
                       % (what, v["sym"])), rv
    return True, "READY: india-risk PASS, waiting for your yes", rv


def kind_of(order, rv):
    """entry or exit, as india-risk saw it (else: a buy is an entry, a sell an exit; the pack is long only)."""
    if rv and rv.get("kind"):
        return rv["kind"]
    return "entry" if str(order.get("side", "")).lower() == "buy" else "exit"


def logged_loss(v, order, cfg, rv):
    """The max loss kept in the log for india-risk's daily limit: the ticket's, or
    india-risk's own figure when that is higher (it may use a fresher price)."""
    r = risk_of(v, order, cfg)
    mine = r["total"] if r else None
    theirs = _f((rv or {}).get("max_loss"))
    if mine is None:
        return theirs
    return max(mine, theirs) if theirs is not None else mine


# ---------------------------------------------------------------- rendering

def broker_lines(v, order, fp, cfg, broker, ids, mode, reference):
    lines = []
    reqs = requests_for(v, fp, broker, ids, cfg)
    name = BROKER_NAMES[broker]
    if reference:
        lines.append("  For reference only (paper mode: nothing goes to %s). %s would get:" % (name, name))
    elif broker == "dhan" and v["bracket"]:
        lines.append("  Dhan: ONE Super Order (entry, target and stop-loss together):")
    else:
        lines.append("  %s:" % name)
    for i, rq in enumerate(reqs, 1):
        if len(reqs) > 1:
            lines.append("  Step %d, %s: %s" % (i, rq["when"], rq["step"]))
        lines.append("    %s %s" % (rq["method"], rq["url"]))
        for l in json.dumps(rq["body"], indent=2, ensure_ascii=False).splitlines():
            lines.append("    " + l)
    if broker == "dhan":
        lines.append('  "dhanClientId" is a placeholder: your own tool fills it in. "correlationId" is this '
                     "order's fingerprint, so Dhan's order book links back to the risk check.")
        if v["bracket"] and v["product"] not in ("INTRADAY", "MIS"):
            lines.append("  note: Dhan's docs list INTRADAY for Super Orders; check that %s is accepted." % v["product"])
    if broker == "angelone":
        if v["bracket"]:
            lines.append("  The target %s is NOT placed at Angel One: two resting sells for the same intraday "
                         "shares could both fill and leave you short. india-alerts watches the target; when it "
                         "rings, cancel the stop-loss order and approve a LIMIT sell (ticket.py flatten)."
                         % inr(v["target"]))
        lines.append("  Your API key and session token go in the request headers, added by your own tool. "
                     "Never paste them, your PIN or your TOTP secret here.")
        if v["type"] == "MARKET":
            lines.append("  note: Angel One reportedly rejects API market orders for algo trading from "
                         "2026-04-01. Use a LIMIT.")
    if broker == "dhan" and v["type"] == "MARKET":
        lines.append("  note: Dhan turns API market orders into limit orders with price protection.")
    if mode == "live":
        tail = " (otherwise Dhan returns error DH-911)" if broker == "dhan" else ""
        lines.append("  " + STATIC_IP % (name, tail))
        lines.append("  Enter it yourself in the %s app, or run your own %s tool on your static-IP machine "
                     "with its order tool set to ask. Then record it: ticket.py result." % (name, name))
    return lines


def render(order, idx, total, cfg, risk, state, today, now, ids, show_as=None):
    mode, broker = mode_of(cfg)
    ready, label, rv = status_of(order, risk, state, today, mode, broker, ids)
    v = view(order)
    fp = fingerprint(order)
    if mode == "paper":
        acct = "PAPER (simulated here, nothing goes to a broker)"
    else:
        acct = "LIVE ACCOUNT, REAL MONEY, %s" % BROKER_NAMES[broker]
    lines = ["ORDER %d of %d, %s, %s IST" % (idx, total, acct, to_ist(now).strftime("%Y-%m-%d %H:%M"))]
    for part in plain_parts(v, order, cfg):
        lines.append("  " + part)
    if order.get("why"):
        lines.append("  why: " + order["why"])
    lines.append("  " + label)
    for w in list((rv or {}).get("warnings", [])) + v["notes"]:
        lines.append("  note: " + w)
    if not v["problems"]:
        shape = show_as or (broker if broker != "paper" else None)
        if shape:
            lines += broker_lines(v, order, fp, cfg, shape, ids, mode, reference=(mode == "paper"))
        if mode == "paper" and ready:
            lines.append("  Paper: after your yes, ticket.py paper --index %d [--price P] simulates the fill "
                         "here. Nothing goes to a broker." % idx)
        if mode == "paper":
            if not shape:
                lines.append("  To see what Dhan or Angel One would get: ticket.py show --as dhan (or angelone).")
    if ready:
        lines.append("  Reply \"yes\" to approve this one order, or \"no\" to skip it.")
    return "\n".join(lines), ready


def ticket_json(order, idx, cfg, risk, state, today, now, ids, show_as=None):
    mode, broker = mode_of(cfg)
    ready, label, rv = status_of(order, risk, state, today, mode, broker, ids)
    v = view(order)
    fp = fingerprint(order)
    r = risk_of(v, order, cfg)
    shape = show_as or (broker if broker != "paper" else None)
    return {"index": idx, "ready": ready, "status": label, "plain": plain(v, order, cfg), "fingerprint": fp,
            "mode": mode, "paper": mode == "paper", "broker": broker, "shown_as": shape,
            "requests": requests_for(v, fp, shape, ids, cfg) if shape and not v["problems"] else [],
            "why": order.get("why", ""), "bracket": v["bracket"], "max_loss": r["total"] if r else None,
            "loss_at_stop": r["at_stop"] if r else None, "costs_at_stop": r["costs"] if r else None,
            "stop": v["stop"], "target": v["target"], "problems": v["problems"],
            "notes": config_notes(cfg) + day_notes(now) + list((rv or {}).get("warnings", [])) + v["notes"]}


# ---------------------------------------------------------------- fills -> portfolio

def side_charges(cfg, side, qty, price):
    """Estimated charges for one side of an intraday trade (brokerage, STT on a sell,
    stamp duty on a buy, exchange and SEBI fees, GST)."""
    flat, pct = cfg.get("brokerage_flat_inr", 20), cfg.get("brokerage_pct", 0.03)
    if side == "buy":
        return intraday_costs(qty, price, 0, flat, pct)["total"]
    return intraday_costs(qty, 0, price, flat, pct)["total"]


def apply_fill(portfolio_path, cfg, symbol, side, qty, price, date, charges=0.0):
    """Record a filled order in trader-india/portfolio.json: cash and shares, with a
    cost-basis lot per buy (oldest lots are relieved first on a sell). Charges come
    off the cash."""
    pf = read_json(portfolio_path, "portfolio", required=False)
    if pf is None:
        budget = _f(cfg.get("budget"))
        if not budget:
            raise TicketError("no %s yet and no budget in the config to start it from" % portfolio_path)
        pf = {"cash": float(budget), "positions": []}
    symbol = norm_symbol(symbol)
    qty, price = _f(qty), _f(price)
    if not qty or qty <= 0 or qty != int(qty) or not price or price <= 0:
        raise TicketError("a fill needs a whole number of shares above 0 and a price above 0")
    qty = int(qty)
    cost = _r2(Decimal(str(price)) * qty)
    pos = None
    for p in pf.setdefault("positions", []):
        if str(p.get("ticker") or p.get("symbol") or "").upper() == symbol:
            pos = p
    if side == "buy":
        if pos is None:
            pos = {"ticker": symbol, "shares": 0, "lots": []}
            pf["positions"].append(pos)
        lots = pos.setdefault("lots", [])
        lots.append({"id": "%s-%d" % (symbol, len(lots) + 1), "date": date, "shares": qty, "cost": cost})
        pos["shares"] = int(round(float(pos.get("shares", 0)) + qty))
        pf["cash"] = _r2(float(pf.get("cash", 0)) - cost - charges)
    else:
        held = float(pos.get("shares", 0)) if pos else 0
        if pos is None or held + 1e-9 < qty:
            raise TicketError("cannot record selling %d %s: the portfolio holds %s (this pack does not "
                              "short)" % (qty, symbol, _num(held)))
        left = qty
        for lot in sorted(pos.get("lots", []), key=lambda l: l.get("date", "")):
            if left <= 0:
                break
            take = min(left, float(lot["shares"]))
            per = float(lot["cost"]) / float(lot["shares"]) if float(lot["shares"]) else 0
            lot["cost"] = _r2(float(lot["cost"]) - per * take)
            lot["shares"] = int(round(float(lot["shares"]) - take))
            left -= take
        pos["lots"] = [l for l in pos.get("lots", []) if float(l["shares"]) > 0]
        pos["shares"] = int(round(held - qty))
        if pos["shares"] <= 0:
            pf["positions"].remove(pos)
        pf["cash"] = _r2(float(pf.get("cash", 0)) + cost - charges)
    write_json(portfolio_path, pf)
    return pf


def log_fill(state_path, now, today, symbol, side, qty, price, charges, paper):
    """A fill in the log, so india-risk can see what was traded today."""
    state = load_state(state_path)
    qty, price = int(float(qty)), _r2(price)
    state["orders"].append({
        "at": ist_iso(now), "date": today, "status": "filled", "symbol": norm_symbol(symbol), "side": side,
        "qty": qty, "price": price, "charges": charges, "paper": bool(paper),
        "plain": "%s %d %s at %s%s" % (side.upper(), qty, norm_symbol(symbol), inr(price),
                                       " (paper)" if paper else "")})
    write_json(state_path, state)


# ---------------------------------------------------------------- commands

def _clock(a):
    now = parse_now(getattr(a, "now", None))
    today = getattr(a, "today", None) or to_ist(now).date().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", today):
        raise TicketError("--today wants a date like 2026-10-19")
    return now, today


def _load(a):
    doc = read_json(a.orders, "orders file (run /india-budget, or ticket.py flatten, first)")
    orders = doc.get("orders", doc) if isinstance(doc, dict) else doc
    if not isinstance(orders, list) or not orders:
        raise TicketError("no orders in %s" % a.orders)
    cfg = load_config(a.config)
    risk = read_json(a.risk, "risk check", required=False)
    state = load_state(a.state)
    ids = load_ids(getattr(a, "ids", None))
    now, today = _clock(a)
    return orders, cfg, risk, state, ids, today, now


def _pick(orders, index):
    if index is None:
        raise TicketError("say which order: --index N")
    if not 1 <= index <= len(orders):
        raise TicketError("there is no order %d (there are %d)" % (index, len(orders)))
    return orders[index - 1]


def cmd_show(a):
    orders, cfg, risk, state, ids, today, now = _load(a)
    mode, broker = mode_of(cfg)
    if a.as_broker and mode == "live" and a.as_broker != broker:
        raise TicketError("your live broker is %s; --as %s is only for paper mode" % (broker, a.as_broker))
    picks = [(a.index, _pick(orders, a.index))] if a.index else list(enumerate(orders, 1))
    if a.json:
        out = [ticket_json(o, i, cfg, risk, state, today, now, ids, a.as_broker) for i, o in picks]
        print(json.dumps(out[0] if a.index else out, indent=2, ensure_ascii=False))
        return 0 if any(t["ready"] for t in out) else 1
    blocks, any_ready = [], False
    for i, o in picks:
        text, ready = render(o, i, len(orders), cfg, risk, state, today, now, ids, a.as_broker)
        blocks.append(text)
        any_ready = any_ready or ready
    for n in config_notes(cfg) + day_notes(now):
        print("note: " + n)
    print("\n\n".join(blocks))
    print("\nOne order at a time: a yes covers one ticket, never the batch. Broker request shapes are from "
          "the brokers' SDK source, not live-tested. Education and tooling, not financial advice.")
    return 0 if any_ready else 1


def cmd_approve(a):
    orders, cfg, risk, state, ids, today, now = _load(a)
    order = _pick(orders, a.index)
    mode, broker = mode_of(cfg)
    ready, label, rv = status_of(order, risk, state, today, mode, broker, ids)
    if not ready:
        raise TicketError("order %d is not ready: %s" % (a.index, label))
    ok, why = parse_yes(a.reply, order, cfg, [o.get("symbol", "") for o in orders])
    if not ok:
        print("Not recorded: %s. Ask the user again with the ticket for order %d." % (why, a.index))
        return 1
    v = view(order)
    fp = fingerprint(order)
    rec = {"at": ist_iso(now), "date": today, "index": a.index, "fingerprint": fp, "symbol": v["sym"],
           "side": v["side"], "qty": v["qty"], "kind": kind_of(order, rv), "max_loss": logged_loss(v, order, cfg, rv),
           "stop": v["stop"], "target": v["target"], "plain": plain(v, order, cfg), "status": "approved",
           "reply": a.reply, "paper": mode == "paper", "broker": broker if mode == "live" else "paper"}
    state["orders"].append(rec)
    write_json(a.state, state)
    print("Recorded your yes for order %d: %s." % (a.index, rec["plain"]))
    if mode == "paper":
        print("Paper mode. Now simulate the fill: ticket.py paper --index %d [--price P]. Nothing goes to a "
              "broker." % a.index)
        return 0
    for l in broker_lines(v, order, fp, cfg, broker, ids, mode, reference=False):
        print(l[2:] if l.startswith("  ") else l)
    print("Then: ticket.py result --index %d --status placed|denied|failed (with --broker-id, and "
          "--filled-qty/--filled-price once it fills)." % a.index)
    return 0


def cmd_decline(a):
    orders, cfg, risk, state, ids, today, now = _load(a)
    order = _pick(orders, a.index)
    v = view(order)
    rec = {"at": ist_iso(now), "date": today, "index": a.index, "fingerprint": fingerprint(order),
           "symbol": v["sym"], "side": v["side"], "plain": plain(v, order, cfg), "status": "declined",
           "reply": a.reply or "no"}
    state["orders"].append(rec)
    write_json(a.state, state)
    print("Recorded: you said no to order %d (%s). Nothing was sent." % (a.index, rec["plain"]))
    return 0


def _approved(state, order, today, index):
    fp = fingerprint(order)
    rec = latest(state, fp, today)
    if not rec or rec.get("status") != "approved":
        raise TicketError("order %d has no yes recorded today; this can only follow an approval" % index)
    return fp, rec


def cmd_paper(a):
    orders, cfg, risk, state, ids, today, now = _load(a)
    mode, broker = mode_of(cfg)
    if mode != "paper":
        raise TicketError("your config is live (%s): a paper fill would muddle the log. Record the real order "
                          "with ticket.py result" % BROKER_NAMES[broker])
    order = _pick(orders, a.index)
    fp, rec = _approved(state, order, today, a.index)
    v = view(order)
    seen = _f(a.price) if a.price is not None else None
    if a.price is not None and (seen is None or seen <= 0):
        raise TicketError("--price wants the price you see now, like --price 364.40")
    if v["type"] == "LIMIT":
        lim = v["price"]
        if seen is None:
            fill = lim
        elif (v["side"] == "buy" and seen <= lim + 1e-9) or (v["side"] == "sell" and seen >= lim - 1e-9):
            fill = seen
        else:
            print("Not filled: the price %s is %s your limit %s, so a real limit order would wait. Nothing "
                  "recorded; run ticket.py paper again with a later price, or decline it."
                  % (inr(seen), "above" if v["side"] == "buy" else "below", inr(lim)))
            return 1
    elif v["type"] == "MARKET":
        if seen is None:
            raise TicketError("a market order fills at whatever the market gives: pass --price P (the price you see)")
        fill = seen
    else:
        raise TicketError("paper fills cover LIMIT and MARKET orders; a %s order waits for its trigger"
                          % TYPE_WORDS.get(v["type"], v["type"]))
    fill = _r2(fill)
    charges = side_charges(cfg, v["side"], v["qty"], fill)
    placed = {"at": ist_iso(now), "date": today, "index": a.index, "fingerprint": fp, "symbol": v["sym"],
              "side": v["side"], "plain": rec["plain"], "status": "placed", "paper": True, "broker": "paper",
              "broker_order_id": "PAPER-" + fp[:8], "note": "simulated fill, nothing sent to a broker"}
    for k in ("qty", "kind", "max_loss", "stop", "target"):
        if rec.get(k) is not None:
            placed[k] = rec[k]
    state["orders"].append(placed)
    write_json(a.state, state)
    pf = apply_fill(a.portfolio, cfg, v["sym"], v["side"], v["qty"], fill, today, charges)
    log_fill(a.state, now, today, v["sym"], v["side"], v["qty"], fill, charges, True)
    print("Paper fill: %s %d %s at %s (simulated). Estimated charges %s. Cash now %s."
          % (v["side"].upper(), v["qty"], v["sym"], inr(fill), inr(charges), inr(pf["cash"])))
    if placed.get("max_loss") is not None:
        print("Logged with max loss %s for india-risk's daily limit." % inr(placed["max_loss"]))
    if v["bracket"]:
        print("The stop-loss %s and the target %s are not resting anywhere in paper mode. Set india-alerts "
              "on them; when one rings, record the paper exit: ticket.py fill --symbol %s --side sell --qty %d "
              "--price P. Anything still open by flat_by: ticket.py flatten."
              % (inr(v["stop"]), inr(v["target"]), v["sym"], v["qty"]))
    return 0


def cmd_result(a):
    orders, cfg, risk, state, ids, today, now = _load(a)
    mode, broker = mode_of(cfg)
    order = _pick(orders, a.index)
    fp, rec = _approved(state, order, today, a.index)
    if a.status == "placed" and mode != "live":
        raise TicketError("your config is paper trading, so nothing was placed at a broker. Simulate it: "
                          "ticket.py paper --index %d" % a.index)
    new = {"at": ist_iso(now), "date": today, "index": a.index, "fingerprint": fp, "symbol": rec["symbol"],
           "side": rec["side"], "plain": rec["plain"], "status": a.status, "paper": mode == "paper",
           "broker": broker if mode == "live" else "paper"}
    for k in ("qty", "kind", "max_loss", "stop", "target"):
        if rec.get(k) is not None:
            new[k] = rec[k]
    if a.broker_id:
        new["broker_order_id"] = a.broker_id
    if a.note:
        new["note"] = a.note
    state["orders"].append(new)
    write_json(a.state, state)
    print("Recorded order %d as %s." % (a.index, a.status))
    v = view(order)
    if a.status == "placed" and a.filled_qty and a.filled_price:
        charges = side_charges(cfg, rec["side"], _f(a.filled_qty) or 0, _f(a.filled_price) or 0)
        apply_fill(a.portfolio, cfg, rec["symbol"], rec["side"], a.filled_qty, a.filled_price, today, charges)
        log_fill(a.state, now, today, rec["symbol"], rec["side"], a.filled_qty, a.filled_price, charges, False)
        print("Added the fill to %s (estimated charges %s; your contract note has the exact figure)."
              % (a.portfolio, inr(charges)))
    elif a.status == "placed":
        print("When it fills, record it: ticket.py fill --symbol %s --side %s --qty Q --price P"
              % (rec["symbol"], rec["side"]))
    if a.status == "placed" and v["bracket"] and broker == "angelone":
        print("Angel One: once the entry fills, place step 2, the STOPLOSS_LIMIT sell from the ticket, for the "
              "quantity that filled. Do not add a target sell; india-alerts watches the target.")
    if a.status == "failed":
        print("A failed order is not retried without a new risk check and a new yes.")
    return 0


def cmd_fill(a):
    cfg = load_config(a.config)
    mode, _ = mode_of(cfg)
    now = parse_now(a.now)
    date = a.date or to_ist(now).date().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise TicketError("--date wants a date like 2026-10-19")
    if a.charges is not None:
        charges = _f(a.charges)
        if charges is None or charges < 0:
            raise TicketError("--charges wants rupees, like --charges 32.17")
    else:
        q, p = _f(a.qty), _f(a.price)
        charges = side_charges(cfg, a.side, q, p) if q and p and q > 0 and p > 0 else 0.0
    pf = apply_fill(a.portfolio, cfg, a.symbol, a.side, a.qty, a.price, date, charges)
    log_fill(a.state, now, date, a.symbol, a.side, a.qty, a.price, charges, mode == "paper")
    print("Recorded %s %s %s at %s on %s in %s (charges %s%s). Cash now %s."
          % (a.side, _num(a.qty), norm_symbol(a.symbol), inr(_f(a.price)), date, a.portfolio, inr(charges),
             "" if a.charges is not None else ", estimated", inr(pf["cash"])))
    return 0


def last_price(sym, a, now):
    """(price, source, note) from --price, else trader-india/prices.json."""
    if a.price is not None:
        p = _f(a.price)
        if not p or p <= 0:
            raise TicketError("--price wants the last price, like --price 366.10")
        return p, "--price", None
    doc = read_json(a.prices, "prices", required=False) or {}
    prices = doc.get("prices", doc) if isinstance(doc, dict) else {}
    p = None
    for k, val in (prices.items() if isinstance(prices, dict) else []):
        if from_yahoo(k) == sym:
            p = _f(val)
    if not p:
        raise TicketError("flatten needs the last price for %s: pass --price P, or fetch a quote with "
                          "/india-alerts into %s" % (sym, a.prices))
    detail = (doc.get("detail") or {}).get(sym) or {}
    t = parse_utc(detail.get("time")) or parse_utc(detail.get("fetched")) or parse_utc(doc.get("as_of"))
    note = None
    if t is None:
        note = "the price in %s has no time: check it is current" % a.prices
    else:
        age = (now - t).total_seconds() / 60.0
        if age > 15:
            note = ("the last price is from %s IST, %d minutes ago: get a fresh quote or pass --price"
                    % (to_ist(t).strftime("%H:%M"), int(age)))
    return p, "%s as of %s IST" % (a.prices, to_ist(t).strftime("%H:%M") if t else "?"), note


def cmd_flatten(a):
    cfg = load_config(a.config)
    mode, broker = mode_of(cfg)
    sym = norm_symbol(a.symbol)
    now, today = _clock(a)
    if a.qty is not None:
        q = _f(a.qty)
        if q is None or q <= 0 or q != int(q):
            raise TicketError("--qty wants the whole number of shares you hold, like --qty 137")
        qty, source = int(q), "the broker"
    else:
        pf = read_json(a.portfolio, "portfolio", required=False) or {}
        qty = sum(_f(p.get("shares", p.get("qty"))) or 0 for p in pf.get("positions", [])
                  if str(p.get("ticker") or p.get("symbol") or "").upper() == sym)
        source = a.portfolio
        if qty <= 0:
            raise TicketError("nothing to flatten: no %s shares in %s. Check your broker's positions and pass "
                              "--qty if you do hold some" % (sym, a.portfolio))
        qty = int(qty)
    px, px_from, px_note = last_price(sym, a, now)
    buf = Decimal(str(_f(cfg.get("limit_buffer_pct")) if _f(cfg.get("limit_buffer_pct")) is not None else 0.1))
    limit = tick_down(Decimal(str(px)) * (1 - buf / 100))
    plan = read_json(a.plan, "plan", required=False) or {}
    flat_by = (plan.get("flat_by") if str(plan.get("symbol", "")).upper() == sym else None) \
        or cfg.get("flat_by") or "15:00"
    order = {"symbol": sym, "exchange": "NSE", "side": "sell", "qty": qty, "order_type": "LIMIT",
             "price": limit, "trigger_price": None, "product": str(cfg.get("product") or "INTRADAY").upper(),
             "validity": "DAY", "stop_loss": None, "target": None, "bracket": False,
             "why": "flat by %s IST: closes the %s day trade before the brokers' 15:10 auto square-off "
                    "(qty from %s; limit %s below the last price %s)"
                    % (flat_by, sym, source, _num(float(buf)) + "%", inr(px))}
    old = read_json(a.orders, "orders", required=False)
    replaced = len(old.get("orders", [])) if isinstance(old, dict) else 0
    doc = {"created_by": "india-broker", "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "proposed",
           "paper": mode == "paper",
           "note": "Flatten ticket. Nothing is placed until india-risk passes it and you say yes in the chat.",
           "source": "ticket.py flatten %s on %s (last price from %s)" % (sym, today, px_from), "orders": [order]}
    write_json(a.orders, doc)
    v = view(order)
    print("Flatten %s: %s (flat by %s IST)." % (sym, plain(v, order, cfg), flat_by))
    print("Wrote it to %s%s." % (a.orders, (" (it replaced %d earlier proposal%s)"
                                             % (replaced, "" if replaced == 1 else "s")) if replaced else ""))
    if px_note:
        print("note: " + px_note)
    if a.qty is None:
        print("The qty comes from %s. Check it against your broker's positions before you say yes." % source)
    print("A limit a little under the last price usually fills at once. If the price falls through it, it "
          "waits: re-price it. Angel One and Dhan square off open intraday positions at 15:10 anyway, with a charge.")
    print("Next:")
    print("  1. /india-risk. A sell that only closes what you hold is never blocked by the daily limits or the")
    print("     entry window.")
    print("  2. ticket.py show, then the user's yes for this one order.")
    if mode == "paper":
        print("  3. Paper: ticket.py paper --index 1 [--price P].")
    elif broker == "dhan":
        print("  3. Dhan: the Super Order's target and stop-loss legs still hold these shares. Cancel them first in")
        print("     the Dhan app (or your own static-IP tool), or they can fill after your sell and leave you short.")
        print("     Then enter the sell and record it with ticket.py result.")
    else:
        print("  3. Angel One: cancel the resting STOPLOSS_LIMIT sell first in the Angel One app (or your own")
        print("     static-IP tool), or it can fill after your sell and leave you short. Then enter the sell and")
        print("     record it with ticket.py result.")
    return 0


def cmd_ids(a):
    if not a.dhan_csv and not a.angel_json:
        raise TicketError("give --dhan-csv FILE and/or --angel-json FILE: the scrip masters you downloaded "
                          "(Dhan: %s, Angel One: %s)" % (DHAN_SCRIP_URL, ANGEL_SCRIP_URL))
    syms = []
    for s in a.symbols:
        n = norm_symbol(s)
        if n not in syms:
            syms.append(n)
    found, probs = {}, []
    if a.dhan_csv:
        d, p = dhan_lookup(a.dhan_csv, syms)
        found["dhan"] = d
        probs += p
    if a.angel_json:
        g, p = angel_lookup(a.angel_json, syms)
        found["angelone"] = g
        probs += p
    ids = read_json(a.out, "security IDs", required=False) or {}
    if not isinstance(ids, dict):
        raise TicketError('%s should look like {"SYNTH": {"dhan": "...", "angelone": "..."}}' % a.out)
    missing = []
    for s in syms:
        entry = dict(ids.get(s) or {})
        parts = []
        for b in ("dhan", "angelone"):
            if b not in found:
                continue
            if s in found[b]:
                entry[b] = found[b][s]
                parts.append("%s %s" % (BROKER_NAMES[b], found[b][s]))
            else:
                parts.append("%s not found" % BROKER_NAMES[b])
                missing.append("%s on %s" % (s, BROKER_NAMES[b]))
        if entry:
            ids[s] = entry
        print("%-12s %s" % (s, ", ".join(parts)))
    write_json(a.out, ids)
    for p in probs:
        print("note: " + p)
    if missing:
        print("Not found: %s. Only NSE EQ-series equity is looked up (Dhan: SEM_EXM_EXCH_ID NSE, "
              "SEM_INSTRUMENT_NAME EQUITY; Angel One: exch_seg NSE, symbol SYM-EQ)." % ", ".join(missing))
    print("Wrote %s. These are public instrument codes, not credentials. Check one against the broker's app "
          "before your first live order." % a.out)
    return 1 if missing or probs else 0


def cmd_log(a):
    state = load_state(a.state)
    now, today = _clock(a)
    rows = [r for r in state.get("orders", []) if a.all or rec_day(r) == today]
    if not rows:
        print("No decisions recorded%s." % ("" if a.all else " today"))
        return 1
    for r in rows:
        extra = (" id " + str(r["broker_order_id"])) if r.get("broker_order_id") else ""
        reply = (' reply "%s"' % r["reply"]) if r.get("reply") and r.get("status") in ("approved", "declined") else ""
        loss = (" max loss %s" % inr(r["max_loss"])) if r.get("max_loss") is not None and r.get("status") == "placed" else ""
        idx = ("#%s" % r["index"]) if r.get("index") is not None else "  "
        print("%s  %s %-9s %s%s%s%s" % (r.get("at"), idx, r.get("status"), r.get("plain"), reply, loss, extra))
    placed = sum(1 for r in rows if r.get("status") == "placed")
    paper = sum(1 for r in rows if r.get("status") == "placed" and r.get("paper"))
    print("%d placed%s%s." % (placed, "" if a.all else " today", (" (%d on paper)" % paper) if paper else ""))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Order tickets, paper fills and your yes (india-broker, NSE). "
                                             "Never places a live order.")
    sub = ap.add_subparsers(dest="cmd")

    def clock(p):
        p.add_argument("--now", help="pretend it is this India time, e.g. \"2026-10-19 09:55\"")
        p.add_argument("--today", help="YYYY-MM-DD (default: today in India)")

    def common(p):
        p.add_argument("--orders", default=ORDERS_FILE)
        p.add_argument("--config", default=CONFIG_FILE)
        p.add_argument("--risk", default=RISK_FILE)
        p.add_argument("--state", default=STATE_FILE)
        p.add_argument("--ids", default=IDS_FILE, help="security IDs written by ticket.py ids")
        clock(p)

    p = sub.add_parser("show", help="render the tickets")
    common(p)
    p.add_argument("--index", type=int)
    p.add_argument("--json", action="store_true")
    p.add_argument("--as", dest="as_broker", choices=["dhan", "angelone"],
                   help="also show this broker's request (paper mode, for reference)")
    p = sub.add_parser("approve", help="record the user's explicit yes for one order")
    common(p)
    p.add_argument("--index", type=int, required=True)
    p.add_argument("--reply", required=True, help="the user's reply, word for word")
    p = sub.add_parser("decline", help="record a no")
    common(p)
    p.add_argument("--index", type=int, required=True)
    p.add_argument("--reply")
    p = sub.add_parser("paper", help="simulate the fill of an approved order (paper mode)")
    common(p)
    p.add_argument("--index", type=int, required=True)
    p.add_argument("--price", help="the price you see now (default: fill at the limit)")
    p.add_argument("--portfolio", default=PORTFOLIO_FILE)
    p = sub.add_parser("result", help="record what happened to a live order")
    common(p)
    p.add_argument("--index", type=int, required=True)
    p.add_argument("--status", required=True, choices=["placed", "denied", "failed"])
    p.add_argument("--broker-id")
    p.add_argument("--note")
    p.add_argument("--filled-qty")
    p.add_argument("--filled-price")
    p.add_argument("--portfolio", default=PORTFOLIO_FILE)
    p = sub.add_parser("fill", help="record a fill in trader-india/portfolio.json")
    p.add_argument("--symbol", required=True)
    p.add_argument("--side", required=True, choices=["buy", "sell"])
    p.add_argument("--qty", required=True)
    p.add_argument("--price", required=True)
    p.add_argument("--charges", help="rupees from your contract note (default: an estimate)")
    p.add_argument("--date", help="YYYY-MM-DD (default: today in India)")
    p.add_argument("--now")
    p.add_argument("--portfolio", default=PORTFOLIO_FILE)
    p.add_argument("--config", default=CONFIG_FILE)
    p.add_argument("--state", default=STATE_FILE)
    p = sub.add_parser("flatten", help="a LIMIT sell that closes a symbol's position by flat_by")
    p.add_argument("--symbol", required=True)
    p.add_argument("--qty", help="shares you hold, from your broker (default: trader-india/portfolio.json)")
    p.add_argument("--price", help="the last price (default: trader-india/prices.json)")
    p.add_argument("--orders", default=ORDERS_FILE, help="where the ticket is written")
    p.add_argument("--portfolio", default=PORTFOLIO_FILE)
    p.add_argument("--prices", default=PRICES_FILE)
    p.add_argument("--plan", default=PLAN_FILE)
    p.add_argument("--config", default=CONFIG_FILE)
    clock(p)
    p = sub.add_parser("ids", help="look up broker security IDs in downloaded scrip masters")
    p.add_argument("symbols", nargs="+")
    p.add_argument("--dhan-csv", help="Dhan's api-scrip-master.csv")
    p.add_argument("--angel-json", help="Angel One's OpenAPIScripMaster.json")
    p.add_argument("--out", default=IDS_FILE)
    p = sub.add_parser("log", help="today's decisions")
    p.add_argument("--state", default=STATE_FILE)
    clock(p)
    p.add_argument("--all", action="store_true")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"show": cmd_show, "approve": cmd_approve, "decline": cmd_decline, "paper": cmd_paper,
                "result": cmd_result, "fill": cmd_fill, "flatten": cmd_flatten, "ids": cmd_ids,
                "log": cmd_log}[a.cmd](a)
    except (TicketError, CoreError) as e:
        print("ticket.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
