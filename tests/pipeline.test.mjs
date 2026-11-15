// Pipeline parity + API tests. Plain Node, no browser:  node tests/pipeline.test.mjs   (from the repo root)
// The fixture tests/fixtures/moving-sky-analyse.json was dumped from artifacts/moving-sky/index.html via its
// #test hook (regenerate with: node tests/fixtures/make-moving-sky-fixture.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../app/js/pipeline/index.js';
import * as CO from '../app/js/sky/coords.js';
import * as CF from '../app/js/candidates/format.js';
import { gridSky, gridPixel } from '../server/lib/wcs.mjs';

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
const mn = P.meanStack(field, 0.95, 0, 5);
ok(JSON.stringify(mn.idx) === '[0,1,3,4,5]' && mn.n === 5 && mn.ts.length === 5, 'meanStack picks the same same-band passes in the window');
ok(mn === P.meanStack(field, 0.95, 5, 0), 'meanStack cached per band+span (order-free)');
{ // inverse-variance weighted mean of sky-subtracted frames, first pass's sky put back
  let num = 0, den = 0; for (const i of mn.idx) { const f = field.frame(i), { med, sig } = P.stats(f), w = 1 / (sig * sig); num += w * (f[777] - med); den += w; }
  const want = P.stats(f0).med + num / den; ok(Math.abs(mn.img[777] - want) < 1e-3, `meanStack is the inverse-variance mean of those passes (${mn.img[777].toFixed(3)} vs ${want.toFixed(3)})`); }
ok(mn.nEff > 4.5 && mn.nEff <= 5 + 1e-9 && Math.abs(mn.gain - Math.sqrt(mn.nEff)) < 1e-9, `five passes of equal depth count as ${mn.nEff.toFixed(2)} effective passes, expected gain √nEff = ${mn.gain.toFixed(2)}×`);
ok(mn.gainMad > 1.5 && P.stats(mn.img).sig < P.stats(f0).sig, `in the noise-dominated simulation the robust scatter really drops (${mn.gainMad.toFixed(2)}×, ideal 2.24)`);
ok(JSON.stringify(mn.bands) === '[0.95]', 'bands lists the wavelengths that went in');
{ const one = P.meanStack(field, 0.95, 0, 0); ok(one.n === 1 && Math.abs(one.gain - 1) < 1e-6 && Math.abs(one.img[777] - f0[777]) < 1e-4, 'a one-pass window is that pass, gain 1'); }
{ const all = P.meanStack(field, null, 0, 5);
  ok(JSON.stringify(all.idx) === '[0,1,2,3,4,5]' && all.n === 6 && JSON.stringify(all.bands) === '[0.95,1.62]', `band null adds every wavelength in the window (${all.n} passes, bands ${all.bands.join('/')})`);
  ok(all.gain > 2 && all.nEff > 5 && all === P.meanStack(field, null, 5, 0), `all-wavelength stack: ${all.nEff.toFixed(2)} effective passes (gain ${all.gain.toFixed(2)}×), cached`); }
{ // a shallow pass must not drag the co-add down: double one frame's noise and the weighted mean still beats the best single pass
  const g = { ...field, frame: i => { const f = field.frame(i); if (i !== 1) return f; const h = Float32Array.from(f), r = P.rng(7); for (let p = 0; p < h.length; p++) h[p] += (r() + r() + r() + r() - 2) * 3 * P.stats(f).sig; return h; } };
  const ws = P.meanStack(g, 0.95, 0, 5); ok(ws.nEff > 4 && ws.nEff < 4.6 && ws.gainMad > 1.8, `a 3× noisier pass is down-weighted: ${ws.nEff.toFixed(2)} effective passes of 5, measured scatter still ${ws.gainMad.toFixed(2)}× lower (a plain mean would be dragged down)`); }

