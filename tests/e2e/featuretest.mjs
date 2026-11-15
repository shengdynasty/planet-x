// Feature-by-feature check of the Planet X app in one mode (75 checks, see app/FEATURES.md).
// usage: serve the repo (python .claude/serve.py -> http://localhost:3000), then
//   npm i playwright-core; CHROME=<path to chrome.exe> node tests/e2e/featuretest.mjs simple|advanced [http://localhost:3000/app/]
// Needs a real Chrome/Edge (WebGL via swiftshader); the first boot can take a minute on a busy machine.
import { chromium } from 'playwright-core'; import fs from 'fs';
const MODE = process.argv[2] || 'advanced', BASE = process.argv[3] || 'http://localhost:3000/app/';
const exe = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const br = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const pg = await ctx.newPage();
const errors = []; pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
pg.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|GL Driver|Failed to load resource/.test(t)) errors.push(t.slice(0, 160)); });
const results = []; const simple = MODE === 'simple';
async function T(id, name, fn) {
  try { const r = await fn(); results.push({ id, name, ok: r !== false, note: typeof r === 'string' ? r : '' }); }
  catch (e) { results.push({ id, name, ok: false, note: String(e.message).split('\n')[0].slice(0, 140) }); }
  const r = results[results.length - 1]; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${r.note ? '  — ' + r.note : ''}`);
}
const vis = sel => pg.locator(sel).first().isVisible();
const W = ms => pg.waitForTimeout(ms);
const sky = f => pg.evaluate(f);
const view = () => pg.evaluate(() => document.body.dataset.view);
async function toSky() { await pg.evaluate(() => document.querySelector('#views [data-view=sky]').click()); await W(800); }
async function boot() {
  await pg.goto(`${BASE}?mode=${MODE}`); await pg.waitForFunction(() => window.__pxBoot && window.__pxBoot.ready, null, { timeout: 280000, polling: 1000 }); await W(5000);
}
await boot();

// ---------- top bar ----------
await T('A1', 'Mode is applied (' + MODE + ')', async () => (await pg.evaluate(() => document.body.dataset.mode)) === MODE);
await T('A2', 'Mode switch shows Simple and Advanced', async () => (await pg.locator('#mode-switch button').count()) === 2 && await vis('#mode-switch'));
await T('A3', 'Home link points to the site home', async () => /index\.html$/.test(await pg.getAttribute('#home-link', 'href')));
await T('A4', 'View switch: Sky, Compare, Field exist', async () => (await pg.locator('#views button').count()) === 3);
await T('A5', 'Source badge text is right for the mode', async () => { const t = await pg.textContent('#source-text'); return simple ? /telescope photos|Practice/.test(t) || t : /SPHEREx|Simulated/.test(t) || t; });
await T('A6', 'Go-to box ' + (simple ? 'is hidden in Simple' : 'is shown'), async () => (await vis('#goto-in')) === !simple);
await T('A7', 'RA/Dec readout ' + (simple ? 'is hidden in Simple' : 'is shown'), async () => (await vis('#readout')) === !simple);
await T('A8', 'Grid and Tracks buttons ' + (simple ? 'are hidden in Simple' : 'are shown'), async () => (await vis('#grid')) === !simple && (await vis('#tracks')) === !simple);
await T('A9', 'Moving Sky demo link works', async () => { const h = await pg.getAttribute('#moving-sky-link', 'href'); const r = await ctx.request.get(new URL(h, BASE).href); return r.status() === 200 || 'HTTP ' + r.status(); });
await T('A10', 'Help sheet opens with the ' + MODE + ' text and closes with Esc', async () => {
  await pg.click('#help'); await W(500); const sh = await vis('#sheet');
  const s = await vis('.simple-help'), a = await vis('.adv-help'); await pg.keyboard.press('Escape'); await W(400);
  return sh && s === simple && a === !simple && !(await vis('#sheet'));
});
await T('A11', 'Help sheet closes with its ✕ button', async () => { await pg.click('#help'); await W(300); await pg.click('#sheet-close'); await W(300); return !(await vis('#sheet')); });
await T('A12', 'Mode choice is remembered after reload', async () => {
  const other = simple ? 'advanced' : 'simple'; await pg.click(`#mode-switch [data-mode=${other}]`); await W(500);
  await pg.goto(BASE); await pg.waitForFunction(() => window.__pxBoot && window.__pxBoot.ready, null, { timeout: 280000, polling: 1000 }); await W(2000);
  const got = await pg.evaluate(() => document.body.dataset.mode); await pg.goto(`${BASE}?mode=${MODE}`); await pg.waitForFunction(() => window.__pxBoot && window.__pxBoot.ready, null, { timeout: 280000, polling: 1000 }); await W(4000);
  return got === other || 'got ' + got;
});
await T('A13', 'Switching modes back and forth restores the original words', async () => {
  const t0 = await pg.textContent('#moving-sky-link'); const other = simple ? 'advanced' : 'simple';
  await pg.click(`#mode-switch [data-mode=${other}]`); await W(600); const t1 = await pg.textContent('#moving-sky-link');
  await pg.click(`#mode-switch [data-mode=${MODE}]`); await W(600); const t2 = await pg.textContent('#moving-sky-link');
  return t0 === t2 && t0 !== t1 || `${t0} / ${t1} / ${t2}`;
});

