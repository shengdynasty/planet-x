# NASA Planet X: Pitch Outline

Nine slides, drawn from `docs/WRITEUP.md`. Every number and claim here comes from the write-up. Without the local data server, all app content is simulated and labelled; the real-data result is one test field, not a discovery.

## Slide 1: NASA Planet X

- **Key message:** A tool for finding what moves in SPHEREx's repeated infrared sky maps.
- **Supporting points:**
  - Space Apps Challenge 2026: "Planet X and SPHEREx"
  - One app with three views on NASA's Deep Star Maps, plus an optional server for real SPHEREx data
  - Candidates for human review, never claimed detections
- **Visual:** Full-bleed screenshot of the app's Sky view on the Deep Star Maps backdrop, with mover markers.

## Slide 2: The problem

- **Key message:** A distant planet would be faint and would barely move. Only repeated images can reveal it.
- **Supporting points:**
  - In a single image, a distant planet can't be told apart from a star.
  - Something hundreds of AU away shifts only slightly over months.
  - Asteroids, brown dwarfs, variable stars and artifacts also change between images.
- **Visual:** Two-panel sketch: a fast asteroid streaking across a field next to a barely shifted dot.

## Slide 3: Why SPHEREx

- **Key message:** SPHEREx re-maps the whole sky every six months, which gives a built-in time series for slow movers.
- **Supporting points:**
  - Roughly six-month all-sky cadence
  - Bursts of four exposures about 2.4 minutes apart, then a revisit hours to a day later
  - 6.15″ pixels
- **Visual:** The app's scan timeline (four scans, the last shown as scheduled).

## Slide 4: How it works

- **Key message:** From real SPHEREx exposures to a short list for a person to vet.
- **Supporting points:**
  - IRSA exposures (`spherex_qr2`, `spherex_qr3`) → pair at matching wavelength → align cutouts on one grid
  - Detect at 5σ with 3σ hysteresis, then reject sources narrower than the PSF
  - Pair appeared and vanished sources into movers → cross-match with JPL Small-Body Identification and Horizons
  - Vet what is left, then mark it Follow-up or Rejected
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
  - Review panel: Candidate, Matched and Likely statuses, Follow-up/Rejected, CSV/JSON export
  - A badge always says *Simulated data* or *Live · SPHEREx*
- **Visual:** Side-by-side screenshots of the Sky view with the review panel and of the Field view.

## Slide 7: Real data: 16 Psyche

- **Key message:** On real SPHEREx frames, the pipeline recovers a known asteroid where JPL says it should be.
- **Supporting points:**
  - 300″ field, 15 February 2026: 16 Psyche labelled *Known object*, within 2″ of its Horizons position
  - Absent from the same field in September 2025 and September 2026
  - Cosmic rays and bad pixels labelled artifacts; one variable and one faint, unvetted candidate remain
  - One test field, not a survey and not a discovery
- **Visual:** Field view on the Psyche example with the Known-objects overlay on.

## Slide 8: Honest about what is real

- **Key message:** With the server, the data and cross-matches are real. Without it, every mover and number is simulated and labelled.
- **Supporting points:**
  - Real: SPHEREx exposures from IRSA, JPL positions, NASA Deep Star Maps backdrop, the pipeline on real frames
  - Simulated: the hosted demos' scans and six movers, the Moving Sky field, all spectra
  - We claim no discoveries.
- **Visual:** Two-column "Real / Simulated" table.

## Slide 9: Limitations and next steps

- **Key message:** The real-data path works end to end. Next, scale it up and measure how often it is wrong.
- **Supporting points:**
  - Risks: three epochs is the minimum for an orbit fit, false positives, faint signals, small fields, thresholds tested on only two real fields
  - Next: run across many real fields, injection tests for the false-positive rate
  - Then: multi-epoch linking and orbit fits, real spectra, a hosted data server
- **Visual:** Short roadmap line with three milestones. Close with team names `[Team member names]` and links: app https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW, Moving Sky https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b, `[Video link]`.
