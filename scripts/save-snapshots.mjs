#!/usr/bin/env node
// Save the six example fields (app/js/field/examples.js) from a running data server as JSON snapshots in
// app/data/snapshots/, so the app can show real SPHEREx frames, JPL known objects and Gaia stars with no server
// (GitHub Pages). Node ≥ 20, no dependencies.
//
//   node server/index.mjs                       # terminal 1 (a warm cache makes this take seconds, cold ~2 min per field)
//   node scripts/save-snapshots.mjs             # terminal 2; PLANETX_SERVER=http://host:port for another server
//   node scripts/save-snapshots.mjs --allow-partial   # keep a field whose JPL or Gaia lookup failed (marked in index.json)
//
// Writes <id>.json per target (the /api/field answer minus timings) and index.json: when it was saved, the home patch's
// survey scans for the timeline, the known objects as review-panel candidates, and one entry per target.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EXAMPLES } from '../app/js/field/examples.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app', 'data', 'snapshots');
const SERVER = (process.env.PLANETX_SERVER || 'http://localhost:8787').replace(/\/+$/, '');
const ALLOW_PARTIAL = process.argv.includes('--allow-partial');
const HOME = { ra: 70.42, dec: 19.18, size: 120 };

async function getJSON(p, timeoutMs) {
  const r = await fetch(SERVER + p, { signal: AbortSignal.timeout(timeoutMs) });
  let body = null; try { body = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
  return body;
}
const kb = n => `${(n / 1024).toFixed(0)} KB`;

/** The field's known objects as review-panel candidates: the same mapping as server/index.mjs candidatesFor()
 *  (one pos per survey scan, null where the object wasn't in the field; RA in hours). Ids are assigned afterwards. */
function candidatesOf(f) {
  const scanIds = (f.surveyEpochs || []).map(e => e.id).sort((a, b) => a - b);
  const cosd = Math.cos(f.dec0 * Math.PI / 180);
  return (f.known || []).map(k => {
    const perScan = scanIds.map(s => (k.samples || []).find(sm => f.epochs[sm.i] && f.epochs[sm.i].scan === s) || null);
    const pos = perScan.map(sm => {
      if (!sm) return null;
      const ra = f.ra0 - (sm.x - f.N / 2) * f.scale / 3600 / cosd, dec = f.dec0 - (sm.y - f.N / 2) * f.scale / 3600;
      return [+(ra / 15).toFixed(6), +dec.toFixed(6)];
    });
    const star = k.kind === 'star';
    return {
      id: '', name: k.name, tag: star ? `Known high-proper-motion star · ${k.name}` : `Known small body · ${k.name}`,
      status: 'Matched', pipelineStatus: 'Matched', band: `${f.band} µm`, pos, scans: scanIds.filter((_, i) => perScan[i]), match: k.name, simulated: false,
      note: star ? `${k.note || ''} Position from Gaia DR3 proper motion, not a pixel detection.`.trim()
        : `JPL predicts this catalogued object inside the ${Math.round(f.sizeArcsec)}″ field (V≈${k.vmag ?? '?'}). This is an ephemeris prediction, not a confirmed pixel detection.`,
    };
  });
}

let health;
try { health = await getJSON('/api/health', 5000); } catch (e) { console.error(`No data server at ${SERVER} (${e.message}). Start one with: node server/index.mjs`); process.exit(1); }
if (!health || !health.ok) { console.error(`Data server at ${SERVER} is not healthy: ${JSON.stringify(health)}`); process.exit(1); }
console.log(`Data server ${SERVER} (${health.service || 'planet-x-data'} ${health.version || '?'})`);
await mkdir(OUT, { recursive: true });

const home = { ...HOME, ...(health.home || {}) };
process.stdout.write(`home patch (RA ${home.ra}, Dec ${home.dec}): GET /api/scans … `);
const sc = await getJSON(`/api/scans?ra=${home.ra}&dec=${home.dec}`, 120000);
if (!sc.epochs || !sc.epochs.length) { console.error('no SPHEREx scans cover the home patch; nothing saved'); process.exit(1); }
const scans = sc.epochs.map(e => ({ id: e.id, label: e.label, date: e.date, has: true, start: e.start, end: e.end, nExposures: e.nExposures }));
console.log(`${scans.length} scans (${scans.map(s => s.date).join(', ')})`);

const targets = [], candidates = [], seen = new Set();
let refused = 0;
for (const ex of EXAMPLES) {
  const qs = new URLSearchParams({ ra: String(ex.ra), dec: String(ex.dec), size: String(ex.sizeArcsec) });
  if (ex.det) qs.set('det', String(ex.det));
  if (Number.isFinite(ex.t)) qs.set('t', String(ex.t));
  process.stdout.write(`${ex.id}: GET /api/field?${qs} … `);
  const t0 = Date.now();
  let j;
  try { j = await getJSON('/api/field?' + qs, 600000); } catch (e) { console.log(`FAILED (${e.message})`); refused++; continue; }
  const problems = [];
  if (j.knownStatus !== 'ok') problems.push(`knownStatus=${j.knownStatus}`);
  if (j.starsStatus !== 'ok') problems.push(`starsStatus=${j.starsStatus}`);
  if (!Array.isArray(j.epochs) || j.epochs.length < 2) problems.push(`${j.epochs ? j.epochs.length : 0} epochs`);
  if (problems.length && !ALLOW_PARTIAL) { console.log(`REFUSED (${problems.join(', ')}); retry when the server has them, or pass --allow-partial`); refused++; continue; }
  const { timingsMs: _t, ...keep } = j; // timings are about this machine, not the data
  const body = JSON.stringify(keep), file = `${ex.id}.json`;
  await writeFile(path.join(OUT, file), body);
  for (const c of candidatesOf(j)) if (!seen.has(c.name)) { seen.add(c.name); candidates.push(c); }
  const entry = {
    id: ex.id, label: ex.label, ra: ex.ra, dec: ex.dec, sizeArcsec: ex.sizeArcsec, det: ex.det, t: Number.isFinite(ex.t) ? ex.t : null, note: ex.note,
    file, bytes: Buffer.byteLength(body), epochs: j.epochs.length, nKnown: (j.known || []).length, nStars: (j.stars || []).length, builtAt: j.builtAt || null,
  };
  if (problems.length) entry.partial = problems;
  targets.push(entry);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s · ${entry.epochs} epochs · ${entry.nKnown} known · ${entry.nStars} stars · ${kb(entry.bytes)}${problems.length ? ` · PARTIAL: ${problems.join(', ')}` : ''}`);
}
candidates.forEach((c, i) => { c.id = 'k' + String(i + 1).padStart(2, '0'); });

const index = {
  savedAt: new Date().toISOString(), server: { version: health.version || null, url: SERVER },
  home: { ra: home.ra, dec: home.dec, size: home.size }, scans, candidates, targets,
};
await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`\n${targets.length} of ${EXAMPLES.length} fields saved to ${path.relative(ROOT, OUT)}/ · index.json: ${scans.length} scans, ${candidates.length} candidates (${candidates.map(c => c.name).join(', ') || 'none'})`);
if (refused) { console.error(`${refused} target(s) not saved; index.json lists only the saved ones.`); process.exit(2); }
