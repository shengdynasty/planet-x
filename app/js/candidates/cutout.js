// The Movers panel and Compare share ONE cutout generator (app/js/compare/cutout.js), so the same candidate gets the
// same star field in both and a track that crosses RA 0h is drawn correctly (issues.md ISS-10). Pixels are still
// simulated for illustration; real frames are shown in the Field view.
export { renderCutout } from '../compare/cutout.js';
