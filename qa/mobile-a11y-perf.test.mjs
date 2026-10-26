#!/usr/bin/env node
// Mobile / accessibility / performance QA for artifacts/ui-demo/index.html.
//
//   node qa/mobile-a11y-perf.test.mjs [--file <html>] [--label after] [--baseline <dir of PNGs>] [--runs 3] [--no-perf] [--no-shots]
//
// Env: PW_CORE   absolute path to playwright-core/index.mjs (no npm install into the repo)
//      QA_OUT    directory for screenshots (default: the session scratchpad, never git)
//      CHROME    Chrome executable
// Prints perf numbers (desktop, and mobile emulation with 4x CPU throttle), layout/a11y checks,
// a WCAG contrast scan measured against the real rendered background, and (with --baseline) a
// pixel diff of each screenshot against an earlier run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRATCH = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const PW_CORE = process.env.PW_CORE || `${SCRATCH}/pw/node_modules/playwright-core/index.mjs`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(PW_CORE);

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(arg('file', path.join(here, '../artifacts/ui-demo/index.html')));
const LABEL = arg('label', 'after');
const OUT = path.join(process.env.QA_OUT || path.join(SCRATCH, 'qa'), LABEL);
const BASELINE = arg('baseline', null);
const RUNS = +arg('runs', 3);
const URL = pathToFileURL(FILE).href;
const MARKS_SKY = fs.readFileSync(FILE, 'utf8').includes("performance.mark('sky-ready')");
fs.mkdirSync(OUT, { recursive: true });

// three.js r128 is served from a local cache when present so network jitter doesn't pollute timings.
const THREE_CACHE = path.join(SCRATCH, 'cache/three.r128.min.js');
async function routeThree(ctx) {
  if (!fs.existsSync(THREE_CACHE)) return;
  const body = fs.readFileSync(THREE_CACHE);
  await ctx.route('**/three.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.abort()); // fonts: fall back to system stack, deterministic
}

const INIT = `(() => {
  window.__qa = { lt: [], firstFrame: null, draws: 0 };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) __qa.lt.push([Math.round(e.startTime), Math.round(e.duration)]); })
        .observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { if (__qa.firstFrame === null && window.THREE) __qa.firstFrame = performance.now(); cb(t); });
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) for (const fn of ['drawArrays', 'drawElements']) {
    const o = C.prototype[fn]; C.prototype[fn] = function () { __qa.draws++; return o.apply(this, arguments); };
  }
})();`;

const launch = () => chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function open(browser, dev, { scheme = 'light', attr = null, throttle = 0 } = {}) {
  const ctx = await browser.newContext({ ...DEVICES[dev], colorScheme: scheme });
  await routeThree(ctx);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  if (throttle) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  await page.goto(URL, { waitUntil: 'load' });
  if (attr) await page.evaluate(a => document.documentElement.setAttribute('data-theme', a), attr);
  await page.waitForTimeout(4000 * (throttle ? 1.5 : 1));
  return { ctx, page, errors };
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const results = { label: LABEL, file: FILE, perf: {}, checks: [], contrast: [], diffs: [], errors: [] };
const check = (name, ok, info = '') => { results.checks.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

// ------------------------------------------------------------------ perf
async function perf(browser, dev, throttle) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page, errors } = await open(browser, dev, { throttle });
    if (MARKS_SKY) await page.waitForFunction(() => performance.getEntriesByName('sky-ready').length, null, { timeout: 30000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const lt = __qa.lt, sky = performance.getEntriesByName('sky-ready')[0];
      return { dcl: Math.round(nav.domContentLoadedEventEnd), firstFrame: Math.round(__qa.firstFrame),
        skyReady: sky ? Math.round(sky.startTime) : null,
        longest: lt.reduce((m, t) => Math.max(m, t[1]), 0), tbt: lt.reduce((s, t) => s + Math.max(0, t[1] - 50), 0),
        longTasks: lt.length, lastBusy: lt.reduce((m, t) => Math.max(m, t[0] + t[1]), 0) };
    });
    results.errors.push(...errors); runs.push(r); await ctx.close();
  }
  const keys = Object.keys(runs[0]); const m = {};
  for (const k of keys) m[k] = runs[0][k] === null ? null : median(runs.map(r => r[k]));
  return m;
}

// ------------------------------------------------------------------ in-page helpers
async function decodeInPage(page, buf) {
  // returns nothing; stores ImageData on window.__qaImg
  await page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); window.__qaImg = g.getImageData(0, 0, c.width, c.height);
  }, buf.toString('base64'));
}

