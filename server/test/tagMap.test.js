const TAG_MAP = require('../src/tagMap');

describe('tagMap', () => {
  test('revenue has primary tag and fallback', () => {
    expect(TAG_MAP.revenue.tags).toEqual([
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

  test('all required modelling fields are mapped', () => {
    const expected = [
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
    expect(Object.keys(TAG_MAP)).toEqual(expected);
  });

  test('every field has at least one tag and a unit', () => {
    for (const [field, def] of Object.entries(TAG_MAP)) {
      expect(Array.isArray(def.tags)).toBe(true);
      expect(def.tags.length).toBeGreaterThan(0);
      expect(typeof def.unit).toBe('string');
    }
  });
});