// 5. radec / pixel round trip, centre
const [ra, dec] = P.radec(field, 160, 160);
ok(ra === 70.42 && dec === 19.18, 'radec centre');
const [px, py] = P.pixel(field, ...P.radec(field, 37.5, 250.25));
ok(Math.abs(px - 37.5) < 1e-9 && Math.abs(py - 250.25) < 1e-9, 'pixel inverts radec');
// ISS-15: radec/pixel are the exact TAN grid, identical to the server's, at every declination (corners of a 600″ field)
for (const d0 of [0, 30, 60, 80, 85, 89, -66.5]) {
  const f = { N: 100, scale: 6, ra0: 123.4, dec0: d0 };
  let worst = 0, rt = 0;
  for (const [x, y] of [[0, 0], [100, 0], [0, 100], [100, 100], [37.5, 80.25], [50, 50]]) {
    const [ra, dec] = P.radec(f, x, y), [sa, sd] = gridSky(f.ra0, f.dec0, f.scale, f.N, x, y);
    const dra = ((ra - sa + 540) % 360 - 180) * Math.cos(dec * Math.PI / 180) * 3600, ddec = (dec - sd) * 3600;
    worst = Math.max(worst, Math.hypot(dra, ddec));
    const [px, py] = P.pixel(f, ra, dec); rt = Math.max(rt, Math.abs(px - x), Math.abs(py - y));
    const [gx, gy] = gridPixel(f.ra0, f.dec0, f.scale, f.N, ra, dec); rt = Math.max(rt, Math.abs(px - gx), Math.abs(py - gy));
  }
  ok(worst < 1e-6 && rt < 1e-6, `radec/pixel match the server TAN at Dec ${d0} (worst ${worst.toExponential(1)}″, round trip ${rt.toExponential(1)} px)`);
}
// ISS-05: across RA 0h/360° nothing jumps by a whole turn
{ const f = { N: 100, scale: 6, ra0: 359.9985, dec0: 2 };
  const [r1] = P.radec(f, 0, 50), [r2] = P.radec(f, 100, 50);
  ok(r1 >= 0 && r1 < 360 && r2 >= 0 && r2 < 360, 'radec stays in [0,360) across RA 0h');
  const [x1] = P.pixel(f, 0.0015, 2), [x2] = P.pixel(f, 359.9975, 2);
  ok(Math.abs(x1) < 100 && Math.abs(x2) < 100 && x1 < x2, `pixel is finite across RA 0h (${x1.toFixed(1)}, ${x2.toFixed(1)})`); }
