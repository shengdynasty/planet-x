// The answerer boundary. The panel only ever calls answer(question, context) and gets back
//   { text, actions[], sources[], id }
// context: { mode: 'simple' | 'advanced', view, source } (store values the answer may depend on).
//
// Today the one answerer is the intent matcher over kb.js, fully offline. A second answerer (Gemini through Firebase
// AI Logic, knowledge base as its only context, the same actions as function declarations) can sit behind the same
// signature later and fall back to this one when it is unreachable or out of quota; it is not built.
import { ENTRIES, FALLBACK } from './kb.js';
import { createMatcher } from './match.js';

const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

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

export const answer = intentAnswerer();
