// New-data path in the browser, with no server: the release shows on each image, a release can be typed in, and a field
// saved from one page opens on another (a fresh browser context, as on another machine).
// Run:  node tests/releases-browser.test.mjs      (headless Chrome via tests/browser.mjs; port 8109)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launch, serve } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8109, BASE = `http://127.0.0.1:${PORT}/app/`, DEAD = 'api=http://127.0.0.1:59999';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) fails++; };
const server = await serve(PORT, ROOT), browser = await launch();
const benign = t => /Failed to load resource: (the server responded with a status of 404|net::ERR_(FAILED|CONNECTION_REFUSED|TUNNEL_CONNECTION_FAILED))/.test(t);
async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }), page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 20000 });
  return { ctx, page, errors };
}
const st = page => page.evaluate(() => { const s = document.getElementById('view-field').__fv.state; return { sim: s.field?.simulated, file: s.field?.fromFile?.name || null, n: s.field?.epochs.length, N: s.field?.N }; });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-rel-'));

try {
  console.log('\n== machine 1: saved example field → Save field file ==');
  const { ctx: c1, page: p1, errors: e1 } = await open(DEAD);
  const ex = (await import('../app/js/field/examples.js')).EXAMPLES[0]; // the first saved example
  await p1.goto(`${BASE}?${DEAD}&ra=${ex.ra}&dec=${ex.dec}&size=${ex.sizeArcsec}&det=${ex.det || 1}`);
  await p1.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await p1.waitForFunction(() => document.getElementById('view-field').__fv.state.field && !document.getElementById('view-field').__fv.state.field.simulated, null, { timeout: 20000 }).catch(() => {});
  const s1 = await st(p1); ok(s1.sim === false, 'a real saved field is open');
  ok(await p1.locator('[data-ref="datasec"] h3').innerText() === 'Data releases', 'the Data releases section is there');
  ok(/spherex_/.test(await p1.locator('[data-ref="relline"]').innerText() + await p1.locator('[data-ref="rellist"]').innerText()) || /does not say/.test(await p1.locator('[data-ref="relline"]').innerText()),
    'it says which release the images came from (or that this saved file predates release labels)');
  ok(await p1.locator('[data-ref="savebtn"]').isEnabled(), 'Save field file is enabled for a real field');
  const [dl] = await Promise.all([p1.waitForEvent('download'), p1.click('[data-ref="savebtn"]')]);
  const file = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(file);
  ok(/^planetx-field-.*\.json$/.test(dl.suggestedFilename()) && fs.statSync(file).size > 10000, `downloaded ${dl.suggestedFilename()} (${fs.statSync(file).size} bytes)`);

  console.log('\n== typed release ==');
  await p1.fill('[data-ref="relin"]', 'dr2'); await p1.click('[data-ref="relform"] button');
  ok(/spherex_dr2/.test(await p1.locator('[data-ref="relnote"]').innerText()), 'typed "dr2" is kept as spherex_dr2 and shown');
  ok(JSON.parse(await p1.evaluate(() => localStorage.getItem('planetx.releases.v1'))).includes('spherex_dr2'), 'kept in this browser');
  await p1.fill('[data-ref="relin"]', 'banana'); await p1.click('[data-ref="relform"] button');
  ok(/Not a SPHEREx release name: banana/.test(await p1.locator('[data-ref="relnote"]').innerText()), 'a bad name is refused with the reason');
  await c1.close();

  console.log('\n== machine 2: no server, no saved data → Open field file ==');
  const { ctx: c2, page: p2, errors: e2 } = await open(`${DEAD}&data=sim`);
  await p2.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find(x => /^field$/i.test(x.textContent.trim())); b && b.click(); });
  const before = await st(p2); ok(before.sim !== false, 'before: simulated data');
  await p2.setInputFiles('[data-ref="filein"]', file);
  await p2.waitForFunction(() => document.getElementById('view-field').__fv.state.field?.fromFile, null, { timeout: 15000 });
  const s2 = await st(p2);
  ok(s2.sim === false && s2.file === path.basename(file) && s2.n === s1.n && s2.N === s1.N, `opened ${s2.file}: real field, ${s2.n} images, ${s2.N}×${s2.N} px`);
  ok(/^File · SPHEREx/.test(await p2.locator('.fv-pill').innerText()), 'the Field pill says it came from a file');
  ok(/Opened .*json/.test(await p2.locator('[data-ref="filenote"]').innerText()), 'the note confirms');
  await p2.setInputFiles('[data-ref="filein"]', { name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await p2.waitForFunction(() => /Not a Planet X field file/.test(document.querySelector('[data-ref="filenote"]').textContent), null, { timeout: 5000 });
  ok((await st(p2)).file === path.basename(file), 'a bad file is refused and the open field stays');
  ok(e1.length + e2.length === 0, 'no console errors' + (e1.concat(e2).length ? ': ' + e1.concat(e2).join(' | ').slice(0, 300) : ''));
  await c2.close();
} finally { await browser.close(); server.kill && server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
