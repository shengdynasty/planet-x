// Report data files. Pure: each takes derive(core) (model.js) and returns the file text.
// Every file starts with the report's status and, for simulated data, a SIMULATED DATA line, so a file passed on
// without the page still says what it is.
import { STATUS } from './schema.js';

const SIM_LINE = 'SIMULATED DATA: planted test objects in a simulated star field, not a real observation';
const FOLLOWUP_LINE = 'For follow-up use; not an MPC submission';
const f = (v, d) => v == null || !Number.isFinite(v) ? '' : v.toFixed(d);

/** Comment lines shared by every file (each prefixed by the caller's comment marker). */
export function headerLines(view) {
  const c = view.core, lines = [];
  if (view.simulated) lines.push(SIM_LINE);
  lines.push(`Planet X candidate report ${c.id} · ${STATUS} · ${view.kindLabel}: ${c.title}`);
  lines.push(`Data: ${c.data.sim ? 'simulated field' : c.data.mode === 'snapshot' ? 'saved SPHEREx frames (NASA/IPAC IRSA)' : 'live SPHEREx frames (NASA/IPAC IRSA)'}${c.data.nominal ? '; epoch dates are nominal (the simulation has no calendar)' : ''}`);
  lines.push(`Generated ${c.gen} by ${c.app}`);
  return lines;
}
const comments = (view, mark = '#') => headerLines(view).map(l => `${mark} ${l}`);
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvRow = cells => cells.map(csvCell).join(',');

/** A short tracklet id for ADES trkSub (≤ 8 characters), stable for a report id. */
export function trkSub(id) { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return 'PX' + (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6); }

export const ADES_COLUMNS = ['trkSub', 'mode', 'stn', 'obsTime', 'ra', 'dec', 'rmsRA', 'rmsDec', 'astCat', 'remarks'];
/**
 * ADES PSV (MPC's current exchange format), one row per epoch. Not submission-ready: SPHEREx is a spacecraft and its
 * position (sys/ctr/pos1–3) is not available here, so stn is XXX and mode is a placeholder.
 */
export function toADES(view) {
  const c = view.core, rows = c.ep.map(e => [trkSub(c.id), 'CCD', 'XXX', view.fmt.iso(e.mjd), f(e.ra, 6), f(e.dec, 6), f(e.err, 2), f(e.err, 2), 'UNK',
    `SPHEREx ${e.lambda ?? e.band}um${e.obs ? ' ' + e.obs : ''}${c.data.sim ? ' SIMULATED' : ''}`.replace(/\|/g, '/')]);
  const widths = ADES_COLUMNS.map((h, k) => Math.max(h.length, ...rows.map(r => String(r[k]).length)));
  const line = cells => cells.map((v, k) => String(v).padEnd(widths[k])).join('|').trimEnd();
  return [
    '# version=2022',
    `# ${FOLLOWUP_LINE}`,
    ...comments(view),
    '# mode and stn are placeholders: SPHEREx observes from low Earth orbit and its position is not included',
    '# observatory', '! name SPHEREx (NASA)',
    '# measurers', '! name Planet X automated pipeline',
    '# telescope', '! name SPHEREx', '! aperture 0.2',
    line(ADES_COLUMNS), ...rows.map(line), '',
  ].join('\n');
}

export const CSV_COLUMNS = ['role', 'utc', 'mjd', 'ra_deg', 'dec_deg', 'ra_hms', 'dec_dms', 'err_arcsec', 'band_um', 'lambda_um',
  'flux', 'flux_err', 'flux_unit', 'peak_above_sky', 'noise', 'snr', 'spherex_image', 'flags', 'hard_flags', 'x_px', 'y_px'];
/** The astrometry table: one row per epoch. RA/Dec ICRS. */
export function toCSV(view) {
  const c = view.core;
  return [...comments(view), `# Positions ICRS; err_arcsec is the 1-sigma centroid uncertainty per axis; flux is a 5x5-pixel aperture sum (${c.data.unit})`,
    csvRow(CSV_COLUMNS),
    ...c.ep.map(e => csvRow([e.role === 'ref' ? 'reference' : 'comparison', view.fmt.iso(e.mjd), f(e.mjd, 5), f(e.ra, 6), f(e.dec, 6), view.fmt.ra(e.ra), view.fmt.dec(e.dec),
      f(e.err, 2), e.band, e.lambda ?? '', e.flux ?? '', e.fluxErr ?? '', c.data.unit, e.peak, e.sig, e.sig > 0 ? f(e.peak / e.sig, 1) : '', e.obs ?? '',
      e.flags.join(';'), e.hard.join(';'), e.x, e.y])), ''].join('\n');
}

export const EPH_COLUMNS = ['date_utc', 'mjd', 'ra_deg', 'dec_deg', 'ra_hms', 'dec_dms', 'sigma_major_arcsec', 'sigma_minor_arcsec', 'pa_deg', 'elongation_deg'];
/** Linear-motion ephemeris for the next 30 nights (0h UTC). Empty, with a note, when only one epoch was measured. */
export function toEphemerisCSV(view) {
  const head = [...comments(view), '# Linear motion on the sky from the measured epochs; 1-sigma ellipse from the fit covariance (grows with time). Not an orbit.'];
  if (!view.fit.moving) return [...head, '# Only one epoch measured: no motion, so no prediction is possible.', csvRow(EPH_COLUMNS), ''].join('\n');
  return [...head, csvRow(EPH_COLUMNS), ...view.eph.map(p => csvRow([view.fmt.iso(p.mjd).slice(0, 10), f(p.mjd, 1), f(p.ra, 6), f(p.dec, 6), view.fmt.ra(p.ra), view.fmt.dec(p.dec),
    f(p.smaj, 2), f(p.smin, 2), f(p.pa, 1), f(p.elong, 1)])), ''].join('\n');
}

/** The full report: the stored core plus everything derived from it. */
export function toJSON(view) {
  const { core, status, kindLabel, simulated, fit, motion, eph, fan, followup, orbit } = view;
  return JSON.stringify({ notice: headerLines(view), status, simulated, kind: kindLabel, report: core,
    derived: { motion, linearFit: { ...fit, varV: Number.isFinite(fit.varV) ? fit.varV : null }, ephemeris: eph, distanceFan: { illustrative: true, rows: fan }, followup, orbit } }, null, 2) + '\n';
}

/** File names for the downloads. */
export const fileName = (view, ext) => `${view.core.id.replace(/\s+/g, '_').replace(/[^\w+.-]/g, '')}${view.simulated ? '_SIMULATED' : ''}.${ext}`;
