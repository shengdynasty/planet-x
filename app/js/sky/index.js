// Sky view: the three.js all-sky scene from the UI demo, driven entirely by the store.
//   reads   candidates, filter (status + search, same predicate as the list), selectedId, scan, layers, view
//   writes  selectedId (when a marker is picked)
//   listens 'flyto' {ra (DEGREES), dec (deg), fov?}
/* global THREE */
import { toXYZ, yawPitchFor, raDecOf, unwrap } from './coords.js';
import { shortId, designation, matches, posAt, observed, hasPos } from '../candidates/format.js';
import { createBackdrop, makeRng, isLowEnd } from './backdrop.js';
import { VIEW } from './config.js';

const R_MARK = 500, R_GRID = 700, R_STARS = 600;
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
    renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
  } catch (e) {
    el.innerHTML = '<p style="color:#9a9a9a;padding:80px 20px;text-align:center">This browser could not start WebGL, so the 3D sky is unavailable.</p>';
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEW.home.fov, 1, 0.1, 2000);
  const home = yawPitchFor(VIEW.home.raH, VIEW.home.decD);
  let yaw = home.yaw, pitch = home.pitch, tYaw = yaw, tPitch = pitch, tFov = VIEW.home.fov;

  // --- backdrop ---
  const backdrop = createBackdrop(renderer, { low, onChange: () => kick() });
  scene.add(backdrop.mesh);

  // --- resolved stars: colour by temperature ---
  const starVert = `attribute float aSize; varying float vA; varying vec3 vC; uniform float uPR;
    void main(){ vA = clamp(aSize/4.0, .35, 1.0); vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
    gl_PointSize = aSize * uPR; gl_Position = projectionMatrix * mv; }`;
  const starFrag = `varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5);
    float core = smoothstep(.5, .12, d); gl_FragColor = vec4(mix(vC, vec3(1.0), core*.6), core * vA); }`;
  const haloFrag = `varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5);
    float a = pow(max(0., 1. - d*2.), 2.2) * .32; gl_FragColor = vec4(vC, a); }`;
  function pointsLayer(rnd, n, sizeFn, frag) {
    const pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3);
    const starColor = () => { const k = rnd(); // O/B blue, A/F white, G yellow, K/M orange
      return k < 0.12 ? [0.68, 0.78, 1.0] : k < 0.5 ? [0.95, 0.96, 1.0] : k < 0.75 ? [1.0, 0.93, 0.78] : [1.0, 0.78, 0.55]; };
    for (let i = 0; i < n; i++) {
      let u = rnd() * 2 - 1; if (rnd() < 0.5) u = Math.max(-1, Math.min(1, u * 0.6));
      const th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * R_STARS; pos[i * 3 + 1] = u * R_STARS; pos[i * 3 + 2] = r * Math.sin(th) * R_STARS;
      size[i] = sizeFn(); col.set(starColor(), i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
      uniforms: { uPR: { value: renderer.getPixelRatio() } }, vertexShader: starVert, fragmentShader: frag });
    return new THREE.Points(geo, mat);
  }
  { const r1 = makeRng(7); scene.add(pointsLayer(r1, low ? 12000 : 26000, () => Math.pow(r1(), 4) * 2.6 + 0.7, starFrag)); }
  { const r2 = makeRng(101); scene.add(pointsLayer(r2, 280, () => 18 + r2() * 24, haloFrag)); }
  { const r3 = makeRng(101); scene.add(pointsLayer(r3, 280, () => 3.2 + r3() * 1.8, starFrag)); }

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
  const clampPitch = p => Math.max(-1.5, Math.min(1.5, p));
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
    get backdrop() { return backdrop.kind; },
  };
  if (typeof window !== 'undefined') window.__sky = api; // headless tests
  return api;
}
