// Build a multi-epoch Field (app/js/core/types.js) from real SPHEREx exposures.
import { searchExposures, groupEpochs, exposureAtTarget, cutout } from './irsa.mjs';
import { smallBodies, horizonsRaDec } from './jpl.mjs';
import { findImageHDU, readImage, readTableRow } from './fits.mjs';
import { celestialWCS, spectralWCS, gridSky, gridPixel } from './wcs.mjs';
import { mapLimit, memoJSON } from './net.mjs';

export const SCALE = 6.15; // arcsec/px, SPHEREx native pixel
// Spectral resolving power per detector band (SPHEREx: R≈41 for bands 1–3, ≈35 for 4, ≈110 for 5, ≈130 for 6).
const R = { 1: 41, 2: 41, 3: 41, 4: 35, 5: 110, 6: 130 };

const fmtT = dt => dt === 0 ? '0 d' : dt < 0.04 ? `+${(dt * 1440).toFixed(0)} min` : dt < 0.9 ? `+${(dt * 24).toFixed(0)} h` : `+${dt.toFixed(dt < 10 ? 1 : 0)} d`;
const mjdISO = mjd => new Date((mjd - 40587) * 86400000).toISOString();

function median(arr) { const a = Float32Array.from(arr.filter(Number.isFinite)).sort(); return a.length ? a[a.length >> 1] : 0; }

/** The epochs covering a position, with per-detector band ranges; with `det`, also each exposure's wavelength at the target. */
export async function scansAt(ra, dec, { det } = {}) {
  const exps = await searchExposures(ra, dec);
  const epochs = groupEpochs(exps);
  for (const ep of epochs) {
    if (det) {
      const mine = ep.exposures.filter(e => e.detector === det);
      ep.atTarget = (await mapLimit(mine, 3, e => exposureAtTarget(e, ra, dec).catch(err => ({ ...e, error: err.message }))))
        .map(e => ({ obsId: e.obsId, detector: e.detector, mjd: e.mjdAvg ?? e.mjd, wave: e.wave, bw: e.bw, waveSource: e.waveSource, inside: e.inside, error: e.error }));
    }
    delete ep.exposures;
  }
  return { ra, dec, collections: [...new Set(exps.map(e => e.collection))], nExposures: exps.length, epochs };
}

/**
 * Choose, per survey epoch, the exposures on one detector whose wavelength at the target best matches a common
 * reference wavelength (frames can only be compared at matching wavelength — SPHEREx's filters are linear-variable).
 */
function chooseFrames(epochs, { lam, perEpoch, marginPx, mjd }) {
  const usable = epochs.map(ep => ep.cands.filter(c => c.inside && !c.error
    && c.pixel[0] > marginPx && c.pixel[1] > marginPx && c.pixel[0] < 2040 - marginPx && c.pixel[1] < 2040 - marginPx));
  const withData = usable.filter(u => u.length);
  if (!withData.length) return null;
  let ref = lam, anchor = null;
  if (mjd) { // anchor on the exposure closest in time to `mjd`, and match the other epochs to its wavelength
    for (const c of withData.flat()) if (!anchor || Math.abs(c.mjdAvg - mjd) < Math.abs(anchor.mjdAvg - mjd)) anchor = c;
    ref = anchor.wave;
  }
  if (!ref) { // pick the reference wavelength that minimises the worst per-epoch mismatch
    let best = Infinity;
    for (const c of withData.flat()) {
      const cost = Math.max(...withData.map(u => Math.min(...u.map(o => Math.abs(o.wave - c.wave)))));
      if (cost < best - 1e-9) { best = cost; ref = c.wave; }
    }
  }
  return {
    ref, anchor: anchor && anchor.obsId,
    picks: usable.map(u => u.map(c => ({ ...c, dLam: c.wave - ref })).sort((a, b) => (!!anchor && b.obsId === anchor.obsId) - (!!anchor && a.obsId === anchor.obsId) || Math.abs(a.dLam) - Math.abs(b.dLam))
      .filter((c, i) => i === 0 || Math.abs(c.dLam) <= ref / R[c.detector] / 2).slice(0, perEpoch)),
  };
}

