// Report link encoding: core report → JSON → deflate-raw → base64url → `#v=1&c=…`, and back.
// The hash is never sent to a server, so a report link works on static hosting and leaks nothing to it.
// Works in browsers and Node ≥ 18 (CompressionStream, btoa/atob). fromHash validates: a malformed or tampered link
// throws a ReportError with a readable message, never a half-built object.
import { REPORT_VERSION, ReportError, migrate, validate } from './schema.js';

export const MAX_LINK_CHARS = 8000; // refuse anything absurd before inflating it

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
function b64url(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ReportError('Report link is not valid: the data contains characters a link cannot have');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}

/** Core report → 'v=1&c=…' (without the leading #). Validates first, so a link is never made from a bad object. */
export async function toHash(core) {
  validate(core);
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(core)), new CompressionStream('deflate-raw'));
  return `v=${REPORT_VERSION}&c=${b64url(bytes)}`;
}

/** 'v=1&c=…' or '#v=1&c=…' (or a whole URL) → validated core report. Throws ReportError. */
export async function fromHash(hash) {
  let h = String(hash || ''); const at = h.indexOf('#'); if (at >= 0) h = h.slice(at + 1);
  if (!h) throw new ReportError('This page needs a report link: open it from a flagged source in the Field view (Report ↗).');
  if (h.length > MAX_LINK_CHARS) throw new ReportError('Report link is not valid: it is too long');
  const p = new URLSearchParams(h), v = p.get('v'), c = p.get('c');
  if (!c) throw new ReportError('Report link is not valid: the report data (c=…) is missing');
  if (v !== String(REPORT_VERSION)) throw new ReportError(`This report link uses format version ${v === null ? '(none)' : JSON.stringify(v)}, which this copy of Planet X cannot read (it reads version ${REPORT_VERSION}).`);
  let json;
  try { json = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(unb64url(c), new DecompressionStream('deflate-raw'))); }
  catch (e) { if (e instanceof ReportError) throw e; throw new ReportError('Report link is not valid: the data is damaged (it may have been cut off when it was copied)'); }
  let obj; try { obj = JSON.parse(json); } catch { throw new ReportError('Report link is not valid: the data is not a report'); }
  return validate(migrate(obj));
}
