---
name: india-insider
description: >-
  The Insider Tracker for NSE. Watches the trades company insiders must
  disclose under SEBI's Prohibition of Insider Trading (PIT) regulations, and
  NSE's bulk and block deals: lists each PIT filing as NSE posts it, alerts
  once per new filing or deal, reads the filing's XML into clean rows (who,
  promoter or director, buy, sell or pledge, shares, value in rupees, mode,
  trade date, how many trading days it took to reach NSE) and flags stocks on
  your watchlist or in your portfolio. India time, rupees. Use when the user
  says "insider trades", "insider buying", "are the promoters buying X",
  "promoter selling", "promoter pledge", "SEBI PIT disclosures", "bulk deals
  today", "block deals", "did any fund buy X", "who bought in the block deal",
  "alert me when insiders trade my stocks", or "run the insider skill".
argument-hint: "[pit|deals|watch|xml] [--symbol SYMBOL] [--read]"
---

# india-insider

Promoters, directors and other designated persons of a listed Indian company
must report their trades in its shares under SEBI's insider-trading (PIT)
rules. NSE lists every such filing and links an XML file with the details.
Separately, NSE publishes every bulk deal and block deal. This skill reads
both, notices what is new since the last check, and reads the filings for you.

It is fast. It is not early. A PIT disclosure reaches NSE days after the
trade, and bulk and block deals are published after the session. There is no
inside information here: only public filings, read quickly. Say that every
time.

Tool in this folder (standard library Python 3.8+):

```bash
python3 "${CLAUDE_SKILL_DIR}/insider.py" --help
```

## What it reads and writes

| File | Use |
| --- | --- |
| NSE PIT filings: `https://www.nseindia.com/api/corporates-pit-gg?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` | the list of filings (`{"data": [...]}`) |
| each filing's `xmlFileName` (XBRL XML) | the trade rows, with `--read` |
| NSE deals: `https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType=bulk_deals` (or `block_deals`) `&from=DD-MM-YYYY&to=DD-MM-YYYY` | bulk or block deals over up to 365 days |
| `https://nsearchives.nseindia.com/content/equities/bulk.csv` and `block.csv` | the latest day's deals |
| `trader-india/state/insider.json` | written by `watch`: what was already shown, so each item alerts once |
| `trader-india/state/pit-xml/` | downloaded PIT XML files, kept so each is fetched once |
| `trader-india/watchlist.json` | read: india-scanner's hits (`hits[].symbol`), flagged as "on your watchlist" |
| `trader-india/portfolio.json` | read: your positions (`positions[].symbol`), flagged as "you hold" |

Symbols are plain NSE symbols (SYNTH, M&M, BAJAJ-AUTO). Times are India time
(IST), values in rupees with Indian grouping (₹4,13,07,500.00), big ones also
in crore.

## What the data means, and its limits

**Insider trades (SEBI PIT).** Promoters and the promoter group, directors,
key managerial personnel and designated employees report trades in their
company's shares. SEBI's Regulation 7(2) gives the insider 2 trading days to
tell the company once their trades in a calendar quarter pass ₹10 lakh, and
the company 2 more trading days to tell the exchange (as defined by SEBI;
check the current rule). So a filing reaches NSE up to about 4 trading days
after the trade, sometimes later: this is not a real-time trading signal. Each
row shows how many NSE trading days passed (holidays counted from the NSE
calendar) and marks more than 4 as slower than usual.

**Bulk deals.** A bulk deal is a single client's trades in one scrip on one
day that add up to more than 0.5% of the company's listed shares, as defined
by SEBI; check the current rule. They happen in the normal market, and NSE
publishes the day's list after the close. The client is the trading account
named to the exchange (a fund scheme, a foreign investor, a broker's own
book), not always the final owner. A client that bought and sold the same
stock the same day is usually arbitrage or market making, not a new holding:
the tool marks that and shows the net.

**Block deals.** Block deals trade in two separate windows, 08:45-09:00 and
14:05-14:20 IST, with a minimum size of about ₹25 crore from 2025-12-07. These
figures come from secondary sources, so check NSE's current circular. A block
deal is usually a negotiated transfer between two large holders; the price
sits close to the market by rule, so it says who changed hands more than where
the price goes.

This is not inside information. It is what the law makes public, after the
fact.

## Reading the signals

Promoter buying, promoter selling and pledges are different signals. Say
which one it is.

