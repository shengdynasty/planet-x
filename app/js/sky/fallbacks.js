// Minimal built-in stand-ins used by main.js when a module owned by another agent (data, candidates, field)
// is missing or fails to load. They keep the shell usable on its own; the real modules replace them with
// no edits. All data here is placeholder and marked simulated.
import { renderCutout } from '../compare/cutout.js';
import { fmtRA, fmtDec, shiftText, pad2 } from './coords.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export const STUB_SCANS = [
  { id: 1, label: 'Scan 1', date: 'May 2025', has: true },
  { id: 2, label: 'Scan 2', date: 'Nov 2025', has: true },
  { id: 3, label: 'Scan 3', date: 'May 2026', has: true },
  { id: 4, label: 'Scan 4', date: 'Nov 2026', has: false },
];

export const STUB_CANDIDATES = [
  { tag: 'Known asteroid · 2003 UB', status: 'Matched', band: '2.4 µm', pos: [[3.20, 12.0], [3.90, 10.5], [4.55, 9.2]], match: '2003 UB', note: 'Fast main‑belt mover. Cross‑matched to JPL’s catalogue on the first pass.' },
  { tag: 'Known comet · C/2024 R3', status: 'Matched', band: '3.1 µm', pos: [[9.80, -22.0], [10.30, -24.0], [10.95, -25.6]], match: 'C/2024 R3', note: 'Extended emission consistent with a coma.' },
  { tag: 'Unmatched · slow mover', status: 'Candidate', band: '4.6 µm', pos: [[16.10, 41.0], [16.15, 41.2], [16.19, 41.35]], note: 'No match in the known‑object catalogue. A shift this small over six months is consistent with a very distant body. A candidate for review, not a detection.' },
  { tag: 'Known asteroid · 1998 KY26', status: 'Matched', band: '1.6 µm', pos: [[20.40, -8.0], [21.10, -6.4], [21.85, -4.9]], match: '1998 KY26', note: 'Near‑Earth asteroid. Large shift between scans.' },
  { tag: 'Probable brown dwarf', status: 'Likely', band: '4.1 µm', pos: [[6.70, 58.0], [6.78, 57.6], [6.86, 57.2]], note: 'Bright in the longest bands, faint in the shortest. Motion suggests a nearby cool object.' },
  { tag: 'Unmatched · slow mover', status: 'Candidate', band: '4.6 µm', pos: [[13.40, -47.0], [13.42, -46.7], [13.45, -46.4]], note: 'Second slow, unmatched source. Three epochs is the minimum for an orbit fit; the solution is still poorly constrained.' },
].map((c, i) => ({ id: `c${pad2(i + 1)}`, name: `Candidate ${pad2(i + 1)}`, simulated: true, ...c }));

/** Stand-in for data/index.js initData. */
export async function initDataStub(store) {
  store.set('scans', STUB_SCANS);
  store.set('candidates', STUB_CANDIDATES);
  store.set('source', { mode: 'sim', live: false, note: 'Built-in placeholder data (data module not loaded)' });
}

