# Project page text (NASA Space Apps 2026 submission form)

Paste-ready text for the submission form, one block per field, condensed from `docs/WRITEUP.md` (which stays the full
account). Every number here is measured in this repository and reproducible with the commands in README §5. Fill the
the one placeholder left before submitting: **[Video link]**.

---

## Project name

**Planet X: finding the parallax a distant planet cannot hide in SPHEREx**

## High-level project summary

A browser tool that searches NASA's SPHEREx infrared sky survey for the one signal a distant, unknown planet cannot
hide: parallax. SPHEREx looks about 90° from the Sun, so its two passes over any patch six months apart see it from
opposite sides of Earth's orbit. A body at 500 AU jumps 825″ between those passes and drifts 7″ a day between the
re-visits within one pass, while the stars stay put. For a chosen patch the app collects every SPHEREx exposure, pairs
them at matching wavelength, flags what moved, appeared, vanished or brightened, and checks each flag against JPL's
known asteroids and comets and Gaia's stars. Whatever is left is a candidate for a person to vet, never a detection.
The hosted copy shows real SPHEREx frames for six targets with no server needed. We measured what the tool can and
cannot find by planting synthetic movers into real frames, built a linker that joins the two halves of a parallax
signature across cutouts and turns the shift into a distance, and showed with numbers that a Planet Nine-class body is
below SPHEREx's single-exposure depth, which is the honest answer the challenge deserves.

## Link to project demo

[Video link] (30 seconds, recorded on the hosted app)

## Link to final project

- App (live, no install): https://shengdynasty.github.io/planet-x/
- Source, MIT licence: https://github.com/shengdynasty/planet-x
- Technical write-up: https://github.com/shengdynasty/planet-x/blob/main/docs/WRITEUP.md

## Detailed project description

**What it does.** Planet X is one browser app with three views and a review panel, set on NASA's Deep Star Maps 2020
all-sky image. *Sky* shows the whole sky with every flagged mover, and stays sharp when zoomed in by streaming NASA's
star map as tiles at up to 182 pixels per degree. *Compare* blinks, wipes or subtracts two passes of a
mover. *Field* runs the detection pipeline on one patch: it aligns the SPHEREx passes, subtracts or co-adds them, lists what
changed (uncatalogued mover, known object, variable star, artifact, vanished source) and opens a vetting panel with
stamps, the catalogue checks, DSS2, 2MASS and AllWISE images of the same spot, and a one-page follow-up report that an
observer could act on (positions with uncertainties, motion, predictions, ADES/CSV/JSON files). A badge always says
whether the data is live from the server, saved real frames, or simulation. New SPHEREx releases need no code change:
each pass says which release it came from, a new release can be typed in the day IRSA publishes it, and a field saved
as one file on any machine opens in the hosted app with no server. For any star it measures a spectrum on the fly: its
brightness in every SPHEREx exposure that covers it, at the wavelength each one saw, about two hundred points from 0.75
to 5 µm.

**How it works.** A small Node server (no dependencies) finds every SPHEREx exposure of a position in NASA/IPAC IRSA,
reads each file's own spectral WCS to pair frames at the same wavelength (SPHEREx's filters vary across the detector,
so only same-wavelength frames can be compared), downloads and aligns cutouts, and asks JPL which known bodies were in
the field at each frame's time, using the spacecraft's own position from the image header. Detection runs in the
browser on the real frames: robust noise, 5σ detection with 3σ hysteresis, a PSF-width test that rejects cosmic rays
and bad pixels, the SPHEREx pipeline's own flag plane, Gaia DR3 stars with proper motions, and brightness changes
judged on aperture flux because SPHEREx's one-pixel PSF makes peak values unreliable.

**Why parallax.** A body at 500 AU moves 58″ along its orbit in six months, but Earth's motion swings it by 825″
between SPHEREx passes and 7″ a day within one. So between passes it leaves a 300″ cutout, vanishing in one and
appearing in another, and within a pass it moves a few pixels against fixed stars. The tool handles both: in-field
movers directly, and the between-pass signature with a cross-field linker that predicts, from Earth's position at the
two passes, where a vanished source reappears for each assumed distance, builds that cutout and looks for the new
source. A parallax-distance estimator then turns the measured shift into a distance with an error bar, which is what
separates an asteroid, a star and a trans-Neptunian body by physics rather than catalogue lookup.

**What we measured, on real frames.**

- On a 300″ field from 15 February 2026 the pipeline flags asteroid 16 Psyche as a known object 1.3″ from its JPL
  Horizons position, and labels the cosmic rays and bad pixels in the field as artifacts.
