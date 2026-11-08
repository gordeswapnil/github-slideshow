// Offline typography + geometry preparation.
// Reads OFL fonts from @fontsource packages, extracts glyph outlines with opentype.js,
// lays out the name / tagline with real kerning and tracking, and partitions the
// S and G glyphs into machined components with exact polygon clipping.
// Output: src/glyph-data.json (consumed by src/main.js; no font parsing at runtime).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import pc from 'polygon-clipping';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FS = (pkg, file) => path.join(ROOT, 'node_modules/@fontsource', pkg, 'files', file);

function load(p) {
  const b = fs.readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// Font stacks (subset files are merged by lookup order)
const SERIF = [load(FS('cormorant-garamond', 'cormorant-garamond-latin-600-normal.woff')),
               load(FS('cormorant-garamond', 'cormorant-garamond-latin-ext-600-normal.woff'))];
const SANS  = [load(FS('inter', 'inter-latin-500-normal.woff')),
               load(FS('inter', 'inter-latin-ext-500-normal.woff')),
               load(FS('inter', 'inter-greek-500-normal.woff'))];
const MONO  = [load(FS('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff')),
               load(FS('jetbrains-mono', 'jetbrains-mono-latin-ext-500-normal.woff')),
               load(FS('jetbrains-mono', 'jetbrains-mono-greek-500-normal.woff'))];

function glyphFor(ch, stack) {
  for (const f of stack) {
    const g = f.charToGlyph(ch);
    if (g && g.index !== 0) return { font: f, glyph: g };
  }
  throw new Error(`Missing glyph "${ch}" (U+${ch.codePointAt(0).toString(16)})`);
}

// ---------- outline flattening ----------
// Returns contours as arrays of [x,y] in font units (y up). maxSeg in font units.
function flatten(commands, maxSeg) {
  const contours = [];
  let cur = null, px = 0, py = 0;
  const push = (x, y) => {
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - x, last[1] - y) > 1e-6) cur.push([x, y]);
  };
  for (const c of commands) {
    if (c.type === 'M') { if (cur && cur.length > 2) contours.push(cur); cur = []; push(c.x, c.y); px = c.x; py = c.y; }
    else if (c.type === 'L') { push(c.x, c.y); px = c.x; py = c.y; }
    else if (c.type === 'Q') {
      const len = Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x - c.x1, c.y - c.y1);
      const n = Math.max(2, Math.min(256, Math.ceil(len / maxSeg)));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        push(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y);
      }
      px = c.x; py = c.y;
    } else if (c.type === 'C') {
      const len = Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2);
      const n = Math.max(2, Math.min(256, Math.ceil(len / maxSeg)));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        push(u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
             u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y);
      }
      px = c.x; py = c.y;
    } else if (c.type === 'Z') {
      if (cur && cur.length > 2) contours.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length > 2) contours.push(cur);
  // drop explicit closing duplicate
  for (const ct of contours) {
    const a = ct[0], b = ct[ct.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) ct.pop();
  }
  return contours;
}

const signedArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// Non-zero fill: variable-font instances keep overlapping contours (e.g. W, N), so contours with the
// outer orientation are unioned and opposite-orientation contours are subtracted as counters.
function toPolygons(contours) {
  if (!contours.length) return [];
  const areas = contours.map(signedArea);
  let maxI = 0;
  areas.forEach((a, i) => { if (Math.abs(a) > Math.abs(areas[maxI])) maxI = i; });
  const outerSign = Math.sign(areas[maxI]);
  const close = (r) => [[...r, r[0]]];
  const solids = contours.filter((c, i) => Math.sign(areas[i]) === outerSign).map(close);
  const holes = contours.filter((c, i) => Math.sign(areas[i]) !== outerSign).map(close);
  let geom = pc.union(solids[0], ...solids.slice(1));
  if (holes.length) geom = pc.difference(geom, ...holes);
  const orient = (r, ccw) => (signedArea(r) > 0) === ccw ? r : r.slice().reverse();
  return geom.map(poly => poly.map((r, k) => orient(r.slice(0, -1), k === 0)));
}

const round = (v) => Math.round(v * 1e5) / 1e5;
const flat = (ring) => ring.flatMap(([x, y]) => [round(x), round(y)]);

