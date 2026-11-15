// Measured spectra in the Field view, as the hosted copy shows them (saved SPHEREx data, no data server), with a stand-in
// saved spectrum for Barnard's Star: the field-centre button, picking a star in the image, the Spectrum button on a
// selected Gaia star, the CSV, Simple mode and the simulated field.   Run:  node tests/spectrum-browser.test.mjs  (PORT, default 8113)
import path from 'node:path';
import fs from 'node:fs';
import { launch, serve, SCRATCH } from './browser.mjs';
import { EXAMPLES } from '../app/js/field/examples.js';

const PORT = +(process.env.PORT || 8113), BASE = `http://127.0.0.1:${PORT}/app/`;
let fails = 0; const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const ex = EXAMPLES.find(e => e.id === 'barnard');
const lam = Array.from({ length: 40 }, (_, i) => 0.78 + i * 0.105);
const spectrum = { ra: 269.452075, dec: 4.693391, pm: { pmra: -801.551, pmdec: 10362.394, epoch: 57388.5 }, unit: 'µJy', nExposures: 45, nFound: 45, rejected: { flagged: 3, edge: 2 },
  points: lam.map((l, i) => ({ lambda: +l.toFixed(3), bw: +(l / 41).toFixed(4), flux: Math.round(3.2e6 * l ** -1.2), err: 2500, detector: 1 + Math.min(5, Math.floor((l - 0.75) / 0.72)), mjd: 61000 + i, obsId: 'b' + i, collection: 'spherex_dr1', soft: i === 5 || i === 30 ? ['GHOST'] : [] })),
  builtAt: '2026-11-17T09:00:00.000Z' };
const index = { savedAt: '2026-11-17T09:00:00.000Z', spectra: [{ id: 'barnard', label: "Barnard's Star", ra: ex.ra, dec: ex.dec, file: 'barnard.json', n: 40 }] };

await serve(PORT);
const browser = await launch();
async function open(query, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  await ctx.route(/^http:\/\/(localhost|127\.0\.0\.1):8787\//, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"ok":false}' }));
  await ctx.route(/\/data\/spectra\/index\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(index) }));
  await ctx.route(/\/data\/spectra\/barnard\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spectrum) }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|net::ERR_FAILED/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(BASE + '?' + query, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 60000 });
  return { ctx, page, errors };
}
const st = page => page.evaluate(() => { const s = document.getElementById('view-field').__fv.state; return { sim: s.field?.simulated, n: s.field?.epochs.length }; });
const plotted = page => page.evaluate(() => { const svg = document.querySelector('[data-ref="specplot"]'); return { shown: !svg.hasAttribute('hidden') && getComputedStyle(svg).display !== 'none' && svg.getBoundingClientRect().height > 20, circles: svg.querySelectorAll('circle').length, soft: svg.querySelectorAll('circle.soft').length, limits: svg.querySelectorAll('.ul').length }; });
const status = page => page.locator('[data-ref="specstatus"]').innerText();

