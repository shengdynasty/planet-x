// The answerer boundary. The panel only ever calls answer(question, context) and gets back
//   { text, actions[], sources[], id, ai? }
// context: { mode: 'simple' | 'advanced', view, source } (store values the answer may depend on).
//
// Two answerers behind it. The intent matcher over kb.js (offline, instant, every answer hand-checked) answers
// everything it has an entry for. Only a question it has no entry for goes to Gemini through Firebase AI Logic
// (gemini.js), with the knowledge base as Gemini's only context; that answer is marked as AI and says it can be wrong.
// Gemini is off under test automation and with ?ai=off, and any failure (offline, quota, timeout, "not in my notes")
// gives the matcher's own fallback answer, so the panel never depends on it.
import { ENTRIES, FALLBACK } from './kb.js';
import { createMatcher } from './match.js';
import { askGemini, geminiAllowed } from './gemini.js';

const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/** Where an AI answer came from, shown under it. */
export const AI_SOURCE = 'Gemini (Google) through Firebase AI Logic, using only this helper’s notes. It can be wrong';

/** Answerer backed by the intent matcher. */
export function intentAnswerer(entries = ENTRIES) {
  const match = createMatcher(entries);
  return async function answer(question, context = {}) {
    const entry = match(question).entry || FALLBACK;
    const simple = context.mode === 'simple';
    return {
      id: entry.id,
      text: resolve(simple && entry.plain ? entry.plain : entry.text, context),
      actions: (entry.actions || []).map(a => ({ ...a })),
      sources: [...(entry.sources || [])],
    };
  };
}

/** The matcher first; Gemini only for what it has no entry for, and the matcher's fallback if Gemini can't help. */
export function hybridAnswerer({ entries = ENTRIES, gemini = askGemini, allowed = geminiAllowed } = {}) {
  const base = intentAnswerer(entries);
  return async function answer(question, context = {}) {
    const res = await base(question, context);
    if (res.id !== FALLBACK.id || !allowed()) return res;
    try {
      const text = await gemini(question, { entries, context });
      if (!text) return res;
      return { id: 'ai', text, actions: [], sources: [AI_SOURCE], ai: true };
    } catch (err) {
      console.warn('[planet-x] helper: Gemini unavailable, giving the offline answer', err);
      return res;
    }
  };
}

export const answer = hybridAnswerer();
