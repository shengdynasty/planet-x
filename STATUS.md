# NASA Planet X — Status

_Last updated: 2026-10-25_

## Done
- Review fixes merged (212b04c): 9 findings in sky/compare/panel (shortcuts behind dialogs, stale Field patch, Compare crash, null-safe per-scan positions, illustrative-cutout label, XSS in scan labels, search vs sky markers, `?` in Field, label consistency); hermetic shell tests. Store re-entrancy fix and favicon committed. Suites on main: review 64, shell 87, workflow 88, pipeline 57, field all pass.
- Live data merged (build/data): local server `node server/index.mjs` (port 8787) pulls real SPHEREx exposures via IRSA SIA (spherex_qr2 + qr3), cutouts with own FITS/WCS parsing, wavelength from each file's spectral WCS, JPL sb_ident + Horizons. Home field: 321 exposures, 3 epochs; 16 Psyche recovered within 2″ of Horizons. Client falls back to sim in ~0 ms when the server is absent (claude.ai sandbox). Cold costs: ~10 s per field, ~70 s with JPL.
- **App assembled on main** — http://localhost:8000/app/ — shell merged (76/76): top bar Sky · Compare · Field + data badge, real NASA sky with correct orientation, render-on-change, Compare, help sheet with credits; review panel and Field view mounted. Field default size unified at 1968″. Only the data module is still the built-in stand-in.
- Old UI demo mobile/a11y/perf merged: first frame 10.4 s → 0.7 s (desktop), 13.7 s → 0.5 s (phone, 4× throttle); keyboard list, focus traps, pinch zoom, 40px targets.
- Field view + pipeline merged (8296257): detection output identical to Moving Sky on all 30 same-wavelength pairs (57/57); Field view in the UI demo look, "Flagged sources" wording, add-to-review-list and show-on-sky wired to the store (ra/dec in degrees).
- Old UI demo fly-to fixed (82cd7c7): yaw sign was mirrored about RA 6h/18h (up to 180° off); now 0.00° on all 18 checks. Also go-to Dec regex, Scan 1 label stealing Blink clicks, drag direction/speed, readout rounding, compare-blink state, modifier-key shortcuts. Findings forwarded to the shell agent for the new app.
- Candidate review panel merged (5f75917): filter/sort/search, keyboard listbox, Follow-up/Rejected review with notes (localStorage), CSV/JSON export with copy fallback for the sandbox. 88/88 tests pass on main. Contracts updated: flyto ra/dec in degrees; Candidate.pipelineStatus.
- Real sky merged (6ba33d3): NASA SVS Deep Star Maps 2020 (Gaia DR2), app/assets/sky_4k.jpg + sky_2k.jpg. Orientation verified on Orion, Vega, Polaris, Pleiades, LMC and the 12h seam; the old setup was mirrored E–W (fix: backdrop.scale.x = -1). Credit: NASA/GSFC SVS; Gaia DR2: ESA/Gaia/DPAC.
- Moving Sky mobile/a11y/perf merged (98c9f2a): 4×2 epoch grid, touch readout, live-region announcements, AA contrast, slider jank 833 ms → ~1 ms at 4× throttle. Both Moving Sky suites pass on main.
- Moving Sky correctness + interactions merged (6df1285): slow mover's drift corrected to a real ~500 AU rate (0.03°/yr), the "nearest matching pass" crash fixed, Track honours the selected window, selection survives epoch changes, reduced-motion flip button, spectrum label overflow, theme redraw. `node qa/moving-sky.test.mjs`: ALL PASS on main.
- Write-up merged (docs/WRITEUP.md, docs/PITCH-OUTLINE.md). Placeholders: [Team member names], [UI demo link], [Moving Sky demo link], [Video link].
- Pitch deck v1 published (9 slides, private): https://claude.ai/artifact/UAqhztF4edsXdn2mTzs6fw — source in docs/deck/. Demo slides have screenshot placeholders, filled after QA.
- Repo initialised; baseline snapshots of both published artifacts committed (`artifacts/`, commit d7a194f). Checksums match the published versions.

## PAUSED again (2026-10-26, by user request) — resume from here
No agents running. Nothing published to artifacts. GitHub `main` is up to date (all suites green).
- Only open work: `build/live` (worktree agent-a5a2790d3e10c14c2), NOT merged, unverified:
  9d91008 pipeline: PSF-aware artifact test; ephemeris match wins over artifact test
  d4ff84f data/server: live size mapping (fixes "live Field always falls back to sim"), /api/progress, one pos per scan, merged candidate poll, persisted field-added candidates
  214ac7a WIP field live UI, plus uncommitted edits to app/js/field/index.js and a new tests/live.test.mjs
  Remaining there: finish Field live loading UI + Cancel, live empty panel state, Psyche end-to-end in the browser, focus restore leaving Field, escape band labels, Field key handler vs dialogs/`?`; then all suites (sim parity 57/57 must hold). Needs `git merge main` first (main now has fix/review: posAt helpers, dialog guards).
- Full review report (13 confirmed findings + repro scripts): scratchpad/review/
- Running processes: static server :8000, live data server :8787 (cache warm for home + Psyche fields).

## Next
- (a) Fix the fly-to bug + interaction QA (UI demo)
- (b) Mobile / accessibility / performance QA (UI demo)
- (c) Hackathon write-up
- (d) Pitch deck
- Merge (a)→(b) and (e)→(f); test in headless Chrome (desktop + phone); republish BOTH demos to their existing URLs (ask first)

- Local preview: http://localhost:8000/artifacts/ui-demo/index.html and http://localhost:8000/artifacts/moving-sky/index.html (python http.server, bound to 127.0.0.1)

## Blockers / open questions
- `CLAUDE.md` (the project brief) is **not in this folder**. The plan below was inferred from the request and the artifacts.

## Repo
- GitHub (private): https://github.com/shengdynasty/planet-x — `main` pushed 2026-10-26. Push again after each merge.

## Artifact URLs
- UI demo (republish target): https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW
- Pitch deck (new, private): https://claude.ai/artifact/UAqhztF4edsXdn2mTzs6fw
- SPHEREx Moving Sky demo (reference, read-only): https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b
