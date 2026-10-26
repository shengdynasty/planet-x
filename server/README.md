# Planet X data server

A small local server that turns real SPHEREx exposures into the multi-epoch `Field` the app's detection
pipeline consumes. Node ≥ 20, **no npm dependencies** (built-in `fetch`, `http`, `zlib`).

```sh
node server/index.mjs            # http://localhost:8787   (PORT=… to change; HOST=127.0.0.1 by default)
node --test tests/data.test.mjs  # client + server tests; hits IRSA for real (PLANETX_OFFLINE=1 skips that)
```

With the server running, the app (`http://localhost:8000/app/`) detects it via `/api/health` within 1.5 s and
switches to **Live · SPHEREx via IRSA**. Without it (or on claude.ai, where outside requests are blocked) the
app silently uses simulated data. `app/dev/data.html` shows what the data module produces.

## Running with live data

```sh
node server/index.mjs                         # terminal 1: data server on http://localhost:8787
python3 -m http.server 8000 --bind 127.0.0.1  # terminal 2, from the repo root
open http://localhost:8000/app/               # badge top right: "Live · SPHEREx"
```

What to expect:

- **Badge** reads *Live · SPHEREx* within ~1.5 s of loading. If the server isn't running (or the page is hosted
  on claude.ai) it reads *Simulated data* and everything is the Moving Sky simulation, labelled as such.
- **Review panel** lists only the known objects JPL predicts in the home patch (RA 70.42°, Dec 19.18°, 2′).
  Often there are none; the panel then says so and offers **Open Field on the home patch**. The server does not
  run detection. The app does, in the browser, on the real frames.
