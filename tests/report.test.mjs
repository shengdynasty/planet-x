// node tests/report.test.mjs — candidate report: model, link encoding, schema, motion fit, predictions, exports,
// and the Field view wiring. Node only (no browser); uses the simulation and a saved real SPHEREx field.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simulateField, analyse } from '../app/js/pipeline/index.js';
import { toField } from '../app/js/data/index.js';
import { buildReport, derive, designation, SIM_T0_MJD } from '../app/js/report/model.js';
import { REPORT_VERSION, STATUS, validate, migrate, ReportError } from '../app/js/report/schema.js';
import { toHash, fromHash } from '../app/js/report/encode.js';
import { linearFit, predict, toPlane, fromPlane, sepArcsec, sun, elongation, distanceFan, isoToMjd, mjdToIso } from '../app/js/report/predict.js';
import { toADES, toCSV, toEphemerisCSV, toJSON, ADES_COLUMNS, CSV_COLUMNS, EPH_COLUMNS, trkSub } from '../app/js/report/export.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const GEN = '2026-11-14T12:00:00Z';
const clone = o => JSON.parse(JSON.stringify(o));

// fixtures: the simulated slow mover, and a real flagged source from a saved SPHEREx field
const sim = simulateField(), simRes = analyse(sim, 0, 5), mover = simRes.find(r => r.kind === 'cand' && r.from && r.to);
const simCore = buildReport(mover, sim, { A: 0, B: 5, generatedAt: GEN });
const snap = JSON.parse(readFileSync(join(ROOT, 'app/data/snapshots/barnard.json'), 'utf8'));
const real = toField(snap); real.snapshot = { id: 'barnard', label: "Barnard's Star" };
real.request = { ra: 269.4463, dec: 4.7682, sizeArcsec: 300, det: 1, t: null };
const sameBand = real.epochs.map((e, i) => i).filter(i => real.epochs[i].band === real.epochs[0].band);
const realPair = [sameBand[0], sameBand.at(-1)], realRes = analyse(real, ...realPair);
const realPick = realRes.find(r => r.kind === 'known' && r.from && r.to) || realRes[0];
const realCore = buildReport(realPick, real, { A: realPair[0], B: realPair[1], mode: 'snapshot', generatedAt: GEN });

// ---------- model ----------
t('model: simulated mover → two epochs, nominal dates, SIMULATED flags, status constant', () => {
  assert.equal(simCore.v, REPORT_VERSION); assert.equal(simCore.kind, 'cand');
  assert.equal(simCore.data.sim, true); assert.equal(simCore.data.mode, 'sim'); assert.equal(simCore.data.nominal, true);
  assert.equal(simCore.ep.length, 2); assert.deepEqual(simCore.ep.map(e => e.role), ['ref', 'cmp']);
  assert.equal(simCore.ep[0].mjd, SIM_T0_MJD); assert.equal(simCore.ep[1].mjd, SIM_T0_MJD + 183);
  assert.match(simCore.id, /^PX J\d{6}\.\d[+-]\d{6}$/);
  const v = derive(simCore); assert.equal(v.status, STATUS); assert.equal(v.status, 'Candidate, unconfirmed'); assert.equal(v.simulated, true);
  assert.ok(!JSON.stringify(simCore).toLowerCase().includes('detection'), 'nothing called a detection');
});
t('model: real saved field → real MJDs, image ids, Jy fluxes, Gaia / known cross-match', () => {
  assert.equal(realCore.data.sim, false); assert.equal(realCore.data.mode, 'snapshot'); assert.equal(realCore.data.nominal, false);
  assert.equal(realCore.data.snap, 'barnard'); assert.equal(realCore.data.unit, 'Jy');
  assert.deepEqual(realCore.data.req, { ra: 269.4463, dec: 4.7682, size: 300, det: 1, t: null });
  for (const e of realCore.ep) { assert.ok(e.mjd > 60000 && e.mjd < 62000); assert.ok(e.obs && e.obs.length > 5); assert.ok(e.lambda > 0.7 && e.lambda < 5.1); }
  if (realPick.kind === 'known') assert.ok(realCore.xm.match && realCore.xm.known.some(k => k.name === realCore.xm.match));
  assert.ok(realCore.xm.gaia === null || realCore.xm.gaia.sep <= realCore.xm.radius);
});
t('model: designation truncates like an IAU name, never rounds to 60', () => {
  assert.equal(designation(70.42, 19.18), 'PX J044140.8+191048');
  assert.equal(designation(359.99999, -0.5), 'PX J235959.9-003000');
});

