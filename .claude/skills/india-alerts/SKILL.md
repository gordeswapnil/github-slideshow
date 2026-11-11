---
name: india-alerts
description: >-
  Price Alerts for NSE stocks. Rings when a price, a stop or the opening bell
  hits. Turns the trade plan into three alerts in one go (the stop, the
  target and "flat by" at your flat-by time, 15:00 India time by default),
  plus above / below / stop / target levels, percent moves from the previous
  close, any time of day in India time, and the NSE opening bell at 09:15,
  each ringing once so you are not spammed. Knows the NSE day (pre-open call
  auction 09:00 to 09:15, normal market 09:15 to 15:30 IST) and the 2026 NSE
  holidays, warns when a year's holidays are not known yet, fetches free
  delayed Yahoo quotes for SYMBOL.NS one symbol at a time, and writes
  trader-india/prices.json for sizing and the risk check. Use when the user
  says "alert me when", "tell me if RELIANCE hits", "watch my stop", "watch
  my trade", "remind me to close by 3", "is the market open", "when does the
  NSE open", "get me a price", or right after /india-exit writes a plan.
argument-hint: "[symbol] [price]"
---

# india-alerts

Price Alerts watches the numbers so the user does not have to stare at a
chart. An alert is information, not an order: when a stop alert rings,
nothing is sold by this skill. With a bracket the stop-loss and the target
already sit at the broker (a Dhan Super Order, or separate orders at Angel
One) and do the work; the alerts tell the user what happened and when it is
time to be flat.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).

```bash
python3 "${CLAUDE_SKILL_DIR}/alerts.py" clock                          # NSE open, pre-open or closed, next open
python3 "${CLAUDE_SKILL_DIR}/alerts.py" add --from-plan                # stop, target, flat by from trader-india/plan.json
python3 "${CLAUDE_SKILL_DIR}/alerts.py" add --opening-bell
python3 "${CLAUDE_SKILL_DIR}/alerts.py" add --symbol RELIANCE --stop 1398.10
python3 "${CLAUDE_SKILL_DIR}/alerts.py" add --symbol RELIANCE --target 1440.50
python3 "${CLAUDE_SKILL_DIR}/alerts.py" add --at 15:00 --label "flat by" --symbol RELIANCE
python3 "${CLAUDE_SKILL_DIR}/alerts.py" add --symbol INFY --pct 3
python3 "${CLAUDE_SKILL_DIR}/alerts.py" check                          # exit 0 = something rang
python3 "${CLAUDE_SKILL_DIR}/alerts.py" quote RELIANCE M&M --write     # -> trader-india/prices.json
python3 "${CLAUDE_SKILL_DIR}/alerts.py" quote --holdings --write       # portfolio + plan symbols
python3 "${CLAUDE_SKILL_DIR}/alerts.py" list
python3 "${CLAUDE_SKILL_DIR}/alerts.py" reset reliance-plan-stop
```

