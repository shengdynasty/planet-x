# Other telescopes (Aladin Lite) in the Field view

When you select a flagged source in the **Field** view, its **Vetting** section shows four chips:

| Chip | What it shows | Taken |
|---|---|---|
| **DSS2** | Visible-light photographic plates (Digitized Sky Survey 2). Oldest images here, best for showing motion | 1980s–90s |
| **2MASS** | Sharp near-infrared images at wavelengths overlapping SPHEREx | 1997–2001 |
| **AllWISE** | Mid-infrared WISE images. Best for cold brown dwarfs | 2010–2011 |
| **SIMBAD** | Labels known objects with their names and types (drawn on whichever image is shown) | names |

Press a survey chip to open a small viewer centred on the selected source, with the 15-pixel SPHEREx vetting stamp outlined
in white. Press the lit chip again to close it. "Open in Aladin ↗" opens the same view on the full Aladin Lite site.

## Licence: Aladin Lite is not in this repo

Aladin Lite (CDS, Strasbourg) is GPL-3.0. Nothing from it is copied into this repository. The first time a chip is pressed,
`app/js/aladin/index.js` fetches it at runtime, the same way the app loads three.js from cdnjs, trying in order:

1. the official npm package, pinned (`aladin-lite@3.8.2`), as an ES module from jsDelivr;
2. the CDS-hosted script `https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js` (this returned 404 on
   13 Nov 2026, which is why the npm build comes first).

To move to a newer release, change `ALADIN_VERSION` in `app/js/aladin/index.js` (check `npm view aladin-lite versions`). `tests/aladin.test.mjs` fails if Aladin library files ever appear in the repo.
If the CDN can't be reached (claude.ai sandbox, offline, ad blocker), the viewer says so with a "Try again" button and the
rest of the Field view is unaffected.

## Try it

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

- **In the app:** http://localhost:8000/app/?ra=269.4463&dec=4.7682&size=300 → pick a flagged source → press **DSS2**.
- **Chips on their own:** http://localhost:8000/app/dev/aladin.html (buttons for the five challenge targets).

Demo idea: on Barnard's Star, press **DSS2** and zoom out (scroll) a little. The star moves about 10″ a year, so in plates
from the 1980s–90s it sits roughly 5–6′ from today's position, well outside the white SPHEREx stamp. **2MASS** (~1999) puts it
about 4–5′ away and **AllWISE** (2010) about 2′: the star walking towards the stamp across three decades.

## Files

- `app/js/aladin/index.js`: `mountOtherTelescopes(el)` → `{ setTarget({ra, dec, stampArcsec}) }`. Loads Aladin Lite on demand.
- `app/js/aladin/geom.js`: survey list with HiPS IDs and dates, field of view and outline maths. Add a survey here.
- `app/css/aladin.css`: chip and viewer styles.
- `app/js/field/index.js`: a mount point in the vetting template and an `updateOther(ra, dec)` call in `renderVet` (tagged `aladin`).
- `app/index.html`: the stylesheet, a help-sheet sentence and a credit line (tagged `aladin`).

