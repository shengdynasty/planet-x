# NASA Planet X — Status

_Last updated: 2026-10-25_

## Done
- Pitch deck v1 published (9 slides, private): https://claude.ai/artifact/UAqhztF4edsXdn2mTzs6fw — source in docs/deck/. Demo slides have screenshot placeholders, filled after QA.
- Repo initialised; baseline snapshots of both published artifacts committed (`artifacts/`, commit d7a194f). Checksums match the published versions.

## In progress
- Plan approved 2026-10-25. Deck = claude.ai Slides artifact; write-up = Markdown in repo.
- Agent (a) `fix/flyto`: fly-to sign bug + interaction QA (incl. Scan 1 marker overlapping Blink)
- Agent (b) `qa/mobile-a11y-perf`: phone layout, keyboard/focus/contrast, load-time perf
- Agent (c) `docs/writeup`: docs/WRITEUP.md + docs/PITCH-OUTLINE.md
- Headless test harness: Chrome + playwright-core (in scratch, not a repo dependency) verified working

## Next
- (a) Fix the fly-to bug + interaction QA (UI demo)
- (b) Mobile / accessibility / performance QA (UI demo)
- (c) Hackathon write-up
- (d) Pitch deck
- Merge, test in headless Chromium (desktop + phone), republish the UI demo to its existing URL

## Blockers / open questions
- `CLAUDE.md` (the project brief) is **not in this folder**. The plan below was inferred from the request and the artifacts.

## Artifact URLs
- UI demo (republish target): https://claude.ai/artifact/CJjpfU1iwqFTwNmdPZhdKW
- Pitch deck (new, private): https://claude.ai/artifact/UAqhztF4edsXdn2mTzs6fw
- SPHEREx Moving Sky demo (reference, read-only): https://claude.ai/artifact/MXRGaK88XENuCzXziVur9b
