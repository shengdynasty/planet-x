// Candidate report model. Pure: no DOM, importable from Node.
//   buildReport(result, field, opts) → core   what a link stores (schema.js), read from the Field view's own outputs
//   derive(core)                     → view   everything shown or exported, recomputed from the core on every load
// Nothing here re-runs detection: `result` is one entry of pipeline analyse(field, A, B), exactly as the Field view
// lists it, and the measurements are its own centroids plus an aperture sum around them.
import { radec, fmtRA, fmtDec, apFlux } from '../pipeline/index.js';
import { REPORT_VERSION, APP_VERSION, STATUS, validate } from './schema.js';
import { linearFit, predict, distanceFan, elongation, isoToMjd, mjdToIso, sepArcsec, FAN_DISTANCES } from './predict.js';

/** The simulation has no calendar: its epochs are days from 0, placed on this nominal date (2025-05-15) and labelled so. */
export const SIM_T0_MJD = 60810;
/** Cross-match search radius, arcsec. */
export const XM_RADIUS = 30;
/** Centroid precision floor, pixels (sub-pixel sampling and WCS residuals). */
export const ERR_FLOOR_PX = 0.1;
export const FOLLOW_DAYS = 30;
/** Elongation from the Sun above which a target is treated as observable at night (rough; not an observatory planner). */
export const MIN_ELONGATION = 60;

export const KIND_LABEL = { cand: 'Mover / new source', known: 'Known object', var: 'Variable', art: 'Artifact', left: 'Vanished source' };
const round = (v, d) => v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

/** 'PX J044140.8+191048' from a position (degrees): sexagesimal, truncated, like an IAU-style designation. */
export function designation(ra, dec) {
  const t = Math.floor((((ra % 360) + 360) % 360) / 15 * 36000), h = Math.floor(t / 36000), m = Math.floor(t % 36000 / 600), s = (t % 600) / 10;
  const a = Math.floor(Math.abs(dec) * 3600), dd = Math.floor(a / 3600), dm = Math.floor(a % 3600 / 60), ds = a % 60;
  const p = n => String(n).padStart(2, '0');
  return `PX J${p(h)}${p(m)}${s.toFixed(1).padStart(4, '0')}${dec < 0 ? '-' : '+'}${p(dd)}${p(dm)}${p(ds)}`;
}

/** Names of the flags set at a pixel: [all (minus SOURCE), hard ones]. */
function flagsAt(field, i, x, y) {
  if (typeof field.flags !== 'function' || !field.flagBits || !field.flagBits.names) return [[], []];
  const fl = field.flags(i), N = field.N, px = Math.round(x), py = Math.round(y);
  if (!fl || px < 0 || py < 0 || px >= N || py >= N) return [[], []];
  const v = fl[py * N + px], on = Object.entries(field.flagBits.names).filter(([n, b]) => n !== 'SOURCE' && ((v >>> b) & 1)).map(([n]) => n);
  return [on, on.filter(n => (field.flagBits.hard || []).includes(n))];
}

/**
 * @param {{kind:string, title:string, detail:string, x:number, y:number, from?:object, to?:object, obj?:object, star?:object}} r
 *   one analyse() result, as the Field view shows it
 * @param {import('../core/types.js').Field} field
 * @param {{A:number, B:number, mode?:'sim'|'snapshot'|'live', generatedAt?:string, psfSigma?:number}} opts
 * @returns {object} the core report (validated)
 */
