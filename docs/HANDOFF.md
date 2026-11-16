# Planet X: handoff

Written 16 November 2026, after the NASA Space Apps 2026 submission. The project is finished and submitted. Start
here: what exists, where it lives, how to run and test it, which outside services it uses, and what is left.

| | |
|---|---|
| Live app | https://shengdynasty.github.io/planet-x/ (GitHub Pages, deploys from `main`) |
| Source | https://github.com/shengdynasty/planet-x, MIT licence |
| Last code change | `9c8c2564` (helper AI): all 31 suites pass on it, and the live site was checked on desktop and phone (15 Nov, 22:20 CST) |
| Team | Sheng Yan, Aaryan Jain, Arko Ganguly, Nidhish Senthilkumar, Tejas Konduru, Hardik Jain |
| Submission | Form filled from `docs/PROJECT-PAGE.md`; all six members are on the Space Apps team |

## What it is

A browser app that searches NASA's SPHEREx infrared sky survey for a distant planet by the one thing it cannot hide:
parallax. SPHEREx maps the whole sky every six months from opposite sides of Earth's orbit, so a body at 500 AU jumps
about 825″ between passes. For a patch of sky the app pairs every SPHEREx exposure at the same wavelength, flags what
moved, appeared or vanished, rejects artifacts, known asteroids and Gaia stars, and leaves candidates for a person to
vet, never claims. `docs/WRITEUP.md` is the full account, with every number and how it was measured.

## What the app has

- **Sky:** a three.js sky on NASA's Deep Star Maps, streamed as tiles down to level 6 (64k, 182 px/deg; WebP for
  levels 3–5, AVIF for 6).
- **Field:** blink, difference, track, stack and play through the passes; SPHEREx flags, JPL known objects, Gaia stars
  and bad pixels as overlays; a vetting panel with Aladin Lite (DSS2, 2MASS, AllWISE, SIMBAD names); a one-page
  candidate report (`app/report.html`) with ADES, CSV, ephemeris and JSON downloads.
- **Compare and the review panel:** the candidate list across fields.
- **SPHEREx spectra:** measured on the fly by the data server for any star. The hosted copy has 26 saved: five example
  targets and 21 bright field stars, which are ringed while you pick.
- **New data without code changes:** each pass shows its release, the server searches releases typed in the app, and
  a field can be saved to a file and opened anywhere.
- **Honesty:** a badge that always says Live, Saved or Simulated; Simple and Advanced modes.
- **Helper:** the chat bubble in the bottom-left corner. A hand-written knowledge base answers what it covers;
  questions it misses go to Gemini (see Firebase below).
- **Hosted copy:** six saved real fields, the five challenge targets plus 16 Psyche: Psyche, Barnard's Star, Epsilon
  Indi Ba/Bb, WISE 0855−0714, RW Aurigae and R Draconis.

## Where to read more

| File | What it covers |
|---|---|
| `README.md` | Running, testing, team workflow, the Python backend, credits |
| `docs/WRITEUP.md` | The full account: method, tests, limits, next steps |
| `docs/PROJECT-PAGE.md` | The submission form text, field by field |
| `docs/PITCH-OUTLINE.md`, `docs/VIDEO.md` | Pitch outline and the 30-second video shot list |
| `docs/ALADIN.md` | The other-telescopes panel |
| `app/ARCHITECTURE.md`, `app/FEATURES.md` | Code structure; the feature test's tables |
| `server/README.md` | The data server's routes |
| `STATUS.md`, `issues.md` | Dated log of every change; the QA issue list |

## Run and test

- **Hosted:** nothing to set up.
- **Locally with real data:** README, "For the team", sections 1 and 2. You need Node 20+, Python 3.10+ and git, and
  no `npm install`. The data server (`node server/index.mjs`, port 8787) fetches any position from IRSA and JPL.
- **Tests:** README section 5 lists every suite. There are 31: 17 Node suites, 11 browser suites, the live-mode suite
  (needs the data server) and 2 QA suites for the older demo page. Browser suites use playwright-core 1.49.1 and
  Chrome; `tests/browser.mjs` explains the setup.
- **More saved spectra:** `node scripts/save-spectra.mjs --stars 4` with the data server running; then commit
  `app/data/spectra/`.

## Outside services

| Service | Used for | Account | Notes |
|---|---|---|---|
| GitHub and Pages | Repo and hosting | `shengdynasty` | Pages deploys from the root of `main` within a minute or two |
| NASA/IPAC IRSA | SPHEREx images, flags, variance; HiPS mirrors | None | Its file server refuses about 6–10% of reads with 503; the server retries |
| JPL Small-Body Identification and Horizons | Known asteroids and comets | None | |
| ESA Gaia archive | Gaia DR3 stars and proper motions | None | |
| CDS, Strasbourg | Aladin Lite, SIMBAD names, sky surveys | None | |
| Firebase `planet-x-spherex` | Gemini for the helper | Sheng's Google account | Spark plan, no billing; details below |

### Firebase

