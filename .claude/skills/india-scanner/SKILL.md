---
name: india-scanner
description: >-
  Chart Scanner for NSE (India). Scans hundreds of NSE charts for setups:
  opening-range breakouts, flags, oversold bounces. Builds the list of
  NSE-listed stocks from NSE's own equity list (EQUITY_L.csv, EQ series
  only: BE and BZ are trade-for-trade, no intraday), runs a pre-market scan
  of daily closes (20-day closing-high breakout, bull flag, reclaimed the
  20-day average, oversold, oversold bounce) with rupee liquidity floors,
  and an intraday opening-range breakout scan on 5-minute bars (range 09:15
  to 09:30 India time), then writes trader-india/watchlist.json for
  india-news and india-entry. Free Yahoo data (SYMBOL.NS), bar by bar. Use
  when the user says "scan NSE", "scan the Indian market", "find me
  setups", "what is breaking out on NSE", "opening range breakouts",
  "scan for bull flags", "oversold stocks", "pre-market scan", "build my
  watchlist", "what should I look at today", or at the start of an NSE
  trading day before /india-news.
argument-hint: "[universe | daily | orb] [--at HH:MM] [--file EQUITY_L.csv]"
---

# india-scanner

The Chart Scanner is the first step of a day trade on NSE. It reads hundreds
of free charts and lists the ones that match a rule. That is all it does. A
scan is a list of charts that match a rule, not a list of stocks to buy, and
a setup on a chart is not a prediction. SEBI found that most individual
intraday traders lose money; the scanner does not change that. It only saves
you from flipping through 2,000 charts by hand.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).
All times are India time (IST, UTC+5:30, no daylight saving), 24-hour.

```bash
python3 "${CLAUDE_SKILL_DIR}/scan.py" universe                          # NSE's list -> trader-india/universe.txt
python3 "${CLAUDE_SKILL_DIR}/scan.py" universe --file ~/Downloads/EQUITY_L.csv   # when NSE blocks the script
python3 "${CLAUDE_SKILL_DIR}/scan.py" daily                             # before 09:15 -> trader-india/watchlist.json
python3 "${CLAUDE_SKILL_DIR}/scan.py" daily --symbols RELIANCE,TCS,M&M  # or --watchlist FILE, --limit 200
python3 "${CLAUDE_SKILL_DIR}/scan.py" orb                               # after 09:35 -> trader-india/watchlist.json
python3 "${CLAUDE_SKILL_DIR}/scan.py" orb --at 10:00                    # cut the clock at 10:00 IST
python3 "${CLAUDE_SKILL_DIR}/scan.py" orb --watchlist trader-india/watchlist.json --json
```