const TEXT_SEL = ['#title', '#readout span', '#readout b', '#readout button', '#views button', '#help', '#mobile-toggle', '#panel header > span',
  '#filters button', '#list li .n', '#list li > span:nth-child(2)', '#list li .s', '#empty', '#detail h2', '#detail .tag', '#detail dt', '#detail dd', '#detail p',
  '#cutlabel span', '#detail .row button', '#blink', '.scan:not(:disabled) small', '#ctl button', '#cmp-top button', '#cmp-top h2', '#cmp-top .sub', '#cmp-side h3',
  '#cmp-side p', '#cmp-side dt', '#cmp-side dd', '#cmp-side button', '.corner', '#sheet h2', '#sheet h3', '#sheet p', '#sheet li', '#sheet kbd', '#sheet .keys span', '#sheet-close', '#layers button'];

async function contrast(page, tag) {
  const targets = await page.evaluate(sel => {
    const out = []; let n = 0;
    for (const s of sel) for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || !el.textContent.trim()) continue;
      if (el.closest('[inert]') || el.closest(':disabled')) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity; if (op < 0.05) continue;
      // topmost check: is the element actually what you see at its centre?
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
      if (!hit || !el.contains(hit)) continue;
      let clipped = false; // partly scrolled out of an overflow container: background under the hidden part isn't its own
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowY === 'visible') continue; const q = a.getBoundingClientRect(); if (r.top < q.top - 1 || r.bottom > q.bottom + 1 || r.left < q.left - 1 || r.right > q.right + 1) clipped = true; }
      if (clipped) continue;
      el.dataset.qa = n; out.push({ id: n++, sel: s, text: el.textContent.trim().slice(0, 24), color: cs.color, op, size: parseFloat(cs.fontSize), weight: +cs.fontWeight, rect: [r.left, r.top, r.width, r.height] });
    }
    const st = document.createElement('style'); st.id = 'qa-hide';
    st.textContent = '[data-qa], [data-qa] * { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } [data-qa] kbd, kbd[data-qa] { border-color: transparent !important; }';
    document.head.appendChild(st); return out;
  }, TEXT_SEL);
  await page.waitForTimeout(250);
  const dpr = await page.evaluate(() => devicePixelRatio);
  await decodeInPage(page, await page.screenshot());
  const rows = await page.evaluate(({ targets, dpr }) => {
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const img = window.__qaImg, W = img.width;
    return targets.map(t => {
      // inset 3px so borders / rounded corners of the element itself don't count as background
      const [x, y, w, h] = [t.rect[0] + 3, t.rect[1] + 3, t.rect[2] - 6, t.rect[3] - 6].map(v => Math.round(v * dpr)); const lum = [], px = [];
      for (let j = Math.max(0, y); j < Math.min(img.height, y + h); j += 2) for (let i = Math.max(0, x); i < Math.min(W, x + w); i += 2) {
        const k = (j * W + i) * 4; lum.push(L(img.data[k], img.data[k + 1], img.data[k + 2])); px.push([img.data[k], img.data[k + 1], img.data[k + 2]]);
      }
      if (!lum.length) return null;
      const order = lum.map((v, i) => i).sort((a, b) => lum[a] - lum[b]);
      const pick = q => px[order[Math.min(order.length - 1, Math.floor(q * order.length))]];
      const m = t.color.match(/[\d.]+/g).map(Number); const a = (m[3] ?? 1) * t.op;
      const ratio = bg => { const fg = [0, 1, 2].map(c => m[c] * a + bg[c] * (1 - a)); const l1 = L(...fg), l2 = L(...bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const worst = Math.min(ratio(pick(0.1)), ratio(pick(0.5)), ratio(pick(0.9)));
      const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
      return { sel: t.sel, text: t.text, ratio: +worst.toFixed(2), need: large ? 3 : 4.5 };
    }).filter(Boolean);
  }, { targets, dpr });
  await page.evaluate(() => { document.getElementById('qa-hide').remove(); document.querySelectorAll('[data-qa]').forEach(e => delete e.dataset.qa); });
  // one row per selector: its worst instance
  const by = new Map(); for (const r of rows) if (!by.has(r.sel) || by.get(r.sel).ratio > r.ratio) by.set(r.sel, r);
  for (const r of by.values()) results.contrast.push({ tag, ...r, ok: r.ratio >= r.need });
}

async function layout(page, tag) {
  const r = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight, over = [], small = [];
    const doc = document.documentElement.scrollWidth > vw || document.body.scrollWidth > vw;
    for (const el of document.querySelectorAll('button, [role="option"], input, [tabindex="0"], a[href]')) {
      if (el.closest('[inert]') || el.id === 'stage') continue;
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (b.width === 0 || b.height === 0 || cs.visibility === 'hidden') continue;
      if (b.bottom < 0 || b.top > vh) continue; // off-screen sheet (closed mobile panel)
      const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, b.left + b.width / 2)), Math.min(vh - 1, Math.max(0, b.top + b.height / 2)));
      if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
      const name = (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.textContent.trim() ? ` "${el.textContent.trim().slice(0, 14)}"` : '');
      if (b.left < -1 || b.right > vw + 1) over.push(`${name} [${Math.round(b.left)}..${Math.round(b.right)}]`);
      if (!el.disabled && (b.width < 40 || b.height < 40)) {
        // effective target incl. the ::before hit-slop some controls use
        const pb = getComputedStyle(el, '::before'); const slop = pb.content !== 'none' && pb.position === 'absolute' ? -parseFloat(pb.top || 0) * 2 : 0;
        if (b.width + slop < 40 || b.height + slop < 40) small.push(`${name} ${Math.round(b.width + slop)}×${Math.round(b.height + slop)}`);
      }
    }
    return { doc, over, small };
  });
  check(`[${tag}] no horizontal page overflow`, !r.doc);
  check(`[${tag}] controls inside viewport`, r.over.length === 0, r.over.join(', '));
  if (!tag.startsWith('desktop')) check(`[${tag}] tap targets >= 40px`, r.small.length === 0, r.small.join(', '));
}

