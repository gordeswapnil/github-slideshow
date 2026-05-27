// Best-effort extraction of the "Item 1 — Business" narrative from a 10-K
// document. The filing is (inline-XBRL) HTML; we strip markup to text and slice
// the Business section out by its item headers. Heuristic by nature — always
// link back to the source filing.

function codePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch (_) {
    return ' ';
  }
}

// Decode numeric (&#174; &#x2122;) and common named HTML entities.
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;|&ndash;/gi, '—')
    .replace(/&[a-zA-Z]+;/g, ' ');
}

function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  return t.replace(/\s+/g, ' ').trim();
}

// Common Item 1 sub-headings; we insert a paragraph break before them so the
// extracted prose isn't a single wall of text.
const SUBHEADINGS = [
  'Company Background', 'Products', 'Services', 'Segments', 'Markets and Distribution',
  'Competition', 'Supply of Components', 'Research and Development', 'Intellectual Property',
  'Patents', 'Business Seasonality', 'Human Capital', 'Employees', 'Government Regulation',
  'Environmental', 'Available Information', 'Seasonality',
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function addParagraphBreaks(text) {
  let out = text;
  for (const h of SUBHEADINGS) {
    out = out.replace(new RegExp('\\.\\s+(' + escapeRe(h) + ')\\s', 'g'), '.\n\n$1 ');
  }
  return out;
}

// Returns { excerpt, length, truncated } or null if the section isn't found.
function extractBusinessSection(html, { maxChars = 6000 } = {}) {
  const text = htmlToText(html);
  if (!text) return null;

  // Find all "Item 1. Business" headers; the real section is the last one
  // (earlier hits are the table of contents). Allow optional period and spacing.
  const startRe = /item\s*1\.?\s*[-:.]?\s*business/gi;
  const starts = [];
  let m;
  while ((m = startRe.exec(text)) !== null) starts.push(m.index);
  if (!starts.length) return null;
  const start = starts[starts.length - 1];

  // End at the next "Item 1A ... Risk Factors" (or Item 2 Properties) after start.
  const endRe = /item\s*1a\.?\s*[-:.]?\s*risk\s*factors|item\s*2\.?\s*[-:.]?\s*properties|item\s*1b\.?\s*[-:.]?\s*unresolved/gi;
  endRe.lastIndex = start + 1;
  const endMatch = endRe.exec(text);
  const end = endMatch ? endMatch.index : Math.min(text.length, start + maxChars * 3);

  let section = addParagraphBreaks(text.slice(start, end).trim());
  if (!section) return null;

  const length = section.length;
  let truncated = false;
  if (section.length > maxChars) {
    section = section.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
    truncated = true;
  }
  return { excerpt: section, length, truncated };
}

module.exports = { extractBusinessSection, htmlToText, decodeEntities };
