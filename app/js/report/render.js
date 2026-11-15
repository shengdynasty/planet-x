// Fills app/report.html from the link: decode + validate (encode.js), derive (model.js), then text, tables, stamps,
// QR code and downloads. Every decoded value is untrusted, so the page is built with textContent only.
import { fromHash } from './encode.js';
import { derive, MIN_ELONGATION } from './model.js';
import { toADES, toCSV, toEphemerisCSV, toJSON, fileName } from './export.js';
import { drawStamps, rebuildField } from './stamps.js';

const $ = r => document.querySelector(`[data-r="${r}"]`);
const fx = (v, d, unit = '') => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d) + unit;
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

function kv(box, rows) { box.replaceChildren(...rows.filter(Boolean).flatMap(([k, v, cls]) => [el('dt', k), el('dd', v, cls)])); }
function table(box, head, rows) {
  const thead = el('thead'), tr = el('tr'); head.forEach(h => tr.append(el('th', h))); thead.append(tr);
  const tbody = el('tbody'); rows.forEach(r => { const row = el('tr'); r.forEach(c => row.append(el('td', c, /\d[hm°]/.test(c) || c.length < 14 ? 'nw' : null))); tbody.append(row); });
  box.replaceChildren(thead, tbody);
}
const sourceTxt = c => c.data.sim ? 'Simulated field (planted test objects)' : c.data.mode === 'snapshot' ? 'SPHEREx, saved frames from NASA/IPAC IRSA' : 'SPHEREx, live frames from NASA/IPAC IRSA';
const day = iso => iso.slice(0, 10);
const jyTxt = j => Math.abs(j) >= 1 ? `${j.toPrecision(3)} Jy` : Math.abs(j) >= 1e-3 ? `${(j * 1e3).toPrecision(3)} mJy` : `${(j * 1e6).toPrecision(3)} µJy`;

