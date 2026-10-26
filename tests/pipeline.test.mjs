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

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
