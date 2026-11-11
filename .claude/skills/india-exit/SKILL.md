---
name: india-exit
description: >-
  Exit Planner for NSE stocks. Sets your stop and your target before you
  enter, so you know when to get out. Reads the entry from india-entry (or a
  price you give), puts the stop at the opening-range midpoint by default (or
  the range low, your price, a percent, or a multiple of the ATR), rounds it
  down to the NSE tick, and sets the target at 2R (or 1R, or your price),
  also rounded down to the tick. Refuses a stop at or above the entry, a
  target at or below it, or a stop too tight to survive the spread (under 4
  ticks or 0.05% of the price), and says why. Flat by 15:00 India time by
  default. Writes trader-india/plan.json for the Time Machine, the Budget
  Manager and Price Alerts. Long side only. Use when the user says "where's
  my stop", "set my stop and target", "plan the exit", "when do I get out",
  "stop loss", "what's my R", "risk reward", or right after /india-entry
  triggers, before /india-timemachine.
argument-hint: "[--stop or-mid|or-low|price:X|pct:X|atr:K] [--target 2R|1R|price:X]"
---

# india-exit

The Exit Planner decides how an NSE intraday trade ends before it starts.
The stop is where the setup has failed. The target is where you take what you
came for. Both are set BEFORE the entry, written down and handed on, so
nobody has to decide anything in the middle of a fast move. A stop is a plan,
not a guarantee: a gap or a fast market can fill past it, and a stock locked
at its lower price band (the lower circuit) can have no buyers at all, so the
stop-loss order does not fill until the band opens. Day trading loses most
people money, and a neat plan does not change that.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).

```bash
python3 "${CLAUDE_SKILL_DIR}/exit.py" plan                          # trader-india/entry.json: midpoint stop, 2R target
python3 "${CLAUDE_SKILL_DIR}/exit.py" plan --stop or-mid --target 1R --write
python3 "${CLAUDE_SKILL_DIR}/exit.py" plan --stop atr:1.5           # needs the session's bars (Yahoo or --offline)
python3 "${CLAUDE_SKILL_DIR}/exit.py" plan --symbol SYNTH --entry 364.18 --or-high 362.18 --or-low 354.47
python3 "${CLAUDE_SKILL_DIR}/exit.py" plan --symbol M&M --entry 3012.45 --stop pct:1
python3 "${CLAUDE_SKILL_DIR}/exit.py" show                          # the current trader-india/plan.json
```