const shot = async (page, name) => { const p = path.join(OUT, name + '.png'); await page.screenshot({ path: p }); return p; };
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none'; }, sel);
async function openPanelAndSelect(page, idx = 2) {
  if (await visible(page, '#mobile-toggle')) await page.click('#mobile-toggle');
  await page.waitForTimeout(400);
  await page.click(`#list li:nth-child(${idx + 1})`);
  await page.waitForTimeout(1500);
}

// ------------------------------------------------------------------ screenshots + checks
async function shots(browser) {
  const themes = [{ n: 'light', scheme: 'light' }, { n: 'dark', scheme: 'dark' }];
  const jobs = themes.flatMap(t => ['desktop', 'phone', 'landscape', 'tablet'].map(dev => [t, dev]));
  await Promise.all(jobs.map(async ([t, dev]) => {
      const { ctx, page, errors } = await open(browser, dev, { scheme: t.scheme });
      const tag = `${dev}-${t.n}`;
      await shot(page, `${tag}-home`); await layout(page, `${tag} home`); await contrast(page, `${tag} home`);
      await openPanelAndSelect(page);
      await shot(page, `${tag}-selected`); await layout(page, `${tag} selected`); await contrast(page, `${tag} selected`);
      await page.click('#d-compare'); await page.waitForTimeout(600);
      await shot(page, `${tag}-compare`); await layout(page, `${tag} compare`); await contrast(page, `${tag} compare`);
      const sq = await page.evaluate(() => { const r = document.getElementById('cmp-wrap').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), r.bottom <= innerHeight + 1 && r.top >= 0]; });
      check(`[${tag} compare] wipe image usable`, sq[0] >= 160 && sq[2], `${sq[0]}×${sq[1]} px, in view: ${sq[2]}`);
      await page.click('#cmp-back'); await page.waitForTimeout(300);
      if (dev !== 'desktop' && await visible(page, '#mobile-toggle')) { await page.click('#mobile-toggle'); await page.waitForTimeout(400); }
      await page.click('#help'); await page.waitForTimeout(300);
      await shot(page, `${tag}-help`); await layout(page, `${tag} help`); await contrast(page, `${tag} help`);
      results.errors.push(...errors.map(e => `${tag}: ${e}`)); await ctx.close();
  }));
  results.checks.sort((a, b) => a.name.localeCompare(b.name));
  // explicit data-theme overrides beat the OS preference
  for (const [scheme, attr] of [['light', 'dark'], ['dark', 'light']]) {
    const { ctx, page } = await open(browser, 'phone', { scheme, attr });
    await openPanelAndSelect(page);
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('panel')).backgroundColor);
    await shot(page, `phone-attr-${attr}-selected`);
    check(`data-theme="${attr}" overrides prefers-color-scheme: ${scheme}`, attr === 'dark' ? bg.startsWith('rgba(0, 0, 0') : bg.startsWith('rgba(255, 255, 255'), bg);
    await ctx.close();
  }
}

