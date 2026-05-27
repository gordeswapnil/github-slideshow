const { parseStooqCsv, createPriceProvider } = require('../src/priceData');

describe('parseStooqCsv', () => {
  test('extracts the close price', () => {
    const csv = 'Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-05-26,22:00:05,270,275,269,272.5,40000000';
    expect(parseStooqCsv(csv)).toBe(272.5);
  });
  test('returns null for N/D or malformed data', () => {
    expect(parseStooqCsv('Symbol,Date,Time,Open,High,Low,Close,Volume\nFOO.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D')).toBeNull();
    expect(parseStooqCsv('')).toBeNull();
    expect(parseStooqCsv('no header')).toBeNull();
  });
});

describe('createPriceProvider', () => {
  test('requests the Stooq CSV endpoint with a browser UA and parses the close', async () => {
    let requested = null;
    let ua = null;
    const fetchImpl = async (url, opts) => {
      requested = url;
      ua = opts.headers['User-Agent'];
      return { ok: true, text: async () => 'Symbol,Date,Time,Open,High,Low,Close,Volume\nNFLX.US,2026-05-26,22:00,1,1,1,1234.5,1' };
    };
    const provider = createPriceProvider({ fetchImpl });
    const close = await provider.getClose('NFLX');
    expect(close).toBe(1234.5);
    expect(requested).toContain('nflx.us');
    expect(requested).toContain('e=csv');
    expect(ua).toMatch(/Mozilla/);
  });

  test('returns null on a non-OK response', async () => {
    const provider = createPriceProvider({ fetchImpl: async () => ({ ok: false, text: async () => '' }) });
    expect(await provider.getClose('NFLX')).toBeNull();
  });
});
