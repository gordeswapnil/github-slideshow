---
name: india-analyst
description: >-
  The Results Analyst for NSE companies. Reads a company's quarterly results
  as NSE lists them (NSE's results comparison and its list of results
  filings) and sums up what changed: net sales, total income, net profit, net
  margin and diluted EPS, quarter by quarter, each against the same quarter a
  year earlier and the quarter before, with the trailing twelve months,
  standalone or consolidated, and when each result came out on the NSE clock.
  Reads an earnings call transcript when you paste one. Use when the user says
  "how were Reliance's results", "analyse the quarter", "what changed this
  quarter", "is revenue growing", "Q2 FY27 numbers", "compare margins", "sum
  up the con call", "when do results come out", or before trading a stock
  around its results.
argument-hint: "[NSE symbols]"
---

# india-analyst

Results move Indian stocks more than anything else on the calendar, and the
press release puts the best number first. This skill reads the figures NSE
lists from the company's own results filing, lines them up quarter by
quarter on India's April-March financial year, and says plainly what
changed. For a day trader it answers two questions before a trade: what did
the last results say, and are the next ones inside this trade (and do they
tend to come out during market hours)?

Tool in this folder (standard library Python, no keys):

```bash
python3 "${CLAUDE_SKILL_DIR}/results.py" --help
```

## What it reads and writes

- Reads NSE's results comparison,
  `https://www.nseindia.com/api/results-comparision?symbol=RELIANCE` (NSE's
  spelling): the last few quarters with net sales (`re_net_sale`), total
  income, net profit, diluted EPS, face value, exceptional items and other
  income.
- Reads NSE's list of results filings,
  `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&symbol=RELIANCE`:
  standalone or consolidated, audited or not, the broadcast time and the
  XBRL link. `--no-filings` skips it.
- NSE's bot protection often refuses scripts (HTTP 403, or no answer). The
  tool then says so and stops asking. Open `https://www.nseindia.com/` in
  your browser, then each URL above, save each page as a `.json` file, and
  run `results.py SYMBOL --file comparison.json --filings-file filings.json`
  (one symbol per pair of files).
- NSE's terms of use restrict automated collection of its data. Keep it
  occasional and for your own use: one warm-up and one request per URL, at
  least a second apart, no retries.
- Writes `trader-india/metrics.json` with `--metrics`: one row per symbol
  (TTM net sales, net profit and EPS, the latest net margin and growth, the
  basis). `metrics.example.json` in this folder is a run on the synthetic
  test companies, not on real data.
- Earnings calls: the tool does not fetch transcripts. If the user pastes one
  (listed companies post call recordings and transcripts on their websites,
  and many also file the transcript on NSE under "Analysts/Institutional
  Investor Meet/Con. Call Updates"), read it and sum up what management said
  changed: guidance, margins, demand, capex, anything they declined to answer.
- The next results date is not in this data. Look for the board meeting
  notice with `/india-news` (it prints `RESULTS SOON` with the date) and say
  where it came from.

## The rules

- **Units: say them.** NSE's figures are printed as NSE shows them, usually
  rupees in lakh (1 crore = 100 lakh). The tool also gives the crore figure
  "if these are in lakh". Check the filing before quoting a number as crore.
- **Filed numbers first.** The table comes from NSE's listing of the filed
  results. Use the results PDF, the press release and the presentation for
  context, and say which numbers came from where.
- **Standalone vs consolidated.** NSE's comparison rows do not say which they
  are. When a row matches a filing in NSE's filings list (by sequence
  number), that filing labels it; otherwise the header says "basis not
  stated". A group with subsidiaries can look very different consolidated:
  never compare a standalone figure with someone's consolidated one.
- **Compare like with like.** Growth is against the same quarter a year
  earlier. Quarter-on-quarter changes are shown but many businesses are
  seasonal (festive quarters, monsoon, year-end Q4).
- **EPS needs the same face value.** After a split, bonus or consolidation the
  face value changes and EPS on either side do not compare: the tool leaves
  that growth blank and drops TTM EPS.
- **Say when the data lags.** When the filings list has a newer quarter than
  the comparison, the tool prints a NOTE with the XBRL link: read the filing
  itself before summarising.
- **Flag one-offs.** Exceptional items, other income above a quarter of
  profit before tax, and a swing between loss and profit are called out.
  A percent change across a loss is not shown: it is not meaningful.

## Steps

1. Run it for the companies in question (or the symbols on
   `trader-india/watchlist.json`):

   ```bash
   python3 "${CLAUDE_SKILL_DIR}/results.py" RELIANCE
   python3 "${CLAUDE_SKILL_DIR}/results.py" RELIANCE TCS INFY --metrics trader-india/metrics.json
   python3 "${CLAUDE_SKILL_DIR}/results.py" RELIANCE --file comparison.json --filings-file filings.json
   ```

   `--quarters 8` shows more if NSE has them, `--basis consolidated` keeps one
   basis, `--json` gives everything machine-readable.
2. Open the latest results filing (the XBRL or PDF link) when the numbers
   need context, and read it.
3. Write the summary: one line on the quarter (net sales, net profit, EPS,
   growth), one on the margin, one on anything unusual (exceptional items, a
   split, a lagging comparison, basis), the release time, and the links.
   Plain words, real numbers, no adjectives the numbers do not support.
4. If the next results fall inside the planned trade, say it before
   `/india-exit` sets the stop. If the company usually reports during market
   hours, a same-day trade is exposed too: a stop does not protect against a
   jump through it, and a price band can stop it filling at all.

## Example (synthetic data)

`SYNTH` and `SYN-AUTO` are made-up companies in the test fixtures; the
figures were written for the tests and are not NSE data.

`results.py SYNTH SYN-AUTO --offline <fixtures>`: SYNTH, standalone (from
NSE's filings list), quarter ending 2026-09-30 (Q2 FY27): net sales 60,870
(+16.2% against a year earlier), net profit 5,020 (+19.8%), diluted EPS
₹10.04 (+19.8%); "if these are in lakh, ₹608.70 crore and ₹50.20 crore"; net
margin 8.2% (+0.2 points on the quarter before); last four quarters 2,33,340
net sales and ₹38.74 EPS. The filings list shows the standalone and the
consolidated filings broadcast on 2026-10-21 after the close, and that Q1
came out during market hours.

For SYN-AUTO the tool notes that NSE's comparison stops at 2026-06-30 while a
consolidated filing for 2026-09-30 was broadcast at 13:05 IST on 2026-10-19,
during market hours, so the summary reads that filing directly. It also
flags the swing from a loss a year earlier, exceptional items inside the
profit, and a face-value change (a split) that makes EPS growth and TTM EPS
meaningless.

## What it never does

- Never says a stock is cheap, expensive, a buy or a sell. It reports what
  NSE lists from the company's filing.
- Never invents a number the data does not have, never converts lakh to
  crore without saying "if", and never mixes standalone and consolidated rows
  in one table.
- Never hammers NSE: one warm-up, one request per URL, at least a second
  apart, and none after a refusal.

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

This skill only reads results.
