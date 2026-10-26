// Canvas drawing for the field view: false-colour imagery, stamps, and the marker overlay.
// Imagery keeps Moving Sky's colour maps; markers differ by shape and dash and carry text labels,
// so colour is never the only cue.
import { stats } from '../pipeline/index.js';

export const INF = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
export const DIV = [[33, 102, 172], [146, 197, 222], [40, 40, 44], [244, 165, 130], [178, 24, 43]];
export function cmap(stops, v) { v = Math.min(Math.max(v, 0), 1) * (stops.length - 1); const i = Math.min(v | 0, stops.length - 2), f = v - i; const a = stops[i], b = stops[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }

/** Paint an N×N image into an N×N canvas (CSS scales it, pixelated). Asinh stretch on inferno, or diverging for differences. */
export function drawImage(canvas, img, N, diverging, stretch) {
  if (canvas.width !== N) { canvas.width = canvas.height = N; }
  const g = canvas.getContext('2d'), idata = g.createImageData(N, N), d = idata.data;
  const { med, sig } = stats(img);
  if (diverging) { const lim = 6 * sig * stretch; for (let p = 0; p < N * N; p++) { const c = cmap(DIV, 0.5 + img[p] / (2 * lim)); d[p * 4] = c[0]; d[p * 4 + 1] = c[1]; d[p * 4 + 2] = c[2]; d[p * 4 + 3] = 255; } }
  else { const lo = med - 2 * sig, hi = med + 40 * sig / stretch, k = 4;
    for (let p = 0; p < N * N; p++) { let v = (img[p] - lo) / (hi - lo); v = Math.asinh(Math.max(v, 0) * k) / Math.asinh(k); const c = cmap(INF, v); d[p * 4] = c[0]; d[p * 4 + 1] = c[1]; d[p * 4 + 2] = c[2]; d[p * 4 + 3] = 255; } }
  g.putImageData(idata, 0, 0);
}

/** 15×15 cutout around (cx, cy). */
export function drawStamp(canvas, img, N, cx, cy) {
  const g = canvas.getContext('2d'), id = g.createImageData(15, 15); const { med, sig } = stats(img);
  for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) { const x = Math.round(cx) - 7 + i, y = Math.round(cy) - 7 + j;
    const v = (x < 0 || y < 0 || x >= N || y >= N) ? med : img[y * N + x]; let n = (v - med) / (12 * sig); n = Math.asinh(Math.max(n, 0) * 4) / Math.asinh(4);
    const col = cmap(INF, n), p = (j * 15 + i) * 4; id.data[p] = col[0]; id.data[p + 1] = col[1]; id.data[p + 2] = col[2]; id.data[p + 3] = 255; }
  g.putImageData(id, 0, 0);
}

// Marker styles: hue + shape + dash + label. Colours are part of the imagery layer.
export const MARK = {
  cand:  { col: '#ffffff', shape: 'circle',  dash: [],     label: 'Candidate' },
  known: { col: '#79e0ec', shape: 'square',  dash: [],     label: 'Known' },
  var:   { col: '#cdb0ff', shape: 'diamond', dash: [],     label: 'Variable' },
  art:   { col: '#b4b4b4', shape: 'cross',   dash: [3, 3], label: 'Artifact' },
  left:  { col: '#79e0ec', shape: 'circle',  dash: [2, 3], label: 'Left field' },
};
export const KIND_NAME = { cand: 'Candidate', known: 'Known object', var: 'Variable', art: 'Artifact', left: 'Left the field' };

