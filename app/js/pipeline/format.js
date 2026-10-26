// Formatting, coordinates and model spectra (pure).

/** Time baseline in days → '2.4 min' | '10.1 h' | '1.0 d' | '183 d'. */
export function fmtDt(dt) { return dt < 0.04 ? `${(dt * 1440).toFixed(1)} min` : dt < 0.9 ? `${(dt * 24).toFixed(1)} h` : `${dt.toFixed(dt < 10 ? 1 : 0)} d`; }
/** Rate in arcsec/day, unit chosen to match fmtDt(dt). */
export function fmtRate(r, dt) { return dt < 0.9 ? `${(r / 24).toFixed(1)}″/h` : dt < 30 ? `${r.toFixed(1)}″/day` : `${(r * 365.25 / 3600).toFixed(2)}°/yr`; }

/** Pixel (x right, y down) → [ra, dec] in degrees (tangent-plane approximation, RA increasing to the left). */
export function radec(field, x, y) {
  const { N, scale, ra0, dec0 } = field;
  const ra = ra0 - (x - N / 2) * scale / 3600 / Math.cos(dec0 * Math.PI / 180);
  const dec = dec0 - (y - N / 2) * scale / 3600;
  return [ra, dec];
}
/** Inverse of radec. */
export function pixel(field, ra, dec) {
  const { N, scale, ra0, dec0 } = field;
  return [N / 2 - (ra - ra0) * 3600 / scale * Math.cos(dec0 * Math.PI / 180), N / 2 - (dec - dec0) * 3600 / scale];
}

export function fmtRA(ra) { ra = ((ra % 360) + 360) % 360; const h = ra / 15, hh = h | 0, m = (h - hh) * 60, mm = m | 0, s = (m - mm) * 60; return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`; }
export function fmtDec(d) { const sg = d < 0 ? '−' : '+', a = Math.abs(d), dd = a | 0, m = (a - dd) * 60, mm = m | 0, s = (m - mm) * 60; return `${sg}${dd}° ${String(mm).padStart(2, '0')}′ ${s.toFixed(0).padStart(2, '0')}″`; }

/** Model spectrum across the 102 SPHEREx bands (0.75–5 µm). kind: 'asteroid' | 'ice' | 'star'. → [[µm, value], …] */
export function spectrum(kind) { const pts = []; for (let i = 0; i < 102; i++) { const l = 0.75 + i * (4.25 / 101); let v;
  if (kind === 'asteroid') v = 1 + 0.25 * (l - 0.95) + (l > 3 ? 0.9 * (l - 3) ** 1.5 : 0);
  else if (kind === 'ice') { v = 1.1 - 0.05 * l; for (const [c, w, d] of [[1.5, 0.07, 0.35], [2.0, 0.08, 0.5], [3.05, 0.2, 0.85]]) v *= 1 - d * Math.exp(-((l - c) ** 2) / (2 * w * w)); }
  else v = Math.exp(-0.5 * (l - 0.95)) * 1.3;
  pts.push([l, v]); } return pts; }
