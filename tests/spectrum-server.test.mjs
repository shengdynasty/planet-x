// Spectra on the fly, on the server, against synthetic SPHEREx Level 2 files served by a stand-in IRSA (no network).
// Each file has the real layout (primary, IMAGE, FLAGS, VARIANCE, the WCS-WAVE table at the end, headers of varying
// length), with FLAGS RICE-compressed as IRSA serves it (a binary table, one tile per row) in most files and plain in a
// few, and a star planted with a known spectrum: a power law with a methane-like dip at 3.3 µm.
//   Run:  node --test tests/spectrum-server.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE = mkdtempSync(path.join(os.tmpdir(), 'px-spec-srv-'));
Object.assign(process.env, { PLANETX_CACHE: CACHE, PLANETX_COLLECTIONS: 'spherex_dr1', PLANETX_QUIET: '1' });
after(() => rmSync(CACHE, { recursive: true, force: true }));

// ---------- a tiny FITS writer ----------
const BLOCK = 2880, pad = b => Buffer.concat([b, Buffer.alloc((BLOCK - b.length % BLOCK) % BLOCK)]);
const card = (k, v) => (k.padEnd(8) + '= ' + (typeof v === 'string' ? `'${v.padEnd(8)}'` : typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : String(v).padStart(20))).padEnd(80);
const header = (o, filler = 0) => { const cards = Object.entries(o).map(([k, v]) => card(k, v)); for (let i = 0; i < filler; i++) cards.push(('HISTORY filler card ' + i).padEnd(80)); cards.push('END'.padEnd(80)); return Buffer.from(cards.join('').padEnd(Math.ceil((cards.length * 80) / BLOCK) * BLOCK), 'latin1'); };
const f32 = a => { const b = Buffer.alloc(a.length * 4); a.forEach((v, i) => b.writeFloatBE(v, i * 4)); return pad(b); };
const i32 = a => { const b = Buffer.alloc(a.length * 4); a.forEach((v, i) => b.writeInt32BE(v | 0, i * 4)); return pad(b); };
const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const cdf = (a, mu, s) => 0.5 * (1 + erf((a - mu) / (s * Math.SQRT2)));
/** RICE_1 compression of 32-bit integers (CFITSIO fits_rcomp), to build compressed FLAGS planes for the stand-in files. */
function riceEncode(a, blocksize = 32) {
  const bytes = []; let acc = 0, nacc = 0;
  const put = (v, n) => { for (let k = n - 1; k >= 0; k--) { acc = (acc << 1) | ((v >>> k) & 1); if (++nacc === 8) { bytes.push(acc & 255); acc = 0; nacc = 0; } } };
  put(a[0] >>> 0, 32); let last = a[0] | 0;
  for (let i = 0; i < a.length; i += blocksize) {
    const blk = Math.min(blocksize, a.length - i), diff = []; let sum = 0;
    for (let j = 0; j < blk; j++) { const v = a[i + j] | 0, pd = (v - last) | 0, d = (pd < 0 ? ~(pd << 1) : pd << 1) >>> 0; diff.push(d); sum += d; last = v; }
    const dpsum = Math.max(0, (sum - Math.floor(blk / 2) - 1) / blk); let psum = Math.min(dpsum, 4294967295) >>> 1, fs = 0; while (psum > 0) { fs++; psum >>>= 1; }
    if (fs >= 25) { put(26, 5); for (const d of diff) put(d, 32); }
    else if (fs === 0 && sum === 0) put(0, 5);
    else { put(fs + 1, 5); for (const d of diff) { for (let z = d >>> fs; z > 0; z--) put(0, 1); put(1, 1); if (fs) put(d & ((1 << fs) - 1), fs); } }
  }
  if (nacc) bytes.push((acc << (8 - nacc)) & 255);
  return Buffer.from(bytes);
}
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

const NX = 64, SKY = 1.5, NOISE = 0.05, SIGMA_PSF = 0.45, BANDS = { 1: [0.75, 1.09], 2: [1.10, 1.62], 3: [1.63, 2.41], 4: [2.42, 3.82], 5: [3.83, 4.41], 6: [4.42, 5.00] };
const truth = lam => 12000 * lam ** -0.5 * (lam > 3.15 && lam < 3.45 ? 0.4 : 1); // µJy
const { MJYSR_TO_UJY } = await import('../server/lib/spectrum.mjs');

