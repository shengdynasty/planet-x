# NASA Planet X — Status

_Last updated: 2026-10-25_

## Done
- Moving Sky mobile/a11y/perf merged (98c9f2a): 4×2 epoch grid, touch readout, live-region announcements, AA contrast, slider jank 833 ms → ~1 ms at 4× throttle. Both Moving Sky suites pass on main.
- Moving Sky correctness + interactions merged (6df1285): slow mover's drift corrected to a real ~500 AU rate (0.03°/yr), the "nearest matching pass" crash fixed, Track honours the selected window, selection survives epoch changes, reduced-motion flip button, spectrum label overflow, theme redraw. `node qa/moving-sky.test.mjs`: ALL PASS on main.
- Write-up merged (docs/WRITEUP.md, docs/PITCH-OUTLINE.md). Placeholders: [Team member names], [UI demo link], [Moving Sky demo link], [Video link].
- Pitch deck v1 published (9 slides, private): https://claude.ai/artifact/UAqhztF4edsXdn2mTzs6fw — source in docs/deck/. Demo slides have screenshot placeholders, filled after QA.
- Repo initialised; baseline snapshots of both published artifacts committed (`artifacts/`, commit d7a194f). Checksums match the published versions.

## In progress — full app build (started 2026-10-25, est. 1–1.5 h wall-clock)
Goal: one app in `app/` that merges both demos in the UI demo's look. Contracts: `app/ARCHITECTURE.md`. Preview: http://localhost:8000/app/
- `build/shell` — page, top bar (Sky · Compare · Field, data-source badge), 3D sky, Compare; folds in fly-to + known UI-demo bugs
- `build/field` — pure detection pipeline (must match Moving Sky exactly) + Field analysis view
- `build/data` — simulated source + live source via local Node server (IRSA SPHEREx cutouts, JPL small-body ID)
- `build/workflow` — candidate review panel: filter/sort/search, status + notes, persistence, CSV/JSON export
- `build/assets` — real NASA SVS Deep Star Maps sky texture, orientation verified against bright stars
- Still finishing on the old single-file UI demo: `fix/flyto`, `qa/mobile-a11y-perf` (findings get forwarded to shell)

## Next
- (a) Fix the fly-to bug + interaction QA (UI demo)
- (b) Mobile / accessibility / performance QA (UI demo)
- (c) Hackathon write-up
- (d) Pitch deck
- Merge (a)→(b) and (e)→(f); test in headless Chrome (desktop + phone); republish BOTH demos to their existing URLs (ask first)

- Local preview: http://localhost:8000/artifacts/ui-demo/index.html and http://localhost:8000/artifacts/moving-sky/index.html (python http.server, bound to 127.0.0.1)

## Blockers / open questions
- `CLAUDE.md` (the project brief) is **not in this folder**. The plan below was inferred from the request and the artifacts.

## Artifact URLs
- UI demo (republish target): https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW
- Pitch deck (new, private): https://claude.ai/artifact/UAqhztF4edsXdn2mTzs6fw
- SPHEREx Moving Sky demo (reference, read-only): https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b
