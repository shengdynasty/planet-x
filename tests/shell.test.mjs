// Shell + Sky + Compare — headless Chrome against app/index.html.
// Run from the repo root:  node tests/shell.test.mjs
// Serves the repo on 127.0.0.1:8101 itself (reuses a server already listening there). Screenshots go to the scratchpad.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRATCH = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const { chromium } = await import(`${SCRATCH}/pw/node_modules/playwright-core/index.mjs`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8101, URL_ = `http://127.0.0.1:${PORT}/app/`;
const SHOTS = path.join(SCRATCH, 'shots', 'shell');
mkdirSync(SHOTS, { recursive: true });

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); } }

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


// Missing sibling modules (another agent's, not merged yet) 404 and fall back by design; anything else is an error.
const benign = t => /Failed to load resource: the server responded with a status of 404/.test(t);
async function open({ width, height, scheme = 'dark', mobile = false, reduced = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [], notFound = [];
  page.on('console', m => { if (m.type() === 'error') (benign(m.text()) ? notFound : errors).push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.status() === 404) notFound.push(r.url()); });
  await page.goto(URL_);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 15000 });
  await page.waitForFunction(() => window.__sky && window.__sky.backdrop, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors, notFound };
}
const settle = page => page.waitForFunction(() => window.__sky.settled, null, { timeout: 10000 }).then(() => page.waitForTimeout(80));
const view = page => page.evaluate(() => window.__px.get('view'));
const sepDeg = (r1, d1, r2, d2) => { // hours, degrees
  const a = r1 / 12 * Math.PI, b = r2 / 12 * Math.PI, p = d1 * Math.PI / 180, q = d2 * Math.PI / 180;
  return Math.acos(Math.min(1, Math.sin(p) * Math.sin(q) + Math.cos(p) * Math.cos(q) * Math.cos(a - b))) * 180 / Math.PI;
};

// =====================================================================
console.log('pure helpers (app/js/sky/coords.js)');
{
  const C = await import(path.join(ROOT, 'app/js/sky/coords.js'));
  ok(C.fmtRA(19.9999) === '20h 00m' && C.fmtRA(23.999) === '0h 00m', `fmtRA carries rounding (${C.fmtRA(19.9999)})`);
  ok(C.fmtDec(-0.04) === '+0.0°' && C.fmtDec(-12.34) === '−12.3°', `fmtDec never shows −0.0° (${C.fmtDec(-0.04)})`);
  const g = q => JSON.stringify(C.parseGoto(q));
  ok(g('16h06m, −41') === JSON.stringify({ kind: 'pos', raH: 16.1, decD: -41 }), 'go-to accepts Unicode minus');
  ok(g('16h06m, -41') === g('16h06m −41') && g('16h06m +41') === JSON.stringify({ kind: 'pos', raH: 16.1, decD: 41 }), 'go-to signs and separators');
  ok(C.parseGoto('25h, +10') === null && C.parseGoto('10h, +95') === null && C.parseGoto('400, 10') === null, 'go-to rejects RA > 24h and |Dec| > 90');
  ok(g('candidate 3') === g('c03') && C.parseGoto('candidate 3').n === 3, 'go-to "candidate 3"');
  for (const [r, d] of [[0, 0], [6, 30], [12, -60], [18.5, 85], [23.9, -1]]) {
    const { yaw, pitch } = C.yawPitchFor(r, d), back = C.raDecOf(C.dirFor(yaw, pitch));
    ok(Math.abs(back.raH - r) < 1e-9 && Math.abs(back.decD - d) < 1e-9, `yaw = ra − π/2 round-trips RA ${r}h Dec ${d}°`);
  }
}

