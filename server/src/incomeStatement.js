// Recast a normalized (US-GAAP) period into the vertical Statement of Profit &
// Loss of Schedule III, Division I, Part II of the Companies Act, 2013.
//
// US-GAAP statements use FUNCTIONAL classification (cost of revenue, R&D, SG&A);
// Schedule III uses NATURAL heads (materials, finance costs, other expenses).
// We anchor on Profit Before Tax (authoritative), build:
//   Total Income   = Revenue from operations + Other income
//   Total Expenses = Total Income − Profit Before Tax        (reconciling)
// then list the separable natural heads (cost of revenue, finance costs) and let
// "Other expenses" absorb the rest (operating expenses, D&A embedded in them,
// employee benefits, etc.). Guarantees Total Income − Total Expenses = PBT.

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function addable(values) {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (v != null) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

function computeScheduleIIIPL(period) {
  const v = period || {};

  const revenue = num(v.revenue);
  const otherIncome = addable([num(v.interestIncome), num(v.otherIncomeExpense)]);
  const totalIncome = addable([revenue, otherIncome]);

  // PBT control total: prefer the reported pre-tax income; else net income + tax.
  let pbt = num(v.pretaxIncome);
  if (pbt == null && num(v.netIncome) != null && num(v.incomeTaxExpense) != null) {
    pbt = v.netIncome + v.incomeTaxExpense;
  }

  const totalExpenses = totalIncome != null && pbt != null ? totalIncome - pbt : null;
  const costOfRevenue = num(v.costOfRevenue);
  const financeCosts = num(v.interestExpense);
  const otherExpenses =
    totalExpenses != null ? totalExpenses - (addable([costOfRevenue, financeCosts]) || 0) : null;

  const totalTax = num(v.incomeTaxExpense);
  const deferredTax = num(v.deferredIncomeTaxes);
  const currentTax = totalTax != null ? totalTax - (deferredTax || 0) : null;

  const profitAfterTax = pbt != null && totalTax != null ? pbt - totalTax : null;
  const netIncome = num(v.netIncome);
  // Plug for minority interest / discontinued ops so PAT + this = net income.
  const otherItems = netIncome != null && profitAfterTax != null ? netIncome - profitAfterTax : null;

  const epsBasic = num(v.epsBasic);
  const epsDiluted = num(v.dilutedEPS);

  const difference =
    totalIncome != null && totalExpenses != null && pbt != null
      ? totalIncome - totalExpenses - pbt
      : null;
  const balances = difference == null ? null : Math.abs(difference) <= 1;

  const L = (key, label, kind, level, value, unit = 'USD') => ({ key, label, kind, level, value, unit });

  const lines = [
    L('rev', 'I. Revenue from operations', 'item', 1, revenue),
    L('oi', 'II. Other income', 'item', 1, otherIncome),
    L('ti', 'III. Total Income (I + II)', 'subtotal', 0, totalIncome),
    L('exp', 'IV. Expenses', 'header', 1, null),
    L('cor', 'Cost of revenue / materials & services', 'item', 2, costOfRevenue),
    L('fc', 'Finance costs', 'item', 2, financeCosts),
    L('oe', 'Other expenses (operating & unmapped)', 'item', 2, otherExpenses),
    L('te', 'Total Expenses', 'subtotal', 1, totalExpenses),
    L('pbt', 'V. Profit Before Tax (III − IV)', 'subtotal', 0, pbt),
    L('tax', 'VI. Tax expense', 'header', 1, null),
    L('ct', '(1) Current tax', 'item', 2, currentTax),
    L('dt', '(2) Deferred tax', 'item', 2, deferredTax),
    L('tt', 'Total tax expense', 'subtotal', 1, totalTax),
    L('pat', 'VII. Profit After Tax (V − VI)', 'subtotal', 0, profitAfterTax),
    L('oth', 'VIII. Other items (NCI, discontinued ops)', 'item', 1, otherItems),
    L('pfp', 'IX. Profit for the period', 'grandtotal', 0, netIncome),
    L('eps', 'X. Earnings per equity share', 'header', 1, null),
    L('epsb', '(1) Basic', 'item', 2, epsBasic, 'USD/shares'),
    L('epsd', '(2) Diluted', 'item', 2, epsDiluted, 'USD/shares'),
  ];

  return { fiscalYear: v.fiscalYear, lines, difference, balances };
}

module.exports = { buildScheduleIIIPL: computeScheduleIIIPL };
