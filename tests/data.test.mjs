// Data module + server tests.  Run:  node --test tests/data.test.mjs
// Network tests hit IRSA and JPL for real; set PLANETX_OFFLINE=1 to skip them. They use a fresh cache dir
// (cold timings), then repeat the request (warm timings). PLANETX_TEST_KNOWN=1 also runs the slow JPL lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
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
  assert.ok(['Candidate', 'Matched', 'Likely'].includes(c.status));
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

test('field size: one range shared by the deep link, the data module and the server (ISS-24)', async () => {
  const L = await import('../app/js/core/limits.js');
  const S = await import('../server/lib/field.mjs');
  assert.deepEqual([L.FIELD_SIZE_MIN, L.FIELD_SIZE_MAX, L.FIELD_SIZE_DEFAULT], [S.SIZE_MIN, S.SIZE_MAX, S.SIZE_DEFAULT], 'client and server copies agree');
  assert.equal(L.clampFieldSize(3000), 600); assert.equal(L.clampFieldSize(10), 40); assert.equal(L.clampFieldSize(300.4), 300); assert.equal(L.clampFieldSize('x'), 120);
  const { liveSize, HOME } = await dataModule('http://127.0.0.1:9');
  assert.equal(liveSize(10), 40); assert.equal(liveSize(600), 600); assert.equal(liveSize(119.6), 120);
  assert.equal(liveSize(1968), 300, 'a sim-sized field re-requested live gets the 300″ default, not the maximum');
  assert.equal(liveSize(NaN), HOME.sizeArcsec); assert.equal(HOME.sizeArcsec, 120);
});

// ---------- saved snapshots (app/data/snapshots/, written by scripts/save-snapshots.mjs; what the hosted copy shows) ----------
const SNAP_DIR = new URL('../app/data/snapshots/', import.meta.url);
const readSnap = name => JSON.parse(readFileSync(new URL(name, SNAP_DIR), 'utf8'));
/** Serve app/data/snapshots/ over HTTP (Node's fetch has no file: URLs; the browser loads them relative to the app). */
const serveSnapshots = () => http.createServer((req, res) => {
  try { const body = readFileSync(new URL('.' + req.url.split('?')[0], SNAP_DIR)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); }
  catch { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}'); }
});

test('snapshots: one saved field per example target, each decodes via toField; Psyche has its JPL object', async () => {
  const { EXAMPLES } = await import('../app/js/field/examples.js');
  const idx = readSnap('index.json');
  assert.ok(Date.parse(idx.savedAt) > 0, 'savedAt is a date');
  assert.ok(idx.scans.length >= 2, 'home-patch scans for the timeline'); idx.scans.forEach(checkScan);
  assert.equal(idx.targets.length, EXAMPLES.length, 'one snapshot per example (rerun scripts/save-snapshots.mjs if IRSA refused one)');
  const { toField } = await dataModule('http://127.0.0.1:9');
  for (const ex of EXAMPLES) {
    const t = idx.targets.find(x => x.id === ex.id); assert.ok(t, ex.id);
    assert.ok(Math.abs(t.ra - ex.ra) < 1e-6 && Math.abs(t.dec - ex.dec) < 1e-6 && t.sizeArcsec === ex.sizeArcsec && t.det === ex.det, `${ex.id} matches examples.js`);
    assert.ok(!t.partial, `${ex.id}: complete (JPL and Gaia answered)`);
    const j = readSnap(t.file);
    assert.equal(j.simulated, false); assert.ok(j.epochs.length >= 2, `${ex.id}: ≥ 2 epochs`); assert.equal(t.epochs, j.epochs.length);
    assert.equal(j.knownStatus, 'ok'); assert.equal(j.starsStatus, 'ok'); assert.ok(!('timingsMs' in j), 'timings dropped');
    assert.ok(Math.abs(j.ra0 - ex.ra) < 1e-6 && Math.abs(j.dec0 - ex.dec) < 1e-6, 'field centred on the target');
    assert.ok(j.epochs.every(e => typeof e.url === 'string' && /irsa\.ipac\.caltech\.edu/.test(e.url)), 'provenance: every frame names its IRSA file');
    const f = toField(j);
    for (let i = 0; i < j.epochs.length; i++) { const fr = f.frame(i); assert.equal(fr.length, f.N * f.N); assert.ok(fr.every(Number.isFinite), 'finite'); }
    console.log(`  ${ex.id.padEnd(9)} ${j.epochs.length} epochs · ${f.known.length} known · ${f.stars.length} stars · ${(t.bytes / 1024).toFixed(0)} KB`);
  }
  assert.ok(readSnap('psyche.json').known.some(k => /Psyche/.test(k.name) && (k.kind || 'sb') === 'sb'), 'Psyche is a JPL known object in its field');
  assert.ok(idx.candidates.some(c => /Psyche/.test(c.name) && c.status === 'Matched' && c.simulated === false), 'and a Matched candidate for the panel');
  // ISS-09: the Epsilon Indi pair is one Gaia DR3 source; the server names it (GAIA_NAMES) and the saved files say the same
  const { GAIA_NAMES } = await import('../server/lib/gaia.mjs');
  assert.equal(GAIA_NAMES['6412596012146801152'], 'Epsilon Indi Ba/Bb');
  assert.ok(readSnap('epsindi.json').known.some(k => k.name === 'Epsilon Indi Ba/Bb' && k.kind === 'star' && k.gaiaId === '6412596012146801152'), 'named in its field, not listed by Gaia id');
  assert.ok(idx.candidates.some(c => c.name === 'Epsilon Indi Ba/Bb' && c.tag === 'Known high-proper-motion star · Epsilon Indi Ba/Bb'), 'and in the panel');
  for (const c of idx.candidates) {
    for (const k of ['id', 'name', 'tag', 'status', 'band', 'note']) assert.equal(typeof c[k], 'string', k);
    assert.equal(c.pipelineStatus, c.status); assert.ok(c.pos.every(p => p === null || (p.length === 2 && p.every(Number.isFinite))));
    assert.match(c.note, /not a (confirmed pixel|pixel) detection/);
  }
  assert.deepEqual(idx.candidates.map(c => c.id), idx.candidates.map((_, i) => 'k' + String(i + 1).padStart(2, '0')));
});