function bboxOf(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// ---------- master scale: serif cap height = 10 world units ----------
const serif = SERIF[0];
const CAP = serif.tables.os2.sCapHeight || serif.charToGlyph('H').getBoundingBox().y2;
const K = 10 / CAP;                         // font units -> world units for the serif
const MAXSEG_WORLD = 0.035;                 // flattening resolution for large glyphs

function serifGlyphWorld(ch) {
  const { glyph } = glyphFor(ch, SERIF);
  const contours = flatten(glyph.path.commands, MAXSEG_WORLD / K).map(c => c.map(([x, y]) => [x * K, y * K]));
  return { glyph, polys: toPolygons(contours) };
}

// ---------- partition S / G into machined components ----------
const CELL = 0.46;
function partition(polys, seed) {
  const bb = bboxOf(polys);
  // centre glyph on its bbox centre
  const P = polys.map(poly => poly.map(r => r.map(([x, y]) => [x - bb.cx, y - bb.cy])));
  const hw = (bb.x1 - bb.x0) / 2, hh = (bb.y1 - bb.y0) / 2;
  const ni = Math.ceil(hw / CELL) + 1, nj = Math.ceil(hh / CELL) + 1;
  let pieces = [];
  for (let i = -ni; i < ni; i++) for (let j = -nj; j < nj; j++) {
    const x0 = i * CELL, y0 = j * CELL;
    const cell = [[[x0, y0], [x0 + CELL, y0], [x0 + CELL, y0 + CELL], [x0, y0 + CELL], [x0, y0]]];
    const res = pc.intersection(P, cell);
    for (const poly of res) {
      const ring = poly[0].slice(0, -1);
      const a = Math.abs(signedArea(ring));
      if (a < 1e-5) continue;
      pieces.push({ i, j, poly: [poly[0]], area: a });
    }
  }
  // merge slivers into the largest edge-sharing neighbour
  const MIN = 0.38 * CELL * CELL;
  let changed = true, guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    pieces.sort((a, b) => a.area - b.area);
    for (let k = 0; k < pieces.length; k++) {
      const p = pieces[k];
      if (p.area >= MIN || p.dead) continue;
      let best = null, bestU = null;
      for (const q of pieces) {
        if (q === p || q.dead) continue;
        if (Math.abs(q.i - p.i) + Math.abs(q.j - p.j) > 2) continue;
        const u = pc.union(p.poly, q.poly);
        if (u.length !== 1 || u[0].length !== 1) continue; // must fuse into one simple polygon
        if (!best || q.area > best.area) { best = q; bestU = u[0]; }
      }
      if (best) {
        best.poly = [bestU[0]];
        best.area = Math.abs(signedArea(bestU[0].slice(0, -1)));
        best.merged = true;
        p.dead = true; changed = true;
      }
    }
    pieces = pieces.filter(p => !p.dead);
  }
  // full cells become precision triangles (alternating diagonal), partial cells stay as cut profiles
  const out = [];
  for (const p of pieces) {
    const ring = p.poly[0].slice(0, -1);
    const full = !p.merged && Math.abs(p.area - CELL * CELL) < 1e-4;
    if (full) {
      const x0 = p.i * CELL, y0 = p.j * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      const tris = ((p.i + p.j) & 1)
        ? [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]]
        : [[[x0, y0], [x1, y0], [x0, y1]], [[x1, y0], [x1, y1], [x0, y1]]];
      for (const t of tris) out.push({ kind: 'tri', ring: t, cell: [p.i, p.j] });
    } else {
      out.push({ kind: 'cut', ring: signedArea(ring) > 0 ? ring : ring.reverse(), cell: [p.i, p.j] });
    }
  }
  return {
    bbox: { w: round(bb.x1 - bb.x0), h: round(bb.y1 - bb.y0), cx: round(bb.cx), cy: round(bb.cy) },
    outline: P.map(poly => poly.map(flat)),
    pieces: out.map(p => {
      const a = Math.abs(signedArea(p.ring));
      let per = 0; for (let k = 0; k < p.ring.length; k++) { const A = p.ring[k], B = p.ring[(k + 1) % p.ring.length]; per += Math.hypot(A[0] - B[0], A[1] - B[1]); }
      return { k: p.kind, c: p.cell, r: flat(p.ring), inr: round(2 * a / per) };
    }),
  };
}

// ---------- typesetting helpers ----------
function setLine(text, stack, { tracking = 0, scale = 1, maxSeg }) {
  // tracking in em; returns letters with outlines in world units (baseline y=0), plus width
  const out = [];
  let pen = 0, prev = null;
  for (const ch of text) {
    if (ch === ' ') {
      const { font, glyph } = glyphFor(' ', stack);
      pen += (glyph.advanceWidth / font.unitsPerEm) * scale + tracking * scale;
      prev = null; continue;
    }
    const { font, glyph } = glyphFor(ch, stack);
    const em = font.unitsPerEm;
    if (prev && prev.font === font) pen += (font.getKerningValue(prev.glyph, glyph) / em) * scale;
    const s = scale / em;
    const contours = flatten(glyph.path.commands, maxSeg / s).map(c => c.map(([x, y]) => [pen + x * s, y * s]));
    const polys = toPolygons(contours);
    const bb = polys.length ? bboxOf(polys) : { cx: pen, cy: 0 };
    out.push({ ch, adv: round((glyph.advanceWidth / em) * scale), x: round(pen), cx: round(bb.cx), cy: round(bb.cy),
               polys: polys.map(poly => poly.map(r => flat(r.map(([x, y]) => [x - bb.cx, y - bb.cy])))) });
    pen += (glyph.advanceWidth / em) * scale + tracking * scale;
    prev = { font, glyph };
  }
  const last = out[out.length - 1];
  const width = last ? last.x + last.adv : 0;
  return { letters: out, width: round(width) };
}

// ---------- build ----------
const S = serifGlyphWorld('S');
const G = serifGlyphWorld('G');
const partS = partition(S.polys, 1);
const partG = partition(G.polys, 2);

