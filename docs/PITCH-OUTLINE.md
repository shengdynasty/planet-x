# NASA Planet X: Pitch Outline

Nine slides, drawn from `docs/WRITEUP.md`. Every number and claim here comes from the write-up. All demo content is simulated or placeholder data.

## Slide 1: NASA Planet X

- **Key message:** A tool for finding what moves in SPHEREx's repeated infrared sky maps.
- **Supporting points:**
  - Space Apps Challenge 2026: "Planet X and SPHEREx"
  - Two working browser prototypes
  - Candidates, never claimed detections
- **Visual:** Full-bleed screenshot of the UI demo's 3D all-sky view with mover reticles.

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
- **Visual:** The UI demo's scan timeline (four scans, the last shown as scheduled).

## Slide 4: How it works

- **Key message:** Six steps, from data query to a short vetted list.
- **Supporting points:**
  - IRSA SIA cutouts (`spherex_qr2`, 60–120″) → align and pair at matching wavelength
  - Detect at 5σ with 3σ hysteresis, then reject non-PSF spikes
  - Pair appeared and vanished sources into movers → cross-match with JPL Horizons and small-body identification
  - Vet what is left: stamps, displacement, spectrum
- **Visual:** Horizontal pipeline diagram with the six steps as boxes.

## Slide 5: The wavelength catch

- **Key message:** SPHEREx's linear variable filters mean frames can only be compared at matching wavelength.
- **Supporting points:**
  - At mismatched wavelengths, a blink shows colour differences, not motion.
  - The demo turns detection off and offers the nearest matching pass.
  - Matching limits the usable epoch pairs.
- **Visual:** Screenshot of the Moving Sky warning banner on a 0.95 µm vs 3.29 µm pair.

## Slide 6: Demo 1, the Planet X UI

- **Key message:** Browse the whole sky, see every mover, and compare scans in one place.
- **Supporting points:**
  - Movers list with Matched, Candidate and Likely statuses, plus filters
  - Blink across scans; tracks join each mover's positions
  - Compare mode with wipe and Difference (a mover shows up twice)
- **Visual:** Side-by-side screenshots of the sky view with the Movers panel and of Compare mode in Difference.

## Slide 7: Demo 2, Moving Sky

- **Key message:** The detection logic running on a simulated field, start to finish.
- **Supporting points:**
  - Planted asteroid, variable star, artifact and one slow mover at about 500 AU
  - Depending on the epoch pair chosen, the detector labels each as known object, variable, rejected spike or uncatalogued mover.
  - The vetting panel shows a spectrum with water-ice absorption at 1.5, 2.0 and 3 µm.
- **Visual:** Moving Sky screenshot with the candidate selected, showing the stamps and spectrum.

## Slide 8: Honest about what is real

- **Key message:** The method and mission parameters are real. Every candidate and number in the demos is simulated.
- **Supporting points:**
  - Real: pixel scale, cadence, matched-wavelength rule, detect → match → ephemeris logic
  - Simulated: sky, scans, candidates, designations, spectra, ephemeris stub
  - No real data has been processed yet, and we claim no discoveries.
- **Visual:** Two-column "Real / Simulated" table.

## Slide 9: Limitations and next steps

- **Key message:** The path to real data is concrete. Swap two stubs, then tune on real frames.
- **Supporting points:**
  - Risks: three epochs is the minimum for an orbit fit, false positives, faint signals, small cutouts
  - Next: run on IRSA `spherex_qr2` cutouts, connect JPL Horizons and small-body identification
  - Then: multi-epoch linking and orbit fits, injection tests for the false-positive rate
- **Visual:** Short roadmap line with three milestones. Close with team names `[Team member names]` and links `[UI demo link]`, `[Moving Sky demo link]`, `[Video link]`.
