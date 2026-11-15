// In-app helper: a panel that answers common questions from the knowledge base (kb.js) and moves around the app.
// mountAssistant(el, store) fills <aside id="assistant"> and adds an "Ask" button to the top bar beside the help
// button (like modes.js adds its switch). It asks one answerer (answer.js) and drives the app only through the store:
// view, field and 'flyto'. The one exception is "open the help sheet", which presses the shell's own ? button.
import { answer as defaultAnswer } from './answer.js';
import { SUGGESTIONS, actionLabel } from './kb.js';
import { EXAMPLES } from '../field/examples.js';

const narrow = () => window.matchMedia('(max-width: 860px)').matches;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const INTRO = {
  advanced: 'I answer questions about this app from its own notes and can take you around it. If something isn’t in my notes I’ll say so rather than guess.',
  simple: 'Ask me about this app and I can show you around. If I don’t know something, I’ll say so instead of guessing.',
};

export function mountAssistant(el, store, { answer = defaultAnswer } = {}) {
  const mode = () => (store.get('mode') === 'simple' ? 'simple' : 'advanced');
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // --- the top-bar button ---
  const btn = h('button', 'glass', 'Ask');
  btn.type = 'button'; btn.id = 'ask';
  btn.title = 'Ask a question about the app';
  btn.setAttribute('aria-controls', el.id); btn.setAttribute('aria-expanded', 'false');
  const help = document.getElementById('help');
  (help && help.parentNode ? help.parentNode : document.getElementById('top')).insertBefore(btn, help || null);

  // --- the panel ---
  el.classList.add('hud', 'glass');
  el.setAttribute('aria-labelledby', 'as-title');
  el.hidden = true;
  const head = h('header', 'as-head');
  const title = h('h2', null, 'Ask Planet X'); title.id = 'as-title';
  const close = h('button', 'icon ghost', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Close');
  head.append(title, close);
  const log = h('div', 'as-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.tabIndex = 0;
  log.setAttribute('aria-label', 'Conversation');
  const intro = h('p', 'as-msg as-a as-intro');
  log.append(intro);
  const chips = h('div', 'as-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Suggested questions');
  const form = h('form', 'as-form'); form.autocomplete = 'off';
  const input = h('input'); input.type = 'text'; input.setAttribute('aria-label', 'Your question'); input.placeholder = 'Ask about the app…';
  input.enterKeyHint = 'send'; input.maxLength = 200;
  const send = h('button', null, 'Send'); send.type = 'submit';
  form.append(input, send);
  el.append(head, log, chips, form);

  function renderStatic() {
    intro.textContent = INTRO[mode()];
    const list = SUGGESTIONS[store.get('view')] || SUGGESTIONS.sky;
    chips.replaceChildren(...list.map(s => {
      const b = h('button', 'as-chip', mode() === 'simple' && s.plain ? s.plain : s.q); b.type = 'button';
      b.addEventListener('click', () => ask(b.textContent));
      return b;
    }));
  }

  const scrollEnd = () => log.scrollTo({ top: log.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });

  async function ask(question) {
    const q = String(question || '').trim(); if (!q) return;
    log.append(h('p', 'as-msg as-q', q));
    let res;
    try { res = await answer(q, { mode: mode(), view: store.get('view'), source: store.get('source') }); }
    catch (err) { console.warn('[planet-x] assistant:', err); res = { text: 'Something went wrong answering that. The help sheet covers the app.', actions: [{ type: 'help' }], sources: [] }; }
    const msg = h('div', 'as-msg as-a'); msg.dataset.answer = res.id || '';
    msg.append(h('p', null, res.text));
    if (res.actions && res.actions.length) {
      const row = h('div', 'as-acts');
      for (const a of res.actions) {
        const b = h('button', null, actionLabel(a, mode())); b.type = 'button';
        b.addEventListener('click', () => run(a));
        row.append(b);
      }
      msg.append(row);
    }
    if (res.sources && res.sources.length) msg.append(h('p', 'as-src', 'From: ' + res.sources.join('; ')));
    log.append(msg);
    scrollEnd();
  }

  function run(a) {
    const ex = a.example && EXAMPLES.find(e => e.id === a.example);
    if (a.type === 'help') {
      hide(true);
      if (help) help.click();
      return;
    }
    if (a.type === 'view') {
      if (a.view === 'compare' && !store.selected()) { store.emit('toast', 'Pick a mover first'); return; }
      store.set('view', a.view);
    } else if (a.type === 'field' && ex) {
      const f = { ra: ex.ra, dec: ex.dec, sizeArcsec: ex.sizeArcsec, det: ex.det };
      if (ex.t != null) f.t = ex.t;
      store.set('field', f);
      store.set('view', 'field');
    } else if (a.type === 'flyto' && ex) {
      store.set('view', 'sky');
      store.emit('flyto', { ra: ex.ra, dec: ex.dec, fov: 10 });
    } else return;
    store.emit('announce', actionLabel(a, mode()));
    if (narrow()) hide(true); // on a phone the panel would cover what was just opened
  }

  // on phones the top bar wraps to two or three rows, so the panel starts under whatever height it has
  function place() {
    const top = document.getElementById('top');
    if (top) el.style.setProperty('--as-top', Math.round(top.getBoundingClientRect().bottom + 8) + 'px');
  }
  window.addEventListener('resize', () => { if (!el.hidden) place(); });

  function show() {
    if (!el.hidden) return;
    renderStatic();
    el.hidden = false; btn.setAttribute('aria-expanded', 'true'); document.body.classList.add('assistant-open');
    place();
    input.focus();
  }
  function hide(returnFocus) {
    if (el.hidden) return;
    el.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.body.classList.remove('assistant-open');
    if (returnFocus) btn.focus();
  }

  btn.addEventListener('click', () => (el.hidden ? show() : hide(true)));
  close.addEventListener('click', () => hide(true));
  form.addEventListener('submit', e => { e.preventDefault(); const q = input.value; input.value = ''; ask(q); });
  // keys typed in the panel stay in the panel: no view shortcut fires while typing or on a chip
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); hide(true); }
  });
  store.on('view', () => { if (!el.hidden) renderStatic(); });
  store.on('mode', () => { if (!el.hidden) renderStatic(); });
  renderStatic();

  return { show, hide, ask, el };
}
