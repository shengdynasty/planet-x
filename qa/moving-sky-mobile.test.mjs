// Mobile / accessibility / performance QA for artifacts/moving-sky/index.html.
// Usage: node qa/moving-sky-mobile.test.mjs            (from the repo root)
// Env:   PW=<dir containing node_modules/playwright-core>  OUT=<screenshot dir>
//        QA_BASE=<git ref to compare against>  (default: merge-base with main)
// Loads an instrumented copy (exposes analyse/render/update on window.__qa) via file://,
// compares analyse() output between QA_BASE and the working tree, prints perf numbers
// at 1x and 4x CPU throttle, checks layout at phone/tablet widths and contrast in both
// themes, and writes screenshots to OUT. Exits 1 if any check fails.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SCRATCH = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const PW = process.env.PW || `${SCRATCH}/pw`;
const OUT = process.env.OUT || `${SCRATCH}/moving-sky-qa`;
const { chromium } = await import(path.join(PW, 'node_modules/playwright-core/index.mjs'));
const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const FILE = 'artifacts/moving-sky/index.html';
const BASE = process.env.QA_BASE || execSync('git merge-base HEAD main', { cwd: ROOT }).toString().trim();
mkdirSync(OUT, { recursive: true });

const HOOK = `
window.__qa={analyse,render,update,frame,EPOCHS,
  get mode(){return mode}, set mode(v){mode=v}, set pair(v){A=v[0];B=v[1]},
  stopTimer(){clearInterval(timer);timer=null}};
const __t0=performance.now(); update(); window.__qa.initMs=performance.now()-__t0;
`;
function instrument(src, name) {
  const i = src.lastIndexOf('\nupdate();\n');
  if (i < 0) throw new Error('cannot find init call to instrument in ' + name);
  const out = src.slice(0, i + 1) + HOOK + src.slice(i + '\nupdate();\n'.length);
  const p = `${OUT}/${name}.html`; writeFileSync(p, out); return 'file://' + p;
}
const urlCur = instrument(readFileSync(path.join(ROOT, FILE), 'utf8'), 'current');
const urlBase = instrument(execSync(`git show ${BASE}:${FILE}`, { cwd: ROOT }).toString(), 'base');

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

async function open(url, opts = {}, rate = 1) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const page = await ctx.newPage();
  if (rate !== 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url); await page.waitForFunction(() => window.__qa);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, errs };
}

// ---------- 1. detection results identical ----------
{
  const pairs = [];
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) if (a !== b) pairs.push([a, b]);
  const run = async url => { const { ctx, page } = await open(url);
    const r = await page.evaluate(ps => ps.map(([a, b]) => __qa.EPOCHS[a].band === __qa.EPOCHS[b].band ? JSON.stringify(__qa.analyse(a, b)) : null), pairs);
    await ctx.close(); return r; };
  const [rb, rc] = [await run(urlBase), await run(urlCur)];
  const same = rb.filter((x, i) => x !== rc[i]).length;
  check(same === 0, `analyse() output identical to ${BASE.slice(0, 7)} for ${rb.filter(Boolean).length} matched-band epoch pairs (${same} differ)`);
}

// ---------- 2. performance ----------
async function perf(url, rate) {
  const { ctx, page } = await open(url, {}, rate);
  await page.evaluate(() => __qa.stopTimer());
  const r = await page.evaluate(async () => {
    const T = f => { const t = performance.now(); f(); return performance.now() - t; };
    const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const out = {};
    // first update for a pair whose frames are not generated yet (cold)
    out.coldUpdate = T(() => { __qa.pair = [3, 4]; __qa.update(); });
    for (let i = 0; i < 8; i++) __qa.frame(i);
    const pairs = [[0, 5], [0, 7], [3, 4], [0, 1], [5, 7]];
    out.warmUpdate = med(pairs.map(p => T(() => { __qa.pair = p; __qa.update(); })));
    out.repeatUpdate = med([0, 1, 2, 3, 4].map(() => T(() => __qa.update())));
    __qa.stopTimer(); __qa.pair = [0, 5]; __qa.update(); __qa.stopTimer();
    for (const m of ['blink', 'diff', 'track']) { __qa.mode = m; __qa.render();
      out[`render_${m}`] = med(Array.from({ length: 7 }, () => T(() => __qa.render()))); }
    // 30 slider input events as fast as a drag can fire them, then wait 2 frames
    __qa.mode = 'track'; const s = document.getElementById('stretch');
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now(); let busy = 0;
    for (let k = 0; k < 30; k++) { const t = performance.now(); s.value = String(0.5 + k * 0.05); s.dispatchEvent(new Event('input', { bubbles: true })); busy += performance.now() - t; }
    await raf(); await raf(); out.slider30_sync = busy;
    return out;
  });
  await ctx.close(); return r;
}
const perfRows = {};
for (const [name, url] of [['base', urlBase], ['current', urlCur]])
  for (const rate of [1, 4]) perfRows[`${name} ${rate}x`] = await perf(url, rate);