ok(P.fmtRA(70.42) === '04h 41m 40.8s' && P.fmtDec(19.18) === '+19° 10′ 48″', 'fmtRA / fmtDec');
// ISS-13: rounding carries instead of printing 60.0s / 60″
ok(P.fmtRA((8 + 55 / 60 + 59.97 / 3600) * 15) === '08h 56m 00.0s' && P.fmtRA(359.99999) === '00h 00m 00.0s', `fmtRA carries (${P.fmtRA((8 + 55 / 60 + 59.97 / 3600) * 15)})`);
ok(P.fmtDec(-(7 + 14 / 60 + 59.6 / 3600)) === '−7° 15′ 00″' && P.fmtDec(-(33 + 19 / 60 + 59.8 / 3600)) === '−33° 20′ 00″', 'fmtDec carries');
ok(P.fmtDec(-0.00001) === '+0° 00′ 00″' && P.fmtDec(-0.5) === '−0° 30′ 00″', 'fmtDec never prints −0° 00′ 00″');
// ISS-14: both Dec formatters agree on negative zero
ok(CF.fmtDec(-0.04) === '+0.0°' && CF.fmtDec(-0.04) === CO.fmtDec(-0.04) && CF.fmtDec(-12.34) === CO.fmtDec(-12.34), 'candidates fmtDec matches sky fmtDec');
// ISS-16: parser consistency
const nearC = (a, b) => a && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
ok(nearC(CO.parseCentre('12h +30d'), [180, 30]) && nearC(CO.parseCentre('12h, -30°'), [180, -30]), 'parseCentre accepts degrees with a d/° unit');
ok(CO.parseCentre('08h 55m 60s, 0') === null && CO.parseCentre('12h60m, 0') === null && CO.parseCentre('12:60, 0') === null && CO.parseCentre('12 60 0, 0') === null, 'parseCentre rejects 60 minutes / 60 seconds');
ok(CO.parseCentre('24h, 0') === null && CO.parseRA('24h') === null && CO.parseRA('24:00') === null && CO.parseRA('0h') === 0, 'RA 24h is rejected, 0h is fine');
ok(CO.parseGoto('16h06m +41').raH === 16.1 && nearC(CO.parseCentre('23h59m59s, 0'), [(23 + 59 / 60 + 59 / 3600) * 15, 0]), 'valid RA still parses');
// bare 24 means 24 degrees in both boxes; Dec minutes below 60 in the short parser too
ok(Math.abs(CO.parseGoto('24, 0').raH * 15 - CO.parseCentre('24, 0')[0]) < 1e-9 && CO.parseGoto('23.9, 0').raH === 23.9 && CO.parseGoto('25h, +10') === null, 'bare 24 is degrees in Go-to and Field centre');
ok(CO.parseDec('30d75m') === null && CO.parseGoto('12h, +30d75m') === null && CO.parseDec('30d59m') === 30 + 59 / 60 && CO.parseDec('+41') === 41, 'parseDec rejects 60+ minutes');
// ISS-19: CSV formula injection
ok(CF.csvField('=HYPERLINK("http://x")') === `"'=HYPERLINK(""http://x"")"` && CF.csvField('+1') === "'+1" && CF.csvField('-x') === "'-x" && CF.csvField('@a') === "'@a", 'csvField defuses = + - @');
ok(CF.csvField(-7.25) === '-7.25' && CF.csvField('plain') === 'plain' && CF.csvField(null) === '', 'csvField leaves numbers and plain text alone');

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

