// Regression checks for the independent review's confirmed bugs (one block per fix), headless Chrome against app/.
// Run from the repo root:  node tests/review.test.mjs
// Serves the worktree on 127.0.0.1:8107 itself (reuses a server already listening there). Hermetic: the local live
// server (:8787) is blocked, so the app always boots on simulated data.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRATCH = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const { chromium } = await import(`${SCRATCH}/pw/node_modules/playwright-core/index.mjs`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8107, URL_ = `http://127.0.0.1:${PORT}/app/`;

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); } }

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
const benign = t => /Failed to load resource: (the server responded with a status of 404|net::ERR_FAILED)/.test(t);
async function open({ width = 1280, height = 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.route(/(localhost|127\.0\.0\.1):8787/, r => r.abort());
  await page.goto(URL_);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__sky, null, { timeout: 20000 });
  return { ctx, page, errors, ev: (f, a) => page.evaluate(f, a) };
}
const blur = page => page.evaluate(() => document.activeElement && document.activeElement.blur());
const near = (a, b) => Math.abs(a - b) < 1e-6;

// A candidate in the server's new shape: one pos entry per scan, null where unobserved.
const GAPPY = { id: 'k01', name: '2015 AB12', tag: 'Known small body · 2015 AB12', status: 'Matched', pipelineStatus: 'Matched',
  band: '1.6 µm', pos: [[16.1, 41.0], null, [16.1004, 41.002], null], match: '2015 AB12', note: '', simulated: false };
const NOPOS = { id: 'k02', name: 'Nopos', tag: 'Known small body', status: 'Matched', band: '1.6 µm', pos: [], note: '', simulated: false };
const ALLNULL = { id: 'k03', name: 'Allnull', tag: 'Known small body', status: 'Matched', band: '1.6 µm', pos: [null, null, null, null], simulated: false };

// =====================================================================
console.log('pure helpers (app/js/candidates/format.js)');
{
  const F = await import(path.join(ROOT, 'app/js/candidates/format.js'));
  ok(F.posAt(GAPPY, 1) === GAPPY.pos[0] && F.posAt(GAPPY, 2) === null && F.posAt(GAPPY, 3) === GAPPY.pos[2], 'posAt: the scan\'s entry, null where unobserved');
  ok(F.posAt(NOPOS, 1) === null && F.posAt({ id: 'x' }, 1) === null, 'posAt: null for no positions');
  ok(F.posAt({ pos: [[1, 2], [3, 4]] }, 3)[0] === 3, 'posAt: older data with fewer entries clamps to the last');
  ok(F.nearestPos(GAPPY, 2) === GAPPY.pos[0] && F.nearestPos(GAPPY, 4) === GAPPY.pos[2] && F.nearestPos(ALLNULL, 2) === null, 'nearestPos falls back to the nearest observed');
  ok(F.hasPos(GAPPY) && !F.hasPos(NOPOS) && !F.hasPos(ALLNULL) && !F.hasPos(null), 'hasPos');
  ok(F.fmtPos(GAPPY, 2) === 'not observed in Scan 2' && /^16h 06m, \+41\.0°$/.test(F.fmtPos(GAPPY, 1)), `fmtPos (${F.fmtPos(GAPPY, 1)} / ${F.fmtPos(GAPPY, 2)})`);
  ok(/over 2 scans$/.test(F.fmtShift(GAPPY)) && F.shiftDeg(GAPPY) > 0, `fmtShift uses observed entries (${F.fmtShift(GAPPY)})`);
  ok(F.fmtShift(ALLNULL) === '—', 'fmtShift with nothing observed');
  const r = F.exportRow(GAPPY);
  ok(r.n_scans === 2 && near(r.ra_hours_last, 16.1004) && near(r.dec_deg_first, 41), 'export uses first/last observed');
  ok(F.toCSV([GAPPY, NOPOS, ALLNULL]).split('\r\n').length === 5, 'CSV export does not throw on nulls');
  ok(F.shortId({ id: 'c07' }) === '07' && F.shortId({ id: 'f-70.4+19.2' }) === 'F', 'shortId');
  ok(F.matches({ id: 'c05', tag: 'Probable brown dwarf', status: 'Likely' }, { status: 'all', query: 'brown' }) &&
    !F.matches({ id: 'c03', tag: 'Unmatched · slow mover', status: 'Candidate' }, { status: 'all', query: 'brown' }), 'matches() exported');
}

