const {
  normalizeCompanyFacts,
  isFullYearDuration,
  extractAllAnnualFacts,
} = require('../src/normalize');
const { companyfacts } = require('./fixtures/secFixtures');

describe('isFullYearDuration', () => {
  test('accepts a ~365 day period', () => {
    expect(isFullYearDuration({ start: '2024-01-01', end: '2024-12-31' })).toBe(true);
  });
  test('rejects a quarterly period', () => {
    expect(isFullYearDuration({ start: '2024-01-01', end: '2024-03-31' })).toBe(false);
  });
  test('rejects an instant fact (no start)', () => {
    expect(isFullYearDuration({ end: '2024-12-31' })).toBe(false);
  });
});

describe('normalizeCompanyFacts', () => {
  const result = normalizeCompanyFacts(companyfacts);
  const byYear = Object.fromEntries(result.periods.map((p) => [p.fiscalYear, p]));

  test('returns periods sorted newest-first', () => {
    expect(result.periods.map((p) => p.fiscalYear)).toEqual([2024, 2023, 2022]);
  });

  test('uses the company entity name', () => {
    expect(result.companyName).toBe('NETFLIX INC');
  });

  test('every period is an annual 10-K', () => {
    for (const p of result.periods) {
      expect(p.form).toBe('10-K');
    }
  });

  test('filters out 10-Q and partial-year durations', () => {
    // Only full-year FY values survive; the Q1 and H1 Revenues entries are gone.
    expect(byYear[2024].revenue).toBe(39000); // from fallback tag, not 9370/18000
    expect(byYear[2023].revenue).toBe(33723);
    expect(byYear[2022].revenue).toBe(31616);
  });

  test('applies fallback tag when the primary tag lacks the year', () => {
    expect(byYear[2024].rawTagsUsed.revenue.tag).toBe(
      'RevenueFromContractWithCustomerExcludingAssessedTax'
    );
    expect(byYear[2023].rawTagsUsed.revenue.tag).toBe('Revenues');
  });

  test('uses fallback tag for cost of revenue', () => {
    expect(byYear[2024].costOfRevenue).toBe(21038);
    expect(byYear[2024].rawTagsUsed.costOfRevenue.tag).toBe('CostOfGoodsAndServicesSold');
  });

  test('derives total liabilities from current + noncurrent when direct tag missing', () => {
    expect(byYear[2024].totalLiabilities).toBe(28000);
    const audit = byYear[2024].rawTagsUsed.totalLiabilities;
    expect(audit.tag).toBe('LiabilitiesCurrent+LiabilitiesNoncurrent');
    expect(audit.derived).toBe(true);
    // No data for earlier years -> stays null.
    expect(byYear[2023].totalLiabilities).toBeNull();
  });

  test('leaves unmapped/absent fields null', () => {
    expect(byYear[2024].grossProfit).toBeNull();
    expect(byYear[2024].rawTagsUsed.grossProfit).toBeUndefined();
  });

  test('prefers the original filing over a restated comparative', () => {
    // 2023 Assets exist in both the FY2023 (A-2023) and FY2024 (A-2024) filings.
    expect(byYear[2023].rawTagsUsed.totalAssets.accessionNumber).toBe('A-2023');
    expect(byYear[2023].rawTagsUsed.totalAssets.reportFiscalYear).toBe(2023);
  });

  test('records full audit trail per value', () => {
    const audit = byYear[2024].rawTagsUsed.netIncome;
    expect(audit).toMatchObject({
      tag: 'NetIncomeLoss',
      unit: 'USD',
      fiscalYear: 2024,
      accessionNumber: 'A-2024',
      filed: '2025-01-27',
      form: '10-K',
      periodEnd: '2024-12-31',
    });
  });

  test('handles non-USD units for EPS and shares', () => {
    expect(byYear[2024].dilutedEPS).toBe(19.83);
    expect(byYear[2024].rawTagsUsed.dilutedEPS.unit).toBe('USD/shares');
    expect(byYear[2024].dilutedShares).toBe(439000000);
    expect(byYear[2024].rawTagsUsed.dilutedShares.unit).toBe('shares');
  });

  test('period-level filed/accession come from the period\'s own 10-K', () => {
    expect(byYear[2024].filed).toBe('2025-01-27');
    expect(byYear[2024].accessionNumber).toBe('A-2024');
    expect(byYear[2023].accessionNumber).toBe('A-2023');
  });

  test('limits to the latest N periods when years is given', () => {
    const limited = normalizeCompanyFacts(companyfacts, { years: 2 });
    expect(limited.periods.map((p) => p.fiscalYear)).toEqual([2024, 2023]);
  });

  test('ignores an invalid years value', () => {
    const all = normalizeCompanyFacts(companyfacts, { years: 'abc' });
    expect(all.periods).toHaveLength(3);
  });

  test('handles companyfacts with no us-gaap data', () => {
    const empty = normalizeCompanyFacts({ entityName: 'X', facts: {} });
    expect(empty.periods).toEqual([]);
    expect(empty.companyName).toBe('X');
  });

  test('maps newly added line items (current liabilities, R&D fallbacks)', () => {
    // LiabilitiesCurrent in the fixture now also surfaces as currentLiabilities.
    expect(byYear[2024].currentLiabilities).toBe(10000);
    expect(byYear[2024].rawTagsUsed.currentLiabilities.tag).toBe('LiabilitiesCurrent');
  });
});

describe('extractAllAnnualFacts', () => {
  const all = extractAllAnnualFacts(companyfacts);

  test('returns every reported annual concept', () => {
    const tags = all.concepts.map((c) => c.tag);
    expect(tags).toEqual(expect.arrayContaining(['Revenues', 'NetIncomeLoss', 'Assets']));
    expect(all.conceptCount).toBe(all.concepts.length);
    expect(all.taxonomy).toBe('us-gaap');
  });

  test('concepts are sorted and carry a per-year audit trail', () => {
    const sorted = [...all.concepts].sort((a, b) => a.tag.localeCompare(b.tag));
    expect(all.concepts.map((c) => c.tag)).toEqual(sorted.map((c) => c.tag));
    const revenue = all.concepts.find((c) => c.tag === 'Revenues');
    expect(revenue.values[2023]).toMatchObject({ value: 33723, unit: 'USD', form: '10-K' });
  });

  test('excludes 10-Q / partial periods (Revenues 2024 partials dropped)', () => {
    const revenue = all.concepts.find((c) => c.tag === 'Revenues');
    // Only the full-year 2022/2023 entries survive under Revenues.
    expect(Object.keys(revenue.values).map(Number).sort()).toEqual([2022, 2023]);
  });

  test('respects the years limit', () => {
    const limited = extractAllAnnualFacts(companyfacts, { years: 1 });
    expect(limited.fiscalYears).toEqual([2024]);
    for (const c of limited.concepts) {
      expect(Object.keys(c.values).map(Number).every((y) => y === 2024)).toBe(true);
    }
  });
});
