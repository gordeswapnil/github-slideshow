---
name: india-budget
description: >-
  Budget Manager for NSE day trades. Sizes every position to your rupee
  budget and your max loss per trade, charges included. Reads the trade plan
  from india-exit (entry, stop, target), prices a marketable LIMIT just above
  the entry on the NSE tick grid, finds the whole shares that fit inside four
  limits (max loss incl. STT, brokerage and fees; position cap; max order;
  cash after your buffer), says which limit decided it, and writes ONE
  bracket order (LIMIT entry, stop-loss, target, INTRADAY) to
  trader-india/orders.json. A stop too far away for your max loss is a plain
  refusal, not a smaller order. Nothing is placed. Use when the user says
  "how many shares", "size this trade", "how much should I buy", "I have
  ₹1 lakh", "I only want to risk ₹1,000 a trade", "set my rules", "keep 10%
  in cash", or after /india-exit writes a plan.
argument-hint: "[budget in rupees]"
---

# india-budget

The Budget Manager turns a plan ("buy SYNTH at 364.20, stop 358.30") into an
exact NSE order ("buy 137 shares, LIMIT 364.60, INTRADAY"), inside rules the
user sets once. The stop decides the risk a share; the max loss, the
position cap, the max order and the cash decide the shares. It writes a
proposal only. india-risk checks it and india-broker asks the user yes or no.

Day trading loses most people money. SEBI's own study found 71% of individual
intraday traders in the equity cash segment made a net loss in FY23. Sizing
to a max loss keeps each loss small; it does not make a trade win.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).

```bash
python3 "${CLAUDE_SKILL_DIR}/size.py"                        # trader-india/plan.json + trader-india/config.json
python3 "${CLAUDE_SKILL_DIR}/size.py" --write                # write trader-india/orders.json
python3 "${CLAUDE_SKILL_DIR}/size.py" --limit 364.50 --json  # your own limit price
python3 "${CLAUDE_SKILL_DIR}/size.py" --market               # a MARKET order (india-risk warns on it)
python3 "${CLAUDE_SKILL_DIR}/size.py" --weights SYN-A=40,SYN-B=60 --config split.json   # weights mode, below
```