const keys = Object.keys(perfRows['base 1x']);
console.log('\nperf (ms, median)'.padEnd(22) + Object.keys(perfRows).map(k => k.padStart(13)).join(''));
for (const k of keys) console.log(k.padEnd(22) + Object.values(perfRows).map(r => r[k].toFixed(1).padStart(13)).join(''));
console.log('(slider30_sync = main-thread time spent inside 30 back-to-back slider input events)\n');

// ---------- 3. layout, touch, a11y, screenshots ----------
const VIEWS = [
  ['desktop', { viewport: { width: 1280, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['phone-land', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['tablet', { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }],
];
for (const [vname, vopts] of VIEWS) for (const theme of ['light', 'dark']) {
  const { ctx, page, errs } = await open(urlCur, { ...vopts, colorScheme: theme });
  await page.evaluate(t => { document.documentElement.dataset.theme = t; __qa.stopTimer(); __qa.render(); }, theme);
  const tag = `${vname}/${theme}`;
  const L = await page.evaluate(() => {
    const de = document.documentElement;
    const eb = [...document.querySelectorAll('.epochs button')];
    const tb = [...document.querySelectorAll('.toolbar button, .toolbar input, .epochs button, .dets button')].filter(b => b.getClientRects().length);
    const ro = document.getElementById('readout').getBoundingClientRect(), cv = document.getElementById('sky').getBoundingClientRect();
    return { hscroll: de.scrollWidth - de.clientWidth,
      epOverflow: eb.filter(b => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).length,
      minEpW: Math.min(...eb.map(b => b.getBoundingClientRect().width)), minEpH: Math.min(...eb.map(b => b.getBoundingClientRect().height)),
      minTap: Math.min(...tb.map(b => b.getBoundingClientRect().height)),
      readoutOverImage: Math.max(0, Math.min(ro.bottom, cv.bottom) - Math.max(ro.top, cv.top)) / cv.height,
      padTop: getComputedStyle(de).paddingTop };
  });
  check(L.hscroll <= 0, `${tag}: no horizontal page scroll (${L.hscroll}px)`);
  check(L.epOverflow === 0, `${tag}: no epoch button overflows its box (${L.epOverflow})`);
  check(L.minEpW >= 40 && L.minEpH >= 40, `${tag}: epoch buttons >= 40x40 (min ${L.minEpW.toFixed(0)}x${L.minEpH.toFixed(0)})`);
  if (vopts.hasTouch) {
    check(L.minTap >= 40, `${tag}: toolbar/epoch/detection tap targets >= 40px tall (min ${L.minTap.toFixed(0)})`);
    check(L.readoutOverImage < 0.01, `${tag}: readout does not cover the image (${(L.readoutOverImage * 100).toFixed(0)}% of height)`);
    // tap updates the readout
    await page.locator('#sky').scrollIntoViewIfNeeded();
    const cv = await page.locator('#sky').boundingBox();
    const top = Math.max(cv.y, 0), vh = vopts.viewport.height;
    await page.touchscreen.tap(cv.x + cv.width * 0.3, Math.min(top + 60, vh - 20));
    const ro1 = await page.textContent('#readout');
    check(/Pixel/.test(ro1), `${tag}: tap on canvas updates readout ("${ro1.slice(0, 60)}")`);
    // horizontal drag updates readout continuously
    const cdp = await ctx.newCDPSession(page); const y = Math.min(top + 140, vh - 10);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cv.x + 40, y }] });
    for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cv.x + 40 + k * 20, y }] });
    const ro2 = await page.textContent('#readout');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(ro2 !== ro1 && /Pixel/.test(ro2), `${tag}: horizontal drag scrubs readout ("${ro2.slice(0, 60)}")`);
  }
  // select first detection via the list (non-pointer path) so the vetting panel shows
  await page.locator('#dets button').first().focus(); await page.keyboard.press('Enter');
  const sel = await page.evaluate(() => ({ pressed: document.querySelector('#dets button').getAttribute('aria-pressed'),
    focusInList: !!document.activeElement.closest('#dets'), vet: !document.getElementById('vetpanel').hidden,
    spec: document.getElementById('spec').getAttribute('aria-label'), live: document.getElementById('announce')?.textContent }));
  if (vname === 'desktop') {
    check(sel.pressed === 'true' && sel.vet, `${tag}: Enter on a list item selects it (aria-pressed, vetting panel shown)`);
    check(sel.focusInList, `${tag}: focus stays on the detection after selecting`);
    check(/Uncatalogued|mover|candidate/i.test(sel.spec || ''), `${tag}: spectrum aria-label names the selection ("${sel.spec}")`);
    check(/Selected/.test(sel.live || ''), `${tag}: selection announced in live region ("${sel.live}")`);
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${vname}-${theme}.png`, fullPage: true });
  if (vname === 'phone') {
    // mismatched-wavelength state
    await page.evaluate(() => { __qa.pair = [0, 6]; __qa.update(); __qa.stopTimer(); });
    await page.locator('#warn').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${vname}-${theme}-mismatch.png` });
  }
  if (errs.length) check(false, `${tag}: page errors ${errs.join('; ')}`);
  await ctx.close();
}