function render(view) {
  const c = view.core, f = view.fmt;
  document.title = `${c.id} · ${view.simulated ? 'SIMULATED · ' : ''}Candidate report · Planet X`;
  $('sim').hidden = !view.simulated;
  $('id').textContent = c.id; $('title').textContent = `${c.title}. ${c.detail}`;
  kv($('meta'), [
    ['Kind', view.kindLabel], ['Status', view.status, 'rp-status'], ['Data', sourceTxt(c) + (c.data.req && !c.data.sim ? ` · D${c.data.req.det ?? '?'}` : '')],
    c.data.nominal && ['Dates', 'Nominal: the simulation has no calendar'], ['Version', c.app], ['Generated', c.gen.replace('T', ' ').replace('Z', ' UTC')],
  ]);

  // motion
  const m = view.motion;
  kv($('motion'), view.fit.moving ? [
    ['Rate', `${fx(m.rateHr, 3)}″/hr · ${fx(m.rateYr, 1)}″/yr`], ['', `± ${fx(m.rateErrDay * 365.25, 1)}″/yr (1σ)`],
    ['Position angle', `${fx(m.pa, 1)}° E of N`], ['Total shift', `${fx(m.shift, 1)}″`], ['Time span', `${fx(m.span, m.span < 2 ? 3 : 1)} d`], ['SNR (peak)', fx(m.snr, 1)],
  ] : [['Rate', 'Not measured: one epoch only'], ['SNR (peak)', fx(m.snr, 1)]]);

  // cross-match
  const x = c.xm, rows = [];
  rows.push(['Gaia DR3', x.gaia ? `${x.gaia.name}${x.gaia.g != null ? `, G ${x.gaia.g}` : ''}, ${x.gaia.sep}″` : c.data.sim ? 'Not queried (simulated field)' : `None within ${x.radius}″`]);
  rows.push(['Known small body', x.known.filter(k => k.kind !== 'star').map(k => `${k.name}, ${k.sep}″ (${k.src}${k.mag != null ? `, V ${k.mag}` : ''})`).join('; ') || `None within ${x.radius}″`]);
  const pm = x.known.filter(k => k.kind === 'star'); if (pm.length) rows.push(['High proper motion', pm.map(k => `${k.name}, ${k.sep}″`).join('; ')]);
  rows.push(['CatWISE', 'Not queried']);
  if (x.match) rows.push(['Matched to', x.match]);
  kv($('xm'), rows);

  // astrometry
  table($('astro'), ['Epoch', 'UTC', 'MJD', 'RA', 'Dec', 'RA / Dec (°)', 'σ', 'Flux', 'Band', 'SPHEREx image', 'Flags'], c.ep.map(e => [
    e.role === 'ref' ? 'Ref' : 'Cmp', f.iso(e.mjd).replace('T', ' ').replace('Z', ''), fx(e.mjd, 5), f.ra(e.ra), f.dec(e.dec), `${fx(e.ra, 6)} ${e.dec >= 0 ? '+' : ''}${fx(e.dec, 6)}`, `${fx(e.err, 2)}″`,
    e.flux == null ? '—' : c.data.unit === 'Jy' ? jyTxt(e.flux) : `${e.flux.toPrecision(3)} ${c.data.unit}`, `${e.lambda ?? e.band} µm`, e.obs || (c.data.sim ? 'simulated' : '—'),
    e.flags.length ? e.flags.map(n => e.hard.includes(n) ? `${n} (hard)` : n).join(', ') : 'none']));

  // prediction: linear
  const fu = view.followup;
  if (view.fit.moving) {
    const picks = [0, 9, 19, 29].map(k => view.eph[k]).filter(Boolean);
    table($('linear'), ['Date (0h UTC)', 'RA', 'Dec', '1σ', 'Elong.'], picks.map(p => [day(f.iso(p.mjd)), f.ra(p.ra), f.dec(p.dec), `${fx(p.smaj, 1)}″`, `${fx(p.elong, 0)}°`]));
  } else table($('linear'), ['Linear motion'], [['One epoch only: no motion measured, so no prediction.']]);
  // prediction: distance fan, positions on the last day of the follow-up window
  const endIso = day(f.iso(view.fan[0]?.pts.at(-1)?.mjd ?? 0));
  table($('fan'), ['Distance', 'Model rate', `RA on ${endIso}`, 'Dec', 'Offset from linear'], view.fan.map(r => {
    if (!r.ok) return [`${r.r} AU`, 'not possible from this direction', '', '', ''];
    const p = r.pts.at(-1), off = view.end ? sepArcsecLocal(p.ra, p.dec, view.end.ra, view.end.dec) : null;
    return [`${r.r} AU`, `${fx(r.rate, 1)}″/day`, f.ra(p.ra), f.dec(p.dec), off == null ? '—' : off > 3600 ? `${fx(off / 3600, 2)}°` : `${fx(off, 0)}″`];
  }));
  $('orbit').textContent = `${view.orbit}: ${c.ep.length} epoch${c.ep.length === 1 ? '' : 's'} over ${fx(view.motion.span, 1)} days. A future server step could add one.${view.fit.moving ? ` Measured ${fx(m.rateDay, 2)}″/day: compare with the model rates above for a rough distance.` : ''}`;

  // follow-up box
  kv($('follow'), [
    ['Window', `${fu.from} to ${fu.to} (30 nights)`],
    fu.now ? ['Position now', `${f.ra(fu.now.ra)} ${f.dec(fu.now.dec)} ± ${fx(fu.now.smaj, 1)}″`] : ['Position', `${f.ra(c.ep.at(-1).ra)} ${f.dec(c.ep.at(-1).dec)} (last seen; motion unknown)`],
    fu.end && ['On ' + fu.to, `${f.ra(fu.end.ra)} ${f.dec(fu.end.dec)} ± ${fx(fu.end.smaj, 1)}″`],
    ['Solar elongation', `${fx(fu.elongNow, 0)}° now`],
    ['Observable', fu.observable ? `${fu.observable} of 30 nights at ≥ ${MIN_ELONGATION}° from the Sun (${fu.firstObs} to ${fu.lastObs})` : `Not at ≥ ${MIN_ELONGATION}° from the Sun in this window`],
    ['Suggested band', fu.band],
    ['Brightness', fu.mag != null ? `≈ ${fx(fu.mag, 1)} AB mag at ${fu.magBand} µm (5×5-pixel aperture)` : c.data.sim ? 'Simulated units only (no calibrated magnitude)' : 'Not measured'],
    ['Status', view.status, 'rp-status'],
  ]);

  // link + QR
  // The report link is 700–1,000 characters: a QR code of it has ~100 modules a side and cannot be read from a 24 mm
  // print. The QR therefore carries the short deep link that opens this field in the app (same frames, same flags, the
  // source to re-select); the full report link stays as text and behind the Copy link button.
  const link = location.href; $('link').textContent = link;
  drawQR(fieldLink(c));
}

