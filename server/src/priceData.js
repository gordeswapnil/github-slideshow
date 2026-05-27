// Free, no-key latest share price from Stooq (used to derive market cap when no
// market-data API key is configured). Market cap = latest close × shares
// outstanding (the latter from SEC dei data).
//
// Stooq CSV: https://stooq.com/q/l/?s=aapl.us&f=sd2t2ohlcv&h&e=csv
//   Symbol,Date,Time,Open,High,Low,Close,Volume
//
// Stooq can reject unusual User-Agents, so we request it directly with a
// browser-like UA rather than via the SEC client (which sends the SEC UA).

function parseStooqCsv(csv) {
  if (!csv || typeof csv !== 'string') return null;
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const row = lines[1].split(',');
  const idx = header.indexOf('close');
  if (idx === -1) return null;
  const close = Number(row[idx]);
  return Number.isFinite(close) && close > 0 ? close : null;
}

function createPriceProvider({ client, fetchImpl = globalThis.fetch, baseUrl = 'https://stooq.com' } = {}) {
  async function getClose(ticker) {
    const sym = encodeURIComponent(String(ticker).toLowerCase()) + '.us';
    const url = `${baseUrl}/q/l/?s=${sym}&f=sd2t2ohlcv&h&e=csv`;
    let csv;
    if (typeof fetchImpl === 'function') {
      const res = await fetchImpl(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FinancialModellingEducationApp/1.0)',
          Accept: 'text/csv,text/plain,*/*',
        },
      });
      if (!res.ok) return null;
      csv = await res.text();
    } else if (client && client.getText) {
      csv = await client.getText(url);
    } else {
      return null;
    }
    return parseStooqCsv(csv);
  }
  return { getClose, source: 'stooq' };
}

module.exports = { createPriceProvider, parseStooqCsv };