test('snapshot mode: boots from the saved files when no server answers; getField matches exactly, by containment, or falls back', async () => {
  const srv = serveSnapshots(); const base = await listen(srv);
  globalThis.PLANETX_SNAPSHOTS = base + '/';
  try {
    const store = await freshStore(); const toasts = []; store.listen('toast', m => toasts.push(m));
    const data = await dataModule('http://127.0.0.1:9');
    const t0 = performance.now(); await data.initData(store); console.log(`  snapshot initData: ${(performance.now() - t0).toFixed(0)} ms`);
    const src = store.get('source');
    assert.equal(src.mode, 'snapshot'); assert.equal(src.live, false); assert.equal(src.snapshot, true);
    assert.match(src.note, /^Saved SPHEREx data · saved \d{1,2} \w{3} \d{4}$/);
    assert.ok(data.isSnapshot() && !data.isLive() && data.dataMode() === 'snapshot');
    assert.ok(store.get('scans').length >= 2); store.get('scans').forEach(checkScan);
    assert.ok(store.get('candidates').some(c => /Psyche/.test(c.name) && c.simulated === false), 'Psyche in the panel (ISS-26, snapshot mode)');
    // exact: the Examples menu's own request → the saved field, no note
    const ex = (await import('../app/js/field/examples.js')).EXAMPLES.find(e => e.id === 'psyche');
    const f = await data.getField({ ra: ex.ra, dec: ex.dec, sizeArcsec: ex.sizeArcsec, det: ex.det, t: ex.t });
    assert.equal(f.simulated, false); assert.equal(f.snapshot.id, 'psyche'); assert.equal(f.request.sizeArcsec, 300); assert.equal(f.request.det, 3);
    assert.ok(f.known.some(k => /Psyche/.test(k.name))); assert.ok(f.frame(0) instanceof Float32Array);
    assert.equal(toasts.length, 0, 'no toast for an exact request');
    // containment: a candidate's position 1′ off the centre, the panel's default 120″ → the saved 300″ field, said so
    const g = await data.getField({ ra: ex.ra + 0.0167, dec: ex.dec, sizeArcsec: 120 });
    assert.equal(g.snapshot.id, 'psyche'); assert.equal(g.simulated, false);
    assert.equal(toasts.length, 1); assert.match(toasts[0], /^Showing the saved 300″ field for 16 Psyche/);
    // outside every saved field → simulation, said plainly
    const h = await data.getField({ ra: 10, dec: 10, sizeArcsec: 120 });
    assert.equal(h.simulated, true); assert.match(h.fallbackReason, /No saved SPHEREx data/); assert.equal(toasts.length, 2);
    // findSnapshot: RA wrap at 0h and the containment radius (half the saved size)
    const T = [{ id: 'a', ra: 359.9995, dec: 0, sizeArcsec: 300 }];
    assert.deepEqual([data.findSnapshot(T, 0.0001, 0).target.id, data.findSnapshot(T, 0.0001, 0).exact], ['a', true]);
    assert.equal(data.findSnapshot(T, 0.03, 0).exact, false); assert.equal(data.findSnapshot(T, 0.05, 0), null);
    assert.equal(data.findSnapshot(T, NaN, 0), null);
  } finally { srv.close(); delete globalThis.PLANETX_SNAPSHOTS; }
});