/** One synthetic exposure file. o: {ra0, dec0 (where CRPIX points), crpix:[x,y] (1-based), lam, mjd, star:{x, y, flux} (0-based px, µJy), flag:{x, y, bit}, nanAt:{x, y}, compressed, variance, filler, seed} */
function exposureFile(o) {
  const r = rng(o.seed), img = new Float32Array(NX * NX), flags = new Int32Array(NX * NX);
  for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) img[j * NX + i] = SKY + NOISE * gauss(r);
  if (o.star) { const tot = o.star.flux / MJYSR_TO_UJY;
    for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) img[j * NX + i] += tot * (cdf(i + 0.5, o.star.x, SIGMA_PSF) - cdf(i - 0.5, o.star.x, SIGMA_PSF)) * (cdf(j + 0.5, o.star.y, SIGMA_PSF) - cdf(j - 0.5, o.star.y, SIGMA_PSF)); }
  if (o.flag) flags[o.flag.y * NX + o.flag.x] = 1 << o.flag.bit;
  if (o.nanAt) img[o.nanAt.y * NX + o.nanAt.x] = NaN; // a masked pixel, as the pipeline leaves a saturated core
  const prim = header({ SIMPLE: true, BITPIX: 8, NAXIS: 0, EXTEND: true });
  const imgH = header({ XTENSION: 'IMAGE', BITPIX: -32, NAXIS: 2, NAXIS1: NX, NAXIS2: NX, PCOUNT: 0, GCOUNT: 1, EXTNAME: 'IMAGE', BUNIT: 'MJy/sr',
    CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRVAL1: o.ra0, CRVAL2: o.dec0, CRPIX1: o.crpix[0], CRPIX2: o.crpix[1], CD1_1: -PIX, CD1_2: 0, CD2_1: 0, CD2_2: PIX,
    'MJD-AVG': o.mjd, CTYPE1W: 'WAVE-TAB', CTYPE2W: 'WAVE-TAB', PV1_3W: 1, PV2_3W: 2 }, o.filler || 0);
  const varH = o.variance ? Buffer.concat([header({ XTENSION: 'IMAGE', BITPIX: -32, NAXIS: 2, NAXIS1: NX, NAXIS2: NX, PCOUNT: 0, GCOUNT: 1, EXTNAME: 'VARIANCE' }), f32(new Float32Array(NX * NX).fill(NOISE ** 2))]) : Buffer.alloc(0);
  let flagHDU;
  if (o.compressed) { // as IRSA serves FLAGS: a RICE_1 tile-compressed binary table, one tile per row, the tiles in the heap
    const tiles = []; for (let j = 0; j < NX; j++) tiles.push(riceEncode(flags.subarray(j * NX, (j + 1) * NX)));
    const table = Buffer.alloc(8 * NX); let off = 0; tiles.forEach((t, j) => { table.writeInt32BE(t.length, 8 * j); table.writeInt32BE(off, 8 * j + 4); off += t.length; });
    flagHDU = Buffer.concat([header({ XTENSION: 'BINTABLE', BITPIX: 8, NAXIS: 2, NAXIS1: 8, NAXIS2: NX, PCOUNT: off, GCOUNT: 1, TFIELDS: 1, TTYPE1: 'COMPRESSED_DATA', TFORM1: `1PB(${Math.max(...tiles.map(t => t.length))})`,
      ZIMAGE: true, ZBITPIX: 32, ZNAXIS: 2, ZNAXIS1: NX, ZNAXIS2: NX, ZTILE1: NX, ZTILE2: 1, ZCMPTYPE: 'RICE_1', ZNAME1: 'BLOCKSIZE', ZVAL1: 32, ZNAME2: 'BYTEPIX', ZVAL2: 4, EXTNAME: 'FLAGS' }, 30), pad(Buffer.concat([table, ...tiles]))]);
  } else flagHDU = Buffer.concat([header({ XTENSION: 'IMAGE', BITPIX: 32, NAXIS: 2, NAXIS1: NX, NAXIS2: NX, PCOUNT: 0, GCOUNT: 1, EXTNAME: 'FLAGS', MP_TRANSIENT: 0, MP_GHOST: 22 }), i32(flags)]);
  const waveH = header({ XTENSION: 'BINTABLE', BITPIX: 8, NAXIS: 2, NAXIS1: 48, NAXIS2: 1, PCOUNT: 0, GCOUNT: 1, TFIELDS: 3, TTYPE1: 'X', TFORM1: '2E', TTYPE2: 'Y', TFORM2: '2E', TTYPE3: 'VALUES', TFORM3: '8E', EXTNAME: 'WCS-WAVE' });
  const bw = o.lam / 41, waveD = Buffer.alloc(48); [0, 200, 0, 200, o.lam, bw, o.lam, bw, o.lam, bw, o.lam, bw].forEach((v, i) => waveD.writeFloatBE(v, i * 4));
  return Buffer.concat([prim, imgH, f32(img), flagHDU, varH, waveH, pad(waveD)]); // the real order: IMAGE, FLAGS, VARIANCE, …, WCS-WAVE
}
const PIX = 6.15 / 3600;

