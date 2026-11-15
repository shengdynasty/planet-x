// Detection, matching and per-pair analysis, lifted from artifacts/moving-sky and generalised to any Field.
// Pure: no DOM. Frames are treated as immutable, so results are cached per image / per field.
import { fmtDt, fmtRate } from './format.js';

const sideOf = img => Math.round(Math.sqrt(img.length));

// perf: frames are immutable once generated, so stats/detect results can be cached per image
const memo = fn => { const c = new WeakMap(); return (img, ...a) => { let m = c.get(img); if (!m) c.set(img, m = new Map()); const key = a.join(','); if (!m.has(key)) m.set(key, fn(img, ...a)); return m.get(key); }; };

/** Robust sky level and noise: median and 1.4826·MAD of a fixed 4000-pixel sample. */
export const stats = memo(function stats(img) {
  const L = img.length, s = new Float32Array(4000); for (let k = 0; k < 4000; k++) s[k] = img[(k * 25733) % L]; s.sort();
  const med = s[2000]; const d = new Float32Array(4000); for (let k = 0; k < 4000; k++) d[k] = Math.abs(s[k] - med); d.sort(); return { med, sig: 1.4826 * d[2000] };
});

/** Local maxima above med + k·sig, with centroid, peak, flux and a PSF-sanity "spike" ratio. Square images. */
export const detect = memo(function detect(img, k = 5) {
  const N = sideOf(img), { med, sig } = stats(img), thr = med + k * sig, out = [];
  const E = N >= 64 ? 4 : 2; // edge margin: Moving Sky's 4 px on big fields; small live cutouts (e.g. 20×20) keep more area
  for (let y = E; y < N - E; y++) for (let x = E; x < N - E; x++) { const v = img[y * N + x]; if (v < thr) continue; let mx = true;
    for (let dy = -1; dy <= 1 && mx; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; if (img[(y + dy) * N + x + dx] > v) { mx = false; break; } }
    if (!mx) continue;
    let sx = 0, sy = 0, sw = 0, nb = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const w = Math.max(img[(y + dy) * N + x + dx] - med, 0); sx += w * (x + dx); sy += w * (y + dy); sw += w; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx || dy) nb += img[(y + dy) * N + x + dx] - med; }
    out.push({ x: sw ? sx / sw : x, y: sw ? sy / sw : y, peak: v - med, flux: sw, sig, spike: (v - med) / Math.max(nb / 8, 0.5 * sig) }); }
  return out;
});

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function nearest(list, p) { let best = null, bd = 1e9; for (const q of list) { const d = dist(p, q); if (d < bd) { bd = d; best = q; } } return [best, bd]; }

// ---------- PSF sampling ----------
// The "single-pixel spike" test compares a peak with the mean of its 8 neighbours. What counts as too sharp
// depends on how well the PSF is sampled: the simulation's σ = 1.15 px Gaussian gives ≈ 1.7 for a centred star,
// but real SPHEREx stars (FWHM ≈ 6.6″ ≈ 1.07 px at 6.15″/px) give 3–8. So the limit is scaled by the PSF:
// spikeLimit(σ) = 3.2 · S(σ) / S(1.15), where S(σ) is the spike ratio of a centred, point-sampled Gaussian.
export const SIM_PSF_SIGMA = 1.15;
export const SPIKE_LIMIT_SIM = 3.2;
export const LIVE_PSF_SIGMA = 0.7; // fallback for live frames with too few stars to measure (typical SPHEREx L2 after resampling)
/** Spike ratio (peak / mean of the 8 neighbours) of a centred, point-sampled Gaussian of width σ px. */
export function spikeOf(sigma) { const u = Math.exp(-1 / (2 * sigma * sigma)); return 2 / (u + u * u); }
/** Inverse of spikeOf (bisection on 0.2–5 px). */
export function sigmaOfSpike(s) { let lo = 0.2, hi = 5; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (spikeOf(m) > s) lo = m; else hi = m; } return (lo + hi) / 2; }
/** Spike limit for a PSF of width σ px; exactly Moving Sky's 3.2 at σ = 1.15. */
export function spikeLimit(sigma) { return sigma === SIM_PSF_SIGMA ? SPIKE_LIMIT_SIM : SPIKE_LIMIT_SIM * spikeOf(sigma) / spikeOf(SIM_PSF_SIGMA); }