// ---------- 4. accessibility semantics + keyboard ----------
{
  const { ctx, page } = await open(urlCur);
  const a = await page.evaluate(() => ({
    epLabels: [...document.querySelectorAll('#epB button')].map(b => b.getAttribute('aria-label')),
    groups: [...document.querySelectorAll('.epochs')].map(g => g.getAttribute('aria-labelledby') ? document.getElementById(g.getAttribute('aria-labelledby')).textContent : g.getAttribute('aria-label')),
    warnLive: document.getElementById('warn').closest('[role=status],[role=alert],[aria-live]') !== null,
    baseLive: document.getElementById('baseline').closest('[aria-live]') !== null || !!document.getElementById('announce'),
    canvasRole: document.getElementById('sky').getAttribute('role'),
  }));
  check(a.epLabels.every(l => l && /µm|micron/.test(l)), `epoch buttons have aria-labels with wavelength (e.g. "${a.epLabels[5]}")`);
  console.log('      groups:', a.groups.join(' | '));
  check(a.warnLive, 'mismatch warning sits in a status/alert live region');
  check(a.baseLive, 'baseline change has a polite live region');
  check(a.canvasRole === 'img', 'canvas exposed as role=img');
  // keyboard: activate an epoch button with Enter; focus should stay on it and the change be announced
  await page.locator('#epB button[data-i="7"]').focus(); await page.keyboard.press('Enter');
  const k = await page.evaluate(() => ({ idx: +(document.activeElement.dataset.i ?? -1),
    live: document.getElementById('announce')?.textContent }));
  check(k.idx === 7, `focus stays on the activated epoch button (index ${k.idx})`);
  check(/Baseline/.test(k.live || ''), `baseline announced ("${k.live}")`);
  await page.locator('#epB button[data-i="6"]').focus(); await page.keyboard.press('Enter');
  const w = await page.evaluate(() => document.getElementById('announce')?.textContent);
  console.log('      mismatch announcement:', w);
  // tab order (first 12 stops)
  await page.reload(); await page.waitForFunction(() => window.__qa); const order = [];
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const e = document.activeElement; return (e.id || e.getAttribute('aria-label') || e.textContent).trim().slice(0, 18); })); }
  console.log('      tab order:', order.join(' → '));
  // focus ring visible (not clipped) on segmented buttons: outline drawn inside
  const fo = await page.evaluate(() => { const b = document.getElementById('m-diff'); b.focus(); const cs = getComputedStyle(b); return cs.outlineOffset; });
  await page.locator('#m-blink').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await page.locator('.toolbar').screenshot({ path: `${OUT}/focus-toolbar.png` });
  check(parseFloat(fo) < 0, `segmented buttons draw focus ring inside the clipped group (outline-offset ${fo})`);
  await ctx.close();
}

