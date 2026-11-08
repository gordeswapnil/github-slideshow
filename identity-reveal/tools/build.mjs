// Bundles src/main.js (+ three.js + glyph data) into ONE self-contained HTML file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
  legalComments: 'none', loader: { '.json': 'json' },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync(path.join(ROOT, 'src/template.html'), 'utf8');
const html = tpl.replace('/*__BUNDLE__*/', () => js);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist/swapnil-gorde-reveal.html');
fs.writeFileSync(out, html);
console.log('wrote', path.relative(ROOT, out), (html.length / 1024 / 1024).toFixed(2), 'MB');
