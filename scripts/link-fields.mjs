#!/usr/bin/env node
// Cross-field linking: where should a source that VANISHED from one SPHEREx cutout reappear six months later?
//
// A distant body barely moves on its own, but Earth moves ~2 AU between two passes, so its apparent position shifts by
// parallax: ~800″ at 500 AU, ~400″ at 1000 AU, ~200″ at 2000 AU. Our cutouts are 300″ wide, so the pipeline sees
// "Source vanished" in pass A and "New source, no counterpart" in pass B, in two different cutouts. This script
//   1. takes a vanished source (RA, Dec, time of pass A, flux) and the time of pass B,
//   2. predicts where a body at each assumed distance (300 … 2000 AU) would be seen from Earth at pass B,
//   3. builds the field at each predicted position at pass B and runs the app's own `analyse` on it,
//   4. reports, for every distance, the predicted position and whether a "New source" with a similar flux is there.
//
// Simplifications (stated again in the output):
//  - The body's own orbital motion is ignored. At 300–2000 AU it is a few percent of the parallax (tens of arcsec at
//    most), so the counterpart can sit a little off the predicted centre: any new source inside the field counts.
//  - Observer = Earth–Moon barycentre from a low-precision analytic ephemeris (JPL "approximate positions", good to
//    ~1e-4 AU, i.e. < 0.1″ of parallax at 500 AU). SPHEREx is within ~7,000 km (5e-5 AU) of the geocentre, which is
//    < 0.03″ at 500 AU. The SPHEREx header position (X_SC/Y_SC/Z_SC) is therefore not needed here.
//  - The assumed distance is the heliocentric distance of the body.
//  - Flux = sum of the 5×5 pixels around the peak minus the local sky (median of the ring 3–4 px out), in image units (MJy/sr × px).
//    Passes at different wavelengths are not colour-corrected, hence the generous ×2 tolerance.
//
// Usage:
//   node scripts/link-fields.mjs --ra 70.26 --dec 19.06 --mjdA 60923.7 --mjdB 61086.6 --flux 12.5   (predict + link, needs the server)
//   node scripts/link-fields.mjs --ra … --dec … --mjdA … --mjdB … --predict-only                       (no network)
//   node scripts/link-fields.mjs --field app/data/snapshots/psyche.json --pair 0,1                    (links every "Source vanished" of that pair)
// Options: --server http://localhost:8787  --size 300  --distances 300,500,750,1000,1500,2000  --flux-tol 2  --json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse } from '../app/js/pipeline/index.js';
import { radec } from '../app/js/pipeline/format.js';
import { toField } from '../app/js/data/index.js';
import { estimateDistance } from './parallax-distance.mjs';   // (it imports predictAtB/sepArcsec back from this file; both are only called after loading)

export const DISTANCES = [300, 500, 750, 1000, 1500, 2000];
const D2R = Math.PI / 180, AS = 3600 / D2R;       // radians → arcsec
const rev = d => ((d % 360) + 360) % 360;

/** Earth–Moon barycentre, heliocentric, equatorial J2000 (AU), from the JPL low-precision Keplerian elements (1800–2050). */
export function earthHelio(mjd) {
  const T = (mjd - 51544.5) / 36525;
  const a = 1.00000261 + 0.00000562 * T, e = 0.01671123 - 0.00004392 * T, I = (-0.00001531 - 0.01294668 * T) * D2R;
  const L = 100.46457166 + 35999.37306329 * T, varpi = 102.93768193 + 0.32327364 * T;   // Ω = 0 for this body
  const M = rev(L - varpi) * D2R; let E = M + e * Math.sin(M);
  for (let k = 0; k < 12; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E), w = varpi * D2R;
  const x = Math.cos(w) * xp - Math.sin(w) * yp;
  const y = Math.sin(w) * Math.cos(I) * xp + Math.cos(w) * Math.cos(I) * yp;
  const z = Math.sin(w) * Math.sin(I) * xp + Math.cos(w) * Math.sin(I) * yp;
  const eps = 23.43929111 * D2R;                                                          // ecliptic → equatorial
  return [x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps)];
}