const psfCache = new WeakMap();
/**
 * PSF width of a field, in pixels: `field.psfSigmaPx` when the source states it (the simulation does), otherwise
 * measured from the frames' bright (> 20σ), isolated stars that are present in at least one other epoch (so
 * cosmic rays and movers don't count), by inverting the median spike ratio.
 * @returns {{sigma:number, spikeMax:number, from:'field'|'stars'|'default', nStars:number}}
 */
export function psfModel(field) {
  let m = psfCache.get(field); if (m) return m;
  if (Number.isFinite(field.psfSigmaPx)) m = { sigma: field.psfSigmaPx, from: 'field', nStars: 0 };
  else if (field.simulated) m = { sigma: SIM_PSF_SIGMA, from: 'field', nStars: 0 };
  else {
    const n = field.epochs.length, spikes = [];
    for (let i = 0; i < n; i++) {
      const all = detect(field.frame(i), 3);
      for (const s of detect(field.frame(i), 5)) {
        if (s.peak < 20 * s.sig) continue;
        if (all.some(q => { const d = dist(q, s); return d > 0.01 && d < 3; })) continue; // isolated
        let seen = false;
        for (let j = 0; j < n && !seen; j++) if (j !== i && field.epochs[j].band === field.epochs[i].band) seen = detect(field.frame(j), 5).some(q => dist(q, s) < 1);
        if (seen) spikes.push(s.spike);
      }
    }
    spikes.sort((a, b) => a - b);
    m = spikes.length >= 3 ? { sigma: sigmaOfSpike(spikes[spikes.length >> 1]), from: 'stars', nStars: spikes.length } : { sigma: LIVE_PSF_SIGMA, from: 'default', nStars: spikes.length };
  }
  m.spikeMax = spikeLimit(m.sigma);
  psfCache.set(field, m); return m;
}

/**
 * How badly a bright source fails a PSF fit: Gaussian of width σ at the 3×3 centroid, free amplitude, over the 5×5
 * box; returns the residual fraction Σ(d − A·g)² / Σd² minus the part expected from noise. Stars and asteroids
 * give < 0.1; cosmic-ray streaks and bad-pixel blobs 0.2–1.
 */
export function psfMisfit(img, s, sigma) {
  const N = sideOf(img), { med, sig } = stats(img), x0 = Math.round(s.x), y0 = Math.round(s.y);
  let cx = 0, cy = 0, cw = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x0 + dx, yy = y0 + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const w = Math.max(img[yy * N + xx] - med, 0); cx += w * xx; cy += w * yy; cw += w; }
  if (!cw) return 1; cx /= cw; cy /= cw;
  const d = [], g = []; let dg = 0, gg = 0, dd = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x0 + dx, yy = y0 + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
    const v = img[yy * N + xx] - med, m = Math.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma * sigma)); d.push(v); g.push(m); dg += v * m; gg += m * m; dd += v * v; }
  const A = dg / gg; let rr = 0; for (let k = 0; k < d.length; k++) rr += (d[k] - A * g[k]) ** 2;
  return dd > 0 ? (rr - d.length * sig * sig) / dd : 1;
}
const MISFIT_MAX = 0.15, MISFIT_MIN_SNR = 30, CLUSTER_PX = 4;
const ZP_MIN_STARS = 4, EXCESS_MIN_DEX = 0.5; // Gaia-G zero point needs 4 matched stars; "not that star" means > ×3.2 (or 3 × the field's scatter) brighter
const zpCache = new WeakMap();

