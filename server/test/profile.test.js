const { buildProfile } = require('../src/profile');
const { normalizeCompanyFacts } = require('../src/normalize');
const { submissions, companyfacts } = require('./fixtures/secFixtures');

describe('buildProfile', () => {
  const modelData = normalizeCompanyFacts(companyfacts, { years: 5 });
  const profile = buildProfile({ ticker: 'NFLX', cik: '0001065280', submissions, modelData });

  test('carries SEC submissions metadata', () => {
    expect(profile).toMatchObject({
      ticker: 'NFLX',
      cik: '0001065280',
      name: 'NETFLIX INC',
      industry: 'Services-Video Tape Rental',
      sicCode: '7841',
      stateOfIncorporation: 'DE',
      exchanges: ['NASDAQ'],
    });
    expect(profile.headquarters).toMatchObject({ city: 'Los Gatos', state: 'CA' });
    expect(profile.formerNames).toContain('NETFLIX COM INC');
  });

  test('computes a financial snapshot from the latest period', () => {
    const s = profile.snapshot;
    expect(s.fiscalYear).toBe(2024);
    expect(s.revenue).toBe(39000); // fixture FY2024 revenue (fallback tag)
    expect(s.netMargin).toBeCloseTo(8712 / 39000, 4);
    expect(s.returnOnEquity).toBeCloseTo(8712 / 24743, 4);
    // YoY growth vs FY2023 revenue (33723)
    expect(s.revenueGrowth).toBeCloseTo((39000 - 33723) / 33723, 4);
  });

  test('lists only annual (10-K) recent filings', () => {
    expect(profile.recentFilings.every((f) => f.form === '10-K')).toBe(true);
    expect(profile.recentFilings[0]).toMatchObject({ accessionNumber: 'A-2024' });
  });

  test('produces a human-readable narrative', () => {
    expect(typeof profile.narrative).toBe('string');
    expect(profile.narrative).toContain('NETFLIX INC');
    expect(profile.narrative).toMatch(/FY2024/);
  });
});
