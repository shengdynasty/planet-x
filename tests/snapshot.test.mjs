// Snapshot mode in the browser: with no data server to answer (the hosted copy on GitHub Pages), the app boots on the
// saved example fields in app/data/snapshots/ and says so everywhere (badge, Field pill, request section, toasts).
// Run:  node tests/snapshot.test.mjs      (headless Chrome via tests/browser.mjs; one Chrome suite at a time; port 8108)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { launch, serve } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8108, BASE = `http://127.0.0.1:${PORT}/app/`;
const DEAD = 'api=http://127.0.0.1:59999'; // nothing listens there (and Chrome refuses the Node tests' port 9 as unsafe), so the app cannot go live even with a server on :8787
let passes = 0, failures = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); } }

const server = await serve(PORT, ROOT);
const browser = await launch();
const { EXAMPLES } = await import('../app/js/field/examples.js');
const psyche = EXAMPLES.find(e => e.id === 'psyche');

// The dead :9 server's refused health probe logs a resource error by design; anything else is a failure.
const benign = t => /Failed to load resource: (the server responded with a status of 404|net::ERR_(FAILED|CONNECTION_REFUSED))/.test(t);
async function open(query, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 20000 });
  return { ctx, page, errors };
}
const badge = page => page.textContent('#source-text');
const pill = page => page.locator('.fv-pill').innerText();
const fieldState = page => page.evaluate(() => { const s = document.getElementById('view-field').__fv.state; return { simulated: s.field?.simulated, snapshot: s.field?.snapshot || null, kinds: s.results.map(r => r.kind), nStars: s.field?.stars?.length || 0, knownKinds: (s.field?.known || []).map(k => k.kind) }; });
const waitSnapshot = (page, id) => page.waitForFunction(i => document.getElementById('view-field').__fv.state.field?.snapshot?.id === i, id, { timeout: 15000 });
const noErrors = (errors, what) => ok(errors.length === 0, `${what}: no console errors${errors.length ? ': ' + errors.join(' | ').slice(0, 300) : ''}`);

console.log('\n== desktop: no server answers → saved SPHEREx data ==');
{
  const { ctx, page, errors } = await open(DEAD);
  ok(await badge(page) === 'Saved SPHEREx data', 'badge says "Saved SPHEREx data"');
  ok(await page.getAttribute('#source-badge', 'data-mode') === 'snapshot', 'badge data-mode=snapshot');
  const title = await page.getAttribute('#source-badge', 'title');
  ok(/saved \d{1,2} \w{3} \d{4}/.test(title) && /Not a live feed/.test(title), `badge tooltip gives the saved date and says it is not live ("${title.slice(0, 58)}…")`);
  const src = await page.evaluate(() => window.__px.get('source'));
  ok(src.mode === 'snapshot' && src.live === false && src.snapshot === true && src.targets.length === EXAMPLES.length, `source: mode snapshot, live false, ${EXAMPLES.length} targets`);
  const scans = await page.evaluate(() => window.__px.get('scans'));
  ok(scans.length >= 2 && scans.every(s => s.has), `timeline carries the home patch's ${scans.length} real scans (${scans.map(s => s.date).join(', ')})`);
  await page.waitForSelector('#panel .cx-list li[data-id^="k"]', { timeout: 5000 });
  const cands = await page.evaluate(() => window.__px.get('candidates').map(c => ({ name: c.name, status: c.status, simulated: c.simulated })));
  ok(cands.some(c => /Psyche/.test(c.name) && c.status === 'Matched'), `panel lists the saved known objects: ${cands.map(c => c.name).join(', ')}`);
  ok(cands.every(c => c.simulated === false), 'none of them marked simulated');
  ok(!/Simulated/.test(await page.textContent('#panel')), 'panel shows no "Simulated" marker');

  // The Examples menu's own request for 16 Psyche → the saved field, labelled Saved
  await page.evaluate(ex => { window.__px.set('field', { ra: ex.ra, dec: ex.dec, sizeArcsec: ex.sizeArcsec, det: ex.det, t: ex.t }); window.__px.set('view', 'field'); }, psyche);
  await waitSnapshot(page, 'psyche');
  const p1 = await pill(page);
  ok(/^Saved · SPHEREx D3 · [\d.]+ µm$/.test(p1), `Field pill: "${p1}"`);
  ok(/saved \d{1,2} \w{3} \d{4}/.test(await page.getAttribute('.fv-pill', 'title')), 'pill tooltip names the saved date');
  const st = await fieldState(page);
  ok(st.simulated === false && st.snapshot.id === 'psyche', 'the field is the psyche snapshot, not simulated');
  ok(st.kinds.includes('known'), `flagged sources include a Known object (kinds: ${st.kinds.join(', ')})`);
  ok(st.knownKinds.includes('sb'), 'JPL small bodies carried over');
  const live = page.locator('[data-ref="live"]');
  ok(!(await live.evaluate(e => e.hidden)) && (await live.evaluate(e => e.hasAttribute('data-snapshot'))), 'request section shown, in its snapshot form');
  ok(await page.locator('[data-ref="liveform"]').evaluate(e => getComputedStyle(e).display === 'none'), 'free-form request hidden (no server to ask)');
  ok(await page.locator('[data-ref="lex"]').evaluate(e => getComputedStyle(e).display !== 'none'), 'Examples menu still shown');
  ok(await page.textContent('[data-ref="livehead"]') === 'Saved SPHEREx fields', 'section heading says "Saved SPHEREx fields"');
  ok(await page.inputValue('[data-ref="lex"]') === 'psyche', 'Examples menu shows psyche');
  const note = await page.textContent('[data-ref="livenote"]');
  ok(new RegExp(`^Saved data covers these ${EXAMPLES.length} targets\\. Run the local server to request any position\\. Real SPHEREx frames on detector D3`).test(note) && /saved \d{1,2} \w{3} \d{4}/.test(note), `note says what the saved data covers and when it was saved ("${note.slice(0, 70)}…")`);
  ok(/size=300/.test(page.url()) && /det=3/.test(page.url()), `address bar carries the loaded field (${new URL(page.url()).search})`);

  // The Examples menu itself switches fields
  await page.selectOption('[data-ref="lex"]', 'barnard');
  await waitSnapshot(page, 'barnard');
  const p2 = await pill(page);
  ok(/^Saved · SPHEREx D1 · [\d.]+ µm$/.test(p2), `Examples → Barnard's Star: "${p2}"`);
  const st2 = await fieldState(page);
  ok(st2.nStars > 100 && st2.knownKinds.includes('star'), `Gaia stars overlaid (${st2.nStars}) and Barnard's Star carried as a known high-proper-motion star`);

  // A position inside a saved field at the panel's default 120″ (what a candidate's Field button sends) → the saved 300″ field, with a note
  await page.evaluate(ex => window.__px.set('field', { ra: ex.ra + 0.0167, dec: ex.dec, sizeArcsec: 120 }), psyche);
  await waitSnapshot(page, 'psyche');
  ok(/Showing the saved 300″ field for 16 Psyche/.test(await page.textContent('#toast')), 'toast says the saved field was shown instead of the 120″ request');
  ok(await page.inputValue('[data-ref="lex"]') === 'psyche', 'Examples menu names what was loaded, not what was asked');
  noErrors(errors, 'desktop');
  await ctx.close();
}

