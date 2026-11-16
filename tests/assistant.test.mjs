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

console.log('everyday questions are not caught by generic words');
for (const [q, id] of [['what does 3.3 micron mean', 'wavelength'], ['how accurate are the positions', 'can-find']])
  ok(match(q).entry?.id === id, `"${q}" → ${id} (got ${match(q).entry?.id || 'fallback'})`);

console.log('honest fallback for questions the notes do not cover');
for (const q of ['What is the weather in Paris?', 'Write me a poem about cats', 'How do I bake bread?', 'Who won the World Cup?', 'Is Pluto a planet?', 'Tell me a joke', 'does it work on my phone', 'who made this', 'asdf qwer', '', '   ', '???'])
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

console.log('Gemini answerer (a stand-in for Gemini: offline)');
{
  const { hybridAnswerer, AI_SOURCE } = await imp('app/js/assistant/answer.js');
  const g = await imp('app/js/assistant/gemini.js');
  const OFF_TOPIC = 'What is the capital of France?';
  const calls = [];
  const stub = reply => async (q, opts) => { calls.push({ q, opts }); if (reply instanceof Error) throw reply; return reply; };
  ok((await intentAnswerer()(OFF_TOPIC)).id === 'fallback', 'the test question is one the notes have no entry for');

  let a = hybridAnswerer({ gemini: stub('Paris is not in my notes.'), allowed: () => true });
  let r = await a('How does parallax work?', { mode: 'advanced' });
  ok(r.id === 'parallax' && !r.ai && calls.length === 0, 'a question the notes cover is answered from them and Gemini is not asked');
  r = await a(OFF_TOPIC, { mode: 'advanced', view: 'sky' });
  ok(r.id === 'ai' && r.ai === true && r.text === 'Paris is not in my notes.' && r.actions.length === 0 && r.sources[0] === AI_SOURCE, 'a question the notes miss goes to Gemini, marked as an AI answer with its source');
  ok(calls.length === 1 && calls[0].opts.entries.length === ENTRIES.length && calls[0].opts.context.view === 'sky', 'Gemini gets the question, every note and the context');
  ok(/can be wrong/.test(AI_SOURCE), 'the AI source line says it can be wrong');

  for (const [why, reply] of [['replies that the notes do not cover it', null], ['fails (offline, quota or timeout)', new Error('quota')]]) {
    r = await hybridAnswerer({ gemini: stub(reply), allowed: () => true })(OFF_TOPIC, { mode: 'advanced' });
    ok(r.id === 'fallback' && r.actions.some(x => x.type === 'help'), `when Gemini ${why}, the offline "not in my notes" answer is given`);
  }
  const before = calls.length;
  r = await hybridAnswerer({ gemini: stub('x'), allowed: () => false })(OFF_TOPIC, { mode: 'simple' });
  ok(r.id === 'fallback' && calls.length === before, 'switched off (tests, ?ai=off): Gemini is never asked');
  ok(g.geminiAllowed() === false && (await answer(OFF_TOPIC)).id === 'fallback', 'outside a browser it is off, so the default answerer stays offline here');

  ok(g.cleanAnswer('NOT_IN_NOTES') === null && g.cleanAnswer('  ') === null, '"not in my notes" and empty replies are not shown');
  ok(g.cleanAnswer('**Parallax** is the `shift`.') === 'Parallax is the shift.', 'markdown is stripped to plain text');
  ok(g.cleanAnswer('Passes come from spherex_dr1 and spherex_qr3.') === 'Passes come from spherex_dr1 and spherex_qr3.', 'underscores in release names survive');
  ok(g.cleanAnswer('We discovered a new planet in this field.') === null && g.cleanAnswer('The app has found Planet Nine.') === null, 'a claim that a planet was found is never shown');
  ok(g.cleanAnswer('The app has not found Planet Nine; it lists candidates.') !== null, 'saying it has not found one is fine');
  ok(g.cleanAnswer('The detector arrays see 102 bands.', { mode: 'advanced' }) !== null && g.cleanAnswer('It can detect asteroids.', { mode: 'simple' }) === null, '"detect" is dropped only in Simple mode, like the notes');
  ok(g.cleanAnswer('word '.repeat(400)).length <= 901, 'a runaway reply is cut short');

  const sys = g.systemInstruction(ENTRIES, { mode: 'advanced', view: 'sky', source: 'snapshot' });
  ok(ENTRIES.every(e => sys.includes(`[${e.id}] `)) && !/=>|function\s*\(/.test(sys), 'the instruction carries every note, with context-dependent notes resolved to text');
  ok(sys.includes(g.NOT_IN_NOTES) && /only the notes/.test(sys) && /Never say that the app or the team discovered/.test(sys), 'and the rules: only the notes, say when they do not cover it, never claim a discovery');
  ok(/plain words/.test(g.promptFor('q', { mode: 'simple' })) && !/plain words/.test(g.promptFor('q', { mode: 'advanced' })) && /Question: q$/.test(g.promptFor('q', {})), 'the question goes last, with a plain-words request in Simple mode only');
  ok(g.MODEL === 'gemini-3.5-flash-lite' && g.FIREBASE_CONFIG.projectId === 'planet-x-spherex' && /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\/$/.test(g.SDK_BASE), 'model, project and a pinned SDK version');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
