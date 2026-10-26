// Field view browser test (playwright-core, headless Chrome). From the repo root:  node tests/field.test.mjs
// Serves the worktree on 127.0.0.1:8102 (python http.server) and drives app/dev/field.html, which mounts only
// the field view with the shared store. Screenshots → $SHOTS (default: scratchpad/field). Exits 1 on failure.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCR = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const { chromium } = await import(process.env.PW_CORE || SCR + '/pw/node_modules/playwright-core/index.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHOTS || SCR + '/field';
const PORT = +(process.env.PORT || 8102), BASE = `http://127.0.0.1:${PORT}/app/dev/field.html`;
fs.mkdirSync(OUT, { recursive: true });
const hasData = fs.existsSync(path.join(ROOT, 'app/js/data/index.js'));

const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const cleanup = () => { try { srv.kill(); } catch {} };
process.on('exit', cleanup);
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function open(ctxOpts = {}, query = '') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text() + ' @ ' + (m.location()?.url || '')); });
  p.on('response', r => { if (r.status() >= 400) errs.push(`http ${r.status()}: ${r.url()}`); });
  await p.goto(BASE + query); await p.waitForFunction(() => window.__field?.state.results.length > 0);
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
  // the data module is written in parallel by another agent; until it lands the view falls back to simulateField()
  const real = () => errs.filter(e => hasData || !/data\/index\.js/.test(e) && !/Failed to load resource.*404/.test(e));
  return { ctx, p, errs, real };
}
const det = p => p.locator('.fv-dets li').allInnerTexts();
const pressed = (p, grp) => p.evaluate(g => [...document.querySelectorAll(`[data-ref="${g}"] button`)].findIndex(x => x.getAttribute('aria-pressed') === 'true'), grp);
const ep = (p, grp, i) => p.locator(`[data-ref="${grp}"] button`).nth(i);
const vetHidden = p => p.locator('[data-ref="vet"]').evaluate(e => e.hidden);
const noHScroll = p => p.evaluate(() => { const v = document.querySelector('.fv'); return document.documentElement.scrollWidth <= innerWidth && v.scrollWidth <= v.clientWidth; });

