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
  test('requests the Stooq CSV endpoint and parses the close', async () => {
    let requested = null;
    const client = {
      getText: async (url) => {
        requested = url;
        return 'Symbol,Date,Time,Open,High,Low,Close,Volume\nNFLX.US,2026-05-26,22:00,1,1,1,1234.5,1';
      },
    };
    const provider = createPriceProvider({ client });
    const close = await provider.getClose('NFLX');
    expect(close).toBe(1234.5);
    expect(requested).toContain('nflx.us');
    expect(requested).toContain('e=csv');
  });
});
