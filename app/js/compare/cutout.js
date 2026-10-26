// Illustrative cutout generator from the UI demo: noise + field stars + the mover at its position for a scan.
// Pixels are synthetic (the UI says so); the mover's displacement follows the candidate's real track, exaggerated
// for slow movers so the shift is visible at cutout scale.
import { pipelineStatus, posIndex, posAt } from '../candidates/format.js';

function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 100000; }
const lcg = s => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W canvas size (square)
 * @param {{id:string, pos:Array<[number,number]|null>, status:string, pipelineStatus?:string}} c candidate
 * @param {number} scanId 1-based
 * @returns {[number, number, [number, number]|null, number]} mover x, y, position used (null if unobserved), index into pos
 */
export function renderCutout(ctx, W, c, scanId) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
  const r = lcg(1000 + hash(c.id));
  const rn = lcg(4000 + scanId);
  const img = ctx.createImageData(W, W);
  for (let i = 0; i < img.data.length; i += 4) { const v = 10 + rn() * 22; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * W, rad = (1.5 + r() * 3) * W / 256;
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.5); g2.addColorStop(0, 'rgba(255,255,255,0.95)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2; ctx.fillRect(x - rad * 3, y - rad * 3, rad * 6, rad * 6);
  }
  // pos has one entry per scan, null where unobserved: offsets are from the first observed position, and a scan
  // without one draws the field only
  const k = Math.max(0, posIndex(c, scanId)), a = (c.pos || []).find(Boolean), p = posAt(c, scanId);
  if (!a || !p) return [W / 2, W / 2, null, k];
  const scale = (pipelineStatus(c) === 'Matched' ? 18 : 600) * W / 256; // same rule as the panel cutout
  let dRa = p[0] - a[0]; if (dRa > 12) dRa -= 24; if (dRa < -12) dRa += 24;
  const dx = -dRa * 15 * Math.cos(a[1] * Math.PI / 180) * scale, dy = -(p[1] - a[1]) * scale;
  const lim = W * 0.35, x = W / 2 + Math.max(-lim, Math.min(lim, dx)), y = W / 2 + Math.max(-lim, Math.min(lim, dy));
  const rr = 9 * W / 256;
  const g3 = ctx.createRadialGradient(x, y, 0, x, y, rr); g3.addColorStop(0, '#fff'); g3.addColorStop(0.4, 'rgba(255,255,255,.9)'); g3.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g3; ctx.fillRect(x - rr * 1.5, y - rr * 1.5, rr * 3, rr * 3);
  return [x, y, p, k];
}