// ---------- desktop ----------
{
  const { ctx, p, real } = await open();
  ok(await p.locator('.fv-pill').innerText() === 'Simulated field', 'header says Simulated field');
  ok(/^RA 04h 41m 40\.8s, Dec \+19° 10′ 48″/.test(await p.locator('[data-ref="pos"]').innerText()), 'header shows field RA/Dec');
  ok((await p.locator('[data-ref="baseline"]').innerText()) === 'Baseline 183 d · both at 0.95 µm', 'header baseline');
  ok(await pressed(p, 'epA') === 0 && await pressed(p, 'epB') === 5, 'defaults to 0 d vs +183 d');
  const items = await det(p); const ci = items.findIndex(t => t.includes('Uncatalogued mover'));
  ok(ci === 0, 'candidate found on 0 d vs +183 d (listed first)');
  ok(items.some(t => t.includes('Brightness change')) && items.some(t => /left the cutout/.test(t)), 'variable and departed asteroid listed');
  ok(!items.join().includes('Detection'), 'nothing called a detection');
  ok(await p.locator('.fv-img').getAttribute('role') === 'img' && (await p.locator('.fv-img').getAttribute('aria-label')).length > 20, 'canvas role=img with label');
  await p.screenshot({ path: OUT + '/desktop-light.png' });

  // selection → vetting
  await p.locator('.fv-dets button').nth(ci).click();
  ok(!(await vetHidden(p)), 'vetting shows on list select');
  ok((await p.locator('[data-ref="vethead"]').innerText()) === 'Vetting: Uncatalogued mover', 'vetting heading');
  ok(await p.evaluate(() => document.activeElement?.closest('.fv-dets') && document.activeElement.getAttribute('aria-pressed') === 'true'), 'focus stays on the selected list item');
  ok(/Selected: Uncatalogued mover/.test(await p.locator('#announce').innerText()), 'selection announced in #announce');
  const kv = await p.locator('[data-ref="kv"]').innerText();
  ok(/Position/.test(kv) && /Displacement/.test(kv) && /Verdict/.test(kv), 'vetting key values');
  ok(await p.locator('[data-ref="spec"] path.l').count() === 1, 'spectrum drawn');
  const right = await p.evaluate(() => Math.max(...[...document.querySelectorAll('[data-ref="spec"] text')].map(t => { const b = t.getBBox(); return b.x + b.width; })));
  ok(right <= 340, `spectrum labels fit the viewBox (${right.toFixed(0)})`);

  // Add to review list
  const before = await p.evaluate(() => window.__px.get('candidates').length);
  await p.locator('[data-ref="add"]').click();
  const cands = await p.evaluate(() => window.__px.get('candidates'));
  const c = cands.at(-1);
  ok(cands.length === before + 1 && c.status === 'Candidate' && c.pipelineStatus === 'Candidate' && c.simulated === true && /^f-\d+\.\d{4}[+-]\d+\.\d{4}$/.test(c.id), 'Add to review list appends a Candidate (status + pipelineStatus, f-<ra><dec> id): ' + c.id);
  ok(Array.isArray(c.pos) && c.pos.length === 2 && Math.abs(c.pos[0][0] - 70.42 / 15) < 0.05 && Math.abs(c.pos[0][1] - 19.18) < 0.5, 'candidate pos is [raHours, decDeg] from radec');
  ok(await p.evaluate(() => window.__px.get('selectedId')) === c.id, 'new candidate becomes selectedId');
  ok(/On review list/.test(await p.locator('[data-ref="add"]').innerText()), 'button reflects it is on the list');
  await p.locator('[data-ref="add"]').click({ force: true });
  ok((await p.evaluate(() => window.__px.get('candidates').length)) === before + 1, 'no duplicate on second click');
  await p.screenshot({ path: OUT + '/desktop-light-selected.png' });
  // the merged candidate panel (app/js/candidates) renders the new entry
  if (fs.existsSync(path.join(ROOT, 'app/js/candidates/index.js'))) {
    const q = await ctx.newPage(); const qerr = []; q.on('pageerror', e => qerr.push(e.message));
    await q.goto(BASE + '?panel=1'); await q.waitForFunction(() => window.__field?.state.results.length > 0);
    await q.locator('.fv-dets button').nth(0).click(); await q.locator('[data-ref="add"]').click();
    const id = await q.evaluate(() => window.__px.get('candidates').at(-1).id);
    await q.evaluate(() => window.__px.set('view', 'sky'));
    const row = q.locator(`#panel [data-id="${id}"]`);
    ok(await row.count() === 1 && await row.isVisible(), 'candidate panel lists the added candidate');
    ok(/Simulated/.test(await row.innerText()), 'panel marks it Simulated');
    await q.screenshot({ path: OUT + '/panel-after-add.png' });
    ok(qerr.length === 0, 'no page errors with the candidate panel: ' + qerr.join(' | '));
    await q.close();
  }

  // mismatch warning + "compare with X instead"
  await ep(p, 'epB', 2).click();
  ok(await p.locator('[data-ref="warn"]').isVisible(), 'wavelength-mismatch warning shown');
  ok(await p.locator('.fv-status').getAttribute('role') === 'status', 'warning sits in role=status');
  ok((await det(p)).join().includes('same wavelength'), 'list explains why it is empty');
  await p.screenshot({ path: OUT + '/desktop-light-mismatch.png' });
  await p.locator('[data-ref="warn"] button').click();
  ok(await pressed(p, 'epB') === 1, '"Compare with +2 min instead" picks nearest same-band pass');
  await ep(p, 'epA', 2).click(); await ep(p, 'epB', 5).click();
  ok((await p.locator('[data-ref="warn"]').innerText()).includes('No other pass'), 'no-match case explained');

  // modes, overlays, readout, keyboard
  await ep(p, 'epA', 0).click(); await ep(p, 'epB', 5).click();
  for (const m of ['diff', 'track', 'blink']) { await p.click(`[data-mode="${m}"]`); ok(await p.getAttribute(`[data-mode="${m}"]`, 'aria-pressed') === 'true', m + ' pressed'); }
  await p.click('[data-mode="track"]');
  ok(/Max-stack of 5 passes at 0\.95 µm, 0 d to \+183 d/.test(await p.locator('[data-ref="flash"]').innerText()), 'track label');
  await p.screenshot({ path: OUT + '/desktop-track.png' });
  await p.click('[data-act="known"]'); ok(await p.getAttribute('[data-act="known"]', 'aria-pressed') === 'true', 'known toggle');
  await p.click('[data-act="marks"]'); ok(await p.getAttribute('[data-act="marks"]', 'aria-pressed') === 'false', 'flags toggle');
  await p.click('[data-act="marks"]'); await p.click('[data-act="known"]');
  const box = await p.locator('.fv-ov').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  ok(/RA .*Dec .*Pixel \d+, \d+.*Stack max -?\d/s.test(await p.locator('[data-ref="readout"]').innerText()), 'hover readout');
  await p.mouse.click(box.x + (96.5 / 320) * box.width, box.y + (92.5 / 320) * box.height);
  ok((await p.locator('.fv-dets button[aria-pressed=true]').innerText()).includes('Brightness'), 'canvas click selects the variable');
  await p.keyboard.press('Escape'); ok(await vetHidden(p), 'Esc clears selection');
  await p.keyboard.press('d'); ok(await p.getAttribute('[data-mode="diff"]', 'aria-pressed') === 'true', 'key D → difference');
  await p.screenshot({ path: OUT + '/desktop-diff.png' });
  await p.keyboard.press('n'); ok((await p.locator('.fv-dets button[aria-pressed=true]').innerText()).includes('Uncatalogued'), 'key N selects first flag');
  await p.keyboard.press('b');

  // show on sky
  await p.click('[data-act="sky"]');
  const fly = await p.evaluate(() => window.__flyto.at(-1));
  ok(fly && Math.abs(fly.ra - 70.42) < 0.5 && Math.abs(fly.dec - 19.18) < 0.5 && await p.evaluate(() => window.__px.get('view')) === 'sky', 'Show on sky emits flyto (degrees) and sets view=sky');
  ok(await p.locator('.fv').evaluate(e => e.hidden), 'view hides when view != field');
  await p.evaluate(() => window.__px.set('view', 'field'));
  ok(!(await p.locator('.fv').evaluate(e => e.hidden)), 'view shows again');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  ok(await p.evaluate(() => window.__px.get('view')) === 'sky', 'Esc with nothing selected goes back to sky');

  // re-centring via store.field
  await p.evaluate(() => { window.__px.set('view', 'field'); window.__px.set('field', { ra: 241.5, dec: 41, sizeArcsec: 1968 }); });
  await p.waitForFunction(() => /^RA 16h 06m/.test(document.querySelector('[data-ref="pos"]').textContent));
  ok(true, 'store.field re-centres the field (RA in degrees)');

  // dark theme
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await p.locator('.fv-dets button').nth(0).click(); await p.waitForTimeout(100);
  await p.screenshot({ path: OUT + '/desktop-dark.png' });
  ok(real().length === 0, 'no console errors (desktop): ' + real().join(' | '));
  await ctx.close();
}

