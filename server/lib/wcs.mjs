// Celestial WCS (TAN, optionally with SIP distortion) and SPHEREx's spectral lookup-table WCS (alternate 'W').
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Build a TAN(-SIP) WCS from header key/values. Pixel coordinates are FITS 1-based. */
export function celestialWCS(kv) {
  const ct1 = String(kv.CTYPE1 || ''), ct2 = String(kv.CTYPE2 || '');
  if (!/TAN/.test(ct1) || !/TAN/.test(ct2)) throw new Error(`Unsupported projection ${ct1}/${ct2} (only TAN/TAN-SIP)`);
  let cd;
  if (kv.CD1_1 !== undefined) cd = [kv.CD1_1, kv.CD1_2 || 0, kv.CD2_1 || 0, kv.CD2_2];
  else {
    const c1 = kv.CDELT1 ?? 1, c2 = kv.CDELT2 ?? 1;
    let pc = [kv.PC1_1 ?? 1, kv.PC1_2 ?? 0, kv.PC2_1 ?? 0, kv.PC2_2 ?? 1];
    if (kv.PC1_1 === undefined && kv.CROTA2 !== undefined) { const r = kv.CROTA2 * D2R; pc = [Math.cos(r), -Math.sin(r) * c2 / c1, Math.sin(r) * c1 / c2, Math.cos(r)]; }
    cd = [c1 * pc[0], c1 * pc[1], c2 * pc[2], c2 * pc[3]];
  }
  const det = cd[0] * cd[3] - cd[1] * cd[2];
  const inv = [cd[3] / det, -cd[1] / det, -cd[2] / det, cd[0] / det];
  const sip = n => { const ord = kv[n + '_ORDER']; if (!ord) return null; const t = []; for (let p = 0; p <= ord; p++) for (let q = 0; q + p <= ord; q++) { const c = kv[`${n}_${p}_${q}`]; if (c) t.push([p, q, c]); } return t; };
  const poly = (t, u, v) => { let s = 0; for (const [p, q, c] of t) s += c * u ** p * v ** q; return s; };
  const hasSip = /SIP/.test(ct1);
  const A = hasSip ? sip('A') : null, B = hasSip ? sip('B') : null, AP = hasSip ? sip('AP') : null, BP = hasSip ? sip('BP') : null;
  const crpix = [kv.CRPIX1, kv.CRPIX2], a0 = kv.CRVAL1 * D2R, d0 = kv.CRVAL2 * D2R;
  if (hasSip && (!AP || !BP)) throw new Error('SIP header without inverse (AP/BP) coefficients');

  return {
    sip: hasSip,
    /** sky (deg) → pixel (1-based) */
    toPixel(ra, dec) {
      const a = ra * D2R, d = dec * D2R, da = a - a0;
      const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
      const xi = Math.cos(d) * Math.sin(da) / cosc * R2D;
      const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc * R2D;
      // Standard FITS TAN with LONPOLE=180: intermediate world (x, y) = (xi, eta).
      const U = inv[0] * xi + inv[1] * eta, V = inv[2] * xi + inv[3] * eta;
      const u = AP ? U + poly(AP, U, V) : U, v = BP ? V + poly(BP, U, V) : V;
      return [u + crpix[0], v + crpix[1]];
    },
    /** pixel (1-based) → sky (deg) */
    toSky(p1, p2) {
      const u = p1 - crpix[0], v = p2 - crpix[1];
      const U = A ? u + poly(A, u, v) : u, V = B ? v + poly(B, u, v) : v;
      const x = (cd[0] * U + cd[1] * V) * D2R, y = (cd[2] * U + cd[3] * V) * D2R;
      return tanInverse(x, y, a0, d0);
    },
  };
}

/** Inverse gnomonic: standard coordinates (radians, xi east-positive) about (a0, d0) radians → [ra, dec] deg. */
export function tanInverse(xi, eta, a0, d0) {
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return [((a0 * R2D) % 360 + 360) % 360, d0 * R2D];
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + eta * Math.sin(c) * Math.cos(d0) / rho);
  const ra = a0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c));
  return [((ra * R2D) % 360 + 360) % 360, dec * R2D];
}

/**
 * Output grid used for every epoch: TAN projection centred on (ra0, dec0), north up, east left,
 * `scale` arcsec/px, pixel (x right, y down) with the field centre at (N/2, N/2). Matches
 * app/js/pipeline/format.js `radec()` to first order (it is the small-field approximation of this).
 */
export function gridSky(ra0, dec0, scale, N, x, y) {
  const s = scale / 3600 * D2R;
  return tanInverse(-(x - N / 2) * s, -(y - N / 2) * s, ra0 * D2R, dec0 * D2R);
}
export function gridPixel(ra0, dec0, scale, N, ra, dec) {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R, da = a - a0;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  const xi = Math.cos(d) * Math.sin(da) / cosc, eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc;
  const s = scale / 3600 * D2R;
  return [N / 2 - xi / s, N / 2 - eta / s];
}

/**
 * SPHEREx spectral WCS: alternate WCS 'W' with CTYPE1W/2W = 'WAVE-TAB' and a bilinear lookup table in the
 * WCS-WAVE binary table (columns X, Y = control points in raw detector pixels, VALUES(2,9,9) = [wavelength, bandwidth]).
 * Returns (p1, p2) → {wave, bw} in µm, or null if the header has no such WCS.
 */
export function spectralWCS(kv, table) {
  if (!/TAB/.test(String(kv.CTYPE1W || '')) || !table) return null;
  const X = table.X, Y = table.Y, V = table.VALUES;
  const nx = X.length, ny = Y.length, nv = V.length / (nx * ny);
  const psi = (p, i) => (kv[`CRVAL${i}W`] ?? 0) + (kv[`CDELT${i}W`] ?? 1) * (p - (kv[`CRPIX${i}W`] ?? 0));
  const idx = (arr, v) => { // fractional index into a monotonic control-point vector (clamped)
    if (v <= arr[0]) return 0; if (v >= arr[arr.length - 1]) return arr.length - 1;
    let k = 0; while (arr[k + 1] < v) k++; return k + (v - arr[k]) / (arr[k + 1] - arr[k]);
  };
  const at = (fx, fy, comp) => {
    const i0 = Math.min(Math.floor(fx), nx - 2), j0 = Math.min(Math.floor(fy), ny - 2), tx = fx - i0, ty = fy - j0;
    const g = (i, j) => V[comp + nv * (i + nx * j)];
    return (1 - tx) * (1 - ty) * g(i0, j0) + tx * (1 - ty) * g(i0 + 1, j0) + (1 - tx) * ty * g(i0, j0 + 1) + tx * ty * g(i0 + 1, j0 + 1);
  };
  return (p1, p2) => {
    const fx = idx(X, psi(p1, 1)), fy = idx(Y, psi(p2, 2));
    return { wave: at(fx, fy, (kv.PV1_3W ?? 1) - 1), bw: at(fx, fy, (kv.PV2_3W ?? 2) - 1), detX: psi(p1, 1), detY: psi(p2, 2) };
  };
}
