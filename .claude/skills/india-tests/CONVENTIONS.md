# India pack conventions

The India pack is a port of the US day-trader pack (upstream copy:
`/home/user/jakeschincariol/day-trader-skill`, also installed as
`.claude/skills/trader-*`). Leave the `trader-*` folders untouched.

## Layout

| US skill | India skill | script |
| --- | --- | --- |
| trader-scanner | india-scanner | scan.py |
| trader-news | india-news | news.py |
| trader-entry | india-entry | entry.py |
| trader-exit | india-exit | exit.py |
| trader-timemachine | india-timemachine | timemachine.py |
| trader-risk | india-risk | check.py |
| trader-budget | india-budget | size.py (+ config.example.json) |
| trader-broker | india-broker | ticket.py |
| trader-alerts | india-alerts | alerts.py |
| trader-analyst | india-analyst | results.py |
| trader-pelosi | india-insider | insider.py (SEBI PIT insider trades + NSE bulk/block deals) |

- Skills: `.claude/skills/india-<name>/SKILL.md` + script(s). Frontmatter `name: india-<name>`.
- Tests: `.claude/skills/india-tests/test_<name>.py`, using `from _load import load, ROOT, FIX`.
  Run all: `cd .claude/skills/india-tests && python3 -m unittest discover -s . -v`.
- Fixtures: `.claude/skills/india-tests/fixtures/india-<name>/`.
- Working files the skills write: `trader-india/` (core `DATA_DIR`), same file names as the US
  pack's `trader/` (config.json, watchlist.json, entry.json, plan.json, orders.json,
  portfolio.json, prices.json, state/risk.json, state/broker.json, ...). Replace every
  `trader/` path with `trader-india/`. Extra: `trader-india/holidays.json` adds NSE holidays.

## The shared core (mandatory)

`india-tests/india_core.py` holds one block between `# --- india core: begin` and
`# --- india core: end`. Every script embeds that block verbatim right after its own
imports (paste it, or put the two marker lines there and run
`python3 india-tests/sync_core.py`). `sync_core.py --check` must pass. Never edit the
block inside a script; if the core needs a change, report it instead.

Use the core instead of any US logic, and delete the US logic:
- time: `to_ist`, `ist_to_utc`, `utc_now`, `parse_now` (naive `--now` = India time),
  `trading_day`, `session`, `market_status`, `calendar_known`, `continuous_end`,
  `OPEN` 09:15, `CLOSE` 15:30, `PRE_OPEN` 09:00. No DST anywhere. Delete
  `eastern_offset`, NYSE holiday and early-close tables. Labels say "India time" or "IST".
  When `calendar_known` is false (2027 until NSE publishes), warn and say how to add
  `trader-india/holidays.json`.
- symbols: `norm_symbol` (NSE symbol, may contain `&` and `-`, e.g. M&M, BAJAJ-AUTO),
  `yahoo_symbol` (adds `.NS`) and `from_yahoo`. Only Yahoo URLs see `.NS`; URL-encode with
  `urllib.parse.quote(yahoo_symbol(s), safe="")` (M&M -> M%26M.NS). Files and output use the
  plain NSE symbol.
- money: rupees. Print with `inr()` (Indian grouping, `₹1,23,456.50`). Config keys `*_usd`
  become `*_inr`.
- price grid: NSE tick sizes, not cents. A long stop and a long target round with
  `tick_down`; anything that must not be under-stated rounds with `tick_up`.
- costs: `intraday_costs(qty, buy, sell, brokerage_flat, brokerage_pct)` for a round trip.

## Market rules to encode (sources in the research notes in the README)

- Normal market 09:15-15:30 IST, pre-open 09:00-09:15. Opening range = 09:15-09:30.
- Defaults: `no_entries_before` 09:30, `no_entries_after` 14:30, `flat_by` 15:00. Reason:
  Angel One and Dhan auto square-off equity intraday (MIS) positions at 15:10 (from
  2026-08-03), with a charge; closing-auction (F&O) stocks stop continuous trading at
  15:15 until 2026-12-06.
- Intraday only in the EQ series (BE/BZ are trade-for-trade: no intraday). Price bands
  (2/5/10/20 %, F&O stocks dynamic) can stop a stop-loss from filling: say so where stops
  are discussed. Yahoo data does not carry the band.
- No pattern-day-trader rule in India: drop `pdt_guard`.
- Product `INTRADAY` (MIS). Leverage off by default (`allow_margin` false). Short selling
  intraday is legal in India but off by default (`allow_short` false); setups stay long only.
- Costs matter: `include_costs_in_risk` (default true) adds the round-trip charges at the stop
  to every max-loss figure (per trade and daily).

Example config (`india-budget/config.example.json`):

