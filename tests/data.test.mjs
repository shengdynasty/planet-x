// Data module + server tests.  Run:  node --test tests/data.test.mjs
// Network tests hit IRSA and JPL for real; set PLANETX_OFFLINE=1 to skip them. They use a fresh cache dir
// (cold timings), then repeat the request (warm timings). PLANETX_TEST_KNOWN=1 also runs the slow JPL lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLANETX_CACHE ||= mkdtempSync(join(tmpdir(), 'planetx-cache-'));
process.env.PLANETX_QUIET = '1';
const OFFLINE = process.env.PLANETX_OFFLINE === '1';

/** Import a fresh copy of the data module pointed at `server` (module state is per import). */
async function dataModule(server) {
  globalThis.PLANETX_SERVER = server;
  return import(`../app/js/data/index.js?s=${encodeURIComponent(server)}&n=${Math.random()}`);
}
async function freshStore() { return import(`../app/js/core/store.js?n=${Math.random()}`); }

const listen = srv => new Promise(res => srv.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${srv.address().port}`)));

function checkScan(s) {
  assert.equal(typeof s.id, 'number'); assert.equal(typeof s.label, 'string'); assert.equal(typeof s.date, 'string'); assert.equal(typeof s.has, 'boolean');
}
function checkCandidate(c) {
  for (const k of ['id', 'name', 'tag', 'status', 'band', 'note']) assert.equal(typeof c[k], 'string', k);
  assert.ok(['Candidate', 'Matched', 'Likely', 'Rejected', 'Follow-up'].includes(c.status));
  assert.equal(c.pipelineStatus, c.status);
  assert.ok(Array.isArray(c.pos) && c.pos.every(p => p.length === 2 && p.every(Number.isFinite)));
  assert.equal(typeof c.simulated, 'boolean');
}

test('sim initData: shapes match types.js, ids c01…c06, all simulated', async () => {
  const store = await freshStore();
  const { initData } = await dataModule('http://127.0.0.1:9'); // nothing listens on port 9
  await initData(store);
  const scans = store.get('scans'), cands = store.get('candidates'), src = store.get('source');
  assert.equal(scans.length, 4); scans.forEach(checkScan);
  assert.deepEqual(scans.map(s => s.has), [true, true, true, false]);
  assert.deepEqual(cands.map(c => c.id), ['c01', 'c02', 'c03', 'c04', 'c05', 'c06']);
  cands.forEach(checkCandidate);
  assert.ok(cands.every(c => c.simulated === true));
  assert.equal(src.mode, 'sim'); assert.equal(src.live, false); assert.match(src.note, /Simulated/);
});

test('live client falls back to sim within 2 s when the server is down', async () => {
  const store = await freshStore();
  const { initData } = await dataModule('http://127.0.0.1:9');
  const t0 = performance.now(); await initData(store); const ms = performance.now() - t0;
  console.log(`  fallback (connection refused): ${ms.toFixed(0)} ms`);
  assert.ok(ms < 2000); assert.equal(store.get('source').mode, 'sim');
});

test('live client falls back within 2 s when the server hangs', async () => {
  const sockets = new Set();
  const hang = http.createServer(() => { /* never answer */ });
  hang.on('connection', s => sockets.add(s));
  const url = await listen(hang);
  const store = await freshStore();
  const { initData } = await dataModule(url);
  const t0 = performance.now(); await initData(store); const ms = performance.now() - t0;
  console.log(`  fallback (hung server): ${ms.toFixed(0)} ms`);
  sockets.forEach(s => s.destroy()); hang.close();
  assert.ok(ms < 2000, `${ms} ms`); assert.equal(store.get('source').mode, 'sim');
  assert.match(store.get('source').note, /no local data server/);
});

test('sim getField: simulated field re-centred, or a clear error if the pipeline module is missing', async () => {
  const { getField } = await dataModule('http://127.0.0.1:9');
  try {
    const f = await getField({ ra: 12.5, dec: -30, sizeArcsec: 120 });
    assert.equal(f.simulated, true); assert.equal(f.ra0, 12.5); assert.equal(f.dec0, -30);
    assert.ok(f.frame(0) instanceof Float32Array && f.frame(0).length === f.N * f.N);
  } catch (e) {
    assert.match(e.message, /pipeline\/index\.js/);
  }
});

test('toField: decodes frames and interpolates known-object positions', async () => {
  const { toField } = await dataModule('http://127.0.0.1:9');
  const a = new Float32Array([1, 2, 3, 4]);
  const b64 = Buffer.from(a.buffer).toString('base64');
  const f = toField({ N: 2, scale: 6.15, ra0: 1, dec0: 2, epochs: [{ t: 0 }, { t: 1 }], frames: [b64, b64],
    known: [{ name: 'X', samples: [{ t: 0, x: 0, y: 0 }, { t: 1, x: 2, y: 4 }] }] });
  assert.deepEqual([...f.frame(1)], [1, 2, 3, 4]);
  assert.deepEqual(f.known[0].pos(0.5), [1, 2]);
  assert.deepEqual(f.known[0].pos(50), [-999, -999]);
  assert.equal(f.simulated, false);
});

test('server: /api/health, CORS, and a real /api/field with ≥ 2 epochs', { skip: OFFLINE && 'PLANETX_OFFLINE=1', timeout: 600000 }, async () => {
  const { createServer } = await import('../server/index.mjs');
  const srv = createServer(); const url = await listen(srv);
  try {
    let t0 = performance.now();
    const h = await fetch(url + '/api/health', { headers: { Origin: 'http://localhost:8000' } });
    console.log(`  /api/health: ${(performance.now() - t0).toFixed(0)} ms`);
    assert.equal(h.status, 200); assert.equal((await h.json()).ok, true);
    assert.equal(h.headers.get('access-control-allow-origin'), 'http://localhost:8000');
    const evil = await fetch(url + '/api/health', { headers: { Origin: 'https://example.com' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    const q = '/api/field?ra=70.42&dec=19.18&size=120&known=' + (process.env.PLANETX_TEST_KNOWN === '1' ? '1' : '0');
    t0 = performance.now();
    const r = await fetch(url + q); const cold = performance.now() - t0;
    const j = await r.json();
    assert.equal(r.status, 200, j.error);
    console.log(`  ${q} cold: ${(cold / 1000).toFixed(1)} s (server: ${JSON.stringify(j.timingsMs)}), ${j.epochs.length} frames, D${j.detector} @ ${j.refLambda} µm`);
    t0 = performance.now(); await (await fetch(url + q)).json();
    console.log(`  ${q} warm: ${(performance.now() - t0).toFixed(0)} ms`);

    assert.equal(j.simulated, false);
    assert.ok(j.epochs.length >= 2);
    assert.ok(new Set(j.epochs.map(e => e.scan)).size >= 2, 'frames from ≥ 2 survey epochs');
    const { toField } = await dataModule(url);
    const f = toField(j);
    for (let i = 0; i < j.epochs.length; i++) {
      const fr = f.frame(i);
      assert.equal(fr.length, f.N * f.N);
      assert.ok(fr.every(Number.isFinite), 'finite');
      let lo = Infinity, hi = -Infinity; for (const v of fr) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      assert.ok(hi - lo > 0.05, `non-constant (range ${hi - lo})`);
      assert.ok(j.epochs[i].coverage > 0.9);
      console.log(`    ${j.epochs[i].label.padEnd(8)} ${j.epochs[i].date.slice(0, 10)} λ=${j.epochs[i].lambda} µm band=${j.epochs[i].band} range ${lo.toFixed(3)}…${hi.toFixed(3)} ${j.bunit}`);
    }
    // the same stars appear at the same pixel in every epoch (WCS resampling works): brightest pixel within 1.5 px
    const peak = fr => { let k = 0; for (let p = 1; p < fr.length; p++) if (fr[p] > fr[k]) k = p; return [k % f.N, (k / f.N) | 0]; };
    const p0 = peak(f.frame(0));
    for (let i = 1; i < j.epochs.length; i++) { const p = peak(f.frame(i)); assert.ok(Math.hypot(p[0] - p0[0], p[1] - p0[1]) <= 1.5, `epoch ${i} peak ${p} vs ${p0}`); }

    // live client end to end against this server
    const store = await freshStore();
    const data = await dataModule(url);
    t0 = performance.now(); await data.initData(store);
    console.log(`  live initData: ${(performance.now() - t0).toFixed(0)} ms, ${store.get('scans').length} scans: ${store.get('scans').map(s => s.date).join(', ')}`);
    assert.equal(store.get('source').mode, 'live'); assert.equal(store.get('source').live, true);
    store.get('scans').forEach(checkScan);
    const lf = await data.getField({ ra: 70.42, dec: 19.18, sizeArcsec: 120, known: process.env.PLANETX_TEST_KNOWN === '1' });
    assert.equal(lf.simulated, false); assert.ok(lf.frame(0) instanceof Float32Array);
  } finally { srv.close(); }
});