// ---------- aperture photometry for the variability test ----------
// On an under-sampled PSF (real SPHEREx frames: FWHM ≈ 1 px after resampling) the peak pixel depends on where the
// star falls within the pixel, so the same star differs by ×2–3 in peak between two frames with no change in flux
// (issues.md ISS-01: 11 of 13 "Brightness change" flags on real fields were such sampling artefacts). Below
// UNDERSAMPLED_SIGMA the variability test therefore uses the flux in a 5×5 box above the local sky (median of the
// surrounding 9×9 ring), normalised by the median flux ratio of the field's other matched stars, which cancels a
// zero-point or colour offset between the two passes. A star within 3 px of a brighter one is a blend and is never
// called variable. The simulation's σ = 1.15 px PSF keeps Moving Sky's peak-ratio test, so its results stay identical.
export const UNDERSAMPLED_SIGMA = 1.0;
export const AP_RATIO = 1.5;  // flux must change by more than ×1.5 either way…
export const AP_SIGMAS = 5;   // …by more than 5× the aperture noise of the difference…
export const AP_SNR = 10;     // …and the brighter measurement must be a 10σ aperture detection
const AP_R = 2, AP_SKY_R = 4;
/** 5×5 aperture flux above the local sky at the rounded position, and the aperture's noise (√n · σ). */
export function apFlux(img, x, y) {
  const N = sideOf(img), { med, sig } = stats(img), x0 = Math.round(x), y0 = Math.round(y), ring = [];
  let sum = 0, n = 0;
  for (let dy = -AP_SKY_R; dy <= AP_SKY_R; dy++) for (let dx = -AP_SKY_R; dx <= AP_SKY_R; dx++) {
    const xx = x0 + dx, yy = y0 + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const v = img[yy * N + xx];
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= AP_R) { sum += v; n++; } else ring.push(v); }
  ring.sort((p, q) => p - q);
  const sky = ring.length ? ring[ring.length >> 1] : med;
  return { flux: sum - n * sky, noise: Math.sqrt(Math.max(n, 1)) * sig };
}
const fmtRatio = r => r >= 100 ? '>100' : r < 0.01 ? '<0.01' : r.toFixed(2);

export const KIND_ORDER = { cand: 0, known: 1, var: 2, art: 3, left: 4 };
const analyseCache = new WeakMap();

/**
 * Compare epoch ib against reference ia. Returns flagged sources sorted cand, known, var, art, left.
 * Each result: {kind, title, detail, x, y, from?, to?, obj?}. Same semantics and strings as Moving Sky.
 * Cached per (field, ia, ib); callers must not mutate the results.
 * @param {import('../core/types.js').Field} field
 */
export function analyse(field, ia, ib) {
  let m = analyseCache.get(field); if (!m) analyseCache.set(field, m = new Map());
  const key = ia + ',' + ib; if (m.has(key)) return m.get(key);
  const res = analyseUncached(field, ia, ib); m.set(key, res); return res;
}