`--now "2026-10-19 15:00"` pins the clock (India time, IST; add `Z` for UTC);
`--offline DIR` reads saved `yahoo-<SYMBOL>.json` quote files instead of the
network. Symbols are plain NSE symbols (RELIANCE, M&M, BAJAJ-AUTO);
`RELIANCE.NS` and `NSE:RELIANCE` are read the same way.

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/plan.json` | the trade from india-exit, for `add --from-plan` |
| `trader-india/config.json` | `flat_by` when the plan has none (default 15:00) |
| `trader-india/alerts.json` | the rules (`alerts.example.json` in this folder) |
| `trader-india/state/alerts.json` | which rules rang and when, so each rings once |
| `trader-india/prices.json` | the latest quotes in rupees, merged in, for india-budget and india-risk (same shape as the US pack's, plus `"currency": "INR"`) |
| `trader-india/portfolio.json` | the symbols held, for `quote --holdings` |
| `trader-india/holidays.json` | extra NSE holidays (2027 onwards), shared with every india skill |

## Rule types

| type | rings when | rings again |
| --- | --- | --- |
| `above` / `target` | price at or above `price` | after `reset`, or on its own if `"rearm": true` and the price fell back |
| `below` / `stop` | price at or below `price` | same |
| `pct_move` | moved `pct` percent from the previous close (or `ref`), optional `direction` up or down | once per day at most |
| `time` | the India clock passed `at` ("15:00", 24-hour IST) on an NSE trading day | once per trading day |
| `opening_bell` | the NSE normal market is open (from 09:15, not during the pre-open) | once per trading day |

A rule with `"date"` is watched on that India date only; `--from-plan`
rules carry the plan's date, so yesterday's stop never rings today. The
flat-by alert from a plan rings at the plan's `flat_by` (15:00 by default),
and its message says that Angel One and Dhan square off intraday (MIS)
positions themselves at 15:10, with a charge.

## Quotes

- Yahoo Finance chart JSON for `SYMBOL.NS`:
  `query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=1d`,
  URL-encoded (`M&M` is `M%26M.NS`), an unofficial free endpoint, one
  request per symbol, half a second apart. On a 429 it waits and tries once
  more; on a 429 or a 5xx after that it tries `query1`. Files and output use
  the plain NSE symbol.
- Free quotes are unofficial, delayed and can lag. They are fine for alerts
  and for checking a size, not for timing an order. The broker's price is the
  one that fills. Each price in `trader-india/prices.json` keeps its quote
  time, and india-risk only uses a fresh one.
- Yahoo does not carry a stock's series (intraday is EQ only) or its price
  band (2, 5, 10 or 20%, dynamic for F&O stocks). A stock locked at its lower
  band (the lower circuit) can leave a stop-loss unfilled: a stop alert that
  rang does not prove the position is closed.
- If Yahoo is down, read the price from the broker's app or connector and
  write it into `trader-india/prices.json` as
  `{"as_of": "...Z", "currency": "INR", "prices": {"RELIANCE": 1412.30}}`.

## The NSE clock

Pre-open call auction 09:00 to 09:15, normal market 09:15 to 15:30 India
time, closed on weekends and on the NSE holidays in the pack's shared core
(the 2026 list from NSE circulars NSE/CMTR/71775 and NSE/CMTR/72260, for
example Dussehra on 2026-10-20 and Diwali Balipratipada on 2026-11-10).
India has no daylight saving, so the tool works out India time from UTC
itself and ignores the computer's own zone. `clock` also says, until
2026-12-06, that stocks in the closing auction session (the F&O stocks)
stop continuous trading at 15:15.

NSE publishes the next year's holidays in December. For a year the list does
not cover (2027 for now) `clock` and `check` warn that every weekday counts
as open, and say how to add the dates to `trader-india/holidays.json` as
`{"2027-01-26": "Republic Day", ...}`. Special sessions such as Muhurat
trading are not in the calendar.

## Steps

1. Right after india-exit writes the plan, run `add --from-plan`. Confirm
   the three alerts back to the user: the stop, the target and the flat-by
   time.
2. Run `check` while the trade is open: every few minutes from a Claude
   scheduled task or `/loop`. Each run fetches only the symbols in today's
   rules and rings each alert once. A check reads the latest delayed quote;
   it is not a live feed, and a price can pass a level between two checks.
3. Tell the user what rang in one line each. A stop or target alert means the
   bracket has probably filled: check the positions and record the fill with
   india-broker. "Flat by" means close anything still open: india-broker
   `flatten`, then india-risk, then the user's yes. Never act for them.

## Example: the synthetic reel

SYNTH is synthetic: the US pack's real quotes re-timed onto the NSE session
and renamed, prices unchanged. It is not NSE data and says nothing about any
Indian stock. On Monday 2026-10-19 the plan from india-exit is entry ₹364.18
at 10:00, stop ₹358.30, target ₹370.05, flat by 15:00. `add --from-plan`
writes `synth-plan-stop`, `synth-plan-target` and `synth-flat-by` for that
day. A `check` at 10:38 reads the synthetic 10:37 quote, ₹366.48, between
the stop and the target:

```
NSE OPEN (2026-10-19 10:38 India time, normal market).
Nothing hit. 4 rule(s) watched today, SYNTH ₹366.48.
```

At 15:00:

```
ALERT Flat by: it is 15:00 India time (set for 15:00), the market closes at 15:30. If SYNTH is still open, close it:
india-broker flatten --symbol SYNTH builds the sell ticket, then india-risk and your yes. Brokers such as Angel One
and Dhan square off intraday (MIS) positions at 15:10 themselves, with a charge.
```

It rings once. The next day, 2026-10-20, is an NSE holiday (Dussehra), so
nothing rings; on 2026-10-21 the plan's three alerts are no longer watched,
and with `add --opening-bell` the bell rings at 09:15.

## Rules

- An alert is a fact about a price or the clock. Say it as a fact.
- Never present a quote as live. Free quotes are delayed and unofficial.
- Confirm every new rule back to the user: symbol, type, level, day.

## What it never does

It never places, cancels or changes an order, never claims a quote is
live, and never predicts where a price is going.

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
