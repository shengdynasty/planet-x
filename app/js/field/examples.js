// Built-in targets: 16 Psyche (the server's real-data test case) and the five test objects named in the challenge
// brief. Coordinates are for epoch 2026.0 (proper motions applied; the brief quotes WISE 0855 at its 2010 position).
// Pure data, no DOM: the Field view's Examples menu reads it, and scripts/save-snapshots.mjs saves each one as a
// JSON snapshot (app/data/snapshots/) so the hosted copy can show the real fields without a data server.
export const EXAMPLES = [
  { id: 'psyche', label: '16 Psyche · asteroid crossing, 16 Feb 2026', ra: 70.2635, dec: 19.0558, sizeArcsec: 300, det: 3, t: 61087.1294,
    note: 'Main-belt asteroid. Expect one Known object within ~2″ of the JPL ephemeris in the Feb 2026 frame, and nothing there in the other passes.' },
  { id: 'barnard', label: "Barnard's Star · fastest proper motion", ra: 269.4463, dec: 4.7682, sizeArcsec: 300, det: 1,
    note: "10.4″/yr, about 1.7 px per year here. Gaia DR3 knows it, so it is a Known star; Play shows the drift between passes." },
  { id: 'epsindi', label: 'Epsilon Indi Ba/Bb · brown-dwarf pair', ra: 331.0960, dec: -56.8010, sizeArcsec: 300, det: 2,
    note: 'Two T dwarfs moving 4.7″/yr, bright near 1.25 µm. Gaia DR3 sees the pair as one faint source (G 18.0), so it is a Known high-proper-motion star here. Under a pixel between adjacent passes, so compare the first and last.' },
  { id: 'wise0855', label: 'WISE 0855−0714 · coldest brown dwarf', ra: 133.7599, dec: -7.2422, sizeArcsec: 300, det: 6,
    note: '8″/yr but extremely faint even at 4.5 µm. SPHEREx may not detect it at all; an honest null result is the expected answer.' },
  { id: 'rwaur', label: 'RW Aurigae · variable young star', ra: 76.9565, dec: 30.4014, sizeArcsec: 300, det: 1,
    note: 'Brightness changes at a fixed position: expect Variable flags on the Gaia star, not motion.' },
  { id: 'rdra', label: 'R Draconis · Mira variable', ra: 248.1673, dec: 66.7550, sizeArcsec: 300, det: 1,
    note: 'Mira-type pulsator, magnitudes of change over a year, but at G 6.4 it saturates SPHEREx: expect pipeline artifact flags (TRANSIENT, SUR_ERROR, OVERFLOW) on its core, rejected as artifacts, and no Variable flag, because a saturated core carries no usable flux.' },
];