- **Buying in the market** (mode "market purchase", "on market"): an insider
  paying for shares with their own money. The classic positive read, but
  insiders buy for many reasons, and the filing is days old.
- **Selling in the market**: can be taxes, diversification, a planned sale or
  the minimum public shareholding rule. Not automatically bearish; a cluster
  of insiders selling is worth more attention than one sale.
- **Pledges**: a promoter borrowing against their shares. Rising pledges can
  mean money is tight; an invoked pledge means the lender took or sold the
  shares (a forced sale, not a view); a released pledge means the loan was
  repaid. Promoters also report pledges in separate filings under SEBI's
  takeover regulations (SAST), which this skill does not read.
- **ESOP, gift, inter-se transfer, allotment**: not market trades. The tool
  labels them "not a market trade".

## The rules

- **Quote the filing, not a summary site.** Every row comes from NSE's filing
  or deals file, with the app id and links. Third-party trackers can lag or
  mislabel; the filing wins.
- **Say the delay.** PIT rows show the trade date and how many trading days
  later the filing reached NSE.
- **Unconfirmed fields are marked.** See "Formats" below: the person,
  category and mode come from XML element names not yet confirmed against a
  real NSE file. If a row says "person not found in the XML", run
  `insider.py xml FILE --raw` and read the fields yourself.
- **Shareholding percentages are printed as filed.** XBRL can store 12.4% as
  12.4 or 0.124; the share counts before and after are unambiguous.

## Step 1: insider filings

```bash
python3 "${CLAUDE_SKILL_DIR}/insider.py" pit                          # last 7 days, every company
python3 "${CLAUDE_SKILL_DIR}/insider.py" pit --symbol SYNTH --read    # and the rows in each XML
python3 "${CLAUDE_SKILL_DIR}/insider.py" pit --days 30 --json
```

`--symbol` repeats. `--read` opens each filing's XML (the first 10; raise
`--read-limit`), one request a second. Revisions show which app id they
replace and why.

## Step 2: bulk and block deals

```bash
python3 "${CLAUDE_SKILL_DIR}/insider.py" deals --kind bulk            # the latest day (archive CSV)
python3 "${CLAUDE_SKILL_DIR}/insider.py" deals --kind block --days 5  # the historical API
python3 "${CLAUDE_SKILL_DIR}/insider.py" deals --client "SYNTH FUND" --days 30
```

`--days 1` (the default) reads today's `bulk.csv` or `block.csv` and falls
back to the API; more days use the API (365 at most). Without `--kind` it
reads both.

## Step 3: watch for new ones

```bash
python3 "${CLAUDE_SKILL_DIR}/insider.py" watch --read
python3 "${CLAUDE_SKILL_DIR}/insider.py" watch --mine                 # only your symbols
```

Shows only PIT filings and deals not seen at the last check (the last 7 days
of filings and 3 days of deals), your holdings first, then your watchlist,
then the rest (25 per kind; `--limit 0` for all). Everything checked is
recorded in `trader-india/state/insider.json`; `--dry-run` leaves it alone.
Exit code 0 means something new, 1 nothing new, 2 an error. Filings arrive
through the day and into the evening, and deals after the close, so once an
hour on trading days is plenty: run it with `/loop 1h` or a scheduled task,
and keep it gentle (see below).

## Step 4: read one filing

```bash
python3 "${CLAUDE_SKILL_DIR}/insider.py" xml saved-filing.xml --filed 2026-11-11 --raw
```

Rows from one PIT XML (a saved file or its URL). `--raw` prints every field
of every disclosure, for checking the unconfirmed ones.

## When NSE blocks the tool: the browser route

NSE's website terms of use restrict automated collection of its data. This
tool makes a few requests per run for your own use, with a cookie warm-up
visit to the home page, a browser-like User-Agent and Referer and at least one
second between requests. NSE's bot protection still often answers 403 or
never answers. Then the tool stops and prints the exact address; the user:

1. opens `https://www.nseindia.com/` in their own browser,
2. opens the printed address in the same browser and saves what it shows
   (Save Page As `.json`, or the `.csv` download; for `--read`, the XML too,
   next to the JSON or in an `xml/` folder beside it),
3. runs the same command with `--file PATH`. `watch` takes several:
   `--file pit.json --file bulk.csv --file block=block-deals.json`.

`--offline DIR` reads a folder of saved answers named `pit.json`,
`xml/<name>.xml`, `bulk.csv`, `block.csv`, `bulk_deals.json` and
`block_deals.json`; the tests use it.

