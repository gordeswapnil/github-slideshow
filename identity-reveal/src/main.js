// SWAPNIL GORDE — 15 s cinematic identity reveal
// Three.js, deterministic: every frame is a pure function of time t (seconds).
//   window.REVEAL.renderFrame(t)  -> renders the frame at time t
// No Math.random, no clocks inside the scene logic; all motion is analytic springs.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import DATA from './glyph-data.json';

export const W = 1920, H = 1080, FPS = 30, DURATION = 15;
const SCALE = Math.min(1, Math.max(0.25, parseFloat(new URLSearchParams(location.search).get('scale') || '1')));
const RW = Math.round(W * SCALE), RH = Math.round(H * SCALE);

// ───────────────────────────── helpers ─────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// Analytic damped-spring step response (0 → 1), zero initial velocity.
// freq: natural frequency in Hz, zeta: damping ratio.
function spring(t, freq = 1, zeta = 1) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (zeta < 0.999) {
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w * t) * (1 + w * t);
}
// A value driven by a spring follower whose target steps through keys.
// keys: [{ v }, { t, v, f, z }, ...] — superposition of step responses (linear system).
function track(keys, t) {
  let v = keys[0].v;
  for (let k = 1; k < keys.length; k++) v += (keys[k].v - keys[k - 1].v) * spring(t - keys[k].t, keys[k].f ?? 0.6, keys[k].z ?? 1);
  return v;
}
const pulse = (t, t0, rise, decay) => (t < t0 ? smoothstep(t0 - rise, t0, t) : Math.exp(-(t - t0) / decay));

// ───────────────────────────── renderer ─────────────────────────────
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 4000);
camera.filmGauge = 36;

