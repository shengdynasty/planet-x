// SPHEREx at NASA/IPAC IRSA: Simple Image Access v2 search, survey-epoch grouping, header reads (HTTP Range),
// per-exposure wavelength at the target, and cutouts.
import { fetchBuf, mapLimit } from './net.mjs';
import { parseHeader, listHDUs, readTableRow } from './fits.mjs';
import { celestialWCS, spectralWCS } from './wcs.mjs';

export const SIA_URL = 'https://irsa.ipac.caltech.edu/SIA';
export const TAP_URL = 'https://irsa.ipac.caltech.edu/TAP/sync';
const DAY = 86400000;

// Which SPHEREx collections to search. IRSA renames them as releases land (Oct 2026: spherex_qr2 + spherex_qr3;
// Nov 2026: spherex_dr1 replaced qr2), so by default we ask IRSA TAP (ivoa.obscore) once a day for every
// spherex_* collection and skip the calibration (_cal), deep-field (_deep) and spectral-cube (_cube) products.
// PLANETX_COLLECTIONS=a,b pins the list instead.
const PINNED = process.env.PLANETX_COLLECTIONS ? process.env.PLANETX_COLLECTIONS.split(',').filter(Boolean) : null;
const FALLBACK = ['spherex_dr1', 'spherex_qr3']; // used if TAP is unreachable (verified Nov 2026)
/** The collections in use (live binding: updated after the first discovery). */
export let COLLECTIONS = PINNED || FALLBACK;
// Discovery must never hold a request hostage to IRSA TAP (it has timed out for minutes at a time): a request waits
// at most DISCOVERY_GRACE_MS for it, then goes ahead with the fallback list while discovery finishes in the background.
// After a failure we don't ask TAP again for 10 minutes.
const DISCOVERY_GRACE_MS = 3000;
let discovered = null, retryAfter = 0, inflight = null;
function discover() {
  if (inflight) return inflight;
  const q = "SELECT obs_collection, count(*) AS n FROM ivoa.obscore WHERE obs_collection LIKE 'spherex%' GROUP BY obs_collection";
  const url = `${TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(q)}`;
  inflight = fetchBuf(url, { ns: 'sia', maxAgeMs: DAY, timeoutMs: 20000 }).then(buf => {
    const names = buf.toString('utf8').trim().split('\n').slice(1).map(l => l.split(',')[0].trim()).filter(c => /^spherex_/.test(c) && !/_(cal|deep|cube)$/.test(c));
    if (names.length) { discovered = names.sort(); COLLECTIONS = discovered; }
  }).catch(e => { retryAfter = Date.now() + 600000; console.error('[irsa] collection discovery failed; using', COLLECTIONS.join(','), 'for the next 10 min -', e.message); })
    .finally(() => { inflight = null; });
  return inflight;
}
let graced = false; // only the first caller waits the grace period; later ones carry on with whatever list we have
export async function collections() {
  if (PINNED) return PINNED;
  if (discovered || Date.now() < retryAfter) return COLLECTIONS;
  const p = discover();
  if (!graced) { graced = true; await Promise.race([p, new Promise(res => setTimeout(res, DISCOVERY_GRACE_MS))]); }
  return COLLECTIONS;
}

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Parse the first TABLE of a VOTable (TABLEDATA serialisation) into objects. */
export function parseVOTable(xml) {
  const err = xml.match(/<INFO[^>]*name="QUERY_STATUS"[^>]*value="ERROR"[^>]*>([\s\S]*?)<\/INFO>/);
  if (err) throw new Error('IRSA SIA error: ' + unesc(err[1]).trim());
  const tableStart = xml.indexOf('<TABLE'); if (tableStart < 0) return [];
  const t = xml.slice(tableStart);
  const names = [...t.matchAll(/<FIELD\b[^>]*?\bname="([^"]+)"/g)].map(m => m[1]);
  const rows = [];
  for (const m of t.matchAll(/<TR>([\s\S]*?)<\/TR>/g)) {
    const cells = [...m[1].matchAll(/<TD\s*\/>|<TD>([\s\S]*?)<\/TD>/g)].map(c => unesc(c[1] ?? ''));
    const o = {}; names.forEach((n, i) => { o[n] = cells[i] ?? ''; }); rows.push(o);
  }
  return rows;
}

const mjdToDate = mjd => new Date((mjd - 40587) * DAY);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A usable IRSA collection name typed by a person: spherex_<something>, lower case, and not a calibration, deep-field or
 *  cube product (the same ones discovery skips). Exported for the server's parameter check and the tests. */
export const isCollectionName = c => typeof c === 'string' && /^spherex_[a-z0-9_]{1,40}$/.test(c) && !/_(cal|deep|cube)$/.test(c);

/** Every SPHEREx science exposure (all six detectors) covering (ra, dec), across COLLECTIONS plus any `extra`
 *  collections the caller names (a release that has just appeared and discovery has not seen yet). */
