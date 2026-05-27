const config = require('./config');

// Risk-free rate from the US Treasury Daily Par Yield Curve feed (free, no key).
// The feed is XML; rather than add an XML dependency we extract the latest
// 10-year rate (BC_10YEAR) with a regex. Falls back to a configured default.
const TREASURY_BASE =
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';

function treasuryUrl(year) {
  return `${TREASURY_BASE}?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
}

function parseLatest10Year(xml) {
  if (!xml) return null;
  // Each daily entry contains <d:BC_10YEAR>4.32</d:BC_10YEAR>. The feed is
  // chronological, so the last match is the most recent business day.
  const matches = [...xml.matchAll(/<d:BC_10YEAR>([\d.]+)<\/d:BC_10YEAR>/g)];
  if (!matches.length) return null;
  const last = Number(matches[matches.length - 1][1]);
  return Number.isFinite(last) ? last / 100 : null; // percent -> decimal
}

function createTreasuryProvider({ client, fallback = config.riskFreeRateDefault } = {}) {
  async function getRiskFreeRate(year = new Date().getUTCFullYear()) {
    try {
      const xml = await client.getText(treasuryUrl(year));
      const rate = parseLatest10Year(xml);
      if (rate != null) {
        return { riskFreeRate: rate, source: 'us-treasury:10y-par-yield', year };
      }
    } catch (_) {
      /* fall through to default */
    }
    return { riskFreeRate: fallback, source: 'default', year };
  }

  return { getRiskFreeRate };
}

module.exports = { createTreasuryProvider, parseLatest10Year };
