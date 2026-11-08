// Deterministic offline render: steps REVEAL.renderFrame(frame / FPS) in headless Chromium,
// captures each frame losslessly (PNG) and pipes it straight into ffmpeg (H.264, yuv420p).
//   node tools/render.mjs [--scale 0.5] [--fps 30] [--out dist/swapnil-gorde-reveal.mp4] [--from 0 --to 450]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(process.env.PW_MODULE || '/opt/node22/lib/node_modules', 'playwright'))); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const scale = parseFloat(arg('scale', '1'));
const fpsOut = parseInt(arg('fps', '30'), 10);
const out = path.resolve(ROOT, arg('out', 'dist/swapnil-gorde-reveal.mp4'));
const crf = arg('crf', '14');
const html = path.join(ROOT, 'dist/swapnil-gorde-reveal.html');

// tiny static server (file:// is avoided so the page behaves exactly as when hosted)
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, 'dist', decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(path.join(ROOT, 'dist')) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/${path.basename(html)}?render=1&scale=${scale}`);
await page.waitForFunction(() => window.REVEAL && window.REVEAL.ready, null, { timeout: 600000 });
const { FPS, DURATION } = await page.evaluate(() => ({ FPS: REVEAL.FPS, DURATION: REVEAL.DURATION }));
const fps = fpsOut || FPS;
const total = Math.round(DURATION * fps);
const from = parseInt(arg('from', '0'), 10), to = Math.min(total, parseInt(arg('to', String(total)), 10));

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-tune', 'film', '-movflags', '+faststart', '-r', String(fps), out], { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let f = from; f < to; f++) {
  const b64 = await page.evaluate((t) => { REVEAL.renderFrame(t); return document.getElementById('c').toDataURL('image/png').split(',')[1]; }, f / fps);
  const buf = Buffer.from(b64, 'base64');
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 15 === 0 || f === to - 1) {
    const done = f - from + 1, el = (Date.now() - t0) / 1000;
    console.log(`frame ${f + 1}/${to}  ${(el / done).toFixed(2)} s/frame  eta ${((to - f - 1) * el / done / 60).toFixed(1)} min`);
  }
}
ff.stdin.end();
await new Promise((r, j) => ff.on('close', c => (c === 0 ? r() : j(new Error('ffmpeg exit ' + c)))));
await browser.close();
server.close();
console.log('wrote', path.relative(ROOT, out));