console.log("hosted copy: the saved Barnard's Star field");
{
  const { ctx, page, errors } = await open(`ra=${ex.ra}&dec=${ex.dec}&size=${ex.sizeArcsec}&det=${ex.det || 1}`);
  await page.waitForFunction(() => { const s = document.getElementById('view-field').__fv.state; return s.field && !s.field.simulated; }, null, { timeout: 30000 });
  ok(await page.locator('[data-ref="specsec"]').isVisible(), 'the SPHEREx spectrum section is there for a real field');
  ok(/Pick a star in the image, or measure the target at the field centre/.test(await status(page)), 'it says how to start');

  await page.click('[data-act="speccentre"]');
  await page.waitForFunction(() => !document.querySelector('[data-ref="specplot"]').hasAttribute('hidden'), null, { timeout: 15000 });
  let p = await plotted(page);
  ok(p.circles === 40 && p.soft === 2 && p.limits === 0, `Field centre draws the saved spectrum: ${p.circles} points, ${p.soft} with a soft flag`);
  ok(/^Barnard's Star \(saved\): 40 measured points\.$/.test(await status(page)), `the status names the star and the count (${await status(page)})`);
  const cap = await page.locator('[data-ref="speccap"]').innerText();
  ok(/Measured from 40 of 45 SPHEREx exposures/.test(cap) && /proper motion \(10\.39″\/yr\)/.test(cap) && /3 flagged/.test(cap) && /Saved 2026-11-17/.test(cap) && /not calibrated photometry/.test(cap), 'the caption says what the points are, the motion, what was left out and that it is saved');
  ok(/Measured SPHEREx spectrum: 40 points from 0\.78 to/.test(await page.locator('[data-ref="specplot"]').getAttribute('aria-label')), 'the plot has a summary for screen readers');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ref="speccsv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n');
  ok(/^planetx-spectrum-269\.4521\+4\.6934\.csv$/.test(dl.suggestedFilename()) && csv.length === 45 && csv[4].startsWith('lambda_um,'), `Download CSV: ${dl.suggestedFilename()}, ${csv.length} lines`);

  await page.click('[data-act="specpick"]');
  ok(await page.getAttribute('[data-act="specpick"]', 'aria-pressed') === 'true' && await page.locator('.fv-stage.fv-picking').count() === 1, 'Pick a star turns picking on (crosshair)');
  const box = await page.locator('.fv-ov').boundingBox();
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.08);
  await page.waitForFunction(() => /saved for/.test(document.querySelector('[data-ref="specstatus"]').textContent), null, { timeout: 10000 }).catch(() => {});
  ok(/^Spectra are saved for Barnard's Star only\. Run the local data server to measure any star\.$/.test(await status(page)) && !(await plotted(page)).shown, 'a star with no saved spectrum says what is saved and how to measure it');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => !document.querySelector('[data-ref="specplot"]').hasAttribute('hidden'), null, { timeout: 10000 }).catch(() => {});
  ok((await plotted(page)).circles === 40 && (await plotted(page)).shown && /^Barnard's Star \(saved\)/.test(await status(page)), `picking the star at the centre finds it in Gaia, saturated core and all, and its saved spectrum (${await status(page)})`);
  await page.keyboard.press('Escape');
  ok(await page.getAttribute('[data-act="specpick"]', 'aria-pressed') === 'false' && await page.evaluate(() => window.__px.get('view')) === 'field', 'Esc stops picking and stays in the Field view');

  // the Spectrum button in the vetting panel: for a flagged source that stays put (Barnard's Star, a Gaia star), not for an artifact
  const kinds = await page.evaluate(() => document.getElementById('view-field').__fv.state.results.map(r => ({ kind: r.kind, star: !!(r.obj && r.obj.kind === 'star') })));
  const iStar = kinds.findIndex(k => k.kind === 'known' && k.star), iArt = kinds.findIndex(k => k.kind === 'art' || (k.kind === 'cand' && false));
  if (iArt >= 0) { await page.locator('.fv-dets button').nth(iArt).click(); ok(!(await page.locator('[data-ref="specsel"]').isVisible()), 'no Spectrum button for an artifact'); }
  if (iStar >= 0) {
    await page.locator('.fv-dets button').nth(iStar).click();
    ok(await page.locator('[data-ref="specsel"]').isVisible(), "a Spectrum button for Barnard's Star, a flagged Gaia star");
    ok(!(await page.locator('[data-ref="spec"]').isVisible()), 'the model spectrum is not shown on real data');
    await page.click('[data-ref="specsel"]');
    await page.waitForFunction(() => !document.querySelector('[data-ref="specplot"]').hasAttribute('hidden'), null, { timeout: 10000 }).catch(() => {});
    ok((await plotted(page)).circles === 40, 'the Spectrum button measures it: the saved spectrum, found where the star is in the field');
  } else ok(false, `the Barnard field should flag Barnard's Star as a known Gaia star (results: ${JSON.stringify(kinds)})`);
  await page.screenshot({ path: path.join(SCRATCH, 'spectrum-barnard.png') });
  await page.locator('[data-ref="specsec"]').screenshot({ path: path.join(SCRATCH, 'spectrum-section.png') });

  await page.click('#mode-switch [data-mode=simple]'); await page.waitForTimeout(300);
  ok(!(await page.locator('[data-ref="specsec"]').isVisible()) && !(await page.locator('[data-ref="specsel"]').isVisible()), 'Simple mode hides spectra');
  await page.click('#mode-switch [data-mode=advanced]');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''}`);
  await ctx.close();
}

console.log('simulated field');
{
  const { ctx, page, errors } = await open('data=sim');
  await page.evaluate(() => document.querySelector('#views [data-view=field]').click());
  await page.waitForFunction(() => document.getElementById('view-field').__fv.state.results.length > 0, null, { timeout: 30000 });
  ok((await st(page)).sim === true && !(await page.locator('[data-ref="specsec"]').isVisible()), 'no SPHEREx spectrum section on simulated data');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
