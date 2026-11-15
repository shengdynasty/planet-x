// Streamed HD sky tiles in the browser: the manifest's mixed formats (levels 3-5 WebP, level 6 AVIF) load at the 6° zoom
// limit on a desktop and a phone, every request succeeds, and the texture cache stays within its cap.
//   PORT=8110 node tests/hdtiles.test.mjs
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { launch, serve, SCRATCH } from './browser.mjs';

const PORT = +(process.env.PORT || 8110), BASE = `http://127.0.0.1:${PORT}`;
await serve(PORT);
mkdirSync(SCRATCH, { recursive: true });
const browser = await launch();
let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (c) pass++; else fail++; };

console.log('manifest');
const manifest = await (await fetch(`${BASE}/app/assets/skytiles/manifest.json`)).json();
ok(manifest.minLevel === 3 && manifest.maxLevel === 6, `levels ${manifest.minLevel}-${manifest.maxLevel}`);
ok(manifest.ext === 'webp' && manifest.exts && manifest.exts['6'] === 'avif', `default format ${manifest.ext}, per-level ${JSON.stringify(manifest.exts)}`);

for (const [tag, vp, dsf, mobile] of [['desktop', { width: 1280, height: 800 }, 1, false], ['phone', { width: 390, height: 844 }, 3, true]]) {
  console.log(tag);
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: dsf });
  const page = await ctx.newPage(); const errors = [], reqs = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|net::ERR_FAILED/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on('response', r => { const m = r.url().match(/skytiles\/(\d)\/\d+_\d+\.(\w+)$/); if (m) reqs.push({ level: +m[1], ext: m[2], status: r.status() }); });
  await page.goto(`${BASE}/app/?data=sim`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true' && window.__sky && window.__sky.backdrop === 'image', null, { timeout: 30000 });
  await page.waitForFunction(() => !['idle', 'loading'].includes(window.__sky.hd().state), null, { timeout: 20000 });
  const h0 = await page.evaluate(() => window.__sky.hd());
  ok(h0.state === 'ready' && /assets\/skytiles/.test(h0.base), `manifest found under ${h0.base}; level ${h0.level} at the home zoom`);

  // the galactic centre at the zoom limit: the densest sky, where level 6 is wanted
  await page.evaluate(() => window.__px.emit('flyto', { ra: 266.4, dec: -29.0, fov: 6 }));
  await page.waitForFunction(() => { const h = window.__sky.hd(); return h.level === 6 && h.loading === 0 && h.drawn > 0; }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  const h1 = await page.evaluate(() => ({ fov: window.__sky.fov, hd: window.__sky.hd() }));
  ok(h1.hd.level === 6 && h1.hd.drawn > 0, `level 6 drawn at the 6° limit (fov ${h1.fov.toFixed(1)}, level ${h1.hd.level}, ${h1.hd.drawn} tiles drawn of ${h1.hd.visible} visible)`);
  const l6 = reqs.filter(r => r.level === 6), lo = reqs.filter(r => r.level < 6);
  ok(l6.length > 0 && l6.every(r => r.ext === 'avif'), `level 6 tiles requested as AVIF (${l6.length})`);
  ok(lo.length > 0 && lo.every(r => r.ext === 'webp'), `levels 3-5 requested as WebP (${lo.length})`);
  ok(reqs.every(r => r.status === 200), `every tile request answered 200 (${reqs.length})`);
  ok(h1.hd.cached <= (mobile ? 90 : 280), `texture cache within its cap (${h1.hd.cached} of ${mobile ? 90 : 280})`);
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''}`);
  await page.screenshot({ path: path.join(SCRATCH, `hdtiles-${tag}.png`) });
  await ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed. Screenshots: ${SCRATCH}`);
process.exit(fail ? 1 : 0);
