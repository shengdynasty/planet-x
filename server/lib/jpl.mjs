// Known asteroids and comets in a field at a given time: JPL SSD Small-Body Identification API (sb_ident v1.1).
// We use the first pass only (fast-ish: ~30-40 s per query uncached; the high-precision second pass took ~3 min).
import { fetchBuf } from './net.mjs';

export const SB_IDENT = 'https://ssd-api.jpl.nasa.gov/sb_ident.api';

const sexa = (v, hours) => {
  const neg = v < 0; let a = Math.abs(v) / (hours ? 15 : 1);
  const d = Math.floor(a); a = (a - d) * 60; const m = Math.floor(a); const s = (a - m) * 60;
  return `${neg ? 'M' : ''}${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${s.toFixed(2).padStart(5, '0')}`;
};
const parseSexa = (s, hours) => {
  const m = String(s).trim().match(/^([+-]?)(\d+)[:\s]+(\d+)[:'\s]+([\d.]+)/); if (!m) return NaN;
  const v = +m[2] + +m[3] / 60 + +m[4] / 3600; return (m[1] === '-' ? -v : v) * (hours ? 15 : 1);
};

/**
 * @param {{ra:number, dec:number, mjd:number, halfWidthArcsec:number, xobs?:number[]|null}} q
 *   xobs = observer position, geocentric km (ICRF). SPHEREx headers give the spacecraft position (X_SC/Y_SC/Z_SC);
 *   without it we fall back to the geocentre (fine for main-belt objects, a few arcsec off for near-Earth ones).
 * @returns {Promise<{objects:Array<{name, dRA, dDec, vmag, errRA, errDec, ra, dec}>, n:number, url:string, observer:string}>}
 */
export async function smallBodies(q) {
  const jd = (q.mjd + 2400000.5).toFixed(6);
  const hw = Math.max(q.halfWidthArcsec / 3600, 0.01);
  const p = new URLSearchParams({
    'obs-time': jd, 'fov-ra-center': sexa(q.ra, true), 'fov-dec-center': sexa(q.dec, false),
    'fov-ra-hwidth': (hw / Math.max(Math.cos(q.dec * Math.PI / 180), 0.05)).toFixed(4), 'fov-dec-hwidth': hw.toFixed(4),
    'mag-required': 'false', 'vmag-lim': String(q.vmagLim ?? 22), // SPHEREx single-exposure depth is ~V 19-20; the limit also roughly halves query time
  });
  let observer;
  if (q.xobs) { p.set('xobs', q.xobs.map(v => v.toFixed(3)).join(',')); observer = 'SPHEREx spacecraft (header X_SC/Y_SC/Z_SC)'; }
  else { p.set('xobs', '0,0,0'); observer = 'geocentre (no spacecraft position available)'; }
  const url = `${SB_IDENT}?${p}`;
  const buf = await fetchBuf(url, { ns: 'jpl', timeoutMs: 180000 });
  const j = JSON.parse(buf.toString('utf8'));
  if (j.error || j.code) throw new Error('JPL sb_ident: ' + (j.message || j.error || JSON.stringify(j).slice(0, 200)));
  const fields = j.fields_first || [], rows = j.data_first_pass || [];
  const col = name => fields.findIndex(f => f.startsWith(name));
  const iN = col('Object name'), iRA = col('Astrometric RA'), iDec = col('Astrometric Dec'), idRA = col('Dist. from center RA'),
    idDec = col('Dist. from center Dec'), iV = col('Visual magnitude'), ieRA = col('Est. error RA'), ieDec = col('Est. error Dec');
  const lim = q.halfWidthArcsec * 1.05;
  const objects = rows.map(r => ({
    name: r[iN], dRA: +r[idRA], dDec: +r[idDec], vmag: r[iV] === '' ? null : +r[iV],
    errRA: ieRA >= 0 ? +r[ieRA] : null, errDec: ieDec >= 0 ? +r[ieDec] : null,
    ra: parseSexa(r[iRA], true), dec: parseSexa(r[iDec], false),
  })).filter(o => Math.abs(o.dRA) <= lim && Math.abs(o.dDec) <= lim); // first pass lists anything whose error box overlaps; keep nominal positions inside
  return { objects, n: rows.length, url, observer };
}
