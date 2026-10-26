#!/usr/bin/env node
// Planet X local data server: real SPHEREx data from NASA/IPAC IRSA + JPL small-body identification.
// Node >= 20, zero npm dependencies.  Run:  node server/index.mjs   (PORT env var, default 8787)
import http from 'node:http';
import zlib from 'node:zlib';
import { scansAt, buildField, knownAt } from './lib/field.mjs';
import { COLLECTIONS, SIA_URL } from './lib/irsa.mjs';
import { SB_IDENT } from './lib/jpl.mjs';
import { CACHE_DIR, upstreamLog, peekJSON, memoJSON } from './lib/net.mjs';

const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = '0.1.0';
// Default "home" field for the app's live mode: Taurus near the ecliptic (the Moving Sky demo's field centre).
export const HOME = { ra: 70.42, dec: 19.18, size: 120 };

const ORIGIN_OK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function send(req, res, status, body, extraHeaders = {}) {
  const origin = req.headers.origin;
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin', ...extraHeaders };
  if (origin && ORIGIN_OK.test(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Methods'] = 'GET, OPTIONS'; h['Access-Control-Allow-Headers'] = 'Content-Type'; }
  let buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  if (buf.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h); res.end(buf);
}

function num(sp, name, { required = true, min = -Infinity, max = Infinity } = {}) {
  const raw = sp.get(name);
  if (raw === null || raw === '') { if (required) throw Object.assign(new Error(`Missing parameter ${name}`), { status: 400 }); return undefined; }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max) throw Object.assign(new Error(`Bad parameter ${name}=${raw}`), { status: 400 });
  return v;
}
const pos = sp => ({ ra: num(sp, 'ra', { min: 0, max: 360 }), dec: num(sp, 'dec', { min: -90, max: 90 }) });

// Live candidates = known small bodies JPL predicts inside the home field at the frame times (real, not detections).
// Built in the background because the first sb_ident queries take tens of seconds each.
const pending = new Map();
async function candidatesFor(ra, dec, size) {
  const id = JSON.stringify(['cands-v1', ra, dec, size]);
  const hit = await peekJSON('cands', id);
  if (hit) return hit;
  if (!pending.has(id)) {
    pending.set(id, memoJSON('cands', id, async () => {
      const f = await buildField({ ra, dec, size });
      const scanIds = [...new Set(f.epochs.map(e => e.scan))];
      const cands = f.known.map((k, n) => {
        const perScan = scanIds.map(s => k.samples.find(sm => f.epochs[sm.i].scan === s)).filter(Boolean);
        const pos = perScan.map(sm => { const ra = f.ra0 - (sm.x - f.N / 2) * f.scale / 3600 / Math.cos(f.dec0 * Math.PI / 180); const dec = f.dec0 - (sm.y - f.N / 2) * f.scale / 3600; return [+(ra / 15).toFixed(6), +dec.toFixed(6)]; });
        return {
          id: 'k' + String(n + 1).padStart(2, '0'), name: k.name, tag: `Known small body · ${k.name}`, status: 'Matched', pipelineStatus: 'Matched',
          band: `${f.band} µm`, pos, scans: perScan.map(sm => f.epochs[sm.i].scan), match: k.name, simulated: false,
          note: `JPL predicts this catalogued object inside the ${Math.round(f.sizeArcsec)}″ field (V≈${k.vmag ?? '?'}). This is an ephemeris prediction, not a confirmed pixel detection.`,
        };
      });
      return { ra, dec, size, field: { N: f.N, epochs: f.epochs.length }, knownStatus: f.knownStatus, candidates: cands };
    }).finally(() => pending.delete(id)));
    pending.get(id).catch(e => console.error('[candidates]', e.message));
  }
  return { ra, dec, size, pending: true, candidates: [] };
}

const routes = {
  '/api/health': async () => ({
    ok: true, service: 'planet-x-data', version: VERSION, node: process.version, time: new Date().toISOString(),
    upstream: { sia: SIA_URL, collections: COLLECTIONS, sbIdent: SB_IDENT }, cacheDir: CACHE_DIR, home: HOME,
    recentUpstream: upstreamLog.slice(-10),
  }),
  '/api/scans': async sp => {
    const { ra, dec } = pos(sp);
    return scansAt(ra, dec, { det: num(sp, 'det', { required: false, min: 1, max: 6 }) });
  },
  '/api/field': async sp => {
    const { ra, dec } = pos(sp);
    return buildField({
      ra, dec, size: num(sp, 'size', { required: false, min: 20, max: 600 }) ?? 120,
      det: num(sp, 'det', { required: false, min: 1, max: 6 }), lam: num(sp, 'lam', { required: false, min: 0.7, max: 5.1 }),
      perEpoch: num(sp, 'per', { required: false, min: 1, max: 4 }), known: sp.get('known') !== '0',
      mjd: num(sp, 't', { required: false, min: 60000, max: 70000 }),
    });
  },
  '/api/known': async sp => {
    const { ra, dec } = pos(sp);
    const t = sp.get('t'); if (!t) throw Object.assign(new Error('Missing parameter t (MJD or ISO date)'), { status: 400 });
    return knownAt(ra, dec, t, num(sp, 'r', { required: false, min: 10, max: 3600 }) ?? 120);
  },
  '/api/candidates': async sp => {
    const ra = num(sp, 'ra', { required: false, min: 0, max: 360 }) ?? HOME.ra, dec = num(sp, 'dec', { required: false, min: -90, max: 90 }) ?? HOME.dec;
    return candidatesFor(ra, dec, num(sp, 'size', { required: false, min: 20, max: 600 }) ?? HOME.size);
  },
};

export function createServer() {
  return http.createServer(async (req, res) => {
    const t0 = Date.now();
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(req, res, 204, '');
    if (req.method !== 'GET') return send(req, res, 405, { error: 'GET only' });
    const fn = routes[u.pathname];
    if (!fn) return send(req, res, 404, { error: 'Not found', endpoints: Object.keys(routes) });
    try {
      const body = await fn(u.searchParams);
      send(req, res, 200, body, { 'Server-Timing': `total;dur=${Date.now() - t0}` });
    } catch (e) {
      console.error(`[${u.pathname}]`, e.message);
      send(req, res, e.status || 502, { error: e.message });
    } finally {
      if (process.env.PLANETX_QUIET !== '1') console.log(`${req.method} ${u.pathname}${u.search} ${Date.now() - t0}ms`);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server/index.mjs')) {
  createServer().listen(PORT, HOST, () => console.log(`Planet X data server on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}  (cache: ${CACHE_DIR})`));
}
