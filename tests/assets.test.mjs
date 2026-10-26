// node --test tests/assets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const root = new URL('../app/assets/', import.meta.url);

// Read width/height from the first JPEG SOFn marker.
function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'not a JPEG');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

for (const [name, w, h, maxBytes] of [['sky_4k.jpg', 4096, 2048, 3_000_000], ['sky_2k.jpg', 2048, 1024, 1_000_000]]) {
  test(`${name} is ${w}x${h} and <= ${maxBytes} bytes`, () => {
    const url = new URL(name, root);
    assert.ok(statSync(url).size <= maxBytes);
    assert.deepEqual(jpegSize(readFileSync(url)), { w, h });
  });
}
