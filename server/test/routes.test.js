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
  const service = createSecService({
    client,
    // Deterministic stubs so WACC tests don't depend on env/network.
    marketData: {
      configured: false,
      getOverview: async () => ({ configured: false, beta: null, marketCap: null, source: 'none' }),
    },
    treasury: {
      getRiskFreeRate: async () => ({ riskFreeRate: 0.043, source: 'default', year: 2026 }),
    },
  });
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

describe('GET /api/sec/profile', () => {
  test('returns metadata plus a financial snapshot', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/profile?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ticker: 'NFLX', cik: '0001065280', name: 'NETFLIX INC' });
    expect(r.body.snapshot.fiscalYear).toBe(2024);
    expect(typeof r.body.narrative).toBe('string');
  });
});

describe('GET /api/sec/ratios', () => {
  test('returns one ratio set per period', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/ratios?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.ratios.length).toBeGreaterThan(0);
    expect(r.body.ratios[0]).toHaveProperty('currentRatio');
  });
});

describe('GET /api/sec/wacc', () => {
  test('computes WACC from query-param overrides', async () => {
    const app = makeApp();
    const r = await request(app).get(
      '/api/sec/wacc?ticker=NFLX&beta=1.2&marketCap=90000&costOfDebt=0.05&taxRate=0.2&totalDebt=10000&rf=0.04&erp=0.05'
    );
    expect(r.status).toBe(200);
    expect(r.body.inputs.beta).toBe(1.2);
    // Re=0.04+1.2*0.05=0.10 ; afterTaxRd=0.05*0.8=0.04 ; 0.9*0.10+0.1*0.04=0.094
    expect(r.body.wacc).toBeCloseTo(0.094, 5);
    expect(r.body.complete).toBe(true);
  });

  test('still returns (incomplete) when market data is unconfigured', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/wacc?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.meta.marketDataConfigured).toBe(false);
    expect(r.body.missing).toEqual(expect.arrayContaining(['beta', 'marketCap']));
  });
});

describe('GET /api/sec/all-facts', () => {
  test('returns every annual concept for the ticker', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/all-facts?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.cik).toBe('0001065280');
    expect(r.body.conceptCount).toBeGreaterThan(0);
    expect(r.body.concepts.map((c) => c.tag)).toEqual(expect.arrayContaining(['Revenues']));
  });
});

describe('GET /api/sec/fields', () => {
  test('returns curated field metadata without a network call', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/fields');
    expect(r.status).toBe(200);
    expect(r.body.fields.length).toBeGreaterThanOrEqual(40);
    const revenue = r.body.fields.find((f) => f.key === 'revenue');
    expect(revenue).toMatchObject({ statement: 'income', unit: 'USD' });
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
