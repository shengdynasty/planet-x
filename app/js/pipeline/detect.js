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
  for (let y = 4; y < N - 4; y++) for (let x = 4; x < N - 4; x++) { const v = img[y * N + x]; if (v < thr) continue; let mx = true;
    for (let dy = -1; dy <= 1 && mx; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; if (img[(y + dy) * N + x + dx] > v) { mx = false; break; } }
    if (!mx) continue;
    let sx = 0, sy = 0, sw = 0, nb = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const w = Math.max(img[(y + dy) * N + x + dx] - med, 0); sx += w * (x + dx); sy += w * (y + dy); sw += w; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx || dy) nb += img[(y + dy) * N + x + dx] - med; }
    out.push({ x: sw ? sx / sw : x, y: sw ? sy / sw : y, peak: v - med, flux: sw, sig, spike: (v - med) / Math.max(nb / 8, 0.5 * sig) }); }
  return out;
});

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function nearest(list, p) { let best = null, bd = 1e9; for (const q of list) { const d = dist(p, q); if (d < bd) { bd = d; best = q; } } return [best, bd]; }

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
  const usedV = new Set();
  const partner = b => { let best = null, bd = 1e9; for (const v of vanished) { if (usedV.has(v)) continue; const r = b.peak / v.peak; if (r < 0.5 || r > 2) continue; const d = dist(v, b); if (d < bd) { bd = d; best = v; } } return [best, bd]; };
  for (const b of appeared) {
    if (b.spike > 3.2) { res.push({ kind: 'art', title: 'Single-pixel spike', x: b.x, y: b.y, to: b, detail: 'Not PSF-shaped: cosmic ray or hot pixel' }); continue; }
    const k = knownAt(tb, b);
    const [v, dv] = partner(b);
    const rate = v ? dv * SCALE / dt : null;
    if (k) { if (v) usedV.add(v); res.push({ kind: 'known', title: k.name, x: b.x, y: b.y, from: v, to: b, obj: k, detail: v ? `Moved ${(dv * SCALE).toFixed(0)}″ in ${fmtDt(dt)} — matches ephemeris` : 'Matches ephemeris' }); continue; }
    if (v) { usedV.add(v); res.push({ kind: 'cand', title: 'Uncatalogued mover', x: b.x, y: b.y, from: v, to: b, detail: `${(dv * SCALE).toFixed(0)}″ in ${fmtDt(dt)} = ${fmtRate(rate, dt)}. No ephemeris match.` }); }
    else res.push({ kind: 'cand', title: 'New source, no counterpart', x: b.x, y: b.y, to: b, detail: 'Appeared with nothing vanishing nearby' });
  }
  for (const v of vanished) { if (usedV.has(v)) continue;
    if (v.spike > 3.2) { res.push({ kind: 'art', title: 'Single-pixel spike in reference', x: v.x, y: v.y, from: v, detail: 'Not PSF-shaped: cosmic ray or hot pixel' }); continue; }
    const k = knownAt(ta, v);
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