// ---------- phone 390×844, light and dark ----------
for (const theme of ['light', 'dark']) {
  const { ctx, p, real } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, '?theme=' + theme);
  const stage = await p.locator('.fv-img').boundingBox(), side = await p.locator('.fv-side').boundingBox();
  ok(stage.width > 340 && stage.y < 200 && side.y >= stage.y + stage.height, `${theme} phone: stage on top, controls below`);
  ok(await noHScroll(p), `${theme} phone: no horizontal scroll`);
  const small = await p.evaluate(() => [...document.querySelectorAll('.fv button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).length);
  ok(small === 0, `${theme} phone: 44px touch targets (${small} smaller)`);
  await p.screenshot({ path: `${OUT}/phone-${theme}.png` });
  await p.locator('.fv-dets button').nth(0).tap();
  await p.locator('[data-ref="vet"]').scrollIntoViewIfNeeded();
  ok(!(await vetHidden(p)) && await noHScroll(p), `${theme} phone: vetting stacks below, still no horizontal scroll`);
  await p.screenshot({ path: `${OUT}/phone-${theme}-vet.png` });
  await p.locator('.fv').evaluate(e => e.scrollTop = 0);
  await p.screenshot({ path: `${OUT}/phone-${theme}-full.png`, fullPage: false });
  ok(real().length === 0, `no console errors (phone ${theme}): ` + real().join(' | '));
  await ctx.close();
}

// ---------- reduced motion: manual flip ----------
{
  const { ctx, p, real } = await open({ reducedMotion: 'reduce' });
  const l0 = await p.locator('[data-ref="flash"]').innerText(); await p.waitForTimeout(1400);
  ok(l0 === await p.locator('[data-ref="flash"]').innerText(), 'reduced motion: no auto blink');
  const flip = p.locator('[data-act="flip"]');
  ok(await flip.isVisible(), 'reduced motion: flip control visible');
  await flip.click(); ok((await p.locator('[data-ref="flash"]').innerText()).startsWith('Compare'), 'flip shows comparison');
  ok(await p.evaluate(() => document.activeElement?.dataset.act === 'flip'), 'focus stays on flip');
  await flip.click(); ok((await p.locator('[data-ref="flash"]').innerText()).startsWith('Reference'), 'flip back');
  ok(real().length === 0, 'no console errors (reduced motion): ' + real().join(' | '));
  await ctx.close();
}

await browser.close(); cleanup();
console.log(`\nscreenshots: ${OUT}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
