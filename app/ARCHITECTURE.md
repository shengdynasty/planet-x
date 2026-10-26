# Planet X app — architecture and module contracts

One app that merges the two demos (`artifacts/ui-demo`, `artifacts/moving-sky`) in the **UI demo's look**:
strictly black / white / grey UI (tokens in `app/css/base.css`), Inter, glass HUD panels over a full-bleed sky;
only imagery (sky, cutouts, field images, spectra) has colour. Dark and light themes, phone width ≥ 360px.

No build step. Plain ES modules loaded by `app/index.html`; three.js r128 stays a global from cdnjs
(`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`). Local preview:
`http://localhost:8000/app/` (python http.server at repo root). Live data needs `node server/index.mjs` (port 8787).

## Who owns what (edit only your own files; ask the main agent for changes elsewhere)

| Module | Owner | Files |
|---|---|---|
| Core state/bus, base CSS, this doc | main agent | `app/js/core/*`, `app/css/base.css`, `app/ARCHITECTURE.md` |
| Shell + Sky view + Compare | agent **shell** | `app/index.html`, `app/js/main.js`, `app/js/sky/*`, `app/js/compare/*`, `app/css/shell.css`, `app/css/sky.css`, `app/css/compare.css` |
| Detection pipeline (pure, no DOM) + Field analysis view | agent **field** | `app/js/pipeline/*`, `app/js/field/*`, `app/css/field.css`, `tests/pipeline.test.mjs`, `tests/field.test.mjs` |
| Data sources (sim + live client) + server | agent **data** | `app/js/data/*`, `server/*`, `tests/data.test.mjs` |
| Candidate workflow (panel) | agent **workflow** | `app/js/candidates/*`, `app/css/candidates.css` |
| Real sky imagery | agent **assets** | `app/assets/*` (+ `app/assets/README.md` with source, licence, orientation) |

Each agent may also add a standalone dev page `app/dev/<module>.html` that mounts only its module with simulated data.
Dev-server ports (avoid clashes): shell 8101, field 8102, data 8103, workflow 8104, assets 8105.

## Mount contract (shell provides, modules fill)

`app/index.html` (shell) contains these empty mount points and loads every module's CSS:

- `<aside id="panel">` — the right-hand Movers panel (bottom sheet on phones). **workflow** mounts into it.
- `<section id="view-field" hidden>` — full-screen view like Compare. **field** mounts into it.
- `<section id="view-compare" hidden>` — Compare (shell's own).
- `#stage` sky canvas, top bar, timeline, zoom controls, help sheet, toast, `#announce` live region — shell.

`app/js/main.js` (shell) boots in this order:
```js
import * as store from './core/store.js';
import { initData } from './data/index.js';             // data
import { mountSky } from './sky/index.js';              // shell
import { mountCompare } from './compare/index.js';      // shell
import { mountCandidates } from './candidates/index.js';// workflow
import { mountField } from './field/index.js';          // field
await initData(store);                                   // fills scans, candidates, source
mountSky(document.getElementById('stage'), store);
mountCompare(document.getElementById('view-compare'), store);
mountCandidates(document.getElementById('panel'), store);
mountField(document.getElementById('view-field'), store);
```
Every `mountX(el, store)` must work with only `store` (see `core/store.js` for keys and events) and must not
query DOM outside `el` except `#announce` (write text into it for screen-reader announcements).
Views show/hide themselves from `store.on('view', …)`; the shell owns the top-bar view switcher
(Sky · Compare · Field).

## Pipeline API (field agent → used by field view, data)

`app/js/pipeline/index.js` exports pure functions (also importable from Node for tests):
- `simulateField(opts?) → Field` — the Moving Sky simulated field (stars, asteroid, slow mover ~500 AU, variable, spike), byte-for-byte the same results as `artifacts/moving-sky` on main.
- `analyse(field, ia, ib) → Result[]` — same semantics and output as Moving Sky's `analyse` (kinds: cand, known, var, art, left), cached per frame.
- `stats(img)`, `detect(img, k)`, `diff(field, ia, ib)`, `maxStack(field, band, ia, ib)`, `radec(field, x, y)`, `fmtDt`, `fmtRate`, `spectrum(kind)`.
`Field` and `Candidate` shapes: `app/js/core/types.js`.

## Data API (data → used by main, field)

`app/js/data/index.js`:
- `initData(store)` — sets `scans`, `candidates`, `source`. Tries the local server (`http://localhost:8787/api/health`, 1.5 s timeout); falls back to simulated. Hosted as a claude.ai artifact, outside network is blocked, so it must fall back silently.
- `getField({ra, dec, sizeArcsec}) → Promise<Field>` — live: real SPHEREx cutouts via the server; sim: `simulateField()` re-centred on the request. Always sets `field.simulated` truthfully.

Server (`server/index.mjs`, Node ≥ 20, no npm deps): `/api/health`, `/api/scans?ra&dec`, `/api/field?ra&dec&size`
(epochs + frames as Float32 binary or base64), `/api/known?ra&dec&t` (JPL small-body identification). Disk cache in `server/.cache/` (gitignored).

## Honesty rule

Every screen that shows simulated data says so (the `source` key drives a visible "Simulated data" badge in the top bar,
owned by shell). Never call anything a detection; unmatched movers are "candidates".

## Testing

Headless Chrome via playwright-core at
`/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad/pw/node_modules/playwright-core/index.mjs`
(`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`, args
`['--use-angle=swiftshader','--enable-unsafe-swiftshader']`). ES modules need http, not file:// — start your own
`python3 -m http.server <port> --bind 127.0.0.1` from your worktree root on a free port (8100–8199). Never npm install into the repo.
Put tests under `tests/`; screenshots in the scratchpad, never in git.