// =====================================================================
console.log('1. global shortcuts stand down behind the Export dialog');
{
  const { ctx, page, errors, ev } = await open();
  ok(await ev(() => { const d = document.querySelector('.cx-dialog'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!d.getAttribute('aria-labelledby'); }),
    'Export dialog has role="dialog", aria-modal and a label');
  await ev(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); __px.set('selectedId', 'c03'); });
  await page.click('.cx-export'); await page.click('#cx-export-menu [data-x="copy"][data-fmt="csv"]');
  await page.waitForFunction(() => document.querySelector('.cx-dialog').open);
  ok(await ev(() => document.getElementById('cx-dlg-title').textContent.length > 0), 'dialog label has text');
  await page.focus('.cx-dlg-copy');
  for (const k of ['f', 'c', 'g', 't', 'b', '2', '?']) await page.keyboard.press(k);
  await page.waitForTimeout(300);
  const s = await ev(() => ({ view: __px.get('view'), open: document.querySelector('.cx-dialog').open, scan: __px.get('scan'), layers: __px.get('layers'), sheet: !document.getElementById('sheet').hidden }));
  ok(s.view === 'sky' && s.open, `F / C in the dialog don't switch views (view ${s.view}, dialog open ${s.open})`);
  ok(s.scan === 1 && s.layers.grid === true && s.layers.tracks === false && !s.sheet, 'G / T / B / 2 / ? do nothing behind the dialog');
  // keys typed with focus elsewhere while the dialog is open (e.g. the page body) are ignored too
  await ev(() => { const d = document.querySelector('.cx-dialog'); d.close(); d.setAttribute('open', ''); document.activeElement.blur(); });
  await page.keyboard.press('f'); await page.waitForTimeout(200);
  ok(await ev(() => __px.get('view')) === 'sky', 'F ignored while a (non-modal fallback) dialog is open');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(await ev(() => !document.querySelector('.cx-dialog').open), 'Esc still closes the dialog');
  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('2. Field tab / F key analyse what is selected now');
{
  const { ctx, page, errors, ev } = await open();
  const posOf = id => ev(id => { const c = __px.get('candidates').find(x => x.id === id); return c.pos[__px.get('scan') - 1]; }, id);
  await ev(() => __px.set('selectedId', 'c03'));
  await page.click('#views button[data-view="field"]'); await page.waitForTimeout(300);
  const f1 = await ev(() => __px.get('field')), p3 = await posOf('c03');
  ok(f1 && near(f1.ra, p3[0] * 15) && near(f1.dec, p3[1]), 'Field tab: field at c03');
  await page.click('#views button[data-view="sky"]');
  await ev(() => __px.set('selectedId', 'c05'));
  await page.click('#views button[data-view="field"]'); await page.waitForTimeout(300);
  const f2 = await ev(() => __px.get('field')), p5 = await posOf('c05');
  ok(f2 && near(f2.ra, p5[0] * 15) && near(f2.dec, p5[1]), `Field tab after selecting c05: field follows (${f2 && f2.ra.toFixed(3)} vs ${(p5[0] * 15).toFixed(3)})`);
  await ev(() => __px.set('view', 'sky'));
  await ev(() => __px.set('selectedId', 'c02')); await blur(page);
  await page.keyboard.press('f'); await page.waitForTimeout(300);
  const f3 = await ev(() => __px.get('field')), p2 = await posOf('c02');
  ok(await ev(() => __px.get('view')) === 'field' && near(f3.ra, p2[0] * 15), 'F key after selecting c02: field follows');
  // an explicit field (the panel's "Analyse field", or the Field view itself) is kept for the same candidate
  await ev(() => __px.set('view', 'sky'));
  await ev(() => { __px.set('selectedId', 'c04'); __px.set('field', { ra: 12.5, dec: -3.25, sizeArcsec: 1968 }); }); await blur(page);
  await page.keyboard.press('f'); await page.waitForTimeout(300);
  const f4 = await ev(() => __px.get('field'));
  ok(near(f4.ra, 12.5) && near(f4.dec, -3.25), 'explicit field kept while its candidate is still selected');
  // no selection: the view centre
  await ev(() => __px.set('view', 'sky'));
  await ev(() => { __px.set('selectedId', null); __sky.flyTo(5.5, -5, 30); });
  await page.waitForFunction(() => __sky.settled, null, { timeout: 10000 }); await blur(page);
  await page.keyboard.press('f'); await page.waitForTimeout(300);
  const f5 = await ev(() => __px.get('field'));
  ok(Math.abs(f5.ra - 82.5) < 1 && Math.abs(f5.dec + 5) < 1, `no selection: field at the view centre (${f5.ra.toFixed(2)}, ${f5.dec.toFixed(2)})`);
  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('3. Compare with a candidate that has no positions');
{
  const { ctx, page, errors, ev } = await open();
  await ev(([a, b]) => { __px.set('candidates', [...__px.get('candidates'), a, b]); __px.set('selectedId', 'k02'); }, [NOPOS, ALLNULL]);
  await blur(page);
  await page.keyboard.press('c'); await page.waitForTimeout(250);
  ok(await ev(() => __px.get('view')) === 'sky', 'C key: stays on the sky');
  ok(/no positions/.test(await ev(() => document.getElementById('toast').textContent)), 'C key: toast explains why');
  await ev(() => __px.set('view', 'sky'));
  await page.click('#views button[data-view="compare"]'); await page.waitForTimeout(200);
  ok(await ev(() => __px.get('view')) === 'sky', 'Compare tab: stays on the sky');
  await ev(() => document.querySelector('#panel .cx-cut').click()); await page.waitForTimeout(200);
  ok(await ev(() => __px.get('view')) === 'sky' && /no positions/.test(await ev(() => document.getElementById('toast').textContent)), 'panel cutout click: stays, with a toast');
  ok(await ev(() => document.querySelector('.cx-compare').disabled), '"Open in Compare" disabled');
  await ev(() => __px.set('view', 'compare')); await page.waitForTimeout(200);
  const e = await ev(() => ({ empty: !document.querySelector('.cmp-empty').hidden, msg: document.querySelector('.cmp-empty').textContent, wrap: document.querySelector('.cmp-wrap').hidden }));
  ok(e.empty && e.wrap && /no positions/.test(e.msg), `Compare forced open draws an empty state ("${e.msg.trim().split('\n')[0]}")`);
  await ev(() => __px.set('selectedId', 'k03')); await page.waitForTimeout(200);
  ok(await ev(() => !document.querySelector('.cmp-empty').hidden), 'all-null positions: empty state too');
  ok(!errors.length, `no exceptions (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('4. positions per scan may be null');
{
  const { ctx, page, errors, ev } = await open();
  await ev(g => { __px.set('candidates', [...__px.get('candidates'), g]); __px.patch('layers', { tracks: true }); __px.set('selectedId', 'k01'); }, GAPPY);
  await page.waitForTimeout(200);
  ok(await ev(() => __sky.markerShown('k01')), 'scan 1: marker shown');
  ok(/^16h 06m/.test(await ev(() => document.querySelector('.cx-pos').textContent)), 'scan 1: panel position');
  ok(/over 2 scans/.test(await ev(() => document.querySelector('.cx-shift').textContent)), 'panel shift counts observed scans');
  await ev(() => __px.set('scan', 2)); await page.waitForTimeout(200);
  ok(!(await ev(() => __sky.markerShown('k01'))), 'scan 2 (unobserved): marker hidden');
  ok(await ev(() => document.querySelector('.cx-pos').textContent) === 'not observed in Scan 2', 'scan 2: "not observed in Scan 2"');
  await ev(() => __px.set('scan', 3)); await page.waitForTimeout(200);
  ok(await ev(() => __sky.markerShown('k01')), 'scan 3: marker back');
  await ev(() => __px.set('scan', 2)); await page.waitForTimeout(100);
  await page.fill('#goto-in', '16h06m, +41'); await page.press('#goto-in', 'Enter'); // a fly-to on an unobserved scan
  await ev(() => document.querySelector('.cx-fly').click());
  await blur(page);
  await page.keyboard.press('c'); await page.waitForTimeout(250);
  ok(await ev(() => __px.get('view')) === 'compare', 'Compare opens on an unobserved scan');
  const dl = await ev(() => document.querySelector('.cmp-dl').textContent);
  ok(/not observed in Scan|16h 06m/.test(dl), `Compare details null-safe (${dl.slice(0, 60)})`);
  await page.click('.cmp-seg-ov button[data-ov="diff"]'); await page.waitForTimeout(100);
  await ev(() => __px.set('view', 'sky'));
  await ev(() => __px.set('selectedId', null)); await blur(page);
  await ev(() => __px.set('selectedId', 'k01'));
  await page.keyboard.press('f'); await page.waitForTimeout(300);
  const f = await ev(() => __px.get('field'));
  ok(f && Number.isFinite(f.ra) && near(f.ra, 16.1 * 15), 'F on an unobserved scan uses the nearest observed position');
  ok(!errors.length, `no exceptions (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('5. the panel cutout is labelled illustrative for every candidate');
{
  const { ctx, page, errors, ev } = await open();
  await ev(g => { __px.set('candidates', [...__px.get('candidates'), g]); __px.set('selectedId', 'k01'); }, GAPPY);
  const r = await ev(() => ({ cap: document.querySelector('.cx-cutlabel').textContent, aria: document.querySelector('.cx-cut').getAttribute('aria-label') }));
  ok(/Illustrative cutout \(simulated pixels\)/.test(r.cap), `non-simulated candidate: caption (${r.cap})`);
  ok(/^Illustrative cutout \(simulated pixels\) of 2015 AB12/.test(r.aria), 'non-simulated candidate: aria-label');
  await ev(() => __px.set('selectedId', 'c03'));
  ok(/^Illustrative cutout \(simulated pixels\)/.test(await ev(() => document.querySelector('.cx-cut').getAttribute('aria-label'))), 'simulated candidate: same label');
  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('6. scan labels are text, not HTML');
{
  const { ctx, page, errors, ev } = await open();
  await ev(() => __px.set('scans', [{ id: 1, label: '<img src=x onerror="window.__xss=1">', date: 'x', has: true }, { id: 2, label: 'Scan 2', date: 'y', has: true }]));
  await page.waitForTimeout(300);
  ok(!(await ev(() => window.__xss)) && !(await ev(() => document.querySelector('#scans img'))), 'no markup injected');
  ok((await ev(() => document.querySelector('#scans .scan small').textContent)).startsWith('<img'), 'label shown literally');
  ok(!errors.filter(e => !/x$/.test(e)).length, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('7. search hides movers on the sky as in the list');
{
  const { ctx, page, errors, ev } = await open();
  await ev(() => __px.patch('filter', { query: 'brown' })); await page.waitForTimeout(200);
  const list = await ev(() => [...document.querySelectorAll('.cx-list li')].map(l => l.dataset.id));
  const sky = await ev(() => __px.get('candidates').filter(c => __sky.markerShown(c.id)).map(c => c.id));
  ok(list.length > 0 && JSON.stringify(list) === JSON.stringify(sky), `sky shows exactly the listed movers (list ${list} / sky ${sky})`);
  await ev(() => __px.patch('filter', { query: '', status: 'Matched' })); await page.waitForTimeout(200);
  const sky2 = await ev(() => __px.get('candidates').filter(c => __sky.markerShown(c.id)).map(c => c.status));
  ok(sky2.length && sky2.every(s => s === 'Matched'), 'status filter still applies');
  await ev(() => __px.patch('filter', { status: 'all' })); await page.waitForTimeout(100);
  ok(await ev(() => __px.get('candidates').every(c => __sky.markerShown(c.id))), 'cleared: all shown');
  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('8. ? opens help in the Field view');
{
  const { ctx, page, errors, ev } = await open();
  await ev(() => __px.set('selectedId', 'c03'));
  await page.click('#views button[data-view="field"]'); await page.waitForTimeout(500);
  await blur(page);
  await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(200);
  ok(await ev(() => !document.getElementById('sheet').hidden), 'help sheet open');
  await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(200);
  ok(await ev(() => document.getElementById('sheet').hidden && __px.get('view') === 'field'), '? again closes it, still in Field');
  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('9. labels are consistent');
{
  const { ctx, page, errors, ev } = await open();
  const FC = { id: 'f-243.0000+41.0000', name: 'Field candidate 7', tag: 'Unmatched', status: 'Candidate', band: '1 µm', pos: [[16.2, 41.0]], simulated: false };
  const K = { id: 'k42', name: 'Thing 42', tag: 'Known', status: 'Matched', band: '1 µm', pos: [[16.3, 41.0]], simulated: false };
  await ev(([a, b]) => __px.set('candidates', [...__px.get('candidates'), a, b]), [FC, K]);
  const labels = await ev(() => __px.get('candidates').map(c => [c.id, __sky.markerLabel(c.id), document.querySelector(`.cx-list li[data-id="${CSS.escape(c.id)}"] .n`)?.textContent]));
  ok(labels.every(([, s, l]) => s === l), `sky marker labels match the list (${labels.map(x => x[1]).join(' ')})`);
  ok(labels.find(x => x[0] === FC.id)[1] === 'F', 'Field-added candidate shows "F"');
  await page.fill('#goto-in', 'candidate 42'); await page.press('#goto-in', 'Enter'); await page.waitForTimeout(200);
  ok(await ev(() => __px.get('selectedId')) === null && /No candidate 42/.test(await ev(() => document.getElementById('toast').textContent)), '"candidate 42" does not match a non-cNN id');
  await page.fill('#goto-in', 'candidate 7'); await page.press('#goto-in', 'Enter'); await page.waitForTimeout(200);
  ok(await ev(() => __px.get('selectedId')) === null, '"candidate 7" does not pick a Field candidate named "… 7" or the 7th in the list');
  await page.fill('#goto-in', 'candidate 5'); await page.press('#goto-in', 'Enter'); await page.waitForTimeout(200);
  ok(await ev(() => __px.get('selectedId')) === 'c05', '"candidate 5" → c05');
  // Compare scales by the pipeline status, like the panel: a reviewer's Rejected on a Matched mover changes nothing
  const same = await ev(async () => {
    const { renderCutout } = await import('/app/js/compare/cutout.js');
    const base = { id: 'z1', pos: [[10, 20], [10.001, 20.001], [10.002, 20.002]] };
    const draw = c => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; renderCutout(cv.getContext('2d'), 128, c, 3); return cv.toDataURL(); };
    const a = draw({ ...base, status: 'Matched' }), b = draw({ ...base, status: 'Rejected', pipelineStatus: 'Matched' }), c = draw({ ...base, status: 'Candidate' });
    return { same: a === b, differs: a !== c };
  });
  ok(same.same && same.differs, 'Compare scale follows pipelineStatus ?? status');
  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

await browser.close();
if (server) server.kill();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
