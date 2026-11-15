// In-app helper: the intent matcher and its knowledge base (app/js/assistant). Node, offline.
//   node tests/assistant.test.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);
const { ENTRIES, FALLBACK, SUGGESTIONS, actionLabel } = await imp('app/js/assistant/kb.js');
const { createMatcher, tokens } = await imp('app/js/assistant/match.js');
const { answer, intentAnswerer } = await imp('app/js/assistant/answer.js');
const { EXAMPLES } = await imp('app/js/field/examples.js');

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); } }
const match = createMatcher(ENTRIES);

console.log('knowledge base');
{
  const ids = ENTRIES.map(e => e.id);
  ok(new Set(ids).size === ids.length, `entry ids are unique (${ids.length} entries)`);
  ok(ENTRIES.every(e => e.q.length >= 1 && e.text && e.sources && e.sources.length), 'every entry has example questions, an answer and a source');
  ok(EXAMPLES.every(x => ids.includes('ex-' + x.id)), 'every example target has its own entry');
}

console.log('every entry is reached by its example questions');
for (const e of ENTRIES) {
  const missed = e.q.filter(q => match(q).entry?.id !== e.id).map(q => `"${q}" → ${match(q).entry?.id || 'fallback'}`);
  ok(missed.length === 0, `${e.id}${missed.length ? ': ' + missed.join(', ') : ''}`);
}

console.log('suggested questions reach their entries, in both modes');
for (const [view, list] of Object.entries(SUGGESTIONS)) for (const s of list) for (const q of [s.q, s.plain].filter(Boolean))
  ok(match(q).entry?.id === s.id, `${view}: "${q}" → ${s.id}`);

console.log('honest fallback for questions the notes do not cover');
for (const q of ['What is the weather in Paris?', 'Write me a poem about cats', 'How do I bake bread?', 'Who won the World Cup?', 'Is Pluto a planet?', 'Tell me a joke', 'asdf qwer', '', '   ', '???'])
  ok(match(q).entry === null, `"${q}" is not covered`);
{
  const r = await answer('What is the capital of France?', { mode: 'advanced' });
  ok(r.id === 'fallback' && /won’t guess/.test(r.text) && r.actions.some(a => a.type === 'help'), 'fallback says so and offers the help sheet');
  const s = await answer('What is the capital of France?', { mode: 'simple' });
  ok(s.text === FALLBACK.plain, 'fallback has a plain-words version');
}

console.log('answerer boundary: answer(question, context) → {text, actions[], sources[]}');
{
  const r = await answer('How does parallax find it?', { mode: 'advanced' });
  ok(typeof r.text === 'string' && Array.isArray(r.actions) && Array.isArray(r.sources) && r.id === 'parallax', 'shape');
  const a = await answer('What is this?', { mode: 'advanced' }), b = await answer('What is this?', { mode: 'simple' });
  ok(a.text !== b.text && b.text.length > 0, 'Simple mode gets the plain-words answer');
  for (const mode of ['live', 'snapshot', 'sim']) {
    const r = await answer('What does the badge mean?', { mode: 'advanced', source: { mode } });
    ok({ live: /Live · SPHEREx: real/, snapshot: /reads Saved SPHEREx data/, sim: /reads Simulated data/ }[mode].test(r.text), `badge answer follows the data source (${mode})`);
  }
  const mine = intentAnswerer([{ id: 'only', q: ['ping'], text: 'pong', sources: ['test'] }]);
  ok((await mine('ping')).text === 'pong', 'an answerer can be built over other entries');
}

console.log('actions drive the app only through known targets');
{
  const acts = [...ENTRIES, FALLBACK].flatMap(e => (e.actions || []).map(a => [e.id, a]));
  const bad = acts.filter(([, a]) => {
    if (a.type === 'view') return !['sky', 'compare', 'field'].includes(a.view);
    if (a.type === 'field' || a.type === 'flyto') { const x = EXAMPLES.find(e => e.id === a.example); return !x || !Number.isFinite(x.ra) || !Number.isFinite(x.dec) || x.ra < 0 || x.ra >= 360; }
    return a.type !== 'help';
  });
  ok(acts.length > 0 && bad.length === 0, `${acts.length} actions, all valid ${bad.map(([id, a]) => id + ':' + JSON.stringify(a)).join(' ')}`);
  ok(acts.every(([, a]) => actionLabel(a, 'advanced') && actionLabel(a, 'simple')), 'every action has a label in both modes');
}

console.log('honesty rule: no detections, no discoveries, limits stated');
{
  const texts = [];
  for (const e of [...ENTRIES, FALLBACK]) for (const v of [e.text, e.plain].filter(Boolean))
    for (const mode of ['live', 'snapshot', 'sim']) texts.push([e.id, typeof v === 'function' ? v({ source: { mode } }) : v]);
  const all = [...texts, ...Object.values(SUGGESTIONS).flat().flatMap(s => [['chip', s.q], ['chip', s.plain || '']]),
    ...[...ENTRIES, FALLBACK].flatMap(e => (e.actions || []).flatMap(a => [['action', actionLabel(a, 'advanced')], ['action', actionLabel(a, 'simple')]]))];
  const det = all.filter(([, t]) => /detect/i.test(t));
  ok(det.length === 0, `no text says "detect" ${det.map(([id]) => id).join(', ')}`);
  const disc = all.filter(([, t]) => /discover/i.test(t.replace(/not a discovery/gi, '')));
  ok(disc.length === 0, `"discovery" appears only as "not a discovery" ${disc.map(([id]) => id).join(', ')}`);
  const p9 = ENTRIES.find(e => e.id === 'planet9'), lim = ENTRIES.find(e => e.id === 'cannot-find');
  ok(/below SPHEREx’s single-exposure depth/.test(p9.text) && /below SPHEREx’s single-exposure depth/.test(lim.text), 'a Planet Nine-class body is stated to be below SPHEREx’s single-exposure depth');
  ok(/too faint/.test(p9.plain), 'and said plainly in Simple mode');
}

console.log('tokens');
ok(tokens('Can it find Planet 9?').includes('nine') && tokens('close-up pictures').join(' ') === 'field image', 'synonyms and plurals fold together');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
