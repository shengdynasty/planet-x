# NASA Planet X

NASA Space Apps Challenge 2026 entry for the challenge "Planet X and SPHEREx".

## Summary

NASA Planet X is a tool for searching SPHEREx's repeated infrared maps of the sky for things that move. For a chosen patch of sky, it collects SPHEREx exposures from different epochs, pairs them at matching wavelength, flags sources that shift against the fixed stars, and checks each flag against JPL's known asteroids and comets. Whatever is left is a candidate for a person to vet. The product is one browser app with three views (Sky, Compare, Field) and a review panel, set on NASA's Deep Star Maps 2020 all-sky image. An optional local server feeds it real SPHEREx exposures from NASA/IPAC IRSA and known objects from JPL. Without that server, everything the app shows is simulated and labelled as such. A separate technical demo, Moving Sky, runs the detection logic on a simulated field. Nothing in this entry is a detection.

## The problem

A distant, undiscovered planet ("Planet X") would be faint, and it would barely move. Something hundreds of AU away shifts only slightly over months, so a single image can't tell it apart from a background star. Repeated images of the same sky can.

SPHEREx re-maps the whole sky every six months, so anything that changes position between passes is worth a look. But asteroids, comets, brown dwarfs (nearby cool objects that also move), variable stars and detector artifacts also change between passes. The work is to find every change, explain the known ones, and leave a short, honest list of what is still unexplained.

## How it works

1. **Find the data.** Query NASA/IPAC IRSA Simple Image Access (collections `spherex_qr2` and `spherex_qr3`, calibrated science images only) for every exposure covering the target, and group exposures into survey epochs (a gap of more than 30 days starts a new one).
2. **Pair frames at matching wavelength.** SPHEREx uses linear variable filters, so the wavelength changes across the detector. Frames can only be compared at the same wavelength; otherwise a blink shows colour differences, not motion. The server reads each exposure's own spectral WCS (via a small HTTP Range read of the header and wavelength table) to find the wavelength at the target, then picks, per epoch, the exposure closest to a common reference wavelength. The Field view turns detection off for mismatched pairs and offers the nearest matching pass.
3. **Cut out and align.** Take a 120–600″ cutout from IRSA's cutout service, subtract the zodiacal-light model, and resample every epoch onto one common grid at 6.15″ per pixel, using our own FITS and WCS (TAN-SIP) readers.
4. **Detect.** Estimate sky and noise robustly (median and median absolute deviation) and keep local maxima above 5σ. Hysteresis: a source needs >5σ to be detected, but only a >3σ counterpart to count as "still there" in the other frame.
5. **Reject artifacts.** A source that appears in one frame and is narrower than the point-spread function is rejected as a cosmic ray or bad pixel. The PSF width is measured from each field's own stars, because real SPHEREx stars are about 1 pixel wide after resampling.
6. **Classify changes.**
   - Same position, large change in brightness: variable, not a mover.
   - New source with a similar-brightness source gone nearby: paired as a mover. The app reports displacement and rate.
   - Unpaired appearances and disappearances are listed separately.
7. **Cross-match with known objects.** JPL's Small-Body Identification service finds catalogued objects near the field at each frame's mid-exposure time, using SPHEREx's own position from the image header as the observer. JPL Horizons then gives each object's precise position on the grid. A Horizons match always wins: the source is labelled *Known object*, with its offset.
8. **Vet candidates.** Show stamps, position, brightness, displacement and a spectrum for each remaining mover, then send it to the review panel, where a person marks it *Follow-up* or *Rejected* and adds notes. Spectra are still a model, not extracted from the data. Even a candidate that passes every check needs a third epoch and an orbit fit before it is anything.

## What we built

### 1. The Planet X app (main product)

A full-screen browser app on NASA's Deep Star Maps 2020 all-sky image, with a strictly black, white and grey interface so that only the imagery carries colour. It works on phones and in light and dark themes. A badge in the top bar always says where the data comes from: *Simulated data* or *Live · SPHEREx*. A homepage at the repository root leads into the app and the Moving Sky demo.

- **Sky view.** A 3D view of the whole sky. Drag to look around, scroll or pinch to zoom, toggle an RA/Dec grid, and turn on tracks that connect each mover's positions across scans. A "Go to" box accepts coordinates or a candidate number. A scan timeline shows four all-sky scans about six months apart (the fourth shown as scheduled); Blink cycles through them.
- **Compare view.** Two scans of the selected mover with a draggable wipe, a Difference overlay (left subtracted from right, so a mover shows up twice) and Blink.
- **Field view.** The detection pipeline on one patch of sky: Blink, Difference and Track views, Flags and Known-objects overlays, a list of flagged sources (uncatalogued mover, known object, variable, artifact, left the field), and a vetting panel with stamps and a spectrum. With the server running, a *Live request* box sets the centre, size, detector and an optional date, and a built-in example loads asteroid 16 Psyche.
- **Review panel.** Every mover is *Candidate* (unmatched), *Matched* (known asteroid or comet) or *Likely* (for example, a probable brown dwarf). A reviewer can mark any mover *Follow-up* or *Rejected* and write a note; reviews are kept in the browser. The list can be filtered, sorted and searched, and exported as CSV or JSON. Sources flagged in the Field view can be added to the list.

