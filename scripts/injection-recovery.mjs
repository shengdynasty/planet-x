// Injection-recovery test on real SPHEREx frames.
//
// Plants synthetic movers of known brightness and motion into the saved example fields (app/data/snapshots/, real
// IRSA frames with their flag planes, JPL known objects and Gaia stars) and asks the detection pipeline
// (app/js/pipeline/detect.js analyse) what it reports. A planted source is "recovered" when the pipeline flags an
// Uncatalogued mover whose reference and comparison positions are both within 1.5 px of where it was planted.
//
//   node scripts/injection-recovery.mjs                 # Markdown tables on stdout, a few seconds
//   node scripts/injection-recovery.mjs --trials 10 --pairs all --json out.json --fields psyche,barnard
//   node scripts/injection-recovery.mjs --clear-gaia    # also keep 1.5 px from every Gaia DR3 star: the detector alone
//
// Two numbers matter. Without --clear-gaia the planted source may land within 1.5 px of a catalogued star, and the
// pipeline then calls the change a brightening or fading of that star rather than motion (its rule for separating
// variability from movers). In a dense field (Barnard's Star: 218 Gaia stars in 49×49 px) that covers most positions,
// so recovery there says more about the catalogue rule than about the detector. --clear-gaia removes that effect.
//
// The planted source is a point-sampled Gaussian of the field's own measured PSF width (psfModel), at a random
// sub-pixel position, with total flux F such that a pixel-centred copy would peak at `snr` × the frame's noise
// (robust MAD, as the pipeline measures it). Real sub-pixel phases lower the realised peak by up to ~40% at
// σ ≈ 0.65 px, which is the point: this is what the detector sees. Planted positions keep 4 px from the edges and
// from any existing ≥ 3σ source in either frame, and avoid pixels the L2 pipeline flags as bad, so the numbers
// measure the detector, not blends or bad pixels (those are separate failure modes, see issues.md ISS-07/ISS-17).
// Trials are deterministic (seeded), so the tables are reproducible; tests/injection.test.mjs asserts a subset.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { toField } = await import(path.join(ROOT, 'app/js/data/index.js'));
const { analyse, psfModel, stats, detect, rng } = await import(path.join(ROOT, 'app/js/pipeline/index.js'));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, v) => a.startsWith('--') ? [a.slice(2), v[i + 1] && !v[i + 1].startsWith('--') ? v[i + 1] : true] : []).filter(Boolean));
export const SNRS = [4, 6, 8, 12, 20, 40];      // nominal peak SNR of a pixel-centred source (the FIRM detection threshold is 7σ)
export const SHIFTS = [1, 2, 3, 5, 8, 15];       // motion between the two frames, px (6.15″/px); the pairing threshold is 2.2 px
export const CASES = [...SHIFTS.map(s => ({ id: String(s), shift: s })), { id: 'enter', shift: null, enter: true }, { id: 'leave', shift: null, leave: true }];
const MATCH_PX = 1.5, EDGE = 4, CLEAR_PX = 4, GAIA_PX = 1.5; // GAIA_PX: the pipeline's own star-match radius (detect.js starAt)

/** Load the saved fields (all, or `ids`). */
export function loadFields(ids = null) {
  const idx = JSON.parse(readFileSync(path.join(ROOT, 'app/data/snapshots/index.json'), 'utf8'));
  return idx.targets.filter(t => !ids || ids.includes(t.id)).map(t => ({ id: t.id, label: t.label, field: toField(JSON.parse(readFileSync(path.join(ROOT, 'app/data/snapshots', t.file), 'utf8'))) }));
}

/** Add a point-sampled Gaussian of total flux F and width sigma (px) at (x, y). */
export function plant(img, N, x, y, F, sigma) {
  const a = F / (2 * Math.PI * sigma * sigma), r = Math.ceil(4 * sigma) + 1;
  for (let yy = Math.max(0, Math.floor(y) - r); yy <= Math.min(N - 1, Math.ceil(y) + r); yy++)
    for (let xx = Math.max(0, Math.floor(x) - r); xx <= Math.min(N - 1, Math.ceil(x) + r); xx++)
      img[yy * N + xx] += a * Math.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma * sigma));
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * One trial: plant a mover (or an entering / leaving source) into a copy of frames ia and ib and classify what the
 * pipeline says about it. Returns {outcome: 'recovered'|'misclassified'|'missed', kind?, title?, errPx?, posA?, posB?}.
 */