- **Field view** (top bar *Field*, a candidate's *Field*, or the empty-panel button) asks the server for that
  patch. Live fields are small: 120″ = 20×20 px, 300″ = 49×49 px, 600″ = 98×98 px (6.15″/px). A request larger
  than 600″ (e.g. the 1968″ simulation default) becomes 300″. The *Live request* box on the right sets the size,
  the detector (D1–D6, i.e. the wavelength range) and an optional anchor date (MJD or `2026-02-15`): frames are
  then chosen around the exposure nearest that time. *Example: asteroid 16 Psyche* loads the test case below.
- **Loading** shows the stages (from `GET /api/progress`) and the elapsed time, with *Cancel* (or Esc) to go back.
  The frames are requested twice in parallel, without and with JPL (`known=0` / default). The image appears as
  soon as the frames arrive, with a *Checking JPL for known objects…* note. When JPL answers, catalogued
  asteroids switch from *Candidate* to *Known object*. Cancelling doesn't stop the server; it keeps filling the
  cache, so a retry is faster.
- **Flags** come from `app/js/pipeline` with a PSF-aware artifact test: the PSF width is measured from the
  frames' own stars (σ ≈ 0.7 px after resampling, versus 1.15 px in the simulation). Cosmic-ray streaks and
  bad pixels are *Artifact*; an ephemeris match always wins (*Known object*, with the offset from Horizons).
  Anything added to the review list from a live field is stored as live (`simulated: false`), and it is
  kept in `localStorage` (`planetx.fieldcands.v1`).

Time costs (home connection, Oct 2026; everything after the first time comes from the cache):

| Request | Cold | Warm |
|---|---|---|
| Health + scans for the home patch (app boot) | ~2 s (SIA search) | < 50 ms |
| Field frames, 120–300″ (`known=0`) | ~10 s (SIA 1 s, ~70 header range reads 6 s, 3 cutouts × 5 MB 3 s) | ~2 ms |
| Field with known objects | + 1–2.5 min (JPL sb_ident 18–70 s per frame, one at a time; Horizons a few s) | ~2 ms |
| Review-panel known objects (`/api/candidates`) | same as a field with known objects, in the background | ~2 ms |

Cache: `server/.cache/` (or `PLANETX_CACHE`): `sia/` searches (7 days), `hdr/` header range reads, `cutout/`
cutouts, `jpl/` sb_ident answers, `horizons/` Horizons answers, `field/` finished fields, `cands/` panel lists. Roughly 5 MB per
cutout, so a few hundred MB after a dozen fields. Delete the folder to start fresh.

Run `node tests/live.test.mjs` with the server up for the browser end-to-end check (home field, 16 Psyche,
loading + Cancel). `PLANETX_SERVER=http://localhost:8788` points it, and the app, at another port.

CORS: only `http://localhost:*` and `http://127.0.0.1:*` origins get an `Access-Control-Allow-Origin` header.
Cache: everything fetched upstream is kept in `server/.cache/` (gitignored; `PLANETX_CACHE=dir` to move it).
Delete it to force fresh downloads. SIA search results expire after 7 days; everything else is kept.

## Endpoints

| Endpoint | What it returns |
|---|---|
| `GET /api/health` | `{ok, version, upstream, home, recentUpstream[]}` (last upstream requests with timings) |
| `GET /api/scans?ra&dec[&det=1..6]` | SPHEREx survey epochs covering the position: `{id, label, date, start, end, nExposures, detectors[{detector, emMin, emMax, count}]}`. With `det`, each epoch also lists that detector's exposures with the **wavelength at the target** (`atTarget[]`). |
| `GET /api/field?ra&dec[&size=120][&det=1][&lam=µm][&per=2][&t=MJD][&known=0]` | A `Field` as JSON: metadata, `epochs[]`, `frames[]` (base64 Float32, little-endian, N×N row-major), `known[]` (JPL objects with pixel `samples` per frame). `size` 20–600″. `t` anchors the selection on the exposure nearest that time (e.g. the night an asteroid passed). |
| `GET /api/progress` | Cold field builds in progress: `{builds:[{ra, dec, size, N, known, stage (sia, headers, cutouts, horizons), label, done, total, jpl:{done,total}, elapsedMs}]}`. Warm requests never show up. |
| `GET /api/known?ra&dec&t[&r=120]` | Known small bodies within ±`r`″ at time `t` (MJD or ISO date): JPL sb_ident first pass, geocentric observer (raw, not Horizons-refined). |
| `GET /api/candidates[?ra&dec&size]` | Live "candidates" for the app's panel: the known objects JPL predicts in the field (status `Matched`). Built in the background; answers `{pending:true}` until ready. |

ra/dec are degrees (ICRS). Errors come back as `{error}` with 400 (bad input), 404 (no coverage) or 502 (upstream).

Example (timings measured 26 Oct 2026 from a home connection, cold cache):

```
GET /api/field?ra=70.42&dec=19.18&size=120&known=0   →  ~10 s cold (SIA 1 s, 72 header Range reads 6 s, 3 cutouts 3 s), 2 ms warm
GET /api/field?ra=70.42&dec=19.18&size=120            →  ~2.5 min cold (3 JPL sb_ident queries, 18–70 s each, run one at a time), 2 ms warm
```

End-to-end check with a real asteroid: `GET /api/field?ra=70.2635&dec=19.0558&size=300&det=3&t=61087.1294`
(~1.5 min cold) returns three 1.85 µm frames; on 15 Feb 2026 **16 Psyche** is in the field. Horizons puts it at
pixel (21.49, 23.58); the brightest blob in that frame is centred at (21.55, 23.31), i.e. within 2″, and it is
absent from the Sep 2025 and Sep 2026 frames.

That field returns 3 frames on detector D1 at 0.770 ± 0.006 µm: Sep 2025, Mar 2026 and Aug 2026, with stars
aligned to ≲ 0.5 px between epochs and the brightest star within 2″ of its Gaia DR3 position.

## How a field is built (what's real)

1. **Find exposures** — IRSA Simple Image Access v2, `https://irsa.ipac.caltech.edu/SIA?COLLECTION=…&POS=CIRCLE ra dec r`.
   Collections checked against IRSA TAP (`ivoa.obscore`) in Oct 2026: `spherex_qr2` (≈1.1 M exposures) and
   `spherex_qr3` (newer quick release, still growing). Both are queried (`PLANETX_COLLECTIONS` to change);
   `*_cal` and `*_deep` collections are skipped. Only `calib_level=2` science images are used.
2. **Group into survey epochs** — exposures sorted by time; a gap > 30 days starts a new epoch. SPHEREx maps the
   sky every ~6 months; each epoch covers a point over ~2 weeks, ~17 exposures per detector.
3. **Wavelength at the target** — SPHEREx uses linear variable filters: the wavelength changes across each
   detector. For every candidate exposure we read only the image header (HTTP Range, ≈ 30 kB of a 70 MB file) and
   the `WCS-WAVE` lookup table at the end of the file (Range, 5.8 kB). We place the target on the detector with
   the celestial WCS and look up the wavelength with the file's own spectral WCS (alternate WCS `W`, `WAVE-TAB`,
   bilinear table) — no approximation beyond the table's own interpolation.
