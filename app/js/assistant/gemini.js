// Gemini through Firebase AI Logic: the helper's second answerer. answer.js asks it only when the knowledge base has no
// entry for a question, gives it the knowledge base as its only context, and falls back to "not in my notes" whenever it
// is switched off, unreachable, slow or out of quota, or replies that the notes don't cover the question.
//
// Firebase project planet-x-spherex, on the no-cost Spark plan, with the Gemini Developer API. The web config and the
// reCAPTCHA Enterprise site key below are public by design: they identify the app and appear in every page that uses
// them, so they are not secrets. App Check (Fraud Defense, formerly reCAPTCHA Enterprise) vouches that requests come
// from this site; the key accepts shengdynasty.github.io and localhost. The SDK loads from Google's CDN on the first
// question that needs it, never on page load.
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyDbW81vfqIwPNZnXkNH0CgqGWsJbYX-Vck',
  authDomain: 'planet-x-spherex.firebaseapp.com',
  projectId: 'planet-x-spherex',
  storageBucket: 'planet-x-spherex.firebasestorage.app',
  messagingSenderId: '145152994011',
  appId: '1:145152994011:web:a1063f3a0d7fbb4672fafe',
});
export const RECAPTCHA_SITE_KEY = '6LdA7iEuAAAAAEaFMJAMtnT0x6LUuG41LKHRdBYh';
export const MODEL = 'gemini-3.5-flash-lite'; // answered in under a second when tried; gemini-2.5-flash is retired here
export const SDK_BASE = 'https://www.gstatic.com/firebasejs/13.3.0/';
export const TIMEOUT_MS = 15000;
export const NOT_IN_NOTES = 'NOT_IN_NOTES';

/** May this page call Gemini? Off with ?ai=off and under browser automation (navigator.webdriver), so the test suites
 *  stay offline; ?ai=on forces it on. Always off outside a browser. */
export function geminiAllowed() {
  if (typeof location === 'undefined' || typeof navigator === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('ai');
  if (q === 'off') return false;
  if (q === 'on') return true;
  return !navigator.webdriver;
}

const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/** The system instruction: the rules, then every knowledge-base entry's text for this context as the notes. */
export function systemInstruction(entries, context = {}) {
  const notes = entries.map(e => `[${e.id}] ${resolve(e.text, context)}`).join('\n');
  return [
    'You are the in-app helper of Planet X, a web app built for the NASA Space Apps 2026 challenge "Planet X and SPHEREx".',
    "Answer the user's question using only the notes below, which are the app's own documentation.",
    `If the notes do not answer it, or it is not about the app, astronomy or the challenge, reply with exactly ${NOT_IN_NOTES} and nothing else.`,
    'Keep it short: at most three sentences of plain text, with no markdown, lists or links.',
    'Never say that the app or the team discovered or confirmed a planet or any new object: the app finds candidates for people to check.',
    'Use only numbers that appear in the notes.',
    '',
    'NOTES:',
    notes,
  ].join('\n');
}

/** The user turn: the question, with the context it may depend on. */
export function promptFor(question, context = {}) {
  const lines = [];
  if (context.view) lines.push(`The user is in the ${context.view} view.`);
  if (context.mode === 'simple') lines.push('Answer in plain words for someone new to astronomy, and do not use the words "detect", "detection" or "detector".');
  lines.push(`Question: ${question}`);
  return lines.join('\n');
}

/** The model's reply as display text, or null when it must not be shown: empty, "not in my notes", a claim that a
 *  planet was found, or (in Simple mode) the word "detect", which the Simple-mode text never uses. */
export function cleanAnswer(text, context = {}) {
  const raw = String(text || '');
  if (raw.includes(NOT_IN_NOTES)) return null;
  // markdown emphasis, code ticks and heading marks only: underscores stay (release names such as spherex_dr1)
  let t = raw.replace(/[`*]+/g, '').replace(/^\s*#+\s*/gm, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\b(we|the team|planet x|the app|this app|it)\s+(has\s+|have\s+)?(discovered|confirmed|found)\s+(a\s+|the\s+)?(new\s+)?(planet|planet nine|planet x)\b/i.test(t)) return null;
  if (context.mode === 'simple' && /detect/i.test(t)) return null;
  if (t.length > 900) t = t.slice(0, 900).replace(/\s+\S*$/, '') + '…';
  return t;
}

let aiPromise = null;
/** Load the SDK from the CDN and set up the app, App Check and the AI service, once; a failed load is retried next time. */
function loadAI() {
  if (!aiPromise) {
    aiPromise = (async () => {
      const [{ initializeApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider }, { getAI, getGenerativeModel, GoogleAIBackend }] =
        await Promise.all(['firebase-app.js', 'firebase-app-check.js', 'firebase-ai.js'].map(f => import(SDK_BASE + f)));
      const app = initializeApp(FIREBASE_CONFIG, 'planet-x-helper');
      try { initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true }); }
      catch (err) { console.warn('[planet-x] helper: App Check unavailable', err); }
      return { ai: getAI(app, { backend: new GoogleAIBackend() }), getGenerativeModel };
    })().catch(err => { aiPromise = null; throw err; });
  }
  return aiPromise;
}

/** Ask Gemini. Resolves to display text, or null when the reply must not be shown; rejects on network, quota or
 *  timeout errors, and the caller then gives the offline answer. */
export async function askGemini(question, { entries, context = {} } = {}) {
  const { ai, getGenerativeModel } = await loadAI();
  const model = getGenerativeModel(ai, {
    model: MODEL,
    systemInstruction: systemInstruction(entries, context),
    generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
  });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Gemini timed out')), TIMEOUT_MS); });
  try {
    const r = await Promise.race([model.generateContent(promptFor(question, context)), timeout]);
    return cleanAnswer(r.response.text(), context);
  } finally { clearTimeout(timer); }
}