export function trial(field, ia, ib, snr, cas, r, ctx) {
  const N = field.N, { sig: sigA } = stats(field.frame(ia)), { sig: sigB } = stats(field.frame(ib));
  const F = snr * Math.max(sigA, sigB) * 2 * Math.PI * ctx.sigma * ctx.sigma;
  const hard = (i, p) => { if (!ctx.FB) return false; const fl = field.flags(i); if (!fl) return false; const v = fl[Math.round(p.y) * N + Math.round(p.x)]; return ctx.FB.hard.some(n => ctx.FB.names[n] != null && ((v >>> ctx.FB.names[n]) & 1) === 1); };
  const clear = p => p.x >= EDGE && p.y >= EDGE && p.x < N - EDGE && p.y < N - EDGE && !ctx.existing.some(q => d2(q, p) < CLEAR_PX) && !hard(ia, p) && !hard(ib, p)
    && !(ctx.clearGaia && ctx.stars.some(s => d2(s, p) < GAIA_PX));
  let posA = null, posB = null;
  for (let k = 0; k < 500 && !posA; k++) {
    const p = { x: EDGE + r() * (N - 2 * EDGE), y: EDGE + r() * (N - 2 * EDGE) };
    if (cas.enter) { if (clear(p)) posB = p, posA = { x: -99, y: -99 }; continue; }
    if (cas.leave) { if (clear(p)) posA = p, posB = { x: -99, y: -99 }; continue; }
    const th = r() * 2 * Math.PI, q = { x: p.x + cas.shift * Math.cos(th), y: p.y + cas.shift * Math.sin(th) };
    if (clear(p) && clear(q) && d2(p, q) > 0) { posA = p; posB = q; }
  }
  if (!posA) return { outcome: 'noroom' };
  const fa = Float32Array.from(field.frame(ia)), fb = Float32Array.from(field.frame(ib));
  if (!cas.enter) plant(fa, N, posA.x, posA.y, F, ctx.sigma);
  if (!cas.leave) plant(fb, N, posB.x, posB.y, F, ctx.sigma);
  const g = { ...field, psfSigmaPx: ctx.sigma, frame: i => i === ia ? fa : i === ib ? fb : field.frame(i) };
  const res = analyse(g, ia, ib);
  const atB = p => p && d2(p, posB) < MATCH_PX, atA = p => p && d2(p, posA) < MATCH_PX;
  if (cas.enter) { // an entering source is recovered as "New source, no counterpart", or, when the real field happens to hold a genuinely
    // vanished source (not an artifact, not a star that faded) of similar brightness, as an "Uncatalogued mover" paired with it: with two
    // epochs that reading is as valid as ours, so it counts, and is tallied separately
    const h = res.find(x => x.kind === 'cand' && atB(x.to) && (x.title === 'New source, no counterpart' || ctx.baseline.some(b => b.kind === 'left' && b.from && x.from && d2(b.from, x.from) < 0.5)));
    if (h) return { outcome: 'recovered', errPx: d2(h.to, posB), paired: h.title === 'Uncatalogued mover' }; }
  else if (cas.leave) { const h = res.find(x => x.kind === 'left' && atA(x.from)); if (h) return { outcome: 'recovered', errPx: d2(h.from, posA) }; }
  else { const h = res.find(x => x.kind === 'cand' && x.title === 'Uncatalogued mover' && atB(x.to) && atA(x.from)); if (h) return { outcome: 'recovered', errPx: Math.max(d2(h.to, posB), d2(h.from, posA)) }; }
  const near = res.find(x => atB(x.to) || atA(x.from) || atB(x) || atA(x));
  const baseline = near && ctx.baseline.some(b => b.kind === near.kind && b.title === near.title && Math.hypot(b.x - near.x, b.y - near.y) < 0.5);
  return near && !baseline ? { outcome: 'misclassified', kind: near.kind, title: near.title } : { outcome: 'missed' };
}

