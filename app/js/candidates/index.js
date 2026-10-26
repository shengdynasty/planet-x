// Candidate review panel ("Movers"). Mounts into the shell's #panel (a bottom sheet on phones).
// Talks only through `store`; writes screen-reader announcements into #announce.
//
// Store usage:
//   reads   candidates, selectedId, scan, scans, filter
//   writes  selectedId, filter, view ('compare' | 'field'), field
//   updates candidates via updateCandidate: status, reviewNote, pipelineStatus (the pre-review status, kept so a
//           reviewer can revert a Follow-up / Rejected back to what the pipeline said)
//   emits   'flyto' {ra (deg), dec (deg), fov, raHours}, 'toast' string
import * as F from './format.js';
import { renderCutout, seedIndex } from './cutout.js';
import * as persist from './persist.js';

const OVERFLOW = ['Likely', 'Follow-up', 'Rejected'];
const FIELD_ARCSEC = 1968; // 320 px × 6.15″

const html = String.raw;
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const TEMPLATE = html`
<div class="cx">
  <header class="cx-head">
    <h2 class="cx-title" id="cx-title">Movers <span class="cx-count"></span></h2>
    <div class="cx-menuwrap">
      <button class="cx-export ghost" aria-haspopup="menu" aria-expanded="false" aria-controls="cx-export-menu">Export</button>
      <div class="cx-menu glass" id="cx-export-menu" role="menu" aria-label="Export the listed movers" hidden>
        <button role="menuitem" data-x="download" data-fmt="csv">Download CSV</button>
        <button role="menuitem" data-x="download" data-fmt="json">Download JSON</button>
        <button role="menuitem" data-x="copy" data-fmt="csv">Copy CSV</button>
        <button role="menuitem" data-x="copy" data-fmt="json">Copy JSON</button>
      </div>
    </div>
      <div class="seg cx-filters" role="group" aria-label="Filter by status">
        <button data-f="all" aria-pressed="true">All</button>
        <button data-f="Candidate" aria-pressed="false">Unmatched</button>
        <button data-f="Matched" aria-pressed="false">Matched</button>
        <div class="cx-menuwrap">
          <button class="cx-more" aria-haspopup="menu" aria-expanded="false" aria-controls="cx-more-menu" aria-pressed="false"><span>More</span> <span aria-hidden="true">▾</span></button>
          <div class="cx-menu glass" id="cx-more-menu" role="menu" aria-label="More status filters" hidden>
            ${OVERFLOW.map(s => html`<button role="menuitemradio" aria-checked="false" data-f="${s}">${s}</button>`).join('')}
          </div>
        </div>
      </div>
      <select class="cx-fsel" aria-label="Filter by status">
        ${F.FILTERS.map(f => html`<option value="${f.id}">${f.label}</option>`).join('')}
      </select>
      <input type="text" class="cx-q" placeholder="Search movers" aria-label="Search movers" autocomplete="off" spellcheck="false" enterkeyhint="search">
      <select class="cx-sort" aria-label="Sort by">
        ${F.SORTS.map(s => html`<option value="${s.id}">Sort: ${s.label}</option>`).join('')}
      </select>
  </header>
  <ul class="cx-list" role="listbox" aria-labelledby="cx-title"></ul>
  <div class="cx-empty" hidden><span class="cx-empty-msg"></span> <button class="cx-clear ghost" hidden>Clear filters</button></div>
  <section class="cx-detail" aria-labelledby="cx-d-name" hidden>
    <div class="cx-dhead"><h3 id="cx-d-name"></h3><span class="cx-sim" hidden>Simulated</span></div>
    <div class="cx-tag"></div>
    <div class="cx-cutgrid">
      <figure class="cx-fig">
        <canvas class="cx-cut" width="256" height="256" role="img"></canvas>
        <figcaption class="cx-cutlabel"><span class="cx-cutscan"></span><span>60″ cutout</span></figcaption>
      </figure>
      <dl>
        <dt>Position</dt><dd class="cx-pos"></dd>
        <dt>Shift</dt><dd class="cx-shift"></dd>
        <dt>Peak band</dt><dd class="cx-band"></dd>
        <dt>Status</dt><dd class="cx-status"></dd>
      </dl>
    </div>
    <p class="cx-note"></p>
    <div class="cx-actions">
      <button class="cx-compare">Open in Compare</button>
      <button class="cx-field">Analyse field</button>
      <button class="cx-fly ghost">Center on sky</button>
    </div>
    <div class="cx-review">
      <div class="cx-rlabel" id="cx-rs-label">Review</div>
      <div class="seg cx-rstatus" role="group" aria-labelledby="cx-rs-label"></div>
      <label class="cx-rlabel" for="cx-rnote">Reviewer note</label>
      <textarea id="cx-rnote" class="cx-rnote" rows="3" placeholder="What you checked, what to look at next"></textarea>
      <div class="cx-saved" aria-live="polite"></div>
    </div>
  </section>
  <dialog class="cx-dialog" aria-labelledby="cx-dlg-title">
    <form method="dialog" class="cx-dlg-box">
      <h3 id="cx-dlg-title"></h3>
      <p class="cx-dlg-msg"></p>
      <textarea class="cx-dlg-text" readonly rows="10" aria-label="Export text" spellcheck="false"></textarea>
      <div class="cx-dlg-row"><span class="cx-dlg-status" aria-live="polite"></span>
        <button type="button" class="cx-dlg-copy">Copy</button><button value="close" class="ghost">Close</button></div>
    </form>
  </dialog>
</div>`;

