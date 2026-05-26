const config = require('./config');

// Pluggable market-data provider for the inputs SEC does not have (beta and
// market capitalisation). Default provider: Alpha Vantage (free API key).
//
// The OVERVIEW endpoint returns Beta and MarketCapitalization directly:
//   https://www.alphavantage.co/query?function=OVERVIEW&symbol=NFLX&apikey=KEY
function createMarketDataProvider({ client, apiKey = config.alphaVantageApiKey, baseUrl = config.alphaVantageBaseUrl } = {}) {
  const configured = Boolean(apiKey);

  async function getOverview(ticker) {
    if (!configured) {
      return { configured: false, beta: null, marketCap: null, source: 'none' };
    }
    const url =
      `${baseUrl}/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}` +
      `&apikey=${encodeURIComponent(apiKey)}`;
    const data = await client.getJson(url);

    // Alpha Vantage signals throttling/errors with a Note/Information field and
    // an otherwise empty object.
    if (!data || data.Note || data.Information || Object.keys(data).length === 0) {
      const reason = (data && (data.Note || data.Information)) || 'no data returned';
      const err = new Error(`Market-data provider error: ${reason}`);
      err.status = 502;
      throw err;
    }

    const beta = data.Beta != null && data.Beta !== 'None' ? Number(data.Beta) : null;
    const marketCap =
      data.MarketCapitalization != null && data.MarketCapitalization !== 'None'
        ? Number(data.MarketCapitalization)
        : null;

    return {
      configured: true,
      provider: config.marketDataProvider,
      beta: Number.isFinite(beta) ? beta : null,
      marketCap: Number.isFinite(marketCap) ? marketCap : null,
      name: data.Name || null,
      source: `${config.marketDataProvider}:OVERVIEW`,
    };
  }

  return { configured, getOverview };
}

module.exports = { createMarketDataProvider };
