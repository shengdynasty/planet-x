// Parallax-distance estimator (scripts/parallax-distance.mjs). Plain Node, no network:  node tests/parallax.test.mjs
import { predictAtB } from '../scripts/link-fields.mjs';
import { estimateDistance, ownMotionMax } from '../scripts/parallax-distance.mjs';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const R2D = 180 / Math.PI, A0 = { ra: 76.9565, dec: 30.4014, mjd: 60920 }, mjdB = 61107.7, dt = mjdB - A0.mjd;
const at = (A, mB, r) => predictAtB({ ra: A.ra, dec: A.dec, mjdA: A.mjd, mjdB: mB, distAU: r });
const move = (p, east, north) => ({ ra: p.ra + east / 3600 / Math.cos(p.dec / R2D), dec: p.dec + north / 3600 });

// 1. no noise, no own motion: the distance comes back, from several places on the sky
for (const [ra, dec] of [[76.96, 30.4], [200, -40], [10, 5], [310, 60]]) for (const r of [300, 750, 2000]) {
  const A = { ra, dec, mjd: 60920 }, p = at(A, mjdB, r), e = estimateDistance({ A, B: { ra: p.ra, dec: p.dec, mjd: mjdB } });
  if (e.verdict !== 'trans-neptunian') { ok(e.verdict === 'ambiguous' && e.loAU <= r && r <= e.hiAU, `(${ra}, ${dec}) ${r} AU: weak geometry reported as ambiguous ${e.loAU.toFixed(0)}–${e.hiAU.toFixed(0)} AU`); continue; }
  ok(Math.abs(e.distAU / r - 1) < 0.03 && e.loAU <= r && r <= e.hiAU, `(${ra}, ${dec}) ${r} AU → ${e.distAU.toFixed(0)} AU (${e.loAU.toFixed(0)}–${e.hiAU.toFixed(0)})`); }

// 2. noise and own motion up to the bound-orbit limit, random sky and dates: the truth must lie inside the error bar
{ let n = 0, inside = 0; const half = [];
  for (let k = 0; k < 500; k++) {
    const A = { ra: rnd() * 360, dec: Math.asin(2 * rnd() - 1) * R2D, mjd: 60920 + rnd() * 100 }, mB = A.mjd + 150 + rnd() * 60, r = 300 * Math.pow(2000 / 300, rnd());
    const p = at(A, mB, r), own = ownMotionMax(r, mB - A.mjd) * rnd(), th = rnd() * 2 * Math.PI, q = move(p, own * Math.sin(th) + 0.9 * gauss(), own * Math.cos(th) + 0.9 * gauss());
    const e = estimateDistance({ A, B: { ...q, mjd: mB } }); n++; if (e.loAU != null && e.loAU <= r && r <= e.hiAU) inside++; if (e.verdict === 'trans-neptunian') half.push((e.hiAU - e.loAU) / 2 / r); }
  half.sort((a, b) => a - b);
  ok(inside / n >= 0.99, `500 random bodies at 300–2000 AU (0.9″ noise, own motion up to the limit): truth inside the error bar in ${(100 * inside / n).toFixed(1)}%`);
  ok(half[half.length >> 1] < 0.15, `median half-width of the error bar ${(100 * half[half.length >> 1]).toFixed(1)}% of the distance`); }

// 3. worst case: own motion exactly at the limit, along the parallax line, both ways
for (const r of [500, 1500]) for (const sgn of [-1, 1]) {
  const p = at(A0, mjdB, r), m = sgn * ownMotionMax(r, dt), th = p.pa / R2D, q = move(p, m * Math.sin(th), m * Math.cos(th)), e = estimateDistance({ A: A0, B: { ...q, mjd: mjdB } });
  ok(e.loAU <= r && r <= e.hiAU, `own motion ${m.toFixed(0)}″ (the limit) at ${r} AU: truth inside ${e.loAU.toFixed(0)}–${e.hiAU.toFixed(0)}`); }

// 4. what is NOT parallax is not given a distance
{ const e = estimateDistance({ A: A0, B: { ...move(A0, 0.5, -0.4), mjd: mjdB } });
  ok(e.verdict === 'no-parallax' && e.loAU > 5e4, `a source that did not move: no-parallax, farther than ${e.loAU.toFixed(0)} AU`);
  for (const [name, E, N] of [['5.3″ east (Barnard\'s-Star-like proper motion)', 5.3, 0], ['5.3″ south', 0, -5.3]]) { const x = estimateDistance({ A: A0, B: { ...move(A0, E, N), mjd: mjdB } }); ok(x.verdict === 'inconsistent', `a star with ${name}: not parallax (${x.verdict})`); }
  const p = at(A0, mjdB, 750), th = (p.pa + 90) / R2D, x = estimateDistance({ A: A0, B: { ...move(A0, 400 * Math.sin(th), 400 * Math.cos(th)), mjd: mjdB } });
  ok(x.verdict === 'inconsistent', `400″ perpendicular to the parallax direction: not parallax (${x.verdict})`);
  const y = estimateDistance({ A: A0, B: { ...move(A0, 2000, 2200), mjd: mjdB } }); ok(y.verdict === 'inconsistent', `2,970″ in a random direction: not parallax (${y.verdict})`); }

// 5. a bigger position error widens the bar; the measured numbers are reported
{ const p = at(A0, mjdB, 750), B = { ra: p.ra, dec: p.dec, mjd: mjdB }, e1 = estimateDistance({ A: A0, B, sigma: 0.5 }), e2 = estimateDistance({ A: A0, B, sigma: 8 });
  ok(e2.hiAU - e2.loAU > e1.hiAU - e1.loAU, `σ 8″ gives a wider bar than σ 0.5″ (${(e2.hiAU - e2.loAU).toFixed(0)} vs ${(e1.hiAU - e1.loAU).toFixed(0)} AU)`);
  ok(Math.abs(e1.measured.shiftArcsec - p.shiftArcsec) < 0.01 && Math.abs(e1.measured.pa - p.pa) < 0.01, 'measured shift and position angle match the geometry'); }
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
