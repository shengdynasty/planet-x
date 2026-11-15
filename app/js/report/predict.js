// Motion and prediction for the candidate report. Pure: no DOM, importable from Node.
//
// Everything is worked out on the tangent plane at the fit's mean position (ξ east, η north, arcsec), so RA wrap at 0h
// and high declinations need no special cases. Three levels of prediction, each saying what it assumes:
//   linearFit / predict   straight-line motion on the sky; the uncertainty comes from the fit covariance and so grows
//                         linearly with time away from the epochs.
//   distanceFan           ILLUSTRATIVE: where the source would be if it were on a circular orbit at an assumed
//                         heliocentric distance (parallax from Earth's motion plus orbital motion).
//   (orbit fit)           not implemented: two or three epochs from one survey are too short an arc.

const D2R = Math.PI / 180, R2D = 180 / Math.PI, AS = 3600;
export const MJD_J2000 = 51544.5;
const K_GAUSS = 0.01720209895;          // AU^1.5 / day: circular speed at r AU is K / sqrt(r) AU/day

/** UTC ISO string → MJD. */
export const isoToMjd = iso => Date.parse(iso) / 86400000 + 40587;
/** MJD → '2026-02-16T03:06:40Z' (to the second). */
export function mjdToIso(mjd) { return new Date(Math.round((mjd - 40587) * 86400) * 1000).toISOString().replace('.000Z', 'Z'); }

/** Gnomonic offsets of (ra, dec) from the tangent point (ra0, dec0), arcsec: [ξ east, η north]. */
export function toPlane(ra, dec, ra0, dec0) {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R, da = a - a0;
  const c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  return [Math.cos(d) * Math.sin(da) / c * R2D * AS, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / c * R2D * AS];
}
/** Inverse of toPlane: [ra (0–360), dec] in degrees. */
export function fromPlane(xi, eta, ra0, dec0) {
  const x = xi / AS * D2R, y = eta / AS * D2R, d0 = dec0 * D2R, rho = Math.hypot(x, y);
  if (rho === 0) return [ra0, dec0];
  const c = Math.atan(rho), sc = Math.sin(c), cc = Math.cos(c);
  const dec = Math.asin(cc * Math.sin(d0) + y * sc * Math.cos(d0) / rho);
  const ra = ra0 * D2R + Math.atan2(x * sc, rho * Math.cos(d0) * cc - y * Math.sin(d0) * sc);
  return [(((ra * R2D) % 360) + 360) % 360, dec * R2D];
}
/** Angular separation, arcsec. */
export function sepArcsec(ra1, dec1, ra2, dec2) {
  const dRa = (ra2 - ra1) * D2R, dDe = (dec2 - dec1) * D2R;
  const a = Math.sin(dDe / 2) ** 2 + Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.sin(dRa / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * R2D * AS;
}
/** Position angle of a step (dξ east, dη north), degrees east of north, 0–360. */
export const paOf = (dx, dy) => ((Math.atan2(dx, dy) * R2D) + 360) % 360;

/** Mean of positions on the sphere (unit vectors), so a set straddling RA 0h averages correctly. */
function meanPos(eps) {
  let x = 0, y = 0, z = 0;
  for (const e of eps) { const a = e.ra * D2R, d = e.dec * D2R; x += Math.cos(d) * Math.cos(a); y += Math.cos(d) * Math.sin(a); z += Math.sin(d); }
  return [(((Math.atan2(y, x) * R2D) % 360) + 360) % 360, Math.atan2(z, Math.hypot(x, y)) * R2D];
}

/**
 * Weighted straight-line fit of position against time.
 * @param {Array<{mjd:number, ra:number, dec:number, err:number}>} epochs  err = 1σ position uncertainty, arcsec (per axis)
 * @returns {{n, ra0, dec0, tref, x0, y0, vx, vy, varX0, varV, rate, pa, span, moving}}
 *   x/y on the tangent plane at (ra0, dec0) in arcsec, v in arcsec/day; varX0 at tref and varV are per axis (the
 *   epochs' errors are circular, so both axes share them and the covariance between x0 and v is zero at tref).
 *   With one epoch there is no motion: rate is null and predictions are not possible.
 */
export function linearFit(epochs) {
  const eps = epochs.filter(e => [e.mjd, e.ra, e.dec].every(Number.isFinite));
  if (!eps.length) throw new Error('linearFit needs at least one epoch');
  const [ra0, dec0] = meanPos(eps);
  const w = eps.map(e => 1 / Math.max(e.err, 1e-3) ** 2), W = w.reduce((a, b) => a + b, 0);
  const tref = eps.reduce((s, e, i) => s + w[i] * e.mjd, 0) / W;
  const pts = eps.map(e => toPlane(e.ra, e.dec, ra0, dec0));
  const x0 = pts.reduce((s, p, i) => s + w[i] * p[0], 0) / W, y0 = pts.reduce((s, p, i) => s + w[i] * p[1], 0) / W;
  const Stt = eps.reduce((s, e, i) => s + w[i] * (e.mjd - tref) ** 2, 0);
  const span = Math.max(...eps.map(e => e.mjd)) - Math.min(...eps.map(e => e.mjd));
  const base = { n: eps.length, ra0, dec0, tref, x0, y0, varX0: 1 / W, span };
  if (eps.length < 2 || Stt <= 0) return { ...base, vx: 0, vy: 0, varV: Infinity, rate: null, pa: null, moving: false };
  const vx = eps.reduce((s, e, i) => s + w[i] * (e.mjd - tref) * (pts[i][0] - x0), 0) / Stt;
  const vy = eps.reduce((s, e, i) => s + w[i] * (e.mjd - tref) * (pts[i][1] - y0), 0) / Stt;
  return { ...base, vx, vy, varV: 1 / Stt, rate: Math.hypot(vx, vy), pa: paOf(vx, vy), moving: true };
}

/**
 * Linear-motion positions at the given MJDs, with the 1σ uncertainty ellipse from the fit covariance.
 * σ(t)² = var(x0) + (t − tref)² var(v): it grows linearly with time once the rate term dominates.
 * The epochs' errors are circular, so the ellipse is a circle; its PA is reported along the motion.
 * @returns {Array<{mjd, ra, dec, smaj, smin, pa}>}  smaj/smin in arcsec, pa in degrees E of N
 */
export function predict(fit, mjds) {
  if (!fit.moving) return [];
  return mjds.map(mjd => {
    const dt = mjd - fit.tref, [ra, dec] = fromPlane(fit.x0 + fit.vx * dt, fit.y0 + fit.vy * dt, fit.ra0, fit.dec0);
    const s = Math.sqrt(fit.varX0 + dt * dt * fit.varV);
    return { mjd, ra, dec, smaj: s, smin: s, pa: fit.pa };
  });
}

// ---------- Sun, elongation and the distance fan ----------
/** Low-precision Sun (Astronomical Almanac, ~0.01° over 1950–2050). Returns geocentric RA/Dec (deg), distance R (AU),
 *  the obliquity and the Sun's geocentric equatorial position vector (AU). */
export function sun(mjd) {
  const n = mjd - MJD_J2000, L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * n) * D2R;
  const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const v = [R * Math.cos(lam), R * Math.cos(eps) * Math.sin(lam), R * Math.sin(eps) * Math.sin(lam)];
  return { ra: ((Math.atan2(v[1], v[0]) * R2D) + 360) % 360, dec: Math.asin(v[2] / R) * R2D, R, eps, v };
}
/** Solar elongation of (ra, dec) at mjd, degrees. */
export const elongation = (ra, dec, mjd) => { const s = sun(mjd); return sepArcsec(ra, dec, s.ra, s.dec) / AS; };

