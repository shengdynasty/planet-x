// Tile maths for the streamed HD sky (no DOM, no three.js, so it can be tested from Node).
//
// The sky is NASA's Deep Star Maps 2020 cut into a pyramid of 512 × 512 px tiles. Level l is the whole map at
// 1024 · 2^l px wide, as 2^(l+1) columns × 2^l rows (level 3 = 8192 px wide, level 6 = 65,536 px, 182 px per degree).
// Only tiles that are on screen, at the detail the screen can show, are ever fetched or drawn (like culling in a game).
//
// Map convention (assets/README.md): u from the left edge, v from the top; RA = (0.5 - u) · 24 h, Dec = 90 - 180 v.
import { toXYZ, dirFor } from './coords.js';

export const TILE_PX = 512;
export const PPD0 = 1024 / 360; // pixels per degree of the level-0 map

export const gridOf = level => ({ cols: 2 ** (level + 1), rows: 2 ** level });
export const pxPerDegree = level => PPD0 * 2 ** level;

/** The detail level whose texels are at least as dense as the screen's pixels: ceil(log2(screen px per deg / PPD0)). */
export function levelFor(heightPx, fovV, { min = 0, max = 6, bias = 0 } = {}) {
  if (!(heightPx > 0) || !(fovV > 0)) return min;
  const l = Math.ceil(Math.log2((heightPx / fovV) / PPD0) - 1e-9) + bias;
  return Math.max(min, Math.min(max, l));
}

/** RA (hours) and Dec (degrees) of the point at fraction (u, v) of the map. */
export const raDecAt = (u, v) => ({ raH: (((0.5 - u) * 24) % 24 + 24) % 24, decD: 90 - 180 * v });

/** The 9 sample points of a tile (corners, edge middles, centre) as unit vectors. */
export function tileSamples(level, col, row) {
  const { cols, rows } = gridOf(level), pts = [];
  for (const fv of [0, 0.5, 1]) for (const fu of [0, 0.5, 1]) {
    const { raH, decD } = raDecAt((col + fu) / cols, (row + fv) / rows);
    pts.push(toXYZ(raH, decD));
  }
  return pts;
}

/** Camera axes for a yaw/pitch, as in sky/index.js (rotateY(yaw) then rotateX(pitch), no roll). */
export function cameraBasis(yaw, pitch) {
  const f = dirFor(yaw, pitch), r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}

/**
 * Can any part of this tile be on screen? Conservative: it may say yes for a tile just off the edge (a little
 * margin is wanted so tiles are ready before they scroll in), never no for one that is showing.
 */
export function tileVisible(basis, fovV, aspect, level, col, row, margin = 0.15) {
  const t = Math.tan(fovV * Math.PI / 360), tx = t * aspect;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, front = 0, behind = 0;
  for (const p of tileSamples(level, col, row)) {
    const z = p[0] * basis.f[0] + p[1] * basis.f[1] + p[2] * basis.f[2];
    if (z <= 1e-3) { behind++; continue; }
    front++;
    const x = (p[0] * basis.r[0] + p[1] * basis.r[1] + p[2] * basis.r[2]) / z / tx;
    const y = (p[0] * basis.u[0] + p[1] * basis.u[1] + p[2] * basis.u[2]) / z / t;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!front) return false;
  // A tile that straddles the camera plane (some samples behind) is ~90° from the view centre, outside any rectilinear view
  // unless the view is very wide. Judge it by the samples in front only, with extra room, instead of keeping it blindly.
  const m = 1 + margin + (behind ? 0.5 : 0);
  return maxX >= -m && minX <= m && maxY >= -m && minY <= m;
}

/**
 * Every tile of `level` that may be on screen, found by descending the pyramid from `from` (a quadtree walk): a coarse tile
 * that is off screen rules out all of its children, so a deep zoom looks at a few dozen tiles, not all 8,192.
 */
export function visibleTiles(yaw, pitch, fovV, aspect, level, from = 0) {
  const basis = cameraBasis(yaw, pitch), out = [];
  const walk = (l, col, row) => {
    if (!tileVisible(basis, fovV, aspect, l, col, row)) return;
    if (l === level) { out.push({ level: l, col, row }); return; }
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) walk(l + 1, col * 2 + dc, row * 2 + dr);
  };
  const start = Math.min(from, level), { cols, rows } = gridOf(start);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) walk(start, col, row);
  return out;
}

/** The tile one level coarser that contains this one. */
export const parentOf = ({ level, col, row }) => ({ level: level - 1, col: col >> 1, row: row >> 1 });
export const tileKey = ({ level, col, row }) => `${level}/${col}_${row}`;