// ---------- target A: thirteen exposures, a planted spectrum, and every way an exposure can be left out ----------
const A = { ra: 150, dec: 2 }, MJD0 = 61000;
const SET_A = [
  [1, 0.85], [1, 1.05], [2, 1.30], [2, 1.55, 'soft'], [3, 1.90], [3, 2.25], [4, 2.70], [4, 3.30], [4, 3.60, 'flagged'],
  [5, 4.00], [5, 4.20, 'edge'], [6, 4.60, 'outside'], [6, 4.90, 'flaky'], [2, 1.42, 'overflow'], [3, 2.05, 'nan'],
].map(([det, lam, kind], k) => {
  const crpix = kind === 'edge' ? [3.4, 31.7] : kind === 'outside' ? [-20, 31.7] : [32.3 + 0.1 * (k % 3), 31.7 - 0.1 * (k % 2)];
  const sx = crpix[0] - 1, sy = crpix[1] - 1, ic = Math.round(sx), jc = Math.round(sy);
  return { id: `a${String(k + 1).padStart(2, '0')}`, det, lam, kind, mjd: MJD0 + k * 0.7, file: exposureFile({ ra0: A.ra, dec0: A.dec, crpix, lam, mjd: MJD0 + k * 0.7, seed: 100 + k,
    star: { x: sx, y: sy, flux: truth(lam) }, flag: kind === 'flagged' ? { x: ic, y: jc, bit: 0 } : kind === 'soft' ? { x: ic + 1, y: jc, bit: 22 } : kind === 'overflow' ? { x: ic, y: jc + 1, bit: 1 } : null,
    nanAt: kind === 'nan' ? { x: ic, y: jc } : null,
    compressed: k !== 1 && k !== 5, variance: k !== 2 && k !== 6, filler: k % 2 ? 45 : 0 }) };
});

// ---------- target B: a fast-moving star (18″/yr east), observed a year before and a year after its reference epoch ----------
const B = { ra: 210, dec: -10 }, PM = { pmra: 18000, pmdec: 0 }, EPOCH = 61000;
const SET_B = [[-365.25, 1.2], [-200, 2.0], [200, 3.0], [365.25, 4.0]].map(([dt, lam], k) => {
  const shiftPx = -(PM.pmra / 1000) * (dt / 365.25) / 6.15; // east is left: x decreases as RA grows
  const crpix = [32.0, 32.0], sx = crpix[0] - 1 + shiftPx, sy = crpix[1] - 1;
  return { id: `b${k + 1}`, det: Math.ceil(lam), lam, mjd: EPOCH + dt, file: exposureFile({ ra0: B.ra, dec0: B.dec, crpix, lam, mjd: EPOCH + dt, seed: 300 + k, star: { x: sx, y: sy, flux: 8000 } }) };
});

// ---------- target C: a star too bright for SPHEREx, saturated in every exposure ----------
const C = { ra: 30, dec: 40 };
const SET_C = [1.0, 2.5, 4.1].map((lam, k) => ({ id: `c${k + 1}`, det: Math.ceil(lam), lam, mjd: 61000 + k,
  file: exposureFile({ ra0: C.ra, dec0: C.dec, crpix: [32, 32], lam, mjd: 61000 + k, seed: 500 + k, star: { x: 31, y: 31, flux: 5e6 }, flag: { x: 31, y: 31, bit: 1 }, nanAt: k === 1 ? { x: 31, y: 31 } : null, compressed: true, variance: true }) }));

