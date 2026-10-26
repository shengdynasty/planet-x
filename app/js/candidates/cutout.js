// Placeholder cutout, ported from the UI demo's renderCutout. Deterministic: the star field depends only on the
// candidate (seed from its id), the noise only on the scan, so redrawing gives identical pixels.
import { pipelineStatus, posIndex, posAt } from './format.js';

/** Seed index used by the demo (0 for c01, 1 for c02, …); string hash for non-numeric ids. */
export function seedIndex(id) {
  const m = String(id).match(/(\d+)$/);
  if (m) return Math.max(0, +m[1] - 1);
  let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
}

/** Draws into ctx (W×W). Returns [x, y, pos, k] — the mover's pixel position, sky position (null if unobserved) and epoch index. */
export function renderCutout(ctx, W, m, scanId, mi) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
  let s = 1000 + mi * 7; const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const img = ctx.createImageData(W, W); let t = 4000 + scanId; const rn = () => { t = (t * 16807) % 2147483647; return (t - 1) / 2147483646; };
  for (let i = 0; i < img.data.length; i += 4) { const v = 10 + rn() * 22; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * W, rad = (1.5 + r() * 3) * W / 256;
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.5);
    g2.addColorStop(0, 'rgba(255,255,255,0.95)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2; ctx.fillRect(x - rad * 3, y - rad * 3, rad * 6, rad * 6);
  }
  // pos has one entry per scan, null where the mover was not observed: offsets are from the first observed position
  const k = Math.max(0, posIndex(m, scanId)), a = (m.pos || []).find(Boolean), p = posAt(m, scanId);
  if (!a || !p) return [W / 2, W / 2, null, k]; // not observed in this scan: field only, no mover
  const scale = (pipelineStatus(m) === 'Matched' ? 18 : 600) * W / 256; // slow movers exaggerated so the shift is visible
  const dx = -(p[0] - a[0]) * 15 * Math.cos(a[1] * Math.PI / 180) * scale, dy = -(p[1] - a[1]) * scale;
  const lim = W * 0.35, x = W / 2 + Math.max(-lim, Math.min(lim, dx)), y = W / 2 + Math.max(-lim, Math.min(lim, dy));
  const rr = 9 * W / 256; const g3 = ctx.createRadialGradient(x, y, 0, x, y, rr);
  g3.addColorStop(0, '#fff'); g3.addColorStop(0.4, 'rgba(255,255,255,.9)'); g3.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g3; ctx.fillRect(x - rr * 1.5, y - rr * 1.5, rr * 3, rr * 3);
  return [x, y, p, k];
}
