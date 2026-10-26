// Headless QA for artifacts/ui-demo/index.html: fly-to accuracy, go-to parser, and a few interaction checks.
//
//   node qa/flyto.test.mjs
//
// Env overrides:
//   PW_CORE   path to playwright-core's index.mjs (default: the session scratchpad install)
//   CHROME    Chrome executable (default: macOS Google Chrome)
//   SHOTS     directory for screenshots (default: $TMPDIR; never inside the repo)
//
// The page's three.js objects live in a closure, so an init script wraps THREE.WebGLRenderer
// to capture the scene and camera passed to render(). Nothing in the page is modified.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW_CORE = process.env.PW_CORE || '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad/pw/node_modules/playwright-core/index.mjs';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.env.SHOTS || os.tmpdir();
const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(here, '..', 'artifacts', 'ui-demo', 'index.html')).href;

const { chromium } = await import(PW_CORE);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const errors = []; page.on('pageerror', e => errors.push(e.message));

await page.addInitScript(() => {
  let T;
  Object.defineProperty(window, 'THREE', { configurable: true, get: () => T, set(v) {
    T = v;
    queueMicrotask(() => { // runs once the UMD bundle has filled the namespace, before the inline script
      const R = T.WebGLRenderer;
      T.WebGLRenderer = function (...a) { const r = new R(...a); const o = r.render; r.render = function (s, c) { window.__scene = s; window.__cam = c; return o.call(this, s, c); }; return r; };
    });
  } });
});
await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__cam, null, { timeout: 90000 });
await page.waitForTimeout(4000);

// ---------------------------------------------------------------- helpers
const movers = [ // copy of the page data: the position at Scan 1 is what fly-to targets by default
  [3.20, 12.0], [9.80, -22.0], [16.10, 41.0], [20.40, -8.0], [6.70, 58.0], [13.40, -47.0],
];
let fails = 0; const rows = [];
const check = (ok, name, info = '') => { const l = `${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`; rows.push(l); console.log(l); if (!ok) fails++; };
page.setDefaultTimeout(5000);
async function section(name, fn) { console.log(`--- ${name} ---`); try { await fn(); } catch (e) { check(false, `${name}: aborted`, e.message.split('\n')[0]); } }
const sepDeg = (ra1h, d1, ra2h, d2) => { const r = Math.PI / 180, a1 = ra1h * 15 * r, a2 = ra2h * 15 * r;
  const c = Math.sin(d1 * r) * Math.sin(d2 * r) + Math.cos(d1 * r) * Math.cos(d2 * r) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, c))) / r; };

async function settle() { // wait until the camera stops moving (easing is 12%/frame; swiftshader runs ~13 fps)
  let last = null, still = 0;
  for (let i = 0; i < 120 && still < 3; i++) {
    await page.waitForTimeout(200);
    const q = await page.evaluate(() => { const c = window.__cam; return [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov / 100]; });
    still = last && q.every((v, k) => Math.abs(v - last[k]) < 2e-5) ? still + 1 : 0;
    last = q;
  }
}
async function readout() {
  const [ra, dec] = await page.evaluate(() => [document.getElementById('ra').textContent, document.getElementById('dec').textContent]);
  const mr = ra.match(/(\d+)h (\d+)m/), md = dec.match(/([+−-])([\d.]+)°/);
  return { text: `${ra} ${dec}`, ra: +mr[1] + +mr[2] / 60, dec: (md[1] === '+' ? 1 : -1) * +md[2] };
}
// screen offset (fraction of viewport w/h) of the selected marker sprite, or of an arbitrary RA/Dec
async function offset(target) {
  return page.evaluate(t => {
    const T = window.THREE, cam = window.__cam, scene = window.__scene;
    cam.updateMatrixWorld();
    let p;
    if (t) { const ra = t[0] / 12 * Math.PI, d = t[1] * Math.PI / 180; p = new T.Vector3(Math.cos(d) * Math.cos(ra), Math.sin(d), -Math.cos(d) * Math.sin(ra)).multiplyScalar(500); }
    else {
      const group = scene.children.find(g => g.isGroup && g.children.length && g.children.every(c => c.isSprite));
      // the selected sprite is the one whose reticle texture has the filled centre dot
      const odd = group.children.find(s => { const img = s.material.map.image; const g = img.getContext('2d'); return g.getImageData(64, 64, 1, 1).data[3] > 0; });
      if (!odd) return null; p = odd.position.clone();
    }
    const v = p.project(cam);
    return { dx: v.x / 2, dy: -v.y / 2, behind: v.z > 1 };
  }, target || null);
}
async function expectCentered(name, raH, decD, useSprite) {
  await settle();
  const r = await readout();
  const sep = sepDeg(r.ra, r.dec, raH, decD);
  const o = await offset(useSprite ? null : [raH, decD]);
  const off = o ? Math.max(Math.abs(o.dx), Math.abs(o.dy)) * 100 : Infinity;
  const ok = sep <= 0.5 && o && !o.behind && off <= 2;
  check(ok, name, `target ${raH.toFixed(3)}h ${decD.toFixed(2)}°  readout "${r.text}"  sep ${sep.toFixed(2)}°  ${useSprite ? 'sprite' : 'point'} off-center ${o && !o.behind ? off.toFixed(1) + '%' : 'behind camera'}`);
}
async function goto(q) { await page.fill('#goto-in', q); await page.press('#goto-in', 'Enter'); }
const toastText = () => page.evaluate(() => document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : '');