export function buildReport(r, field, opts) {
  const { A, B } = opts, E = field.epochs, sim = !!field.simulated;
  const mode = sim ? 'sim' : (opts.mode === 'live' || opts.mode === 'snapshot' ? opts.mode : field.snapshot ? 'snapshot' : 'live');
  const nominal = !E.every(e => Number.isFinite(e.mjd));
  const mjdOf = i => Number.isFinite(E[i].mjd) ? E[i].mjd : SIM_T0_MJD + E[i].t;
  const psf = Number.isFinite(opts.psfSigma) ? opts.psfSigma : Number.isFinite(field.psfSigmaPx) ? field.psfSigmaPx : 1;
  const pxArea = (field.scale / 206264.806) ** 2;                  // sr per pixel
  const jy = !sim && /^\s*MJy\s*\/\s*sr\s*$/i.test(field.bunit || 'MJy/sr');      // aperture sums in MJy/sr·px → Jy only for real frames
  const pts = [];
  if (r.from) pts.push({ i: A, role: 'ref', p: r.from });
  if (r.to) pts.push({ i: B, role: 'cmp', p: r.to });
  if (!pts.length) pts.push({ i: B, role: 'cmp', p: r });
  pts.sort((a, b) => mjdOf(a.i) - mjdOf(b.i));
  const ep = pts.map(({ i, role, p }) => {
    const [ra, dec] = radec(field, p.x, p.y), e = E[i];
    const snr = Number.isFinite(p.peak) && p.sig > 0 ? p.peak / p.sig : null;
    const errPx = Math.max(ERR_FLOOR_PX, snr ? psf / snr : psf);
    let flux = null, fluxErr = null;
    try { const F = apFlux(field.frame(i), p.x, p.y); if (Number.isFinite(F.flux)) { const k = jy ? 1e6 * pxArea : 1; flux = F.flux * k; fluxErr = F.noise * k; } } catch { /* edge of frame */ }
    const [flags, hard] = flagsAt(field, i, p.x, p.y);
    return {
      i, role, mjd: round(mjdOf(i), 5), band: round(e.band, 4), lambda: round(e.lambda, 4), obs: e.obsId ? String(e.obsId).slice(0, 60) : null,
      x: round(p.x, 2), y: round(p.y, 2), ra: round(ra, 6), dec: round(dec, 6), err: round(errPx * field.scale, 2),
      peak: round(p.peak ?? 0, 4), sig: round(p.sig ?? 0, 4), flux: round(flux, jy ? 9 : 4), fluxErr: round(fluxErr, jy ? 9 : 4), flags, hard,
    };
  });
  // cross-match at the last epoch: nearest Gaia star and every known object (JPL / Gaia proper motion) within the radius
  const last = pts.at(-1), tl = E[last.i].t, lp = last.p, R = XM_RADIUS / field.scale;
  let gaia = null;
  for (const s of field.stars || []) { const q = s.pos(tl); if (!q) continue; const d = Math.hypot(q[0] - lp.x, q[1] - lp.y); if (d <= R && (!gaia || d < gaia.d)) gaia = { s, d }; }
  const known = [];
  for (const k of field.known || []) { const q = k.pos(tl); if (!q || q[0] < -100) continue; const d = Math.hypot(q[0] - lp.x, q[1] - lp.y); if (d <= R) known.push({ k, d }); }
  known.sort((a, b) => a.d - b.d);
  const [lra, ldec] = radec(field, lp.x, lp.y);
  const req = field.request && Number.isFinite(field.request.ra) ? field.request : null;
  const core = {
    v: REPORT_VERSION, app: APP_VERSION, gen: opts.generatedAt || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    id: designation(lra, ldec), kind: r.kind, title: String(r.title).slice(0, 120), detail: String(r.detail).slice(0, 400),
    data: {
      mode, sim, snap: field.snapshot ? String(field.snapshot.id).slice(0, 40) : null, nominal,
      ra0: round(field.ra0, 6), dec0: round(field.dec0, 6), N: field.N, scale: round(field.scale, 4), psf: round(psf, 3),
      unit: jy ? 'Jy' : sim ? 'sim units' : String(field.bunit || 'MJy/sr').slice(0, 20),
      req: req ? { ra: round(req.ra, 6), dec: round(req.dec, 6), size: req.sizeArcsec ?? null, det: req.det ?? null, t: Number.isFinite(req.t) ? round(req.t, 5) : null } : null,
    },
    pair: [A, B], ep,
    xm: {
      radius: XM_RADIUS, match: r.kind === 'known' && r.obj ? String(r.obj.name).slice(0, 120) : null,
      gaia: gaia ? { name: String(gaia.s.name).slice(0, 80), g: round(gaia.s.g, 2), sep: round(gaia.d * field.scale, 1) } : null,
      known: known.slice(0, 12).map(({ k, d }) => ({ name: String(k.name).slice(0, 120), kind: k.kind || 'sb', src: String(k.source || (sim ? 'simulated ephemeris' : 'JPL')).slice(0, 80), sep: round(d * field.scale, 1), mag: Number.isFinite(k.vmag) ? k.vmag : null })),
    },
  };
  return validate(core);
}

