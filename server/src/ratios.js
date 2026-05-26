// Working-capital and liquidity ratios derived from the normalized periods.
// Pure computation — no external data.

const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);

// Days ratios use the absolute value of COGS, which SEC may report as a
// positive expense.
const daysOf = (balance, flow) => {
  if (balance == null || flow == null || flow === 0) return null;
  return (balance / Math.abs(flow)) * 365;
};

function ratiosForPeriod(p) {
  const totalDebt = (p.shortTermDebt || 0) + (p.longTermDebt || 0) || null;
  const dso = daysOf(p.accountsReceivable, p.revenue);
  const dpo = daysOf(p.accountsPayable, p.costOfRevenue);
  const dio = daysOf(p.inventory, p.costOfRevenue);
  const ccc =
    dso == null && dio == null && dpo == null ? null : (dso || 0) + (dio || 0) - (dpo || 0);

  return {
    fiscalYear: p.fiscalYear,
    // liquidity
    currentRatio: div(p.currentAssets, p.currentLiabilities),
    quickRatio: div(
      p.currentAssets != null ? p.currentAssets - (p.inventory || 0) : null,
      p.currentLiabilities
    ),
    workingCapital:
      p.currentAssets != null && p.currentLiabilities != null
        ? p.currentAssets - p.currentLiabilities
        : null,
    // working-capital efficiency (days)
    daysSalesOutstanding: dso,
    daysPayablesOutstanding: dpo,
    daysInventoryOutstanding: dio,
    cashConversionCycle: ccc,
    // leverage
    debtToEquity: div(totalDebt, p.stockholdersEquity),
    debtToAssets: div(totalDebt, p.totalAssets),
    interestCoverage: div(p.operatingIncome, p.interestExpense),
    // returns
    netMargin: div(p.netIncome, p.revenue),
    returnOnEquity: div(p.netIncome, p.stockholdersEquity),
    returnOnAssets: div(p.netIncome, p.totalAssets),
  };
}

function computeRatios(periods) {
  return (periods || []).map(ratiosForPeriod);
}

module.exports = { computeRatios, ratiosForPeriod };
