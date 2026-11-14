// Gaia DR3 sources near a position, from the ESA Gaia archive TAP service (sync, CSV), cached 30 days.
// Used to overlay catalogued stars on a field and to recognise high-proper-motion stars as known movers.
import { fetchBuf } from './net.mjs';

export const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
export const GAIA_EPOCH_MJD = 57388.5; // J2016.0, the reference epoch of Gaia DR3 positions
/** Stars with a proper motion at least this large (mas/yr) are listed as known movers: 1″/yr ≈ 0.16 px/yr at 6.15″/px. */
export const HIGH_PM_MAS = 1000;
/** Common names for a few Gaia DR3 source ids (the challenge's test targets that Gaia sees; the Epsilon Indi brown-dwarf
 *  pair is a single G 18.0 source to Gaia). */
export const GAIA_NAMES = { '4472832130942575872': "Barnard's Star", '6412596012146801152': 'Epsilon Indi Ba/Bb' };
const DAY = 86400000;

/**
 * Gaia DR3 sources within `radiusDeg` of (ra, dec) brighter than G = gmax.
 * @returns {Promise<Array<{id:string, ra:number, dec:number, pmra:number|null, pmdec:number|null, plx:number|null, g:number, rp:number|null, name:string|null}>>}
 */
export async function gaiaCone(ra, dec, radiusDeg, gmax = 19) {
  const q = `SELECT source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag,phot_rp_mean_mag FROM gaiadr3.gaia_source `
    + `WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra.toFixed(6)},${dec.toFixed(6)},${radiusDeg.toFixed(5)})) AND phot_g_mean_mag<${gmax}`;
  const url = `${GAIA_TAP}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(q)}`;
  const csv = (await fetchBuf(url, { ns: 'gaia', maxAgeMs: 30 * DAY, timeoutMs: 60000 })).toString('utf8').trim();
  if (!csv.startsWith('source_id')) throw new Error('Gaia TAP: unexpected answer: ' + csv.slice(0, 200).replace(/\s+/g, ' '));
  const [head, ...rows] = csv.split('\n'), cols = head.split(',');
  const num = v => v === '' || v === undefined ? null : +v;
  return rows.map(l => { const c = l.split(','), o = {}; cols.forEach((k, i) => { o[k] = c[i]; }); return o; })
    .filter(o => o.source_id)
    .map(o => ({ id: o.source_id, ra: +o.ra, dec: +o.dec, pmra: num(o.pmra), pmdec: num(o.pmdec), plx: num(o.parallax), g: +o.phot_g_mean_mag, rp: num(o.phot_rp_mean_mag), name: GAIA_NAMES[o.source_id] || null }))
    .filter(s => Number.isFinite(s.ra) && Number.isFinite(s.dec))
    .sort((a, b) => a.g - b.g);
}

/** Position (deg) of a Gaia source at MJD `mjd`, propagating its proper motion from J2016.0 (parallax ignored). */
export function gaiaAt(s, mjd) {
  if (s.pmra == null || s.pmdec == null) return [s.ra, s.dec];
  const dt = (mjd - GAIA_EPOCH_MJD) / 365.25;
  return [s.ra + s.pmra * dt / 3.6e6 / Math.cos(s.dec * Math.PI / 180), s.dec + s.pmdec * dt / 3.6e6];
}

/** Total proper motion, mas/yr (0 when Gaia has none). */
export const pmTotal = s => s.pmra == null || s.pmdec == null ? 0 : Math.hypot(s.pmra, s.pmdec);

/** Display name: the common name if known, else 'Gaia DR3 <id>'. */
export const gaiaName = s => s.name || `Gaia DR3 ${s.id}`;
