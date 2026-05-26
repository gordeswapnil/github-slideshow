const TAG_MAP = require('../src/tagMap');

describe('tagMap', () => {
  test('revenue has primary tag and fallback', () => {
    expect(TAG_MAP.revenue.tags.slice(0, 2)).toEqual([
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
    ]);
  });

  test('costOfRevenue falls back to CostOfGoodsAndServicesSold', () => {
    expect(TAG_MAP.costOfRevenue.tags).toContain('CostOfGoodsAndServicesSold');
  });

  test('EPS and shares use non-USD units', () => {
    expect(TAG_MAP.dilutedEPS.unit).toBe('USD/shares');
    expect(TAG_MAP.dilutedShares.unit).toBe('shares');
  });

  test('all original headline fields remain mapped', () => {
    const required = [
      'revenue',
      'costOfRevenue',
      'grossProfit',
      'operatingIncome',
      'netIncome',
      'totalAssets',
      'currentAssets',
      'cashAndEquivalents',
      'totalLiabilities',
      'stockholdersEquity',
      'operatingCashFlow',
      'capitalExpenditure',
      'dilutedEPS',
      'dilutedShares',
    ];
    expect(Object.keys(TAG_MAP)).toEqual(expect.arrayContaining(required));
  });

  test('expanded into a full three-statement model', () => {
    expect(Object.keys(TAG_MAP).length).toBeGreaterThanOrEqual(40);
    const statements = new Set(Object.values(TAG_MAP).map((d) => d.statement));
    expect(statements).toEqual(new Set(['income', 'pershare', 'balance', 'cashflow']));
  });

  test('every field has tags, a unit, a label and a statement', () => {
    for (const def of Object.values(TAG_MAP)) {
      expect(Array.isArray(def.tags)).toBe(true);
      expect(def.tags.length).toBeGreaterThan(0);
      expect(typeof def.unit).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(['income', 'pershare', 'balance', 'cashflow']).toContain(def.statement);
    }
  });
});
