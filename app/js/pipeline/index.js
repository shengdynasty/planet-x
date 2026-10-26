// Detection pipeline: pure ES modules, no DOM, importable from Node (see app/ARCHITECTURE.md).
export { simulateField, SIM_EPOCHS, SIM_OBJ, SIM_ARTIFACT, rng, gauss } from './sim.js';
export { analyse, stats, detect, diff, maxStack, dist, KIND_ORDER } from './detect.js';
export { radec, pixel, fmtDt, fmtRate, fmtRA, fmtDec, spectrum } from './format.js';