// ---------- the stand-in IRSA ----------
const FIELDS = ['obs_id', 'energy_bandpassname', 'em_min', 'em_max', 't_min', 't_max', 't_exptime', 'access_url', 'obs_publisher_did', 'dataproduct_subtype', 'calib_level', 'obs_release_date'];
const vot = rows => `<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="OK"/><TABLE>${FIELDS.map(f => `<FIELD name="${f}" datatype="char"/>`).join('')}<DATA><TABLEDATA>${rows.map(r => `<TR>${FIELDS.map(f => `<TD>${r[f] ?? ''}</TD>`).join('')}</TR>`).join('')}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
const URL_OF = e => `https://irsa.example/${e.id}.fits`;
const row = e => ({ obs_id: e.id, energy_bandpassname: 'D' + e.det, em_min: BANDS[e.det][0] * 1e-6, em_max: BANDS[e.det][1] * 1e-6, t_min: e.mjd - 0.001, t_max: e.mjd + 0.001, t_exptime: 112,
  access_url: URL_OF(e), obs_publisher_did: 'ivo://irsa/' + e.id, dataproduct_subtype: 'science', calib_level: 2, obs_release_date: '2026-11-04T00:00:00' });
const FILES = new Map([...SET_A, ...SET_B, ...SET_C].map(e => [URL_OF(e), e]));
let flaky = true, requests = 0;
globalThis.fetch = async (url, opts = {}) => {
  requests++;
  const u = new URL(url);
  if (u.pathname === '/SIA') { const [, ra] = u.searchParams.get('POS').split(' ').map(Number); /* 'CIRCLE ra dec r' */ return new Response(vot((Math.abs(ra - A.ra) < 1 ? SET_A : Math.abs(ra - C.ra) < 1 ? SET_C : SET_B).map(row)), { status: 200 }); }
  const e = FILES.get(url.split('?')[0]); if (!e) return new Response('no such file', { status: 404 });
  const range = opts.headers && opts.headers.Range, buf = e.file;
  if (!range) return new Response(buf, { status: 200 });
  let m = range.match(/^bytes=(\d+)-(\d+)$/), a, b;
  if (m) { a = +m[1]; b = Math.min(+m[2], buf.length - 1); } else if ((m = range.match(/^bytes=-(\d+)$/))) { a = Math.max(0, buf.length - +m[1]); b = buf.length - 1; }
  if (a > buf.length - 1) return new Response('', { status: 416 });
  if (e.kind === 'flaky' && flaky && a > 4 * BLOCK && b - a > 4 * NX) return new Response('Proxy Error', { status: 502 }); // its pixel reads fail until IRSA recovers
  return new Response(buf.subarray(a, b + 1), { status: 206 });
};
const { buildSpectrum } = await import('../server/lib/spectrum.mjs');
const { riceDecompress } = await import('../server/lib/fits.mjs');

test('RICE_1: what CFITSIO’s encoder writes, the decoder reads back exactly (zeros, sparse bit masks, large and negative values)', () => {
  const r = rng(7), cases = {
    zeros: new Int32Array(2040),
    masks: Int32Array.from({ length: 2040 }, () => (r() < 0.1 ? 1 << Math.floor(r() * 29) : 0) | (r() < 0.02 ? 1 << 21 : 0)),
    random: Int32Array.from({ length: 777 }, () => (r() * 4294967296) | 0),
    ramp: Int32Array.from({ length: 300 }, (_, i) => i * 1000 - 150000),
    edge: Int32Array.from([-2147483648, 2147483647, 0, -1, 1, 1 << 31, 12345]),
  };
  for (const [name, a] of Object.entries(cases)) assert.deepEqual(riceDecompress(riceEncode(a), a.length), a, name);
  assert.throws(() => riceDecompress(riceEncode(cases.masks).subarray(0, 10), 2040), /ended early/);
});

test('one pixel of 1 MJy/sr is 889 µJy with the nominal 6.15″ pixel', () => {
  assert.ok(Math.abs(MJYSR_TO_UJY - 889.0) < 0.5, String(MJYSR_TO_UJY));
});

