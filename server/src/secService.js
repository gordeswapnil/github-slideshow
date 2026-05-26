const config = require('./config');
const { padCik, cikUrlParam, findTickerEntry } = require('./cikLookup');
const { normalizeCompanyFacts, extractAllAnnualFacts } = require('./normalize');
const { buildProfile } = require('./profile');
const { computeRatios } = require('./ratios');
const { createMarketDataProvider } = require('./marketData');
const { createTreasuryProvider } = require('./treasury');
const { computeWacc, effectiveTaxRate } = require('./wacc');
const { extractSegments } = require('./segments');
const { getIndustryBeta } = require('./damodaran');
const { extractBusinessSection } = require('./filingText');
const { createPriceProvider } = require('./priceData');
const TAG_MAP = require('./tagMap');
const { badRequest, notFound } = require('./errors');

// Field metadata derived from the tag map (no network needed).
function fieldDefinitions() {
  return Object.entries(TAG_MAP).map(([key, def]) => ({
    key,
    label: def.label,
    statement: def.statement,
    unit: def.unit,
    tags: def.tags,
  }));
}

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const submissionsUrl = (cik) => `https://data.sec.gov/submissions/${cikUrlParam(cik)}.json`;
const companyFactsUrl = (cik) =>
  `https://data.sec.gov/api/xbrl/companyfacts/${cikUrlParam(cik)}.json`;
const companyConceptUrl = (cik, tag, taxonomy = 'us-gaap') =>
  `https://data.sec.gov/api/xbrl/companyconcept/${cikUrlParam(cik)}/${taxonomy}/${tag}.json`;

function normalizeTicker(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!t) throw badRequest('Query parameter "ticker" is required.');
  if (!/^[A-Z0-9.\-]{1,15}$/.test(t)) throw badRequest(`Invalid ticker: "${ticker}".`);
  return t;
}

// Latest cover-page shares outstanding from SEC dei data (for market cap).
function sharesOutstanding(facts) {
  const dei = facts && facts.facts && facts.facts.dei;
  const node = dei && dei.EntityCommonStockSharesOutstanding;
  const arr = node && node.units && node.units.shares;
  if (!Array.isArray(arr) || !arr.length) return null;
  const latest = [...arr].sort((a, b) => Date.parse(b.end || 0) - Date.parse(a.end || 0))[0];
  return latest && Number.isFinite(latest.val) ? latest.val : null;
}

