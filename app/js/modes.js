// Simple / Advanced mode.
// Advanced is the app as it always was. Simple keeps every view but hides the controls only an astronomer needs
// (coordinates, grid, tracks, spectra, key lists) and rewrites the jargon on screen into plain words.
// The rewriting is a presentation layer: it walks the page's text, swaps known phrases for plain ones, and puts the
// original back when you switch to Advanced, so the modules that own the UI never know. Remember the choice in
// localStorage (Advanced until a choice is made); ?mode=simple or ?mode=advanced overrides it for a shared link.

import { MARK } from './field/render.js';

const KEY = 'planetx.mode';
// labels the Close-up view draws on the picture itself (canvas text, so the text sweep cannot reach them)
const MARK_PLAIN = { cand: 'Possible new object', known: 'Known', var: 'Changed brightness', art: 'Camera glitch', left: 'Moved out of view' };
const MARK_ORIG = Object.fromEntries(Object.keys(MARK_PLAIN).map(k => [k, MARK[k] && MARK[k].label]));

// exact phrase (after trimming) -> plain phrase
export const EXACT = {
  // top bar
  'Compare': 'Compare',
  'Field': 'Close-up',
  'Moving Sky demo': 'Watch a demo',
  'Simulated data': 'Practice data',
  'Saved SPHEREx data': 'Real telescope photos',
  'Live · SPHEREx': 'Live telescope photos',
  'About and shortcuts': 'Help',
  'Movers panel': 'List of things that moved',
  'Blink': 'Flip',
  // movers list
  'Movers': 'Things that moved',
  'Export': 'Save list',
  'Unmatched': 'New',
  'Matched': 'Known',
  'Likely': 'Probably known',
  'Sort: Id': 'Sort: Name',
  'Sort: Shift': 'Sort: Movement',
  'Sort: Band': 'Sort: Colour',
  'Sort: Status': 'Sort: Type',
  'Search movers': 'Search the list',
  'Known small body': 'Known asteroid or comet',
  'Known high-proper-motion star': 'Known fast-moving star',
  'Candidate': 'Possible new object',
  'Analyse field': 'Close-up',
  'Center': 'Go there',
  'Open Field on the home patch': 'Open a close-up',
  'Clear filters': 'Clear filters',
  'Simulated': 'Practice',
  'Download CSV': 'Save as spreadsheet (CSV)',
  'Download JSON': 'Save as data file (JSON)',
  'Copy CSV': 'Copy as spreadsheet text',
  'Copy JSON': 'Copy as data text',
  'Export text': 'List as text',
  'Center the sky on this mover': 'Look at this one in the sky',
  // compare
  '← Sky': '← Back to the sky',
  'Left': 'Left picture',
  'Right': 'Right picture',
  'Overlay': 'How to compare',
  'Wipe': 'Slide',
  'Difference': 'What changed',
  'Position': 'Where',
  'Shift': 'How far it moved',
  'Peak band': 'Brightest colour',
  'Status': 'Type',
  'Match': 'Known as',
  'Wipe position': 'Slider position',
  'Compare scans': 'Compare two pictures',
  'Illustrative cutout (simulated pixels)': 'Example picture (not real pixels)',
  'Cutout pixels here are simulated for illustration. Field analysis works on the image data.': 'The picture here is a drawing to show the idea. The Close-up view uses the real image data.',
  // close-up (field)
  'Field analysis': 'Close-up',
  'Observations of this field': 'Pictures of this patch',
  'Reference pass': 'First picture',
  'Compare with': 'Second picture',
  'Track': 'Path',
  'Stack': 'Add together',
  'Play': 'Play',
  'Flags': 'Possible movers',
  'Known objects': 'Known objects',
  'Stretch': 'Brightness',
  'Saved SPHEREx fields': 'Example places',
  'Examples': 'Examples',
  'Choose a target…': 'Choose a place…',
  'Flagged sources': 'Worth a look',
  'Variable': 'Changed brightness',
  'Variable:': 'Changed brightness:',
  'Candidate:': 'Possible new object:',
  'Left the field': 'Moved out of view',
  'Left the field:': 'Moved out of view:',
  'Uncatalogued mover': 'Mover nobody has listed',
  'Brightness change, fixed position': 'Got brighter or dimmer, did not move',
  'Hover or tap the image to read coordinates and surface brightness': 'Hover over the picture to see details',
  'Reference cutout': 'First picture',
  'Comparison cutout': 'Second picture',
  'Example targets': 'Example places',
  'Close': 'Close',
};

