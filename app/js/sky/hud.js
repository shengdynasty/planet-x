// The HUD around the sky (shell): top bar (views, go-to, source badge, readout, layers, help, mobile toggle),
// timeline + blink, zoom controls, help sheet, toast, live-region announcements and global shortcuts.
import { parseGoto, fmtRA, fmtDec, pad2 } from './coords.js';
import { VIEW } from './config.js';

const $ = id => document.getElementById(id);
const narrow = () => window.matchMedia('(max-width: 860px)').matches;
const isTyping = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const FIELD_SIZE_ARCSEC = 600;

export function mountHud(store) {
  let sky = null;                                 // attached after mountSky
  const announceEl = $('announce');
  let announceT;
  function announce(msg) {
    if (!announceEl || !msg) return;
    announceEl.textContent = '';
    clearTimeout(announceT); announceT = setTimeout(() => { announceEl.textContent = msg; }, 60);
  }
  const toastEl = $('toast'); let toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
    announce(msg);
  }
  store.listen('toast', toast);
  store.listen('announce', announce);

  // --- top-bar height → CSS var, so full-screen views and the panel sit below it at any width ---
  const top = $('top');
  const bottom = $('bottom');
  const setTopH = () => {
    const rs = document.documentElement.style;
    rs.setProperty('--top-h', `${Math.ceil(top.getBoundingClientRect().bottom)}px`);
    if (bottom) rs.setProperty('--bottom-h', `${Math.ceil(bottom.getBoundingClientRect().height)}px`);
  };
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(setTopH); ro.observe(top); if (bottom) ro.observe(bottom); }
  window.addEventListener('resize', setTopH); setTopH();

  // --- views ---
  const candLabel = c => c ? c.name : '';
  function setView(v) {
    if (v === 'compare' && !store.selected()) { toast('Pick a mover first'); return false; }
    if (v === 'field' && !store.get('field')) {
      const c = store.selected();
      let raH, decD;
      if (c && c.pos && c.pos.length) { const p = c.pos[Math.min(store.get('scan') || 1, c.pos.length) - 1]; [raH, decD] = p; }
      else if (sky) ({ raH, decD } = sky.centre());
      else ({ raH, decD } = VIEW.home);
      store.set('field', { ra: raH * 15, dec: decD, sizeArcsec: FIELD_SIZE_ARCSEC });
    }
    store.set('view', v);
    return true;
  }
  const viewBtns = [...document.querySelectorAll('#views button')];
  viewBtns.forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  const VIEW_NAMES = { sky: 'Sky', compare: 'Compare', field: 'Field analysis' };
  store.on('view', (v, prev) => {
    viewBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    document.body.dataset.view = v;
    if (v !== 'sky') { stopBlink(); closePanel(); }
    syncInert();
    if (prev && prev !== v) announce(`${VIEW_NAMES[v] || v} view`);
    setTopH();
  });

  // --- source badge (always visible; honesty rule) ---
  const badge = $('source-badge'), badgeText = $('source-text');
  function renderSource(src) {
    src = src || { mode: 'sim', live: false };
    const live = src.mode === 'live' && src.live !== false;
    badge.dataset.mode = live ? 'live' : 'sim';
    badgeText.textContent = live ? 'Live · SPHEREx' : 'Simulated data';
    const note = src.note && src.note !== badgeText.textContent ? `${badgeText.textContent}. ${src.note}` : badgeText.textContent;
    badge.title = note; badge.setAttribute('aria-label', `Data source: ${note}`);
  }
  store.on('source', (s, prev) => { renderSource(s); if (prev && prev.mode !== s.mode) announce(`Data source: ${badgeText.textContent}`); });
  renderSource(store.get('source'));

  // --- readout ---
  const raEl = $('ra'), decEl = $('dec');
  let lastRead = '';
  function readout({ raH, decD }) {
    const r = 'RA ' + fmtRA(raH), d = 'Dec ' + fmtDec(decD);
    if (r + d === lastRead) return; lastRead = r + d;
    raEl.textContent = r; decEl.textContent = d;
  }

  // --- layers ---
  const gridBtn = $('grid'), trBtn = $('tracks');
  const toggleLayer = k => store.patch('layers', { [k]: !store.get('layers')[k] });
  gridBtn.addEventListener('click', () => toggleLayer('grid'));
  trBtn.addEventListener('click', () => toggleLayer('tracks'));
  function renderLayers(l) { gridBtn.setAttribute('aria-pressed', String(!!l.grid)); trBtn.setAttribute('aria-pressed', String(!!l.tracks)); }
  store.on('layers', renderLayers); renderLayers(store.get('layers'));

  // --- timeline + blink ---
  const scansEl = $('scans'), blinkBtn = $('blink');
  let blinkTimer = null;
  function buildTimeline() {
    scansEl.querySelectorAll('.scan').forEach(b => b.remove());
    const scans = store.get('scans') || [], n = scans.length;
    scans.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scan' + (s.has ? ' has' : ' pending') + (i === 0 ? ' first' : '') + (i === n - 1 && n > 1 ? ' last' : '');
      b.dataset.id = s.id;
      if (i === 0) b.style.left = '0';
      else if (i === n - 1) b.style.right = '0';
      else b.style.left = `calc(7.5px + ${i / (n - 1)} * (100% - 15px))`;
      b.innerHTML = `<i aria-hidden="true"></i><small>${s.label} · ${s.date}</small>`;
      b.setAttribute('aria-label', `${s.label}, ${s.date}${s.has ? '' : ', scheduled, no data yet'}`);
      b.setAttribute('aria-pressed', String(s.id === store.get('scan')));
      if (s.has) b.addEventListener('click', () => { stopBlink(); store.set('scan', s.id); });
      else { b.disabled = true; b.title = 'Scheduled'; }
      scansEl.appendChild(b);
    });
    blinkBtn.disabled = scans.filter(s => s.has).length < 2;
  }
  store.on('scans', buildTimeline);
  store.on('scan', id => scansEl.querySelectorAll('.scan').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.id === id))));
  function stopBlink() { if (!blinkTimer) return; clearInterval(blinkTimer); blinkTimer = null; blinkBtn.setAttribute('aria-pressed', 'false'); }
  function startBlink() {
    const avail = (store.get('scans') || []).filter(s => s.has).map(s => s.id);
    if (avail.length < 2) return;
    blinkBtn.setAttribute('aria-pressed', 'true');
    let k = Math.max(0, avail.indexOf(store.get('scan')));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    blinkTimer = setInterval(() => { k = (k + 1) % avail.length; store.set('scan', avail[k]); }, reduce ? 1200 : 600);
  }
  blinkBtn.addEventListener('click', () => (blinkTimer ? stopBlink() : startBlink()));
  buildTimeline();

  // --- zoom controls ---
  $('zin').addEventListener('click', () => sky && sky.zoom(0.75));
  $('zout').addEventListener('click', () => sky && sky.zoom(1.33));
  $('reset').addEventListener('click', () => sky && sky.reset());

  // --- flying: 'flyto' carries degrees (core/store.js contract) ---
  const flyToCand = c => {
    const p = c.pos[Math.min(store.get('scan') || 1, c.pos.length) - 1];
    store.emit('flyto', { ra: p[0] * 15, dec: p[1], fov: VIEW.flyFov, raHours: p[0] });
  };
  // a marker picked on the sky (the panel itself flies on list clicks; sky picks don't move the camera)
  function picked(id) {
    const c = store.selected();
    if (c && c.id === id) announce(`${c.name} selected. ${c.tag || ''}`);
    if (narrow()) openPanel();
  }

  // --- go-to ---
  const gotoForm = $('goto'), gotoIn = $('goto-in');
  const candByNumber = n => {
    const list = store.get('candidates') || [];
    return list.find(c => { const m = /(\d+)\s*$/.exec(c.name || c.id || ''); return m && +m[1] === n; }) || list[n - 1] || null;
  };
  gotoForm.addEventListener('submit', e => {
    e.preventDefault();
    const r = parseGoto(gotoIn.value);
    if (r && r.kind === 'candidate') {
      const c = candByNumber(r.n);
      if (c) {
        if (store.get('view') !== 'sky') store.set('view', 'sky');
        const f = store.get('filter') || {};
        if ((f.status && f.status !== 'all' && f.status !== c.status) || f.query) store.patch('filter', { status: 'all', query: '' });
        store.set('selectedId', c.id); flyToCand(c);
        gotoIn.value = ''; return;
      }
      toast(`No candidate ${pad2(r.n)}`); return;
    }
    if (r && r.kind === 'pos') {
      if (store.get('view') !== 'sky') store.set('view', 'sky');
      store.emit('flyto', { ra: r.raH * 15, dec: r.decD, fov: VIEW.gotoFov, raHours: r.raH });
      announce(`Centred on RA ${fmtRA(r.raH)}, Dec ${fmtDec(r.decD)}`);
      gotoIn.value = ''; return;
    }
    toast('Try “16h06m, +41” or “candidate 3”');
  });

  // --- help sheet: focus moves in, is trapped, and returns on close ---
  const sheet = $('sheet'), sheetBox = sheet.querySelector('.box'), helpBtn = $('help');
  let sheetReturn = null;
  const focusables = () => [...sheet.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
  function openSheet() {
    if (!sheet.hidden) return;
    sheetReturn = document.activeElement;
    sheet.hidden = false; sheet.classList.add('show');
    syncInert();
    $('sheet-close').focus();
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true; sheet.classList.remove('show');
    syncInert();
    if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus(); else helpBtn.focus();
  }
  helpBtn.addEventListener('click', openSheet);
  $('sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('keydown', e => {
    e.stopPropagation(); // no view shortcut fires while the sheet is open
    if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(); if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetBox)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  sheet.addEventListener('focusout', e => { if (!sheet.hidden && e.relatedTarget && !sheet.contains(e.relatedTarget)) $('sheet-close').focus(); });

  // --- mobile bottom sheet for the panel ---
  const mt = $('mobile-toggle'), panel = $('panel');
  function openPanel() { panel.classList.add('open'); mt.setAttribute('aria-expanded', 'true'); mt.setAttribute('aria-pressed', 'true'); syncInert(); }
  function closePanel() { panel.classList.remove('open'); mt.setAttribute('aria-expanded', 'false'); mt.setAttribute('aria-pressed', 'false'); syncInert(); }

  // What can take focus / is in the accessibility tree: everything behind the help sheet is inert; the sky HUD is
  // inert while another view covers it; on phones the closed bottom sheet is inert, not just moved off-screen.
  function syncInert() {
    document.body.classList.toggle('panel-open', panel.classList.contains('open'));
    const sheetOpen = !sheet.hidden, offSky = store.get('view') !== 'sky';
    const set = (id, v) => { const el = $(id); if (el) el.inert = v; };
    set('top', sheetOpen); set('toast', sheetOpen);
    set('view-compare', sheetOpen); set('view-field', sheetOpen);
    set('stage', sheetOpen || offSky); set('bottom', sheetOpen || offSky);
    set('panel', sheetOpen || offSky || (narrow() && !panel.classList.contains('open')));
  }
  window.matchMedia('(max-width: 860px)').addEventListener('change', syncInert);
  syncInert();
  mt.addEventListener('click', () => (panel.classList.contains('open') ? closePanel() : (openPanel(), store.get('view') !== 'sky' && store.set('view', 'sky'))));

  // --- global shortcuts ---
  // Sky keys act only in 'sky', a few view keys also in 'compare' (Compare handles its own B).
  // Nothing here acts in 'field': the Field view owns the keyboard there (B/D/T, F/K, Space, N/P, 1–8, A, S, Esc).
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (!sheet.hidden) return; // the sheet handles (and stops) its own keys
    const k = e.key, view = store.get('view');
    if (view === 'field') return;
    if (k === 'Escape') {
      if (isTyping(e.target)) { e.target.blur(); return; }
      if (panel.classList.contains('open') && narrow()) { closePanel(); mt.focus(); return; }
      if (view === 'compare') store.set('view', 'sky');
      return;
    }
    if (isTyping(e.target)) return;
    if (view === 'sky' && /^[1-9]$/.test(k)) {
      const sc = (store.get('scans') || [])[+k - 1];
      if (sc && sc.has) { stopBlink(); store.set('scan', sc.id); } else if (sc) toast(`${sc.label} is scheduled for ${sc.date}`);
    }
    else if (view === 'sky' && (k === 'b' || k === 'B')) blinkBtn.click();
    else if (k === 'c' || k === 'C') setView(view === 'compare' ? 'sky' : 'compare');
    else if (k === 'f' || k === 'F') setView('field');
    else if (view === 'compare' && (k === 's' || k === 'S')) setView('sky');
    else if (view === 'sky' && (k === 'g' || k === 'G')) toggleLayer('grid');
    else if (view === 'sky' && (k === 't' || k === 'T')) toggleLayer('tracks');
    else if (k === '?') openSheet();
    else if (view === 'sky' && k === '/') { if (getComputedStyle(gotoForm).display !== 'none') gotoIn.focus(); else return; }
    else return;
    e.preventDefault();
  });

  return {
    readout, picked, toast, announce, setView,
    attachSky(s) { sky = s; },
  };
}
