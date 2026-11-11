---
name: india-news
description: >-
  News Monitor for NSE stocks. Tracks what each company you watch files with
  the exchange (NSE corporate announcements: results, board meetings,
  dividends and splits, fund raising, deals, credit ratings, auditor and
  management changes, pledges, SAST and insider disclosures, SEBI orders,
  clarifications), Yahoo Finance headlines per symbol, and how far each stock
  is from the previous close. Shows only what is new since the last check,
  newest first, in India time, tags each item, never repeats one, and warns
  when results are due today, soon, or just came out. Use when the user says
  "any news on RELIANCE", "why is this moving", "what's the news on my
  watchlist", "morning briefing", "pre-market news", "did anything break",
  "check the NSE filings", "corporate announcements", "when are the results",
  "is there a board meeting", or after /india-scanner finds setups.
argument-hint: "[NSE symbols]"
---

# india-news

A chart can look perfect and still be about to jump on a results release, a
SEBI order or a pledge invocation. In India the company's own filing on NSE
usually comes first, and results often come out during market hours. Before a
setup becomes a trade, this skill reads the company's NSE announcements and
its Yahoo Finance headlines for every stock on the watchlist, tells you only
what is new, and prints how far each stock has moved today, so a filing and a
move sit side by side.

Tool in this folder (standard library Python, no keys):

```bash
python3 "${CLAUDE_SKILL_DIR}/news.py"                               # watchlist + plan + portfolio
python3 "${CLAUDE_SKILL_DIR}/news.py" --tickers RELIANCE TCS M&M --hours 12
python3 "${CLAUDE_SKILL_DIR}/news.py" --tickers RELIANCE --file ~/Downloads/announcements.json
python3 "${CLAUDE_SKILL_DIR}/news.py" --no-nse --json
```

Symbols are plain NSE symbols (`RELIANCE`, `M&M`, `BAJAJ-AUTO`); the tool adds
`.NS` only for Yahoo.

## What it reads and writes

| file / feed | what |
| --- | --- |
| `--tickers`, else `trader-india/watchlist.json` | the scanner's hits (india-scanner) |
| `trader-india/plan.json` | the trade you are planning (india-exit) |
| `trader-india/portfolio.json` | what you hold (india-broker records fills there) |
| NSE corporate announcements | `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=RELIANCE` (the last 14 days) |
| `--file PATH` | the same JSON, saved from your own browser (repeatable; NSE is then not called) |
| Yahoo Finance headline RSS | `https://feeds.finance.yahoo.com/rss/2.0/headline?s=RELIANCE.NS&region=IN&lang=en-IN` |
| Yahoo Finance chart endpoint | the last price against the previous close (unofficial, delayed) |
| `trader-india/state/news.json` | what has been shown, by NSE `seq_id` or headline link (kept 30 days) |

### Getting NSE's data

NSE's site wants a browser session, so the tool first loads
`https://www.nseindia.com/` once to collect its cookies, then asks for each
symbol at least a second apart. NSE runs bot protection that often refuses
scripts anyway (HTTP 403, or no answer at all). When that happens the tool
says so in a `note:` line, stops asking NSE for the rest of the run, and
still shows the Yahoo headlines and moves. Then:

1. Open `https://www.nseindia.com/` in your browser, then open the API URL the
   note names (for example
   `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=RELIANCE`).
2. Save the page as a `.json` file (it starts with `[`).
3. Run again with `--file PATH` (several files: repeat `--file`).

NSE's terms of use restrict automated collection of its data. Keep checks
occasional and for your own use: the tool makes one request per symbol per
run, a second apart, and gives up on the first refusal rather than retrying.

Yahoo's coverage of Indian stocks is patchy. An empty feed prints
"no Yahoo headlines", which is not an error: the NSE filings are the primary
source.

## The rules

- **Filings are leads too.** Before telling the user something happened, open
  the filing's PDF (the link on each NSE item) or the story, and read it. Quote
  the source and link it. Never summarise a story you could not read: say so.
- **The filing beats the headline.** If an NSE announcement and a headline
  disagree, the announcement is what the company told the exchange.
- **Say what it touches.** Every item lists the symbols it touches and its
  tags: results, board meeting, corporate action (dividend, bonus, split,
  buyback, record date), fund raising (QIP, rights, preferential issue, NCDs,
  warrants), deal (acquisition, merger, scheme of arrangement, demerger),
  credit rating, auditor, management change (KMP, MD, CEO, CFO, directors),
  pledge/encumbrance, insider/SAST, regulatory (SEBI order, penalty, court,
  tribunal, tax demand), analyst/investor meet, clarification,
  circuit/surveillance (price band, ASM/GSM), analyst rating and macro for
  headlines, and routine (trading window closure, newspaper copies, share
  certificates, AGM paperwork) when there is nothing else to see. NSE items
  marked `!` are in a category that can move the price.
