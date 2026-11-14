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
- `<aside id="inspect" hidden>` — left of the sky: the selected mover's imagery and description. **workflow** fills it on desktop (≥ 861 px) and shows it while a mover is selected; on phones that content sits inside the sheet instead.
- `<section id="view-field" hidden>` — full-screen view like Compare. **field** mounts into it.
- `<section id="view-compare" hidden>` — Compare (shell's own).
- `#stage` sky canvas, top bar, timeline, zoom controls, help sheet, toast, `#announce` live region — shell.
  Sky markers are labelled with the list number **and the object's name** (`designation(c)` in `candidates/format.js`:
  the live match, else the part of the tag after ' · ' without the placeholder note, else the short tag). Field markers
  label known objects `Known · <name>` and ephemeris circles with the name.

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
The team's FastAPI port (Tejas-Konduru/Spherex_Backend) serves the same routes and the same JSON.

Live `Field`s carry three things the simulation doesn't (all optional; the pipeline checks for them):
- `field.flags(i) → Uint32Array | null` and `field.flagBits = {names, hard, soft}` — the SPHEREx L2 FLAGS plane per frame,
  resampled onto the grid (bitwise OR of the source pixels) plus our `MASKED` (bit 30: the pixel was NaN and got the median)
  and `OFF_IMAGE` (31). `detect.js` turns a source on a hard-flagged pixel into an artifact and appends soft flags
  (ghost, persistence, halo) to the detail. `epochs[].flagged` is the fraction of flagged pixels.
- `field.stars[]` — Gaia DR3 sources with G < 19: `{id, name, g, rp, pm, pos(t) → [x, y]}`, proper motion propagated from
  J2016.0 by `toField`. A new or vanished source on a Gaia star is variability (`var`), never a mover.
- On real frames the PSF is under-sampled (σ < 1 px), so a star's peak pixel changes by ×2–3 with its sub-pixel position
  alone. Variability there is judged on 5×5 aperture flux above the local sky (`detect.js apFlux`), relative to the
  median flux ratio of the field's other matched stars, and never on the peak; blends (a brighter source within 3 px)
  are never called variable. The simulation (σ = 1.15 px) keeps Moving Sky's peak-ratio test, so parity holds.
- `field.known[]` entries have `kind: 'sb' | 'star'`; stars moving faster than 1″/yr come from Gaia with `source: 'Gaia DR3
  proper motion'` and `pmArcsecYr`. A known mover whose shift is below the 2.2 px pairing radius is still reported
  (`kind: 'known'`, from the predicted positions, or `predicted: true` when nothing clean sits there).

Deep links (`main.js`): `/app/?ra=&dec=[&size=&det=&t=]` opens the Field on that patch (degrees or sexagesimal via
`sky/coords.js parseCentre`); `?api=https://…` points the data module at a hosted data server. `size` is clamped to
40–600″ by `core/limits.js`, the one client copy of the server's range (`server/lib/field.mjs` SIZE_MIN/SIZE_MAX), which the
data module's `liveSize` and the Field view's Live request box use too. The field view keeps the
address bar in sync (`history.replaceState`) while a field is open. Built-in examples (`field/index.js EXAMPLES`): 16 Psyche
plus the challenge brief's five test targets.

## Honesty rule

Every screen that shows simulated data says so (the `source` key drives a visible "Simulated data" badge in the top bar,
owned by shell). Never call anything a detection; unmatched movers are "candidates".

## Testing

Headless Chrome via playwright-core, launched through `tests/browser.mjs` (`launch()`): it finds playwright-core in
`$PW_CORE`, the repo's `node_modules/` (`npm i --no-save playwright-core@1.49.1`) or the session scratchpad, and Chrome in
`$CHROME` or the platform's usual place. WebGL runs on the Mac's GPU (`--use-angle=metal`) by default on macOS and on
SwiftShader elsewhere; `CHROME_GL=swiftshader|metal|gl` overrides. `serve(port, root)` starts the static server and
refuses a stale one that serves other files. ES modules need http, not file:// — start your own
`python3 -m http.server <port> --bind 127.0.0.1` from your worktree root on a free port (8100–8199). Never npm install into the repo.
Put tests under `tests/`; screenshots in the scratchpad, never in git.

## Sky deep zoom

The NASA backdrop (`sky_4k.jpg`) is about 11 px per degree, so it blurs long before the 6° zoom limit. `app/js/sky/deepzoom.js`
cross-fades (28° → 16° field of view) to survey tiles (DSS2 colour HiPS from IRSA's mirror of CDS), drawn by Aladin Lite in an
element *behind* the three.js canvas. The canvas is transparent (`alpha: true`), so the grid, markers and tracks stay ours and stay
on top; `sky/index.js` drives Aladin's centre and width from the camera every frame (both are gnomonic, so they line up to
< 0.1 px). Aladin Lite (GPL-3.0) is not in the repo: it is imported from jsDelivr on first zoom-in, with usage logging off. If it
cannot load (offline, blocked) the NASA picture simply stays. Pure helpers are tested by `node tests/deepzoom.test.mjs`.
