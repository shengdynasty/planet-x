// Data sources: simulated placeholder data (always available) and live SPHEREx data via the local server
// (server/index.mjs on http://localhost:8787). See app/ARCHITECTURE.md "Data API".
//
//   initData(store)                 → fills store keys scans, candidates, source
//   getField({ra, dec, sizeArcsec}) → Promise<Field>  (field.simulated is always truthful)

export const SERVER = (typeof globalThis !== 'undefined' && globalThis.PLANETX_SERVER) || 'http://localhost:8787';
export const HOME = { ra: 70.42, dec: 19.18, sizeArcsec: 120 }; // live mode's default field (Taurus, near the ecliptic)
const HEALTH_TIMEOUT_MS = 1500;

// ---------- simulated source (the UI demo's placeholder data) ----------
/** @type {import('../core/types.js').Scan[]} */
export const SIM_SCANS = [
  { id: 1, label: 'Scan 1', date: 'May 2025', has: true },
  { id: 2, label: 'Scan 2', date: 'Nov 2025', has: true },
  { id: 3, label: 'Scan 3', date: 'May 2026', has: true },
  { id: 4, label: 'Scan 4', date: 'Nov 2026', has: false },
];

const PH = ' (placeholder)'; // designations below are invented stand-ins, not real cross-matches
const SIM_RAW = [
  { tag: 'Known asteroid · 2003 UB' + PH, status: 'Matched', band: '2.4 µm', pos: [[3.20, 12.0], [3.90, 10.5], [4.55, 9.2]], note: 'Fast main‑belt mover. Cross‑matched to JPL’s catalog on the first pass.' },
  { tag: 'Known comet · C/2024 R3' + PH, status: 'Matched', band: '3.1 µm', pos: [[9.80, -22.0], [10.30, -24.0], [10.95, -25.6]], note: 'Extended emission consistent with a coma.' },
  { tag: 'Unmatched · slow mover', status: 'Candidate', band: '4.6 µm', pos: [[16.10, 41.0], [16.15, 41.2], [16.19, 41.35]], note: 'No match in the known‑object catalog. A shift this small over six months is consistent with a very distant body. Candidate signal, not a detection.' },
  { tag: 'Known asteroid · 1998 KY26' + PH, status: 'Matched', band: '1.6 µm', pos: [[20.40, -8.0], [21.10, -6.4], [21.85, -4.9]], note: 'Near‑Earth asteroid. Large shift between scans.' },
  { tag: 'Probable brown dwarf', status: 'Likely', band: '4.1 µm', pos: [[6.70, 58.0], [6.78, 57.6], [6.86, 57.2]], note: 'Bright in the longest bands, faint in the shortest. Motion suggests a nearby cool object.' },
  { tag: 'Unmatched · slow mover', status: 'Candidate', band: '4.6 µm', pos: [[13.40, -47.0], [13.42, -46.7], [13.45, -46.4]], note: 'Second slow, unmatched source. Three epochs is the minimum for an orbit fit; the solution is still poorly constrained.' },
];

/** @type {import('../core/types.js').Candidate[]} */
export const SIM_CANDIDATES = SIM_RAW.map((c, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    id: 'c' + n, name: 'Candidate ' + n, tag: c.tag, status: c.status, pipelineStatus: c.status, band: c.band,
    pos: c.pos.map(p => [p[0], p[1]]), note: c.note + ' Simulated placeholder data.', simulated: true,
  };
});

const simCopy = () => ({ scans: SIM_SCANS.map(s => ({ ...s })), candidates: SIM_CANDIDATES.map(c => ({ ...c, pos: c.pos.map(p => [...p]) })) });

// ---------- helpers ----------
let storeRef = null;
let mode = 'sim';

