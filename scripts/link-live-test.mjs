#!/usr/bin/env node
// Live injection test of the cross-field linker, through the REAL data server (needs `node server/index.mjs` running).
//   1. fetch a real pass-A field and plant a source in it (it is absent in pass B, i.e. it "vanished")
//   2. predict where a body at --true-au would reappear, fetch the REAL pass-B field there, plant the counterpart in it
//      (at a quiet pixel, with some motion of its own), and let linkFields() look at every distance
//   3. control: the same real fields with nothing planted must give no hit
// Usage: node scripts/link-live-test.mjs [--ra 76.9565 --dec 30.4014 --pair 0,1 --true-au 750 --amp 30 --distances 500,750,1000,1500 --server http://localhost:8787]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, stats, analyse } from '../app/js/pipeline/index.js';
import { radec, pixel } from '../app/js/pipeline/format.js';
import { linkFields, fetchField, apertureFlux, predictAtB, formatRow, sepArcsec, NOTE } from './link-fields.mjs';

const o = {}; const av = process.argv.slice(2); for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) o[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : true;
const server = o.server || 'http://localhost:8787', ra0 = +(o.ra ?? 76.9565), dec0 = +(o.dec ?? 30.4014), [ia, ib] = String(o.pair || '0,1').split(',').map(Number);
const TRUE_AU = +(o['true-au'] || 750), AMP = +(o.amp || 30), distances = o.distances ? String(o.distances).split(',').map(Number) : [500, 750, 1000, 1500];
const SIGMA = 0.8;   // px. Sharper than this is classed "Single-pixel spike" (an artifact) when it lands on a pixel centre
const get = (ra, dec, mjd) => fetchField(server, { ra, dec, size: 300, mjd });
function plant(img, N, x, y, amp) { for (let j = Math.max(0, Math.floor(y - 4)); j <= Math.min(N - 1, Math.ceil(y + 4)); j++) for (let i = Math.max(0, Math.floor(x - 4)); i <= Math.min(N - 1, Math.ceil(x + 4)); i++) img[j * N + i] += amp * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * SIGMA ** 2)); }
const nearest = (F, mjd) => F.epochs.reduce((b, e, i) => Math.abs(e.mjd - mjd) < Math.abs(F.epochs[b].mjd - mjd) ? i : b, 0);
// How far a pixel is from every real source (bright ones count double, their wings reach far). Higher = quieter.
const room = (dets, x, y) => dets.reduce((m, d) => Math.min(m, Math.hypot(d.x - x, d.y - y) / (d.peak > 20 * d.sig ? 2 : 1)), 99);
/** The quietest usable pixel (≥ 12 px from the edge, `room` ≥ minRoom in every given frame), nearest the centre first. */
function quietSpot(F, epochs, minRoom) {
  const N = F.N, dets = epochs.flatMap(e => detect(F.frame(e))); let best = null;
  for (let y = 12; y <= N - 13; y++) for (let x = 12; x <= N - 13; x++) { const rm = room(dets, x, y); if (rm < minRoom) continue; const c = Math.hypot(x - N / 2, y - N / 2); if (!best || c < best.c) best = { x, y, c, rm }; }
  return best ? { ...best, nDet: dets.length } : { x: null, nDet: dets.length };
}
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', m); };

console.log(`Fetching the real pass-A field at ${ra0}°, ${dec0}° from ${server} …`);
const FA = await get(ra0, dec0), N = FA.N, a = ia, b = ib;
console.log(`  ${FA.epochs.length} passes, pair ${a}→${b}: MJD ${FA.epochs[a].mjd.toFixed(1)} → ${FA.epochs[b].mjd.toFixed(1)}`);
let qa = null; for (const minRoom of [6, 5, 4, 3]) { qa = quietSpot(FA, [a, b], minRoom); if (qa.x != null) break; }
if (qa.x == null) { console.error(`no quiet pixel in the pass-A field to plant in (${qa.nDet} real sources in it)`); process.exit(1); }
const spotA = [qa.x, qa.y]; if (process.env.DEBUG_LINK) console.log('  planting at', spotA, 'room', qa.rm.toFixed(1), 'of', qa.nDet, 'sources');
const A = Float32Array.from(FA.frame(a)); plant(A, N, spotA[0], spotA[1], AMP * stats(A).sig);
const planted = { ...FA, frame: i => i === a ? A : FA.frame(i) };
// The source as the linker needs it. analyse() may call the planted source "Source vanished" or, when the field also holds an
// unrelated appearing source of similar brightness, pair the two as an "Uncatalogued mover" (both are legitimate), so it is
// read straight from the frame: the nearest detection to where it was planted.
const seen = detect(A).sort((p, q) => Math.hypot(p.x - spotA[0], p.y - spotA[1]) - Math.hypot(q.x - spotA[0], q.y - spotA[1]))[0];
const [sra, sdec] = seen ? radec(FA, seen.x, seen.y) : [null, null];
const src = seen && Math.hypot(seen.x - spotA[0], seen.y - spotA[1]) < 1.5 ? { ra: sra, dec: sdec, mjdA: FA.epochs[a].mjd, flux: apertureFlux(A, N, seen.x, seen.y), pixel: [seen.x, seen.y] } : null;
ok(!!src, `the planted source is detected in pass A at ${src ? src.pixel.map(v => v.toFixed(1)).join(', ') : 'nowhere'}`);
const how = analyse(planted, a, b).filter(r => Math.hypot(((r.from || r).x ?? r.x) - spotA[0], ((r.from || r).y ?? r.y) - spotA[1]) < 2);
console.log(`  (the pipeline calls it: ${how.length ? how.map(r => r.title).join(', ') : 'nothing'})`);
if (!src) process.exit(1);
const mjdB = FA.epochs[b].mjd, pt = predictAtB({ ...src, mjdB, distAU: TRUE_AU });
console.log(`Body assumed at ${TRUE_AU} AU: parallax puts it ${pt.shiftArcsec.toFixed(0)}″ away at ${pt.ra.toFixed(4)}°, ${pt.dec.toFixed(4)}°. Fetching the real pass-B field there …`);
const Fp = await get(pt.ra, pt.dec, mjdB), ibp = nearest(Fp, mjdB);
let qb = null; for (const minRoom of [6, 5, 4, 3]) { qb = quietSpot(Fp, [ibp], minRoom); if (qb.x != null) break; }
if (qb.x == null) { console.error(`no quiet pixel in the pass-B field to plant the counterpart in (${qb.nDet} real sources in it)`); process.exit(1); }
const spotB = [qb.x, qb.y];
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