// regular expressions for phrases with numbers in them
export const RX = [
  [/^\d+(\.\d+)? µm$/, ''],                                  // wavelength lines: "0.95 µm"
  [/^Pass (\d+)$/, 'Picture $1'],
  [/^Scan (\d+)( · .*)?$/, 'Picture $1$2'],
  [/^Flagged sources \((\d+)\)$/, 'Worth a look ($1)'],
  [/^RA .* · ([\d.]+)′ × [\d.]+′$/, 'A small patch of sky, about $1 arcminutes across'],
  [/^Baseline (\d+) d · .*$/, 'The two pictures were taken $1 days apart'],
  [/^(\d+)″ in (\d+) d = .*$/, 'Moved $1 arcseconds in $2 days.'],
  [/^Compare · Pass (\d+)$/, 'Comparing with picture $1'],
  [/^Known objects?\b.*$/, null],
  [/^JPL predicts this catalogued object inside the \S+ field \(V≈[\d.]+\)\. This is an ephemeris prediction, not a confirmed pixel detection\.$/,
    'NASA’s tables say this known object is in this patch. That is a prediction, not something we saw in the picture.'],
  [/^Simulated field · No saved SPHEREx data for this patch; showing simulated data.*$/, 'Practice picture: we have no saved telescope photos for this patch.'],
  [/^Saved data covers these 6 targets\..*$/, 'Real photos are saved for these 6 places only.'],
  [/^Simulated star field and planted movers\. Nothing here is a real detection\.$/, 'A practice picture with made-up movers. Nothing here is a real find.'],
];

// attribute text that gets the same treatment
const ATTRS = ['aria-label', 'title', 'placeholder'];

function plain(text) {
  const t = text.trim(); if (!t) return null;
  if (Object.prototype.hasOwnProperty.call(EXACT, t)) return text.replace(t, EXACT[t]);
  for (const [re, rep] of RX) { if (re.test(t)) return rep === null ? null : text.replace(t, t.replace(re, rep)); } // null: leave it as it is
  return null;
}
export const simplify = plain;

export function mountModes(store) {
  const root = document.body;
  const orig = new WeakMap();       // node -> { value, shown } for text nodes
  const origAttr = new WeakMap();   // element -> { attr: { value, shown } }
  let mode = 'advanced', obs = null, queued = false;

  function applyText(node) {
    const rec = orig.get(node);
    if (rec && node.nodeValue !== rec.shown) orig.delete(node); // the owning module wrote new text: start again from it
    const cur = node.nodeValue, p = plain(cur);
    if (p !== null && p !== cur) { orig.set(node, { value: cur, shown: p }); node.nodeValue = p; }
  }
  function applyAttrs(el) {
    for (const a of ATTRS) {
      const cur = el.getAttribute(a); if (cur === null) continue;
      const rec = origAttr.get(el) && origAttr.get(el)[a];
      if (rec && cur !== rec.shown) delete origAttr.get(el)[a];
      const p = plain(cur);
      if (p !== null && p !== cur) { const m = origAttr.get(el) || {}; m[a] = { value: cur, shown: p }; origAttr.set(el, m); el.setAttribute(a, p); }
    }
  }
  function sweep() {
    queued = false; if (mode !== 'simple') return;
    stop();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 3) { const pt = n.parentNode && n.parentNode.nodeName; if (pt !== 'SCRIPT' && pt !== 'STYLE') applyText(n); }
      else if (n.nodeType === 1) applyAttrs(n);
    }
    watch();
  }
  function restore() {
    stop();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 3) { const r = orig.get(n); if (r && n.nodeValue === r.shown) n.nodeValue = r.value; orig.delete(n); }
      else if (n.nodeType === 1) {
        const m = origAttr.get(n); if (!m) continue;
        for (const a of Object.keys(m)) if (n.getAttribute(a) === m[a].shown) n.setAttribute(a, m[a].value);
        origAttr.delete(n);
      }
    }
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(sweep); } }
  function watch() { if (!obs) obs = new MutationObserver(schedule); obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
  function stop() { if (obs) obs.disconnect(); }

  function set(m, persist = true) {
    mode = m === 'advanced' ? 'advanced' : 'simple';
    document.body.dataset.mode = mode;
    document.documentElement.dataset.mode = mode;
    if (persist) { try { localStorage.setItem(KEY, mode); } catch { /* private mode: not remembered */ } }
    if (store && store.set) store.set('mode', mode);
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    for (const k of Object.keys(MARK_PLAIN)) if (MARK[k]) MARK[k].label = mode === 'simple' ? MARK_PLAIN[k] : MARK_ORIG[k];
    if (mode === 'simple') { sweep(); watch(); } else { stop(); restore(); }
    window.dispatchEvent(new Event('resize')); // makes the Close-up picture redraw its labels
    const live = document.getElementById('announce'); if (live) live.textContent = mode === 'simple' ? 'Simple mode' : 'Advanced mode';
  }

  // the switch, in the top bar next to the help button
  const seg = document.createElement('div');
  seg.className = 'seg glass'; seg.id = 'mode-switch'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Detail level');
  seg.innerHTML = '<button type="button" data-mode="simple" aria-pressed="false" title="Plain words, fewer controls">Simple</button><button type="button" data-mode="advanced" aria-pressed="false" title="All the controls and the technical terms">Advanced</button>';
  const help = document.getElementById('help'); (help && help.parentNode ? help.parentNode : document.getElementById('top')).insertBefore(seg, help || null);
  seg.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) set(b.dataset.mode); });

  let start = 'advanced'; // the wording the docs, pitch and suites describe; Simple is one click away
  try { const saved = localStorage.getItem(KEY); if (saved === 'advanced' || saved === 'simple') start = saved; } catch { /* default */ }
  const q = new URLSearchParams(location.search).get('mode');
  const fromLink = q === 'simple' || q === 'advanced';
  set(fromLink ? q : start, !fromLink);
  return { get: () => mode, set };
}
