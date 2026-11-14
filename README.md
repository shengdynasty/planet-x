# Planet X

A NASA Space Apps Challenge 2026 project: search NASA's **SPHEREx** all-sky infrared survey for the parallax a distant "Planet X" cannot hide, and help people review what's found.

SPHEREx looks about 90° from the Sun and re-maps the whole sky every six months, so its two passes over any patch see it from opposite sides of Earth's orbit. A body at 500 AU jumps 825″ between them (134 pixels, out of a 300″ cutout and into another) and drifts 7″ a day between the re-visits within one pass. The app compares the same patch of sky across epochs, flags what moved, appeared, vanished or brightened, and checks each one against JPL's catalogue of known asteroids and comets and Gaia DR3's catalogue of stars. Whatever is left is a **candidate for human review, never a detection**. What it can and cannot find was measured by planting synthetic movers into real frames (`docs/WRITEUP.md`).

Enter a position (or pick one of the built-in targets), and the app loads every SPHEREx pass of that patch at a matching wavelength, plays them like a little video, blinks or subtracts any two, overlays Gaia stars and the SPHEREx pipeline's own bad-pixel flags, and names what it recognises.

**Live demo:** https://shengdynasty.github.io/planet-x/ (real SPHEREx data for the six built-in targets, saved in the repo; any other position needs the local server below)

