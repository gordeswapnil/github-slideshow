// Best-effort extraction of the "Item 1 — Business" narrative from a 10-K
// document. The filing is (inline-XBRL) HTML; we strip markup to text and slice
// the Business section out by its item headers. Heuristic by nature — always
// link back to the source filing.

function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#8217;|&#x2019;|&rsquo;/gi, "'")
    .replace(/&#8216;|&lsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns { excerpt, length, truncated } or null if the section isn't found.
function extractBusinessSection(html, { maxChars = 4000 } = {}) {
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

  let section = text.slice(start, end).trim();
  if (!section) return null;

  const length = section.length;
  let truncated = false;
  if (section.length > maxChars) {
    section = section.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
    truncated = true;
  }
  return { excerpt: section, length, truncated };
}

module.exports = { extractBusinessSection, htmlToText };
