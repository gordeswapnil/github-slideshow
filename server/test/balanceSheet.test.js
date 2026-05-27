const { buildScheduleIII } = require('../src/balanceSheet');

const lineValue = (s, key) => s.lines.find((l) => l.key === key).value;

describe('buildScheduleIII', () => {
  // A balanced, fully-mapped period.
  const period = {
    fiscalYear: 2024,
    totalAssets: 1000, currentAssets: 400, totalLiabilities: 600, currentLiabilities: 250,
    stockholdersEquity: 400,
    cashAndEquivalents: 300, shortTermInvestments: 50,
    propertyPlantEquipmentNet: 200, intangibleAssets: 100,
    longTermDebt: 300, accountsPayable: 100, shortTermDebt: 50,
    commonStockValue: 120, retainedEarnings: 300, treasuryStock: -20, accumulatedOCI: 0,
  };
  const s = buildScheduleIII(period);

  test('balances: Total Assets = Total Equity and Liabilities', () => {
    expect(lineValue(s, 'asTotal')).toBe(1000);
    expect(lineValue(s, 'elTotal')).toBe(1000);
    expect(s.balances).toBe(true);
    expect(s.difference).toBe(0);
  });

  test('residual "Other" lines absorb unmapped amounts so groups reconcile', () => {
    // Non-current assets = 1000-400 = 600; mapped 200+100 -> other 300
    expect(lineValue(s, 'otherNonCurrentAssets')).toBe(300);
    // Current assets = 400; mapped 300+50 -> other 50
    expect(lineValue(s, 'otherCurrentAssets')).toBe(50);
    // Non-current liab = 600-250 = 350; mapped 300 -> other 50
    expect(lineValue(s, 'otherLongTermLiabilities')).toBe(50);
    // Current liab = 250; mapped 50+100 -> other 100
    expect(lineValue(s, 'otherCurrentLiabilities')).toBe(100);
  });

  test('splits equity into share capital and reserves', () => {
    expect(lineValue(s, 'shareCapital')).toBe(120);
    expect(lineValue(s, 'reserves')).toBe(280); // 400 - 120
    expect(lineValue(s, 'otherReserves')).toBe(0); // 280 - (300 - 20 + 0)
    expect(lineValue(s, 'sfTotal')).toBe(400);
  });

  test('subtotals tie to the SEC control totals', () => {
    expect(lineValue(s, 'ncaTotal')).toBe(600);
    expect(lineValue(s, 'caTotal')).toBe(400);
    expect(lineValue(s, 'nclTotal')).toBe(350);
    expect(lineValue(s, 'clTotal')).toBe(250);
  });

  test('handles missing control totals without throwing', () => {
    const sparse = buildScheduleIII({ fiscalYear: 2024, totalAssets: 500, cashAndEquivalents: 100 });
    expect(sparse.lines.length).toBeGreaterThan(0);
    expect(lineValue(sparse, 'asTotal')).toBe(500);
  });
});