const unit = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Angular separation in arcsec. */
export function sepArcsec(ra1, dec1, ra2, dec2) { const u = unit(ra1, dec1), v = unit(ra2, dec2), c = u[1] * v[2] - u[2] * v[1], d = u[2] * v[0] - u[0] * v[2], f = u[0] * v[1] - u[1] * v[0]; return Math.atan2(Math.hypot(c, d, f), dot(u, v)) * AS; }

/**
 * Where is a body seen at pass B, if it was seen at (ra, dec) at pass A and sits at heliocentric distance `distAU`
 * (not moving by itself)? Returns {ra, dec, shiftArcsec, pa (deg, east of north)}.
 */
export function predictAtB({ ra, dec, mjdA, mjdB, distAU }) {
  const EA = earthHelio(mjdA), EB = earthHelio(mjdB), u = unit(ra, dec), b = dot(EA, u);
  const disc = b * b - dot(EA, EA) + distAU * distAU;
  if (disc < 0) throw new Error(`distance ${distAU} AU is inside the observer's orbit`);
  const s = -b + Math.sqrt(disc), P = [EA[0] + s * u[0], EA[1] + s * u[1], EA[2] + s * u[2]], v = [P[0] - EB[0], P[1] - EB[1], P[2] - EB[2]];
  const r = Math.hypot(...v), pra = rev(Math.atan2(v[1], v[0]) / D2R), pdec = Math.asin(v[2] / r) / D2R;
  const dE = Math.atan2(Math.sin((pra - ra) * D2R) * Math.cos(pdec * D2R), Math.cos(dec * D2R) * Math.sin(pdec * D2R) - Math.sin(dec * D2R) * Math.cos(pdec * D2R) * Math.cos((pra - ra) * D2R));
  return { ra: pra, dec: pdec, shiftArcsec: sepArcsec(ra, dec, pra, pdec), pa: rev(dE / D2R) };
}

const median = a => { const s = Float32Array.from(a).sort(); return s[s.length >> 1]; };
/** Flux used for the ×2 comparison: sum over the 5×5 pixels around (x, y) minus the LOCAL sky, taken as the median of
 *  the ring of pixels 3–4 px away (so the wings of a bright neighbour do not count as the source's flux). */
export function apertureFlux(img, N, x, y) {
  const cx = Math.round(x), cy = Math.round(y), ring = []; let sum = 0;
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const xx = cx + i, yy = cy + j; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
    const r = Math.max(Math.abs(i), Math.abs(j)); if (r <= 2) sum += img[yy * N + xx]; else ring.push(img[yy * N + xx]); }
  return sum - 25 * (ring.length ? median(ring) : median(img));
}
const nearestEpoch = (F, mjd, not = -1) => { let b = -1; F.epochs.forEach((e, i) => { if (i !== not && (b < 0 || Math.abs(e.mjd - mjd) < Math.abs(F.epochs[b].mjd - mjd))) b = i; }); return b; };

export const NOTE = 'Predictions ignore the body\'s own motion (a few percent of the parallax at 300–2000 AU, i.e. tens of arcsec at most), so a counterpart may sit off the predicted centre; any new source inside the field counts. Neighbouring distances can overlap within one 300″ field, so a hit alone does not fix the distance; the parallax distance printed after a hit does, from the measured shift (scripts/parallax-distance.mjs). Flux is not colour-corrected between passes.';

/**
 * @param {{source:{ra:number,dec:number,mjdA:number,flux:number}, mjdB:number,
 *          getField:(ra:number,dec:number,o:{mjd:number,sizeArcsec:number})=>Promise<object>,
 *          distances?:number[], sizeArcsec?:number, fluxTol?:number}} o
 * @returns {Promise<Array<{distAU,ra,dec,shiftArcsec,pa,nNew,hit:boolean|null,hitAt,error?}>>} one row per distance; hit is null (not false) when the field could not be built
 */
