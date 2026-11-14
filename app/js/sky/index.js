// Sky view: the three.js all-sky scene from the UI demo, driven entirely by the store.
//   reads   candidates, filter (status + search, same predicate as the list), selectedId, scan, layers, view
//   writes  selectedId (when a marker is picked)
//   listens 'flyto' {ra (DEGREES), dec (deg), fov?}
/* global THREE */
import { toXYZ, yawPitchFor, raDecOf, unwrap } from './coords.js';
import { shortId, designation, matches, posAt, observed, hasPos } from '../candidates/format.js';
import { createBackdrop, isLowEnd } from './backdrop.js';
import { VIEW } from './config.js';
import { createDeepZoom } from './deepzoom.js';
import { createHdTiles } from './hdtiles.js';
import { createZoomDebug } from './zoomdebug.js'; // DEBUG (this branch only)

const R_MARK = 500, R_GRID = 700;
const v3 = (raH, decD, r) => new THREE.Vector3(...toXYZ(raH, decD, r));

/**
 * @param {HTMLElement} el  the #stage element
 * @param {typeof import('../core/store.js')} store
 * @param {{onView?: (v:{raH:number, decD:number, fov:number}) => void, onPick?: (id:string) => void}} [opts]
 */
export function mountSky(el, store, opts = {}) {
  if (typeof THREE === 'undefined') {
    el.innerHTML = '<p style="color:#9a9a9a;padding:80px 20px;text-align:center">The 3D sky needs WebGL and three.js, which did not load.</p>';
    return null;
  }
  const low = isLowEnd();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onView = opts.onView || (() => {});
  const onPick = opts.onPick || (() => {});

  el.setAttribute('role', 'application');
  el.setAttribute('aria-roledescription', 'sky map');
  el.setAttribute('aria-label', 'Sky. Drag or use arrow keys to look around, scroll or pinch to zoom.');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !low, alpha: true, powerPreference: 'high-performance' }); // alpha: the deep-zoom tiles sit behind the canvas
  } catch (e) {
    el.innerHTML = '<p style="color:#9a9a9a;padding:80px 20px;text-align:center">This browser could not start WebGL, so the 3D sky is unavailable.</p>';
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.setClearColor(0x000000, 0);
  el.appendChild(renderer.domElement);
  // Deep zoom: survey tiles (deepzoom.js) behind the canvas, faded in as the NASA picture runs out of detail.
  const deepHost = document.createElement('div'); deepHost.className = 'sky-deep'; deepHost.setAttribute('aria-hidden', 'true');
  el.insertBefore(deepHost, renderer.domElement);
  const deep = createDeepZoom(deepHost, { onReady: () => kick() });
  const zoomDebug = createZoomDebug(el); // DEBUG (this branch only)
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEW.home.fov, 1, 0.1, 2000);
  const home = yawPitchFor(VIEW.home.raH, VIEW.home.decD);
  let yaw = home.yaw, pitch = home.pitch, tYaw = yaw, tPitch = pitch, tFov = VIEW.home.fov;

  // --- backdrop ---
  const backdrop = createBackdrop(renderer, { low, onChange: () => kick() });
  scene.add(backdrop.mesh);
  backdrop.mesh.renderOrder = -101;
  // HD tiles: only what is on screen, at the detail the screen can show (hdtiles.js); the backdrop stays underneath.
  const hdq = new URLSearchParams(location.search);
  const hd = createHdTiles({ low, onChange: () => kick(), enabled: hdq.get('hd') !== '0', maxLevel: +hdq.get('hdmax') || 99 });
  scene.add(hd.group);

  // Every star on screen comes from the backdrop image (NASA SVS Deep Star Maps, built from Gaia DR2). The UI demo
  // used to draw three random point layers on top of it (26,000 faint dots, 280 haloed bright stars); 92% of those
  // bright "stars" matched nothing real (issues.md ISS-02), so they are gone: nothing invented is drawn on the sky.

  // --- grid (UI element: white only) ---
  const grid = new THREE.Group();
  {
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 });
    const eq = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 });
    for (let raH = 0; raH < 24; raH += 2) { const p = []; for (let d = -90; d <= 90; d += 3) p.push(v3(raH, d, R_GRID)); grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), mat)); }
    for (let dec = -60; dec <= 60; dec += 30) { const p = []; for (let h = 0; h <= 24; h += 0.25) p.push(v3(h, dec, R_GRID)); grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), dec === 0 ? eq : mat)); }
  }
  scene.add(grid);

  // --- markers + tracks, rebuilt from store.candidates ---
  const markerGroup = new THREE.Group(); scene.add(markerGroup);
  const trackGroup = new THREE.Group(); scene.add(trackGroup);
  const texCache = new Map();
  // Marker texture: reticle at (64,64) — tests look for the filled dot there — then the list number in bold and the
  // object's name after it. TEX_W × 128, drawn by a sprite of the same aspect, anchored on the reticle centre.
  const TEX_W = 1280, FONT = 'Inter, Helvetica, Arial, sans-serif';
  function reticleTex(label, name, filled) {
    const key = label + '\u0000' + name + (filled ? '*' : '');
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = TEX_W; c.height = 128; const g = c.getContext('2d');
    g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 8;
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 22, 0, Math.PI * 2); g.stroke();
    if (filled) { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 7, 0, Math.PI * 2); g.fill(); }
    g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.font = `600 62px ${FONT}`; g.fillText(label, 104, 64);
    if (name) {
      let x = 104 + g.measureText(label).width + 22, txt = name;
      g.font = `400 62px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.92)';
      while (txt.length > 1 && x + g.measureText(txt).width > TEX_W - 8) txt = txt.slice(0, -2).trimEnd() + '…'; // keep inside the texture
      g.fillText(txt, x, 64);
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; texCache.set(key, t);
    return t;
  }
  const labelOf = c => shortId(c); // same short label as the Movers list ('03', or 'F' for a Field-added candidate)
  const nameOf = c => designation(c); // the object's own name ('2003 UB', '16 Psyche', 'slow mover')
  /** @type {Map<string, {sprite: THREE.Sprite, track: THREE.Group, c: object, label: string, name: string, here: boolean}>} */
  let markers = new Map();
  function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.map) o.material.dispose(); }); g.clear(); }
  function buildMarkers() {
    markerGroup.children.forEach(s => s.material.dispose()); markerGroup.clear();
    disposeGroup(trackGroup);
    markers = new Map();
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const ptMat = new THREE.PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.6 });
    (store.get('candidates') || []).forEach(c => {
      if (!hasPos(c)) return;
      const label = labelOf(c), name = nameOf(c);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTex(label, name, false), transparent: true, depthWrite: false, depthTest: false }));
      s.center.set(64 / TEX_W, 0.5); s.userData.id = c.id; markerGroup.add(s);
      const pts = observed(c).map(p => v3(p[0], p[1], R_MARK)); // scans without a position are skipped
      const tg = new THREE.Group();
      if (pts.length > 1) tg.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      tg.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), ptMat));
      trackGroup.add(tg);
      markers.set(c.id, { sprite: s, track: tg, c, label, name, here: true });
    });
    placeMarkers();
  }
  // a marker sits at the scan's position and is hidden on scans where the mover was not observed
  function placeMarkers() {
    const scan = store.get('scan') || 1;
    markers.forEach(m => { const p = posAt(m.c, scan); m.here = !!p; if (p) m.sprite.position.copy(v3(p[0], p[1], R_MARK)); });
    styleMarkers();
  }
  const visibleByFilter = c => matches(c, store.get('filter') || {}); // status filter and search, exactly as the list
  function styleMarkers() {
    const sel = store.get('selectedId'), layers = store.get('layers') || {};
    markers.forEach(({ sprite, track, c, label, name, here }) => {
      const show = visibleByFilter(c);
      sprite.visible = show && here; track.visible = show && !!layers.tracks;
      const map = reticleTex(label, name, c.id === sel);
      if (sprite.material.map !== map) { sprite.material.map = map; sprite.material.needsUpdate = true; }
      sprite.renderOrder = c.id === sel ? 2 : 1;
    });
    grid.visible = layers.grid !== false;
    kick();
  }

  // --- camera control ---
  // The camera is oriented by Euler angles (rotateY, rotateX), not lookAt, so pitch may reach the poles exactly: a
  // go-to "0h, +90" centres on Dec +90°, not +85.9° (issues.md ISS-18). Drag speed near the pole is guarded below.
  const clampPitch = p => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p));
  const zoom = f => { tFov = Math.min(VIEW.fovMax, Math.max(VIEW.fovMin, tFov * f)); kick(); };
  function flyTo(raH, decD, fov) {
    const t = yawPitchFor(raH, decD);
    tYaw = unwrap(t.yaw, yaw); tPitch = clampPitch(t.pitch);
    if (fov) tFov = Math.min(VIEW.fovMax, Math.max(VIEW.fovMin, fov));
    kick();
  }
  function reset() { flyTo(VIEW.home.raH, VIEW.home.decD, VIEW.home.fov); }
  function pan(dx, dy) { const s = 0.06 * camera.fov / 60; tYaw += dx * s; tPitch = clampPitch(tPitch + dy * s); kick(); }

  // --- pointer input: drag to look, tap to pick, two-finger pinch to zoom ---
  const pointers = new Map(); let drag = null, moved = 0, pinch = null;
  el.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' }; moved = 0; el.classList.add('dragging'); }
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, fov: tFov }; drag = null; moved = 99; }
  });
  el.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      tFov = Math.min(VIEW.fovMax, Math.max(VIEW.fovMin, pinch.fov * pinch.d / d)); camera.fov = tFov; camera.updateProjectionMatrix(); kick();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
    // 1:1 grab: the sky point under the finger stays under it (radians per pixel at the view centre)
    const k = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, el.clientHeight);
    tYaw += dx * k / Math.max(0.25, Math.cos(pitch)); tPitch = clampPitch(tPitch + dy * k); yaw = tYaw; pitch = tPitch;
    drag.x = e.clientX; drag.y = e.clientY; kick();
  });
  const endPointer = (e, cancel) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      el.classList.remove('dragging');
      if (!cancel && drag && moved < 6) pick(e.clientX, e.clientY, drag.touch);
      drag = null;
    }
  };
  el.addEventListener('pointerup', e => endPointer(e, false));
  el.addEventListener('pointercancel', e => endPointer(e, true));
  el.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

  const tmp = new THREE.Vector3();
  function screenOf(sprite) {
    tmp.copy(sprite.position).project(camera);
    if (tmp.z > 1) return null;
    return { x: (tmp.x + 1) / 2 * el.clientWidth, y: (1 - tmp.y) / 2 * el.clientHeight };
  }
  function pick(clientX, clientY, touch) {
    const r = el.getBoundingClientRect(), cx = clientX - r.left, cy = clientY - r.top;
    let best = null, bd = touch ? VIEW.pickRadiusTouchPx : VIEW.pickRadiusPx;
    markers.forEach(({ sprite }, id) => {
      if (!sprite.visible) return; const p = screenOf(sprite); if (!p) return;
      const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = id; }
    });
    if (best) { store.set('selectedId', best); onPick(best); }
  }

  // arrow keys / zoom keys (only while the sky is the active view and focus isn't in a text field)
  window.addEventListener('keydown', e => {
    if (store.get('view') !== 'sky' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('dialog[open], [role="dialog"]:not(dialog):not([hidden])')) return; // a modal dialog owns the keys
    if (t && t.closest && t.closest('dialog, [role="dialog"], [role="listbox"], #panel')) return;
    if (e.key === 'ArrowLeft') pan(1, 0); else if (e.key === 'ArrowRight') pan(-1, 0);
    else if (e.key === 'ArrowUp') pan(0, 1); else if (e.key === 'ArrowDown') pan(0, -1);
    else if (e.key === '+' || e.key === '=') zoom(0.75); else if (e.key === '-' || e.key === '_') zoom(1.33);
    else return;
    e.preventDefault();
  });

  // --- store wiring ---
  store.on('candidates', buildMarkers);
  store.on('scan', placeMarkers);
  store.on('selectedId', styleMarkers);
  store.on('filter', styleMarkers);
  store.on('layers', styleMarkers);
  store.on('view', () => kick());
  store.listen('flyto', p => {
    if (!p) return;
    if (!Number.isFinite(p.ra) || !Number.isFinite(p.dec)) return;
    flyTo(p.ra / 15, p.dec, p.fov); // ra in degrees (contract); raHours, if present, is ignored
  });

  // --- render loop: only while visible, the sky is the active view, and something changed ---
  const dir = new THREE.Vector3();
  let raf = 0, dirty = true, lastW = 0, lastH = 0;
  const active = () => !document.hidden && store.get('view') === 'sky';
  function kick() { dirty = true; settled = false; if (!raf && active()) raf = requestAnimationFrame(frame); }
  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
    if (w === lastW && h === lastH) return; lastW = w; lastH = h;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); kick();
  }
  window.addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(el);
  document.addEventListener('visibilitychange', () => kick());
  let settled = false, frames = 0;
  function frame() {
    raf = 0;
    if (!active()) return;
    resize();
    const e = reduce.matches ? 1 : 0.12;
    yaw += (tYaw - yaw) * e; pitch += (tPitch - pitch) * e;
    let moving = Math.abs(tYaw - yaw) > 1e-5 || Math.abs(tPitch - pitch) > 1e-5;
    if (Math.abs(camera.fov - tFov) > 0.01) { camera.fov += (tFov - camera.fov) * e; camera.updateProjectionMatrix(); moving = true; }
    else if (camera.fov !== tFov) { camera.fov = tFov; camera.updateProjectionMatrix(); }
    if (!moving) { yaw = tYaw; pitch = tPitch; }
    camera.rotation.set(0, 0, 0); camera.rotateY(yaw); camera.rotateX(pitch);
    camera.getWorldDirection(dir);
    const { raH, decD } = raDecOf([dir.x, dir.y, dir.z]);
    onView({ raH, decD, fov: camera.fov });
    const mix = deep.update({ raDeg: raH * 15, decDeg: decD, fovV: camera.fov, aspect: camera.aspect });
    if (hd.update({ yaw, pitch, fovV: camera.fov, aspect: camera.aspect, heightPx: renderer.domElement.height })) moving = true;
    zoomDebug.update({ fovV: camera.fov, aspect: camera.aspect, heightPx: el.clientHeight, mix, state: deep.state, hd: hd.stats() }); // DEBUG
    backdrop.mesh.material.transparent = true; backdrop.mesh.material.opacity = 1 - mix; backdrop.mesh.visible = mix < 0.999;
    const sc = camera.fov / 60;
    markerGroup.children.forEach(s => s.scale.set(36 * (TEX_W / 128) * sc, 36 * sc, 1)); // same aspect as the texture; 36 units tall ≈ 25 px type on an 800 px view
    renderer.render(scene, camera); frames++;
    settled = !moving;
    dirty = false;
    if (moving) raf = requestAnimationFrame(frame);
  }
  buildMarkers(); resize(); kick();

  const api = {
    flyTo, reset, zoom, pan,
    centre() { camera.getWorldDirection(dir); return raDecOf([dir.x, dir.y, dir.z]); },
    /** Where the camera is heading (= centre() once settled); use this to act on a fly-to that is still easing. */
    target() { const cp = Math.cos(tPitch); return raDecOf([-Math.sin(tYaw) * cp, Math.sin(tPitch), -Math.cos(tYaw) * cp]); },
    get settled() { return settled; },
    get fov() { return camera.fov; },
    frames: () => frames,
    /** Screen position (px, relative to the stage) of a candidate's marker, or null if hidden / behind. */
    markerScreen(id) { const m = markers.get(id); if (!m || !m.sprite.visible) return null; camera.updateMatrixWorld(); return screenOf(m.sprite); },
    /** The label drawn next to a candidate's marker (same as the list's short id), or null if it has no marker. */
    markerLabel(id) { const m = markers.get(id); return m ? m.label : null; },
    /** The object's name drawn after the number, or null if it has no marker. */
    markerName(id) { const m = markers.get(id); return m ? m.name : null; },
    /** Whether a candidate's marker is shown (filter + search + observed in the current scan), wherever the camera is. */
    markerShown(id) { const m = markers.get(id); return !!(m && m.sprite.visible); },
    ready: backdrop.ready,
    /** The deep-zoom tiles: {state: 'idle'|'loading'|'ready'|'failed', error}. */
    hd: () => hd.stats(),
    deep: () => ({ state: deep.state, error: deep.error, viewer: deep.viewer }),
    get backdrop() { return backdrop.kind; },
    /** Direct children of the scene by three.js type, e.g. {Mesh: 1, Group: 3}: the backdrop, grid, markers, tracks and nothing else. */
    sceneTypes() { const c = {}; for (const o of scene.children) c[o.type] = (c[o.type] || 0) + 1; return c; },
  };
  if (typeof window !== 'undefined') window.__sky = api; // headless tests
  return api;
}