function analyseUncached(field, ia, ib) {
  // Hysteresis: a source must be >5σ to count as detected, but only needs a >3σ counterpart to count as "still there".
  const fa = field.frame(ia), fb = field.frame(ib), SCALE = field.scale, KNOWN = field.known || [], STARS = field.stars || [], N = field.N || sideOf(fa);
  const A = detect(fa, 5), B = detect(fb, 5), Alo = detect(fa, 3), Blo = detect(fb, 3);
  const ta = field.epochs[ia].t, tb = field.epochs[ib].t, dt = Math.abs(tb - ta), sig = A.length ? A[0].sig : 0.1;
  const res = [], appeared = [], vanished = [];
  const FIRM = 7 * sig;
  // SPHEREx pipeline FLAGS (live fields only): a source on a hard-flagged pixel is an artifact whatever its shape;
  // soft flags (ghost, persistence, halo) are appended to the detail so a reviewer sees the contamination.
  const FB = typeof field.flags === 'function' && field.flagBits && field.flagBits.names ? field.flagBits : null;
  const bit = (v, n) => FB.names[n] != null && ((v >>> FB.names[n]) & 1) === 1;
  const flagsAt = (i, p) => { if (!FB) return null; const fl = field.flags(i); if (!fl) return null; const x = Math.round(p.x), y = Math.round(p.y); return x < 0 || y < 0 || x >= N || y >= N ? null : fl[y * N + x]; };
  const hardFlags = (i, p) => { const v = flagsAt(i, p); return v == null ? [] : FB.hard.filter(n => bit(v, n)); };
  const softTxt = (i, p) => { const v = flagsAt(i, p); const s = v == null ? [] : FB.soft.filter(n => bit(v, n)); return s.length ? ` · SPHEREx pipeline flags: ${s.join(', ')}` : ''; };
  // Gaia DR3 stars (live fields only): a change at a catalogued star is variability, not motion.
  const starAt = (t, p) => { let best = null, bd = 1.5; for (const s of STARS) { const [x, y] = s.pos(t); const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = s; } } return best; };
  const starTxt = s => `${s.name} (G ${s.g.toFixed(1)})`;
  // Is this source's light plausibly that star's? The frame's own matched stars give a zero point between Gaia G and
  // 5×5 aperture flux; a source more than max(×3, 3 × the field's G-to-band scatter) brighter than the star it sits on
  // is not that star, so it is handled like any other appeared/vanished source, with the coincidence named (ISS-28:
  // without this, a mover landing within 1.5 px of any of a crowded field's faint catalogued stars was filed as a
  // brightening; the injection test recovered 28% in Barnard's field against 74% clear of stars).
  // Gaia RP (0.63–1.05 µm) is the magnitude used: it sits next to SPHEREx's bands, so the colour term is small at 0.75–1.1 µm
  // and the field's own scatter covers it further out. A star without RP (7 of 218 in Barnard's field) keeps the old reading.
  const magOf = s => Number.isFinite(s.rp) ? s.rp : null;
  const zeroPoint = i => { let m = zpCache.get(field); if (!m) zpCache.set(field, m = new Map()); if (m.has(i)) return m.get(i);
    const img = field.frame(i), t = field.epochs[i].t, det = detect(img, 5), rs = [];
    for (const s of STARS) { const mag = magOf(s); if (mag == null) continue; const [x, y] = s.pos(t), [d, dd] = nearest(det, { x, y }); if (!d || dd > 1) continue;
      if (det.some(q => q !== d && dist(q, d) < 3) || hardFlags(i, d).length) continue;                  // blended or saturated: flux means nothing
      const F = apFlux(img, d.x, d.y); if (F.flux < AP_SNR * F.noise) continue; rs.push(Math.log10(F.flux) + 0.4 * mag); }
    rs.sort((p, q) => p - q); let zp = null;
    if (rs.length >= ZP_MIN_STARS) { const med = rs[rs.length >> 1], dev = rs.map(r => Math.abs(r - med)).sort((p, q) => p - q); zp = { zp: med, scatter: 1.4826 * dev[dev.length >> 1], n: rs.length }; }
    m.set(i, zp); return zp; };
  const excessOf = (i, p, s) => { const z = zeroPoint(i), mag = magOf(s); if (!z || mag == null) return null;
    const F = apFlux(field.frame(i), p.x, p.y).flux, ratio = F / Math.pow(10, z.zp - 0.4 * mag), lim = Math.pow(10, Math.max(EXCESS_MIN_DEX, 3 * z.scatter));
    // next to a brighter source the aperture holds its light too (a blend within 3 px, or the wings of a star ≥ 20× brighter
    // within 8 px), so an excess there proves nothing: keep the star reading
    const wings = [...A, ...B].some(q => q.peak > 20 * p.peak && dist(q, p) > 0.01 && dist(q, p) < 8);
    return { ratio, excess: ratio > lim && !blended(p) && !wings, txt: `×${fmtRatio(ratio)} brighter than ${starTxt(s)} should be in this band from its Gaia RP (zero point from ${z.n} stars, limit ×${lim.toFixed(1)})` }; };
  const onStarTxt = ex => ex ? ` · sits on a catalogued star, ${ex.txt}: a mover on top of it, or a strong brightening` : '';
  const knownAt = (t, p) => { for (const k of KNOWN) { const q = k.pos(t); if (!q) continue; const [x, y] = q; if (Math.hypot(x - p.x, y - p.y) < 3) return k; } return null; };
  // Variability on an under-sampled PSF is judged on aperture flux (see apFlux), relative to the field's other stars.
  const psf = psfModel(field), under = psf.sigma < UNDERSAMPLED_SIGMA;
  let zp = 1;
  if (under) { const rs = [];
    for (const b of B) { if (b.peak < 12 * sig) continue; const [a, d] = nearest(Alo.filter(q => q.peak > 0.35 * b.peak), b);
      if (!a || d >= 2.2 || a.peak < 12 * sig || (KNOWN.length && knownAt(tb, b)) || hardFlags(ib, b).length || hardFlags(ia, a).length) continue;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, Fa = apFlux(fa, x, y), Fb = apFlux(fb, x, y);
      if (Fa.flux > AP_SNR * Fa.noise && Fb.flux > AP_SNR * Fb.noise) rs.push(Fb.flux / Fa.flux); }
    rs.sort((p, q) => p - q); if (rs.length >= 3) zp = Math.min(2, Math.max(0.5, rs[rs.length >> 1])); }
  const blended = p => [...A, ...B].some(q => q.peak > 1.5 * p.peak && dist(q, p) > 0.01 && dist(q, p) < 3);
  const change = (pa, pb) => { const x = (pa.x + pb.x) / 2, y = (pa.y + pb.y) / 2, Fa = apFlux(fa, x, y), Fb = apFlux(fb, x, y);
    const ratio = Fb.flux / Math.max(Fa.flux, Fa.noise) / zp, diff = Fb.flux - zp * Fa.flux, noise = Math.hypot(Fb.noise, zp * Fa.noise);
    const varies = Math.max(Fa.flux, Fb.flux / zp) > AP_SNR * Math.max(Fa.noise, Fb.noise) && (ratio > AP_RATIO || ratio < 1 / AP_RATIO) && Math.abs(diff) > AP_SIGMAS * noise;
    return { ratio, varies, txt: `×${fmtRatio(ratio)} in flux (5×5 aperture, relative to the field's other stars)` }; };
  const dupVar = p => res.some(r => r.kind === 'var' && Math.hypot(r.x - p.x, r.y - p.y) < 2);   // one flag per star
  for (const b of B) { const [a, d] = nearest(Alo.filter(q => q.peak > 0.35 * b.peak), b);
    if (a && d < 2.2) { const ratio = b.peak / a.peak, c = under ? change(a, b) : null;
      const varies = c ? c.varies && !blended(b) : (ratio > 1.8 || ratio < 0.55) && Math.min(a.peak, b.peak) > 12 * sig;
      if (varies) {
        if (KNOWN.length && knownAt(tb, b)) continue;                                     // a known mover's own pixels: reported as 'known' below
        const hf = [...new Set([...hardFlags(ib, b), ...hardFlags(ia, a)])];              // saturated core or bad pixel: the ratio means nothing
        if (hf.length) { res.push({ kind: 'art', title: 'Flagged by the SPHEREx pipeline', x: b.x, y: b.y, from: a, to: b, detail: `Brightness change on a pixel the L2 pipeline marks bad (${hf.join(', ')}): not trustworthy` }); continue; }
        if (dupVar(b)) continue;
        const s = STARS.length ? starAt(tb, b) : null;
        res.push({ kind: 'var', title: 'Brightness change, fixed position', x: b.x, y: b.y, from: a, to: b, star: s, detail: `${c ? c.txt : `×${ratio.toFixed(2)} in peak`}, no motion` + (s ? ` · ${starTxt(s)}` : '') + softTxt(ib, b) }); }
    } else if (b.peak > FIRM) appeared.push(b); }
  for (const a of A) { if (a.peak <= FIRM) continue; const [b, d] = nearest(Blo.filter(q => q.peak > 0.35 * a.peak), a); if (!(b && d < 2.2)) vanished.push(a); }
  const inside = q => q && q[0] >= 0 && q[1] >= 0 && q[0] < N && q[1] < N;
  // Live ephemerides name their source; then say how close the prediction was (simulated strings stay Moving Sky's).
  const offTxt = (k, t, p) => { if (!k.source) return ''; const [x, y] = k.pos(t); return ` · ${(Math.hypot(x - p.x, y - p.y) * SCALE).toFixed(1)}″ from ${k.source}`; };
  // Artifact test, PSF-aware: too sharp for this field's PSF (spike), or a bright blob that fails a PSF fit
  // (cosmic-ray streak, bad pixels); a source within a few pixels of such a hit is an artifact too, whether the hit
  // is in the same frame (CR shower) or in the other one (the counterpart is hidden under it).
  const hardOf = img => { const why = new Map();
    for (const s of detect(img, 5)) { if (s.spike > psf.spikeMax) why.set(s, 'spike'); else if (s.peak > MISFIT_MIN_SNR * s.sig && Math.min(...[1, 1.5, 2].map(f => psfMisfit(img, s, f * psf.sigma))) > MISFIT_MAX) why.set(s, 'shape'); } // broader than the PSF is fine (galaxy, blend)
    return why; };
  const hardA = hardOf(fa), hardB = hardOf(fb);
  const near = (m, s) => { for (const h of m.keys()) if (h !== s && dist(h, s) < CLUSTER_PX) return true; return false; };
  const artWhy = (own, other, s) => own.get(s) || (near(own, s) ? 'cluster' : near(other, s) ? 'masked' : null);
  const ART_TXT = { shape: ['Not PSF-shaped', 'Streak or blob that fails a PSF fit: cosmic ray or bad pixels'], cluster: ['Next to an artifact', 'Within a few pixels of a cosmic-ray / bad-pixel hit in the same frame'],
    masked: ['Counterpart covered by an artifact', 'The same spot in the other frame is hit by a cosmic ray or bad pixels, so this change is not trustworthy'] };
  const usedV = new Set();
  // a vanished source sitting on a Gaia star is a star that faded, never the origin of a mover; nor is a cosmic ray or
  // bad pixel in the reference, or a source whose spot in the comparison frame is hidden under one (an injection test on
  // the real example fields linked 45% of entering sources to such a "partner" across the field, see docs/WRITEUP.md)
  // a vanished source on a Gaia star it could plausibly be is a star that faded, never the origin of a mover
  // (and whatever sits there, if the light at that spot did not actually drop, nothing left: the star's detection just toggled)
  const starV = new Map(); const vanishedOnStar = v => { if (!starV.has(v)) { const s = STARS.length ? starAt(ta, v) : null, ex = s ? excessOf(ia, v, s) : null, c = s && under ? change(v, v) : null;
    starV.set(v, { s, ex, isStar: !!s && !(ex && ex.excess && (!c || c.ratio < 1 / AP_RATIO)) }); } return starV.get(v); };
  const partner = b => { let best = null, bd = 1e9; for (const v of vanished) { if (usedV.has(v) || vanishedOnStar(v).isStar || hardFlags(ia, v).length || artWhy(hardA, hardB, v)) continue; const r = b.peak / v.peak; if (r < 0.5 || r > 2) continue; const d = dist(v, b); if (d < bd) { bd = d; best = v; } } return [best, bd]; };
  for (const b of appeared) {
    const k = knownAt(tb, b), hf = k ? [] : hardFlags(ib, b);  // an ephemeris match wins over every artifact test
    if (hf.length) { res.push({ kind: 'art', title: 'Flagged by the SPHEREx pipeline', x: b.x, y: b.y, to: b, detail: `Pixel flags: ${hf.join(', ')}. The L2 pipeline marks this pixel as bad in this frame` }); continue; }
    const why = artWhy(hardB, hardA, b);
    if (!k && why === 'spike') { res.push({ kind: 'art', title: 'Single-pixel spike', x: b.x, y: b.y, to: b, detail: 'Not PSF-shaped: cosmic ray or hot pixel' }); continue; }
    if (!k && why) { res.push({ kind: 'art', title: ART_TXT[why][0], x: b.x, y: b.y, to: b, detail: ART_TXT[why][1] }); continue; }
    const s = !k && STARS.length ? starAt(tb, b) : null, ex = s ? excessOf(ib, b, s) : null, c = s && under ? change(b, b) : null;
    if (s && !(ex && ex.excess && (!c || c.ratio > AP_RATIO))) { // a Gaia star that is now detected and wasn't: a brightening only if its aperture flux really rose
      if (c && (!c.varies || c.ratio < 1 || blended(b))) continue;                     // same flux, the 5σ detection just toggled (sampling, blend)
      if (dupVar(b)) continue;
      res.push({ kind: 'var', title: 'Brightened star', x: b.x, y: b.y, to: b, star: s, detail: `Appeared at ${starTxt(s)}, below detection in the reference${c ? `: ${c.txt}` : ''}; a brightening, not a mover` + softTxt(ib, b) }); continue; }
    const [v, dv] = partner(b), vs = v ? vanishedOnStar(v) : null;
    const rate = v ? dv * SCALE / dt : null, coin = onStarTxt(s ? ex : null) + (vs && vs.s ? ` · its reference position sits on ${starTxt(vs.s)}, ${vs.ex.txt}` : '');
    if (k) { if (v) usedV.add(v); res.push({ kind: 'known', title: k.name, x: b.x, y: b.y, from: v, to: b, obj: k, detail: (v ? `Moved ${(dv * SCALE).toFixed(0)}″ in ${fmtDt(dt)} — matches ephemeris` : 'Matches ephemeris') + offTxt(k, tb, b) }); continue; }
    if (v) { usedV.add(v); res.push({ kind: 'cand', title: 'Uncatalogued mover', x: b.x, y: b.y, from: v, to: b, star: s || vs.s || undefined, detail: `${(dv * SCALE).toFixed(0)}″ in ${fmtDt(dt)} = ${fmtRate(rate, dt)}. No ephemeris match.` + coin + softTxt(ib, b) }); }
    else res.push({ kind: 'cand', title: 'New source, no counterpart', x: b.x, y: b.y, to: b, star: s || undefined, detail: 'Appeared with nothing vanishing nearby' + coin + softTxt(ib, b) });
  }
  for (const v of vanished) { if (usedV.has(v)) continue;
    const k = knownAt(ta, v), hf = k ? [] : hardFlags(ia, v);
    if (k && inside(k.pos(tb))) continue;                                                 // still in the field: it moved, and is reported as 'known' below
    if (hf.length) { res.push({ kind: 'art', title: 'Flagged by the SPHEREx pipeline in reference', x: v.x, y: v.y, from: v, detail: `Pixel flags: ${hf.join(', ')}. The L2 pipeline marks this pixel as bad in the reference frame` }); continue; }
    const why = artWhy(hardA, hardB, v);
    if (!k && why === 'spike') { res.push({ kind: 'art', title: 'Single-pixel spike in reference', x: v.x, y: v.y, from: v, detail: 'Not PSF-shaped: cosmic ray or hot pixel' }); continue; }
    if (!k && why) { res.push({ kind: 'art', title: ART_TXT[why][0] + (why === 'masked' ? '' : ' in reference'), x: v.x, y: v.y, from: v, detail: ART_TXT[why][1] }); continue; }
    const { s, ex, isStar } = k ? { s: null } : vanishedOnStar(v);
    if (isStar) { // a Gaia star no longer detected: a fading only if its aperture flux really fell
      const c = under ? change(v, v) : null;
      if (c && (!c.varies || c.ratio > 1 || blended(v))) continue;                     // same flux, the 5σ detection just toggled (sampling, blend)
      if (dupVar(v)) continue;
      res.push({ kind: 'var', title: 'Faded star', x: v.x, y: v.y, from: v, star: s, detail: `${starTxt(s)} dropped below detection in the comparison frame${c ? `: ${c.txt}` : ''}; fading, not motion` }); continue; }
    res.push({ kind: 'left', title: k ? `${k.name} — left the cutout` : 'Source vanished', x: v.x, y: v.y, from: v, star: s || undefined, detail: (k ? 'Ephemeris puts it outside this field now' : 'Faded or moved out of field') + onStarTxt(s ? ex : null) }); }
  // Known movers whose shift is below the pairing threshold (a high-proper-motion star at ~1 px/yr) never appear or
  // vanish, so they would go unreported; name them when a source sits at the predicted position in both frames.
  for (const k of KNOWN) {
    if (res.some(r => r.kind === 'known' && r.obj === k)) continue;
    const pa = k.pos(ta), pb = k.pos(tb); if (!inside(pa) || !inside(pb)) continue;
    const shift = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]); if (shift < 0.5) continue; // not moving at this resolution
    const what = k.kind === 'star' ? 'proper motion' : 'ephemeris';
    const [sa, da] = nearest(Alo, { x: pa[0], y: pa[1] }), [sb, db] = nearest(Blo, { x: pb[0], y: pb[1] });
    if (sa && sb && da <= 2 && db <= 2) res.push({ kind: 'known', title: k.name, x: sb.x, y: sb.y, from: sa, to: sb, obj: k, detail: `Moved ${(dist(sa, sb) * SCALE).toFixed(0)}″ in ${fmtDt(dt)} — matches ${what}` + offTxt(k, tb, sb) });
    else res.push({ kind: 'known', title: k.name, x: pb[0], y: pb[1], obj: k, predicted: true, detail: `Predicted here from the ${what} (${(shift * SCALE).toFixed(0)}″ in ${fmtDt(dt)}); no clean centroid within 2 px — saturated, flagged or too faint` });
  }
  res.sort((p, q) => KIND_ORDER[p.kind] - KIND_ORDER[q.kind]);
  return res;
}

