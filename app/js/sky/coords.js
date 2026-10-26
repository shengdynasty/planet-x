// Pure sky-coordinate helpers (no DOM, no three.js) so they can be unit-tested from Node.
//
// World frame used by the sky: +Y = north celestial pole, RA 0h along +X, RA 6h along -Z
// (toXYZ below). The camera starts looking down -Z and is oriented with
// `camera.rotation.set(0,0,0); camera.rotateY(yaw); camera.rotateX(pitch)`, so its view direction is
// (-cos p sin y, sin p, -cos p cos y). Matching that to toXYZ gives yaw = ra - PI/2, pitch = dec.
// (The original UI demo used yaw = -ra + PI/2, which pointed the camera at the mirror RA.)

const PI = Math.PI;

/** Unit-sphere position (times r) for RA in hours, Dec in degrees. */
export function toXYZ(raH, decD, r = 1) {
  const ra = raH / 12 * PI, dec = decD * PI / 180;
  return [r * Math.cos(dec) * Math.cos(ra), r * Math.sin(dec), -r * Math.cos(dec) * Math.sin(ra)];
}

/** Camera yaw/pitch (radians) that centre the view on RA (h), Dec (deg). */
export function yawPitchFor(raH, decD) {
  return { yaw: raH / 12 * PI - PI / 2, pitch: decD * PI / 180 };
}

/** View direction for a yaw/pitch, same convention as the camera. */
export function dirFor(yaw, pitch) {
  return [-Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];
}

/** RA (h, 0..24) and Dec (deg) of a world direction. */
export function raDecOf([x, y, z]) {
  const raH = ((Math.atan2(-z, x) / PI * 12) % 24 + 24) % 24;
  return { raH, decD: Math.asin(Math.max(-1, Math.min(1, y))) * 180 / PI };
}

/** Shortest-path target: shift `target` by whole turns so it is within PI of `from`. */
export function unwrap(target, from) {
  while (target - from > PI) target -= 2 * PI;
  while (from - target > PI) target += 2 * PI;
  return target;
}

/** Angular separation in degrees between two RA(h)/Dec(deg) positions. */
export function sepDeg(ra1, dec1, ra2, dec2) {
  const a = toXYZ(ra1, dec1), b = toXYZ(ra2, dec2);
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d) * 180 / PI;
}

export const pad2 = n => String(n).padStart(2, '0');

export function fmtRA(h) {
  h = ((h % 24) + 24) % 24;
  let H = Math.floor(h), m = Math.round((h - H) * 60);
  if (m === 60) { m = 0; H = (H + 1) % 24; }
  return `${H}h ${pad2(m)}m`;
}

export const fmtDec = d => {
  const r = Math.round(d * 10) / 10; // round first, so -0.04 reads "+0.0°", never "−0.0°"
  return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(1)}°`;
};

/** Total shift of a track [[raH, decD], ...] as display text, e.g. "18.4′ over 3 scans". */
export function shiftText(pos) {
  if (!pos || !pos.length) return '—';
  const a = pos[0], b = pos[pos.length - 1];
  const sh = sepDeg(a[0], a[1], b[0], b[1]);
  return (sh < 1 ? `${(sh * 60).toFixed(1)}′` : `${sh.toFixed(2)}°`) + ` over ${pos.length} scan${pos.length === 1 ? '' : 's'}`;
}

const SIGN = '[+\\-−–]'; // ASCII plus, ASCII hyphen-minus, Unicode minus, en dash (no range!)

/** RA token → hours. Accepts "16h06m", "16h", "16:06", "16.1" (hours, ≤ 24) or "241.5" (degrees, > 24) or "241.5d". */
export function parseRA(s) {
  s = s.trim();
  let m = s.match(/^(\d+(?:\.\d+)?)h(?:\s*(\d+(?:\.\d+)?)m?)?(?:\s*(\d+(?:\.\d+)?)s?)?$/i);
  if (m) return norm(+m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600);
  m = s.match(/^(\d+):(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/);
  if (m) return norm(+m[1] + +m[2] / 60 + (+m[3] || 0) / 3600);
  m = s.match(/^(\d+(?:\.\d+)?)(d|°)$/i);
  if (m) return norm(+m[1] / 15);
  m = s.match(/^\d+(?:\.\d+)?$/);
  if (m) { const v = +s; return v > 24 ? norm(v / 15) : (v === 24 ? 0 : v); }
  return null;
  function norm(h) { return h > 360 / 15 ? null : ((h % 24) + 24) % 24; }
}

/** Dec token → degrees. Accepts "+41", "-12.5", "−47", "+41d12m", "41°12′", "41:12". */
export function parseDec(s) {
  s = s.trim();
  const m = s.match(new RegExp(`^(${SIGN}?)\\s*(\\d+(?:\\.\\d+)?)(?:\\s*(?:d|°|:)\\s*(?:(\\d+(?:\\.\\d+)?)\\s*(?:m|′|')?)?)?$`, 'i'));
  if (!m) return null;
  const v = +m[2] + (+m[3] || 0) / 60;
  if (v > 90) return null;
  return m[1] && m[1] !== '+' ? -v : v;
}

/**
 * Parse the go-to box. Returns {kind:'candidate', n} (1-based), {kind:'pos', raH, decD}, or null.
 * "candidate 3", "cand 3", "c3", "c03", "3", "#3" → candidate 3.
 */
export function parseGoto(q) {
  q = (q || '').trim();
  if (!q) return null;
  const c = q.match(/^(?:candidate|cand|c|#)?\s*0*(\d{1,3})$/i);
  if (c) return { kind: 'candidate', n: +c[1] };
  // split on comma, or on whitespace between the two coordinates; keep "16h 06m" together
  let parts = q.split(/\s*,\s*/);
  if (parts.length !== 2) {
    const m = q.match(/^(.+?)\s+([+\-−–]?\d.*)$/);
    parts = m ? [m[1], m[2]] : [];
    // "16h 06m +41": first split lands inside the RA; retry from the sign
    const sm = q.match(/^(.+?)\s*([+\-−–]\s*\d.*)$/);
    if (sm && parseRA(sm[1]) !== null && parseDec(sm[2]) !== null) parts = [sm[1], sm[2]];
  }
  if (parts.length !== 2) return null;
  const raH = parseRA(parts[0]), decD = parseDec(parts[1]);
  if (raH === null || decD === null) return null;
  return { kind: 'pos', raH, decD };
}
