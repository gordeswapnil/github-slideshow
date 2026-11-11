---
name: india-timemachine
description: >-
  Time Machine for NSE (India). Replays every possible outcome of a planned
  intraday trade before you risk a rupee: 10,000 simulated sessions plus
  every past time the setup fired, with the round-trip intraday charges
  (brokerage, STT, stamp duty, exchange and SEBI fees, GST) in R. Takes the
  plan from india-exit (entry, stop, target, flat-by), rebuilds the rest of
  the NSE session 10,000 times from the stock's own 5-minute bars (09:15 to
  15:30 India time) over the last 60 days, and re-runs the same rule on
  every past session. Prints the odds of target first, stop first, or
  neither by the flat-by time (default 15:00), where the price sits then,
  the average R before and after costs, the history, and one honest verdict,
  then hands off to /india-budget. Use when the user says "run the time
  machine", "replay this trade", "what are the odds", "simulate this
  trade", "monte carlo", "backtest this setup", "how often does this hit the
  target", "is this a coin flip", "what do the charges do to it", or after
  /india-exit writes a plan, before /india-budget.
argument-hint: "[path to plan.json, or NSE SYMBOL]"
---

# india-timemachine

The Time Machine sits between the plan and the money. india-exit has set
the entry, the stop, the target and the flat-by time. Before anything is
sized or sent, this skill asks one question: if today plays out like the
stock's own last 60 days, how often does this plan hit the target first, the
stop first, or neither before you square off, and what is left after the
charges? It answers with 10,000 replays and with the real record of the same
rule on every past session. It is a simulation built from the stock's own
recent bars, not a prediction, and the method has real limits (below). Most
individual intraday traders in India lose money, and a good-looking replay
does not change that.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).
All times are India time (IST, UTC+5:30, no daylight saving), 24-hour.

```bash
python3 "${CLAUDE_SKILL_DIR}/timemachine.py" run                    # trader-india/plan.json, 10,000 replays, seed 19
python3 "${CLAUDE_SKILL_DIR}/timemachine.py" run --write            # also save trader-india/timemachine.json
python3 "${CLAUDE_SKILL_DIR}/timemachine.py" run --until 14:45      # end each replay before the plan's flat_by
python3 "${CLAUDE_SKILL_DIR}/timemachine.py" run --qty 160          # charges for 160 shares
python3 "${CLAUDE_SKILL_DIR}/timemachine.py" run --json
python3 "${CLAUDE_SKILL_DIR}/timemachine.py" run --symbol SYNTH --date 2026-10-19 \
    --entry 364.18 --stop 358.30 --target 370.05 --entry-time 10:00   # synthetic test data
python3 "${CLAUDE_SKILL_DIR}/timemachine.py" chart --from           # ASCII fan chart of the saved run
```

