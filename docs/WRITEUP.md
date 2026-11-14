# NASA Planet X

NASA Space Apps Challenge 2026 entry for the challenge "Planet X and SPHEREx".

## Summary

NASA Planet X is a tool for searching SPHEREx's repeated infrared maps of the sky for the one thing a distant, unknown planet cannot hide: parallax. SPHEREx looks close to 90° from the Sun, so the two passes it makes over any patch six months apart see it from opposite sides of Earth's orbit, a 2 AU baseline. A body at 500 AU jumps 825″ between those passes, and within a single pass, where the same patch is re-imaged 1–18 days apart, it drifts 7″ a day. For a chosen patch the app collects SPHEREx exposures from every pass, pairs them at matching wavelength, flags sources that shift, appear or vanish against the fixed stars, and checks each flag against JPL's known asteroids and comets and Gaia DR3's stars. Whatever is left is a candidate for a person to vet. The product is one browser app with three views (Sky, Compare, Field) and a review panel, set on NASA's Deep Star Maps 2020 all-sky image. A local server feeds it real SPHEREx exposures from NASA/IPAC IRSA and known objects from JPL; without it, the hosted copy shows real saved frames for six example targets, and the simulation is used only where it says so. The detector was measured by planting synthetic movers into real frames. A separate technical demo, Moving Sky, runs the detection logic on a simulated field. Nothing in this entry is a detection.

## The problem

A distant, undiscovered planet ("Planet X") would be faint, and in a single image it looks exactly like a faint star. What gives it away is motion, and the motion is not the slow crawl along its orbit. At 500 AU a body circles the Sun at 0.03° a year, 58″ in six months. Earth's own motion does far more: seen from a moving Earth, anything that close swings back and forth every year by 2 AU divided by its distance.

| Distance | Orbital motion in 6 months | Parallax jump between two SPHEREx passes (6 months, 2 AU baseline) | Parallax drift within one pass |
|---|---|---|---|
| 300 AU | 125″ | 1,375″ (224 px) | 11.8″ per day |
| 500 AU | 58″ | 825″ (134 px) | 7.1″ per day |
| 1,000 AU | 20″ | 413″ (67 px) | 3.5″ per day |
| 2,000 AU | 7″ | 206″ (34 px) | 1.8″ per day |

Pixels are SPHEREx's 6.15″. The published Planet Nine orbit fits, with a semi-major axis around 400–500 AU, put such a body somewhere between about 300 and 700 AU today, so its parallax between passes is hundreds of pixels. Two consequences shape the whole tool. Between passes, a body closer than about 1,500 AU leaves a 300″ cutout altogether: in the first pass's cutout it is a source that vanished, and in a cutout a few fields away it is a new source with no counterpart. Within a pass, where SPHEREx re-images the same patch 1–18 days apart (1.4, 4.4 and 17.8 days in our six example fields), the same body moves 10–60″: a few pixels, inside one cutout, with the stars fixed around it.

Asteroids, comets, brown dwarfs (nearby cool objects that also move), variable stars and detector artifacts also change between images. The work is to find every change, explain the known ones, and leave a short, honest list of what is still unexplained.

## How it works

