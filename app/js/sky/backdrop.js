// All-sky backdrop: a colourful procedural sky (the UI demo's), replaced by a real equirectangular image
// when SKY_IMAGE.url loads. Orientation for both comes from config.js.
/* global THREE */
import { SKY_IMAGE, PROCEDURAL } from './config.js';

export function makeRng(seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  rnd.gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;
  return rnd;
}

/** Lighter build for phones / low-memory devices. */
export function isLowEnd() {
  const mem = navigator.deviceMemory || 8;
  return Math.min(window.innerWidth, window.innerHeight) <= 600 || mem <= 4;
}

const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * Draw the procedural sky into a canvas, yielding to the event loop between chunks so first paint and input
 * are never blocked. Resolves to the canvas.
 */
export async function proceduralSky({ low = isLowEnd() } = {}) {
  const rnd = makeRng(11), gauss = rnd.gauss;
  const w = low ? 2048 : 4096, h = w / 2, k = w / 4096;          // k scales radii
  const n = c => Math.round(c * (low ? 0.35 : 1));                // fewer blobs on small devices
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#02030a'; g.fillRect(0, 0, w, h);
  const bandY = t => h / 2 + Math.sin(t * Math.PI * 2 + 1.2) * h * 0.22;
  const blob = (x, y, rad, color) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const CHUNK = low ? 300 : 900;
  async function loop(count, fn) { for (let i = 0; i < count; i++) { fn(i); if (i % CHUNK === CHUNK - 1) await tick(); } await tick(); }
  // wide warm glow of the galactic bulge, fading to cool blue away from the plane
  await loop(n(500), () => { const t = rnd(), x = t * w, y = bandY(t) + gauss() * h * 0.11; blob(x, y, (180 + rnd() * 320) * k, `hsla(${28 + rnd() * 14}, 70%, ${52 + rnd() * 10}%, 0.028)`); });
  await loop(n(900), () => { const t = rnd(), x = t * w, y = bandY(t) + gauss() * h * 0.16; blob(x, y, (100 + rnd() * 220) * k, `hsla(${210 + rnd() * 25}, 60%, 60%, 0.018)`); });
  // mid-scale nebulosity: pinks and oranges (H-alpha) with a few blue reflection patches
  await loop(n(2600), () => {
    const t = rnd(), x = t * w, y = bandY(t) + gauss() * h * 0.08, rad = (36 + rnd() * 110) * k, q = rnd();
    blob(x, y, rad, q < 0.55 ? `hsla(${20 + rnd() * 22}, 80%, 58%, 0.045)` : q < 0.8 ? `hsla(${330 + rnd() * 20}, 70%, 60%, 0.035)` : `hsla(${205 + rnd() * 20}, 75%, 62%, 0.04)`);
  });
  // fine structure
  await loop(n(9000), () => { const t = rnd(), x = t * w, y = bandY(t) + gauss() * h * 0.07; blob(x, y, (5 + rnd() * 24) * Math.max(k, 0.7), `hsla(${30 + rnd() * 30}, 60%, 75%, 0.07)`); });
  // dust lanes
  g.globalCompositeOperation = 'multiply';
  await loop(n(800), () => {
    const t = rnd(), x = t * w, y = bandY(t) + gauss() * h * 0.03, rad = (18 + rnd() * 120) * k;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, 'rgba(70,45,35,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  });
  g.globalCompositeOperation = 'source-over';
  // two Magellanic-cloud-like smudges off the plane
  blob(w * 0.22, h * 0.84, 150 * k, 'rgba(200,210,255,0.16)'); blob(w * 0.16, h * 0.9, 90 * k, 'rgba(200,210,255,0.14)');
  // unresolved stars with a little colour
  const cols = ['rgba(255,205,160,0.45)', 'rgba(180,200,255,0.45)', 'rgba(255,255,255,0.4)'];
  await loop(Math.round(70000 * (low ? 0.3 : 1)), () => {
    const t = rnd(), y = rnd() < 0.5 ? rnd() * h : bandY(t) + gauss() * h * 0.08, q = rnd();
    g.fillStyle = q < 0.15 ? cols[0] : q < 0.3 ? cols[1] : cols[2]; g.fillRect(t * w, y, 1, 1);
  });
  return cv;
}

/**
 * Orient the backdrop mesh so image pixels land on the right RA/Dec (texture offset/repeat/flipY untouched).
 * three.js SphereGeometry puts texture u at local direction (-cos 2πu, ·, sin 2πu); the app's toXYZ puts RA at
 * (cos ra, ·, -sin ra). For an image whose left edge is RA0 with RA growing rightwards that is
 * rotation.y = RA0 + π. If RA grows leftwards (sky seen from inside, e.g. NASA SVS), mirror z first
 * (scale.z = -1) with the same rotation. For the SVS map (RA0 = 12h, leftwards) this gives rotation.y = 2π,
 * scale.z = -1: the same transform as app/assets/README.md's rotation.y = π, scale.x = -1.
 * r128 flips face winding for a negative-determinant world matrix, so BackSide still draws the inside.
 */
export function orient(mesh, o) {
  mesh.scale.set(1, o.decTop < 0 ? -1 : 1, o.raIncreases === 'left' ? -1 : 1);
  mesh.rotation.set(0, o.raAtLeftEdgeH / 12 * Math.PI + Math.PI, 0);
}

/**
 * Create the backdrop mesh and load the real sky image (2k on phones / low memory, 4k otherwise).
 * The procedural sky is only a fallback: built if the image fails, or as a placeholder if it hasn't
 * arrived after `placeholderAfterMs`. `onChange(kind)` fires when a texture is applied ('procedural' | 'image').
 */
export function createBackdrop(renderer, { low = isLowEnd(), onChange = () => {}, placeholderAfterMs = 2500 } = {}) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, low ? 48 : 64, low ? 32 : 48),
    new THREE.MeshBasicMaterial({ color: 0x02030a, side: THREE.BackSide }));
  let kind = null, building = false, resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  const apply = (tex, o, k) => {
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); tex.encoding = THREE.sRGBEncoding;
    orient(mesh, o);
    const mat = mesh.material;
    if (mat.map) mat.map.dispose();
    mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
    kind = k; onChange(k); resolveReady(k);
  };
  const fallback = () => {
    if (building || kind === 'image') return; building = true;
    proceduralSky({ low }).then(cv => { if (kind !== 'image') apply(new THREE.CanvasTexture(cv), PROCEDURAL, 'procedural'); });
  };
  const small = low || renderer.capabilities.maxTextureSize < 4096;
  new THREE.TextureLoader().load(small ? SKY_IMAGE.urlLow : SKY_IMAGE.url,
    tex => apply(tex, SKY_IMAGE, 'image'), undefined, fallback);
  setTimeout(fallback, placeholderAfterMs);
  return { mesh, ready, get kind() { return kind; } };
}
