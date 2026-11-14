// Deep-zoom layer logic (no browser):  node tests/deepzoom.test.mjs   (from the repo root)
import { deepMix, horizontalFov, createDeepZoom, deepConfig, SURVEYS, DEEP, ALADIN_ESM } from '../app/js/sky/deepzoom.js';

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL ' + m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// deepMix: NASA picture when wide, tiles when deep, smooth in between
ok(deepMix(60) === 0 && deepMix(DEEP.enterFov) === 0 && deepMix(100) === 0, 'wide view: NASA picture only');
ok(deepMix(DEEP.fullFov) === 1 && deepMix(6) === 1, 'deep view: tiles only');
const mid = deepMix((DEEP.enterFov + DEEP.fullFov) / 2);
ok(near(mid, 0.5), 'half-way is an even mix');
let mono = true, prev = -1; for (let f = DEEP.enterFov; f >= DEEP.fullFov; f -= 0.5) { const m = deepMix(f); if (m < prev - 1e-12) mono = false; prev = m; }
ok(mono, 'mix only grows as you zoom in');
ok(deepMix(NaN) === 0 && deepMix(undefined) === 0, 'bad fov shows the NASA picture');

// horizontalFov: Aladin takes the width, three.js the height (gnomonic, so tan not linear)
ok(near(horizontalFov(10, 1), 10), 'square view: same both ways');
ok(Math.abs(horizontalFov(8, 4 / 3) - 10.653) < 0.01, `4:3 view (${horizontalFov(8, 4 / 3).toFixed(3)})`);
ok(horizontalFov(10, 0.5) < 10, 'portrait view is narrower than tall');

// the package is pinned and comes from the official npm package, not copied into the repo
ok(/aladin-lite@\d+\.\d+\.\d+\/dist\/aladin\.js$/.test(ALADIN_ESM), 'Aladin Lite is pinned');

// URL settings
ok(deepConfig('').enterFov === 28 && deepConfig('').hips === DEEP.hips, 'defaults');
ok(deepConfig('?sky=2mass').hips === SURVEYS['2mass'] && deepConfig('?sky=nonsense').hips === DEEP.hips, '?sky= picks a survey, junk is ignored');
ok(deepConfig('?deep=130').enterFov === 130 && deepConfig('?deep=130').fullFov === 118 && deepConfig('?deep=999').enterFov === 130 && deepConfig('?deep=1').enterFov === 10, '?deep= is clamped and sets the fade range');
ok(deepMix(100, 130, 118) === 1 && deepMix(60, 130, 118) === 1, 'deep=130 means tiles at every zoom the app allows');

// createDeepZoom with a fake Aladin
globalThis.document = { createElement: () => ({ style: {}, appendChild() {} }) };
const mkHost = () => ({ style: {}, appendChild() {} });
const calls = [];
const fakeA = { aladin: (el, opts) => { calls.push(['create', opts.projection, opts.log, opts.survey]); return { gotoRaDec: (r, d) => calls.push(['goto', r, d]), setFoV: f => calls.push(['fov', f]) }; } };
const cam = { raDeg: 269.45, decDeg: 4.69, fovV: 8, aspect: 4 / 3 };
{
  const host = mkHost(); let ready = 0, release;
  const gate = new Promise(r => { release = r; });
  const dz = createDeepZoom(host, { onReady: () => ready++, load: () => gate.then(() => fakeA) });
  ok(dz.update({ ...cam, fovV: 60 }) === 0 && dz.state === 'idle' && host.style.visibility === 'hidden', 'wide view: nothing loaded, layer hidden');
  ok(dz.update(cam) === 0 && dz.state === 'loading', 'zooming in starts loading, still shows the NASA picture');
  release(fakeA); await new Promise(r => setTimeout(r, 10));
  ok(dz.state === 'ready' && ready === 1, 'ready after the library loads');
  ok(calls[0][0] === 'create' && calls[0][1] === 'TAN' && calls[0][2] === false && calls[0][3] === DEEP.hips, 'tangent projection, usage logging off, IRSA tiles');
  calls.length = 0;
  const mix = dz.update(cam);
  ok(mix === 1 && host.style.visibility === 'visible', 'tiles shown once ready');
  ok(calls.some(c => c[0] === 'goto' && c[1] === 269.45 && c[2] === 4.69) && calls.some(c => c[0] === 'fov' && Math.abs(c[1] - 10.653) < 0.01), 'camera is passed on (centre and width)');
  calls.length = 0; dz.update(cam);
  ok(calls.length === 0, 'no redundant calls when the camera has not moved');
  dz.update({ ...cam, raDeg: 270 }); ok(calls.length === 1 && calls[0][0] === 'goto', 'only the changed value is sent');
}
{
  const host = mkHost(); const warn = console.warn; console.warn = () => {};
  const dz = createDeepZoom(host, { load: () => Promise.reject(new Error('blocked')) });
  dz.update(cam); await new Promise(r => setTimeout(r, 10));
  console.warn = warn;
  ok(dz.state === 'failed' && dz.error === 'blocked', 'load failure is recorded');
  ok(dz.update(cam) === 0 && dz.update({ ...cam, fovV: 6 }) === 0, 'after a failure the NASA picture stays, always');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
