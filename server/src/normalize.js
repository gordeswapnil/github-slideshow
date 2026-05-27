const TAG_MAP = require('./tagMap');

// Field order and the period-level fields that are good "anchors" for choosing
// a representative accession number / filed date for each period.
const FIELDS = Object.keys(TAG_MAP);
const ANCHOR_PRIORITY = ['netIncome', 'revenue', 'totalAssets', 'stockholdersEquity'];

function yearOf(dateStr) {
  const year = Number(String(dateStr || '').slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

// Duration facts (income statement, cash flow) have a `start`. We only keep
// full-year periods (~365 days) so quarterly/partial durations are excluded.
function isFullYearDuration(entry) {
  if (!entry.start || !entry.end) return false;
  const start = Date.parse(entry.start);
  const end = Date.parse(entry.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const days = (end - start) / (1000 * 60 * 60 * 24);
  return days >= 350 && days <= 380;
}

function getGaapFacts(companyFacts) {
  return (companyFacts && companyFacts.facts && companyFacts.facts['us-gaap']) || {};
}

// Pick the preferred unit if present, otherwise the first reported unit. The
// chosen unit name is returned so it can be recorded for auditability.
function selectUnit(tagData, preferredUnit) {
  const units = tagData && tagData.units;
  if (!units) return { unit: null, entries: [] };
  if (Array.isArray(units[preferredUnit])) {
    return { unit: preferredUnit, entries: units[preferredUnit] };
  }
  const keys = Object.keys(units);
  if (keys.length === 0) return { unit: null, entries: [] };
  return { unit: keys[0], entries: units[keys[0]] };
}

// Prefer the entry whose report fiscal year equals the period year (the
// original 10-K for that year); otherwise prefer the most recently filed.
function isBetterCandidate(candidate, existing, fiscalYear, preferLatest = false) {
  const newer = Date.parse(candidate.filed || 0) > Date.parse(existing.filed || 0);
  // For split-sensitive fields (EPS, shares) prefer the most recently filed
  // value so the series is restated/split-adjusted.
  if (preferLatest) return newer;
  const candIsOriginal = candidate.reportFiscalYear === fiscalYear;
  const existIsOriginal = existing.reportFiscalYear === fiscalYear;
  if (candIsOriginal !== existIsOriginal) return candIsOriginal;
  return newer;
}

// Map fiscalYear -> audited value for a single XBRL tag, keeping only annual
// 10-K facts (form === "10-K", fp === "FY").
function selectAnnualByYear(tagData, preferredUnit, preferLatest = false) {
  const { unit, entries } = selectUnit(tagData, preferredUnit);
  const byYear = new Map();
  for (const entry of entries) {
    if (entry.form !== '10-K' || entry.fp !== 'FY') continue;
    const isInstant = !entry.start;
    if (!isInstant && !isFullYearDuration(entry)) continue;
    const fiscalYear = yearOf(entry.end);
    if (!fiscalYear) continue;

    const candidate = {
      value: entry.val,
      unit,
      fiscalYear,
      reportFiscalYear: entry.fy,
      accessionNumber: entry.accn || null,
      filed: entry.filed || null,
      form: entry.form,
      periodEnd: entry.end,
      periodStart: entry.start || null,
    };
    const existing = byYear.get(fiscalYear);
    if (!existing || isBetterCandidate(candidate, existing, fiscalYear, preferLatest)) {
      byYear.set(fiscalYear, candidate);
    }
  }
  return byYear;
}

// Build fiscalYear -> audited value for a modelling field, walking its tag list
// in priority order. The first tag that has a value for a year fills that year.
function buildFieldSeries(companyFacts, field) {
  const gaap = getGaapFacts(companyFacts);
  const def = TAG_MAP[field];
  const byYear = new Map();
  for (const tag of def.tags) {
    const tagData = gaap[tag];
    if (!tagData) continue;
    const series = selectAnnualByYear(tagData, def.unit, def.preferLatestFiling);
    for (const [fiscalYear, audited] of series) {
      if (!byYear.has(fiscalYear)) {
        const value = def.negate ? -Math.abs(audited.value) : audited.value;
        byYear.set(fiscalYear, { ...audited, value, tag });
      }
    }
  }
  return byYear;
}

// Fallback for total liabilities: LiabilitiesCurrent + LiabilitiesNoncurrent,
// applied only for years where the direct `Liabilities` tag is missing.
function applyLiabilitiesFallback(companyFacts, totalLiabilitiesSeries) {
  const gaap = getGaapFacts(companyFacts);
  const current = selectAnnualByYear(gaap.LiabilitiesCurrent, 'USD');
  const noncurrent = selectAnnualByYear(gaap.LiabilitiesNoncurrent, 'USD');
  for (const [fiscalYear, cur] of current) {
    if (totalLiabilitiesSeries.has(fiscalYear)) continue;
    const non = noncurrent.get(fiscalYear);
    if (!non) continue;
    totalLiabilitiesSeries.set(fiscalYear, {
      value: cur.value + non.value,
      unit: cur.unit,
      fiscalYear,
      reportFiscalYear: cur.reportFiscalYear,
      accessionNumber: cur.accessionNumber,
      filed: cur.filed,
      form: cur.form,
      periodEnd: cur.periodEnd,
      periodStart: null,
      tag: 'LiabilitiesCurrent+LiabilitiesNoncurrent',
      derived: true,
    });
  }
}

function buildPeriod(fiscalYear, fieldSeries) {
  const period = {
    fiscalYear,
    form: '10-K',
    filed: null,
    accessionNumber: null,
  };
  const rawTagsUsed = {};
  const present = [];

  for (const field of FIELDS) {
    const audited = fieldSeries[field].get(fiscalYear);
    if (!audited) {
      period[field] = null;
      continue;
    }
    period[field] = audited.value;
    rawTagsUsed[field] = {
      tag: audited.tag,
      unit: audited.unit,
      value: audited.value,
      fiscalYear: audited.fiscalYear,
      reportFiscalYear: audited.reportFiscalYear,
      accessionNumber: audited.accessionNumber,
      filed: audited.filed,
      form: audited.form,
      periodEnd: audited.periodEnd,
      ...(audited.derived ? { derived: true } : {}),
    };
    present.push({ field, audited });
  }

  // Period-level filed/accession: prefer original-year filings, then latest filed.
  const originals = present.filter((p) => p.audited.reportFiscalYear === fiscalYear);
  const pool = originals.length ? originals : present;
  pool.sort((a, b) => {
    const ap = ANCHOR_PRIORITY.indexOf(a.field);
    const bp = ANCHOR_PRIORITY.indexOf(b.field);
    const aRank = ap === -1 ? Number.MAX_SAFE_INTEGER : ap;
    const bRank = bp === -1 ? Number.MAX_SAFE_INTEGER : bp;
    if (aRank !== bRank) return aRank - bRank;
    return Date.parse(b.audited.filed || 0) - Date.parse(a.audited.filed || 0);
  });
  if (pool.length) {
    period.filed = pool[0].audited.filed;
    period.accessionNumber = pool[0].audited.accessionNumber;
  }

  period.rawTagsUsed = rawTagsUsed;
  return period;
}

// Derive gross profit (revenue - cost of revenue) for years the company did not
// tag GrossProfit directly.
function applyGrossProfitFallback(fieldSeries) {
  const revenue = fieldSeries.revenue;
  const cost = fieldSeries.costOfRevenue;
  const gross = fieldSeries.grossProfit;
  for (const [fiscalYear, rev] of revenue) {
    if (gross.has(fiscalYear)) continue;
    const c = cost.get(fiscalYear);
    if (!c) continue;
    gross.set(fiscalYear, {
      value: rev.value - c.value,
      unit: rev.unit,
      fiscalYear,
      reportFiscalYear: rev.reportFiscalYear,
      accessionNumber: rev.accessionNumber,
      filed: rev.filed,
      form: rev.form,
      periodEnd: rev.periodEnd,
      tag: `${rev.tag} − ${c.tag}`,
      derived: true,
    });
  }
}

// Flag a likely stock split where weighted diluted shares jump by >3x (or <1/3x)
// between adjacent years — the per-share series may not be split-consistent
// across that boundary (older filings are not restated in available data).
function detectSplitWarnings(fieldSeries, sortedYears) {
  const shares = fieldSeries.dilutedShares;
  const warnings = [];
  for (let i = 0; i < sortedYears.length - 1; i += 1) {
    const newer = shares.get(sortedYears[i]);
    const older = shares.get(sortedYears[i + 1]);
    if (!newer || !older || !older.value) continue;
    const ratio = newer.value / older.value;
    if (ratio >= 3 || ratio <= 1 / 3) {
      warnings.push(
        `Diluted shares change ~${ratio.toFixed(1)}x between FY${sortedYears[i + 1]} and ` +
          `FY${sortedYears[i]} — likely a stock split. Per-share figures may not be ` +
          `split-consistent across that boundary (older filings aren't restated in SEC data).`
      );
    }
  }
  return warnings;
}

// Turn raw SEC companyfacts JSON into normalized, modelling-ready annual data.
function normalizeCompanyFacts(companyFacts, { years } = {}) {
  const fieldSeries = {};
  for (const field of FIELDS) {
    fieldSeries[field] = buildFieldSeries(companyFacts, field);
  }
  applyLiabilitiesFallback(companyFacts, fieldSeries.totalLiabilities);
  applyGrossProfitFallback(fieldSeries);

  const yearSet = new Set();
  for (const field of FIELDS) {
    for (const fiscalYear of fieldSeries[field].keys()) {
      yearSet.add(fiscalYear);
    }
  }

  let sortedYears = [...yearSet].sort((a, b) => b - a);
  const limit = Number(years);
  if (Number.isFinite(limit) && limit > 0) {
    sortedYears = sortedYears.slice(0, limit);
  }

  return {
    cik: null, // filled in by the service (padded form)
    companyName: companyFacts && companyFacts.entityName ? companyFacts.entityName : null,
    warnings: detectSplitWarnings(fieldSeries, sortedYears),
    periods: sortedYears.map((fiscalYear) => buildPeriod(fiscalYear, fieldSeries)),
  };
}

// Extract EVERY us-gaap concept that has annual 10-K / FY values, as a
// normalized time series. This is the "fetch everything" path — it surfaces all
// line items the company reported in XBRL, using the raw tag names.
function extractAllAnnualFacts(companyFacts, { years } = {}) {
  const gaap = getGaapFacts(companyFacts);
  const yearSet = new Set();
  let concepts = [];

  for (const [tag, tagData] of Object.entries(gaap)) {
    const byYear = selectAnnualByYear(tagData, 'USD');
    if (byYear.size === 0) continue;
    const values = {};
    let unit = null;
    for (const [fiscalYear, audited] of byYear) {
      unit = audited.unit;
      values[fiscalYear] = {
        value: audited.value,
        unit: audited.unit,
        accessionNumber: audited.accessionNumber,
        filed: audited.filed,
        form: audited.form,
        periodEnd: audited.periodEnd,
      };
      yearSet.add(fiscalYear);
    }
    concepts.push({ tag, label: tagData.label || tag, unit, values });
  }

  let fiscalYears = [...yearSet].sort((a, b) => b - a);
  const limit = Number(years);
  if (Number.isFinite(limit) && limit > 0) {
    fiscalYears = fiscalYears.slice(0, limit);
    const keep = new Set(fiscalYears);
    for (const concept of concepts) {
      for (const fy of Object.keys(concept.values)) {
        if (!keep.has(Number(fy))) delete concept.values[fy];
      }
    }
    concepts = concepts.filter((c) => Object.keys(c.values).length > 0);
  }

  concepts.sort((a, b) => a.tag.localeCompare(b.tag));

  return {
    taxonomy: 'us-gaap',
    fiscalYears,
    conceptCount: concepts.length,
    concepts,
  };
}

module.exports = {
  normalizeCompanyFacts,
  extractAllAnnualFacts,
  // exported for unit testing
  selectAnnualByYear,
  isFullYearDuration,
  buildFieldSeries,
};
