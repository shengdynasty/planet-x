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
| Candidate report (link + PDF + data files) | agent **report** | `app/report.html`, `app/js/report/*`, `app/css/report.css`, `tests/report.test.mjs`, `tests/report-browser.test.mjs` (+ one tagged button in `app/js/field/index.js`) |

Each agent may also add a standalone dev page `app/dev/<module>.html` that mounts only its module with simulated data.
Dev-server ports (avoid clashes): shell 8101, field 8102, data 8103, workflow 8104, assets 8105, report 8109.

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

`app/js/data/index.js`, three sources in order of preference, `source.mode` = `'live' | 'snapshot' | 'sim'`:
- `initData(store)` — sets `scans`, `candidates`, `source`. Tries the local server (`http://localhost:8787/api/health`, 1.5 s timeout, only when the page is served locally or `?api=` names one); then the saved snapshots (`app/data/snapshots/index.json`, 5 s timeout: real data for the six example targets, written by `scripts/save-snapshots.mjs`, so the hosted copy is not simulated); then the simulation. `?data=sim` (`globalThis.PLANETX_DATA`) forces the simulation; `PLANETX_SNAPSHOTS` points at another copy of the snapshots (tests). Hosted as a claude.ai artifact, outside network is blocked, so it must fall back silently.
- `getField({ra, dec, sizeArcsec, det, t}) → Promise<Field>` — live: real SPHEREx cutouts via the server; snapshot: the saved field at those coordinates, or the one whose field contains them (with a toast when the request asked for another size/detector/date), else the simulation with `field.fallbackReason`; sim: `simulateField()` re-centred on the request. Live and snapshot reject a request without finite `ra`/`dec` ("Field request needs ra and dec") before any network call; only the sim accepts none (the Field view then substitutes `source.home`, or in snapshot mode the first saved target, since the home patch has no saved field). Always sets `field.simulated` truthfully; a saved field carries `field.snapshot = {id, label, savedAt}` and `field.request` describes what was actually loaded.
- `isLive()`, `isSnapshot()`, `dataMode()`; `source.note` is the badge tooltip; in snapshot mode `source.targets` lists the saved fields.

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

## Sky HD tiles (streamed)

