// Pipeline parity + API tests. Plain Node, no browser:  node tests/pipeline.test.mjs   (from the repo root)
// The fixture tests/fixtures/moving-sky-analyse.json was dumped from artifacts/moving-sky/index.html via its
// #test hook (regenerate with: node tests/fixtures/make-moving-sky-fixture.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../app/js/pipeline/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/moving-sky-analyse.json'), 'utf8'));
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL ' + m); } };
const R = v => Math.round(v * 1e4) / 1e4;
const pt = q => q ? { x: R(q.x), y: R(q.y), peak: R(q.peak) } : null;

const field = P.simulateField();
ok(field.N === 320 && field.scale === 6.15 && field.simulated === true && field.epochs.length === 8, 'field shape');
ok(JSON.stringify(field.epochs) === JSON.stringify(fx.epochs), 'epochs identical to Moving Sky');

// 1. analyse() parity over all 30 ordered same-wavelength pairs
ok(fx.pairs.length === 30, 'fixture has 30 ordered same-wavelength pairs');
let nRes = 0;
for (const { a, b, results } of fx.pairs) {
  const got = P.analyse(field, a, b).map(r => ({ kind: r.kind, title: r.title, detail: r.detail, x: R(r.x), y: R(r.y), from: pt(r.from), to: pt(r.to) }));
  nRes += got.length;
  const same = JSON.stringify(got) === JSON.stringify(results);
  ok(same, `analyse(${a},${b}) matches Moving Sky`);
  if (!same) { console.log('  want', JSON.stringify(results)); console.log('  got ', JSON.stringify(got)); }
}
console.log(`analyse parity: ${fx.pairs.length} pairs, ${nRes} results compared`);

// 2. formatting parity
for (const [d, dt, rate] of fx.fmt) ok(P.fmtDt(d) === dt && P.fmtRate(100, d) === rate, `fmtDt/fmtRate(${d})`);

// 3. caching: same objects back, frames shared across re-centred fields
ok(P.analyse(field, 0, 5) === P.analyse(field, 0, 5), 'analyse cached per field+pair');
ok(P.detect(field.frame(0), 5) === P.detect(field.frame(0), 5), 'detect cached per frame');
ok(P.stats(field.frame(0)) === P.stats(field.frame(0)), 'stats cached per frame');
ok(P.diff(field, 0, 5) === P.diff(field, 0, 5) && P.diff(field, 0, 5) !== P.diff(field, 5, 0), 'diff cached per ordered pair');
const moved = P.simulateField({ ra0: 100, dec0: -20 });
ok(moved.frame(3) === field.frame(3) && moved.ra0 === 100, 're-centred sim shares frames');
ok(JSON.stringify(P.analyse(moved, 0, 5).map(r => r.title)) === JSON.stringify(P.analyse(field, 0, 5).map(r => r.title)), 're-centred sim gives same results');

// 4. diff / maxStack values
const d = P.diff(field, 0, 5), f0 = field.frame(0), f5 = field.frame(5);
ok(d[1234] === Math.fround(f5[1234] - f0[1234]), 'diff = B − A');
const st = P.maxStack(field, 0.95, 0, 5);
ok(JSON.stringify(st.idx) === '[0,1,3,4,5]' && st.ts.length === 5, 'maxStack picks same-band passes in the window');
ok(st === P.maxStack(field, 0.95, 5, 0), 'maxStack cached per band+span (order-free)');
ok(st.img[777] >= f0[777] && st.img[777] >= f5[777], 'maxStack is a pixel max');

// 5. radec / pixel round trip, centre
const [ra, dec] = P.radec(field, 160, 160);
ok(ra === 70.42 && dec === 19.18, 'radec centre');
const [px, py] = P.pixel(field, ...P.radec(field, 37.5, 250.25));
ok(Math.abs(px - 37.5) < 1e-9 && Math.abs(py - 250.25) < 1e-9, 'pixel inverts radec');
ok(P.fmtRA(70.42) === '04h 41m 40.8s' && P.fmtDec(19.18) === '+19° 10′ 48″', 'fmtRA / fmtDec');

// 6. spectrum shape
for (const k of ['asteroid', 'ice', 'star']) { const s = P.spectrum(k); ok(s.length === 102 && Math.abs(s[0][0] - 0.75) < 1e-12 && Math.abs(s[101][0] - 5) < 1e-12, 'spectrum ' + k); }

// 7. generic Field: tiny synthetic live-like field (N=64, two epochs, one mover, nothing known)
{
  const N = 64, mk = (x0) => { const r = P.rng(7), g = new Float32Array(N * N); for (let p = 0; p < N * N; p++) g[p] = 1 + 0.05 * P.gauss(r);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) g[(30 + dy) * N + x0 + dx] += 3 * Math.exp(-(dx * dx + dy * dy) / 2.6); return g; };
  const frames = [mk(20), mk(40)];
  const live = { N, scale: 6.15, ra0: 10, dec0: 0, epochs: [{ t: 0, band: 2, label: 'a', sub: '' }, { t: 180, band: 2, label: 'b', sub: '' }], frame: i => frames[i], known: [], simulated: false };
  const res = P.analyse(live, 0, 1);
  ok(res.length === 1 && res[0].kind === 'cand' && res[0].title === 'Uncatalogued mover' && Math.abs(res[0].x - 40) < 0.5, 'generic N=64 field finds the mover: ' + JSON.stringify(res.map(r => r.title)));
}