- **Results-day risk comes first.** The tool reads board meeting notices and
  results filings and prints, above the items:
  - `RESULTS OUT`: results were posted to NSE since the last session's close.
    Expect bigger, faster swings and wider spreads; if they came out
    overnight, the open can gap.
  - `RESULTS TODAY`: the board meets on results today. Indian companies often
    release results during market hours (SEBI's listing rules are understood to
    require the outcome within 30 minutes of the meeting ending; not verified
    for this pack, check the current rule), and the price can jump straight
    through a stop.
  - `RESULTS SOON`: the meeting date and how many trading days away it is
    (NSE holidays counted). A day trade closed the same day is not exposed;
    anything held overnight is.
  Say this before `/india-entry` and `/india-exit`. A day trade on a results
  day is a choice the user makes knowing that, not a default.
- **MOVING** marks a stock 3 % or more from the previous close (`--move-pct`).
  A move close to 5, 10 or 20 % adds "near a price band? check NSE": a stock
  locked at its band may not trade at all, and a stop-loss there may not
  fill. Yahoo does not carry the band; the NSE quote page does. A move with no
  filing and no headline is worth saying out loud too.
- **No predictions.** Report what was filed or published and how far the price
  is from the previous close. Never say what the stock will do next.

## Steps

1. Run the check: `python3 "${CLAUDE_SKILL_DIR}/news.py"`. Exit code 1 means
   nothing new. `--all` shows items already seen, `--json` gives everything
   machine readable, `--dry-run` leaves the state alone, `--now "2026-10-19
   09:40"` pins the clock (India time).
2. If a `note:` says NSE refused, offer the `--file` route above; do not loop
   retries against NSE.
3. Read the items that matter: every `RESULTS` line, every `!` filing, and
   every MOVING symbol first. Open the filing PDFs.
4. Write a short brief, per symbol: what happened, the source and link, the
   move, and one line on why it matters to the setup (for example "the board
   meets on results on Wednesday: an overnight hold is exposed to it").
5. If a filing changes the picture, say so before `/india-entry` and
   `/india-exit`: results today, a SEBI order, a pledge invocation, a QIP
   priced below the market. Never act on a filing or a headline alone.

During the session: `/loop 15m /india-news`, or a scheduled task each morning
before the 09:00 pre-open. Keep the interval long: NSE asks for restraint.

## Example (synthetic data)

These numbers come from the synthetic test fixtures (`SYNTH` and `SYN-AUTO`
are made-up companies; the announcements and headlines were written for the
tests, and the price line is US bars re-timed onto the NSE clock). They show
the format, not any real stock.

Monday 2026-10-19, checked at 09:40 IST. The check leads with:

```
NSE 2026-10-19 (Monday), 09:40 IST: normal market until 15:30.
SYNTH      ₹366.48 +3.31% vs previous close ₹354.72 at 10:37 IST  MOVING

RESULTS TODAY  SYN-AUTO: the board meets on results today (2026-10-19). ...
RESULTS SOON   SYNTH: the board meets on results on 2026-10-21 (Wednesday), the next trading day. ...

! 2026-10-19 09:05 IST  SYNTH       NSE           Credit Rating
```

2026-10-20 is an NSE holiday (Dussehra), so Wednesday is the next trading
day. The trading-window closure filed at 08:12 is tagged routine even though
it mentions the results. SYN-AUTO has no Yahoo headlines, which the tool says
in a note. At 14:00 the same check shows only the three items published since,
and SYN-AUTO's line has become `RESULTS OUT ... at 2026-10-19 13:05 IST,
during market hours today`. A brief for SYNTH would say: "Credit rating
revised upwards (NSE filing, 09:05); results on Wednesday, after the
holiday. Today's trade is in and out before the close; an overnight hold is
not." When a symbol has no news, say so rather than padding the brief.

## What it never does

- Never invents or embellishes a filing, a story, a quote or a number.
- Never trades on news, and never tells the user to buy or sell because of a
  filing or a headline.
- Never hammers a server: one request per feed per symbol, at least a second
  between NSE requests, no retries after NSE refuses.

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

This skill only reads and reports.
