# NASA Planet X — Status

_Last updated: 2026-10-25_

## Done
- Write-up and pitch outline brought up to date with the current app (by a second Claude session, reviewed here): one app with Sky/Compare/Field and review panel, the local SPHEREx/JPL server, Moving Sky in the app palette, the 16 Psyche real-data test (within 2″ of Horizons, per server/README.md), demo links filled. Still placeholders: [Team member names], [Video link]. docs/deck/ (published Slides) not updated yet; its slide 7 is still the Moving Sky slide.
- Sky view polish: top-bar controls one 32px height, shorter go-to hint (box hidden below 1040px, as on phones), outlined ? button; Movers panel shrinks to its list when nothing is selected; Candidate status shown by a filled dot (Likely/Follow-up rings, Matched muted), per-row "Simulated" as quiet text, list fades at the bottom only while it scrolls. Top bar checked at 10 widths (no overlap/overflow). Shell 87, workflow 88, review 64, field, mobile/a11y 118, fly-to all pass (fly-to needed one rerun: timing under load, on the untouched old ui-demo).
- Republished: Moving Sky (restyled + QA fixes) to https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b (version 1793032482-3ba1; replaced the original baseline, which had not changed). App with Moving Sky links to https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW (version 1793032485-dba7). Moving Sky is still PRIVATE: app viewers who follow its link cannot open it until it is shared from its Share menu.
- Moving Sky restyled to the app palette: black / white / grey UI and Inter (was teal accent, orange badge, Albert Sans); overlay marks use the app Field view colours; list swatches are grey and told apart by shape. QA updated to match (dot contrast checks ink/muted; overlay colours no longer change with theme). moving-sky 0 failures, moving-sky-mobile 93/93 (one run hit a screenshot timeout under load; two reruns clean). Not yet republished to its artifact link.
- App links to the rest of the site: "Moving Sky demo" in the top bar (hidden on the sky view below 1180px and on phones, where the top bar is full), a Moving Sky entry in the ? sheet, and the "Planet X" title links home. Served from the repo they use relative paths; on a published artifact Moving Sky opens its own artifact link and the title links nowhere. Shell 87/87, mobile/a11y 118/118, fly-to all pass.
- Homepage (`index.html` at the repo root, served at http://localhost:8000/): one screen, title and buttons centred on the NASA sky map, "Open the sky" (→ /app/) and "Moving Sky demo" (→ /artifacts/moving-sky/). Checked headless at 1440×900 and 390×844: no errors, no scrolling, both buttons work. Not yet on the artifact link.
- **Published the full app to the existing UI demo link** (2026-10-26, version 1793021478-fb62, 31 files, shared "anyone with the link"): https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW — runs on simulated data there (sandbox blocks the local server). Before publishing, merged in a newer version another session had published at 03:20 UTC (realistic slow-mover positions for c03/c05/c06 + cutout exaggeration; its fly-to/RA/timeline fixes were already in the app). Its code referenced a "master.md track 4" plan that is not in this repo.
- **Live integration merged (d2273cd)** — real SPHEREx data end to end. PSF-aware artifact test (real stars are ~1 px; sim results byte-identical, pipeline 75/75 incl. 57 parity checks + a real SPHEREx fixture). On the real Psyche field: before, 9 "spikes" incl. Psyche itself; after, 16 Psyche = Known object 1.3″ from Horizons, cosmic rays/bad pixels = artifacts, 1 variable, 1 faint candidate. Field live loading overlay with stages + Cancel, two-step load (frames first, JPL after), live request box (centre/size/detector/date, Psyche example), live empty panel state, field-added candidates persisted, visible fallback reason.
- Go-to → Field now uses the fly-to target (was 0.03–0.06° off when pressed mid-easing); verified 0.00000° on 3 targets.
- **All suites green on main (2026-10-26):** pipeline 75, data 5 (+2 network skips), field ALL PASS, workflow 88, shell 87, review 64, live ALL PASS (against :8787).
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

## In progress
- Nothing running.

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
- Planet X app (was the UI demo; now the full app): https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW
- Pitch deck (new, private): https://claude.ai/artifact/UAqhztF4edsXdn2mTzs6fw
- SPHEREx Moving Sky demo (reference, read-only): https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b

- 2026-10-26: App artifact republished with the Sky view polish (version 1793039454-6cef): https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW
- 2026-10-26: Full site (homepage + app + Moving Sky) published as one artifact: https://claude.ai/artifact/7coFfmF9zDLmKXTMB4A8iC (private until shared). Cross-page links now point at explicit index.html files.
- 2026-10-26: Repo made public; live site on GitHub Pages at https://shengdynasty.github.io/planet-x/. Hosted copies no longer probe localhost:8787 (avoids Chrome local-network prompt).
- 2026-10-27: Pitch deck dropped (not needed): docs/deck/ removed. The published deck artifact (UAqhztF4edsXdn2mTzs6fw) is private and unused; delete it from the claude.ai gallery.
- 2026-10-27: Reviewer note box removed from the Movers panel (status buttons stay); export drops the review_note column. Suites: workflow 84, shell 87, review 64, field/live all pass, mobile/a11y 118/118.
- 2026-10-27: Movers panel simplified and polished: review buttons (Follow-up/Rejected) and their saved state removed with persist.js; filters are All/Unmatched/Matched/Likely in one row; the selected card is shown whole (list shrinks first; on short windows the card scrolls with its buttons pinned); short labels; entrance and state animations under .cx, off for prefers-reduced-motion.
- 2026-10-27: Selecting a mover opens its imagery and description in a left window (#inspect); the sidebar keeps the list, facts and buttons. Escape or ✕ closes it. Phones keep everything in the sheet. Suites: workflow 77, shell 87, review 64, field/live pass, mobile/a11y 118/118, fly-to all passed.
- 2026-10-27: Moving Sky controls simplified: the reference is always the first pass; one row of chips picks the later pass (other-wavelength passes dashed, still teach the matching rule); toolbar reads Flags / Known / Contrast. Both Moving Sky suites pass.
- 2026-10-30: Passes have short names instead of time offsets or ids: live frames "Scan 1 / 2 / 3" (the survey pass; "Scan 2a/2b" if two frames share one), simulated "Pass 1…8", Moving Sky chips "Pass 2…8". Chips show only the wavelength underneath; the offset (and the observation id, live) is in the tooltip, the baseline line still gives the days. Captions, flash, track label, notes and announcements use the names.
- 2026-10-30: Marker labels: sky markers show the number and the object's name ("01 2003 UB", "05 Probable brown dwarf") at roughly 25 px instead of a 15 px number; field markers read "Known · 16 Psyche (A852 FA)" and ephemeris circles carry the name; field label type 11 → 13 px. New `designation()` in format.js, `__sky.markerName(id)`.
