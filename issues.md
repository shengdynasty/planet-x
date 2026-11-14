# Planet X: test report and issue list

Tested 13 Nov 2026 on `main` at `2aa2959`, Windows 11, Node 24.3, Chrome (headless, SwiftShader WebGL) and the Claude desktop in-app browser.
The live data server (`server/`) ran against the real IRSA, Gaia and JPL services. No source files were changed; the only file added besides this one is [`qa/star-accuracy.csv`](qa/star-accuracy.csv).

**Bottom line.** The app mostly works. The sky orientation, the real-data astrometry (frames against Gaia) and the 16 Psyche result are accurate. The weak points are:

- The "Variable" flag on real frames is wrong most of the time (ISS-01).
- The sky shows fake stars on top of the real map (ISS-02).
- The data server cannot start on Windows (ISS-03).
- IRSA's frequent 502 errors push the whole app into simulated mode (ISS-04).

Fields that straddle RA 0h also lose their Gaia stars (ISS-05, medium because it is rare).

Everything below was reproduced; reproduction steps are in each entry.

| Severity | Count | Meaning |
|---|---|---|
| High | 4 | Wrong science output, or the app/server cannot run as documented |
| Medium | 8 | Misleading output, missing documented feature, or a broken quality gate |
| Low | 15 | Cosmetic, edge cases, documentation drift |

---

## 1. What was tested and how

| Layer | What | Result |
|---|---|---|
| Existing suites | `pipeline` 96/96, `data` 5/5 (2 network cases skipped), `workflow` 77/77, `field` all pass, `shell` 96/96*, `review` 66/66*, `live` all pass (see ISS-04), `qa/moving-sky` all pass, `qa/flyto` all pass, `qa/mobile-a11y-perf` 118/118 (330/330 contrast checks), `assets` pass, `qa/moving-sky-mobile` **fails** (ISS-11) | * needed a local workaround for ISS-11; the 77/96/66 counts differ from STATUS.md (77/87/64) |
| New UI tests (130 checks saved, headless Chrome) | Sky view, go-to, timeline, blink, zoom, panel (filter, search, sort, export), Compare, Field (sim and live), deep links, Examples, Live request box, Cancel, mobile (390 px) in light and dark, resize 200 to 2560 px, key mashing, blocked storage, corrupt storage, WebGL off, CDN blocked | 126 pass. The 4 other results are 2 wrong expectations in my script (drag direction, which scan the field centres on) and the pole limit, counted for north and south (ISS-18) |
| Pure-function tests | Coordinate parsers (60 inputs), formatters, tangent-plane maths, RA-wrap, CSV | ISS-05, 13 to 16, 19 |
| Server API | 20 request shapes: bad/missing/out-of-range params, wrong method, CORS from foreign origins, path traversal | All validated correctly; CORS correctly limited to localhost origins |
| Star accuracy | Section 3 | See there |
| Pages | Homepage, app, Moving Sky, old UI demo, 4 dev pages, GitHub Pages demo (all 200) at 1440 and 390 px | ISS-21 |

Not covered: Firefox/Safari, real phones, screen readers, cold JPL builds for every example (done for Psyche, Barnard, Eps Indi, WISE 0855, RW Aur; R Dra was still warming), and any claim about a real Planet X.

---

## 2. Issues

### High

**ISS-01: "Variable" flags on real frames are mostly false (peak ratio on an under-sampled PSF).**
`app/js/pipeline/detect.js:130-135` flags a fixed-position source as *Brightness change* when its **peak** changes by more than ×1.8 or less than ×0.55. SPHEREx stars are about 1 px FWHM, so the peak depends on where the star falls in the pixel, not only on its brightness.
- Reproduce: use the 7 live example fields. I summed a 7×7 aperture for every such flag and compared flux ratios. 11 of 13 *Brightness change* flags had flux ratios between 0.92 and 1.19, with peak ratios between ×0.25 and ×2.77. Only RW Aur A (flux ×1.7 and ×2.4, a genuine variable) was real.
- Examples: Barnard field, Gaia G 13.0 star, "×0.48 in peak" with 5×5 flux ratio 0.97 (frame 1: 24.6 at the centre pixel; frame 2: 12.0 with its neighbours at 11.4 and 12.0); Psyche field G 16.6 star ×2.77 with flux ×1.12.
- Impact: roughly 85% of variable flags on real data are false. Reviewers are told these sources "dropped/changed" when they did not.
- Fix: compare aperture or PSF-fit flux instead of peak, or compare 3×3 sums.
- **Fixed** 2026-11-13 (see STATUS.md).

