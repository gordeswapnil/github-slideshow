const { computeWacc, effectiveTaxRate } = require('../src/wacc');
const { parseLatest10Year } = require('../src/treasury');
const { createMarketDataProvider } = require('../src/marketData');

const basePeriod = {
  fiscalYear: 2024,
  shortTermDebt: 1000,
  longTermDebt: 9000,
  interestExpense: 500,
  incomeTaxExpense: 200,
  pretaxIncome: 1000,
};

describe('effectiveTaxRate', () => {
  test('computes and clamps to 0–50%', () => {
    expect(effectiveTaxRate({ incomeTaxExpense: 200, pretaxIncome: 1000 })).toBeCloseTo(0.2, 5);
    expect(effectiveTaxRate({ incomeTaxExpense: 600, pretaxIncome: 1000 })).toBe(0.5);
    expect(effectiveTaxRate({ incomeTaxExpense: 200, pretaxIncome: 0 })).toBeNull();
  });
});

describe('computeWacc', () => {
  test('full computation', () => {
    const r = computeWacc({
      period: basePeriod,
      beta: 1.2,
      marketCap: 90000,
      riskFreeRate: 0.04,
      equityRiskPremium: 0.05,
    });
    // Re = 0.04 + 1.2*0.05 = 0.10 ; after-tax Rd = 0.05*(1-0.2)=0.04
    // E/V=0.9, D/V=0.1 -> 0.9*0.10 + 0.1*0.04 = 0.094
    expect(r.components.costOfEquity).toBeCloseTo(0.1, 6);
    expect(r.components.afterTaxCostOfDebt).toBeCloseTo(0.04, 6);
    expect(r.components.weightEquity).toBeCloseTo(0.9, 6);
    expect(r.wacc).toBeCloseTo(0.094, 6);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  test('overrides take precedence over fetched inputs', () => {
    const r = computeWacc({
      period: basePeriod,
      beta: 1.2,
      marketCap: 90000,
      riskFreeRate: 0.04,
      equityRiskPremium: 0.05,
      overrides: { beta: 2.0 },
    });
    // Re = 0.04 + 2*0.05 = 0.14 -> 0.9*0.14 + 0.1*0.04 = 0.13
    expect(r.inputs.beta).toBe(2.0);
    expect(r.wacc).toBeCloseTo(0.13, 6);
  });

  test('reports missing inputs and returns null wacc when incomplete', () => {
    const r = computeWacc({
      period: { fiscalYear: 2024 },
      riskFreeRate: 0.04,
      equityRiskPremium: 0.05,
    });
    expect(r.wacc).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(['beta', 'marketCap', 'costOfDebt']));
  });
});

describe('treasury parseLatest10Year', () => {
  test('extracts the most recent 10-year rate as a decimal', () => {
    const xml =
      '<feed><entry><content><m:properties>' +
      '<d:BC_10YEAR>4.10</d:BC_10YEAR></m:properties></content></entry>' +
      '<entry><content><m:properties>' +
      '<d:BC_10YEAR>4.32</d:BC_10YEAR></m:properties></content></entry></feed>';
    expect(parseLatest10Year(xml)).toBeCloseTo(0.0432, 6);
  });

  test('returns null when no rate is present', () => {
    expect(parseLatest10Year('<feed></feed>')).toBeNull();
  });
});

describe('marketData provider (Alpha Vantage)', () => {
  test('parses Beta and MarketCapitalization from OVERVIEW', async () => {
    const client = {
      getJson: async () => ({ Name: 'Netflix Inc', Beta: '1.28', MarketCapitalization: '350000000000' }),
    };
    const provider = createMarketDataProvider({ client, apiKey: 'TESTKEY' });
    const o = await provider.getOverview('NFLX');
    expect(o).toMatchObject({ configured: true, beta: 1.28, marketCap: 350000000000 });
  });

  test('is a no-op when no API key is configured', async () => {
    const provider = createMarketDataProvider({ client: {}, apiKey: '' });
    expect(provider.configured).toBe(false);
    const o = await provider.getOverview('NFLX');
    expect(o).toMatchObject({ configured: false, beta: null, marketCap: null });
  });

  test('throws on a throttling Note', async () => {
    const client = { getJson: async () => ({ Note: 'rate limit' }) };
    const provider = createMarketDataProvider({ client, apiKey: 'TESTKEY' });
    await expect(provider.getOverview('NFLX')).rejects.toThrow(/Market-data provider/);
  });
});