The 4k backdrop is ~11 px/deg, so it blurs when zoomed. NASA publishes the same Deep Star Map at up to 65,536 × 32,768 px
(182 px/deg, one image pixel per screen pixel at the 6° zoom limit). `scripts/make-sky-tiles.py` cuts it into a pyramid of
512 px tiles (`app/assets/skytiles/<level>/<col>_<row>.<ext>`; `manifest.json` gives the levels and the format). **All four levels are on `main`**:
levels 3–5 as WebP q70 (32,768 px wide, up to 91 px/deg, 2,688 tiles, about 153 MB; merged in #7) and level 6 as AVIF q42 (65,536 px
wide, 182 px/deg, 8,192 tiles, 176 MB; #13 and #14, re-encoded from the WebP q70 level 6 on `feat/sky-tiles-all`). `manifest.json`
names the default format (`ext`) and per-level overrides (`exts`), so the two formats mix. They are committed once, not per code
change: each regeneration would add its size to the repo history. Levels 3–5 stay WebP because an AVIF q42 re-encode of them (#12,
not merged) kept only 31–69% of the faint stars in dense Milky Way tiles, the grain that is the Milky Way's texture when zoomed out,
and looked blotchy at 1:1; level 6 keeps 96–99% (77% in the densest tile) because its stars are larger. At the 6° limit a level 6
tile holds about twice the faint stars of the level 5 tile upsampled to the same scale (2,722 vs 1,144 in a galactic-centre tile).
Other sets are kept on branches: `feat/sky-tiles-avif` (levels 3–5 as AVIF q50 from the source, 93 MB) and `feat/sky-tiles-all` (all
four levels as WebP, 525 MB). AVIF needs Chrome 85+, Firefox 93+, Edge 121+ or Safari 16.4+; on anything older the level 6 tiles fail
quietly and level 5 stays on screen.
To make them yourself, run the script on `starmap_2020_64k.exr`. They can also be hosted elsewhere: point `SKY_TILES.remote` in
`sky/config.js` (or `?tiles=<url>`) at them; that host must send `Access-Control-Allow-Origin`. `manifest.json` says which levels exist. `sky/hdtiles.js` streams only what is needed, like culling and LOD in a game:

- **LOD:** `tilemath.levelFor` picks the level whose texels are about as dense as the screen's pixels.
- **Visibility:** `tilemath.visibleTiles` walks the tile quadtree from level 3 and skips every off-screen branch (≈12 of 8,192 tiles at 6°).
- **Progressive:** coarse tiles load first and stay under the fine ones; new tiles fade in; the 4k backdrop is the always-present base.
- **Budget:** at most 6 requests in flight, an LRU texture cache (280 tiles, 90 on phones), a cap on tiles per frame near the poles.
- If `assets/skytiles/manifest.json` is missing the module turns itself off and the sky is the 4k backdrop as before.

URL switches while testing: `?hd=0` (off), `?hdmax=5` (cap the level), `?tiles=<url>` (tile location). The Aladin survey layer (`deepzoom.js`) is now opt-in (`?sky=`, `?deep=`).

<!-- aladin:doc -->
## Other telescopes (aladin)

`app/js/aladin/index.js` exports `mountOtherTelescopes(el)`. The Field view mounts it into `[data-ref="other"]` in the vetting
section (lazy `import()`, first time a source is selected) and calls `setTarget({ra, dec, stampArcsec})` from `renderVet`.
Chips: DSS2 (1980s–90s), 2MASS (1997–2001), AllWISE (2010–2011) and SIMBAD names; pressing a lit chip closes the viewer.
Aladin Lite (GPL-3.0) is never copied into the repo: it is loaded from the CDS CDN only when a chip is pressed. Surveys and
dates live in `app/js/aladin/geom.js`. Dev page `app/dev/aladin.html`; test `node tests/aladin.test.mjs`.
<!-- /aladin:doc -->

<!-- report:doc -->
## Candidate report (report)

The Field view's **Report ↗** button (vetting actions, the only `// report` lines in `app/js/field/index.js`) lazy-loads
`report/model.js` and `report/encode.js` and opens `app/report.html#v=1&c=…` in a new tab. Static hosting only: the
report lives in the URL hash (deflate-raw + base64url, ~0.7–1.5 KB), which is never sent to a server.

- `model.js` `buildReport(result, field, {A, B, mode})` → the core object `schema.js` describes (v1): per-epoch MJD,
  RA/Dec (6 decimals), centroid error (σ_PSF / SNR, floor 0.1 px), 5×5 aperture flux (Jy on real MJy/sr frames), band,
  SPHEREx image id and flag names, plus the Gaia DR3 / known-object cross-match within 30″. It reads one `analyse()`
  result as the Field view lists it and never re-runs detection. `derive(core)` computes motion, predictions, the
  follow-up box and the exports; it is deterministic ("now" is the report's generation time).
- `schema.js` `validate()` checks every field (types, ranges, lengths) and throws `ReportError`; `migrate()` reads v1.
  Decoded values are untrusted and the page uses `textContent` only.
- `predict.js`: weighted linear fit on the tangent plane (RA wrap and high Dec safe; σ grows linearly with time from the
  fit covariance), a low-precision Sun for elongation, and an **illustrative** distance fan (circular prograde orbit at
  2/5/40/300 AU, seen from Earth's centre). No orbit fit: the page says "Arc too short for an orbit fit".
- `export.js`: ADES PSV (headed "For follow-up use; not an MPC submission"; stn XXX, no spacecraft position), astrometry
  CSV, 30-night ephemeris CSV, JSON. Every file starts with SIMULATED DATA when the field was simulated.
- `stamps.js` rebuilds the field (`simulateField` for sim; `data/initData` + `getField` for saved or live frames), checks
  its epochs match the report's, and draws per-epoch stamps plus the difference on one stretch, with an N/E compass and
  a scale bar. If the frames are unreachable the page says "Stamps unavailable offline" and shows the rest.
- Simulated dates: the simulation has no calendar, so its epochs sit on a nominal date (`SIM_T0_MJD`, 2025-05-15) and
  the page and files say so.
- QR code: `qrcode-generator` 1.4.4 from cdnjs (with an integrity hash), on `report.html` only; without it the link text
  stands alone. It encodes the ~80-character deep link to the field (`render.js` `fieldLink`), not the 700–1,000-character
  report link: a code of the latter has ~100 modules a side and cannot be read from a 32 mm print.
- Tests: `node tests/report.test.mjs` (Node), `node tests/report-browser.test.mjs` (browser, port 8109).
<!-- /report:doc -->