1. **Find the data.** Query NASA/IPAC IRSA Simple Image Access (every current SPHEREx all-sky collection, discovered from IRSA's catalogue so new releases are picked up automatically; `spherex_dr1` and `spherex_qr3` in Nov 2026; calibrated science images only) for every exposure covering the target, and group exposures into survey epochs (a gap of more than 30 days starts a new one).
2. **Pair frames at matching wavelength.** SPHEREx uses linear variable filters, so the wavelength changes across the detector. Frames can only be compared at the same wavelength; otherwise a blink shows colour differences, not motion. The server reads each exposure's own spectral WCS (via a small HTTP Range read of the header and wavelength table) to find the wavelength at the target, then picks, per epoch, the exposure closest to a common reference wavelength. The Field view turns detection off for mismatched pairs and offers the nearest matching pass.
3. **Cut out and align.** Take a 120–600″ cutout from IRSA's cutout service, subtract the zodiacal-light model, and resample every epoch onto one common grid at 6.15″ per pixel, using our own FITS and WCS (TAN-SIP) readers.
4. **Detect.** Estimate sky and noise robustly (median and median absolute deviation) and keep local maxima above 5σ. Hysteresis: a source needs >5σ to be detected, but only a >3σ counterpart to count as "still there" in the other frame.
5. **Reject artifacts.** A source that appears in one frame and is narrower than the point-spread function is rejected as a cosmic ray or bad pixel. The PSF width is measured from each field's own stars, because real SPHEREx stars are about 1 pixel wide after resampling.
6. **Classify changes.**
   - Same position, large change in brightness: variable, not a mover.
   - New source with a similar-brightness source gone nearby: paired as a mover. The app reports displacement and rate.
   - Unpaired appearances and disappearances are listed separately. Between passes this pair of flags, in two different cutouts, is exactly what a body at 300–2,000 AU leaves behind.
   - A change within 1.5 px of a Gaia star is a brightening or fading of that star only if the light is plausibly the star's (from its Gaia RP magnitude and the frame's own zero point) and actually changed; otherwise it is a mover sitting on a star, and the coincidence is named.
7. **Cross-match with known objects.** JPL's Small-Body Identification service finds catalogued objects near the field at each frame's mid-exposure time, using SPHEREx's own position from the image header as the observer. JPL Horizons then gives each object's precise position on the grid. A Horizons match always wins: the source is labelled *Known object*, with its offset.
8. **Vet candidates.** Show stamps, position, brightness, displacement and a spectrum for each remaining mover, then send it to the Movers panel for a person to look at. Spectra are still a model, not extracted from the data. Even a candidate that passes every check needs a third epoch and an orbit fit before it is anything.

## What the tool can and cannot find

Measured on real frames by the injection-recovery test below, stated plainly. It can find:

- **Within one pass, a body at 300–1,000 AU that reaches 12σ in a single exposure.** Re-imaged 2–8 days apart it moves 18–90″; the detector reports 80–91% of such movers with both positions, with a median position error of 0.9″, and no false movers on the six un-injected real pairs.
- **Between passes, the two halves of its signature.** A source that vanished is reported 91–97% of the time, a new source with no counterpart 76–93%. Joining the two across cutouts, by predicting where a vanished source reappears for each assumed distance, is the cross-field linker now being prototyped (next steps). Until it lands, a between-pass Planet X in our data is two separate flags for a person to connect.
- **Anything beyond about 1,500 AU**, which stays inside a 600″ cutout between passes and is handled like any other in-field mover.

It cannot find:

- **Anything fainter than about 7σ in one exposure.** A nominal 8σ source is recovered one time in five, a 4σ source never. The 5σ detection and 7σ "firm" bars trade sensitivity for a clean list.
- **Shifts under 13″ (2.2 px) in a pair.** So nothing beyond about 3,000 AU within a pass gap of a few days, and nothing at 500 AU across a gap shorter than two days.
- **A mover within 3 px of a brighter star, or in the wings of a star twenty times brighter**, where its light cannot be separated from the star's.
- **Anything outside the patches someone asks for.** The search is per cutout, not all-sky, and it reports candidates, never detections: two epochs show consistency with motion; three or more and an orbit fit are needed before any claim.

## What we built

### 1. The Planet X app (main product)

A full-screen browser app on NASA's Deep Star Maps 2020 all-sky image, with a strictly black, white and grey interface so that only the imagery carries colour. It works on phones and in light and dark themes. A badge in the top bar always says where the data comes from: *Live · SPHEREx* (the local server), *Saved SPHEREx data* (real frames for the six example targets, saved in the repository; what the hosted copy shows) or *Simulated data*. A homepage at the repository root leads into the app and the Moving Sky demo.

