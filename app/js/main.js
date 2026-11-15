// Boot sequence (see app/ARCHITECTURE.md). Modules owned by other agents are loaded with dynamic import()
// so a missing or broken module falls back to a built-in stand-in instead of taking the app down.
import * as store from './core/store.js';
import { mountSky } from './sky/index.js';
import { mountHud } from './sky/hud.js';
import { mountModes } from './modes.js';
import { mountCompare } from './compare/index.js';
import { initDataStub, mountCandidatesStub, mountFieldStub } from './sky/fallbacks.js';
import { parseCentre } from './sky/coords.js';
import { clampFieldSize, FIELD_SIZE_MIN, FIELD_SIZE_MAX } from './core/limits.js';

const $ = id => document.getElementById(id);
const boot = { modules: {}, ready: false };
window.__pxBoot = boot;

// Deep links: /app/?ra=&dec=[&size=40–600″&det=1-6&t=MJD|date] opens the Field view on that patch (RA/Dec in degrees or
// sexagesimal), so a position can be embedded or shared; ?api=https://… points the data module at a hosted data
// server (otherwise it looks for one on localhost:8787 only when the page itself is served locally); ?data=sim skips
// the server and the saved snapshots (app/data/snapshots/) and runs on the simulation.
const Q = new URLSearchParams(location.search);
if (Q.get('api')) globalThis.PLANETX_SERVER = Q.get('api').replace(/\/+$/, '');
if (Q.get('data') === 'sim') globalThis.PLANETX_DATA = 'sim';
function deepLink() {
  if (!Q.has('ra') || !Q.has('dec')) return null;
  const c = parseCentre(`${Q.get('ra')}, ${Q.get('dec')}`); if (!c) { console.warn('[planet-x] ?ra/?dec not understood'); return null; }
  const f = { ra: c[0], dec: c[1] };
  if (Q.has('size')) { // clamped into the server's range (core/limits.js) rather than dropped, so a shared link still opens near what was meant
    const s = +Q.get('size');
    if (Number.isFinite(s) && s > 0) { f.sizeArcsec = clampFieldSize(s); if (s < FIELD_SIZE_MIN || s > FIELD_SIZE_MAX) console.warn(`[planet-x] ?size=${Q.get('size')} is outside ${FIELD_SIZE_MIN}–${FIELD_SIZE_MAX}″; using ${f.sizeArcsec}″`); }
    else console.warn('[planet-x] ?size not understood');
  }
  const det = +Q.get('det'); if (det >= 1 && det <= 6 && Number.isInteger(det)) f.det = det;
  const t = (Q.get('t') || '').trim();
  if (/^\d{5}(\.\d+)?$/.test(t)) f.t = +t; else if (t) { const ms = Date.parse(/^\d{4}-\d\d-\d\d$/.test(t) ? t + 'T00:00:00Z' : t); if (Number.isFinite(ms)) f.t = ms / 86400000 + 40587; }
  return f;
}

async function load(name, path, exportName, fallback) {
  try {
    const mod = await import(path);
    if (typeof mod[exportName] !== 'function') throw new Error(`${path} has no ${exportName}()`);
    return { fn: mod[exportName], real: true };
  } catch (err) {
    console.warn(`[planet-x] ${name}: using built-in fallback (${err && err.message ? err.message : err})`);
    return { fn: fallback, real: false };
  }
}

async function run(name, mod, fallback, ...args) {
  try { await mod.fn(...args); boot.modules[name] = mod.real ? 'module' : 'fallback'; }
  catch (err) {
    if (!mod.real) throw err;
    console.warn(`[planet-x] ${name} failed, using built-in fallback:`, err);
    // clear anything the failed module left in its mount point
    const el = args.find(a => a instanceof HTMLElement); if (el) el.replaceChildren();
    await fallback(...args); boot.modules[name] = 'fallback';
  }
}

// Start fetching other agents' modules straight away, in parallel.
const pData = load('data', './data/index.js', 'initData', initDataStub);
const pCand = load('candidates', './candidates/index.js', 'mountCandidates', mountCandidatesStub);
const pField = load('field', './field/index.js', 'mountField', mountFieldStub);

// Shell first so the sky paints before data arrives (a live-server probe can take up to 1.5 s).
const hud = mountHud(store);
const sky = mountSky($('stage'), store, { onView: hud.readout, onPick: hud.picked });
hud.attachSky(sky);
mountCompare($('view-compare'), store);

const [data, cand, field] = await Promise.all([pData, pCand, pField]);
await run('candidates', cand, mountCandidatesStub, $('panel'), store);
await run('field', field, mountFieldStub, $('view-field'), store);
await run('data', data, initDataStub, store);
if (!(store.get('candidates') || []).length && !(store.get('scans') || []).length && data.real) {
  console.warn('[planet-x] data module produced no scans or candidates; using placeholder data');
  await initDataStub(store);
}
if (!store.get('scan') || !(store.get('scans') || []).some(s => s.id === store.get('scan') && s.has)) {
  const first = (store.get('scans') || []).find(s => s.has); if (first) store.set('scan', first.id);
}
const deep = deepLink();
if (deep) { store.set('field', deep); store.set('view', 'field'); }
mountModes(store); // after every module has drawn, so the plain-words pass starts from the finished page
boot.ready = true;
document.documentElement.dataset.ready = 'true';
