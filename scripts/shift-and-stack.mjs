// Shift-and-stack on real SPHEREx frames: can adding the passes reach below the single-exposure limit?
//
// For an assumed distance, Earth's parallax says exactly where a body seen at some spot in the reference pass would
// sit in every other pass (predictAtB from scripts/link-fields.mjs, Earth's position from JPL's approximate elements).
// Shift every pass by that offset, average the frames, and a body at that distance adds up coherently while the fixed
// stars smear into n faint copies and the noise falls by about √n. A grid of distances is a grid of such stacks.
//
// This is the bounded, in-cutout version: the body has to stay inside the 300″ saved field in every pass, so with a
// ~200″ parallax between the two seasons it covers bodies beyond about 1,500–2,000 AU. Nearer bodies leave the cutout
// (see the cross-field linker); stacking them means stacking cutouts fetched along the predicted track, which this
// script does not do. Proven by injection on the six saved real fields (app/data/snapshots/):
//
//   node scripts/shift-and-stack.mjs                       # Markdown tables, ~10 s
//   node scripts/shift-and-stack.mjs --trials 10 --true-au 2000 --snrs 3,4,5,6,8
//
// "Recovered" = a source planted at `snr` × the frame noise in EVERY pass (at the positions a body at --true-au would
// occupy) is a ≥ 7σ_stack local maximum within 1.5 px of its reference position in the stack made at that distance, at
// a pixel not covered by the mask of shifted star copies. The same planted source is also stacked at WRONG distances
// (the selectivity check) and tested frame by frame (would a single pass have shown it?). Deterministic (seeded).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detect, stats, psfModel, rng } = await import(path.join(ROOT, 'app/js/pipeline/index.js'));
const { pixel } = await import(path.join(ROOT, 'app/js/pipeline/format.js'));
const { predictAtB } = await import(path.join(ROOT, 'scripts/link-fields.mjs'));
const { loadFields, plant } = await import(path.join(ROOT, 'scripts/injection-recovery.mjs'));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, v) => a.startsWith('--') ? [a.slice(2), v[i + 1] && !v[i + 1].startsWith('--') ? v[i + 1] : true] : []).filter(Boolean));
export const SNRS = [3, 4, 5, 6, 8];                  // per-frame peak SNR of a pixel-centred source (the single-frame firm bar is 7σ)
export const HYPOTHESES = [1500, 2000, 3000, 5000, Infinity]; // Infinity = no shift (a fixed source)
const FIRM = 7, DETECT_K = 5, MATCH_PX = 1.5, EDGE = 4, CLEAR_PX = 4, MASK_PX = 2;
/** Mask radius around a shifted copy of a fixed source: 2 px for a faint one, growing with brightness to 8 px, so the
 *  halo of a saturated star (R Draconis, Barnard's Star) is masked too and does not pass for noise in the stack. */
export const maskRadius = snr => Math.max(MASK_PX, Math.min(8, MASK_PX + 2 * Math.log10(Math.max(1, snr / 5))));

/** Pixel offset of a body at `distAU`, seen at the field centre in the reference epoch, in epoch i: [dx, dy]. */
export function parallaxOffsets(field, distAU, ref = 0) {
  const [x0, y0] = pixel(field, field.ra0, field.dec0);
  return field.epochs.map(e => {
    if (!Number.isFinite(distAU)) return [0, 0];
    const p = predictAtB({ ra: field.ra0, dec: field.dec0, mjdA: field.epochs[ref].mjd, mjdB: e.mjd, distAU });
    const [x, y] = pixel(field, p.ra, p.dec); return [x - x0, y - y0];
  });
}

/** Bilinear sample of frame at (x + dx, y + dy) for every pixel; NaN where the source lies outside the frame. */
export function shiftFrame(img, N, dx, dy) {
  const out = new Float32Array(N * N).fill(NaN);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = x + dx, sy = y + dy, x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= N || y0 + 1 >= N) continue;
    const fx = sx - x0, fy = sy - y0;
    out[y * N + x] = (1 - fx) * (1 - fy) * img[y0 * N + x0] + fx * (1 - fy) * img[y0 * N + x0 + 1] + (1 - fx) * fy * img[(y0 + 1) * N + x0] + fx * fy * img[(y0 + 1) * N + x0 + 1];
  }
  return out;
}

