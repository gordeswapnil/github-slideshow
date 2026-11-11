# The India Day Trader skills (NSE)

Eleven Claude skills for intraday trading on India's National Stock Exchange: scan
NSE stocks for setups, read NSE announcements, time the entry, set the stop and
target on the NSE tick grid, replay the trade, size it with Indian charges counted,
check it against your limits, and paper-trade it. Ported from the MIT-licensed
[day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill) US pack
(`trader-*` in this folder, left as it was).

> **Status: built without live data.** The session that wrote this pack had no
> network access, so no tool has been run against live NSE, Yahoo, Dhan or Angel One.
> The parsers follow formats documented in the brokers' official SDKs and in
> open-source NSE client libraries, and every test runs on synthetic data (see
> `india-tests/fixtures/README.md`). Run each data tool once against the live source
> before you trust it (the checklist is at the end).

## The eleven

| command | job | what it does |
| --- | --- | --- |
| `/india-scanner` | Chart Scanner | NSE's equity list (EQ series), daily setups, 09:15-09:30 opening-range breakouts. |
| `/india-news` | News Monitor | NSE corporate announcements tagged (results, dividend, pledge, SEBI order...), Yahoo `.NS` headlines, the day's move. |
| `/india-entry` | Entry Timer | Watches 5m/1m bars and calls the first completed close above the range. |
| `/india-exit` | Exit Planner | Stop and target on the NSE tick grid, flat by 15:00. |
| `/india-timemachine` | Time Machine | 10,000 replays of the rest of the session plus every past day the setup fired, charges in R. |
| `/india-budget` | Budget Manager | Whole shares from a marketable LIMIT, max loss including STT, stamp duty, exchange, SEBI and GST charges. |
| `/india-risk` | Risk Manager | PASS or BLOCK: window, INTRADAY only, EQ series, tick grid, loss with charges, daily limit, duplicates. |
| `/india-broker` | Order Executor | Paper fills here; Dhan Super Order and Angel One SmartAPI tickets for live use. Never without your yes. |
| `/india-alerts` | Price Alerts | Stop, target, flat-by and the 09:15 opening bell, NSE calendar. |
| `/india-analyst` | Results Analyst | Quarterly results from NSE: revenue, profit, margin, EPS, YoY, QoQ, TTM on the April-March year. |
| `/india-insider` | Insider & Deals Tracker | SEBI PIT insider-trading disclosures and NSE bulk and block deals; replaces the US Pelosi tracker. |

## How to use it

```bash
mkdir -p trader-india
cp .claude/skills/india-budget/config.example.json trader-india/config.json   # then edit it
```

Everything lands in `trader-india/`, and each skill reads what the last one wrote:

```
scanner -> news -> entry -> exit -> timemachine -> budget -> risk -> broker   (one trade)
alerts: stop, target, flat by 15:00                                           (while it is open)
news / analyst / insider                                                       (on a schedule)
```

The worked example, on synthetic data (US bars re-timed onto the NSE clock; nothing
here is a real Indian stock), example config with a ₹1,00,000 budget:

1. `/india-entry SYNTH`: opening range 09:15-09:30 is ₹354.47 to ₹362.18; the 09:55 bar
   closes ₹364.18, so it triggers at 10:00.
2. `/india-exit`: stop at the range midpoint rounded down to the ₹0.05 tick, ₹358.30;
   target 2R, ₹375.90; flat by 15:00.
3. `/india-budget`: LIMIT ₹364.55 (entry + 0.1%, rounded up to the tick). The ₹1,000 max
   loss would allow 150 shares, but the 50% position cap allows 137. Max loss
   137 x ₹6.25 = ₹856.25 + ₹52.53 charges = ₹908.78.
4. `/india-risk`: PASS, reward:risk 1.82 (1.65 net of charges), with warnings that the
   series and the price band are not known from Yahoo data.
5. `/india-broker`: shows the ticket, refuses "sure, go ahead", records "yes", and
   simulates the paper fill.
6. `/india-alerts add --from-plan`: stop, target and 15:00 flat-by alerts.

`india-tests/test_flow.py` runs exactly this chain.

## Fine print