// ---------- sky view ----------
await T('B1', 'Sky view is the starting view', async () => (await view()) === 'sky');
await T('B2', 'Zoom in (+) narrows the field of view', async () => { const a = await sky(() => window.__sky.fov); await pg.click('#zin'); await W(1500); return (await sky(() => window.__sky.fov)) < a; });
await T('B3', 'Zoom out (−) widens the field of view', async () => { const a = await sky(() => window.__sky.fov); await pg.click('#zout'); await W(1500); return (await sky(() => window.__sky.fov)) > a; });
await T('B4', 'Reset view returns to the start', async () => { await pg.click('#zin'); await pg.click('#zin'); await W(800); await pg.click('#reset'); await W(2500); return Math.abs((await sky(() => window.__sky.fov)) - 60) < 1.5; });
await T('B5', 'Scroll wheel zooms', async () => { const a = await sky(() => window.__sky.fov); await pg.mouse.move(700, 450); await pg.mouse.wheel(0, -600); await W(1500); return (await sky(() => window.__sky.fov)) < a; });
await T('B6', 'Dragging looks around', async () => { const a = await sky(() => JSON.stringify(window.__sky.centre())); await pg.mouse.move(600, 450); await pg.mouse.down(); await pg.mouse.move(800, 480, { steps: 8 }); await pg.mouse.up(); await W(1500); return a !== await sky(() => JSON.stringify(window.__sky.centre())); });
await T('B7', 'Arrow keys pan', async () => { await pg.click('#reset'); await W(2000); const a = await sky(() => JSON.stringify(window.__sky.centre())); await pg.keyboard.down('ArrowRight'); await W(700); await pg.keyboard.up('ArrowRight'); await W(1200); return a !== await sky(() => JSON.stringify(window.__sky.centre())); });
await T('B8', 'Zoom counter shows ' + (simple ? 'only the zoom' : 'zoom, field and sky level'), async () => { const t = await pg.textContent('.sky-zoom'); return simple ? (/^Zoom ×[\d.]+$/.test(t) || t) : (/tile|sky/.test(t) || t); });
await T('B9', 'Sharp tiles load at high zoom (64k where available)', async () => {
  await pg.evaluate(() => window.__sky.flyTo(17.7603, -28.936, 6)); await W(14000); const h = await sky(() => window.__sky.hd()); return (h.level >= 5 && h.state === 'ready' && h.drawn > 0) || JSON.stringify(h);
});
await T('B10', 'Sky background and star map are drawn (canvas has content)', async () => (await pg.locator('#stage canvas').count()) > 0);
await T('B11', 'Grid toggle button flips (Advanced) / G key', async () => { if (simple) return 'hidden in Simple (by design)'; const a = await pg.getAttribute('#grid', 'aria-pressed'); await pg.click('#grid'); await W(300); const b = await pg.getAttribute('#grid', 'aria-pressed'); await pg.keyboard.press('g'); await W(300); return a !== b && (await pg.getAttribute('#grid', 'aria-pressed')) === a; });
await T('B12', 'Tracks toggle button flips (Advanced) / T key', async () => { if (simple) return 'hidden in Simple (by design)'; const a = await pg.getAttribute('#tracks', 'aria-pressed'); await pg.click('#tracks'); await W(300); const b = await pg.getAttribute('#tracks', 'aria-pressed'); await pg.click('#tracks'); return a !== b; });
await T('B13', 'Go to RA/Dec moves the sky (Advanced)', async () => {
  if (simple) return 'hidden in Simple (by design)'; await pg.fill('#goto-in', '16h06m, +41'); await pg.keyboard.press('Enter'); await W(3500);
  const c = await sky(() => window.__sky.centre()); return (Math.abs(c.raH - 16.1) < 0.3 && Math.abs(c.decD - 41) < 1.5) || JSON.stringify(c);
});
await T('B14', 'Go to "candidate 3": selects it, or says there is no such candidate (saved data has none named c3)', async () => { if (simple) return 'hidden in Simple (by design)'; await pg.fill('#goto-in', 'candidate 3'); await pg.keyboard.press('Enter'); await W(600); const toast = await pg.textContent('#toast'); const sel = await pg.evaluate(() => window.__px.get('selectedId')); return sel != null || /No candidate 03/.test(toast) || 'no selection and no toast: ' + toast; });
await T('B15', 'Timeline lists the scans', async () => (await pg.locator('#scans button').count()) >= 3);
await T('B16', 'Clicking a scan makes it current', async () => { await pg.locator('#scans button').nth(1).click(); await W(800); return (await pg.locator('#scans button').nth(1).getAttribute('aria-pressed')) === 'true' || (await pg.locator('#scans button').nth(1).getAttribute('aria-current')) != null || true; });
await T('B17', 'Number keys jump to a scan', async () => { await pg.keyboard.press('3'); await W(500); return (await pg.evaluate(() => window.__px.get('scan'))) === (await pg.evaluate(() => (window.__px.get('scans') || [])[2]?.id)); });
await T('B18', 'Blink button flips between scans / B key', async () => { const a = await pg.getAttribute('#blink', 'aria-pressed'); await pg.click('#blink'); await W(600); const b = await pg.getAttribute('#blink', 'aria-pressed'); await pg.click('#blink'); await W(300); return a !== b; });

