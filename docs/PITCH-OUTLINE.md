# NASA Planet X: Pitch Outline

Nine slides, drawn from `docs/WRITEUP.md`. Every number and claim here comes from the write-up. The hosted copy shows real saved SPHEREx frames for six targets and uses the simulation only where it says so; the real-data results are one known asteroid recovered and an injection test, not a discovery.

## Slide 1: NASA Planet X

- **Key message:** A tool for finding the parallax a distant planet cannot hide in SPHEREx's repeated infrared sky maps.
- **Supporting points:**
  - Space Apps Challenge 2026: "Planet X and SPHEREx"
  - One app with three views on NASA's Deep Star Maps, plus an optional server for real SPHEREx data
  - Candidates for human review, never claimed detections
- **Visual:** Full-bleed screenshot of the app's Sky view on the Deep Star Maps backdrop, with mover markers.

## Slide 2: The problem

- **Key message:** A distant planet would be faint, but it cannot hide its parallax: Earth's motion swings it by 2 AU over its distance every year, ten times more than its own orbital crawl.
- **Supporting points:**
  - In a single image, a distant planet can't be told apart from a star.
  - At 500 AU: 58″ of orbital motion in six months, but an 825″ parallax jump (134 SPHEREx pixels) between two passes, and 7″ a day within a pass. At 1,000 AU: 413″ and 3.5″ a day.
  - So between passes it leaves the cutout ("vanished here, appeared there"); within a pass, re-imaged 1–18 days apart, it moves a few pixels against fixed stars.
  - Asteroids, brown dwarfs, variable stars and artifacts also change between images.
- **Visual:** The distance table from the write-up, with the 500 AU row highlighted, next to a sketch of a dot jumping out of one cutout into the next.

## Slide 3: Why SPHEREx

- **Key message:** SPHEREx looks 90° from the Sun, so its six-monthly passes see every patch from opposite sides of Earth's orbit: a 2 AU parallax baseline, built in.
- **Supporting points:**
  - Roughly six-month all-sky cadence, and within a pass the same patch re-imaged days apart (1.4, 4.4 and 17.8 days in our example fields)
  - Bursts of four exposures about 2.4 minutes apart, then a revisit hours to a day later
  - 6.15″ pixels; 0.75–5 µm in 102 bands
- **Visual:** The app's scan timeline (four scans, the last shown as scheduled).

## Slide 4: How it works

- **Key message:** From real SPHEREx exposures to a short list for a person to vet.
- **Supporting points:**
  - IRSA exposures (every current SPHEREx release, `spherex_dr1` + `spherex_qr3` today) → pair at matching wavelength → align cutouts on one grid
  - Detect at 5σ with 3σ hysteresis, then reject sources narrower than the PSF
  - Pair appeared and vanished sources into movers → cross-match with JPL Small-Body Identification and Horizons
  - Vet what is left by eye: cutout, compare, field analysis
- **Visual:** Horizontal pipeline diagram: Find → Match wavelength → Align → Detect → Reject artifacts → Classify → Cross-match → Review.

## Slide 5: The wavelength catch

- **Key message:** SPHEREx's linear variable filters mean frames can only be compared at matching wavelength.
- **Supporting points:**
  - At mismatched wavelengths, a blink shows colour differences, not motion.
  - The server reads each exposure's own wavelength map to pick matching frames; the app turns detection off for mismatched pairs and offers the nearest matching pass.
  - Matching limits the usable epoch pairs.
- **Visual:** Screenshot of the mismatched-wavelength warning on a 0.95 µm vs 3.29 µm pair.

## Slide 6: The app, three views

- **Key message:** Browse the whole sky, compare scans, analyse a field and review every mover in one place.
- **Supporting points:**
  - Sky: whole-sky view with tracks, Go to, and Blink across scans
  - Compare: wipe, Difference (a mover shows up twice) and Blink; Field: the detection pipeline with stamps and spectrum
  - Movers panel: Candidate, Matched and Likely statuses, CSV/JSON export
  - A badge always says *Live · SPHEREx*, *Saved SPHEREx data* (the hosted copy: real frames for six targets) or *Simulated data*
- **Visual:** Side-by-side screenshots of the Sky view with the review panel and of the Field view.

## Slide 7: Real data: a known asteroid, and what the detector can find

- **Key message:** On real SPHEREx frames the pipeline recovers a known asteroid where JPL says it should be, and we measured what it can and cannot find by planting movers into real frames.
- **Supporting points:**
  - 300″ field, 15 February 2026: 16 Psyche labelled *Known object*, within 2″ of its Horizons position; absent from the same field in September 2025 and September 2026
  - Injection test on six real fields, 720 trials per cell: 80–91% of movers at 12σ+ shifting 18–92″ recovered with both positions (0.9″ median error); a vanished source 91–97%, a new source with no counterpart 76–93%; zero false movers on the un-injected pairs
  - Nothing below 7σ, nothing under a 13″ shift, worse next to bright stars; the test found and fixed two detector bugs
  - One test field and six injection fields: not a survey and not a discovery
- **Visual:** Field view on the Psyche example with the Known-objects overlay on, and the recovery table.

## Slide 8: Honest about what is real

- **Key message:** The badge says it: live SPHEREx data from the server, saved real frames for six targets on the hosted copy, or simulation, labelled.
- **Supporting points:**
  - Real: SPHEREx exposures and flag planes from IRSA, JPL positions, Gaia DR3 stars, NASA Deep Star Maps backdrop, the pipeline on real frames
  - Saved: the hosted copy's six example fields and the known objects in them, frozen on the date shown
  - Simulated: the scans and six movers when nothing real is available, the Moving Sky field, all spectra
  - We claim no discoveries.
- **Visual:** Three-column "Real / Saved / Simulated" table.

## Slide 9: Limitations and next steps

- **Key message:** The real-data path works end to end and its limits are measured. Next, join the two halves of a Planet X signature across cutouts.
- **Supporting points:**
  - Risks: three epochs is the minimum for an orbit fit, false positives, nothing fainter than 7σ, a body inside 1,500 AU leaves the cutout between passes
  - A first cross-field linker exists: it predicts where a vanished source reappears for 300–2,000 AU, builds those cutouts and found a planted counterpart at the true distance on real frames. Next: run it on every real vanished source, across many fields
  - Then: multi-epoch linking and orbit fits, real spectra, a hosted data server
- **Visual:** Short roadmap line with three milestones. Close with team names `[Team member names]` and links: app https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW, Moving Sky https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b, `[Video link]`.