function shape(g, kind, x, y, r) {
  g.beginPath();
  const s = MARK[kind].shape;
  if (s === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
  else if (s === 'square') { const h = r * 0.88; g.rect(x - h, y - h, 2 * h, 2 * h); }
  else if (s === 'diamond') { g.moveTo(x, y - r * 1.15); g.lineTo(x + r * 1.15, y); g.lineTo(x, y + r * 1.15); g.lineTo(x - r * 1.15, y); g.closePath(); }
  else { g.arc(x, y, r, 0, Math.PI * 2); const h = r * 0.55; g.moveTo(x - h, y - h); g.lineTo(x + h, y + h); g.moveTo(x + h, y - h); g.lineTo(x - h, y + h); }
}

/** Inline SVG glyph matching the canvas marker shape (UI uses currentColor: grey, never colour-only). */
export function glyph(kind) {
  const m = MARK[kind], d = m.dash.length ? ` stroke-dasharray="${m.dash.map(v => v * 0.8).join(' ')}"` : '';
  const body = m.shape === 'circle' ? `<circle cx="8" cy="8" r="5.5"${d}/>`
    : m.shape === 'square' ? `<rect x="3" y="3" width="10" height="10"${d}/>`
    : m.shape === 'diamond' ? `<path d="M8 1.8 14.2 8 8 14.2 1.8 8Z"${d}/>`
    : `<circle cx="8" cy="8" r="5.5"${d}/><path d="M5 5l6 6M11 5l-6 6"/>`;
  return `<svg class="fv-glyph${kind === 'cand' ? ' fill' : ''}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">${body}</svg>`;
}

function label(g, text, x, y, col, fs) {
  g.font = `600 ${fs}px Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
  g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = Math.max(3, fs * 0.32); g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, x, y);
  g.fillStyle = col; g.fillText(text, x, y);
}

/**
 * Draw markers onto the overlay canvas (sized to the displayed image × devicePixelRatio).
 * opts: {N, results, selected, showMarks, showKnown, knownPts: [[x,y],...]}
 */
export function drawOverlay(canvas, o) {
  const g = canvas.getContext('2d'), W = canvas.width, dpr = o.dpr || 1, css = W / dpr;
  g.clearRect(0, 0, W, W);
  const S = W / o.N, P = (v) => (v + 0.5) * S;
  const k = Math.max(0.75, Math.min(1.25, css / 640)) * dpr;   // marker scale: readable on phones, not huge on big screens
  const fs = Math.round(11 * Math.max(0.95, Math.min(1.15, css / 640)) * dpr);
  if (o.showKnown) for (const [x, y] of o.knownPts) {
    if (x < -5) continue; g.setLineDash([4 * k, 4 * k]); g.lineWidth = 1.5 * k; g.strokeStyle = MARK.known.col;
    g.beginPath(); g.arc(P(x), P(y), 14 * k, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    label(g, 'Ephemeris', P(x) - 14 * k, P(y) + 22 * k, MARK.known.col, fs);
  }
  if (!o.showMarks) return;
  for (const r of o.results) {
    const m = MARK[r.kind], rr = (r.kind === 'cand' ? 11 : 9) * k;
    g.strokeStyle = m.col; g.lineWidth = (r.kind === 'cand' ? 2.2 : 1.8) * k;
    if (r.from && r.to && r.kind !== 'var') {
      g.setLineDash([2 * k, 4 * k]); g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(P(r.from.x), P(r.from.y)); g.lineTo(P(r.to.x), P(r.to.y)); g.stroke();
      g.setLineDash([2 * k, 2 * k]); g.beginPath(); g.arc(P(r.from.x), P(r.from.y), 5 * k, 0, Math.PI * 2); g.stroke(); g.lineWidth = (r.kind === 'cand' ? 2.2 : 1.8) * k;
    }
    g.setLineDash(m.dash.map(v => v * k)); shape(g, r.kind, P(r.x), P(r.y), rr); g.stroke(); g.setLineDash([]);
    if (r === o.selected) { g.lineWidth = 1.5 * k; g.strokeStyle = '#fff'; g.beginPath(); g.arc(P(r.x), P(r.y), 19 * k, 0, Math.PI * 2); g.stroke(); }
    const lx = P(r.x) + rr + 5 * k, flip = lx + 70 * k > W;   // keep labels inside the image
    g.textAlign = flip ? 'right' : 'left';
    label(g, m.label, flip ? P(r.x) - rr - 5 * k : lx, P(r.y) - rr * 0.6, m.col, fs);
    g.textAlign = 'left';
  }
}