// ---------- 4b. reduced-motion flip button (keyboard, tap size, announcement) ----------
{
  const { ctx, page } = await open(urlCur, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const f = page.locator('#flip');
  check(await f.isVisible(), 'reduced motion: flip button visible');
  const h = (await f.boundingBox()).height;
  check(h >= 40, `reduced motion: flip button tap target ${h.toFixed(0)}px tall`);
  await f.focus(); await page.keyboard.press('Enter');
  const r = await page.evaluate(() => ({ focus: document.activeElement.id, live: document.getElementById('announce').textContent, label: document.getElementById('flip').textContent }));
  check(r.focus === 'flip' && /Compare/.test(r.live), `reduced motion: flip keeps focus and announces ("${r.live}", button now "${r.label}")`);
  await page.screenshot({ path: `${OUT}/phone-reduced-motion.png` });
  await ctx.close();
}

// ---------- 5. contrast (WCAG AA) in both themes ----------
{
  const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = h => { h = h.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const INF_MAX = [252, 255, 164], DIV_MAX = [244, 165, 130];
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open(urlCur, { colorScheme: theme });
    const v = await page.evaluate(t => { document.documentElement.dataset.theme = t; const cs = getComputedStyle(document.documentElement);
      const g = n => cs.getPropertyValue(n).trim();
      const alpha = sel => { const m = getComputedStyle(document.querySelector(sel)).backgroundColor.match(/[\d.]+/g); return +m[3]; };
      return { ...Object.fromEntries(['--bg', '--panel', '--panel-2', '--ink', '--muted', '--accent', '--accent-ink', '--warn', '--warn-bg', '--cand', '--known', '--var', '--art', '--focus'].map(n => [n, g(n)])),
        flashA: alpha('.flash'), readA: alpha('.readout') }; }, theme);
    const c = n => hex(v[n]);
    const T = [
      ['ink on panel', c('--ink'), c('--panel'), 4.5], ['muted on panel', c('--muted'), c('--panel'), 4.5],
      ['muted on panel-2', c('--muted'), c('--panel-2'), 4.5], ['muted on bg (.lead/.sub)', c('--muted'), c('--bg'), 4.5],
      ['badge/.warn text', c('--warn'), c('--warn-bg'), 4.5], ['pressed button text', c('--accent-ink'), c('--accent'), 4.5],
      ['focus ring on panel', c('--focus'), c('--panel'), 3], ['focus ring on bg', c('--focus'), c('--bg'), 3],
      // list swatches are grey and told apart by shape (filled / solid / dashed / dotted), as in the app's Field view
      ...['--ink', '--muted'].map(n => [`.dot ${n} on panel-2 (3:1)`, c(n), c('--panel-2'), 3]),
      ['.flash over brightest pixel', [255, 255, 255], over([0, 0, 0], v.flashA, INF_MAX), 4.5],
      ['.flash over diff max', [255, 255, 255], over([0, 0, 0], v.flashA, DIV_MAX), 4.5],
      ['.readout over brightest pixel', [255, 255, 255], over([0, 0, 0], v.readA, INF_MAX), 4.5],
    ];
    for (const [name, fg, bg, min] of T) { const r = cr(fg, bg); check(r >= min, `${theme}: ${name} ${r.toFixed(2)}:1 (need ${min})`); }
    await ctx.close();
  }
}

await browser.close();
console.log(`\nscreenshots: ${OUT}\n${failures ? failures + ' check(s) failed' : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
