// Simulated SPHEREx field, lifted from artifacts/moving-sky (same seeds, same arithmetic, same frames).
// Pure: no DOM. Frames are generated lazily and shared by every simulated Field, so re-centred copies
// (data/getField in sim mode) reuse the same pixels and the detection caches keyed on them.

export const SIM_N = 320;          // pixels per side
export const SIM_SCALE = 6.15;     // arcsec per pixel (SPHEREx)
export const SIM_RA0 = 70.42, SIM_DEC0 = 19.18; // Taurus, near the ecliptic
const SIG = 1.15;                  // PSF sigma, px

export const SIM_EPOCHS = Object.freeze([
  { t: 0,       band: 0.95, label: '0 d',    sub: '0.95 µm' },
  { t: 0.00167, band: 0.95, label: '+2 min', sub: '0.95 µm' },
  { t: 0.42,    band: 1.62, label: '+10 h',  sub: '1.62 µm' },
  { t: 1.0,     band: 0.95, label: '+1 d',   sub: '0.95 µm' },
  { t: 2.0,     band: 0.95, label: '+2 d',   sub: '0.95 µm' },
  { t: 183.0,   band: 0.95, label: '+183 d', sub: '0.95 µm' },
  { t: 184.0,   band: 3.29, label: '+184 d', sub: '3.29 µm' },
  { t: 366.0,   band: 0.95, label: '+366 d', sub: '0.95 µm' },
].map(Object.freeze));

export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function gauss(r) { const u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const N = SIM_N;
const stars = []; { const r = rng(20261114);
  for (let i = 0; i < 230; i++) { const amp = Math.exp(gauss(r) * 1.1 - 0.4); stars.push({ x: r() * N, y: r() * N, amp: Math.min(amp, 60), c: 0.3 + r() * 1.2 }); } }
const starFlux = (s, band) => s.amp * Math.exp(-s.c * (band - 0.95));

const P = 2 * Math.PI / 365.25;
/** Planted objects (ground truth; pixel positions, t in days). Exposed as field.truth for tests and the dev page. */
export const SIM_OBJ = Object.freeze({
  asteroid: { name: 'Main-belt asteroid (catalogued)', kind: 'known',
    pos: t => t <= 2.5 ? [38 + 27 * t, 262 - 9 * t] : [-999, -999],
    flux: band => 7.5 * (1 + 0.25 * (band - 0.95)) + (band > 3 ? 2.5 * (band - 3) : 0),
    spec: 'asteroid' },
  px: { name: 'Slow uncatalogued mover', kind: 'cand',
    // ~500 AU: Keplerian drift ~0.03°/yr (0.05 px/day) plus the yearly parallax loop (1 AU/500 AU ≈ 410″ ≈ 55–67 px)
    pos: t => [188 + 0.05 * t + 55 * Math.sin(P * t), 118 + 0.02 * t + 22 * Math.cos(P * t)],
    flux: band => 1.35 * (band > 3 ? 0.35 : 1),
    spec: 'ice' },
  variable: { name: 'Variable star', kind: 'var', pos: () => [96, 92],
    flux: (band, t) => (t > 100 ? 9.5 : 4.2) * Math.exp(-0.5 * (band - 0.95)), spec: 'star' },
});
export const SIM_ARTIFACT = Object.freeze({ epoch: 3, x: 261, y: 71, amp: 5.5 });

const frames = new Map();
function simFrame(i) {
  if (frames.has(i)) return frames.get(i);
  const e = SIM_EPOCHS[i]; if (!e) throw new RangeError('no epoch ' + i);
  const r = rng(1000 + i), img = new Float32Array(N * N);
  const bg = 0.6 + 1.3 * (e.band - 0.75);
  for (let p = 0; p < N * N; p++) { const y = (p / N) | 0; img[p] = bg * (1 + 0.08 * (y / N)) + 0.11 * gauss(r); }
  const stamp = (x, y, amp) => { const x0 = Math.round(x), y0 = Math.round(y);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x0 + dx, yy = y0 + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const d2 = (xx - x) ** 2 + (yy - y) ** 2; img[yy * N + xx] += amp * Math.exp(-d2 / (2 * SIG * SIG)); } };
  for (const s of stars) stamp(s.x, s.y, starFlux(s, e.band));
  for (const k in SIM_OBJ) { const o = SIM_OBJ[k], [x, y] = o.pos(e.t); if (x > -5) stamp(x, y, o.flux(e.band, e.t)); }
  if (i === SIM_ARTIFACT.epoch) img[SIM_ARTIFACT.y * N + SIM_ARTIFACT.x] += SIM_ARTIFACT.amp;
  frames.set(i, img); return img;
}

/**
 * The Moving Sky simulated field. opts.ra0 / opts.dec0 (degrees) re-centre it; pixels and results are unchanged.
 * @returns {import('../core/types.js').Field}
 */
export function simulateField(opts = {}) {
  return {
    N, scale: SIM_SCALE,
    ra0: opts.ra0 ?? SIM_RA0, dec0: opts.dec0 ?? SIM_DEC0,
    epochs: SIM_EPOCHS.map(e => ({ ...e })),
    frame: simFrame,
    known: [{ name: SIM_OBJ.asteroid.name, pos: SIM_OBJ.asteroid.pos }], // the "ephemeris service" only knows this one
    simulated: true,
    truth: SIM_OBJ,
  };
}
