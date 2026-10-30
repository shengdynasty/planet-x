// QA for artifacts/moving-sky/index.html
// Rerun from the repo root:  node qa/moving-sky.test.mjs
// Needs playwright-core (default: session scratchpad copy; override with PW_CORE=/abs/path/playwright-core/index.mjs)
// and Chrome at /Applications/Google Chrome.app. Screenshots go to $SHOTS (default: scratchpad/moving-sky).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SCR = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const { chromium } = await import(process.env.PW_CORE || SCR + '/pw/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const URL_ = pathToFileURL(path.join(here, '../artifacts/moving-sky/index.html')).href + '#test';
const OUT = process.env.SHOTS || SCR + '/moving-sky';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const hidden = async (pg, sel) => (await pg.locator(sel).getAttribute('hidden')) !== null;

// ---------- 1. detection table over every same-wavelength pair ----------
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(URL_); await p.waitForTimeout(300);
const table = await p.evaluate(() => {
  const { analyse, EPOCHS, OBJ } = window.__ms; const same = [0, 1, 3, 4, 5, 7], rows = [];
  const near = (q, o, t) => { if (!q) return false; const [x, y] = o.pos(t); return Math.hypot(q.x - x, q.y - y) < 3; };
  for (const a of same) for (const c of same) { if (a === c) continue;
    const ta = EPOCHS[a].t, tb = EPOCHS[c].t;
    rows.push({ A: a, B: c, a: EPOCHS[a].label, b: EPOCHS[c].label,
      flags: analyse(a, c).map(r => {
        const tag = near(r.to, OBJ.asteroid, tb) || near(r.from, OBJ.asteroid, ta) ? 'ast'
          : near(r.to, OBJ.px, tb) || near(r.from, OBJ.px, ta) ? 'px'
          : near(r, OBJ.variable, 0) ? 'var' : Math.hypot(r.x - 261, r.y - 71) < 3 ? 'spike' : 'STAR?';
        return { kind: r.kind, tag, title: r.title, detail: r.detail }; }) }); }
  return rows; });
for (const r of table) console.log(`${r.a.padEnd(7)}-> ${r.b.padEnd(7)} | ` + (r.flags.map(f => `${f.kind}:${f.tag}`).join(', ') || '(none)'));
console.log('\nDetails (A<B):');
for (const r of table) if (r.A < r.B) for (const f of r.flags) console.log(`  ${r.a}->${r.b} [${f.kind}/${f.tag}] ${f.title} — ${f.detail}`);
const T = (a, c) => table.find(r => r.A === a && r.B === c).flags;
const has = (fl, kind, tag) => fl.some(f => f.kind === kind && f.tag === tag);
ok(table.every(r => r.flags.every(f => f.tag !== 'STAR?')), 'no spurious flags on fixed stars');
ok(T(0, 1).length === 0 && T(1, 0).length === 0, 'burst pair (2.4 min) flags nothing: asteroid moves 0.3″ < 1 px');
for (const [a, c] of [[0, 3], [0, 4], [1, 4], [3, 4]]) ok(has(T(a, c), 'known', 'ast'), `asteroid known ${a}->${c}`);
for (const [a, c] of [[0, 5], [0, 7], [4, 7]]) ok(has(T(a, c), 'left', 'ast'), `asteroid "left the cutout" ${a}->${c}`);
for (const [a, c] of [[0, 5], [0, 7], [5, 7]]) ok(has(T(a, c), 'cand', 'px'), `px candidate ${a}->${c}`);
for (const [a, c] of [[0, 5], [0, 7], [4, 5], [7, 1], [5, 3]]) ok(has(T(a, c), 'var', 'var'), `variable flagged ${a}->${c}`);
ok(!has(T(5, 7), 'var', 'var') && !has(T(0, 4), 'var', 'var'), 'variable not flagged within same state');
for (const [a, c] of [[0, 3], [3, 4], [3, 7]]) ok(T(a, c).some(f => f.kind === 'art' && f.tag === 'spike'), `spike rejected ${a}->${c}`);
ok(table.every(r => r.flags.filter(f => f.tag === 'spike').every(f => f.kind === 'art')), 'spike never flagged as anything but artifact');
ok(table.every(r => r.flags.filter(f => f.tag === 'ast').every(f => f.kind === 'known' || f.kind === 'left')), 'asteroid never flagged as candidate');
const fmt = await p.evaluate(() => { const { fmtDt, fmtRate } = window.__ms; return [0.00167, 0.42, 1, 2, 181, 183, 366].map(d => [d, fmtDt(d), fmtRate(100, d)]); });
console.log('\nfmtDt / fmtRate(100″/day):', JSON.stringify(fmt));
ok(fmt.map(f => f[1]).join('|') === '2.4 min|10.1 h|1.0 d|2.0 d|181 d|183 d|366 d', 'fmtDt labels');
ok(fmt[2][2] === '100.0″/day' && fmt[5][2] === '10.15°/yr' && fmt[1][2] === '4.2″/h', 'fmtRate units follow fmtDt');