/** AB magnitude of a flux density in Jy. */
export const abMag = jy => jy > 0 ? 8.90 - 2.5 * Math.log10(jy) : null;

/**
 * Everything the page and the exports show, from a (validated) core report. Deterministic: "now" is the report's
 * generation time, so a link shows the same predictions whenever it is opened.
 */
export function derive(core) {
  const ep = core.ep, gen = isoToMjd(core.gen), first = ep[0], last = ep.at(-1);
  const fit = linearFit(ep);
  const shift = ep.length > 1 ? sepArcsec(first.ra, first.dec, last.ra, last.dec) : null;
  const snr = Math.max(...ep.map(e => e.sig > 0 ? e.peak / e.sig : 0));
  const motion = fit.moving
    ? { rateDay: fit.rate, rateHr: fit.rate / 24, rateYr: fit.rate * 365.25, pa: fit.pa, shift, span: fit.span, snr, rateErrDay: Math.sqrt(fit.varV) }
    : { rateDay: null, rateHr: null, rateYr: null, pa: null, shift: null, span: 0, snr, rateErrDay: null };
  // follow-up window: the next FOLLOW_DAYS nights from the report date, at 0h UTC
  const d0 = Math.ceil(gen), nights = Array.from({ length: FOLLOW_DAYS }, (_, k) => d0 + k);
  const eph = predict(fit, nights).map(p => ({ ...p, elong: elongation(p.ra, p.dec, p.mjd) }));
  const at = (mjd) => predict(fit, [mjd])[0] || null;
  const now = at(gen), end = at(d0 + FOLLOW_DAYS - 1);
  const obsNights = (eph.length ? eph : nights.map(mjd => ({ mjd, elong: elongation(last.ra, last.dec, mjd) }))).filter(p => p.elong >= MIN_ELONGATION);
  const fan = distanceFan(last.ra, last.dec, last.mjd, [gen, d0 + FOLLOW_DAYS - 1], FAN_DISTANCES);
  const fluxEp = [...ep].reverse().find(e => Number.isFinite(e.flux) && e.flux > 0);
  const mag = core.data.unit === 'Jy' && fluxEp ? abMag(fluxEp.flux) : null;
  return {
    core, status: STATUS, kindLabel: KIND_LABEL[core.kind] || core.kind, simulated: core.data.sim, fit, motion, eph, now, end, fan,
    followup: {
      from: mjdToIso(d0).slice(0, 10), to: mjdToIso(d0 + FOLLOW_DAYS - 1).slice(0, 10), now, end,
      observable: obsNights.length, firstObs: obsNights.length ? mjdToIso(obsNights[0].mjd).slice(0, 10) : null,
      lastObs: obsNights.length ? mjdToIso(obsNights.at(-1).mjd).slice(0, 10) : null,
      elongNow: elongation((now || last).ra, (now || last).dec, gen),
      band: `near-infrared, ${fluxEp ? (fluxEp.lambda ?? fluxEp.band) : last.lambda ?? last.band} µm (the SPHEREx band it was flagged in)`,
      mag, magBand: fluxEp ? (fluxEp.lambda ?? fluxEp.band) : null,
    },
    orbit: 'Arc too short for an orbit fit',
    fmt: { ra: fmtRA, dec: fmtDec, iso: mjdToIso },
  };
}
