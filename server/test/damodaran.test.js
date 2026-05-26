const { getIndustryBeta, sicToIndustry, relever } = require('../src/damodaran');

describe('sicToIndustry', () => {
  test('maps Netflix SIC 7841 to Entertainment', () => {
    expect(sicToIndustry('7841')).toBe('Entertainment');
  });
  test('maps a software SIC to Software', () => {
    expect(sicToIndustry('7372')).toBe('Software (System & Application)');
  });
  test('returns null for unknown SIC', () => {
    expect(sicToIndustry('9999')).toBeNull();
    expect(sicToIndustry('')).toBeNull();
  });
});

describe('relever', () => {
  test('beta_L = beta_U * (1 + (1 - t) * D/E)', () => {
    expect(relever(1.0, { de: 0.5, taxRate: 0.2 })).toBeCloseTo(1.4, 6);
  });
  test('returns the unlevered beta when D/E is unknown', () => {
    expect(relever(1.1, { de: null, taxRate: 0.2 })).toBe(1.1);
  });
});

describe('getIndustryBeta', () => {
  test('relevers the matched industry asset beta', () => {
    const r = getIndustryBeta({ sic: '7841', de: 0.5, taxRate: 0.2 });
    expect(r.industry).toBe('Entertainment');
    expect(r.matchedBy).toBe('sic');
    expect(r.unleveredBeta).toBe(1.1);
    expect(r.releveredBeta).toBeCloseTo(1.1 * 1.4, 6); // 1.54
  });

  test('falls back to Total Market for unknown industries', () => {
    const r = getIndustryBeta({ sic: '9999', de: 0, taxRate: 0.2 });
    expect(r.industry).toBe('Total Market');
    expect(r.matchedBy).toBe('fallback');
    expect(r.releveredBeta).toBe(r.unleveredBeta); // de = 0
  });
});
