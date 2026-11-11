---
name: india-risk
description: >-
  Risk Manager for NSE orders. Checks every trade against your limits and
  stops anything over them, before it can reach the broker. For a day trade:
  a stop is required, the loss at the stop plus the round-trip charges (STT,
  brokerage, GST, fees) must fit your max loss per trade (measured from the
  highest of the plan's entry, the limit price and a fresh price),
  reward:risk must meet your minimum (also shown net of charges), the day's
  total risk must fit your daily loss limit, no more than your trades per
  day, and no new entries outside 09:30 to 14:30 India time or when NSE is
  closed (weekends, NSE holidays). India rules on top: INTRADAY product only,
  EQ series only (BE / BZ are trade-for-trade), prices on the NSE tick grid,
  a warning on MARKET orders and on stops that can fail at the lower circuit.
  It also keeps the basics: blocked symbols, order size, position cap, cash
  buffer, margin, short sales, options, futures and crypto, malformed or bad
  bracket orders, duplicates and a daily order limit. Getting out is never
  blocked by a day limit. Prints PASS or BLOCK with the reason and records the
  verdicts so india-broker only shows an order that passed. Use when the user
  says "check my order", "is this safe", "risk check", "does this break my
  rules", "can I take this trade", "how much have I risked today", or before
  /india-broker, always.
argument-hint: "[path to orders.json]"
---

# india-risk

The Risk Manager is the gate between a proposal and the broker. Every order
written by india-budget or india-broker's flatten passes through it. A BLOCK
is final for that order: it does not go to the user for a yes, and it does
not go to the broker. Most people who day trade lose money: SEBI's own study
found 71% of individual intraday traders in the equity cash segment made a
net loss in FY23. These limits keep each loss and each day's losses small,
charges included. They do not make a trade win.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).

