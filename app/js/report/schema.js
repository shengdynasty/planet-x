// Candidate report: the stored (link) shape, its version and validation. Pure: no DOM.
//
// A report link carries only this core object. Everything else on the report page (motion, predictions, the
// follow-up box, the exports) is derived from it by model.js derive(), so old links keep working as the maths improves
// and nothing in the link has to be trusted beyond these checks. Pixels are never stored: the stamps are rebuilt from
// `data` (the field request) when the page opens.
//
// v1 core:
// { v: 1, app: string, gen: ISO UTC, id: string, kind: 'cand'|'known'|'var'|'art'|'left', title, detail,
//   data: { mode: 'sim'|'snapshot'|'live', sim: bool, snap: string|null, ra0, dec0, N, scale, psf, unit,
//           req: { ra, dec, size, det, t } | null, nominal: bool },
//   pair: [A, B],
//   ep: [{ i, role: 'ref'|'cmp', mjd, band, lambda|null, obs|null, x, y, ra, dec, err, peak, sig, flux|null, fluxErr|null,
//          flags: string[], hard: string[] }],
//   xm: { radius, gaia: { name, g, sep } | null, known: [{ name, kind, src, sep, mag|null }], match: string|null } }

export const REPORT_VERSION = 1;
/** App version shown in the header (no build step, so this is a date-stamped string bumped with the report format). */
export const APP_VERSION = 'planet-x report 1 · 2026-11-14';
export const STATUS = 'Candidate, unconfirmed';
export const KINDS = ['cand', 'known', 'var', 'art', 'left'];
export const MODES = ['sim', 'snapshot', 'live'];
const MAX_STR = 400, MAX_EP = 16, MAX_KNOWN = 12, MAX_FLAGS = 32;

export class ReportError extends Error { constructor(msg) { super(msg); this.name = 'ReportError'; } }

const fail = (path, what) => { throw new ReportError(`Report link is not valid: ${path} ${what}`); };
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function str(v, path, { nullable = false, max = MAX_STR } = {}) {
  if (v === null && nullable) return;
  if (typeof v !== 'string') fail(path, 'must be text'); if (v.length > max) fail(path, `is longer than ${max} characters`);
}
function num(v, path, { nullable = false, min = -Infinity, max = Infinity } = {}) {
  if (v === null && nullable) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'must be a finite number');
  if (v < min || v > max) fail(path, `is out of range (${min} to ${max})`);
}
function bool(v, path) { if (typeof v !== 'boolean') fail(path, 'must be true or false'); }
function strList(v, path, max) { if (!Array.isArray(v)) fail(path, 'must be a list'); if (v.length > max) fail(path, `has more than ${max} entries`); v.forEach((s, i) => str(s, `${path}[${i}]`, { max: 40 })); }

