// One-off: regenerate tests/fixtures/moving-sky-analyse.json from artifacts/moving-sky/index.html (the reference demo).
// Usage (repo root):  node tests/fixtures/make-moving-sky-fixture.mjs
// Loads the page headlessly with its #test hook (window.__ms) and records analyse() for every ordered
// same-wavelength epoch pair. tests/pipeline.test.mjs asserts app/js/pipeline reproduces this exactly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SCR = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
const { chromium } = await import(process.env.PW_CORE || SCR + '/pw/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(here, '../../artifacts/moving-sky/index.html')).href + '#test';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage();
await p.goto(url); await p.waitForFunction(() => window.__ms);
const out = await p.evaluate(() => {
  const { analyse, EPOCHS, fmtDt, fmtRate } = window.__ms;
  const R = v => Math.round(v * 1e4) / 1e4;
  const pt = q => q ? { x: R(q.x), y: R(q.y), peak: R(q.peak) } : null;
  const pairs = [];
  for (let a = 0; a < EPOCHS.length; a++) for (let c = 0; c < EPOCHS.length; c++) {
    if (a === c || EPOCHS[a].band !== EPOCHS[c].band) continue;
    pairs.push({ a, b: c, results: analyse(a, c).map(r => ({ kind: r.kind, title: r.title, detail: r.detail,
      x: R(r.x), y: R(r.y), from: pt(r.from), to: pt(r.to) })) });
  }
  const fmt = [0.00167, 0.42, 1, 2, 181, 183, 366].map(d => [d, fmtDt(d), fmtRate(100, d)]);
  return { source: 'artifacts/moving-sky/index.html', epochs: EPOCHS, pairs, fmt };
});
await b.close();
fs.writeFileSync(path.join(here, 'moving-sky-analyse.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.pairs.length} pairs, ${out.pairs.reduce((n, p) => n + p.results.length, 0)} results`);