export async function searchExposures(ra, dec, extra = []) {
  const names = [...new Set([...(await collections()), ...extra.filter(isCollectionName)])];
  const lists = await mapLimit(names, 2, async coll => {
    const url = `${SIA_URL}?COLLECTION=${coll}&POS=CIRCLE+${ra.toFixed(6)}+${dec.toFixed(6)}+0.0003&RESPONSEFORMAT=VOTABLE&MAXREC=5000`;
    const xml = (await fetchBuf(url, { ns: 'sia', maxAgeMs: 7 * DAY, timeoutMs: 90000 })).toString('utf8');
    return parseVOTable(xml).map(r => ({ ...r, collection: coll }));
  });
  const seen = new Set(), out = [];
  for (const r of lists.flat()) {
    if (r.dataproduct_subtype && r.dataproduct_subtype !== 'science') continue;
    if (r.calib_level && +r.calib_level !== 2) continue;
    const id = r.obs_publisher_did || r.access_url;
    if (seen.has(r.obs_id + r.energy_bandpassname)) continue; // a newer release may repeat an exposure
    seen.add(r.obs_id + r.energy_bandpassname); seen.add(id);
    out.push({
      obsId: r.obs_id, detector: +String(r.energy_bandpassname).replace(/\D/g, ''), bandName: r.energy_bandpassname,
      emMin: +r.em_min * 1e6, emMax: +r.em_max * 1e6, mjd: (+r.t_min + +r.t_max) / 2, exptime: +r.t_exptime,
      url: r.access_url, collection: r.collection, release: r.obs_release_date,
    });
  }
  out.sort((a, b) => a.mjd - b.mjd || a.detector - b.detector);
  return out;
}

/** Group exposures into survey epochs: a new epoch starts after a gap of more than `gapDays`. */
export function groupEpochs(exps, gapDays = 30) {
  const epochs = [];
  for (const e of exps) {
    const cur = epochs[epochs.length - 1];
    if (!cur || e.mjd - cur.mjdEnd > gapDays) epochs.push({ mjdStart: e.mjd, mjdEnd: e.mjd, exposures: [e] });
    else { cur.mjdEnd = e.mjd; cur.exposures.push(e); }
  }
  return epochs.map((ep, i) => {
    const mid = mjdToDate((ep.mjdStart + ep.mjdEnd) / 2), byDet = {};
    for (const e of ep.exposures) {
      const d = byDet[e.detector] ||= { detector: e.detector, bandName: e.bandName, count: 0, emMin: e.emMin, emMax: e.emMax };
      d.count++;
    }
    return {
      id: i + 1, label: `Scan ${i + 1}`, date: `${MONTHS[mid.getUTCMonth()]} ${mid.getUTCFullYear()}`, has: true,
      mjdStart: ep.mjdStart, mjdEnd: ep.mjdEnd,
      start: mjdToDate(ep.mjdStart).toISOString().slice(0, 10), end: mjdToDate(ep.mjdEnd).toISOString().slice(0, 10),
      nExposures: ep.exposures.length, detectors: Object.values(byDet), exposures: ep.exposures,
    };
  });
}

/** Image-HDU header of a full exposure file, read with an HTTP Range request (≈ 30 kB instead of ≈ 70 MB). */
export async function exposureHeader(url) {
  for (const len of [57600, 172800]) {
    const buf = await fetchBuf(url, { ns: 'hdr', range: `bytes=0-${len - 1}` });
    const p = parseHeader(buf, 0); if (!p) continue;
    const h = parseHeader(buf, p.end);
    if (h) return h.kv;
  }
  throw new Error('Could not read the image header of ' + url);
}

/** The WCS-WAVE lookup table: the last HDU of a SPHEREx L2 file (header + 1 data block), via a Range request. */
export async function waveTable(url) {
  const buf = await fetchBuf(url, { ns: 'hdr', range: 'bytes=-5760' });
  const h = parseHeader(buf, 0);
  if (!h || String(h.kv.EXTNAME).trim() !== 'WCS-WAVE') throw new Error('WCS-WAVE table not found at end of ' + url);
  return readTableRow(buf, { kv: h.kv, dataStart: h.end }, 0);
}

/**
 * Wavelength (µm) SPHEREx measured at (ra, dec) in one exposure, from the file's own spectral WCS.
 * SPHEREx uses linear variable filters, so wavelength depends on where the target falls on the detector.
 */
export async function exposureAtTarget(exp, ra, dec) {
  const [kv, table] = await Promise.all([exposureHeader(exp.url), waveTable(exp.url)]);
  const wcs = celestialWCS(kv);
  const [p1, p2] = wcs.toPixel(ra, dec);
  const nx = kv.NAXIS1, ny = kv.NAXIS2;
  const inside = p1 >= 0.5 && p2 >= 0.5 && p1 <= nx + 0.5 && p2 <= ny + 0.5;
  const sw = spectralWCS(kv, table);
  const w = sw ? sw(p1, p2) : null;
  return {
    ...exp, inside, pixel: [p1, p2], wave: w ? w.wave : (exp.emMin + exp.emMax) / 2, bw: w ? w.bw : null,
    waveSource: w ? 'spectral WCS (WCS-WAVE table)' : 'approximate: centre of detector band',
    mjdAvg: kv['MJD-AVG'] ?? exp.mjd, dateAvg: kv['DATE-AVG'] || null,
    xobs: [kv.X_SC, kv.Y_SC, kv.Z_SC].every(Number.isFinite) ? [kv.X_SC, kv.Y_SC, kv.Z_SC] : null,
    psfFwhm: kv.PSF_FWHM ?? null, bunit: kv.BUNIT || null,
  };
}

/** Cutout of one exposure from the IRSA cutout service (all extensions, ≈ 5 MB mostly the PSF cube). */
export async function cutout(exp, ra, dec, sizeArcsec) {
  const url = `${exp.url}?center=${ra.toFixed(6)},${dec.toFixed(6)}&size=${Math.round(sizeArcsec)}arcsec`;
  const buf = await fetchBuf(url, { ns: 'cutout', timeoutMs: 120000, accept: [200] });
  const hdus = listHDUs(buf);
  if (!hdus.length) throw new Error('Cutout is not FITS: ' + buf.toString('utf8', 0, 200));
  return { url, buf, hdus };
}
