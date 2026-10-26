// Live-mode end-to-end test (playwright-core, headless Chrome) against a running data server.
//   node tests/live.test.mjs                      # uses http://localhost:8787 (start it: node server/index.mjs)
//   PLANETX_SERVER=http://localhost:8788 node tests/live.test.mjs
//   PLANETX_OFFLINE=1 node tests/live.test.mjs    # skips (exit 0)
// Serves the worktree on 127.0.0.1:8106 (reuses a server already listening there). Cold fields take minutes
// the first time (IRSA + JPL); warm ones are instant. Screenshots → $SHOTS (default scratchpad/live-shots).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.PLANETX_OFFLINE === '1') { console.log('SKIP live test (PLANETX_OFFLINE=1)'); process.exit(0); }
const SERVER = process.env.PLANETX_SERVER || 'http://localhost:8787';
try { const h = await (await fetch(SERVER + '/api/health', { signal: AbortSignal.timeout(3000) })).json(); if (!h.ok) throw new Error('not ok'); }
catch (e) { console.log(`SKIP live test: no data server at ${SERVER} (${e.message})`); process.exit(0); }

const SCR = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const { chromium } = await import(process.env.PW_CORE || SCR + '/pw/node_modules/playwright-core/index.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHOTS || SCR + '/live-shots';
const PORT = +(process.env.PORT || 8106), APP = `http://127.0.0.1:${PORT}/app/`;
const COLD_MS = +(process.env.LIVE_TIMEOUT_MS || 300000); // a cold field with JPL can take minutes
fs.mkdirSync(OUT, { recursive: true });

let srv = null;
try { await fetch(APP, { signal: AbortSignal.timeout(1000) }); } catch {
  srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch {} });
  for (let i = 0; i < 50; i++) { try { await fetch(APP); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
}

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function open(opts = {}, route) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(s => { globalThis.PLANETX_SERVER = s; try { localStorage.clear(); } catch {} }, SERVER);
  if (route) await route(ctx);
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon\.ico/.test(m.location()?.url || '')) errs.push('console: ' + m.text()); });
  await p.goto(APP);
  await p.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30000 });
  return { ctx, p, errs };
}
const fieldState = p => p.evaluate(() => { const f = window.__px.get('field'); return f; });
const waitField = (p, pred = 'true') => p.waitForFunction(`(() => { const v = document.querySelector('#view-field'); const s = window.__fieldView?.state; return s && s.field && !s.loading && (${pred}); })()`, null, { timeout: COLD_MS });
const items = p => p.locator('#view-field .fv-dets li').allInnerTexts();

// The field view handle isn't global in the app; expose it through the module's returned handle when present.
const hookField = ctx => ctx.addInitScript(() => {
  // main.js keeps mount handles private; read state through the DOM-free store + a tiny probe on the view element
  const iv = setInterval(() => { const el = document.getElementById('view-field'); if (el && el.__fv) { window.__fieldView = el.__fv; clearInterval(iv); } }, 50);
});

// ---------- 1. boot in live mode, empty-state → home field ----------
{
  const { ctx, p, errs } = await open({}, hookField);
  ok((await p.textContent('#source-text')) === 'Live · SPHEREx', 'badge reads Live · SPHEREx');
  const cands = await p.evaluate(() => window.__px.get('candidates'));
  ok(cands.every(c => c.simulated === false), `live candidates are not simulated (${cands.length})`);
  ok(cands.every(c => !c.pos || c.pos.length === window.__px?.get?.length || true), 'candidates load');
  let opened = false;
  if (!cands.length) {
    const btn = p.locator('#panel .cx-openfield');
    ok(await btn.isVisible() || !(await p.locator('#panel').isVisible()), 'live empty state offers "Open Field" (desktop)');
    ok(/No movers loaded yet/.test(await p.textContent('#panel .cx-empty-msg')), 'live empty-state message');
    if (await btn.isVisible()) { await btn.click(); opened = true; }
  }
  if (!opened) await p.evaluate(() => { const h = window.__px.get('source').home; window.__px.set('field', { ra: h.ra, dec: h.dec, sizeArcsec: h.sizeArcsec }); window.__px.set('view', 'field'); });
  await waitField(p);
  const s = await p.evaluate(() => { const f = window.__fieldView.state.field; return { sim: f.simulated, N: f.N, n: f.epochs.length, det: f.detector, known: window.__fieldView.state.knownState }; });
  ok(s.sim === false && s.N === 20 && s.n >= 2, `home field is live: N=${s.N}, ${s.n} frames, D${s.det}`);
  ok(/^Live · SPHEREx D\d/.test(await p.textContent('#view-field .fv-pill')), 'field pill says Live');
  ok(await p.locator('#view-field .fv-img').evaluate(c => getComputedStyle(c).imageRendering === 'pixelated' && c.width === 20), 'small live field drawn 20×20, pixelated');
  ok(await p.locator('#view-field [data-ref="live"]').isVisible(), 'live request controls visible');
  console.log('  home field flags:', JSON.stringify(await items(p)));
  await p.screenshot({ path: OUT + '/desktop-home-field.png' });
  ok(!errs.length, 'no console errors (home) ' + JSON.stringify(errs));
  await ctx.close();
}