test('every exposure is measured at its own wavelength, and the brightness follows the planted spectrum within its error', async () => {
  const s = await buildSpectrum({ ra: A.ra, dec: A.dec });
  assert.equal(s.incomplete, true, 'one exposure could not be read');
  assert.deepEqual(s.rejected, { flagged: 1, edge: 1, outside: 1, failed: 1, saturated: 2 }, 'a cosmic ray is flagged; the OVERFLOW flag or a masked core is saturation');
  assert.equal(s.points.length, 9);
  assert.deepEqual(s.points.map(p => p.lambda), [...s.points.map(p => p.lambda)].sort((a, b) => a - b), 'sorted by wavelength');
  for (const p of s.points) {
    const want = truth(p.lambda), z = (p.flux - want) / p.err;
    assert.ok(Math.abs(z) < 4, `${p.obsId} at ${p.lambda} µm: ${p.flux.toFixed(0)} ± ${p.err.toFixed(0)} µJy, planted ${want.toFixed(0)} (z ${z.toFixed(1)})`);
    assert.ok(p.err > 100 && p.err < 500, `${p.obsId}: error ${p.err.toFixed(0)} µJy is the sky noise over the box (expected ≈ 260)`);
  }
  const dip = s.points.find(p => Math.abs(p.lambda - 3.3) < 0.01), side = s.points.find(p => Math.abs(p.lambda - 2.7) < 0.01);
  assert.ok(dip.flux < 0.6 * side.flux, `the 3.3 µm dip shows: ${dip.flux.toFixed(0)} against ${side.flux.toFixed(0)} µJy at 2.7 µm`);
  assert.deepEqual(s.points.find(p => p.obsId === 'a04').soft, ['GHOST'], 'a soft flag in the box is kept and named');
  assert.ok(s.points.every(p => p.obsId !== 'a04' ? p.soft.length === 0 : true));
  assert.ok(s.points.every(p => p.collection === 'spherex_dr1' && Number.isFinite(p.bw) && p.detector >= 1 && p.detector <= 6));
  assert.deepEqual([...new Set(s.points.map(p => p.errFrom))].sort(), ['sky', 'variance'], 'errors from the VARIANCE plane, or the sky scatter where a file has none');
  assert.ok(s.points.every(p => !p.noFlags), 'every file’s FLAGS were read, compressed or plain');
});

test('a spectrum with unread exposures is not kept: asked again, they are retried; a complete one is kept', async () => {
  flaky = false;
  const s = await buildSpectrum({ ra: A.ra, dec: A.dec });
  assert.equal(s.incomplete, undefined); assert.equal(s.points.length, 10); assert.equal(s.rejected.failed, undefined);
  assert.ok(s.points.some(p => p.obsId === 'a13'), 'the exposure that failed before is in');
  const before = requests; await buildSpectrum({ ra: A.ra, dec: A.dec });
  assert.equal(requests, before, 'served from the cache, no request to IRSA');
});

test('a proper motion moves the position to each exposure’s time', async () => {
  const still = await buildSpectrum({ ra: B.ra, dec: B.dec });
  const moving = await buildSpectrum({ ra: B.ra, dec: B.dec, ...PM, epoch: EPOCH });
  assert.equal(moving.points.length, 4); assert.deepEqual(moving.pm, { ...PM, epoch: EPOCH });
  for (const p of moving.points) assert.ok(Math.abs(p.flux - 8000) < 4 * p.err, `with the motion, ${p.obsId}: ${p.flux.toFixed(0)} ± ${p.err.toFixed(0)} µJy (planted 8000)`);
  const far = still.points.filter(p => p.obsId === 'b1' || p.obsId === 'b4');
  assert.ok(far.length === 2 && far.every(p => p.flux < 0.5 * 8000), `without it, the star ~3 px away a year off is mostly outside the box: ${far.map(p => p.flux.toFixed(0)).join(', ')} µJy`);
});

test('a star saturated in every exposure gives an empty spectrum that says why, not an error, and it is kept', async () => {
  const s = await buildSpectrum({ ra: C.ra, dec: C.dec });
  assert.equal(s.points.length, 0); assert.deepEqual(s.rejected, { saturated: 3 }); assert.equal(s.incomplete, undefined);
  const before = requests; await buildSpectrum({ ra: C.ra, dec: C.dec }); assert.equal(requests, before, 'cached like any complete answer');
});
