// WACC computation.
//
//   WACC = (E/V) * Re + (D/V) * Rd * (1 - Tc)
//   Re   = Rf + Beta * ERP                (CAPM cost of equity)
//
// SEC supplies: cost of debt (interest / debt), effective tax rate, book debt.
// Market data supplies: beta, market value of equity (market cap).
// Treasury supplies: risk-free rate. ERP is an assumption.
//
// Every input is overridable so students can apply their own assumptions.

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Effective tax rate, clamped to a sane 0–50% band.
function effectiveTaxRate(period) {
  const tax = num(period.incomeTaxExpense);
  const pretax = num(period.pretaxIncome);
  if (tax == null || pretax == null || pretax === 0) return null;
  const rate = tax / pretax;
  if (!Number.isFinite(rate)) return null;
  return Math.min(Math.max(rate, 0), 0.5);
}

function computeWacc({ period, beta, marketCap, bookEquity, riskFreeRate, equityRiskPremium, overrides = {} }) {
  const o = overrides;

  const totalDebtBook = (num(period.shortTermDebt) || 0) + (num(period.longTermDebt) || 0) || null;
  const totalDebt = num(o.totalDebt) != null ? o.totalDebt : totalDebtBook;
  const interestExpense = num(period.interestExpense);

  const costOfDebtPreTax =
    num(o.costOfDebt) != null
      ? o.costOfDebt
      : interestExpense != null && totalDebt
        ? interestExpense / totalDebt
        : null;

  const taxRate = num(o.taxRate) != null ? o.taxRate : effectiveTaxRate(period);
  const rf = num(o.riskFreeRate) != null ? o.riskFreeRate : num(riskFreeRate);
  const b = num(o.beta) != null ? o.beta : num(beta);
  const erp = num(o.equityRiskPremium) != null ? o.equityRiskPremium : num(equityRiskPremium);
  // Equity value for the weight: true market cap if available, else fall back to
  // book equity so WACC still computes (flagged via equityBasis).
  const trueMarketCap = num(o.marketCap) != null ? o.marketCap : num(marketCap);
  const equityMV = trueMarketCap != null ? trueMarketCap : num(bookEquity);
  const equityBasis = trueMarketCap != null ? 'market' : num(bookEquity) != null ? 'book' : null;

  const costOfEquity = rf != null && b != null && erp != null ? rf + b * erp : null;
  const afterTaxCostOfDebt =
    costOfDebtPreTax != null && taxRate != null ? costOfDebtPreTax * (1 - taxRate) : null;

  let weightEquity = null;
  let weightDebt = null;
  let wacc = null;
  if (equityMV != null && totalDebt != null && equityMV + totalDebt > 0) {
    const v = equityMV + totalDebt;
    weightEquity = equityMV / v;
    weightDebt = totalDebt / v;
    if (costOfEquity != null && afterTaxCostOfDebt != null) {
      wacc = weightEquity * costOfEquity + weightDebt * afterTaxCostOfDebt;
    }
  }

  const missing = [];
  if (b == null) missing.push('beta');
  if (equityMV == null) missing.push('equity');
  if (rf == null) missing.push('riskFreeRate');
  if (erp == null) missing.push('equityRiskPremium');
  if (costOfDebtPreTax == null) missing.push('costOfDebt');
  if (taxRate == null) missing.push('taxRate');

  return {
    wacc,
    components: {
      costOfEquity,
      costOfDebtPreTax,
      afterTaxCostOfDebt,
      taxRate,
      weightEquity,
      weightDebt,
    },
    inputs: {
      fiscalYear: period.fiscalYear,
      beta: b,
      riskFreeRate: rf,
      equityRiskPremium: erp,
      marketValueOfEquity: trueMarketCap,
      equityUsed: equityMV,
      equityBasis,
      totalDebt,
      interestExpense,
    },
    sources: {
      beta: 'market-data',
      marketValueOfEquity: 'market-data',
      riskFreeRate: 'us-treasury',
      equityRiskPremium: 'assumption',
      costOfDebt: 'sec (interestExpense / totalDebt)',
      taxRate: 'sec (incomeTaxExpense / pretaxIncome)',
      totalDebt: 'sec (book: short-term + long-term debt)',
    },
    missing,
    complete: missing.length === 0 && wacc != null,
  };
}

module.exports = { computeWacc, effectiveTaxRate };