/** Throws ReportError with a readable message unless `r` is a well-formed core report of the current version. */
export function validate(r) {
  if (!isObj(r)) fail('report', 'must be an object');
  if (r.v !== REPORT_VERSION) fail('v', `must be ${REPORT_VERSION} (got ${JSON.stringify(r.v)})`);
  str(r.app, 'app', { max: 80 }); str(r.gen, 'gen', { max: 30 }); if (!Number.isFinite(Date.parse(r.gen))) fail('gen', 'must be a UTC date');
  str(r.id, 'id', { max: 60 }); str(r.title, 'title', { max: 120 }); str(r.detail, 'detail');
  if (!KINDS.includes(r.kind)) fail('kind', `must be one of ${KINDS.join(', ')}`);
  const d = r.data; if (!isObj(d)) fail('data', 'must be an object');
  if (!MODES.includes(d.mode)) fail('data.mode', `must be one of ${MODES.join(', ')}`);
  bool(d.sim, 'data.sim'); bool(d.nominal, 'data.nominal');
  if (d.mode === 'sim' && !d.sim) fail('data.sim', 'must be true for simulated data');
  str(d.snap, 'data.snap', { nullable: true, max: 40 }); str(d.unit, 'data.unit', { max: 20 });
  num(d.ra0, 'data.ra0', { min: 0, max: 360 }); num(d.dec0, 'data.dec0', { min: -90, max: 90 });
  num(d.N, 'data.N', { min: 4, max: 4096 }); num(d.scale, 'data.scale', { min: 0.01, max: 100 }); num(d.psf, 'data.psf', { min: 0.05, max: 20 });
  if (d.req !== null) {
    if (!isObj(d.req)) fail('data.req', 'must be an object or null');
    num(d.req.ra, 'data.req.ra', { min: 0, max: 360 }); num(d.req.dec, 'data.req.dec', { min: -90, max: 90 });
    num(d.req.size, 'data.req.size', { nullable: true, min: 1, max: 7200 }); num(d.req.det, 'data.req.det', { nullable: true, min: 1, max: 6 });
    num(d.req.t, 'data.req.t', { nullable: true, min: 0, max: 1e6 });
  }
  if (!Array.isArray(r.pair) || r.pair.length !== 2) fail('pair', 'must be two epoch indices'); r.pair.forEach((i, k) => num(i, `pair[${k}]`, { min: 0, max: 999 }));
  if (!Array.isArray(r.ep) || !r.ep.length) fail('ep', 'must list at least one epoch'); if (r.ep.length > MAX_EP) fail('ep', `has more than ${MAX_EP} epochs`);
  r.ep.forEach((e, k) => {
    const p = `ep[${k}]`; if (!isObj(e)) fail(p, 'must be an object');
    num(e.i, p + '.i', { min: 0, max: 999 }); if (!['ref', 'cmp'].includes(e.role)) fail(p + '.role', 'must be ref or cmp');
    num(e.mjd, p + '.mjd', { min: 0, max: 1e6 }); num(e.band, p + '.band', { min: 0.1, max: 30 }); num(e.lambda, p + '.lambda', { nullable: true, min: 0.1, max: 30 });
    str(e.obs, p + '.obs', { nullable: true, max: 60 });
    num(e.x, p + '.x', { min: -1e4, max: 1e4 }); num(e.y, p + '.y', { min: -1e4, max: 1e4 });
    num(e.ra, p + '.ra', { min: 0, max: 360 }); num(e.dec, p + '.dec', { min: -90, max: 90 });
    num(e.err, p + '.err', { min: 0, max: 3600 }); num(e.peak, p + '.peak'); num(e.sig, p + '.sig', { min: 0 });
    num(e.flux, p + '.flux', { nullable: true }); num(e.fluxErr, p + '.fluxErr', { nullable: true, min: 0 });
    strList(e.flags, p + '.flags', MAX_FLAGS); strList(e.hard, p + '.hard', MAX_FLAGS);
  });
  const x = r.xm; if (!isObj(x)) fail('xm', 'must be an object');
  num(x.radius, 'xm.radius', { min: 0, max: 3600 }); str(x.match, 'xm.match', { nullable: true, max: 120 });
  if (x.gaia !== null) { if (!isObj(x.gaia)) fail('xm.gaia', 'must be an object or null'); str(x.gaia.name, 'xm.gaia.name', { max: 80 }); num(x.gaia.g, 'xm.gaia.g', { nullable: true }); num(x.gaia.sep, 'xm.gaia.sep', { min: 0 }); }
  if (!Array.isArray(x.known) || x.known.length > MAX_KNOWN) fail('xm.known', `must be a list of at most ${MAX_KNOWN}`);
  x.known.forEach((k, i) => { const p = `xm.known[${i}]`; if (!isObj(k)) fail(p, 'must be an object'); str(k.name, p + '.name', { max: 120 }); str(k.kind, p + '.kind', { max: 10 }); str(k.src, p + '.src', { max: 80 }); num(k.sep, p + '.sep', { min: 0 }); num(k.mag, p + '.mag', { nullable: true }); });
  return r;
}

/** Bring an older report up to the current version (only v1 exists so far). Throws ReportError for unknown versions. */
export function migrate(r) {
  if (!isObj(r)) throw new ReportError('Report link is not valid: report must be an object');
  if (r.v === REPORT_VERSION) return r;
  throw new ReportError(`This report link uses format version ${JSON.stringify(r.v)}, which this copy of Planet X cannot read (it reads version ${REPORT_VERSION}).`);
}