export async function linkFields({ source, mjdB, getField, distances = DISTANCES, sizeArcsec = 300, fluxTol = 2 }) {
  const rows = [];
  for (const distAU of distances) {
    const p = predictAtB({ ra: source.ra, dec: source.dec, mjdA: source.mjdA, mjdB, distAU }), row = { distAU, ...p, nNew: 0, hit: false, hitAt: null };
    try {
      const F = await getField(p.ra, p.dec, { mjd: mjdB, sizeArcsec });
      const ib = nearestEpoch(F, mjdB), ia = nearestEpoch(F, source.mjdA, ib);
      if (ib < 0 || ia < 0) throw new Error('the field has fewer than two passes');
      // Something that APPEARED in pass B. `analyse` calls it "New source, no counterpart", but when the field also holds an
      // unrelated vanished source of similar brightness it pairs the two and reports an "Uncatalogued mover" instead; the
      // appeared end (`to`) is just as new, so both count here and the report says which one it was.
      const news = analyse(F, ia, ib).filter(r => r.kind === 'cand' && (r.title === 'New source, no counterpart' || r.title === 'Uncatalogued mover'));
      row.nNew = news.length; row.pair = [ia, ib];
      row.newSources = [];
      for (const r of news) {
        const ratio = apertureFlux(F.frame(ib), F.N, r.x, r.y) / source.flux, off = Math.hypot(r.x - F.N / 2, r.y - F.N / 2) * F.scale;
        const [ra, dec] = radec(F, r.x, r.y);
        row.newSources.push({ x: r.x, y: r.y, ra, dec, offsetArcsec: off, fluxRatio: ratio, flaggedAs: r.title });
        if (ratio >= 1 / fluxTol && ratio <= fluxTol && (!row.hitAt || off < row.hitAt.offsetArcsec)) row.hitAt = { x: r.x, y: r.y, ra, dec, offsetArcsec: off, fluxRatio: ratio, flaggedAs: r.title };
      }
      row.hit = !!row.hitAt;
      // The distance the MEASURED shift implies (not the assumed one): the hit's own position against the source's, with an error bar.
      if (row.hitAt) row.distance = estimateDistance({ A: { ra: source.ra, dec: source.dec, mjd: source.mjdA }, B: { ra: row.hitAt.ra, dec: row.hitAt.dec, mjd: mjdB } });
    } catch (e) { row.hit = null; row.error = e.message; }
    rows.push(row);
  }
  // Neighbouring distances can put the same body in two fields. Say so: it is why a hit does not fix the distance.
  for (const r of rows) {
    r.overlaps = rows.filter(o => o !== r && sepArcsec(r.ra, r.dec, o.ra, o.dec) < sizeArcsec).map(o => o.distAU);   // fields share sky
    r.sameSourceAs = r.hitAt ? rows.filter(o => o !== r && o.hitAt && sepArcsec(r.hitAt.ra, r.hitAt.dec, o.hitAt.ra, o.hitAt.dec) < 15).map(o => o.distAU) : [];   // one source seen in both fields
  }
  return rows;
}

/** "Source vanished" results of a saved/built field for epoch pair (a, b), as sources ready for linkFields. */
export function vanishedSources(F, a, b) {
  return analyse(F, a, b).filter(r => r.kind === 'left' && r.title === 'Source vanished' && r.from).map(r => {
    const [ra, dec] = radec(F, r.x, r.y);
    return { ra, dec, mjdA: F.epochs[a].mjd, flux: apertureFlux(F.frame(a), F.N, r.x, r.y), pixel: [r.x, r.y] };
  });
}


/** GET {server}/api/field with retries: IRSA answers 502/503 on a good share of cold requests, and the server passes that status on.
 *  Retries 5xx up to `tries` times with a growing wait, prints each retry, and puts the server's own error text in the final error. */
export async function fetchField(server, { ra, dec, size = 300, mjd, known = false }, { tries = 4, waitMs = 15000, log = m => console.error(m) } = {}) {
  const u = `${server}/api/field?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&size=${size}&known=${known ? 1 : 0}${mjd ? '&t=' + mjd : ''}`; // the server's anchor parameter is `t` (MJD or date), see server/README.md
  let last;
  for (let k = 1; k <= tries; k++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (r.ok) return toField(await r.json());
      let msg = ''; try { msg = (await r.json()).error || ''; } catch { /* not JSON */ }
      last = new Error(`server answered HTTP ${r.status}${msg ? ': ' + String(msg).replace(/\s+/g, ' ').slice(0, 160) : ''} (${u})`); last.status = r.status;
      if (r.status < 500) break;
    } catch (e) { last = e; }
    if (k < tries) { log(`  … ${String(last.message).slice(0, 110)}; retrying in ${(waitMs * k / 1000).toFixed(0)} s (${k}/${tries - 1})`); await new Promise(res => setTimeout(res, waitMs * k)); }
  }
  throw last;
}

