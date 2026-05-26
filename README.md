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
| `GET /api/sec/model-data?ticker=NFLX` | Normalized annual 10-K modelling data |
| `GET /api/sec/model-data?ticker=NFLX&years=5` | Latest 5 annual 10-K periods |
| `GET /api/sec/concept?ticker=NFLX&tag=Revenues` | One US-GAAP concept (raw) |

`model-data` returns one normalized object per fiscal year (revenue, cost of
revenue, gross profit, operating income, net income, total/current assets, cash,
total liabilities, equity, operating cash flow, capex, diluted EPS and shares).

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
  rather than guessed.
- The fiscal year is derived from each fact's period-end date, which is a
  reasonable convention but may differ from a company's internal FY label.
- The in-memory cache is per-process; use a shared cache (e.g. Redis) if you run
  multiple instances.