/** Robust median and 1.4826·MAD over the finite pixels. */
export function robust(img) {
  const v = Array.from(img).filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return { med: 0, sig: 1 };
  const med = v[v.length >> 1], d = v.map(x => Math.abs(x - med)).sort((a, b) => a - b);
  return { med, sig: 1.4826 * d[d.length >> 1] };
}

/**
 * Stack `frames` (Float32Array[]) aligned for a body at `distAU`: mean over the frames that cover each pixel.
 * Returns {img (NaN where no frame covers), cover (count per pixel), n, sig (robust noise of the fully covered stack), med,
 *          mask (Uint8Array: 1 within MASK_PX of a shifted copy of any ≥ 3σ single-frame source)}.
 */
export function stack(field, frames, offsets0) {
  const N = field.N, n = frames.length, sum = new Float32Array(N * N), cover = new Uint8Array(N * N), mask = new Uint8Array(N * N);
  // Whole-pixel shifts: SPHEREx's PSF is ~0.7 px wide after resampling, and bilinear interpolation of a half-pixel shift
  // spreads such a peak over four pixels; rounding costs at most 0.5 px of alignment, which keeps ~75% of the peak.
  const offsets = offsets0.map(([dx, dy]) => [Math.round(dx), Math.round(dy)]);
  // The mask holds the FIXED sources only: a ≥ 3σ source counts as fixed when a frame whose predicted offset differs by
  // more than 3 px has one within 1.5 px of the same (unshifted) position. A body at the assumed distance has moved
  // between such frames, so it is never masked; between same-season passes it has not, which is why those pairs do not
  // count: a distant body returns to the same pixel a year later, as a star does.
  const dets = frames.map(f => detect(f, 3));
  const far = (i, j) => Math.hypot(offsets[i][0] - offsets[j][0], offsets[i][1] - offsets[j][1]) > 3;
  const fixed = dets.map((ds, i) => ds.filter(d => dets.some((o, j) => j !== i && far(i, j) && o.some(q => Math.hypot(q.x - d.x, q.y - d.y) < 1.5))));
  // inverse-variance weights: a noisier pass should count for less
  const w = frames.map(f => 1 / stats(f).sig ** 2), wsum = new Float32Array(N * N);
  frames.forEach((f, i) => {
    const [dx, dy] = offsets[i], s = shiftFrame(f, N, dx, dy);
    for (let p = 0; p < N * N; p++) if (Number.isFinite(s[p])) { sum[p] += w[i] * s[p]; wsum[p] += w[i]; cover[p]++; }
    for (const d of fixed[i]) { // where this frame's fixed sources land in the stack: x_stack = x_frame - dx
      const cx = d.x - dx, cy = d.y - dy, R = maskRadius(d.peak / d.sig);
      for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(N - 1, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(N - 1, Math.ceil(cx + R)); x++)
        if (Math.hypot(x - cx, y - cy) <= R) mask[y * N + x] = 1;
    }
  });
  const img = new Float32Array(N * N).fill(NaN); let full = 0;
  for (let p = 0; p < N * N; p++) if (cover[p] === n) { img[p] = sum[p] / wsum[p]; full++; }
  // noise of the stack measured on sky pixels: fully covered and outside the star-copy mask (the copies are signal, not noise)
  const sky = new Float32Array(N * N).fill(NaN); for (let p = 0; p < N * N; p++) if (cover[p] === n && !mask[p]) sky[p] = img[p];
  const { med, sig } = robust(sky);
  return { img, cover, n, sig, med, mask, fullPixels: full };
}

