const request = require('supertest');
const { createApp } = require('../src/app');
const { createSecService, TICKERS_URL } = require('../src/secService');
const { tickers, submissions, companyfacts } = require('./fixtures/secFixtures');
const inlineXbrl = require('./fixtures/inlineXbrl');

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
    getText: jest.fn(async (url) => {
      if (url.includes('/Archives/')) return inlineXbrl;
      throw new Error(`unexpected text url ${url}`);
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
    priceData: { getClose: async () => 250, source: 'stub' },
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

describe('GET /api/sec/balance-sheet', () => {
  test('returns a Schedule III statement per period', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/balance-sheet?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.format).toMatch(/Schedule III/);
    expect(r.body.statements.length).toBeGreaterThan(0);
    const s = r.body.statements[0];
    expect(s.lines.find((l) => l.key === 'asTotal')).toBeTruthy();
    expect(s.lines.find((l) => l.key === 'elTotal')).toBeTruthy();
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

  test('uses industry beta and a free (price x shares) market cap without a key', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/wacc?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.meta.marketDataConfigured).toBe(false);
    // Beta from Damodaran industry beta; market cap derived from 250 x 430M shares.
    expect(r.body.missing).not.toContain('beta');
    expect(r.body.missing).not.toContain('marketCap');
    expect(r.body.beta.industry).toBe('Entertainment'); // SIC 7841
    expect(r.body.beta.deRatioBasis).toMatch(/market/);
    expect(r.body.inputs.marketValueOfEquity).toBe(250 * 430000000);
  });
});

describe('GET /api/sec/business', () => {
  test('extracts the Item 1 Business narrative from the latest 10-K', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/business?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.sourceDocument).toContain('/Archives/edgar/data/1065280/');
    expect(r.body.business.excerpt).toMatch(/SampleCo is a synthetic streaming/);
  });
});

describe('GET /api/sec/segments', () => {
  test('returns revenue grouped by axis/member, merged across filings, with diagnostics', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/sec/segments?ticker=NFLX');
    expect(r.status).toBe(200);
    expect(r.body.accessionNumber).toBe('A-2024');
    expect(r.body.sourceDocument).toContain('/Archives/edgar/data/1065280/');
    expect(r.body.filingsParsed).toBe(2); // two 10-Ks in the fixture
    const product = r.body.axes.find((a) => a.axis === 'srt:ProductOrServiceAxis');
    expect(product).toBeTruthy();
    const streaming = product.members.find((m) => m.member === 'nflx:StreamingRevenuesMember');
    expect(streaming.values['2024']).toBe(38000000 * 1000);
    // diagnostics reveal the multi-axis (product x geography) combination too
    expect(r.body.diagnostics.axesSeen.length).toBeGreaterThan(0);
    expect(r.body.diagnostics.axisCombinations.some((c) => c.axes.includes('+'))).toBe(true);
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