**ISS-02: Fake stars are drawn on top of the real star map.**
`app/js/sky/index.js:80-82` adds three always-on `THREE.Points` layers: 26,000 random "resolved stars" (12,000 on low-end), 280 random bright stars of 3.2 to 5 px and 280 matching 18 to 42 px halos, all from a seeded RNG, on top of the NASA/Gaia backdrop.
- Check: I reproduced the RNG positions. Only 23 of the 280 bright sprites lie within 0.5° of a real G < 5.2 star (chance level is 14.6), so about **92% of the bright, haloed stars are fake**. The 26,000 faint ones are random by construction.
- Impact: any star the user sees may not exist at that position. This conflicts with the project's honesty rule, and it matters for the per-star accuracy requirement.
- Fix: remove the three layers (the 4k Gaia-based backdrop already carries the stars), or draw a real catalogue.
- **Fixed** 2026-11-13 (see STATUS.md).

**ISS-03: `node server/index.mjs` does nothing on Windows.**
`server/index.mjs:123` starts only `if (import.meta.url === \`file://${process.argv[1]}\` || process.argv[1]?.endsWith('server/index.mjs'))`. On Windows `argv[1]` is `F:\...\server\index.mjs`, so both tests are false. The process exits with code 0, prints nothing and listens on nothing. The README's "Run it" and "For the team" steps both fail, and the badge silently stays on *Simulated data*.
- Workaround used: `node --input-type=module -e "const m=await import('./server/index.mjs'); m.createServer().listen(8787,'127.0.0.1')"`.
- Fix: compare `fileURLToPath(import.meta.url)` with `path.resolve(process.argv[1])`.
- **Fixed** 2026-11-14 (see STATUS.md).

**ISS-04: IRSA 502s make live mode unreliable, and failure handling is poor.**
During testing, IRSA's `spherex_dr1` SIA endpoint answered **HTTP 502 on about half of cold requests** (e.g. 5 of 6 attempts for Psyche, 3 of 4 for Eps Indi). `server/lib/net.mjs` retries once; one failed collection (out of two) fails the whole request.
- `initData()` (`app/js/data/index.js:98-117`) probes `/api/scans` once. When that 502s, the **whole session falls back to "Simulated data"** with six invented movers, with no retry and no explanation. A reload fixes it. This also made `tests/live.test.mjs` fail on my first run and pass later with no change.
- In the Field view a 502 shows the raw upstream HTML in the toast and the header pill: `Simulated field · live data failed: irsa.ipac.caltech.edu answered HTTP 502: <!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"> <html><head> <title>502 Proxy Error</title>…`.
- A simulated field then appears at a **real** RA/Dec, with planted fake stars, a fake asteroid and a fake variable. It is labelled, but easy to misread.
- Fix: retry 2 to 3 times with backoff, return the collections that did answer, strip HTML from error text, and retry `/api/scans` in `initData`.

### Medium

**ISS-05: Fields that touch RA 0h/360° lose their Gaia stars.**
`app/js/data/index.js:176` (`toField()`) computes `ra - j.ra0` with no wrap, so a star 0.004° east of a field at RA 359.997° lands at x = 207,577 px.
- Reproduce: `GET /api/field?ra=359.9985&dec=2.0&size=300&det=1&known=0`. 5 of 9 Gaia stars get |x| > 200 px, and only 4 of the 7 that exactly belong in the frame are placed inside it. The server's own `gridPixel` is correct (it uses `sin(Δα)`).
- Impact: for a field that straddles RA 0h/360° (roughly 1 pointing in 4,000 for a 300″ field) the *Gaia stars* overlay and the "a change at a catalogued star is variability" matching silently lose the stars on the other side of the wrap.
- Fix: wrap `ra - ra0` into (-180°, 180°], or reuse the server's tangent-plane formula.
- **Fixed** 2026-11-14 in PR #6 (Tejas): `toField` wraps RA into (−180°, 180°].