// ---------- 2. interactions ----------
const btn = (grp, i) => p.locator(`#${grp} button[data-i="${i}"]`); // i = index into EPOCHS
const pressedB = () => p.evaluate(() => { const b = document.querySelector('#epB button[aria-pressed="true"]'); return b ? +b.dataset.i : -1; });
const det = () => p.locator('#dets li').allInnerTexts();
await p.screenshot({ path: OUT + '/01-default.png', fullPage: true });
await btn('epB', 2).click();
ok(await p.locator('#warn.on').count() === 1, 'mismatch warning shown');
await p.click('#warn button');
ok(await pressedB() === 1, 'nearest-match from 0 d/+10 h picks +2 min');
ok(await p.$$eval('#epB button', b => b.length) === 7 && await p.$$eval('#epB button.other', b => b.length) === 2, 'one row: the 7 later passes, the 2 other-wavelength ones marked');
await btn('epB', 5).click();
const items = await det(); const ci = items.findIndex(t => t.includes('Uncatalogued mover'));
ok(ci >= 0, 'candidate listed for 0 d vs +183 d');
await p.locator('#dets button').nth(Math.max(ci, 0)).click();
ok(!(await hidden(p, '#vetpanel')), 'vet panel shows on list select');
const right = await p.evaluate(() => Math.max(...[...document.querySelectorAll('#spec text')].map(t => { const bb = t.getBBox(); return bb.x + bb.width; })));
ok(right <= 340, `spectrum labels fit the 340 viewBox (right edge ${right.toFixed(0)})`);
await p.screenshot({ path: OUT + '/03-selected.png', fullPage: true });
await btn('epB', 7).click();
ok(!(await hidden(p, '#vetpanel')) && (await p.locator('#dets button[aria-pressed=true]').count()) === 1, 'selection survives epoch change (re-matched by kind)');
await btn('epB', 1).click();
ok(await hidden(p, '#vetpanel'), 'selection clears when nothing matches');

await btn('epB', 5).click();
await p.locator('#sky').scrollIntoViewIfNeeded(); const box = await p.locator('#sky').boundingBox();
const toScreen = ([x, y]) => [box.x + (x + .5) / 320 * box.width, box.y + (y + .5) / 320 * box.height];
await p.mouse.click(...toScreen([96, 92]));
ok(!(await hidden(p, '#vetpanel')), 'canvas click selects the variable');
ok((await p.locator('#dets button[aria-pressed=true]').innerText()).includes('Brightness'), 'list reflects canvas selection');
await p.mouse.click(box.x + 5, box.y + 5);
ok(await hidden(p, '#vetpanel'), 'click on empty sky deselects');
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
ok((await p.textContent('#readout')).match(/Pixel \d+, \d+Value -?\d/), 'hover readout');

for (const m of ['m-diff', 'm-track', 'm-blink']) { await p.click('#' + m); ok(await p.getAttribute('#' + m, 'aria-pressed') === 'true', m + ' pressed');
  if (m !== 'm-blink') await p.screenshot({ path: `${OUT}/04-${m}.png` }); }
await p.click('#m-track'); const tl = await p.textContent('#flash'); console.log('track label:', tl);
ok(/5 passes at 0.95 µm, Pass 1 to Pass 6/.test(tl), 'track stacks same-band passes within the selected window');
await p.click('#m-blink');
await p.click('#o-known'); ok(await p.getAttribute('#o-known', 'aria-pressed') === 'true', 'known toggle on');
await p.click('#o-marks'); ok(await p.getAttribute('#o-marks', 'aria-pressed') === 'false', 'flags toggle off');
await p.click('#o-marks'); await p.click('#o-known');
await p.fill('#stretch', '2.5'); await p.dispatchEvent('#stretch', 'input');
await btn('epB', 4).click(); await p.click('#m-diff'); await p.click('#o-known');
await p.screenshot({ path: OUT + '/05-diff-known.png' }); await p.click('#o-known'); await p.click('#m-blink');
ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

// overlay marks sit on the always-dark image, so their colours (the app's Field view colours) don't change with the theme
await btn('epB', 5).click(); await p.click('#m-diff');
const sample = () => p.evaluate(() => { const c = document.getElementById('sky'); return c.toDataURL().length; });
const s0 = await sample();
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(100);
ok(s0 === await sample(), 'canvas overlay colours stay the same on a data-theme change');
await p.screenshot({ path: OUT + '/06-dark.png', fullPage: true });
await p.close();

// ---------- 3. reduced motion: manual flip ----------
const ctxR = await b.newContext({ reducedMotion: 'reduce', viewport: { width: 1200, height: 900 } });
const r = await ctxR.newPage(); await r.goto(URL_); await r.waitForTimeout(1500);
const l0 = await r.textContent('#flash'); await r.waitForTimeout(1500);
ok(l0 === await r.textContent('#flash'), 'reduced motion: no auto blink');
const flip = r.locator('#flip');
ok(await flip.count() === 1 && await flip.isVisible(), 'reduced motion: manual flip control visible');
if (await flip.count()) { await flip.click(); ok((await r.textContent('#flash')).startsWith('Compare'), 'flip shows comparison');
  await r.screenshot({ path: OUT + '/07-reduced-flip.png' }); await flip.click(); ok((await r.textContent('#flash')).startsWith('Reference'), 'flip back to reference'); }
await ctxR.close();
await b.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
