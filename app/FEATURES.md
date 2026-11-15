# Features and how each was tested

Every feature below has an automated check in `tests/features.test.mjs`, run once in Advanced and once in Simple mode against the
app as the hosted copy shows it (saved SPHEREx data, no live server), on the shared browser harness (`tests/browser.mjs`: any machine
with Chrome; `node tests/features.test.mjs`, about six minutes; `--md` prints these tables). The rule is strict: a check passes only by
returning true; a string is a failure note; a Simple-mode control that is meant to be hidden counts as *hidden by design* only after
the check confirms it is hidden. Last full run (16 Nov 2026, main at 8f684a3 plus this test): Advanced 74/74, Simple 69/74 with the
other 5 hidden by design, no failures. The tables below are what that run printed.

**Modes.** *Advanced* is the app as built, with the technical terms. *Simple* keeps every view but uses plain words, hides coordinate and survey controls, and has its own help text. Advanced is the default; switch in the top bar, the choice is remembered, and `?mode=simple|advanced` overrides it for a shared link.

## Top bar and help

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| A1 | Mode is applied | pass | pass |
| A2 | Mode switch shows Simple and Advanced | pass | pass |
| A3 | Home link points to the site home | pass | pass |
| A4 | View switch: Sky, Compare, Field exist | pass | pass |
| A5 | Source badge names the saved data in the mode's words | pass | pass |
| A6 | Go-to box: shown in Advanced, hidden in Simple | pass | pass |
| A7 | RA/Dec readout: shown in Advanced, hidden in Simple | pass | pass |
| A8 | Grid and Tracks buttons: shown in Advanced, hidden in Simple | pass | pass |
| A9 | Moving Sky demo link resolves | pass | pass |
| A10 | Help sheet opens with the mode's text and closes with Esc | pass | pass |
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
| B9 | Sharp tiles load at the zoom limit (level 5 or the 64k level 6) | pass | pass |
| B10 | Sky canvas is present | pass | pass |
| B11 | Grid toggle flips by button and by G key (Advanced) | pass | hidden by design |
| B12 | Tracks toggle flips (Advanced) | pass | hidden by design |
| B13 | Go to RA/Dec moves the sky (Advanced) | pass | hidden by design |
| B14 | Go to "candidate 3" selects it or says there is no such candidate (Advanced) | pass | hidden by design |
| B15 | Timeline lists the scans | pass | pass |
| B16 | Clicking a scan makes it current | pass | pass |
| B17 | Number keys jump to a scan | pass | pass |
| B18 | Blink button flips between scans | pass | pass |

## Movers panel and export

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| C1 | Movers list shows every candidate in the store | pass | pass |
| C2 | Filter buttons narrow the list | pass | pass |
| C3 | Search narrows the list | pass | pass |
| C4 | Sort changes the order | pass | pass |
| C5 | Picking a mover opens its details | pass | pass |
| C6 | Details panel is in the mode's words | pass | pass |
| C7 | Center / Look-here button moves the sky to the mover | pass | pass |
| C8 | Export menu opens with 4 choices | pass | pass |
| C9 | Export: download CSV works | pass | pass |
| C10 | Export: download JSON works | pass | pass |
| C11 | Export: copy CSV writes the clipboard or shows its text box | pass | pass |
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
| D9 | Facts list is in the mode's words | pass | pass |
| D10 | Honest note about the cutout pixels is shown | pass | pass |
| D11 | Back to sky works | pass | pass |

## Field (close-up) view

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| E1 | Field view opens | pass | pass |
| E2 | Field draws a picture | pass | pass |
| E3 | View modes: Blink / Difference / Track / Stack / Play each can be selected | pass | pass |
| E4 | Reference pass picker changes pass | pass | pass |
| E5 | Compare-with pass picker changes pass | pass | pass |
| E6 | Layer buttons (Flags / Known objects) toggle | pass | pass |
| E7 | Brightness (Stretch) slider: works in Advanced, hidden in Simple | pass | pass |
| E8 | Flagged-source list has entries | pass | pass |
| E9 | Choosing an example target loads it | pass | pass |
| E10 | Field keyboard: D switches to Difference, B back to Blink | pass | pass |
| E11 | Keyboard-hint list: shown in Advanced, hidden in Simple | pass | pass |
| E12 | Spectrum chart: present in Advanced, hidden in Simple | pass | pass |
| E13 | Field picture labels are in the mode's words | pass | pass |
| E14 | Back (← Sky) leaves Field | pass | pass |

## Shortcuts, links and phones

| ID | Feature | Advanced | Simple |
|---|---|---|---|
| F1 | Keyboard F opens Field, Esc and S return to Sky | pass | pass |
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
- **Data releases and field files** (the Field view's release labels, typed-in releases, Save / Open field file): covered by `tests/releases.test.mjs`, `tests/releases-server.test.mjs` and `tests/releases-browser.test.mjs`, not by this run.
