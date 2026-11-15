// Intent matcher: picks the knowledge-base entry a question is about, or none. Pure, no DOM (Node tests import it).
// Each entry is a bag of words from its example questions and keys; a question scores each entry by the rarity (idf)
// of the words they share, single words and adjacent pairs. Below the bar, or with no shared word that means
// anything, the answer is "not covered" rather than a guess.

const STOP = new Set(('a an the is are was were be been do does did done i me my you your it its this that these those to of in on at for '
  + 'with and or but if so how what why when where which who whom can could would should will shall may might must there here about '
  + 'tell show give get make let please just any some much many very really thing things one ones by from as into than then them they '
  + 'we our us have has had not no yes up out also more most all lot like want need know see look use using used am planet x mean means work works made').split(' '));

// words that mean the same here
const SYN = {
  pictures: 'image', picture: 'image', photos: 'image', photo: 'image', images: 'image', frames: 'image', frame: 'image', exposures: 'image', exposure: 'exposure',
  colour: 'color', colours: 'color', colors: 'color', analyze: 'analyse', analysis: 'analyse', catalog: 'catalogue', catalogs: 'catalogue', catalogues: 'catalogue',
  limitations: 'limit', limits: 'limit', limitation: 'limit', cant: 'cannot', 'can’t': 'cannot', "can't": 'cannot', unable: 'cannot',
  p9: 'nine', '9': 'nine', ix: 'nine', planetx: 'planet', closeup: 'field', 'close-up': 'field', simulation: 'simulated', simulate: 'simulated', fake: 'simulated', practice: 'simulated',
  flip: 'blink', flipping: 'blink', blinking: 'blink', shortcuts: 'shortcut', hotkeys: 'shortcut', keys: 'shortcut', key: 'shortcut',
  examples: 'example', targets: 'target', movers: 'mover', moving: 'move', moved: 'move', moves: 'move', motion: 'move',
  deep: 'depth', deeper: 'depth',
  discovered: 'discovery', discover: 'discovery', find: 'find',
};

export function tokens(text) {
  return String(text).toLowerCase().replace(/[’']/g, '').replace(/planet\s*(nine|9)/g, 'nine').replace(/close-up/g, 'closeup')
    .split(/[^a-z0-9µ]+/).filter(Boolean)
    .map(w => SYN[w] || w)
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .map(w => SYN[w] || w)
    .filter(w => !STOP.has(w));
}
const pairs = t => t.slice(1).map((w, i) => t[i] + ' ' + w);
const phrase = text => String(text).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9µ]+/g, ' ').trim();

/** Build a matcher over knowledge-base entries. */
export function createMatcher(entries, { bar = 1.2 } = {}) {
  const bags = entries.map(e => {
    const bag = new Map();
    const add = (w, n) => bag.set(w, Math.max(bag.get(w) || 0, n));
    for (const q of e.q) { const t = tokens(q); t.forEach(w => add(w, 1)); pairs(t).forEach(p => add(p, 1.5)); }
    for (const k of e.keys || []) tokens(k).forEach(w => add(w, 0.8));
    return bag;
  });
  const df = new Map();
  for (const bag of bags) for (const w of bag.keys()) df.set(w, (df.get(w) || 0) + 1);
  const idf = w => Math.log(1 + entries.length / (df.get(w) || entries.length));
  const exact = new Map(entries.flatMap(e => e.q.map(q => [phrase(q), e])));

  return function match(question) {
    const hit = exact.get(phrase(question)); // an example question as written, even one made only of common words
    if (hit) return { entry: hit, score: Infinity };
    const t = tokens(question);
    if (!t.length) return { entry: null, score: 0 };
    const words = [...new Set([...t, ...pairs(t)])];
    let best = null, bestScore = 0;
    bags.forEach((bag, i) => {
      let s = 0;
      for (const w of words) if (bag.has(w)) s += bag.get(w) * idf(w);
      s /= Math.sqrt(t.length); // long questions don't win by length alone
      if (s > bestScore) { bestScore = s; best = entries[i]; }
    });
    return bestScore >= bar ? { entry: best, score: bestScore } : { entry: null, score: bestScore };
  };
}