- **Sky view.** A 3D view of the whole sky. Drag to look around, scroll or pinch to zoom, toggle an RA/Dec grid, and turn on tracks that connect each mover's positions across scans. A "Go to" box accepts coordinates or a candidate number. A scan timeline shows four all-sky scans about six months apart (the fourth shown as scheduled); Blink cycles through them.
- **Compare view.** Two scans of the selected mover with a draggable wipe, a Difference overlay (left subtracted from right, so a mover shows up twice) and Blink.
- **Field view.** The detection pipeline on one patch of sky: Blink, Difference and Track views, Flags and Known-objects overlays, a list of flagged sources (uncatalogued mover, known object, variable, artifact, left the field), and a vetting panel with stamps and a spectrum. With the server running, a *Live request* box sets the centre, size, detector and an optional date, and a built-in example loads asteroid 16 Psyche.
- **Movers panel.** Every mover is *Candidate* (unmatched), *Matched* (known asteroid or comet) or *Likely* (for example, a probable brown dwarf). Selecting one opens its cutout and description in a window on the left of the sky, while the panel keeps its position, shift and band with buttons to compare its scans, analyse its field or centre the sky on it. The list can be filtered, sorted and searched, and exported as CSV or JSON. Sources flagged in the Field view can be added to the list.

### 2. Local data server (optional)

A small Node server (`server/index.mjs`, no dependencies) that does steps 1–3 and 7 of "How it works" on real data: it finds SPHEREx exposures in IRSA, matches wavelengths, downloads and aligns cutouts, and asks JPL which known objects are in the field. Detection itself runs in the browser, on the real frames. Results are cached on disk, so a field that took a few minutes the first time loads instantly afterwards.

### 3. SPHEREx Moving Sky (pipeline demo)

A standalone technical demo, now in the app's black, white and grey palette, that runs the detection logic on a simulated 320×320-pixel field near the ecliptic, at SPHEREx's 6.15″ pixel scale. The app's Field view uses the same pipeline and gives identical results on this field.

- Eight observation epochs from minutes to a year apart, mostly at 0.95 µm, with one pass each at 1.62 µm and 3.29 µm to demonstrate the matched-wavelength rule.
- Blink, Difference and Track (max-stack of same-wavelength passes) views, with Flags and Known-objects overlays.
- A detections list (uncatalogued mover, known object, variable, artifact, left the field) and a vetting panel with position, peak above sky, displacement, a verdict, 15×15-pixel stamps and a model spectrum across 102 bands. The candidate's spectrum shows reflected sunlight with water-ice absorption at 1.5, 2.0 and 3 µm, which is why it fades in the 3.29 µm pass.

## What is real and what is simulated

**Real, with the local server running:**

