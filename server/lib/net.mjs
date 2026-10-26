// Polite networking: disk cache, per-host concurrency limits, timeouts, one retry on 5xx/network error.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CACHE_DIR = process.env.PLANETX_CACHE || join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');
const UA = 'planet-x-spaceapps/0.1 (NASA Space Apps 2026 demo; low-rate, cached)';

// Per-host semaphores: IRSA 3 at a time, JPL 1 at a time (sb_ident is slow and shared).
const LIMITS = { 'irsa.ipac.caltech.edu': 3, 'ssd-api.jpl.nasa.gov': 1, 'ssd.jpl.nasa.gov': 2 };
const queues = new Map();
function sem(host) {
  if (!queues.has(host)) queues.set(host, { n: 0, max: LIMITS[host] || 2, wait: [] });
  return queues.get(host);
}
async function withHost(host, fn) {
  const q = sem(host);
  if (q.n >= q.max) await new Promise(res => q.wait.push(res));
  q.n++;
  try { return await fn(); } finally { q.n--; const next = q.wait.shift(); if (next) next(); }
}

/** Log of upstream requests (for timings in /api/health and the tests). */
export const upstreamLog = [];
function logReq(entry) { upstreamLog.push(entry); if (upstreamLog.length > 200) upstreamLog.shift(); if (process.env.PLANETX_QUIET !== '1') console.log(`[upstream] ${entry.status} ${entry.ms}ms ${entry.bytes}B ${entry.url.slice(0, 160)}`); }

const key = s => createHash('sha1').update(s).digest('hex');
const pathFor = (ns, k) => join(CACHE_DIR, ns, k.slice(0, 2), k);

async function cacheGet(ns, k, maxAgeMs) {
  try {
    const p = pathFor(ns, k);
    if (maxAgeMs) { const s = await stat(p); if (Date.now() - s.mtimeMs > maxAgeMs) return null; }
    return await readFile(p);
  } catch { return null; }
}
async function cachePut(ns, k, buf) {
  const p = pathFor(ns, k);
  await mkdir(dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  await writeFile(tmp, buf);
  await rename(tmp, p);
}

const inflight = new Map();

/**
 * GET a URL as a Buffer, through the disk cache.
 * @param {string} url
 * @param {{ns?:string, range?:string, timeoutMs?:number, maxAgeMs?:number, accept?:number[]}} [o]
 */
export async function fetchBuf(url, o = {}) {
  const ns = o.ns || 'http';
  const k = key(url + '|' + (o.range || ''));
  const hit = await cacheGet(ns, k, o.maxAgeMs);
  if (hit) return hit;
  if (inflight.has(k)) return inflight.get(k);
  const host = new URL(url).host;
  const p = withHost(host, async () => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const headers = { 'User-Agent': UA };
        if (o.range) headers.Range = o.range;
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(o.timeoutMs || 60000) });
        const buf = Buffer.from(await r.arrayBuffer());
        logReq({ url, status: r.status, ms: Date.now() - t0, bytes: buf.length, range: o.range || null });
        const ok = (o.accept || [200, 206]).includes(r.status);
        if (ok) { await cachePut(ns, k, buf); return buf; }
        lastErr = new Error(`${host} answered HTTP ${r.status}: ${buf.toString('utf8', 0, 300).replace(/\s+/g, ' ')}`);
        lastErr.status = r.status;
        if (r.status < 500) break; // 4xx: don't retry
      } catch (e) {
        logReq({ url, status: 'ERR', ms: Date.now() - t0, bytes: 0, range: o.range || null });
        lastErr = e;
      }
      await new Promise(res => setTimeout(res, 1500));
    }
    throw lastErr;
  });
  inflight.set(k, p);
  try { return await p; } finally { inflight.delete(k); }
}

/** JSON results we compute ourselves (e.g. per-field summaries), cached on disk. */
export async function memoJSON(ns, id, fn, maxAgeMs) {
  const k = key(id);
  const hit = await cacheGet(ns, k, maxAgeMs);
  if (hit) return JSON.parse(hit.toString('utf8'));
  const v = await fn();
  await cachePut(ns, k, Buffer.from(JSON.stringify(v)));
  return v;
}
export async function peekJSON(ns, id) {
  const hit = await cacheGet(ns, key(id));
  return hit ? JSON.parse(hit.toString('utf8')) : null;
}

/** Run fn over items with at most n in flight. */
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); } }));
  return out;
}
