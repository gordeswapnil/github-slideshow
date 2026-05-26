const { padCik, cikUrlParam, findTickerEntry } = require('./cikLookup');
const { normalizeCompanyFacts, extractAllAnnualFacts } = require('./normalize');
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

function createSecService({ client }) {
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
