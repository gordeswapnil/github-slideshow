const { XMLParser } = require('fast-xml-parser');

// Segment / geographic / product revenue breakdowns are NOT in the companyfacts
// JSON API — they only exist as dimensional facts inside the filing's inline
// XBRL (the primary 10-K .htm). This module parses that document, pairs each
// dimensional revenue fact with its context's axis/member, and groups the
// result by axis.

const REVENUE_CONCEPTS = new Set([
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'RevenueFromContractWithCustomerExcludingAssessedTaxProductAndServiceBenchmark',
]);

// Axes that represent a revenue breakdown we care about.
const isSegmentAxis = (dim) => /Segment|Geograph|ProductOrService/i.test(dim || '');

const localName = (qname) => String(qname || '').split(':').pop();

// "nflx:StreamingRevenuesMember" -> "Streaming Revenues"; "country:US" -> "US".
function humanize(qname, stripSuffix) {
  let s = localName(qname);
  if (stripSuffix && s.endsWith(stripSuffix)) s = s.slice(0, -stripSuffix.length);
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return s || qname;
}

// Recursively collect every value stored under `key` anywhere in the parsed tree.
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
  const members = collectByKey(ctx, 'explicitMember');
  return members
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
  const cleaned = String(raw).replace(/,/g, '').trim();
  let value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  const scale = Number(fact['@_scale']);
  if (Number.isFinite(scale)) value *= 10 ** scale;
  if (fact['@_sign'] === '-') value = -value;
  return value;
}

function parseInlineXbrlSegments(xml, { concepts = REVENUE_CONCEPTS } = {}) {
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

  // Build contextId -> { period, dimensions }
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

    const segDims = ctx.dimensions.filter((d) => isSegmentAxis(d.dimension));
    // Only single-axis breakdowns (avoid double-counting product x geography cells).
    if (segDims.length !== 1) continue;

    const value = factValue(fact);
    if (value == null) continue;

    facts.push({
      concept,
      axis: segDims[0].dimension,
      member: segDims[0].member,
      value,
      unit: localName(fact['@_unitRef']) || null,
      fiscalYear: Number(ctx.period.end.slice(0, 4)),
      periodEnd: ctx.period.end,
    });
  }
  return facts;
}

// Group flat facts into { axes: [ { axis, label, members: [ { member, label, values } ] } ] }.
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
      members.set(f.member, { member: f.member, label: humanize(f.member, 'Member'), values: {} });
    }
    // Keep the largest absolute value if the same member/year appears twice.
    const slot = members.get(f.member).values;
    if (slot[f.fiscalYear] == null || Math.abs(f.value) > Math.abs(slot[f.fiscalYear])) {
      slot[f.fiscalYear] = f.value;
    }
  }

  const axes = [...axisMap.values()].map((a) => ({
    axis: a.axis,
    label: a.label,
    members: [...a.members.values()].sort((x, y) => {
      const latest = Math.max(...Object.keys({ ...x.values, ...y.values }).map(Number));
      return (y.values[latest] || 0) - (x.values[latest] || 0);
    }),
  }));

  return { fiscalYears: [...yearSet].sort((a, b) => b - a), factCount: facts.length, axes };
}

function extractSegments(xml) {
  return groupSegments(parseInlineXbrlSegments(xml));
}

module.exports = {
  parseInlineXbrlSegments,
  groupSegments,
  extractSegments,
  humanize,
  REVENUE_CONCEPTS,
};
