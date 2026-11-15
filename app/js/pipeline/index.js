// Detection pipeline: pure ES modules, no DOM, importable from Node (see app/ARCHITECTURE.md).
export { simulateField, SIM_EPOCHS, SIM_OBJ, SIM_ARTIFACT, rng, gauss } from './sim.js';
export { analyse, stats, detect, diff, maxStack, meanStack, dist, KIND_ORDER, psfModel, psfMisfit, spikeOf, sigmaOfSpike, spikeLimit, SIM_PSF_SIGMA, LIVE_PSF_SIGMA, apFlux, UNDERSAMPLED_SIGMA, AP_RATIO, AP_SIGMAS, AP_SNR } from './detect.js';
export { radec, pixel, fmtDt, fmtRate, fmtRA, fmtDec, spectrum } from './format.js';