const rect = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }, sel);
const pressed = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(b => b.getAttribute('aria-pressed')).join(','), sel);
const has = (sel, cls) => page.evaluate(([s, c]) => document.querySelector(s).classList.contains(c), [sel, cls]);
const selectedRow = () => page.evaluate(() => [...document.querySelectorAll('#list li')].findIndex(l => l.getAttribute('aria-selected') === 'true') + 1);
// total azimuth the camera sweeps over the next `ms` (sampled every frame, unwrapped)
const sweep = ms => page.evaluate(ms => new Promise(res => { const c = window.__cam, T = window.THREE, d = new T.Vector3(); let prev = null, tot = 0; const t0 = performance.now();
  (function f() { c.getWorldDirection(d); const a = Math.atan2(-d.z, d.x); if (prev !== null) { let s = a - prev; while (s > Math.PI) s -= 2 * Math.PI; while (s < -Math.PI) s += 2 * Math.PI; tot += Math.abs(s); } prev = a;
    if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(tot * 180 / Math.PI); })(); }), ms);
const dragStage = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up(); };
const clipB = () => page.evaluate(() => document.getElementById('cmp-b').style.clipPath);

// ---------------------------------------------------------------- 1. fly-to
await section('fly-to: list click (select(i, true))', async () => {
  for (let i = 0; i < movers.length; i++) {
    await page.click(`#list li:nth-child(${i + 1})`);
    await expectCentered(`list click Candidate 0${i + 1}`, movers[i][0], movers[i][1], true);
  }
  await page.screenshot({ path: path.join(SHOTS, 'flyto-c06.png') });
});
await section('fly-to: go-to input', async () => {
  await goto('candidate 3'); await expectCentered('go-to "candidate 3"', ...movers[2], true);
  await goto('c5'); await expectCentered('go-to "c5"', ...movers[4], true);
  for (const [q, ra, dec] of [
    ['16h06m, +41', 16.1, 41], ['5.5, -30', 5.5, -30], ['250, 20', 250 / 15, 20], ['16h06m, 41', 16.1, 41],
    ['0h, 0', 0, 0], ['23h59m, -0.5', 23 + 59 / 60, -0.5], ['12h30m, −60', 12.5, -60], ['180 45', 12, 45],
  ]) { await goto(q); await expectCentered(`go-to "${q}"`, ra, dec, false); }
});
await section('fly-to: "Center on sky" after dragging away', async () => {
  await page.click('#list li:nth-child(4)'); await settle();
  await dragStage(500, 450, 300, 300); await settle();
  await page.click('#d-fly'); await expectCentered('#d-fly Candidate 04 @ Scan 1', ...movers[3], true);
  await page.click('.scan[data-id="3"]'); await page.click('#d-fly'); await expectCentered('#d-fly Candidate 04 @ Scan 3', 21.85, -4.9, true);
  await page.click('.scan[data-id="1"]');
});
await section('reset view', async () => {
  await page.click('#reset'); await settle();
  for (let k = 0; k < 6; k++) await dragStage(200, 450, 1300, 450); // wind yaw over a full turn the same way
  await settle();
  await page.click('#reset');
  const swept = await sweep(4000); await settle();
  const r = await readout();
  const raInit = (0.6 + Math.PI / 2) / Math.PI * 12, decInit = 0.15 * 180 / Math.PI; // yaw 0.6, pitch 0.15
  check(sepDeg(r.ra, r.dec, raInit, decInit) <= 0.5, 'reset returns to the initial view', `readout "${r.text}" expected ${raInit.toFixed(2)}h ${decInit.toFixed(1)}°`);
  check(swept <= 180, 'reset takes the short way round', `camera swept ${swept.toFixed(0)}° of azimuth`);
});
await section('drag direction (grab: the sky follows the pointer)', async () => {
  await page.click('#list li:nth-child(3)'); await settle();
  const o0 = await offset(null);
  await dragStage(720, 450, 820, 520); await settle();
  const o1 = await offset(null);
  const mdx = (o1.dx - o0.dx) * 1440, mdy = (o1.dy - o0.dy) * 900;
  check(mdx > 70 && mdx < 130 && mdy > 50 && mdy < 90, 'marker follows a drag right+down (about 1:1)', `marker moved ${mdx.toFixed(0)}px, ${mdy.toFixed(0)}px for a +100px, +70px drag`);
});