test('getField without ra/dec: refused before any request in live and snapshot modes, still fine for the simulation (ISS-25)', async () => {
  const sim = await dataModule('http://127.0.0.1:9');
  try { assert.equal((await sim.getField({})).simulated, true, 'sim: picks its own centre'); } catch (e) { assert.match(e.message, /pipeline\/index\.js/); }
  // live: a stand-in server (health + one scan) that counts field requests; none may arrive for a request without a position
  let fields = 0;
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0], ok = b => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (p === '/api/health') return ok({ ok: true });
    if (p === '/api/scans') return ok({ epochs: [{ id: 1, label: 'Scan 1', date: 'Sep 2025' }] });
    if (p === '/api/candidates') return ok({ candidates: [] });
    if (p === '/api/field') fields++;
    res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"stand-in server has no fields"}');
  });
  const url = await listen(srv);
  try {
    const store = await freshStore(); const toasts = []; store.listen('toast', m => toasts.push(m));
    const live = await dataModule(url); await live.initData(store);
    assert.equal(store.get('source').mode, 'live');
    for (const q of [{}, { ra: 70.42 }, { ra: 70.42, dec: NaN }, { dec: 19.18, fallback: true }]) await assert.rejects(live.getField(q), /^Error: Field request needs ra and dec$/, JSON.stringify(q));
    assert.equal(fields, 0, 'no /api/field request for a missing position'); assert.equal(toasts.length, 0, 'and no simulated stand-in');
    await assert.rejects(live.getField({ ra: 70.42, dec: 19.18, fallback: false }), /stand-in server has no fields/, 'a complete request still goes to the server');
    assert.equal(fields, 1);
  } finally { srv.close(); }
  const snap = serveSnapshots(); const base = await listen(snap); globalThis.PLANETX_SNAPSHOTS = base + '/';
  try {
    const store = await freshStore(); const data = await dataModule('http://127.0.0.1:9'); await data.initData(store);
    assert.ok(data.isSnapshot());
    await assert.rejects(data.getField({}), /Field request needs ra and dec/);
  } finally { snap.close(); delete globalThis.PLANETX_SNAPSHOTS; }
});

test('?data=sim forces the simulation even when snapshots are available', async () => {
  const srv = serveSnapshots(); const base = await listen(srv);
  globalThis.PLANETX_SNAPSHOTS = base + '/'; globalThis.PLANETX_DATA = 'sim';
  try {
    const store = await freshStore(); const { initData, dataMode } = await dataModule('http://127.0.0.1:9');
    await initData(store);
    assert.equal(store.get('source').mode, 'sim'); assert.equal(dataMode(), 'sim'); assert.match(store.get('source').note, /data=sim/);
    assert.deepEqual(store.get('candidates').map(c => c.id), ['c01', 'c02', 'c03', 'c04', 'c05', 'c06']);
  } finally { srv.close(); delete globalThis.PLANETX_SNAPSHOTS; delete globalThis.PLANETX_DATA; }
});

test('server: a size outside 40–600″ is refused with a 400 that names the range (no upstream call)', async () => {
  const { createServer } = await import('../server/index.mjs');
  const srv = createServer(); const url = await listen(srv);
  try {
    for (const [q, re] of [['size=10', /size=10 \(40–600\)/], ['size=39', /size=39/], ['size=601', /size=601/], ['size=abc', /size=abc/]]) {
      const r = await fetch(`${url}/api/field?ra=70.42&dec=19.18&${q}`); const j = await r.json();
      assert.equal(r.status, 400, q); assert.match(j.error, re);
    }
    const c = await fetch(`${url}/api/candidates?size=20`); assert.equal(c.status, 400);
    assert.match((await c.json()).error, /40–600/);
  } finally { srv.close(); }
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

test('server: known asteroid 16 Psyche is where JPL Horizons says (slow: JPL)', { skip: (OFFLINE || process.env.PLANETX_TEST_KNOWN !== '1') && 'set PLANETX_TEST_KNOWN=1', timeout: 900000 }, async () => {
  const { createServer } = await import('../server/index.mjs');
  const srv = createServer(); const url = await listen(srv);
  try {
    const t0 = performance.now();
    const j = await (await fetch(url + '/api/field?ra=70.2635&dec=19.0558&size=300&det=3&t=61087.1294')).json();
    console.log(`  Psyche field cold: ${((performance.now() - t0) / 1000).toFixed(1)} s, known: ${j.known.map(k => k.name).join(', ')}`);
    const ps = j.known.find(k => /Psyche/.test(k.name)); assert.ok(ps, 'Psyche listed');
    const s = ps.samples[0], { toField } = await dataModule(url), f = toField(j), fr = f.frame(s.i);
    let best = [0, 0, -Infinity];
    for (let y = Math.floor(s.y) - 3; y <= Math.ceil(s.y) + 3; y++) for (let x = Math.floor(s.x) - 3; x <= Math.ceil(s.x) + 3; x++) if (fr[y * f.N + x] > best[2]) best = [x, y, fr[y * f.N + x]];
    console.log(`  Psyche predicted (${s.x}, ${s.y}), brightest pixel nearby (${best[0]}, ${best[1]})`);
    assert.ok(Math.hypot(best[0] - s.x, best[1] - s.y) < 1.5);
  } finally { srv.close(); }
});