// Name: serif caps, cap height 10 world units, tracking +0.16 em
const EM = 10 / (CAP / serif.unitsPerEm);   // world units per em so that cap height = 10
const name = setLine('SWAPNIL GORDE', SERIF, { tracking: 0.16, scale: EM, maxSeg: 0.035 });

// Tagline: Inter Medium caps, cap height ~ 0.235 of name cap height, tracking +0.34 em
const inter = SANS[0];
const interCap = inter.tables.os2.sCapHeight / inter.unitsPerEm;
const TAG_CAP = 2.3;
const tagEm = TAG_CAP / interCap;
const tagWords = ['FINANCE', 'FINTECH', 'ACADEMIA', 'INNOVATION'];
const tagSet = tagWords.map(w => setLine(w, SANS, { tracking: 0.3, scale: tagEm, maxSeg: 0.02 }));

// Floating knowledge fragments: accounting symbols, financial figures, code
const fragments = [
  // accounting / finance symbols (serif)
  ['Σ', 'sans'], ['Δ', 'sans'], ['%', 'serif'], ['$', 'serif'], ['€', 'serif'], ['£', 'serif'], ['¥', 'serif'], ['₹', 'sans'], ['±', 'serif'],
  ['Dr', 'serif'], ['Cr', 'serif'], ['β', 'sans'], ['σ', 'sans'], ['π', 'sans'], ['λ', 'mono'],
  ['NPV', 'sans'], ['IRR', 'sans'], ['WACC', 'sans'], ['EBITDA', 'sans'], ['ROE', 'sans'], ['P/E', 'sans'], ['CAPM', 'sans'], ['VaR', 'sans'],
  ['A = L + E', 'serif'], ['Debit', 'serif'], ['Credit', 'serif'], ['Ledger', 'serif'], ['Equity', 'serif'], ['Yield', 'serif'],
  // numbers
  ['1,284.50', 'mono'], ['+3.27%', 'mono'], ['−0.84%', 'mono'], ['4,096.00', 'mono'], ['12.5%', 'mono'], ['0.618', 'mono'],
  ['$2.4M', 'mono'], ['€950K', 'mono'], ['98.6', 'mono'], ['7.25%', 'mono'], ['(1,200)', 'mono'], ['1.05^n', 'mono'], ['365', 'mono'],
  // code
  ['0x3F', 'mono'], ['1011 0110', 'mono'], ['{ }', 'mono'], ['</>', 'mono'], ['f(x)', 'mono'], ['=SUM(B2:B9)', 'mono'],
  ['=NPV(r, CF)', 'mono'], ['if (r > g)', 'mono'], ['hash: 7f3a', 'mono'], ['ledger.post()', 'mono'], ['0101', 'mono'],
  ['tx.verify()', 'mono'], ['await price()', 'mono'], ['[ ]', 'mono'], ['=>', 'mono'], ['::', 'mono'], ['01', 'mono'], ['∞', 'sans'],
];
const STACK = { serif: SERIF, sans: SANS, mono: MONO };
const frag = fragments.filter(([t, f]) => {
  try { for (const ch of t) if (ch !== ' ') glyphFor(ch, STACK[f]); return true; }
  catch (e) { console.warn('dropping fragment', JSON.stringify(t), '-', e.message); return false; }
}).map(([t, f]) => {
  const L = setLine(t, STACK[f], { tracking: f === 'mono' ? 0 : 0.04, scale: 1, maxSeg: 0.015 });
  return { t, f, width: L.width, letters: L.letters };
});

const data = {
  generated: 'tools/extract-glyphs.mjs',
  fonts: {
    serif: 'Cormorant Garamond SemiBold (SIL OFL 1.1)',
    sans: 'Inter Medium (SIL OFL 1.1)',
    mono: 'JetBrains Mono Medium (SIL OFL 1.1)',
  },
  cell: CELL,
  capHeight: 10,
  S: { ...partS, glyphCenterInName: null },
  G: partG,
  name,
  tagline: { words: tagSet, cap: TAG_CAP, em: round(tagEm) },
  fragments: frag,
};

fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/glyph-data.json'), JSON.stringify(data));

// report
const kinds = (p) => p.pieces.reduce((m, x) => (m[x.k] = (m[x.k] || 0) + 1, m), {});
console.log('cap height (font units):', CAP, 'unitsPerEm', serif.unitsPerEm);
console.log('S pieces', partS.pieces.length, kinds(partS), 'bbox', partS.bbox);
console.log('G pieces', partG.pieces.length, kinds(partG), 'bbox', partG.bbox);
console.log('name width', name.width, 'letters', name.letters.map(l => `${l.ch}@${l.x}`).join(' '));
console.log('kerning check (AV, WA):', SERIF[0].getKerningValue(SERIF[0].charToGlyph('A'), SERIF[0].charToGlyph('V')), SERIF[0].getKerningValue(SERIF[0].charToGlyph('W'), SERIF[0].charToGlyph('A')));
console.log('tagline widths', tagSet.map(t => t.width));
console.log('json bytes', fs.statSync(path.join(ROOT, 'src/glyph-data.json')).size);
