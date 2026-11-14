// Deep-zoom layer for the Sky view.
//
// The NASA backdrop is a 4096 × 2048 picture of the whole sky: about 11 pixels per degree, so it turns to mush well
// before the 6° zoom limit. Below DEEP.enterFov the sky is instead drawn from tiled all-sky survey imagery (HiPS), which
// has far more detail the closer you look. The tiles are drawn by Aladin Lite in a layer *behind* the three.js
// canvas; the canvas stays transparent there, so the grid, markers and tracks are still ours and still on top.
//
// Aladin Lite (CDS, GPL-3.0) is NOT bundled: it is fetched from jsDelivr at runtime the first time you zoom in, the same
// way the app loads three.js. If it cannot be reached (offline, blocked) nothing changes: the NASA picture just stays.
//
// Pure helpers (deepMix, horizontalFov) are importable from Node for tests.

export const DEEP = {
  enterFov: 28,   // wider than this: the NASA picture only
  fullFov: 16,    // narrower than this: tiles only; in between the two cross-fade
  version: '3.8.2',
  // DSS2 colour (visible light, whole sky) from IRSA's mirror of the CDS HiPS; the app already depends on IRSA.
  hips: 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color',
  loadTimeoutMs: 20000,
};
/** Tile surveys on IRSA's mirror of the CDS HiPS (all-sky). */
export const SURVEYS = {
  dss2: 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color',   // visible light, photographic plates; seams at wide views
  '2mass': 'https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color', // near infrared: clean, dramatic dust lane, some green speckle
};

/**
 * Settings from the page URL, so the looks can be compared without editing code:
 *   ?sky=dss2|2mass   which survey (default dss2)
 *   ?deep=<degrees>   the field of view below which tiles start to fade in (default 28; 130 = tiles at every zoom)
 */
export function deepConfig(search = '') {
  const q = new URLSearchParams(search), d = parseFloat(q.get('deep'));
  const enterFov = Number.isFinite(d) ? Math.min(130, Math.max(10, d)) : DEEP.enterFov;
  const fullFov = Math.max(6, Math.min(DEEP.fullFov, enterFov - 12));
  return { enterFov, fullFov: Number.isFinite(d) ? Math.max(6, enterFov - 12) : fullFov, hips: SURVEYS[q.get('sky')] || DEEP.hips };
}

export const ALADIN_ESM = `https://cdn.jsdelivr.net/npm/aladin-lite@${DEEP.version}/dist/aladin.js`;

/** How much of the tiles to show for a camera field of view: 0 = NASA picture only, 1 = tiles only (smooth in between). */
export function deepMix(fov, enter = DEEP.enterFov, full = DEEP.fullFov) {
  if (!Number.isFinite(fov)) return 0;
  const t = Math.min(1, Math.max(0, (enter - fov) / (enter - full)));
  return t * t * (3 - 2 * t);
}

/** Aladin sizes its view by the angular width; three.js by the angular height. Same gnomonic (TAN) geometry. */
export function horizontalFov(fovV, aspect) {
  const r = Math.PI / 180;
  return 2 * Math.atan(Math.tan(fovV * r / 2) * aspect) / r;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Aladin Lite took too long to load')), ms))]);

let loading = null;
/** Load Aladin Lite once (ES module from the official npm package) and wait for it to initialise. */
export function loadAladin() {
  if (loading) return loading;
  loading = withTimeout((async () => {
    const mod = await import(/* @vite-ignore */ ALADIN_ESM);
    const A = mod.default || mod.A;
    if (!A || typeof A.aladin !== 'function') throw new Error('Aladin Lite module did not export A');
    await A.init;
    return A;
  })(), DEEP.loadTimeoutMs).catch(e => { loading = null; throw e; });
  return loading;
}

/**
 * @param {HTMLElement} host  empty element sitting behind the three.js canvas (position: absolute; inset: 0)
 * @param {{onReady?: () => void}} [opts]
 */
export function createDeepZoom(host, { onReady = () => {}, load = loadAladin, config = deepConfig(typeof location !== 'undefined' ? location.search : '') } = {}) {
  let state = 'idle', viewer = null, last = {}, lastError = '';

  async function start(first) {
    state = 'loading';
    try {
      const A = await load();
      // Aladin lays its canvases out inside the element it is given and reads that element's size back; handing it the
      // host directly let the two feed each other (the box grew to millions of pixels). A fixed-size mount breaks the loop.
      const mount = document.createElement('div');
      mount.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden';
      host.appendChild(mount);
      viewer = A.aladin(mount, {
        survey: config.hips, target: `${first.raDeg} ${first.decDeg}`, fov: Math.max(0.01, first.fovH),
        cooFrame: 'ICRSd', projection: 'TAN', log: false,
        showReticle: false, showZoomControl: false, showFullscreenControl: false, showLayersControl: false,
        showGotoControl: false, showFrame: false, showCooGridControl: false, showProjectionControl: false,
        showSettingsControl: false, showShareControl: false, showSimbadPointerControl: false, showContextMenu: false,
      });
      state = 'ready'; last = {}; onReady();
    } catch (e) {
      state = 'failed'; lastError = e && e.message ? e.message : String(e);
      console.warn('[planet-x] deep zoom unavailable; keeping the NASA sky picture:', e);
    }
  }

  return {
    /**
     * Call every frame with the camera. Returns the share of the tiles to show (0 until they are ready, so the NASA
     * picture is never taken away before something sharper is behind it).
     */
    update({ raDeg, decDeg, fovV, aspect }) {
      const want = deepMix(fovV, config.enterFov, config.fullFov);
      if (want <= 0) { host.style.visibility = 'hidden'; return 0; }
      const fovH = horizontalFov(fovV, aspect || 1);
      if (state === 'idle') start({ raDeg, decDeg, fovH });
      if (state !== 'ready') return 0;
      host.style.visibility = 'visible';
      if (raDeg !== last.raDeg || decDeg !== last.decDeg) { viewer.gotoRaDec(raDeg, decDeg); last.raDeg = raDeg; last.decDeg = decDeg; }
      if (fovH !== last.fovH) { viewer.setFoV(fovH); last.fovH = fovH; }
      return want;
    },
    get state() { return state; },
    get error() { return lastError; },
    get viewer() { return viewer; },
  };
}