console.log('\n== deep link outside every saved field → simulation, said plainly ==');
{
  const { ctx, page, errors } = await open(`${DEAD}&ra=10&dec=10&size=120`);
  await page.waitForFunction(() => /Simulated field/.test(document.querySelector('.fv-pill')?.textContent || ''), null, { timeout: 15000 });
  const p = await pill(page);
  ok(/^Simulated field · No saved SPHEREx data for this patch; showing simulated data/.test(p), `pill: "${p.slice(0, 90)}…"`);
  ok(await page.locator('.fv-pill').evaluate(e => e.classList.contains('fv-pill-warn')), 'pill marked as a warning');
  ok(/No saved SPHEREx data/.test(await page.textContent('#toast')), 'toast says so too');
  ok(await badge(page) === 'Saved SPHEREx data', 'badge still reports the data source (saved data; this one field is simulated)');
  ok((await fieldState(page)).simulated === true, 'the field is simulated');
  noErrors(errors, 'deep link');
  await ctx.close();
}

console.log('\n== ?data=sim forces the simulation ==');
{
  const { ctx, page, errors } = await open(`${DEAD}&data=sim`);
  ok(await badge(page) === 'Simulated data', 'badge says "Simulated data"');
  ok(await page.getAttribute('#source-badge', 'data-mode') === 'sim', 'badge data-mode=sim');
  const ids = await page.evaluate(() => window.__px.get('candidates').map(c => c.id).join());
  ok(ids === 'c01,c02,c03,c04,c05,c06', `the six simulated movers (${ids})`);
  ok(/data=sim/.test(await page.getAttribute('#source-badge', 'title')), 'tooltip says why');
  noErrors(errors, 'data=sim');
  await ctx.close();
}

console.log('\n== phone 390×844 ==');
{
  const { ctx, page, errors } = await open(DEAD, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await badge(page) === 'Saved SPHEREx data', 'badge says "Saved SPHEREx data" on a phone');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  await page.evaluate(ex => { window.__px.set('field', { ra: ex.ra, dec: ex.dec, sizeArcsec: ex.sizeArcsec, det: ex.det, t: ex.t }); window.__px.set('view', 'field'); }, psyche);
  await waitSnapshot(page, 'psyche');
  ok(/^Saved · SPHEREx D3/.test(await pill(page)), 'Field view opens the saved Psyche field on a phone');
  noErrors(errors, 'phone');
  await ctx.close();
}

await browser.close();
if (server) server.kill();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
