// Spectra on the fly: how bright one position is in every SPHEREx exposure that covers it, at the wavelength each
// exposure saw there. SPHEREx's linear-variable filters make the wavelength depend on where a position falls on the
// detector, so one survey pass samples about a hundred wavelengths from 0.75 to 5 µm across the six detectors.
//
// Each exposure's stamp (11 × 11 detector pixels around the position) is read straight from the full Level 2 file with
// HTTP Range requests, about 250 kB in all instead of a 5 MB cutout (mostly the PSF cube): an 11-row band of the IMAGE and
// VARIANCE planes (plain floats), and the same rows of the FLAGS plane, which IRSA stores RICE-compressed as a binary
// table with one tile per detector row (its tile pointers, then those tiles' bytes, decoded by fits.mjs riceDecompress;
// checked pixel for pixel against IRSA's uncompressed cutouts of the same exposures). The headers come from the same
// cached reads the field builder uses for the wavelength at the target.
//
// Brightness is the 5 × 5-pixel sum above the local sky (the median of the stamp outside its central 7 × 7), the same
// box the app's variability test uses (app/js/pipeline/detect.js apFlux), converted from MJy/sr with the nominal 6.15″
// pixel. It is a relative spectrum, not calibrated photometry: no aperture correction, no colour terms. Its error comes
// from the pipeline's VARIANCE plane summed over the box (the star's own noise included) plus the sky level's
// uncertainty; without a VARIANCE plane, from the sky's robust scatter alone.
// An exposure is left out when the position falls outside the detector or within 5 px of its edge, or when a pixel of
// the 5 × 5 box is NaN or carries a hard SPHEREx flag (cosmic ray, saturation, bad pixel). Soft flags (ghost, halo,
// persistence) are kept and named on the point.
import { searchExposures, isCollectionName, exposureAtTarget } from './irsa.mjs';
import { fetchBuf, mapLimit, memoJSON } from './net.mjs';
import { parseHeader, dataBytes, padded, riceDecompress } from './fits.mjs';
import { flagBitsOf } from './field.mjs';

export const STAMP_HALF = 5, APERTURE_HALF = 2, SKY_INNER = 4; // 11 × 11 stamp, 5 × 5 box, sky at Chebyshev distance ≥ 4
export const PIXEL_ARCSEC = 6.15;
/** One pixel of 1 MJy/sr, in µJy: (6.15″)² in steradians × 10¹² µJy per MJy. */
export const MJYSR_TO_UJY = (PIXEL_ARCSEC / 206264.806) ** 2 * 1e12;
export const MAX_EXPOSURES = 400; // the survey's deep fields near the ecliptic poles have thousands: keep the most recent
const J2016_MJD = 57388.5, SURVEY_MID_MJD = 61100, HOUR = 3600000, MIN_SKY = 20; // SURVEY_MID: Feb 2026, between SPHEREx's first passes

/** Spectrum builds in progress (cold cache), for GET /api/progress: id → {ra, dec, stage, label, done, total, started}. */
export const spectrumProgress = new Map();
const building = new Map();

/** Where an exposure file's IMAGE plane sits: its header (the same cached Range read as exposureHeader), the byte offset
 *  of its pixels, and the offset of the HDU after it. */
export async function imageLayout(url) {
  for (const len of [57600, 172800]) {
    const buf = await fetchBuf(url, { ns: 'hdr', range: `bytes=0-${len - 1}` });
    const p = parseHeader(buf, 0); if (!p) continue;
    const off = p.end + padded(dataBytes(p.kv)), h = parseHeader(buf, off); if (!h) continue;
    if (String(h.kv.EXTNAME || '').trim() !== 'IMAGE' || (h.kv.BITPIX | 0) !== -32) throw new Error(`First extension of ${url} is not a float IMAGE plane`);
    return { kv: h.kv, dataStart: h.end, next: h.end + padded(dataBytes(h.kv)) };
  }
  throw new Error('Could not read the image header of ' + url);
}

