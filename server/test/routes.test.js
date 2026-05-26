const request = require('supertest');
const { createApp } = require('../src/app');
const { createSecService, TICKERS_URL } = require('../src/secService');
const { tickers, submissions, companyfacts } = require('./fixtures/secFixtures');

// Fake SEC client that serves fixtures based on the requested URL.
function makeApp() {
  const client = {
    getJson: jest.fn(async (url) => {
      if (url === TICKERS_URL) return tickers;
      if (url.includes('/submissions/')) return submissions;
      if (url.includes('/companyfacts/')) return companyfacts;
      const err = new Error(`unexpected url ${url}`);
      err.status = 404;
      throw err;
    }),
  };
  const service = createSecService({ client });
  return createApp({ service });
}

describe('GET /api/sec/company', () => {
  test('returns CIK, name, tickers and exchange', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/company?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ticker: 'NFLX',
      cik: '0001065280',
      companyName: 'NETFLIX INC',
      tickers: ['NFLX'],
      exchanges: ['NASDAQ'],
    });
  });

  test('is case-insensitive on the ticker', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/company?ticker=nflx');
    expect(r.status).toBe(200);
    expect(r.body.cik).toBe('0001065280');
  });
});

describe('GET /api/sec/companyfacts', () => {
  test('returns wrapped raw companyfacts', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/companyfacts?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.cik).toBe('0001065280');
    expect(r.body.facts.facts['us-gaap'].Revenues).toBeDefined();
  });
});

describe('GET /api/sec/model-data', () => {
  test('returns normalized annual data', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/model-data?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.ticker).toBe('NFLX');
    expect(r.body.periods.map((p) => p.fiscalYear)).toEqual([2024, 2023, 2022]);
  });

  test('honors the years parameter', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/model-data?ticker=NFLX&years=2');
    expect(r.status).toBe(200);
    expect(r.body.periods).toHaveLength(2);
    expect(r.body.periods[0].fiscalYear).toBe(2024);
  });
});

describe('error handling', () => {
  test('400 when ticker is missing', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/model-data');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/ticker/i);
  });

  test('400 on a malformed ticker', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/company?ticker=not a ticker!');
    expect(r.status).toBe(400);
  });

  test('404 for an unknown ticker', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/company?ticker=ZZZZ');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/no sec cik/i);
  });

  test('404 for an unknown API route', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/nope');
    expect(r.status).toBe(404);
  });
});
