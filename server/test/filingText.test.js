const { extractBusinessSection, htmlToText } = require('../src/filingText');

describe('htmlToText', () => {
  test('strips tags and decodes basic entities', () => {
    expect(htmlToText('<p>Hello&nbsp;&amp; <b>world</b></p>')).toBe('Hello & world');
  });
});

describe('extractBusinessSection', () => {
  const html = `
    <html><body>
      <div>Table of contents</div>
      <a>Item 1. Business .......... 4</a>
      <a>Item 1A. Risk Factors ...... 12</a>
      <h2>Item 1. Business</h2>
      <p>Acme Corp designs and sells widgets to enterprise customers worldwide.</p>
      <p>We operate one reportable segment.</p>
      <h2>Item 1A. Risk Factors</h2>
      <p>Our business faces competition and other risks.</p>
    </body></html>`;

  test('extracts the real Business section (not the TOC) and stops at Risk Factors', () => {
    const r = extractBusinessSection(html);
    expect(r.excerpt).toMatch(/Acme Corp designs and sells widgets/);
    expect(r.excerpt).not.toMatch(/faces competition/); // stops before Risk Factors body
  });

  test('truncates long sections', () => {
    const long = '<h2>Item 1. Business</h2><p>' + 'word '.repeat(2000) + '</p><h2>Item 1A. Risk Factors</h2>';
    const r = extractBusinessSection(long, { maxChars: 500 });
    expect(r.truncated).toBe(true);
    expect(r.excerpt.length).toBeLessThanOrEqual(520);
  });

  test('returns null when there is no Business section', () => {
    expect(extractBusinessSection('<p>nothing here</p>')).toBeNull();
  });
});