- Injection-recovery: synthetic movers planted into six real fields at each field's own PSF width, 720 trials per
  cell. From 12σ up, 80–91% of movers shifting 18–92″ are recovered with both positions (median position error 0.9″);
  a vanished source 91–97%, a new source with no counterpart 76–93%; nothing below 7σ; zero false movers on the
  un-injected real pairs. The test found and fixed two detector bugs (a wrong partner search; movers landing on
  catalogued stars filed as brightenings).
- Linker and distance: a counterpart planted at the true distance is found, controls give no hit; on 500 random bodies
  at 300–2,000 AU with 0.9″ noise the true distance lies inside the error bar every time, median half-width 10%.
- Spectra on the fly: Epsilon Indi Ba/Bb, a pair of T dwarfs, shows the 3.3 µm methane dip and the 4 µm peak in 301
  measured exposures; WISE 0855's own 4.5 µm light rises above a neighbouring star's; Barnard's Star and R Draconis
  saturate SPHEREx, and the app says so. The FLAGS plane, which IRSA stores RICE-compressed, is decoded in our own code and
  matches IRSA's cutouts pixel for pixel.
- Depth: our 7σ single-exposure limit is AB 17.0–17.5 in clean fields. A nominal 10 Earth-mass Planet Nine at 700 AU
  is V 21.7 and AB 22.8–23.4 at 3–5 µm; even the most optimistic published model (W1 16.1 at 622 AU) is 1.3–2 mag
  short. Shift-and-stack across SPHEREx's three or four passes gains only 0.3–0.4 mag. The tool therefore reaches
  nearer, larger or warmer bodies than Planet Nine, and says so.

**What is real and what is not.** With the server: everything above is real SPHEREx, JPL and Gaia data. The hosted
copy shows real saved frames, known objects and stars for six example targets, and the simulation only where it says
so. Spectra are measured from the SPHEREx exposures on real data (relative brightness, not calibrated photometry) and modelled only on the simulated field. No discovery is claimed.

**Limits.** Two epochs show consistency with motion, three and an orbit fit are needed before any claim; fields are
120–600″ so the search covers chosen patches, not the whole sky; nothing fainter than 7σ in one exposure; a mover
within 3 px of a brighter star is lost; the linker ignores the body's own motion and colour between passes.

## NASA data

- **SPHEREx Level 2 images** (calibrated science images with their FLAGS planes), collections `spherex_dr1` and
  `spherex_qr3`, through NASA/IPAC Infrared Science Archive (IRSA) Simple Image Access and cutout services:
  https://irsa.ipac.caltech.edu/ . Wavelength at the target read from each file's spectral WCS.
- **JPL Small-Body Identification API and JPL Horizons** (NASA/JPL Solar System Dynamics) for known asteroids and comets
  in each field at each frame's time: https://ssd-api.jpl.nasa.gov/ and https://ssd.jpl.nasa.gov/horizons/
- **NASA/Goddard Scientific Visualization Studio, Deep Star Maps 2020** (ID 4851), the all-sky backdrop; credit
  NASA/Goddard Space Flight Center Scientific Visualization Studio and Gaia DR2: ESA/Gaia/DPAC. Not endorsed by NASA.
- **IRSA HiPS mirrors** of the DSS2, 2MASS and AllWISE all-sky images for the vetting panel.

## Space agency partner and other data

- **ESA Gaia DR3** (ESA/Gaia/DPAC) via the ESA Gaia archive: stars with proper motions over every field.
- **CDS, Strasbourg:** SIMBAD names and the HiPS surveys (DSS2, 2MASS, AllWISE) shown through Aladin Lite, loaded at
  run time and not bundled.
- **Libraries:** three.js r128 (MIT), Aladin Lite 3.8.2 (CDS, GPL/LGPL), qrcode-generator 1.4.4 (MIT), all from public
  CDNs with integrity hashes where the CDN allows it. No other dependencies.
- **References:** Linder & Mordasini 2016, A&A 589, A134 (arXiv:1602.07465); Fortney et al. 2016, ApJL 824, L25
  (arXiv:1604.07424); Meisner et al. 2017 (arXiv:1611.00015); Bock et al. 2025, The SPHEREx Satellite Mission
  (arXiv:2511.02985); Luhman 2014, ApJL 786, L18 (arXiv:1404.6501); Brown & Batygin, the Planet Nine orbit fits.

## Use of artificial intelligence

The code, tests and documentation in this repository were written with Claude (Anthropic) as a coding assistant,
working from the team's direction and reviewed, run and verified by the team; every claim above is backed by a test
or script in the repository that anyone can rerun. The science choices, data sources, test results and conclusions
are the team's. No AI-generated images, audio or video are used: every picture in the app is NASA or ESA data or drawn
from it by our code. The same disclosure is in the README credits.

## Team

Sheng Yan, Aaryan Jain, Arko Ganguly, Nidhish Senthilkumar, Tejas Konduru, Hardik Jain