/** Stand-in for candidates/index.js: the UI demo's Movers list + detail card. */
export function mountCandidatesStub(el, store) {
  el.classList.add('stub-panel');
  el.innerHTML = `
    <header><h2>Movers</h2>
      <div class="seg stub-filters" role="group" aria-label="Filter movers">
        <button type="button" data-f="all" aria-pressed="true">All</button>
        <button type="button" data-f="Candidate" aria-pressed="false">Unmatched</button>
        <button type="button" data-f="Matched" aria-pressed="false">Matched</button>
      </div>
    </header>
    <ul class="stub-list" role="listbox" aria-label="Movers"></ul>
    <div class="stub-empty" hidden>Nothing flagged with this filter.</div>
    <section class="stub-detail" hidden>
      <h3 class="d-name"></h3><div class="tag d-tag"></div>
      <canvas class="stub-cut" width="256" height="256" role="img" aria-label="Simulated cutout of the selected mover"></canvas>
      <div class="cutlabel"><span class="d-scan"></span><span>60″ cutout · simulated</span></div>
      <dl><dt>Position</dt><dd class="d-pos"></dd><dt>Shift</dt><dd class="d-shift"></dd><dt>Peak band</dt><dd class="d-band"></dd><dt>Status</dt><dd class="d-status"></dd></dl>
      <p class="d-note"></p>
      <div class="row"><button type="button" class="d-compare">Open in Compare</button><button type="button" class="ghost d-fly">Center on sky</button></div>
    </section>`;
  const q = s => el.querySelector(s);
  const list = q('.stub-list'), detail = q('.stub-detail'), cut = q('.stub-cut'), cg = cut.getContext('2d');
  function renderList() {
    const cands = store.get('candidates') || [], st = store.get('filter').status, sel = store.get('selectedId');
    list.innerHTML = '';
    let shown = 0;
    cands.forEach((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.tabIndex = c.id === sel || (!sel && i === 0) ? 0 : -1;
      li.setAttribute('aria-selected', String(c.id === sel)); li.dataset.id = c.id;
      const num = (/(\d+)\s*$/.exec(c.name) || [, i + 1])[1];
      li.innerHTML = `<span class="n">${esc(pad2(+num))}</span><span>${esc((c.tag || '').split(' · ')[0])}</span><span class="s">${esc(c.status)}</span>`;
      li.hidden = !(st === 'all' || c.status === st); if (!li.hidden) shown++;
      li.addEventListener('click', () => {
        store.set('selectedId', c.id);
        const p = c.pos[Math.min(store.get('scan') || 1, c.pos.length) - 1];
        store.emit('flyto', { ra: p[0] * 15, dec: p[1], fov: 22, raHours: p[0] });
      });
      li.addEventListener('keydown', e => {
        const items = [...list.querySelectorAll('li:not([hidden])')], k = items.indexOf(li);
        if (e.key === 'ArrowDown' && items[k + 1]) { items[k + 1].focus(); e.preventDefault(); }
        else if (e.key === 'ArrowUp' && items[k - 1]) { items[k - 1].focus(); e.preventDefault(); }
        else if (e.key === 'Enter' || e.key === ' ') { store.set('selectedId', c.id); e.preventDefault(); }
      });
      list.appendChild(li);
    });
    q('.stub-empty').hidden = shown > 0;
    el.querySelectorAll('.stub-filters button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === st)));
  }
  function renderDetail() {
    const c = store.selected();
    detail.hidden = !c; if (!c) return;
    const scans = store.get('scans') || [];
    const [x, y, p, k] = renderCutout(cg, cut.width, c, store.get('scan') || 1);
    cg.strokeStyle = 'rgba(255,255,255,.6)'; cg.lineWidth = 1; cg.beginPath(); cg.arc(x, y, 16, 0, Math.PI * 2); cg.stroke();
    const s = scans[k] || {};
    q('.d-name').textContent = c.name; q('.d-tag').textContent = c.tag || '';
    q('.d-scan').textContent = `${s.label || ''} · ${s.date || ''}`;
    q('.d-pos').textContent = `${fmtRA(p[0])}, ${fmtDec(p[1])}`;
    q('.d-shift').textContent = shiftText(c.pos); q('.d-band').textContent = c.band || '—';
    q('.d-status').textContent = c.status; q('.d-note').textContent = c.note || '';
  }
  el.querySelectorAll('.stub-filters button').forEach(b => b.addEventListener('click', () => store.patch('filter', { status: b.dataset.f })));
  q('.d-compare').addEventListener('click', () => store.set('view', 'compare'));
  cut.addEventListener('click', () => store.set('view', 'compare'));
  q('.d-fly').addEventListener('click', () => {
    const c = store.selected(); if (!c) return;
    const p = c.pos[Math.min(store.get('scan') || 1, c.pos.length) - 1];
    store.emit('flyto', { ra: p[0] * 15, dec: p[1], fov: 22, raHours: p[0] });
  });
  store.on('candidates', () => { renderList(); renderDetail(); });
  store.on('filter', renderList);
  store.on('selectedId', () => { renderList(); renderDetail(); });
  store.on('scan', renderDetail);
  renderList(); renderDetail();
}

/** Stand-in for field/index.js. */
export function mountFieldStub(el, store) {
  el.classList.add('view', 'stub-field');
  el.setAttribute('aria-label', 'Field analysis');
  el.innerHTML = `<div class="stub-field-box">
      <h2>Field analysis</h2>
      <p class="stub-field-pos"></p>
      <p>The field analysis module isn’t loaded in this build. When it is, this view aligns every epoch of the patch, subtracts them, and lists what moved, cross‑matched against known objects.</p>
      <button type="button" class="stub-back">← Back to sky</button>
    </div>`;
  const pos = el.querySelector('.stub-field-pos');
  const render = () => {
    const f = store.get('field');
    pos.textContent = f ? `Patch centred on RA ${fmtRA(f.ra / 15)}, Dec ${fmtDec(f.dec)} · ${Math.round(f.sizeArcsec / 60)}′ across` : 'No patch chosen yet.';
  };
  el.querySelector('.stub-back').addEventListener('click', () => store.set('view', 'sky'));
  store.on('field', render);
  store.on('view', v => { el.hidden = v !== 'field'; if (v === 'field') render(); });
  el.hidden = store.get('view') !== 'field'; render();
}