// 11. SPHEREx pipeline flags and Gaia stars on a synthetic live field: hard flags make artifacts, Gaia stars turn
//     appearances/disappearances into variability, a slow known mover is reported from its predicted position.
{
  const N = 48, S = 0.55, r = P.rng(7), stars = [];
  for (let i = 0; i < 10; i++) stars.push({ x: 6 + r() * 20, y: 6 + r() * 36, a: 3 + 30 * r() }); // stars keep to x < 26; test sources sit to the right
  const psf = (g, x, y, a) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
    g[Y * N + X] += a * Math.exp(-((X - x) ** 2 + (Y - y) ** 2) / (2 * S * S)); } };
  const mk = i => { const q = P.rng(300 + i), g = new Float32Array(N * N); for (let p = 0; p < N * N; p++) g[p] = 0.5 + 0.02 * P.gauss(q);
    for (const s of stars) psf(g, s.x, s.y, s.a);
    psf(g, 33.3 + 1.2 * i, 30.4, 25);                   // slow known mover: 1.2 px per epoch (under the 2.2 px pairing radius)
    if (i === 1) { psf(g, 40.3, 10.6, 20); psf(g, 30.4, 40.3, 18); psf(g, 34.6, 8.4, 12); }   // flagged hit; new source on a Gaia star; new source, nothing there
    if (i === 0) psf(g, 36.3, 20.6, 15);                  // star that fades below detection (on a Gaia star)
    return g; };                                          // (fractional positions, like real stars: integer-centred Gaussians look like spikes)
  const frames = [mk(0), mk(1)];
  const flagBits = { names: { TRANSIENT: 0, OUTLIER: 19, PERSIST: 17, SOURCE: 21 }, hard: ['TRANSIENT', 'OUTLIER'], soft: ['PERSIST'] };
  const flags = [new Uint32Array(N * N), new Uint32Array(N * N)];
  flags[1][11 * N + 40] = (1 << 0) | (1 << 19);        // hard flags under the hit's peak pixel
  flags[1][8 * N + 35] = 1 << 17;                        // soft flag under the plain new source
  const gaia = [{ name: 'Gaia DR3 1', g: 15.2, pm: 0.01, pos: () => [30.4, 40.3] }, { name: 'Gaia DR3 2', g: 16.0, pm: 0.02, pos: () => [36.3, 20.6] }];
  const mover = { name: 'Fast star', kind: 'star', source: 'Gaia DR3 proper motion', pos: t => [33.3 + 1.2 * (t / 180), 30.4] };
  const f = { N, scale: 6.15, ra0: 10, dec0: 5, epochs: [0, 180].map(t => ({ t, band: 1.02, label: t + ' d', sub: '' })), frame: i => frames[i], flags: i => flags[i], flagBits, known: [mover], stars: gaia, simulated: false };
  const res = P.analyse(f, 0, 1), at = (x, y) => res.find(q => Math.hypot(q.x - x, q.y - y) < 1.5);
  ok(at(40.3, 10.6)?.kind === 'art' && /Flagged by the SPHEREx pipeline/.test(at(40.3, 10.6).title) && /TRANSIENT, OUTLIER/.test(at(40.3, 10.6).detail), 'hard pipeline flags → artifact naming the bits');
  ok(at(30.4, 40.3)?.kind === 'var' && at(30.4, 40.3).title === 'Brightened star' && /Gaia DR3 1/.test(at(30.4, 40.3).detail), 'new source on a Gaia star → variable (brightened star)');
  ok(at(36.3, 20.6)?.kind === 'var' && at(36.3, 20.6).title === 'Faded star' && /Gaia DR3 2/.test(at(36.3, 20.6).detail), 'vanished source on a Gaia star → variable (faded star): ' + JSON.stringify(res.map(q => `${q.kind}:${q.title}@${q.x.toFixed(1)},${q.y.toFixed(1)}`)));
  ok(at(34.6, 8.4)?.kind === 'cand' && /SPHEREx pipeline flags: PERSIST/.test(at(34.6, 8.4).detail), 'soft flag is appended to a candidate, not a verdict: ' + JSON.stringify(at(34.6, 8.4)?.detail));
  const kn = res.find(q => q.kind === 'known');
  ok(kn && kn.title === 'Fast star' && /matches proper motion/.test(kn.detail) && kn.from && kn.to && Math.abs(kn.to.x - 34.5) < 0.5, 'sub-threshold known mover reported from the predicted positions: ' + (kn && kn.detail));
  ok(!res.some(q => q.kind === 'left'), 'a known mover still inside the field is never "left the cutout"');
  ok(res.filter(q => q.kind === 'cand').length === 1, 'exactly one candidate: ' + JSON.stringify(res.map(q => q.kind + ':' + q.title)));
  // no clean centroid at the prediction → still reported, as a prediction
  const f2 = { ...f, known: [{ ...mover, pos: t => [40, 40 + 1.5 * (t / 180)] }] };
  const kp = P.analyse(f2, 0, 1).find(q => q.kind === 'known');
  ok(kp && kp.predicted && /Predicted here/.test(kp.detail), 'known mover with nothing detectable at the prediction → reported as predicted');
}