- Gaia DR3 stars over every live field (ESA archive), with proper motions propagated to each frame time: stars moving faster than 1″/yr (Barnard's Star) are recognised as known movers, and brightness changes at catalogued stars are reported as variability rather than motion
- The SPHEREx pipeline's own per-pixel FLAGS plane, carried with every frame and shown as a *Bad pixels* overlay; a source on a flagged pixel is rejected as an artifact with the flag names (TRANSIENT, OUTLIER, …)
- SPHEREx exposures from IRSA (`spherex_dr1`, `spherex_qr3` as of Nov 2026; collections discovered automatically), with wavelengths read from each file's own spectral WCS
- Known-object positions from JPL Small-Body Identification and Horizons
- The detection, artifact rejection and cross-matching, run on those real frames
- The sky backdrop: NASA/Goddard SVS Deep Star Maps 2020 (built from Gaia DR2), checked for orientation against known stars and the Large Magellanic Cloud

**End-to-end test on real data.** On a 300″ SPHEREx field observed on 15 February 2026, the pipeline flags asteroid 16 Psyche and labels it *Known object*, within 2″ of its JPL Horizons position; it is absent from the September 2025 and September 2026 frames of the same field. In that field, cosmic rays and bad pixels are labelled as artifacts, and one variable and one faint candidate remain. We have not vetted that candidate, and it is not a discovery. This is one test field, not a survey.

**Injection-recovery test on real frames.** To measure what the detector can and cannot find, we planted synthetic movers into the six saved real fields (point-sampled Gaussians at each field's own measured PSF width, 0.59–0.74 px, at random sub-pixel positions clear of existing sources and bad pixels) and asked the pipeline what it reported. Brightness is the peak SNR a pixel-centred source would have; the real sub-pixel phase lowers the peak by up to 40%, which is what the detector sees. `scripts/injection-recovery.mjs` reproduces every number (720 trials per cell, fixed seed) and `tests/injection.test.mjs` guards them. Recovered means reported as *Uncatalogued mover* with both positions within 1.5 px of where it was planted (entering: *New source, no counterpart*; leaving: *Source vanished*), planted at least 1.5 px from any Gaia star:

| Peak SNR | 1 px (6″) | 2 px (12″) | 3 px (18″) | 5 px (31″) | 8 px (49″) | 15 px (92″) | enters the field | leaves the field |
|---|---|---|---|---|---|---|---|---|
| 4 | 0% | 0% | 0% | 0% | 0% | 0% | 3% | 2% |
| 8 | 0% | 7% | 16% | 19% | 18% | 18% | 42% | 34% |
| 12 | 0% | 17% | 90% | 90% | 84% | 81% | 76% | 91% |
| 20 | 0% | 14% | 89% | 91% | 88% | 79% | 93% | 97% |
| 40 | 0% | 5% | 88% | 85% | 88% | 85% | 93% | 92% |

What this says. Nothing below the 7σ bar is reported, by design, and a nominal 8σ source gets through only one time in five because its sub-pixel phase usually leaves its peak under the bar. From 12σ up, 80–91% of movers shifting 18–92″ between passes are reported with both positions, with a median position error of 0.15 px (0.9″). Shifts under the 2.2 px pairing threshold (13″) are never called motion: a two-pass comparison cannot resolve them. That limit does not bite Planet X: within a pass a body at 300–1,000 AU moves 18–90″ in 2–8 days, squarely in the recovered range, and between passes it moves 200–1,300″, more than a 300″ field, so in one cutout it looks like *Source vanished*, and in another cutout like *New source, no counterpart*. Those two signatures are recovered at 91–97% and 76–93% from 12σ up; linking them across cutouts is next step 3. Planted anywhere, without avoiding catalogued stars, recovery is 73–91% overall and 77% in Barnard's Star's field (218 Gaia stars in 49×49 px). Before this test it was 28% there: a mover landing within 1.5 px of a faint catalogued star was filed as that star brightening. The pipeline now compares the source's flux with what the star should have from its Gaia RP magnitude, using a zero point from the frame's own stars, and keeps the brightening reading only when the light is plausibly the star's and actually changed; otherwise it reports a mover and names the coincidence (issues.md ISS-28, fixed by this test). The test also found and fixed a linking bug: an entering source used to be paired with any vanished cosmic ray anywhere in the field (45% of entering sources at 12σ), which hid the *no counterpart* signal; the partner search now skips artifacts. At 30σ and above, about 5% of planted sources fail the PSF-shape test at unlucky sub-pixel phases and are called artifacts (ISS-29). The un-injected pairs produce no *Uncatalogued mover* in any of the six fields, so the false-positive rate for movers on these real pairs is zero.

**Simulated or placeholder:**

- Without the server, the app first looks for the **saved snapshots** in `app/data/snapshots/`: the server's real answer for the six example targets (SPHEREx frames and flag planes from IRSA, JPL's known objects, Gaia DR3 stars), saved on the date shown in the badge's tooltip. In that mode the badge reads *Saved SPHEREx data*, the scan timeline carries the home patch's real survey scans, the review panel lists the known objects JPL and Gaia put in those fields (16 Psyche among them), and the Examples menu and any position inside one of those fields show real data analysed in the browser; this is what the hosted copy on GitHub Pages shows. Any other position falls back to the simulation and says so in the Field header.
- Without the server and without the snapshots (the claude.ai artifact links below, where outside network requests are blocked, or `?data=sim`): the scans, scan dates, all six movers in the review panel, their designations, positions, shifts, bands and notes, and the Field view's field. "Known asteroid" labels in this mode are illustrative, not real cross-matches. Slow movers' shifts are exaggerated in cutouts for visibility. The badge reads *Simulated data*.
- In Moving Sky: the star field, the noise, the band response and the planted objects (a catalogued main-belt asteroid, a variable star, one faint, uncatalogued mover at about 500 AU with its orbital drift and the yearly parallax loop from Earth's orbit, which is the kind of signal Planet X would leave, and a single-pixel artifact). Its ephemeris is a stub.
- Spectra, in both the app and Moving Sky, are models, not extracted from SPHEREx data.
- With the server, the review panel lists only the known objects JPL predicts in a small home patch (often none); new movers enter it only when a reviewer adds them from the Field view.

## Limitations and risks

- **Three epochs is the minimum for an orbit fit.** Even then the orbit is poorly constrained; two epochs only show a source is consistent with motion.
- **False positives.** Brown dwarfs, variable stars, cosmic rays, hot pixels and mis-paired sources can all look like movers. Hysteresis, the PSF-width test and brightness-ratio pairing reduce these but don't eliminate them, so a human stays in the loop.
- **Wavelength matching shrinks the usable data.** Fewer epoch pairs are usable per patch, and frames from different epochs are matched to within half a resolution element, not exactly.
- **Faint signals.** A distant planet would sit near the detection threshold. The 5σ detection and 7σ firm bars trade sensitivity for reliability: nothing fainter than about 7σ in one exposure is reported.
- **Small fields.** Live fields are 120–600″ (20–98 pixels across). Between passes any body closer than about 1,500 AU leaves the cutout, which is the expected Planet X signature, so it shows up as two flags in two cutouts until the cross-field linker lands; and the search covers chosen patches, not the whole sky.
- **Simplified measurements.** Frames are surface brightness after zodiacal-light subtraction, with no flux calibration and no PSF photometry; brightness changes are judged on 5×5 aperture flux relative to the field's other stars, because SPHEREx's one-pixel PSF makes peak values depend on sub-pixel position. Bilinear resampling is good enough for blinking and differencing, not for precise astrometry.
- **Tested on real data by injection, not by discovery.** Thresholds were set on the simulated field; recovery on real frames is measured by planting synthetic movers (see the injection-recovery test above): 80–91% at ≥ 12σ for 18–92″ shifts, nothing below 7σ, nothing under a 13″ shift, and a few points worse in crowded fields. No real unknown mover has been found and confirmed.
- **Slow first requests.** A new field takes about 10 seconds, or a few minutes when JPL is checked; everything is cached afterwards.

## Next steps

1. Run the pipeline across many real fields, not just chosen patches, and feed unmatched movers into the review panel automatically.
2. Extend the injection test to later epoch pairs, blends and bright-star wings, and set the detection bar against it instead of against the simulation.
3. Cross-field linking, in progress: for a source that vanished, predict where it reappears in the next pass for each distance from 300 to 2,000 AU, fetch those cutouts and look for the new source; then multi-epoch linking and a basic orbit fit once three or more matched-wavelength epochs are available.
4. Extract real spectra from the SPHEREx frames for vetting.
5. Proper PSF photometry and flux calibration, so brightness changes can be measured, not just flagged.
6. Host the data server so the public demo can show live data, not just the simulation.

## Team

[Team member names]

## Links

- App: https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW
- Moving Sky demo: https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b
- Video: [Video link]
