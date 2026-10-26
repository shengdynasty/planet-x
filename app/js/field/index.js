// Field analysis view: the Moving Sky experience inside the app (blink / difference / track a patch of sky,
// vet what moved, send candidates to the review list). Mounts into <section id="view-field">.
// Talks to the rest of the app only through the store (view, field, candidates, selectedId; flyto, toast).
import { simulateField, analyse, diff, maxStack, radec, fmtDt, fmtRA, fmtDec, spectrum, dist, psfModel } from '../pipeline/index.js';
import { drawImage, drawStamp, drawOverlay, glyph, KIND_NAME } from './render.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const spokenT = l => l.replace(/(\d+) (d|h|min)$/, (_, n, u) => `${n} ${{ d: 'day', h: 'hour', min: 'minute' }[u]}${n === '1' ? '' : 's'}`);
const DETECTORS = [[1, '0.75–1.09 µm'], [2, '1.10–1.62 µm'], [3, '1.63–2.41 µm'], [4, '2.42–3.82 µm'], [5, '3.83–4.41 µm'], [6, '4.42–5.00 µm']];
const PSYCHE = { ra: 70.2635, dec: 19.0558, sizeArcsec: 300, det: 3, t: 61087.1294 }; // 16 Psyche in the 15 Feb 2026 frame (server/README.md)
const isoToMJD = ms => ms / 86400000 + 40587;
/** "61087.13" (MJD) or an ISO date/time ("2026-02-15", "2026-02-15T03:06Z") → MJD; '' → null; junk → NaN. */
export function parseAnchor(v) {
  v = String(v ?? '').trim(); if (!v) return null;
  if (/^\d{5}(\.\d+)?$/.test(v)) return +v;
  const ms = Date.parse(/^\d{4}-\d\d-\d\d$/.test(v) ? v + 'T00:00:00Z' : v); return Number.isFinite(ms) ? isoToMJD(ms) : NaN;
}
const fmtSecs = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
const VERDICT = {
  cand: 'Worth a follow-up: not in catalogue, PSF-shaped, consistent two-epoch motion. Needs a third epoch and an orbit fit before it is anything.',
  known: 'Identified. Position agrees with the ephemeris.', var: 'Photometric variable, not a mover.',
  art: 'Reject. Single-frame, not PSF-shaped.', left: 'Known object no longer inside the cutout.',
};

const TEMPLATE = `
<header class="fv-top">
  <button class="ghost fv-back" data-act="back">← Sky</button>
  <div class="fv-title"><h2 tabindex="-1" data-ref="h">Field</h2><span class="fv-sub" data-ref="pos"></span></div>
  <span class="fv-sub fv-base" data-ref="baseline"></span>
  <span class="fv-spacer"></span>
  <span class="fv-pill" data-ref="source"></span>
</header>
<div class="fv-body">
  <div class="fv-main">
    <div class="fv-toolbar">
      <div class="seg" role="group" aria-label="View mode">
        <button data-mode="blink" aria-pressed="true">Blink</button>
        <button data-mode="diff" aria-pressed="false">Difference</button>
        <button data-mode="track" aria-pressed="false">Track</button>
      </div>
      <div class="seg" role="group" aria-label="Overlays">
        <button data-act="marks" aria-pressed="true">Flags</button>
        <button data-act="known" aria-pressed="false">Known objects</button>
      </div>
      <button data-act="flip" data-ref="flip" hidden>Show comparison</button>
      <span class="fv-spacer"></span>
      <label class="fv-stretch">Stretch <input data-ref="stretch" type="range" min="0.3" max="3" step="0.05" value="1"></label>
    </div>
    <div class="fv-stagewrap">
      <div class="fv-stage" data-ref="stage">
        <canvas class="fv-img" data-ref="img" width="320" height="320" role="img" aria-describedby=""></canvas>
        <canvas class="fv-ov" data-ref="ov" aria-hidden="true"></canvas>
        <div class="fv-corner l" data-ref="flash">Reference</div>
        <div class="fv-corner r" data-ref="legend" hidden></div>
        <div class="fv-readout" data-ref="readout"><span>Hover or tap the image to read coordinates and surface brightness</span></div>
        <div class="fv-loading" data-ref="loading" hidden>
          <div class="fv-load-box">
            <div class="fv-load-t" data-ref="loadT" role="status">Loading field…</div>
            <ol class="fv-load-steps" data-ref="loadSteps"></ol>
            <div class="fv-load-el" data-ref="loadEl"></div>
            <button data-act="cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <aside class="fv-side" aria-label="Field analysis controls">
    <section>
      <h3>Observations of this field</h3>
      <div class="fv-rowlab" data-ref="labA">Reference pass</div>
      <div class="fv-epochs" data-ref="epA" role="group"></div>
      <div class="fv-rowlab" data-ref="labB">Compare with</div>
      <div class="fv-epochs" data-ref="epB" role="group"></div>
      <div role="status" class="fv-status"><div class="fv-warn" data-ref="warn" hidden></div><p class="fv-note" data-ref="knownnote" hidden></p></div>
    </section>
    <section class="fv-live" data-ref="live" hidden>
      <h3>Live request</h3>
      <form data-ref="liveform" class="fv-liveform">
        <label class="fv-wide">Centre, RA and Dec in degrees <input data-ref="lpos" type="text" inputmode="decimal" placeholder="70.2635, 19.0558" autocomplete="off" spellcheck="false"></label>
        <label>Size <select data-ref="lsize"><option value="120">120″ (20 px)</option><option value="300">300″ (49 px)</option><option value="600">600″ (98 px)</option></select></label>
        <label>Detector <select data-ref="ldet">${DETECTORS.map(([d, r]) => `<option value="${d}">D${d} · ${r}</option>`).join('')}</select></label>
        <label class="fv-wide">Anchor on date <input data-ref="lt" type="text" inputmode="decimal" placeholder="MJD or 2026-02-15 (optional)" autocomplete="off" spellcheck="false"></label>
        <button type="submit">Load</button>
      </form>
      <button class="ghost fv-example" data-act="psyche">Example: asteroid 16 Psyche, 15 Feb 2026</button>
      <p class="fv-note" data-ref="livenote"></p>
    </section>
    <section>
      <h3 data-ref="dethead">Flagged sources</h3>
      <ul class="fv-dets" data-ref="dets"></ul>
    </section>
    <section class="fv-vet" data-ref="vet" hidden>
      <h3 data-ref="vethead">Vetting</h3>
      <div class="fv-stamps">
        <figure><canvas data-ref="stA" width="15" height="15" role="img" aria-label="Reference cutout"></canvas><figcaption data-ref="capA">Reference</figcaption></figure>
        <figure><canvas data-ref="stB" width="15" height="15" role="img" aria-label="Comparison cutout"></canvas><figcaption data-ref="capB">Compare</figcaption></figure>
      </div>
      <dl data-ref="kv"></dl>
      <svg class="fv-spec" data-ref="spec" viewBox="0 0 340 120" role="img" aria-label="Spectrum across the 102 SPHEREx bands"></svg>
      <div class="fv-actions">
        <button data-act="add" data-ref="add">Add to review list</button>
        <button data-act="sky" class="ghost">Show on sky</button>
      </div>
    </section>
    <p class="fv-keys">Keys: <kbd>B</kbd> <kbd>D</kbd> <kbd>T</kbd> mode · <kbd>F</kbd> flags · <kbd>K</kbd> known · <kbd>Space</kbd> flip · <kbd>N</kbd>/<kbd>P</kbd> next/previous flag · <kbd>1</kbd>–<kbd>8</kbd> compare pass · <kbd>A</kbd> add · <kbd>S</kbd> show on sky · <kbd>Esc</kbd> clear / back</p>
  </aside>
</div>`;

