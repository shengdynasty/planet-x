// Tile maths for the streamed HD sky (no browser):  node tests/tilemath.test.mjs   (from the repo root)
import { gridOf, pxPerDegree, levelFor, raDecAt, tileSamples, cameraBasis, tileVisible, visibleTiles, parentOf, tileKey } from '../app/js/sky/tilemath.js';
import { yawPitchFor, raDecOf, toXYZ, dirFor } from '../app/js/sky/coords.js';

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL ' + m); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// pyramid geometry
ok(gridOf(3).cols === 16 && gridOf(3).rows === 8 && gridOf(6).cols === 128 && gridOf(6).rows === 64, 'grid sizes: level 6 is 128 x 64 tiles of 512 px = 65,536 x 32,768');
ok(near(pxPerDegree(6), 65536 / 360) && near(pxPerDegree(2), 4096 / 360), 'pixels per degree');

// map convention: u = 0.5 is 0h, left edge is 12h, top is +90
ok(near(raDecAt(0.5, 0.5).raH, 0) && near(raDecAt(0, 0.5).raH, 12) && near(raDecAt(0.25, 0).decD, 90) && near(raDecAt(0.25, 1).decD, -90), 'map convention (RA 0h at the centre, RA grows to the left, north on top)');
ok(near(raDecAt(0.25, 0.5).raH, 6) && near(raDecAt(0.75, 0.5).raH, 18), 'RA 6h is left of centre, 18h right');

// levelFor: texels about as dense as screen pixels
ok(levelFor(1536, 100) === 3 && levelFor(1536, 60) === 4 && levelFor(1536, 20) === 5 && levelFor(1536, 6) === 6, 'level for a 1536 px tall screen at fov 100/60/20/6');
ok(levelFor(768, 100) === 2 && levelFor(768, 60) === 3, 'a 768 px tall screen needs one level less (level 2 is the 4k backdrop)');
ok(levelFor(768, 6, { max: 6 }) === 6 && levelFor(768, 6, { max: 4 }) === 4, 'capped by the finest level (or a device cap)');
ok(levelFor(0, 6) === 0 && levelFor(768, 0) === 0 && levelFor(768, NaN) === 0, 'bad input is harmless');
for (let f = 100; f > 6; f -= 5) ok(levelFor(1000, f - 1) >= levelFor(1000, f), `level never drops as you zoom in (${f})`);

// a tile contains its own centre point and the camera sees what is in front of it
const { yaw, pitch } = yawPitchFor(17.963, 4.69);
const b = cameraBasis(yaw, pitch);
ok(near(b.f[0] * b.r[0] + b.f[1] * b.r[1] + b.f[2] * b.r[2], 0) && near(b.u[0] * b.f[0] + b.u[1] * b.f[1] + b.u[2] * b.f[2], 0), 'camera axes are perpendicular');
const c = raDecOf(b.f); ok(near(c.raH, 17.963, 1e-3) && near(c.decD, 4.69, 1e-3), 'camera looks where the yaw/pitch say');

// the tile under the view centre is always visible, at every level; one on the far side never is
for (const level of [3, 4, 5, 6]) {
  const { cols, rows } = gridOf(level);
  const u = 0.5 - 17.963 / 24, v = (90 - 4.69) / 180; // map fractions of the view centre
  const col = Math.floor(((u % 1) + 1) % 1 * cols), row = Math.floor(v * rows);
  ok(tileVisible(b, 6, 4 / 3, level, col, row), `centre tile visible at level ${level}`);
  const far = { col: (col + cols / 2) % cols, row: rows - 1 - row };
  ok(!tileVisible(b, 6, 4 / 3, level, far.col, far.row), `opposite tile not visible at level ${level}`);
}

// culling: a deep zoom looks at a handful of tiles, a wide view at more, and never the whole sky
const n6 = visibleTiles(yaw, pitch, 6, 4 / 3, 6, 3).length, n5 = visibleTiles(yaw, pitch, 20, 4 / 3, 5, 3).length, n3 = visibleTiles(yaw, pitch, 100, 4 / 3, 3, 3).length;
ok(n6 >= 6 && n6 <= 24, `6° zoom: ${n6} of 8192 level-6 tiles`);
ok(n5 >= 12 && n5 <= 64, `20° zoom: ${n5} of 2048 level-5 tiles`);
ok(n3 >= 20 && n3 < 128, `100° view: ${n3} of 128 level-3 tiles`);
ok(visibleTiles(yaw, pitch, 6, 4 / 3, 6, 3).every(t => t.level === 6), 'only the requested level is returned');

// completeness: every tile that contains a point inside the view is reported
{
  const level = 5, { cols, rows } = gridOf(level), vis = new Set(visibleTiles(yaw, pitch, 20, 4 / 3, level, 3).map(tileKey));
  let missed = 0, tested = 0;
  const tx = Math.tan(10 * Math.PI / 180);
  for (let sx = -0.95; sx <= 0.95; sx += 0.1) for (let sy = -0.95; sy <= 0.95; sy += 0.1) {
    // a ray through screen point (sx, sy) -> world direction -> map tile
    const d = [0, 1, 2].map(i => b.f[i] + sx * tx * (4 / 3) * b.r[i] + sy * tx * b.u[i]); const m = Math.hypot(...d);
    const { raH, decD } = raDecOf(d.map(x => x / m));
    const u = ((0.5 - raH / 24) % 1 + 1) % 1, v = (90 - decD) / 180;
    tested++; if (!vis.has(tileKey({ level, col: Math.min(cols - 1, Math.floor(u * cols)), row: Math.min(rows - 1, Math.floor(v * rows)) }))) missed++;
  }
  ok(missed === 0, `no on-screen point falls in a tile that was culled (${missed} of ${tested})`);
}
// near the poles and across the RA seam
for (const [raH, decD] of [[0, 89.5], [12, -89.5], [11.99, 0], [0.01, 30]]) {
  const v = yawPitchFor(raH, decD), vt = visibleTiles(v.yaw, v.pitch, 10, 16 / 9, 6, 3);
  ok(vt.length >= 2 && vt.length <= 512, `(${raH}h, ${decD}°): ${vt.length} tiles (the poles touch many thin tiles; hdtiles.js caps this)`);
}

ok(parentOf({ level: 6, col: 95, row: 29 }).col === 47 && parentOf({ level: 6, col: 95, row: 29 }).row === 14 && parentOf({ level: 6, col: 95, row: 29 }).level === 5, 'parent tile');
ok(tileKey({ level: 4, col: 3, row: 2 }) === '4/3_2', 'tile key matches the file layout 4/3_2.jpg');

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
