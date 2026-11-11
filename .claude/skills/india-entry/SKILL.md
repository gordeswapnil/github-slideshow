---
name: india-entry
description: >-
  Entry Timer for NSE stocks. Watches a setup bar by bar and tells you the
  moment to get in. Reads free Yahoo 1-minute or 5-minute bars for
  SYMBOL.NS, builds the opening range (09:15 to 09:30 India time by default)
  and calls the entry on the first completed bar that CLOSES above the range
  high, or above a level you give it (like a 20-day high from the scanner),
  with an optional volume check. Says waiting and how far, triggered with the
  time and the price, expired (no entries after 14:30 by default), or not
  open yet (pre-open call auction 09:00 to 09:15), and writes
  trader-india/entry.json for /india-exit. Long side only. It never places an
  order. Use when the user says "tell me when to get in", "watch RELIANCE",
  "has it broken out", "did it break the opening range", "entry signal",
  "time my entry", "check my watchlist", or after /india-scanner and
  /india-news, before /india-exit.
argument-hint: "[SYMBOL] [--setup orb|level] [--interval 5m|1m]"
---

# india-entry

The Entry Timer turns an NSE setup into one moment: the bar that confirms
it. It reads bars, 1-minute or 5-minute, and waits for each one to finish. A
price that pokes above the high in the middle of a bar is not an entry. A bar
that CLOSES above it is. Then it says the time and the price in India time,
writes them down for the Exit Planner, and stops. It never buys anything.
Day trading loses most people money, and a clean signal does not change that.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).

```bash
python3 "${CLAUDE_SKILL_DIR}/entry.py" check RELIANCE              # 15-minute opening range, 5-minute bars
python3 "${CLAUDE_SKILL_DIR}/entry.py" check RELIANCE --write      # also save trader-india/entry.json
python3 "${CLAUDE_SKILL_DIR}/entry.py" check INFY --setup level --level 1520.40
python3 "${CLAUDE_SKILL_DIR}/entry.py" check M&M --interval 1m --min-volume-x 1.5
python3 "${CLAUDE_SKILL_DIR}/entry.py" watch RELIANCE --until 14:30 # one line per closed bar, stops on the trigger
python3 "${CLAUDE_SKILL_DIR}/entry.py" watchlist                   # every hit in trader-india/watchlist.json
```