> **Status:** hackathon prototype. The badge in the top bar always says what you are looking at: **Live · SPHEREx** (the local server fetches any position from IRSA), **Saved SPHEREx data** (real frames, known objects and Gaia stars for the six example targets, saved in `app/data/snapshots/` on the date in the badge's tooltip), or **Simulated data** (placeholder scans and movers, labelled as such).

## What's here

| Path | What it is |
|---|---|
| `app/` | The web app: 3D sky on NASA's Deep Star Maps, candidate review panel, Compare (wipe/difference/blink), and Field analysis (the detection pipeline on a patch of sky). Plain ES modules, no build step. Contracts: [`app/ARCHITECTURE.md`](app/ARCHITECTURE.md). |
| `server/` | Optional local Node server (no npm deps) that pulls **real SPHEREx exposures** from NASA/IPAC IRSA and known objects from JPL. See [`server/README.md`](server/README.md). |
| `artifacts/` | The two original single-file demos (UI demo, Moving Sky), kept as published snapshots. |
| `docs/` | Project write-up and pitch outline. |
| `tests/`, `qa/` | Unit and headless-browser tests. |

## Run it

```sh
python3 -m http.server 8000 --bind 127.0.0.1   # from the repo root
open http://localhost:8000/                     # homepage; "Open the sky" → /app/ (saved SPHEREx data for the six example targets)

node server/index.mjs                           # optional: live SPHEREx data for any position on :8787
```

On Windows, `py -m http.server 8000 --bind 127.0.0.1` if `python3` is not on your PATH.

With the server running, the badge in the top bar switches from **Saved SPHEREx data** to **Live · SPHEREx**. First loads of a field take ~10 s (about a minute when JPL is also checked); results are cached in `server/.cache/`. Add `?data=sim` to the app URL to see the simulation instead.

## For the team

Everything below works on macOS, Linux and Windows (use `py` instead of `python3` on Windows if needed).

### 1. Set up once

You need **Node 20+** (`node -v`), **Python 3.10+** (`python3 --version`) and **git**. No `npm install`: the app has no build step and the Node server has no dependencies.

```sh
git clone https://github.com/shengdynasty/planet-x.git
cd planet-x
```

Optional, for the headless-browser tests: have Google Chrome installed and add `playwright-core` (no `package.json` needed):

```sh
npm i --no-save playwright-core@1.49.1
```

The suites find it in `node_modules/` and find Chrome in its usual place on macOS, Windows and Linux. `PW_CORE=` and `CHROME=` override both (see `tests/browser.mjs`).

### 2. Run the app with real data

Two terminals, both from the repo root:

```sh
# terminal 1: data server (real SPHEREx exposures from IRSA, known objects from JPL)
node server/index.mjs

# terminal 2: static files
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000/app/. The badge top right should read **Live · SPHEREx** within two seconds. If it says *Saved SPHEREx data*, the server isn't running on port 8787, or IRSA is down (check http://localhost:8787/api/health), and the app is showing the saved example fields instead (see below).

Try the built-in targets: in the Field view, open **Examples** and pick one. They are 16 Psyche (the asteroid test case) and the five objects the challenge brief names:

| Example | What you should see |
|---|---|
| 16 Psyche · 16 Feb 2026 | Three 1.85 µm frames; Psyche flagged *Known object*, 1.3″ from the JPL ephemeris, in the Feb 2026 frame only |
| Barnard's Star | *Known object* from Gaia DR3 proper motion (10.4″/yr, about 1.7 px a year); press **Play** to watch it drift |
| Epsilon Indi Ba/Bb | Brown-dwarf pair, 4.7″/yr; Gaia DR3 sees it as one faint source (G 18.0), so it is a *Known object* by name; under a pixel between adjacent passes, so compare first and last |
| WISE 0855−0714 | The coldest known brown dwarf, 8″/yr but very faint: SPHEREx may show nothing, and that is the honest answer |
| RW Aurigae | Variable young star: *Variable* flags tied to its Gaia DR3 entry, no motion |
| R Draconis | Mira variable, but at G 6.4 it saturates SPHEREx: pipeline artifact flags (TRANSIENT, SUR_ERROR, OVERFLOW) on its core, rejected as artifacts, and no *Variable* flag |

First load of a field takes ~10 s for the frames plus 1–2 min for the JPL known-object check (the frames and Gaia stars appear first); afterwards it is instant from `server/.cache/`.

Three overlays sit above the image: **Flags** (what the pipeline found), **Known objects** (JPL ephemerides and Gaia high-proper-motion stars), **Gaia stars** (every Gaia DR3 star with G < 19 at the frame time) and **Bad pixels** (the SPHEREx pipeline's own FLAGS plane: red = bad, amber = contaminated). **Play** cycles through every pass at the reference wavelength like a little video.

Any field can be shared or embedded by URL: `/app/?ra=269.4463&dec=4.7682&size=300&det=1` opens straight on Barnard's Star (RA/Dec in degrees or `08h55m10.8s`/`-07d14m42.5s`; `size` 40–600 arcsec, clamped if outside; `det` 1–6; optional `t` as MJD or `2026-02-16`). The address bar updates as you move, so copying it is enough.

#### Saved snapshots (what the hosted copy shows)

`app/data/snapshots/` holds the server's answer for each of the six example targets (about 100 KB each: the frames, the SPHEREx flag planes, JPL's known objects and the Gaia stars, with the IRSA file behind every frame) plus `index.json` (when they were saved, the home patch's survey scans for the timeline, and the known objects as review-panel entries). When no server answers, the app loads these and the badge reads **Saved SPHEREx data**: the Examples menu and any position inside one of those fields show the real data, analysed in the browser as in live mode; anything else falls back to the simulation and says so. To refresh them after the server has new passes:

```sh
node server/index.mjs                 # terminal 1
node scripts/save-snapshots.mjs       # terminal 2: rewrites app/data/snapshots/ (refuses a field whose JPL or Gaia lookup failed)
```

Then commit the files; `main` deploys to GitHub Pages. `?data=sim` on the app URL skips both the server and the snapshots.

### 3. The Python backend

The team's FastAPI server lives in [Tejas-Konduru/Spherex_Backend](https://github.com/Tejas-Konduru/Spherex_Backend). It serves the same six routes as `server/` (`/api/health`, `/api/scans`, `/api/field`, `/api/progress`, `/api/known`, `/api/candidates`), so the app works against either one unchanged:

```sh
git clone https://github.com/Tejas-Konduru/Spherex_Backend.git && cd Spherex_Backend
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --port 8787                      # interactive docs at http://localhost:8787/docs
```

Don't run both servers on 8787 at once. To point the app at a server on another host or port, open it with `?api=`:

```
http://localhost:8000/app/?api=https://your-api.example.com
```

or, to make it permanent, add one line to `app/index.html` **before** the `js/main.js` script tag:

```html
<script>window.PLANETX_SERVER = 'https://your-api.example.com';</script>
```

A deployed API must be on HTTPS (the app on GitHub Pages is HTTPS) and must list the app's origin in its CORS allowlist (`PLANETX_ORIGINS=https://shengdynasty.github.io` for the FastAPI server).

### 4. Where things are

| Want to change… | Look in |
|---|---|
| Detection pipeline (what counts as moved / appeared / artifact) | `app/js/pipeline/` and `tests/pipeline.test.mjs` |
| Field view (frames, flags, blink, live request box) | `app/js/field/` |
| 3D sky, markers, fly-to | `app/js/sky/` |
| Candidate review panel, export | `app/js/candidates/` |
| Candidate report (shareable link, PDF, ADES/CSV/JSON) | `app/js/report/`, `app/report.html`; contracts in `app/ARCHITECTURE.md` |
| Data loading, server contract, sim fallback | `app/js/data/index.js`; contract in `app/ARCHITECTURE.md` |
| Real-data server (IRSA, JPL, FITS, WCS) | `server/lib/`; explained in `server/README.md` |
| Write-up, pitch and the submission form text | `docs/WRITEUP.md`, `docs/PITCH-OUTLINE.md`, `docs/PROJECT-PAGE.md` |
| What's done / in progress | `STATUS.md` |

Rules of thumb: anything simulated must say so in the UI (`simulated: true` flows through to a *Simulated* tag); nothing is ever called a detection, only a candidate; coordinates are ICRS degrees everywhere except where a label says otherwise.

### 5. Tests

Run the relevant suite before you push. Node-only suites take seconds; browser suites need Chrome and take a minute or two each (longer on a machine without a GPU: Chrome renders the sky in software). Don't run two browser suites at the same time. Each browser suite serves the repo itself on a port in 8101–8109 and refuses to reuse a server there that serves different files, so a forgotten `http.server` from another checkout can't make it test the wrong code. The server is python's `http.server`: on Windows the suites start it with `py -3` or `python` (the `python3` there is the Store stub); `PLANETX_PYTHON="py -3"` (or a path to `python.exe`) picks the interpreter on any platform.

```sh
node tests/pipeline.test.mjs                        # detection pipeline (also checks parity with Moving Sky)
PLANETX_OFFLINE=1 node --test tests/data.test.mjs   # data module; drop PLANETX_OFFLINE to hit IRSA for real
node --test tests/injection.test.mjs                # injection-recovery on the saved real fields (Node, seconds)
node scripts/injection-recovery.mjs [--clear-gaia]  # the full recovery tables behind docs/WRITEUP.md
node tests/link.test.mjs                            # cross-field linker: parallax prediction + planted counterpart (Node, offline)
node tests/parallax.test.mjs                        # parallax-distance estimator: distance with an error bar from a measured shift (Node, offline)
node --test tests/stack.test.mjs                    # shift-and-stack on the saved real fields (Node, seconds)
node scripts/shift-and-stack.mjs                    # the full stacking tables behind docs/WRITEUP.md (--trials, --true-au)
node scripts/link-fields.mjs --field app/data/snapshots/psyche.json --pair 0,1   # link that pair's vanished sources (needs the server; --predict-only does not)
node tests/shell.test.mjs                           # app shell, top bar, badge         (browser)
node tests/review.test.mjs                          # review panel + sky markers        (browser)
node tests/workflow.test.mjs                        # end-to-end sim workflow           (browser)
node tests/field.test.mjs                           # Field view                        (browser)
node tests/report.test.mjs                          # candidate report: model, link, fit, exports (Node)
node tests/report-browser.test.mjs                  # candidate report end to end       (browser)
node tests/live.test.mjs                            # live mode against :8787          (browser, needs a data server)
node qa/moving-sky.test.mjs                         # Moving Sky demo                   (browser)
```

`PLANETX_SERVER=http://localhost:8790 node tests/live.test.mjs` runs the live suite against another server, e.g. the FastAPI one.

### 6. Working together

- Branch from `main`, open a pull request, and run the suites your change touches. `main` deploys to GitHub Pages automatically (a minute or two after the push).
- Keep real-data additions honest: the server's "known objects" are JPL ephemeris predictions, not pixel detections, and the frames are surface brightness after zodiacal-light subtraction, not calibrated photometry.
- `server/.cache/` is ignored by git. It grows to a few hundred MB; delete it to start fresh.
- Hackathon dates: 14–15 November 2026. The challenge dataset is handed out then; everything here already runs on the public SPHEREx releases (`spherex_dr1` + `spherex_qr3` as of Nov 2026), so you can build and test before that.

## Credits

- Sky imagery: NASA/Goddard Space Flight Center Scientific Visualization Studio, *Deep Star Maps 2020*. Gaia DR2: ESA/Gaia/DPAC.
- Data: SPHEREx via NASA/IPAC Infrared Science Archive (IRSA); JPL Small-Body Identification and Horizons; Gaia DR3 via the ESA Gaia archive.
- Other telescopes panel: Aladin Lite (CDS, Strasbourg) loaded from jsDelivr at run time, never bundled; DSS2, 2MASS and AllWISE HiPS (CDS) via the IRSA mirror; names from SIMBAD (CDS).
- Run-time libraries, loaded from public CDNs and not part of this repository: three.js (MIT) and Aladin Lite (CDS, GPL/LGPL).
- Licence: the team's code, tests and documentation are released under the MIT License (see `LICENSE`). It does not cover the data, imagery and libraries above, which keep their own terms and credits; the saved SPHEREx fields in `app/data/snapshots/` are derived from the IRSA, JPL and Gaia data and carry the same provenance. The sky imagery is used under NASA's media usage guidelines, with no NASA endorsement implied.
- AI assistance: the code, tests and documentation in this repository were written with Claude (Anthropic) as a coding assistant, working from the team's direction and reviewed, run and verified by the team. The science choices, data sources, test results and conclusions are the team's.
- Team: [Team member names]
