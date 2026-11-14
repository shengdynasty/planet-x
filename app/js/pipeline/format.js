// Formatting, coordinates and model spectra (pure).

/** Time baseline in days → '2.4 min' | '10.1 h' | '1.0 d' | '183 d'. */
export function fmtDt(dt) { return dt < 0.04 ? `${(dt * 1440).toFixed(1)} min` : dt < 0.9 ? `${(dt * 24).toFixed(1)} h` : `${dt.toFixed(dt < 10 ? 1 : 0)} d`; }
/** Rate in arcsec/day, unit chosen to match fmtDt(dt). */
export function fmtRate(r, dt) { return dt < 0.9 ? `${(r / 24).toFixed(1)}″/h` : dt < 30 ? `${r.toFixed(1)}″/day` : `${(r * 365.25 / 3600).toFixed(2)}°/yr`; }

const D2R = Math.PI / 180;
/** Pixel (x right, y down) → [ra, dec] in degrees. Exact TAN (gnomonic) projection centred on (ra0, dec0), north up,
 *  east left, field centre at (N/2, N/2): the same grid as server/lib/wcs.mjs gridSky (ISS-15: the old first-order
 *  version was off by up to ~0.4″·tan(Dec) at the corners of a 600″ field). RA is returned in [0, 360). */
export function radec(field, x, y) {
  const { N, scale, ra0, dec0 } = field;
  const s = scale / 3600 * D2R, xi = -(x - N / 2) * s, eta = -(y - N / 2) * s, rho = Math.hypot(xi, eta);
  if (rho === 0) return [ra0, dec0];
  const d0 = dec0 * D2R, c = Math.atan(rho), sc = Math.sin(c), cc = Math.cos(c);
  const dec = Math.asin(cc * Math.sin(d0) + eta * sc * Math.cos(d0) / rho);
  const ra = ra0 * D2R + Math.atan2(xi * sc, rho * Math.cos(d0) * cc - eta * Math.sin(d0) * sc);
  return [(((ra / D2R) % 360) + 360) % 360, dec / D2R];
}
/** Inverse of radec (exact TAN). Safe across RA 0h/360° (uses sin/cos of the RA difference, not a subtraction). */
export function pixel(field, ra, dec) {
  const { N, scale, ra0, dec0 } = field;
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R, da = a - a0;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  const xi = Math.cos(d) * Math.sin(da) / cosc, eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc;
  const s = scale / 3600 * D2R;
  return [N / 2 - xi / s, N / 2 - eta / s];
}

/** RA in degrees → "04h 41m 40.8s". Rounds to the printed precision first, so it never prints "60.0s". */
export function fmtRA(ra) {
  const day = 24 * 3600 * 10;                                               // tenths of a second in 24 h
  const t = Math.round((((ra % 360) + 360) % 360) / 15 * 3600 * 10) % day;
  const hh = Math.floor(t / 36000), mm = Math.floor(t % 36000 / 600), s = (t % 600) / 10;
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
}
/** Dec in degrees → "+19° 10′ 48″". Rounds to whole arcseconds first, so it never prints "60″" and never "−0°". */
export function fmtDec(d) {
  const t = Math.round(Math.abs(d) * 3600), sg = d < 0 && t > 0 ? '−' : '+';
  const dd = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), s = t % 60;
  return `${sg}${dd}° ${String(mm).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

/** ILLUSTRATIVE model shape across the 102 SPHEREx bands (0.75–5 µm), invented for the simulation. Not measured data and never shown for real fields. kind: 'asteroid' | 'ice' | 'star'. → [[µm, value], …] */
export function spectrum(kind) { const pts = []; for (let i = 0; i < 102; i++) { const l = 0.75 + i * (4.25 / 101); let v;
  if (kind === 'asteroid') v = 1 + 0.25 * (l - 0.95) + (l > 3 ? 0.9 * (l - 3) ** 1.5 : 0);
  else if (kind === 'ice') { v = 1.1 - 0.05 * l; for (const [c, w, d] of [[1.5, 0.07, 0.35], [2.0, 0.08, 0.5], [3.05, 0.2, 0.85]]) v *= 1 - d * Math.exp(-((l - c) ** 2) / (2 * w * w)); }
  else v = Math.exp(-0.5 * (l - 0.95)) * 1.3;
  pts.push([l, v]); } return pts; }
