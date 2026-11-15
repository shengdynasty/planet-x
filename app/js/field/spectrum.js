// Measured SPHEREx spectra in the Field view: which sources can have one, the plot, the caption and the CSV, from the
// data server's /api/spectrum answer (server/lib/spectrum.mjs) or a saved copy. No DOM, so Node tests can check them.

export const LAMBDA_MIN = 0.75, LAMBDA_MAX = 5.0;
export const DETECTOR_RANGES = [[1, 0.75, 1.09], [2, 1.10, 1.62], [3, 1.63, 2.41], [4, 2.42, 3.82], [5, 3.83, 4.41], [6, 4.42, 5.00]];
const W = 340, H = 180, X0 = 46, X1 = 332, Y0 = 18, Y1 = 150;

/** Can this flagged source's spectrum be measured at one spot across the survey? Movers sit somewhere else in every
 *  exposure, so only stars that changed brightness, Gaia stars with a proper motion (passed on), and new sources qualify. */
export function fixedSource(r) {
  if (!r) return false;
  if (r.kind === 'var') return true;
  if (r.kind === 'known') return !!(r.obj && r.obj.kind === 'star');
  if (r.kind === 'cand') return !r.from;
  return false;
}

const isDetection = p => Number.isFinite(p.flux) && Number.isFinite(p.err) && p.flux > 2 * p.err;

/**
 * The plot's layout, exported for tests: {log, y0, y1} in plot units (log10 µJy when log), and which points are upper
 * limits (below 2σ: drawn at 2σ). A log axis when the detections span more than 30×, so deep absorption stays visible.
 */
export function spectrumScale(points) {
  const pts = (points || []).filter(p => Number.isFinite(p.lambda) && Number.isFinite(p.flux) && Number.isFinite(p.err));
  const det = pts.filter(isDetection), lim = pts.filter(p => !isDetection(p));
  if (!det.length) {
    const hi = Math.max(1, ...pts.map(p => Math.max(p.flux + p.err, 2 * p.err)));
    return { log: false, y0: Math.min(0, ...pts.map(p => p.flux - p.err)), y1: hi * 1.08, limits: new Set(lim) };
  }
  const fmin = Math.min(...det.map(p => p.flux)), fmax = Math.max(...det.map(p => p.flux));
  if (fmax / fmin > 30) {
    const lo = Math.min(fmin, ...det.map(p => Math.max(p.flux - p.err, fmin / 3)), ...lim.map(p => 2 * p.err).filter(v => v > 0));
    const hi = Math.max(...det.map(p => p.flux + p.err));
    return { log: true, y0: Math.log10(lo) - 0.08, y1: Math.log10(hi) + 0.08, limits: new Set(lim) };
  }
  const lo = Math.min(0, ...pts.map(p => p.flux - p.err)), hi = Math.max(...pts.map(p => p.flux + p.err));
  return { log: false, y0: lo, y1: lo + (hi - lo) * 1.08, limits: new Set() }; // linear: every point with its error bar, even below 2σ
}

/** 1234 → "1.2k", 25000 → "25k", 2e6 → "2M": tick labels that fit the margin. */
export const compact = v => { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? s + +(a / 1e6).toPrecision(2) + 'M' : a >= 1e3 ? s + +(a / 1e3).toPrecision(2) + 'k' : s + +a.toPrecision(2); };

function ticks(sc) {
  if (sc.log) {
    const out = [];
    for (let k = Math.ceil(sc.y0); k <= Math.floor(sc.y1); k++) out.push(k);
    if (out.length < 2) for (const k of [Math.floor(sc.y0), Math.floor(sc.y1)]) for (const m of [2, 5]) { const v = k + Math.log10(m); if (v > sc.y0 && v < sc.y1 && !out.includes(v)) out.push(v); }
    return out.sort((a, b) => a - b).map(v => ({ v, label: compact(10 ** v) }));
  }
  const span = sc.y1 - sc.y0, raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw || 1)), step = [1, 2, 5, 10].map(m => m * mag).find(s => span / s <= 5) || 10 * mag;
  const out = []; for (let v = Math.ceil(sc.y0 / step) * step; v <= sc.y1 + 1e-9; v += step) out.push({ v, label: compact(+v.toPrecision(6)) });
  return out;
}

