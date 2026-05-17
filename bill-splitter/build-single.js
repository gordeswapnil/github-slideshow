#!/usr/bin/env node
/* Bundle the entire bill-splitter app into a single self-contained HTML file.
   - Inlines CSS, JS, and SVG icon as a data URL.
   - Removes service-worker / manifest references that need a real web server.
   - Keeps the html2pdf / pdf.js CDN <script> tags (work whenever the phone
     has internet; manual entry works fully offline regardless).
*/
const fs = require('fs');
const path = require('path');

const root  = path.join(__dirname);
const read  = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html  = read('index.html');
const css   = read('css/styles.css');
const svg   = read('icons/icon.svg');
const js    = {
  store:      read('js/store.js'),
  calculator: read('js/calculator.js'),
  ocr:        read('js/ocr.js'),
  exporter:   read('js/exporter.js'),
  app:        read('js/app.js'),
};

const svgDataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);

// String.prototype.replace interprets $$ / $& / $1 in the replacement.
// Use the function form so the JS source is inserted verbatim.
const sub = (s) => () => s;

let out = html
  // Strip manifest + service-worker (require a real web server)
  .replace(/<link rel="manifest"[^>]*>\s*/g, '')
  // Replace local stylesheet link with inline <style>
  .replace(/<link rel="stylesheet" href="css\/styles\.css"\s*\/>/, sub(`<style>\n${css}\n</style>`))
  // Replace icon links with data URL
  .replace(/href="icons\/icon\.svg"/g,        sub(`href="${svgDataUrl}"`))
  .replace(/href="icons\/icon-192\.png"/g,    sub(`href="${svgDataUrl}"`))
  // Replace local script tags with inline ones (order: store → calc → ocr → exporter → app)
  .replace(/<script src="js\/store\.js"[^>]*><\/script>/,      sub(`<script>\n${js.store}\n</script>`))
  .replace(/<script src="js\/calculator\.js"[^>]*><\/script>/, sub(`<script>\n${js.calculator}\n</script>`))
  .replace(/<script src="js\/ocr\.js"[^>]*><\/script>/,        sub(`<script>\n${js.ocr}\n</script>`))
  .replace(/<script src="js\/exporter\.js"[^>]*><\/script>/,   sub(`<script>\n${js.exporter}\n</script>`))
  .replace(/<script src="js\/app\.js"[^>]*><\/script>/,        sub(`<script>\n${js.app}\n</script>`));

// Disable service-worker registration (we just inlined everything)
out = out.replace(
  /if \('serviceWorker' in navigator && location\.protocol === 'https:'\) \{\s*navigator\.serviceWorker\.register\('sw\.js'\)\.catch\(\(\) => \{\}\);\s*\}/,
  sub('/* SW disabled in single-file build */')
);

const outFile = path.join(root, 'bill-splitter.html');
fs.writeFileSync(outFile, out);
const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`Wrote ${outFile}  (${kb} KB)`);
