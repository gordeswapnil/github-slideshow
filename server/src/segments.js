const { XMLParser } = require('fast-xml-parser');

// Segment / geographic / product revenue breakdowns are NOT in the companyfacts
// JSON API — they only exist as dimensional facts inside the filing's inline
// XBRL (the primary 10-K .htm). This module parses that document, pairs each
// dimensional revenue fact with its context's axis/member(s), and groups the
// single-axis breakdowns by axis. A diagnostics view exposes every axis/member
// combination seen (including multi-axis cells) to make tuning transparent.

const REVENUE_CONCEPTS = new Set([
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'RevenueFromContractWithCustomerExcludingAssessedTaxProductAndServiceBenchmark',
]);

// Axes that represent a revenue breakdown we care about.
const isSegmentAxis = (dim) =>
  /Segment|Geograph|ProductOrService|Region|Brand|MajorCustomer|Country|Subscription/i.test(dim || '');

const localName = (qname) => String(qname || '').split(':').pop();

// "nflx:StreamingRevenuesMember" -> "Streaming Revenues"; "country:US" -> "US".
function humanize(qname, stripSuffix) {
  let s = localName(qname);
  if (stripSuffix && s.endsWith(stripSuffix)) s = s.slice(0, -stripSuffix.length);
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return s || qname;
}

function collectByKey(node, key, acc = []) {
  if (Array.isArray(node)) {
    for (const n of node) collectByKey(n, key, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) {
        if (Array.isArray(v)) acc.push(...v);
        else acc.push(v);
      }
      collectByKey(v, key, acc);
    }
  }
  return acc;
}

function isFullYear(start, end) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  const days = (e - s) / 86400000;
  return days >= 350 && days <= 380;
}

function contextDimensions(ctx) {
  return collectByKey(ctx, 'explicitMember')
    .map((m) => ({
      dimension: m && m['@_dimension'],
      member: m && (typeof m === 'object' ? m['#text'] : m),
    }))
    .filter((d) => d.dimension && d.member);
}

function contextPeriod(ctx) {
  const period = ctx && ctx.period;
  if (!period) return null;
  if (period.endDate) return { start: period.startDate || null, end: period.endDate };
  if (period.instant) return { start: null, end: period.instant };
  return null;
}

function factValue(fact) {
  const raw = typeof fact === 'object' ? fact['#text'] : fact;
  if (raw == null) return null;
  let value = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(value)) return null;
  const scale = Number(fact['@_scale']);
  if (Number.isFinite(scale)) value *= 10 ** scale;
  if (fact['@_sign'] === '-') value = -value;
  return value;
}

// All full-year revenue facts that carry >=1 segment-axis dimension, with their
// complete segment-dimension list.
function parseRevenueFacts(xml, { concepts = REVENUE_CONCEPTS } = {}) {
  if (!xml || typeof xml !== 'string') return [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    textNodeName: '#text',
    trimValues: true,
    parseAttributeValue: false,
  });
  let tree;
  try {
    tree = parser.parse(xml);
  } catch (_) {
    return [];
  }

  const contexts = {};
  for (const ctx of collectByKey(tree, 'context')) {
    const id = ctx && ctx['@_id'];
    if (!id) continue;
    contexts[id] = { period: contextPeriod(ctx), dimensions: contextDimensions(ctx) };
  }

  const facts = [];
  for (const fact of collectByKey(tree, 'nonFraction')) {
    if (!fact || typeof fact !== 'object') continue;
    const concept = localName(fact['@_name']);
    if (!concepts.has(concept)) continue;
    const ctx = contexts[fact['@_contextRef']];
    if (!ctx || !ctx.period || !ctx.period.end) continue;
    if (!isFullYear(ctx.period.start, ctx.period.end)) continue;

    const segmentDims = ctx.dimensions
      .filter((d) => isSegmentAxis(d.dimension))
      .map((d) => ({ axis: d.dimension, member: d.member }));
    if (segmentDims.length === 0) continue;

    const value = factValue(fact);
    if (value == null) continue;

    facts.push({
      concept,
      segmentDims,
      value,
      unit: localName(fact['@_unitRef']) || null,
      fiscalYear: Number(ctx.period.end.slice(0, 4)),
      periodEnd: ctx.period.end,
    });
  }
  return facts;
}

