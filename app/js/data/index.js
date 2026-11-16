// Data sources, in order of preference: live SPHEREx data via the local server (server/index.mjs on
// http://localhost:8787); saved snapshots of the six example fields (app/data/snapshots/, written by
// scripts/save-snapshots.mjs, so the hosted copy shows real frames without a server); the simulated placeholder
// data (always available). See app/ARCHITECTURE.md "Data API".
//
//   initData(store)                 → fills store keys scans, candidates, source  (source.mode: 'live' | 'snapshot' | 'sim')
//   getField({ra, dec, sizeArcsec}) → Promise<Field>  (field.simulated is always truthful; saved fields carry field.snapshot)

import { FIELD_SIZE_MIN, FIELD_SIZE_MAX, FIELD_SIZE_DEFAULT, clampFieldSize } from '../core/limits.js';
import { pixel } from '../pipeline/format.js';

export const SERVER = (typeof globalThis !== 'undefined' && globalThis.PLANETX_SERVER) || 'http://localhost:8787';
export const HOME = { ra: 70.42, dec: 19.18, sizeArcsec: FIELD_SIZE_DEFAULT }; // live mode's default field (Taurus, near the ecliptic)
const HEALTH_TIMEOUT_MS = 1500;
export const SNAPSHOT_TIMEOUT_MS = 5000;
/** Where the saved fields live: PLANETX_SNAPSHOTS (tests, or a copy hosted elsewhere), else app/data/snapshots/ next to
 *  this module. Under Node there is no `location`, so snapshots are only tried when PLANETX_SNAPSHOTS is set. */
