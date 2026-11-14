// "Other telescopes" chips for the Field view's vetting section: DSS2, 2MASS and AllWISE images of the selected
// source through Aladin Lite (CDS), plus SIMBAD name labels.
//
// Aladin Lite (GPL-3.0) is NOT bundled in this repo: it is fetched at runtime the first time a chip is pressed,
// so a blocked CDN (claude.ai sandbox, offline) never affects the rest of the app. Sources, tried in order:
//   1. the official npm package (aladin-lite, pinned) as an ES module from jsDelivr;
//   2. the CDS-hosted script, which defines a global `A` (it returned 404 on 2026-11-13, hence the npm source first).
//
//   const ot = mountOtherTelescopes(el);           // el: an empty element inside the vetting section
//   ot.setTarget({ ra, dec, stampArcsec });        // degrees; call whenever the selected source changes
import { SURVEYS, SIMBAD, surveyById, fovDeg, footprint, isTarget, aladinUrl, describe, DEFAULT_STAMP_ARCSEC } from './geom.js';

export const ALADIN_VERSION = '3.8.2';
export const ALADIN_ESM = `https://cdn.jsdelivr.net/npm/aladin-lite@${ALADIN_VERSION}/dist/aladin.js`;
export const ALADIN_SRC = 'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';
const LOAD_TIMEOUT_MS = 20000;

const usable = A => A && typeof A.aladin === 'function';
const withTimeout = (p, ms = LOAD_TIMEOUT_MS) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Aladin Lite took too long to load')), ms))]);

/** ES-module build (npm): `export default A`. */
async function fromModule(url) {
  const mod = await import(/* @vite-ignore */ url);
  const A = mod.default || mod.A;
  if (!usable(A)) throw new Error('Aladin Lite module did not export A');
  await A.init;
  return A;
}

/** Classic build (CDS): sets the global `A`. */
function fromScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = true; s.charset = 'utf-8';
    s.onload = () => { const A = globalThis.A; if (!usable(A)) { reject(new Error('Aladin Lite loaded but did not start')); return; } Promise.resolve(A.init).then(() => resolve(A), reject); };
    s.onerror = () => { s.remove(); reject(new Error(`could not load ${url}`)); };
    document.head.appendChild(s);
  });
}

