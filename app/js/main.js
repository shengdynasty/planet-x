// Boot sequence (see app/ARCHITECTURE.md). Modules owned by other agents are loaded with dynamic import()
// so a missing or broken module falls back to a built-in stand-in instead of taking the app down.
import * as store from './core/store.js';
import { mountSky } from './sky/index.js';
import { mountHud } from './sky/hud.js';
import { mountCompare } from './compare/index.js';
import { initDataStub, mountCandidatesStub, mountFieldStub } from './sky/fallbacks.js';

const $ = id => document.getElementById(id);
const boot = { modules: {}, ready: false };
window.__pxBoot = boot;

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
boot.ready = true;
document.documentElement.dataset.ready = 'true';
