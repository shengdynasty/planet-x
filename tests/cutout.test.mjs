// ISS-10: Movers panel and Compare share one cutout generator; RA wrap handled. Plain Node:  node tests/cutout.test.mjs
import * as A from '../app/js/compare/cutout.js';
import * as B from '../app/js/candidates/cutout.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
function ctx() { const log = []; return { log,
  fillStyle: '', fillRect: (...a) => log.push(['r', ...a.map(v => +v.toFixed(3))]),
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: (d) => log.push(['p', d.data.reduce((s, v) => s + v, 0)]),
  createRadialGradient: (...a) => (log.push(['g', ...a.map(v => +v.toFixed(3))]), { addColorStop() {} }) }; }
const cand = (id, pos, extra = {}) => ({ id, pos, status: 'Candidate', pipelineStatus: 'Unmatched', ...extra });
const c = cand('c03', [[1.0, 10], [1.0001, 10.001], [1.0002, 10.002]]);
const a = ctx(), b = ctx(); const ra = A.renderCutout(a, 128, c, 2), rb = B.renderCutout(b, 128, c, 2, 2);
ok(JSON.stringify(a.log) === JSON.stringify(b.log) && JSON.stringify(ra) === JSON.stringify(rb), 'both import paths draw identical pixels for the same candidate');
const c2 = cand('c07', c.pos), x = ctx(), y = ctx(); A.renderCutout(x, 128, c, 1); A.renderCutout(y, 128, c2, 1);
ok(JSON.stringify(x.log) !== JSON.stringify(y.log), 'different candidates get different star fields');
// track crossing RA 0h (hours: 23.9999 → 0.0001): the mover moves a little, not ~24 h, so it is not pinned to the edge
const wrap = cand('c09', [[23.9999, 0], [0.0001, 0]]), nowrap = cand('c09', [[11.9999, 0], [12.0001, 0]]);
const w1 = A.renderCutout(ctx(), 256, wrap, 2), w2 = A.renderCutout(ctx(), 256, nowrap, 2);
ok(Math.abs(w1[0] - w2[0]) < 1e-6 && Math.abs(w1[0] - 128) < 128 * 0.35 - 1e-6, `RA wrap matches the no-wrap case (x ${w1[0].toFixed(2)} vs ${w2[0].toFixed(2)}, not pinned)`);
const miss = A.renderCutout(ctx(), 128, cand('c01', [null, [1, 1]]), 1);
ok(miss[2] === null, 'unobserved scan draws the field only');
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