Flags: `--min-price 20` (rupees), `--min-value` (rupees traded, price times
volume: daily 10 crore, orb 0), `--min-volume` (shares, off by default),
`--or-minutes 15`, `--max-confirm 200` (orb stage 2), `--now "2026-10-19
10:00"` (India time) to pin the clock, `--offline PATH` to read saved Yahoo
files, `--no-write`, `--show N`, `--json`. `universe` also takes `--file`,
`--series EQ` and `--url`. Exit code 0 when the scan found something, 1 when
it found nothing or could not run (the reason is one plain line). Quote a
symbol with `&` in the shell: `--symbols "M&M,RELIANCE"`.

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/universe.txt` | written by `universe`: one `SYMBOL\|Name\|SERIES` a line, read by `daily` and `orb` for the symbols and each hit's series |
| `trader-india/watchlist.json` | written by `daily` and `orb`: `mode`, `as_of` (India time), `exchange` NSE, `universe`, `scanned`, `failed`, `filters`, `hits[]`. india-news and india-entry read `hits[].symbol` (the plain NSE symbol, no `.NS`); india-risk reads `hits[].series` (EQ, or null when the symbol is not in the universe file) |
| `trader-india/config.json` | `allowed_series` (default `["EQ"]`) for `universe`; `no_entries_after` (default 14:30) for `orb` |
| `trader-india/holidays.json` | optional: NSE holidays the built-in 2026 list does not have yet |

## The universe

`universe` reads NSE's list of listed equities, `EQUITY_L.csv`, from
`https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv` (the
legacy host `archives.nseindia.com` serves the same path: use `--url`). The
header is `SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE,
MARKET LOT, ISIN NUMBER, FACE VALUE`; the stray spaces are stripped. It
keeps a row when its `SERIES` is in `allowed_series` (default EQ) and its
symbol is a valid NSE symbol (letters, digits, `&` and `-`, like `M&M` or
`BAJAJ-AUTO`), and writes each kept row's series next to it. Every hit that
`daily` and `orb` write carries that `series`; a symbol scanned with
`--symbols` that is not in the universe file gets `null`. BE and BZ are
trade-for-trade series: every trade must be delivered, so there is no
intraday trading in them, and they are dropped with a count.

NSE's website terms of use restrict automated collection of its data, so
this step is kept minimal: one request for this one file, a browser-like
User-Agent, a 20-second timeout, and no retries. NSE's site runs bot
protection and often answers scripts with HTTP 403, a web page instead of
the file, or nothing at all. Then the script says so in one line: open the
URL in your browser (it downloads `EQUITY_L.csv`) and run
`scan.py universe --file PATH/TO/EQUITY_L.csv`. That route needs no network
at all. The list changes as companies list, delist or move series: refresh
it about once a week.

## The daily scan (before the open)

Yahoo's spark endpoint returns closes for 20 symbols a request, so about
2,000 EQ symbols take about 100 requests with a polite pause (0.3 s). Every
symbol goes to Yahoo as `SYMBOL.NS`, URL-encoded (`M&M` is `M%26M.NS`).

Liquidity comes from the spark meta, in rupees. The defaults are this
pack's choices, not exchange rules; change them with the flags:

- `--min-price 20`: the last price is at least ₹20. It keeps out the
  lowest-priced shares.
- `--min-value` 10 crore (₹10,00,00,000): last price times last session's
  volume, the rupees traded. This is the real liquidity floor: a stock that
  trades ₹10 crore a day can take a ₹1 lakh order without being the market.

Run it before 09:15 or after 15:30: during the session the volume is the
day's so far, and today's daily bar is left out until the 15:30 close.

The setups are computed from daily closes only (spark has no highs or lows):

| setup | the rule on closes |
| --- | --- |
| `breakout_20d` | the last close is above every close of the 20 sessions before it |
| `bull_flag` | up more than 10 % over the 10 sessions before the last 5, then the last 5 closes inside a 5 % range |
| `reclaim_ma20` | the close before was under its 20-day average, the last close is above it |
| `oversold` | RSI 14 (Wilder) under 30 |
| `oversold_bounce` | RSI 14 was under 30 yesterday and today closed up |

Hits are listed most rupees traded first.

## The opening-range breakout scan (during the session)

NSE's normal market runs 09:15 to 15:30 IST (the pre-open call auction is
09:00 to 09:15 and is not used). The opening range is the first
`--or-minutes` (15) of the session: the 09:15, 09:20 and 09:25 five-minute
bars. A hit is the first completed 5-minute bar to CLOSE above the range
high, at that bar's close time, so the first possible hit is at 09:35.

1. Stage 1, every symbol: spark closes of today's 5-minute bars, 20 a
   request. A chart goes on only if a completed bar after the range closed at
   or above the highest close of the range. That is a necessary condition
   (the range high is at least every range close), so no breakout is lost.
2. Stage 2, each candidate: the v8 chart with real highs and lows, one
   request each. Range high = the highest high of the range bars, range low =
   the lowest low. On a strong morning many charts are candidates, so stage 2
   checks at most `--max-confirm` (200) of them, the most rupees traded first,
   and prints PARTIAL with the count it skipped. `--max-confirm 0` checks
   them all.

A chart is usable only when every 5-minute bar from 09:15 to the cutoff is
there; a missing bar means a halt, a freeze at the price band, or a thin
stock. Null closes are dropped, a bar off the 5-minute grid (the live tick,
like 10:43:07) is dropped, and a bar counts only once it is complete (start
+ 5 minutes). Before 09:35, on a weekend or an NSE holiday, after 15:30, or
after `no_entries_after` (default 14:30, an expired setup) it prints one
plain line and writes nothing. The 14:30 default leaves time before the
15:00 flat-by and before Angel One's and Dhan's 15:10 auto square-off of
intraday (MIS) positions.

## Data and limits

- Yahoo's chart and spark endpoints are free, unofficial and can lag. Bars are
  5-minute bars, bar by bar, never tick by tick. query2 first, query1 on a 429
  or 5xx, one retry after a 5-second wait on a 429.
- Yahoo's data does not carry NSE's price band (circuit limit) for a stock.
- Partial results are said as partial: "Fetched 1,912 of 2,050 charts (138
  failed or had no data)". Never round a partial scan up to "the whole market".
- NSE holidays for 2026 come from the pack's shared core (NSE circulars). NSE
  publishes the next year's list in December; until this pack is updated, a
  2027 scan prints a note, and you add the dates to
  `trader-india/holidays.json` as `{"2027-01-26": "Republic Day"}`.

## Steps

1. Once a week or so: `scan.py universe`. If NSE refuses the script, ask the
   user to download `EQUITY_L.csv` in their browser and run it with `--file`.
2. Before the open: `scan.py daily`. Tell the user the counts (fetched,
   liquid, scanned, hits) and the top few by setup.
3. After 09:35 IST (10:00 is a common time): `scan.py orb`. Tell the user how
   many usable charts broke their range and when, and that a later hit is
   closer to the price now.
4. The user picks one chart. Hand it on: `/india-news SYMBOL` (what is moving
   it), then `/india-entry SYMBOL` (the entry bar by bar). Never pick for them.

## Example: synthetic data

These numbers come from the pack's SYNTHETIC test fixtures
(`india-tests/fixtures/india-scanner/`): real US charts re-timed onto the NSE
clock and renamed (SYNTH, SYN-...), with US prices relabelled as rupees. They
are not NSE data and say nothing about any Indian stock.

```
python3 scan.py universe --file EQUITY_L-synthetic.csv
Kept 234 stocks in series EQ (allowed_series).
Dropped: 2 series BE (trade-for-trade: delivery only, no intraday), 2 series BZ (trade-for-trade: delivery only, no intraday).