/** The plot as SVG markup (numbers only: nothing from the data is inserted as text but numbers and detector digits). */
export function spectrumSVG(points) {
  const pts = (points || []).filter(p => Number.isFinite(p.lambda) && Number.isFinite(p.flux) && Number.isFinite(p.err));
  const sc = spectrumScale(pts), f = n => (Math.round(n * 10) / 10).toString();
  const X = l => X0 + (Math.min(Math.max(l, LAMBDA_MIN), LAMBDA_MAX) - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN) * (X1 - X0);
  const Yv = v => Y1 - (v - sc.y0) / ((sc.y1 - sc.y0) || 1) * (Y1 - Y0);
  const Y = flux => sc.log ? Yv(Math.log10(Math.max(flux, 10 ** sc.y0))) : Yv(flux);
  let s = '';
  DETECTOR_RANGES.forEach(([d, a, b], i) => { // the six detectors as alternating bands, labelled at the top
    if (i % 2 === 0) s += `<rect class="band" x="${f(X(a))}" y="${Y0}" width="${f(X(b) - X(a))}" height="${Y1 - Y0}"/>`;
    s += `<text class="det" x="${f((X(a) + X(b)) / 2)}" y="${Y0 - 5}" text-anchor="middle">D${d}</text>`;
  });
  for (const t of ticks(sc)) { const y = Yv(t.v); if (y < Y0 - 0.5 || y > Y1 + 0.5) continue; s += `<line class="grid" x1="${X0}" y1="${f(y)}" x2="${X1}" y2="${f(y)}"/><text x="${X0 - 4}" y="${f(y + 3)}" text-anchor="end">${t.label}</text>`; }
  for (let l = 1; l <= 5; l++) s += `<line class="ax" x1="${f(X(l))}" y1="${Y1}" x2="${f(X(l))}" y2="${Y1 + 3}"/><text x="${f(X(l))}" y="${Y1 + 13}" text-anchor="middle">${l}</text>`;
  s += `<line class="ax" x1="${X0}" y1="${Y1}" x2="${X1}" y2="${Y1}"/><line class="ax" x1="${X0}" y1="${Y0}" x2="${X0}" y2="${Y1}"/>`;
  s += `<text x="${X1}" y="${H - 4}" text-anchor="end">µm</text><text x="4" y="${Y0 - 5}">µJy</text>`;
  for (const p of pts) {
    const x = f(X(p.lambda));
    if (sc.limits.has(p)) { const y = Y(2 * p.err); s += `<path class="ul" d="M${x} ${f(y + 3)} l-2.6 -4.5 h5.2 z"/>`; continue; } // below 2σ: an upper limit at 2σ
    const yv = Y(p.flux), ya = Y(p.flux + p.err), yb = sc.log ? Y(Math.max(p.flux - p.err, 10 ** sc.y0)) : Y(p.flux - p.err);
    s += `<line class="eb" x1="${x}" y1="${f(Math.max(Y0, ya))}" x2="${x}" y2="${f(Math.min(Y1, yb))}"/>`;
    s += `<circle class="pt${p.soft && p.soft.length ? ' soft' : ''}" cx="${x}" cy="${f(Math.min(Math.max(yv, Y0), Y1))}" r="2.2"/>`;
  }
  return s;
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const REASON = { saturated: 'saturated (too bright for SPHEREx there)', flagged: 'flagged (cosmic ray or bad pixel in the box)', edge: 'at the detector edge', outside: 'off the detector', sky: 'with too little clean sky around', failed: 'unreadable (IRSA errors)' };

/** A one-line summary for screen readers. */
export function spectrumSummary(s) {
  const det = (s.points || []).filter(isDetection);
  if (!s.points || !s.points.length) return 'Measured spectrum: no usable exposures';
  const peak = det.length ? det.reduce((a, b) => (b.flux > a.flux ? b : a)) : null;
  return `Measured SPHEREx spectrum: ${plural(s.points.length, 'point')} from ${s.points[0].lambda.toFixed(2)} to ${s.points[s.points.length - 1].lambda.toFixed(2)} µm` +
    (peak ? `, brightest at ${peak.lambda.toFixed(2)} µm (${compact(peak.flux)} µJy)` : ', nothing above 2σ');
}

/** The caption under the plot: what each point is, what was left out, and where the numbers came from. `where` is the position as text. */
export function spectrumCaption(s, where) {
  const n = (s.points || []).length, left = Object.entries(s.rejected || {}).filter(([, k]) => k > 0);
  const soft = (s.points || []).some(p => p.soft && p.soft.length);
  const parts = n === 0 ? [`None of the ${plural(s.nExposures || 0, 'SPHEREx exposure')}${where ? ` at ${where}` : ''} could be measured.`] : [
    `Measured from ${n} of ${plural(s.nExposures || n, 'SPHEREx exposure')}${where ? ` at ${where}` : ''}${s.pm ? `, following its proper motion (${(Math.hypot(s.pm.pmra, s.pm.pmdec) / 1000).toFixed(2)}″/yr)` : ''}.`,
    'Each point is the 5×5-pixel brightness above the local sky at the wavelength that exposure saw: relative, not calibrated photometry, with the pipeline’s noise as error bars; a triangle is an upper limit at 2σ. The box is 31″ across, so a neighbour within about 15″ adds its light.',
  ];
  if (left.length) parts.push(`Left out: ${left.map(([k, c]) => `${c} ${REASON[k] || k}`).join(', ')}.`);
  if (soft) parts.push('Open circles carry a soft SPHEREx flag (ghost, halo or persistence).');
  if (s.incomplete) parts.push('Some exposures could not be read; measuring again retries them.');
  if (s.source === 'saved') parts.push(`Saved ${s.builtAt ? String(s.builtAt).slice(0, 10) : 'earlier'} for the hosted copy; run the data server to measure any position.`);
  return parts.join(' ');
}

const cell = v => { const t = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(t) ? "'" + t : t; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
/** The spectrum as CSV, with a commented header saying what the numbers are. Text cells are defused against spreadsheet formulas. */
export function spectrumCSV(s) {
  const head = [
    '# Planet X: measured SPHEREx spectrum',
    `# position RA ${(+s.ra).toFixed(5)} deg, Dec ${(+s.dec).toFixed(5)} deg${s.pm ? `, proper motion ${s.pm.pmra}/${s.pm.pmdec} mas/yr from MJD ${s.pm.epoch}` : ''}`,
    '# flux: 5x5-pixel sum above the local sky, uJy with the nominal 6.15 arcsec pixel; relative, not calibrated photometry; err: sky noise only',
    `# exposures: ${s.nExposures ?? ''} searched, ${(s.points || []).length} measured${Object.keys(s.rejected || {}).length ? '; left out: ' + Object.entries(s.rejected).map(([k, c]) => `${k} ${c}`).join(', ') : ''}`,
    'lambda_um,bandwidth_um,flux_uJy,err_uJy,snr,detector,mjd,obs_id,collection,soft_flags',
  ];
  const rows = (s.points || []).map(p => [p.lambda, p.bw ?? '', p.flux, p.err, p.err > 0 ? +(p.flux / p.err).toFixed(1) : '', p.detector, p.mjd,
    cell(p.obsId), cell(p.collection), cell((p.soft || []).join(' '))].join(','));
  return head.concat(rows).join('\n') + '\n';
}