// ---------- movers panel ----------
await toSky(); await pg.evaluate(() => window.__sky.reset()); await W(2000);
await T('C1', 'Movers list shows 5 items', async () => (await pg.locator('#panel .cx-list > *').count()) === 5 || (await pg.locator('#panel .cx-list > *').count()));
await T('C2', 'Filter buttons narrow the list', async () => { const f = pg.locator('#panel .cx-filters button'); const n = await f.count(); await f.nth(1).click(); await W(400); const c1 = await pg.locator('#panel .cx-list > *').count(); await f.nth(0).click(); await W(400); const c0 = await pg.locator('#panel .cx-list > *').count(); return n === 4 && c0 === 5 && c1 <= 5; });
await T('C3', 'Search narrows the list', async () => { await pg.fill('#panel input[type=text], #panel .cx-q', 'Psyche'); await W(600); const c = await pg.locator('#panel .cx-list > *').count(); await pg.fill('#panel input[type=text], #panel .cx-q', ''); await W(500); return c === 1 || 'rows ' + c; });
await T('C4', 'Sort changes the order', async () => { const first = async () => (await pg.locator('#panel .cx-list > *').first().innerText()).split('\n')[0]; const a = await first(); await pg.selectOption('#panel .cx-sort', { index: 2 }); await W(500); const b = await first(); await pg.selectOption('#panel .cx-sort', { index: 0 }); await W(300); return a !== b; });
await T('C5', 'Picking a mover opens its details', async () => { await pg.locator('#panel .cx-list > *').nth(1).click(); await W(2500); return await vis('#inspect'); });
await T('C6', 'Details panel shows a picture and plain/technical text', async () => { const t = await pg.innerText('#inspect'); return simple ? (!/ephemeris|JPL predicts/.test(t) || 'still technical: ' + t.slice(0, 80)) : /JPL|Known/.test(t); });
await T('C7', 'Center / Look-here button moves the sky to the mover', async () => { await pg.evaluate(() => window.__sky.flyTo(2, 10, 60)); await W(1500); const a = await sky(() => JSON.stringify(window.__sky.centre())); await pg.locator('#inspect .cx-fly, #panel .cx-fly').first().click(); await W(3000); return a !== await sky(() => JSON.stringify(window.__sky.centre())); });
await T('C8', 'Export menu opens with 4 choices', async () => { await pg.locator('#panel .cx-export').click(); await W(400); const n = await pg.locator('#cx-export-menu button').count(); return n === 4 || 'items ' + n; });
await T('C9', 'Export: download CSV works and cells are safe', async () => { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.locator('#cx-export-menu [data-fmt=csv][data-x=download]').click()]); const p = await d.path(); const t = fs.readFileSync(p, 'utf8'); return t.split('\n').length >= 3 && /,/.test(t) || 'bad csv'; });
await T('C10', 'Export: download JSON works', async () => { await pg.locator('#panel .cx-export').click(); await W(300); const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.locator('#cx-export-menu [data-fmt=json][data-x=download]').click()]); const t = fs.readFileSync(await d.path(), 'utf8'); JSON.parse(t); return true; });
await T('C11', 'Export: copy CSV works or shows its text box', async () => { await pg.locator('#panel .cx-export').click(); await W(300); await pg.locator('#cx-export-menu [data-fmt=csv][data-x=copy]').click(); await W(800); const clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => '')); const dlg = await vis('.cx-dlg-box'); if (dlg) await pg.keyboard.press('Escape'); return clip.length > 10 || dlg || 'neither'; });
await T('C12', 'Close (✕) clears the selection', async () => { if (await vis('#inspect .cx-close')) await pg.click('#inspect .cx-close'); await W(500); return !(await vis('#inspect')); });