function createSecService({ client, marketData, treasury, priceData } = {}) {
  const market = marketData || createMarketDataProvider({ client });
  const treasuryProvider = treasury || createTreasuryProvider({ client });
  const price = priceData || createPriceProvider({ client });

  // Ticker -> { ticker, cik (padded), cikNumber, title }
  async function resolveTicker(rawTicker) {
    const ticker = normalizeTicker(rawTicker);
    const mapping = await client.getJson(TICKERS_URL);
    const entry = findTickerEntry(mapping, ticker);
    if (!entry) {
      throw notFound(`No SEC CIK found for ticker "${ticker}".`);
    }
    return {
      ticker,
      cik: padCik(entry.cik_str),
      cikNumber: entry.cik_str,
      title: entry.title,
    };
  }

  // GET /api/sec/company
  async function getCompany(rawTicker) {
    const resolved = await resolveTicker(rawTicker);
    const submissions = await client.getJson(submissionsUrl(resolved.cik));
    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: submissions.name || resolved.title,
      tickers: submissions.tickers || [resolved.ticker],
      exchanges: submissions.exchanges || [],
      sic: submissions.sic || null,
      sicDescription: submissions.sicDescription || null,
      fiscalYearEnd: submissions.fiscalYearEnd || null,
    };
  }

  // GET /api/sec/companyfacts (wrapped raw SEC payload)
  async function getCompanyFacts(rawTicker) {
    const resolved = await resolveTicker(rawTicker);
    const facts = await client.getJson(companyFactsUrl(resolved.cik));
    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: facts.entityName || resolved.title,
      facts,
    };
  }

  // GET /api/sec/model-data
  async function getModelData(rawTicker, { years } = {}) {
    const resolved = await resolveTicker(rawTicker);
    const facts = await client.getJson(companyFactsUrl(resolved.cik));
    const normalized = normalizeCompanyFacts(facts, { years });
    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: normalized.companyName || resolved.title,
      warnings: normalized.warnings || [],
      periods: normalized.periods,
    };
  }

  // GET /api/sec/profile (case-study profile: metadata + financial snapshot)
  async function getProfile(rawTicker) {
    const resolved = await resolveTicker(rawTicker);
    const [submissions, facts] = await Promise.all([
      client.getJson(submissionsUrl(resolved.cik)),
      client.getJson(companyFactsUrl(resolved.cik)),
    ]);
    const modelData = normalizeCompanyFacts(facts, { years: 5 });
    return buildProfile({ ticker: resolved.ticker, cik: resolved.cik, submissions, modelData });
  }

  // GET /api/sec/ratios (working-capital, liquidity, leverage, returns)
  async function getRatios(rawTicker, { years } = {}) {
    const resolved = await resolveTicker(rawTicker);
    const facts = await client.getJson(companyFactsUrl(resolved.cik));
    const modelData = normalizeCompanyFacts(facts, { years });
    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: modelData.companyName || resolved.title,
      ratios: computeRatios(modelData.periods),
    };
  }

  // GET /api/sec/wacc (cost of capital; market inputs from the configured provider)
  async function getWacc(rawTicker, overrides = {}) {
    const resolved = await resolveTicker(rawTicker);
    const [facts, submissions] = await Promise.all([
      client.getJson(companyFactsUrl(resolved.cik)),
      client.getJson(submissionsUrl(resolved.cik)),
    ]);
    const modelData = normalizeCompanyFacts(facts, { years: 2 });
    const period = modelData.periods[0];
    if (!period) throw notFound(`No annual 10-K data to compute WACC for "${resolved.ticker}".`);

    // Market cap (for the equity weight) is sourced from the market-data
    // provider; it may be unconfigured/fail. Beta comes from a Damodaran
    // INDUSTRY beta re-levered with the company's own D/E + tax rate.
    let overview = { configured: market.configured, beta: null, marketCap: null, source: 'none' };
    let marketError = null;
    try {
      overview = await market.getOverview(resolved.ticker);
    } catch (err) {
      marketError = err.message;
    }

    // Market cap: from the keyed provider if available, else derive it free
    // (Stooq latest close × SEC shares outstanding).
    let marketCap = overview.marketCap;
    let marketCapSource = overview.marketCap != null ? overview.source : null;
    if (marketCap == null) {
      try {
        const close = await price.getClose(resolved.ticker);
        const shares = sharesOutstanding(facts);
        if (close != null && shares != null) {
          marketCap = close * shares;
          marketCapSource = `${price.source}(close ${close}) × SEC(shares ${shares})`;
        }
      } catch (_) {
        /* market cap stays null; user can pass ?marketCap= */
      }
    }

    const rf = await treasuryProvider.getRiskFreeRate();

    const totalDebt = (period.shortTermDebt || 0) + (period.longTermDebt || 0) || null;
    const taxRate = effectiveTaxRate(period);
    // Re-lever with MARKET D/E when market cap is known (book equity inflates beta).
    const equityForLever = marketCap != null ? marketCap : period.stockholdersEquity;
    const de = totalDebt != null && equityForLever ? totalDebt / equityForLever : null;
    const betaInfo = getIndustryBeta({ sic: submissions.sic, de, taxRate });

    const result = computeWacc({
      period,
      beta: betaInfo.releveredBeta,
      marketCap,
      riskFreeRate: rf.riskFreeRate,
      equityRiskPremium: config.equityRiskPremiumDefault,
      overrides,
    });

    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: modelData.companyName || resolved.title,
      ...result,
      beta: {
        ...betaInfo,
        industryName: submissions.sicDescription || null,
        sic: submissions.sic || null,
        deRatioBasis: marketCap != null ? 'market (market cap)' : 'book (equity)',
        providerBeta: overview.beta,
      },
      meta: {
        marketDataConfigured: market.configured,
        marketCapSource: marketCapSource || 'unavailable',
        marketDataError: marketError,
        riskFreeRateSource: rf.source,
        equityRiskPremiumDefault: config.equityRiskPremiumDefault,
        betaNote:
          'Beta is an industry (Damodaran) asset beta re-levered with this company. Override with ?beta=.',
        marketCapNote:
          marketCap == null
            ? 'Could not determine market cap (no API key and no free price) — pass ?marketCap= for the equity weight.'
            : undefined,
      },
    };
  }

  // GET /api/sec/business (Item 1 "Business" narrative from the latest 10-K)
  async function getBusinessSummary(rawTicker) {
    const resolved = await resolveTicker(rawTicker);
    const submissions = await client.getJson(submissionsUrl(resolved.cik));
    const recent = submissions.filings && submissions.filings.recent;
    if (!recent || !Array.isArray(recent.form)) {
      throw notFound(`No filing history found for "${resolved.ticker}".`);
    }
    const idx = recent.form.findIndex((f) => f === '10-K');
    if (idx === -1) throw notFound(`No 10-K filing found for "${resolved.ticker}".`);

    const accession = recent.accessionNumber[idx];
    const primaryDoc = recent.primaryDocument[idx];
    if (!primaryDoc) throw notFound('Latest 10-K has no primary document to parse.');
    const accnNoDash = String(accession).replace(/-/g, '');
    const sourceDocument = `https://www.sec.gov/Archives/edgar/data/${resolved.cikNumber}/${accnNoDash}/${primaryDoc}`;
    const html = await client.getText(sourceDocument);
    const business = extractBusinessSection(html);

    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      accessionNumber: accession,
      sourceDocument,
      business: business || null,
      note: business ? undefined : 'Could not locate the Item 1 (Business) section in the latest 10-K.',
    };
  }

  // GET /api/sec/segments (revenue by segment/geography/product from inline XBRL)
  async function getSegments(rawTicker) {
    const resolved = await resolveTicker(rawTicker);
    const submissions = await client.getJson(submissionsUrl(resolved.cik));
    const recent = submissions.filings && submissions.filings.recent;
    if (!recent || !Array.isArray(recent.form)) {
      throw notFound(`No filing history found for "${resolved.ticker}".`);
    }
    const idx = recent.form.findIndex((f) => f === '10-K');
    if (idx === -1) throw notFound(`No 10-K filing found for "${resolved.ticker}".`);

    const accession = recent.accessionNumber[idx];
    const primaryDoc = recent.primaryDocument[idx];
    const reportDate = recent.reportDate ? recent.reportDate[idx] : null;
    if (!primaryDoc) throw notFound('Latest 10-K has no primary document to parse.');

    const accnNoDash = String(accession).replace(/-/g, '');
    const sourceDocument = `https://www.sec.gov/Archives/edgar/data/${resolved.cikNumber}/${accnNoDash}/${primaryDoc}`;
    const xml = await client.getText(sourceDocument);
    const grouped = extractSegments(xml);

    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: submissions.name || resolved.title,
      accessionNumber: accession,
      reportDate,
      sourceDocument,
      note:
        grouped.axes.length === 0
          ? 'No single-axis revenue breakdowns found. The filing may use older (non-inline) XBRL, custom axes, or only multi-dimensional cells.'
          : undefined,
      ...grouped,
    };
  }

  // GET /api/sec/all-facts (every annual us-gaap concept the company reported)
  async function getAllFacts(rawTicker, { years } = {}) {
    const resolved = await resolveTicker(rawTicker);
    const facts = await client.getJson(companyFactsUrl(resolved.cik));
    const all = extractAllAnnualFacts(facts, { years });
    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: facts.entityName || resolved.title,
      ...all,
    };
  }

  // GET /api/sec/fields (metadata for the curated model — no network)
  function getFields() {
    return { fields: fieldDefinitions() };
  }

  // GET /api/sec/concept (uses the company concept API the SEC exposes)
  async function getConcept(rawTicker, tag, taxonomy = 'us-gaap') {
    if (!tag) throw badRequest('Query parameter "tag" is required.');
    const resolved = await resolveTicker(rawTicker);
    const concept = await client.getJson(companyConceptUrl(resolved.cik, tag, taxonomy));
    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      taxonomy,
      tag,
      concept,
    };
  }

  return {
    resolveTicker,
    getCompany,
    getCompanyFacts,
    getModelData,
    getProfile,
    getBusinessSummary,
    getRatios,
    getWacc,
    getSegments,
    getAllFacts,
    getFields,
    getConcept,
  };
}

module.exports = {
  createSecService,
  // exported for testing / reuse
  TICKERS_URL,
  submissionsUrl,
  companyFactsUrl,
  companyConceptUrl,
  normalizeTicker,
};
