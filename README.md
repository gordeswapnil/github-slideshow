# Your GitHub Learning Lab Repository for Introducing GitHub

Welcome to **your** repository for your GitHub Learning Lab course. This repository will be used during the different activities that I will be guiding you through. See a word you don't understand? We've included an emoji 📖 next to some key terms. Click on it to see its definition.

Oh! I haven't introduced myself...

I'm the GitHub Learning Lab bot and I'm here to help guide you in your journey to learn and master the various topics covered in this course. I will be using Issue and Pull Request comments to communicate with you. In fact, I already added an issue for you to check out.

![issue tab](https://lab.github.com/public/images/issue_tab.png)

I'll meet you over there, can't wait to get started!

This course is using the :sparkles: open source project [reveal.js](https://github.com/hakimel/reveal.js/). In some cases we’ve made changes to the history so it would behave during class, so head to the original project repo to learn more about the cool people behind this project.

---

# SEC EDGAR Integration (`server/`)

A small Node.js + Express backend that fetches structured **10-K** financial
statement data directly from the official **SEC EDGAR XBRL JSON APIs**, so
students can build financial models without extracting numbers from PDFs.

It lives in [`server/`](server/) and runs independently of the Jekyll slideshow
above (GitHub Pages can only host static files, so the API must run locally or
on a separate host).

## Why XBRL JSON instead of PDF extraction

Public companies file their financials as machine-readable **XBRL**, and the SEC
exposes it as clean JSON. Parsing that is accurate and reproducible, whereas
scraping numbers out of PDF annual reports is brittle and error-prone. This
integration deliberately uses **only** the free, no-key, no-PDF JSON APIs.

## SEC endpoints used

| Purpose | Endpoint |
| --- | --- |
| Ticker → CIK mapping | `https://www.sec.gov/files/company_tickers.json` |
| Company submissions / metadata | `https://data.sec.gov/submissions/CIK##########.json` |
| Company XBRL facts (all tags) | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` |
| Single concept (one tag) | `https://data.sec.gov/api/xbrl/companyconcept/CIK##########/us-gaap/<Tag>.json` |

CIKs are zero-padded to 10 digits, e.g. `1065280` → `CIK0001065280`.

## No API key — but a required User-Agent

The SEC APIs need **no API key and no paid plan**. They do require a descriptive
`User-Agent` identifying your app and a contact email. The contact email is read
from an environment variable so you can replace it:

```
SEC_CONTACT_EMAIL=you@example.com
```

The backend sends:

```
User-Agent: FinancialModellingEducationApp you@example.com
Accept-Encoding: gzip, deflate
```

Copy `server/.env.example` to `server/.env` and set your email before deploying.

## Rate limits, retries, caching

- **Max 10 requests/second** — the client spaces request starts to stay at or
  below SEC's fair-access ceiling (configurable via `SEC_MAX_RPS`).
- **Retry/backoff** — `429` and `5xx` responses (and transient network errors)
  are retried with exponential backoff, honoring `Retry-After`.
- **Caching** — successful responses are cached in-memory (default 24h) so
  repeated student requests for the same ticker don't re-hit SEC servers.

## API routes

| Route | Description |
| --- | --- |
| `GET /api/sec/company?ticker=NFLX` | CIK, company name, tickers, exchange |
| `GET /api/sec/companyfacts?ticker=NFLX` | Wrapped raw SEC companyfacts JSON |
| `GET /api/sec/model-data?ticker=NFLX` | Normalized annual 10-K modelling data (curated ~50 line items) |
| `GET /api/sec/model-data?ticker=NFLX&years=5` | Latest 5 annual 10-K periods |
| `GET /api/sec/profile?ticker=NFLX` | Case-study profile: industry, HQ, filings + financial snapshot |
| `GET /api/sec/business?ticker=NFLX` | "Item 1 — Business" narrative extracted from the latest 10-K |
| `GET /api/sec/balance-sheet?ticker=NFLX` | Balance sheet recast into Companies Act 2013 Schedule III vertical format |
| `GET /api/sec/ratios?ticker=NFLX` | Working-capital, liquidity, leverage & return ratios per year |
| `GET /api/sec/wacc?ticker=NFLX` | Cost of capital (see WACC section below) |
| `GET /api/sec/segments?ticker=NFLX` | Revenue by segment / geography / product (parsed from the 10-K) |
| `GET /api/sec/all-facts?ticker=NFLX` | **Every** annual us-gaap concept the company reported, as a time series |
| `GET /api/sec/fields` | Metadata for the curated model (field keys, labels, statement, tags) |
| `GET /api/sec/concept?ticker=NFLX&tag=Revenues` | One US-GAAP concept (raw) |

`model-data` returns one normalized object per fiscal year covering a curated
**full three-statement** line-item set (~50 fields):

- **Income statement** — revenue, cost of revenue, gross profit, R&D, selling &
  marketing, G&A, SG&A, total opex, operating income, interest expense/income,
  other non-operating income, pre-tax income, income tax, net income.
- **Per share** — basic & diluted EPS, basic & diluted weighted shares,
  dividends per share.
- **Balance sheet** — cash, short-term investments, receivables, inventory,
  other current assets, total current assets, PP&E, goodwill, intangibles, total
  assets, payables, short-term/long-term debt, deferred revenue, current
  liabilities, total liabilities, common stock, APIC, retained earnings, treasury
  stock, AOCI, stockholders' equity.
- **Cash flow** — D&A, stock-based comp, operating cash flow, capex,
  acquisitions, investing cash flow, debt issued/repaid, buybacks, dividends
  paid, financing cash flow.

The curated set is intentionally not exhaustive. For **everything** a company
tagged in XBRL (often hundreds of concepts), use `all-facts`, which returns each
concept by its raw US-GAAP tag with the same per-value audit trail. Companies use
different tags, so all-facts uses the raw tag names rather than normalizing.

## Segment / geographic / product revenue

These breakdowns are **not** in the companyfacts JSON API — they only exist as
*dimensional* facts inside the filing's inline XBRL. `segments` therefore:

1. finds the most recent 10-K from the submissions feed,
2. downloads its primary inline-XBRL document,
3. parses the contexts (axis/member dimensions) and revenue facts, and
4. groups revenue by axis (business segment, `srt:StatementGeographicalAxis`,
   `srt:ProductOrServiceAxis`, etc.) and member, per fiscal year.

Only **single-axis, full-year** breakdowns are tabled (product×geography
intersection cells are skipped to avoid double-counting, but appear in
`diagnostics`); it targets **inline-XBRL** filings (recent years). It **merges the
latest N 10-Ks** for more history than the ~3 years a single filing tags — the
most recently filed value wins per member/year. Request a span with
`?years=10` (translated to the filings needed) or set filings directly with
`?filings=N` (max 10 ≈ 12 years). In the UI the Periods selector drives this, so
"Last 10" pulls ~8 filings.
The response includes a `diagnostics` block listing every axis/member and axis
combination found, to make missing breakdowns easy to debug. Members are shown by
their raw XBRL QName (humanized) — always treat the source filing as
authoritative.

## Company profile & ratios

`profile` combines SEC submissions metadata (industry/SIC, exchange, HQ, state of
incorporation, fiscal year-end, recent 10-K filings) with a computed financial
snapshot (revenue, YoY growth, margins, ROE) — a quick case-study brief.

`ratios` returns per-year working-capital and analysis ratios: current/quick
ratio, working capital, **DSO / DPO / DIO and the cash-conversion cycle**,
debt/equity, debt/assets, interest coverage, net margin, ROE and ROA — all
computed from the normalized SEC figures.

## Balance sheet — Companies Act 2013, Schedule III

`balance-sheet` recasts the US-GAAP figures into the **vertical Schedule III
(Division I)** format: *I. Equity and Liabilities* (Shareholders' Funds →
Non-Current Liabilities → Current Liabilities) then *II. Assets* (Non-Current →
Current), with `TOTAL EQUITY AND LIABILITIES = TOTAL ASSETS`.

Reconciliation logic: the SEC-reported control totals (Total/Current Assets,
Total/Current Liabilities, Equity) are authoritative. Mapped US-GAAP items fill
the Schedule III buckets, and a balancing **"Other …"** line in each group
absorbs whatever isn't directly mapped (e.g. a streaming company's content
liabilities). This guarantees every subtotal and the grand total tie out — the
response includes a `balances`/`difference` check. The UI shows this in place of
the flat balance-sheet table, with a ✓ balance check per year.

## WACC (cost of capital)

`WACC = (E/V)·Rₑ + (D/V)·R_d·(1−Tc)`, with `Rₑ = R_f + β·ERP`.

SEC data does **not** include beta or market value of equity, so those come from
a market-data provider; the rest is SEC/Treasury/assumption:

| Input | Source |
| --- | --- |
| Cost of debt (`R_d`) | SEC — interest expense ÷ total debt |
| Tax rate (`Tc`) | SEC — income tax ÷ pre-tax income (clamped 0–50%) |
| Book debt (`D`) | SEC — short-term + long-term debt |
| Risk-free rate (`R_f`) | **US Treasury** 10-yr par yield (free, no key) |
| Beta (`β`) | **Damodaran industry** asset beta, re-levered with this company's D/E + tax |
| Market value of equity (`E`) | Market-data provider (market cap, e.g. Alpha Vantage) |
| Equity risk premium (`ERP`) | Assumption (default 5.5%, overridable) |

**Beta** is no longer a single-stock API regression. We map the company's SIC to
an industry, take that industry's **unlevered (asset) beta** (à la Aswath
Damodaran's free NYU Stern dataset), then re-lever it:
`β_L = β_U · (1 + (1 − Tc)·D/E)`. The built-in table is an approximate seed —
point `DAMODARAN_DATA_PATH` at the official downloaded data for production. The
response's `beta` field shows the matched industry, unlevered/relevered values,
D/E and vintage.

**Market cap** needs a price. If `ALPHAVANTAGE_API_KEY` is set it comes from
there; otherwise it's derived **free, no key** as latest Stooq close × SEC shares
outstanding. Beta is then re-levered with **market** D/E (book equity would
inflate it). Override anytime with `?marketCap=`.

The Cash Flow statement is presented in the three **AS 3 / IAS 7 indirect-method
activities** (Operating, Investing, Financing) with each net-cash subtotal, plus
a reconciliation (FX + net change in cash).

Every input is overridable via query params so students can apply their own
assumptions: `?beta=&rf=&erp=&marketCap=&costOfDebt=&taxRate=&totalDebt=`
(rates as decimals, e.g. `rf=0.043`). The UI exposes the same as editable fields
with a live-recomputed breakdown.

## Auditability

Different companies tag the same concept with different US-GAAP tags, so values
**must remain auditable**. For every normalized value, `rawTagsUsed` records the
original SEC tag, unit, fiscal year, accession number, filed date and form type
(and flags derived values, such as total liabilities computed from current +
non-current). Always treat the raw tag as the source of truth.

## Running it

```bash
cd server
npm install
cp .env.example .env   # set SEC_CONTACT_EMAIL
npm start              # http://localhost:5050  (UI + API)
npm test               # Jest suite (mocked SEC responses)
```

Open `http://localhost:5050`, enter a ticker (e.g. **NFLX**) and fetch. Hover any
value to see the exact US-GAAP tag behind it.

## Limitations

- Tag coverage varies by company and over time; missing values come back `null`
  rather than guessed. A few values are **derived** and flagged as such: gross
  profit (revenue − cost of revenue) and total liabilities (current +
  non-current) when not tagged directly; treasury stock is sign-normalized to a
  negative contra-equity value.
- Per-share figures (EPS, weighted shares) use the **latest restated** filing so
  the series is split-adjusted as far back as recent filings restate it; a
  `warnings` entry flags a likely stock-split discontinuity beyond that point.
- The fiscal year is derived from each fact's period-end date, which is a
  reasonable convention but may differ from a company's internal FY label.
- The in-memory cache is per-process; use a shared cache (e.g. Redis) if you run
  multiple instances.