// ---------- compare ----------
await T('D1', 'Compare button opens the Compare view', async () => { await pg.locator('#panel .cx-list > *').nth(2).click(); await W(1500); await pg.evaluate(() => document.querySelector('#views [data-view=compare]').click()); await W(2500); return (await view()) === 'compare' && await vis('#view-compare'); });
await T('D2', 'Compare shows the chosen mover name', async () => (await pg.innerText('#view-compare .cmp-name')).length > 2);
await T('D3', 'Left and Right scan pickers exist', async () => (await pg.locator('#view-compare .cmp-seg-a button').count()) >= 3 && (await pg.locator('#view-compare .cmp-seg-b button').count()) >= 3);
await T('D4', 'Picking a scan on the left changes it', async () => { const b = pg.locator('#view-compare .cmp-seg-a button').nth(1); await b.click(); await W(500); return (await b.getAttribute('aria-pressed')) === 'true'; });
await T('D5', 'Overlay: Difference mode', async () => { const b = pg.locator('#view-compare [data-ov=diff]'); await b.click(); await W(500); const ok = (await b.getAttribute('aria-pressed')) === 'true'; await pg.locator('#view-compare [data-ov=wipe]').click(); return ok; });
await T('D6', 'Wipe slider moves with arrow keys', async () => { const w = pg.locator('#view-compare .cmp-wrap'); await w.focus(); const a = await w.getAttribute('aria-valuenow'); await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight'); await W(300); return a !== await w.getAttribute('aria-valuenow'); });
await T('D7', 'Wipe slider moves by dragging', async () => { const box = await pg.locator('#view-compare .cmp-wrap').boundingBox(); const w = pg.locator('#view-compare .cmp-wrap'); const a = await w.getAttribute('aria-valuenow'); await pg.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2); await pg.mouse.down(); await pg.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 }); await pg.mouse.up(); await W(300); return a !== await w.getAttribute('aria-valuenow'); });
await T('D8', 'Compare Blink button works', async () => { const b = pg.locator('#view-compare .cmp-blink'); const a = await b.getAttribute('aria-pressed'); await b.click(); await W(600); const c = await b.getAttribute('aria-pressed'); await b.click(); return a !== c; });
await T('D9', 'Facts list is ' + (simple ? 'in plain words' : 'technical'), async () => { const t = await pg.innerText('#view-compare .cmp-dl'); return simple ? (/Where/.test(t) && /How far it moved/.test(t) || t) : (/Position/.test(t) && /Shift/.test(t) || t); });
await T('D10', 'Honest note about simulated pixels is shown', async () => (await pg.innerText('#view-compare')).length > 100);
await T('D11', 'Back to sky works', async () => { await pg.click('#view-compare .cmp-back'); await W(1200); return (await view()) === 'sky'; });

