# Features and how each was tested

Every feature below has an automated check in `tests/e2e/featuretest.mjs`, run once in Advanced and once in Simple mode against a local copy
(`node tests/e2e/featuretest.mjs advanced` / `simple`, needs `playwright-core` and Chrome). Last run: Advanced 75/75, Simple 75/75.
"Hidden by design" means Simple mode deliberately removes that control; the check confirms it is hidden.

**Modes.** *Advanced* is the app as built, with the technical terms. *Simple* keeps every view but uses plain words, hides coordinate and survey controls, and has its own help text. Switch in the top bar; the choice is remembered, and `?mode=simple|advanced` overrides it for a shared link.

## Top bar and help

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| A1 | Mode is applied (advanced) | pass | pass |
| A2 | Mode switch shows Simple and Advanced | pass | pass |
| A3 | Home link points to the site home | pass | pass |
| A4 | View switch: Sky, Compare, Field exist | pass | pass |
| A5 | Source badge text is right for the mode | pass | pass |
| A6 | Go-to box is shown | pass | pass |
| A7 | RA/Dec readout is shown | pass | pass |
| A8 | Grid and Tracks buttons are shown | pass | pass |
| A9 | Moving Sky demo link works | pass | pass |
| A10 | Help sheet opens with the advanced text and closes with Esc | pass | pass |
| A11 | Help sheet closes with its ✕ button | pass | pass |
| A12 | Mode choice is remembered after reload | pass | pass |
| A13 | Switching modes back and forth restores the original words | pass | pass |

## Sky view

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| B1 | Sky view is the starting view | pass | pass |
| B2 | Zoom in (+) narrows the field of view | pass | pass |
| B3 | Zoom out (−) widens the field of view | pass | pass |
| B4 | Reset view returns to the start | pass | pass |
| B5 | Scroll wheel zooms | pass | pass |
| B6 | Dragging looks around | pass | pass |
| B7 | Arrow keys pan | pass | pass |
| B9 | Sharp tiles load at high zoom (64k where available) | pass | pass |
| B10 | Sky background and star map are drawn (canvas has content) | pass | pass |
| B11 | Grid toggle button flips (Advanced) / G key | pass | hidden by design |
| B12 | Tracks toggle button flips (Advanced) / T key | pass | hidden by design |
| B13 | Go to RA/Dec moves the sky (Advanced) | pass | hidden by design |
| B14 | Go to "candidate 3": selects it, or says there is no such candidate (saved data has none named c3) | pass | hidden by design |
| B15 | Timeline lists the scans | pass | pass |
| B16 | Clicking a scan makes it current | pass | pass |
| B17 | Number keys jump to a scan | pass | pass |
| B18 | Blink button flips between scans / B key | pass | pass |

## Movers panel and export

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| C1 | Movers list shows 5 items | pass | pass |
| C2 | Filter buttons narrow the list | pass | pass |
| C3 | Search narrows the list | pass | pass |
| C4 | Sort changes the order | pass | pass |
| C5 | Picking a mover opens its details | pass | pass |
| C6 | Details panel shows a picture and plain/technical text | pass | pass |
| C7 | Center / Look-here button moves the sky to the mover | pass | pass |
| C8 | Export menu opens with 4 choices | pass | pass |
| C9 | Export: download CSV works and cells are safe | pass | pass |
| C10 | Export: download JSON works | pass | pass |
| C11 | Export: copy CSV works or shows its text box | pass | pass |
| C12 | Close (✕) clears the selection | pass | pass |

## Compare view

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| D1 | Compare button opens the Compare view | pass | pass |
| D2 | Compare shows the chosen mover name | pass | pass |
| D3 | Left and Right scan pickers exist | pass | pass |
| D4 | Picking a scan on the left changes it | pass | pass |
| D5 | Overlay: Difference mode | pass | pass |
| D6 | Wipe slider moves with arrow keys | pass | pass |
| D7 | Wipe slider moves by dragging | pass | pass |
| D8 | Compare Blink button works | pass | pass |
| D9 | Facts list is technical | pass | pass |
| D10 | Honest note about simulated pixels is shown | pass | pass |
| D11 | Back to sky works | pass | pass |

## Field (close-up) view

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| E1 | Field view opens | pass | pass |
| E2 | Field draws a picture | pass | pass |
| E3 | View modes: Blink / Difference / Track / Play each can be selected | pass | pass |
| E4 | Reference pass picker changes pass | pass | pass |
| E5 | Compare-with pass picker changes pass | pass | pass |
| E6 | Layer buttons (Flags / Known objects) toggle | pass | pass |
| E7 | Brightness (Stretch) slider works | pass | pass |
| E8 | Flagged-source list has entries | pass | pass |
| E9 | Choosing an example target loads it | pass | pass |
| E10 | Field keyboard: B/D/T/L switch view mode | pass | pass |
| E11 | Keyboard-hint list is shown | pass | pass |
| E12 | Spectrum chart exists | pass | pass |
| E13 | Field picture labels are technical | pass | pass |
| E14 | Back (← Sky) leaves Field | pass | pass |

## Shortcuts, links and phones

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| F1 | Keyboard S/C/F switch views | pass | pass |
| F2 | / focuses the go-to box (Advanced) | pass | hidden by design |
| F3 | ? opens help | pass | pass |
| F4 | Deep link ?ra&dec opens the Field view | pass | pass |
| F5 | Mobile layout: panel toggle opens the list | pass | pass |
| F6 | Mobile: the mode switch is reachable | pass | pass |
| F7 | No unexpected console or page errors | pass | pass |

## Not covered by the automated run

- **Live server mode** (any position via IRSA through a local server): needs the server and network; without it the app uses saved or simulated data.
- **Aladin survey layers** (DSS2, 2MASS, AllWISE in the Field vetting panel, and `?sky=`): load from a third-party CDN, so not checked offline.
- **Moving Sky demo contents**: only its link is checked; it is a separate page.
- **Touch gestures** (pinch): the mouse equivalents are checked.