/** Resample one cutout onto the common grid (north up, east left, SCALE ″/px, centre at N/2). */
function resample(cut, ra0, dec0, N) {
  const img = findImageHDU(cut.hdus, 'IMAGE');
  if (!img) throw new Error('No IMAGE extension in cutout');
  const zodiH = cut.hdus.find(h => h.name.trim() === 'ZODI');
  const tabH = cut.hdus.find(h => h.name.trim() === 'WCS-WAVE');
  const im = readImage(cut.buf, img), zo = zodiH ? readImage(cut.buf, zodiH) : null;
  const wcs = celestialWCS(img.kv);
  const sw = tabH ? spectralWCS(img.kv, readTableRow(cut.buf, tabH, 0)) : null;
  const src = new Float32Array(im.nx * im.ny);
  for (let i = 0; i < src.length; i++) src[i] = im.data[i] - (zo ? zo.data[i] : 0);
  const out = new Float32Array(N * N); let filled = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const [ra, dec] = gridSky(ra0, dec0, SCALE, N, x, y);
    const [p1, p2] = wcs.toPixel(ra, dec);
    const fx = p1 - 1, fy = p2 - 1, i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    let v = NaN;
    if (i0 >= 0 && j0 >= 0 && i0 + 1 < im.nx && j0 + 1 < im.ny) {
      const g = (i, j) => src[j * im.nx + i];
      v = (1 - tx) * (1 - ty) * g(i0, j0) + tx * (1 - ty) * g(i0 + 1, j0) + (1 - tx) * ty * g(i0, j0 + 1) + tx * ty * g(i0 + 1, j0 + 1);
    }
    if (Number.isFinite(v)) filled++;
    out[y * N + x] = v;
  }
  const med = median(out);
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = med; // masked / off-image → median
  const [c1, c2] = wcs.toPixel(ra0, dec0), w = sw ? sw(c1, c2) : null;
  return { frame: out, coverage: filled / (N * N), wave: w ? w.wave : null, bw: w ? w.bw : null, bunit: img.kv.BUNIT || null, zodi: !!zo };
}

/** Field builds in progress (cold cache), for GET /api/progress: id → {ra, dec, size, N, known, stage, done, total, started}. */
export const progress = new Map();
const building = new Map(); // id → Promise, so identical concurrent requests share one build

/**
 * @param {{ra:number, dec:number, size?:number, det?:number, lam?:number, perEpoch?:number, known?:boolean, mjd?:number}} q
 *   mjd: anchor on the exposure nearest this time (e.g. to look at a known asteroid on a given night).
 */