export function mountCandidates(el, store) {
  el.innerHTML = TEMPLATE;
  const $ = sel => el.querySelector(sel);
  const root = $('.cx'), list = $('.cx-list'), detail = $('.cx-detail'), empty = $('.cx-empty');
  const count = $('.cx-count'), q = $('.cx-q'), sortSel = $('.cx-sort'), fsel = $('.cx-fsel');
  const moreBtn = $('.cx-more'), noteEl = $('.cx-rnote'), savedEl = $('.cx-saved');
  const cut = $('.cx-cut'), cg = cut.getContext('2d');
  const dlg = $('.cx-dialog');

  // ---------- helpers ----------
  const getFilter = () => ({ status: 'all', sort: 'id', query: '', ...(store.get('filter') || {}) });
  const cands = () => store.get('candidates') || [];
  const byId = id => cands().find(c => c.id === id) || null;
  const toast = msg => store.emit('toast', msg);
  let annT;
  function announce(msg) {
    const a = document.getElementById('announce'); if (!a) return;
    clearTimeout(annT); a.textContent = '';
    annT = setTimeout(() => { a.textContent = msg; }, 40);
  }
  const scanLabel = k => {
    const s = (store.get('scans') || []).find(x => x.id === k + 1);
    return s ? `${s.label} · ${s.date}` : `Scan ${k + 1}`;
  };
  const posAt = c => { const k = F.posIndex(c, store.get('scan')); return k < 0 ? null : c.pos[k]; };

  // ---------- persistence: restore saved review for every candidate the first time it appears ----------
  const seen = new Set();
  function restoreNew() {
    const fresh = cands().filter(c => !seen.has(c.id));
    if (!fresh.length) return false;
    fresh.forEach(c => seen.add(c.id));
    const saved = persist.loadAll(), patches = [];
    fresh.forEach(c => {
      const s = saved[c.id]; if (!s) return;
      const p = {};
      if (s.status && F.STATUSES.includes(s.status) && s.status !== c.status) {
        p.pipelineStatus = s.pipelineStatus || F.pipelineStatus(c);
        p.status = s.status;
      }
      if (typeof s.reviewNote === 'string' && s.reviewNote !== (c.reviewNote || '')) p.reviewNote = s.reviewNote;
      if (Object.keys(p).length) patches.push([c.id, p]);
    });
    patches.forEach(([id, p]) => store.updateCandidate(id, p));
    return patches.length > 0;
  }

  // ---------- list ----------
  let focusId = null; // option that holds the roving tabindex
  function optionLabel(c) {
    return `${c.name || c.id}, ${c.tag || ''}, status ${c.status}, peak ${c.band}${c.simulated ? ', simulated' : ''}`;
  }
  function renderList() {
    const all = cands(), f = getFilter(), vis = F.visible(all, f);
    const sel = store.get('selectedId');
    const hadFocus = list.contains(document.activeElement);
    count.textContent = vis.length === all.length ? String(all.length) : `${vis.length} of ${all.length}`;
    count.setAttribute('aria-label', vis.length === all.length ? `${all.length} total` : `${vis.length} shown of ${all.length}`);
    if (!vis.some(c => c.id === focusId)) focusId = vis.some(c => c.id === sel) ? sel : (vis[0] && vis[0].id) || null;
    list.replaceChildren(...vis.map(c => {
      const li = document.createElement('li');
      li.id = 'cx-opt-' + c.id; li.dataset.id = c.id;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(c.id === sel));
      li.setAttribute('aria-label', optionLabel(c));
      li.tabIndex = c.id === focusId ? 0 : -1;
      li.innerHTML = html`<span class="n">${esc(F.shortId(c))}</span><span class="cx-mid"><span class="cx-lab">${esc(F.shortTag(c))}</span><span class="cx-sub">${esc(c.band || '')}${c.simulated ? ' <span class="cx-sim">Simulated</span>' : ''}</span></span><span class="s">${esc(c.status)}</span>`;
      return li;
    }));
    list.hidden = !vis.length;
    empty.hidden = !!vis.length;
    const filtered = f.status !== 'all' || String(f.query || '').trim();
    $('.cx-empty-msg').textContent = !all.length ? 'No movers yet. They appear here as scans are compared.'
      : 'Nothing matches this filter.';
    $('.cx-clear').hidden = !(all.length && filtered);
    if (hadFocus) { const li = focusId && list.querySelector(`[data-id="${CSS.escape(focusId)}"]`); if (li) li.focus({ preventScroll: true }); }
    const sl = sel && list.querySelector(`[data-id="${CSS.escape(sel)}"]`);
    if (sl) sl.scrollIntoView({ block: 'nearest' });
  }
  function syncControls() {
    const f = getFilter();
    el.querySelectorAll('.cx-filters > button[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === f.status)));
    const over = OVERFLOW.includes(f.status);
    moreBtn.setAttribute('aria-pressed', String(over));
    moreBtn.firstElementChild.textContent = over ? f.status : 'More';
    el.querySelectorAll('#cx-more-menu [data-f]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.f === f.status)));
    fsel.value = F.FILTERS.some(x => x.id === f.status) ? f.status : 'all';
    sortSel.value = F.SORTS.some(x => x.id === f.sort) ? f.sort : 'id';
    if (document.activeElement !== q && q.value !== (f.query || '')) q.value = f.query || '';
  }
  const setStatusFilter = s => store.patch('filter', { status: s });

  function selectId(id, { fly = false } = {}) {
    focusId = id;
    if (store.get('selectedId') !== id) store.set('selectedId', id);
    if (fly) flyTo();
  }
  list.addEventListener('click', e => {
    const li = e.target.closest('[role="option"]'); if (!li) return;
    selectId(li.dataset.id, { fly: true });
  });
  list.addEventListener('keydown', e => {
    const opts = [...list.querySelectorAll('[role="option"]')]; if (!opts.length) return;
    const i = Math.max(0, opts.findIndex(o => o.dataset.id === focusId));
    let j = null;
    if (e.key === 'ArrowDown') j = Math.min(opts.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = opts.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectId(opts[i].dataset.id, { fly: true }); return; }
    else return;
    e.preventDefault();
    focusId = opts[j].dataset.id;
    opts.forEach(o => { o.tabIndex = o === opts[j] ? 0 : -1; });
    opts[j].focus();
    opts[j].scrollIntoView({ block: 'nearest' });
    selectId(focusId); // selection follows focus
  });

  // ---------- filters, search, sort ----------
  el.querySelectorAll('.cx-filters > button[data-f]').forEach(b => b.addEventListener('click', () => setStatusFilter(b.dataset.f)));
  fsel.addEventListener('change', () => setStatusFilter(fsel.value));
  sortSel.addEventListener('change', () => store.patch('filter', { sort: sortSel.value }));
  q.addEventListener('input', () => store.patch('filter', { query: q.value }));
  q.addEventListener('keydown', e => {
    if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; store.patch('filter', { query: '' }); }
    else if (e.key === 'ArrowDown' || e.key === 'Enter') { const li = list.querySelector('[tabindex="0"]'); if (li) { e.preventDefault(); li.focus(); } }
  });
  $('.cx-clear').addEventListener('click', () => { store.patch('filter', { status: 'all', query: '' }); q.focus(); });

  // ---------- menus (filter overflow, export) ----------
  let openMenu = null;
  function closeMenu(focusBtn) {
    if (!openMenu) return;
    const { btn, menu } = openMenu; menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); openMenu = null;
    if (focusBtn) btn.focus();
  }
  function wireMenu(btn, menu, onPick) {
    const items = () => [...menu.querySelectorAll('[role^="menuitem"]')];
    btn.addEventListener('click', () => {
      if (openMenu && openMenu.menu === menu) return closeMenu(false);
      closeMenu(false);
      menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); openMenu = { btn, menu };
      const it = items(); (it.find(x => x.getAttribute('aria-checked') === 'true') || it[0]).focus();
    });
    menu.addEventListener('keydown', e => {
      const it = items(), i = it.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') it[(i + 1) % it.length].focus();
      else if (e.key === 'ArrowUp') it[(i - 1 + it.length) % it.length].focus();
      else if (e.key === 'Home') it[0].focus();
      else if (e.key === 'End') it[it.length - 1].focus();
      else if (e.key === 'Escape') { e.stopPropagation(); closeMenu(true); }
      else if (e.key === 'Tab') closeMenu(false);
      else return;
      e.preventDefault?.();
    });
    menu.addEventListener('click', e => { const b = e.target.closest('[role^="menuitem"]'); if (!b) return; closeMenu(true); onPick(b); });
  }
  wireMenu(moreBtn, $('#cx-more-menu'), b => setStatusFilter(b.dataset.f));
  wireMenu($('.cx-export'), $('#cx-export-menu'), b => doExport(b.dataset.x, b.dataset.fmt));
  document.addEventListener('pointerdown', e => { if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.btn.contains(e.target)) closeMenu(false); });

  // ---------- detail ----------
  let shownId = null;
  function renderDetail() {
    const c = store.selected ? store.selected() : byId(store.get('selectedId'));
    root.classList.toggle('has-detail', !!c);
    if (!c) { detail.hidden = true; shownId = null; return; }
    detail.hidden = false;
    const isNew = shownId !== c.id; shownId = c.id;
    $('#cx-d-name').textContent = c.name || c.id;
    detail.querySelector('.cx-dhead .cx-sim').hidden = !c.simulated;
    $('.cx-tag').textContent = c.tag || '';
    $('.cx-shift').textContent = F.fmtShift(c);
    $('.cx-band').textContent = c.band || '—';
    const ps = F.pipelineStatus(c);
    $('.cx-status').textContent = c.status === ps ? c.status : `${c.status} (pipeline: ${ps})`;
    $('.cx-note').textContent = c.note || '';
    $('.cx-note').hidden = !c.note;
    drawCut(c);
    // review controls: the pipeline's own status, plus the two a reviewer can assign
    const opts = [...new Set([ps, ...F.USER_STATUSES])];
    const rs = $('.cx-rstatus');
    rs.replaceChildren(...opts.map(s => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.s = s; b.textContent = s;
      b.setAttribute('aria-pressed', String(c.status === s));
      if (s === ps && s !== 'Candidate') b.title = 'Set by the pipeline';
      return b;
    }));
    if (isNew || document.activeElement !== noteEl) {
      if (noteEl.value !== (c.reviewNote || '')) noteEl.value = c.reviewNote || '';
    }
    if (isNew) savedEl.textContent = persist.available() ? '' : storageMsg;
    [$('.cx-compare'), $('.cx-field'), $('.cx-fly')].forEach(b => { b.disabled = !c.pos || !c.pos.length; });
  }
  function drawCut(c) {
    const W = cut.width;
    const [x, y, , k] = renderCutout(cg, W, c, store.get('scan') || 1, seedIndex(c.id));
    cg.strokeStyle = 'rgba(255,255,255,.6)'; cg.lineWidth = 1; cg.beginPath(); cg.arc(x, y, 16, 0, Math.PI * 2); cg.stroke();
    const p = posAt(c);
    $('.cx-cutscan').textContent = scanLabel(k);
    $('.cx-pos').textContent = p ? `${F.fmtRA(p[0])}, ${F.fmtDec(p[1])}` : '—';
    cut.setAttribute('aria-label', `${c.simulated ? 'Simulated cutout' : 'Cutout'} of ${c.name || c.id}, ${scanLabel(k)}. Opens Compare.`);
  }
  cut.addEventListener('click', () => { if (shownId) store.set('view', 'compare'); });

  function flyTo() {
    const c = byId(store.get('selectedId')); const p = c && posAt(c); if (!p) return;
    store.emit('flyto', { ra: p[0] * 15, dec: p[1], fov: 22, raHours: p[0] });
  }
  $('.cx-fly').addEventListener('click', flyTo);
  $('.cx-compare').addEventListener('click', () => store.set('view', 'compare'));
  $('.cx-field').addEventListener('click', () => {
    const c = byId(store.get('selectedId')); const p = c && posAt(c); if (!p) return;
    store.set('field', { ra: p[0] * 15, dec: p[1], sizeArcsec: FIELD_ARCSEC });
    store.set('view', 'field');
  });

  // ---------- review: status + note ----------
  const storageMsg = 'Not saved: browser storage is unavailable here. Export to keep your review.';
  function saved(ok) { savedEl.textContent = ok ? 'Saved on this device' : storageMsg; }
  $('.cx-rstatus').addEventListener('click', e => {
    const b = e.target.closest('button[data-s]'); if (!b) return;
    const c = byId(shownId); if (!c || c.status === b.dataset.s) return;
    const ps = F.pipelineStatus(c), s = b.dataset.s;
    store.updateCandidate(c.id, { status: s, pipelineStatus: ps });
    saved(persist.save(c.id, { status: s, pipelineStatus: ps }));
    announce(`${c.name || c.id} marked ${s}.`);
    const nb = $(`.cx-rstatus button[data-s="${CSS.escape(s)}"]`); if (nb) nb.focus();
  });
  let noteT = null, notePending = null;
  function commitNote() {
    clearTimeout(noteT); noteT = null;
    if (!notePending) return;
    const { id, value } = notePending; notePending = null;
    const c = byId(id); if (!c || (c.reviewNote || '') === value) return;
    store.updateCandidate(id, { reviewNote: value });
    saved(persist.save(id, { reviewNote: value }));
  }
  noteEl.addEventListener('input', () => {
    notePending = { id: shownId, value: noteEl.value };
    savedEl.textContent = '';
    clearTimeout(noteT); noteT = setTimeout(commitNote, 500);
  });
  noteEl.addEventListener('blur', commitNote);
  window.addEventListener('pagehide', commitNote);

  // ---------- export ----------
  function exportText(fmt) {
    const f = getFilter(), vis = F.visible(cands(), f);
    const text = fmt === 'csv' ? F.toCSV(vis) : F.toJSON(vis, {
      exported: new Date().toISOString(), filter: { status: f.status, sort: f.sort, query: f.query || '' },
      note: vis.some(c => c.simulated) ? 'Contains simulated placeholder data.' : undefined,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return { text, n: vis.length, name: `planetx-movers-${stamp}.${fmt}`, mime: fmt === 'csv' ? 'text/csv' : 'application/json' };
  }
  function framed() { try { return window.top !== window.self; } catch { return true; } }
  function tryDownload(text, name, mime) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = name; a.hidden = true;
      el.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch { return false; }
  }
  async function tryCopy(text) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
      await navigator.clipboard.writeText(text); return true;
    } catch { return false; }
  }
  async function doExport(kind, fmt) {
    const { text, n, name, mime } = exportText(fmt), F_ = fmt.toUpperCase(), what = `${n} mover${n === 1 ? '' : 's'}`;
    if (kind === 'download') {
      const ok = tryDownload(text, name, mime);
      // A sandboxed frame (e.g. a hosted artifact) blocks downloads without telling the page, so when framed we can't
      // confirm it worked: offer the text as well.
      if (!ok) openDialog(`Export ${F_}`, 'The download could not start. Copy the text below instead.', text);
      else if (framed()) openDialog(`Export ${F_}`, 'If no download started (this page may be embedded where downloads are blocked), copy the text below.', text);
      else { toast(`Downloaded ${name}`); announce(`Downloaded ${what} as ${F_}.`); }
    } else {
      if (await tryCopy(text)) { toast(`Copied ${what} as ${F_}`); announce(`Copied ${what} as ${F_}.`); }
      else openDialog(`Export ${F_}`, 'The clipboard is not available here. Select the text below and copy it.', text);
    }
  }
  const dlgText = $('.cx-dlg-text'), dlgStatus = $('.cx-dlg-status');
  function openDialog(title, msg, text) {
    $('#cx-dlg-title').textContent = title; $('.cx-dlg-msg').textContent = msg;
    dlgText.value = text; dlgStatus.textContent = '';
    try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    dlgText.focus(); dlgText.select(); dlgText.scrollTop = 0;
  }
  $('.cx-dlg-copy').addEventListener('click', async () => {
    let ok = await tryCopy(dlgText.value);
    if (!ok) { dlgText.focus(); dlgText.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } }
    dlgStatus.textContent = ok ? 'Copied' : 'Text selected: press Ctrl+C or ⌘C';
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  // ---------- store wiring ----------
  let lastSel = store.get('selectedId');
  store.on('candidates', () => { if (restoreNew()) return; renderList(); renderDetail(); });
  store.on('filter', () => { syncControls(); renderList(); });
  store.on('selectedId', id => {
    if (notePending && notePending.id !== id) commitNote();
    if (id !== lastSel) {
      lastSel = id;
      const c = byId(id);
      if (c) announce(`${c.name || c.id} selected. ${c.status}${c.simulated ? ', simulated' : ''}.`);
    }
    if (id && byId(id)) focusId = id;
    renderList(); renderDetail();
  });
  store.on('scan', () => { if (shownId) { const c = byId(shownId); if (c) drawCut(c); } });
  store.on('scans', () => { if (shownId) { const c = byId(shownId); if (c) drawCut(c); } });

  restoreNew();
  syncControls(); renderList(); renderDetail();
  return { el: root };
}
