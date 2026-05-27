// Recast a normalized (US-GAAP) period into the vertical Balance Sheet format of
// Schedule III, Division I of the Companies Act, 2013.
//
// Logic: the SEC-reported control totals are authoritative — Total Assets,
// Current Assets, Total Liabilities, Current Liabilities and Shareholders'
// Equity. Mapped US-GAAP line items are slotted into the Schedule III buckets,
// and a balancing "Other …" line in each group absorbs whatever isn't mapped
// (e.g. a streaming company's content liabilities). This guarantees every
// subtotal and the grand total reconcile, and Total Assets = Total Equity & Liabilities.

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

// Sum that returns null only if every input is null (so 0 + null = 0).
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

// Residual = control - sum(parts); null only when the control total is missing.
function residual(control, parts) {
  if (control == null) return addable(parts);
  return control - (addable(parts) || 0);
}

function computeScheduleIII(period) {
  const v = period || {};
  const totalAssets = num(v.totalAssets);
  const currentAssets = num(v.currentAssets);
  const totalLiabilities = num(v.totalLiabilities);
  const currentLiabilities = num(v.currentLiabilities);
  const equity = num(v.stockholdersEquity);

  const nonCurrentAssets =
    totalAssets != null && currentAssets != null ? totalAssets - currentAssets : null;
  const nonCurrentLiabilities =
    totalLiabilities != null && currentLiabilities != null
      ? totalLiabilities - currentLiabilities
      : null;

  // Assets
  const ppe = num(v.propertyPlantEquipmentNet);
  const intangibles = num(v.intangibleAssets);
  const goodwill = num(v.goodwill);
  const otherNonCurrentAssets = residual(nonCurrentAssets, [ppe, intangibles, goodwill]);

  const cash = num(v.cashAndEquivalents);
  const currentInvestments = num(v.shortTermInvestments);
  const inventories = num(v.inventory);
  const receivables = num(v.accountsReceivable);
  const otherCurrentAssets = residual(currentAssets, [cash, currentInvestments, inventories, receivables]);

  // Equity & Liabilities
  const shareCapital = addable([num(v.commonStockValue), num(v.additionalPaidInCapital)]);
  const reservesTotal = equity != null ? equity - (shareCapital || 0) : null;
  const retained = num(v.retainedEarnings);
  const treasury = num(v.treasuryStock);
  const aoci = num(v.accumulatedOCI);
  const otherReserves = residual(reservesTotal, [retained, treasury, aoci]);

  const longTermBorrowings = num(v.longTermDebt);
  const deferredTax = num(v.deferredTaxLiabilities);
  const otherLongTermLiabilities = residual(nonCurrentLiabilities, [longTermBorrowings, deferredTax]);

  const shortTermBorrowings = num(v.shortTermDebt);
  const tradePayables = num(v.accountsPayable);
  const otherCurrentLiabilities = residual(currentLiabilities, [shortTermBorrowings, tradePayables]);

  const totalEquityAndLiabilities = addable([equity, totalLiabilities]);
  const difference =
    totalAssets != null && totalEquityAndLiabilities != null
      ? totalAssets - totalEquityAndLiabilities
      : null;
  // Tolerate rounding / minority-interest noise up to 0.5% of assets.
  const balances =
    difference == null ? null : Math.abs(difference) <= Math.max(1, Math.abs(totalAssets || 0) * 0.005);

  const L = (key, label, kind, level, value) => ({ key, label, kind, level, value });

  const lines = [
    L('el', 'I. EQUITY AND LIABILITIES', 'header', 0, null),
    L('sf', '(1) Shareholders’ Funds', 'header', 1, null),
    L('shareCapital', '(a) Share Capital', 'item', 2, shareCapital),
    L('reserves', '(b) Reserves & Surplus', 'item', 2, reservesTotal),
    L('retained', 'Retained earnings', 'sub', 3, retained),
    L('treasury', 'Treasury stock', 'sub', 3, treasury),
    L('aoci', 'Other comprehensive income', 'sub', 3, aoci),
    L('otherReserves', 'Other reserves (balancing)', 'sub', 3, otherReserves),
    L('sfTotal', 'Total Shareholders’ Funds', 'subtotal', 1, equity),
    L('ncl', '(2) Non-Current Liabilities', 'header', 1, null),
    L('longTermBorrowings', '(a) Long-term borrowings', 'item', 2, longTermBorrowings),
    L('deferredTax', '(b) Deferred tax liabilities (net)', 'item', 2, deferredTax),
    L('otherLongTermLiabilities', '(c) Other long-term liabilities & provisions', 'item', 2, otherLongTermLiabilities),
    L('nclTotal', 'Total Non-Current Liabilities', 'subtotal', 1, nonCurrentLiabilities),
    L('cl', '(3) Current Liabilities', 'header', 1, null),
    L('shortTermBorrowings', '(a) Short-term borrowings', 'item', 2, shortTermBorrowings),
    L('tradePayables', '(b) Trade payables', 'item', 2, tradePayables),
    L('otherCurrentLiabilities', '(c) Other current liabilities & provisions', 'item', 2, otherCurrentLiabilities),
    L('clTotal', 'Total Current Liabilities', 'subtotal', 1, currentLiabilities),
    L('elTotal', 'TOTAL EQUITY AND LIABILITIES', 'grandtotal', 0, totalEquityAndLiabilities),

    L('as', 'II. ASSETS', 'header', 0, null),
    L('nca', '(1) Non-Current Assets', 'header', 1, null),
    L('ppe', '(a) Property, Plant & Equipment', 'item', 2, ppe),
    L('intangibles', '(b) Intangible assets', 'item', 2, intangibles),
    L('goodwill', '(c) Goodwill', 'item', 2, goodwill),
    L('otherNonCurrentAssets', '(d) Other non-current assets', 'item', 2, otherNonCurrentAssets),
    L('ncaTotal', 'Total Non-Current Assets', 'subtotal', 1, nonCurrentAssets),
    L('ca', '(2) Current Assets', 'header', 1, null),
    L('currentInvestments', '(a) Current investments', 'item', 2, currentInvestments),
    L('inventories', '(b) Inventories', 'item', 2, inventories),
    L('receivables', '(c) Trade receivables', 'item', 2, receivables),
    L('cash', '(d) Cash & cash equivalents', 'item', 2, cash),
    L('otherCurrentAssets', '(e) Other current assets', 'item', 2, otherCurrentAssets),
    L('caTotal', 'Total Current Assets', 'subtotal', 1, currentAssets),
    L('asTotal', 'TOTAL ASSETS', 'grandtotal', 0, totalAssets),
  ];

  return {
    fiscalYear: v.fiscalYear,
    lines,
    totalAssets,
    totalEquityAndLiabilities,
    difference,
    balances,
  };
}

module.exports = { buildScheduleIII: computeScheduleIII };
