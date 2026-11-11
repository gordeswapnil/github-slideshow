"""Build the India pack's synthetic chart fixtures from the US pack's real ones.

No NSE data could be downloaded while this pack was written, so the chart
fixtures are the US pack's real Yahoo Finance bars (TSLA and others, Oct 2026)
moved onto the NSE clock and renamed so nobody mistakes them for NSE data:

- every bar keeps its date and its prices; its New York time minus 15 minutes
  becomes its India time, so 09:30 ET (the US open) lands on 09:15 IST (the NSE
  open). Bars at or after 15:30 IST, and days that are NSE holidays, are dropped.
- TSLA becomes SYNTH.NS; any other ticker X becomes SYN-X.NS.
- meta says INR, NSE, Asia/Kolkata, gmtoffset 19800.

The prices are US-dollar prices relabelled as rupees. They exercise the code on
realistic price paths; they say nothing about any Indian stock.

    python3 retime.py SRC.json[.gz] DST.json[.gz]
"""
import datetime
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import india_core as core  # noqa: E402

EPOCH = datetime.datetime(1970, 1, 1)
PROVENANCE = ("SYNTHETIC: real US Yahoo bars (Oct 2026) re-timed onto the NSE session and "
              "renamed by india-tests/fixtures/retime.py. Not NSE data.")


def rename(sym):
    s = str(sym).upper()
    base = s[:-3] if s.endswith(".NS") else s
    if base in ("SYNTH",) or base.startswith("SYN-"):
        return base
    return "SYNTH" if base == "TSLA" else "SYN-" + base.replace(".", "-")


def _nth_sunday(year, month, n):
    d = datetime.date(year, month, 1)
    d += datetime.timedelta(days=(6 - d.weekday()) % 7)
    return d + datetime.timedelta(weeks=n - 1)


def eastern_offset(utc):
    y = utc.year
    start = datetime.datetime.combine(_nth_sunday(y, 3, 2), datetime.time(7, 0))
    end = datetime.datetime.combine(_nth_sunday(y, 11, 1), datetime.time(6, 0))
    return -4 if start <= utc < end else -5


def ist_local(ts):
    """US epoch seconds -> the India wall-clock time that bar gets."""
    utc = EPOCH + datetime.timedelta(seconds=int(ts))
    ny = utc + datetime.timedelta(hours=eastern_offset(utc))
    return ny - datetime.timedelta(minutes=15)


def epoch(local_ist):
    return int((core.ist_to_utc(local_ist) - EPOCH).total_seconds())


def keep(local):
    return (core.trading_day(local.date())[0]
            and core.OPEN <= local.time() < core.CLOSE)


def retime_ts(ts):
    return epoch(ist_local(ts))


def _periods(day):
    mk = lambda h, m: epoch(datetime.datetime.combine(day, datetime.time(h, m)))
    p = lambda a, b: {"timezone": "IST", "start": a, "end": b, "gmtoffset": 19800}
    return {"pre": p(mk(9, 0), mk(9, 15)), "regular": p(mk(9, 15), mk(15, 30)),
            "post": p(mk(15, 30), mk(16, 0))}


def retime_result(res):
    meta = dict(res.get("meta") or {})
    ts = res.get("timestamp") or []
    idx = [i for i, t in enumerate(ts) if keep(ist_local(t))]
    out = dict(res)
    out["timestamp"] = [retime_ts(ts[i]) for i in idx]
    ind = res.get("indicators") or {}
    new_ind = {}
    for k, series in ind.items():
        new_series = []
        for block in series:
            nb = {}
            for f, vals in block.items():
                nb[f] = [vals[i] for i in idx] if isinstance(vals, list) and len(vals) == len(ts) else vals
            new_series.append(nb)
        new_ind[k] = new_series
    out["indicators"] = new_ind
    if "symbol" in meta:
        meta["symbol"] = rename(meta["symbol"]) + ".NS"
    meta.update({"currency": "INR", "exchangeName": "NSI", "fullExchangeName": "NSE",
                 "timezone": "IST", "exchangeTimezoneName": "Asia/Kolkata", "gmtoffset": 19800,
                 "hasPrePostMarketData": False})
    for k in ("longName", "shortName"):
        if k in meta:
            meta[k] = "Synthetic test stock %s" % meta.get("symbol", "")
    if meta.get("regularMarketTime"):
        meta["regularMarketTime"] = retime_ts(meta["regularMarketTime"])
    if "currentTradingPeriod" in meta and meta.get("regularMarketTime"):
        day = core.to_ist(EPOCH + datetime.timedelta(seconds=meta["regularMarketTime"])).date()
        meta["currentTradingPeriod"] = _periods(day)
    if "tradingPeriods" in meta:
        days = sorted({core.to_ist(EPOCH + datetime.timedelta(seconds=t)).date() for t in out["timestamp"]})
        if isinstance(meta["tradingPeriods"], list):
            meta["tradingPeriods"] = [[dict(_periods(d)["regular"])] for d in days]
        else:
            meta["tradingPeriods"] = {"regular": [[dict(_periods(d)["regular"])] for d in days]}
    out["meta"] = meta
    return out


def walk(obj):
    """Retime every chart result found anywhere in a Yahoo chart/spark document."""
    if isinstance(obj, list):
        return [walk(x) for x in obj]
    if isinstance(obj, dict):
        if "meta" in obj and ("timestamp" in obj or "indicators" in obj):
            return retime_result(obj)
        out = {}
        for k, v in obj.items():
            nk = k
            if isinstance(k, str) and k.isupper() and 1 <= len(k) <= 8 and k.replace(".", "").replace("-", "").isalnum():
                nk = rename(k)        # a dict keyed by ticker (the scanner's wall file)
            if k == "symbol" and isinstance(v, str):
                out[nk] = rename(v) + ".NS"
            else:
                out[nk] = walk(v)
        return out
    return obj


def load(path):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def save(path, doc):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "wt", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))


def convert(src, dst):
    doc = walk(load(src))
    if isinstance(doc, dict):
        doc["_provenance"] = PROVENANCE
    save(dst, doc)
    return doc


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    convert(sys.argv[1], sys.argv[2])