```json
{
  "budget": 100000,
  "cash_buffer_pct": 10,
  "max_position_pct": 50,
  "max_order_inr": 80000,
  "min_order_inr": 500,
  "max_loss_per_trade_inr": 1000,
  "max_daily_loss_inr": 3000,
  "max_trades_per_day": 3,
  "max_orders_per_day": 10,
  "min_reward_risk": 1.0,
  "require_stop": true,
  "include_costs_in_risk": true,
  "no_entries_before": "09:30",
  "no_entries_after": "14:30",
  "flat_by": "15:00",
  "product": "INTRADAY",
  "allowed_series": ["EQ"],
  "brokerage_flat_inr": 20,
  "brokerage_pct": 0.03,
  "broker": "paper",
  "paper": true,
  "blocked": [],
  "allow_options": false,
  "allow_margin": false,
  "allow_short": false
}
```

## Data

- Prices: Yahoo Finance chart JSON v8 for `SYMBOL.NS` on query2/query1.finance.yahoo.com,
  same format as the US pack (meta has currency INR, exchangeTimezoneName Asia/Kolkata,
  gmtoffset 19800). Drop Stooq (no NSE coverage assumed). Free, delayed, unofficial.
- This session has NO network access. Never invent an endpoint's response format: build
  parsers only for formats you can see in the US fixtures or that the lead gives you.

## Fixtures

- Chart fixtures are synthetic: run `python3 india-tests/fixtures/retime.py SRC DST` on the
  US fixture (TSLA -> SYNTH, X -> SYN-X, bars moved so 09:30 ET -> 09:15 IST, NSE holidays
  and bars at/after 15:30 dropped). Name them `SYNTH-...` and say "synthetic" in tests and
  SKILL.md examples. Never call them NSE data.
- Recompute every expected number from the synthetic fixture (times shift by the re-timing:
  a 10:10 ET bar is 09:55 IST; prices are unchanged). Do not copy US numbers without
  checking them.

## Style

- Python 3.8+, standard library only, no zoneinfo. Plain words, no em dashes (U+2014).
- SKILL.md: same structure as the US one, rewritten for NSE and India time. Commands use
  `${CLAUDE_SKILL_DIR}`. Every skill on the way to an order carries the Safety block:

```
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
```

## Files the skills hand each other

Keep the US pack's file names and field names, with these India changes.

`trader-india/plan.json` (india-exit writes; timemachine, budget, alerts, risk read): same
fields as the US plan, prices on the NSE tick grid, times as 24-hour India time ("09:55"),
plus `"timezone": "IST"` and `"exchange": "NSE"`. Default `flat_by` "15:00".

`trader-india/orders.json` (india-budget writes, india-broker `flatten` replaces; india-risk
checks; india-broker shows). Broker-neutral, JSON numbers (not strings):

```json
{
  "created_by": "india-budget",
  "created_at": "2026-10-19T04:25:00Z",
  "status": "proposed",
  "paper": true,
  "note": "Proposals only. Nothing is placed until india-risk passes each order and you say yes to it in the chat.",
  "source": "trader-india/plan.json (SYNTH orb 2026-10-19)",
  "orders": [
    {
      "symbol": "SYNTH",
      "exchange": "NSE",
      "side": "buy",
      "qty": 137,
      "order_type": "LIMIT",
      "price": 364.55,
      "trigger_price": null,
      "product": "INTRADAY",
      "validity": "DAY",
      "stop_loss": 358.30,
      "target": 375.90,
      "bracket": true,
      "why": "opening-range breakout on SYNTH: 137 shares, bound by your 50% position cap",
      "plan": {"entry": 364.18, "stop": 358.30, "target": 375.90, "risk_per_share": 5.88,
               "costs_at_stop": 52.53, "max_loss": 908.78, "setup": "orb",
               "entry_time": "10:00", "flat_by": "15:00"}
    }
  ]
}
```

- `order_type` is LIMIT by default: a marketable limit at the plan entry plus
  `limit_buffer_pct` (config, default 0.1), rounded up to the tick. Reason: Angel One reports
  that API market orders are prohibited for algo trading from 2026-04-01, and Dhan turns API
  market orders into limits with price protection anyway. MARKET is allowed in the file but
  india-risk warns on it.
- Risk is measured from `price` (the worst fill the limit allows) when it is above the plan entry.
  Worked example (synthetic SYNTH, 2R target, example config): limit 364.55, stop 358.30 -> 6.25 a
  share. The max loss alone allows 150 (150 x 6.25 + 57.52 charges = 995.02), but the 50% position cap
  (₹50,000) allows 137 (137 x 364.55 = 49,943.35): 137 x 6.25 = 856.25 + 52.53 charges = 908.78. `entry_time` is the trigger bar's
  close in India time.
- `bracket` true means: stop-loss and target are to be placed with the entry. Dhan: one
  Super Order. Angel One: ROBO orders are not confirmed for equities, so only a separate
  STOPLOSS_LIMIT sell goes in after the entry fills (limit `stop_limit_ticks` ticks below the
  trigger, config default 5). No target sell rests at the broker at the same time: two resting
  sells for the same INTRADAY shares could both fill and leave the user short. india-alerts
  watches the target; when it hits, the stop is cancelled and a LIMIT sell is approved.
- A flatten order: `side` "sell", `bracket` false, `stop_loss`/`target` null, LIMIT at the last
  price minus `limit_buffer_pct`, rounded down to the tick.
- `fingerprint(order)` and `ORDER_FIELDS` live in the shared core. Use them; do not re-implement.