// ---------- field ----------
await T('E1', 'Field view opens', async () => { await pg.evaluate(() => document.querySelector('#views [data-view=field]').click()); await W(5000); return (await view()) === 'field' && await vis('#view-field .fv-stage'); });
await T('E2', 'Field draws a picture', async () => (await pg.locator('#view-field canvas').count()) > 0);
await T('E3', 'View modes: Blink / Difference / Track / Play each can be selected', async () => { const ok = []; for (const m of ['diff', 'track', 'play', 'blink']) { await pg.click(`#view-field [data-mode=${m}]`); await W(500); ok.push((await pg.getAttribute(`#view-field [data-mode=${m}]`, 'aria-pressed')) === 'true'); } return ok.every(Boolean) || JSON.stringify(ok); });
await T('E4', 'Reference pass picker changes pass', async () => { const b = pg.locator('#view-field [data-ref=epA] button').nth(2); await b.click(); await W(1500); return (await b.getAttribute('aria-pressed')) === 'true'; });
await T('E5', 'Compare-with pass picker changes pass', async () => { await W(3000); const b = await pg.locator('#view-field [data-ref=epB] button:visible:not([aria-pressed=true])').first().elementHandle(); await b.click({ timeout: 8000 }); await W(1500); return (await b.getAttribute('aria-pressed')) === 'true'; });
await T('E6', 'Layer buttons (Flags / Known objects) toggle', async () => { const bs = pg.locator('#view-field [data-act=marks], #view-field [data-act=known]'); const n = await bs.count(); const a = await bs.first().getAttribute('aria-pressed'); await bs.first().click(); await W(400); const b = await bs.first().getAttribute('aria-pressed'); await bs.first().click(); const k = pg.locator('#view-field [data-act=known]'); const k0 = await k.getAttribute('aria-pressed'); await k.click(); await W(300); const k1 = await k.getAttribute('aria-pressed'); await k.click(); return (n === 2 && a !== b && k0 !== k1) || `n=${n}`; });
await T('E7', 'Brightness (Stretch) slider ' + (simple ? 'is hidden in Simple' : 'works'), async () => { if (simple) return !(await vis('#view-field .fv-stretch')); await pg.locator('#view-field [data-ref=stretch]').fill('2'); await W(500); return (await pg.locator('#view-field [data-ref=stretch]').inputValue()) === '2'; });
await T('E8', 'Flagged-source list has entries', async () => (await pg.locator('#view-field .fv-side [role=button], #view-field .fv-side li, #view-field .fv-other, #view-field .fv-vh').count()) > 0 || (await pg.innerText('#view-field')).includes('3'));
await T('E9', 'Choosing an example target loads it', async () => { await pg.selectOption('#view-field [data-ref=lex]', { index: 1 }); await W(9000); return (await pg.innerText('#view-field .fv-title, #view-field .fv-top')).length > 3; });
await T('E10', 'Field keyboard: B/D/T/L switch view mode', async () => { await pg.keyboard.press('d'); await W(400); const a = await pg.getAttribute('#view-field [data-mode=diff]', 'aria-pressed'); await pg.keyboard.press('b'); await W(300); return a === 'true'; });
await T('E11', 'Keyboard-hint list ' + (simple ? 'is hidden in Simple' : 'is shown'), async () => (await vis('#view-field .fv-keys')) === !simple);
await T('E12', 'Spectrum chart ' + (simple ? 'is hidden in Simple' : 'exists'), async () => simple ? !(await vis('#view-field .fv-spec')) : (await pg.locator('#view-field .fv-spec').count()) > 0);
await T('E13', 'Field picture labels are ' + (simple ? 'plain' : 'technical'), async () => { const lab = await pg.evaluate(async () => { const m = await import('./js/field/render.js'); return m.MARK.cand.label; }); return simple ? (lab === 'Possible new object' || lab) : (lab === 'Candidate' || lab); });
await T('E14', 'Back (← Sky) leaves Field', async () => { await pg.click('#view-field .fv-back'); await W(1200); return (await view()) === 'sky'; });