**ISS-06: The Help sheet and STATUS.md advertise review features that were removed.**
`app/index.html:80`: "Movers panel: review candidates. Filter, sort, **mark them follow-up or rejected, and add notes**." Commits `5ce9599` and `a696c43` removed the buttons and the note box. `Follow-up`/`Rejected`, `USER_STATUSES`, and the Rejected sort order remain as dead code in `candidates/format.js`, and STATUS.md still lists "Follow-up/Rejected review with notes (localStorage)" as done.
- Fix: update the Help text and STATUS.md, or restore the feature. Without it, a reviewer has no way to record a decision.
- **Fixed** 2026-11-14 (see STATUS.md).

**ISS-07: "Faded star" / "Brightened star" flags fire on blends and noise crossings, and sometimes duplicate.**
- Barnard field, Gaia G 15.6: *Faded star*, "dropped below detection", although the star's pixel value **rose** from 2.0 to 4.6. It is the shoulder of a brighter neighbour and has no local maximum in frame 1.
- Barnard field, G 16.7: *Brightened star* from a 7σ threshold crossing (pixel values 1.1 and 1.6 over a 0.9 background).
- RW Aur field: one Gaia star (156430027546480512, G 14.8) is flagged twice in one pair (×0.25 and ×1.83, 0.6 px apart).
- Fix: use flux in a fixed aperture and de-duplicate flags within a few pixels.
- **Fixed** 2026-11-13 (see STATUS.md).

**ISS-08: "Matches proper motion/ephemeris" is asserted on a 3 px tolerance, not on the measured displacement.**
`detect.js:127,166,188` accept a known object within 3 px, and the verdict reads "Identified. Position agrees with the ephemeris."
- Barnard's Star, pair 0→1 (192 d): the proper motion predicts 5.4″ (0.9 px), the centroid shift measured is 10.0″ (1.6 px), and the card says *Moved 10″ … matches proper motion · 7.0″ from Gaia DR3 proper motion*.
- Cause: the star is saturated (G 8.2). `server/lib/field.mjs:110-111` replaces the masked 3×3 core by the frame median, so the star shows as a ring around a hole and its centroid is biased by up to about 1 px. The same hole is visible in the Field image.
- Fix: for saturated/masked cores, report the predicted position and say the centroid is unreliable, or centroid with the mask; report the residual and flag it when it exceeds about 1 px.

**ISS-09: Two example targets do not behave as their own notes and the README say.**
- *R Draconis*: the note and README promise "Variable flags … a textbook Variable". The G 6.4 star saturates (flags TRANSIENT, SUR_ERROR, OVERFLOW; noise σ is 0.26 to 0.61 here against 0.02 to 0.18 in the other fields), so the only flags are "Flagged by the SPHEREx pipeline" artifacts with the verdict "Reject". The Mira itself is never reported as variable.
- *Epsilon Indi Ba/Bb*: the note says the pair is "absent from Gaia", but the app itself identifies **Gaia DR3 6412596012146801152** (G 18.03, parallax 270.7 mas, proper motion 3982/−2467 mas/yr, so 4.68″/yr) as the known mover at the field centre. It is listed as "Gaia DR3 <id>" because only Barnard's Star has a name in `GAIA_NAMES`.
- (Example coordinates are fine; see section 3.)
- **Fixed** 2026-11-14 (see STATUS.md).

**ISS-10: Compare and the Movers cutouts are always synthetic, even for live data, and two generators disagree.**
`compare/cutout.js` and `candidates/cutout.js` draw invented star fields and an invented mover (exaggerated up to ×6000 for slow ones). It is labelled "Illustrative cutout (simulated pixels)", but real known objects from JPL (live mode) are shown on fake pixels, and the real frames are only reachable through Field.
- The two files use different seeds (`hash(c.id)` against `seedIndex`), so the inspector and Compare draw different star fields for the same candidate. `candidates/cutout.js` also lacks the RA-wrap fix that `compare/cutout.js` has (a track crossing 0h is pinned to the edge).
- Fix: render the Field frames for live candidates, or at least share one generator.
- **Fixed** 2026-11-14 in PR #6 (Tejas): one shared generator with the RA-wrap fix. Live candidates still show synthetic cutouts (the first half of this issue stays open).

