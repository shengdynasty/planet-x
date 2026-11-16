// The helper's knowledge base: short hand-written answers drawn from docs/WRITEUP.md, README.md and the help sheet in
// app/index.html. Pure data, no DOM, so Node tests import it. The helper answers from these entries only.
//
// Entry: { id, q: [example questions], keys: [extra words], text, plain?, actions?, sources }
//   text   the answer in Advanced mode; a function (ctx) → string when it depends on the app's state
//   plain  the same answer in Simple mode's plain words (falls back to text)
//   actions buttons under the answer, run by the panel through the store:
//     { type: 'view', view: 'sky' | 'compare' | 'field' }   { type: 'field', example: <EXAMPLES id> }
//     { type: 'flyto', example: <EXAMPLES id> }             { type: 'help' }
//   sources where the answer comes from, shown under it
// Honesty rule (app/ARCHITECTURE.md): nothing here is ever called a detection or a discovery; flags are candidates.
import { EXAMPLES } from '../field/examples.js';

const WRITEUP = 'Write-up';
const SRC = {
  summary: `${WRITEUP} · Summary`,
  problem: `${WRITEUP} · The problem`,
  how: `${WRITEUP} · How it works`,
  can: `${WRITEUP} · What the tool can and cannot find`,
  built: `${WRITEUP} · What we built`,
  real: `${WRITEUP} · What is real and what is simulated`,
  limits: `${WRITEUP} · Limitations and risks`,
  readme: 'README',
  help: 'Help sheet',
};