// ───────────────────────────── studio environment ─────────────────────────────
// A black studio with a few soft boxes, prefiltered into a PMREM. This is what the
// metal reflects: controlled, rectangular, restrained — no busy HDRI.
function buildStudioEnvironment() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x000000);
  const panel = (w, h, hex, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(7, 4.5, 0xffffff, 1.5, [-5, 7, 7]);     // key soft box, high left front
  panel(20, 11, 0xffffff, 0.42, [1, 2, 11]);    // broad frontal bounce: gives faces a calm satin tone
  panel(1.1, 9, 0xf2f4ff, 1.2, [9, 0.5, 2]);    // vertical strip, right
  panel(14, 2.2, 0xffffff, 0.3, [0, 9, -5]);    // overhead fill, behind
  panel(10, 0.3, 0xff6a1f, 0.7, [0, -2.5, -9]); // thin orange kicker, low behind (restrained)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = buildStudioEnvironment();
scene.environmentIntensity = 0.9;

// ───────────────────────────── lights ─────────────────────────────
const key = new THREE.DirectionalLight(0xfff3e6, 1.6);
key.position.set(-22, 30, 26);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 5, far: 110 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.025;
key.shadow.radius = 3.5;
scene.add(key, key.target);

const rim = new THREE.DirectionalLight(0xdce6ff, 1.5);
rim.position.set(14, 12, -24);
scene.add(rim);

const ORANGE = new THREE.Color('#ff6a1f');

// ───────────────────────────── shared sweep / seam uniforms ─────────────────────────────
const SWEEP = {
  uSweepOrigin: { value: new THREE.Vector3() },
  uSweepDir: { value: new THREE.Vector3(1, 0, 0) },
  uSweepPos: { value: -1e4 },
  uSweepWidth: { value: 0.2 },
  uSweepColor: { value: new THREE.Color(0, 0, 0) },
  uSweepFace: { value: 0.0 },
  uSeamColor: { value: new THREE.Color(0, 0, 0) },
  uFront: { value: new THREE.Vector3(0, 0, 1) },
};
function patchSweep(material, key) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SWEEP);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSwWorld;\nvarying vec3 vSwNormal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSwNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSwWorld; varying vec3 vSwNormal;
uniform vec3 uSweepOrigin; uniform vec3 uSweepDir; uniform float uSweepPos; uniform float uSweepWidth;
uniform vec3 uSweepColor; uniform float uSweepFace; uniform vec3 uSeamColor; uniform vec3 uFront;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 wn = normalize(vSwNormal);
  float nf = abs(dot(wn, uFront));
  float side = 1.0 - smoothstep(0.0, 0.3, nf);                          // side walls
  float chamfer = smoothstep(0.25, 0.5, nf) * (1.0 - smoothstep(0.86, 0.96, nf));
  float sd = dot(vSwWorld - uSweepOrigin, uSweepDir) - uSweepPos;
  float band = exp(-sd * sd / (uSweepWidth * uSweepWidth));
  float tail = exp(-max(-sd, 0.0) / (uSweepWidth * 6.0)) * step(sd, 0.0) * 0.12;   // faint afterglow
  totalEmissiveRadiance += uSweepColor * (band + tail) * (chamfer + 0.07 * side + uSweepFace);
  totalEmissiveRadiance += uSeamColor * chamfer;
}`);
  };
  material.customProgramCacheKey = () => 'sweep-' + key;
}

// ───────────────────────────── machined surface texture ─────────────────────────────
// R: fine milling grooves (bump), G: roughness modulation. Seamlessly tileable.
function machiningTexture() {
  const N = 1024;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const rnd = mulberry32(1931);
  const PITCH = 2; // px per groove → 512 grooves per tile
  const lineAmp = new Float32Array(N / PITCH).map(() => 0.65 + 0.35 * rnd());
  const lineOff = new Float32Array(N / PITCH).map(() => rnd());
  for (let y = 0; y < N; y++) {
    const li = Math.floor(y / PITCH), ph = (y % PITCH) / PITCH;
    const groove = 0.5 + 0.5 * Math.cos(2 * Math.PI * ph);
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const low = 0.5 + 0.25 * Math.sin(2 * Math.PI * (2 * u + lineOff[li] * 0.15)) + 0.25 * Math.sin(2 * Math.PI * (3 * v + 5 * u));
      const r = 0.5 + 0.5 * (groove - 0.5) * lineAmp[li] * (0.85 + 0.15 * low);
      const gg = 0.80 + 0.20 * low;
      const i = (y * N + x) * 4;
      img.data[i] = Math.round(255 * r); img.data[i + 1] = Math.round(255 * gg); img.data[i + 2] = 128; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.55, 0.55);
  tex.rotation = 0.42;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
const machTex = machiningTexture();

// ───────────────────────────── materials ─────────────────────────────
const METAL = { color: new THREE.Color('#8e9299'), metalness: 1.0, roughness: 0.45, emissive: new THREE.Color(0, 0, 0) };
const IVORY = { color: new THREE.Color('#f4f2ee'), metalness: 0.0, roughness: 0.7, emissive: new THREE.Color('#ffffff').multiplyScalar(0.52) };

const pieceMat = new THREE.MeshPhysicalMaterial({
  color: METAL.color.clone(), metalness: METAL.metalness, roughness: METAL.roughness,
  bumpMap: machTex, bumpScale: 0.35, roughnessMap: machTex, emissive: new THREE.Color(0, 0, 0),
});
patchSweep(pieceMat, 'piece');

const nameMat = new THREE.MeshPhysicalMaterial({
  color: IVORY.color.clone(), metalness: 0, roughness: IVORY.roughness, emissive: IVORY.emissive.clone(),
  transparent: false,
});
patchSweep(nameMat, 'name');
// letters rise out of an invisible slot at the baseline (clip plane keeps y > baseline)
const slot = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const nameMatRise = nameMat.clone(); nameMatRise.clippingPlanes = [slot]; patchSweep(nameMatRise, 'nameRise');

// ───────────────────────────── geometry builders ─────────────────────────────
const ringToVec2 = (r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push(new THREE.Vector2(r[i], r[i + 1])); return p; };
function polysToShapes(polys) {
  return polys.map(poly => {
    const s = new THREE.Shape(ringToVec2(poly[0]));
    for (let h = 1; h < poly.length; h++) s.holes.push(new THREE.Path(ringToVec2(poly[h])));
    return s;
  });
}
function ringCentroid(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const cr = r[i] * r[j + 1] - r[j] * r[i + 1];
    a += cr; cx += (r[i] + r[j]) * cr; cy += (r[i + 1] + r[j + 1]) * cr;
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

const LETTER_DEPTH = 1.7;              // monogram letter thickness (cap height = 10)
const LAYER = LETTER_DEPTH / 2;
const BEV = 0.0075;
const CREASE = 0.45;   // < 45° chamfer: caps and chamfers stay flat, curved walls smooth

// Build the machined components of a glyph partition (two depth layers).
function minCornerAngle(r) {
  let m = Math.PI;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, c = (i + 1) % n;
    const ux = r[2 * a] - r[2 * i], uy = r[2 * a + 1] - r[2 * i + 1], vx = r[2 * c] - r[2 * i], vy = r[2 * c + 1] - r[2 * i + 1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) continue;
    m = Math.min(m, Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)))));
  }
  return m;
}
function buildPieces(part) {
  const out = [];
  for (const p of part.pieces) {
    const safe = p.inr > BEV * 3.4 && minCornerAngle(p.r) > 22 * DEG;
    for (const layer of [0, 1]) {
      const useBevel = safe;
      const bt = useBevel ? BEV : 0;
      let geo = new THREE.ExtrudeGeometry(new THREE.Shape(ringToVec2(p.r)), {
        depth: LAYER - 2 * bt, bevelEnabled: useBevel, bevelThickness: bt, bevelSize: BEV, bevelOffset: -BEV,
        bevelSegments: 1, curveSegments: 1, steps: 1,
      });
      const [cx, cy] = ringCentroid(p.r);
      const z0 = layer === 0 ? 0 : -LAYER;
      const zc = z0 + LAYER / 2;
      geo.translate(-cx, -cy, z0 + bt - zc);
      geo = toCreasedNormals(geo, CREASE);
      out.push({ geo, home: new THREE.Vector3(cx, cy, zc), layer, kind: p.k });
    }
  }
  return out;
}

// Type is extruded without a bevel: an inset bevel self-intersects at the acute notches of
// letters such as N and W (stem/diagonal junctions) and would fill their counters.
function letterGeometry(polys, depth) {
  let geo = new THREE.ExtrudeGeometry(polysToShapes(polys), { depth, bevelEnabled: false, curveSegments: 1, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  return toCreasedNormals(geo, CREASE);
}

function flatTextGeometry(letters, scale = 1) {
  const shapes = [];
  for (const L of letters) {
    for (const s of polysToShapes(L.polys)) {
      const pts = s.getPoints(); // already polylines
      const sh = new THREE.Shape(pts.map(p => new THREE.Vector2((p.x + L.cx) * scale, (p.y + L.cy) * scale)));
      sh.holes = s.holes.map(h => new THREE.Path(h.getPoints().map(p => new THREE.Vector2((p.x + L.cx) * scale, (p.y + L.cy) * scale))));
      shapes.push(sh);
    }
  }
  return new THREE.ShapeGeometry(shapes, 1);
}

// ───────────────────────────── layout constants ─────────────────────────────
const rnd = mulberry32(20261108);
const NAME_W = DATA.name.width;
const NAME_BASE_Y = 1.2;                         // name baseline (world)
const NAME_DEPTH = 1.0;
const nameLetters = DATA.name.letters.map((L, i) => ({ ...L, idx: i, pos: new THREE.Vector3(L.cx - NAME_W / 2, L.cy + NAME_BASE_Y, 0) }));
const nameS = nameLetters.find(l => l.ch === 'S');
const nameG = nameLetters.find(l => l.ch === 'G');

// Monogram placement (G at origin, S nested in the G's counter, slightly proud)
const MONO_S = { pos: new THREE.Vector3(-0.55, 0.05, 0.62), scale: 0.6 };
const S_APPROACH = { pos: new THREE.Vector3(-0.55, 0.05, 7.0), rotY: -34 * DEG };

// Timeline (seconds)
const T = {
  sepStart: 3.05,     // S separates
  gStart: 5.55,       // components converge into G
  crysStart: 8.45,    // knowledge fragments crystallise into a new S
  lockMove: 9.62,     // S travels into the G
  lockClick: 10.12,   // the click
  sig: 10.72,         // signature pull-back begins
  lettersIn: 11.32,
  swapSolid: 11.9,
  tagIn: 12.3,
  glint: 13.45,
};

// ───────────────────────────── set A: S → cloud → G ─────────────────────────────
const S_PIECES = buildPieces(DATA.S);
const G_PIECES = buildPieces(DATA.G);

function pairByRank(sList, gList) {
  // order by height (top → bottom) then x, separately per depth layer, and pair proportionally by rank
  const key = (p) => -p.home.y * 10 + p.home.x * 0.35;
  const pairs = [];
  for (const layer of [0, 1]) {
    const S = sList.filter(p => p.layer === layer).sort((a, b) => key(a) - key(b));
    const G = gList.filter(p => p.layer === layer).sort((a, b) => key(a) - key(b));
    const n = Math.max(S.length, G.length);
    const usedS = new Set(), usedG = new Set();
    for (let i = 0; i < n; i++) {
      const s = S[Math.round(i * (S.length - 1) / Math.max(1, n - 1))];
      const g = G[Math.round(i * (G.length - 1) / Math.max(1, n - 1))];
      pairs.push({ s: usedS.has(s) ? null : s, g: usedG.has(g) ? null : g, sRef: s, gRef: g });
      usedS.add(s); usedG.add(g);
    }
  }
  return pairs;
}

const gGroup = new THREE.Group();   // G space (identity until the signature move)
scene.add(gGroup);
const A = pairByRank(S_PIECES, G_PIECES).map((pr, i) => {
  const mesh = new THREE.Mesh(pr.s ? pr.s.geo : pr.g.geo, pieceMat);
  mesh.castShadow = mesh.receiveShadow = true;
  gGroup.add(mesh);
  const sHome = pr.sRef.home, gHome = pr.gRef.home;
  // exploded-view position: measured radial expansion + depth fan-out
  const rad = new THREE.Vector2(sHome.x, sHome.y);
  const rl = rad.length() || 1;
  rad.multiplyScalar(1 / rl);
  const spread = 1.16 + 0.22 * rnd();
  const cloud = new THREE.Vector3(
    sHome.x * spread + rad.x * (0.25 + 0.9 * rnd()),
    sHome.y * (1.1 + 0.12 * rnd()) + (rnd() - 0.5) * 0.5,
    (pr.sRef.layer === 0 ? 1 : -1) * (0.9 + 4.2 * Math.pow(rnd(), 1.3)) + (rnd() - 0.5) * 0.8);
  const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
  // separation wave: travels diagonally across the S from top-left
  const wave = clamp01(((-sHome.y + 5.2) / 10.4) * 0.7 + ((sHome.x + 3) / 6) * 0.3);
  const gWave = clamp01(((-gHome.y + 5.2) / 10.4) * 0.65 + ((gHome.x + 5.2) / 10.4) * 0.35);
  return {
    mesh, sGeo: pr.s ? pr.s.geo : null, gGeo: pr.g ? pr.g.geo : null,
    sHome, gHome, cloud, axis,
    angle: (18 + 50 * rnd()) * DEG * (rnd() < 0.5 ? -1 : 1),
    spin: (rnd() - 0.5) * 0.5,
    tExp: T.sepStart + wave * 0.75 + rnd() * 0.12,
    tG: T.gStart + gWave * 0.85 + rnd() * 0.15,
    tSwap: 4.75 + rnd() * 0.7,
    bob: rnd() * Math.PI * 2,
  };
});

// ───────────────────────────── knowledge fragments ─────────────────────────────
const FRAG_COUNT = 84;
const fragGeoCache = new Map();
function fragGeometry(f) {
  if (!fragGeoCache.has(f.t)) {
    const g = flatTextGeometry(f.letters, 1);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    g.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, 0);
    fragGeoCache.set(f.t, g);
  }
  return fragGeoCache.get(f.t);
}
const fragGroup = new THREE.Group();
scene.add(fragGroup);
const FR = [];
{
  const order = DATA.fragments.map((f, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < FRAG_COUNT; i++) {
    const f = DATA.fragments[order[i % order.length]];
    const roll = rnd();
    const tone = roll < 0.16 ? 'orange' : roll < 0.8 ? 'white' : 'dim';
    const col = tone === 'orange' ? ORANGE.clone().multiplyScalar(1.9) : tone === 'white' ? new THREE.Color(0.82, 0.82, 0.82) : new THREE.Color(0.3, 0.3, 0.31);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(fragGeometry(f), mat);
    mesh.renderOrder = 2;
    fragGroup.add(mesh);
    const src = S_PIECES[Math.floor(rnd() * S_PIECES.length)].home;
    const start = new THREE.Vector3(src.x + (rnd() - 0.5) * 0.3, src.y + (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 1.2);
    const dir = new THREE.Vector3(src.x + (rnd() - 0.5) * 2, src.y * 0.6 + (rnd() - 0.5) * 2, 0).normalize();
    const R = 7 + 9 * Math.pow(rnd(), 0.7);
    const target = new THREE.Vector3(dir.x * R * 1.3, dir.y * R * 0.75 + (rnd() - 0.5) * 3, -16 + 21 * rnd());
    // keep the letter's face clear: anything in front of the glyph footprint is pushed behind it
    if (Math.abs(target.x) < 7.5 && Math.abs(target.y) < 7 && target.z > -4) target.z = -5 - 9 * rnd();
    FR.push({
      mesh, mat, tone, start, target,
      size: (tone === 'dim' ? 0.5 : 0.36) + 0.38 * rnd(),
      peak: tone === 'dim' ? 0.85 : tone === 'orange' ? 0.85 : 0.4 + 0.4 * rnd(),
      tSpawn: T.sepStart + 0.08 + rnd() * 0.95,
      tCrys: T.crysStart + rnd() * 0.75,
      drift: new THREE.Vector3((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.35, (rnd() - 0.5) * 0.5),
      tilt: (rnd() - 0.5) * 0.24,
    });
  }
}
const _fp = new THREE.Vector3();
function fragPosition(F, t, out = _fp) {
  const p = spring(t - F.tSpawn, 0.42, 1.0);
  out.copy(F.start).lerp(F.target, p);
  const age = Math.max(0, t - F.tSpawn);
  out.addScaledVector(F.drift, age);
  // slow orbit of the whole knowledge field while the G forms
  const orbit = 0.07 * Math.max(0, t - 5.0);
  const x = out.x, z = out.z;
  out.x = x * Math.cos(orbit) + z * Math.sin(orbit);
  out.z = -x * Math.sin(orbit) + z * Math.cos(orbit);
  // gather toward the forming S just before crystallising
  const gather = smoothstep(F.tCrys - 0.7, F.tCrys, t) * 0.38;
  if (gather > 0) out.lerp(S_APPROACH.pos, gather);
  return out;
}

// ───────────────────────────── set B: fragments → S (monogram S) ─────────────────────────────
const sGroup = new THREE.Group();
scene.add(sGroup);
const B = S_PIECES.map((p, k) => {
  const mesh = new THREE.Mesh(p.geo, pieceMat);
  mesh.castShadow = mesh.receiveShadow = true;
  sGroup.add(mesh);
  const F = FR[Math.floor(rnd() * FR.length)];
  const startWorld = fragPosition(F, F.tCrys, new THREE.Vector3()).add(new THREE.Vector3((rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.8));
  const wave = clamp01((-p.home.y + 5.2) / 10.4);
  return {
    mesh, home: p.home, startWorld,
    tAppear: F.tCrys - 0.05 + rnd() * 0.1,
    tFly: F.tCrys + 0.1 + wave * 0.12 + rnd() * 0.08,
    q0: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), (rnd() - 0.5) * 2.6),
  };
});

// ───────────────────────────── the name ─────────────────────────────
const nameGroup = new THREE.Group();
scene.add(nameGroup);
const NAME_MESHES = nameLetters.map((L) => {
  const isInitial = L === nameS || L === nameG;
  const word = L.idx < nameG.idx ? 'SW' : 'GO';
  const mat = isInitial ? nameMat : nameMatRise;
  const mesh = new THREE.Mesh(letterGeometry(L.polys, NAME_DEPTH), mat);
  mesh.position.copy(L.pos);
  mesh.visible = false;
  nameGroup.add(mesh);
  return { L, mesh, isInitial, word };
});
// solid S/G at monogram depth for the hand-over from components → typography
const solidS = NAME_MESHES.find(m => m.L === nameS).mesh;
const solidG = NAME_MESHES.find(m => m.L === nameG).mesh;
solidS.geometry = letterGeometry(nameS.polys, LETTER_DEPTH);
solidG.geometry = letterGeometry(nameG.polys, LETTER_DEPTH);

// ───────────────────────────── tagline ─────────────────────────────
const TAG_GAP = 7.2;                               // space for the separator
const TAG_BASE_Y = -10.2;
const tagGroup = new THREE.Group();
scene.add(tagGroup);
const tagWords = DATA.tagline.words;
const tagTotal = tagWords.reduce((s, w) => s + w.width, 0) + TAG_GAP * (tagWords.length - 1);
const TAG = [];
{
  let x = -tagTotal / 2;
  tagWords.forEach((w, wi) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.80, 0.80, 0.80), transparent: true, opacity: 0, toneMapped: false });
    const letters = w.letters.map(L => {
      const m = new THREE.Mesh(flatTextGeometry([{ ...L, cx: 0, cy: 0 }]), mat);
      const home = new THREE.Vector3(x + L.cx, TAG_BASE_Y + L.cy, 0);
      m.position.copy(home);
      tagGroup.add(m);
      return { m, home };
    });
    const wcx = x + w.width / 2;
    TAG.push({ mat, letters, wcx, wi });
    x += w.width;
    if (wi < tagWords.length - 1) {
      const sep = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 2.9),
        new THREE.MeshBasicMaterial({ color: ORANGE.clone().multiplyScalar(1.0), transparent: true, opacity: 0, toneMapped: false }));
      sep.position.set(x + TAG_GAP / 2, TAG_BASE_Y + DATA.tagline.cap / 2, 0);
      sep.userData.wi = wi;
      tagGroup.add(sep);
      TAG[TAG.length - 1].sep = sep;
      x += TAG_GAP;
    }
  });
}

// ───────────────────────────── post-processing ─────────────────────────────
const rt = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(1);
composer.setSize(RW, RH);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: 40, aperture: 0.0, maxblur: 0.012 });
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(RW, RH), 0.6, 0.45, 0.55);
bloom.highPassUniforms.smoothWidth.value = 0.6;
bloom.materialHighPassFilter.fragmentShader = `
  uniform sampler2D tDiffuse; uniform vec3 defaultColor; uniform float defaultOpacity;
  uniform float luminosityThreshold; uniform float smoothWidth; varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    float warm = max(texel.r - 1.6 * max(texel.g, texel.b), 0.0);     // chroma of orange light
    float a = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, warm);
    gl_FragColor = mix(vec4(defaultColor.rgb, defaultOpacity), vec4(texel.rgb, 1.0), a);
  }`;
bloom.materialHighPassFilter.needsUpdate = true;
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uFrame: { value: 0 }, uGrain: { value: 0.022 }, uVignette: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uFrame; uniform float uGrain; uniform float uVignette; varying vec2 vUv;
    float hash(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yxz + 19.19); return fract((p.x + p.y) * p.z); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.5625);
      float vig = 1.0 - uVignette * smoothstep(0.3, 0.8, length(d) * 1.35);   // starts outside the type block
      c.rgb *= vig;
      float n = hash(vec3(gl_FragCoord.xy, uFrame)) - 0.5;
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += n * uGrain * (0.35 + 0.65 * smoothstep(0.0, 0.25, lum));
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
});
composer.addPass(finish);

// ───────────────────────────── camera rig ─────────────────────────────
const MACRO = new THREE.Vector3(2.62, -2.05, LAYER + 0.0);
const CAM = {
  tx: [{ v: MACRO.x }, { t: 1.2, v: 0, f: 0.42 }, { t: 8.45, v: -0.3, f: 0.5 }, { t: T.sig, v: 0, f: 0.42 }],
  ty: [{ v: MACRO.y }, { t: 1.2, v: 0, f: 0.42 }, { t: 8.45, v: 0.0, f: 0.5 }, { t: T.sig, v: -1.3, f: 0.42 }],
  tz: [{ v: MACRO.z }, { t: 1.2, v: 0, f: 0.42 }, { t: 8.45, v: 2.4, f: 0.5 }, { t: T.lockMove, v: 0.6, f: 0.6 }, { t: T.sig, v: 0, f: 0.42 }],
  az: [{ v: 58 }, { t: 0.15, v: 44, f: 0.2 }, { t: 1.2, v: -24, f: 0.34 }, { t: 3.0, v: 26, f: 0.3 },
       { t: 5.55, v: -36, f: 0.26 }, { t: 8.45, v: -22, f: 0.45 }, { t: T.sig, v: 0, f: 0.4 }],
  el: [{ v: -24 }, { t: 0.15, v: -18, f: 0.2 }, { t: 1.2, v: -7, f: 0.36 }, { t: 3.0, v: 10, f: 0.3 }, { t: 5.55, v: -3, f: 0.3 }, { t: 7.2, v: 6, f: 0.35 },
       { t: 8.45, v: 7, f: 0.5 }, { t: T.sig, v: 0, f: 0.42 }],
  logD: [{ v: Math.log(1.15) }, { t: 0.1, v: Math.log(0.95), f: 0.18 }, { t: 1.2, v: Math.log(40), f: 0.34 }, { t: 3.0, v: Math.log(55), f: 0.32 },
         { t: 5.55, v: Math.log(35), f: 0.3 }, { t: 8.45, v: Math.log(40), f: 0.45 },
         { t: T.sig, v: Math.log(690), f: 0.55 }, { t: 13.1, v: Math.log(664), f: 0.18 }],
  focal: [{ v: 100 }, { t: 1.2, v: 50, f: 0.4 }, { t: 5.55, v: 60, f: 0.3 }, { t: T.sig, v: 85, f: 0.6 }],
  roll: [{ v: 6 }, { t: 1.2, v: 0, f: 0.4 }, { t: 5.55, v: 1.5, f: 0.3 }, { t: 8.45, v: 0, f: 0.4 }],
  aperture: [{ v: 0.06 }, { t: 1.2, v: 0.0016, f: 0.45 }, { t: 3.0, v: 0.0011, f: 0.4 }, { t: T.sig - 0.1, v: 0.0, f: 1.6 }],
};
const _target = new THREE.Vector3();
function updateCamera(t) {
  _target.set(track(CAM.tx, t), track(CAM.ty, t), track(CAM.tz, t));
  const az = track(CAM.az, t) * DEG, el = track(CAM.el, t) * DEG, d = Math.exp(track(CAM.logD, t));
  camera.position.set(
    _target.x + d * Math.cos(el) * Math.sin(az),
    _target.y + d * Math.sin(el),
    _target.z + d * Math.cos(el) * Math.cos(az));
  camera.up.set(0, 1, 0);
  camera.lookAt(_target);
  camera.rotateZ(track(CAM.roll, t) * DEG);
  camera.setFocalLength(track(CAM.focal, t));
  camera.near = Math.max(0.02, d * 0.04);
  camera.far = d * 4 + 160;
  camera.updateProjectionMatrix();
  const ap = Math.max(0, track(CAM.aperture, t));
  bokeh.enabled = ap > 2e-5;
  bokeh.uniforms.aperture.value = ap;
  bokeh.uniforms.focus.value = camera.position.distanceTo(_target);
  return d;
}

// ───────────────────────────── per-frame scene state ─────────────────────────────
function computeRiseTimes() {
  const sHalf = DATA.S.bbox.w / 2;
  for (const n of NAME_MESHES) {
    if (n.isInitial) continue;
    if (n.word === 'SW') {
      // rise once the travelling S has passed this letter's centre (and the departing G has cleared it);
      // the letter emerges behind the S, so a little overlap at the start is occluded, never crossed
      const letterRight = n.L.pos.x + n.L.adv * 0.5;
      let tr = T.sig + 1.6;
      for (let t = T.sig; t < T.sig + 3; t += 1 / 240) {
        sGroupTransform(t);
        const gx = nameG.pos.x * spring(t - (T.sig + 0.32), 0.46, 0.95);
        if (sGroup.position.x + sHalf * sGroup.scale.x * 0.35 < n.L.pos.x && gx - DATA.G.bbox.w / 2 > letterRight + 0.5) { tr = t; break; }
      }
      n.tRise = tr;
    } else {
      const order = n.L.idx - nameG.idx;  // O=1 … E=4
      n.tRise = T.sig + 1.0 + order * 0.085;
    }
  }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();
const _e = new THREE.Euler();
const QI = new THREE.Quaternion();

function setSweep(t) {
  // Scene 1: narrow light travelling across the macro edge, then a broad reveal sweep
  let pos = -1e4, width = 0.2, intensity = 0, face = 0;
  const dir = _v.set(0.94, 0.34, 0).normalize();
  const origin = _v2.set(0, 0, 0);
  SWEEP.uSweepDir.value.copy(dir);
  if (t < 1.75) {
    const k = smoothstep(0.0, 1.7, t);
    pos = lerp(-0.6, 2.4, k) + 0; // world units along dir, passes the macro region
    origin.copy(MACRO).addScaledVector(dir, -1.0);
    width = 0.09; intensity = 3.2 * smoothstep(0.0, 0.25, t) * (1 - smoothstep(1.45, 1.75, t)); face = 0.0;
  } else if (t < 3.2) {
    pos = lerp(-8, 8, smoothstep(1.65, 3.05, t));
    width = 0.55; intensity = 2.4 * smoothstep(1.7, 1.9, t) * (1 - smoothstep(2.9, 3.2, t)); face = 0.0;
  } else if (t > 6.6 && t < 8.6) {         // G formed: sweep reveals its construction during the orbit
    pos = lerp(-9, 9, smoothstep(6.7, 8.4, t));
    width = 0.45; intensity = 2.0 * smoothstep(6.6, 6.9, t) * (1 - smoothstep(8.2, 8.6, t)); face = 0.0;
  } else if (t > T.lockClick - 0.05 && t < 11.0) {   // lock flash
    pos = lerp(-8, 9, smoothstep(T.lockClick, T.lockClick + 0.75, t));
    width = 0.7; intensity = 2.6 * (1 - smoothstep(10.75, 11.0, t)); face = 0.0;
  } else if (t > T.glint - 0.1) {           // final restrained glint across the name
    SWEEP.uSweepDir.value.set(1, 0, 0);
    pos = lerp(-NAME_W / 2 - 12, NAME_W / 2 + 12, smoothstep(T.glint, T.glint + 1.15, t));
    width = 3.0; intensity = 1.0 * smoothstep(T.glint - 0.1, T.glint + 0.1, t) * (1 - smoothstep(T.glint + 1.0, T.glint + 1.2, t)); face = 0.16;
  }
  SWEEP.uSweepOrigin.value.copy(origin);
  SWEEP.uSweepPos.value = pos;
  SWEEP.uSweepWidth.value = width;
  SWEEP.uSweepColor.value.copy(ORANGE).multiplyScalar(intensity);
  SWEEP.uSweepFace.value = face;
  // physical orange spot riding on the band (grazing light)
  // seam glow: anticipation before separation, and the lock pulse
  const seam = 1.15 * smoothstep(2.6, 3.05, t) * (1 - smoothstep(3.2, 3.6, t))
             + 1.4 * (t > T.lockClick - 0.05 ? pulse(t, T.lockClick + 0.03, 0.04, 0.28) : 0);
  SWEEP.uSeamColor.value.copy(ORANGE).multiplyScalar(seam);
}

function updateSetA(t) {
  // G group transform (signature)
  const sigP = spring(t - (T.sig + 0.32), 0.46, 0.95);
  gGroup.position.set(0, 0, 0).lerp(nameG.pos, sigP);
  const flatten = lerp(1, NAME_DEPTH / LETTER_DEPTH, smoothstep(T.sig + 0.3, T.sig + 1.2, t));
  gGroup.scale.set(1, 1, flatten);
  const showPieces = t < T.swapSolid;
  gGroup.visible = showPieces;
  if (!showPieces) return;
  for (const a of A) {
    const pe = spring(t - a.tExp, 0.95, 0.66);
    const pg = spring(t - a.tG, 0.8, 0.74);
    const cloudness = clamp01(pe - pg);
    _v.copy(a.sHome).lerp(a.cloud, pe);
    _v.addScaledVector(_v2.copy(a.gHome).sub(a.cloud), pg);
    // gentle floating while dispersed
    _v.y += Math.sin(t * 1.3 + a.bob) * 0.12 * cloudness;
    _v.x += Math.cos(t * 1.1 + a.bob) * 0.08 * cloudness;
    a.mesh.position.copy(_v);
    a.mesh.quaternion.setFromAxisAngle(a.axis, (a.angle + a.spin * (t - a.tExp)) * cloudness);
    const useG = t >= a.tSwap;
    const geo = useG ? a.gGeo : a.sGeo;
    if (geo) {
      if (a.mesh.geometry !== geo) a.mesh.geometry = geo;
      // pieces without a partner shrink out / grow in while dispersed
      const partnerMissing = useG ? !a.sGeo : !a.gGeo;
      let s = 1;
      if (partnerMissing) s = useG ? smoothstep(a.tSwap, a.tSwap + 0.5, t) : 1 - smoothstep(a.tSwap - 0.5, a.tSwap, t);
      a.mesh.scale.setScalar(Math.max(1e-3, s));
      a.mesh.visible = s > 0.002;
    } else {
      a.mesh.visible = false;
    }
  }
}

function sGroupTransform(t) {
  // approach → travel → click, then the signature move to the name position
  const travel = spring(t - T.lockMove, 1.05, 0.9);
  const click = spring(t - T.lockClick, 2.6, 0.42);
  const zMid = 1.55;
  const z = lerp(S_APPROACH.pos.z, zMid, travel) + (MONO_S.pos.z - zMid) * click;
  const rotY = S_APPROACH.rotY * (1 - travel);
  const sigP = spring(t - (T.sig + 0.25), 0.46, 0.95);
  const pos = _v.set(MONO_S.pos.x, MONO_S.pos.y, z).lerp(nameS.pos, sigP);
  const sc = lerp(MONO_S.scale, 1, smoothstep(0, 0.6, sigP));
  const flatten = lerp(1, NAME_DEPTH / LETTER_DEPTH, smoothstep(T.sig + 0.3, T.sig + 1.2, t));
  sGroup.position.copy(pos);
  sGroup.rotation.set(0, rotY, 0);
  sGroup.scale.set(sc, sc, sc * flatten);
  sGroup.updateMatrixWorld(true);
}

function updateSetB(t) {
  sGroupTransform(t);
  const active = t > T.crysStart - 0.2 && t < T.swapSolid;
  sGroup.visible = active;
  if (!active) return;
  _mi.copy(sGroup.matrixWorld).invert();
  for (const b of B) {
    const appear = smoothstep(b.tAppear, b.tAppear + 0.3, t);
    if (appear <= 0) { b.mesh.visible = false; continue; }
    b.mesh.visible = true;
    const p = spring(t - b.tFly, 1.05, 0.8);
    const startLocal = _v.copy(b.startWorld).applyMatrix4(_mi);
    b.mesh.position.copy(startLocal).lerp(b.home, p);
    b.mesh.quaternion.copy(b.q0).slerp(QI, clamp01(p));
    // pieces crystallise at the fragment's scale, then grow to full size as they arrive
    b.mesh.scale.setScalar(Math.max(1e-3, appear * lerp(0.35, 1, clamp01(p * 1.2))));
  }
}

function updateFragments(t, camQuat) {
  for (const F of FR) {
    const fadeIn = smoothstep(F.tSpawn, F.tSpawn + 0.55, t);
    const fadeOut = 1 - smoothstep(F.tCrys - 0.15, F.tCrys + 0.12, t);
    const o = F.peak * fadeIn * fadeOut;
    F.mesh.visible = o > 0.003;
    if (!F.mesh.visible) continue;
    F.mat.opacity = o;
    fragPosition(F, t, F.mesh.position);
    F.mesh.quaternion.copy(camQuat);
    F.mesh.rotateZ(F.tilt);
    F.mesh.scale.setScalar(F.size * lerp(0.55, 1, fadeIn) * lerp(0.4, 1, fadeOut));
  }
}

function updateName(t) {
  const swap = t >= T.swapSolid;
  // material: machined graphite → ivory typography during the pull-back
  const m = smoothstep(T.sig + 0.25, T.sig + 1.1, t);
  pieceMat.color.copy(METAL.color).lerp(IVORY.color, m);
  pieceMat.metalness = lerp(METAL.metalness, IVORY.metalness, m);
  pieceMat.roughness = lerp(METAL.roughness, IVORY.roughness, m);
  pieceMat.emissive.copy(METAL.emissive).lerp(IVORY.emissive, m);
  pieceMat.bumpScale = lerp(0.35, 0.0, m);

  // initials: hand-over from components to solid letters (same transform)
  solidS.visible = swap; solidG.visible = swap;
  if (swap) {
    solidS.position.copy(sGroup.position); solidS.quaternion.copy(sGroup.quaternion);
    solidS.scale.copy(sGroup.scale);
    solidG.position.copy(gGroup.position); solidG.scale.copy(gGroup.scale);
  }
  // remaining letters rise out of a slot at the baseline, in the wake of their initial
  slot.constant = -(NAME_BASE_Y - 0.45);   // below the round-letter overshoot
  for (const n of NAME_MESHES) {
    if (n.isInitial) continue;
    const p = spring(t - n.tRise, 0.95, 0.88);
    n.mesh.visible = t > n.tRise;
    if (!n.mesh.visible) continue;
    n.mesh.position.set(n.L.pos.x, n.L.pos.y - 11.5 * (1 - p), lerp(-0.8, 0, p));
    n.mesh.rotation.set(lerp(14 * DEG, 0, p), 0, 0);
  }
}

function updateTagline(t) {
  for (const w of TAG) {
    const t0 = T.tagIn + w.wi * 0.12;
    const p = spring(t - t0, 0.7, 1.0);
    w.mat.opacity = clamp01(p * 1.1);
    for (const L of w.letters) {
      // tracking opens up into place
      L.m.position.set(w.wcx + (L.home.x - w.wcx) * lerp(0.86, 1, p), L.home.y - (1 - p) * 0.6, 0);
      L.m.visible = p > 0.002;
    }
    if (w.sep) {
      const ps = spring(t - (T.tagIn + 0.35 + w.wi * 0.12), 0.9, 1.0);
      w.sep.material.opacity = clamp01(ps * 1.1);
      w.sep.scale.set(1, Math.max(1e-3, ps), 1);
      w.sep.visible = ps > 0.002;
    }
  }
}

computeRiseTimes();
let currentFrame = 0;
export function renderFrame(t) {
  t = Math.min(Math.max(t, 0), DURATION);
  updateCamera(t);
  setSweep(t);
  updateSetA(t);
  updateSetB(t);
  updateFragments(t, camera.quaternion);
  updateName(t);
  updateTagline(t);
  // shadow frustum follows the action
  key.target.position.set(track(CAM.tx, t), track(CAM.ty, t), 0);
  key.position.copy(key.target.position).add(_v.set(-22, 30, 26));
  finish.uniforms.uFrame.value = Math.round(t * FPS) % 977;
  composer.render();
  currentFrame = Math.round(t * FPS);
}

// warm up shader programs so the first captured frame is final
renderFrame(4.5); renderFrame(11.5); renderFrame(14.9);

window.REVEAL = { renderFrame, W, H, FPS, DURATION, ready: true };
window.dispatchEvent(new Event('reveal-ready'));
