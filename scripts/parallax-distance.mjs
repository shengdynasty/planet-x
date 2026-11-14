#!/usr/bin/env node
// Parallax-distance estimator: how far away is a body that was at (ra, dec) in pass A and is at (ra, dec) in pass B?
//
// Earth moves ~2 AU between two SPHEREx passes, so a distant body that does not move by itself shifts by parallax:
// the size of the shift gives its distance (~820″ at 500 AU, ~410″ at 1000 AU) and the DIRECTION of the shift is fixed
// by where Earth went. We use both. For every trial heliocentric distance r from 10 AU to `maxAU`:
//   predicted B position = predictAtB(A, r)   (scripts/link-fields.mjs: exact Earth positions, same simplifications)
//   accept r when the measured B position is within   nSigma·σ  +  ownMotionMax(r)   of the predicted one.
// (Starting at 10 AU: a body at 5 AU may move 19° by itself between passes, which would "explain" any shift; bodies that near are told apart by their motion within a pass, not here.)
// ownMotionMax(r) is the largest displacement the body's OWN orbital motion can add in the time between the passes if it
// is bound to the Sun: speed ≤ escape speed 2π·√2/√r AU/yr, all of it sideways, i.e. 8.886·(Δt/yr)/r^1.5 · 206265″.
// It is ~80″ at 500 AU, ~30″ at 1000 AU over six months, and it grows fast inside ~50 AU, where it swamps the parallax.
// So the accepted distances form an interval, and the verdict follows from where the interval sits:
//   'trans-neptunian'  the interval lies at 100 AU or more and ends below maxAU: a distance with an error bar
//   'solar-system'     the interval ends below 100 AU: own motion is as big as the parallax, no distance can be given
//   'ambiguous'        the interval spans 100 AU
//   'no-parallax'      the shift is within the noise: only a lower limit (a star, a galaxy, a very distant body)
//   'inconsistent'     no distance explains the shift: it moves differently from parallax (high-proper-motion star,
//                      a wrong pairing, an artifact)
//
// What the error bar means: for a body bound to the Sun, with position noise σ, the true distance lies inside it
// (the own-motion allowance is an upper bound, not a typical value, so the interval is deliberately wide).
// Not covered: bodies on unbound orbits, a wrong pairing that happens to sit on the parallax line, and blends.
//
// Usage:
//   node scripts/parallax-distance.mjs --raA 70.26 --decA 19.06 --mjdA 60923.7 --raB 70.1 --decB 19.0 --mjdB 61086.6 [--sigma 1.3] [--json]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { predictAtB, sepArcsec } from './link-fields.mjs';

export const R_MIN = 10, R_MAX = 1e6, SOLAR_SYSTEM_AU = 100;
export const SIGMA_PAIR = 1.3;   // ″: 0.9″ median position error per epoch (injection test, docs/WRITEUP.md) × √2 for the difference
const ARCSEC_PER_RAD = 206264.806;

/** Largest displacement (″) the body's own motion can add over `dtDays` at heliocentric distance r (AU), if bound to the Sun. */
export const ownMotionMax = (r, dtDays) => 8.886 * (Math.abs(dtDays) / 365.25) / Math.pow(r, 1.5) * ARCSEC_PER_RAD;

/**
 * @param {{A:{ra:number,dec:number,mjd:number}, B:{ra:number,dec:number,mjd:number}, sigma?:number, nSigma?:number, maxAU?:number}} o
 *   A, B: measured positions (degrees) and times (MJD) in the two passes. sigma: position error of the shift, arcsec.
 * @returns {{verdict:string, distAU:number|null, loAU:number|null, hiAU:number|null, measured:{shiftArcsec:number,pa:number},
 *   predictedShiftArcsec:number|null, residualArcsec:number|null, text:string}}
 */