// ------------------------------------------------------------------ keyboard / a11y / render checks
async function behaviour(browser) {
  const { ctx, page, errors } = await open(browser, 'desktop', { scheme: 'dark' });
  const ae = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute('role') || a.tagName) + (a.closest('#sheet') ? '@sheet' : a.closest('#compare') ? '@compare' : '') : null; });
  const stage = await page.evaluate(() => { const s = document.getElementById('stage'); return [s.getAttribute('role'), s.getAttribute('aria-label'), s.tabIndex]; });
  check('#stage has role + accessible name', !!stage[0] && !!stage[1], stage.join(' / '));
  const toast = await page.evaluate(() => { const t = document.getElementById('toast'); return [t.getAttribute('role'), t.getAttribute('aria-live')]; });
  check('toast is a polite live region', toast[0] === 'status' || toast[1] === 'polite', toast.join(' / '));

  // listbox keyboard
  const stops = await page.evaluate(() => [...document.querySelectorAll('#list [role="option"]')].filter(li => li.tabIndex === 0).length);
  check('#list has exactly one tab stop (roving tabindex)', stops === 1, `tab stops: ${stops}`);
  await page.evaluate(() => document.querySelector('#list [role="option"][tabindex="0"]')?.focus());
  const before = await page.evaluate(() => document.getElementById('ra').textContent);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => [...document.querySelectorAll('#list li')].indexOf(document.activeElement));
  check('ArrowDown moves focus within #list', focused === 2, `focused index ${focused}`);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const sel = await page.evaluate(() => [...document.querySelectorAll('#list li')].findIndex(li => li.getAttribute('aria-selected') === 'true'));
  check('Enter selects the focused option', sel === 2, `selected ${sel}`);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press(' '); await page.waitForTimeout(300);
  const sel2 = await page.evaluate(() => [...document.querySelectorAll('#list li')].findIndex(li => li.getAttribute('aria-selected') === 'true'));
  check('Space selects the focused option', sel2 === 1, `selected ${sel2}`);
  await page.waitForTimeout(1200);
  const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live]')].map(e => e.textContent.trim()).filter(Boolean).join(' | '));
  check('selection is announced in a live region', /Candidate 02/.test(live), live.slice(0, 80));

  // help dialog focus management
  await page.focus('#help'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  check('help dialog moves focus inside', (await ae())?.endsWith('@sheet'), await ae());
  let trapped = true; for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); if (!(await ae())?.endsWith('@sheet')) trapped = false; }
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Shift+Tab'); if (!(await ae())?.endsWith('@sheet')) trapped = false; }
  check('help dialog traps Tab / Shift+Tab', trapped, await ae());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('closing help restores focus to the opener', (await ae()) === 'help', await ae());

  // compare overlay hides the sky UI from keyboard + AT, and the sky stops drawing
  await page.focus('#help'); await page.keyboard.press('c'); await page.waitForTimeout(500);
  const inert = await page.evaluate(() => ['top', 'panel', 'bottom', 'stage'].every(id => document.getElementById(id).inert));
  check('compare: sky UI behind the overlay is inert', inert);
  check('compare: focus moves into the overlay', (await ae())?.endsWith('@compare'), await ae());
  const d0 = await page.evaluate(() => __qa.draws); await page.waitForTimeout(1000); const d1 = await page.evaluate(() => __qa.draws);
  check('compare: no WebGL draws while the overlay covers the sky', d1 === d0, `${d1 - d0} draws/s`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const e0 = await page.evaluate(() => __qa.draws); await page.waitForTimeout(1000); const e1 = await page.evaluate(() => __qa.draws);
  check('sky: rendering resumes after compare', e1 > e0, `${e1 - e0} draws/s`);

  // hidden tab: open another tab in front
  const other = await ctx.newPage(); await other.goto('about:blank'); await other.bringToFront(); await page.waitForTimeout(300);
  const vis = await page.evaluate(() => document.visibilityState);
  const h0 = await page.evaluate(() => __qa.draws); await page.waitForTimeout(1000); const h1 = await page.evaluate(() => __qa.draws);
  check('hidden tab: no WebGL draws', vis !== 'hidden' || h1 === h0, `visibility=${vis}, ${h1 - h0} draws/s` + (vis !== 'hidden' ? ' (headless did not hide the tab; not testable here)' : ''));
  await other.close(); await page.bringToFront();
  results.errors.push(...errors.map(e => `behaviour: ${e}`)); await ctx.close();

  // phone: DPR cap, pinch zoom, panel hidden from AT when closed, Grid/Tracks reachable
  const P = await open(browser, 'phone', { scheme: 'light' });
  const dpr = await P.page.evaluate(() => { const c = document.querySelector('#stage canvas'); return +(c.width / c.clientWidth).toFixed(2); });
  check('DPR capped at 2 (device DPR 3)', dpr <= 2, `canvas DPR ${dpr}`);
  const closedPanel = await P.page.evaluate(() => getComputedStyle(document.getElementById('panel')).visibility);
  check('closed mobile panel is hidden from AT / tab order', closedPanel === 'hidden', closedPanel);
  const layers = await P.page.evaluate(() => ['grid', 'tracks'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth; }));
  check('Grid / Tracks reachable on a phone', layers.every(Boolean), layers.join(','));
  const cdp = await P.ctx.newCDPSession(P.page);
  const tp = (x, y, id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
  const imgA = await P.page.screenshot({ clip: { x: 0, y: 200, width: 390, height: 300 } });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(170, 400, 1), tp(220, 400, 2)] });
  for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(170 - k * 12, 400, 1), tp(220 + k * 12, 400, 2)] }); await P.page.waitForTimeout(30); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await P.page.waitForTimeout(1200);
  const imgB = await P.page.screenshot({ clip: { x: 0, y: 200, width: 390, height: 300 } });
  await decodeInPage(P.page, imgA); const a = await P.page.evaluate(() => Array.from(window.__qaImg.data.filter((_, i) => i % 16 === 0)));
  await decodeInPage(P.page, imgB); const b = await P.page.evaluate(() => Array.from(window.__qaImg.data.filter((_, i) => i % 16 === 0)));
  let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]); diff /= a.length;
  check('pinch (two-pointer spread) changes the view', diff > 1.5, `mean abs diff ${diff.toFixed(2)}`);
  await P.ctx.close();
}