**ISS-11: The quality gates do not run on Windows.**
- `tests/browser.mjs:75` spawns `python3`. On Windows that is the Store stub, so **every browser suite dies with "could not start a static server"** (README says "use `py` instead of `python3` on Windows", but the helper hard-codes it).
- `tests/shell.test.mjs:50` and `tests/review.test.mjs:42,248` call `import(path.join(ROOT, …))`. On Windows this throws `ERR_UNSUPPORTED_ESM_URL_SCHEME` (needs `pathToFileURL`).
- `qa/moving-sky-mobile.test.mjs:26-28` searches for `'\nupdate();\n'`. With `core.autocrlf=true` and no `.gitattributes`, the checked-out file has CRLF and the test throws "cannot find init call to instrument". A `.gitattributes` with `* text=auto eol=lf` would fix this one.
- `tests/live.test.mjs:56` uses `window` inside Node (`ReferenceError`) behind `|| true`, so the assertion is vacuous and the suite crashes if any candidate exists.
- `tests/browser.mjs:17` hard-codes a macOS session scratch path.
- STATUS.md test counts (workflow 88, shell 87, review 64) no longer match the suites (77, 96, 66).
- **Fixed** 2026-11-14 (see STATUS.md).

**ISS-12: The "Anchor on date" box silently ignores or snaps bad dates.**
`getField` (`data/index.js:209`) drops `t` unless `t > 60000`, so a date before 25 Feb 2023 loads an *unanchored* field with no message (`t=2020-01-01` gave "Live · SPHEREx D3 · 1.66 µm"). A date past the survey (`t=69000`, 2050) is accepted and snaps to the last exposure (2.41 µm) without saying so. Only unparsable text is rejected.
- Fix: validate against the survey's date range and say what the anchor resolved to.

**ISS-28: A mover that lands within 1.5 px of a catalogued star is reported as that star brightening.**
`detect.js` `starAt()` matches any appeared or vanished source to a Gaia DR3 star within 1.5 px and then judges it as variability, never motion. Found by the injection-recovery test (`scripts/injection-recovery.mjs`, 2026-11-14): planted anywhere, 12σ+ movers are recovered 66–81% of the time overall but only 28% in Barnard's Star's field (218 Gaia stars in 49×49 px, so ~60% of the area is within 1.5 px of a star); planted clear of stars the same field gives 74%.
- Impact: in dense fields most real movers would be filed as *Brightened star* / *Faded star* and never reach the review list.
- Fix: before calling it a brightening, require the star to be bright enough that the pipeline would have detected it (G limit per band), or compare the appeared source's flux with the star's catalogue magnitude; otherwise report both readings ("brightening of G 18.6 star, or a mover on top of it").

### Low