python3 scan.py orb --offline SYNTH-wall5m-2026-10-19.json.gz --now "2026-10-19 10:00"
Opening-range breakout scan, Mon 2026-10-19 10:00 IST: 15-minute range (09:15 to 09:30), 5-minute bars, Yahoo.
Fetched 231 of 234 charts (3 failed or had no data); 197 usable (32 under the price / value floor); 84 candidates, 84 confirmed with real highs and lows.
37 of 197 charts closed above their opening-range high by 10:00 IST:
  09:35  SYN-CDNS          ₹326.74  range 321.58 to 324.80  +0.60% over
  ...
  10:00  SYNTH             ₹364.18  range 354.47 to 362.18  +0.55% over
```

(That run used `--universe` from the synthetic list, so the two BE/BZ
stocks that broke out, SYN-MPC and SYN-ELV, were never scanned.) SYNTH's
range is the 09:15 to 09:25 bars, high 362.18, low 354.47; the 09:55 bar
closed at 364.18, 0.55 % over the high, at 10:00. The user picks SYNTH and
Claude hands it to `/india-news SYNTH`, then `/india-entry SYNTH`.

## Rules

- Say what was scanned: how many symbols, how many charts came back, how many
  were usable, and the time of the data in IST.
- Say "matched a rule", never "a buy", "a winner" or "a good trade".
- Never print a P&L, a return or a profit figure.
- A hit is stale once the price has moved on. Re-run before acting on it.
- Example output from the fixtures is synthetic: say so whenever you show it.

## What it never does

It never places, sizes or checks an order, never says which stock to buy,
never calls data real time, never scrapes NSE beyond the one equity-list
file, and never promises that a setup works.

## Safety

- Education and tooling, not financial advice. A PASS is a rules check, not a recommendation.
- SEBI's own study found 71% of individual intraday traders in the equity cash segment made a
  net loss in FY23 (SEBI, July 2024). Costs and taxes make it harder still.
- Paper trading by default (`"paper": true`). Going live is the user's own decision, in their own config.
- Nothing in this pack places an order except india-broker, and only when all three hold:
  india-risk passed that exact order today, the user typed an explicit yes for that one
  order in the chat, and the user approved Claude's own tool-permission prompt. Since
  2026-04-01 Angel One and Dhan accept API orders only from the user's registered static IP,
  so a cloud session cannot place live orders at all.
- No options, margin, short selling or leverage unless the config allows it and the user confirms.
- Broker keys and TOTP secrets live in environment variables or the broker's own app, never in the chat.
