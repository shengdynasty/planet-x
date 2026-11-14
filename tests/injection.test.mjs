// Injection-recovery on real SPHEREx frames (scripts/injection-recovery.mjs), as a regression test for the detector.
// Run:  node --test tests/injection.test.mjs      (Node only, no browser, a few seconds; deterministic seed)
// Plants synthetic movers into the six saved example fields (app/data/snapshots/) and checks the pipeline's recovery
// stays within the envelope measured on 2026-11-14 (docs/WRITEUP.md "Injection-recovery test"). The bounds sit a little
// below the measured values so a small detector change does not trip them; a real regression (a lost class of mover,
// movers reported below the pairing threshold, a drift in centroids) does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFields, run, SNRS, CASES } from '../scripts/injection-recovery.mjs';
import { analyse } from '../app/js/pipeline/index.js';

const fields = loadFields();
const rate = (out, snr, cas) => { const c = out.cells[snr][cas]; return c.n ? c.recovered / c.n : 0; };
const TRIALS = 6; // × 6 fields = 36 trials per cell

test('baseline: the un-injected first pair of every saved field reports no Uncatalogued mover', () => {
  assert.equal(fields.length, 6);
  for (const { id, field } of fields) {
    const movers = analyse(field, 0, 1).filter(r => r.kind === 'cand' && r.title === 'Uncatalogued mover');
    assert.equal(movers.length, 0, `${id}: ${movers.map(r => r.detail).join('; ')}`);
  }
});

test('detector alone (planted clear of Gaia stars): bright movers are recovered, faint ones and sub-threshold shifts are not', () => {
  const out = run({ fields, trials: TRIALS, clearGaia: true });
  for (const snr of [12, 20, 40]) for (const cas of ['3', '5', '8', '15']) assert.ok(rate(out, snr, cas) >= 0.75, `SNR ${snr}, shift ${cas} px: ${(rate(out, snr, cas) * 100).toFixed(0)}% recovered (want ≥ 75%)`);
  assert.ok(rate(out, 20, 'enter') >= 0.8, `entering source at 20σ: ${(rate(out, 20, 'enter') * 100).toFixed(0)}% (want ≥ 80%)`);
  assert.ok(rate(out, 20, 'leave') >= 0.85, `leaving source at 20σ: ${(rate(out, 20, 'leave') * 100).toFixed(0)}% (want ≥ 85%)`);
  for (const cas of CASES.map(c => c.id)) assert.ok(rate(out, 4, cas) <= 0.1, `4σ, ${cas}: ${(rate(out, 4, cas) * 100).toFixed(0)}% (a 4σ source must not be reported)`);
  for (const snr of SNRS) assert.equal(rate(out, snr, '1'), 0, `1 px shift at ${snr}σ is below the 2.2 px pairing threshold and must not be called motion`);
  for (const snr of SNRS) assert.ok(rate(out, snr, '2') <= 0.35, `2 px shift at ${snr}σ: ${(rate(out, snr, '2') * 100).toFixed(0)}% (only centroid scatter can pair it)`);
  const errs = Object.values(out.cells).flatMap(row => Object.values(row).flatMap(c => c.errs)).sort((a, b) => a - b);
  assert.ok(errs.length > 500 && errs[errs.length >> 1] < 0.5, `median position error ${errs.length ? errs[errs.length >> 1].toFixed(2) : '–'} px over ${errs.length} recoveries (want < 0.5 px)`);
});

test('a mover landing on a catalogued star is still a mover when it is far brighter than that star could be (ISS-28)', () => {
  const any = run({ fields, trials: TRIALS }), clear = run({ fields, trials: TRIALS, clearGaia: true });
  const pf = (out, id) => { const f = out.fields.find(x => x.id === id); return f.recovered / f.n; };
  // before the Gaia-RP brightness check this was 28% against 74% clear of stars (2026-11-14)
  assert.ok(pf(any, 'barnard') >= 0.65, `Barnard's Star field (218 Gaia stars), planted anywhere: ${(pf(any, 'barnard') * 100).toFixed(0)}% (want ≥ 65%)`);
  assert.ok(pf(clear, 'barnard') - pf(any, 'barnard') <= 0.15, `the coincidence costs at most 15 points there: ${(pf(clear, 'barnard') * 100).toFixed(0)}% clear vs ${(pf(any, 'barnard') * 100).toFixed(0)}% anywhere`);
  assert.ok(pf(clear, 'epsindi') >= 0.85 && pf(any, 'epsindi') >= 0.85, `a sparse field (25 Gaia stars) recovers ≥ 85% either way: ${(pf(any, 'epsindi') * 100).toFixed(0)}% / ${(pf(clear, 'epsindi') * 100).toFixed(0)}%`);
  for (const snr of [12, 20, 40]) assert.ok(rate(any, snr, '5') >= 0.7 && rate(any, snr, 'enter') >= 0.75, `planted anywhere, ${snr}σ: 5 px ${(rate(any, snr, '5') * 100).toFixed(0)}% (want ≥ 70%), entering ${(rate(any, snr, 'enter') * 100).toFixed(0)}% (want ≥ 75%)`);
});