/** The header and pixel offset of the HDU called `name`, walking the HDUs from byte `start` (headers only, cached). */
export async function planeLayout(url, start, name, maxHdus = 6) {
  let off = start;
  for (let k = 0; k < maxHdus; k++) {
    let h = null;
    try { for (const len of [5760, 28800]) { h = parseHeader(await fetchBuf(url, { ns: 'hdr', range: `bytes=${off}-${off + len - 1}` }), 0); if (h) break; } }
    catch (e) { if (e.status === 416) return null; throw e; } // walked past the last HDU: the file has no such plane
    if (!h) throw new Error(`No FITS header at byte ${off} of ${url}`);
    if (String(h.kv.EXTNAME || '').trim() === name) return { kv: h.kv, dataStart: off + h.end };
    off += h.end + padded(dataBytes(h.kv));
  }
  return null;
}

const zval = (kv, name) => { for (let k = 1; k < 20; k++) if (String(kv['ZNAME' + k] || '').trim() === name) return kv['ZVAL' + k]; return undefined; };

/** Rows j0..j1 of an integer mask plane as Uint32 bit masks, {nx, rows}: a plain image, or a RICE-compressed one stored as
 *  a binary table of full-width tiles (how IRSA serves the SPHEREx FLAGS plane). */
export async function readMaskRows(url, plane, j0, j1) {
  const kv = plane.kv;
  if (kv.ZIMAGE !== true) {
    const nx = kv.NAXIS1 | 0, bp = kv.BITPIX | 0, buf = await readRows(url, plane, j0, j1), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), rows = new Uint32Array((j1 - j0 + 1) * nx);
    for (let i = 0; i < rows.length; i++) rows[i] = bp === 32 ? dv.getInt32(i * 4, false) >>> 0 : bp === 16 ? dv.getInt16(i * 2, false) >>> 0 : bp === 8 ? dv.getUint8(i) : 0;
    return { nx, rows };
  }
  const cmp = String(kv.ZCMPTYPE || '').trim(), nx = kv.ZNAXIS1 | 0, ny = kv.ZNAXIS2 | 0, tw = kv.ZTILE1 || nx, th = kv.ZTILE2 || 1;
  if (cmp !== 'RICE_1') throw new Error(`Mask plane compressed with ${cmp || 'an unknown method'}: not supported`);
  if (tw !== nx) throw new Error('Mask plane tiles narrower than a row: not supported');
  const col = [1, 2, 3, 4].find(c => String(kv['TTYPE' + c] || '').trim() === 'COMPRESSED_DATA') || 1;
  const tform = String(kv['TFORM' + col] || '').trim(), wide = /^\d*Q/.test(tform), rowB = kv.NAXIS1 | 0;
  let colOff = 0; for (let c = 1; c < col; c++) { const m = String(kv['TFORM' + c]).trim().match(/^(\d*)([A-Z])/); colOff += (m[1] === '' ? 1 : +m[1]) * ({ P: 8, Q: 16, J: 4, E: 4, D: 8, I: 2, K: 8, B: 1 }[m[2]] || 0); }
  const t0 = Math.floor(j0 / th), t1 = Math.floor(j1 / th);
  const desc = await fetchBuf(url, { ns: 'stamp', range: `bytes=${plane.dataStart + t0 * rowB}-${plane.dataStart + (t1 + 1) * rowB - 1}`, accept: [206] });
  const dv = new DataView(desc.buffer, desc.byteOffset, desc.byteLength), tiles = [];
  for (let t = t0; t <= t1; t++) {
    const o = (t - t0) * rowB + colOff;
    tiles.push(wide ? { t, n: Number(dv.getBigInt64(o, false)), off: Number(dv.getBigInt64(o + 8, false)) } : { t, n: dv.getInt32(o, false), off: dv.getInt32(o + 4, false) });
  }
  const heap = plane.dataStart + (kv.THEAP ?? rowB * (kv.NAXIS2 | 0)), a = Math.min(...tiles.map(x => x.off)), b = Math.max(...tiles.map(x => x.off + x.n));
  const hb = await fetchBuf(url, { ns: 'stamp', range: `bytes=${heap + a}-${heap + b - 1}`, accept: [206] });
  const blocksize = zval(kv, 'BLOCKSIZE') ?? 32, bytepix = zval(kv, 'BYTEPIX') ?? 4, rows = new Uint32Array((j1 - j0 + 1) * nx);
  for (const { t, n, off } of tiles) {
    const inTile = Math.min(th, ny - t * th), vals = riceDecompress(hb.subarray(off - a, off - a + n), inTile * nx, blocksize, bytepix);
    for (let r = 0; r < inTile; r++) { const j = t * th + r; if (j < j0 || j > j1) continue; for (let i = 0; i < nx; i++) rows[(j - j0) * nx + i] = vals[r * nx + i] >>> 0; }
  }
  return { nx, rows };
}