/** @param {HTMLElement} el  @param {typeof import('../core/store.js')} store */
export function mountField(el, store) {
  el.classList.add('fv');
  el.setAttribute('aria-label', 'Field analysis');
  el.innerHTML = TEMPLATE;
  const $ = r => el.querySelector(`[data-ref="${r}"]`);
  const uid = 'fv' + Math.random().toString(36).slice(2, 7);
  $('flash').id = uid + '-flash'; $('img').setAttribute('aria-describedby', uid + '-flash');
  $('labA').id = uid + '-la'; $('epA').setAttribute('aria-labelledby', uid + '-la');
  $('labB').id = uid + '-lb'; $('epB').setAttribute('aria-labelledby', uid + '-lb');
  $('img').setAttribute('aria-label', 'Infrared sky image, false colour. Flagged sources are listed under Flagged sources; select one there to vet it.');

  let field = null, A = 0, B = 0, mode = 'blink', showMarks = true, showKnown = false, stretch = 1;
  let blinkPhase = 0, selected = null, results = [], timer = null, shown = null, loadSeq = 0, loadedFor;
  const reducedMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };
  const visible = () => store.get('view') === 'field';

  function announce(msg) {
    const a = document.getElementById('announce');
    if (a) { a.textContent = ''; a.textContent = msg; } else store.emit('announce', msg);
  }
  const announceSel = () => announce(selected ? `Selected: ${selected.title}. ${selected.detail}` : 'Selection cleared');

  // ---------- loading ----------
  // Sim: instant. Live: two requests in parallel, frames-only (known=0, ~10 s cold) and with JPL known objects
  // (up to minutes cold, the server shares the IRSA downloads between them). Frames show as soon as they arrive;
  // known objects are filled in when JPL answers. Everything is cached by the server afterwards.
  let ctl = null, loading = false, tickT = null, pollT = null, loadStart = 0, knownState = null, req = null;
  const liveSource = () => { const s = store.get('source'); return !!(s && s.mode === 'live' && s.live !== false); };
  async function load() {
    req = store.get('field'); loadedFor = req; const seq = ++loadSeq;
    if (ctl) ctl.abort(); ctl = null; stopLoading();
    let data = null;
    try { data = await import('../data/index.js'); } catch { data = null; }
    if (seq !== loadSeq) return;
    const live = liveSource() && data && typeof data.isLive === 'function' && data.isLive();
    if (!live) {
      let f = null;
      try { if (data && typeof data.getField === 'function') f = await data.getField(req || {}); } catch { f = null; }
      if (!f || typeof f.frame !== 'function') {
        // fallback: the Moving Sky simulation, re-centred on the request (store.field ra/dec in degrees)
        f = simulateField(req && Number.isFinite(req.ra) && Number.isFinite(req.dec) ? { ra0: req.ra, dec0: req.dec } : {});
      }
      if (seq !== loadSeq) return;
      knownState = null; setField(f); return;
    }
    const c = ctl = new AbortController(), q = { ...(req || {}), signal: c.signal, fallback: false };
    startLoading(seq, data);
    let painted = false;
    const full = data.getField({ ...q, known: true });
    const quick = data.getField({ ...q, known: false });
    full.then(f => {
      if (seq !== loadSeq) return;
      knownState = f.knownStatus && f.knownStatus !== 'ok' ? 'partial:' + f.knownStatus : 'ok';
      stopLoading(); setField(f, painted); painted = true;
    }, e => {
      if (seq !== loadSeq || c.signal.aborted) return;
      knownState = 'failed:' + e.message; if (painted) renderKnownNote();
    });
    quick.then(f => {
      if (seq !== loadSeq || painted) return;
      knownState = knownState && knownState.startsWith('failed') ? knownState : 'pending';
      stopLoading(); setField(f); painted = true;
    }, async e => {
      if (seq !== loadSeq || c.signal.aborted || painted) return;
      // frames failed: say so, then show the simulation so the view isn't empty
      const f = simulateField(Number.isFinite(req?.ra) ? { ra0: req.ra, dec0: req.dec } : {});
      f.fallbackReason = `live data failed: ${e.message}`;
      store.emit('toast', `Live field failed (${e.message}); showing simulated data`);
      c.abort(); knownState = null; stopLoading(); setField(f); painted = true;
    });
  }
  function startLoading(seq, data) {
    loading = true; loadStart = Date.now(); clearInterval(timer); timer = null;
    $('loading').hidden = false; $('flash').textContent = 'Loading live field…';
    const r = req || {}, d = data.liveSize ? data.liveSize(r.sizeArcsec) : r.sizeArcsec;
    $('loadT').textContent = `Loading SPHEREx frames for RA ${fmtRA(r.ra)}, Dec ${fmtDec(r.dec)} · ${d}″${r.det ? ` · D${r.det}` : ''}…`;
    renderSteps(null); renderLive();
    const tick = () => { $('loadEl').textContent = `${fmtSecs(Date.now() - loadStart)} elapsed · a new field takes ~10 s for frames and ~1–2 min for JPL known objects; cached fields open instantly.`; };
    tick(); tickT = setInterval(tick, 500);
    const poll = async () => {
      const builds = await data.fieldProgress(); if (seq !== loadSeq || !loading) return;
      if (builds) { const mine = builds.filter(b => Math.abs(b.ra - r.ra) < 1e-5 && Math.abs(b.dec - r.dec) < 1e-5); renderSteps(mine); }
      pollT = setTimeout(poll, 1000);
    };
    pollT = setTimeout(poll, 400);
  }
  function stopLoading() {
    loading = false; clearInterval(tickT); clearTimeout(pollT); tickT = pollT = null; $('loading').hidden = true;
  }
  // Stages from the server's /api/progress (cold builds only). Without it, the elapsed time is all we show.
  function renderSteps(builds) {
    const ol = $('loadSteps');
    if (!builds) { ol.innerHTML = ''; ol.hidden = true; return; }
    ol.hidden = false;
    const quick = builds.find(b => !b.known), full = builds.find(b => b.known), b = quick || full;
    const ORDER = ['sia', 'headers', 'cutouts', 'horizons'], at = b ? ORDER.indexOf(b.stage) : -1;
    const st = (i, lab, n) => `<li class="${at > i || (!b && i < 3) ? 'done' : at === i ? 'now' : ''}">${esc(lab)}${at === i && n ? ` <span>${n}</span>` : ''}</li>`;
    let html = st(0, 'Find SPHEREx exposures (IRSA SIA)') + st(1, 'Read headers: wavelength at the target', b && b.total ? `${b.done}/${b.total}` : '')
      + st(2, 'Download and align cutouts', b && b.stage === 'cutouts' ? `${b.done}/${b.total}` : '');
    const j = full && full.jpl;
    html += `<li class="${full ? (j && j.done >= j.total ? 'done' : 'now') : ''}">Ask JPL which known objects are in the field${j ? ` <span>${j.done}/${j.total}</span>` : ''}</li>`;
    ol.innerHTML = html;
  }
  function cancelLoad() {
    if (ctl) ctl.abort(); ctl = null; loadSeq++; stopLoading(); loadedFor = null;
    announce('Loading cancelled. The server keeps fetching in the background, so trying again later is faster.');
    store.emit('toast', 'Field loading cancelled');
    store.set('view', 'sky');
  }
  function renderKnownNote() {
    const n = $('knownnote'), live = field && !field.simulated;
    if (!live || !knownState || knownState === 'ok') { n.hidden = true; n.textContent = ''; return; }
    n.hidden = false;
    n.textContent = knownState === 'pending' ? 'Checking JPL for known objects… This can take a minute or two the first time. Until it answers, catalogued asteroids show up as candidates.'
      : knownState.startsWith('failed:') ? `Known-object check failed (${knownState.slice(7)}). Catalogued asteroids may show up as candidates.`
      : `Known-object check incomplete (${knownState.slice(8)}).`;
  }
  function renderLive() {
    // shown while loading too, so a slow request can be changed without waiting for it
    const sec = $('live'), on = liveSource() && (loading || (!!field && (!field.simulated || !!field.fallbackReason)));
    sec.hidden = !on; if (!on) return;
    const r = req || {}, size = loading || !field ? (r.sizeArcsec > 600 ? 300 : Math.round(r.sizeArcsec || 120)) : field.request?.sizeArcsec ?? (field.sizeArcsec ? Math.round(field.sizeArcsec) : 300);
    const sz = $('lsize'); if (![...sz.options].some(o => +o.value === size)) sz.add(new Option(`${size}″`, String(size)));
    sz.value = String(size); $('ldet').value = String(r.det || (field && !loading && field.detector) || 1);
    $('lt').value = Number.isFinite(r.t) ? String(r.t) : '';
    $('lpos').value = Number.isFinite(r.ra) ? `${+r.ra.toFixed(5)}, ${+r.dec.toFixed(5)}` : '';
    $('livenote').textContent = loading || !field || field.simulated ? '' : `Real SPHEREx frames on detector D${field.detector} at ${field.band} µm. The artifact test uses a PSF width of ${psfModel(field).sigma.toFixed(2)} px ${psfModel(field).from === 'stars' ? `measured from ${psfModel(field).nStars} stars in these frames` : '(typical value; too few stars to measure)'}.`;
  }
  function submitLive(e) {
    e.preventDefault();
    const r = req || store.get('field') || {}, t = parseAnchor($('lt').value);
    if (Number.isNaN(t)) { $('lt').setAttribute('aria-invalid', 'true'); announce('Anchor date not understood. Use an MJD like 61087.13 or a date like 2026-02-15.'); $('lt').focus(); return; }
    $('lt').removeAttribute('aria-invalid');
    const m = $('lpos').value.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-−]?\d+(?:\.\d+)?)$/);
    const ra = m ? +m[1] : NaN, dec = m ? +m[2].replace('−', '-') : NaN;
    if (!(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90)) { $('lpos').setAttribute('aria-invalid', 'true'); announce('Centre not understood. Use RA, Dec in degrees, e.g. 70.2635, 19.0558.'); $('lpos').focus(); return; }
    $('lpos').removeAttribute('aria-invalid');
    const next = { ra, dec, sizeArcsec: +$('lsize').value, det: +$('ldet').value };
    if (t != null) next.t = t;
    store.set('field', next);
  }
  function defaultCompare(f, a) {
    const E = f.epochs, ta = E[a].t; let best = -1, bd = 1e9;
    E.forEach((e, i) => { if (i === a || e.band !== E[a].band) return; const d = Math.abs(e.t - ta - 183); if (d < bd) { bd = d; best = i; } });
    return best >= 0 ? best : (E.length > 1 ? 1 : 0);
  }
  // keep = same frames with more information (known objects arrived): keep the pair, mode and selection.
  function setField(f, keep) {
    const same = keep && field && field.epochs.length === f.epochs.length;
    field = f; lastXY = null;
    if (!same) { A = 0; B = defaultCompare(f, 0); selected = null; $('epA').innerHTML = ''; $('epB').innerHTML = ''; }
    const [ra, dec] = radec(f, f.N / 2, f.N / 2), size = f.N * f.scale / 60;
    $('pos').textContent = `RA ${fmtRA(ra)}, Dec ${fmtDec(dec)} · ${size.toFixed(1)}′ × ${size.toFixed(1)}′${f.simulated ? '' : ` · ${f.N}×${f.N} px`}`;
    const src = $('source');
    src.textContent = f.simulated ? (f.fallbackReason ? `Simulated field · ${f.fallbackReason}` : 'Simulated field') : `Live · SPHEREx D${f.detector ?? '?'} · ${f.band} µm`;
    src.classList.toggle('fv-pill-warn', !!f.fallbackReason);
    src.title = f.simulated ? 'Simulated star field and planted movers. Nothing here is a real detection.' : 'Real SPHEREx images from NASA/IPAC IRSA, analysed in your browser. Flags are candidates, not detections.';
    update(); renderKnownNote(); renderLive();
    if (visible() && !same) announce(`Field loaded${f.simulated ? ', simulated' : ', live SPHEREx data'}. ${results.length} flagged source${results.length === 1 ? '' : 's'}.`);
    else if (visible() && same) announce(`Known objects checked. ${results.length} flagged source${results.length === 1 ? '' : 's'}.`);
  }

  // ---------- epoch pickers / warning / list ----------
  function epochButtons(box, get, setI) {
    if (!box.children.length) field.epochs.forEach((e, i) => {
      const b = document.createElement('button'); b.innerHTML = `${esc(e.label)}<small>${esc(e.sub || e.band + ' µm')}</small>`;
      b.setAttribute('aria-label', `${spokenT(e.label)}, ${e.band} µm`);
      b.addEventListener('click', () => { setI(i); update(); }); box.appendChild(b);
    });
    [...box.children].forEach((b, i) => b.setAttribute('aria-pressed', String(get() === i)));
  }
  function update() {
    if (!field) return;
    const E = field.epochs;
    epochButtons($('epA'), () => A, i => A = i); epochButtons($('epB'), () => B, i => B = i);
    const a = E[A], b = E[B], dt = Math.abs(b.t - a.t), matched = a.band === b.band;
    const baseTxt = A === B ? 'Pick two different passes.' : `Baseline ${fmtDt(dt)} · ${matched ? `both at ${a.band} µm` : `${a.band} vs ${b.band} µm`}`;
    if ($('baseline').textContent !== baseTxt) { const first = !$('baseline').textContent; $('baseline').textContent = baseTxt; if (!first && visible()) announce(`Reference ${spokenT(a.label)}, compare ${spokenT(b.label)}. ${baseTxt}`); }
    const warn = $('warn');
    if (!matched) {
      warn.hidden = false;
      warn.innerHTML = `<span class="fv-bang" aria-hidden="true">!</span><span>These passes were taken at different wavelengths (${esc(a.band)} and ${esc(b.band)} µm). Blinking them shows colour differences, not motion, so flagging is off.</span>`;
      let best = -1, bd = 1e9; E.forEach((e, i) => { if (i !== A && e.band === a.band && Math.abs(e.t - b.t) < bd) { bd = Math.abs(e.t - b.t); best = i; } });
      if (best >= 0) { const btn = document.createElement('button'); btn.textContent = `Compare with ${E[best].label} instead`; btn.title = 'Nearest pass in time at the reference wavelength';
        btn.addEventListener('click', () => { B = best; update(); $('epB').children[B]?.focus(); }); warn.appendChild(btn); }
      else warn.insertAdjacentHTML('beforeend', `<span>No other pass of this field was taken at ${esc(a.band)} µm, so pick a different reference.</span>`);
      results = [];
    } else { warn.hidden = true; warn.innerHTML = ''; results = A === B ? [] : analyse(field, A, B); }
    if (selected) selected = rematch(selected, results);
    renderList(); renderVet(); blinkPhase = 0; render(); setTimer();
  }
  // analyse() results differ per pair, so keep the selection by finding the same source again:
  // same kind, and either endpoint (or the marker position) within 3 px of the old one.
  function rematch(s, list) { const near = (p, q) => p && q && dist(p, q) < 3; let best = null, bd = 1e9;
    for (const r of list) { if (r.kind !== s.kind) continue; if (!(near(r, s) || near(r.from, s.from) || near(r.to, s.to))) continue; const d = dist(r, s); if (d < bd) { bd = d; best = r; } }
    return best; }
  function renderList(focusIdx) {
    const ul = $('dets'); ul.innerHTML = '';
    $('dethead').textContent = results.length ? `Flagged sources (${results.length})` : 'Flagged sources';
    if (!results.length) { const li = document.createElement('li'); li.className = 'fv-empty';
      li.textContent = field.epochs[A].band !== field.epochs[B].band ? 'Choose two passes at the same wavelength to compare.' : A === B ? 'Choose a comparison pass.' : 'Nothing changed between these passes above 5σ.';
      ul.appendChild(li); return; }
    results.forEach((r, i) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.setAttribute('aria-pressed', String(r === selected)); b.dataset.kind = r.kind;
      b.innerHTML = `${glyph(r.kind)}<span class="fv-dt"><span class="t"><span class="fv-vh">${KIND_NAME[r.kind]}: </span>${esc(r.title)}</span><span class="d">${esc(r.detail)}</span></span><span class="fv-kind" aria-hidden="true">${KIND_NAME[r.kind]}</span>`;
      b.addEventListener('click', () => select(selected === r ? null : r, true));
      b.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); ul.querySelectorAll('button')[(i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length]?.focus(); } });
      li.appendChild(b); ul.appendChild(li);
    });
    if (focusIdx != null) ul.querySelectorAll('button')[focusIdx]?.focus();
  }
  function select(r, keepFocus) {
    selected = r; const i = results.indexOf(r);
    const had = el.contains(document.activeElement) && document.activeElement.closest('.fv-dets');
    renderList(keepFocus && had ? Math.max(i, 0) : null); renderVet(); renderOverlay(); announceSel();
  }

  // ---------- vetting ----------
  const ON_LIST_TOL = 20; // arcsec: a review-list entry this close to the selection is the same source
  function candFor(r) {
    const E = field.epochs, pts = [];
    if (r.from) pts.push({ t: E[A].t, p: r.from }); if (r.to) pts.push({ t: E[B].t, p: r.to });
    if (!pts.length) pts.push({ t: E[B].t, p: r });
    pts.sort((p, q) => p.t - q.t);
    return pts.map(({ p }) => { const [ra, dec] = radec(field, p.x, p.y); return [ra / 15, dec]; });
  }
  function onList(r) {
    const [ra, dec] = candFor(r).at(-1);
    return (store.get('candidates') || []).find(c => c.pos?.length && c.pos.some(p => p && Math.hypot((p[0] - ra) * 15 * 3600 * Math.cos(dec * Math.PI / 180), (p[1] - dec) * 3600) < ON_LIST_TOL));
  }
  function renderVet() {
    const p = $('vet'); if (!selected) { p.hidden = true; return; } p.hidden = false; const r = selected, E = field.epochs;
    const [ra, dec] = radec(field, r.x, r.y);
    const rows = [['Position', `${fmtRA(ra)}, ${fmtDec(dec)}`], ['Pixel', `${r.x.toFixed(1)}, ${r.y.toFixed(1)}`]];
    if (r.to) rows.push(['Peak above sky', `${r.to.peak.toFixed(2)} MJy/sr`]);
    if (r.from && r.to) rows.push(['Displacement', `${(dist(r.from, r.to) * field.scale).toFixed(1)}″ in ${fmtDt(Math.abs(E[B].t - E[A].t))}`]);
    if (!field.simulated) {
      const e = E[r.to ? B : A], psf = psfModel(field);
      rows.push(['Data', `Live SPHEREx, D${field.detector ?? '?'} at ${e.lambda ?? e.band} µm, ${String(e.date || '').slice(0, 10)}`]);
      if (r.kind === 'art' || r.kind === 'cand') rows.push(['PSF test', `σ ${psf.sigma.toFixed(2)} px; spike ${(r.to || r.from).spike.toFixed(1)} (limit ${psf.spikeMax.toFixed(1)})`]);
    }
    if (r.kind === 'cand' && field.simulated) rows.push(['Spectrum', 'Water-ice absorption at 1.5, 2.0 and 3 µm, which is why it fades at 3.29 µm']);
    rows.push(['Verdict', VERDICT[r.kind]]);
    $('vethead').textContent = `Vetting: ${r.title}`;
    $('kv').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
    drawStamp($('stA'), field.frame(A), field.N, r.from ? r.from.x : r.x, r.from ? r.from.y : r.y);
    drawStamp($('stB'), field.frame(B), field.N, r.to ? r.to.x : r.x, r.to ? r.to.y : r.y);
    $('capA').textContent = `Reference ${E[A].label}`; $('capB').textContent = `Compare ${E[B].label}`;
    $('stA').setAttribute('aria-label', `Reference cutout, ${E[A].label}, 15 by 15 pixels`); $('stB').setAttribute('aria-label', `Comparison cutout, ${E[B].label}, 15 by 15 pixels`);
    // spectrum: model shapes (simulated field only; live fields don't extract one yet)
    const svg = $('spec'), none = r.kind === 'art' || r.kind === 'left' || !field.simulated;
    const kind = r.kind === 'known' ? 'asteroid' : r.kind === 'cand' ? 'ice' : 'star';
    const label = none ? 'Spectrum not extracted' : r.kind === 'cand' ? 'Reflected sunlight, water-ice dips' : r.kind === 'known' ? 'Reflected sunlight, thermal rise past 3 µm' : 'Stellar continuum';
    const X = l => 20 + (l - 0.75) / 4.25 * 300;
    let path = '';
    if (!none) { const pts = spectrum(kind), mx = Math.max(...pts.map(q => q[1])), Y = v => 100 - v / mx * 82;
      path = `<path class="l" stroke="url(#${uid}-g)" d="${pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)} ${Y(q[1]).toFixed(1)}`).join(' ')}"/>`; }
    svg.innerHTML = `<defs><linearGradient id="${uid}-g" x1="20" x2="320" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6aa8ff"/><stop offset=".5" stop-color="#f2c14e"/><stop offset="1" stop-color="#ff6a3d"/></linearGradient></defs>`
      + `<line class="ax" x1="20" y1="100" x2="320" y2="100"/>${path}${[1, 2, 3, 4, 5].map(l => `<text x="${X(l)}" y="114" text-anchor="middle">${l} µm</text>`).join('')}<text x="20" y="12">${label}${none ? '' : ' (model)'}</text>`;
    svg.setAttribute('aria-label', `Spectrum of the selected ${r.title}: ${none ? 'not extracted' : label + ', model'}`);
    const add = $('add'); add.hidden = r.kind !== 'cand';
    const existing = r.kind === 'cand' && onList(r);
    add.textContent = existing ? 'On review list' : 'Add to review list'; add.title = existing ? existing.name : '';
    add.setAttribute('aria-disabled', String(!!existing)); add.classList.toggle('fv-done', !!existing);
  }
  function addToReview() {
    const r = selected; if (!r || r.kind !== 'cand') return;
    const existing = onList(r);
    if (existing) { store.set('selectedId', existing.id); announce(`${existing.name} is already on the review list`); return; }
    const list = store.get('candidates') || [], E = field.epochs;
    // id from the rounded position (degrees) so it can't collide with data-source ids; suffix only on a true clash
    const [ra, dec] = radec(field, r.x, r.y), base = `f-${ra.toFixed(4)}${dec < 0 ? '-' : '+'}${Math.abs(dec).toFixed(4)}`;
    let id = base; for (let k = 2; list.some(c => c.id === id); k++) id = `${base}-${k}`;
    // Live epochs belong to survey scans: one pos per scan (null where this source wasn't seen), as the panel expects.
    const scans = store.get('scans') || [], live = !field.simulated && scans.length && E[A].scan != null;
    let pos = candFor(r);
    if (live) { const at = (i, p) => { const [pr, pd] = radec(field, p.x, p.y); return { scan: E[i].scan, p: [pr / 15, pd] }; };
      const pts = [r.from && at(A, r.from), r.to && at(B, r.to)].filter(Boolean);
      pos = scans.map(sc => (pts.find(q => q.scan === sc.id) || {}).p || null); }
    const cand = {
      id, name: `Field candidate ${fmtRA(ra).replace(/\.\ds$/, 's')}, ${fmtDec(dec)}`,
      tag: r.from ? 'Unmatched · slow mover' : 'Unmatched · new source',
      status: 'Candidate', pipelineStatus: 'Candidate', band: `${E[B].band} µm`, pos,
      note: `${r.title}: ${r.detail} Flagged in field analysis (reference ${E[A].label}, compare ${E[B].label})${field.simulated ? '' : ' on live SPHEREx frames from IRSA'}. Candidate signal, not a detection.`,
      simulated: !!field.simulated, live: !field.simulated, source: 'field',
    };
    store.set('candidates', [...list, cand]);
    store.set('selectedId', cand.id);
    store.emit('toast', `Added ${cand.name} to the review list`);
    announce(`Added ${cand.name} to the review list`);
    renderVet(); $('add').focus();
  }
  function showOnSky() {
    const r = selected; let ra, dec;
    if (r) [ra, dec] = radec(field, r.x, r.y); else [ra, dec] = radec(field, field.N / 2, field.N / 2);
    store.emit('flyto', { ra, dec, raHours: ra / 15, fov: 4 }); // degrees (store.js contract)
    store.set('view', 'sky');
  }

  // ---------- rendering ----------
  function render() {
    if (!field) return;
    const E = field.epochs, N = field.N, img = $('img'), flash = $('flash'), legend = $('legend');
    let knownT;
    legend.hidden = mode !== 'diff';
    if (mode === 'blink') { const showB = blinkPhase % 2 === 1; shown = field.frame(showB ? B : A); drawImage(img, shown, N, false, stretch);
      flash.textContent = showB ? `Compare · ${E[B].label}` : `Reference · ${E[A].label}`; knownT = [E[showB ? B : A].t]; }
    else if (mode === 'diff') { shown = diff(field, A, B); drawImage(img, shown, N, true, stretch); flash.textContent = 'Compare − Reference'; knownT = [E[A].t, E[B].t];
      legend.innerHTML = '<i aria-hidden="true"></i><span>fainter · brighter</span>'; }
    else { const band = E[A].band, c = maxStack(field, band, A, B); shown = c.img; drawImage(img, shown, N, false, stretch); knownT = c.ts.slice();
      const n = knownT.length, [e0, e1] = E[A].t <= E[B].t ? [A, B] : [B, A];
      flash.textContent = `Max-stack of ${n} pass${n === 1 ? '' : 'es'} at ${band} µm, ${E[e0].label} to ${E[e1].label}`; }
    lastKnownT = knownT; renderOverlay(); showReadout();
  }
  let lastKnownT = [], lastXY = null;
  function renderOverlay() {
    if (!field) return;
    const ov = $('ov'), st = $('stage'), css = st.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(css * dpr);
    if (!W) return;
    if (ov.width !== W) { ov.width = ov.height = W; }
    const matched = field.epochs[A].band === field.epochs[B].band;
    const knownPts = []; for (const t of lastKnownT) for (const k of field.known || []) { const q = k.pos(t); if (q) knownPts.push(q); }
    drawOverlay(ov, { N: field.N, dpr, results: matched ? results : [], selected, showMarks, showKnown, knownPts });
  }
  function syncFlip() {
    const f = $('flip'); f.hidden = !(mode === 'blink' && reducedMQ.matches);
    f.textContent = blinkPhase % 2 === 1 ? 'Show reference' : 'Show comparison';
  }
  function setTimer() { clearInterval(timer); timer = null; if (mode === 'blink' && !reducedMQ.matches && visible() && field) timer = setInterval(() => { blinkPhase++; render(); }, 650); syncFlip(); }
  function setMode(m) { mode = m; el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); blinkPhase = 0; render(); setTimer();
    announce({ blink: 'Blink', diff: 'Difference image', track: 'Track: max-stack' }[m]); }
  function flip() { if (mode !== 'blink') return; blinkPhase++; render(); syncFlip(); announce(`Showing ${$('flash').textContent}`); }
  const toggle = (which) => {
    if (which === 'marks') showMarks = !showMarks; else showKnown = !showKnown;
    el.querySelector(`[data-act="${which}"]`).setAttribute('aria-pressed', String(which === 'marks' ? showMarks : showKnown)); renderOverlay();
  };

  // ---------- events ----------
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    if (b.dataset.mode) return setMode(b.dataset.mode);
    switch (b.dataset.act) {
      case 'back': store.set('view', 'sky'); break;
      case 'marks': case 'known': toggle(b.dataset.act); break;
      case 'flip': flip(); break;
      case 'add': addToReview(); break;
      case 'sky': showOnSky(); break;
      case 'cancel': cancelLoad(); break;
      case 'psyche': store.set('field', { ...PSYCHE }); break;
    }
  });
  $('liveform').addEventListener('submit', submitLive);
  $('stretch').addEventListener('input', e => { stretch = parseFloat(e.target.value); requestAnimationFrame(render); });
  const ov = $('ov');
  const toPix = e => { const rect = ov.getBoundingClientRect(); return [(e.clientX - rect.left) / rect.width * field.N, (e.clientY - rect.top) / rect.height * field.N]; };
  const readoutAt = e => { if (!field) return; const [fx, fy] = toPix(e); lastXY = [Math.floor(fx), Math.floor(fy)]; showReadout(); };
  function showReadout() { if (!lastXY || !field) return; const [x, y] = lastXY, N = field.N; if (x < 0 || y < 0 || x >= N || y >= N) return;
    const img = shown || field.frame(A), [ra, dec] = radec(field, x, y);
    $('readout').innerHTML = `<span>RA <b>${fmtRA(ra)}</b></span><span>Dec <b>${fmtDec(dec)}</b></span><span>Pixel <b>${x}, ${y}</b></span><span>${mode === 'diff' ? 'Difference' : mode === 'track' ? 'Stack max' : 'Value'} <b>${img[y * N + x].toFixed(2)} MJy/sr</b></span>`; }
  ov.addEventListener('pointermove', readoutAt); ov.addEventListener('pointerdown', readoutAt);
  ov.addEventListener('click', e => { if (!field) return; const [x, y] = toPix(e); let best = null, bd = Math.max(14 * field.N / 320, 18 * field.N / (ov.getBoundingClientRect().width || 320));
    for (const r of results) { const d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; best = r; } } select(best, false); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => renderOverlay()).observe($('stage'));
  reducedMQ.addEventListener?.('change', () => { blinkPhase = 0; render(); setTimer(); });

  window.addEventListener('keydown', e => {
    if (!visible() || el.hidden || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' && t.type !== 'range' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    if (t && t.closest && t.closest('[role="dialog"], dialog')) return;
    if ([...document.querySelectorAll('dialog[open], [role="dialog"]')].some(d => !el.contains(d) && !d.hidden && d.getClientRects().length && getComputedStyle(d).visibility !== 'hidden')) return; // help sheet, Export dialog…
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') { if (loading) cancelLoad(); else if (selected) { select(null); } else store.set('view', 'sky'); }
    else if (k === 'b') setMode('blink'); else if (k === 'd') setMode('diff'); else if (k === 't') setMode('track');
    else if (k === 'f') toggle('marks'); else if (k === 'k') toggle('known');
    else if (k === ' ') { if (mode === 'blink' && reducedMQ.matches && tag !== 'BUTTON') flip(); else return; }
    else if (k === 'n' || k === 'p') { if (!results.length) return; const i = results.indexOf(selected), j = i < 0 ? (k === 'n' ? 0 : results.length - 1) : (i + (k === 'n' ? 1 : -1) + results.length) % results.length; select(results[j]); }
    else if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey) { const i = +e.code.slice(5) - 1; if (!field || i >= field.epochs.length) return; B = i; update(); }
    else if (k === 'a') { if (selected?.kind === 'cand') addToReview(); else return; }
    else if (k === 's') showOnSky();
    else return;
    e.preventDefault();
  });

  // ---------- store integration ----------
  let wasOn = false, returnFocus = null;
  function show(v) {
    const on = v === 'field';
    el.hidden = !on;
    if (on) {
      if (!wasOn) returnFocus = document.activeElement;
      if (loadedFor !== store.get('field') || (!field && !loading)) load();
      else if (field && !loading) { render(); setTimer(); }
      requestAnimationFrame(() => { renderOverlay(); if (!el.contains(document.activeElement)) $('h').focus({ preventScroll: true }); });
    } else {
      clearInterval(timer); timer = null;
      // give focus back to whatever opened the view (as Compare does); defer so the shell can update inert first
      const r = returnFocus;
      if (wasOn && (el.contains(document.activeElement) || document.activeElement === document.body))
        setTimeout(() => { if (r && r !== document.body && document.contains(r) && !r.closest('[inert]') && r.getClientRects().length) r.focus({ preventScroll: true }); }, 0);
    }
    wasOn = on;
  }
  store.on('view', show);
  store.on('field', () => { if (visible()) load(); });
  store.on('candidates', () => { if (selected && visible()) renderVet(); });
  store.on('source', () => { if (field) renderLive(); });
  show(store.get('view'));

  const handle = el.__fv = { // handle for tests / the dev page
    get state() { return { A, B, mode, selected, results, field, loading, knownState }; },
    setPair(a, b) { A = a; B = b; update(); },
  };
  return handle;
}