// 12. real fields with FLAGS + Gaia (fixtures from /api/field, Nov 2026, collections spherex_dr1 + spherex_qr3)
{
  const { toField } = await import('../app/js/data/index.js');
  const psy = toField(JSON.parse(fs.readFileSync(path.join(here, 'fixtures/spherex-psyche-field-v3.json'), 'utf8')));
  ok(typeof psy.flags === 'function' && psy.flags(0) instanceof Uint32Array && psy.flags(0).length === psy.N * psy.N && psy.flagBits.names.MASKED === 30, 'v3 field decodes FLAGS planes and bit names');
  ok(psy.stars.length > 20 && psy.stars.every(s => typeof s.pos(0)[0] === 'number'), `Gaia stars decoded with pos(t) (${psy.stars.length})`);
  const r01 = P.analyse(psy, 0, 1), p = r01.find(q => /Psyche/.test(q.title));
  ok(p && p.kind === 'known' && Math.hypot(p.x - 21.49, p.y - 23.58) < 0.33, '16 Psyche still known, within 2″ of Horizons');
  ok(r01.filter(q => q.kind === 'art' && /Flagged by the SPHEREx pipeline/.test(q.title)).length >= 5, 'cosmic-ray hits in the Feb 2026 frame now rejected by the pipeline FLAGS');
  ok(r01.filter(q => q.kind === 'var').every(q => /Gaia DR3/.test(q.detail)), 'brightness changes are tied to Gaia stars');
  ok(!r01.some(q => q.kind === 'cand'), 'no candidates left in the Psyche pair: ' + JSON.stringify(r01.filter(q => q.kind === 'cand').map(q => q.title)));
  // ISS-01: the Psyche field's "Brightness change" flags were peak-sampling artefacts (5×5 flux ratios 0.94–1.07)
  ok(!r01.some(q => q.kind === 'var') && !P.analyse(psy, 0, 2).some(q => q.kind === 'var'), 'no false variables in the Psyche pairs: ' + JSON.stringify(r01.filter(q => q.kind === 'var').map(q => q.detail)));
  const bar = toField(JSON.parse(fs.readFileSync(path.join(here, 'fixtures/spherex-barnard-field.json'), 'utf8')));
  const star = bar.known.find(k => /Barnard/.test(k.name));
  ok(star && star.kind === 'star' && star.pmArcsecYr > 10 && Math.hypot(...[0, 1].map(i => star.pos(bar.epochs[2].t)[i] - star.pos(0)[i])) > 1.5, "Barnard's Star is a known high-proper-motion star moving > 1.5 px over the year");
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const res = P.analyse(bar, a, b), k = res.find(q => /Barnard/.test(q.title));
    ok(k && k.kind === 'known' && /matches proper motion/.test(k.detail), `Barnard's Star reported as a known mover in pair ${a},${b} (${k && k.detail})`);
    ok(!res.some(q => q.kind === 'left' || q.kind === 'cand'), `no "left" or candidate in pair ${a},${b}: ` + JSON.stringify(res.filter(q => q.kind === 'left' || q.kind === 'cand').map(q => q.title)));
    // ISS-01/07: a G 13.0 star at ×0.48 in peak but ×0.97 in flux, and a blended G 15.6 star whose flux rose while its
    // 5σ detection toggled off, used to be reported as variable / faded
    ok(!res.some(q => q.kind === 'var'), `no false variables in pair ${a},${b}: ` + JSON.stringify(res.filter(q => q.kind === 'var').map(q => q.title + ' ' + q.detail)));
  }
  // RW Aurigae (fixture from /api/field?ra=76.9565&dec=30.4014&size=300&det=1): the one genuine variable among the
  // brief's targets, a T Tauri star with deep dimming events. RW Aur A (Gaia DR3 156430822114424576, G 12.2) sits at
  // the field centre and its 5×5 flux goes 85 → 143 → 206 over the three passes (Sep 2025, Mar 2026, Sep 2026). It
  // must survive the aperture test that removed the false flags above, and be the only variable in the field.
  const rw = toField(JSON.parse(fs.readFileSync(path.join(here, 'fixtures/spherex-rwaur-field.json'), 'utf8')));
  for (const [a, b, lo] of [[0, 1, 1.6], [0, 2, 2.3]]) {
    const res = P.analyse(rw, a, b), vars = res.filter(q => q.kind === 'var'), v = vars.find(q => Math.hypot(q.x - rw.N / 2, q.y - rw.N / 2) < 2);
    const ratio = v ? +(/×([\d.]+) in flux/.exec(v.detail) || [])[1] : NaN;
    ok(v && /156430822114424576/.test(v.detail) && ratio >= lo, `RW Aur A is variable in pair ${a},${b}, judged on flux (${v ? v.detail : 'not flagged'})`);
    ok(vars.length === 1, `RW Aur A is the only variable in pair ${a},${b}: ` + JSON.stringify(vars.map(q => q.detail)));
    ok(!res.some(q => q.kind === 'cand'), `no candidates in the RW Aur pair ${a},${b}`);
  }
}