### 2. Local data server (optional)

A small Node server (`server/index.mjs`, no dependencies) that does steps 1–3 and 7 of "How it works" on real data: it finds SPHEREx exposures in IRSA, matches wavelengths, downloads and aligns cutouts, and asks JPL which known objects are in the field. Detection itself runs in the browser, on the real frames. Results are cached on disk, so a field that took a few minutes the first time loads instantly afterwards.

### 3. SPHEREx Moving Sky (pipeline demo)

A standalone technical demo, now in the app's black, white and grey palette, that runs the detection logic on a simulated 320×320-pixel field near the ecliptic, at SPHEREx's 6.15″ pixel scale. The app's Field view uses the same pipeline and gives identical results on this field.

- Eight observation epochs from minutes to a year apart, mostly at 0.95 µm, with one pass each at 1.62 µm and 3.29 µm to demonstrate the matched-wavelength rule.
- Blink, Difference and Track (max-stack of same-wavelength passes) views, with Flags and Known-objects overlays.
- A detections list (uncatalogued mover, known object, variable, artifact, left the field) and a vetting panel with position, peak above sky, displacement, a verdict, 15×15-pixel stamps and a model spectrum across 102 bands. The candidate's spectrum shows reflected sunlight with water-ice absorption at 1.5, 2.0 and 3 µm, which is why it fades in the 3.29 µm pass.

## What is real and what is simulated

**Real, with the local server running:**

- SPHEREx exposures from IRSA (`spherex_qr2`, `spherex_qr3`), with wavelengths read from each file's own spectral WCS
- Known-object positions from JPL Small-Body Identification and Horizons
- The detection, artifact rejection and cross-matching, run on those real frames
- The sky backdrop: NASA/Goddard SVS Deep Star Maps 2020 (built from Gaia DR2), checked for orientation against known stars and the Large Magellanic Cloud

**End-to-end test on real data.** On a 300″ SPHEREx field observed on 15 February 2026, the pipeline flags asteroid 16 Psyche and labels it *Known object*, within 2″ of its JPL Horizons position; it is absent from the September 2025 and September 2026 frames of the same field. In that field, cosmic rays and bad pixels are labelled as artifacts, and one variable and one faint candidate remain. We have not vetted that candidate, and it is not a discovery. This is one test field, not a survey.

**Simulated or placeholder:**

- Without the server (including the hosted demo links below, where outside network requests are blocked): the scans, scan dates, all six movers in the review panel, their designations, positions, shifts, bands and notes, and the Field view's field. "Known asteroid" labels in this mode are illustrative, not real cross-matches. Slow movers' shifts are exaggerated in cutouts for visibility. The badge reads *Simulated data*.
- In Moving Sky: the star field, the noise, the band response and the planted objects (a catalogued main-belt asteroid, a variable star, one faint, slow, uncatalogued mover at about 500 AU, which is the kind of signal Planet X would leave, and a single-pixel artifact). Its ephemeris is a stub.
- Spectra, in both the app and Moving Sky, are models, not extracted from SPHEREx data.
- With the server, the review panel lists only the known objects JPL predicts in a small home patch (often none); new movers enter it only when a reviewer adds them from the Field view.

## Limitations and risks

- **Three epochs is the minimum for an orbit fit.** Even then the orbit is poorly constrained; two epochs only show a source is consistent with motion.
- **False positives.** Brown dwarfs, variable stars, cosmic rays, hot pixels and mis-paired sources can all look like movers. Hysteresis, the PSF-width test and brightness-ratio pairing reduce these but don't eliminate them, so a human stays in the loop.
- **Wavelength matching shrinks the usable data.** Fewer epoch pairs are usable per patch, and frames from different epochs are matched to within half a resolution element, not exactly.
- **Faint signals.** A distant planet would sit near the detection threshold. The 5σ cut trades sensitivity for reliability.
- **Small fields.** Live fields are 120–600″ (20–98 pixels across), so fast movers leave the cutout between scans, and the search covers chosen patches, not the whole sky.
- **Simplified measurements.** Frames are surface brightness after zodiacal-light subtraction, with no flux calibration, no PSF photometry and no use of the per-pixel quality flags. Bilinear resampling is good enough for blinking and differencing, not for precise astrometry.
- **Lightly tested on real data.** Thresholds were set on the simulated field and checked on two real fields: the app's home patch and the 16 Psyche test. They have not been validated at scale.
- **Slow first requests.** A new field takes about 10 seconds, or a few minutes when JPL is checked; everything is cached afterwards.

## Next steps

1. Run the pipeline across many real fields, not just chosen patches, and feed unmatched movers into the review panel automatically.
2. Measure the false-positive rate by injecting synthetic movers into real frames.
3. Add multi-epoch linking and a basic orbit fit once three or more matched-wavelength epochs are available.
4. Extract real spectra from the SPHEREx frames for vetting.
5. Use the per-pixel quality flags and proper photometry.
6. Host the data server so the public demo can show live data, not just the simulation.

## Team

[Team member names]

## Links

- App: https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW
- Moving Sky demo: https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b
- Video: [Video link]
