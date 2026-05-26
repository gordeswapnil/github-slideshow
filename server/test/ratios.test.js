const { computeRatios, ratiosForPeriod } = require('../src/ratios');
const { normalizeCompanyFacts } = require('../src/normalize');
const { companyfacts } = require('./fixtures/secFixtures');

describe('computeRatios', () => {
  const periods = normalizeCompanyFacts(companyfacts).periods;
  const ratios = computeRatios(periods);
  const byYear = Object.fromEntries(ratios.map((r) => [r.fiscalYear, r]));

  test('one ratio row per period', () => {
    expect(ratios.length).toBe(periods.length);
  });

  test('liquidity and return ratios for FY2024', () => {
    const r = byYear[2024];
    // currentAssets 9000 / currentLiabilities 10000
    expect(r.currentRatio).toBeCloseTo(0.9, 5);
    expect(r.workingCapital).toBe(-1000);
    expect(r.netMargin).toBeCloseTo(8712 / 39000, 4);
    expect(r.returnOnEquity).toBeCloseTo(8712 / 24743, 4);
    expect(r.returnOnAssets).toBeCloseTo(8712 / 53630, 4);
  });

  test('days ratios are null when AR/AP/inventory are not reported', () => {
    const r = byYear[2024];
    expect(r.daysSalesOutstanding).toBeNull();
    expect(r.daysPayablesOutstanding).toBeNull();
    expect(r.cashConversionCycle).toBeNull();
  });
});

describe('ratiosForPeriod days math', () => {
  test('DSO / DPO / CCC compute when the inputs exist', () => {
    const r = ratiosForPeriod({
      fiscalYear: 2024,
      revenue: 36500,
      costOfRevenue: 18250,
      accountsReceivable: 1000,
      accountsPayable: 500,
      inventory: 730,
    });
    expect(r.daysSalesOutstanding).toBeCloseTo((1000 / 36500) * 365, 4); // 10
    expect(r.daysPayablesOutstanding).toBeCloseTo((500 / 18250) * 365, 4); // 10
    expect(r.daysInventoryOutstanding).toBeCloseTo((730 / 18250) * 365, 4); // 14.6
    expect(r.cashConversionCycle).toBeCloseTo(10 + 14.6 - 10, 3);
  });
});