Other flags: `--flat-by 14:45`, `--json`, `--now "2026-10-19 10:01"` (India
time, IST), `--entry PRICE` with a waiting entry.json to plan ahead, `--setup
level`, `--offline FILE` (a saved Yahoo chart JSON for an ATR stop). Symbols
are plain NSE symbols (RELIANCE, M&M, BAJAJ-AUTO); `RELIANCE.NS` and
`NSE:RELIANCE` are read the same way.

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/entry.json` | the trigger from india-entry: symbol, entry price, time, bar, opening range |
| `trader-india/config.json` | `flat_by` (15:00) and `min_reward_risk` (1.0: a note here, india-risk enforces it) |
| `trader-india/holidays.json` | extra NSE holidays (2027 onwards), shared with every india skill |
| Yahoo chart API | only for an `atr:K` stop: the session's `SYMBOL.NS` bars up to the entry bar, free and unofficial |
| `trader-india/plan.json` | with `--write`: entry, stop and its rule, target and its R, risk a share, reward:risk, flat by, `"exchange": "NSE"`, `"timezone": "IST"`. india-timemachine, india-budget, india-alerts and india-risk read it |

## Stops and targets

| stop | where it goes |
| --- | --- |
| `or-mid` | the opening-range midpoint (the default for an opening-range breakout) |
| `or-low` | the opening-range low: wider, so fewer shares for the same max loss |
| `price:X` | your price |
| `pct:X` | X percent under the entry |
| `atr:K` | K times the 14-bar ATR under the entry, on the session's bars up to the entry bar. With fewer than 14 bars by then it averages all of them and says so |

A level setup has no opening range to lean on, so it needs a stop you name.

- **The NSE tick.** NSE prices move in ticks that depend on the price: ₹0.01
  under ₹250, ₹0.05 to ₹1,000, ₹0.10 to ₹5,000, ₹0.50 to ₹10,000, ₹1.00 to
  ₹20,000 and ₹5.00 above (NSE circular NSE/CMTR/67133). NSE sets each
  stock's tick monthly from its last close, so near a slab edge check the
  exchange. The stop rounds DOWN to the tick, away from the entry. The
  target also rounds DOWN, so it is never overstated: a 2R target can read
  1.99R after rounding, and the plan says so. The entry stays the price you
  give, to the paisa. Risk = entry minus stop.
- **Refused, with the reason.** A stop at or above the entry. A target at or
  below it. A risk under the larger of 4 ticks and 0.05% of the price: too
  tight to survive the spread (a liquid NSE stock usually quotes 1 or 2 ticks
  wide), normal wiggle would stop you out. At ₹364.18 that is ₹0.20 (4 ticks
  of ₹0.05); at ₹100 it is ₹0.05 (0.05%). An entry.json that has not
  triggered (unless you give `--entry`). A short: this pack plans longs only
  (intraday short selling is legal in India, but off by default).
- **Flat by.** 15:00 India time by default (or `flat_by` in the config). Out
  by then, win or lose: an intraday (MIS) position is never held overnight.
  A flat-by at or after the 15:30 close is refused. At or after 15:10 it
  warns: Angel One and Dhan square off intraday positions themselves at
  15:10 (from 2026-08-03), with a charge. Until 2026-12-06 it also warns at
  or after 15:15, when stocks in the closing auction session (the F&O
  stocks) stop continuous trading. An entry at or after the flat-by time is
  refused.
- **The calendar.** A plan dated on a weekend or an NSE holiday gets a
  warning. For a year the holiday list does not cover (2027 until NSE
  publishes it in December) it warns and says how to add the dates to
  `trader-india/holidays.json`.

## Steps

1. Run it right after `/india-entry` triggers. Before that, `--entry PRICE`
   plans ahead at the level you expect.
2. Use the default stop for an opening-range breakout unless the user names
   another. A level setup needs one: ask.
3. Run `exit.py plan --write`. Read back the entry, the stop and its rule,
   the target and its rule, the risk a share, reward:risk and flat by.
4. If it refuses, say the reason and the fix (a wider stop, a farther
   target). Never loosen anything on your own.
5. Say once that the stop is a plan, not a guarantee, and that a stock at its
   lower price band (circuit) can leave a stop unfilled. Yahoo data does not
   carry the band: check it on NSE or in the broker's app.
6. Hand off to `/india-timemachine` to replay the plan, then `/india-budget`
   to size it to the max loss per trade (india-budget adds the round-trip
   charges). Offer `/india-alerts` for the stop, the target and the flat-by
   time. Claude can keep `entry.py watch` running in the background or on a
   `/loop` until a setup triggers, then come here.

## Example: the synthetic reel

SYNTH is synthetic: the US pack's real 2026-10-19 bars re-timed onto the NSE
session and renamed, prices unchanged. It is not NSE data and says nothing
about any Indian stock. On Monday 2026-10-19 the entry is ₹364.18 at 10:00
IST (the 09:55 bar, bar 8) and the opening range is ₹354.47 to ₹362.18.
`exit.py plan --stop or-mid --target 1R --write`:

```
Exit plan: SYNTH long on NSE, Mon 2026-10-19, opening-range breakout on 5-minute bars
  Entry         ₹364.18 at 10:00 IST (bar 8)
  Stop          ₹358.30  opening-range midpoint: (₹362.18 + ₹354.47) / 2 = ₹358.325, rounded down to the ₹0.05 tick
  Target        ₹370.05  1R (one times the risk): ₹364.18 + 1 x ₹5.88 = ₹370.06, rounded down to the ₹0.05 tick
  Risk a share  ₹5.88 (1.61% of the entry)
  Reward:risk   1.0
  Flat by       15:00 IST, win or lose: intraday (MIS), no overnight hold
```

The default 2R target would be ₹364.18 + 2 x ₹5.88 = ₹375.94, rounded down
to ₹375.90 (reward:risk 1.99). `plan.example.json` in this folder is the 1R
plan as written. india-budget then sizes it against the max loss per trade,
counting the charges at the stop.

## Rules

- The stop and the target are set before the entry, never after.
- Never move a stop further from the entry once the trade is on.
- Plain numbers only: entry, stop, target, risk a share, reward:risk. It
  never prints a P&L or a return.
- Nothing here promises winning trades or money. A 1R target is not a
  prediction that the price gets there.
- Long side only. This pack plans longs only.

## What it never does

It never places an order, never sizes a position, never widens a stop to
make a plan pass, and never calls a stop a guarantee.

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