export const ENTRIES = [
  {
    id: 'about',
    q: ['What is this?', 'What is Planet X?', 'What does this app do?', 'What is this tool for?'],
    keys: ['about', 'purpose', 'app', 'tool'],
    text: 'Planet X looks for a distant, unknown planet by its parallax in SPHEREx’s infrared maps of the whole sky. For a patch of sky it lines up the pictures from every pass, flags sources that shift, appear or vanish against the fixed stars, and checks each flag against JPL’s known asteroids and comets and Gaia’s stars. Whatever is left is a candidate for a person to vet, never a confirmed object.',
    plain: 'Somewhere far past Neptune there might be another planet. NASA’s SPHEREx telescope photographs the whole sky every six months, so this app compares the pictures and looks for dots that moved. Anything that moved and is not a known object is a possible new object: a lead for a person to check, not a find.',
    sources: [SRC.summary, SRC.help],
  },
  {
    id: 'parallax',
    q: ['How does parallax find it?', 'How does it work?', 'Why compare pictures six months apart?', 'Why does a distant planet move?', 'How far does Planet X move?'],
    keys: ['parallax', 'move', 'motion', 'orbit', 'jump', 'baseline', 'shift', 'distance', 'au', 'works'],
    text: 'SPHEREx looks about 90° from the Sun, so its two passes over a patch, six months apart, see it from opposite sides of Earth’s orbit: a 2 AU baseline. A body at 500 AU jumps 825″ (134 pixels) between those passes, far more than its own orbital motion (58″ in six months). Within one pass, where the same patch is re-imaged 1–18 days apart, it drifts about 7″ a day. Between passes a body closer than about 1,500 AU leaves a 300″ cutout entirely, so it shows up as a source that vanished in one cutout and a new source in another.',
    plain: 'As Earth goes around the Sun, nearby things seem to shift against faraway stars, the way your thumb jumps when you close one eye and then the other. SPHEREx sees each patch of sky from opposite sides of Earth’s orbit six months apart, so a distant planet would jump a long way between the two pictures, and drift a little between pictures taken a few days apart.',
    sources: [SRC.problem],
  },
  {
    id: 'planet9',
    q: ['Can it find Planet Nine?', 'Could SPHEREx see Planet Nine?', 'Is Planet Nine bright enough?', 'Has it found Planet X?'],
    keys: ['nine', 'p9', 'bright', 'faint', 'depth', 'exposure', 'found'],
    text: 'No. A Planet Nine-class body is below SPHEREx’s single-exposure depth. Our 7σ limit for one exposure is about AB 17.0–17.5 in the cleanest saved fields. A nominal 10 Earth-mass planet at 700 AU is 5–6.5 mag fainter than our 3–5 µm limits, and even the most optimistic published model is 1.3–2.0 mag short. SPHEREx’s full depth needs all its passes added together, which works only once the body’s orbit is known. So the tool’s reach is nearer, larger or warmer bodies than Planet Nine, and nothing has been found.',
    plain: 'No, not on its own. A Planet Nine-sized world would be too faint to show up in a single SPHEREx picture. The app can reach things that are closer, bigger or warmer, and nothing has been found so far.',
    actions: [{ type: 'help' }],
    sources: [SRC.can],
  },
  {
    id: 'can-find',
    q: ['What can the tool find?', 'What can it find?', 'How sensitive is it?', 'What is it good at?'],
    keys: ['sensitive', 'recover', 'recovery', 'injection', 'reach', 'good', 'accurate', 'accuracy', 'precise', 'error', 'position'],
    text: 'Measured by planting synthetic movers into real frames: within one pass it reports 80–91% of bodies at 300–1,000 AU that reach 12σ in a single exposure and move 18–90″, with a median position error of 0.9″ and no false movers on the six un-injected real pairs. Between passes it reports a source that vanished 91–97% of the time and a new source with no counterpart 76–93%; a cross-field linker joins the two halves. Anything beyond about 1,500 AU stays inside a 600″ cutout and is handled like any other mover.',
    plain: 'It is good at bright, fairly close movers: in tests where fake movers were added to real telescope pictures, it spotted most of the bright ones that moved a few pixels. Fainter or slower ones get missed.',
    sources: [SRC.can],
  },
  {
    id: 'cannot-find',
    q: ['What can’t it find?', 'What are the limits?', 'What are the limitations?', 'What does it miss?'],
    keys: ['limit', 'limitation', 'miss', 'cannot', 'cant', 'weakness', 'risk'],
    text: 'It cannot find anything fainter than about 7σ in one exposure (a nominal 8σ source gets through one time in five, a 4σ source never), shifts under 13″ (2.2 px) in a pair, a mover within 3 px of a brighter star, or anything outside the patches someone asks for: the search is per cutout, not all-sky. A Planet Nine-class body is below SPHEREx’s single-exposure depth. Two epochs only show a source is consistent with motion; three or more and an orbit fit are needed before any claim.',
    plain: 'It misses anything too faint for one picture, anything that moved less than about two pixels, anything right next to a bright star, and every part of the sky nobody asked it to look at. A Planet Nine-sized world is too faint for it. Two pictures only show something might be moving; it takes more pictures and an orbit to say anything for sure.',
    sources: [SRC.can, SRC.limits],
  },
  {
    id: 'candidate',
    q: ['What is a candidate?', 'Is this a discovery?', 'Did it find a new planet?', 'Are the flags real objects?'],
    keys: ['candidate', 'flag', 'flagged', 'confirm', 'confirmed', 'real', 'vet', 'claim'],
    text: 'A candidate is a source that moved, appeared or vanished and matches no known asteroid, comet or Gaia star. It is a lead for a person to vet, not a confirmed object and not a discovery. Brown dwarfs, variable stars, cosmic rays, hot pixels and mis-paired sources can all look like movers, so even a candidate that passes every check needs a third epoch and an orbit fit before it is anything.',
    plain: 'A possible new object is just something that moved and is not on a list of known objects. It is a lead for a person to check. It is not a discovery: camera glitches and ordinary stars can fool it, and it takes more pictures to be sure.',
    sources: [SRC.how, SRC.help],
  },
  {
    id: 'data',
    q: ['Where does the data come from?', 'What are the data sources?', 'Is this real NASA data?', 'Which catalogues does it use?'],
    keys: ['source', 'irsa', 'jpl', 'gaia', 'catalogue', 'catalog', 'archive', 'nasa', 'credit'],
    text: 'SPHEREx exposures come from NASA/IPAC IRSA (every current all-sky collection, found automatically, with each frame’s wavelength read from its own file). Known asteroids and comets come from JPL’s Small-Body Identification service and Horizons; stars and their proper motions from Gaia DR3 (ESA). The sky picture is NASA/Goddard SVS’s Deep Star Maps 2020. Spectra are measured from the same SPHEREx exposures.',
    plain: 'The telescope pictures are from NASA’s SPHEREx, through NASA’s IRSA archive. The list of known asteroids and comets is from NASA JPL, and star positions are from ESA’s Gaia mission. The sky picture is from NASA’s Scientific Visualization Studio.',
    sources: [SRC.how, SRC.real],
  },
  {
    id: 'badge',
    q: ['What does the badge mean?', 'Is this data live, saved or simulated?', 'What does Simulated data mean?', 'What does Saved SPHEREx data mean?'],
    keys: ['badge', 'label', 'live', 'saved', 'snapshot', 'simulated', 'practice', 'mode'],
    text: ctx => {
      const m = ctx && ctx.source && ctx.source.mode;
      const now = m === 'live' ? 'Right now it reads Live · SPHEREx: real SPHEREx images fetched from IRSA through the local server, for any position, cross-matched against JPL.'
        : m === 'snapshot' ? 'Right now it reads Saved SPHEREx data: real SPHEREx images, JPL known objects and Gaia stars for the six example targets, saved on the date in the badge’s tooltip and analysed in your browser. Any other position falls back to the simulation and says so.'
        : 'Right now it reads Simulated data: placeholder scans and movers made up for the demo. Nothing in them is real.';
      return `The badge in the top bar always says where the data comes from. ${now} The three states are Live · SPHEREx (local server), Saved SPHEREx data (six saved targets) and Simulated data.`;
    },
    plain: ctx => {
      const m = ctx && ctx.source && ctx.source.mode;
      const now = m === 'live' ? 'Right now you are looking at live telescope photos, straight from NASA for any place you pick.'
        : m === 'snapshot' ? 'Right now you are looking at real telescope photos, saved for six example places.'
        : 'Right now you are looking at practice data made up for the demo.';
      return `The label in the top bar says where the pictures come from. ${now} Practice data is made up, real telescope photos are saved for six places, and live photos come straight from NASA.`;
    },
    sources: [SRC.help, SRC.real],
  },
  {
    id: 'real-sim',
    q: ['What is real and what is simulated?', 'Is anything here made up?'],
    keys: ['simulation', 'fake', 'placeholder', 'model', 'made'],
    text: 'Real: SPHEREx exposures and their pipeline flags, JPL known objects, Gaia DR3 stars and the sky backdrop, with the server running, and for the six example targets saved in the repository. Simulated: without the server or the saved fields, the scans, the movers in the review panel and the Field view’s field, all labelled Simulated data. Spectra on real data are measured from the SPHEREx exposures; on simulated data they are models.',
    plain: 'The telescope pictures for the six example places are real. Anything marked practice data is made up for the demo. On real photos the colour charts (spectra) are measured; on practice data they are drawings.',
    sources: [SRC.real],
  },
  {
    id: 'sky',
    q: ['How do I use the Sky view?', 'Take me to the sky', 'Show me the whole sky', 'How do I look around?'],
    keys: ['sky', 'drag', 'zoom', 'look', 'around', 'pan', 'whole'],
    text: 'Sky shows the whole sky with every flagged mover. Drag to look around, scroll or pinch to zoom, pick a marker, step through scans on the timeline or Blink between them. Zoomed in, NASA’s Deep Star Map is streamed as sharp tiles.',
    plain: 'Sky shows the whole sky. Drag to look around and scroll or pinch to zoom. Tap a dot in the list to jump to it.',
    actions: [{ type: 'view', view: 'sky' }],
    sources: [SRC.help],
  },
  {
    id: 'compare',
    q: ['How does Compare work?', 'Open Compare', 'How do I compare two scans?'],
    keys: ['compare', 'wipe', 'side', 'difference', 'scans'],
    text: 'Compare shows two scans of the selected mover with a draggable wipe, a Difference overlay (left subtracted from right, so a mover shows up twice) and Blink. Select a mover in the Movers panel first.',
    plain: 'Compare puts two pictures of the same spot side by side and lets you slide between them. Anything that moved shows up twice. Pick a dot in the list first.',
    actions: [{ type: 'view', view: 'compare' }],
    sources: [SRC.help],
  },
  {
    id: 'field',
    q: ['What is the Field view?', 'Open the Field view', 'How do I analyse a patch of sky?', 'How do I zoom into one patch?'],
    keys: ['field', 'analyse', 'analyze', 'patch', 'closeup', 'close', 'stack', 'track'],
    text: 'Field runs the flagging pipeline on one patch of sky: align the epochs, Blink, Difference, Track or Stack them, find what moved and cross-match it. It lists flagged sources (uncatalogued mover, known object, variable, artifact, left the field) with a vetting panel and a Report button for each, and measures any star’s SPHEREx spectrum.',
    plain: 'The close-up zooms into one small patch and flips between pictures taken at different times, so you can see what changed. It lists anything worth a look.',
    actions: [{ type: 'view', view: 'field' }],
    sources: [SRC.help, SRC.built],
  },
  {
    id: 'examples',
    q: ['Show me an example', 'Which example targets are there?', 'Where should I start?', 'What should I look at first?'],
    keys: ['example', 'target', 'start', 'first', 'demo', 'try'],
    text: 'Six example fields have real SPHEREx data saved, so they work on the hosted copy: asteroid 16 Psyche (the best first look: a known object shows up in one pass only), and the five targets from the challenge brief: Barnard’s Star, Epsilon Indi Ba/Bb, WISE 0855−0714, RW Aurigae and R Draconis.',
    plain: 'There are six example places with real telescope photos. Start with the asteroid 16 Psyche: it shows up in one picture and is gone in the others.',
    actions: EXAMPLES.map(e => ({ type: 'field', example: e.id })),
    sources: [SRC.built, SRC.readme],
  },
  {
    id: 'movers',
    q: ['What is the Movers panel?', 'What do Candidate, Matched and Likely mean?', 'How do I export the list?'],
    keys: ['movers', 'panel', 'list', 'matched', 'likely', 'unmatched', 'export', 'csv', 'json', 'review'],
    text: 'The Movers panel is where candidates get reviewed. Each mover is Candidate (unmatched), Matched (a known asteroid or comet) or Likely (for example, a probable brown dwarf). Filter, sort and search the list, export it as CSV or JSON, and open a mover in Compare or Field. Sources flagged in the Field view can be added to it.',
    plain: 'The list shows things that moved. New means nobody has listed it, Known means it matches a known asteroid or comet. You can search the list, save it as a spreadsheet, and open any item for a closer look.',
    sources: [SRC.help, SRC.built],
  },
  {
    id: 'blink',
    q: ['What does Blink do?', 'What is the difference image?', 'How do I see what changed?'],
    keys: ['blink', 'flip', 'difference', 'subtract', 'changed'],
    text: 'Blink flips back and forth between passes taken at different times, so a mover seems to jump while the stars stay put. Difference subtracts one pass from the other: fixed stars cancel and a mover shows up twice, once bright and once dark.',
    plain: 'Flip switches back and forth between pictures taken at different times, so anything that moved seems to jump. What changed takes one picture away from the other, so only the differences are left.',
    sources: [SRC.help, SRC.built],
  },
  {
    id: 'known',
    q: ['How are known objects ruled out?', 'How does it know an asteroid?', 'What about brown dwarfs and variable stars?'],
    keys: ['known', 'asteroid', 'comet', 'horizons', 'match', 'brown', 'dwarf', 'variable', 'artifact', 'cosmic', 'ray'],
    text: 'Every flag is checked against JPL’s Small-Body Identification service at each frame’s time (with SPHEREx’s own position as the observer), then JPL Horizons gives each object’s precise position; a Horizons match labels the source Known object. A change at a Gaia star is a brightening or fading only if the light is plausibly the star’s. Sources narrower than the point-spread function in one frame are rejected as cosmic rays or bad pixels, and so are sources on pixels the SPHEREx pipeline flags.',
    plain: 'Everything that moved is checked against NASA JPL’s list of known asteroids and comets and ESA’s Gaia star list. Changes at a known star count as the star getting brighter or dimmer, and tiny one-picture specks count as camera glitches.',
    sources: [SRC.how],
  },
  {
    id: 'wavelength',
    q: ['Why do wavelengths have to match?', 'What is a matched wavelength?'],
    keys: ['wavelength', 'colour', 'color', 'filter', 'band', 'micron', 'matched'],
    text: 'SPHEREx uses linear variable filters, so the wavelength changes across the camera. Frames can be compared only at the same wavelength, or a blink shows colour differences instead of motion. The server reads each exposure’s spectral WCS and picks, per epoch, the exposure closest to a common wavelength; the Field view refuses to flag mismatched pairs and offers the nearest matching pass.',
    plain: 'SPHEREx sees many colours of infrared light, a different one in each part of each picture. Two pictures can only be compared in the same colour, or things look different just because of the colour.',
    sources: [SRC.how],
  },
  {
    id: 'spherex',
    q: ['What is SPHEREx?', 'Tell me about the telescope'],
    keys: ['spherex', 'telescope', 'infrared', 'survey', 'mission'],
    text: 'SPHEREx is NASA’s infrared all-sky survey telescope. It looks about 90° from the Sun and maps the whole sky every six months, with 6.15″ pixels and linear variable filters that cover 0.75–5 µm. Its repeated maps are what make a parallax search possible.',
    plain: 'SPHEREx is a NASA space telescope that photographs the whole sky in infrared light every six months. Those repeat photos are what this app compares.',
    sources: [SRC.summary, SRC.problem],
  },
  {
    id: 'modes',
    q: ['What are Simple and Advanced modes?', 'Can I get plain words?', 'How do I see all the controls?'],
    keys: ['simple', 'advanced', 'plain', 'words', 'jargon', 'controls'],
    text: 'The switch in the top bar picks the detail level. Advanced (the default) is the full app with the technical terms. Simple swaps the jargon on screen for plain words and hides the controls only an astronomer needs, such as coordinates, the grid, tracks and spectra.',
    plain: 'The Simple / Advanced switch at the top picks the detail level. Simple uses plain words and hides the expert controls. Advanced shows every control and the technical terms.',
    sources: [SRC.readme, SRC.help],
  },
  {
    id: 'shortcuts',
    q: ['What are the keyboard shortcuts?', 'Which keys can I use?'],
    keys: ['keyboard', 'shortcut', 'key', 'keys', 'hotkey'],
    text: 'On the sky: arrow keys pan, 1–9 jump to a scan, B blinks, G and T toggle the grid and tracks, / goes to a position. S, C and F switch to Sky, Compare and Field, ? opens the help sheet and Esc goes back or closes. The help sheet lists them all.',
    plain: 'Press ? for the help sheet, Esc to go back or close, and S, C or F for the sky, Compare or the close-up. The help sheet lists the rest.',
    actions: [{ type: 'help' }],
    sources: [SRC.help],
  },
  {
    id: 'report',
    q: ['What does the Report button do?', 'How do I share a candidate?', 'Can I export a follow-up report?'],
    keys: ['report', 'share', 'pdf', 'ades', 'followup', 'follow'],
    text: 'In the Field view, Report opens a one-page follow-up report for the selected source in a new tab: stamps, positions with uncertainties, motion, cross-matches, predictions and ADES/CSV/JSON files. The whole report is carried in its link, so it needs no server. It says “Arc too short for an orbit fit”, because two or three epochs are not enough for one.',
    plain: 'In the close-up, the Report button opens a one-page summary of the selected object in a new tab, which you can share by its link.',
    sources: [SRC.built],
  },
  {
    id: 'live',
    q: ['How do I get live data?', 'Can I see live pictures of any place?', 'How do I look at any position?', 'How do I run the data server?'],
    keys: ['server', 'node', 'local', 'run', 'install', 'position', 'any'],
    text: 'Live data needs the local data server: from the repo root run node server/index.mjs (Node 20+, no dependencies) and serve the app locally. The badge then reads Live · SPHEREx, and the Field view’s Live request box takes any centre, size, camera and date. The first load of a field takes about 10 seconds, a few minutes when JPL is checked; results are cached.',
    plain: 'Live telescope photos for any place need a small program running on your own computer (the data server in the project’s README). Without it you get the six saved example places.',
    sources: [SRC.readme],
  },
  {
    id: 'stack',
    q: ['Can you add the passes together?', 'What is shift-and-stack?'],
    keys: ['add', 'together', 'shift', 'stack', 'stacking', 'deeper'],
    text: 'The Field view’s Stack adds passes together as an inverse-variance weighted mean. Shift-and-stack, tested on the six saved fields, shifts each pass by the motion a body at an assumed distance would have before adding them. With SPHEREx’s three or four passes it lowers the bar from about 7σ to 5–6σ per frame (0.3–0.4 mag), far short of the 1.3–2 mag the most optimistic Planet Nine model needs.',
    plain: 'Adding the pictures together lets fainter things show up, but SPHEREx has only a few pictures of each place so far, so it helps a little, not enough for a Planet Nine-sized world.',
    sources: [SRC.can],
  },
  {
    id: 'spectrum',
    q: ['How do I see a spectrum?', 'Can it make a spectrum?', 'What does the SPHEREx spectrum show?', 'Are the spectra real?'],
    keys: ['spectrum', 'spectra', 'methane', 'measure', 'measured', 'brightness'],
    text: 'In the Field view, the SPHEREx spectrum section measures a star’s brightness in every exposure that covers it, at the wavelength each exposure saw: one point per exposure, a few hundred from 0.75 to 5 µm across SPHEREx’s six arrays. Pick a star in the image, take the target at the field centre, or press Spectrum on a flagged source that stays put. It is relative brightness, not calibrated photometry, and its 31″ box takes in any neighbour within about 15″. The hosted copy has the example targets saved: Epsilon Indi Ba/Bb shows the 3.3 µm methane dip and the 4 µm peak of cold brown dwarfs, and Barnard’s Star and R Draconis are too bright for SPHEREx. With the data server it measures any star.',
    plain: 'A spectrum shows how bright a star is in each colour of infrared light. Switch to Advanced at the top, open a close-up and use its SPHEREx spectrum section: it measures the star in every picture SPHEREx took of it.',
    actions: [{ type: 'field', example: 'epsindi' }],
    sources: [SRC.built, SRC.real],
  },
  {
    id: 'help',
    q: ['Open the help sheet', 'I need help', 'Show me the help'],
    keys: ['help', 'sheet', 'manual', 'guide', 'instructions'],
    text: 'The help sheet explains the views, the data badge and every shortcut.',
    plain: 'The help sheet explains the app in plain words.',
    actions: [{ type: 'help' }],
    sources: [SRC.help],
  },
  // one entry per example target, from field/examples.js
  ...EXAMPLES.map(e => {
    const name = e.label.split(' · ')[0];
    return {
      id: 'ex-' + e.id,
      q: [`Show me ${name}`, `What is ${name}?`, `Open ${name}`],
      keys: name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2),
      text: `${e.label}. ${e.note.replace(/\bdetect\b/g, 'see')}`, // honesty rule: the helper never says "detect"
      plain: `${name} is one of the six example places with real telescope photos. Open it to see the pictures and what changed between them.`,
      actions: [{ type: 'field', example: e.id }, { type: 'flyto', example: e.id }],
      sources: ['Field view · Examples'],
    };
  }),
];

