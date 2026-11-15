// Report stamps: rebuild the field the report came from (no pixels travel in the link), then draw one cutout per epoch
// and the difference image, all on one shared stretch, each with an N/E compass and a scale bar.
// Simulated reports rebuild with simulateField(); real ones through the data module (saved snapshot or live server).
// If the frames can't be had (offline, no server, different data), rebuildField() throws and the page says so.

const STAMP_MIN = 21, STAMP_MAX = 71, PAD = 14; // stamp side in pixels: enough to hold the whole motion plus a margin

/** Rebuild the Field for a core report. Resolves to a Field whose epochs match the report's, or throws. */
export async function rebuildField(core) {
  const d = core.data;
  let field;
  if (d.sim) {
    const { simulateField } = await import('../pipeline/index.js');
    field = simulateField({ ra0: d.ra0, dec0: d.dec0 });
  } else {
    if (!d.req) throw new Error('the report does not say which field it came from');
    const data = await import('../data/index.js'), store = await import('../core/store.js');
    await data.initData(store);
    if (data.dataMode() === 'sim') throw new Error('no real SPHEREx data here (no saved field for this patch and no local data server)');
    field = await data.getField({ ra: d.req.ra, dec: d.req.dec, sizeArcsec: d.req.size ?? undefined, det: d.req.det ?? undefined, t: d.req.t ?? undefined, known: false });
    if (field.simulated) throw new Error(field.fallbackReason || 'the data source returned a simulated field');
  }
  if (field.N !== d.N || Math.abs(field.scale - d.scale) > 1e-3) throw new Error('the frames available here are not the ones the report was made from');
  for (const e of core.ep) {
    const fe = field.epochs[e.i];
    if (!fe || Math.abs(fe.band - e.band) > 1e-3 || (Number.isFinite(fe.mjd) && Math.abs(fe.mjd - e.mjd) > 1e-4)) throw new Error('the frames available here are not the ones the report was made from');
  }
  return field;
}

/** Robust level and spread of a set of values: median and 1.4826·MAD. */
function robust(vals) {
  const s = Float32Array.from(vals).sort(), med = s[s.length >> 1];
  const d = Float32Array.from(s, v => Math.abs(v - med)).sort();
  return { med, sig: Math.max(1.4826 * d[d.length >> 1], 1e-6) };
}
function cut(img, N, cx, cy, S) {
  const out = new Float32Array(S * S), x0 = Math.round(cx) - (S >> 1), y0 = Math.round(cy) - (S >> 1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const xx = x0 + x, yy = y0 + y; out[y * S + x] = xx < 0 || yy < 0 || xx >= N || yy >= N ? NaN : img[yy * N + xx]; }
  return { px: out, x0, y0 };
}

/**
 * Draw the stamps into `box` (emptied first). Returns a short description of the stretch for the caption below.
 * @param {HTMLElement} box  @param {object} core  @param {import('../core/types.js').Field} field  @param {(mjd:number)=>string} iso
 */
export function drawStamps(box, core, field, iso) {
  const ep = core.ep, N = field.N, scale = field.scale;
  const xs = ep.map(e => e.x), ys = ep.map(e => e.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let S = Math.max(STAMP_MIN, Math.ceil(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))) + 2 * PAD);
  S = Math.min(STAMP_MAX, S | 1);
  const cuts = ep.map(e => ({ e, ...cut(field.frame(e.i), N, cx, cy, S) }));
  // shared stretch: robust sky and noise over every stamp, asinh up to the brightest measured source
  const all = cuts.flatMap(c => [...c.px].filter(Number.isFinite)), { med, sig } = robust(all);
  const top = Math.max(10 * sig, ...ep.map(e => e.peak + med));
  const tone = v => { const u = Math.asinh(Math.max(v - med + 2 * sig, 0) / (2 * sig)) / Math.asinh((top - med + 2 * sig) / (2 * sig)); return Math.round(255 * Math.min(1, u)); };
  const stamps = cuts.map(c => ({ px: c.px, x0: c.x0, y0: c.y0, marks: [c.e], tone, label: `${c.e.role === 'ref' ? 'Reference' : 'Comparison'} · ${(c.e.lambda ?? c.e.band)} µm`, sub: iso(c.e.mjd).replace('T', ' ').replace('Z', ' UTC') }));
  if (cuts.length === 2) {
    const [a, b] = cuts, px = Float32Array.from(b.px, (v, k) => v - a.px[k]);
    const { sig: ds } = robust([...px].filter(Number.isFinite)), lim = Math.max(6 * ds, (top - med) * 0.6);
    stamps.push({ px, x0: a.x0, y0: a.y0, marks: [a.e, b.e], tone: v => Math.round(255 * Math.min(1, Math.max(0, 0.5 + v / (2 * lim)))), label: 'Difference', sub: 'comparison − reference' });
  }
  box.replaceChildren(...stamps.map(s => figure(s, S, scale)));
  return `Shared asinh stretch, sky ${med.toPrecision(3)} ± ${sig.toPrecision(2)} ${core.data.sim ? '(sim units)' : 'MJy/sr'}; difference on a symmetric scale (grey = no change). ${S}×${S} px, ${(S * scale / 60).toFixed(1)}′ across.`;
}

const ZOOM = 8;
function figure(s, S, scale) {
  const fig = document.createElement('figure'), cv = document.createElement('canvas'), cap = document.createElement('figcaption');
  const W = S * ZOOM; cv.width = W; cv.height = W;
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `${s.label} stamp, ${s.sub}, ${S} by ${S} pixels, north up, east left`);
  const g = cv.getContext('2d'), im = g.createImageData(S, S);
  for (let k = 0; k < S * S; k++) { const v = s.px[k], c = Number.isFinite(v) ? s.tone(v) : 40; im.data.set([c, c, c, 255], k * 4); }
  const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S; tmp.getContext('2d').putImageData(im, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, W, W);
  // overlays are sized to the stamp as displayed (u = one hundredth of its width), whatever its pixel count
  const u = W / 100;
  // tick marks at each measured position (gap in the middle, so the source stays visible)
  g.lineWidth = 1.6 * u;
  s.marks.forEach(e => { const x = (e.x - s.x0 + 0.5) * ZOOM, y = (e.y - s.y0 + 0.5) * ZOOM, a = 5 * u, b = 13 * u; g.strokeStyle = e.role === 'cmp' ? '#ffb000' : '#2ec4ff'; // reference blue, comparison amber
    g.beginPath(); g.moveTo(x - b, y); g.lineTo(x - a, y); g.moveTo(x, y - b); g.lineTo(x, y - a); g.stroke(); });
  // compass: north up, east left (the field grid is TAN with north up, east left)
  const ox = W - 8 * u, oy = 31 * u, L = 14 * u; g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 1.6 * u;
  g.font = `600 ${11 * u}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox, oy - L); g.moveTo(ox, oy); g.lineTo(ox - L, oy); g.stroke();
  g.fillText('N', ox, oy - L - 6 * u); g.fillText('E', ox - L - 7 * u, oy);
  // scale bar: the largest of 60/30/15/10″ that fits in 40 % of the width
  const bar = [60, 30, 15, 10].find(v => v / scale * ZOOM <= 0.4 * W) || 10, bw = bar / scale * ZOOM, by = W - 7 * u;
  g.fillRect(6 * u, by - u, bw, 2 * u); g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(`${bar}″`, 6 * u, by - 3 * u);
  const b = document.createElement('b'); b.textContent = s.label; cap.append(b, s.sub);
  fig.append(cv, cap); return fig;
}
