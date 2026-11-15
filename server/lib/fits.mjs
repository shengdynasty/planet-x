// Minimal FITS reader: headers, 2-D/3-D image HDUs (BITPIX 8/16/32/-32/-64, BSCALE/BZERO, big-endian),
// and fixed-width binary tables (TFORM nJ/nE/nD/nI/nK). Enough for SPHEREx L2 multi-extension files.

const BLOCK = 2880;

/** Parse one header starting at byte offset `off`. Returns {cards, kv, end} or null if END not found in buf. */
export function parseHeader(buf, off = 0) {
  const kv = {}; const cards = [];
  for (let i = off; i + BLOCK <= buf.length; i += BLOCK) {
    for (let k = 0; k < 36; k++) {
      const c = buf.toString('latin1', i + k * 80, i + k * 80 + 80);
      cards.push(c);
      const name = c.slice(0, 8).trim();
      if (name === 'END') return { cards, kv, end: i + BLOCK };
      let keyName = name, rest = null;
      if (c[8] === '=' && c[9] === ' ') rest = c.slice(10);
      else if (name === 'HIERARCH') { const m = c.slice(9).match(/^(.+?)\s*=\s*(.*)$/); if (m) { keyName = m[1].trim(); rest = m[2]; } }
      if (rest !== null && !(keyName in kv)) kv[keyName] = parseValue(rest);
    }
  }
  return null;
}

function parseValue(s) {
  s = s.trim();
  if (s.startsWith("'")) { const m = s.match(/^'((?:[^']|'')*)'/); return m ? m[1].replace(/''/g, "'").trimEnd() : s; }
  const v = s.split('/')[0].trim();
  if (v === 'T') return true;
  if (v === 'F') return false;
  const n = Number(v.replace(/D/i, 'E'));
  return v !== '' && Number.isFinite(n) ? n : v;
}

/** Bytes of data (unpadded) following a header. */
export function dataBytes(kv) {
  const naxis = kv.NAXIS | 0;
  if (!naxis) return 0;
  let n = 1; for (let a = 1; a <= naxis; a++) n *= kv['NAXIS' + a] | 0;
  return Math.abs(kv.BITPIX | 0) / 8 * (kv.GCOUNT || 1) * (n + (kv.PCOUNT || 0)); // FITS standard 4.4.1.1
}
export const padded = n => Math.ceil(n / BLOCK) * BLOCK;

/** Walk every HDU of a complete FITS buffer. */
export function listHDUs(buf) {
  const out = []; let off = 0;
  while (off + BLOCK <= buf.length) {
    const h = parseHeader(buf, off);
    if (!h) break;
    const n = dataBytes(h.kv);
    out.push({ index: out.length, kv: h.kv, headerStart: off, dataStart: h.end, dataBytes: n, name: h.kv.EXTNAME || (out.length ? '' : 'PRIMARY') });
    off = h.end + padded(n);
  }
  return out;
}

/** Read an image HDU into a Float64-valued Float32Array (row-major, NAXIS1 fastest). NaN for BLANK. */
export function readImage(buf, hdu) {
  const kv = hdu.kv, bp = kv.BITPIX | 0;
  const nx = kv.NAXIS1 | 0, ny = kv.NAXIS2 | 0, nz = kv.NAXIS >= 3 ? kv.NAXIS3 | 0 : 1;
  const n = nx * ny * nz, bs = kv.BSCALE ?? 1, bz = kv.BZERO ?? 0, blank = kv.BLANK;
  const out = new Float32Array(n), o = hdu.dataStart;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < n; i++) {
    let v;
    switch (bp) {
      case -32: v = dv.getFloat32(o + 4 * i, false); break;
      case -64: v = dv.getFloat64(o + 8 * i, false); break;
      case 16: v = dv.getInt16(o + 2 * i, false); if (v === blank) { out[i] = NaN; continue; } break;
      case 32: v = dv.getInt32(o + 4 * i, false); if (v === blank) { out[i] = NaN; continue; } break;
      case 8: v = dv.getUint8(o + i); if (v === blank) { out[i] = NaN; continue; } break;
      default: throw new Error('Unsupported BITPIX ' + bp);
    }
    out[i] = v * bs + bz;
  }
  return { nx, ny, nz, data: out };
}

/** Read a BITPIX 32 (or 16 / 8) integer image as an unsigned 32-bit bitmask, e.g. the SPHEREx FLAGS plane (no BSCALE/BZERO). */
export function readMask(buf, hdu) {
  const kv = hdu.kv, bp = kv.BITPIX | 0, nx = kv.NAXIS1 | 0, ny = kv.NAXIS2 | 0, n = nx * ny, o = hdu.dataStart;
  const out = new Uint32Array(n), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < n; i++) out[i] = bp === 32 ? dv.getInt32(o + 4 * i, false) >>> 0 : bp === 16 ? dv.getInt16(o + 2 * i, false) >>> 0 : bp === 8 ? dv.getUint8(o + i) : 0;
  return { nx, ny, data: out };
}