Other flags: `--or-minutes N` (default 15), `--json`, `--offline FILE` (a
saved Yahoo chart JSON, `.json` or `.json.gz`, or a folder of
`<SYMBOL>.json`), `--now "2026-10-19 10:00"` (India time, IST) to replay a
day. `watch` with `--now` or `--offline` runs on a simulated clock and
replays the day bar by bar without waiting. Symbols are plain NSE symbols
(RELIANCE, M&M, BAJAJ-AUTO); `RELIANCE.NS` and `NSE:RELIANCE` work too.

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/watchlist.json` | the scanner's hits (`hits[].symbol`), for `watchlist` |
| `trader-india/config.json` | `no_entries_before` (09:30) and `no_entries_after` (14:30), India time. Optional |
| `trader-india/holidays.json` | extra NSE holidays (2027 onwards), shared with every india skill |
| Yahoo chart API | today's bars for `SYMBOL.NS`, `range=1d&interval=5m` (or `1m`), URL-encoded (`M&M` is `M%26M.NS`): free, unofficial, delayed, can lag |
| `trader-india/entry.json` | with `check --write`, or when `watch` triggers: symbol, `"exchange": "NSE"`, setup, status, time, bar, price, level, opening range |

## The rule

- **The NSE day.** Pre-open call auction 09:00 to 09:15, normal market
  09:15 to 15:30 India time. India has no daylight saving, so the times
  never move. Weekends and NSE holidays come from the pack's shared
  calendar (2026, plus `trader-india/holidays.json`).
- **Opening range (orb).** The high and low of the first 15 minutes: the
  09:15, 09:20 and 09:25 five-minute bars, or fifteen 1-minute bars. The
  range is set at 09:30. The level to beat is the range high.
- **Level.** A price you give, like a 20-day high from `/india-scanner`.
- **The trigger** is the first completed bar after the range that CLOSES
  above the level. A wick above is not a trigger. A close exactly at the
  level is not above it.
- **The time** is that bar's close time in 24-hour India time (the 09:55 bar
  closes at 10:00). The price is its close, to the paisa.
- **Only closed bars count.** A bar is closed when the clock passes its start
  plus 5 (or 1) minutes and Yahoo has caught up to that moment (it waits a
  minute at most). Yahoo's live tick, like 10:34:45, is never a bar.
- **Volume, if you want it.** `--min-volume-x 1.5` also needs the trigger
  bar's volume at 1.5 times the range bars' average. The 09:15 bar can carry
  the pre-open auction's volume, so 1.0 is already strict.
- **Time limits.** No entries before 09:30 or after 14:30 (config). Why
  14:30: the pack's flat-by is 15:00, before Angel One and Dhan square off
  intraday (MIS) positions themselves at 15:10, so a later entry has little
  time to work. Until 2026-12-06, stocks in the closing auction session (the
  F&O stocks) stop continuous trading at 15:15.
- **What it says.** Waiting (and how far the last close is from the level),
  triggered, expired, or no data. Before 09:15: not open yet (during
  09:00-09:15 it says the pre-open call auction is on). Before 09:30: the
  range is still forming. Weekends and NSE holidays: the market is closed,
  with the next open. For a year the holiday list does not cover (2027 until
  NSE publishes it in December) it says so and how to add the dates to
  `trader-india/holidays.json`.
- **What Yahoo does not tell you.** The stock's series and its price band.
  Intraday trading is only for the EQ series (BE and BZ are trade-for-trade).
  A stock locked at its upper price band (circuit) can show a close above the
  level with no sellers left to buy from: check the band on NSE or in the
  broker's app before you act.

## Steps

1. Get the symbol from the user, or run `entry.py watchlist` after
   `/india-scanner`. Check `/india-news` for it first.
2. Run `entry.py check SYMBOL`. Tell the user the status in one line:
   waiting and how far, triggered at what time and price, or expired.
3. To wait for it, Claude can run `entry.py watch SYMBOL --until 14:30` in
   the background, or `entry.py check SYMBOL --write` on a `/loop` every 5
   minutes. `watch` wakes just after each bar closes, prints one line per
   bar, and exits 0 on the trigger (it writes `trader-india/entry.json`) or 1
   when the setup expires. Keep the computer awake while it watches: a
   sleeping laptop pauses it, and it catches up, late, when it wakes.
4. When it triggers, say the time and the price, and that nothing was placed.
   If the trigger is more than a bar old, say that too: a late entry is a
   different trade.
5. Hand off to `/india-exit` to set the stop and the target BEFORE anything
   is bought.

## Example: the synthetic reel

SYNTH is synthetic: the US pack's real 2026-10-19 five-minute bars re-timed
onto the NSE session (the US open lands on 09:15 IST) and renamed, prices
unchanged. It is not NSE data and says nothing about any
Indian stock. Monday 2026-10-19, 5-minute bars. The opening range is ₹354.47
to ₹362.18. At 09:57 IST the 09:55 bar is still open, so it waits:

```
WAITING  last close ₹361.68 (09:50 bar), ₹0.50 under the range high ₹362.18 (-0.14%).
The 09:55 bar is still forming (₹364.18 so far, closes 10:00); it does not count until it closes.
```

At 10:00 IST the bar has closed:

```
SYNTH  Mon 2026-10-19 10:00 IST  opening-range breakout (15-minute range) on 5-minute bars (Yahoo, free, delayed, can lag)
Opening range 09:15-09:30: high ₹362.18, low ₹354.47 (3 of 3 bars).
TRIGGERED 10:00 at ₹364.18: the 09:55 bar (bar 8) closed above the range high ₹362.18 (+0.55%).
This is the moment to get in, if you take the trade. Nothing was placed.
```

With `--min-volume-x 1` the 09:55 bar is too thin (0.60x the range's
volume) and the trigger moves to 10:20 at ₹365.75 (the 10:15 bar, 7.98x).
`entry.example.json` in this folder is the entry.json it writes.

## Rules

- Bar by bar, on free Yahoo 1-minute or 5-minute bars. They are unofficial,
  delayed and can lag. Say so when a minute matters.
- A signal is information, not an order, and not a promise. Nothing here
  promises winning trades or money.
- Long side only. This pack plans longs only (intraday short selling is legal
  in India, but off by default). If the user wants a short, say that.
- One trigger per setup per day: the first close above. Later closes do not
  reset it.
- Never call an entry early because a bar looks like it will close above.

## What it never does

It never places an order, never sizes a position, never sets the stop (that
is `/india-exit`), never moves the level after the fact, and never counts a
bar that has not closed. It never runs `/india-broker` from a background
watch: nobody is there to say yes.

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