// ---------------------------------------------------------------- 2. go-to parser
await section('go-to parser rejects junk', async () => {
  for (const q of ['a41', '16h, x41', '16h, 91', 'hello', '16h']) {
    const before = await readout(); await goto(q); await page.waitForTimeout(100);
    const t = await toastText(); await settle(); const after = await readout();
    check(/Try/.test(t) && sepDeg(before.ra, before.dec, after.ra, after.dec) < 0.3, `rejects "${q}"`, `toast "${t}"  readout ${after.text}`);
  }
});

// ---------------------------------------------------------------- 3. interactions
await section('timeline layout', async () => {
  const b = await rect('#blink'), s1 = await rect('.scan[data-id="1"] small'), tl = await rect('#timeline'), s4 = await rect('.scan[data-id="4"] small');
  check(s1.l >= b.r + 2, 'Scan 1 label clears the Blink button', `blink.right ${b.r.toFixed(0)}  scan1-label.left ${s1.l.toFixed(0)}`);
  check(s4.r <= tl.r, 'Scan 4 label stays inside the timeline', `scan4-label.right ${s4.r.toFixed(0)}  timeline.right ${tl.r.toFixed(0)}`);
  const d1 = await rect('.scan[data-id="1"] i'), rail = await rect('#scans .rail'), d4 = await rect('.scan[data-id="4"] i');
  check(Math.abs((d1.l + d1.r) / 2 - rail.l) < 1.5 && Math.abs((d4.l + d4.r) / 2 - rail.r) < 1.5, 'end dots sit on the rail ends', `dot1 ${((d1.l + d1.r) / 2).toFixed(1)} rail ${rail.l.toFixed(1)}..${rail.r.toFixed(1)} dot4 ${((d4.l + d4.r) / 2).toFixed(1)}`);
  const [bg, fg] = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.scan[aria-pressed="true"]')); return [cs.backgroundColor, cs.color]; });
  check(bg === 'rgba(0, 0, 0, 0)', 'selected scan is not a filled block (label readable)', `background ${bg}, text ${fg}`);
});
await section('scan buttons, blink, number keys', async () => {
  for (const id of [1, 2, 3]) { await page.click(`.scan[data-id="${id}"]`); check((await pressed('.scan')).split(',')[id - 1] === 'true', `scan button ${id}`); }
  check(await page.evaluate(() => document.querySelector('.scan[data-id="4"]').disabled), 'scan 4 disabled');
  await page.keyboard.press('4'); check((await pressed('.scan')).split(',')[2] === 'true', 'key 4 is a no-op (pending)');
  await page.keyboard.press('1'); check((await pressed('.scan')).split(',')[0] === 'true', 'key 1');
  await page.click('#blink'); await page.waitForTimeout(1400);
  check(await pressed('#blink') === 'true' && (await pressed('.scan')).split(',')[0] !== 'true', 'Blink cycles scans', await pressed('.scan'));
  await page.keyboard.press('b'); const s = await pressed('.scan'); await page.waitForTimeout(1300);
  check(await pressed('#blink') === 'false' && await pressed('.scan') === s, 'B stops blink');
  await page.keyboard.press('b'); await page.waitForTimeout(300); await page.click('.scan[data-id="2"]'); const s2 = await pressed('.scan'); await page.waitForTimeout(1300);
  check(await pressed('#blink') === 'false' && s2 === await pressed('.scan'), 'clicking a scan stops blink');
});
await section('keyboard: arrows, zoom, grid, tracks', async () => {
  await page.click('#reset'); await settle(); const r0 = await readout(); const f0 = await page.evaluate(() => window.__cam.fov);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await settle(); const r1 = await readout();
  check(r1.ra > r0.ra, 'ArrowLeft pans east (RA up)', `${r0.text} -> ${r1.text}`);
  await page.keyboard.press('ArrowUp'); await settle(); const r2 = await readout(); check(r2.dec > r1.dec, 'ArrowUp raises Dec', `${r1.text} -> ${r2.text}`);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await settle();
  await page.keyboard.press('+'); await settle(); const f1 = await page.evaluate(() => window.__cam.fov);
  await page.keyboard.press('-'); await settle(); const f2 = await page.evaluate(() => window.__cam.fov);
  check(f1 < f0 && f2 > f1, '+ / - zoom', `fov ${f0.toFixed(1)} -> ${f1.toFixed(1)} -> ${f2.toFixed(1)}`);
  const g = await pressed('#grid'); await page.keyboard.press('g'); check(await pressed('#grid') !== g, 'G toggles grid'); await page.keyboard.press('g');
  const t = await pressed('#tracks'); await page.keyboard.press('t'); check(await pressed('#tracks') !== t, 'T toggles tracks'); await page.keyboard.press('t');
  await page.keyboard.press('Meta+c'); check(!(await has('#compare', 'show')), 'Cmd+C (copy) does not open Compare');
  if (await has('#compare', 'show')) await page.click('#cmp-back');
  await page.keyboard.press('Meta+='); await settle(); check(Math.abs(await page.evaluate(() => window.__cam.fov) - f2) < 0.1, 'Cmd+= (browser zoom) does not zoom the sky');
});
await section('filters', async () => {
  const visibleRows = () => page.evaluate(() => [...document.querySelectorAll('#list li')].filter(l => !l.hidden).map(l => l.querySelector('.n').textContent).join(','));
  const visibleSprites = () => page.evaluate(() => window.__scene.children.find(g => g.isGroup && g.children.length && g.children.every(c => c.isSprite)).children.filter(s => s.visible).length);
  await page.click('#filters [data-f="Candidate"]'); const un = await visibleRows(), unS = await visibleSprites();
  await page.click('#filters [data-f="Matched"]'); const ma = await visibleRows(), maS = await visibleSprites();
  await page.click('#filters [data-f="all"]'); const al = await visibleRows();
  check(un.split(',').length + ma.split(',').length === al.split(',').length, 'Unmatched + Matched partition All', `unmatched [${un}]  matched [${ma}]  all [${al}]`);
  check(unS === un.split(',').length && maS === ma.split(',').length, 'sky markers follow the filter', `sprites ${unS}/${maS}`);
});
await section('sky picking + detail card', async () => {
  await page.click('#list li:nth-child(1)'); await settle();
  await goto('16h06m, +41'); await settle();
  await page.mouse.click(720, 450); await page.waitForTimeout(200);
  check(await selectedRow() === 3, 'click on a marker selects it', `selected row ${await selectedRow()}`);
  check(await page.evaluate(() => document.getElementById('d-name').textContent) === 'Candidate 03' && await has('#detail', 'show'), 'detail card shows the picked candidate');
  await page.click('#list li:nth-child(1)'); await goto('16h06m, +41'); await settle();
  await dragStage(720, 450, 760, 450); await page.waitForTimeout(200); check(await selectedRow() === 1, 'a drag is not a pick');
  await page.click('#cut'); check(await has('#compare', 'show'), 'cutout click opens Compare');
  await page.click('#cmp-back'); check(!(await has('#compare', 'show')), '← Sky leaves Compare');
  await page.click('#d-compare'); check(await has('#compare', 'show'), '"Open in Compare"');
  await page.click('#cmp-back');
});
await section('compare mode', async () => {
  await page.click('.scan[data-id="1"]'); await page.click('#blink'); await page.waitForTimeout(700);
  await page.click('[data-view="compare"]'); const s = await pressed('.scan'); await page.waitForTimeout(1300);
  check(await pressed('.scan') === s && await pressed('#blink') === 'false', 'sky blink stops when entering Compare');
  await page.click('#seg-a button:nth-child(3)'); await page.click('#seg-b button:nth-child(1)');
  check(await page.evaluate(() => [document.getElementById('cmp-la').textContent, document.getElementById('cmp-lb').textContent].join('|')) === 'Scan 3 · May 2026|Scan 1 · May 2025', 'left/right scan selectors');
  check(await pressed('#seg-a button') === 'false,false,true' && await pressed('#seg-b button') === 'true,false,false', 'selector pressed state');
  const w = await rect('#cmp-wrap'), cy = (w.t + w.b) / 2, at = f => w.l + (w.r - w.l) * f;
  await page.mouse.move(at(0.5), cy); await page.mouse.down(); await page.mouse.move(at(0.25), cy, { steps: 5 }); await page.mouse.up();
  check(/ 2[45](\.\d+)?%/.test(await clipB()), 'wipe drag', await clipB());
  await page.click('#seg-ov [data-ov="diff"]');
  check(await page.evaluate(() => document.getElementById('cmp-lb').textContent) === 'Difference' && await page.evaluate(() => document.getElementById('wipe').style.display) === 'none', 'Difference overlay');
  await page.click('#seg-ov [data-ov="wipe"]');
  await page.click('#cmp-blink'); await page.waitForTimeout(700);
  await page.click('#seg-ov [data-ov="diff"]'); await page.waitForTimeout(1200);
  const clip = await clipB();
  check(clip === 'none' || clip === '', 'Difference is not clipped by a running compare blink', `cmp-b clip-path "${clip}"`);
  await page.click('#seg-ov [data-ov="wipe"]');
  if (await pressed('#cmp-blink') === 'false') await page.click('#cmp-blink');
  await page.waitForTimeout(700);
  await page.mouse.click(at(0.3), cy); await page.waitForTimeout(1200);
  const clip2 = await clipB();
  check(/ (29|30)(\.\d+)?%/.test(clip2) && await page.evaluate(() => document.getElementById('wipe').style.display) !== 'none', 'clicking the wipe during compare blink keeps the wipe', `cmp-b clip-path "${clip2}"`);
  await page.keyboard.press('b'); const p1 = await pressed('#cmp-blink'); await page.keyboard.press('b'); const p2 = await pressed('#cmp-blink');
  check(p1 !== p2, 'B toggles compare blink', `${p1} -> ${p2}`);
  if (p2 === 'false') await page.keyboard.press('b');
  await page.keyboard.press('Escape'); check(!(await has('#compare', 'show')), 'Esc leaves Compare');
  check(await pressed('#cmp-blink') === 'false', 'compare blink stopped after leaving');
  await page.keyboard.press('c'); check(await has('#compare', 'show'), 'C opens Compare');
  check(/ (29|30)(\.\d+)?%/.test(await clipB()), 'wipe position kept on return', await clipB());
  await page.keyboard.press('c'); check(!(await has('#compare', 'show')), 'C closes Compare');
});
await section('help sheet', async () => {
  await page.click('#help'); check(await has('#sheet', 'show'), '? button opens help');
  await page.click('#sheet-close'); check(!(await has('#sheet', 'show')), 'close button');
  await page.keyboard.press('?'); check(await has('#sheet', 'show'), '? key opens help');
  const g0 = await pressed('#grid'); const r0 = await readout(); await page.keyboard.press('g'); await page.keyboard.press('ArrowLeft'); await settle(); const r1 = await readout();
  check(g0 === await pressed('#grid') && r0.text === r1.text, 'shortcuts are inert behind the help sheet', `grid ${g0} -> ${await pressed('#grid')}, ${r0.text} -> ${r1.text}`);
  await page.keyboard.press('Escape'); check(!(await has('#sheet', 'show')), 'Esc closes help');
  await page.keyboard.press('?'); await page.mouse.click(10, 450); check(!(await has('#sheet', 'show')), 'backdrop click closes help');
});

await page.screenshot({ path: path.join(SHOTS, 'flyto-final.png') });
check(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${fails ? fails + ' FAILED' : 'all passed'}   (screenshots in ${SHOTS})`);
await browser.close();
process.exit(fails ? 1 : 0);