`--now "2026-10-19 10:00"` pins the clock (India time, IST; no daylight
saving). A plan for another day is refused: make a new one with india-exit.

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/config.json` | the rules (start from `config.example.json` in this folder) |
| `trader-india/plan.json` | the trade: entry, stop, target, setup, flat-by time (india-exit writes it) |
| `trader-india/prices.json` | optional: a fresh price above the plan's entry means a bigger risk (india-alerts writes it) |
| `trader-india/portfolio.json` | optional: its cash caps the size (india-broker keeps it) |
| `trader-india/orders.json` | the one proposed bracket order it writes with `--write` |

## Step 1: set the rules once

If `trader-india/config.json` does not exist, copy `config.example.json` into
`trader-india/config.json` and ask the user for each value in plain words:

- **budget**: how many rupees this is for. Only money they can afford to lose.
- **cash_buffer_pct**: how much always stays in cash (default 10).
- **max_loss_per_trade_inr**: the most one trade may lose if the stop fills at the stop,
  charges included (default ₹1,000).
- **max_position_pct**, **max_order_inr**, **min_order_inr**: the biggest position (50% of
  the budget), the biggest order (₹80,000) and the smallest order (₹500).
- **include_costs_in_risk** (true): add the round-trip charges at the stop (STT, stamp duty,
  NSE transaction charge, SEBI fee, GST, brokerage) to every max-loss figure.
- **brokerage_flat_inr** / **brokerage_pct**: the broker's fee per executed order, the lower
  of ₹20 and 0.03% on the common discount plan. Use the user's own contract note.
- **limit_buffer_pct** (0.1): how far above the entry the LIMIT goes, so it fills like a
  market order but can never fill higher.
- The day limits india-risk enforces: **max_daily_loss_inr** (₹3,000), **max_trades_per_day**
  (3), **min_reward_risk** (1.0), **require_stop** (true), **no_entries_before** /
  **no_entries_after** ("09:30" / "14:30") and **flat_by** ("15:00"), all India time,
  **product** ("INTRADAY") and **allowed_series** (["EQ"]).
- **blocked**: NSE symbols they never want to trade.
- Keep **paper** true until they have watched it work on paper.

Why 14:30 and 15:00: Angel One and Dhan square off open intraday (MIS)
positions themselves at 15:10 (from 2026-08-03), with a charge, and until
2026-12-06 the closing-auction (F&O) stocks stop continuous trading at 15:15.
Flat by 15:00 leaves room to get out on your own terms.

## Step 2: size the trade

```bash
python3 "${CLAUDE_SKILL_DIR}/size.py" --write
```

The order is a LIMIT, not a market order: the entry plus `limit_buffer_pct`,
rounded UP to the NSE tick (₹0.01 under ₹250, ₹0.05 to ₹1,000, ₹0.10 to
₹5,000, then ₹0.50, ₹1 and ₹5). Angel One reports that API market orders are
prohibited for algo trading from 2026-04-01, and Dhan turns API market orders
into limits anyway. The entry it prices from is the plan's entry, or the price
in `trader-india/prices.json` if it is fresh (under 15 minutes old) and
higher. Risk is measured from the limit price, the worst fill the order allows.

Whole shares only. The size is the largest number of shares that fits all four:

| limit | shares |
| --- | --- |
| max loss | shares x (limit price minus stop) + the round-trip charges at the stop <= `max_loss_per_trade_inr` |
| position cap | budget x `max_position_pct` / limit price |
| max order | `max_order_inr` / limit price |
| cash | (budget minus the cash buffer) / limit price, never more than the cash in `trader-india/portfolio.json`; only while `allow_margin` is false |

A stop and a target off the tick grid are rounded down onto it (a long stop
further away, never closer), and it says so.

It refuses, and writes no order, when: the size is zero shares (the stop is
too far for the max loss), the order is under the minimum, reward:risk
(measured from the limit price) is under `min_reward_risk`, the stop is not
below the entry, the target is not above it (the move already happened), the
plan is for another day, the symbol is blocked, or the plan is a short. Say
the reason to the user in one line.

## Step 3: show the user

Show the four limits, which one decided the size, the shares, the rupees, the
max loss at the stop with the charges spelled out, and reward:risk before and
after charges. Say plainly that a stop is an order, not a promise: in a fast
market it can fill below the stop, and if the stock hits its lower circuit
(the NSE price band, 2/5/10/20% or dynamic for F&O stocks) it may not fill at
all. Yahoo data does not carry the band. Then hand over to `/india-risk`.

## Example (synthetic SYNTH data)

SYNTH is a synthetic symbol: the US pack's TSLA reel moved onto the NSE clock
and tick grid. These are not NSE prices. Monday 2026-10-19, opening-range
breakout: entry 364.20 when the 09:55 bar closed at 10:00 India time, stop
358.30 (the opening-range midpoint, (362.20 + 354.45) / 2 = 358.325, down to
the ₹0.05 tick), target 376.00 (2R). The example config: ₹1,00,000 budget,
10% buffer, ₹1,000 max loss incl. charges.

Limit: 364.20 x 1.001 = 364.5642, up to the tick = **364.60**. Risk 364.60 -
358.30 = 6.30 a share.

| limit | the math | shares |
| --- | --- | --- |
| max loss | 149 x 6.30 = ₹938.70 + ₹57.14 charges = ₹995.84 (150 would be ₹1,002.52) | 149 |
| position cap | 50% of ₹1,00,000 = ₹50,000 / 364.60 | **137 (decides it)** |
| max order | ₹80,000 / 364.60 | 219 |
| cash | ₹1,00,000 minus ₹10,000 = ₹90,000 / 364.60 | 246 |

137 shares = ₹49,950.20. Max loss at the stop: 137 x 6.30 = ₹863.10 + ₹52.53
charges (brokerage ₹29.71, STT ₹12.27, GST ₹5.91, NSE ₹3.04, stamp ₹1.50, SEBI
₹0.10) = ₹915.63. Reward:risk 11.40 / 6.30 = 1.81, or 1.65 net of charges. It writes:

```json
{"symbol": "SYNTH", "exchange": "NSE", "side": "buy", "qty": 137, "order_type": "LIMIT",
 "price": 364.60, "trigger_price": null, "product": "INTRADAY", "validity": "DAY",
 "stop_loss": 358.30, "target": 376.00, "bracket": true,
 "why": "opening-range breakout on SYNTH: 137 shares, bound by your position cap (137 x 6.30 + ₹52.53 charges = ₹915.63 at the stop)",
 "plan": {"entry": 364.20, "stop": 358.30, "target": 376.00, "risk_per_share": 6.30,
          "costs_at_stop": 52.53, "max_loss": 915.63, "setup": "orb",
          "entry_time": "10:00", "flat_by": "15:00"}}