```bash
python3 "${CLAUDE_SKILL_DIR}/check.py"                           # trader-india/ files; writes trader-india/state/risk.json
python3 "${CLAUDE_SKILL_DIR}/check.py" --json
python3 "${CLAUDE_SKILL_DIR}/check.py" --no-write                # look without recording
python3 "${CLAUDE_SKILL_DIR}/check.py" --now "2026-10-19 10:00"  # pin the clock (India time)
```

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/orders.json` | the proposed orders (india-budget, or india-broker's flatten) |
| `trader-india/config.json` | the limits (india-budget ships `config.example.json`) |
| `trader-india/portfolio.json` | cash and holdings; if missing, a fresh account funded with the budget |
| `trader-india/prices.json` | a fresh price raises the price it measures risk from; also values holdings |
| `trader-india/watchlist.json` | each symbol's series (`hits[].series`, from india-scanner); unknown is a warning |
| `trader-india/holidays.json` | NSE holidays the built-in 2026 list does not have yet (`{"2027-01-26": "Republic Day"}`) |
| `trader-india/state/broker.json` | what was placed today: duplicates, trades per day, daily loss |
| `trader-india/state/risk.json` | the verdicts it writes, with the core fingerprint of each exact order |

## Entries and exits

An **entry** opens or adds to a position: a buy, or a sell that would go
short. An **exit** only reduces what you already hold. Getting out must
always be possible, so an exit is checked for format, the tick grid, asset
and short sales only. Every other rule (day limits, entry window, loss,
reward:risk, blocked list, product, series, size, duplicates) turns into a
warning for an exit, never a BLOCK. An off-grid exit price is still blocked:
the exchange would reject it anyway, so fix the price.

## The checks

Orders are checked in file order, as if each passed order had filled, so a
batch that is fine order by order but breaks a limit together is caught.

| check | blocks when |
| --- | --- |
| format | no symbol, not the plain NSE symbol (SYNTH, not SYNTH.NS), exchange not NSE, side not buy or sell, qty not a positive whole number, a rupee (notional) amount, `order_type` not LIMIT / MARKET / SL / SL-M, a LIMIT or SL with no `price`, an SL or SL-M with no `trigger_price`, `validity` not DAY or IOC, no or unknown `product`; a bracket that is not DAY or misses its `stop_loss` or `target` |
| tick | `price`, `trigger_price`, `stop_loss` or `target` is not a multiple of the NSE tick for that price |
| asset | an option symbol while `allow_options` is false; futures, the NFO segment, crypto, or anything that is not an NSE equity symbol |
| short | a sell of more than you hold (`allow_short` false) |
| blocked | (entries) the symbol is on the `blocked` list |
| product | (entries) a product the config does not allow (`"product": "INTRADAY"`: no CNC / delivery for a day trade; MTF needs `allow_margin`) |
| series | (entries) the series is known and not in `allowed_series` (["EQ"]) |
| size | (entries) under `min_order_inr` or over `max_order_inr` |
| position | (entries) the stock would be over `max_position_pct` of the account |
| cash | (entries) the buy would leave less than the cash buffer, or need margin (`allow_margin` false) |
| stop | (entries) no stop while `require_stop` is true; a stop on the wrong side of the entry |
| loss | (entries) qty x (risk price minus stop) + the round-trip charges at the stop over `max_loss_per_trade_inr` |
| reward:risk | (entries) (target minus risk price) / (risk price minus stop) under `min_reward_risk` |
| daily loss | (entries) the max losses at the stops of today's entries, plus this one, over `max_daily_loss_inr` |
| trades | (entries) `max_trades_per_day` entries already placed today |
| window | (entries) before `no_entries_before` (09:30) or after `no_entries_after` (14:30) India time, or NSE is closed |
| duplicate | (entries) the same symbol and side twice in one batch, or already placed today |
| daily limit | (entries) `max_orders_per_day` orders already placed today |

How the numbers work:

- **The risk price** is the HIGHEST of the plan's entry, the limit price (a
  LIMIT or SL order) and a fresh price from `trader-india/prices.json` (under
  15 minutes old). A plan written at 10:00 cannot understate the risk at
  10:40 after the price ran up. An older price is not used, and it says so.
  A short entry uses the lowest instead.
- **Charges**: with `include_costs_in_risk` (true) every max loss adds the
  round trip at the stop from the pack's core: brokerage (the lower of
  `brokerage_flat_inr` and `brokerage_pct` per order), STT 0.025% on the
  sell, stamp duty 0.003% on the buy, the NSE transaction charge, the SEBI
  fee and 18% GST. Reward:risk is enforced before charges and shown after.
- **Daily loss** counts the full max loss of every entry placed today, win or
  lose, as india-broker logged it. Three full ₹1,000 trades use up a ₹3,000 day.
- **The window** is India time (IST, no daylight saving), worked out in the
  tool, never from the computer's clock zone. The normal market is 09:15 to
  15:30; 09:00 to 09:15 is the pre-open call auction (closed for this check).
  Weekends and the NSE holidays (2026 built in) are closed. The entry window
  closes at 14:30 because Angel One and Dhan square off intraday positions
  themselves at 15:10 (from 2026-08-03), with a charge, and until 2026-12-06
  the closing-auction (F&O) stocks stop continuous trading at 15:15. Set both
  `no_entries_*` to null to switch the window off.
- **No pattern-day-trader rule.** That is a US rule; India has none, so this
  check has no PDT guard, and an old US config key for it is simply ignored.

Warnings do not block, but say them to the user:

- a **MARKET** order: Angel One reportedly prohibits API market orders for
  algo trading from 2026-04-01, and Dhan converts them to limit orders. A
  marketable LIMIT (what india-budget writes) does the same job with a cap.
- the **price band**: a stop can fail to fill if the stock hits its lower
  circuit (2/5/10/20%, dynamic for F&O stocks). Yahoo data does not carry the
  band, so check it on nseindia.com.
- an **unknown series**: no `trader-india/watchlist.json` entry says EQ.
- a holiday list that does not cover the year (2027 until NSE publishes it in
  December): add the dates to `trader-india/holidays.json`.
- a LIVE account, a number sent as a string, a stop that is not placed with
  the order (`bracket` false), a price too old to use.

## Steps

1. If the price may have moved since the plan, refresh it first (india-alerts).
2. Run `check.py`. Exit code 0 means every order passed, 1 means at least one
   was blocked.
3. Tell the user the result in plain words, order by order: the max loss at
   the stop with the charges, reward:risk before and after charges, and how
   much of today's limits it uses. For a BLOCK, give the reason and the fix
   (fewer shares, a closer stop from india-exit, a price on the tick, wait for
   the window, or skip the trade). Never change a limit yourself.
4. If the order changes in any way, run the check again. india-broker matches
   each order to its verdict by fingerprint (the core's `fingerprint` over
   `ORDER_FIELDS`), so an edited order is not ready until it passes again, and
   a verdict from yesterday does not count today.

## Example (synthetic SYNTH data)

SYNTH is a synthetic symbol (the US pack's TSLA reel moved onto the NSE clock
and tick grid), not an NSE stock. The bracket india-budget wrote at 10:00 on
Monday 2026-10-19, on a fresh ₹1,00,000 paper account with the example config
and a watchlist that says SYNTH is EQ:

```
PASS  #1 buy SYNTH 137 shares, entry
          entry 364.60 (the limit price), stop 358.30, target 376.00: risk 6.30 a share
          max loss ₹915.63 = 137 x 6.30 + ₹52.53 charges (limit ₹1,000), reward:risk 1.81 (min 1), net of charges 1.65
          today before this: 0 of 3 trades, ₹0 of ₹3,000 daily loss
        ~ price band: a stop can fail to fill if SYNTH hits its lower circuit (NSE price band); Yahoo data does not carry the band, so check it on nseindia.com

1 passed, 0 blocked at 2026-10-19 10:00 India time. Cash after the passed orders: ₹50,049.80 (paper account).
```

- 138 shares is blocked by the position cap (138 x 364.60 = ₹50,314.80, over 50%).
- 150 shares (with a 100% cap) is blocked by the max loss: 150 x 6.30 = ₹945.00
  + ₹57.52 charges = ₹1,002.52. Without the charges it would have passed.
- The same 137 shares checked at 10:40 with a synthetic 366.50 quote from
  10:37 in `trader-india/prices.json` are blocked: risk 8.20 a share, 137 x
  8.20 + ₹52.64 = ₹1,176.04 at the stop. india-budget, run with that quote,
  writes 111 shares at LIMIT 366.90 instead (₹997.27), which passes.
- At 09:29 it is blocked by the window (no new entries before 09:30); on
  Tuesday 2026-10-20 the market is closed (NSE holiday: Dussehra). The 15:00
  sell that closes the position passes, even after the 14:30 cutoff: it is an exit.
- `"product": "CNC"`, a BE-series symbol, or a stop at 358.32 (off the ₹0.05 grid)
  are each blocked.

## Rules

- A PASS only means the order is allowed to be shown to the user. It is not a yes.
- Every number comes from the config, the order, the portfolio, the prices or the broker log.
- Charges are estimates from published 2026 rates; the contract note is the truth.
- Free Yahoo prices (`SYMBOL.NS`) are unofficial and delayed; the broker's price is the one that
  fills, and a stop can fill worse than its price in a fast market, or not at all at a circuit.

## What it never does

It never places an order, never edits an order to make it pass, never
loosens a limit, never blocks a sell that only gets the user out, and never
treats a PASS as the user's yes.

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
