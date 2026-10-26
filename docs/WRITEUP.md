# NASA Planet X

NASA Space Apps Challenge 2026 entry for the challenge "Planet X and SPHEREx".

## Summary

NASA Planet X is a tool for searching SPHEREx's repeated infrared maps of the sky for things that move. For a chosen patch of sky, it collects every SPHEREx exposure, aligns cutouts from different epochs, flags sources that shift against the fixed stars, and checks each flag against JPL's known asteroids and comets. Whatever is left is a candidate for a person to vet. We built two browser prototypes: a 3D all-sky interface for browsing and comparing movers, and a technical demo of the detection logic on a simulated field. All objects, candidates and numbers in both demos are simulated or placeholder data. Nothing in this entry is a detection.

## The problem

A distant, undiscovered planet ("Planet X") would be faint, and it would barely move. Something hundreds of AU away shifts only slightly over months, so a single image can't tell it apart from a background star. Repeated images of the same sky can.

SPHEREx re-maps the whole sky every six months, so anything that changes position between passes is worth a look. But asteroids, comets, brown dwarfs (nearby cool objects that also move), variable stars and detector artifacts also change between passes. The work is to find every change, explain the known ones, and leave a short, honest list of what is still unexplained.

## How it works

1. **Find the data.** Query NASA/IPAC IRSA Simple Image Access (collection `spherex_qr2`) for every exposure covering the target, and take a 60–120″ cutout. *(Stub: the Moving Sky demo generates frames instead.)*
2. **Pair frames at matching wavelength.** SPHEREx uses linear variable filters, so the wavelength changes across the detector. Frames can only be compared at the same wavelength; otherwise a blink shows colour differences, not motion. The Moving Sky demo turns detection off for mismatched pairs and offers the nearest matching pass.
3. **Detect.** Estimate sky and noise robustly (median and median absolute deviation) and keep local maxima above 5σ. Hysteresis: a source needs >5σ to be detected, but only a >3σ counterpart to count as "still there" in the other frame.
4. **Reject artifacts.** A single-pixel spike that isn't PSF-shaped is rejected as a cosmic ray or hot pixel.
5. **Classify changes.**
   - Same position, large change in brightness: variable, not a mover.
   - New source with a similar-brightness source gone nearby: paired as a mover. The demo reports displacement and rate.
   - Unpaired appearances and disappearances are listed separately.
6. **Cross-match with known objects.** Check each mover against an ephemeris: JPL Horizons and the small-body identification service in the real version. *(Stub: the demo's ephemeris knows one planted asteroid.)*
7. **Vet candidates.** Show stamps, position, brightness, displacement and a spectrum for each remaining mover. The demo's candidate spectrum shows reflected sunlight with water-ice absorption at 1.5, 2.0 and 3 µm, which is why it fades in the 3.29 µm pass. Even a candidate that passes every check is labelled as needing a third epoch and an orbit fit "before it is anything."

## What we built

### 1. Planet X UI demo (main product prototype)

A full-screen, interactive 3D view of the whole sky.

- **Sky view.** Drag to look around, scroll to zoom, toggle an RA/Dec grid, and turn on tracks that connect each mover's positions across scans. A "Go to" box accepts coordinates or a candidate number.
- **Movers list.** Each flagged source is *Matched* (known asteroid or comet), *Candidate* (unmatched) or *Likely* (for example, a probable brown dwarf), with All / Unmatched / Matched filters. Selecting one shows a 60″ cutout, its position, shift across scans, peak band, status and a note.
- **Scan timeline.** Four all-sky scans about six months apart (the fourth shown as scheduled); Blink cycles through them.
- **Compare mode.** Two scans of a candidate with a draggable wipe, a Difference overlay (left subtracted from right, so a mover shows up twice) and Blink.

### 2. SPHEREx Moving Sky (pipeline demo)

A technical demo that runs the detection logic from "How it works" on a simulated 320×320-pixel field near the ecliptic, at SPHEREx's 6.15″ pixel scale.

- Eight observation epochs from minutes to a year apart, mostly at 0.95 µm, with one pass each at 1.62 µm and 3.29 µm to demonstrate the matched-wavelength rule.
- Blink, Difference and Track (max-stack of same-wavelength passes) views, with Flags and Known-objects overlays.
- A colour-coded detections list (uncatalogued mover, known object, variable, artifact, left the field) and a vetting panel with position, peak above sky, displacement, a verdict, 15×15-pixel stamps and a spectrum across 102 bands.

## What is real and what is simulated

**Simulated or placeholder (everything you see as a result):**

- In the UI demo: the sky texture, the scans, scan dates, all six candidates, their designations, positions, shifts, bands and notes. "Known asteroid" labels are illustrative, not real cross-matches. Slow movers' shifts are exaggerated in cutouts for visibility. The backdrop is procedural until a real map (NASA SVS Deep Star Maps 2020) is added.
- In Moving Sky: the star field, the noise, the band response and three planted objects: a catalogued main-belt asteroid, a variable star, and one faint, slow, uncatalogued mover at about 500 AU (the kind of signal Planet X would leave), plus a single-pixel artifact. The ephemeris is a stub and the spectra are synthetic.

**Taken from the real mission or method:**

- SPHEREx's 6.15″ pixel scale and the roughly six-month all-sky cadence
- bursts of four exposures about 2.4 minutes apart, followed by a revisit hours to a day later
- the matched-wavelength rule that follows from the linear variable filters
- the detect → match → ephemeris-check logic

**The path to real data is concrete.** Replace the frame generator with IRSA SIA cutouts (`spherex_qr2`) and the ephemeris stub with JPL Horizons and the small-body identification service. Every other step stays the same. **No real SPHEREx data has been processed yet, and we report no discoveries.**

## Limitations and risks

- **Three epochs is the minimum for an orbit fit.** Even then the orbit is poorly constrained; two epochs only show a source is consistent with motion.
- **False positives.** Brown dwarfs, variable stars, cosmic rays, hot pixels and mis-paired sources can all look like movers. Hysteresis, the spike test and brightness-ratio pairing reduce these but don't eliminate them, so a human stays in the loop.
- **Wavelength matching shrinks the usable data.** Fewer epoch pairs are usable per patch.
- **Faint signals.** A distant planet would sit near the detection threshold. The 5σ cut trades sensitivity for reliability.
- **Small cutouts.** Fast movers leave 60–120″ cutouts between scans, and the search covers chosen patches, not the whole sky at once.
- **Untuned on real data.** Thresholds and matching radii were set on the simulated field, not validated on SPHEREx images.

## Next steps

1. Connect IRSA SIA and run the pipeline on real `spherex_qr2` cutouts.
2. Replace the ephemeris stub with JPL Horizons and the small-body identification service.
3. Feed real pipeline output into the UI demo's Movers list, and load the NASA SVS Deep Star Maps backdrop.
4. Add multi-epoch linking and a basic orbit fit once three or more matched-wavelength epochs are available.
5. Measure the false-positive rate by injecting synthetic movers into real frames.
6. Extract real spectra for vetting.

## Team

[Team member names]

## Links

- UI demo: [UI demo link]
- Moving Sky demo: [Moving Sky demo link]
- Video: [Video link]