**Not financial advice.** SEBI's own study found 71% of individual intraday traders in
the equity cash segment made a net loss in FY23, and loss-makers paid trading costs
equal to a further 57% of their losses (SEBI, "Analysis of Intraday trading by
Individuals in Equity Cash Segment", July 2024). Decide for yourself, and talk to a
SEBI-registered adviser if you need advice.

**No live order from a cloud session.** Since 2026-04-01 Angel One and Dhan accept API
orders (place, modify, cancel) only from the static IP you registered with them, under
SEBI's retail algo framework. This pack therefore paper-trades by default and prints
tickets you enter in the broker's app, or send from your own tool on your own
registered machine with its permission set to ask. Neither broker has an official MCP
server for Claude (Dhan publishes an official Claude Code agent skill,
`dhan-oss/dhanhq-skills`, which this pack does not use). Angel One reportedly prohibits
API market orders for algo trading, so orders are marketable LIMITs. Bracket: Dhan
Super Order; Angel One gets the stop-loss only, with the target watched by alerts, so
two resting sells can never leave you short.

**Charges are real money here.** Every max loss includes estimated round-trip charges:
STT 0.025% on the sell side, stamp duty 0.003% on the buy side, NSE transaction charge
0.00307% each side (from 2026-03-01), SEBI ₹10 per crore, GST 18% on brokerage and the
exchange and SEBI charges, and brokerage of the lower of ₹20 or 0.03% per order (set
yours in the config). Rates change: check your contract note.

**Timings.** Normal market 09:15-15:30 IST, pre-open 09:00-09:15. Angel One and Dhan
auto square-off intraday equity positions at 15:10 (from 2026-08-03), with a charge,
so the default is no entries after 14:30 and flat by 15:00. Until 2026-12-06 the F&O
stocks stop continuous trading at 15:15; from 2026-12-07 every stock trades to 15:30
with a closing auction after. The brokers may move their square-off times again.

**The NSE calendar ends with 2026.** NSE publishes the next year's holidays in December.
Until the pack is updated, add them to `trader-india/holidays.json` as
`{"2027-01-26": "Republic Day"}`; the tools warn when a date's year is not covered.

**Price bands.** Stocks without derivatives have daily bands of 2, 5, 10 or 20%; F&O
stocks have dynamic bands. A stock locked at its lower band can stop your stop-loss
from filling at all. Yahoo data does not carry the band: check it on nseindia.com.

**Ticks.** NSE sets each stock's tick monthly from its previous month-end close (₹0.01
below ₹250, ₹0.05 to ₹1,000, ₹0.10 to ₹5,000, ...). The pack uses the current price,
which can be wrong near a slab edge.

**NSE's website.** NSE runs bot protection that often refuses scripts, and its terms of
use prohibit systematic or automated data collection. The NSE-reading tools fetch
politely (one cookie warm-up, at least a second between requests) and stop on the
first refusal; each also reads a file you save from nseindia.com in your own browser
(`--file`). Whether you fetch live is your decision under NSE's terms.

**Yahoo data is unofficial.** Yahoo lists NSE as real-time, but users report lags of
about 15 minutes. The entry timer notes when Yahoo's last trade is behind the bar it
is waiting for; the other tools do not check. Yahoo's `.NS` headline feed coverage is
unconfirmed.

**The Time Machine is a simulation, not a prediction.** It draws each bar independently
from the stock's past bars at that time of day, which breaks the momentum and
volatility clustering an opening-range breakout depends on, and 60 sessions is a small
sample.

**Taxes.** Intraday equity profit is speculative business income (section 43(5) of the
1961 Act; the Income-tax Act 2025 applies from 2026-04-01), taxed at your slab rate,
and speculative losses only offset speculative income. Not tax advice.

**Insider and deal data is public, and late.** PIT disclosures arrive days after the
trade; bulk and block deals are published after the session. None of it is inside
information.

## Before you trust the live tools

Allow these hosts in the environment (cloud) or run on your own machine, then run each
command once and compare with the website:

| tool | host | check |
| --- | --- | --- |
| alerts, entry, exit, scanner, timemachine, news | query1/query2.finance.yahoo.com | `alerts.py quote RELIANCE` matches the NSE price; bar times are IST |
| news headlines | feeds.finance.yahoo.com | `news.py --tickers RELIANCE` returns Indian headlines |
| scanner | nsearchives.nseindia.com | `scan.py universe` reads EQUITY_L.csv |
| news, analyst, insider | www.nseindia.com | announcements, results comparison, PIT and deals parse |
| broker ids | images.dhan.co, margincalculator.angelbroking.com | `ticket.py ids` finds the right security ID / token |

Research sources (checked 2026-11-11, mostly from official pages and SDK source; some
only from search excerpts): NSE circulars NSE/CMTR/71775, 72260 (holidays) and 67133
(ticks); NSE pre-open and price-band pages; SEBI circular of 2025-02-04 on retail algo
trading and NSE/INVG/67858; Angel One SmartAPI and Dhan v2 SDKs and docs; Angel One
and Dhan auto square-off pages; SEBI intraday study PR 13/2024.

## Tests

```bash
cd .claude/skills/india-tests && python3 -m unittest discover -s . -v
```

Offline, standard library only, Python 3.8+. `sync_core.py --check` confirms every
script carries the same shared core (`india_core.py`).

MIT, as the original pack (see `LICENSE-day-trader-skill`).
