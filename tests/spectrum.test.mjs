// Measured spectra in the app: which sources can have one, the plot, caption and CSV (app/js/field/spectrum.js), and how
// the data module gets one: from the data server, or a saved copy matched by position.   Run:  node --test tests/spectrum.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedSource, spectrumScale, spectrumSVG, spectrumCSV, spectrumCaption, spectrumSummary, compact } from '../app/js/field/spectrum.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const listen = srv => new Promise(res => srv.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${srv.address().port}`)));
async function dataModule(server) { globalThis.PLANETX_SERVER = server; return import(`../app/js/data/index.js?s=${encodeURIComponent(server)}&n=${Math.random()}`); }
async function freshStore() { return import(`../app/js/core/store.js?n=${Math.random()}`); }
const pt = (lambda, flux, err = 100, extra = {}) => ({ lambda, bw: lambda / 41, flux, err, detector: 1 + Math.min(5, Math.floor((lambda - 0.75) / 0.72)), mjd: 61000, obsId: 'e' + lambda, collection: 'spherex_dr1', soft: [], ...extra });

test('only a source that stays put can have a spectrum measured at one spot', () => {
  assert.equal(fixedSource({ kind: 'var' }), true, 'a star that changed brightness');
  assert.equal(fixedSource({ kind: 'known', obj: { kind: 'star' } }), true, 'a Gaia star (its proper motion is passed on)');
  assert.equal(fixedSource({ kind: 'cand', to: {} }), true, 'a new source with no counterpart');
  assert.equal(fixedSource({ kind: 'cand', from: {}, to: {} }), false, 'an uncatalogued mover');
  assert.equal(fixedSource({ kind: 'known', obj: { kind: 'sb' } }), false, 'an asteroid');
  for (const kind of ['art', 'left']) assert.equal(fixedSource({ kind }), false, kind);
  assert.equal(fixedSource(null), false);
});

test('the flux axis is linear for a modest range and logarithmic when detections span more than 30×; upper limits only on a log axis', () => {
  const flat = [0.8, 1.5, 2.5, 3.5, 4.5].map(l => pt(l, 5000 + 300 * l));
  assert.equal(spectrumScale(flat).log, false);
  const deep = [0.8, 1.5, 2.5, 3.3, 4.5].map(l => pt(l, l === 3.3 ? 80 : 9000, 10));
  const sc = spectrumScale(deep);
  assert.equal(sc.log, true, '9000 against 80 µJy: log'); assert.ok(sc.y0 < Math.log10(80) && sc.y1 > Math.log10(9010));
  const withLimit = [...deep, pt(1.0, 5, 10)];
  assert.equal(spectrumScale(withLimit).limits.size, 1, 'a point below 2σ is an upper limit on the log axis');
  assert.equal(spectrumScale([pt(1, 50, 100), pt(2, -30, 100)]).log, false, 'nothing detected: a linear axis around zero');
});

test('the plot draws a point and an error bar per measurement, a triangle per upper limit, the six detectors, and nothing from the data as text', () => {
  const pts = [...[0.8, 1.2, 1.9, 2.6, 3.3, 4.0, 4.6].map(l => pt(l, l === 3.3 ? 60 : 8000, 10)), pt(1.0, 4, 10), pt(2.0, 7000, 10, { soft: ['GHOST'], obsId: '<img src=x onerror=alert(1)>' })];
  const svg = spectrumSVG(pts);
  assert.equal((svg.match(/<circle/g) || []).length, 8); assert.equal((svg.match(/class="ul"/g) || []).length, 1);
  assert.equal((svg.match(/class="eb"/g) || []).length, 8); assert.equal((svg.match(/pt soft/g) || []).length, 1);
  for (let d = 1; d <= 6; d++) assert.ok(svg.includes(`>D${d}<`), `detector D${d} labelled`);
  assert.ok(!/NaN|undefined|<img|onerror/.test(svg), 'only numbers reach the markup');
  assert.equal(spectrumSVG([]).includes('<circle'), false, 'an empty spectrum draws the axes only');
});