export const FALLBACK = {
  id: 'fallback',
  text: 'I don’t have an answer to that in my notes, and I won’t guess. The help sheet covers the app in more detail, or try one of the suggested questions.',
  plain: 'I don’t know the answer to that, and I won’t guess. The help sheet explains the app, or try one of the suggested questions.',
  actions: [{ type: 'help' }],
  sources: [],
};

// suggested questions shown as chips, per view; each must reach its entry (tests/assistant.test.mjs)
export const SUGGESTIONS = {
  sky: [
    { q: 'What is this?', id: 'about' },
    { q: 'How does parallax find it?', id: 'parallax', plain: 'How does it work?' },
    { q: 'Show me an example', id: 'examples' },
    { q: 'What does the badge mean?', id: 'badge', plain: 'Is this data live, saved or simulated?' },
    { q: 'Can it find Planet Nine?', id: 'planet9' },
  ],
  compare: [
    { q: 'How does Compare work?', id: 'compare' },
    { q: 'What does Blink do?', id: 'blink' },
    { q: 'What is a candidate?', id: 'candidate' },
    { q: 'Take me to the sky', id: 'sky' },
  ],
  field: [
    { q: 'What is the Field view?', id: 'field', plain: 'How do I zoom into one patch?' },
    { q: 'Show me an example', id: 'examples' },
    { q: 'What can’t it find?', id: 'cannot-find' },
    { q: 'How do I see a spectrum?', id: 'spectrum' },
    { q: 'What does the Report button do?', id: 'report' },
  ],
};

/** Button label for an action, in the mode's words. */
export function actionLabel(a, mode = 'advanced') {
  const simple = mode === 'simple';
  if (a.type === 'view') return { sky: simple ? 'Go to the sky' : 'Open Sky', compare: 'Open Compare', field: simple ? 'Open a close-up' : 'Open the Field view' }[a.view];
  if (a.type === 'help') return 'Open the help sheet';
  const ex = EXAMPLES.find(e => e.id === a.example), name = ex ? ex.label.split(' · ')[0] : a.example;
  if (a.type === 'field') return simple ? `Close-up: ${name}` : `Field: ${name}`;
  if (a.type === 'flyto') return `Show ${name} on the sky`;
  return a.type;
}

