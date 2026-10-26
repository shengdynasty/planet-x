// Sky configuration: the ONE place that says how an all-sky image maps onto the celestial sphere.
// If app/assets/README.md documents a different orientation for sky_4k.jpg, change SKY_IMAGE here only.

export const SKY_IMAGE = {
  url: 'assets/sky_4k.jpg',          // relative to app/index.html; see app/assets/README.md
  urlLow: 'assets/sky_2k.jpg',       // phones / low deviceMemory / small max texture size
  // Equirectangular image, celestial (ICRF/J2000 equatorial) coordinates.
  // NASA SVS Deep Star Maps 2020: "centered at 0h right ascension, and r.a. increases to the left", north up.
  raAtLeftEdgeH: 12,                 // RA (hours) at the image's left edge
  raIncreases: 'left',               // 'right' or 'left': which way RA grows across the image
  decTop: 90,                        // +90 if north is at the top of the image, -90 if south is
};

// Orientation of the procedural sky drawn by backdrop.js (only used if the real image is slow or fails to load).
export const PROCEDURAL = { raAtLeftEdgeH: 0, raIncreases: 'right', decTop: 90 };

export const VIEW = {
  home: { raH: 8.2918, decD: 8.594, fov: 60 }, // initial / reset view (same framing as the UI demo)
  fovMin: 6, fovMax: 100,
  flyFov: 22,                                // zoom used when flying to a candidate
  gotoFov: 30,                               // zoom used for an RA/Dec go-to
  pickRadiusPx: 24, pickRadiusTouchPx: 34,
};