```

`why` and `plan` are notes for india-risk and india-broker, never sent to a
broker. `bracket` true means the stop-loss and the target go in with the
entry (india-broker explains how for each broker).

- With the stop at the opening-range low (354.45), the risk is 10.15 a share
  and the max loss decides: 94 shares (94 x 10.15 = ₹954.10 + ₹35.81 = ₹989.91).
  Without the charges it would be 98: the costs cost 4 shares.
- With a fresh synthetic quote of 366.50 at 10:37, the limit becomes 366.90
  and the risk 8.60 a share: 111 shares (₹954.60 + ₹42.67 = ₹997.27), bound by
  the max loss.
- With the US reel's 1R target (370.10), reward:risk from the limit price is
  5.50 / 6.30 = 0.87: refused. Paying the 0.1% buffer costs reward:risk, so a
  1R plan falls under a 1.0 minimum.
- With the stop at 300.00 and a ₹50 max loss, one share risks ₹64.60: no order.

## Weights mode (kept from v1)

`--weights SYN-A=40,SYN-B=25` or `--targets FILE` (`targets.example.json`
here: four synthetic symbols, not a recommendation) splits a budget across a
list by weight: the cash buffer comes off the top, weights are renormalised to
100, any stock over `max_position_pct` is pinned at the cap and its excess
shared out, then each slice buys whole shares at its LIMIT price (the quote
plus `limit_buffer_pct`, up to the tick) and spare cash buys one more share at
a time. NSE has no fractional shares, so it always needs quotes (`--prices`
or `trader-india/prices.json`). A slice under the minimum order is dropped.
With the example config and synthetic quotes SYN-A 1,234.50, SYN-B 362.15,
SYN-C 88.40, SYN-D 2,510.00, the ₹90,000 splits 36,000 / 22,500 / 18,000 /
13,500 and buys 29 / 63 / 211 / 5 shares, ₹86.76 left idle.

These are plain buys with no stop, and they carry the config's `product`:
india-risk blocks them while `require_stop` is true, and blocks DELIVERY
unless the config allows it. Use a separate config (`--config`) for a
long-term split.

## Rules

- Proposals only. This skill never calls a broker tool.
- Never size money the user has not said is for this. Ask for the budget and the max loss.
- Every number comes from the config, the plan or the prices. Nothing is guessed.
- No projections: never say what a trade will make. A target is a plan, not a forecast.
- Charges are estimates from published 2026 rates; the contract note is the truth.
- Free Yahoo prices (`SYMBOL.NS`) are unofficial and delayed. The broker's price is the one that fills.

## What it never does

It never places, approves or schedules an order, never raises a limit on its
own, never shrinks a stop to fit more shares, and never sizes options,
margin or short positions.

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
