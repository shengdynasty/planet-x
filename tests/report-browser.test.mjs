// Candidate report, end to end in headless Chrome: open the Field view, select the simulated mover, press Report ↗,
// and check the report tab (tables, stamps, banner, one printed page, a tampered link). From the repo root:
//   node tests/report-browser.test.mjs
// Serves the worktree on 127.0.0.1:8109. Hermetic like tests/field.test.mjs: no local data server, no saved snapshots,
// so the Field view runs on the simulation. Screenshots and PDF → $SHOTS (default: scratchpad/report). Exits 1 on failure.
import fs from 'node:fs';
import { launch, serve, SCRATCH } from './browser.mjs';

const OUT = process.env.SHOTS || SCRATCH + '/report';
const PORT = +(process.env.PORT || 8109), BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT);
process.on('exit', () => { try { srv && srv.kill(); } catch {} });

let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/^http:\/\/(localhost|127\.0\.0\.1):8787\//, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"ok":false,"note":"blocked by test"}' }));
await ctx.route(/\/data\/snapshots\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"targets":[],"note":"blocked by test"}' }));
const errors = []; // third-party hosts (fonts, the QR library on cdnjs) may be unreachable in CI; the page must not depend on them
const watch = p => {
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  p.on('response', r => { if (r.status() >= 400 && r.url().startsWith(BASE) && !/favicon/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`); });
};

// ---------- Field view → Report ↗ ----------
const field = await ctx.newPage(); watch(field);
await field.goto(`${BASE}/app/dev/field.html`); await field.waitForFunction(() => window.__field?.state.results.length > 0);
const items = await field.locator('.fv-dets li').allInnerTexts(), ci = items.findIndex(t => t.includes('Uncatalogued mover'));
ok(ci >= 0, 'simulated mover listed');
await field.locator('.fv-dets button').nth(ci).click();
const btn = field.locator('[data-act="report"]');
ok(await btn.isVisible() && (await btn.innerText()).trim() === 'Report ↗', 'Report ↗ button in the vetting actions');
const [rp] = await Promise.all([ctx.waitForEvent('page'), btn.click()]); watch(rp);
await rp.waitForURL(/\/app\/report\.html#v=1&c=/, { timeout: 20000 });
await rp.waitForFunction(() => window.__report && window.__report.stamps !== 'loading', null, { timeout: 30000 });
const s = await rp.evaluate(() => ({
  stamps: window.__report.stamps, canvases: [...document.querySelectorAll('.rp-figs canvas')].map(c => c.width > 0 && c.height > 0),
  astro: document.querySelectorAll('[data-r="astro"] tbody tr').length, linear: document.querySelectorAll('[data-r="linear"] tbody tr').length,
  fan: document.querySelectorAll('[data-r="fan"] tbody tr').length, sim: !document.querySelector('[data-r="sim"]').hidden,
  status: document.querySelector('.rp-meta .rp-status')?.textContent, text: document.body.innerText, link: document.querySelector('[data-r="link"]').textContent,
  opener: window.opener === null, hash: location.hash.length,
}));
ok(s.stamps === 'drawn' && s.canvases.length === 3 && s.canvases.every(Boolean), 'stamps rebuilt: reference, comparison, difference');
ok(s.astro === 2 && s.linear === 4 && s.fan === 4, 'astrometry, linear and distance tables filled');
ok(s.sim && /SIMULATED DATA/.test(s.text), 'SIMULATED DATA banner on a simulated field');
ok(s.status === 'Candidate, unconfirmed' && !/\bdetection\b/i.test(s.text), 'status "Candidate, unconfirmed"; nothing called a detection');
ok(/Arc too short for an orbit fit/.test(s.text), 'orbit fit not attempted, and says so');
ok(s.link.includes('#v=1&c=') && s.hash < 4096, `permanent link in the footer (${s.hash} chars)`);
ok(s.opener, 'report tab has no opener');
await rp.screenshot({ path: OUT + '/report.png', fullPage: true });

// downloads carry the right headers
const dl = async act => { const [d] = await Promise.all([rp.waitForEvent('download'), rp.click(`[data-act="${act}"]`)]); return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), 'utf8') }; };
const ades = await dl('ades'), csv = await dl('csv'), eph = await dl('eph'), json = await dl('json');
ok(/_SIMULATED\.psv$/.test(ades.name) && ades.text.startsWith('# version=2022\n# For follow-up use; not an MPC submission') && /# SIMULATED DATA/.test(ades.text), 'ADES download: follow-up-only and simulated headers');
ok(csv.text.startsWith('# SIMULATED DATA') && /\nrole,utc,mjd,ra_deg,dec_deg/.test(csv.text), 'CSV download');
ok(eph.text.split('\n').filter(l => /^\d{4}-\d\d-\d\d,/.test(l)).length === 30, 'ephemeris download: 30 nights');
ok(JSON.parse(json.text).simulated === true, 'JSON download');

// one printed page
await rp.emulateMedia({ media: 'print' });
const pdf = await rp.pdf({ format: 'A4', preferCSSPageSize: true }); fs.writeFileSync(OUT + '/report.pdf', pdf);
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
ok(pages === 1, `prints on one A4 page (${pages})`);
ok(await rp.locator('.rp-bar').isHidden(), 'print hides the toolbar');
await rp.emulateMedia({ media: 'screen' });

// a tampered link
const bad = await ctx.newPage(); watch(bad);
await bad.goto(`${BASE}/app/report.html#v=1&c=${'x'.repeat(40)}`); await bad.waitForSelector('[data-r="error"]:not([hidden])');
ok(/could not be opened/.test(await bad.locator('[data-r="error"]').innerText()) && await bad.locator('[data-r="report"]').isHidden(), 'tampered link: clear error, no half-built page');

ok(!errors.length, 'no page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