test('the CSV says what the numbers are, has one row per point, and defuses spreadsheet formulas in text cells', () => {
  const s = { ra: 70.2635, dec: -19.05, pm: { pmra: -801.6, pmdec: 10362.4, epoch: 57388.5 }, nExposures: 12, rejected: { flagged: 2 },
    points: [pt(1.0, 5000), pt(2.0, -12.5, 100, { obsId: '=HYPERLINK("http://x")', soft: ['GHOST', 'HALO'] })] };
  const lines = spectrumCSV(s).trim().split('\n');
  assert.equal(lines.filter(l => l.startsWith('#')).length, 4); assert.equal(lines[4], 'lambda_um,bandwidth_um,flux_uJy,err_uJy,snr,detector,mjd,obs_id,collection,soft_flags');
  assert.equal(lines.length, 7);
  assert.match(lines[1], /RA 70\.26350 deg, Dec -19\.05000 deg, proper motion -801\.6\/10362\.4 mas\/yr/);
  assert.match(lines[6], /^2,[\d.]+,-12\.5,100,-0\.1,/, 'a negative flux stays a number');
  assert.ok(lines[6].includes(`"'=HYPERLINK(""http://x"")"`), 'a formula in a text cell is defused and quoted');
  assert.ok(lines[6].endsWith(',GHOST HALO'));
});

test('the caption names what each point is, what was left out and where the numbers came from', () => {
  const s = { points: [pt(1, 5000), pt(2, 6000, 100, { soft: ['GHOST'] })], nExposures: 9, rejected: { flagged: 3, edge: 1, outside: 3 }, source: 'saved', builtAt: '2026-11-17T10:00:00Z', pm: { pmra: 3000, pmdec: 4000, epoch: 57388.5 } };
  const c = spectrumCaption(s, 'RA 17h 57m 48s, Dec +04° 41′ 36″');
  for (const want of ['Measured from 2 of 9 SPHEREx exposures at RA 17h 57m 48s', 'proper motion (5.00″/yr)', 'relative, not calibrated photometry', '3 flagged', '1 at the detector edge', '3 off the detector', 'Open circles', 'Saved 2026-11-17'])
    assert.ok(c.includes(want), `caption mentions "${want}": ${c}`);
  assert.match(spectrumSummary(s), /^Measured SPHEREx spectrum: 2 points from 1\.00 to 2\.00 µm, brightest at 2\.00 µm/);
  assert.equal(compact(25300), '25k'); assert.equal(compact(-1234), '-1.2k');
});

test('a saved spectrum answers for a position within 1.5 pixels of its own, the nearest first', async () => {
  const { findSavedSpectrum, SPECTRUM_MATCH_ARCSEC } = await dataModule('http://127.0.0.1:9');
  assert.equal(SPECTRUM_MATCH_ARCSEC, 9);
  const list = [{ id: 'a', ra: 100, dec: 10 }, { id: 'b', ra: 100 + 6 / 3600, dec: 10 }];
  assert.equal(findSavedSpectrum(list, 100 + 5 / 3600, 10).id, 'b', 'nearest wins');
  assert.equal(findSavedSpectrum(list, 100, 10 + 12 / 3600), null, '12″ away: no match');
  assert.equal(findSavedSpectrum(null, 100, 10), null);
});