let loading = null;
/** Load Aladin Lite v3 once (npm module first, CDS script as fallback) and wait for it to initialise. Resolves to `A`. */
export function loadAladin() {
  if (usable(globalThis.A)) return Promise.resolve(globalThis.A.init).then(() => globalThis.A);
  if (loading) return loading;
  const override = globalThis.PLANETX_ALADIN_SRC; // tests and self-hosting: a classic script URL
  const sources = override ? [['script', override]] : [['module', ALADIN_ESM], ['script', ALADIN_SRC]];
  loading = (async () => {
    const errors = [];
    for (const [kind, url] of sources) {
      try { const A = await withTimeout(kind === 'module' ? fromModule(url) : fromScript(url)); globalThis.A = A; return A; }
      catch (e) { errors.push(e); console.warn(`[planet-x] Aladin Lite source failed (${url}):`, e); }
    }
    throw new Error('Could not reach the Aladin Lite server');
  })().catch(err => { loading = null; throw err; });
  return loading;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountOtherTelescopes(el) {
  const st = { survey: null, names: false, target: null, A: null, viewer: null, status: 'idle', error: '' };

  el.classList.add('ot');
  el.innerHTML = `
    <div class="ot-head"><span>Other telescopes</span><a class="ot-ext" data-r="ext" target="_blank" rel="noopener" hidden>Open in Aladin ↗</a></div>
    <div class="ot-chips" role="group" aria-label="Other telescopes">
      ${SURVEYS.map(s => `<button type="button" data-survey="${s.id}" aria-pressed="false" title="${esc(s.note)}">${esc(s.label)} <small>${esc(s.dates)}</small></button>`).join('')}
      <button type="button" data-names aria-pressed="false" title="${esc(SIMBAD.note)}">${esc(SIMBAD.label)} <small>${esc(SIMBAD.dates)}</small></button>
    </div>
    <div class="ot-view" data-r="view" hidden>
      <div class="ot-aladin" data-r="aladin"></div>
      <div class="ot-msg" data-r="msg" hidden></div>
    </div>
    <p class="ot-pos" data-r="pos" hidden></p>`;
  const $ = r => el.querySelector(`[data-r="${r}"]`);
  const chips = [...el.querySelectorAll('[data-survey]')], namesChip = el.querySelector('[data-names]');

  function message(text, retry = false) {
    const m = $('msg'); m.hidden = !text;
    m.innerHTML = text ? `<span>${esc(text)}</span>${retry ? '<button type="button">Try again</button>' : ''}` : '';
    if (retry) m.querySelector('button').addEventListener('click', () => { st.status = 'idle'; open(); });
  }

  function paint() {
    chips.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.survey === st.survey)));
    namesChip.setAttribute('aria-pressed', String(st.names));
    const on = !!st.survey && isTarget(st.target), s = on && surveyById(st.survey);
    $('view').hidden = !on; $('pos').hidden = !on;
    $('pos').textContent = on ? `${s.label} (${s.dates}) · ${describe(st.target)}` : '';
    const ext = $('ext'); ext.hidden = !on; if (on) ext.href = aladinUrl(st.target, st.survey);
  }

  function overlays() {
    const { viewer, A, target } = st;
    if (!viewer || !A || !isTarget(target)) return;
    if (typeof viewer.removeLayers === 'function') viewer.removeLayers();
    try { // the SPHEREx vetting stamp, outlined
      const ov = A.graphicOverlay({ color: '#ffffff', lineWidth: 1.5, name: 'SPHEREx stamp' });
      viewer.addOverlay(ov); ov.add(A.polygon(footprint(target.ra, target.dec, target.stampArcsec)));
    } catch (e) { console.warn('[planet-x] other telescopes: outline failed', e); }
    if (st.names) {
      try { viewer.addCatalog(A.catalogFromSimbad(`${target.ra} ${target.dec}`, fovDeg(target.stampArcsec) * 0.75, { name: 'SIMBAD', color: SIMBAD.color, sourceSize: 12, shape: 'circle', onClick: 'showPopup' })); }
      catch (e) { console.warn('[planet-x] other telescopes: SIMBAD failed', e); }
    }
  }

  function sync() {
    paint();
    const { viewer, target } = st; if (!viewer || !isTarget(target) || !st.survey) return;
    message('');
    viewer.gotoRaDec(target.ra, target.dec);
    const f = fovDeg(target.stampArcsec);
    if (typeof viewer.setFoV === 'function') viewer.setFoV(f); else if (typeof viewer.setFov === 'function') viewer.setFov(f);
    const hips = surveyById(st.survey).hips;
    if (typeof viewer.setImageSurvey === 'function') viewer.setImageSurvey(hips); else if (typeof viewer.setBaseImageLayer === 'function') viewer.setBaseImageLayer(hips);
    overlays();
  }

  async function open() {
    paint();
    if (!st.survey || !isTarget(st.target)) return;
    if (st.viewer) { sync(); return; }
    if (st.status === 'loading') return;
    st.status = 'loading'; message('Loading Aladin Lite…');
    try {
      const A = await loadAladin(), t = st.target;
      st.A = A;
      st.viewer = A.aladin($('aladin'), {
        survey: surveyById(st.survey).hips, target: `${t.ra} ${t.dec}`, fov: fovDeg(t.stampArcsec), cooFrame: 'ICRSd',
        showReticle: true, showZoomControl: true, showFullscreenControl: true, showLayersControl: false, showGotoControl: false,
        showFrame: false, showCooGridControl: false, showProjectionControl: false, showSettingsControl: false,
        showShareControl: false, showSimbadPointerControl: false, showContextMenu: false,
      });
      st.status = 'ready'; sync();
    } catch (err) {
      st.status = 'error'; st.error = err && err.message ? err.message : String(err);
      console.warn('[planet-x] other telescopes:', err);
      message(`${st.error}. The rest of the Field view still works.`, true);
    }
  }

  chips.forEach(b => b.addEventListener('click', () => {
    st.survey = st.survey === b.dataset.survey ? null : b.dataset.survey; // press the lit chip again to close
    open();
  }));
  namesChip.addEventListener('click', () => {
    st.names = !st.names;
    if (st.names && !st.survey) st.survey = SURVEYS[0].id; // names need an image to sit on
    st.viewer ? (paint(), overlays()) : open();
  });

  const api = {
    /** @param {{ra:number, dec:number, stampArcsec?:number} | null} t  degrees */
    setTarget(t) {
      st.target = isTarget(t) ? { ra: +t.ra, dec: +t.dec, stampArcsec: +t.stampArcsec > 0 ? +t.stampArcsec : DEFAULT_STAMP_ARCSEC } : null;
      st.survey && st.viewer ? sync() : paint();
    },
    state: () => ({ survey: st.survey, names: st.names, status: st.status, target: st.target, viewer: !!st.viewer }),
  };
  if (typeof window !== 'undefined') window.__otherTelescopes = api;
  return api;
}