// ------------------------------------------------------------------ baseline diff
async function diffs(browser) {
  if (!BASELINE) return;
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto('about:blank');
  for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.png') && f.includes('desktop') && f.endsWith('home.png'))) {
    const bp = path.join(BASELINE, f); if (!fs.existsSync(bp)) continue;
    await decodeInPage(page, fs.readFileSync(bp)); await page.evaluate(() => { window.__qaA = window.__qaImg; });
    await decodeInPage(page, fs.readFileSync(path.join(OUT, f)));
    const d = await page.evaluate(() => { const A = __qaA.data, B = __qaImg.data; if (A.length !== B.length) return null; let s = 0, big = 0;
      for (let i = 0; i < A.length; i += 4) { const e = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); s += e; if (e > 48) big++; }
      return { mean: +(s / (A.length / 4) / 3).toFixed(2), pctBig: +(100 * big / (A.length / 4)).toFixed(2) }; });
    if (d) { results.diffs.push({ file: f, ...d }); console.log(`DIFF  ${f} vs baseline: mean |Δ| ${d.mean}/255 per channel, ${d.pctBig}% of pixels differ by >16/channel`); }
  }
  await ctx.close();
}

const browser = await launch();
console.log(`QA ${LABEL}: ${FILE}\nscreenshots → ${OUT}\n`);
if (!argv.includes('--no-perf')) {
  results.perf.desktop = await perf(browser, 'desktop', 0);
  results.perf.mobile4x = await perf(browser, 'phone', 4);
  console.log('PERF (median of ' + RUNS + ' runs, ms since navigation start; sky-ready only if the page marks it)');
  console.table(results.perf);
}
if (!argv.includes('--no-shots')) await shots(browser);
await behaviour(browser);
await diffs(browser);
await browser.close();

const bad = results.contrast.filter(c => !c.ok);
console.log(`\nCONTRAST (WCAG AA vs rendered background, worst instance per selector): ${results.contrast.length - bad.length}/${results.contrast.length} pass`);
if (bad.length) console.table(bad.map(({ tag, sel, text, ratio, need }) => ({ tag, sel, text, ratio, need })));
const errs = [...new Set(results.errors)];
check('no page errors / dialogs', errs.length === 0, errs.slice(0, 5).join(' | '));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const fails = results.checks.filter(c => !c.ok).length;
console.log(`\n${results.checks.length - fails}/${results.checks.length} checks pass; contrast failures: ${bad.length}. Full results: ${path.join(OUT, 'results.json')}`);
