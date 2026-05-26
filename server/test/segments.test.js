const {
  parseInlineXbrlSegments,
  groupSegments,
  extractSegments,
  humanize,
} = require('../src/segments');
const inlineXbrl = require('./fixtures/inlineXbrl');

describe('humanize', () => {
  test('cleans member/axis QNames', () => {
    expect(humanize('nflx:StreamingRevenuesMember', 'Member')).toBe('Streaming Revenues');
    expect(humanize('srt:ProductOrServiceAxis', 'Axis')).toBe('Product Or Service');
    expect(humanize('country:US')).toBe('US');
  });
});

describe('parseInlineXbrlSegments', () => {
  const facts = parseInlineXbrlSegments(inlineXbrl);

  test('extracts single-axis full-year revenue facts and applies scale', () => {
    const stream24 = facts.find(
      (f) => f.axis === 'srt:ProductOrServiceAxis' && f.member === 'nflx:StreamingRevenuesMember' && f.fiscalYear === 2024
    );
    expect(stream24.value).toBe(38000000 * 1000); // scale=3
    expect(stream24.unit).toBe('usd');
  });

  test('excludes consolidated (no-segment) facts', () => {
    expect(facts.some((f) => f.value === 39000000 * 1000)).toBe(false);
  });

  test('excludes partial-year (Q1) facts', () => {
    expect(facts.some((f) => f.value === 9000000 * 1000)).toBe(false);
  });

  test('excludes multi-axis intersection cells', () => {
    expect(facts.some((f) => f.value === 12000000 * 1000)).toBe(false);
  });

  test('captures both product and geographic axes', () => {
    const axes = new Set(facts.map((f) => f.axis));
    expect(axes).toContain('srt:ProductOrServiceAxis');
    expect(axes).toContain('srt:StatementGeographicalAxis');
  });

  test('returns [] for junk input', () => {
    expect(parseInlineXbrlSegments('')).toEqual([]);
    expect(parseInlineXbrlSegments(null)).toEqual([]);
  });
});

describe('groupSegments', () => {
  const grouped = groupSegments(parseInlineXbrlSegments(inlineXbrl));

  test('groups by axis and member with per-year values', () => {
    expect(grouped.fiscalYears).toEqual([2024, 2023]);
    const product = grouped.axes.find((a) => a.axis === 'srt:ProductOrServiceAxis');
    expect(product.label).toBe('Product Or Service');
    const streaming = product.members.find((m) => m.member === 'nflx:StreamingRevenuesMember');
    expect(streaming.label).toBe('Streaming Revenues');
    expect(streaming.values[2024]).toBe(38000000 * 1000);
    expect(streaming.values[2023]).toBe(33000000 * 1000);
  });

  test('members are sorted by latest-year value descending', () => {
    const product = grouped.axes.find((a) => a.axis === 'srt:ProductOrServiceAxis');
    expect(product.members[0].member).toBe('nflx:StreamingRevenuesMember'); // 38B > 1B
  });

  test('extractSegments is parse + group', () => {
    expect(extractSegments(inlineXbrl)).toEqual(grouped);
  });
});
