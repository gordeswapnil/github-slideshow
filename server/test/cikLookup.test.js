const { padCik, cikUrlParam, findTickerEntry } = require('../src/cikLookup');
const { tickers } = require('./fixtures/secFixtures');

describe('padCik', () => {
  test('pads a numeric CIK to 10 digits', () => {
    expect(padCik(1065280)).toBe('0001065280');
  });

  test('accepts a string CIK', () => {
    expect(padCik('320193')).toBe('0000320193');
  });

  test('leaves an already-padded CIK unchanged', () => {
    expect(padCik('0001065280')).toBe('0001065280');
  });

  test('strips non-digit characters', () => {
    expect(padCik('CIK0001065280')).toBe('0001065280');
  });

  test('throws on a non-numeric CIK', () => {
    expect(() => padCik('abc')).toThrow();
  });
});

describe('cikUrlParam', () => {
  test('produces the data.sec.gov path segment', () => {
    expect(cikUrlParam(1065280)).toBe('CIK0001065280');
  });
});

describe('findTickerEntry', () => {
  test('finds a ticker case-insensitively', () => {
    expect(findTickerEntry(tickers, 'nflx')).toMatchObject({ cik_str: 1065280, ticker: 'NFLX' });
  });

  test('returns null for an unknown ticker', () => {
    expect(findTickerEntry(tickers, 'NOPE')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(findTickerEntry(tickers, '')).toBeNull();
    expect(findTickerEntry(null, 'NFLX')).toBeNull();
  });
});
