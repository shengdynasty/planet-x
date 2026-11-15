// Save measured SPHEREx spectra for the hosted copy: one per built-in example (app/js/field/examples.js), measured by the
// local data server (GET /api/spectrum) at the target. When a Gaia star sits at the centre of the saved field (within 0.8 px),
// it is measured at its catalogue position with its proper motion, so the server follows it from exposure to exposure.
// A moving example (16 Psyche, anchored on one night) is skipped: there is no single spot to measure.
//
//   node server/index.mjs                              # terminal 1 (needs IRSA)
//   node scripts/save-spectra.mjs [--only psyche,barnard] [--server http://localhost:8787]
//
// Writes app/data/spectra/<id>.json and index.json (each entry's ra/dec is where the target is in the saved field, which
// the app matches within 1.5 px). A spectrum still incomplete after five rounds is refused and the previous one, if any,
// is kept; a complete one is saved even with few or no points (a star too bright for SPHEREx: the app shows why).
// Commit the files; main deploys to GitHub Pages.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES } from '../app/js/field/examples.js';
import { gridPixel } from '../server/lib/wcs.mjs';
import { gaiaAt } from '../server/lib/gaia.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), OUT = join(ROOT, 'app/data/spectra'), SNAP = join(ROOT, 'app/data/snapshots');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const SERVER = (arg('server') || 'http://localhost:8787').replace(/\/$/, ''), ONLY = arg('only') ? arg('only').split(',') : null;
const GAIA_J2016 = 57388.5, MIN_POINTS = 10;

/** The target to measure for an example: its Gaia star at the field centre (catalogue position + proper motion), or the position itself. */
export function targetFor(ex, field) {
  const base = { ra: ex.ra, dec: ex.dec, near: [ex.ra, ex.dec] };
  if (!field || !Array.isArray(field.stars) || !field.epochs || !field.epochs.length) return base;
  const mjd = field.epochs[0].mjd, c = field.N / 2; let best = null, bd = 0.8; // tight: a background star sits 1.2 px from WISE 0855, which Gaia does not have
  for (const s of field.stars) { const [x, y] = gridPixel(field.ra0, field.dec0, field.scale, field.N, ...gaiaAt(s, mjd)); const d = Math.hypot(x - c, y - c); if (d < bd) { bd = d; best = s; } }
  if (!best) return base;
  return { ra: best.ra, dec: best.dec, near: base.near, gaia: best.id, ...(Number.isFinite(best.pmra) && Number.isFinite(best.pmdec) ? { pmra: best.pmra, pmdec: best.pmdec, epoch: GAIA_J2016 } : {}) };
}

async function main() {
  const health = await fetch(SERVER + '/api/health').then(r => r.json()).catch(() => null);
  if (!health || !health.ok) { console.error(`No data server at ${SERVER}. Start one with: node server/index.mjs`); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const snapIndex = existsSync(join(SNAP, 'index.json')) ? JSON.parse(readFileSync(join(SNAP, 'index.json'), 'utf8')) : { targets: [] };
  const old = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { spectra: [] };
  const entries = new Map((old.spectra || []).map(e => [e.id, e]));
  for (const ex of EXAMPLES) {
    if (ONLY && !ONLY.includes(ex.id)) continue;
    if (Number.isFinite(ex.t)) { console.log(`${ex.id}: skipped, a moving target (anchored on one night): no single spot to measure`); continue; }
    const snap = (snapIndex.targets || []).find(t => t.id === ex.id), field = snap && existsSync(join(SNAP, snap.file)) ? JSON.parse(readFileSync(join(SNAP, snap.file), 'utf8')) : null;
    const t = targetFor(ex, field), label = ex.label.split(' · ')[0];
    const qs = new URLSearchParams({ ra: String(t.ra), dec: String(t.dec), sra: String(t.near[0]), sdec: String(t.near[1]) }); // search where the saved field is
    if (t.pmra != null) { qs.set('pmra', String(t.pmra)); qs.set('pmdec', String(t.pmdec)); qs.set('epoch', String(t.epoch)); }
    process.stdout.write(`${ex.id}: ${label}${t.gaia ? ` (Gaia DR3 ${t.gaia}${t.pmra != null ? `, ${(Math.hypot(t.pmra, t.pmdec) / 1000).toFixed(2)}″/yr` : ''})` : ''} … `);
    const t0 = Date.now();
    try {
      // IRSA's file server answers some reads with 503. The server keeps every read that worked and does not keep an
      // incomplete spectrum, so asking again re-reads only the exposures that failed: a few rounds usually complete it.
      let s = null;
      // A cold spectrum can take longer than fetch's 5-minute wait for headers. The server finishes it anyway, so on a
      // timeout wait until /api/progress no longer lists this position, then ask again: the answer is in its cache.
      const ask = async () => {
        for (let tries = 0; ; tries++) {
          try { return await fetch(`${SERVER}/api/spectrum?${qs}`, { signal: AbortSignal.timeout(20 * 60000) }); }
          catch (e) {
            if (tries >= 6) throw e;
            for (let w = 0; w < 120; w++) { // up to 20 minutes
              await new Promise(res => setTimeout(res, 10000));
              const p = await fetch(SERVER + '/api/progress').then(r => r.json()).catch(() => ({}));
              if (!(p.spectra || []).some(b => Math.abs(b.ra - t.ra) < 1e-4 && Math.abs(b.dec - t.dec) < 1e-4)) break;
            }
          }
        }
      };
      for (let round = 1; round <= 5; round++) {
        const r = await ask(); s = await r.json();
        if (!r.ok) throw new Error(s.error || `HTTP ${r.status}`);
        if (!s.incomplete) break;
        process.stdout.write(`(${s.rejected.failed} unread, round ${round}) `); await new Promise(res => setTimeout(res, 5000));
      }
      if (s.incomplete) throw new Error(`incomplete after 5 rounds (${(s.errors || []).join('; ')}); run again when IRSA answers`);
      // a complete answer is saved even with few or no points: a star too bright for SPHEREx says so on the hosted copy
      writeFileSync(join(OUT, `${ex.id}.json`), JSON.stringify(s));
      entries.set(ex.id, { id: ex.id, label, ra: t.near[0], dec: t.near[1], file: `${ex.id}.json`, n: s.points.length, nExposures: s.nExposures, pm: s.pm || null, builtAt: s.builtAt });
      console.log(`${s.points.length} points of ${s.nExposures} exposures, left out ${JSON.stringify(s.rejected)} (${((Date.now() - t0) / 1000).toFixed(0)} s)${s.points.length < MIN_POINTS ? ' — few points: the caption says why' : ''}`);
    } catch (e) { console.log(`refused: ${e.message}${entries.has(ex.id) ? ' (keeping the saved one)' : ''}`); }
  }
  const spectra = EXAMPLES.map(ex => entries.get(ex.id)).filter(Boolean);
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ savedAt: new Date().toISOString(), server: health.version || null, spectra }, null, 1) + '\n');
  console.log(`index.json: ${spectra.length} saved spectra`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
