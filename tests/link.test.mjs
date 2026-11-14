// Cross-field linking (scripts/link-fields.mjs). Plain Node, no network:  node tests/link.test.mjs
// A source is planted in a REAL pass-A frame; its counterpart is planted in the REAL pass-B frame at the position
// parallax predicts (plus the body's own motion), in a field centred where the linker asks for it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toField } from '../app/js/data/index.js';
import { pixel, radec } from '../app/js/pipeline/format.js';
import { stats, detect } from '../app/js/pipeline/index.js';
import { earthHelio, predictAtB, sepArcsec, linkFields, vanishedSources, DISTANCES } from '../scripts/link-fields.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// 1. Earth's position against astropy (earth-moon-barycenter minus sun, ICRS), AU
const REF = { 60920.0: [0.944755, -0.325119, -0.140939], 61107.7: [-0.970103, 0.193118, 0.083719], 61291.3: [0.974547, -0.234607, -0.101704], 60000.0: [-0.902659, 0.372365, 0.161421] };
for (const [mjd, ref] of Object.entries(REF)) { const e = earthHelio(+mjd), d = Math.hypot(...e.map((v, i) => v - ref[i])); ok(d < 2e-4, `earthHelio(${mjd}) within 2e-4 AU of astropy (${d.toExponential(1)})`); }

// 2. parallax size: small-angle check, and the numbers quoted in the task
const fx = toField(JSON.parse(fs.readFileSync(path.join(here, 'fixtures/spherex-rwaur-field.json'), 'utf8')));
const mjdA = fx.epochs[0].mjd, mjdB = fx.epochs[1].mjd, S0 = { ra: fx.ra0, dec: fx.dec0 };
{ const EA = earthHelio(mjdA), EB = earthHelio(mjdB), u = [Math.cos(S0.dec * Math.PI / 180) * Math.cos(S0.ra * Math.PI / 180), Math.cos(S0.dec * Math.PI / 180) * Math.sin(S0.ra * Math.PI / 180), Math.sin(S0.dec * Math.PI / 180)];
  const dE = EB.map((v, i) => v - EA[i]), par = dE.map((v, i) => v - u.reduce((s, ui, k) => s + ui * dE[k], 0) * u[i]), perp = Math.hypot(...par);
  const p = predictAtB({ ...S0, mjdA, mjdB, distAU: 1000 }), approx = perp / 1000 * 206265;
  ok(Math.abs(p.shiftArcsec / approx - 1) < 0.06, `shift at 1000 AU ${p.shiftArcsec.toFixed(0)}″ ≈ small-angle ${approx.toFixed(0)}″ (ΔT ${(mjdB - mjdA).toFixed(0)} d)`);
  const s = DISTANCES.map(d => predictAtB({ ...S0, mjdA, mjdB, distAU: d }).shiftArcsec);
  ok(s.every((v, i) => i === 0 || v < s[i - 1]), `shift falls with distance: ${s.map(v => v.toFixed(0)).join(', ')}″`); }

// 3. plant a source in the real pass-A frame, link it
const SIGMA = 0.5, AMP = 30;
function plant(img, N, x, y, amp) { for (let j = Math.max(0, Math.floor(y - 4)); j <= Math.min(N - 1, Math.ceil(y + 4)); j++) for (let i = Math.max(0, Math.floor(x - 4)); i <= Math.min(N - 1, Math.ceil(x + 4)); i++) img[j * N + i] += amp * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * SIGMA ** 2)); }
const N = fx.N, sigA = stats(fx.frame(0)).sig, sigB = stats(fx.frame(1)).sig, XS = 30.3, YS = 18.6;
const A0 = Float32Array.from(fx.frame(0)); plant(A0, N, XS, YS, AMP * sigA);
const FA = { ...fx, frame: i => i === 0 ? A0 : fx.frame(i) };
const src = vanishedSources(FA, 0, 1).sort((a, b) => Math.hypot(a.pixel[0] - XS, a.pixel[1] - YS) - Math.hypot(b.pixel[0] - XS, b.pixel[1] - YS))[0];
ok(src && Math.hypot(src.pixel[0] - XS, src.pixel[1] - YS) < 1 && src.flux > 0, `the planted source is found as "Source vanished" at (${src && src.pixel.map(v => v.toFixed(1))})`);