// =====================================================================
console.log('desktop 1440×900, dark');
{
  const { ctx, page, errors, notFound } = await open({ width: 1440, height: 900 });
  const modules = await page.evaluate(() => window.__pxBoot.modules);
  console.log('  modules:', JSON.stringify(modules), '| 404s:', notFound.filter(u => u.startsWith('http')).map(u => u.replace(URL_, '')).join(', ') || 'none');
  ok(errors.length === 0, `boot: no console errors (${errors.join(' | ')})`);
  ok(await page.evaluate(() => window.__sky.backdrop) === 'image', 'real NASA sky map is the backdrop');
  ok((await page.textContent('#source-text')) === 'Simulated data', 'badge says "Simulated data"');
  await page.evaluate(() => window.__px.set('source', { mode: 'live', live: true, note: 'SPHEREx via IRSA' }));
  ok((await page.textContent('#source-text')) === 'Live · SPHEREx', 'badge says "Live · SPHEREx" for a live source');
  await page.evaluate(() => window.__px.set('source', { mode: 'sim', live: false, note: 'Simulated data' }));
  const cands = await page.evaluate(() => window.__px.get('candidates'));
  ok(cands.length >= 1, `candidates loaded (${cands.length})`);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-dark-boot.png') });
  { const f0 = await page.evaluate(() => window.__sky.frames()); await page.waitForTimeout(600); const f1 = await page.evaluate(() => window.__sky.frames());
    ok(f1 === f0, `idle sky renders no frames (${f1 - f0} in 600 ms)`); }

  // --- timeline: the Scan 1 marker must not overlap the Blink button ---
  const blinkR = await page.locator('#blink').boundingBox(), s1 = await page.locator('.scan').first().boundingBox();
  ok(s1.x >= blinkR.x + blinkR.width, `Scan 1 starts right of Blink (${Math.round(s1.x)} ≥ ${Math.round(blinkR.x + blinkR.width)})`);
  const lastScan = await page.locator('.scan').last().boundingBox(), scansR = await page.locator('#scans').boundingBox();
  ok(lastScan.x + lastScan.width <= scansR.x + scansR.width + 0.5, 'last scan label stays inside the rail');

  // --- fly-to accuracy for every candidate (go-to box) ---
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i], n = +(/(\d+)\s*$/.exec(c.name) || [, i + 1])[1];
    await page.fill('#goto-in', `candidate ${n}`); await page.press('#goto-in', 'Enter');
    await settle(page);
    const scan = await page.evaluate(() => window.__px.get('scan'));
    const [ra, dec] = c.pos[Math.min(scan, c.pos.length) - 1];
    const ctr = await page.evaluate(() => window.__sky.centre());
    const sep = sepDeg(ctr.raH, ctr.decD, ra, dec);
    const scr = await page.evaluate(id => window.__sky.markerScreen(id), c.id);
    const st = await page.locator('#stage').boundingBox();
    const off = scr ? Math.hypot(scr.x - st.width / 2, scr.y - st.height / 2) : Infinity;
    const read = await page.evaluate(() => [document.getElementById('ra').textContent, document.getElementById('dec').textContent]);
    ok(sep < 0.5 && off < 3, `fly to ${c.name}: centre off by ${sep.toFixed(4)}°, marker ${off.toFixed(1)} px from centre, readout ${read.join(' ')}`);
    ok(await page.evaluate(() => window.__px.get('selectedId')) === c.id, `  go-to selects ${c.id}`);
  }
  // RA/Dec go-to, Unicode minus and degrees
  for (const [q, ra, dec] of [['16h06m, +41', 16.1, 41], ['13h24m −47', 13.4, -47], ['241.5, -12.5', 16.1, -12.5]]) {
    await page.fill('#goto-in', q); await page.press('#goto-in', 'Enter'); await settle(page);
    const ctr = await page.evaluate(() => window.__sky.centre());
    ok(sepDeg(ctr.raH, ctr.decD, ra, dec) < 0.5, `go to "${q}" → RA ${ctr.raH.toFixed(3)}h Dec ${ctr.decD.toFixed(2)}°`);
  }
  // flyto event (degrees)
  await page.evaluate(() => window.__px.emit('flyto', { ra: 83.82, dec: -5.39, fov: 30 })); await settle(page);
  { const ctr = await page.evaluate(() => window.__sky.centre()); ok(sepDeg(ctr.raH, ctr.decD, 83.82 / 15, -5.39) < 0.5, `flyto {ra: 83.82°, dec: −5.39°} centres the view (RA ${ctr.raH.toFixed(3)}h)`); }

  // --- marker pick selects ---
  const target = cands.find(c => c.status === 'Candidate') || cands[0];
  await page.fill('#goto-in', target.name.replace(/^\D+/, 'candidate ')); await page.press('#goto-in', 'Enter'); await settle(page);
  await page.evaluate(() => window.__px.set('selectedId', null));
  { const scr = await page.evaluate(id => window.__sky.markerScreen(id), target.id);
    await page.mouse.click(scr.x, scr.y); }
  ok(await page.evaluate(() => window.__px.get('selectedId')) === target.id, `clicking the ${target.id} marker selects it`);
  await page.evaluate(() => window.__px.patch('filter', { status: 'Matched' }));
  ok(await page.evaluate(id => window.__sky.markerScreen(id), target.id) === null, 'filter.status hides non-matching markers');
  await page.evaluate(() => window.__px.patch('filter', { status: 'all' }));
  await page.click('#tracks');
  ok((await page.evaluate(() => window.__px.get('layers'))).tracks === true, 'Tracks toggle writes layers.tracks');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-dark-selected.png') });

  // --- view switching ---
  await page.evaluate(() => window.__px.set('selectedId', null));
  await page.click('#views [data-view="compare"]');
  ok(await view(page) === 'sky', 'Compare without a selection stays on Sky (toast)');
  await page.evaluate(id => window.__px.set('selectedId', id), target.id);
  await page.click('#views [data-view="compare"]');
  ok(await view(page) === 'compare' && await page.isVisible('#view-compare .cmp-wrap'), 'Compare view opens for the selection');
  ok((await page.textContent('#view-compare .cmp-name')) === target.name, 'Compare shows the selected candidate');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cmp-back')), 'focus moves to "← Sky" when Compare opens');
  ok(await page.evaluate(() => document.getElementById('stage').inert && document.getElementById('panel').inert), 'sky HUD is inert behind Compare');
  await page.focus('#view-compare .cmp-wrap'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  ok(+(await page.getAttribute('#view-compare .cmp-wrap', 'aria-valuenow')) > 50, 'wipe is a keyboard slider');
  await page.click('#view-compare [data-ov="diff"]');
  ok((await page.textContent('#view-compare .cmp-lb')) === 'Difference', 'Difference overlay');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-dark-compare.png') });
  await page.click('#view-compare [data-ov="wipe"]');
  await page.keyboard.press('Escape');
  ok(await view(page) === 'sky', 'Esc returns from Compare to Sky');
  await page.evaluate(() => window.__px.set('field', null));
  await page.click('#views [data-view="field"]');
  const field = await page.evaluate(() => window.__px.get('field'));
  const tp = target.pos[Math.min(await page.evaluate(() => window.__px.get('scan')), target.pos.length) - 1];
  ok(await view(page) === 'field' && field && Math.abs(field.ra - tp[0] * 15) < 1e-6 && Math.abs(field.dec - tp[1]) < 1e-6, `Field sets view and field from the selection (ra ${field && field.ra.toFixed(2)}°)`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-dark-field.png') });
  await page.click('#views [data-view="sky"]');
  ok(await view(page) === 'sky', 'Sky button returns to Sky');

  // --- help sheet: focus in, trapped, restored ---
  await page.focus('#help'); await page.keyboard.press('Enter');
  ok(await page.isVisible('#sheet') && await page.evaluate(() => document.getElementById('sheet').contains(document.activeElement)), 'help sheet opens with focus inside');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.getElementById('sheet').contains(document.activeElement)), 'focus is trapped in the sheet');
  const sheetText = await page.textContent('#sheet');
  ok(!/detect/i.test(sheetText), 'help copy never calls anything a detection');
  ok(/NASA\/Goddard Space Flight Center Scientific Visualization Studio/.test(sheetText), 'help sheet carries the sky credit');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-dark-help.png') });
  await page.keyboard.press('Escape');
  ok(!(await page.isVisible('#sheet')) && await page.evaluate(() => document.activeElement.id) === 'help', 'Esc closes the sheet and restores focus');

  // --- accessible names for every visible control ---
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, select, textarea, [role="slider"]')]
    .filter(el => el.offsetParent !== null)
    .filter(el => !((el.getAttribute('aria-label') || '').trim() || (el.textContent || '').trim() || el.getAttribute('aria-labelledby') || el.title || (el.labels && el.labels.length)))
    .map(el => el.outerHTML.slice(0, 80)));
  ok(unnamed.length === 0, `every visible control has an accessible name ${unnamed.join(' ')}`);
  ok(errors.length === 0, `no console errors after the run (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('desktop 1440×900, light');
{
  const { ctx, page, errors } = await open({ width: 1440, height: 900, scheme: 'light' });
  // HUD legibility over the dark sky: readout buttons sit on a light glass pill
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('readout')).backgroundColor);
  ok(/rgba?\(255, 255, 255/.test(bg), `light theme: readout has a light glass background (${bg})`);
  await page.evaluate(() => window.__px.set('selectedId', 'c03'));
  await settle(page);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-light.png') });
  await page.click('#views [data-view="compare"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-light-compare.png') });
  ok(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
for (const scheme of ['dark', 'light']) {
  console.log(`phone 390×844, ${scheme}`);
  const { ctx, page, errors } = await open({ width: 390, height: 844, scheme, mobile: true });
  ok(await page.isVisible('#source-badge'), 'badge visible on phones');
  const overflow = await page.evaluate(() => {
    const W = window.innerWidth;
    return [...document.querySelectorAll('#top *, #bottom *, #panel, #source-badge')].filter(el => el.offsetParent !== null)
      .map(el => [el, el.getBoundingClientRect()]).filter(([, r]) => r.width && (r.right > W + 0.5 || r.left < -0.5)).map(([el]) => el.id || el.className || el.tagName);
  });
  ok(overflow.length === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `nothing overflows horizontally ${overflow.join(',')}`);
  const small = await page.evaluate(() => [...document.querySelectorAll('#top button, #bottom button')].filter(el => el.offsetParent !== null)
    .map(el => [el, el.getBoundingClientRect()]).filter(([, r]) => r.width < 40 || r.height < 40).map(([el, r]) => `${el.id || el.textContent.trim()} ${Math.round(r.width)}×${Math.round(r.height)}`));
  ok(small.length === 0, `tap targets ≥ 40px ${small.join(', ')}`);
  ok(!(await page.evaluate(() => document.getElementById('panel').classList.contains('open'))), 'panel starts closed');
  ok(await page.evaluate(() => document.getElementById('panel').inert), 'closed bottom sheet is inert');
  ok(await page.isVisible('#readout .pos') && await page.isVisible('#grid') && await page.isVisible('#tracks'), 'RA/Dec readout and Grid/Tracks visible on phones');
  await page.screenshot({ path: path.join(SHOTS, `phone-${scheme}-sky.png`) });
  await page.tap('#mobile-toggle');
  await page.waitForTimeout(350);
  ok(await page.evaluate(() => document.getElementById('panel').classList.contains('open') && !document.getElementById('panel').inert), '☰ opens the bottom sheet (no longer inert)');
  const pr = await page.locator('#panel').boundingBox(), tr = await page.locator('#top').boundingBox(), br = await page.locator('#bottom').boundingBox();
  ok(pr.y >= tr.y + tr.height && pr.y + pr.height <= br.y + 1, `sheet sits between top bar and timeline (${Math.round(pr.y)}–${Math.round(pr.y + pr.height)})`);
  await page.screenshot({ path: path.join(SHOTS, `phone-${scheme}-panel.png`) });
  await page.tap('#mobile-toggle'); await page.waitForTimeout(300);

  // touch: drag pans, pinch zooms (CDP touch events)
  const cdp = await ctx.newCDPSession(page);
  const before = await page.evaluate(() => window.__sky.centre());
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[200, 420]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[200 + i * 15, 420]]);
  await touch('touchEnd', []); await settle(page);
  const after = await page.evaluate(() => window.__sky.centre());
  ok(Math.abs(after.raH - before.raH) > 0.05, `touch drag pans the sky (RA ${before.raH.toFixed(2)} → ${after.raH.toFixed(2)})`);
  const fov0 = await page.evaluate(() => window.__sky.fov);
  await touch('touchStart', [[170, 420], [220, 420]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[170 - i * 10, 420], [220 + i * 10, 420]]);
  await touch('touchEnd', []); await settle(page);
  const fov1 = await page.evaluate(() => window.__sky.fov);
  ok(fov1 < fov0 * 0.7, `two-finger pinch zooms in (fov ${fov0.toFixed(1)} → ${fov1.toFixed(1)})`);

  await page.evaluate(() => window.__px.set('selectedId', 'c03'));
  await page.tap('#views [data-view="compare"]'); await page.waitForTimeout(250);
  const cw = await page.locator('#view-compare .cmp-wrap').boundingBox();
  ok(cw && cw.width >= 200 && cw.x >= 0 && cw.x + cw.width <= 390, `compare image fits (${cw && Math.round(cw.width)}px)`);
  await page.screenshot({ path: path.join(SHOTS, `phone-${scheme}-compare.png`) });
  await page.tap('#help'); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS, `phone-${scheme}-help.png`) });
  ok(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('landscape phone 844×390');
{
  const { ctx, page, errors } = await open({ width: 844, height: 390, mobile: true });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
  await page.tap('#mobile-toggle'); await page.waitForTimeout(350);
  const pr = await page.locator('#panel').boundingBox(), tr = await page.locator('#top').boundingBox(), br = await page.locator('#bottom').boundingBox();
  ok(pr.x > 844 / 2 && pr.x + pr.width <= 844 && pr.y >= tr.y + tr.height && pr.y + pr.height <= br.y + 1, `panel docks on the right (${Math.round(pr.x)},${Math.round(pr.y)} ${Math.round(pr.width)}×${Math.round(pr.height)})`);
  await page.screenshot({ path: path.join(SHOTS, 'landscape-panel.png') });
  await page.tap('#mobile-toggle'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__px.set('selectedId', 'c03'));
  await page.tap('#views [data-view="compare"]'); await page.waitForTimeout(250);
  const cw = await page.locator('#view-compare .cmp-wrap').boundingBox(), side = await page.locator('#view-compare .cmp-side').boundingBox();
  ok(cw && side && cw.x + cw.width <= side.x + 1 && cw.y + cw.height <= 390 && cw.width >= 180, `Compare image and controls side by side (image ${cw && Math.round(cw.width)}px)`);
  await page.screenshot({ path: path.join(SHOTS, 'landscape-compare.png') });
  ok(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

// =====================================================================
console.log('reduced motion');
{
  const { ctx, page, errors } = await open({ width: 1024, height: 700, reduced: true });
  await page.evaluate(() => window.__px.emit('flyto', { ra: 200, dec: -30 }));
  await page.waitForTimeout(120);
  const ctr = await page.evaluate(() => window.__sky.centre());
  ok(sepDeg(ctr.raH, ctr.decD, 200 / 15, -30) < 0.05, 'prefers-reduced-motion: fly-to jumps without animating');
  ok(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  await ctx.close();
}

await browser.close();
if (server) server.kill();
console.log(`\n${passes} passed, ${failures} failed. Screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
