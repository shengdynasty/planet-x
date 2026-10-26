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
  const fa = field.frame(ia), fb = field.frame(ib), SCALE = field.scale, KNOWN = field.known || [];
  const A = detect(fa, 5), B = detect(fb, 5), Alo = detect(fa, 3), Blo = detect(fb, 3);
  const ta = field.epochs[ia].t, tb = field.epochs[ib].t, dt = Math.abs(tb - ta), sig = A.length ? A[0].sig : 0.1;
  const res = [], appeared = [], vanished = [];
  const FIRM = 7 * sig;
  for (const b of B) { const [a, d] = nearest(Alo.filter(q => q.peak > 0.35 * b.peak), b);
    if (a && d < 2.2) { const ratio = b.peak / a.peak;
      if ((ratio > 1.8 || ratio < 0.55) && Math.min(a.peak, b.peak) > 12 * sig) res.push({ kind: 'var', title: 'Brightness change, fixed position', x: b.x, y: b.y, from: a, to: b, detail: `×${ratio.toFixed(2)} in peak, no motion` });
    } else if (b.peak > FIRM) appeared.push(b); }
  for (const a of A) { if (a.peak <= FIRM) continue; const [b, d] = nearest(Blo.filter(q => q.peak > 0.35 * a.peak), a); if (!(b && d < 2.2)) vanished.push(a); }
  const knownAt = (t, p) => { for (const k of KNOWN) { const q = k.pos(t); if (!q) continue; const [x, y] = q; if (Math.hypot(x - p.x, y - p.y) < 3) return k; } return null; };
  // Live ephemerides name their source; then say how close the prediction was (simulated strings stay Moving Sky's).
  const offTxt = (k, t, p) => { if (!k.source) return ''; const [x, y] = k.pos(t); return ` · ${(Math.hypot(x - p.x, y - p.y) * SCALE).toFixed(1)}″ from ${k.source}`; };
  // Artifact test, PSF-aware: too sharp for this field's PSF (spike), or a bright blob that fails a PSF fit
  // (cosmic-ray streak, bad pixels); a source within a few pixels of such a hit is an artifact too, whether the hit
  // is in the same frame (CR shower) or in the other one (the counterpart is hidden under it).
  const psf = psfModel(field);
  const hardOf = img => { const why = new Map();
    for (const s of detect(img, 5)) { if (s.spike > psf.spikeMax) why.set(s, 'spike'); else if (s.peak > MISFIT_MIN_SNR * s.sig && Math.min(...[1, 1.5, 2].map(f => psfMisfit(img, s, f * psf.sigma))) > MISFIT_MAX) why.set(s, 'shape'); } // broader than the PSF is fine (galaxy, blend)
    return why; };
  const hardA = hardOf(fa), hardB = hardOf(fb);
  const near = (m, s) => { for (const h of m.keys()) if (h !== s && dist(h, s) < CLUSTER_PX) return true; return false; };
  const artWhy = (own, other, s) => own.get(s) || (near(own, s) ? 'cluster' : near(other, s) ? 'masked' : null);
  const ART_TXT = { shape: ['Not PSF-shaped', 'Streak or blob that fails a PSF fit: cosmic ray or bad pixels'], cluster: ['Next to an artifact', 'Within a few pixels of a cosmic-ray / bad-pixel hit in the same frame'],
    masked: ['Counterpart covered by an artifact', 'The same spot in the other frame is hit by a cosmic ray or bad pixels, so this change is not trustworthy'] };
  const usedV = new Set();
  const partner = b => { let best = null, bd = 1e9; for (const v of vanished) { if (usedV.has(v)) continue; const r = b.peak / v.peak; if (r < 0.5 || r > 2) continue; const d = dist(v, b); if (d < bd) { bd = d; best = v; } } return [best, bd]; };
  for (const b of appeared) {
    const k = knownAt(tb, b), why = artWhy(hardB, hardA, b);  // an ephemeris match wins over the artifact test
    if (!k && why === 'spike') { res.push({ kind: 'art', title: 'Single-pixel spike', x: b.x, y: b.y, to: b, detail: 'Not PSF-shaped: cosmic ray or hot pixel' }); continue; }
    if (!k && why) { res.push({ kind: 'art', title: ART_TXT[why][0], x: b.x, y: b.y, to: b, detail: ART_TXT[why][1] }); continue; }
    const [v, dv] = partner(b);
    const rate = v ? dv * SCALE / dt : null;
    if (k) { if (v) usedV.add(v); res.push({ kind: 'known', title: k.name, x: b.x, y: b.y, from: v, to: b, obj: k, detail: (v ? `Moved ${(dv * SCALE).toFixed(0)}″ in ${fmtDt(dt)} — matches ephemeris` : 'Matches ephemeris') + offTxt(k, tb, b) }); continue; }
    if (v) { usedV.add(v); res.push({ kind: 'cand', title: 'Uncatalogued mover', x: b.x, y: b.y, from: v, to: b, detail: `${(dv * SCALE).toFixed(0)}″ in ${fmtDt(dt)} = ${fmtRate(rate, dt)}. No ephemeris match.` }); }
    else res.push({ kind: 'cand', title: 'New source, no counterpart', x: b.x, y: b.y, to: b, detail: 'Appeared with nothing vanishing nearby' });
  }
  for (const v of vanished) { if (usedV.has(v)) continue;
    const k = knownAt(ta, v), why = artWhy(hardA, hardB, v);
    if (!k && why === 'spike') { res.push({ kind: 'art', title: 'Single-pixel spike in reference', x: v.x, y: v.y, from: v, detail: 'Not PSF-shaped: cosmic ray or hot pixel' }); continue; }
    if (!k && why) { res.push({ kind: 'art', title: ART_TXT[why][0] + (why === 'masked' ? '' : ' in reference'), x: v.x, y: v.y, from: v, detail: ART_TXT[why][1] }); continue; }
    res.push({ kind: 'left', title: k ? `${k.name} — left the cutout` : 'Source vanished', x: v.x, y: v.y, from: v, detail: k ? 'Ephemeris puts it outside this field now' : 'Faded or moved out of field' }); }
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