/** Read row `row` (0-based) of a binary table into {colName: number|number[]}. Supports J, E, D, I, K, B. */
export function readTableRow(buf, hdu, row = 0) {
  const kv = hdu.kv, nf = kv.TFIELDS | 0, width = kv.NAXIS1 | 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = hdu.dataStart + row * width; const out = {};
  const SZ = { J: 4, E: 4, D: 8, I: 2, K: 8, B: 1 };
  for (let f = 1; f <= nf; f++) {
    const m = String(kv['TFORM' + f]).trim().match(/^(\d*)([A-Z])/);
    const rep = m[1] === '' ? 1 : +m[1], code = m[2], sz = SZ[code];
    if (!sz) throw new Error('Unsupported TFORM ' + kv['TFORM' + f]);
    const vals = [];
    for (let i = 0; i < rep; i++) {
      const p = o + i * sz;
      vals.push(code === 'J' ? dv.getInt32(p, false) : code === 'E' ? dv.getFloat32(p, false) : code === 'D' ? dv.getFloat64(p, false)
        : code === 'I' ? dv.getInt16(p, false) : code === 'K' ? Number(dv.getBigInt64(p, false)) : dv.getUint8(p));
    }
    out[String(kv['TTYPE' + f]).trim()] = rep === 1 ? vals[0] : vals;
    o += rep * sz;
  }
  return out;
}

/** Find the first 2-D image HDU, preferring EXTNAME (default 'IMAGE'). */
export function findImageHDU(hdus, name = 'IMAGE') {
  return hdus.find(h => h.name.trim() === name && h.kv.NAXIS >= 2)
    || hdus.find(h => (h.index === 0 || String(h.kv.XTENSION).trim() === 'IMAGE') && h.kv.NAXIS === 2);
}

/**
 * RICE_1 decompression for FITS tile-compressed integer images (a port of CFITSIO's fits_rdecomp, the format IRSA uses
 * for the SPHEREx FLAGS plane): `n` values from `bytes`, as an Int32Array. `bytepix` 4, 2 or 1 (ZVAL of BYTEPIX),
 * `blocksize` the ZVAL of BLOCKSIZE (32). Throws when the stream ends before `n` values.
 */
export function riceDecompress(bytes, n, blocksize = 32, bytepix = 4) {
  const fsbits = bytepix === 1 ? 3 : bytepix === 2 ? 4 : 5, fsmax = bytepix === 1 ? 6 : bytepix === 2 ? 14 : 25, bbits = 1 << fsbits;
  const out = new Int32Array(n), len = bytes.length, shift = 32 - 8 * bytepix;
  let p = 0, lastpix = 0;
  const next = () => { if (p >= len) throw new Error('RICE stream ended early'); return bytes[p++]; };
  for (let k = 0; k < bytepix; k++) lastpix = (lastpix << 8) | next(); // the first value, uncoded
  let b = next(), nbits = 8;
  for (let i = 0; i < n;) {
    nbits -= fsbits;
    while (nbits < 0) { b = ((b << 8) | next()) >>> 0; nbits += 8; }
    const fs = (b >>> nbits) - 1;
    b &= (1 << nbits) - 1;
    const imax = Math.min(i + blocksize, n);
    if (fs < 0) { for (; i < imax; i++) out[i] = lastpix; } // low entropy: every difference zero
    else if (fs === fsmax) { // high entropy: each difference stored in bbits raw bits
      for (; i < imax; i++) {
        let k = bbits - nbits, diff = k >= 32 ? 0 : (b << k) >>> 0;
        for (k -= 8; k >= 0; k -= 8) { b = next(); diff = (diff | (b << k)) >>> 0; }
        if (nbits > 0) { b = next(); diff = (diff | (b >>> -k)) >>> 0; b &= (1 << nbits) - 1; } else b = 0;
        diff = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = shift ? ((diff + lastpix) << shift) >> shift : (diff + lastpix) | 0; out[i] = lastpix;
      }
    } else { // Rice coding: a unary high part, then fs low bits
      for (; i < imax; i++) {
        while (b === 0) { nbits += 8; b = next(); }
        const nzero = nbits - (32 - Math.clz32(b));
        nbits -= nzero + 1; b ^= 1 << nbits; nbits -= fs;
        while (nbits < 0) { b = ((b << 8) | next()) >>> 0; nbits += 8; }
        let diff = ((nzero << fs) | (b >>> nbits)) >>> 0;
        b &= (1 << nbits) - 1;
        diff = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = shift ? ((diff + lastpix) << shift) >> shift : (diff + lastpix) | 0; out[i] = lastpix;
      }
    }
  }
  return out;
}