// ---------- CLI ----------
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } return o; }
export const formatRow = r => `${String(r.distAU).padStart(5)} AU  predicted ${r.ra.toFixed(4)}° ${r.dec >= 0 ? '+' : ''}${r.dec.toFixed(4)}°  shift ${r.shiftArcsec.toFixed(0).padStart(4)}″ PA ${r.pa.toFixed(0).padStart(3)}°  ` +
  (r.error === 'predict-only' ? 'prediction only (no field built)' : r.hit === null ? `FIELD UNAVAILABLE (${String(r.error).slice(0, 90)})` : r.hit ? `HIT  ${r.hitAt.offsetArcsec.toFixed(0)}″ from centre, flux ×${r.hitAt.fluxRatio.toFixed(2)}, flagged "${r.hitAt.flaggedAs}" (${r.nNew} new source${r.nNew === 1 ? '' : 's'} in field)${r.sameSourceAs.length ? `  ← SAME source as the hit at ${r.sameSourceAs.join(', ')} AU: the distance is not fixed by this` : ''}` : `no hit (${r.nNew} new source${r.nNew === 1 ? '' : 's'} in field, none with a similar flux)`) +
  (r.overlaps && r.overlaps.length ? `  [field overlaps the ${r.overlaps.join(', ')} AU field${r.overlaps.length > 1 ? 's' : ''}]` : '') +
  (r.distance ? `\n           parallax distance from the measured shift: ${r.distance.verdict}: ${r.distance.text}` : '');

async function main() {
  const o = parseArgs(process.argv.slice(2)), size = +o.size || 300, tol = +o['flux-tol'] || 2, server = o.server || 'http://localhost:8787';
  const distances = o.distances ? String(o.distances).split(',').map(Number) : DISTANCES;
  let jobs = [];
  if (o.field) {
    const F = toField(JSON.parse(fs.readFileSync(o.field, 'utf8'))), [a, b] = String(o.pair || '0,1').split(',').map(Number);
    for (const s of vanishedSources(F, a, b)) jobs.push({ source: s, mjdB: F.epochs[b].mjd });
    if (!jobs.length) { console.log(`No "Source vanished" in ${path.basename(o.field)} for pair ${a}→${b}.`); return; }
  } else {
    for (const k of ['ra', 'dec', 'mjdA', 'mjdB']) if (!Number.isFinite(+o[k])) { console.error(`missing --${k}`); process.exit(2); }
    if (!o['predict-only'] && !(+o.flux > 0)) { console.error('missing --flux (or use --predict-only)'); process.exit(2); }
    jobs.push({ source: { ra: +o.ra, dec: +o.dec, mjdA: +o.mjdA, flux: +o.flux }, mjdB: +o.mjdB });
  }
  const getField = (ra, dec, { mjd, sizeArcsec }) => fetchField(server, { ra, dec, size: sizeArcsec, mjd });
  const out = [];
  for (const j of jobs) {
    const rows = o['predict-only'] ? distances.map(d => ({ distAU: d, ...predictAtB({ ...j.source, mjdB: j.mjdB, distAU: d }), nNew: 0, hit: null, error: 'predict-only' }))
      : await linkFields({ ...j, getField, distances, sizeArcsec: size, fluxTol: tol });
    out.push({ source: j.source, mjdB: j.mjdB, rows });
    if (!o.json) { console.log(`\nSource at ${j.source.ra.toFixed(4)}°, ${j.source.dec.toFixed(4)}° (pass A MJD ${j.source.mjdA.toFixed(1)}, flux ${Number.isFinite(j.source.flux) ? j.source.flux.toFixed(2) : 'n/a'}) → pass B MJD ${j.mjdB.toFixed(1)}`); for (const r of rows) console.log("  " + formatRow(r)); }
  }
  if (o.json) console.log(JSON.stringify({ note: NOTE, results: out }, null, 1)); else console.log('\n' + NOTE);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
