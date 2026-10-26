# Sky assets

| File | Size | Pixels | Use |
|---|---|---|---|
| `sky_4k.jpg` | 2,960,539 B (2.8 MiB) | 4096 × 2048 | desktop backdrop |
| `sky_2k.jpg` | 738,661 B (0.7 MiB) | 2048 × 1024 | phones / low memory |

Equirectangular (plate carrée), **celestial (ICRF/J2000 equatorial) coordinates**, sRGB JPEG.

## Source and credit

- Source: NASA SVS, *Deep Star Maps 2020*, ID 4851, https://svs.gsfc.nasa.gov/4851/
  (file `starmap_2020_4k.exr`, 4096 × 2048, half-float linear OpenEXR, downloaded 2026-10-25).
- **Credit line (as requested on the SVS page), show it in the app's about/credits:**
  > NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.
- Licence: the SVS page points to the NASA media usage guidelines
  (https://www.nasa.gov/multimedia/guidelines/index.html): NASA-produced imagery is generally not subject to
  copyright and may be used for educational/informational purposes with credit, and must not imply NASA endorsement.
  The map is built partly from ESA Gaia DR2 data, so keep the `ESA/Gaia/DPAC` credit as well.

## How the files were made (macOS `sips` only)

```sh
sips -s format tiff -m "/System/Library/ColorSync/Profiles/sRGB Profile.icc" starmap_2020_4k.exr --out srgb_4k.tif  # linear -> sRGB
sips -s format jpeg -s formatOptions 75 srgb_4k.tif --out sky_4k.jpg            # q85 was 3.6 MB; q75 fits the 3 MB budget
sips -z 1024 2048 srgb_4k.tif --out srgb_2k.tif
sips -s format jpeg -s formatOptions 85 srgb_2k.tif --out sky_2k.jpg
```

The EXR is linear light; converting straight to JPEG keeps linear values (with a "Linear" profile that WebGL ignores)
and looks far too dark, so the sRGB conversion step matters. Load the JPEG with `texture.encoding = THREE.sRGBEncoding`.

## Map convention (from the SVS page, confirmed against the image)

"The map is centered at 0h right ascension, and r.a. increases to the left." So, with `u` from the left edge
(0..1) and `v` from the top (0..1):

```
RA  = ((0.5 - u) * 24 + 24) % 24   hours     (u = 0.5 -> 0h; left edge u = 0 -> 12h; right edge -> 12h)
Dec = 90 - 180 * v                  degrees   (top = +90, north up)
```

(The RA = 12h seam is at the left/right edges; LMC sits at u ≈ 0.275, v ≈ 0.89.)

## Transform the sky module must use (three.js r128)

three.js `SphereGeometry` puts texture `u` at direction `(-cos 2πu, ·, sin 2πu)`; the app's `toVec()` puts RA at
`(cos ra, ·, -sin ra)`. With this map that is a mirror in z, so keep the existing `rotation.y = Math.PI` and add
`scale.x = -1`:

```js
function setBackdrop(tex) {
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.encoding = THREE.sRGBEncoding;
  if (!backdrop) {
    backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(800, 64, 48),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide }));
    backdrop.rotation.y = Math.PI;   // keep
    backdrop.scale.x = -1;           // NEW: un-mirror so the texture matches toVec(raHours, decDeg)
    scene.add(backdrop);
  } else {
    backdrop.material.map.dispose(); backdrop.material.map = tex; backdrop.material.needsUpdate = true;
  }
}
// pick the file:
const skyUrl = (Math.min(screen.width, screen.height) < 768 || renderer.capabilities.maxTextureSize < 4096)
  ? 'assets/sky_2k.jpg' : 'assets/sky_4k.jpg';
new THREE.TextureLoader().load(skyUrl, setBackdrop);
```

Notes:
- No `texture.offset`/`repeat`, no `flipY` change. Equivalent: `rotation.y = 0; scale.z = -1`.
- r128 flips the face winding automatically when the world matrix has a negative determinant, so `BackSide` still
  draws the inside of the sphere (verified below).
- Without `scale.x = -1` (the ui-demo's current code) the sky is mirrored east-west: the markers don't match the stars
  (see `orion_legacy.png`).
- The procedural sky (`proceduralSky()`) isn't tied to real coordinates, so the flip does no harm there.

## Verification

`app/dev/assets.html` (three.js r128 from cdnjs) builds the same sphere, puts the camera at the centre and draws green
rings at `toVec(ra, dec)` for bright stars with known J2000 coordinates. Query params: `ra`, `dec`, `fov`,
`mode=fixed|legacy`, `img=sky_4k|sky_2k`. Example: `http://127.0.0.1:8105/app/dev/assets.html?ra=5.6&dec=-2&fov=40`.

Headless screenshots (playwright-core + Chrome/SwiftShader, 1200×800), stored in the scratchpad rather than git:
`/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad/assets-shots/`

| Shot | Result with the transform above |
|---|---|
| `orion_fixed.png` | Betelgeuse, Rigel, Alnitak/Alnilam/Mintaka, Sirius, Aldebaran all ringed on their stars; Betelgeuse upper-left of the belt and Rigel lower-right, the correct handedness for a view from inside |
| `orion_legacy.png` | old transform (`rotation.y = π` only): Orion appears mirrored, rings miss everything |
| `vega_fixed.png` | Vega, Deneb, Altair (Summer Triangle) on the Milky Way |
| `polaris_fixed.png` | Polaris, Capella |
| `pleiades_fixed.png` | Pleiades cluster, Aldebaran in the Hyades |
| `lmc_fixed.png` | LMC, SMC, Achernar |
| `seam_fixed.png` | Regulus, Denebola, Spica across the RA = 12h seam; no visible seam |
| `orion_2k.png` | same Orion check with `sky_2k.jpg` |

`tests/assets.test.mjs` (`node --test tests/assets.test.mjs`) checks the JPEG dimensions and size budgets.