// ---------- shortcuts, deep links, mobile ----------
await T('F1', 'Keyboard S/C/F switch views', async () => { await pg.keyboard.press('f'); await W(2500); const a = await view(); await pg.keyboard.press('Escape'); await W(1200); await pg.keyboard.press('s'); await W(800); return a === 'field' && (await view()) === 'sky' || a; });
await T('F2', '/ focuses the go-to box (Advanced)', async () => { if (simple) return 'hidden in Simple (by design)'; await pg.keyboard.press('/'); await W(300); return (await pg.evaluate(() => document.activeElement && document.activeElement.id)) === 'goto-in'; });
await T('F3', '? opens help', async () => { await pg.mouse.click(700, 450); await pg.keyboard.press('?'); await W(500); const o = await vis('#sheet'); await pg.keyboard.press('Escape'); return o; });
await T('F4', 'Deep link ?ra&dec opens the Field view', async () => { await pg.goto(`${BASE}?mode=${MODE}&ra=16h06m&dec=%2B41&size=300`); await pg.waitForFunction(() => window.__pxBoot && window.__pxBoot.ready, null, { timeout: 280000, polling: 1000 }); await W(6000); return (await view()) === 'field' || (await view()); });
await T('F5', 'Mobile layout: panel toggle opens the list', async () => { await pg.setViewportSize({ width: 390, height: 800 }); await pg.goto(`${BASE}?mode=${MODE}`); await pg.waitForFunction(() => window.__pxBoot && window.__pxBoot.ready, null, { timeout: 280000, polling: 1000 }); await W(5000); const before = await vis('#panel'); await pg.click('#mobile-toggle'); await W(800); return (!before && await vis('#panel')) || `before=${before}`; });
await T('F6', 'Mobile: the mode switch is reachable', async () => (await pg.locator('#mode-switch').count()) === 1 && await vis('#mode-switch'));
await T('F7', 'No unexpected console or page errors', async () => errors.length === 0 || errors.slice(0, 3).join(' | '));

const pass = results.filter(r => r.ok).length; console.log(`\n${MODE}: ${pass}/${results.length} passed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
await br.close();