const snapshotBase = () => {
  const b = globalThis.PLANETX_SNAPSHOTS || (typeof location !== 'undefined' ? new URL('../../data/snapshots/', import.meta.url).href : null);
  return b ? String(b).replace(/\/*$/, '/') : null;
};
const forcedSim = () => globalThis.PLANETX_DATA === 'sim'; // ?data=sim (main.js): skip the server and the snapshots

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
  { tag: 'Unmatched · slow mover', status: 'Candidate', band: '4.6 µm', pos: [[16.100, 41.000], [16.1014, 41.013], [16.1026, 41.024]], note: 'No match in the known‑object catalog. A shift this small over six months is consistent with a very distant body. Candidate signal, not a detection.' },
  { tag: 'Known asteroid · 1998 KY26' + PH, status: 'Matched', band: '1.6 µm', pos: [[20.40, -8.0], [21.10, -6.4], [21.85, -4.9]], note: 'Near‑Earth asteroid. Large shift between scans.' },
  { tag: 'Probable brown dwarf', status: 'Likely', band: '4.1 µm', pos: [[6.700, 58.000], [6.7004, 57.996], [6.7008, 57.992]], note: 'Bright in the longest bands, faint in the shortest. Motion suggests a nearby cool object.' },
  { tag: 'Unmatched · slow mover', status: 'Candidate', band: '4.6 µm', pos: [[13.400, -47.000], [13.4011, -46.991], [13.4021, -46.983]], note: 'Second slow, unmatched source. Three epochs is the minimum for an orbit fit; the solution is still poorly constrained.' },
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
let mode = 'sim'; // 'sim' | 'snapshot' | 'live'
let snapshotIndex = null; // app/data/snapshots/index.json once loaded (snapshot mode)
const snapshotFiles = new Map(); // target id → Promise<field JSON>
/** ISO timestamp → "14 Nov 2026" (UTC); anything unparsable comes back as given. */
const fmtSaved = iso => { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : String(iso || 'an earlier date'); };

async function getJSON(path, timeoutMs, signal) {
  const t = AbortSignal.timeout(timeoutMs);
  const r = await fetch(SERVER + path, { signal: signal ? (AbortSignal.any ? AbortSignal.any([t, signal]) : signal) : t, cache: 'no-store' });
  let body = null; try { body = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
  return body;
}

// ---------- field-added candidates: persisted so a reviewer's work survives a reload ----------
export const FIELD_CANDS_KEY = 'planetx.fieldcands.v1';
const isFieldCand = c => c && c.source === 'field';
function loadFieldCands() {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(FIELD_CANDS_KEY) || '[]'); return Array.isArray(v) ? v.filter(c => c && typeof c.id === 'string') : []; } catch { return []; }
}
// Two pools, told apart by `simulated`: entries from simulated fields (sim mode) and from real ones (live and snapshot modes).
function saveFieldCands(list) {
  try {
    const sim = mode === 'sim';
    const other = loadFieldCands().filter(c => !!c.simulated !== sim); // keep the other pool's entries untouched
    globalThis.localStorage?.setItem(FIELD_CANDS_KEY, JSON.stringify([...other, ...list.filter(isFieldCand)]));
  } catch { /* storage blocked: nothing to do */ }
}
/** This mode's saved field candidates (sim-field ones only in sim mode, real ones in live and snapshot modes). */
const restoredFieldCands = () => loadFieldCands().filter(c => !!c.simulated === (mode === 'sim')).map(c => ({ ...c, source: 'field' }));
let persistWired = false;
function wirePersistence(store) {
  if (persistWired || !store.on) return; persistWired = true;
  let last = '';
  store.on('candidates', list => { const j = JSON.stringify((list || []).filter(isFieldCand)); if (j !== last) { last = j; saveFieldCands(list || []); } });
}

/** Merge a fresh data-source list into the current one: data-source entries replaced by id, field-added kept. */
export function mergeCandidates(current, fresh) {
  const ids = new Set(fresh.map(c => c.id));
  return [...fresh, ...(current || []).filter(c => isFieldCand(c) && !ids.has(c.id))];
}

function useSim(store, why) {
  mode = 'sim';
  const { scans, candidates } = simCopy();
  store.set('scans', scans);
  store.set('candidates', candidates.concat(restoredFieldCands().filter(c => !candidates.some(d => d.id === c.id))));
  wirePersistence(store);
  store.set('source', { mode: 'sim', live: false, note: why ? `Simulated data · ${why}` : 'Simulated data' });
}

/**
 * Saved snapshots of the example fields (app/data/snapshots/index.json): real SPHEREx data without a server. Fills
 * scans (the home patch's survey scans), candidates (the known objects JPL and Gaia put in those fields) and source;
 * returns false, touching nothing, when there are none (not served, blocked, or running under Node without PLANETX_SNAPSHOTS).
 */
async function useSnapshots(store, why) {
  const base = snapshotBase(); if (!base) return false;
  let idx;
  try {
    const r = await fetch(base + 'index.json', { signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS), cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    idx = await r.json();
    if (!Array.isArray(idx.targets) || !idx.targets.length) throw new Error('no targets');
    if (!Array.isArray(idx.scans) || !idx.scans.length) throw new Error('no scans');
  } catch (e) { if (typeof console !== 'undefined' && console.info) console.info(`[planet-x] no saved SPHEREx data (${e.message}); ${why}`); return false; }
  snapshotIndex = idx; mode = 'snapshot';
  store.set('scans', idx.scans.map(s => ({ ...s, has: s.has !== false })));
  const cands = (idx.candidates || []).map(c => ({ ...c, pipelineStatus: c.pipelineStatus || c.status, simulated: false }));
  store.set('candidates', mergeCandidates(restoredFieldCands(), cands));
  wirePersistence(store);
  const home = idx.home || HOME;
  store.set('source', {
    mode: 'snapshot', live: false, snapshot: true, savedAt: idx.savedAt || null, note: `Saved SPHEREx data · saved ${fmtSaved(idx.savedAt)}`,
    home: { ra: home.ra, dec: home.dec, sizeArcsec: home.size || home.sizeArcsec || HOME.sizeArcsec },
    targets: idx.targets.map(t => ({ id: t.id, label: t.label, ra: t.ra, dec: t.dec, sizeArcsec: t.sizeArcsec, det: t.det, t: Number.isFinite(t.t) ? t.t : null })),
  });
  return true;
}

/** Fill scans, candidates and source. Never throws; falls back to saved snapshots, then to simulated data, on any failure. */
export async function initData(store) {
  storeRef = store;
  if (forcedSim()) return useSim(store, 'simulation requested (?data=sim)');
  let health = null;
  // a hosted copy (GitHub Pages, claude.ai) can't reach a visitor's localhost, and Chrome would ask them for
  // local-network access, so only look for the local server when the page is served locally or one is configured
  const host = typeof location !== 'undefined' ? location.hostname : ''; // no `location` under Node (tests)
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(host) || globalThis.PLANETX_SERVER;
  if (local) try { health = await getJSON('/api/health', HEALTH_TIMEOUT_MS); } catch { /* no server, or sandboxed (claude.ai): stay quiet */ }
  if (!health || !health.ok) { const why = 'no local data server'; if (!(await useSnapshots(store, why))) useSim(store, why); return; }
  try {
    const home = health.home || HOME;
    const sc = await getJSON(`/api/scans?ra=${home.ra}&dec=${home.dec}`, 30000);
    if (!sc.epochs || !sc.epochs.length) throw new Error('no SPHEREx scans cover the home field');
    const scans = sc.epochs.map(e => ({ id: e.id, label: e.label, date: e.date, has: true, start: e.start, end: e.end, nExposures: e.nExposures }));
    mode = 'live';
    store.set('scans', scans);
    store.set('candidates', restoredFieldCands());
    wirePersistence(store);
    store.set('source', { mode: 'live', live: true, note: 'Live · SPHEREx via IRSA', home: { ra: home.ra, dec: home.dec, sizeArcsec: home.size || HOME.sizeArcsec } });
    loadLiveCandidates(store, home); // background: JPL lookups can take a minute the first time
  } catch (e) {
    const why = `live server error (${e.message})`;
    if (!(await useSnapshots(store, why))) useSim(store, why);
  }
}

// Poll gently; unref so Node tests can exit while a poll is pending.
const later = fn => { const t = setTimeout(fn, 15000); if (t && t.unref) t.unref(); };

async function loadLiveCandidates(store, home, attempt = 0) {
  try {
    const r = await getJSON(`/api/candidates?ra=${home.ra}&dec=${home.dec}`, 15000);
    if (mode !== 'live') return;
    if (r.pending) { if (attempt < 40) later(() => loadLiveCandidates(store, home, attempt + 1)); return; }
    const fresh = (r.candidates || []).map(c => ({ ...c, pipelineStatus: c.pipelineStatus || c.status, simulated: false }));
    const merged = mergeCandidates(store.get ? store.get('candidates') : [], fresh);
    store.set('candidates', merged);
    // the poll can drop a known object; don't leave the selection pointing at nothing
    if (store.get && store.get('selectedId') && !merged.some(c => c.id === store.get('selectedId'))) store.set('selectedId', null);
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

function b64ToUint32(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Uint32Array(u8.buffer);
}
const GAIA_EPOCH_MJD = 57388.5; // J2016.0, the epoch of Gaia DR3 positions

/** Convert the server's JSON field into the Field shape (types.js). Exported for tests. */
export function toField(j) {
  const frames = j.frames.map(b64ToFloat32);
  const flags = (j.flags || []).map(b64ToUint32); // SPHEREx pipeline FLAGS per frame (bit names in j.flagBits)
  const known = (j.known || []).map(k => {
    const s = [...k.samples].sort((a, b) => a.t - b.t);
    return {
      name: k.name, kind: k.kind || 'sb', vmag: k.vmag, source: k.source || 'JPL', note: k.note || null, pmArcsecYr: k.pmArcsecYr ?? null,
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
  // Gaia DR3 stars: pixel position at field time t (days from the first frame), propagating the proper motion
  // from J2016.0 on the same exact TAN grid as pipeline/format.js radec().
  const t0 = j.epochs && j.epochs[0] && Number.isFinite(j.epochs[0].mjd) ? j.epochs[0].mjd : GAIA_EPOCH_MJD;
  const stars = (j.stars || []).map(s => ({
    id: s.id, name: s.name || `Gaia DR3 ${s.id}`, g: s.g, rp: s.rp, pm: s.pmra == null || s.pmdec == null ? 0 : Math.hypot(s.pmra, s.pmdec) / 1000,
    pos: t => {
      const dt = (t0 + t - GAIA_EPOCH_MJD) / 365.25;
      const ra = s.ra + (s.pmra || 0) * dt / 3.6e6 / Math.cos(s.dec * Math.PI / 180), dec = s.dec + (s.pmdec || 0) * dt / 3.6e6;
      return pixel(j, ra, dec);   // exact TAN, same as the server grid; also correct across RA 0h (ISS-05)
    },
  }));
  const { frames: _f, flags: _fl, known: _k, stars: _s, ...meta } = j;
  const field = { ...meta, epochs: j.epochs, frame: i => frames[i], flags: i => flags[i] || null, flagBits: j.flagBits || null, known, stars, simulated: false };
  Object.defineProperty(field, '_json', { value: j }); // the original JSON, kept (not enumerable) so the field can be saved to a file as it came
  return field;
}

// ---------- releases: which SPHEREx data release each image came from, and releases typed in by hand ----------
/** IRSA collection names look like spherex_dr1, spherex_qr3. Same rule as the server (server/lib/irsa.mjs isCollectionName). */
export const isCollectionName = c => typeof c === 'string' && /^spherex_[a-z0-9_]{1,40}$/.test(c) && !/_(cal|deep|cube)$/.test(c);
export const RELEASES_KEY = 'planetx.releases.v1';
export const MAX_RELEASES = 4;
/** Turn what a person typed ("spherex_dr2, SPHEREX_qr4", or just "dr2") into {list, bad}: valid collection names and the words that were not. */
export function parseReleases(text) {
  const list = [], bad = [];
  for (let w of String(text ?? '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean)) {
    if (/^(dr|qr)\d+$/.test(w)) w = 'spherex_' + w; // "dr2" is accepted as shorthand for spherex_dr2
    if (!isCollectionName(w)) bad.push(w); else if (!list.includes(w)) list.push(w);
  }
  if (list.length > MAX_RELEASES) { bad.push(...list.splice(MAX_RELEASES)); }
  return { list, bad };
}
/** The releases this browser has been told about (kept in localStorage; [] if none or storage is blocked). */
export function getReleases() {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(RELEASES_KEY) || '[]'); return Array.isArray(v) ? v.filter(isCollectionName).slice(0, MAX_RELEASES) : []; } catch { return []; }
}
export function setReleases(list) {
  const clean = [...new Set((list || []).filter(isCollectionName))].slice(0, MAX_RELEASES);
  try { globalThis.localStorage?.setItem(RELEASES_KEY, JSON.stringify(clean)); } catch { /* storage blocked: the list lasts until reload */ }
  return clean;
}
/**
 * What adding a person's text to the releases already kept would do, without saving anything:
 * {list: the list to keep, added, already, bad, full}. Nothing is added when a word is not a release name (`bad`) or
 * when the list would go past MAX_RELEASES (`full`), so the caller can say why instead of dropping names quietly.
 */
export function addReleases(current, text) {
  const { list, bad } = parseReleases(text);
  const over = bad.filter(isCollectionName), junk = bad.filter(b => !isCollectionName(b)); // parseReleases moves names past the limit into bad
  const have = [...new Set((current || []).filter(isCollectionName))], asked = [...list, ...over];
  const added = asked.filter(c => !have.includes(c)), already = asked.filter(c => have.includes(c));
  const full = have.length + added.length > MAX_RELEASES, ok = !junk.length && !full;
  return { list: ok ? [...have, ...added] : have, added: ok ? added : [], already, bad: junk, full };
}
/** A typed release's line for the current field, from the server's report: '12 exposures here', 'no exposures here yet',
 *  'IRSA refused it (HTTP 400)', or '' when this field was not loaded with it. */
export function requestedStatusText(field, collection) {
  const all = field && field.source && Array.isArray(field.source.requestedStatus) ? field.source.requestedStatus : [];
  const s = all.find(x => x && x.collection === collection); if (!s) return '';
  if (s.error) return `IRSA refused it (${String(s.error).slice(0, 120)})`;
  const n = Number.isFinite(+s.exposures) ? +s.exposures : 0;
  return n ? `${n} exposure${n === 1 ? '' : 's'} here` : 'no exposures here yet';
}
/** "2026-11-04T00:00:00Z" or an MJD → "4 Nov 2026"; '' when there is nothing to show. */
const fmtRelease = r => { if (r == null || r === '') return ''; const ms = Number.isFinite(+r) && +r > 40000 && +r < 100000 ? (+r - 40587) * 86400000 : Date.parse(r); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : String(r); };
/** One epoch's release as text: "spherex_dr1 · released 4 Nov 2026", or "" for a field that carries no release (simulated, older saved files). */
export function releaseLabel(e) {
  if (!e || !e.collection) return '';
  const d = fmtRelease(e.release);
  return d ? `${e.collection} · released ${d}` : e.collection;
}
/** The releases a field draws on: [{collection, release (earliest date text or ''), n (images)}], in name order. */
export function fieldReleases(field) {
  const m = new Map();
  for (const e of (field && field.epochs) || []) {
    if (!e.collection) continue;
    const r = m.get(e.collection) || { collection: e.collection, release: '', n: 0 };
    r.n++; const d = fmtRelease(e.release); if (d && (!r.release || Date.parse(String(e.release)) < Date.parse(r.release))) r.release = d;
    m.set(e.collection, r);
  }
  return [...m.values()].sort((a, b) => a.collection.localeCompare(b.collection));
}

// ---------- field files: save a field pulled on one machine, open it on any other (no server needed) ----------
export const FIELD_FILE_MAX_BYTES = 200e6;
/** The text of a field file: the server's field JSON exactly as it came. Throws for a simulated field (nothing real to save). */
export function fieldFileText(field) {
  if (!field || field.simulated || !field._json) throw new Error('This field is simulated or was not loaded from SPHEREx data, so there is nothing to save');
  return JSON.stringify(field._json);
}
/** A readable file name: planetx-field-70.4200+19.1800-D1.json */
export function fieldFileName(field) {
  const f = (v, d) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(d);
  return `planetx-field-${(+field.ra0).toFixed(4)}${f(+field.dec0, 4)}-D${field.detector ?? 'x'}.json`;
}
/** Check a field file's text and turn it into a Field. Throws an Error whose message says what is wrong. */
export function parseFieldFile(text, name = '') {
  let j; try { j = JSON.parse(text); } catch { throw new Error('This file is not JSON. Open a field file saved from this app or from the data server (/api/field).'); }
  const bad = why => new Error(`Not a Planet X field file (${why})`);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw bad('expected an object');
  if (j.simulated) throw bad('it is a simulated field');
  const N = j.N;
  if (!Number.isInteger(N) || N < 8 || N > 400) throw bad('N missing or out of range');
  for (const k of ['ra0', 'dec0', 'scale']) if (!Number.isFinite(j[k])) throw bad(`${k} missing`);
  if (!Array.isArray(j.frames) || j.frames.length < 2) throw bad('needs at least two frames');
  if (!Array.isArray(j.epochs) || j.epochs.length !== j.frames.length) throw bad('epochs do not match frames');
  for (const [i, e] of j.epochs.entries()) if (!e || !Number.isFinite(e.t) || e.band == null) throw bad(`epoch ${i + 1} is incomplete`);
  for (const [i, b] of j.frames.entries()) if (typeof b !== 'string' || Math.floor(b.length * 3 / 4) < N * N * 4 - 3) throw bad(`frame ${i + 1} is too short for ${N}×${N} pixels`);
  if (j.flags && (!Array.isArray(j.flags) || j.flags.length !== j.frames.length)) throw bad('flags do not match frames');
  let f; try { f = toField(j); } catch (e) { throw bad(e.message); }
  f.fromFile = { name: String(name || ''), savedAt: j.builtAt || null };
  f.request = { ra: j.ra0, dec: j.dec0, sizeArcsec: N * j.scale, det: j.detector, t: null, known: true };
  return f;
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

export const LIVE_MIN_ARCSEC = FIELD_SIZE_MIN, LIVE_MAX_ARCSEC = FIELD_SIZE_MAX, LIVE_DEFAULT_ARCSEC = 300;
/** The size actually requested from the server: rounded and clamped to 40–600″ (core/limits.js, the server's own range),
 *  except that a request wider than the maximum (the sim's 1968″ field re-requested live) gets the 300″ default. */
export const liveSize = s => !Number.isFinite(s) ? HOME.sizeArcsec : s > LIVE_MAX_ARCSEC ? LIVE_DEFAULT_ARCSEC : clampFieldSize(s);
export const isLive = () => mode === 'live';
export const isSnapshot = () => mode === 'snapshot';
export const dataMode = () => mode;

// ---------- saved snapshots ----------
const SNAP_EXACT_DEG = 1e-3; // an example target asked for by its own coordinates (3.6″; the Examples menu and deep links)
const wrapDeg = d => Math.abs(((d + 540) % 360) - 180);
/** Angular separation in arcsec (haversine). */
const sepArcsec = (ra1, dec1, ra2, dec2) => {
  const R = Math.PI / 180, dRa = (ra2 - ra1) * R, dDe = (dec2 - dec1) * R;
  const a = Math.sin(dDe / 2) ** 2 + Math.cos(dec1 * R) * Math.cos(dec2 * R) * Math.sin(dRa / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) / R * 3600;
};
/** The saved target for a request: the one at these coordinates, else the one whose field contains them (nearest wins), else null. Exported for tests. */
export function findSnapshot(targets, ra, dec) {
  if (!Array.isArray(targets) || !Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  const exact = targets.find(s => wrapDeg(s.ra - ra) < SNAP_EXACT_DEG && Math.abs(s.dec - dec) < SNAP_EXACT_DEG);
  if (exact) return { target: exact, exact: true };
  let best = null, bd = Infinity;
  for (const s of targets) { const d = sepArcsec(ra, dec, s.ra, s.dec); if (d < (s.sizeArcsec || LIVE_DEFAULT_ARCSEC) / 2 && d < bd) { best = s; bd = d; } }
  return best ? { target: best, exact: false } : null;
}
function loadSnapshotFile(s, signal) {
  if (!snapshotFiles.has(s.id)) {
    const p = (async () => {
      const t = AbortSignal.timeout(60000);
      const r = await fetch(snapshotBase() + s.file, { signal: signal ? (AbortSignal.any ? AbortSignal.any([t, signal]) : signal) : t });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })();
    p.catch(() => snapshotFiles.delete(s.id)); // a failed download is retried next time
    snapshotFiles.set(s.id, p);
  }
  return snapshotFiles.get(s.id);
}
let lastSnapToast = '';
async function snapshotField({ ra, dec, sizeArcsec, det, t, signal, fallback }) {
  const hit = findSnapshot(snapshotIndex && snapshotIndex.targets, ra, dec);
  if (!hit) {
    const f = await simField(ra, dec);
    f.fallbackReason = 'No saved SPHEREx data for this patch; showing simulated data (run the local server for any position)';
    if (storeRef && storeRef.emit) storeRef.emit('toast', f.fallbackReason);
    return f;
  }
  const s = hit.target;
  try {
    const f = toField(await loadSnapshotFile(s, signal));
    f.snapshot = { id: s.id, label: s.label, savedAt: snapshotIndex.savedAt || null };
    f.request = { ra: s.ra, dec: s.dec, sizeArcsec: s.sizeArcsec, det: s.det || f.detector, t: Number.isFinite(s.t) ? s.t : null, known: true };
    // the saved field is what it is: say so when the request asked for something else
    const differs = !hit.exact || (Number.isFinite(sizeArcsec) && liveSize(sizeArcsec) !== s.sizeArcsec) || (det && det !== s.det)
      || (Number.isFinite(t) && t > 60000 && !(Number.isFinite(s.t) && Math.abs(s.t - t) < 1e-3));
    const key = `${s.id}:${ra}:${dec}:${sizeArcsec}:${det}:${t}`;
    if (differs && key !== lastSnapToast && storeRef && storeRef.emit) { lastSnapToast = key; storeRef.emit('toast', `Showing the saved ${s.sizeArcsec}″ field for ${s.label}`); }
    return f;
  } catch (e) {
    if (!fallback || (signal && signal.aborted)) throw e;
    const f = await simField(ra, dec);
    f.fallbackReason = `Saved field failed to load (${e.message}); showing simulated data`;
    if (storeRef && storeRef.emit) storeRef.emit('toast', f.fallbackReason);
    return f;
  }
}

/**
 * @param {{ra:number, dec:number, sizeArcsec?:number, det?:number, t?:number, known?:boolean, signal?:AbortSignal, fallback?:boolean}} q
 *   ra/dec in degrees (required in live and snapshot modes; the simulation picks its own centre without them); det =
 *   SPHEREx detector 1–6; t = MJD to anchor the frame choice on (e.g. the night an asteroid passed); known=false skips
 *   JPL (much faster cold); fallback=false throws instead of returning a simulated field.
 * @returns {Promise<import('../core/types.js').Field>}
 */
export async function getField({ ra, dec, sizeArcsec = HOME.sizeArcsec, det, t, known = true, signal, fallback = true } = {}) {
  // a missing position is a caller's mistake (store.field null, ISS-25), not a data failure: say so here rather than ask the
  // server for ra=undefined or let the fallback dress it up as a simulated field
  if (mode !== 'sim' && !(Number.isFinite(ra) && Number.isFinite(dec))) throw new Error('Field request needs ra and dec');
  if (mode === 'snapshot') return snapshotField({ ra, dec, sizeArcsec, det, t, signal, fallback });
  if (mode !== 'live') return simField(ra, dec);
  const qs = new URLSearchParams({ ra: String(ra), dec: String(dec), size: String(liveSize(sizeArcsec)) });
  if (det) qs.set('det', String(det));
  if (Number.isFinite(t) && t > 60000) qs.set('t', String(t));
  if (!known) qs.set('known', '0');
  const rel = getReleases(); if (rel.length) qs.set('collections', rel.join(',')); // releases typed in by hand: searched in addition to the discovered ones
  try {
    const f = toField(await getJSON('/api/field?' + qs, 600000, signal));
    f.request = { ra, dec, sizeArcsec: liveSize(sizeArcsec), det: det || f.detector, t: Number.isFinite(t) ? t : null, known };
    return f;
  } catch (e) {
    if (!fallback || (signal && signal.aborted)) throw e;
    const f = await simField(ra, dec);
    f.fallbackReason = `Live field failed (${e.message}); showing simulated data`;
    if (storeRef && storeRef.emit) storeRef.emit('toast', f.fallbackReason);
    return f;
  }
}

// ---------- spectra: one position's brightness in every SPHEREx exposure (server), or a saved copy (hosted) ----------
/** Where saved spectra live: PLANETX_SPECTRA (tests), else app/data/spectra/ next to this module. */
const spectraBase = () => {
  const b = globalThis.PLANETX_SPECTRA || (typeof location !== 'undefined' ? new URL('../../data/spectra/', import.meta.url).href : null);
  return b ? String(b).replace(/\/*$/, '/') : null;
};
/** A saved spectrum answers for a position within this distance of its own (1.5 SPHEREx pixels). */
export const SPECTRUM_MATCH_ARCSEC = 9;
/** The saved spectrum entry nearest (ra, dec) within SPECTRUM_MATCH_ARCSEC, or null. Exported for tests. */
export function findSavedSpectrum(list, ra, dec) {
  if (!Array.isArray(list) || !Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  let best = null, bd = Infinity;
  for (const s of list) { if (!s || !Number.isFinite(s.ra) || !Number.isFinite(s.dec)) continue; const d = sepArcsec(ra, dec, s.ra, s.dec); if (d < bd) { bd = d; best = s; } }
  return best && bd <= SPECTRUM_MATCH_ARCSEC ? best : null;
}
let spectraIndex = null; // Promise<[{id, label, ra, dec, file}]>
/** The saved spectra (app/data/spectra/index.json), or [] when there are none or they cannot be read. */
export function savedSpectra() {
  if (!spectraIndex) spectraIndex = (async () => {
    const base = spectraBase(); if (!base) return [];
    try { const r = await fetch(base + 'index.json', { signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS), cache: 'no-store' }); if (!r.ok) return []; const j = await r.json(); return Array.isArray(j.spectra) ? j.spectra : []; }
    catch { return []; }
  })();
  return spectraIndex;
}
/**
 * A measured SPHEREx spectrum at (ra, dec), from the data server when it runs (`source: 'live'`), else the saved one for
 * that spot (`source: 'saved'`). pmra/pmdec (mas/yr) with `epoch` (MJD of ra/dec; the server assumes Gaia's J2016.0)
 * move the position to each exposure's time. Throws an Error that says why when there is neither.
 */
export async function getSpectrum({ ra, dec, pmra, pmdec, epoch, near, signal } = {}) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) throw new Error('No position to measure');
  if (mode === 'live') {
    const qs = new URLSearchParams({ ra: String(+ra.toFixed(6)), dec: String(+dec.toFixed(6)) });
    if (Number.isFinite(pmra) && Number.isFinite(pmdec)) { qs.set('pmra', String(pmra)); qs.set('pmdec', String(pmdec)); if (Number.isFinite(epoch)) qs.set('epoch', String(epoch)); }
    if (Array.isArray(near) && near.every(Number.isFinite)) { qs.set('sra', String(+near[0].toFixed(6))); qs.set('sdec', String(+near[1].toFixed(6))); } // search IRSA where the star is during the survey
    const rel = getReleases(); if (rel.length) qs.set('collections', rel.join(','));
    return { ...(await getJSON('/api/spectrum?' + qs, 600000, signal)), source: 'live' };
  }
  if (mode !== 'snapshot') throw new Error('Simulated data has no SPHEREx spectrum');
  const [nra, ndec] = Array.isArray(near) && near.every(Number.isFinite) ? near : [ra, dec]; // where it is in the field: a fast star's catalogue position can be far off
  const list = await savedSpectra(), hit = findSavedSpectrum(list, nra, ndec);
  if (!hit) throw new Error(!list.length ? 'No spectra are saved for the hosted copy yet. Run the local data server to measure any star.'
    : list.length > 6 ? 'On this copy, spectra are saved for each example’s target and a few of the brightest stars in its field (ringed while you pick). Run the local data server to measure any star.'
    : `Spectra are saved for ${list.map(s => s.label).join(', ')} only. Run the local data server to measure any star.`);
  const t = AbortSignal.timeout(60000), r = await fetch(spectraBase() + hit.file, { signal: signal ? (AbortSignal.any ? AbortSignal.any([t, signal]) : signal) : t });
  if (!r.ok) throw new Error(`The saved spectrum could not be loaded (HTTP ${r.status})`);
  return { ...(await r.json()), source: 'saved', savedLabel: hit.label };
}
/** Spectrum builds the server is working on (GET /api/progress `spectra`), or null. */
export async function spectrumProgress(signal) {
  if (mode !== 'live' || noProgress) return null;
  try { const r = await getJSON('/api/progress', 3000, signal); return Array.isArray(r.spectra) ? r.spectra : null; } catch { return null; }
}

/** Cold field builds the server is working on (GET /api/progress), or null if the server doesn't report them. */
let noProgress = false; // an older server without /api/progress: ask once, then stop
export async function fieldProgress(signal) {
  if (mode !== 'live' || noProgress) return null;
  try { const r = await getJSON('/api/progress', 3000, signal); return Array.isArray(r.builds) ? r.builds : null; }
  catch (e) { if (/Not found|HTTP 404/i.test(e.message)) noProgress = true; return null; }
}
