// Feature-by-feature check of the app as the hosted copy shows it (saved SPHEREx data, no live server), once in
// Advanced and once in Simple mode: 75 checks per mode, listed in app/FEATURES.md. Ported from the Windows-only
// tests/e2e/featuretest.mjs onto tests/browser.mjs, so it runs on any machine with Chrome.
//   node tests/features.test.mjs                 # both modes (about 6 minutes)
//   node tests/features.test.mjs simple          # one mode
//   node tests/features.test.mjs --md > table.md # also print the FEATURES.md tables after the run
// Strict: a check passes only by returning true. A string is a failure note, except 'hidden in Simple (by design)',
// which is counted separately; a thrown error fails with its message. Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, SCRATCH } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8111), BASE = `http://127.0.0.1:${PORT}/app/`;
const argv = process.argv.slice(2), MD = argv.includes('--md');
const MODES = argv.filter(a => a === 'simple' || a === 'advanced');
const OUT = process.env.SHOTS || path.join(SCRATCH, 'features');
fs.mkdirSync(OUT, { recursive: true });

const srv = await serve(PORT, ROOT);
const cleanup = () => { try { srv && srv.kill(); } catch {} };
process.on('exit', cleanup);
const browser = await launch();
const all = {}; // mode -> results

for (const MODE of MODES.length ? MODES : ['advanced', 'simple']) {
  const simple = MODE === 'simple', results = [];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  // the hosted configuration: no live server, so the app falls back to the saved snapshots in app/data/snapshots
  await ctx.route(/^http:\/\/(localhost|127\.0\.0\.1):8787\//, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"ok":false,"note":"blocked by test"}' }));
  const pg = await ctx.newPage();
  const errors = []; pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
  pg.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|net::ERR_FAILED|GL Driver|Failed to load resource/.test(t)) errors.push(t.slice(0, 160)); });

  async function T(id, name, fn) {
    let r, note = '';
    try { r = await fn(); } catch (e) { r = false; note = String(e.message).split('\n')[0].slice(0, 160); }
    const status = r === true ? 'pass' : (typeof r === 'string' && /^hidden/.test(r)) ? 'hidden' : 'fail';
    if (status !== 'pass' && !note) note = typeof r === 'string' ? r : `returned ${JSON.stringify(r)}`;
    results.push({ id, name, status, note });
    console.log(`${{ pass: 'PASS', hidden: 'SKIP', fail: 'FAIL' }[status]}  ${id}  ${name}${note && status !== 'pass' ? '  — ' + note : ''}`);
  }
  const vis = sel => pg.locator(sel).first().isVisible();
  const W = ms => pg.waitForTimeout(ms);
  const sky = f => pg.evaluate(f);
  const view = () => pg.evaluate(() => document.body.dataset.view);
  const url = q => `${BASE}?${q}`;
  const booted = () => pg.waitForFunction(() => document.documentElement.dataset.ready === 'true' && window.__pxBoot && window.__pxBoot.ready, null, { timeout: 60000 });
  async function go(q) { await pg.goto(url(q), { waitUntil: 'load' }); await booted(); await W(1500); }
  async function toSky() { await pg.evaluate(() => document.querySelector('#views [data-view=sky]').click()); await W(800); }
  const hiddenByDesign = async sel => (await vis(sel)) === false ? 'hidden in Simple (by design)' : `${sel} is visible in Simple`;
  const rows = () => pg.locator('#panel .cx-list > *');
  const centre = () => sky(() => JSON.stringify(window.__sky.centre()));
  console.log(`\n=== ${MODE}`);
  await go(`mode=${MODE}`);

  // ---------- top bar ----------
  await T('A1', 'Mode is applied', async () => (await pg.evaluate(() => document.body.dataset.mode)) === MODE);
  await T('A2', 'Mode switch shows Simple and Advanced', async () => (await pg.locator('#mode-switch button').count()) === 2 && await vis('#mode-switch'));
  await T('A3', 'Home link points to the site home', async () => /index\.html$/.test(await pg.getAttribute('#home-link', 'href')));
  await T('A4', 'View switch: Sky, Compare, Field exist', async () => (await pg.locator('#views button').count()) === 3);
  await T('A5', 'Source badge names the saved data in the mode\'s words', async () => { const t = await pg.textContent('#source-text'); return simple ? /Real telescope photos/.test(t) : /Saved SPHEREx data/.test(t); });
  await T('A6', 'Go-to box: shown in Advanced, hidden in Simple', async () => (await vis('#goto-in')) === !simple);
  await T('A7', 'RA/Dec readout: shown in Advanced, hidden in Simple', async () => (await vis('#readout')) === !simple);
  await T('A8', 'Grid and Tracks buttons: shown in Advanced, hidden in Simple', async () => (await vis('#grid')) === !simple && (await vis('#tracks')) === !simple);
  await T('A10', 'Help sheet opens with the mode\'s text and closes with Esc', async () => {
    await pg.click('#help'); await W(500); const sh = await vis('#sheet');
    const s = await vis('.simple-help'), a = await vis('.adv-help'); await pg.keyboard.press('Escape'); await W(400);
    return sh && s === simple && a === !simple && !(await vis('#sheet'));
  });
  await T('A11', 'Help sheet closes with its ✕ button', async () => { await pg.click('#help'); await W(300); await pg.click('#sheet-close'); await W(300); return !(await vis('#sheet')); });
  await T('A12', 'Mode choice is remembered after reload', async () => {
    const other = simple ? 'advanced' : 'simple'; await pg.click(`#mode-switch [data-mode=${other}]`); await W(500);
    await pg.goto(BASE, { waitUntil: 'load' }); await booted(); await W(1000);
    const got = await pg.evaluate(() => document.body.dataset.mode);
    await go(`mode=${MODE}`);
    return got === other;
  });
  await T('A13', 'Switching modes back and forth restores the original words', async () => {
    const t0 = await pg.textContent('#views [data-view=field]'); const other = simple ? 'advanced' : 'simple'; // Field / Close-up
    await pg.click(`#mode-switch [data-mode=${other}]`); await W(600); const t1 = await pg.textContent('#views [data-view=field]');
    await pg.click(`#mode-switch [data-mode=${MODE}]`); await W(600); const t2 = await pg.textContent('#views [data-view=field]');
    return t0 === t2 && t0 !== t1;
  });

  // ---------- sky view ----------
  await T('B1', 'Sky view is the starting view', async () => (await view()) === 'sky');
  await T('B2', 'Zoom in (+) narrows the field of view', async () => { const a = await sky(() => window.__sky.fov); await pg.click('#zin'); await W(1500); return (await sky(() => window.__sky.fov)) < a; });
  await T('B3', 'Zoom out (−) widens the field of view', async () => { const a = await sky(() => window.__sky.fov); await pg.click('#zout'); await W(1500); return (await sky(() => window.__sky.fov)) > a; });
  await T('B4', 'Reset view returns to the start', async () => { await pg.click('#zin'); await pg.click('#zin'); await W(800); await pg.click('#reset'); await W(2500); return Math.abs((await sky(() => window.__sky.fov)) - 60) < 1.5; });
  await T('B5', 'Scroll wheel zooms', async () => { const a = await sky(() => window.__sky.fov); await pg.mouse.move(700, 450); await pg.mouse.wheel(0, -600); await W(1500); return (await sky(() => window.__sky.fov)) < a; });
  await T('B6', 'Dragging looks around', async () => { const a = await centre(); await pg.mouse.move(600, 450); await pg.mouse.down(); await pg.mouse.move(800, 480, { steps: 8 }); await pg.mouse.up(); await W(1500); return a !== await centre(); });
  await T('B7', 'Arrow keys pan', async () => { await pg.click('#reset'); await W(2000); const a = await centre(); await pg.keyboard.down('ArrowRight'); await W(700); await pg.keyboard.up('ArrowRight'); await W(1200); return a !== await centre(); });
  await T('B9', 'Sharp tiles load at the zoom limit (level 5 or the 64k level 6)', async () => {
    await pg.evaluate(() => window.__sky.flyTo(17.7603, -28.936, 6)); // galactic centre, RA in hours
    await pg.waitForFunction(() => { const h = window.__sky.hd(); return h.state === 'ready' && h.level >= 5 && h.loading === 0 && h.drawn > 0; }, null, { timeout: 60000 }).catch(() => {});
    const h = await sky(() => window.__sky.hd()); return h.state === 'ready' && h.level >= 5 && h.drawn > 0;
  });
  await T('B10', 'Sky canvas is present', async () => (await pg.locator('#stage canvas').count()) > 0);
  await T('B11', 'Grid toggle flips by button and by G key (Advanced)', async () => { if (simple) return hiddenByDesign('#grid'); const a = await pg.getAttribute('#grid', 'aria-pressed'); await pg.click('#grid'); await W(300); const b = await pg.getAttribute('#grid', 'aria-pressed'); await pg.keyboard.press('g'); await W(300); return a !== b && (await pg.getAttribute('#grid', 'aria-pressed')) === a; });
  await T('B12', 'Tracks toggle flips (Advanced)', async () => { if (simple) return hiddenByDesign('#tracks'); const a = await pg.getAttribute('#tracks', 'aria-pressed'); await pg.click('#tracks'); await W(300); const b = await pg.getAttribute('#tracks', 'aria-pressed'); await pg.click('#tracks'); return a !== b; });
  await T('B13', 'Go to RA/Dec moves the sky (Advanced)', async () => {
    if (simple) return hiddenByDesign('#goto-in'); await pg.fill('#goto-in', '16h06m, +41'); await pg.keyboard.press('Enter'); await W(3500);
    const c = await sky(() => window.__sky.centre()); return Math.abs(c.raH - 16.1) < 0.3 && Math.abs(c.decD - 41) < 1.5;
  });
  await T('B14', 'Go to "candidate 3" selects it or says there is no such candidate (Advanced)', async () => { if (simple) return hiddenByDesign('#goto-in'); await pg.fill('#goto-in', 'candidate 3'); await pg.keyboard.press('Enter'); await W(600); const toast = await pg.textContent('#toast'); const sel = await pg.evaluate(() => window.__px.get('selectedId')); return sel != null || /No candidate/.test(toast); });
  await T('B15', 'Timeline lists the scans', async () => (await pg.locator('#scans button').count()) >= 3);
  await T('B16', 'Clicking a scan makes it current', async () => { await pg.locator('#scans button').nth(1).click(); await W(800); return await pg.evaluate(() => window.__px.get('scan') === (window.__px.get('scans') || [])[1]?.id); });
  await T('B17', 'Number keys jump to a scan', async () => { await pg.mouse.click(700, 450); await pg.keyboard.press('3'); await W(500); return await pg.evaluate(() => window.__px.get('scan') === (window.__px.get('scans') || [])[2]?.id); });
  await T('B18', 'Blink button flips between scans', async () => { const a = await pg.getAttribute('#blink', 'aria-pressed'); await pg.click('#blink'); await W(600); const b = await pg.getAttribute('#blink', 'aria-pressed'); await pg.click('#blink'); await W(300); return a !== b; });

  // ---------- movers panel ----------
  await toSky(); await pg.evaluate(() => window.__sky.reset()); await W(2000);
  const total = await rows().count();
  await T('C1', 'Movers list shows every candidate in the store', async () => total > 0 && total === await pg.evaluate(() => (window.__px.get('candidates') || []).length));
  await T('C2', 'Filter buttons narrow the list', async () => { const f = pg.locator('#panel .cx-filters button'); const n = await f.count(); await f.nth(1).click(); await W(400); const c1 = await rows().count(); await f.nth(0).click(); await W(400); const c0 = await rows().count(); return n === 4 && c0 === total && c1 <= total; });
  await T('C3', 'Search narrows the list', async () => { const word = (await rows().first().innerText()).split(/\s+/).find(w => w.length > 3) || 'a'; await pg.fill('#panel .cx-q', word); await W(600); const c = await rows().count(); await pg.fill('#panel .cx-q', 'zzzzqq'); await W(500); const none = await rows().count(); await pg.fill('#panel .cx-q', ''); await W(500); return c >= 1 && c <= total && none === 0 && (await rows().count()) === total; });
  await T('C4', 'Sort changes the order', async () => { const order = () => rows().allInnerTexts(); const a = await order(); await pg.selectOption('#panel .cx-sort', { index: 2 }); await W(500); const b = await order(); await pg.selectOption('#panel .cx-sort', { index: 0 }); await W(300); return a.length === b.length && a.join() !== b.join(); });
  await T('C5', 'Picking a mover opens its details', async () => { await rows().nth(1).click(); await W(2500); return await vis('#inspect'); });
  await T('C6', 'Details panel is in the mode\'s words', async () => { const t = await pg.innerText('#inspect'); return simple ? !/ephemeris|JPL predicts/.test(t) : /JPL|Known|Candidate|Matched/.test(t); });
  await T('C7', 'Center / Look-here button moves the sky to the mover', async () => { await pg.evaluate(() => window.__sky.flyTo(2, 10, 60)); await W(1500); const a = await centre(); await pg.locator('#inspect .cx-fly, #panel .cx-fly').first().click(); await W(3000); return a !== await centre(); });
  await T('C8', 'Export menu opens with 4 choices', async () => { await pg.locator('#panel .cx-export').click(); await W(400); return (await pg.locator('#cx-export-menu button').count()) === 4; });
  await T('C9', 'Export: download CSV works', async () => { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.locator('#cx-export-menu [data-fmt=csv][data-x=download]').click()]); const t = fs.readFileSync(await d.path(), 'utf8'); return t.split('\n').length >= 2 && /,/.test(t); });
  await T('C10', 'Export: download JSON works', async () => { await pg.locator('#panel .cx-export').click(); await W(300); const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.locator('#cx-export-menu [data-fmt=json][data-x=download]').click()]); JSON.parse(fs.readFileSync(await d.path(), 'utf8')); return true; });
  await T('C11', 'Export: copy CSV writes the clipboard or shows its text box', async () => { await pg.locator('#panel .cx-export').click(); await W(300); await pg.locator('#cx-export-menu [data-fmt=csv][data-x=copy]').click(); await W(800); const clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => '')); const dlg = await vis('.cx-dlg-box'); if (dlg) await pg.keyboard.press('Escape'); return clip.length > 10 || dlg; });
  await T('C12', 'Close (✕) clears the selection', async () => { if (await vis('#inspect .cx-close')) await pg.click('#inspect .cx-close'); await W(500); return !(await vis('#inspect')); });

  // ---------- compare ----------
  await T('D1', 'Compare button opens the Compare view', async () => { await rows().nth(2).click(); await W(1500); await pg.evaluate(() => document.querySelector('#views [data-view=compare]').click()); await W(2500); return (await view()) === 'compare' && await vis('#view-compare'); });
  await T('D2', 'Compare shows the chosen mover name', async () => (await pg.innerText('#view-compare .cmp-name')).length > 2);
  await T('D3', 'Left and Right scan pickers exist', async () => (await pg.locator('#view-compare .cmp-seg-a button').count()) >= 3 && (await pg.locator('#view-compare .cmp-seg-b button').count()) >= 3);
  await T('D4', 'Picking a scan on the left changes it', async () => { const b = pg.locator('#view-compare .cmp-seg-a button').nth(1); await b.click(); await W(500); return (await b.getAttribute('aria-pressed')) === 'true'; });
  await T('D5', 'Overlay: Difference mode', async () => { const b = pg.locator('#view-compare [data-ov=diff]'); await b.click(); await W(500); const on = (await b.getAttribute('aria-pressed')) === 'true'; await pg.locator('#view-compare [data-ov=wipe]').click(); return on; });
  await T('D6', 'Wipe slider moves with arrow keys', async () => { const w = pg.locator('#view-compare .cmp-wrap'); await w.focus(); const a = await w.getAttribute('aria-valuenow'); await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight'); await W(300); return a !== await w.getAttribute('aria-valuenow'); });
  await T('D7', 'Wipe slider moves by dragging', async () => { const w = pg.locator('#view-compare .cmp-wrap'); const box = await w.boundingBox(); const a = await w.getAttribute('aria-valuenow'); await pg.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2); await pg.mouse.down(); await pg.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 }); await pg.mouse.up(); await W(300); return a !== await w.getAttribute('aria-valuenow'); });
  await T('D8', 'Compare Blink button works', async () => { const b = pg.locator('#view-compare .cmp-blink'); const a = await b.getAttribute('aria-pressed'); await b.click(); await W(600); const c = await b.getAttribute('aria-pressed'); await b.click(); return a !== c; });
  await T('D9', 'Facts list is in the mode\'s words', async () => { const t = await pg.innerText('#view-compare .cmp-dl'); return simple ? /Where/.test(t) && /How far it moved/.test(t) : /Position/.test(t) && /Shift/.test(t); });
  await T('D10', 'Honest note about the cutout pixels is shown', async () => (await pg.locator('#view-compare .cmp-honest').count()) > 0 && (await pg.locator('#view-compare .cmp-honest').first().innerText()).length > 20);
  await T('D11', 'Back to sky works', async () => { await pg.click('#view-compare .cmp-back'); await W(1200); return (await view()) === 'sky'; });

  // ---------- field ----------
  await T('E1', 'Field view opens', async () => { await pg.evaluate(() => document.querySelector('#views [data-view=field]').click()); await pg.waitForFunction(() => window.__px.get('view') === 'field' && document.querySelector('#view-field [data-ref=pos]')?.textContent.length > 5, null, { timeout: 30000 }).catch(() => {}); await W(1500); return (await view()) === 'field' && await vis('#view-field .fv-stage'); });
  await T('E2', 'Field draws a picture', async () => (await pg.locator('#view-field canvas').count()) > 0);
  await T('E3', 'View modes: Blink / Difference / Track / Stack / Play each can be selected', async () => { const ok = []; for (const m of ['diff', 'track', 'stack', 'play', 'blink']) { await pg.click(`#view-field [data-mode=${m}]`); await W(400); ok.push((await pg.getAttribute(`#view-field [data-mode=${m}]`, 'aria-pressed')) === 'true'); } return ok.every(Boolean); });
  await T('E4', 'Reference pass picker changes pass', async () => { const b = pg.locator('#view-field [data-ref=epA] button').nth(1); await b.click(); await W(1500); return (await b.getAttribute('aria-pressed')) === 'true'; });
  await T('E5', 'Compare-with pass picker changes pass', async () => { const i = await pg.evaluate(() => [...document.querySelectorAll('#view-field [data-ref=epB] button')].findIndex(b => b.getAttribute('aria-pressed') !== 'true')); if (i < 0) return 'no unpressed compare pass to pick'; const b = pg.locator('#view-field [data-ref=epB] button').nth(i); await b.click({ timeout: 8000 }); await W(1500); return (await b.getAttribute('aria-pressed')) === 'true'; });
  await T('E6', 'Layer buttons (Flags / Known objects) toggle', async () => { const m = pg.locator('#view-field [data-act=marks]'), k = pg.locator('#view-field [data-act=known]'); const a = await m.getAttribute('aria-pressed'); await m.click(); await W(300); const b = await m.getAttribute('aria-pressed'); await m.click(); const k0 = await k.getAttribute('aria-pressed'); await k.click(); await W(300); const k1 = await k.getAttribute('aria-pressed'); await k.click(); return a !== b && k0 !== k1; });
  await T('E7', 'Brightness (Stretch) slider: works in Advanced, hidden in Simple', async () => { if (simple) return !(await vis('#view-field .fv-stretch:not(.fv-stackall)')); await pg.locator('#view-field [data-ref=stretch]').fill('2'); await W(500); return (await pg.locator('#view-field [data-ref=stretch]').inputValue()) === '2'; });
  await T('E8', 'Flagged-source list has entries', async () => (await pg.locator('#view-field .fv-dets button').count()) > 0);
  await T('E9', 'Choosing an example target loads it', async () => { const before = await pg.locator('#view-field [data-ref=pos]').innerText(); await pg.selectOption('#view-field [data-ref=lex]', { index: 2 }); await pg.waitForFunction(b => document.querySelector('#view-field [data-ref=pos]').textContent !== b, before, { timeout: 30000 }).catch(() => {}); await W(1000); return (await pg.locator('#view-field [data-ref=pos]').innerText()) !== before; });
  await T('E10', 'Field keyboard: D switches to Difference, B back to Blink', async () => { await pg.mouse.click(700, 450); await pg.keyboard.press('d'); await W(400); const a = await pg.getAttribute('#view-field [data-mode=diff]', 'aria-pressed'); await pg.keyboard.press('b'); await W(300); return a === 'true' && (await pg.getAttribute('#view-field [data-mode=blink]', 'aria-pressed')) === 'true'; });
  await T('E11', 'Keyboard-hint list: shown in Advanced, hidden in Simple', async () => (await vis('#view-field .fv-keys')) === !simple);
  await T('E12', 'Spectrum chart: present in Advanced, hidden in Simple', async () => { await pg.locator('#view-field .fv-dets button').first().click(); await W(600); return simple ? !(await vis('#view-field .fv-spec')) : (await pg.locator('#view-field .fv-spec').count()) > 0; });
  await T('E13', 'Field picture labels are in the mode\'s words', async () => { const lab = await pg.evaluate(async () => { const m = await import('./js/field/render.js'); return m.MARK.cand.label; }); return simple ? lab === 'Possible new object' : lab === 'Candidate'; });
  await T('E14', 'Back (← Sky) leaves Field', async () => { await pg.click('#view-field .fv-back'); await W(1200); return (await view()) === 'sky'; });

  // ---------- shortcuts, deep links, mobile ----------
  await T('F1', 'Keyboard F opens Field, Esc and S return to Sky', async () => { await pg.mouse.click(700, 450); await pg.keyboard.press('f'); await W(2500); const a = await view(); await pg.keyboard.press('Escape'); await W(1200); await pg.keyboard.press('s'); await W(800); return a === 'field' && (await view()) === 'sky'; });
  await T('F2', '/ focuses the go-to box (Advanced)', async () => { if (simple) return hiddenByDesign('#goto-in'); await pg.mouse.click(700, 450); await pg.keyboard.press('/'); await W(300); return (await pg.evaluate(() => document.activeElement && document.activeElement.id)) === 'goto-in'; });
  await T('F3', '? opens help', async () => { await pg.mouse.click(700, 450); await pg.keyboard.press('?'); await W(500); const o = await vis('#sheet'); await pg.keyboard.press('Escape'); return o; });
  await T('F4', 'Deep link ?ra&dec opens the Field view', async () => { await pg.goto(url(`mode=${MODE}&ra=16h06m&dec=%2B41&size=300`), { waitUntil: 'load' }); await booted(); await pg.waitForFunction(() => window.__px.get('view') === 'field', null, { timeout: 30000 }).catch(() => {}); return (await view()) === 'field'; });
  await T('F5', 'Mobile layout: panel toggle opens the list', async () => { await pg.setViewportSize({ width: 390, height: 800 }); await go(`mode=${MODE}`); const before = await vis('#panel'); await pg.click('#mobile-toggle'); await W(800); return !before && await vis('#panel'); });
  await T('F6', 'Mobile: the mode switch is reachable', async () => (await pg.locator('#mode-switch').count()) === 1 && await vis('#mode-switch'));
  await pg.screenshot({ path: path.join(OUT, `${MODE}-phone.png`) });
  await T('F7', 'No unexpected console or page errors', async () => errors.length === 0 ? true : [...new Set(errors)].slice(0, 3).join(' | '));

  const n = s => results.filter(r => r.status === s).length;
  console.log(`\n${MODE}: ${n('pass')} pass, ${n('hidden')} hidden by design, ${n('fail')} fail of ${results.length}`);
  all[MODE] = results;
  await ctx.close();
}
await browser.close(); cleanup();

if (MD && all.advanced && all.simple) {
  const SECTIONS = { A: 'Top bar and help', B: 'Sky view', C: 'Movers panel and export', D: 'Compare view', E: 'Field (close-up) view', F: 'Shortcuts, links and phones' };
  const cell = r => r.status === 'pass' ? 'pass' : r.status === 'hidden' ? 'hidden by design' : `**fail** (${r.note})`;
  for (const [k, title] of Object.entries(SECTIONS)) {
    console.log(`\n## ${title}\n\n| ID | Feature | Advanced | Simple |\n|---|---|---|---|`);
    for (const a of all.advanced.filter(r => r.id[0] === k)) { const s = all.simple.find(r => r.id === a.id); console.log(`| ${a.id} | ${a.name} | ${cell(a)} | ${s ? cell(s) : '–'} |`); }
  }
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(all, null, 1));
const failed = Object.values(all).flat().filter(r => r.status === 'fail').length;
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