// ---------- link encoding ----------
t('encode: sim and real reports round-trip exactly and stay under 4 KB', async () => {
  for (const core of [simCore, realCore]) {
    const h = await toHash(core); assert.match(h, /^v=1&c=[A-Za-z0-9_-]+$/); assert.ok(h.length < 4096, `link ${h.length} chars`);
    assert.deepEqual(await fromHash('#' + h), core); assert.deepEqual(await fromHash(`https://x.test/app/report.html#${h}`), core);
  }
});
t('encode: rounding is as documented (RA/Dec 6 decimals, MJD 5 ≈ 1 s)', () => {
  for (const e of [...simCore.ep, ...realCore.ep]) { assert.equal(e.ra, +e.ra.toFixed(6)); assert.equal(e.dec, +e.dec.toFixed(6)); assert.equal(e.mjd, +e.mjd.toFixed(5)); }
});
t('encode: missing, garbled, truncated, tampered and wrong-version links give clear ReportErrors', async () => {
  const h = await toHash(simCore), c = new URLSearchParams(h).get('c');
  const bad = async (s, re) => { await assert.rejects(fromHash(s), e => e instanceof ReportError && re.test(e.message)); };
  await bad('', /needs a report link/); await bad('#v=1', /missing/); await bad('#v=2&c=' + c, /version "2"/);
  await bad('#v=1&c=' + c.slice(0, c.length >> 1), /damaged/); await bad('#v=1&c=%3Cscript%3E', /characters/);
  await bad('#v=1&c=' + 'A'.repeat(9000), /too long/);
  const forged = clone(simCore); forged.ep[0].ra = '<img src=x onerror=alert(1)>';
  const enc = async o => { const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return 'v=1&c=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  await bad('#' + await enc(forged), /ep\[0\]\.ra must be a finite number/);
  await bad('#' + await enc('just text'), /must be an object/);
});

// ---------- schema ----------
t('schema: validate rejects bad versions, missing fields and wrong types', () => {
  const bad = (mut, re) => { const o = clone(simCore); mut(o); assert.throws(() => validate(o), e => e instanceof ReportError && re.test(e.message)); };
  bad(o => { o.v = 0; }, /^Report link is not valid: v must be 1/); bad(o => { delete o.id; }, /id must be text/);
  bad(o => { o.kind = 'detection'; }, /kind must be one of/); bad(o => { o.data.sim = 'yes'; }, /data\.sim must be true or false/);
  bad(o => { o.data.mode = 'sim'; o.data.sim = false; }, /must be true for simulated data/);
  bad(o => { o.ep = []; }, /at least one epoch/); bad(o => { o.ep[0].dec = 91; }, /out of range/);
  bad(o => { o.ep[0].flags = [1]; }, /flags\[0\] must be text/); bad(o => { o.title = 'x'.repeat(500); }, /longer than/);
  bad(o => { o.xm.known = Array(13).fill(o.xm.known[0] || { name: 'a', kind: 'sb', src: 'JPL', sep: 1, mag: null }); }, /at most 12/);
  bad(o => { o.gen = 'yesterday'; }, /UTC date/); bad(o => { o.pair = [0]; }, /two epoch indices/);
  assert.equal(validate(clone(realCore)).id, realCore.id);
});
t('schema: migrate passes v1 through and refuses unknown versions', () => {
  const o = clone(simCore); assert.equal(migrate(o), o);
  assert.throws(() => migrate({ ...o, v: 2 }), /format version 2/); assert.throws(() => migrate(null), ReportError);
});

// ---------- motion and prediction ----------
const synth = (ra0, dec0, rateDay, pa, mjds, err = 0.5) => mjds.map(mjd => {
  const d = (mjd - mjds[0]) * rateDay, [ra, dec] = fromPlane(d * Math.sin(pa * Math.PI / 180), d * Math.cos(pa * Math.PI / 180), ra0, dec0);
  return { mjd, ra, dec, err };
});
t('linearFit: recovers a known rate and PA (three epochs, mid-sky)', () => {
  const fit = linearFit(synth(120, 20, 3.6, 62, [61000, 61000.4, 61002]));
  assert.ok(Math.abs(fit.rate - 3.6) < 1e-3, fit.rate); assert.ok(Math.abs(fit.pa - 62) < 0.05, fit.pa); assert.equal(fit.moving, true);
});
t('linearFit: RA wrap at 0h and a high declination are handled', () => {
  const wrap = linearFit(synth(359.9995, 10, 50, 90, [61000, 61001]));          // eastward across 0h
  assert.ok(Math.abs(wrap.rate - 50) < 1e-3 && Math.abs(wrap.pa - 90) < 0.05, `${wrap.rate} ${wrap.pa}`);
  assert.ok(wrap.ra0 < 0.01 || wrap.ra0 > 359.99, 'mean position straddles 0h correctly');
  // near the pole the local north turns as RA changes, so check positions and rate rather than one PA
  const truth = synth(200, 89.5, 20, 200, [61000, 61003, 61010, 61020]), pole = linearFit(truth.slice(0, 3));
  assert.ok(Math.abs(pole.rate - 20) < 1e-2, pole.rate);
  const far = predict(pole, [61020])[0]; assert.ok(sepArcsec(far.ra, far.dec, truth[3].ra, truth[3].dec) < 0.01, 'straight-line prediction at Dec 89.5');
  const [x, y] = toPlane(...fromPlane(1234, -567, 10, 85), 10, 85); assert.ok(Math.abs(x - 1234) < 1e-6 && Math.abs(y + 567) < 1e-6);
});
t('predict: uncertainty grows with time away from the epochs, about linearly', () => {
  const fit = linearFit(synth(120, 20, 3.6, 62, [61000, 61183], 0.6));
  const p = predict(fit, [fit.tref, 61600, 62600, 63600]), s = p.map(q => q.smaj);
  assert.ok(s[0] < s[1] && s[1] < s[2] && s[2] < s[3], s.join());
  assert.ok(Math.abs((s[3] - s[2]) / (s[2] - s[1]) - 1) < 0.02, 'linear growth once the rate term dominates');
  const q = predict(fit, [63600])[0]; assert.ok(Math.abs(sepArcsec(p[3].ra, p[3].dec, q.ra, q.dec)) < 1e-6);
  assert.deepEqual(predict(linearFit([{ mjd: 61000, ra: 1, dec: 2, err: 1 }]), [61001]), [], 'one epoch: no prediction');
});
t('sun / elongation: equinox and solstice positions, opposition', () => {
  const eq = sun(isoToMjd('2026-03-20T14:46:00Z')); assert.ok(Math.min(eq.ra, 360 - eq.ra) < 0.05 && Math.abs(eq.dec) < 0.05, `${eq.ra} ${eq.dec}`);
  const so = sun(isoToMjd('2026-06-21T08:24:00Z')); assert.ok(Math.abs(so.ra - 90) < 0.1 && Math.abs(so.dec - 23.44) < 0.02);
  assert.ok(elongation((so.ra + 180) % 360, -so.dec, isoToMjd('2026-06-21T08:24:00Z')) > 179.9);
  assert.equal(mjdToIso(isoToMjd('2026-02-16T03:06:40Z')), '2026-02-16T03:06:40Z');
});
t('distanceFan: starts on the source; nearer means faster; 300 AU ≈ parallax scale', () => {
  const fan = distanceFan(70.42, 19.18, 61000, [61000, 61030]);
  assert.deepEqual(fan.map(f => f.r), [2, 5, 40, 300]);
  for (const f of fan) { assert.ok(f.ok); assert.ok(sepArcsec(f.pts[0].ra, f.pts[0].dec, 70.42, 19.18) < 1e-3); }
  for (let k = 1; k < fan.length; k++) assert.ok(fan[k].rate < fan[k - 1].rate, 'rates fall with distance');
  // at 300 AU the motion is mostly Earth's: ≤ 2π·206265″/300/365.25 ≈ 11.8″/day
  assert.ok(fan[3].rate > 2 && fan[3].rate < 12.5, fan[3].rate);
});
t('derive: deterministic, 30-night follow-up window from the report date, orbit not attempted', () => {
  const a = derive(simCore), b = derive(clone(simCore));
  assert.deepEqual(JSON.parse(toJSON(a)), JSON.parse(toJSON(b)));
  assert.equal(a.eph.length, 30); assert.equal(a.followup.from, '2026-11-15'); assert.equal(a.followup.to, '2026-12-14');
  assert.equal(a.orbit, 'Arc too short for an orbit fit');
  assert.ok(a.motion.rateYr > 0 && a.motion.pa >= 0 && a.motion.pa < 360 && a.motion.span === 183);
  const r = derive(realCore); assert.ok(r.followup.mag === null || (r.followup.mag > 0 && r.followup.mag < 30), r.followup.mag);
});

// ---------- exports ----------
t('ADES PSV: version line, follow-up-only and simulated headers, column order, one row per epoch', () => {
  const s = toADES(derive(simCore)).split('\n');
  assert.equal(s[0], '# version=2022'); assert.ok(s.includes('# For follow-up use; not an MPC submission'));
  assert.ok(s.some(l => /^# SIMULATED DATA/.test(l)));
  const hi = s.findIndex(l => l.startsWith('trkSub')); assert.deepEqual(s[hi].split('|').map(x => x.trim()), ADES_COLUMNS);
  const rows = s.slice(hi + 1).filter(Boolean); assert.equal(rows.length, simCore.ep.length);
  const c = rows[0].split('|').map(x => x.trim()); assert.equal(c[0], trkSub(simCore.id)); assert.ok(c[0].length <= 8);
  assert.equal(c[3], mjdToIso(simCore.ep[0].mjd)); assert.equal(+c[4], simCore.ep[0].ra); assert.equal(+c[6], simCore.ep[0].err);
  assert.ok(!toADES(derive(realCore)).includes('SIMULATED'), 'real data carries no simulated line');
});
t('CSV and ephemeris CSV: headers, units and simulated lines', () => {
  const v = derive(simCore), csv = toCSV(v).split('\n'), hi = csv.findIndex(l => l.startsWith('role,'));
  assert.ok(csv[0].startsWith('# SIMULATED DATA')); assert.equal(csv[hi], CSV_COLUMNS.join(','));
  assert.equal(csv.slice(hi + 1).filter(Boolean).length, 2); assert.ok(csv.some(l => /err_arcsec is the 1-sigma/.test(l)));
  const row = csv[hi + 1].split(','); assert.equal(+row[CSV_COLUMNS.indexOf('ra_deg')], simCore.ep[0].ra); assert.equal(row[CSV_COLUMNS.indexOf('flux_unit')], 'sim units');
  const eph = toEphemerisCSV(v).split('\n'), ei = eph.indexOf(EPH_COLUMNS.join(','));
  assert.ok(eph[0].startsWith('# SIMULATED DATA') && ei > 0); assert.equal(eph.slice(ei + 1).filter(Boolean).length, 30);
  const one = derive({ ...clone(simCore), ep: [clone(simCore.ep[1])] });
  assert.match(toEphemerisCSV(one), /Only one epoch measured/);
  const rc = toCSV(derive(realCore)); assert.ok(!rc.includes('SIMULATED') && rc.includes(',Jy,'));
  const j = JSON.parse(toJSON(v)); assert.equal(j.status, STATUS); assert.equal(j.simulated, true); assert.match(j.notice[0], /SIMULATED DATA/);
});

for (const [name, fn] of tests) {
  try { await fn(); n++; }
  catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; }
}
console.log(`report: ${n}/${tests.length} passed`);
