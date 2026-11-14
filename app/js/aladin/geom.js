// Pure helpers for the "Other telescopes" chips (no DOM), importable from Node for tests.

/** IRSA's mirror of the CDS HiPS (the same tiles); the app already depends on IRSA for SPHEREx, and CDS's tile servers
 *  are not always reachable. */
export const IRSA_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/CDS';

/** Image surveys. `hips` is the HiPS URL passed to Aladin Lite (IRSA mirror); `cds` is the CDS ID, used only for the
 *  "Open in Aladin" link; `dates` are the years the images were taken. */
export const SURVEYS = [
  { id: 'dss2',    hips: `${IRSA_HIPS}/DSS2/color`,   cds: 'P/DSS2/color',    label: 'DSS2',    dates: '1980s–90s', note: 'Digitized Sky Survey 2: visible-light photographic plates, 1980s–90s. The oldest images here, so the best for showing motion.' },
  { id: '2mass',   hips: `${IRSA_HIPS}/2MASS/Color`,  cds: 'P/2MASS/color',   label: '2MASS',   dates: '1997–2001', note: 'Two Micron All Sky Survey: sharp near-infrared images, 1997–2001, at wavelengths overlapping SPHEREx.' },
  { id: 'allwise', hips: `${IRSA_HIPS}/AllWISE/RGB-W4-W2-W1`, cds: 'P/allWISE/color', label: 'AllWISE', dates: '2010–2011', note: 'AllWISE: mid-infrared WISE images, 2010–2011. Best for cold brown dwarfs.' },
];

/** SIMBAD name labels drawn on top of whichever survey is shown. */
export const SIMBAD = { id: 'simbad', label: 'SIMBAD', dates: 'names', note: 'SIMBAD: labels known objects with their names and types.', color: '#ffffff' };

/** The Field view's vetting stamp is 15 SPHEREx pixels of ~6.2″. */
export const DEFAULT_STAMP_ARCSEC = 93;

export const surveyById = id => SURVEYS.find(s => s.id === id) || SURVEYS[0];

export function normRa(ra) { const r = ra % 360; return r < 0 ? r + 360 : r; }

/** Aladin field of view (degrees) around a stamp of `stampArcsec`: 2.5× the stamp, at least 2′, at most 1°. */
export function fovDeg(stampArcsec = DEFAULT_STAMP_ARCSEC) {
  const s = Number.isFinite(stampArcsec) && stampArcsec > 0 ? stampArcsec : DEFAULT_STAMP_ARCSEC;
  return Math.min(1, Math.max(2 / 60, (s * 2.5) / 3600));
}

/** Corners [[ra, dec], …] of a square of side `sizeArcsec` centred on (ra, dec), for an outline. Small-field approximation. */
export function footprint(ra, dec, sizeArcsec = DEFAULT_STAMP_ARCSEC) {
  const h = (sizeArcsec / 3600) / 2;
  const dRa = h / Math.max(0.01, Math.cos((dec * Math.PI) / 180));
  const clampDec = d => Math.max(-90, Math.min(90, d));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [normRa(ra + sx * dRa), clampDec(dec + sy * h)]);
}

export function isTarget(t) {
  return !!t && Number.isFinite(t.ra) && Number.isFinite(t.dec) && t.dec >= -90 && t.dec <= 90;
}

/** Link to the same view on the full Aladin Lite site. */
export function aladinUrl(t, surveyId) {
  const u = new URL('https://aladin.cds.unistra.fr/AladinLite/');
  u.searchParams.set('target', `${normRa(t.ra).toFixed(5)} ${t.dec.toFixed(5)}`);
  u.searchParams.set('fov', fovDeg(t.stampArcsec).toFixed(4));
  u.searchParams.set('survey', surveyById(surveyId).cds);
  return u.toString();
}

/** e.g. "RA 269.4463°, Dec +4.7682° · 3.9′ view" */
export function describe(t) {
  if (!isTarget(t)) return 'No position yet';
  const f = fovDeg(t.stampArcsec) * 60;
  const view = f >= 60 ? `${+(f / 60).toFixed(1)}°` : `${+f.toFixed(f < 10 ? 1 : 0)}′`;
  return `RA ${normRa(t.ra).toFixed(4)}°, Dec ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(4)}° · ${view} view`;
}
