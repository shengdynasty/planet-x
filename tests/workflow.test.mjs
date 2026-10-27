// Candidate review panel (workflow) — headless Chrome against app/dev/candidates.html.
// Run from the repo root:  node tests/workflow.test.mjs
// Serves the repo on 127.0.0.1:8104 itself (reuses a server already listening there). Screenshots go to the scratchpad.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRATCH = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const { chromium } = await import(`${SCRATCH}/pw/node_modules/playwright-core/index.mjs`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8104, URL_ = `http://127.0.0.1:${PORT}/app/dev/candidates.html`;
const SHOTS = path.join(SCRATCH, 'shots', 'workflow');
mkdirSync(SHOTS, { recursive: true });

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

// ---------- server ----------
async function up() { try { return (await fetch(URL_)).ok; } catch { return false; } }
let server = null;
if (!(await up())) {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// Hermetic: never talk to a live data server on :8787 (tests/live.test.mjs covers live mode).
{ const nc = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await nc(o); await c.route(/^http:\/\/(localhost|127\.0\.0\.1):8787\//, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"ok":false,"note":"blocked by test"}' })); return c; }; }


function watch(page, errors) {
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
}
const ids = page => page.$$eval('#panel [role="option"]', els => els.map(e => e.dataset.id));
const sel = page => page.evaluate(() => window.__px.get('selectedId'));
const cand = (page, id) => page.evaluate(id => window.__px.get('candidates').find(c => c.id === id), id);

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\r') { /* part of CRLF */ }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

try {
  // =============== desktop, functional ===============
  console.log('desktop');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${PORT}` });
  const page = await ctx.newPage();
  const errors = []; watch(page, errors);
  await page.goto(URL_);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#panel [role="option"]');

  eq(await ids(page), ['c01', 'c02', 'c03', 'c04', 'c05', 'c06'], 'six placeholder movers listed');
  eq((await page.textContent('#panel .cx-count')).trim(), '6', 'count shows 6');
  ok(await page.$eval('#panel .cx-list', e => e.getAttribute('role') === 'listbox'), 'list is a listbox');
  eq(await page.$$eval('#panel .cx-list .cx-sim', els => els.length), 6, 'every simulated row carries a "Simulated" label');

  // filter
  await page.click('#panel .cx-filters > button[data-f="Candidate"]');
  eq(await ids(page), ['c03', 'c06'], 'Unmatched filter');
  eq((await page.textContent('#panel .cx-count')).trim(), '2 of 6', 'count shows filtered total');
  await page.click('#panel .cx-filters > button[data-f="Matched"]');
  eq(await ids(page), ['c01', 'c02', 'c04'], 'Matched filter');
  await page.click('#panel .cx-filters > button[data-f="Likely"]');
  eq(await ids(page), ['c05'], 'Likely filter');
  await page.fill('#panel .cx-q', 'zzz');
  ok(await page.isVisible('#panel .cx-empty'), 'empty state for an empty filter');
  ok(/Nothing matches/.test(await page.textContent('#panel .cx-empty')), 'empty state message');
  await page.click('#panel .cx-clear');
  eq((await ids(page)).length, 6, '"Clear filters" restores the full list');

  // sort
  await page.selectOption('#panel .cx-sort', 'shift');
  eq(await ids(page), ['c06', 'c03', 'c05', 'c02', 'c01', 'c04'], 'sort by shift (slowest first)');
  await page.selectOption('#panel .cx-sort', 'band');
  eq(await ids(page), ['c04', 'c01', 'c02', 'c05', 'c03', 'c06'], 'sort by peak band');
  await page.selectOption('#panel .cx-sort', 'status');
  eq(await ids(page), ['c03', 'c06', 'c05', 'c01', 'c02', 'c04'], 'sort by status');
  await page.selectOption('#panel .cx-sort', 'id');

  // search
  await page.fill('#panel .cx-q', 'comet');
  eq(await ids(page), ['c02'], 'search "comet"');
  await page.fill('#panel .cx-q', 'slow mover');
  eq(await ids(page), ['c03', 'c06'], 'search "slow mover" (multi-word)');
  await page.fill('#panel .cx-q', 'zzzz');
  ok(await page.isVisible('#panel .cx-empty'), 'empty state for no search hits');
  await page.fill('#panel .cx-q', '');
  eq((await ids(page)).length, 6, 'clearing search restores list');

  // keyboard
  await page.focus('#panel [role="option"][tabindex="0"]');
  eq(await page.$$eval('#panel [role="option"][tabindex="0"]', e => e.length), 1, 'exactly one option in the tab order (roving tabindex)');
  await page.keyboard.press('ArrowDown');
  eq(await sel(page), 'c02', 'ArrowDown selects next');
  eq(await page.evaluate(() => document.activeElement.dataset.id), 'c02', 'focus follows');
  await page.keyboard.press('End');
  eq(await sel(page), 'c06', 'End');
  await page.keyboard.press('ArrowUp');
  eq(await sel(page), 'c05', 'ArrowUp');
  await page.keyboard.press('Home');
  eq(await sel(page), 'c01', 'Home');
  eq(await page.getAttribute('#cx-opt-c01', 'aria-selected'), 'true', 'aria-selected on the selected option');
  const nEv = await page.evaluate(() => window.__events.filter(e => e[0] === 'flyto').length);
  await page.keyboard.press('Enter');
  const fly = await page.evaluate(() => window.__events.filter(e => e[0] === 'flyto').pop());
  ok(await page.evaluate(n => window.__events.filter(e => e[0] === 'flyto').length === n + 1, nEv), 'Enter emits flyto');
  ok(fly && Math.abs(fly[1].ra - 4.55 * 15) < 1e-9 && fly[1].dec === 9.2, 'flyto at the active scan position (deg)');
  // announce is debounced 40 ms, and the software renderer can hold the main thread well past that
  ok(await page.waitForFunction(() => /Candidate 01 selected/.test(document.getElementById('announce').textContent), null, { timeout: 3000 }).then(() => true, () => false), 'selection announced in #announce');

  // detail card
  await page.click('#cx-opt-c03');
  eq(await page.textContent('#cx-d-name'), 'Candidate 03', 'click selects; detail card shows');
  ok(await page.isVisible('.cx-insp .cx-dhead .cx-sim'), 'detail shows "Simulated"');
  eq(await page.textContent('#panel .cx-pos'), '16h 11m, +41.4°', 'position for active scan 3');
  await page.evaluate(() => window.__px.set('scan', 1));
  eq(await page.textContent('#panel .cx-pos'), '16h 06m, +41.0°', 'position follows store.scan');
  eq(await page.textContent('.cx-cutscan'), 'Scan 1 · May 2025', 'cutout label follows scan');
  const px1 = await page.$eval('.cx-cut', c => c.toDataURL());
  await page.evaluate(() => window.__px.set('scan', 2)); await page.evaluate(() => window.__px.set('scan', 1));
  ok(px1 === await page.$eval('.cx-cut', c => c.toDataURL()), 'cutout is deterministic');
  await page.evaluate(() => window.__px.set('scan', 3));
  ok(/over 3 scans/.test(await page.textContent('#panel .cx-shift')), 'shift over scans');
  eq(await page.textContent('#panel .cx-band'), '4.6 µm', 'peak band');
  await page.click('#panel .cx-field');
  const st = await page.evaluate(() => ({ view: window.__px.get('view'), field: window.__px.get('field') }));
  ok(st.view === 'field' && Math.abs(st.field.ra - 16.19 * 15) < 1e-9 && st.field.dec === 41.35 && st.field.sizeArcsec === 1968, 'Analyse field sets store.field and view');
  await page.click('#panel .cx-compare');
  eq(await page.evaluate(() => window.__px.get('view')), 'compare', 'Open in Compare sets view');
  await page.evaluate(() => window.__px.set('view', 'sky'));

  // the whole card is visible without scrolling it
  {
    const m = await page.evaluate(() => { const d = document.querySelector('#panel .cx-detail'), a = document.querySelector('#panel .cx-actions').getBoundingClientRect(), p = document.querySelector('#panel').getBoundingClientRect(); return { over: d.scrollHeight - d.clientHeight, fits: a.bottom <= p.bottom + 1 }; });
    ok(m.over <= 1 && m.fits, `card fits without scrolling (${JSON.stringify(m)})`);
    ok(await page.$eval('#cx-opt-c03', li => { const l = li.parentElement.getBoundingClientRect(), r = li.getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }), 'selected row stays in view when the list shrinks');
  }

  // export: download CSV
  await page.click('#panel .cx-filters > button[data-f="all"]');
  await page.click('#panel .cx-export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cx-export-menu [data-x="download"][data-fmt="csv"]')]);
  ok(/^planetx-movers-\d{4}-\d\d-\d\d\.csv$/.test(dl.suggestedFilename()), 'CSV download filename');
  const csv = readFileSync(await dl.path(), 'utf8');
  const rows = parseCSV(csv), head = rows[0];
  eq(rows.length, 7, 'CSV has header + 6 rows');
  const r3 = rows.find(r => r[0] === 'c03');
  eq(r3[head.indexOf('status')], 'Candidate', 'CSV has the status');
  eq(r3[head.indexOf('simulated')], 'true', 'CSV marks simulated rows');
  ok(rows.find(r => r[0] === 'c01')[head.indexOf('note')] === 'Fast main‑belt mover. Cross‑matched to JPL’s catalog on the first pass.', 'plain fields unchanged');

  // export: copy JSON of a filtered list
  await page.click('#panel .cx-filters > button[data-f="Candidate"]');
  await page.click('#panel .cx-export');
  await page.click('#cx-export-menu [data-x="copy"][data-fmt="json"]');
  await page.waitForTimeout(100);
  const js = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  eq(js.candidates.map(c => c.id), ['c03', 'c06'], 'JSON export follows the filter');
  ok(js.count === 2 && js.filter.status === 'Candidate', 'JSON export metadata');

  // export: clipboard failure → fallback dialog
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); });
  await page.click('#panel .cx-filters > button[data-f="all"]');
  await page.click('#panel .cx-export');
  await page.click('#cx-export-menu [data-x="copy"][data-fmt="csv"]');
  await page.waitForSelector('#panel .cx-dialog[open]');
  const dlgText = await page.$eval('#panel .cx-dlg-text', t => t.value);
  ok(dlgText === csv.replace(/\r\n/g, '\r\n') || parseCSV(dlgText).length === 7, 'fallback dialog holds the CSV');
  ok(await page.evaluate(() => { const t = document.querySelector('.cx-dlg-text'); return t.selectionStart === 0 && t.selectionEnd === t.value.length; }), 'dialog text is pre-selected');
  await page.keyboard.press('Escape');
  ok(!(await page.$('#panel .cx-dialog[open]')), 'dialog closes with Escape');

  // two-way selection: the fake sky sets selectedId
  await page.click('#fake-sky [data-sel="c05"]');
  eq(await page.getAttribute('#cx-opt-c05', 'aria-selected'), 'true', 'external selectedId reflected in list');
  eq(await page.textContent('#cx-d-name'), 'Candidate 05', 'external selectedId reflected in detail');
  ok(await page.isVisible('#inspect .cx-insp'), 'desktop: imagery and description open in the left window');
  await page.evaluate(() => window.__px.set('selectedId', null));
  ok(await page.isHidden('#panel .cx-detail'), 'deselect hides detail');
  ok(await page.isHidden('#inspect'), 'deselect closes the left window');
  await page.click('#cx-opt-c03');
  await page.click('#inspect .cx-close');
  ok(await page.isHidden('#inspect') && !(await page.evaluate(() => window.__px.get('selectedId'))), 'the window\'s close button deselects');

  // runtime-added candidate
  await page.click('#fake-sky #add');
  eq((await ids(page)).slice(-1), ['c07'], 'runtime-added candidate appears');
  eq((await page.textContent('#panel .cx-count')).trim(), '7', 'count updates');

  // honesty
  ok(!/detection/i.test(await page.textContent('#panel')), 'panel never says "detection"');

  eq(errors, [], 'no console errors (desktop)');
  await ctx.close();

  // =============== storage throws ===============
  console.log('storage blocked');
  {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
    const p = await c.newPage(); const errs = []; watch(p, errs);
    await p.goto(URL_);
    await p.waitForSelector('#panel [role="option"]');
    eq((await ids(p)).length, 6, 'panel works when localStorage throws');
    await p.click('#cx-opt-c06');
    eq(await p.textContent('#cx-d-name'), 'Candidate 06', 'selection still works');
    eq(errs, [], 'no console errors when storage throws');
    await c.close();
  }

  // =============== screenshots + phone layout ===============
  for (const scheme of ['light', 'dark']) {
    for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: '390', width: 390, height: 844, mobile: true }]) {
      const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, deviceScaleFactor: 2, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
      const p = await c.newPage(); const errs = []; watch(p, errs);
      await p.goto(URL_);
      await p.evaluate(() => localStorage.clear());
      await p.reload();
      await p.waitForSelector('#panel [role="option"]');
      await p.evaluate(() => window.__px.set('selectedId', 'c03'));
      await p.waitForTimeout(350);
      const file = path.join(SHOTS, `${vp.name}-${scheme}.png`);
      await p.screenshot({ path: file });
      console.log('  shot ' + file);
      if (vp.mobile) {
        const small = await p.$$eval('#panel button:not([hidden]), #panel select, #panel [role="option"], #panel input', els => els
          .filter(e => e.offsetParent !== null && !e.closest('[hidden]') && !e.closest('dialog'))
          .map(e => [e.className || e.tagName, e.dataset.f || e.dataset.s || e.textContent.trim().slice(0, 16), Math.round(e.getBoundingClientRect().height)])
          .filter(x => x[2] < 40));
        eq(small, [], `tap targets ≥ 40px at 390 (${scheme})`);
        const ov = await p.evaluate(() => { const d = document.querySelector('.cx'); return d.scrollWidth <= d.clientWidth + 1; });
        ok(ov, `no horizontal overflow at 390 (${scheme})`);
        ok(await p.$eval('#panel .cx-insp-slot .cx-insp', e => !!e) && await p.isHidden('#inspect'), `phone: imagery inside the sheet (${scheme})`);
        const fit = await p.evaluate(() => { const d = document.querySelector('#panel .cx-detail'), a = document.querySelector('#panel .cx-actions').getBoundingClientRect(), pr = document.querySelector('#panel').getBoundingClientRect(); return { over: d.scrollHeight - d.clientHeight, fits: a.bottom <= pr.bottom + 1 }; });
        ok(fit.over <= 1 && fit.fits, `card fits in the sheet without scrolling (${scheme}, ${JSON.stringify(fit)})`);
        // At 360 px too
        await p.setViewportSize({ width: 360, height: 740 });
        await p.waitForTimeout(300);
        const ov360 = await p.evaluate(() => { const d = document.querySelector('.cx'); return d.scrollWidth <= d.clientWidth + 1; });
        ok(ov360, `no horizontal overflow at 360 (${scheme})`);
        const f3 = path.join(SHOTS, `360-${scheme}.png`);
        await p.screenshot({ path: f3 }); console.log('  shot ' + f3);
      } else {
        await p.click('#panel .cx-export');
        const f4 = path.join(SHOTS, `${vp.name}-${scheme}-menu.png`);
        await p.screenshot({ path: f4, clip: { x: 900, y: 40, width: 380, height: 400 } }); console.log('  shot ' + f4);
      }
      eq(errs, [], `no console errors (${vp.name}, ${scheme})`);
      await c.close();
    }
  }
} catch (e) {
  failures++; console.error(e);
} finally {
  await browser.close();
  if (server) server.kill();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