// the true body: 750 AU. It has also moved a little by itself between the passes: put it at a quiet pixel 3–12 px
// (18–75″) from the predicted centre, away from every real source of the field, so the test measures the linker and not blends
const TRUE_AU = 750, pt = predictAtB({ ...src, mjdB, distAU: TRUE_AU }), Cpt = { ...fx, ra0: pt.ra, dec0: pt.dec };
const real = detect(fx.frame(1)).concat(detect(fx.frame(0))); let spot = null;
for (let r = 3; r <= 12 && !spot; r += 0.5) for (let a = 0; a < 360 && !spot; a += 15) { const x = N / 2 + r * Math.cos(a * Math.PI / 180), y = N / 2 + r * Math.sin(a * Math.PI / 180); if (real.every(d => Math.hypot(d.x - x, d.y - y) > (d.peak > 20 * d.sig ? 8 : 3.5)) && x > 6 && y > 6 && x < N - 7 && y < N - 7) spot = [x, y]; }
const [tra, tdec] = radec(Cpt, ...spot), truth = { ra: tra, dec: tdec };
console.log(`   own motion of the planted body: ${sepArcsec(pt.ra, pt.dec, truth.ra, truth.dec).toFixed(0)}″ from the parallax-only prediction`);
// a stand-in for /api/field: the REAL pass-B frames (real noise), centred where asked, with the counterpart planted where it truly is
const standIn = (plantIt, boost = 1) => async (ra, dec) => {
  const F = { ...fx, ra0: ra, dec0: dec, stars: [], known: [] }, B = Float32Array.from(fx.frame(1)), [x, y] = pixel(F, truth.ra, truth.dec);
  if (plantIt && x > 5 && y > 5 && x < N - 6 && y < N - 6) plant(B, N, x, y, AMP * sigB * boost);   // plant() with the exact TAN pixel from this PR
  F.frame = i => i === 1 ? B : fx.frame(i); return F;
};
const rows = await linkFields({ source: src, mjdB, getField: standIn(true) });
console.log(rows.map(r => `   ${r.distAU} AU: sep from truth ${sepArcsec(r.ra, r.dec, truth.ra, truth.dec).toFixed(0)}″, ${r.hit ? 'HIT at ' + r.hitAt.offsetArcsec.toFixed(0) + '″, flux ×' + r.hitAt.fluxRatio.toFixed(2) + ' (' + r.hitAt.flaggedAs + ')' : 'no hit'} (${r.nNew} new)`).join('\n'));
const by = Object.fromEntries(rows.map(r => [r.distAU, r]));
ok(by[TRUE_AU].hit && by[TRUE_AU].hitAt.offsetArcsec < 80, `the true distance (${TRUE_AU} AU) is a hit, ${by[TRUE_AU].hitAt && by[TRUE_AU].hitAt.offsetArcsec.toFixed(0)}″ from the predicted centre`);
ok(rows.every(r => !(r.hit && sepArcsec(r.ra, r.dec, truth.ra, truth.dec) > 200)), 'no distance whose field cannot contain the body (> 200″ away) reports a hit');
ok(rows.some(r => !r.hit && sepArcsec(r.ra, r.dec, truth.ra, truth.dec) > 200), 'at least one other distance is correctly reported as no hit');
// controls
const none = await linkFields({ source: src, mjdB, getField: standIn(false) });
ok(none.every(r => r.hit === false), 'no counterpart planted: no distance is a hit');
const wrongFlux = await linkFields({ source: src, mjdB, getField: standIn(true, 8) });
ok(wrongFlux.every(r => !r.hit), 'a counterpart 8× too bright is rejected by the ×2 flux rule');
const broken = await linkFields({ source: src, mjdB, distances: [500], getField: async () => { throw new Error('HTTP 502'); } });
ok(broken[0].hit === null && /502/.test(broken[0].error), 'a field that cannot be built is reported as unavailable, not as "no hit"');


// 5. neighbouring distances: a body between 1500 and 2000 AU is inside both fields; the linker must say it is ONE source
{ const mid = predictAtB({ ...src, mjdB, distAU: 1750 }), want = [1500, 2000];
  const Cs = want.map(d => { const p = predictAtB({ ...src, mjdB, distAU: d }); return { ...fx, ra0: p.ra, dec0: p.dec }; });
  let spot = null;   // an own-motion offset for which the body lands on a quiet pixel in BOTH fields
  for (let dx = -100; dx <= 100 && !spot; dx += 6) for (let dy = -100; dy <= 100 && !spot; dy += 6) {
    const ra = mid.ra + dx / 3600 / Math.cos(mid.dec * Math.PI / 180), dec = mid.dec + dy / 3600;
    const px = Cs.map(C => pixel(C, ra, dec));
    if (px.every(([x, y]) => x > 8 && y > 8 && x < N - 9 && y < N - 9 && real.every(d => Math.hypot(d.x - x, d.y - y) > (d.peak > 20 * d.sig ? 7 : 3.5)))) spot = { ra, dec }; }
  ok(!!spot, 'found an own-motion offset that is quiet in both fields');
  if (spot) {
    const stand = async (ra, dec) => { const F = { ...fx, ra0: ra, dec0: dec, stars: [], known: [] }, B = Float32Array.from(fx.frame(1)), [x, y] = pixel(F, spot.ra, spot.dec); if (x > 5 && y > 5 && x < N - 6 && y < N - 6) plant(B, N, x, y, AMP * sigB); F.frame = i => i === 1 ? B : fx.frame(i); return F; };
    const r2 = await linkFields({ source: src, mjdB, getField: stand }), q = Object.fromEntries(r2.map(r => [r.distAU, r]));
    console.log(r2.map(r => `   ${r.distAU} AU: ${r.hit ? 'HIT' : 'no hit'}${r.sameSourceAs.length ? ' (same source as ' + r.sameSourceAs + ' AU)' : ''}${r.overlaps.length ? ' overlaps ' + r.overlaps : ''}`).join('\n'));
    ok(q[1500].hit && q[2000].hit, 'both the 1500 and the 2000 AU fields hit the same body');
    ok(q[1500].sameSourceAs.includes(2000) && q[2000].sameSourceAs.includes(1500), 'and they are reported as the SAME source (the distance is not fixed)');
    ok(q[1500].overlaps.includes(2000) && !q[300].overlaps.includes(2000), 'overlapping fields are flagged; distant ones are not'); } }

// 4. the CLI, without network
const out = execFileSync('node', [path.join(here, '../scripts/link-fields.mjs'), '--ra', '70.26', '--dec', '19.06', '--mjdA', '60923.7', '--mjdB', '61086.6', '--predict-only'], { encoding: 'utf8' });
ok(/300 AU/.test(out) && /2000 AU/.test(out) && /own motion/.test(out), 'CLI --predict-only prints every distance and the simplification note');
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