/** Rows j0..j1 of an image plane, full width, as one Range read (only a partial answer is accepted: never the whole file). */
async function readRows(url, plane, j0, j1) {
  const bpp = Math.abs(plane.kv.BITPIX | 0) / 8, nx = plane.kv.NAXIS1 | 0;
  const a = plane.dataStart + j0 * nx * bpp, b = plane.dataStart + (j1 + 1) * nx * bpp - 1;
  const buf = await fetchBuf(url, { ns: 'stamp', range: `bytes=${a}-${b}`, timeoutMs: 60000, accept: [206] });
  if (buf.length !== b - a + 1) throw new Error(`Short read (${buf.length} of ${b - a + 1} bytes) from ${url}`);
  return buf;
}

const median = a => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : NaN; };

/**
 * One exposure's point at (ra, dec): {lambda, bw, flux, err, detector, mjd, obsId, collection, soft, offset} with flux and
 * err in µJy, or {skip: 'outside' | 'edge' | 'saturated' | 'flagged' | 'sky'} when it cannot be measured there.
 */
export async function measureExposure(exp, ra, dec) {
  const at = await exposureAtTarget(exp, ra, dec);
  if (!at.inside) return { skip: 'outside' };
  const img = await imageLayout(exp.url), nx = img.kv.NAXIS1 | 0, ny = img.kv.NAXIS2 | 0, H = STAMP_HALF, S = 2 * H + 1;
  const x = at.pixel[0] - 1, y = at.pixel[1] - 1, ic = Math.round(x), jc = Math.round(y); // FITS 1-based → 0-based
  if (ic - H < 0 || jc - H < 0 || ic + H > nx - 1 || jc + H > ny - 1) return { skip: 'edge' };
  const flags = await planeLayout(exp.url, img.next, 'FLAGS'), variance = await planeLayout(exp.url, img.next, 'VARIANCE');
  const [ib, fm, vb] = await Promise.all([readRows(exp.url, img, jc - H, jc + H), flags ? readMaskRows(exp.url, flags, jc - H, jc + H) : null,
    variance && (variance.kv.BITPIX | 0) === -32 ? readRows(exp.url, variance, jc - H, jc + H) : null]);
  const bs = img.kv.BSCALE ?? 1, bz = img.kv.BZERO ?? 0, di = new DataView(ib.buffer, ib.byteOffset, ib.byteLength);
  const dvv = vb && new DataView(vb.buffer, vb.byteOffset, vb.byteLength), vnx = variance ? variance.kv.NAXIS1 | 0 : 0;
  // the pipeline's own bits only: MASKED and OFF_IMAGE are names the field builder gives its resampled grid
  const bits = flags ? flagBitsOf(flags.kv) : null;
  const maskOf = list => (bits ? list.filter(n => n !== 'MASKED' && n !== 'OFF_IMAGE' && bits.names[n] != null) : []).reduce((m, n) => (m | (1 << bits.names[n])) >>> 0, 0);
  const HARD = maskOf(bits ? bits.hard : []), SOFT = maskOf(bits ? bits.soft : []);
  const OVERFLOW = bits && bits.names.OVERFLOW != null ? (1 << bits.names.OVERFLOW) >>> 0 : 0;
  let sum = 0, nAp = 0, soft = 0, varSum = 0, varOk = !!dvv, nan = 0, hard = 0; const sky = [];
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
    const col = ic - H + c, v = di.getFloat32((r * nx + col) * 4, false) * bs + bz, f = fm ? fm.rows[r * fm.nx + col] : 0;
    const d = Math.max(Math.abs(r - H), Math.abs(c - H));
    if (d <= APERTURE_HALF) {
      if (!Number.isFinite(v)) { nan++; continue; }
      hard = (hard | (f & HARD)) >>> 0; sum += v; nAp++; soft |= f & SOFT;
      if (varOk) { const w = dvv.getFloat32((r * vnx + col) * 4, false); if (Number.isFinite(w) && w >= 0) varSum += w; else varOk = false; }
    } else if (d >= SKY_INNER && Number.isFinite(v) && !(f & (HARD | SOFT))) sky.push(v);
  }
  // a masked (NaN) pixel or the OVERFLOW flag in the box: the star saturated the detector there (Barnard's Star and
  // R Draconis do in every exposure); any other hard flag: a cosmic ray, a bad or hot pixel
  if (nan || (hard & OVERFLOW)) return { skip: 'saturated' };
  if (hard) return { skip: 'flagged' };
  if (sky.length < MIN_SKY) return { skip: 'sky' };
  const med = median(sky), sig = 1.4826 * median(sky.map(s => Math.abs(s - med)));
  // the pipeline's variance over the box (the star's own noise included) plus the sky level's uncertainty; without it, the sky's scatter alone
  const errSB = varOk ? Math.sqrt(varSum + nAp * nAp * sig * sig / sky.length) : sig * Math.sqrt(nAp * (1 + nAp / sky.length));
  const flux = (sum - nAp * med) * MJYSR_TO_UJY, err = errSB * MJYSR_TO_UJY;
  return {
    lambda: +at.wave.toFixed(4), bw: Number.isFinite(at.bw) ? +at.bw.toFixed(4) : null, flux: +flux.toFixed(3), err: +err.toFixed(3),
    detector: exp.detector, mjd: +(at.mjdAvg ?? exp.mjd).toFixed(5), obsId: exp.obsId, collection: exp.collection,
    soft: bits ? bits.soft.filter(n => bits.names[n] != null && ((soft >>> bits.names[n]) & 1)) : [],
    offset: [+(x - ic).toFixed(2), +(y - jc).toFixed(2)], // where the position fell inside the centre pixel
    errFrom: varOk ? 'variance' : 'sky', ...(fm ? {} : { noFlags: true }),
  };
}

