// Shared data shapes (JSDoc only; no runtime code). Simulated and live data sources must both produce these.

/**
 * @typedef {Object} Scan
 * @property {number} id          1-based
 * @property {string} label       'Scan 1'
 * @property {string} date        human label, e.g. 'May 2025'
 * @property {boolean} has        false = scheduled, no data yet
 */

/**
 * @typedef {'Candidate'|'Matched'|'Likely'|'Rejected'|'Follow-up'} CandidateStatus
 *   Candidate = unmatched mover; Matched = known object; Likely = probable non-planet (e.g. brown dwarf);
 *   Rejected / Follow-up = set by a human reviewer in the workflow.
 */

/**
 * @typedef {Object} Candidate
 * @property {string} id               stable id, e.g. 'c03'
 * @property {string} name             'Candidate 03'
 * @property {string} tag              one-line description, 'Known asteroid · 2003 UB'
 * @property {CandidateStatus} status
 * @property {string} band             peak band label, '4.6 µm'
 * @property {Array<[number, number]>} pos   [raHours, decDeg] per available scan, in scan order
 * @property {string} note
 * @property {boolean} simulated       true for placeholder data — UI must say so
 * @property {string} [reviewNote]     free text from the reviewer (workflow)
 * @property {string} [match]          known-object designation if cross-matched
 */

/**
 * A field = one patch of sky observed at several epochs. Produced by data sources, consumed by the pipeline.
 * @typedef {Object} Field
 * @property {number} N                pixels per side
 * @property {number} scale            arcsec per pixel
 * @property {number} ra0              centre RA, degrees
 * @property {number} dec0             centre Dec, degrees
 * @property {Array<{t:number, band:number, label:string, sub:string}>} epochs   t in days from first epoch, band in µm
 * @property {(i:number) => Float32Array} frame   N*N image for epoch i (row-major, surface brightness)
 * @property {Array<{name:string, pos:(t:number)=>[number,number]}>} known   ephemeris: pixel position at time t
 * @property {boolean} simulated
 */

export {};
