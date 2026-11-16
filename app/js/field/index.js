// Field analysis view: the Moving Sky experience inside the app (blink / difference / track a patch of sky,
// vet what moved, send candidates to the review list). Mounts into <section id="view-field">.
// Talks to the rest of the app only through the store (view, field, candidates, selectedId; flyto, toast).
import { simulateField, analyse, detect, diff, maxStack, meanStack, radec, pixel, fmtDt, fmtRA, fmtDec, spectrum, dist, psfModel } from '../pipeline/index.js';
import { drawImage, drawStamp, drawOverlay, glyph, KIND_NAME } from './render.js';
import { fixedSource, spectrumSVG, spectrumCaption, spectrumSummary, spectrumCSV } from './spectrum.js';
import { parseCentre } from '../sky/coords.js';
import { clampFieldSize } from '../core/limits.js';
import { EXAMPLES } from './examples.js';
export { EXAMPLES }; // the built-in targets (also what scripts/save-snapshots.mjs saves for the hosted copy)

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const spokenT = l => l.replace(/(\d+) (d|h|min)$/, (_, n, u) => `${n} ${{ d: 'day', h: 'hour', min: 'minute' }[u]}${n === '1' ? '' : 's'}`);
// Passes get short names, not offsets or ids: live frames are 'Scan 2' (the survey pass; 'Scan 2a', '2b' when the
// field has two frames from the same pass), simulated ones 'Pass 3'. The offset stays in the tooltip and the baseline line.
const epName = (E, e) => {
  if (e.scan == null) return `Pass ${E.indexOf(e) + 1}`;
  const same = E.filter(x => x.scan === e.scan);
  return `Scan ${e.scan}${same.length > 1 ? String.fromCharCode(97 + same.indexOf(e)) : ''}`;
};
const epSub = e => String(e.sub || e.band + ' µm').split(' · ')[0]; // the wavelength only
const epTitle = e => `${e.label}${e.date ? ` · ${String(e.date).slice(0, 10)}` : ''}${e.obsId ? ` · ${e.obsId}` : ''}${e.collection ? ` · ${e.collection}${e.release ? ' released ' + String(e.release).slice(0, 10) : ''}` : ''}`;
const DETECTORS = [[1, '0.75–1.09 µm'], [2, '1.10–1.62 µm'], [3, '1.63–2.41 µm'], [4, '2.42–3.82 µm'], [5, '3.83–4.41 µm'], [6, '4.42–5.00 µm']];
const exampleFor = r => r && Number.isFinite(r.ra) ? EXAMPLES.find(e => Math.abs(e.ra - r.ra) < 1e-4 && Math.abs(e.dec - r.dec) < 1e-4) : null;
const isoToMJD = ms => ms / 86400000 + 40587;
/** "61087.13" (MJD) or an ISO date/time ("2026-02-15", "2026-02-15T03:06Z") → MJD; '' → null; junk → NaN. */
export function parseAnchor(v) {
  v = String(v ?? '').trim(); if (!v) return null;
  if (/^\d{5}(\.\d+)?$/.test(v)) return +v;
  const ms = Date.parse(/^\d{4}-\d\d-\d\d$/.test(v) ? v + 'T00:00:00Z' : v); return Number.isFinite(ms) ? isoToMJD(ms) : NaN;
}
const fmtSecs = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
/** ISO timestamp → "14 Nov 2026" (UTC), for the saved-snapshot labels; anything unparsable comes back as given. */
const fmtSaved = iso => { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : String(iso || 'an earlier date'); };
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
        <button data-mode="track" aria-pressed="false" title="Pixel-wise maximum of every pass at the reference wavelength: a mover leaves a trail">Track</button>
        <button data-mode="stack" aria-pressed="false" title="Add the passes together: the mean of every pass at the reference wavelength, so faint fixed sources gain signal-to-noise">Stack</button>
        <button data-mode="play" aria-pressed="false" title="Cycle through every pass at the reference wavelength">Play</button>
      </div>
      <div class="seg" role="group" aria-label="Overlays">
        <button data-act="marks" aria-pressed="true">Flags</button>
        <button data-act="known" aria-pressed="false">Known objects</button>
        <button data-act="stars" data-ref="starsbtn" aria-pressed="false" hidden title="Gaia DR3 stars (G &lt; 19) at the frame time">Gaia stars</button>
        <button data-act="bad" data-ref="badbtn" aria-pressed="false" hidden title="Pixels the SPHEREx pipeline flagged: red = bad, amber = contaminated">Bad pixels</button>
      </div>
      <button data-act="flip" data-ref="flip" hidden>Show comparison</button>
      <span class="fv-spacer"></span>
      <label class="fv-stretch fv-stackall" data-ref="stackallwrap" hidden title="Add every pass of this detector together, whatever its wavelength: more signal, colour differences mixed in"><input data-ref="stackall" type="checkbox"> All wavelengths</label>
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
    <section class="fv-data" data-ref="datasec">
      <h3>Data releases</h3>
      <p class="fv-note" data-ref="relline"></p>
      <ul class="fv-rel" data-ref="rellist"></ul>
      <form data-ref="relform" class="fv-relform">
        <label>New release <input data-ref="relin" type="text" placeholder="spherex_dr2" autocomplete="off" spellcheck="false" aria-describedby="relhelp"></label>
        <button type="submit">Use it</button>
      </form>
      <div class="fv-rowlab" data-ref="reltypedlab" hidden>Added by you</div>
      <ul class="fv-rel fv-typed" data-ref="reltyped" aria-label="Releases added by you" hidden></ul>
      <p class="fv-note" data-ref="relnote" id="relhelp">When IRSA publishes a new release, type its name here (e.g. spherex_dr2). The next field you load from the data server also searches it.</p>
      <div class="fv-fileacts">
        <button data-act="savefile" data-ref="savebtn" class="ghost" title="Download this field as one file that opens in the app on any computer, no server needed">Save field file</button>
        <button data-act="openfile" class="ghost" title="Open a field file saved on another machine">Open field file…</button>
        <input data-ref="filein" type="file" accept=".json,application/json" hidden aria-label="Field file">
      </div>
      <p class="fv-note" data-ref="filenote" role="status"></p>
    </section>
    <section class="fv-live" data-ref="live" hidden>
      <h3 data-ref="livehead">Live request</h3>
      <form data-ref="liveform" class="fv-liveform">
        <label class="fv-wide">Centre, RA and Dec (degrees, or h m s / d m s) <input data-ref="lpos" type="text" inputmode="text" placeholder="70.2635, 19.0558  or  08h55m10.8s −07d14m42.5s" autocomplete="off" spellcheck="false"></label>
        <label>Size <select data-ref="lsize"><option value="120">120″ (20 px)</option><option value="300">300″ (49 px)</option><option value="600">600″ (98 px)</option></select></label>
        <label>Detector <select data-ref="ldet">${DETECTORS.map(([d, r]) => `<option value="${d}">D${d} · ${r}</option>`).join('')}</select></label>
        <label class="fv-wide">Anchor on date <input data-ref="lt" type="text" inputmode="decimal" placeholder="MJD or 2026-02-15 (optional)" autocomplete="off" spellcheck="false"></label>
        <button type="submit">Load</button>
      </form>
      <label class="fv-examples">Examples <select data-ref="lex" aria-label="Example targets"><option value="">Choose a target…</option>${EXAMPLES.map(e => `<option value="${e.id}">${esc(e.label)}</option>`).join('')}</select></label>
      <p class="fv-note fv-exnote" data-ref="exnote" hidden></p>
      <p class="fv-note" data-ref="livenote"></p>
    </section>
    <section>
      <h3 data-ref="dethead">Flagged sources</h3>
      <ul class="fv-dets" data-ref="dets"></ul>
    </section>
    <section class="fv-specsec" data-ref="specsec" hidden>
      <h3>SPHEREx spectrum</h3>
      <div class="fv-fileacts">
        <button data-act="specpick" data-ref="specpick" aria-pressed="false" title="Then click a star in the image: its brightness in every SPHEREx exposure, at the wavelength each one saw">Pick a star</button>
        <button data-act="speccentre" class="ghost" title="The target at the centre of this field">Field centre</button>
      </div>
      <p class="fv-note" data-ref="specstatus" role="status"></p>
      <svg class="fv-specplot" data-ref="specplot" viewBox="0 0 340 180" role="img" hidden></svg>
      <p class="fv-note" data-ref="speccap" hidden></p>
      <div class="fv-fileacts"><button data-act="speccsv" data-ref="speccsv" class="ghost" hidden>Download CSV</button></div>
    </section>
    <section class="fv-vet" data-ref="vet" hidden>
      <h3 data-ref="vethead">Vetting</h3>
      <div class="fv-stamps">
        <figure><canvas data-ref="stA" width="15" height="15" role="img" aria-label="Reference cutout"></canvas><figcaption data-ref="capA">Reference</figcaption></figure>
        <figure><canvas data-ref="stB" width="15" height="15" role="img" aria-label="Comparison cutout"></canvas><figcaption data-ref="capB">Compare</figcaption></figure>
      </div>
      <dl data-ref="kv"></dl>
      <svg class="fv-spec" data-ref="spec" viewBox="0 0 340 120" role="img" aria-label="Spectrum across the 102 SPHEREx bands"></svg>
      <div class="fv-other" data-ref="other"></div> <!-- aladin: Other telescopes chips (app/js/aladin) -->
      <div class="fv-actions">
        <button data-act="add" data-ref="add">Add to review list</button>
        <button data-act="sky" class="ghost">Show on sky</button>
        <button data-act="specsel" data-ref="specsel" class="ghost" hidden title="Its brightness in every SPHEREx exposure, at the wavelength each one saw">Spectrum</button>
        <button data-act="report" class="ghost" title="One-page follow-up report in a new tab: stamps, astrometry, predictions, data files">Report ↗</button> <!-- report -->
      </div>
    </section>
    <p class="fv-keys">Keys: <kbd>B</kbd> <kbd>D</kbd> <kbd>T</kbd> <kbd>M</kbd> <kbd>L</kbd> blink / difference / track / stack / play ·<kbd>F</kbd> flags · <kbd>K</kbd> known · <kbd>G</kbd> Gaia · <kbd>X</kbd> bad pixels · <kbd>Space</kbd> flip / next pass · <kbd>N</kbd>/<kbd>P</kbd> next/previous flag · <kbd>1</kbd>–<kbd>8</kbd> compare pass · <kbd>A</kbd> add · <kbd>S</kbd> show on sky · <kbd>Esc</kbd> clear / back</p>
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

  let field = null, A = 0, B = 0, mode = 'blink', showMarks = true, showKnown = false, showStars = false, showBad = false, stretch = 1, stackAll = false;
  let blinkPhase = 0, playIdx = 0, selected = null, results = [], timer = null, shown = null, loadSeq = 0, loadedFor;
  let specPicking = false, specCtl = null, specData = null, specSeq = 0, specTimer = null, savedSpots = []; // measured spectra (see ---------- spectra)
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
  let ctl = null, loading = false, tickT = null, pollT = null, loadStart = 0, knownState = null, req = null, dataMod = null;
  const liveSource = () => { const s = store.get('source'); return !!(s && s.mode === 'live' && s.live !== false); };
  // saved snapshots of the example fields (app/data/snapshots/): real frames, but only for those targets and no server to ask
  const snapshotSource = () => { const s = store.get('source'); return !!(s && s.mode === 'snapshot'); };
  /** The size the data module will actually request (its liveSize rule), or the shared clamp if the module is missing. */
  const liveSizeOf = s => dataMod && typeof dataMod.liveSize === 'function' ? dataMod.liveSize(s) : clampFieldSize(s);
  async function load() {
    req = store.get('field'); loadedFor = req; const seq = ++loadSeq;
    if (ctl) ctl.abort(); ctl = null; stopLoading();
    let data = null;
    try { data = await import('../data/index.js'); } catch { data = null; }
    dataMod = data;
    if (seq !== loadSeq) return;
    // no position (store.field null; the UI always sets one, the store need not — ISS-25): real data needs a patch to
    // fetch, so open on the source's home patch instead of requesting ra=undefined. loadedFor keeps the store's value.
    if ((liveSource() || snapshotSource()) && !(req && Number.isFinite(req.ra) && Number.isFinite(req.dec))) {
      const s = store.get('source') || {};
      // snapshot mode: the home patch has no saved field (it would show the simulation), so open the first saved target as itself
      const saved = snapshotSource() && Array.isArray(s.targets) ? s.targets[0] : null, home = s.home || (data && data.HOME);
      if (saved) req = { ...(req || {}), ra: saved.ra, dec: saved.dec, sizeArcsec: saved.sizeArcsec, det: saved.det, t: saved.t };
      else if (home) req = { ...(req || {}), ra: home.ra, dec: home.dec, sizeArcsec: Number.isFinite(req?.sizeArcsec) ? req.sizeArcsec : home.sizeArcsec };
    }
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
    if (!field) { $('source').textContent = 'Live · loading'; $('source').title = ''; }
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
    if (!builds || !builds.length) { ol.innerHTML = ''; ol.hidden = true; return; } // warm, finished, or not reported
    ol.hidden = false;
    const quick = builds.find(b => !b.known), full = builds.find(b => b.known), b = quick || full;
    const ORDER = ['sia', 'headers', 'cutouts', 'horizons'], at = b ? ORDER.indexOf(b.stage) : -1;
    const st = (i, lab, n) => `<li class="${at > i || (!quick && full && i < 3 && at < 0) ? 'done' : at === i ? 'now' : ''}">${esc(lab)}${at === i && n ? ` <span>${n}</span>` : ''}</li>`;
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
    const snap = snapshotSource();
    const sec = $('live'), on = (liveSource() || snap) && (loading || (!!field && (!field.simulated || !!field.fallbackReason)));
    sec.hidden = !on; if (!on) return;
    // snapshot mode: the free-form request makes no sense (no server to ask), so the section keeps only the Examples menu
    if (snap) sec.setAttribute('data-snapshot', ''); else sec.removeAttribute('data-snapshot');
    $('livehead').textContent = snap ? 'Saved SPHEREx fields' : 'Live request';
    const r = req || {}, size = loading || !field ? liveSizeOf(r.sizeArcsec) : field.request?.sizeArcsec ?? (field.sizeArcsec ? Math.round(field.sizeArcsec) : 300);
    const sz = $('lsize'); if (![...sz.options].some(o => +o.value === size)) sz.add(new Option(`${size}″`, String(size)));
    sz.value = String(size); $('ldet').value = String(r.det || (field && !loading && field.detector) || 1);
    $('lt').value = Number.isFinite(r.t) ? String(r.t) : '';
    $('lpos').value = Number.isFinite(r.ra) ? `${+r.ra.toFixed(5)}, ${+r.dec.toFixed(5)}` : '';
    // a saved field answers for any request inside it, so name the example by what was loaded, not what was asked
    const ex = exampleFor(field && !loading && field.request ? field.request : r); $('lex').value = ex ? ex.id : '';
    const note = $('exnote'); note.hidden = !ex; note.textContent = ex ? ex.note : '';
    let extra = '';
    if (field && !loading && !field.simulated) {
      const n = field.stars ? field.stars.length : 0, fl = field.epochs.some(e => Number.isFinite(e.flagged));
      extra = ` ${n ? `${n} Gaia DR3 stars overlaid (G < 19)` : field.starsStatus && field.starsStatus.startsWith('failed') ? 'Gaia lookup failed' : 'No Gaia stars'}${fl ? `; ${(Math.max(...field.epochs.map(e => e.flagged || 0)) * 100).toFixed(0)}% of pixels carry a pipeline flag in the worst frame` : ''}.`;
    }
    const snapNote = snap ? `Saved data covers these ${EXAMPLES.length} targets. Run the local server to request any position. ` : '';
    $('livenote').textContent = loading || !field || field.simulated ? snapNote.trim() : snapNote + `Real SPHEREx frames on detector D${field.detector} at ${field.band} µm${field.snapshot ? `, saved ${fmtSaved(field.snapshot.savedAt)}` : ''}. The artifact test uses a PSF width of ${psfModel(field).sigma.toFixed(2)} px ${psfModel(field).from === 'stars' ? `measured from ${psfModel(field).nStars} stars in these frames` : '(typical value; too few stars to measure)'}.` + extra;
  }
  function submitLive(e) {
    e.preventDefault();
    const t = parseAnchor($('lt').value);
    if (Number.isNaN(t)) { $('lt').setAttribute('aria-invalid', 'true'); announce('Anchor date not understood. Use an MJD like 61087.13 or a date like 2026-02-15.'); $('lt').focus(); return; }
    $('lt').removeAttribute('aria-invalid');
    const c = parseCentre($('lpos').value);
    if (!c) { $('lpos').setAttribute('aria-invalid', 'true'); announce('Centre not understood. Use RA, Dec in degrees (70.2635, 19.0558) or sexagesimal (08h55m10.8s −07d14m42.5s).'); $('lpos').focus(); return; }
    $('lpos').removeAttribute('aria-invalid');
    const next = { ra: +c[0].toFixed(5), dec: +c[1].toFixed(5), sizeArcsec: +$('lsize').value, det: +$('ldet').value };
    if (t != null) next.t = t;
    store.set('field', next);
  }
  /** Keep the address bar shareable: /app/?ra=&dec=&size=&det=[&t=] while a field is open, clean again on the sky. */
  function syncUrl(on) {
    if (typeof history === 'undefined' || typeof location === 'undefined' || !history.replaceState) return;
    try {
      const u = new URL(location.href);
      ['ra', 'dec', 'size', 'det', 't'].forEach(k => u.searchParams.delete(k));
      const r = on ? (field && field.request) || req || (field ? { ra: field.ra0, dec: field.dec0, sizeArcsec: field.N * field.scale } : null) : null;
      if (r && Number.isFinite(r.ra) && Number.isFinite(r.dec)) {
        u.searchParams.set('ra', String(+r.ra.toFixed(5))); u.searchParams.set('dec', String(+r.dec.toFixed(5)));
        if (Number.isFinite(r.sizeArcsec)) u.searchParams.set('size', String(Math.round(r.sizeArcsec)));
        if (r.det) u.searchParams.set('det', String(r.det));
        if (Number.isFinite(r.t)) u.searchParams.set('t', String(r.t));
      }
      if (u.href !== location.href) history.replaceState(history.state, '', u.href);
    } catch { /* file:// or a sandboxed frame: no shareable URL */ }
  }
  function syncOverlayButtons() {
    const live = field && !field.simulated;
    $('starsbtn').hidden = !(live && field.stars && field.stars.length);
    $('badbtn').hidden = !(live && typeof field.flags === 'function' && field.flagBits);
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
    if (!same) { A = 0; B = defaultCompare(f, 0); playIdx = 0; selected = null; $('epA').innerHTML = ''; $('epB').innerHTML = ''; }
    const [ra, dec] = radec(f, f.N / 2, f.N / 2), size = f.N * f.scale / 60;
    $('pos').textContent = `RA ${fmtRA(ra)}, Dec ${fmtDec(dec)} · ${size.toFixed(1)}′ × ${size.toFixed(1)}′${f.simulated ? '' : ` · ${f.N}×${f.N} px`}`;
    const src = $('source');
    src.textContent = f.simulated ? (f.fallbackReason ? `Simulated field · ${f.fallbackReason}` : 'Simulated field') : `${f.fromFile ? 'File' : f.snapshot ? 'Saved' : 'Live'} · SPHEREx D${f.detector ?? '?'} · ${f.band} µm`;
    src.classList.toggle('fv-pill-warn', !!f.fallbackReason);
    src.title = f.simulated ? 'Simulated star field and planted movers. Nothing here is a real detection.'
      : f.fromFile ? `Real SPHEREx images from a field file${f.fromFile.name ? ' (' + f.fromFile.name + ')' : ''}, analysed in your browser. Flags are candidates, not detections.`
      : f.snapshot ? `Real SPHEREx images from NASA/IPAC IRSA, saved ${fmtSaved(f.snapshot.savedAt)} and analysed in your browser. Flags are candidates, not detections.`
      : 'Real SPHEREx images from NASA/IPAC IRSA, analysed in your browser. Flags are candidates, not detections.';
    if (!same) resetSpectrum();
    syncOverlayButtons(); update(); renderKnownNote(); renderLive(); renderData(); if (visible()) syncUrl(true);
    if (visible() && !same) announce(`Field loaded${f.simulated ? ', simulated' : f.fromFile ? ', SPHEREx data from a file' : f.snapshot ? ', saved SPHEREx data' : ', live SPHEREx data'}. ${results.length} flagged source${results.length === 1 ? '' : 's'}.`);
    else if (visible() && same) announce(`Known objects checked. ${results.length} flagged source${results.length === 1 ? '' : 's'}.`);
  }

  // ---------- epoch pickers / warning / list ----------
  function epochButtons(box, get, setI) {
    if (!box.children.length) field.epochs.forEach((e, i) => {
      const b = document.createElement('button'); b.innerHTML = `${esc(epName(field.epochs, e))}<small>${esc(epSub(e))}</small>`;
      b.title = epTitle(e); b.setAttribute('aria-label', `${epName(field.epochs, e)}, ${spokenT(e.label)}, ${e.band} µm`);
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
    if ($('baseline').textContent !== baseTxt) { const first = !$('baseline').textContent; $('baseline').textContent = baseTxt; if (!first && visible()) announce(`Reference ${epName(E, a)}, compare ${epName(E, b)}. ${baseTxt}`); }
    renderData();
    const warn = $('warn');
    if (!matched) {
      warn.hidden = false;
      warn.innerHTML = `<span class="fv-bang" aria-hidden="true">!</span><span>These passes were taken at different wavelengths (${esc(a.band)} and ${esc(b.band)} µm). Blinking them shows colour differences, not motion, so flagging is off.</span>`;
      let best = -1, bd = 1e9; E.forEach((e, i) => { if (i !== A && e.band === a.band && Math.abs(e.t - b.t) < bd) { bd = Math.abs(e.t - b.t); best = i; } });
      if (best >= 0) { const btn = document.createElement('button'); btn.textContent = `Compare with ${epName(E, E[best])} instead`; btn.title = 'Nearest pass in time at the reference wavelength';
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
  // Other telescopes (DSS2, 2MASS, AllWISE, SIMBAD) for the selected source. app/js/aladin is loaded on first use, and
  // Aladin Lite itself only when a chip is pressed; if either fails, the Field view carries on without it. // aladin
  let other = null, otherLoad = null, otherTarget = null; // aladin
  function updateOther(ra, dec) { // aladin
    otherTarget = { ra, dec, stampArcsec: 15 * (field.scale || 6.2) };
    if (other) { other.setTarget(otherTarget); return; }
    otherLoad ||= import('../aladin/index.js').then(m => { other = m.mountOtherTelescopes($('other')); other.setTarget(otherTarget); })
      .catch(e => { console.warn('[planet-x] field: other telescopes unavailable', e); $('other').hidden = true; });
  } // aladin
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
      const fl = flagNamesAt(r); if (fl) rows.push(['SPHEREx flags', fl]);
      if (r.star) rows.push(['Gaia DR3', `${r.star.name}, G ${r.star.g.toFixed(1)}${r.star.pm ? `, ${r.star.pm.toFixed(2)}″/yr` : ''}`]);
      if (r.kind === 'known' && r.obj) rows.push([r.obj.kind === 'star' ? 'Catalogue' : 'Ephemeris', `${r.obj.source}${r.obj.kind === 'star' && r.obj.pmArcsecYr ? `, ${r.obj.pmArcsecYr}″/yr` : ''}${Number.isFinite(r.obj.vmag) ? `, ${r.obj.kind === 'star' ? 'G' : 'V'} ${r.obj.vmag}` : ''}`]);
    }
    if (r.kind === 'cand' && field.simulated) rows.push(['Spectrum', 'Water-ice absorption at 1.5, 2.0 and 3 µm, which is why it fades at 3.29 µm']);
    rows.push(['Verdict', VERDICT[r.kind]]);
    $('vethead').textContent = `Vetting: ${r.title}`;
    updateOther(ra, dec); // aladin
    $('kv').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
    drawStamp($('stA'), field.frame(A), field.N, r.from ? r.from.x : r.x, r.from ? r.from.y : r.y);
    drawStamp($('stB'), field.frame(B), field.N, r.to ? r.to.x : r.x, r.to ? r.to.y : r.y);
    $('capA').textContent = `Reference ${epName(E, E[A])}`; $('capB').textContent = `Compare ${epName(E, E[B])}`;
    $('stA').setAttribute('aria-label', `Reference cutout, ${epName(E, E[A])}, 15 by 15 pixels`); $('stB').setAttribute('aria-label', `Comparison cutout, ${epName(E, E[B])}, 15 by 15 pixels`);
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
    svg.toggleAttribute('hidden', !field.simulated); // real fields measure it instead: the Spectrum button below, for a source that stays put (an SVG has no .hidden property)
    $('specsel').hidden = !!field.simulated || !fixedSource(r);
    const add = $('add'); add.hidden = r.kind !== 'cand';
    const existing = r.kind === 'cand' && onList(r);
    add.textContent = existing ? 'On review list' : 'Add to review list'; add.title = existing ? existing.name : '';
    add.setAttribute('aria-disabled', String(!!existing)); add.classList.toggle('fv-done', !!existing);
  }
  /** Names of the SPHEREx pipeline flags under a result's pixel, in the frame it was found in ('none' when clean). */
  function flagNamesAt(r) {
    if (!field || typeof field.flags !== 'function' || !field.flagBits) return null;
    const fl = field.flags(r.to ? B : A); if (!fl) return null;
    const p = r.to || r.from || r, x = Math.round(p.x), y = Math.round(p.y); if (x < 0 || y < 0 || x >= field.N || y >= field.N) return null;
    const v = fl[y * field.N + x], names = Object.entries(field.flagBits.names).filter(([n, b]) => n !== 'SOURCE' && ((v >>> b) & 1)).map(([n]) => n);
    return names.length ? names.join(', ') : 'none';
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
      note: `${r.title}: ${r.detail} Flagged in field analysis (reference ${epName(E, E[A])}, compare ${epName(E, E[B])})${field.simulated ? '' : ' on live SPHEREx frames from IRSA'}. Candidate signal, not a detection.`,
      simulated: !!field.simulated, live: !field.simulated, source: 'field',
    };
    store.set('candidates', [...list, cand]);
    store.set('selectedId', cand.id);
    store.emit('toast', `Added ${cand.name} to the review list`);
    announce(`Added ${cand.name} to the review list`);
    renderVet(); $('add').focus();
  }
  // Candidate report (app/report.html) for the selected source, in a new tab. The report module loads only on this // report
  // click; the tab is opened first, synchronously, so a popup blocker lets it through. Nothing is re-detected. // report
  async function openReport() { // report
    const r = selected; if (!r || !field) return; // report
    const w = window.open('', '_blank'); // report
    try { // report
      const [{ buildReport }, { toHash }] = await Promise.all([import('../report/model.js'), import('../report/encode.js')]); // report
      const mode = dataMod && typeof dataMod.dataMode === 'function' ? dataMod.dataMode() : undefined; // report
      const url = new URL('../../report.html#' + await toHash(buildReport(r, field, { A, B, mode, psfSigma: psfModel(field).sigma })), import.meta.url).href; // report
      if (w) { w.opener = null; w.location.href = url; } else window.open(url, '_blank', 'noopener'); // report
      announce('Report opened in a new tab'); // report
    } catch (e) { // report
      if (w) w.close(); console.warn('[planet-x] field: report failed', e); store.emit('toast', `Report could not be made: ${e.message}`); // report
    } // report
  } // report
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
    legend.hidden = !(mode === 'diff' || mode === 'stack');
    if (mode === 'blink') { const showB = blinkPhase % 2 === 1; shown = field.frame(showB ? B : A); drawImage(img, shown, N, false, stretch);
      flash.textContent = showB ? `Compare · ${epName(E, E[B])}` : `Reference · ${epName(E, E[A])}`; knownT = [E[showB ? B : A].t]; }
    else if (mode === 'diff') { shown = diff(field, A, B); drawImage(img, shown, N, true, stretch); flash.textContent = 'Compare − Reference'; knownT = [E[A].t, E[B].t];
      legend.innerHTML = '<i aria-hidden="true"></i><span>fainter · brighter</span>'; }
    else if (mode === 'play') { const seq = playSeq(), n = playIdx % seq.length, i = seq[n]; shown = field.frame(i); drawImage(img, shown, N, false, stretch);
      flash.textContent = `${epName(E, E[i])} · ${E[i].date ? String(E[i].date).slice(0, 10) : E[i].label} (${n + 1}/${seq.length})`; knownT = [E[i].t]; }
    else if (mode === 'stack') { const c = meanStack(field, stackAll ? null : E[A].band, A, B); shown = c.img; drawImage(img, shown, N, false, stretch); knownT = c.ts.slice();
      const n = knownT.length, [e0, e1] = E[A].t <= E[B].t ? [A, B] : [B, A];
      const where = stackAll ? `, all wavelengths (${c.bands.length > 1 ? `${c.bands[0]}–${c.bands.at(-1)}` : c.bands[0]} µm)` : ` at ${E[A].band} µm`;
      flash.textContent = `Mean of ${n} pass${n === 1 ? '' : 'es'}${where}, ${epName(E, E[e0])} to ${epName(E, E[e1])}${n > 1 ? ` · noise about ${c.gain.toFixed(1)}× lower than one pass` : ''}`;
      const nS = detect(c.img, 5).length, n1 = detect(field.frame(A), 5).length; // what the co-add buys, counted: sources above 5σ
      legend.innerHTML = `<span>${nS} source${nS === 1 ? '' : 's'} above 5σ in the stack · ${n1} in ${esc(epName(E, E[A]))}</span>`; }
    else { const band = E[A].band, c = maxStack(field, band, A, B); shown = c.img; drawImage(img, shown, N, false, stretch); knownT = c.ts.slice();
      const n = knownT.length, [e0, e1] = E[A].t <= E[B].t ? [A, B] : [B, A];
      flash.textContent = `Max-stack of ${n} pass${n === 1 ? '' : 'es'} at ${band} µm, ${epName(E, E[e0])} to ${epName(E, E[e1])}`; }
    lastKnownT = knownT; renderOverlay(); showReadout();
  }
  let lastKnownT = [], lastXY = null;
  function renderOverlay() {
    if (!field) return;
    const ov = $('ov'), st = $('stage'), css = st.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(css * dpr);
    if (!W) return;
    if (ov.width !== W) { ov.width = ov.height = W; }
    const matched = field.epochs[A].band === field.epochs[B].band;
    const knownPts = []; for (const t of lastKnownT) for (const k of field.known || []) { const q = k.pos(t); if (q) knownPts.push({ x: q[0], y: q[1], name: k.name }); }
    // Gaia stars at the time of the frame on screen; bad pixels from that frame's FLAGS plane (none for a stack).
    const t = lastKnownT.length ? lastKnownT[0] : field.epochs[A].t;
    const stars = showStars && field.stars ? field.stars.map(s => { const [x, y] = s.pos(t); return { x, y, g: s.g }; }) : null;
    const fi = mode === 'blink' ? (blinkPhase % 2 === 1 ? B : A) : mode === 'diff' ? B : mode === 'play' ? playFrame() : null;
    const flags = showBad && fi != null && typeof field.flags === 'function' ? field.flags(fi) : null;
    drawOverlay(ov, { N: field.N, dpr, results: matched && mode !== 'play' ? results : [], selected, showMarks, showKnown, knownPts, showStars, stars, showBad, flags, flagBits: field.flagBits || null, spots: specPicking ? savedSpots : null });
  }
  /** Frames at the reference pass's wavelength in time order: what Play cycles through. */
  const playSeq = () => { const E = field.epochs, band = E[A].band, s = E.map((e, i) => i).filter(i => E[i].band === band); s.sort((i, j) => E[i].t - E[j].t); return s.length ? s : [A]; };
  const playFrame = () => { const s = playSeq(); return s[playIdx % s.length]; };
  function syncFlip() {
    const f = $('flip'); f.hidden = !((mode === 'blink' || mode === 'play') && reducedMQ.matches);
    f.textContent = mode === 'play' ? 'Next pass' : blinkPhase % 2 === 1 ? 'Show reference' : 'Show comparison';
  }
  function setTimer() {
    clearInterval(timer); timer = null;
    if (!reducedMQ.matches && visible() && field) {
      if (mode === 'blink') timer = setInterval(() => { blinkPhase++; render(); }, 650);
      else if (mode === 'play') timer = setInterval(() => { playIdx++; render(); }, 900);
    }
    syncFlip();
  }
  function setMode(m) { mode = m; el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); $('stackallwrap').hidden = m !== 'stack'; blinkPhase = 0; playIdx = 0; render(); setTimer();
    announce({ blink: 'Blink', diff: 'Difference image', track: 'Track: max-stack', stack: 'Stack: the passes added together, mean image', play: field ? `Play: ${playSeq().length} passes at ${field.epochs[A].band} µm in time order${reducedMQ.matches ? '; Space or Next pass steps' : ''}` : 'Play' }[m]); }
  function flip() {
    if (mode === 'play') { playIdx++; render(); syncFlip(); announce(`Showing ${$('flash').textContent}`); return; }
    if (mode !== 'blink') return; blinkPhase++; render(); syncFlip(); announce(`Showing ${$('flash').textContent}`);
  }
  const toggle = (which) => {
    if (which === 'marks') showMarks = !showMarks; else if (which === 'known') showKnown = !showKnown; else if (which === 'stars') showStars = !showStars; else if (which === 'bad') showBad = !showBad;
    const on = { marks: showMarks, known: showKnown, stars: showStars, bad: showBad }[which];
    el.querySelector(`[data-act="${which}"]`).setAttribute('aria-pressed', String(on)); renderOverlay();
    if (which === 'stars' || which === 'bad') announce(`${which === 'stars' ? 'Gaia stars' : 'Bad pixels'} ${on ? 'shown' : 'hidden'}`);
  };

  // ---------- events ----------
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    if (b.dataset.mode) return setMode(b.dataset.mode);
    switch (b.dataset.act) {
      case 'back': store.set('view', 'sky'); break;
      case 'marks': case 'known': case 'stars': case 'bad': toggle(b.dataset.act); break;
      case 'flip': flip(); break;
      case 'add': addToReview(); break;
      case 'sky': showOnSky(); break;
      case 'report': openReport(); break; // report
      case 'specpick': setPicking(!specPicking); break;
      case 'speccentre': measureSpectrum(centreTarget()); break;
      case 'specsel': if (selected) { measureSpectrum(spectrumTargetFor(selected)); $('specsec').scrollIntoView({ block: 'nearest', behavior: reducedMQ.matches ? 'auto' : 'smooth' }); } break;
      case 'speccsv': downloadSpectrum(); break;
      case 'cancel': cancelLoad(); break;
    }
  });
  $('liveform').addEventListener('submit', submitLive);

  // ---------- data releases and field files ----------
  const relText = e => dataMod && dataMod.releaseLabel ? dataMod.releaseLabel(e) : '';
  function renderData() {
    if (!dataMod) { import('../data/index.js').then(m => { dataMod = m; renderData(); }, () => {}); return; }
    const real = field && !field.simulated, E = real ? field.epochs : [];
    const ta = E[A] && relText(E[A]), tb = E[B] && relText(E[B]);
    $('relline').textContent = !real ? 'Simulated data has no SPHEREx release.' : !ta && !tb ? 'This field does not say which release it came from (saved before releases were recorded).'
      : A === B || ta === tb ? `Both passes: ${ta}.` : `Reference pass: ${ta || 'unknown'}. Compare pass: ${tb || 'unknown'}.`;
    const ul = $('rellist'); ul.innerHTML = '';
    for (const r of real ? dataMod.fieldReleases(field) : []) {
      const li = document.createElement('li'); li.textContent = `${r.collection}${r.release ? ` · released ${r.release}` : ''} · ${r.n} image${r.n === 1 ? '' : 's'}`; ul.appendChild(li);
    }
    const mine = dataMod.getReleases(), typed = $('reltyped');
    typed.innerHTML = '';
    for (const c of mine) { // each release added by hand, with what this field got from it (when it was loaded with it) and a way to take it back
      const li = document.createElement('li'), t = document.createElement('span'), b = document.createElement('button');
      const st = real ? dataMod.requestedStatusText(field, c) : '';
      t.textContent = st ? `${c} · ${st}` : c;
      b.type = 'button'; b.className = 'ghost'; b.dataset.act = 'relrm'; b.dataset.rel = c; b.textContent = 'Remove'; b.setAttribute('aria-label', `Remove ${c}`);
      li.append(t, b); typed.appendChild(li);
    }
    typed.hidden = $('reltypedlab').hidden = !mine.length;
    $('relnote').textContent = liveSource()
      ? `When IRSA publishes a new release, add its name here (e.g. spherex_dr2): fields you load from the data server then search it too${mine.length ? ', as they do the ones above' : ''}. Up to ${dataMod.MAX_RELEASES}.`
      : 'Adding a release needs the local data server: only a server can search IRSA. Names you add are kept in this browser until you run one.';
    $('savebtn').disabled = !real || !field._json;
  }
  const reloadForReleases = msg => { // a change of releases changes what the server searches: reload a live field, otherwise just redraw the list
    if (liveSource() && visible()) { loadedFor = null; load(); announce(`${msg} Reloading this field from the server.`); }
    else { renderData(); announce(msg); }
  };
  $('relform').addEventListener('submit', e => {
    e.preventDefault();
    if (!dataMod) return;
    const input = $('relin'), r = dataMod.addReleases(dataMod.getReleases(), input.value);
    const say = (msg, invalid) => { $('relnote').textContent = msg; announce(msg); if (invalid) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
    if (r.bad.length) return say(`Not a SPHEREx release name: ${r.bad.join(', ')}. Names look like spherex_dr2 or spherex_qr4 (the IRSA collection name).`, true);
    if (r.full) return say(`Up to ${dataMod.MAX_RELEASES} releases can be added. Remove one first.`, true);
    if (!r.added.length) return say(r.already.length ? `Already added: ${r.already.join(', ')}.` : 'Type a release name, e.g. spherex_dr2.', !r.already.length);
    input.removeAttribute('aria-invalid'); input.value = '';
    dataMod.setReleases(r.list);
    store.emit('toast', `Release added: ${r.added.join(', ')}`);
    reloadForReleases(`Release ${r.added.join(', ')} added.`);
  });
  $('reltyped').addEventListener('click', e => {
    const b = e.target.closest('button[data-act="relrm"]'); if (!b || !dataMod) return;
    const c = b.dataset.rel;
    dataMod.setReleases(dataMod.getReleases().filter(x => x !== c));
    store.emit('toast', `Release removed: ${c}`);
    $('relin').focus(); // the button is gone: keep the keyboard in the section
    reloadForReleases(`Release ${c} removed.`);
  });
  $('savebtn').addEventListener('click', () => {
    try {
      const blob = new Blob([dataMod.fieldFileText(field)], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = dataMod.fieldFileName(field); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      $('filenote').textContent = `Saved ${a.download}. Open it with "Open field file" on any computer, no server needed.`;
    } catch (err) { $('filenote').textContent = err.message; }
  });
  $('filein').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
    const note = $('filenote');
    try {
      if (!dataMod) dataMod = await import('../data/index.js');
      if (file.size > dataMod.FIELD_FILE_MAX_BYTES) throw new Error('This file is too large to be a field file');
      const f = dataMod.parseFieldFile(await file.text(), file.name);
      if (ctl) ctl.abort(); ctl = null; loadSeq++; stopLoading();
      loadedFor = store.get('field'); // what the store asks for stays as it was; this marks it loaded, so coming back to the view does not reload from the server
      knownState = null; setField(f);
      note.textContent = `Opened ${file.name}: ${f.epochs.length} images, ${f.N}×${f.N} px, RA ${f.ra0.toFixed(4)}, Dec ${f.dec0.toFixed(4)}.`;
      announce(note.textContent);
    } catch (err) { note.textContent = err.message; announce(err.message); }
  });
  el.addEventListener('click', e => { const b = e.target.closest('button[data-act="openfile"]'); if (b && el.contains(b)) $('filein').click(); });
  $('lex').addEventListener('change', e => {
    const ex = EXAMPLES.find(x => x.id === e.target.value); if (!ex) return;
    const next = { ra: ex.ra, dec: ex.dec, sizeArcsec: ex.sizeArcsec, det: ex.det }; if (ex.t) next.t = ex.t;
    store.set('field', next);
  });
  $('stretch').addEventListener('input', e => { stretch = parseFloat(e.target.value); requestAnimationFrame(render); });
  $('stackall').addEventListener('change', e => { stackAll = e.target.checked; render(); announce(stackAll ? 'Stack: every wavelength of this detector added together' : `Stack: passes at ${field ? field.epochs[A].band : ''} µm only`); });
  const ov = $('ov');
  const toPix = e => { const rect = ov.getBoundingClientRect(); return [(e.clientX - rect.left) / rect.width * field.N, (e.clientY - rect.top) / rect.height * field.N]; };
  const readoutAt = e => { if (!field) return; const [fx, fy] = toPix(e); lastXY = [Math.floor(fx), Math.floor(fy)]; showReadout(); };
  function showReadout() { if (!lastXY || !field) return; const [x, y] = lastXY, N = field.N; if (x < 0 || y < 0 || x >= N || y >= N) return;
    const img = shown || field.frame(A), [ra, dec] = radec(field, x, y);
    $('readout').innerHTML = `<span>RA <b>${fmtRA(ra)}</b></span><span>Dec <b>${fmtDec(dec)}</b></span><span>Pixel <b>${x}, ${y}</b></span><span>${mode === 'diff' ? 'Difference' : mode === 'track' ? 'Stack max' : mode === 'stack' ? 'Stack mean' : 'Value'} <b>${img[y * N + x].toFixed(2)} MJy/sr</b></span>`; }
  ov.addEventListener('pointermove', readoutAt); ov.addEventListener('pointerdown', readoutAt);
  ov.addEventListener('click', e => { if (!field) return; const [x, y] = toPix(e); if (specPicking) { spectrumAtPixel(x, y); return; } let best = null, bd = Math.max(14 * field.N / 320, 18 * field.N / (ov.getBoundingClientRect().width || 320));
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
    if (k === 'Escape') { if (loading) cancelLoad(); else if (specPicking) setPicking(false); else if (selected) { select(null); } else store.set('view', 'sky'); }
    else if (k === 'b') setMode('blink'); else if (k === 'd') setMode('diff'); else if (k === 't') setMode('track'); else if (k === 'm') setMode('stack'); else if (k === 'l') setMode('play');
    else if (k === 'f') toggle('marks'); else if (k === 'k') toggle('known');
    else if (k === 'g') { if ($('starsbtn').hidden) return; toggle('stars'); } else if (k === 'x') { if ($('badbtn').hidden) return; toggle('bad'); }
    else if (k === ' ') { if (((mode === 'blink' && reducedMQ.matches) || mode === 'play') && tag !== 'BUTTON') flip(); else return; }
    else if (k === 'n' || k === 'p') { if (!results.length) return; const i = results.indexOf(selected), j = i < 0 ? (k === 'n' ? 0 : results.length - 1) : (i + (k === 'n' ? 1 : -1) + results.length) % results.length; select(results[j]); }
    else if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey) { const i = +e.code.slice(5) - 1; if (!field || i >= field.epochs.length) return; B = i; update(); }
    else if (k === 'a') { if (selected?.kind === 'cand') addToReview(); else return; }
    else if (k === 's') showOnSky();
    else return;
    e.preventDefault();
  });

  // ---------- spectra ----------
  // A measured SPHEREx spectrum of one spot (server/lib/spectrum.mjs): picked in the image, the field's centre, or the
  // selected flagged source when it stays put. A Gaia star is measured at its catalogue position with its proper motion,
  // so the server follows it from exposure to exposure; `near` is where it is in this field, which a saved spectrum matches.
  const GAIA_J2016 = 57388.5;
  const gaiaRaw = id => { const list = field && field._json && Array.isArray(field._json.stars) ? field._json.stars : []; return id == null ? null : list.find(s => String(s.id) === String(id)) || null; };
  const gaiaOfKnown = k => { const raw = field && field._json && Array.isArray(field._json.known) ? field._json.known.find(x => x.name === k.name) : null; return raw ? gaiaRaw(raw.gaiaId) : null; };
  const gaiaTarget = (raw, near, label) => raw && Number.isFinite(raw.ra) && Number.isFinite(raw.dec) ? { ra: raw.ra, dec: raw.dec, near, label,
    ...(Number.isFinite(raw.pmra) && Number.isFinite(raw.pmdec) ? { pmra: raw.pmra, pmdec: raw.pmdec, epoch: GAIA_J2016 } : {}) } : null;
  /** The Gaia star within `r` px of (x, y) in the reference pass, or null. Tight on purpose: WISE 0855 is not in Gaia and a
   *  background star sits 1.2 px from it, which a looser match would measure instead. */
  function gaiaNear(x, y, r = 0.8) {
    let best = null, bd = r;
    for (const s of (field && field.stars) || []) { const [sx, sy] = s.pos(field.epochs[A].t); const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  const where = ([ra, dec]) => `RA ${fmtRA(ra)}, Dec ${fmtDec(dec)}`;
  function spectrumTargetFor(r) {
    const near = radec(field, r.x, r.y);
    const raw = r.kind === 'known' && r.obj ? gaiaOfKnown(r.obj) : r.star ? gaiaRaw(r.star.id) : null;
    return gaiaTarget(raw, near, r.title) || { ra: near[0], dec: near[1], near, label: r.title };
  }
  function centreTarget() {
    const q = field.request || {}, c = Number.isFinite(q.ra) && Number.isFinite(q.dec) ? [q.ra, q.dec] : [field.ra0, field.dec0];
    const ex = exampleFor(q), label = ex && !Number.isFinite(ex.t) ? ex.label.split(' · ')[0] : 'the field centre'; // an anchored example (16 Psyche) moves: the spot is not it
    const s = gaiaNear(field.N / 2, field.N / 2);
    return (s && gaiaTarget(gaiaRaw(s.id), c, label)) || { ra: c[0], dec: c[1], near: c, label };
  }
  /** A click in the image while picking: the light-weighted centre of what is within 2 px of it, above the local sky (the
   *  star, not the sky beside it; a saturated star, whose core the server fills with the median, still centres on its ring). */
  function spectrumAtPixel(fx, fy) {
    if (!field || field.simulated) return;
    const N = field.N, img = field.frame(A), cx = Math.floor(fx), cy = Math.floor(fy), at = (x, y) => x >= 0 && y >= 0 && x < N && y < N ? img[y * N + x] : NaN;
    const ring = []; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 4 && Number.isFinite(at(cx + dx, cy + dy))) ring.push(at(cx + dx, cy + dy));
    ring.sort((a, b) => a - b); const sky = ring.length ? ring[ring.length >> 1] : 0;
    let sw = 0, sx = 0, sy = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const w = Math.max(0, at(cx + dx, cy + dy) - sky) || 0; sw += w; sx += w * (cx + dx); sy += w * (cy + dy); }
    const px = sw > 0 ? sx / sw : cx, py = sw > 0 ? sy / sw : cy;
    const near = radec(field, px, py), s = gaiaNear(px, py, 1.0);
    measureSpectrum((s && gaiaTarget(gaiaRaw(s.id), near, s.name)) || { ra: near[0], dec: near[1], near, label: `the star at ${where(near)}` });
  }
  function setPicking(on) {
    specPicking = !!on && !!field && !field.simulated;
    $('specpick').setAttribute('aria-pressed', String(specPicking)); $('stage').classList.toggle('fv-picking', specPicking);
    if (specPicking) { announce('Click a star in the image to measure its spectrum. Esc stops picking.'); loadSavedSpots(); }
    renderOverlay(); // the saved-spectrum rings come and go with picking
  }
  /** Where this copy has saved spectra inside the field (hosted copy only: a data server measures anywhere), ringed while picking. */
  async function loadSavedSpots() {
    const f = field; savedSpots = [];
    if (!f || f.simulated || !snapshotSource()) return;
    if (!dataMod) dataMod = await import('../data/index.js');
    const list = typeof dataMod.savedSpectra === 'function' ? await dataMod.savedSpectra() : [];
    if (f !== field) return;
    savedSpots = list.map(s => { const [x, y] = pixel(f, s.ra, s.dec); return { x, y }; }).filter(p => p.x >= 0 && p.y >= 0 && p.x < f.N && p.y < f.N);
    if (!specPicking) return;
    renderOverlay();
    if (!specData) $('specstatus').textContent = savedSpots.length
      ? `Click a star. On this copy the ${savedSpots.length} ringed star${savedSpots.length === 1 ? ' has a saved spectrum' : 's have saved spectra'}; the data server measures any star.`
      : 'Click a star. No spectra are saved in this field on this copy; the data server measures any star.';
  }
  function resetSpectrum() {
    specSeq++; if (specCtl) specCtl.abort(); specCtl = null; clearInterval(specTimer); specTimer = null; specData = null; setPicking(false);
    $('specsec').hidden = !field || !!field.simulated;
    $('specstatus').textContent = field && !field.simulated ? 'Pick a star in the image, or measure the target at the field centre: its brightness in every SPHEREx exposure, at the wavelength each one saw.' : '';
    renderSpectrum();
  }
  async function measureSpectrum(t) {
    if (!field || field.simulated || !t) return;
    if (!dataMod) dataMod = await import('../data/index.js');
    const seq = ++specSeq; if (specCtl) specCtl.abort(); const c = specCtl = new AbortController();
    specData = null; renderSpectrum(); clearInterval(specTimer); specTimer = null;
    const live = liveSource(), t0 = Date.now(), say = m => { $('specstatus').textContent = m; };
    say(live ? `Measuring ${t.label} in every SPHEREx exposure of this spot… A minute or two the first time; cached after.` : `Loading the saved spectrum of ${t.label}…`);
    announce($('specstatus').textContent);
    if (live) specTimer = setInterval(async () => {
      const b = (await dataMod.spectrumProgress() || []).find(x => Math.abs(x.ra - t.ra) < 1e-5 && Math.abs(x.dec - t.dec) < 1e-5);
      if (seq === specSeq && specTimer) say(`Measuring ${t.label}: ${b && b.total ? `${b.done} of ${b.total} exposures` : b ? b.label : 'waiting for the server'} · ${fmtSecs(Date.now() - t0)}`);
    }, 1000);
    try {
      const s = await dataMod.getSpectrum({ ra: t.ra, dec: t.dec, pmra: t.pmra, pmdec: t.pmdec, epoch: t.epoch, near: t.near, signal: c.signal });
      if (seq !== specSeq) return;
      specData = { ...s, label: t.label, where: where(t.near || [t.ra, t.dec]) };
      renderSpectrum(); announce(`Spectrum of ${t.label}. ${spectrumSummary(specData)}`);
    } catch (e) { if (seq === specSeq && !c.signal.aborted) { say(e.message); announce(e.message); } }
    finally { if (seq === specSeq) { clearInterval(specTimer); specTimer = null; } }
  }
  function renderSpectrum() {
    const s = specData, svg = $('specplot'), cap = $('speccap'), csv = $('speccsv');
    if (!s) { svg.setAttribute('hidden', ''); cap.hidden = csv.hidden = true; svg.innerHTML = ''; return; }
    const n = (s.points || []).length;
    svg.innerHTML = spectrumSVG(s.points); svg.toggleAttribute('hidden', !n); svg.setAttribute('aria-label', spectrumSummary(s));
    cap.textContent = spectrumCaption(s, s.where); cap.hidden = false; csv.hidden = !n;
    const sat = (s.rejected || {}).saturated || 0;
    $('specstatus').textContent = n ? `${s.label}${s.source === 'saved' ? ' (saved)' : ''}: ${n} measured point${n === 1 ? '' : 's'}.` : `${s.label}${s.source === 'saved' ? ' (saved)' : ''}: no exposure could be measured here${sat > (s.nExposures || 0) / 2 ? ': it is too bright for SPHEREx' : ''}.`;
  }
  function downloadSpectrum() {
    const s = specData; if (!s || !(s.points || []).length) return;
    const a = document.createElement('a'), sign = s.dec >= 0 ? '+' : '-';
    a.href = URL.createObjectURL(new Blob([spectrumCSV(s)], { type: 'text/csv' }));
    a.download = `planetx-spectrum-${(+s.ra).toFixed(4)}${sign}${Math.abs(+s.dec).toFixed(4)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    announce(`Saved ${a.download}`);
  }

  // ---------- store integration ----------
  let wasOn = false, returnFocus = null;
  function show(v) {
    const on = v === 'field';
    el.hidden = !on;
    if (on) {
      if (!wasOn) returnFocus = document.activeElement;
      if (loadedFor !== store.get('field') || (!field && !loading)) load();
      else if (field && !loading) { render(); setTimer(); syncUrl(true); }
      requestAnimationFrame(() => { renderOverlay(); if (!el.contains(document.activeElement)) $('h').focus({ preventScroll: true }); });
    } else {
      clearInterval(timer); timer = null; if (wasOn) syncUrl(false);
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
  renderData();

  const handle = el.__fv = { // handle for tests / the dev page
    get state() { return { A, B, mode, playIdx, showStars, showBad, selected, results, field, loading, knownState, savedSpots: savedSpots.length, specPicking }; },
    setPair(a, b) { A = a; B = b; update(); },
  };
  return handle;
}
