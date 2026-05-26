// Ticker <-> CIK helpers.

// SEC CIKs are numeric but the JSON APIs expect them zero-padded to 10 digits,
// e.g. 1065280 -> "0001065280".
function padCik(cik) {
  const digits = String(cik).replace(/\D/g, '');
  if (!digits) {
    throw new Error(`Invalid CIK: ${cik}`);
  }
  return digits.padStart(10, '0');
}

// The data.sec.gov path segment, e.g. 1065280 -> "CIK0001065280".
function cikUrlParam(cik) {
  return `CIK${padCik(cik)}`;
}

// company_tickers.json is keyed by an arbitrary index:
// { "0": { "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." }, ... }
function findTickerEntry(mapping, ticker) {
  const target = String(ticker).trim().toUpperCase();
  if (!target) return null;
  for (const entry of Object.values(mapping || {})) {
    if (entry && String(entry.ticker).toUpperCase() === target) {
      return entry;
    }
  }
  return null;
}

module.exports = { padCik, cikUrlParam, findTickerEntry };