// 13. ISS-01: on an under-sampled PSF the peak depends on where a star falls in its pixel, so variability is judged on
//     5×5 aperture flux relative to the field's other stars. A star that merely shifts within its pixel is not
//     variable; one whose flux doubles is, and the detail says so in flux.
{
  const N = 48, S = 0.55, r = P.rng(13), stars = [];
  while (stars.length < 12) { const s = { x: 5 + r() * 38, y: 5 + r() * 38, a: 4 + 30 * r() }; if (Math.hypot(s.x - 12, s.y - 36) > 7 && Math.hypot(s.x - 36, s.y - 12) > 7) stars.push(s); }
  const psf = (g, x, y, a) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
    g[Y * N + X] += a * Math.exp(-((X - x) ** 2 + (Y - y) ** 2) / (2 * S * S)); } };
  const mk = i => { const q = P.rng(500 + i), g = new Float32Array(N * N); for (let p = 0; p < N * N; p++) g[p] = 0.5 + 0.02 * P.gauss(q);
    for (const s of stars) psf(g, s.x, s.y, s.a);
    psf(g, i ? 12.55 : 12, i ? 36.55 : 36, 20);         // same flux, 0.55 px over in both axes: the peak halves
    psf(g, 36, 12, i ? 24 : 11);                         // fixed position, flux ×2.2: a real variable
    return g; };
  const frames = [mk(0), mk(1)];
  const f = { N, scale: 6.15, ra0: 10, dec0: 5, psfSigmaPx: S, epochs: [0, 180].map(t => ({ t, band: 1.02, label: t + ' d', sub: '' })), frame: i => frames[i], known: [], stars: [], simulated: false };
  const res = P.analyse(f, 0, 1), at = (x, y) => res.find(q => Math.hypot(q.x - x, q.y - y) < 1.5);
  const a0 = P.detect(frames[0], 5).find(s => Math.hypot(s.x - 12, s.y - 36) < 1), b0 = P.detect(frames[1], 5).find(s => Math.hypot(s.x - 12.55, s.y - 36.55) < 1);
  ok(a0 && b0 && b0.peak / a0.peak < 0.55, `a sub-pixel shift alone changes the peak by ×${a0 && b0 ? (b0.peak / a0.peak).toFixed(2) : '?'} (the old peak test flagged that)`);
  ok(!at(12.3, 36.3), 'a star that only moved within its pixel is not called variable: ' + JSON.stringify(res.map(q => q.kind + ':' + q.title)));
  const v = at(36, 12);
  ok(v && v.kind === 'var' && /in flux/.test(v.detail) && /×2\.[0-4]/.test(v.detail), 'a star whose flux doubled is variable, judged on aperture flux: ' + (v && v.detail));
  ok(P.apFlux(frames[1], 36, 12).flux / P.apFlux(frames[0], 36, 12).flux > 2 && res.filter(q => q.kind === 'var').length === 1, 'exactly one variable in the pair');
  ok(P.UNDERSAMPLED_SIGMA > P.LIVE_PSF_SIGMA && P.UNDERSAMPLED_SIGMA < P.SIM_PSF_SIGMA, 'real frames use the flux test, the simulation keeps the peak test');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
