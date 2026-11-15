// Streamed HD sky: NASA's Deep Star Map as a pyramid of 512 px tiles (scripts/make-sky-tiles.py), of which only the tiles
// that are on screen, at the detail the screen can show, are fetched and drawn. Like culling and LOD in a game:
//   - level of detail from the zoom (tilemath.levelFor): texels about as dense as screen pixels, never more;
//   - visibility by walking the tile quadtree (tilemath.visibleTiles): off-screen branches are never looked at;
//   - coarse tiles load first and stay under the fine ones, so the picture refines instead of popping;
//   - a small LRU cache: textures that have not been seen for a while are disposed.
// The 4k backdrop (backdrop.js) stays underneath as the base, so nothing is ever blank. If assets/skytiles is absent
// (it is not in git; see scripts/make-sky-tiles.py) this module turns itself off and the sky is as before.
// Tiles may live on another site: `bases` is tried in order for a manifest.json, and images are loaded with CORS so WebGL accepts them.
/* global THREE */
import { levelFor, visibleTiles, parentOf, tileKey, gridOf } from './tilemath.js';
import { orient } from './backdrop.js';
import { SKY_IMAGE } from './config.js';

const R = 800, FADE_MS = 220;

export function createHdTiles({ onChange = () => {}, low = false, bases = ['assets/skytiles'], maxCache = low ? 90 : 280, maxVisible = low ? 40 : 110, maxLoads = 6, maxLevel = 99, enabled = true } = {}) {
  const group = new THREE.Group();
  orient(group, SKY_IMAGE);
  let state = enabled ? 'idle' : 'off', manifest = null, base = '', frame = 0, lastT = 0;
  const tiles = new Map();           // key -> {key, level, col, row, status: 'new'|'loading'|'ready'|'missing', tex, mesh, used}
  let inflight = 0, wanted = [];
  const stat = { level: 0, visible: 0, drawn: 0, loading: 0, cached: 0 };

  const get = t => { const k = tileKey(t); let e = tiles.get(k); if (!e) { e = { key: k, ...t, status: 'new', tex: null, mesh: null, used: 0 }; tiles.set(k, e); } return e; };

  async function start() {
    state = 'loading';
    for (const b of bases) {
      try {
        const r = await fetch(`${b.replace(/\/$/, '')}/manifest.json`);
        if (!r.ok) continue;
        manifest = await r.json(); base = b.replace(/\/$/, ''); state = 'ready'; onChange(); return;
      } catch (e) { /* unreachable: try the next place */ }
    }
    state = 'off';   // no tiles anywhere: the 4k sky stays, silently
  }

  function pump() {
    while (inflight < maxLoads && wanted.length) {
      const e = wanted.shift(); if (e.status !== 'new') continue;
      // a partial level (manifest.have[level] = ['col_row', ...]) only exists in places: do not ask for the rest
      if (manifest.have && manifest.have[e.level] && !manifest.have[e.level].includes(`${e.col}_${e.row}`)) { e.status = 'missing'; continue; }
      e.status = 'loading'; inflight++;
      const img = new Image(); img.decoding = 'async'; img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.encoding = THREE.sRGBEncoding; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
        e.tex = tex; e.status = 'ready'; inflight--; onChange(); pump();
      };
      img.onerror = () => { e.status = 'missing'; inflight--; pump(); };
      img.src = `${base}/${e.level}/${e.col}_${e.row}.${manifest.ext}`;
    }
  }

  function showMesh(e) {
    if (!e.mesh) {
      const { cols, rows } = gridOf(e.level), phi = 2 * Math.PI / cols, theta = Math.PI / rows;
      const geo = new THREE.SphereGeometry(R, Math.max(2, Math.min(24, Math.ceil(360 / cols / 4))), Math.max(2, Math.min(24, Math.ceil(180 / rows / 4))), e.col * phi, phi, e.row * theta, theta);
      const mat = new THREE.MeshBasicMaterial({ map: e.tex, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      e.mesh = new THREE.Mesh(geo, mat); e.mesh.renderOrder = -100 + e.level; e.mesh.frustumCulled = false;
      group.add(e.mesh);
    }
    e.mesh.visible = true;
  }
  function drop(e) {
    if (e.mesh) { group.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); e.mesh = null; }
    if (e.tex) { e.tex.dispose(); e.tex = null; }
    tiles.delete(e.key);
  }

  return {
    group,
    get state() { return state; },
    stats: () => ({ ...stat, state, base }),
    /**
     * Call every frame with the camera. Returns true while something is still loading or fading in (keep rendering).
     * @param {{yaw:number, pitch:number, fovV:number, aspect:number, heightPx:number}} cam  heightPx = drawing-buffer height
     */
    update({ yaw, pitch, fovV, aspect, heightPx }) {
      if (state === 'idle') start();
      if (state !== 'ready') return state === 'loading';
      frame++; const now = performance.now(), dt = lastT ? now - lastT : 16; lastT = now;
      const raw = levelFor(heightPx, fovV, { min: 0, max: 99 });
      let L = Math.min(raw, manifest.maxLevel, maxLevel);
      let busy = false, drawn = 0, vis = [];
      const draw = new Set();
      if (L >= manifest.minLevel) {
        vis = visibleTiles(yaw, pitch, fovV, aspect, L, manifest.minLevel);
        // Near the poles the map's columns crowd together, so a small view touches hundreds of thin tiles: take less detail
        // there rather than blow the budget.
        while (vis.length > maxVisible && L > manifest.minLevel) { L--; vis = visibleTiles(yaw, pitch, fovV, aspect, L, manifest.minLevel); }
        const lowest = Math.max(manifest.minLevel, L - 2); // request this level and two coarser, as a progressive path
        const want = new Map();
        for (const t0 of vis) {
          let t = t0, covered = false;
          for (let l = L; l >= manifest.minLevel; l--, t = parentOf(t)) {
            const e = get(t); e.used = frame;
            if (e.status === 'new' && l >= lowest) want.set(e.key, e);
            if (!covered && e.status === 'ready') {
              draw.add(e);
              if (e.mesh && e.mesh.material.opacity >= 0.999) covered = true; // fully in: nothing coarser needs drawing
            }
          }
        }
        wanted = [...want.values()].sort((a, b) => a.level - b.level);
        pump();
      }
      for (const e of tiles.values()) {
        if (!e.mesh && !draw.has(e)) continue;
        if (draw.has(e)) {
          showMesh(e); drawn++;
          const m = e.mesh.material;
          if (m.opacity < 1) { m.opacity = Math.min(1, m.opacity + dt / FADE_MS); busy = true; }
        } else e.mesh.visible = false;
      }
      // LRU: keep at most maxCache textures; never drop something in view
      let have = 0; for (const e of tiles.values()) if (e.tex) have++;
      if (have > maxCache) {
        const old = [...tiles.values()].filter(e => e.tex && e.used < frame - 1).sort((a, b) => a.used - b.used);
        for (const e of old) { if (have <= maxCache) break; drop(e); have--; }
      }
      stat.level = L < manifest.minLevel ? 0 : L; stat.visible = vis.length; stat.drawn = drawn; stat.loading = inflight + wanted.length; stat.cached = have;
      return busy || inflight > 0 || wanted.length > 0;
    },
  };
}