const diffCache = new WeakMap();
/** frame(ib) − frame(ia), cached per field and ordered pair. */
export function diff(field, ia, ib) {
  let m = diffCache.get(field); if (!m) diffCache.set(field, m = new Map());
  const key = ia + ',' + ib; let d = m.get(key);
  if (!d) { const fa = field.frame(ia), fb = field.frame(ib), L = fa.length; d = new Float32Array(L); for (let p = 0; p < L; p++) d[p] = fb[p] - fa[p]; m.set(key, d); }
  return d;
}

const stackCache = new WeakMap();
/**
 * Pixel-wise maximum over every epoch at `band` whose time lies between epochs ia and ib (inclusive),
 * so a mover leaves a trail. Cached per field + band + time span.
 * @returns {{img: Float32Array, ts: number[], idx: number[]}}
 */
export function maxStack(field, band, ia, ib) {
  let m = stackCache.get(field); if (!m) stackCache.set(field, m = new Map());
  const E = field.epochs, lo = Math.min(E[ia].t, E[ib].t), hi = Math.max(E[ia].t, E[ib].t), key = band + ',' + lo + ',' + hi;
  let c = m.get(key);
  if (!c) { const L = field.N * field.N, st = new Float32Array(L).fill(-Infinity), ts = [], idx = [];
    E.forEach((e, i) => { if (e.band !== band || e.t < lo || e.t > hi) return; ts.push(e.t); idx.push(i); const f = field.frame(i); for (let p = 0; p < L; p++) if (f[p] > st[p]) st[p] = f[p]; });
    m.set(key, c = { img: st, ts, idx }); }
  return c;
}

