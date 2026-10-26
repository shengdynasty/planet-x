# Planet X

A NASA Space Apps Challenge 2026 project: search NASA's **SPHEREx** all-sky infrared survey for slow-moving objects, the kind of signal a distant "Planet X" would leave, and help people review what's found.

SPHEREx re-maps the whole sky every six months. A far-off planet barely shifts between those passes, so the app compares the same patch of sky across epochs, flags what moved, appeared, vanished or brightened, and checks each one against JPL's catalogue of known asteroids and comets. Whatever is left is a **candidate for human review, never a detection**.

> **Status:** hackathon prototype. Without the local data server, everything shown is simulated and labelled as such.

## What's here

| Path | What it is |
|---|---|
| `app/` | The web app: 3D sky on NASA's Deep Star Maps, candidate review panel, Compare (wipe/difference/blink), and Field analysis (the detection pipeline on a patch of sky). Plain ES modules, no build step. Contracts: [`app/ARCHITECTURE.md`](app/ARCHITECTURE.md). |
| `server/` | Optional local Node server (no npm deps) that pulls **real SPHEREx exposures** from NASA/IPAC IRSA and known objects from JPL. See [`server/README.md`](server/README.md). |
| `artifacts/` | The two original single-file demos (UI demo, Moving Sky), kept as published snapshots. |
| `docs/` | Project write-up, pitch outline, and pitch-deck source. |
| `tests/`, `qa/` | Unit and headless-browser tests. |

## Run it

```sh
python3 -m http.server 8000 --bind 127.0.0.1   # from the repo root
open http://localhost:8000/app/                 # simulated data

node server/index.mjs                           # optional: live SPHEREx data on :8787
```

With the server running, the badge in the top bar switches from **Simulated data** to **Live · SPHEREx**. First loads of a field take ~10 s (about a minute when JPL is also checked); results are cached in `server/.cache/`.

## Tests

```sh
node tests/pipeline.test.mjs                 # detection pipeline, plain Node
PLANETX_OFFLINE=1 node --test tests/data.test.mjs
node tests/workflow.test.mjs                 # browser tests need Chrome + playwright-core
node tests/field.test.mjs
node tests/shell.test.mjs
```

## Credits

- Sky imagery: NASA/Goddard Space Flight Center Scientific Visualization Studio, *Deep Star Maps 2020*. Gaia DR2: ESA/Gaia/DPAC.
- Data: SPHEREx via NASA/IPAC Infrared Science Archive (IRSA); JPL Small-Body Identification and Horizons.
- Team: [Team member names]
