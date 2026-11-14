// node tests/aladin.test.mjs — Other telescopes chips: pure helpers, wiring into the Field view, and no vendored Aladin.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { SURVEYS, SIMBAD, fovDeg, footprint, normRa, isTarget, aladinUrl, describe, surveyById, DEFAULT_STAMP_ARCSEC } from '../app/js/aladin/geom.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = (name, fn) => { fn(); n++; };

t('surveys: DSS2, 2MASS, AllWISE from the IRSA mirror, with CDS ids for links and dates', () => {
  assert.deepEqual(SURVEYS.map(s => s.label), ['DSS2', '2MASS', 'AllWISE']);
  assert.deepEqual(SURVEYS.map(s => s.dates), ['1980s–90s', '1997–2001', '2010–2011']);
  for (const s of SURVEYS) { assert.match(s.hips, /^https:\/\/irsa\.ipac\.caltech\.edu\/data\/hips\/CDS\//); assert.match(s.cds, /^P\//); }
  assert.equal(SIMBAD.label, 'SIMBAD');
  assert.equal(surveyById('nope').id, SURVEYS[0].id);
});

t('fov: 2.5× the stamp, clamped to 2′–1°', () => {
  assert.ok(Math.abs(fovDeg(93) - 93 * 2.5 / 3600) < 1e-12);
  assert.equal(fovDeg(1), 2 / 60);
  assert.equal(fovDeg(1e9), 1);
  assert.equal(fovDeg(undefined), fovDeg(DEFAULT_STAMP_ARCSEC));
});

t('footprint: square around the centre, RA stretched by 1/cos(dec), wraps at 0h', () => {
  const f = footprint(10, 60, 3600), ras = f.map(p => p[0]), decs = f.map(p => p[1]);
  assert.ok(Math.abs(Math.max(...decs) - 60.5) < 1e-9 && Math.abs(Math.min(...decs) - 59.5) < 1e-9);
  assert.ok(Math.abs((Math.max(...ras) - Math.min(...ras)) - 1 / Math.cos(Math.PI / 3)) < 1e-9);
  const w = footprint(0.01, 0, 360);
  assert.ok(w.every(p => p[0] >= 0 && p[0] < 360) && w.some(p => p[0] > 359));
  assert.ok(footprint(0, 89.99, 3600).every(p => p[1] <= 90));
});

t('normRa / isTarget / links / labels', () => {
  assert.equal(normRa(-10), 350); assert.equal(normRa(370), 10);
  assert.ok(isTarget({ ra: 1, dec: 2 })); assert.ok(!isTarget({ ra: 1, dec: 95 })); assert.ok(!isTarget(null));
  const u = new URL(aladinUrl({ ra: 269.4463, dec: 4.7682, stampArcsec: 93 }, 'dss2'));
  assert.equal(u.hostname, 'aladin.cds.unistra.fr');
  assert.equal(u.searchParams.get('survey'), 'P/DSS2/color');
  assert.equal(u.searchParams.get('target'), '269.44630 4.76820');
  assert.match(describe({ ra: 269.4463, dec: 4.7682, stampArcsec: 93 }), /^RA 269\.4463°, Dec \+4\.7682° · 3\.9′ view$/);
  assert.equal(describe(null), 'No position yet');
});

t('wired into the Field view vetting section, not a floating panel', () => {
  const field = readFileSync(join(ROOT, 'app/js/field/index.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'app/index.html'), 'utf8');
  const main = readFileSync(join(ROOT, 'app/js/main.js'), 'utf8');
  const vet = field.slice(field.indexOf('class="fv-vet"'), field.indexOf('class="fv-actions"'));
  assert.ok(vet.includes('data-ref="other"'), 'vetting section has the Other telescopes mount');
  assert.ok(field.includes("import('../aladin/index.js')"), 'field view lazy-loads the module');
  assert.ok(/updateOther\(ra, dec\)/.test(field), 'renderVet updates the target');
  assert.ok(html.includes('href="css/aladin.css"'));
  assert.ok(!html.includes('aladin-panel') && !main.includes('aladin'), 'no floating panel left over');
});

t('viewer host has an explicit size (Aladin forces position:relative, which voids inset:0)', () => {
  const css = readFileSync(join(ROOT, 'app/css/aladin.css'), 'utf8');
  const rule = (css.match(/\.ot-aladin\s*\{([^}]*)\}/) || [])[1] || '';
  assert.match(rule, /(^|;)\s*width:\s*100%/, '.ot-aladin width: 100%');
  assert.match(rule, /(^|;)\s*height:\s*100%/, '.ot-aladin height: 100%');
  assert.match(css, /\.ot-view\s*\{[^}]*aspect-ratio/, '.ot-view keeps a definite height');
});

t('Aladin Lite (GPL-3.0) is not vendored: only loaded from the CDS CDN', () => {
  const files = []; const walk = d => { for (const f of readdirSync(d)) { if (['node_modules', '.git', '.cache'].includes(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(ROOT);
  const named = files.filter(p => /aladin/i.test(p.split('/').pop()) && /\.(js|mjs|wasm)$/.test(p) && !/app\/js\/aladin\/(index|geom)\.js$|tests\/aladin\.test\.mjs$/.test(p));
  assert.deepEqual(named.map(p => relative(ROOT, p)), [], 'no Aladin library files in the repo');
  const src = readFileSync(join(ROOT, 'app/js/aladin/index.js'), 'utf8');
  assert.ok(src.includes("'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js'"), 'CDS script as fallback');
  assert.ok(src.includes('https://cdn.jsdelivr.net/npm/aladin-lite@${ALADIN_VERSION}/dist/aladin.js'), 'npm build from jsDelivr first');
  assert.match(src, /ALADIN_VERSION = '\d+\.\d+\.\d+'/, 'pinned to an exact stable version');
  assert.ok(src.length < 20000, 'our module is small; the library is not inlined');
});

console.log(`aladin: ${n}/${n} passed`);