async function getJSON(path, timeoutMs) {
  const r = await fetch(SERVER + path, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  let body = null; try { body = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
  return body;
}

function useSim(store, why) {
  mode = 'sim';
  const { scans, candidates } = simCopy();
  store.set('scans', scans);
  store.set('candidates', candidates);
  store.set('source', { mode: 'sim', live: false, note: why ? `Simulated data · ${why}` : 'Simulated data' });
}

/** Fill scans, candidates and source. Never throws; falls back to simulated data on any failure. */
export async function initData(store) {
  storeRef = store;
  let health = null;
  try { health = await getJSON('/api/health', HEALTH_TIMEOUT_MS); } catch { /* no server, or sandboxed (claude.ai): stay quiet */ }
  if (!health || !health.ok) return useSim(store, 'no local data server');
  try {
    const home = health.home || HOME;
    const sc = await getJSON(`/api/scans?ra=${home.ra}&dec=${home.dec}`, 30000);
    if (!sc.epochs || !sc.epochs.length) throw new Error('no SPHEREx scans cover the home field');
    const scans = sc.epochs.map(e => ({ id: e.id, label: e.label, date: e.date, has: true, start: e.start, end: e.end, nExposures: e.nExposures }));
    mode = 'live';
    store.set('scans', scans);
    store.set('candidates', []);
    store.set('source', { mode: 'live', live: true, note: 'Live · SPHEREx via IRSA' });
    loadLiveCandidates(store, home); // background: JPL lookups can take a minute the first time
  } catch (e) {
    useSim(store, `live server error (${e.message})`);
  }
}

// Poll gently; unref so Node tests can exit while a poll is pending.
const later = fn => { const t = setTimeout(fn, 15000); if (t && t.unref) t.unref(); };

async function loadLiveCandidates(store, home, attempt = 0) {
  try {
    const r = await getJSON(`/api/candidates?ra=${home.ra}&dec=${home.dec}`, 15000);
    if (mode !== 'live') return;
    if (r.pending) { if (attempt < 40) later(() => loadLiveCandidates(store, home, attempt + 1)); return; }
    store.set('candidates', (r.candidates || []).map(c => ({ ...c, pipelineStatus: c.pipelineStatus || c.status, simulated: false })));
  } catch (e) {
    if (attempt < 3) later(() => loadLiveCandidates(store, home, attempt + 1));
    else store.emit && store.emit('toast', `Could not load known objects: ${e.message}`);
  }
}

// ---------- fields ----------
function b64ToFloat32(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer); // server writes little-endian, as are all browsers' platforms
}

/** Convert the server's JSON field into the Field shape (types.js). Exported for tests. */
export function toField(j) {
  const frames = j.frames.map(b64ToFloat32);
  const known = (j.known || []).map(k => {
    const s = [...k.samples].sort((a, b) => a.t - b.t);
    return {
      name: k.name, vmag: k.vmag, source: k.source || 'JPL',
      // Exact at frame times; linear between samples less than 3 days apart; otherwise outside the field.
      pos: t => {
        for (const p of s) if (Math.abs(p.t - t) < 1e-6) return [p.x, p.y];
        for (let i = 0; i + 1 < s.length; i++) if (s[i].t < t && t < s[i + 1].t && s[i + 1].t - s[i].t < 3) {
          const f = (t - s[i].t) / (s[i + 1].t - s[i].t); return [s[i].x + f * (s[i + 1].x - s[i].x), s[i].y + f * (s[i + 1].y - s[i].y)];
        }
        return [-999, -999];
      },
    };
  });
  const { frames: _f, known: _k, ...meta } = j;
  return { ...meta, epochs: j.epochs, frame: i => frames[i], known, simulated: false };
}

async function simField(ra, dec) {
  let mod;
  try { mod = await import('../pipeline/index.js'); }
  catch (e) { throw new Error(`Simulated field unavailable: app/js/pipeline/index.js could not be loaded (${e.message})`); }
  if (typeof mod.simulateField !== 'function') throw new Error('app/js/pipeline/index.js does not export simulateField');
  const f = mod.simulateField(Number.isFinite(ra) && Number.isFinite(dec) ? { ra0: ra, dec0: dec } : {});
  f.ra0 = Number.isFinite(ra) ? ra : f.ra0; f.dec0 = Number.isFinite(dec) ? dec : f.dec0;
  f.simulated = true;
  return f;
}

/**
 * @param {{ra:number, dec:number, sizeArcsec?:number, det?:number, known?:boolean}} q  ra/dec in degrees
 * @returns {Promise<import('../core/types.js').Field>}
 */
export async function getField({ ra, dec, sizeArcsec = HOME.sizeArcsec, det, known = true } = {}) {
  if (mode !== 'live') return simField(ra, dec);
  const qs = new URLSearchParams({ ra: String(ra), dec: String(dec), size: String(Math.round(sizeArcsec)) });
  if (det) qs.set('det', String(det));
  if (!known) qs.set('known', '0');
  try {
    return toField(await getJSON('/api/field?' + qs, 600000));
  } catch (e) {
    const f = await simField(ra, dec);
    f.fallbackReason = `Live field failed (${e.message}); showing simulated data`;
    if (storeRef && storeRef.emit) storeRef.emit('toast', f.fallbackReason);
    return f;
  }
}
