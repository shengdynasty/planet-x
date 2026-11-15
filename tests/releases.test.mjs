// Release labels, typed-in releases and field files. Offline: no IRSA, no browser.  Run:  node --test tests/releases.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectionsParam } from '../server/index.mjs';
import { isCollectionName } from '../server/lib/irsa.mjs';
import { parseReleases, addReleases, requestedStatusText, releaseLabel, fieldReleases, toField, fieldFileText, fieldFileName, parseFieldFile, getReleases, setReleases, RELEASES_KEY } from '../app/js/data/index.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/spherex-psyche-field-v3.json', import.meta.url), 'utf8'));
const sp = q => new URL('http://x/?' + q).searchParams;

test('server accepts spherex_* collection names and rejects anything else with a 400', () => {
  assert.deepEqual(collectionsParam(sp('collections=spherex_dr2,SPHEREX_qr4')), ['spherex_dr2', 'spherex_qr4']);
  assert.deepEqual(collectionsParam(sp('ra=1')), []);
  for (const bad of ['foo', "spherex_dr2'--", 'spherex_dr2_cal', 'spherex_deep', 'spherex_x_cube', 'spherex_a,spherex_b,spherex_c,spherex_d,spherex_e', 'spherex_', '../spherex_dr2'])
    assert.throws(() => collectionsParam(sp('collections=' + encodeURIComponent(bad))), e => e.status === 400, bad);
  assert.ok(isCollectionName('spherex_dr2') && !isCollectionName('irsa_x') && !isCollectionName(7));
});

test('typed releases: shorthand, case, duplicates, junk, limit', () => {
  assert.deepEqual(parseReleases('dr2, SPHEREX_qr4  dr2'), { list: ['spherex_dr2', 'spherex_qr4'], bad: [] });
  assert.deepEqual(parseReleases('hello spherex_dr3_cal'), { list: [], bad: ['hello', 'spherex_dr3_cal'] });
  assert.deepEqual(parseReleases(''), { list: [], bad: [] });
  const many = parseReleases('dr1 dr2 dr3 dr4 dr5');
  assert.equal(many.list.length, 4); assert.deepEqual(many.bad, ['spherex_dr5']);
});

test('adding releases says what happened instead of dropping names quietly', () => {
  assert.deepEqual(addReleases([], 'dr2'), { list: ['spherex_dr2'], added: ['spherex_dr2'], already: [], bad: [], full: false });
  const four = ['spherex_dr2', 'spherex_dr3', 'spherex_dr4', 'spherex_dr5'];
  assert.deepEqual(addReleases(four, 'dr6'), { list: four, added: [], already: [], bad: [], full: true }, 'a fifth is refused, the list stays');
  assert.deepEqual(addReleases(['spherex_dr2'], 'DR2'), { list: ['spherex_dr2'], added: [], already: ['spherex_dr2'], bad: [], full: false });
  assert.deepEqual(addReleases(['spherex_dr2'], 'banana dr3'), { list: ['spherex_dr2'], added: [], already: [], bad: ['banana'], full: false }, 'nothing is added beside a bad word');
  const five = addReleases([], 'dr1 dr2 dr3 dr4 dr5');
  assert.equal(five.full, true); assert.deepEqual(five.bad, [], 'five good names at once are "too many", not "bad"'); assert.deepEqual(five.list, []);
});

test('a typed release says what this field got from it', () => {
  const f = { source: { requestedStatus: [{ collection: 'spherex_dr2', exposures: 12, error: null }, { collection: 'spherex_dr9', exposures: 0, error: 'HTTP 400' }, { collection: 'spherex_dr3', exposures: 0, error: null }] } };
  assert.equal(requestedStatusText(f, 'spherex_dr2'), '12 exposures here');
  assert.equal(requestedStatusText(f, 'spherex_dr9'), 'IRSA refused it (HTTP 400)');
  assert.equal(requestedStatusText(f, 'spherex_dr3'), 'no exposures here yet');
  assert.equal(requestedStatusText(f, 'spherex_dr4'), '', 'not asked with this field');
  assert.equal(requestedStatusText({}, 'spherex_dr2'), ''); assert.equal(requestedStatusText(null, 'spherex_dr2'), '');
});