/** Local maxima above med + k·sig among fully covered, unmasked pixels, with a 5×5 centroid. */
export function detectStack(st, N, k = DETECT_K) {
  const { img, cover, mask, med, sig, n } = st, thr = med + k * sig, out = [];
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const p = y * N + x, v = img[p]; if (cover[p] !== n || mask[p] || !(v >= thr)) continue;
    let mx = true; for (let dy = -1; dy <= 1 && mx; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const q = img[(y + dy) * N + x + dx]; if (Number.isFinite(q) && q > v) { mx = false; break; } }
    if (!mx) continue;
    let sx = 0, sy = 0, sw = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const q = img[(y + dy) * N + x + dx]; if (!Number.isFinite(q)) continue; const w = Math.max(q - med, 0); sx += w * (x + dx); sy += w * (y + dy); sw += w; }
    out.push({ x: sw ? sx / sw : x, y: sw ? sy / sw : y, peak: v - med, snr: (v - med) / sig });
  }
  return out;
}

/** One injection trial on one field. Returns per-hypothesis recovery plus whether any single frame showed the source. */
export function trial(field, frames0, snr, trueAU, hyps, r, ctx) {
  const N = field.N, offs = parallaxOffsets(field, trueAU);
  // a reference position whose shifted copies all lie inside the field, clear of real sources and bad pixels in every frame,
  // and outside the star-copy mask of the true-distance stack (the mask is sky the method cannot search; its share is reported)
  let p0 = null;
  for (let k = 0; k < 400 && !p0; k++) {
    const c = { x: EDGE + r() * (N - 2 * EDGE), y: EDGE + r() * (N - 2 * EDGE) };
    if (ctx.mask0[Math.round(c.y) * N + Math.round(c.x)]) continue;
    const okAll = offs.every(([dx, dy], i) => { const x = c.x + dx, y = c.y + dy; return x >= EDGE && y >= EDGE && x < N - EDGE && y < N - EDGE && !ctx.existing[i].some(q => Math.hypot(q.x - x, q.y - y) < CLEAR_PX) && !ctx.hard(i, x, y); });
    if (okAll) p0 = c;
  }
  if (!p0) return null;
  const frames = frames0.map((f, i) => { const g = Float32Array.from(f); plant(g, N, p0.x + offs[i][0], p0.y + offs[i][1], snr * ctx.sig[i] * 2 * Math.PI * ctx.psf * ctx.psf, ctx.psf); return g; });
  // would a single pass have shown it? (a 5σ local maximum with peak ≥ 7σ at the planted spot, the pipeline's firm bar)
  const single = frames.some((g, i) => detect(g, DETECT_K).some(d => d.peak >= FIRM * d.sig && Math.hypot(d.x - p0.x - offs[i][0], d.y - p0.y - offs[i][1]) < MATCH_PX));
  const res = { single, by: {} };
  for (const h of hyps) {
    const st = stack(field, frames, parallaxOffsets(field, h));
    const hit = detectStack(st, N).find(d => d.snr >= FIRM && Math.hypot(d.x - p0.x, d.y - p0.y) < MATCH_PX);
    res.by[h] = { hit: !!hit, snr: hit ? hit.snr : null, sigRatio: st.sig / ctx.sigRef };
  }
  return res;
}

export function run({ fields, trials = 20, trueAU = 2000, snrs = SNRS, hyps = HYPOTHESES, seed = 20261115 } = {}) {
  const out = [];
  for (const { id, field } of fields) {
    const frames0 = field.epochs.map((_, i) => field.frame(i)), n = frames0.length, N = field.N;
    const psf = psfModel(field).sigma, sig = frames0.map(f => stats(f).sig), existing = frames0.map(f => detect(f, 3));
    const FB = field.flagBits && field.flagBits.names ? field.flagBits : null;
    const hard = (i, x, y) => { if (!FB) return false; const fl = field.flags(i); if (!fl) return false; const v = fl[Math.round(y) * field.N + Math.round(x)]; return FB.hard.some(nm => FB.names[nm] != null && ((v >>> FB.names[nm]) & 1) === 1); };
    const trueStack = stack(field, frames0, parallaxOffsets(field, trueAU)), maskFrac = trueStack.mask.reduce((a, b) => a + b, 0) / (N * N);
    const ctx = { psf, sig, existing, hard, sigRef: sig[0], mask0: trueStack.mask };
    const noShift = stack(field, frames0, parallaxOffsets(field, Infinity));
    // noise gain: the best single frame's noise over the stack's, for the plain mean (no shift) and for the true-distance stack
    const best = Math.min(...sig), row = { id, n, psf, gain: best / noShift.sig, gainTrue: best / trueStack.sig, ideal: Math.sqrt(n), maskFrac, cells: {} };
    for (const snr of snrs) {
      const r = rng(seed + snr * 31 + id.length), cell = { n: 0, single: 0, hit: {}, snr: {} }; for (const h of hyps) { cell.hit[h] = 0; cell.snr[h] = []; }
      for (let k = 0; k < trials; k++) { const t = trial(field, frames0, snr, trueAU, hyps, r, ctx); if (!t) continue; cell.n++; if (t.single) cell.single++; for (const h of hyps) { if (t.by[h].hit) { cell.hit[h]++; cell.snr[h].push(t.by[h].snr); } } }
      row.cells[snr] = cell;
    }
    out.push(row);
  }
  return { rows: out, trueAU, trials, hyps, snrs, seed };
}

