#!/usr/bin/env node
// Live injection test of the cross-field linker, through the REAL data server (needs `node server/index.mjs` running).
//   1. fetch a real pass-A field, plant a source in it (it "vanishes" in pass B), read it back as a "Source vanished"
//   2. predict where a body at --true-au would reappear, fetch the REAL pass-B field there, plant the counterpart in it
//      (at a quiet pixel, with some motion of its own), and let linkFields() look at every distance
//   3. control: the same real fields with nothing planted must give no hit
// Usage: node scripts/link-live-test.mjs [--ra 76.9565 --dec 30.4014 --pair 0,1 --true-au 750 --amp 30 --distances 500,750,1000,1500 --server http://localhost:8787]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toField } from '../app/js/data/index.js';
import { detect, stats } from '../app/js/pipeline/index.js';
import { radec, pixel } from '../app/js/pipeline/format.js';
import { linkFields, vanishedSources, predictAtB, formatRow, sepArcsec, NOTE } from './link-fields.mjs';

const o = {}; const av = process.argv.slice(2); for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) o[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : true;
const server = o.server || 'http://localhost:8787', ra0 = +(o.ra ?? 76.9565), dec0 = +(o.dec ?? 30.4014), [ia, ib] = String(o.pair || '0,1').split(',').map(Number);
const TRUE_AU = +(o['true-au'] || 750), AMP = +(o.amp || 30), distances = o.distances ? String(o.distances).split(',').map(Number) : [500, 750, 1000, 1500];
const SIGMA = 0.5;
const get = async (ra, dec, mjd) => { const u = `${server}/api/field?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&size=300&known=0${mjd ? '&mjd=' + mjd : ''}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(10 * 60 * 1000) }); if (!r.ok) throw new Error(`server answered HTTP ${r.status} for ${u}`); return toField(await r.json()); };
function plant(img, N, x, y, amp) { for (let j = Math.max(0, Math.floor(y - 4)); j <= Math.min(N - 1, Math.ceil(y + 4)); j++) for (let i = Math.max(0, Math.floor(x - 4)); i <= Math.min(N - 1, Math.ceil(x + 4)); i++) img[j * N + i] += amp * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * SIGMA ** 2)); }
const nearest = (F, mjd) => F.epochs.reduce((b, e, i) => Math.abs(e.mjd - mjd) < Math.abs(F.epochs[b].mjd - mjd) ? i : b, 0);
const quiet = (F, e, x, y) => { const N = F.N; return x > 8 && y > 8 && x < N - 9 && y < N - 9 && detect(F.frame(e)).every(d => Math.hypot(d.x - x, d.y - y) > (d.peak > 20 * d.sig ? 8 : 3.5)); };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', m); };

console.log(`Fetching the real pass-A field at ${ra0}°, ${dec0}° from ${server} …`);
const FA = await get(ra0, dec0), N = FA.N, a = ia, b = ib;
console.log(`  ${FA.epochs.length} passes, pair ${a}→${b}: MJD ${FA.epochs[a].mjd.toFixed(1)} → ${FA.epochs[b].mjd.toFixed(1)}`);
let spotA = null; for (let r = 4; r <= 14 && !spotA; r += 1) for (let t = 0; t < 360 && !spotA; t += 20) { const x = N / 2 + r * Math.cos(t * Math.PI / 180), y = N / 2 + r * Math.sin(t * Math.PI / 180); if (quiet(FA, a, x, y) && quiet(FA, b, x, y)) spotA = [x, y]; }
if (!spotA) { console.error('no quiet pixel in the pass-A field to plant in'); process.exit(1); }
const A = Float32Array.from(FA.frame(a)); plant(A, N, spotA[0], spotA[1], AMP * stats(A).sig);
const planted = { ...FA, frame: i => i === a ? A : FA.frame(i) };
const src = vanishedSources(planted, a, b).sort((p, q) => Math.hypot(p.pixel[0] - spotA[0], p.pixel[1] - spotA[1]) - Math.hypot(q.pixel[0] - spotA[0], q.pixel[1] - spotA[1]))[0];
ok(src && Math.hypot(src.pixel[0] - spotA[0], src.pixel[1] - spotA[1]) < 1.5, `the planted source is read back as "Source vanished" at ${src ? src.pixel.map(v => v.toFixed(1)).join(', ') : 'nowhere'}`);
if (!src) process.exit(1);
const mjdB = FA.epochs[b].mjd, pt = predictAtB({ ...src, mjdB, distAU: TRUE_AU });
console.log(`Body assumed at ${TRUE_AU} AU: parallax puts it ${pt.shiftArcsec.toFixed(0)}″ away at ${pt.ra.toFixed(4)}°, ${pt.dec.toFixed(4)}°. Fetching the real pass-B field there …`);
const Fp = await get(pt.ra, pt.dec, mjdB), ibp = nearest(Fp, mjdB);
let spotB = null; for (let r = 3; r <= 12 && !spotB; r += 0.5) for (let t = 0; t < 360 && !spotB; t += 15) { const x = Fp.N / 2 + r * Math.cos(t * Math.PI / 180), y = Fp.N / 2 + r * Math.sin(t * Math.PI / 180); if (quiet(Fp, ibp, x, y)) spotB = [x, y]; }
if (!spotB) { console.error('no quiet pixel in the pass-B field to plant the counterpart in'); process.exit(1); }
const [tra, tdec] = radec(Fp, ...spotB), truth = { ra: tra, dec: tdec };
console.log(`Counterpart planted ${sepArcsec(pt.ra, pt.dec, tra, tdec).toFixed(0)}″ from the parallax-only prediction (its own motion).\n`);
const wrap = plantIt => async (ra, dec, q) => { const F = await get(ra, dec, q.mjd), e = nearest(F, q.mjd), B = Float32Array.from(F.frame(e)), [x, y] = pixel(F, truth.ra, truth.dec);
  if (plantIt && x > 5 && y > 5 && x < F.N - 6 && y < F.N - 6) plant(B, F.N, x, y, AMP * stats(B).sig); return { ...F, frame: i => i === e ? B : F.frame(i) }; };
const run = async (title, plantIt) => { console.log(title); const rows = await linkFields({ source: src, mjdB, getField: wrap(plantIt), distances }); for (const r of rows) console.log('  ' + formatRow(r) + `   [${sepArcsec(r.ra, r.dec, truth.ra, truth.dec).toFixed(0)}″ from the planted body]`); return Object.fromEntries(rows.map(r => [r.distAU, r])); };
const hit = await run('WITH the counterpart planted:', true), none = await run('\nCONTROL, nothing planted:', false);
console.log();
ok(hit[TRUE_AU] && hit[TRUE_AU].hit === true, `the true distance (${TRUE_AU} AU) is a hit`);
ok(Object.values(hit).every(r => r.hit !== null) && Object.values(none).every(r => r.hit !== null), 'every field was built (no "field unavailable")');
ok(Object.values(none).every(r => r.hit === false), 'control: no distance is a hit when nothing is planted');
console.log('\n' + NOTE + '\n' + (fails ? `${fails} check(s) failed` : 'all checks passed')); process.exit(fails ? 1 : 0);
