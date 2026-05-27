// Loads configuration from the environment. dotenv is optional so the server
// (and the tests) still run if it has not been installed.
try {
  // eslint-disable-next-line global-require
  require('dotenv').config();
} catch (_) {
  /* dotenv is an optional convenience dependency */
}

const contactEmail = process.env.SEC_CONTACT_EMAIL || 'gordeswapnil@gmail.com';
const appName = process.env.SEC_APP_NAME || 'FinancialModellingEducationApp';

module.exports = {
  port: Number(process.env.PORT) || 5050,
  contactEmail,
  appName,
  // SEC fair-access policy requires a descriptive User-Agent that identifies
  // the application and a contact address. The email is env-driven so it can
  // be replaced without code changes.
  userAgent: `${appName} ${contactEmail}`,
  acceptEncoding: 'gzip, deflate',
  // Cache SEC responses to avoid repeatedly hitting their servers for the same
  // ticker. Defaults to 24h since 10-K data changes at most a few times a year.
  cacheTtlMs: Number(process.env.SEC_CACHE_TTL_MS) || 24 * 60 * 60 * 1000,
  // SEC allows up to 10 requests/second. We stay at or below this.
  maxRequestsPerSecond: Number(process.env.SEC_MAX_RPS) || 10,
  maxRetries: Number(process.env.SEC_MAX_RETRIES) || 4,
  baseBackoffMs: Number(process.env.SEC_BASE_BACKOFF_MS) || 500,

  // ---- WACC / market data (non-SEC) -------------------------------------
  // Beta and market capitalisation are not in SEC data. They come from a
  // pluggable market-data provider (default: Alpha Vantage). Get a free key at
  // https://www.alphavantage.co/support/#api-key and set ALPHAVANTAGE_API_KEY.
  marketDataProvider: process.env.MARKET_DATA_PROVIDER || 'alphavantage',
  alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY || '',
  alphaVantageBaseUrl: process.env.ALPHAVANTAGE_BASE_URL || 'https://www.alphavantage.co',

  // Risk-free rate: pulled free (no key) from the US Treasury par-yield feed,
  // with a sensible fallback if the feed is unreachable. Override per-request.
  riskFreeRateDefault: Number(process.env.RISK_FREE_RATE) || 0.043,
  // Equity risk premium is a market assumption, not a data point.
  equityRiskPremiumDefault: Number(process.env.EQUITY_RISK_PREMIUM) || 0.055,
};