const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '–';
export function tables(o) {
  const L = [];
  L.push(`Shift-and-stack by injection: a source planted at the given per-frame peak SNR in every pass, at the positions a body at ${o.trueAU} AU would occupy; stacked at ${o.hyps.map(h => Number.isFinite(h) ? h + ' AU' : 'no shift').join(', ')}. Recovered = ≥ 7σ_stack within 1.5 px of the reference position, outside the star-copy mask. ${o.trials} trials per cell, seed ${o.seed}.`);
  L.push('', `| Field | Passes stacked | Noise gain, plain mean (ideal √n) | Noise gain, stack at ${o.trueAU} AU | Sky lost to star copies |`, '|---|---|---|---|---|');
  for (const r of o.rows) L.push(`| ${r.id} | ${r.n} | ×${r.gain.toFixed(2)} (×${r.ideal.toFixed(2)}) | ×${r.gainTrue.toFixed(2)} | ${(100 * r.maskFrac).toFixed(0)}% |`);
  L.push('', `| Field | Per-frame SNR | Seen in a single pass | Stack at ${o.trueAU} AU (true) | ${o.hyps.filter(h => h !== o.trueAU).map(h => `Stack at ${Number.isFinite(h) ? h + ' AU' : 'no shift'}`).join(' | ')} | Stack SNR at true distance (median) |`);
  L.push(`|${'---|'.repeat(4 + o.hyps.length)}`);
  for (const r of o.rows) for (const s of o.snrs) { const c = r.cells[s]; if (!c.n) continue; const med = c.snr[o.trueAU].length ? c.snr[o.trueAU].sort((a, b) => a - b)[c.snr[o.trueAU].length >> 1].toFixed(1) : '–';
    L.push(`| ${r.id} (${r.n}) | ${s}σ | ${pct(c.single, c.n)} | **${pct(c.hit[o.trueAU], c.n)}** | ${o.hyps.filter(h => h !== o.trueAU).map(h => pct(c.hit[h], c.n)).join(' | ')} | ${med} |`); }
  // aggregate over fields, per SNR
  L.push('', '| Per-frame SNR | Seen in a single pass | Recovered in the stack at the true distance | False recovery at a wrong distance or no shift |', '|---|---|---|---|');
  for (const s of o.snrs) { let n = 0, single = 0, hit = 0, wrong = 0, wrongN = 0; for (const r of o.rows) { const c = r.cells[s]; n += c.n; single += c.single; hit += c.hit[o.trueAU]; for (const h of o.hyps) if (h !== o.trueAU) { wrong += c.hit[h]; wrongN += c.n; } }
    L.push(`| ${s}σ | ${pct(single, n)} | **${pct(hit, n)}** | ${pct(wrong, wrongN)} |`); }
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fields = loadFields(args.fields ? String(args.fields).split(',') : null), t0 = Date.now();
  const o = run({ fields, trials: args.trials ? +args.trials : 20, trueAU: args['true-au'] ? +args['true-au'] : 2000, snrs: args.snrs ? String(args.snrs).split(',').map(Number) : SNRS });
  console.log(tables(o)); console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
