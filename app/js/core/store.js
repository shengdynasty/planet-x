// Tiny shared state + event bus. Every module talks through this; no module imports another module's internals.
//
// State keys (owner in brackets; anyone may read/subscribe, only the owner should write unless noted):
//   view        'sky' | 'compare' | 'field'                 [shell]  (anyone may request via set)
//   scan        active scan id (1-based)                     [shell]
//   scans       Scan[]                                       [data]
//   candidates  Candidate[]                                  [data]   (workflow updates fields via updateCandidate)
//   selectedId  candidate id | null                          [anyone]
//   filter      { status: 'all'|CandidateStatus, sort: string, query: string }  [candidates]
//   field       { ra, dec, sizeArcsec } | null               [anyone] (setting it asks the field view to analyse that patch)
//   source      { mode: 'sim'|'live', live: boolean, note: string }  [data]
//   layers      { grid: boolean, tracks: boolean }           [shell]
//
// Events (fire-and-forget, payload in brackets):
//   'flyto'  {ra, dec, fov?}       ask the sky to centre on a position. ra and dec in DEGREES (same as `field`);
//                                  senders may add raHours for convenience, receivers must use ra/15.
//   'toast'  string                show a transient message
//   'announce' string              polite screen-reader announcement

const state = {
  view: 'sky', scan: 1, scans: [], candidates: [], selectedId: null,
  filter: { status: 'all', sort: 'id', query: '' },
  field: null, source: { mode: 'sim', live: false, note: 'Simulated data' },
  layers: { grid: true, tracks: false },
};
const subs = new Map();

export function get(key) { return key ? state[key] : state; }

export function set(key, value) {
  if (state[key] === value) return;
  const prev = state[key];
  state[key] = value;
  (subs.get(key) || []).forEach(fn => fn(value, prev));
  (subs.get('*') || []).forEach(fn => fn(key, value, prev));
}

/** Shallow-merge into an object-valued key (e.g. patch('filter', {sort:'shift'})). */
export function patch(key, partial) { set(key, { ...state[key], ...partial }); }

export function on(key, fn) {
  if (!subs.has(key)) subs.set(key, []);
  subs.get(key).push(fn);
  return () => subs.set(key, subs.get(key).filter(f => f !== fn));
}

export function emit(event, payload) { (subs.get('event:' + event) || []).forEach(fn => fn(payload)); }
export function listen(event, fn) { return on('event:' + event, fn); }

export function selected() { return state.candidates.find(c => c.id === state.selectedId) || null; }

export function updateCandidate(id, partial) {
  set('candidates', state.candidates.map(c => (c.id === id ? { ...c, ...partial } : c)));
}

if (typeof window !== 'undefined') window.__px = { get, set, patch, emit }; // debugging and headless tests