/** Run the grid over fields × pairs; returns {cells: {[snr]: {[case]: {n, recovered, misclassified, missed, errs[], kinds{}}}}, fields: [...]} */
export function run({ fields, trials = 20, pairs = 'first', seed = 20261114, snrs = SNRS, cases = CASES, clearGaia = false, log = () => {} } = {}) {
  const cells = {}; for (const s of snrs) { cells[s] = {}; for (const c of cases) cells[s][c.id] = { n: 0, recovered: 0, misclassified: 0, missed: 0, errs: [], kinds: {} }; }
  const perField = [];
  for (const { id, field } of fields) {
    const js = pairs === 'all' ? field.epochs.map((_, j) => j).slice(1) : [1];
    const psf = psfModel(field), FB = typeof field.flags === 'function' && field.flagBits && field.flagBits.names ? field.flagBits : null;
    const pf = { id, sigma: psf.sigma, stars: (field.stars || []).length, pairs: js.length, n: 0, recovered: 0 };
    for (const ib of js) {
      const ia = 0, r = rng(seed + ib * 1000 + id.length * 7), baseline = analyse(field, ia, ib);
      const existing = [...detect(field.frame(ia), 3), ...detect(field.frame(ib), 3)];
      // Gaia positions at both epochs (they barely differ, except for the high-proper-motion targets themselves)
      const stars = (field.stars || []).flatMap(s => [field.epochs[ia].t, field.epochs[ib].t].map(t => { const [x, y] = s.pos(t); return { x, y }; }));
      const ctx = { sigma: psf.sigma, FB, existing, baseline, stars, clearGaia };
      for (const snr of snrs) for (const cas of cases) for (let k = 0; k < trials; k++) {
        const t = trial(field, ia, ib, snr, cas, r, ctx); if (t.outcome === 'noroom') continue;
        const cell = cells[snr][cas.id]; cell.n++; cell[t.outcome]++;
        if (t.paired) cell.paired = (cell.paired || 0) + 1;
        if (t.errPx != null) cell.errs.push(t.errPx);
        if (t.kind) cell.kinds[`${t.kind}: ${t.title}`] = (cell.kinds[`${t.kind}: ${t.title}`] || 0) + 1;
        if (snr >= 12 && cas.shift >= 3) { pf.n++; if (t.outcome === 'recovered') pf.recovered++; }
      }
      log(`${id} pair 0→${ib} done`);
    }
    perField.push(pf);
  }
  return { cells, fields: perField, trials, pairs, seed, clearGaia };
}

const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '–';
export function tables(out) {
  const S = Object.keys(out.cells), C = Object.keys(out.cells[S[0]]);
  const head = `| Peak SNR | ${C.map(c => /^\d/.test(c) ? `${c} px (${(c * 6.15).toFixed(0)}″)` : c === 'enter' ? 'enters the field' : 'leaves the field').join(' | ')} |`;
  const rows = S.map(s => `| ${s} | ${C.map(c => pct(out.cells[s][c].recovered, out.cells[s][c].n)).join(' | ')} |`);
  const all = []; for (const s of S) for (const c of C) all.push(...out.cells[s][c].errs);
  all.sort((a, b) => a - b);
  const mis = {}; for (const s of S) for (const c of C) for (const [k, v] of Object.entries(out.cells[s][c].kinds)) mis[k] = (mis[k] || 0) + v;
  const misTxt = Object.entries(mis).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ') || 'none';
  const n = Object.values(out.cells[S[0]]).reduce((a, c) => a + c.n, 0);
  return [
    `Recovered movers (reported as "Uncatalogued mover" with both positions within ${MATCH_PX} px of where they were planted), ${Math.round(n / C.length)} trials per cell across ${out.fields.length} real fields, pairs: ${out.pairs}, seed ${out.seed}${out.clearGaia ? ', planted ≥ 1.5 px from every Gaia star (detector alone)' : ', planted anywhere clear of detected sources (Gaia coincidences count as misses)'}:`,
    '', head, `|${'---|'.repeat(C.length + 1)}`, ...rows, '',
    `Position error of recovered sources: median ${all.length ? (all[all.length >> 1]).toFixed(2) : '–'} px, 90th percentile ${all.length ? all[Math.floor(all.length * 0.9)].toFixed(2) : '–'} px.`,
    `What the misses became: ${misTxt}.`,
    `Entering sources paired by the pipeline with a genuinely vanished source elsewhere in the field (counted as recovered): ${S.map(s => `${s}σ ${out.cells[s].enter.paired || 0}/${out.cells[s].enter.n}`).join(', ')}.`,
    '', '| Field | PSF σ (px) | Gaia stars | Pairs | Recovered at SNR ≥ 12, shift ≥ 3 px |', '|---|---|---|---|---|',
    ...out.fields.map(f => `| ${f.id} | ${f.sigma.toFixed(2)} | ${f.stars} | ${f.pairs} | ${pct(f.recovered, f.n)} (${f.recovered}/${f.n}) |`),
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fields = loadFields(args.fields ? String(args.fields).split(',') : null);
  const t0 = Date.now();
  const out = run({ fields, trials: args.trials ? +args.trials : 20, pairs: args.pairs === 'all' ? 'all' : 'first', seed: args.seed ? +args.seed : 20261114, clearGaia: !!args['clear-gaia'], log: m => process.stderr.write(m + '\n') });
  console.log(tables(out));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (args.json) { const { writeFileSync } = await import('node:fs'); writeFileSync(String(args.json), JSON.stringify(out, null, 1)); }
}