const unit = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => a.map(x => x * k), add = (a, b) => a.map((x, i) => x + b[i]), norm = a => Math.hypot(...a);
const toRaDec = v => { const r = norm(v); return [((Math.atan2(v[1], v[0]) * R2D) + 360) % 360, Math.asin(v[2] / r) * R2D]; };

export const FAN_DISTANCES = [2, 5, 40, 300];
/**
 * ILLUSTRATIVE positions for assumed heliocentric distances. Assumptions: the object is where it was seen at mjd0, at
 * heliocentric distance r AU, on a circular, prograde orbit of the lowest inclination its position allows; observed from
 * the centre of the Earth (SPHEREx is in low Earth orbit); no light-time. Not an orbit fit.
 * @returns {Array<{r, ok, rate, pa, pts: Array<{mjd, ra, dec}>}>}  rate in arcsec/day at mjd0, from the model
 */
export function distanceFan(ra, dec, mjd0, mjds, distances = FAN_DISTANCES) {
  const earth = mjd => scale(sun(mjd).v, -1);
  const E0 = earth(mjd0), u = unit(ra, dec), eclN = (e => [0, -Math.sin(e), Math.cos(e)])(sun(mjd0).eps);
  return distances.map(r => {
    const b = dot(E0, u), disc = b * b - dot(E0, E0) + r * r;
    if (disc < 0) return { r, ok: false, rate: null, pa: null, pts: [] };
    const P0 = add(E0, scale(u, -b + Math.sqrt(disc))), rh = scale(P0, 1 / norm(P0));
    let h = add(eclN, scale(rh, -dot(eclN, rh))); if (norm(h) < 1e-9) h = [0, 0, 1]; h = scale(h, 1 / norm(h));
    const vh = cross(h, rh), w = K_GAUSS / r ** 1.5;            // angular rate, rad/day
    const at = mjd => { const th = w * (mjd - mjd0), P = scale(add(scale(rh, Math.cos(th)), scale(vh, Math.sin(th))), r); return toRaDec(add(P, scale(earth(mjd), -1))); };
    const [r1, d1] = at(mjd0 + 1), [px, py] = toPlane(r1, d1, ra, dec);
    return { r, ok: true, rate: Math.hypot(px, py), pa: paOf(px, py), pts: mjds.map(mjd => { const [a, d] = at(mjd); return { mjd, ra: a, dec: d }; }) };
  });
}
