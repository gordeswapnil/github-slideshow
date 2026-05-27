const { buildScheduleIIIPL } = require('../src/incomeStatement');

const val = (s, key) => s.lines.find((l) => l.key === key).value;

describe('buildScheduleIIIPL', () => {
  const period = {
    fiscalYear: 2024,
    revenue: 1000, interestIncome: 20, otherIncomeExpense: 10,
    pretaxIncome: 300, costOfRevenue: 500, interestExpense: 30,
    incomeTaxExpense: 60, deferredIncomeTaxes: 10, netIncome: 240,
    epsBasic: 2.4, dilutedEPS: 2.35,
  };
  const s = buildScheduleIIIPL(period);

  test('Total Income − Total Expenses reconciles to Profit Before Tax', () => {
    expect(val(s, 'ti')).toBe(1030); // 1000 + 30 other income
    expect(val(s, 'te')).toBe(730); // 1030 − 300
    expect(val(s, 'pbt')).toBe(300);
    expect(s.balances).toBe(true);
  });

  test('Other expenses absorb the functional operating costs', () => {
    // 730 total − 500 cost of revenue − 30 finance costs = 200
    expect(val(s, 'oe')).toBe(200);
  });

  test('splits tax into current and deferred', () => {
    expect(val(s, 'dt')).toBe(10);
    expect(val(s, 'ct')).toBe(50); // 60 − 10
    expect(val(s, 'tt')).toBe(60);
  });

  test('flows PBT → PAT → profit for the period', () => {
    expect(val(s, 'pat')).toBe(240); // 300 − 60
    expect(val(s, 'oth')).toBe(0); // 240 − 240
    expect(val(s, 'pfp')).toBe(240);
  });

  test('EPS lines are per-share', () => {
    const epsb = s.lines.find((l) => l.key === 'epsb');
    expect(epsb.value).toBe(2.4);
    expect(epsb.unit).toBe('USD/shares');
  });

  test('falls back to net income + tax when PBT is not reported', () => {
    const s2 = buildScheduleIIIPL({ fiscalYear: 2024, revenue: 100, netIncome: 60, incomeTaxExpense: 15 });
    expect(val(s2, 'pbt')).toBe(75);
  });
});