test('live: the data server is asked with the position, proper motion, epoch and typed releases', async () => {
  let asked = null;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), ok = b => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/health') return ok({ ok: true });
    if (u.pathname === '/api/scans') return ok({ epochs: [{ id: 1, label: 'Scan 1', date: 'Sep 2025' }] });
    if (u.pathname === '/api/candidates') return ok({ candidates: [] });
    if (u.pathname === '/api/spectrum') { asked = Object.fromEntries(u.searchParams); return ok({ ra: +asked.ra, dec: +asked.dec, points: [pt(1, 5000)], nExposures: 1, rejected: {} }); }
    res.writeHead(404); res.end('{}');
  });
  const url = await listen(srv), mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  try {
    const store = await freshStore(), data = await dataModule(url); await data.initData(store);
    assert.equal(store.get('source').mode, 'live');
    data.setReleases(['spherex_dr2']);
    const s = await data.getSpectrum({ ra: 269.452075, dec: 4.693391, pmra: -801.551, pmdec: 10362.394, epoch: 57388.5 });
    assert.deepEqual(asked, { ra: '269.452075', dec: '4.693391', pmra: '-801.551', pmdec: '10362.394', epoch: '57388.5', collections: 'spherex_dr2' });
    assert.equal(s.source, 'live'); assert.equal(s.points.length, 1);
    await data.getSpectrum({ ra: 10, dec: 20 }); assert.equal(asked.pmra, undefined, 'no proper motion: none sent');
    await data.getSpectrum({ ra: 10, dec: 20, near: [10.0015, 20.0007] }); assert.deepEqual([asked.sra, asked.sdec], ['10.0015', '20.0007'], 'where the star is in the field is where IRSA is searched');
    await assert.rejects(data.getSpectrum({ ra: NaN, dec: 20 }), /No position/);
  } finally { srv.close(); delete globalThis.localStorage; }
});

test('hosted copy: a saved spectrum is found by where the star is in the field, and anywhere else says what is saved', async () => {
  const spectrum = { ra: 269.452075, dec: 4.693391, points: [pt(1.0, 5000), pt(2.0, 6000)], nExposures: 2, rejected: {}, builtAt: '2026-11-17T10:00:00Z' };
  const index = { savedAt: '2026-11-17T10:00:00Z', spectra: [{ id: 'barnard', label: "Barnard's Star", ra: 269.4486, dec: 4.7392, file: 'barnard.json' }] };
  const files = srv => http.createServer((req, res) => { // the repo's snapshots under /snap/, the stand-in spectra under /spec/
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/spec/')) { const b = p === '/spec/index.json' ? index : p === '/spec/barnard.json' ? spectrum : null; res.writeHead(b ? 200 : 404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(b || {})); }
    const f = normalize(join(ROOT, 'app/data/snapshots', p.replace(/^\/snap\//, '')));
    if (p.startsWith('/snap/') && f.startsWith(join(ROOT, 'app/data/snapshots')) && existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(readFileSync(f)); }
    res.writeHead(404); res.end('{}');
  });
  const srv = files(); const base = await listen(srv);
  globalThis.PLANETX_SNAPSHOTS = base + '/snap/'; globalThis.PLANETX_SPECTRA = base + '/spec/';
  try {
    const store = await freshStore(), data = await dataModule('http://127.0.0.1:9'); await data.initData(store);
    assert.ok(data.isSnapshot(), 'no server: the saved data');
    // the catalogue (J2016) position of a fast star is far from where it is now; `near` is where it is in the field
    const s = await data.getSpectrum({ ra: 269.452075, dec: 4.693391, pmra: -801.551, pmdec: 10362.394, near: [269.4486 + 3 / 3600, 4.7392] });
    assert.equal(s.source, 'saved'); assert.equal(s.savedLabel, "Barnard's Star"); assert.equal(s.points.length, 2);
    await assert.rejects(data.getSpectrum({ ra: 269.452075, dec: 4.693391 }), /Spectra are saved for Barnard's Star only\. Run the local data server/, 'its catalogue position alone is 164″ off');
    await assert.rejects(data.getSpectrum({ ra: 10, dec: 20 }), /saved for Barnard's Star only/);
  } finally { srv.close(); delete globalThis.PLANETX_SNAPSHOTS; delete globalThis.PLANETX_SPECTRA; }
});

test('simulated data has no SPHEREx spectrum', async () => {
  globalThis.PLANETX_DATA = 'sim';
  try { const store = await freshStore(), data = await dataModule('http://127.0.0.1:9'); await data.initData(store); await assert.rejects(data.getSpectrum({ ra: 10, dec: 20 }), /Simulated data has no SPHEREx spectrum/); }
  finally { delete globalThis.PLANETX_DATA; }
});