// separation for the offset column (kept local so render.js needs nothing else from predict.js)
function sepArcsecLocal(r1, d1, r2, d2) { const R = Math.PI / 180, a = Math.sin((d2 - d1) * R / 2) ** 2 + Math.cos(d1 * R) * Math.cos(d2 * R) * Math.sin((r2 - r1) * R / 2) ** 2; return 2 * Math.asin(Math.min(1, Math.sqrt(a))) / R * 3600; }

/** Deep link to the report's field in the app (app/?ra=&dec=&size=&det=&t=), ~80 characters, so its QR code stays readable. */
export function fieldLink(c) {
  const u = new URL('./', location.href), q = u.searchParams, r = c.data.req;
  if (r) { q.set('ra', String(r.ra)); q.set('dec', String(r.dec)); if (r.size) q.set('size', String(r.size)); if (r.det) q.set('det', String(r.det)); if (r.t != null) q.set('t', String(r.t)); }
  else { q.set('ra', String(c.data.ra0)); q.set('dec', String(c.data.dec0)); if (c.data.sim) q.set('data', 'sim'); }
  return u.href;
}

function drawQR(text, tries = 0) {
  const lib = globalThis.qrcode, cv = $('qr');
  if (typeof lib !== 'function') { if (tries < 150) setTimeout(() => drawQR(text, tries + 1), 100); return; } // the script is async and may come from a cold CDN; give it 15 s, then leave the link text alone
  try {
    const qr = lib(0, 'L'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), q = 2, px = Math.max(2, Math.floor(264 / (n + 2 * q)));
    cv.width = cv.height = (n + 2 * q) * px; const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + q) * px, (r + q) * px, px, px);
    cv.hidden = false;
  } catch (e) { console.warn('[planet-x] report: QR code not drawn', e); }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wire(view) {
  const files = {
    ades: () => download(fileName(view, 'psv'), toADES(view), 'text/plain'),
    csv: () => download(fileName(view, 'csv'), toCSV(view), 'text/csv'),
    eph: () => download(fileName(view, 'ephemeris.csv'), toEphemerisCSV(view), 'text/csv'),
    json: () => download(fileName(view, 'json'), toJSON(view), 'application/json'),
  };
  document.querySelectorAll('.rp-bar [data-act]').forEach(b => {
    b.disabled = false;
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'print') window.print();
      else if (act === 'copy') { try { await navigator.clipboard.writeText(location.href); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; } setTimeout(() => { b.textContent = 'Copy link'; }, 1500); }
      else files[act]();
    });
  });
}

function showError(msg) {
  const box = $('error'); box.hidden = false; $('report').hidden = true;
  box.replaceChildren(el('strong', 'This report could not be opened.'), el('span', msg));
  document.title = 'Report link not valid · Planet X';
}

async function main() {
  let view;
  try { view = derive(await fromHash(location.hash)); }
  catch (e) { console.warn('[planet-x] report:', e); showError(e && e.name === 'ReportError' ? e.message : 'The report link could not be read.'); return; }
  $('report').hidden = false; render(view); wire(view);
  window.__report = { view, stamps: 'loading' };
  const note = $('stampnote'); note.textContent = 'Rebuilding stamps from the field…';
  try { const field = await rebuildField(view.core); note.textContent = drawStamps($('stamps'), view.core, field, view.fmt.iso); window.__report.stamps = 'drawn'; }
  catch (e) { console.warn('[planet-x] report: stamps', e); note.textContent = `Stamps unavailable offline: ${e.message}. Everything else in this report comes from the link itself.`; window.__report.stamps = 'unavailable'; }
}
addEventListener('hashchange', () => location.reload());
main();