// Single-axis breakdown facts (used for the grouped tables).
function toSingleAxisFacts(revFacts) {
  return revFacts
    .filter((f) => f.segmentDims.length === 1)
    .map((f) => ({
      concept: f.concept,
      axis: f.segmentDims[0].axis,
      member: f.segmentDims[0].member,
      value: f.value,
      unit: f.unit,
      fiscalYear: f.fiscalYear,
      periodEnd: f.periodEnd,
      filed: f.filed || null,
    }));
}

function parseInlineXbrlSegments(xml, opts) {
  return toSingleAxisFacts(parseRevenueFacts(xml, opts));
}
const parseDimensionalFacts = (xml, opts) => parseRevenueFacts(xml, opts);

// Group single-axis facts into { axes: [ { axis, label, members:[{member,label,values}] } ] }.
// When facts carry a `filed` date (multi-filing merge), the most recently filed
// value wins for each member/year; otherwise the larger absolute value wins.
function groupSegments(facts) {
  const yearSet = new Set();
  const axisMap = new Map();

  for (const f of facts) {
    yearSet.add(f.fiscalYear);
    if (!axisMap.has(f.axis)) {
      axisMap.set(f.axis, { axis: f.axis, label: humanize(f.axis, 'Axis'), members: new Map() });
    }
    const members = axisMap.get(f.axis).members;
    if (!members.has(f.member)) {
      members.set(f.member, { member: f.member, label: humanize(f.member, 'Member'), values: {}, _filed: {} });
    }
    const slot = members.get(f.member);
    const have = slot.values[f.fiscalYear];
    const prevFiled = slot._filed[f.fiscalYear];
    const better =
      have == null ||
      (f.filed && (!prevFiled || Date.parse(f.filed) > Date.parse(prevFiled))) ||
      (!f.filed && Math.abs(f.value) > Math.abs(have));
    if (better) {
      slot.values[f.fiscalYear] = f.value;
      slot._filed[f.fiscalYear] = f.filed || null;
    }
  }

  const axes = [...axisMap.values()].map((a) => ({
    axis: a.axis,
    label: a.label,
    members: [...a.members.values()]
      .map((m) => {
        delete m._filed;
        return m;
      })
      .sort((x, y) => {
        const yr = Math.max(...Object.keys({ ...x.values, ...y.values }).map(Number));
        return (y.values[yr] || 0) - (x.values[yr] || 0);
      }),
  }));

  return { fiscalYears: [...yearSet].sort((a, b) => b - a), factCount: facts.length, axes };
}

// Reveal every axis/member and axis-combination seen (incl. multi-axis cells).
function buildDiagnostics(revFacts) {
  const axisMembers = new Map();
  const combos = new Map();
  for (const f of revFacts) {
    const axes = f.segmentDims.map((d) => d.axis).sort();
    const key = axes.map(localName).join(' + ') || '(none)';
    combos.set(key, (combos.get(key) || 0) + 1);
    for (const d of f.segmentDims) {
      if (!axisMembers.has(d.axis)) axisMembers.set(d.axis, new Set());
      axisMembers.get(d.axis).add(d.member);
    }
  }
  return {
    totalRevenueFacts: revFacts.length,
    axesSeen: [...axisMembers.entries()].map(([axis, set]) => ({
      axis,
      label: humanize(axis, 'Axis'),
      members: [...set],
    })),
    axisCombinations: [...combos.entries()]
      .map(([axes, count]) => ({ axes, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function extractSegments(xml) {
  return groupSegments(parseInlineXbrlSegments(xml));
}

module.exports = {
  parseInlineXbrlSegments,
  parseDimensionalFacts,
  parseRevenueFacts,
  toSingleAxisFacts,
  groupSegments,
  buildDiagnostics,
  extractSegments,
  humanize,
  REVENUE_CONCEPTS,
};