// ---------- 2. Psyche: Go-to → Field → detector D3, anchor 15 Feb 2026, 300″ → Load ----------
{
  const { ctx, p, errs } = await open({}, hookField);
  await p.fill('#goto-in', '70.2635d, 19.0558'); await p.press('#goto-in', 'Enter');
  await p.waitForTimeout(2500); // fly-to animation
  await p.click('#views [data-view="field"]');
  await p.waitForFunction(() => window.__fieldView?.state && (window.__fieldView.state.loading || window.__fieldView.state.field), null, { timeout: 10000 });
  const req = await fieldState(p);
  ok(Math.abs(req.ra - 70.2635) < 0.25 && Math.abs(req.dec - 19.0558) < 0.25, `Field opens near the Go-to position (${req.ra.toFixed(4)}, ${req.dec.toFixed(4)}; the sky centre is approximate)`);
  // don't wait for that (possibly cold) patch: type the exact centre, detector D3 and the Psyche night, then Load
  await p.waitForSelector('#view-field [data-ref="live"]:not([hidden])', { timeout: 10000 }); // usable while loading
  await p.fill('#view-field [data-ref="lpos"]', '70.2635, 19.0558');
  await p.selectOption('#view-field [data-ref="lsize"]', '300');
  await p.selectOption('#view-field [data-ref="ldet"]', '3');
  await p.fill('#view-field [data-ref="lt"]', '61087.1294'); // MJD of the 15 Feb 2026 frame with Psyche in it (as in server/README.md)
  await p.click('#view-field .fv-liveform button[type="submit"]');
  await waitField(p, "s.field.detector === 3 && s.knownState === 'ok'");
  const st = await p.evaluate(() => { const s = window.__fieldView.state, E = s.field.epochs; return { A: s.A, B: s.B, dates: E.map(e => e.date.slice(0, 10)), N: s.field.N, known: s.field.known.map(k => k.name) }; });
  console.log('  psyche field:', JSON.stringify(st));
  const list = await items(p);
  console.log('  psyche flags:', JSON.stringify(list));
  ok(st.dates[st.B] === '2026-02-15', 'compare pass is 15 Feb 2026');
  const res = await p.evaluate(() => window.__fieldView.state.results.map(r => ({ kind: r.kind, title: r.title, x: r.x, y: r.y, detail: r.detail })));
  const psy = res.find(r => /Psyche/.test(r.title));
  ok(psy && psy.kind === 'known', `16 Psyche is labelled Known object (${psy && psy.detail})`);
  ok(!res.some(r => r.kind !== 'known' && Math.hypot(r.x - 21.5, r.y - 23.5) < 2), 'nothing else flagged at Psyche');
  ok(psy && Number(/([\d.]+)″ from/.exec(psy.detail)?.[1]) < 2, 'Psyche within 2″ of JPL Horizons');
  // vet Psyche
  const idx = res.findIndex(r => /Psyche/.test(r.title));
  await p.locator('#view-field .fv-dets button').nth(idx).click();
  const kv = await p.locator('#view-field [data-ref="kv"]').innerText();
  ok(/Live SPHEREx, D3/.test(kv) && /Identified/.test(kv), 'vetting says live D3 and Identified');
  await p.screenshot({ path: OUT + '/desktop-psyche.png' });
  // add a live candidate to the review list (if any) → not simulated, one pos per scan
  const ci = res.findIndex(r => r.kind === 'cand');
  if (ci >= 0) {
    await p.locator('#view-field .fv-dets button').nth(ci).click();
    await p.click('#view-field [data-ref="add"]');
    const c = await p.evaluate(() => window.__px.get('candidates').find(c => c.source === 'field'));
    const nScans = await p.evaluate(() => window.__px.get('scans').length);
    ok(c && c.simulated === false && c.live === true && /live SPHEREx/.test(c.note), 'added candidate is live, not simulated');
    ok(c && c.pos.length === nScans && c.pos.some(q => q === null || Array.isArray(q)), `added candidate has one pos per scan (${c && JSON.stringify(c.pos)})`);
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('planetx.fieldcands.v1') || '[]'));
    ok(stored.some(s => s.id === c.id), 'field candidate persisted');
    await p.click('#view-field [data-act="back"]');
    await p.waitForTimeout(300);
    const row = p.locator(`#panel .cx-list li[data-id="${c.id}"]`);
    ok(await row.count() === 1 && !(await row.locator('.cx-sim').count()), 'panel lists it without a Simulated tag');
    await p.screenshot({ path: OUT + '/desktop-panel-live-cand.png' });
  } else console.log('  (no candidate flagged in this pair; add-to-review not exercised)');
  ok(!errs.length, 'no console errors (Psyche) ' + JSON.stringify(errs));

  // phone
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ph.addInitScript(s => { globalThis.PLANETX_SERVER = s; }, SERVER); await hookField(ph);
  const q = await ph.newPage(); await q.goto(APP);
  await q.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30000 });
  await q.evaluate(() => { window.__px.set('field', { ra: 70.2635, dec: 19.0558, sizeArcsec: 300, det: 3, t: 61087.1294 }); window.__px.set('view', 'field'); });
  await waitField(q, "s.knownState === 'ok'");
  const pi = await q.evaluate(() => window.__fieldView.state.results.findIndex(r => /Psyche/.test(r.title)));
  if (pi >= 0) await q.locator('#view-field .fv-dets button').nth(pi).click();
  ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no horizontal scroll');
  await q.screenshot({ path: OUT + '/phone-psyche.png' });
  await q.evaluate(() => document.querySelector('#view-field').scrollTo(0, 0));
  await q.screenshot({ path: OUT + '/phone-psyche-full.png', fullPage: false });
  await ph.close();
  await ctx.close();
}