/**
 * The measured spectrum at (ra, dec). q: {ra, dec, pmra?, pmdec? (mas/yr), epoch? (MJD of ra/dec, default J2016.0, Gaia
 * DR3's), sra?, sdec? (where to search IRSA for exposures: where the star is during the survey; by default ra/dec, moved
 * to February 2026 for a proper motion), collections? (typed releases, as for fields)}. With a proper motion the position
 * is moved to each exposure's time. Cached on disk; a result where some exposures could not be read is served but not kept.
 */
export async function buildSpectrum(q) {
  const extra = [...new Set((q.collections || []).filter(isCollectionName))].sort();
  const pm = Number.isFinite(q.pmra) && Number.isFinite(q.pmdec) && (q.pmra || q.pmdec) ? { pmra: q.pmra, pmdec: q.pmdec, epoch: Number.isFinite(q.epoch) ? q.epoch : J2016_MJD } : null;
  const posAt = mjd => {
    if (!pm) return [q.ra, q.dec];
    const dt = (mjd - pm.epoch) / 365.25;
    return [q.ra + pm.pmra * dt / 3.6e6 / Math.cos(q.dec * Math.PI / 180), q.dec + pm.pmdec * dt / 3.6e6];
  };
  const search = Number.isFinite(q.sra) && Number.isFinite(q.sdec) ? [q.sra, q.sdec] : posAt(SURVEY_MID_MJD);
  const id = JSON.stringify(['spectrum-v2', /* v2: saturated exposures counted apart from flagged ones */ +q.ra.toFixed(5), +q.dec.toFixed(5), pm ? [pm.pmra, pm.pmdec, pm.epoch] : null, extra, search.map(v => +v.toFixed(5))]);
  if (building.has(id)) return building.get(id);
  const run = memoJSON('spectrum', id, async () => {
    const t0 = Date.now(), P = { ra: q.ra, dec: q.dec, stage: 'sia', label: 'Searching IRSA for every SPHEREx exposure of this position', done: 0, total: 0, started: t0 };
    spectrumProgress.set(id, P);
    try {
      const report = {}, all = await searchExposures(search[0], search[1], extra, report);
      if (!all.length) throw Object.assign(new Error(`No SPHEREx exposures cover RA ${q.ra}, Dec ${q.dec}`), { status: 404 });
      const use = all.length > MAX_EXPOSURES ? all.slice(-MAX_EXPOSURES) : all;
      Object.assign(P, { stage: 'stamps', label: 'Measuring the position in each exposure', total: use.length });
      const res = await mapLimit(use, 3, e => measureExposure(e, ...posAt(e.mjd)).catch(err => ({ skip: 'failed', error: err.message })).finally(() => P.done++));
      const points = res.filter(r => !r.skip).sort((a, b) => a.lambda - b.lambda || a.mjd - b.mjd);
      const rejected = {}; for (const r of res) if (r.skip) rejected[r.skip] = (rejected[r.skip] || 0) + 1;
      const failed = res.filter(r => r.skip === 'failed');
      if (failed.length === res.length) throw new Error(`No exposure could be read: ${failed[0].error}`); // IRSA down: nothing to keep
      // otherwise an empty spectrum is an answer too: every exposure saturated, say, which the caller should show
      return {
        ra: q.ra, dec: q.dec, pm, searchedAt: search.map(v => +v.toFixed(6)), unit: 'µJy', points, rejected, nExposures: use.length, nFound: all.length,
        collections: [...new Set(points.map(p => p.collection))], requested: extra, requestedStatus: report.requestedStatus || [],
        incomplete: failed.length ? true : undefined, errors: failed.length ? [...new Set(failed.map(f => f.error))].slice(0, 3) : undefined,
        method: {
          stamp: `${2 * STAMP_HALF + 1}×${2 * STAMP_HALF + 1} detector pixels per exposure, read from the Level 2 file (IMAGE and FLAGS)`,
          aperture: `${2 * APERTURE_HALF + 1}×${2 * APERTURE_HALF + 1}-pixel sum above the local sky (median of the stamp outside the central ${2 * SKY_INNER - 1}×${2 * SKY_INNER - 1})`,
          units: `µJy with the nominal ${PIXEL_ARCSEC}″ pixel (1 MJy/sr over one pixel = ${MJYSR_TO_UJY.toFixed(1)} µJy); relative, not calibrated photometry`,
          errors: 'the pipeline VARIANCE plane summed over the aperture plus the sky level’s uncertainty (the sky’s robust scatter alone where an exposure has no VARIANCE)',
          wavelength: 'each exposure’s own spectral WCS at the position (WCS-WAVE table)',
          leftOut: 'outside the detector or within 5 px of its edge; saturated (a masked pixel or the OVERFLOW flag in the box); another hard flag in the box (cosmic ray, bad or hot pixel). Soft flags are named on the point.',
          blending: 'the box is 31″ across: a neighbour within about 15″ adds its light, which at SPHEREx’s 6″ pixels is often the case',
        },
        timingsMs: { total: Date.now() - t0 }, builtAt: new Date().toISOString(),
      };
    } finally { spectrumProgress.delete(id); }
  }, extra.length ? HOUR : undefined);
  building.set(id, run);
  try { return await run; } finally { building.delete(id); }
}
