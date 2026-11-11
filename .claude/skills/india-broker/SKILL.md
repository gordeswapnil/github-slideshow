---
name: india-broker
description: >-
  Order Executor for NSE (India). Turns approved orders into tickets for your
  broker, paper trading by default, never without your yes. Shows each order
  as a plain ticket in rupees and India time (prices on the NSE tick grid, a
  bracket's stop-loss and target, the max loss at the stop including
  charges) plus the exact request for Dhan (a bracket is one Super Order) or
  Angel One (the entry LIMIT, then a STOPLOSS_LIMIT sell after the fill).
  Records your yes word for word, simulates paper fills, builds the LIMIT
  sell that closes a day trade by your flat-by time, records fills, looks up
  broker security IDs, and logs each trade's max loss so india-risk can hold
  the daily limit. Explains why a cloud session cannot place live orders
  (the brokers' static-IP rule since 2026-04-01). Use when the user says
  "place the order", "buy it", "execute", "send it to Dhan", "send it to
  Angel One", "paper trade it", "close my position", "flatten", "get me
  out", "square off", "set up Dhan", "set up Angel One", or after
  /india-risk passes.
argument-hint: "[order number]"
---

# india-broker

The Order Executor is the only skill in the India pack that can lead to a
real order, so it is the strictest. An order reaches the market only after
three separate gates, every time, for every order:

1. **india-risk passed this exact order today** (matched by fingerprint, today in India time).
2. **The user typed an explicit yes for this one order** in the chat.
3. **The user approved the last step themselves**: Claude's own tool-permission
   prompt, or (for a live order, see below) entering it in the broker's app
   or their own broker tool, which is set to ask.

Two yeses from the user, one PASS from the rules. No yes, no order.

`${CLAUDE_SKILL_DIR}` below is this skill's folder (where this SKILL.md lives).

```bash
python3 "${CLAUDE_SKILL_DIR}/ticket.py" show                       # every ticket, READY or not
python3 "${CLAUDE_SKILL_DIR}/ticket.py" show --as dhan             # paper mode: also show Dhan's request
python3 "${CLAUDE_SKILL_DIR}/ticket.py" approve --index 1 --reply "yes"
python3 "${CLAUDE_SKILL_DIR}/ticket.py" paper --index 1 --price 364.40
python3 "${CLAUDE_SKILL_DIR}/ticket.py" result --index 1 --status placed --broker-id ID --filled-qty 137 --filled-price 364.50
python3 "${CLAUDE_SKILL_DIR}/ticket.py" fill --symbol SYNTH --side sell --qty 137 --price 358.30
python3 "${CLAUDE_SKILL_DIR}/ticket.py" flatten --symbol SYNTH --price 366.10
python3 "${CLAUDE_SKILL_DIR}/ticket.py" ids --dhan-csv api-scrip-master.csv --angel-json OpenAPIScripMaster.json SYNTH
python3 "${CLAUDE_SKILL_DIR}/ticket.py" log
```

`ticket.py` never talks to a broker and never places a live order. It renders
tickets, checks that a reply is a real yes for that order, simulates paper
fills, builds the flatten ticket, looks up security IDs in files you
downloaded, and keeps the log in `trader-india/state/broker.json`.
`--now "2026-10-19 09:55"` pins the clock (India time, IST; no daylight saving).

## What it reads and writes

| file | what |
| --- | --- |
| `trader-india/orders.json` | the proposed orders (india-budget writes it; `flatten` replaces it) |
| `trader-india/state/risk.json` | india-risk's verdicts; only a PASS from today is READY |
| `trader-india/state/broker.json` | every yes, no, placed, failed and filled, with each entry's max loss |
| `trader-india/portfolio.json` | cash and shares, updated by `paper`, `fill` and `result --filled-qty` |
| `trader-india/config.json` | `broker`, `paper`, charges, `limit_buffer_pct`, `stop_limit_ticks`, `flat_by` |
| `trader-india/security_ids.json` | `{"SYNTH": {"dhan": "...", "angelone": "..."}}`, written by `ids` |
| `trader-india/prices.json`, `trader-india/plan.json` | the last price and the flat-by time for `flatten` |

## Paper or live

```json
{"broker": "paper", "paper": true, "limit_buffer_pct": 0.1, "stop_limit_ticks": 5}
```

- `"broker"`: `"paper"` (default), `"dhan"` or `"angelone"`. It picks which broker request the ticket shows.
- `"paper": true` (default): every fill is simulated here by `ticket.py paper`, whatever the broker.
  Neither Dhan nor Angel One offers paper trading (Dhan's sandbox is for testing code and is
  explicitly not paper trading), so the paper account lives in `trader-india/`.
- Live means `"paper": false` **and** a broker named. The user sets that themselves, in their own
  config. Claude never does.

Paper fills: a buy limit fills at the limit, or at `--price P` if P is at or under the limit; above
it, it is "Not filled" and nothing is recorded (try again later, or decline). A sell limit is the
mirror image. A market order needs `--price`. Each paper fill takes the estimated charges off the
cash and is logged as placed, with the max loss, so india-risk counts it.

## How a live order reaches the market in India

**The static IP rule.** Since 2026-04-01 Angel One and Dhan accept API orders (place, modify and
cancel) only from the static IP address the client registered with them. A request from any other
address is rejected (Dhan's error code is DH-911). A Claude cloud session runs on a shared cloud
machine whose address is not the user's, so **it cannot place, change or cancel a live order at
all**. Reading data (quotes, positions, the order book, the scrip master) does not need the IP.

So a live ticket goes one of two ways, both after gates 1 and 2:

1. **The user enters it in the broker's app** (Dhan or Angel One), copying the ticket: side, qty,
   symbol, LIMIT price, INTRADAY, DAY, and the stop-loss and target. Their tap in the app is gate 3.
2. **The user runs their own broker tool on their own static-IP machine**, for example Claude Code
   on their computer with Dhan's official agent skill (`dhan-oss/dhanhq-skills`), with every tool or
   command that places, modifies or cancels an order set to ask (`"permissions": {"ask": [...]}` in
   `.claude/settings.json`, never `allow`). Its permission prompt is gate 3. Neither broker has an
   official MCP server for Claude; community ones exist and get the same rules.

Then record what happened with `ticket.py result`. Keys, tokens, PIN and TOTP secrets stay in that
tool's environment variables or the broker's app. The tickets show placeholders such as
`"dhanClientId": "<your Dhan client id>"`; never fill them in the chat.

**Not live-tested.** The request shapes below come from the brokers' official SDK source and docs as
read in late 2026. No order has ever been sent to Dhan or Angel One from this pack. Before the first
live order, check each field against the broker's current docs and try 1 share.

### Dhan

- A bracket (`"bracket": true`) becomes **ONE Super Order**: `POST https://api.dhan.co/v2/super/orders`
  with `dhanClientId, correlationId, transactionType, exchangeSegment ("NSE_EQ"), productType
  ("INTRADAY"), orderType, securityId (string), quantity (number), price, targetPrice,
  stopLossPrice, trailingJump`. Dhan's docs list INTRADAY for Super Orders. `trailingJump` 0 is meant
  as "no trailing" (our reading, not confirmed). `correlationId` is the order's fingerprint.
- Anything else (a flatten sell): `POST https://api.dhan.co/v2/orders` with `validity` (DAY or IOC),
  `disclosedQuantity` 0 and `triggerPrice` (0 unless it is a stop order).
- Dhan turns API market orders into limit orders with price protection; the pack sends LIMITs anyway.

### Angel One (SmartAPI)

- `POST https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/placeOrder`, every value a
  string, as in Angel One's README sample (`variety, tradingsymbol "SYNTH-EQ", symboltoken, transactiontype,
  exchange "NSE", ordertype, producttype "INTRADAY", duration "DAY", price, squareoff "0",
  stoploss "0", quantity`, plus `triggerprice` on a stop order).
- A bracket is **two steps**, because ROBO (bracket) orders are not confirmed for equities:
  1. now: the entry, `variety` NORMAL, `ordertype` LIMIT;
  2. only after the entry fills, for the quantity that filled: the protective stop, `variety`
     STOPLOSS, `ordertype` STOPLOSS_LIMIT, a SELL with `triggerprice` = the stop-loss and `price` =
     `stop_limit_ticks` ticks below it (default 5, rounded down to the tick).
- **No target sell is placed at the same time.** Two resting sells for the same intraday shares
  could both fill and leave the user short. india-alerts watches the target; when it rings, the user
  cancels the stop-loss order, then `flatten` builds a LIMIT sell that goes through india-risk and a
  new yes.
- Angel One reportedly prohibits API market orders for algo trading from 2026-04-01: use LIMIT.
- A stop-limit can fail to fill if the price gaps through its limit or the stock is stuck at its
  price band (2/5/10/20 %, dynamic for F&O stocks). Watch it.

### Security IDs (`ticket.py ids`)

Both brokers identify a stock by a number, not by its symbol. The user downloads the public scrip
masters (no login, no static IP needed; large files):

- Dhan: `https://images.dhan.co/api-data/api-scrip-master.csv`. `ids` keeps rows with
  `SEM_EXM_EXCH_ID` NSE and `SEM_INSTRUMENT_NAME` EQUITY, matches `SEM_TRADING_SYMBOL` and reads
  `SEM_SMST_SECURITY_ID`.
- Angel One: `https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json`
  (this URL and its fields are community-confirmed, not from Angel One's own docs). `ids` keeps
  records with `exch_seg` NSE and `symbol` "SYMBOL-EQ" and reads `token`.

`ticket.py ids --dhan-csv FILE --angel-json FILE SYNTH RELIANCE` writes
`trader-india/security_ids.json` and keeps entries already there. Without an ID a live ticket shows a
placeholder and is NOT READY for live. Paper does not need IDs. These are public instrument codes,
not credentials. Check one against the broker's app before the first live order.

## Steps: the entry

1. `ticket.py show`. Only READY tickets go to the user. A ticket that is NOT READY or BLOCKED goes
   back to `/india-risk` (or, for a missing ID, to `ticket.py ids`).
2. Show ONE ticket and ask: "Approve this order? Reply yes or no." One order per question. Never
   offer "yes to all".
3. Run `ticket.py approve --index N --reply "<the user's reply, word for word>"`. If it prints
   "Not recorded", the reply was not an explicit yes for this order (for example "sure", "haan",
   "yes to all", or a yes that names a different stock or amount). Ask again. Never turn a reply
   into a yes yourself.
4. Only after "Recorded your yes":
   - **Paper:** `ticket.py paper --index N [--price P]`. Claude Code asks before it runs the
     command (do not put `ticket.py paper` in an allow list): that is gate 3.
   - **Live:** give the user the ticket and the broker request it printed, and the static IP note.
     They enter it in the app or in their own tool. Then `ticket.py result --index N --status placed
     --broker-id <id> --filled-qty Q --filled-price P`, or `--status denied`, or `--status failed`
     with `--note`. A failed order is not retried without a new check and a new yes.
   The log keeps the entry's max loss (with charges) for india-risk's daily limit.
5. **Angel One only:** once the entry fills, the user places step 2, the STOPLOSS_LIMIT sell, for the
   quantity that filled.

## Steps: while it is open, and out by the close

- india-alerts watches the stop, the target and the flat-by time (`/india-alerts`, from the plan).
- When a stop-loss or a target fills (on paper: when the alert rings), record it:
  `ticket.py fill --symbol SYNTH --side sell --qty 137 --price 358.30`. `--charges` takes the
  figure from the contract note; without it the charges are estimated.
- By `flat_by` (default 15:00 IST), anything still open gets closed. Angel One and Dhan auto square
  off intraday (MIS) positions at 15:10, with a charge, and closing-auction (F&O) stocks stop
  continuous trading at 15:15 until 2026-12-06, so do not wait for that.
  1. Check how many shares are held (the broker's positions screen, or `trader-india/portfolio.json`).
  2. `ticket.py flatten --symbol SYNTH [--qty 137] [--price 366.10]` writes a LIMIT sell at the last
     price minus `limit_buffer_pct` (default 0.1 %), rounded down to the tick, to
     `trader-india/orders.json`. Without `--price` it reads `trader-india/prices.json` and warns if
     the quote is more than 15 minutes old.
  3. `/india-risk`. A sell that only closes what the user holds is never blocked by the daily limits
     or the entry window.
  4. `ticket.py show`, then the user's yes for that one order, as above.
  5. Live: first cancel what still holds the shares, or it can fill after the sell and leave the
     user short. Dhan: the Super Order's target and stop-loss legs. Angel One: the resting
     STOPLOSS_LIMIT sell. Then the sell, then `result`.

## Example (synthetic: SYNTH is not an NSE stock)

```
ORDER 1 of 1, LIVE ACCOUNT, REAL MONEY, Dhan, 2026-10-19 09:55 IST
  BUY 137 SYNTH (NSE), limit ₹364.55, intraday (MIS), good for today
  stop-loss ₹358.30
  target ₹370.00
  max loss about ₹908.78 if the stop fills at ₹358.30 (₹856.25 at the stop + ₹52.53 estimated charges); it can fill worse in a fast market, or not at all if the stock is stuck at its price band
  why: opening-range breakout on SYNTH (synthetic): 137 shares, bound by your 50% position cap (₹50,000)
  READY: india-risk PASS, waiting for your yes
  Dhan: ONE Super Order (entry, target and stop-loss together):
    POST https://api.dhan.co/v2/super/orders
    {"dhanClientId": "<your Dhan client id>", "correlationId": "92feb92367c35e18",
     "transactionType": "BUY", "exchangeSegment": "NSE_EQ", "productType": "INTRADAY",
     "orderType": "LIMIT", "securityId": "99990001", "quantity": 137, "price": 364.55,
     "targetPrice": 370.0, "stopLossPrice": 358.3, "trailingJump": 0}
  Since 2026-04-01 Dhan accepts API orders (place, modify, cancel) only from the static IP address
  you registered with it (otherwise Dhan returns error DH-911). ...
```

The same order on Angel One shows step 1 (the LIMIT buy) and step 2 (a STOPLOSS_LIMIT sell,
trigger ₹358.30, limit ₹358.05, after the fill), and no target sell. In paper mode the header reads
"PAPER (simulated here, nothing goes to a broker)" and `--as dhan` or `--as angelone` adds the
request for reference. The `why` and the plan stay in the file; they are never sent.

## What it never does

- Never leads to an order without all three gates, and never two orders on one yes.
- Never places orders from a scheduled or background task: nobody is there to say yes.
- Never tries to send a live order from a cloud session (the static IP rule makes it impossible anyway).
- Never asks for, reads, stores or repeats client ids, API keys, tokens, PINs or TOTP secrets. If the
  config holds one, `show` says to delete it without printing it. If the user pastes one in the chat,
  tell them to delete the message and regenerate it at the broker.
- Never switches `"paper"` to false or `"broker"` to a live broker. The user does that themselves.
- Never places a target sell next to a resting Angel One stop, and never shorts to "fix" a fill.
- Never promises a fill price: a market order and a stop fill at whatever the market gives, and a
  price band can stop a stop-loss from filling at all.

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