Other flags: `--replays N`, `--seed N` (default 19), `--window N` (default 2
bars), `--orders PATH` and `--config PATH` (where the qty and the brokerage
come from), `--offline FILE` (a saved Yahoo chart JSON, `.json` or
`.json.gz`), `--now "2026-10-19 10:50"` (India time) to pin the clock.

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/plan.json` | the plan from india-exit: symbol, date, entry, `entry_time` (the entry bar's CLOSE, 24-hour IST, e.g. "10:00" for the 09:55 bar) and/or `entry_bar`, stop, stop_rule, target, target_r, opening range, `flat_by` (default 15:00), `timezone` IST, `exchange` NSE, optional `qty` |
| `trader-india/orders.json` | read only for the qty: the first order for the same symbol and side whose `plan` has the same entry and stop |
| `trader-india/config.json` | `brokerage_flat_inr` (default 20) and `brokerage_pct` (default 0.03; null = flat fee only) |
| Yahoo chart API | one request for `SYMBOL.NS`: 60 days of 5-minute bars (`range=60d&interval=5m`), free and unofficial, can lag |
| `trader-india/timemachine.json` | with `--write`: `{plan, mc, costs, history}` plus the verdict. `mc` holds the odds, percentiles, the average R before and after costs, the fan-chart bands, 160 sample paths and a 24-bin histogram of the price at the flat-by time |

## How it works

1. **The pool.** It keeps only FULL NSE sessions before the plan's date: all
   75 five-minute bars, 09:15 to 15:30 India time. NSE holidays have no bars;
   sessions with gaps and today are left out. Every bar becomes four ratios
   to the bar before it: open, high, low and close over the previous close.
2. **One replay.** Start at the entry price. For each bar left until the
   flat-by time, pick a past bar from the same time of day (plus or minus 2
   bars) at random, and scale it to the current price. Bar by bar, it checks
   the stop first, then the target. A bar that touches both counts as the
   stop.
3. **10,000 replays** give four odds. Target first. Stop first. Neither,
   which means the trade was still open at the flat-by time (`--until`, else
   the plan's `flat_by`, else 15:00; never after the 15:30 close). Green,
   which means target first or above the entry at that time. R is the
   target's R at the target, -1 at the stop, and otherwise the distance from
   the entry at the flat-by time divided by the risk. A gap through the stop
   still counts as -1R here. A real fill can be worse, and on NSE a stock
   that hits its price band (circuit limit) can stop a stop-loss from filling
   at all; Yahoo's data does not carry the band.
4. **The history.** The plan's own rule (the same opening range, stop rule
   and target R, with stops and targets rounded to NSE's tick grid) runs
   again on every one of those past sessions. That is what really happened
   on those days, not a simulation.
5. **Costs.** The shared core's `intraday_costs` prices one round trip:
   brokerage (the lower of `brokerage_flat_inr` and `brokerage_pct` % of each
   order), STT on the sell side, stamp duty on the buy side, the NSE
   transaction charge and SEBI's fee on both sides, and GST. It prints the
   charges at the stop and at the target in rupees and in R, and scores every
   replay and every history trade net of its own exit's charges: "average R
   net of costs", and the share of target-first replays needed to break even
   after costs. The qty comes from `--qty`, the plan, or
   `trader-india/orders.json`; with none it uses one share, which is the most
   a share can cost in R (per share, the charges never rise as
   the order grows: with the lower of a flat fee and a percentage, brokerage
   per share can only fall). Rates are 2026's; check your contract note.
6. **The verdict** is one line from the numbers, before costs; the cost
   line and the notes below it carry the charges. It looks only at the replays that hit one side,
   and asks how often the target came first. A bigger target needs to win
   less often to break even: 1 in (1 + R). That is 50 % at 1R, 33 % at 2R.
   Less than 5 points from break-even: "Close to a coin flip" at 1R, "Close
   to break-even" at any other R. 5 to 15 points: "Leans toward the target"
   or "Leans toward the stop". 15 or more: "Strongly toward" one of them.
7. **Below the verdict**, when it applies: a line when more than 40 % of the
   replays hit neither (the price at the flat-by time decides those), the
   average R when its sign goes against the lean, and a line when the charges
   turn a positive average R negative.

**The seed.** The draws come from Python's `random.Random(seed)`, seed 19 by
default. Same plan, same data, same seed: the same numbers, on any machine.
Say the seed with every result so the user can repeat it.

**5-minute bars only.** Yahoo keeps 60 days of 5-min bars but only about 7
days of 1-min bars, too few sessions for a fair pool. It refuses, in one
plain line, when there are fewer than 20 full sessions, when the entry bar is
not in the data (wrong date, an NSE holiday, not closed yet, a future day),
or when the plan does not make sense (a stop above a buy's entry, an entry
off the 5-minute grid, a plan in another time zone or for another exchange).
A live in-progress bar is never used. A flat-by after 15:10 gets a note:
Angel One and Dhan square off intraday (MIS) positions from 15:10 with a
charge, and until 2026-12-06 F&O stocks stop continuous trading at 15:15.

## The limits of this method

Say these plainly when the user leans on the numbers:

- **Each bar is drawn on its own.** A replay picks every bar independently
  from past bars at that time of day. That breaks momentum (a strong morning
  tending to run on) and volatility clustering (big bars following big
  bars). An opening-range breakout depends on exactly those things, so the
  replays can understate both the runs to the target and the fast moves to
  the stop. The history line, which uses real whole sessions, is the check
  on this.
- **60 days is a small sample.** After weekends and NSE holidays that is
  about 57 sessions, and the history fires on only some of them. One quiet
  or one wild month shifts every number.
- **The past 60 days are not today.** Results, news, index events, a price
  band or a halt can do what those sessions never did.

It is a simulation, not a prediction.

## Steps

1. Make sure `trader-india/plan.json` is today's plan from `/india-exit`. If
   there is none, run that first, or pass the plan as flags.
2. Run `timemachine.py run --write`. If `/india-budget` has already written
   `trader-india/orders.json`, the charges use its qty; otherwise they are
   per share, and you can pass `--qty`.
3. Tell the user, in this order: the four odds, the median and the 5 to 95
   range of the price at the flat-by time, the average R, the charges in R
   and the average R net of costs, the history line, then the verdict line
   and any line under it exactly as printed. Say the seed.
4. If the verdict is a coin flip or close to break-even, or the charges turn
   the average R negative, say so plainly. Do not dress it up. If the history
   and the replays disagree, say that too.
5. Say once that this is built from the last 60 days and is not a
   prediction, and name the method's limits above. Check `/india-news` for
   the stock before going on.
6. If the user still wants the trade, hand off to `/india-budget` to size it.

## Example: synthetic data

These numbers come from the pack's SYNTHETIC fixture
(`india-tests/fixtures/india-timemachine/SYNTH-60d5m.json.gz`): real US bars
re-timed onto the NSE clock and renamed SYNTH, with US prices relabelled as
rupees. They are not NSE data and say nothing about any Indian stock.

SYNTH, Monday 2026-10-19. The 15-minute opening range is 354.47 to 362.18.
The 09:55 bar closes above it: entry 364.18 at 10:00 (bar 8), stop 358.30 (the
range midpoint 358.325 rounded down to the 0.05 tick), target 370.05 (1R,
risk 5.88 a share, rounded down to the tick), flat by 15:00.

```
10,000 replays of the rest of the session, 10:00 to 15:00 IST (the plan's flat_by), 60 five-minute bars, seed 19.
  target first   26.1 %
  stop first     21.3 %
  neither        52.7 %   still open at 15:00
  green          53.0 %   target first, or above the entry at 15:00
  Price at 15:00: median 364.52, 90 % of replays between 356.50 and 372.87.
  Average R: +0.053 (R = the 5.88 risk: +0.9983R at the target, -1R at the stop).
  Costs per share (no qty in the plan or orders, so one share: the most a share can cost in R): ₹0.38 round trip at the stop (0.065R), ₹0.39 at the target (0.066R).
  Average R net of costs: -0.012. Net of costs the target has to come first in 53.3 % of the replays that hit one side (50.0 % before costs).
History: the same rule (15-min opening range, stop at the opening-range midpoint, 1R target) on each of those 57 past sessions fired 32 times: 13 target, 15 stop, 4 neither. Average R -0.050 (-0.170 net of costs).
Leans toward the target: target first 26.1 % vs stop first 21.3 %.
52.7 % of the replays hit neither by 15:00; the price at 15:00 decides those.
Charges turn the average R from +0.053 to -0.012 net of costs.
```

At 1R the target has to come first in half of the replays that hit one
side, 53.3 % once the charges are in. It did in 55.1 %: a lean of five
points, the smallest that earns the word. More than half the replays hit
neither, the charges take the average R below zero, and the real history of
the same rule was worse than even (-0.17R a trade after costs). That is the
honest answer for this setup, and it is what the user should hear before
`/india-budget` sizes it. With `--qty 160` the charges at the stop are
₹61.33, still 0.065R.

## Rules

- Every number comes from the run. Never round a coin flip up into an edge.
- The verdict line and the lines under it are printed by the tool. Repeat
  them, do not rewrite them. Never judge a 2R or 3R plan by target first vs
  stop first alone: the verdict already weighs the target's R.
- Always give the charges and the average R net of costs next to the gross
  numbers.
- Simulated odds are not predictions and not promises. Say it once, plainly.
- Free Yahoo data is unofficial and can lag. Bars are 5-minute bars, checked
  bar by bar, never tick by tick and never real time.
- Always say the seed, so any run can be repeated.
- One plan per run. A changed entry, stop, target, date or flat-by is a new run.
- Example output from the fixtures is synthetic: say so whenever you show it.

## What it never does

It never places an order, never sizes a position, never changes the plan,
and never calls a result a sure thing. It never prints a P&L or a profit.
It never uses a bar that has not closed yet, and never mixes today's bars
into the pool.

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