| ID | Issue | Evidence |
|---|---|---|
| ISS-13 (fixed) | Wrong rounding in the Field/Live text: `pipeline/format.js` `fmtRA`/`fmtDec` print "60.0s" / "60″" | RA 08h55m59.97s prints `08h 55m 60.0s`; Dec −7°14′59.6″ prints `−7° 14′ 60″`. Visible in the loading box: "Dec −33° 19′ 60″" |
| ISS-14 (fixed) | `candidates/format.js` `fmtDec(-0.04)` gives "−0.0°", while `sky/coords.js` deliberately gives "+0.0°" | Two formatters disagree |
| ISS-15 (fixed) | `radec()` / `pixel()` use a first-order tangent plane. Error against exact TAN at the corners of a 600″ field: 0.3″ at Dec 30°, 0.85″ at 60°, 2.8″ at 80°, 5.7″ at 85°, 30″ at 89° | Used for Add to review list and Show on sky positions; the server uses exact TAN |
| ISS-16 (fixed) | `parseCentre('12h +30d')` returns null although `parseDec('30d')` is accepted; `'08h 55m 60s, 0'` is accepted as 55m + 60 s; `'24h, 0'` becomes RA 0 | `sky/coords.js` |
| ISS-17 | Saturated-star cores appear as holes in the Field image (masked pixels become the frame median) | Barnard's Star, section 3 |
| ISS-18 (fixed) | The sky camera cannot look at the celestial poles: `clampPitch` (`sky/index.js:165`) stops at 1.5 rad, so go-to `0h, +90` centres on Dec ±85.9° with no message | North/south pole checks, centre Dec 85.94° |
| ISS-19 (fixed) | CSV export does not neutralise cells starting with `=`, `+`, `-`, `@` (spreadsheet formula injection from server-supplied names/notes) | `csvField('=HYPERLINK("http://x")')` is quoted but still starts with `=` |
| ISS-20 (fixed) | three.js r128 and the Inter font load from cdnjs/Google Fonts with no SRI, and the sky cannot render offline (a clear message is shown instead) | `app/index.html:10-11,110` |
| ISS-21 (fixed) | `artifacts/ui-demo/index.html` requests `assets/sky_4k.jpg`, which is not in the snapshot (404 on every load; it falls back to the procedural sky) | Console 404 |
| ISS-22 (fixed) | Documentation drift: README/server README say `spherex_qr2 + qr3` (code uses `dr1 + qr3`); README, WRITEUP and PITCH still have `[Team member names]` and `[Video link]`; STATUS.md and README mention `docs/deck/`, removed in `ab2c660`; README says run `python3 -m http.server` | grep of the `*.md` files |
| ISS-23 | The field overlay's labels collide ("252790 (2002 EM154)" over "Variable" in the Psyche field) | Screenshot with Known objects and Flags on |
| ISS-24 (fixed) | Size limits disagree: server accepts `size` 20 to 600 but clamps to ≥ 40 (N ≥ 8); the deep link accepts 20 to 3000; the Live request box offers 120/300/600 only | `server/index.mjs`, `lib/field.mjs:128`, `main.js:23` |
| ISS-25 (fixed) | Opening Field in live mode with `store.field` null requests `ra=undefined` ("Live field failed (Bad parameter ra=undefined)") | Reachable only through the store, not the UI, because the Field tab always sets a field first |
| ISS-27 (fixed) | On phones the "Planet X" title link is 51×16 px, below a comfortable touch target | Measured at 390 px |
| ISS-26 | Live mode's panel is empty by default (0 movers in the home patch); the message is clear, but the demo opens with nothing to review. _Snapshot mode (no server; the hosted copy) opens with the known objects of the six saved example fields, 16 Psyche first (2026-11-14); live mode is unchanged._ | `/api/candidates` returns `[]` for the home patch |
| ISS-29 | At ≥ 30σ, about 5% of PSF-shaped sources fail the PSF-fit artifact test at unlucky sub-pixel phases and are called *Not PSF-shaped* (`psfMisfit` evaluates the Gaussian at a 3×3 centroid that is biased towards the pixel centre on an under-sampled PSF); a bright real mover can be rejected for this | Injection-recovery test, 2026-11-14: 50 of 960 planted 40σ sources |

---

## 3. Star accuracy

Per-star data (1,884 rows) is in [`qa/star-accuracy.csv`](qa/star-accuracy.csv): `dataset, star_id, mag, expected position, epochs expected/detected, mean offset (px, ″), notes`.

### 3.1 Stars on the sky map (the NASA/Gaia backdrop)
Each of the 1,347 Gaia DR3 stars brighter than G 4.6 (|Dec| < 80°) was located in `sky_4k.jpg` with the documented RA/Dec mapping, then measured by centroiding.

| Measure | Result |
|---|---|
| Stars with a clear image peak | 1,345 of 1,347 |
| Median offset (dx, dy) | 0.00, 0.00 px, so no flip, shift or rotation |
| Median positional error | 46″ (1 pixel is 316″ in Dec and 5.3′ in RA at the equator, so this is below the image resolution) |
| Within 3 px | 1,302 (97%); the 43 outliers are crowded or nebulous areas, e.g. G 2.7 near Orion's belt |
| Fly-to in the rendered app (28 stars spread over the sky, 6° field) | median centre error 2.0′, which is image quantisation |

So the **backdrop stars are correct**. The **fake overlay** drawn on top of them is not (ISS-02).