export function estimateDistance({ A, B, sigma = SIGMA_PAIR, nSigma = 3, maxAU = R_MAX }) {
  const dt = B.mjd - A.mjd, shift = sepArcsec(A.ra, A.dec, B.ra, B.dec), pa = bearing(A, B);
  const mk = r => predictAtB({ ra: A.ra, dec: A.dec, mjdA: A.mjd, mjdB: B.mjd, distAU: r });
  // signed margin: > 0 means r is accepted
  const margin = r => { const p = mk(r); return nSigma * sigma + ownMotionMax(r, dt) - sepArcsec(p.ra, p.dec, B.ra, B.dec); };
  const n = 1400, grid = Array.from({ length: n + 1 }, (_, i) => R_MIN * Math.pow(maxAU / R_MIN, i / n)), m = grid.map(margin);
  // contiguous accepted intervals, edges refined by bisection
  const iv = []; let start = null;
  const edge = (r0, r1) => { let lo = r0, hi = r1; const acc = margin(r0) > 0; for (let k = 0; k < 40; k++) { const mid = Math.sqrt(lo * hi); if ((margin(mid) > 0) === acc) lo = mid; else hi = mid; } return Math.sqrt(lo * hi); };
  for (let i = 0; i <= n; i++) {
    if (m[i] > 0 && start === null) start = i === 0 ? { r: grid[0], i } : { r: edge(grid[i - 1], grid[i]), i };
    if ((m[i] <= 0 || i === n) && start !== null) { const last = m[i] > 0 ? i : i - 1, hi = m[i] > 0 ? grid[n] : edge(grid[i - 1], grid[i]); iv.push({ lo: start.r, hi, i0: start.i, i1: last }); start = null; }
  }
  const base = { measured: { shiftArcsec: shift, pa }, intervals: iv.map(v => ({ loAU: v.lo, hiAU: v.hi })) };
  if (!iv.length) return { ...base, verdict: 'inconsistent', distAU: null, loAU: null, hiAU: null, predictedShiftArcsec: null, residualArcsec: null,
    text: `${shift.toFixed(0)}″ at PA ${pa.toFixed(0)}° is not parallax at any distance from ${R_MIN} to ${maxAU} AU: it moves differently (a high-proper-motion star, a wrong pairing, or an artifact)` };
  // Primary answer: among intervals that reach 100 AU or more (the Planet X regime) the one with the largest margin; only when
  // there is none, a nearer one. A nearer interval can coexist with it (when the line of sight lies close to Earth's direction of
  // travel every shift is small, so a 10–30 AU body fits too): that is reported as `alsoNearAU`, not silently dropped.
  const closed = iv.filter(v => v.lo > R_MIN * 1.01), far = closed.filter(v => v.hi >= SOLAR_SYSTEM_AU), pool = far.length ? far : closed.length ? closed : iv;   // an interval that touches R_MIN has no near edge: it cannot be told from 'any distance below its end'
  let V = pool[0], bm = -Infinity; for (const v of pool) for (let i = v.i0; i <= v.i1; i++) if (m[i] > bm) { bm = m[i]; V = v; }
  const near = iv.filter(v => v !== V && v.lo < SOLAR_SYSTEM_AU), alsoNearAU = near.length ? Math.max(...near.map(v => v.hi)) : null;
  let best = V.lo, bres = Infinity;
  for (let k = 0; k <= 400; k++) { const r = V.lo * Math.pow(V.hi / V.lo, k / 400), q = mk(r), sp = sepArcsec(q.ra, q.dec, B.ra, B.dec); if (sp < bres) { bres = sp; best = r; } }
  const p = mk(best), out = { ...base, alsoNearAU, distAU: best, loAU: V.lo, hiAU: V.hi, predictedShiftArcsec: p.shiftArcsec, residualArcsec: bres };
  const fmt = v => v >= 1e4 ? (Math.round(v / 1000) * 1000).toLocaleString('en-US') : v >= 1000 ? v.toFixed(0) : v.toFixed(v < 100 ? 1 : 0);
  if (V.hi >= maxAU * 0.999) return { ...out, verdict: 'no-parallax', distAU: null, text: `no parallax beyond the noise (shift ${shift.toFixed(1)}″): farther than ${fmt(V.lo)} AU (${nSigma}σ), a star, a galaxy or a very distant body` };
  if (V.hi < SOLAR_SYSTEM_AU) return { ...out, verdict: 'solar-system', distAU: null, text: `inside ${fmt(V.hi)} AU: the body's own motion is as large as the parallax, so no distance can be given (an asteroid, comet or Kuiper-belt object)` };
  if (V.lo < SOLAR_SYSTEM_AU) return { ...out, verdict: 'ambiguous', text: `between ${fmt(V.lo)} and ${fmt(V.hi)} AU: own motion and parallax cannot be told apart here` };
  return { ...out, verdict: 'trans-neptunian', text: `${fmt(best)} AU (${fmt(V.lo)}–${fmt(V.hi)} AU): the shift ${shift.toFixed(0)}″ at PA ${pa.toFixed(0)}° matches parallax, residual ${bres.toFixed(0)}″` + (alsoNearAU ? `; a body nearer than ${fmt(alsoNearAU)} AU would also fit (its motion within a pass would tell)` : '') };
}

/** Bearing of B from A, degrees east of north. */
export function bearing(A, B) {
  const d2r = Math.PI / 180, dra = (B.ra - A.ra) * d2r, y = Math.sin(dra) * Math.cos(B.dec * d2r), x = Math.cos(A.dec * d2r) * Math.sin(B.dec * d2r) - Math.sin(A.dec * d2r) * Math.cos(B.dec * d2r) * Math.cos(dra);
  return ((Math.atan2(y, x) / d2r) % 360 + 360) % 360;
}

// ---------- CLI ----------
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } return o; }
function main() {
  const o = parseArgs(process.argv.slice(2));
  for (const k of ['raA', 'decA', 'mjdA', 'raB', 'decB', 'mjdB']) if (!Number.isFinite(+o[k])) { console.error(`missing --${k}`); process.exit(2); }
  const r = estimateDistance({ A: { ra: +o.raA, dec: +o.decA, mjd: +o.mjdA }, B: { ra: +o.raB, dec: +o.decB, mjd: +o.mjdB }, sigma: o.sigma ? +o.sigma : SIGMA_PAIR });
  if (o.json) console.log(JSON.stringify(r, null, 1)); else console.log(`${r.verdict}: ${r.text}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