const meanCache = new WeakMap();
/**
 * The passes added together: an inverse-variance weighted mean of every epoch whose time lies between epochs ia and
 * ib (inclusive) at `band`, or at every wavelength when `band` is null (the brief's "add together all the data taken
 * by each of the six detector arrays"). Each frame enters as (frame − its own sky) / σ², so a shallow pass cannot drag
 * the result down, and the first pass's sky level is put back. Fixed sources gain signal-to-noise (noise falls by up
 * to √n for n passes of equal depth); a mover is spread thin. `nEff` is the effective number of passes, (Σw)²/Σw²
 * (n for equal depths, less when a shallow pass carries little weight), and `gain` = √nEff is the noise reduction to
 * expect for aligned, independent passes. `gainMad` is the ratio of robust image scatter, best pass over stack; in a
 * dense field that scatter is faint real stars, identical in every pass, so it barely moves: it is a diagnostic, not
 * a claim. Cached per field + band + time span, like maxStack.
 * @returns {{img: Float32Array, ts: number[], idx: number[], n: number, nEff: number, gain: number, gainMad: number, bands: number[]}}
 */
export function meanStack(field, band, ia, ib) {
  let m = meanCache.get(field); if (!m) meanCache.set(field, m = new Map());
  const E = field.epochs, lo = Math.min(E[ia].t, E[ib].t), hi = Math.max(E[ia].t, E[ib].t), key = (band == null ? '*' : band) + ',' + lo + ',' + hi;
  let c = m.get(key);
  if (!c) {
    const L = field.N * field.N, sum = new Float64Array(L), ts = [], idx = [], bands = []; let wsum = 0, w2sum = 0, best = Infinity;
    E.forEach((e, i) => {
      if ((band != null && e.band !== band) || e.t < lo || e.t > hi) return;
      const f = field.frame(i), { med, sig } = stats(f), w = 1 / Math.max(sig * sig, 1e-12);
      ts.push(e.t); idx.push(i); if (!bands.includes(e.band)) bands.push(e.band); wsum += w; w2sum += w * w; if (sig < best) best = sig;
      for (let p = 0; p < L; p++) sum[p] += w * (f[p] - med);
    });
    const img = new Float32Array(L);
    if (idx.length) { const med0 = stats(field.frame(idx[0])).med; for (let p = 0; p < L; p++) img[p] = med0 + sum[p] / wsum; }
    const nEff = idx.length ? wsum * wsum / w2sum : 0, gain = idx.length ? Math.sqrt(nEff) : 1;
    const gainMad = idx.length ? best / Math.max(stats(img).sig, 1e-9) : 1;
    m.set(key, c = { img, ts, idx, n: idx.length, nEff, gain, gainMad, bands: bands.sort((a, b) => Number(a) - Number(b)) });
  }
  return c;
}