### 3.2 Real SPHEREx frames against Gaia DR3 (live fields)
The 6 example fields, the home field and one field across RA 0h (3 to 6 frames each), **every Gaia star with G < 19 inside the frame** (all 307 stars, in the CSV).

| Gaia G | Stars | Detected / expected (3σ, within 3 px) |
|---|---|---|
| < 13 | 8 | 28/28 (100%) |
| 13 to 15 | 20 | 61/63 (97%) |
| 15 to 16 | 22 | 69/74 (93%) |
| 16 to 17 | 40 | 93/125 (74%) |
| 17 to 18 | 78 | 183/250 (73%) |
| 18 to 19 | 139 | 199/435 (46%) |

- **Astrometry (G < 15, 28 detected stars): median offset 1.05″ (0.17 px), 90th percentile 8.9″.** The outliers are a saturated star (R Dra, G 6.4, 9.2″) and two blends (G 14.7 and 15.0: 8.8″, 14.3″). Fainter matches are inflated by chance coincidences with noise peaks, so the CSV offsets for G > 16 should not be read as astrometric errors.
- **Proper motion works.** Barnard's Star was found at the predicted position in all 3 frames (10.39″/yr, matching Gaia's −802/+10362 mas/yr), and Eps Indi B (4.68″/yr) is identified from Gaia.
- The overlay propagates proper motion but ignores parallax (documented in `server/README.md`); the effect is at most 0.09 px (Barnard's Star, 547 mas).
- Barnard's Star has a **centroid error up to 7″** because of saturation (ISS-08).
- Every 5σ detection with no Gaia star within 3 px was faint (peaks 0.1 to 1.2 MJy/sr) and often persistent across frames, which fits sources fainter than Gaia's limit. The home field shows a vertical line of four such faint detections at x ≈ 27 (a possible detector column pattern; not investigated).
- Near RA 0h the overlay breaks (ISS-05: only 3 of the 9 stars placed correctly in the RA 359.9985° field).
- The same stars give variable flags with about 85% false positives (ISS-01, ISS-07).

### 3.3 Example targets against Gaia DR3 (propagated to epoch 2026.0)

| Target | Offset of the example centre |
|---|---|
| Barnard's Star | 0.1″ |
| R Draconis | 0.1″ |
| RW Aurigae A | 1.6″ (B: 0.6″) |
| Epsilon Indi B (Gaia DR3 6412596012146801152) | 1.8″ |
| 16 Psyche | the frame centroid is **1.29″** from an independent JPL Horizons query (README claims < 2″); the server's ephemeris sample is 0.06″ from Horizons |
| WISE 0855−0714 | not in Gaia (expected); nothing detected at 4.97 µm, an honest null result |

### 3.4 Simulated field (230 planted stars)
All results are against the planted truth.

| Measure | Result |
|---|---|
| Stars bright enough to expect (> 8σ in ≥ 1 epoch, inside the 4 px margin) | 81 |
| Detected in every epoch they were expected | 80/81 (the miss is a 1.2-amplitude star 2.4 px from a neighbour) |
| Centroid error | median 0.12 px (0.7″), 95th percentile 0.45 px, maximum 1.18 px |
| Peak against truth | median 0.97, 5th to 95th percentile 0.85 to 1.34 |
| False detections (not star, object or artifact) | 0 in all 8 frames |
| Planted objects | asteroid → *Known*; slow mover → *Uncatalogued mover*; variable → *Brightness change*; single-pixel spike → *Artifact*; 14 same-band pairs all classified correctly |
| By design never detected | 14 stars inside the 4 px edge margin (none brighter than amplitude 5) |

### 3.5 Summary
Positions of real stars are good (sub-pixel to about 1″ for unsaturated stars). Brightness-based judgements about those stars (ISS-01, ISS-07, ISS-08) and the overlay near RA 0h (ISS-05) are not. On the sky map, the real stars are right and about 92% of the bright "stars" drawn over them are invented.

---

## 4. Feature checklist

| Feature | Result |
|---|---|
| Homepage: two buttons, both links 200, no overflow | Pass |
| Sky: drag (1:1 grab), wheel, +/−, zoom limits 6° to 100°, reset, arrow keys, readout | Pass (ISS-18 at the poles) |
| Sky: grid and tracks toggles (buttons and G/T) | Pass |
| Go-to: candidate numbers ("3", "c03", "#3", "candidate 3"), RA/Dec, bad input, `/` focus, Esc | Pass (ISS-16, ISS-18) |
| Timeline: scan buttons, keys 1 to 9, scheduled scan disabled and toast, Blink and B | Pass |
| Markers: number and name labels, hidden by filter, one per scan | Pass |
| Movers panel: filter (4), search, empty state, clear, sort (id/shift/band/status), keyboard list, Export (CSV download, JSON copy, filter respected) | Pass (ISS-06, ISS-19) |
| Inspector and Esc to close | Pass |
| Compare: opens, scan pickers, wipe (mouse, Home/End), Difference, Blink, Esc, no-selection toast | Pass (ISS-10) |
| Field (sim): blink/diff/track/play, passes, mismatch warning plus "compare with … instead", N/P, vetting, click-to-select, readout, Add to review list (no duplicates), Show on sky, URL sync | Pass |
| Field (live): Examples, request box (invalid centre, date, Dec 91), Load, Cancel, overlays (Flags, Known, Gaia, Bad pixels), Play, loading steps, deep link | Pass (ISS-01, 04, 07, 08, 09, 12, 13) |
| Deep links: degrees, sexagesimal, bad ra/dec/size/det/t, XSS text, RA 0 and 360 | Pass |
| Persistence: field-added candidates survive reload (live); corrupt, XSS, 3,000-entry and blocked storage | Pass |
| Resilience: WebGL off, CDN blocked, server unreachable, rapid view switching, key mashing | Pass |
| Layout: 200 to 2560 px, 390 px in light and dark, no overflow, touch targets ≥ 32 px | Pass |
| Help sheet: open/close, focus trap | Pass (ISS-06 text) |
| Data server API: validation, CORS, 404/405 | Pass (ISS-03, 04, 24) |
| Moving Sky demo | Pass (qa suite); mobile suite fails (ISS-11) |
| GitHub Pages demo | Reachable, matches `main` |

---

## 5. Minor observations (not graded as issues)

| ID | Observation | Evidence |
|---|---|---|
| OBS-01 | The 16 Psyche field returns 12 flags for the Sep 2025 → Feb 2026 pair: 1 known object, 1 false variable (ISS-01), 10 artifacts from pipeline-flagged pixels. The list is noisy for a reviewer. | Psyche example, pair 0→1 |
| OBS-02 | Catalogued asteroid 252790 (2002 EM154), V 21.2, is predicted at pixel (8.7, 1.0) in frame 0 where the frame shows SNR 48. That is far too bright for V 21, so it is probably a star, hot pixel or flagged region; not investigated. It also crowds the label of a nearby flag (ISS-23). | Psyche field, `known[0]` |
| OBS-03 | Epsilon Indi field: a "Source vanished" flag at (45.9, 2.8), near the cutout edge, persists in every later pair with no explanation. Real or an edge effect; not determined. | Eps Indi example, pairs 0→3 and 0→5 |
| OBS-04 | Cancelling a load in the UI does not stop the server's build, and repeated loads of the same field start duplicate builds that queue behind JPL (about 1 min per frame). The README documents the background fetch; the duplicate builds are not mentioned. | `/api/progress` showed up to 5 concurrent builds for 2 fields |
| OBS-05 | JPL known-object checks are slow: 58 s (WISE 0855), 86 s (Barnard), 127 s (RW Aur), 364 s (Eps Indi) when run one after another. The R Draconis check had not finished when I stopped the servers, so its known-object result is untested. | Warm-up log |
| OBS-06 | A first robustness run (corrupt `localStorage` as invalid JSON, non-array, XSS name, string and NaN positions, 3,000 entries, blocked storage) passed in full; its result file was overwritten by a later run, so the saved counts in section 1 exclude it. | Re-run of the WebGL/CDN/resize/key-mashing half is saved |
| OBS-07 | `/api/known` (JPL first pass) timed out at 60 s while the server was busy with other JPL builds; there is no queue indicator for it. | Last server API probe |
