// Builds a student-facing company profile from SEC submissions metadata plus a
// financial snapshot computed from the normalized model data. No data beyond
// what SEC already provides.

function pct(numerator, denominator) {
  if (numerator == null || !denominator) return null;
  return numerator / denominator;
}

function fmtBillions(v) {
  if (v == null) return 'n/a';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}M`;
  return `${sign}$${a}`;
}

function fmtPct(v) {
  return v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}

// Per-period financial highlights from the normalized periods (newest first).
function buildSnapshot(periods) {
  if (!periods || !periods.length) return null;
  const latest = periods[0];
  const prior = periods[1] || null;

  const totalDebt =
    (latest.shortTermDebt || 0) + (latest.longTermDebt || 0) || null;
  const freeCashFlow =
    latest.operatingCashFlow != null && latest.capitalExpenditure != null
      ? latest.operatingCashFlow - latest.capitalExpenditure
      : null;

  return {
    fiscalYear: latest.fiscalYear,
    revenue: latest.revenue,
    revenueGrowth: prior ? pct((latest.revenue || 0) - (prior.revenue || 0), prior.revenue) : null,
    grossMargin: pct(latest.grossProfit, latest.revenue),
    operatingMargin: pct(latest.operatingIncome, latest.revenue),
    netMargin: pct(latest.netIncome, latest.revenue),
    netIncome: latest.netIncome,
    operatingCashFlow: latest.operatingCashFlow,
    freeCashFlow,
    totalAssets: latest.totalAssets,
    totalLiabilities: latest.totalLiabilities,
    stockholdersEquity: latest.stockholdersEquity,
    returnOnAssets: pct(latest.netIncome, latest.totalAssets),
    returnOnEquity: pct(latest.netIncome, latest.stockholdersEquity),
    currentRatio: pct(latest.currentAssets, latest.currentLiabilities),
    debtToEquity: pct(totalDebt, latest.stockholdersEquity),
    totalDebt,
  };
}

function buildNarrative(name, submissions, snapshot) {
  const industry = submissions.sicDescription || 'company';
  const state = submissions.stateOfIncorporation || submissions.addresses?.business?.stateOrCountry;
  const parts = [];
  parts.push(
    `${name} operates in ${industry}${state ? ` and is incorporated in ${state}` : ''}.`
  );
  if (snapshot) {
    const growth =
      snapshot.revenueGrowth == null
        ? ''
        : `, ${snapshot.revenueGrowth >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(snapshot.revenueGrowth))} year over year`;
    parts.push(
      `In FY${snapshot.fiscalYear} it reported revenue of ${fmtBillions(snapshot.revenue)}${growth}, ` +
        `a net margin of ${fmtPct(snapshot.netMargin)} and return on equity of ${fmtPct(snapshot.returnOnEquity)}.`
    );
  }
  return parts.join(' ');
}

function recentAnnualFilings(submissions, limit = 5) {
  const recent = submissions.filings && submissions.filings.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const out = [];
  for (let i = 0; i < recent.form.length && out.length < limit; i += 1) {
    if (recent.form[i] !== '10-K') continue;
    out.push({
      form: recent.form[i],
      filed: recent.filingDate ? recent.filingDate[i] : null,
      accessionNumber: recent.accessionNumber ? recent.accessionNumber[i] : null,
      reportDate: recent.reportDate ? recent.reportDate[i] : null,
      primaryDocument: recent.primaryDocument ? recent.primaryDocument[i] : null,
    });
  }
  return out;
}

function buildProfile({ ticker, cik, submissions, modelData }) {
  const name = submissions.name || (modelData && modelData.companyName) || ticker;
  const snapshot = buildSnapshot(modelData && modelData.periods);
  const business = submissions.addresses && submissions.addresses.business;

  return {
    ticker,
    cik,
    name,
    formerNames: (submissions.formerNames || []).map((f) => f.name),
    exchanges: submissions.exchanges || [],
    tickers: submissions.tickers || [ticker],
    sicCode: submissions.sic || null,
    industry: submissions.sicDescription || null,
    category: submissions.category || null,
    stateOfIncorporation: submissions.stateOfIncorporation || null,
    fiscalYearEnd: submissions.fiscalYearEnd || null,
    website: submissions.website || null,
    headquarters: business
      ? {
          city: business.city || null,
          state: business.stateOrCountry || null,
          street: [business.street1, business.street2].filter(Boolean).join(', ') || null,
        }
      : null,
    employees: submissions.employees || null,
    snapshot,
    narrative: buildNarrative(name, submissions, snapshot),
    recentFilings: recentAnnualFilings(submissions),
  };
}

module.exports = { buildProfile, buildSnapshot };
