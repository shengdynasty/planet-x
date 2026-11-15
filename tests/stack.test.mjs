// Shift-and-stack on the saved real fields (scripts/shift-and-stack.mjs), as a regression test for the measured gain.
// Run:  node --test tests/stack.test.mjs      (Node only, no browser, a few seconds; deterministic seed)
// The bounds sit below the values measured on 2026-11-15 (docs/WRITEUP.md "Shift-and-stack") so a small change in the
// detector or the stacking does not trip them; losing the gain, or gaining false hits at wrong distances, does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFields } from '../scripts/injection-recovery.mjs';
import { run, parallaxOffsets, shiftFrame, maskRadius } from '../scripts/shift-and-stack.mjs';

const fields = loadFields();
const TRIALS = 8; // × 6 fields = 48 trials per cell

test('whole-pixel shifts and the parallax offsets behave', () => {
  const N = 5, img = new Float32Array(N * N); img[2 * N + 2] = 1; // a point at (2, 2)
  const s = shiftFrame(img, N, 1, 0); // out(x, y) = img(x + 1, y): the point moves to x = 1
  assert.equal(s[2 * N + 1], 1); assert.equal(s[2 * N + 2], 0); assert.ok(Number.isNaN(s[2 * N + 4]), 'pixels sampled outside the frame are NaN');
  const { field } = fields[0], o2000 = parallaxOffsets(field, 2000), oInf = parallaxOffsets(field, Infinity);
  assert.ok(oInf.every(([x, y]) => x === 0 && y === 0), 'no shift for a fixed source');
  assert.ok(Math.abs(o2000[0][0]) < 1e-9 && Math.abs(o2000[0][1]) < 1e-9, 'the reference epoch has zero offset');
  assert.ok(Math.hypot(...o2000[1]) > 25 && Math.hypot(...o2000[1]) < 40, `the opposite-season pass is ~33 px away at 2000 AU (${Math.hypot(...o2000[1]).toFixed(1)})`);
  assert.equal(maskRadius(3), 2); assert.ok(maskRadius(5000) > 6 && maskRadius(5000) <= 8, 'bright sources get a wider mask');
});

test('stacking at the true distance lifts faint sources over the bar and not at wrong distances', () => {
  const o = run({ fields, trials: TRIALS, trueAU: 2000 });
  const agg = s => { let n = 0, single = 0, hit = 0, wrong = 0, wrongN = 0; for (const r of o.rows) { const c = r.cells[s]; n += c.n; single += c.single; hit += c.hit[2000]; for (const h of o.hyps) if (h !== 2000) { wrong += c.hit[h]; wrongN += c.n; } } return { single: single / n, hit: hit / n, wrong: wrong / wrongN, n }; };
  const a6 = agg(6), a5 = agg(5), a3 = agg(3), a8 = agg(8);
  assert.ok(a6.hit >= 0.45, `6σ per frame: ${(a6.hit * 100).toFixed(0)}% recovered in the stack (want ≥ 45%; single pass ${(a6.single * 100).toFixed(0)}%)`);
  assert.ok(a6.hit >= 3 * a6.single, `the stack recovers ≥ 3× what a single pass does at 6σ (${(a6.hit * 100).toFixed(0)}% vs ${(a6.single * 100).toFixed(0)}%)`);
  assert.ok(a5.hit >= 0.2 && a5.hit >= 3 * a5.single, `5σ per frame: ${(a5.hit * 100).toFixed(0)}% in the stack vs ${(a5.single * 100).toFixed(0)}% single (want ≥ 20% and ≥ 3×)`);
  assert.ok(a8.hit >= 0.6, `8σ per frame still recovered in the stack: ${(a8.hit * 100).toFixed(0)}% (want ≥ 60%)`);
  assert.ok(a3.hit <= 0.05 && a3.wrong <= 0.05, `3σ per frame stays below the bar: ${(a3.hit * 100).toFixed(0)}% true, ${(a3.wrong * 100).toFixed(0)}% at wrong distances`);
  assert.ok(a6.wrong <= 0.15, `false recovery at wrong distances or no shift at 6σ: ${(a6.wrong * 100).toFixed(0)}% (want ≤ 15%)`);
  const gains = o.rows.filter(r => r.gainTrue >= 1.4).map(r => r.id);
  assert.ok(gains.length >= 4, `≥ 4 fields gain ×1.4 or more in noise at the true distance: ${o.rows.map(r => `${r.id} ×${r.gainTrue.toFixed(2)}`).join(', ')}`);
  assert.ok(o.rows.every(r => r.gainTrue <= Math.sqrt(r.n) * 1.25), 'no field gains more than √n (the ideal) by a wide margin');
  assert.ok(o.rows.every(r => r.maskFrac >= 0.03 && r.maskFrac <= 0.65), `the star-copy mask covers 3–65% of each field: ${o.rows.map(r => `${r.id} ${(r.maskFrac * 100).toFixed(0)}%`).join(', ')}`);
});