export async function buildField(q) {
  const size = Math.min(Math.max(q.size || 120, 40), 600);
  const N = Math.max(8, Math.round(size / SCALE));
  const det = q.lam ? null : (q.det || 1), perEpoch = Math.min(Math.max(q.perEpoch || 2, 1), 4);
  const id = JSON.stringify(['field-v2', +q.ra.toFixed(5), +q.dec.toFixed(5), N, det, q.lam || null, perEpoch, q.known !== false, q.mjd || null]);
  if (building.has(id)) return building.get(id);
  const run = memoJSON('field', id, async () => {
    const T = { start: Date.now() };
    const P = { ra: q.ra, dec: q.dec, size, N, det, mjd: q.mjd || null, known: q.known !== false, stage: 'sia', label: 'Searching IRSA for SPHEREx exposures', done: 0, total: 0, started: T.start };
    progress.set(id, P);
    const step = (stage, label, total = 0) => Object.assign(P, { stage, label, done: 0, total });
    try {
    const exps = await searchExposures(q.ra, q.dec);
    T.sia = Date.now() - T.start;
    if (!exps.length) { const e = new Error(`No SPHEREx exposures cover RA ${q.ra}, Dec ${q.dec} in ${'the searched collections'}`); e.status = 404; throw e; }
    const epochs = groupEpochs(exps);
    const detector = det || (exps.find(e => q.lam >= e.emMin && q.lam <= e.emMax) || {}).detector;
    if (!detector) { const e = new Error(`No detector covers ${q.lam} µm`); e.status = 400; throw e; }
    step('headers', 'Reading exposure headers (wavelength at the target)', epochs.reduce((n, ep) => n + ep.exposures.filter(e => e.detector === detector).length, 0));
    for (const ep of epochs) {
      const mine = ep.exposures.filter(e => e.detector === detector);
      ep.cands = await mapLimit(mine, 3, e => exposureAtTarget(e, q.ra, q.dec).catch(err => ({ ...e, error: err.message })).finally(() => P.done++));
    }
    T.headers = Date.now() - T.start;
    const marginPx = size / SCALE; // keep the cutout well inside the detector
    const sel = chooseFrames(epochs, { lam: q.lam, perEpoch, marginPx, mjd: q.mjd });
    if (!sel) { const e = new Error('Exposures found, but none places this position safely inside the detector'); e.status = 404; throw e; }
    const frames = [];
    epochs.forEach((ep, k) => sel.picks[k].forEach(c => frames.push({ ...c, scan: ep.id, scanLabel: ep.label, scanDate: ep.date })));
    frames.sort((a, b) => a.mjdAvg - b.mjdAvg);
    if (frames.length < 1) { const e = new Error('No usable frames'); e.status = 404; throw e; }

    const cutSize = Math.min(size * 1.5 + 8 * SCALE, 900);
    const knownWanted = q.known !== false;
    step('cutouts', knownWanted ? 'Downloading cutouts from IRSA; asking JPL which known objects are in the field' : 'Downloading cutouts from IRSA', frames.length);
    P.jpl = knownWanted ? { done: 0, total: frames.length } : null; // sb_ident: slow (18–70 s per frame, one at a time)
    const [res, sbs] = await Promise.all([
      mapLimit(frames, 2, async f => { const r = resample(await cutout(f, q.ra, q.dec, cutSize), q.ra, q.dec, N); P.done++; return r; }),
      knownWanted ? mapLimit(frames, 1, f => smallBodies({ ra: q.ra, dec: q.dec, mjd: f.mjdAvg, halfWidthArcsec: size / 2, xobs: f.xobs })
        .catch(err => ({ error: err.message, objects: [] })).finally(() => P.jpl.done++)) : Promise.resolve(null),
    ]);
    T.cutouts = Date.now() - T.start;

    const ref = +sel.ref.toFixed(2), t0 = frames[0].mjdAvg;
    const epochsOut = frames.map((f, i) => {
      const wave = res[i].wave ?? f.wave, matched = Math.abs(wave - sel.ref) <= sel.ref / R[f.detector] / 2;
      const t = f.mjdAvg - t0;
      return {
        t, band: matched ? ref : +wave.toFixed(2), label: fmtT(t), sub: `${wave.toFixed(2)} µm · ${f.scanDate}`,
        mjd: f.mjdAvg, date: mjdISO(f.mjdAvg), lambda: +wave.toFixed(4), bandwidth: res[i].bw ?? f.bw, dLambda: +(wave - sel.ref).toFixed(4), matched,
        waveSource: res[i].wave != null ? 'spectral WCS at target (cutout)' : f.waveSource,
        detector: f.detector, obsId: f.obsId, scan: f.scan, scanLabel: f.scanLabel, collection: f.collection,
        coverage: +res[i].coverage.toFixed(3), url: f.url,
      };
    });

    const known = new Map();
    if (sbs) sbs.forEach((s, i) => (s.objects || []).forEach(o => {
      if (!known.has(o.name)) known.set(o.name, { name: o.name, vmag: o.vmag, source: 'sb_ident first pass', samples: [] });
      known.get(o.name).samples.push({ i, t: epochsOut[i].t, x: +(N / 2 - o.dRA / SCALE).toFixed(2), y: +(N / 2 - o.dDec / SCALE).toFixed(2), errArcsec: o.errRA != null ? Math.max(o.errRA, o.errDec) : null });
    }));
    // Refine with Horizons (precise ephemeris, one request per object for all frame times). sb_ident's first pass
    // is a quick two-body propagation with errors of tens of arcsec; Horizons agrees with SPHEREx to ~1″.
    const objs = [...known.values()].slice(0, 25);
    if (objs.length) step('horizons', 'Refining known-object positions with JPL Horizons', objs.length);
    await mapLimit(objs, 2, async k => {
      try {
        const rd = await horizonsRaDec(k.name, frames.map(f => f.mjdAvg));
        if (!rd) return;
        k.source = 'JPL Horizons (geocentric)';
        k.samples = rd.map(([ra, dec], i) => { const [x, y] = gridPixel(q.ra, q.dec, SCALE, N, ra, dec); return { i, t: epochsOut[i].t, x: +x.toFixed(2), y: +y.toFixed(2), ra, dec }; })
          .filter(s => s.x > -5 && s.y > -5 && s.x < N + 5 && s.y < N + 5);
      } catch (e) { k.horizonsError = e.message; }
      P.done++;
    });
    for (const [name, k] of known) if (!k.samples.length) known.delete(name);

    return {
      N, scale: SCALE, ra0: q.ra, dec0: q.dec, sizeArcsec: N * SCALE, simulated: false,
      detector, refLambda: +sel.ref.toFixed(4), anchorObsId: sel.anchor || null, band: ref, bunit: res[0].bunit,
      epochs: epochsOut,
      frameEncoding: 'base64 Float32 little-endian, row-major N×N, y down (north up), x right (east left)',
      frames: res.map(r => Buffer.from(r.frame.buffer, r.frame.byteOffset, r.frame.byteLength).toString('base64')),
      known: [...known.values()],
      knownStatus: !knownWanted ? 'skipped' : sbs.some(s => s.error) ? 'partial: ' + sbs.filter(s => s.error).map(s => s.error).join('; ') : 'ok',
      knownObserver: sbs && sbs[0] ? sbs[0].observer : null,
      surveyEpochs: epochs.map(ep => ({ id: ep.id, label: ep.label, date: ep.date, start: ep.start, end: ep.end, nExposures: ep.nExposures })),
      source: { mode: 'live', note: 'Live · SPHEREx via IRSA', collections: [...new Set(frames.map(f => f.collection))] },
      notes: [
        'Pixels: SPHEREx L2 IMAGE minus the pipeline ZODI model, bilinearly resampled (TAN-SIP WCS) onto a common north-up grid at 6.15″/px.',
        'Masked or off-detector pixels are replaced by the frame median; FLAGS are not applied.',
        `Frames chosen on detector D${detector} so the wavelength at the target is within half a resolution element of ${sel.ref.toFixed(3)} µm where possible; see epochs[].matched.`,
        'Known objects: found with JPL sb_ident (first pass, observer = SPHEREx spacecraft position) at each frame time, then positioned with JPL Horizons (geocentric) at every frame time.',
      ],
      timingsMs: { sia: T.sia, headers: T.headers, total: Date.now() - T.start },
      builtAt: new Date().toISOString(),
    };
    } finally { progress.delete(id); }
  });
  building.set(id, run);
  try { return await run; } finally { building.delete(id); }
}

/** Known small bodies near (ra, dec) at MJD or ISO time t. */
export async function knownAt(ra, dec, t, halfWidthArcsec = 120) {
  const mjd = typeof t === 'number' || /^\d+(\.\d+)?$/.test(String(t)) ? +t : (Date.parse(t) / 86400000 + 40587);
  if (!Number.isFinite(mjd)) { const e = new Error('t must be an MJD or an ISO date'); e.status = 400; throw e; }
  const r = await smallBodies({ ra, dec, mjd, halfWidthArcsec, xobs: null });
  return { ra, dec, mjd, date: mjdISO(mjd), halfWidthArcsec, observer: r.observer, nFirstPass: r.n, objects: r.objects, source: 'JPL SSD sb_ident v1.1 (first pass)' };
}
