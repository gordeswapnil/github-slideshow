// Free, no-key latest share price from Stooq (used to derive market cap when no
// market-data API key is configured). Market cap = latest close × shares
// outstanding (the latter from SEC dei data).
//
// Stooq CSV: https://stooq.com/q/l/?s=aapl.us&f=sd2t2ohlcv&h&e=csv
//   Symbol,Date,Time,Open,High,Low,Close,Volume

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

function createPriceProvider({ client, baseUrl = 'https://stooq.com' } = {}) {
  async function getClose(ticker) {
    const sym = encodeURIComponent(String(ticker).toLowerCase()) + '.us';
    const url = `${baseUrl}/q/l/?s=${sym}&f=sd2t2ohlcv&h&e=csv`;
    const csv = await client.getText(url);
    return parseStooqCsv(csv);
  }
  return { getClose, source: 'stooq' };
}

module.exports = { createPriceProvider, parseStooqCsv };