test('typed releases are kept between visits and cleaned on the way in and out', () => {
  const mem = new Map(); globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  try {
    assert.deepEqual(getReleases(), []);
    assert.deepEqual(setReleases(['spherex_dr2', 'spherex_dr2', 'nonsense']), ['spherex_dr2']);
    assert.deepEqual(getReleases(), ['spherex_dr2']);
    mem.set(RELEASES_KEY, '{"not":"a list"}'); assert.deepEqual(getReleases(), []);
    mem.set(RELEASES_KEY, 'not json'); assert.deepEqual(getReleases(), []);
  } finally { delete globalThis.localStorage; }
});

test('each image says which release it came from', () => {
  assert.equal(releaseLabel({ collection: 'spherex_dr1', release: '2026-11-04T00:00:00' }), 'spherex_dr1 · released 4 Nov 2026');
  assert.equal(releaseLabel({ collection: 'spherex_dr1', release: 61343 }), 'spherex_dr1 · released 30 Oct 2026'); // MJD works too
  assert.equal(releaseLabel({ collection: 'spherex_qr3' }), 'spherex_qr3');
  assert.equal(releaseLabel({}), ''); assert.equal(releaseLabel(null), '');
  const f = toField(fixture());
  f.epochs = f.epochs.map((e, i) => ({ ...e, collection: i < 2 ? 'spherex_dr1' : 'spherex_qr3', release: i < 2 ? '2026-11-04T00:00:00' : '2026-09-01T00:00:00' }));
  const r = fieldReleases(f);
  assert.deepEqual(r.map(x => x.collection), ['spherex_dr1', 'spherex_qr3']);
  assert.equal(r[0].n, 2); assert.equal(r[0].release, '4 Nov 2026'); assert.equal(r[1].n, f.epochs.length - 2);
  assert.deepEqual(fieldReleases({ epochs: [{ t: 0 }] }), []); // simulated or old files: nothing to list
});

test('a saved field file opens to the same pixels, and says it came from a file', () => {
  const j = fixture(), f = toField(j);
  const g = parseFieldFile(fieldFileText(f), 'x.json');
  assert.equal(g.N, f.N); assert.equal(g.epochs.length, f.epochs.length); assert.equal(g.simulated, false);
  for (let i = 0; i < f.epochs.length; i++) assert.deepEqual([...g.frame(i)], [...f.frame(i)]);
  assert.equal(g.known.length, f.known.length); assert.equal(g.stars.length, f.stars.length);
  assert.deepEqual(g.fromFile, { name: 'x.json', savedAt: j.builtAt || null });
  assert.equal(g.request.ra, j.ra0);
  assert.match(fieldFileName(f), /^planetx-field-[\d.]+[+-][\d.]+-D\d\.json$/);
});

test('a file that is not a field is refused with a reason, never half-loaded', () => {
  const j = fixture(), text = o => JSON.stringify(o);
  assert.throws(() => parseFieldFile('this is not json'), /not JSON/);
  assert.throws(() => parseFieldFile('[1,2]'), /expected an object/);
  assert.throws(() => parseFieldFile(text({ ...j, simulated: true })), /simulated/);
  assert.throws(() => parseFieldFile(text({ ...j, N: undefined })), /N missing/);
  assert.throws(() => parseFieldFile(text({ ...j, frames: [j.frames[0]] })), /at least two frames/);
  assert.throws(() => parseFieldFile(text({ ...j, epochs: j.epochs.slice(1) })), /epochs do not match/);
  assert.throws(() => parseFieldFile(text({ ...j, frames: [j.frames[0].slice(0, 100), ...j.frames.slice(1)] })), /too short/);
  assert.throws(() => parseFieldFile(text({ ...j, ra0: 'x' })), /ra0 missing/);
  assert.throws(() => fieldFileText({ simulated: true }), /nothing to save/);
});
