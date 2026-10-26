// Compare view: two scans of the selected candidate side by side with a wipe, a difference image, or blink.
//   reads  view, selectedId (via selected()), candidates, scans, scan
//   writes view ('sky' on back)
import { renderCutout } from './cutout.js';
import { shiftText, fmtRA, fmtDec } from '../sky/coords.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function mountCompare(el, store) {
  el.setAttribute('aria-label', 'Compare scans');
  el.classList.add('view');
  el.innerHTML = `
    <div class="cmp-top">
      <button class="ghost cmp-back" type="button" aria-label="Back to sky">← Sky</button>
      <h2 class="cmp-name">Compare</h2><span class="sub cmp-tag"></span>
      <span class="cmp-flex"></span>
      <button class="cmp-blink" type="button" aria-pressed="false">Blink</button>
    </div>
    <div class="cmp-body">
      <div class="cmp-view">
        <div class="cmp-wrap" role="slider" tabindex="0" aria-label="Wipe position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
          <canvas class="cmp-a" width="512" height="512" aria-hidden="true"></canvas>
          <canvas class="cmp-b" width="512" height="512" aria-hidden="true"></canvas>
          <div class="cmp-wipe"></div>
          <div class="corner l cmp-la"></div><div class="corner r cmp-lb"></div>
        </div>
        <div class="cmp-empty" hidden>
          <p>Pick a mover on the sky or in the list, then open Compare.</p>
          <button type="button" class="cmp-back2">Back to sky</button>
        </div>
      </div>
      <aside class="cmp-side">
        <div class="fieldset"><h3 id="cmp-h-a">Left</h3><div class="seg cmp-seg-a" role="group" aria-labelledby="cmp-h-a"></div></div>
        <div class="fieldset"><h3 id="cmp-h-b">Right</h3><div class="seg cmp-seg-b" role="group" aria-labelledby="cmp-h-b"></div></div>
        <div class="fieldset"><h3 id="cmp-h-ov">Overlay</h3>
          <div class="seg cmp-seg-ov" role="group" aria-labelledby="cmp-h-ov"><button type="button" data-ov="wipe" aria-pressed="true">Wipe</button><button type="button" data-ov="diff" aria-pressed="false">Difference</button></div>
        </div>
        <div><h3>Candidate</h3><dl class="cmp-dl"></dl></div>
        <p class="cmp-note"></p>
        <p>Drag across the image (or use ← →) to move the wipe. Difference subtracts the left scan from the right; anything that moved shows twice.</p>
        <p class="cmp-honest">Cutout pixels here are simulated for illustration. Field analysis works on the image data.</p>
      </aside>
    </div>`;
  const q = s => el.querySelector(s);
  const ca = q('.cmp-a'), cb = q('.cmp-b'), cga = ca.getContext('2d'), cgb = cb.getContext('2d', { willReadFrequently: true });
  const wrap = q('.cmp-wrap'), wipe = q('.cmp-wipe'), blinkBtn = q('.cmp-blink'), empty = q('.cmp-empty');
  let cmpA = 1, cmpB = 2, overlay = 'wipe', blinkTimer = null, wipeX = 0.5, lastSel = null, diffCache = null;

  const scans = () => (store.get('scans') || []).filter(s => s.has);
  const scanLabel = id => { const s = (store.get('scans') || []).find(x => x.id === id); return s ? `${s.label} · ${s.date}` : `Scan ${id}`; };
  function pickDefaults() {
    const ids = scans().map(s => s.id), cur = store.get('scan') || 1;
    if (!ids.includes(cmpA)) cmpA = ids[0] || 1;
    if (!ids.includes(cmpB)) cmpB = ids[1] || ids[0] || 1;
    // default: the current scan against the one before it (or the next one)
    if (ids.length > 1) { const i = Math.max(0, ids.indexOf(cur)); cmpB = ids[i > 0 ? i : 1]; cmpA = ids[i > 0 ? i - 1 : 0]; }
  }
  function buildSeg(seg, get, setv) {
    seg.innerHTML = '';
    scans().forEach(s => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = s.label;
      b.setAttribute('aria-pressed', String(get() === s.id)); b.setAttribute('aria-label', `${s.label}, ${s.date}`);
      b.addEventListener('click', () => { setv(s.id); buildSegs(); draw(); });
      seg.appendChild(b);
    });
  }
  function buildSegs() { buildSeg(q('.cmp-seg-a'), () => cmpA, v => cmpA = v); buildSeg(q('.cmp-seg-b'), () => cmpB, v => cmpB = v); }

  function applyWipe() {
    if (blinkTimer) return;
    if (overlay === 'diff') { cb.style.clipPath = 'none'; wipe.hidden = true; }
    else { cb.style.clipPath = `inset(0 0 0 ${wipeX * 100}%)`; wipe.hidden = false; wipe.style.left = `${wipeX * 100}%`; }
    wrap.setAttribute('aria-valuenow', String(Math.round(wipeX * 100)));
  }
  function draw() {
    const c = store.selected();
    empty.hidden = !!c; wrap.hidden = !c; q('.cmp-side').hidden = !c; blinkBtn.disabled = !c;
    if (!c) { q('.cmp-name').textContent = 'Compare'; q('.cmp-tag').textContent = ''; return; }
    const W = ca.width;
    renderCutout(cga, W, c, cmpA);
    if (overlay === 'diff') {
      const key = `${c.id}|${cmpA}|${cmpB}|${c.status}|${JSON.stringify(c.pos)}`;
      if (!diffCache || diffCache.key !== key) {
        renderCutout(cgb, W, c, cmpB);
        const A = cga.getImageData(0, 0, W, W), B = cgb.getImageData(0, 0, W, W);
        for (let i = 0; i < A.data.length; i += 4) { const d = B.data[i] - A.data[i]; const v = 128 + d * 0.9; B.data[i] = B.data[i + 1] = B.data[i + 2] = Math.max(0, Math.min(255, v)); }
        diffCache = { key, img: B };
      }
      cgb.putImageData(diffCache.img, 0, 0);
    } else renderCutout(cgb, W, c, cmpB);
    applyWipe();
    q('.cmp-la').textContent = scanLabel(cmpA);
    q('.cmp-lb').textContent = overlay === 'diff' ? 'Difference' : scanLabel(cmpB);
    q('.cmp-name').textContent = c.name; q('.cmp-tag').textContent = c.tag || '';
    q('.cmp-note').textContent = c.note || '';
    const p = c.pos[Math.min(cmpB, c.pos.length) - 1];
    q('.cmp-dl').innerHTML = `<dt>Position</dt><dd>${esc(fmtRA(p[0]))}, ${esc(fmtDec(p[1]))}</dd><dt>Shift</dt><dd>${esc(shiftText(c.pos))}</dd>`
      + `<dt>Peak band</dt><dd>${esc(c.band || '—')}</dd><dt>Status</dt><dd>${esc(c.status)}</dd>`
      + (c.match ? `<dt>Match</dt><dd>${esc(c.match)}</dd>` : '');
    wrap.setAttribute('aria-label', `Wipe between ${scanLabel(cmpA)} and ${scanLabel(cmpB)} for ${c.name}`);
  }

  el.querySelectorAll('.cmp-seg-ov button').forEach(b => b.addEventListener('click', () => {
    stopBlink(); overlay = b.dataset.ov; el.querySelectorAll('.cmp-seg-ov button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw();
  }));
  let wiping = false;
  const setWipe = e => { const r = wrap.getBoundingClientRect(); wipeX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); applyWipe(); };
  wrap.addEventListener('pointerdown', e => { stopBlink(); wiping = true; try { wrap.setPointerCapture(e.pointerId); } catch (_) {} setWipe(e); });
  wrap.addEventListener('pointermove', e => wiping && setWipe(e));
  wrap.addEventListener('pointerup', () => { wiping = false; }); wrap.addEventListener('pointercancel', () => { wiping = false; });
  wrap.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') wipeX = Math.max(0, wipeX - step); else if (e.key === 'ArrowRight') wipeX = Math.min(1, wipeX + step);
    else if (e.key === 'Home') wipeX = 0; else if (e.key === 'End') wipeX = 1; else return;
    e.preventDefault(); e.stopPropagation(); stopBlink(); applyWipe();
  });

  function stopBlink() { if (!blinkTimer) return; clearInterval(blinkTimer); blinkTimer = null; blinkBtn.setAttribute('aria-pressed', 'false'); applyWipe(); }
  function startBlink() {
    if (!store.selected()) return;
    blinkBtn.setAttribute('aria-pressed', 'true'); let on = false; wipe.hidden = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    blinkTimer = setInterval(() => { on = !on; cb.style.clipPath = `inset(0 0 0 ${on ? 0 : 100}%)`; }, reduce ? 1200 : 500);
  }
  blinkBtn.addEventListener('click', () => (blinkTimer ? stopBlink() : startBlink()));
  const back = () => store.set('view', 'sky');
  q('.cmp-back').addEventListener('click', back); q('.cmp-back2').addEventListener('click', back);

  window.addEventListener('keydown', e => {
    if (store.get('view') !== 'compare' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (t && t.closest && t.closest('[role="dialog"]')) return;
    if (e.key === 'b' || e.key === 'B') { blinkBtn.click(); e.preventDefault(); }
  });

  // focus moves to "← Sky" when Compare opens and goes back to where it was when it closes
  let returnFocus = null, shown = false;
  function show(v) {
    const on = v === 'compare';
    el.hidden = !on;
    if (on) {
      const sel = store.get('selectedId');
      if (sel !== lastSel) { pickDefaults(); lastSel = sel; }
      buildSegs(); draw();
      if (!shown) { returnFocus = document.activeElement; q('.cmp-back').focus({ preventScroll: true }); }
    } else {
      stopBlink();
      if (shown && el.contains(document.activeElement) || shown && document.activeElement === document.body) {
        const r = returnFocus;
        // defer: the view we return to updates its own inert state in the same 'view' change
        setTimeout(() => { if (r && document.contains(r) && !r.closest('[inert]') && r.getClientRects().length) r.focus({ preventScroll: true }); }, 0);
      }
    }
    shown = on;
  }
  store.on('view', show);
  store.on('selectedId', () => { if (store.get('view') === 'compare') { stopBlink(); pickDefaults(); lastSel = store.get('selectedId'); buildSegs(); draw(); } });
  store.on('candidates', () => { if (store.get('view') === 'compare') draw(); });
  store.on('scans', () => { if (store.get('view') === 'compare') { pickDefaults(); buildSegs(); draw(); } });
  show(store.get('view'));
  return { draw };
}