// 8. PSF sampling: the spike limit scales with the PSF; the simulation keeps Moving Sky's 3.2 exactly
ok(P.spikeLimit(P.SIM_PSF_SIGMA) === 3.2 && P.psfModel(field).sigma === 1.15 && P.psfModel(field).spikeMax === 3.2, 'sim PSF: σ 1.15 px, spike limit exactly 3.2');
ok(Math.abs(P.sigmaOfSpike(P.spikeOf(0.68)) - 0.68) < 1e-6 && P.spikeLimit(0.68) > 7, 'spikeOf / sigmaOfSpike invert; undersampled limit > 7');

// 9. undersampled synthetic field (σ = 0.55 px, like SPHEREx's 6.6″ FWHM at 6.15″/px): stars in every epoch,
//    a catalogued asteroid and an uncatalogued transient in epoch 1 only, a cosmic-ray streak and a hot pixel.
{
  const N = 48, S = 0.55, r = P.rng(42), stars = [];
  for (let i = 0; i < 14; i++) stars.push({ x: 6 + r() * 36, y: 6 + r() * 36, a: 3 + 30 * r() });
  const psf = (g, x, y, a) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
    g[Y * N + X] += a * Math.exp(-((X - x) ** 2 + (Y - y) ** 2) / (2 * S * S)); } };
  const mk = i => { const q = P.rng(100 + i), g = new Float32Array(N * N); for (let p = 0; p < N * N; p++) g[p] = 0.5 + 0.02 * P.gauss(q);
    for (const s of stars) psf(g, s.x, s.y, s.a);
    if (i === 1) { psf(g, 40.3, 33.6, 20); psf(g, 19.4, 40.7, 6);                       // asteroid (known), transient (not)
      g[10 * N + 41] += 60; g[9 * N + 41] += 21; g[11 * N + 41] += 21;                 // vertical cosmic-ray streak
      g[40 * N + 8] += 9; }                                                             // hot pixel
    return g; };
  const frames = [mk(0), mk(1), mk(2)];
  const asteroid = { name: '(99999) Testoid', source: 'JPL Horizons (geocentric)', pos: t => t === 180 ? [40.35, 33.55] : [-999, -999] };
  const f = { N, scale: 6.15, ra0: 10, dec0: 5, epochs: [0, 180, 360].map(t => ({ t, band: 1.86, label: t + ' d', sub: '' })), frame: i => frames[i], known: [asteroid], simulated: false };
  const pm = P.psfModel(f);
  ok(pm.from === 'stars' && Math.abs(pm.sigma - S) < 0.2, `PSF measured from the stars: σ ${pm.sigma.toFixed(2)} px from ${pm.nStars} stars`);
  const ast = P.detect(frames[1], 5).find(s => Math.hypot(s.x - 40.3, s.y - 33.6) < 1);
  ok(ast && ast.spike > 3.2, `asteroid is sharper than the old fixed limit (spike ${ast && ast.spike.toFixed(1)} > 3.2)`);
  const res = P.analyse(f, 0, 1), at = (x, y) => res.find(q => Math.hypot(q.x - x, q.y - y) < 1.5);
  ok(at(40.3, 33.6)?.kind === 'known' && /″ from JPL Horizons/.test(at(40.3, 33.6).detail), 'catalogued asteroid → known object, with offset from the ephemeris');
  ok(at(19.4, 40.7)?.kind === 'cand', 'PSF-shaped transient → candidate');
  ok(at(41, 10)?.kind === 'art', 'cosmic-ray streak → artifact');
  ok(at(8, 40)?.kind === 'art', 'hot pixel → artifact');
  ok(res.filter(q => q.kind !== 'art').length === 2, 'no stars flagged: ' + JSON.stringify(res.map(q => q.kind + ':' + q.title)));
  // ephemeris wins: put the ephemeris on the hot pixel
  const f2 = { ...f, known: [{ ...asteroid, name: 'Hot-pixel twin', pos: t => t === 180 ? [8, 40] : [-999, -999] }] };
  ok(P.analyse(f2, 0, 1).find(q => Math.hypot(q.x - 8, q.y - 40) < 1.5)?.kind === 'known', 'an ephemeris match wins over the artifact test');
}

// 10. real SPHEREx field (tests/fixtures/spherex-psyche-field.json, from /api/field?ra=70.2635&dec=19.0558&size=300&det=3&t=61087.1294):
//     16 Psyche is in the 15 Feb 2026 frame only; that frame also has cosmic-ray streaks and bad pixels.
{
  const { toField } = await import('../app/js/data/index.js');
  const f = toField(JSON.parse(fs.readFileSync(path.join(here, 'fixtures/spherex-psyche-field.json'), 'utf8')));
  const pm = P.psfModel(f);
  ok(pm.from === 'stars' && pm.sigma > 0.5 && pm.sigma < 0.9, `real PSF σ ${pm.sigma.toFixed(2)} px from ${pm.nStars} stars`);
  const res = P.analyse(f, 0, 1), psy = res.find(q => /Psyche/.test(q.title));
  ok(psy && psy.kind === 'known' && Math.hypot(psy.x - 21.49, psy.y - 23.58) < 0.33, '16 Psyche → known object, within 2″ of Horizons');
  ok(!res.some(q => q.kind !== 'known' && Math.hypot(q.x - 21.5, q.y - 23.5) < 2), 'nothing else flagged at Psyche');
  for (const [x, y] of [[16.6, 5.9], [22.1, 6.4], [20.6, 10.3]]) ok(res.find(q => Math.hypot(q.x - x, q.y - y) < 1)?.kind === 'art', `cosmic ray / bad pixel at (${x}, ${y}) → artifact`);
  ok(res.filter(q => q.kind === 'cand').length <= 1, 'at most one candidate left: ' + JSON.stringify(res.filter(q => q.kind === 'cand').map(q => q.title)));
  ok(P.analyse(f, 0, 2).every(q => q.kind !== 'cand'), 'Sep 2025 vs Sep 2026: no candidates');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
