const config = require('./config');
const { padCik, cikUrlParam, findTickerEntry } = require('./cikLookup');
const { normalizeCompanyFacts, extractAllAnnualFacts } = require('./normalize');
const { buildProfile } = require('./profile');
const { computeRatios } = require('./ratios');
const { createMarketDataProvider } = require('./marketData');
const { createTreasuryProvider } = require('./treasury');
const { computeWacc } = require('./wacc');
const { extractSegments } = require('./segments');
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

function createSecService({ client, marketData, treasury } = {}) {
  const market = marketData || createMarketDataProvider({ client });
  const treasuryProvider = treasury || createTreasuryProvider({ client });

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
    const facts = await client.getJson(companyFactsUrl(resolved.cik));
    const modelData = normalizeCompanyFacts(facts, { years: 2 });
    const period = modelData.periods[0];
    if (!period) throw notFound(`No annual 10-K data to compute WACC for "${resolved.ticker}".`);

    // Market data (beta, market cap) and risk-free rate may fail or be
    // unconfigured; WACC still returns with whatever is available + overrides.
    let overview = { configured: market.configured, beta: null, marketCap: null, source: 'none' };
    let marketError = null;
    try {
      overview = await market.getOverview(resolved.ticker);
    } catch (err) {
      marketError = err.message;
    }
    const rf = await treasuryProvider.getRiskFreeRate();

    const result = computeWacc({
      period,
      beta: overview.beta,
      marketCap: overview.marketCap,
      riskFreeRate: rf.riskFreeRate,
      equityRiskPremium: config.equityRiskPremiumDefault,
      overrides,
    });

    return {
      ticker: resolved.ticker,
      cik: resolved.cik,
      companyName: modelData.companyName || resolved.title,
      ...result,
      meta: {
        marketDataConfigured: market.configured,
        marketDataSource: overview.source,
        marketDataError: marketError,
        riskFreeRateSource: rf.source,
        equityRiskPremiumDefault: config.equityRiskPremiumDefault,
        note: market.configured
          ? undefined
          : 'No market-data API key set (ALPHAVANTAGE_API_KEY). Beta and market cap are null — pass them as query params (?beta=&marketCap=) or set a key.',
      },
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