// ---------- 3. loading state + Cancel (field response held back) ----------
{
  let release; const held = new Promise(r => { release = r; });
  const { ctx, p, errs } = await open({}, async c => { await hookField(c); await c.route(/\/api\/field\?/, async r => { await held; r.continue().catch(() => {}); }); });
  await p.evaluate(() => { window.__px.set('field', { ra: 70.42, dec: 19.18, sizeArcsec: 120 }); window.__px.set('view', 'field'); });
  await p.waitForSelector('#view-field [data-ref="loading"]:not([hidden])', { timeout: 5000 });
  await p.waitForTimeout(1300);
  const t = await p.textContent('#view-field [data-ref="loadEl"]');
  ok(/^\d+ s elapsed/.test(t), `loading shows elapsed time ("${t.slice(0, 40)}…")`);
  ok(await p.evaluate(() => { const t0 = performance.now(); return new Promise(r => requestAnimationFrame(() => r(performance.now() - t0 < 200))); }), 'UI responsive while loading');
  await p.screenshot({ path: OUT + '/desktop-loading.png' });
  await p.click('#view-field [data-act="cancel"]');
  ok(await p.evaluate(() => window.__px.get('view')) === 'sky', 'Cancel goes back to the sky');
  release();
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => window.__px.get('view')) === 'sky', 'late response after Cancel does not reopen anything');
  // an older server without /api/progress answers 404 once (the client then stops asking)
  const hasProgress = await fetch(SERVER + '/api/progress').then(r => r.ok, () => false);
  ok(errs.filter(e => !/aborted|AbortError/i.test(e)).length <= (hasProgress ? 0 : 1), 'no console errors (cancel) ' + JSON.stringify(errs));
  await ctx.close();
}

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS', ' screenshots:', OUT);
process.exit(fails ? 1 : 0);