4. **Match wavelengths** — default detector D1 (0.75–1.1 µm; `det=` or `lam=` to change). We choose the reference
   wavelength that minimises the worst mismatch across epochs and take, per epoch, the closest exposure plus up to
   `per−1` more within half a resolution element (R≈41 for D1–D3, 35 for D4, 110 for D5, 130 for D6).
   Matched frames get the same `band` value (rounded reference, µm) so the pipeline compares them; the true
   per-frame wavelength is in `epochs[].lambda`, the difference in `dLambda`, and `matched:false` flags a frame
   that could not be matched within tolerance.
5. **Cutouts** — IRSA's cutout service (`<access_url>?center=ra,dec&size=…arcsec`). Each cutout includes all
   extensions (IMAGE, FLAGS, VARIANCE, ZODI, PSF cube, WCS-WAVE), ≈ 5 MB, mostly the PSF cube.
6. **FITS parsing** — our own reader (`lib/fits.mjs`): 2880-byte blocks, BITPIX 8/16/32/−32/−64, BSCALE/BZERO,
   BLANK, big-endian, binary tables; we pick the `IMAGE` extension by EXTNAME.
7. **Common grid** — each frame is `IMAGE − ZODI` (the pipeline's zodiacal-light model), bilinearly resampled onto
   one TAN grid centred on the request, 6.15″/px, north up / east left, centre at pixel (N/2, N/2) — the
   convention of `app/js/pipeline` `radec()`. The source WCS is TAN with SIP distortion (`lib/wcs.mjs`; CD or
   CDELT+PC, forward A/B and inverse AP/BP polynomials).
8. **Known objects** — JPL SSD Small-Body Identification API (`sb_ident.api`) at each frame's mid-exposure time
   (`MJD-AVG`), with the observer at **SPHEREx's own position** from the header (`X_SC/Y_SC/Z_SC`, geocentric km,
   passed as `xobs`), finds which catalogued objects are near the field. Each one is then positioned with
   **JPL Horizons** (`ssd.jpl.nasa.gov/api/horizons.api`, one request per object for all frame times) and
   projected onto the grid. Horizons is needed because sb_ident's fast first pass has errors of tens of arcsec.

## Simplifications and gaps (be honest in the UI)

- **Surface brightness, not photometry.** Frames are MJy/sr after zodi subtraction. No flux calibration to
  magnitudes, no PSF photometry, no per-pixel variance used.
- **Resampling** is bilinear, which slightly smooths the undersampled SPHEREx PSF (FWHM ≈ 6.6″ ≈ 1 px) and
  does not conserve flux exactly. Good enough for blinking/differencing, not for precise astrometry.
- **FLAGS are ignored.** Bad, off-detector or NaN pixels are set to the frame median. Cosmic rays, persistence
  and the occasional column artefact remain and will show up as "artifacts" in the pipeline.
- **Wavelength matching is approximate across epochs:** frames are within half a resolution element where
  the survey allows, not identical. A bandpass-dependent brightness change can remain.
- **Known-object search uses sb_ident's first pass** (objects with V ≤ 22; the precise second pass took ~3 min per
  query). Objects are kept if their nominal position lies within the field grown by their error (≤ 2′), then
  Horizons decides; if Horizons can't resolve a name we keep the first-pass position (`known[].source` says which).
  Horizons positions are **geocentric**: SPHEREx is ~7000 km from Earth's centre, a parallax of ≲ 3″ for main-belt
  objects but more for near-Earth objects. Between frame times the client interpolates
  linearly only for samples < 3 days apart; otherwise `pos(t)` is off-field.
- **Slow first requests.** sb_ident queries take 18–70 s each and run one at a time; a new field with `known`
  takes a few minutes cold. Everything is cached afterwards. `known=0` skips JPL.
- **Live candidates** are only JPL-predicted known objects in the home field (often none in 2′). The server does
  not run detection; the app's field view does that on the frames. Nothing here is a detection.
- **Only TAN/TAN-SIP** celestial WCS is supported (that's what SPHEREx L2 uses).
- **Bandwidth:** each cutout is ~5 MB because the service always includes the PSF cube; a Range-based
  row cutout of IMAGE + ZODI would be ~10× smaller, but we stick to the official cutout service.
- `/api/known` uses a geocentric observer (no spacecraft position for an arbitrary time); `/api/field` uses SPHEREx's.
