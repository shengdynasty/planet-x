// Typed-in releases on the server, against a stand-in for IRSA (no network): a typed release is searched first, so its
// copy of a reprocessed exposure wins; one IRSA refuses is skipped and reported instead of failing the field; IRSA being
// down still fails it.   Run:  node --test tests/releases-server.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// before the server modules load: a throwaway cache, the discovered list pinned (no IRSA TAP), quiet logs
const CACHE = mkdtempSync(path.join(os.tmpdir(), 'px-rel-srv-'));
Object.assign(process.env, { PLANETX_CACHE: CACHE, PLANETX_COLLECTIONS: 'spherex_dr1', PLANETX_QUIET: '1' });
after(() => rmSync(CACHE, { recursive: true, force: true }));

const FIELDS = ['obs_id', 'energy_bandpassname', 'em_min', 'em_max', 't_min', 't_max', 't_exptime', 'access_url', 'obs_publisher_did', 'dataproduct_subtype', 'calib_level', 'obs_release_date'];
const vot = rows => `<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="OK"/><TABLE>${FIELDS.map(f => `<FIELD name="${f}" datatype="char"/>`).join('')}<DATA><TABLEDATA>${rows.map(r => `<TR>${FIELDS.map(f => `<TD>${r[f] ?? ''}</TD>`).join('')}</TR>`).join('')}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
const row = (obs, det, coll, released) => ({ obs_id: obs, energy_bandpassname: 'D' + det, em_min: 7.5e-7, em_max: 1.09e-6, t_min: 61000, t_max: 61000.01, t_exptime: 112, access_url: `https://irsa.example/${coll}/${obs}_D${det}.fits`, obs_publisher_did: `ivo://irsa/${coll}/${obs}_D${det}`, dataproduct_subtype: 'science', calib_level: 2, obs_release_date: released });
const asked = [];
globalThis.fetch = async url => {
  const coll = new URL(url).searchParams.get('COLLECTION'); asked.push(coll);
  const ok = body => new Response(body, { status: 200 });
  switch (coll) {
    case 'spherex_dr1': return ok(vot([row('A', 1, 'spherex_dr1', '2026-11-04T00:00:00'), row('C', 2, 'spherex_dr1', '2026-11-04T00:00:00')]));
    case 'spherex_dr2': return ok(vot([row('A', 1, 'spherex_dr2', '2027-05-01T00:00:00'), row('B', 1, 'spherex_dr2', '2027-05-01T00:00:00')])); // A reprocessed, B new
    case 'spherex_none': return ok(vot([]));
    case 'spherex_bad': return new Response('Unknown collection', { status: 400 });
    case 'spherex_err': return ok('<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">Unknown collection: spherex_err</INFO></RESOURCE></VOTABLE>');
    case 'spherex_down': return new Response('Proxy Error', { status: 502 });
    default: throw new Error('unexpected request ' + url);
  }
};
const { searchExposures } = await import('../server/lib/irsa.mjs');
const ids = out => out.map(e => `${e.obsId}:${e.collection}`).sort();

test('without typed releases nothing changes', async () => {
  const rep = {}, out = await searchExposures(10, 20, [], rep);
  assert.deepEqual(ids(out), ['A:spherex_dr1', 'C:spherex_dr1']);
  assert.deepEqual(rep.requestedStatus, []);
});

test('a typed release is searched first, so its copy of a reprocessed exposure is the one kept, and its count is reported', async () => {
  const rep = {}, out = await searchExposures(11, 21, ['spherex_dr2'], rep);
  assert.deepEqual(ids(out), ['A:spherex_dr2', 'B:spherex_dr2', 'C:spherex_dr1']);
  assert.equal(out.find(e => e.obsId === 'A').release, '2027-05-01T00:00:00', 'the kept copy carries its own release date');
  assert.deepEqual(rep.requestedStatus, [{ collection: 'spherex_dr2', exposures: 2, error: null }]);
});

test('a typed release IRSA refuses is skipped with its reason, an empty one is reported empty, and the rest still builds', async () => {
  const rep = {}, out = await searchExposures(12, 22, ['spherex_bad', 'spherex_err', 'spherex_none'], rep);
  assert.deepEqual(ids(out), ['A:spherex_dr1', 'C:spherex_dr1']);
  const by = Object.fromEntries(rep.requestedStatus.map(s => [s.collection, s]));
  assert.equal(by.spherex_bad.error, 'HTTP 400', 'an HTTP 4xx refusal');
  assert.match(by.spherex_err.error, /Unknown collection: spherex_err/, 'a refusal inside an HTTP 200 VOTable');
  assert.deepEqual(by.spherex_none, { collection: 'spherex_none', exposures: 0, error: null }, 'a release with nothing here');
});

test('IRSA being down still fails the search, for a typed release too, so no field is built without it', async () => {
  await assert.rejects(searchExposures(13, 23, ['spherex_down']), e => e.status === 502);
});