## Example (synthetic data)

From the test fixtures: SYNTH symbols and fake names, not NSE data.

```
Checked 2026-11-11 20:00 India time. Flagging: SYN-X (watchlist), SYNTH (held)
NEW SEBI PIT insider filing: 2026-11-11 18:42 IST  SYNTH  Synth Industries Limited (synthetic), Original, app 9000101  <- you hold SYNTH
    - promoter buying in the market: SYNTH PROMOTER TRUST (Promoter Group) bought 50,000 shares
      worth ₹4,13,07,500.00 (about ₹826.15 a share), mode: Market Purchase, traded 2026-11-06,
      on NSE 2 trading days later
      holds 1,20,00,000 -> 1,20,50,000 shares (12.00 -> 12.05, shareholding as filed)
NEW SEBI PIT insider filing: 2026-11-09 21:05 IST  SYN-X  Syn-X Chemicals Limited (synthetic), Original, app 9000102  <- SYN-X is on your watchlist
    - promoter pledge created: SYNTH HOLDINGS PRIVATE LIMITED (FAKE) (Promoter) pledged 2,00,000
      shares worth ₹3,00,00,000.00 (about ₹150.00 a share), mode: Pledge, dated 2026-10-26,
      on NSE 10 trading days later (more than the usual 2 + 2)
NEW bulk deal: 2026-11-11  BULK  SYNTH  BUY  1,08,709 @ ₹826.15 = ₹8,98,09,940.35 (₹8.98 crore)  SYNTH CLIENT FUND LLP  <- you hold SYNTH
      the same client bought and sold SYNTH that day (net +5,000 shares): often arbitrage or market making, not a new holding
```

The 2 trading days skip Tuesday 2026-11-10, an NSE holiday. Then say: "These
are public disclosures. The SYNTH purchase happened on 2026-11-06 and reached
NSE two trading days later; it says what a promoter did last week, not what
the price will do next."

If the user wants to act on it, it goes the long way: a disclosure is days
old, so it is a reason to look at a chart, not a setup. `/india-scanner` and
`/india-entry` decide if there is a trade today; then shares only, sized by
`/india-budget`, checked by `/india-risk`, and placed by `/india-broker` only
after their yes.

## Formats: confirmed and assumed

Nothing here was tested live against NSE (no network in the build session).

- PIT list: the endpoint, its Referer and the filing keys (symbol,
  companyName, broadcastDateTime, typeOfSubmission, revisionRemark, appId,
  prevAppId, xmlFileName, ixbrl) come from research and a community project.
  The broadcastDateTime format is assumed ("11-Nov-2026 18:42:10"; ISO is also
  read), and so are the values of typeOfSubmission.
- PIT XML: flat XBRL, one context per disclosure (`contextRef="Disclosure1"`).
  Element names seen in a community parser's notes on real files, used as
  confirmed: `SecuritiesAcquiredOrDisposedNumberOfSecurity`, `...ValueOfSecurity`,
  `...TransactionType`, `...PercentageOfShareholding`,
  `SecuritiesHeldPriorToAcquisitionOrDisposal...` and
  `SecuritiesHeldPostAcquistionOrDisposal...` (NSE's spelling) with
  `NumberOfSecurity` / `PercentageOfShareholding`, and
  `DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate`.
  Unconfirmed, built the same way from SEBI's Form C headings and marked in
  the output: the person (`NameOfThePerson`), category (`CategoryOfPerson`),
  mode (`ModeOfAcquisitionOrDisposal`), to-date, intimation date and exchange.
  The transaction-type and mode words (Buy, Sell, Pledge, Revocation,
  Invocation, Market Purchase, ESOP) are matched loosely.
- Deals: the API's BD_ keys and the CSV headers come from community sources.
  The CSV's date format and number formatting are assumed (dates like
  11-NOV-2026, plain or Indian-grouped numbers are both read).

When a real file disagrees, `--raw` shows what is there; report the field
names so the parser can be fixed.

## What it never does

- Never says or implies an insider or a fund has inside information, or that
  copying them beats the market. No return claims.
- Never presents a filing as real-time, or a client name as the final owner.
- Never hides an unconfirmed field: it is marked, and the filing link is shown.
- Never places an order, and never logs in anywhere.

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
- Insider filings and bulk and block deals are PUBLIC records published after the trade. This
  skill reads them quickly; it has no inside information, and it says so.