- **Project:** `planet-x-spherex` on the free Spark plan, with no billing account. The reCAPTCHA Enterprise (Fraud
  Defense) API is enabled in the same Google Cloud project.
- **AI Logic:** Gemini Developer API, model `gemini-3.5-flash` with low thinking, AI monitoring on.
- **Web app:** `planet-x-web`. Its config is in `app/js/assistant/gemini.js`; those values and the site key are public
  by design, and no secret is in the repo.
- **App Check:** registered with the Fraud Defense key "planet-x-web App Check", which accepts `shengdynasty.github.io`
  and `localhost`. Enforcement for AI Logic is off; Firebase turns it on automatically on 21 January 2027.
- **Console choices made at setup:** Gemini in Firebase on, Google Analytics off, the Google Developer Program joined.
- **How the app uses it:** only questions the knowledge base has no entry for are sent, with the knowledge base as
  Gemini's only context. Replies are tagged "AI answer". Gemini is off under browser automation and with `?ai=off`;
  `?ai=on` forces it on. Errors, quota limits and a 15-second timeout give the offline "not in my notes" answer.

## Loose ends

1. **Video placeholders.** `[Video link]` is still in `docs/WRITEUP.md` (Links), `docs/PROJECT-PAGE.md` (the intro
   note and "Link to project demo") and `docs/PITCH-OUTLINE.md` (the last slide). The write-up is linked from the
   project page, so remove or fill them.
2. **The pitch deck** (Tejas's Google Slides). Slide 5 said a nominal Planet Nine is reachable inside 250–340 AU;
   that range is for the most optimistic model, and the nominal one is reachable only within about 35–60 AU. Spectra
   were missing, and slides 2 and 6 had layout issues. Whether these were fixed is unknown.
3. **App Check enforcement.** Once App Check's metrics show verified requests from the live site, enforce it for
   Firebase AI Logic in the console (App Check, APIs). After enforcement, local development needs an App Check debug
   token.
4. **Branches.**
   - Merged, safe to delete on GitHub: `candidate-report`, `feat/assistant`, `feat/sky-deep-zoom`,
     `feat/sky-tiles-q42-east`, `feat/sky-tiles-q42-west`, `tejas/parallax-distance`, `tejas/release-data-path`.
   - Not merged, ask the owner first: `feat/sky-tiles-all`, `feat/sky-tiles-avif`, `feat/sky-tiles-q42-core`,
     `fix/phone-field-layout`.
   - On Sheng's machine: 12 merged local branches, and 25 unmerged ones that are mostly old agent worktrees
     (`git worktree list` shows 15). Keep `backup/pre-rewrite-2026-11-13` until nobody needs the old history.
5. **Chat bubble at about 1024 px wide.** It covers a sliver of the field image's bottom-left corner. Fixing it needs
   a change to the desktop Field layout.
6. **Gemini speed.** Answers take 1–11 s. Anything slower than 15 s falls back to the offline answer; raising the
   timeout in `gemini.js` to 20–25 s would keep more slow answers. Heavy use hits the free tier's rate limits and falls
   back the same way.
7. **Helper matcher.** It sometimes answers an off-topic question with a loosely related entry ("Who won the football
   match yesterday?" gets the wavelength answer). Gemini only sees questions the matcher misses completely.
8. **Saved fields predate release labels.** Re-saving the six fields would show release dates on the hosted copy, but
   it changes the frames behind the write-up's numbers: rerun `scripts/injection-recovery.mjs` and update the
   write-up if you do.
9. **Spectra are relative, not calibrated photometry.** Calibrating them is the write-up's fourth next step.
10. **No hosted data server.** Positions beyond the six saved fields need the local server, or Tejas's FastAPI backend
    (README section 3) deployed on HTTPS with the site in its CORS allowlist.

## Ideas for later

From the write-up: run the cross-field linker on every real vanished source across many fields, fit orbits from three
or more passes, host a data server so any position works on the hosted copy, and calibrate the spectra.

## Working notes

- SPHEREx stores its FLAGS plane RICE-compressed; `riceDecompress` in `server/lib/fits.mjs` reads it, checked against
  IRSA's own cutouts.
- IRSA renamed `spherex_qr2` to `spherex_dr1` (noticed 13 November 2026); the server searches `dr1` and `qr3`, plus
  any typed release.
- Spectra read 11×11 stamps from each exposure by HTTP range requests, at most three at a time per host, and keep
  every read that worked so a retry only re-reads the failures.
- Default test ports: shell 8101, field 8102, workflow 8104, live 8106, review 8107, snapshot 8108, report-browser
  8109, hdtiles 8110, features 8111, releases-browser 8112, spectrum-browser 8113, assistant-browser 8160. `PORT`
  overrides most of them.
- Commits use the author "Sheng Yan" with the GitHub no-reply address and no AI co-author lines; AI use is disclosed in
  prose in the README credits and the project page.
- Merges: finish on a branch, run the suites, push to `main` as a fast-forward, then check the live site. Browsers can
  keep old files for up to 10 minutes, so hard-refresh.
