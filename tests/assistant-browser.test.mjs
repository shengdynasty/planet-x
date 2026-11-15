// In-app helper end to end: headless Chrome against app/index.html with the saved snapshots (the hosted copy).
//   PORT=8160 node tests/assistant-browser.test.mjs
// Opens the panel, asks by chip and by typing, runs actions, checks Esc and focus, phone width, dark mode,
// reduced motion and Simple mode, and that no page errors happen. Screenshots go to the scratchpad.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, SCRATCH } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8160), URL_ = `http://127.0.0.1:${PORT}/app/`;
const SHOTS = path.join(SCRATCH, 'shots', 'assistant');
mkdirSync(SHOTS, { recursive: true });

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); } }

const server = await serve(PORT, ROOT);
const browser = await launch();
process.on('exit', () => { try { server && server.kill(); } catch {} });

async function open({ width = 1440, height = 900, scheme = 'dark', mobile = false, reduced = false, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  // hosted configuration: no live server, so the saved snapshots are used
  await ctx.route(/(localhost|127\.0\.0\.1):8787/, r => r.abort());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED|GL Driver/.test(m.text())) errors.push(m.text()); });
  await page.goto(URL_ + query);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30000 });
  return { ctx, page, errors };
}
const lastAnswer = page => page.evaluate(() => { const a = [...document.querySelectorAll('#assistant .as-a[data-answer]')].pop(); return a ? { id: a.dataset.answer, text: a.textContent } : null; });
const ask = async (page, q) => { await page.fill('#assistant .as-form input', q); await page.press('#assistant .as-form input', 'Enter'); await page.waitForTimeout(150); };
const panelText = page => page.evaluate(() => document.getElementById('assistant').textContent);

console.log('desktop 1440×900, dark');
{
  const { ctx, page, errors } = await open();
  ok(await page.evaluate(() => window.__pxBoot.modules.assistant) === 'module', 'assistant module mounted');
  ok(await page.isVisible('#ask') && !(await page.isVisible('#assistant')), 'Ask button in the top bar, panel closed');
  await page.click('#ask');
  ok(await page.isVisible('#assistant') && await page.evaluate(() => document.activeElement.matches('#assistant .as-form input')), 'opens with focus in the question box');
  ok(await page.getAttribute('#ask', 'aria-expanded') === 'true', 'button says the panel is expanded');
  ok(await page.locator('#assistant .as-chip').count() >= 3, 'suggested questions shown as chips');

  await page.locator('#assistant .as-chip', { hasText: 'How does parallax find it?' }).click(); await page.waitForTimeout(150);
  { const a = await lastAnswer(page); ok(a && a.id === 'parallax' && /825″/.test(a.text), 'chip answers from the knowledge base'); }
  await ask(page, 'could spherex see planet nine');
  { const a = await lastAnswer(page); ok(a && a.id === 'planet9' && /below SPHEREx’s single-exposure depth/.test(a.text), 'typed question answered, limit stated plainly'); }
  await ask(page, 'What is the capital of France?');
  { const a = await lastAnswer(page); ok(a && a.id === 'fallback' && /won’t guess/.test(a.text), 'uncovered question gets the honest fallback'); }
  await ask(page, 'What does the badge mean?');
  { const a = await lastAnswer(page); ok(a && /reads Saved SPHEREx data/.test(a.text), 'badge answer names the current source (saved)'); }

  // action: open an example field
  await ask(page, 'Show me 16 Psyche');
  await page.locator('#assistant .as-a').last().locator('button', { hasText: 'Field: 16 Psyche' }).click();
  await page.waitForTimeout(300);
  { const f = await page.evaluate(() => window.__px.get('field')), v = await page.evaluate(() => window.__px.get('view'));
    ok(v === 'field' && f && Math.abs(f.ra - 70.2635) < 1e-6 && f.det === 3 && f.sizeArcsec === 300, `action opens the example field (${v}, ra ${f && f.ra})`); }
  ok(await page.isVisible('#assistant'), 'panel stays open on a wide screen');
  ok(await page.locator('#assistant .as-chip', { hasText: 'What is the Field view?' }).count() === 1, 'chips follow the view');
  // action: fly the sky
  await page.locator('#assistant .as-a').last().locator('button', { hasText: 'Show 16 Psyche on the sky' }).click();
  await page.waitForFunction(() => window.__sky && window.__sky.settled, null, { timeout: 60000 });
  { const v = await page.evaluate(() => window.__px.get('view')), c = await page.evaluate(() => window.__sky.centre());
    ok(v === 'sky' && Math.abs(c.raH - 70.2635 / 15) < 0.05 && Math.abs(c.decD - 19.0558) < 0.5, `fly-to action centres the sky (RA ${c.raH.toFixed(3)}h Dec ${c.decD.toFixed(2)}°)`); }
  // typing view-shortcut letters in the box does not switch views
  await page.click('#assistant .as-form input'); await page.keyboard.type('cfs');
  ok(await page.evaluate(() => window.__px.get('view')) === 'sky', 'keys typed in the panel stay in the panel');
  await page.fill('#assistant .as-form input', '');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-dark.png') });

  ok(!/detect/i.test(await panelText(page)), 'panel text never says "detect"');
  await page.keyboard.press('Escape');
  ok(!(await page.isVisible('#assistant')) && await page.evaluate(() => document.activeElement.id) === 'ask', 'Esc closes and focus returns to the Ask button');
  // action: help sheet
  await page.click('#ask'); await ask(page, 'Open the help sheet');
  await page.locator('#assistant .as-a').last().locator('button', { hasText: 'Open the help sheet' }).click(); await page.waitForTimeout(200);
  ok(await page.isVisible('#sheet') && !(await page.isVisible('#assistant')), 'help action closes the panel and opens the help sheet');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => document.activeElement.id) === 'ask', 'closing the help sheet returns focus to the Ask button');
  await page.click('#ask'); await page.click('#assistant .as-head button');
  ok(!(await page.isVisible('#assistant')) && await page.evaluate(() => document.activeElement.id) === 'ask', '✕ closes and returns focus');
  const unnamed = await page.evaluate(() => { document.getElementById('ask').click(); return [...document.querySelectorAll('#assistant button, #assistant input, #ask')]
    .filter(el => !((el.getAttribute('aria-label') || '').trim() || (el.textContent || '').trim())).length; });
  ok(unnamed === 0, 'every helper control has an accessible name');
  ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

console.log('phone 390×844, light, reduced motion');
{
  const { ctx, page, errors } = await open({ width: 390, height: 844, scheme: 'light', mobile: true, reduced: true });
  const b = await page.locator('#ask').boundingBox();
  ok(b && b.width >= 40 && b.height >= 40 && b.x + b.width <= 390, `Ask button is a ≥ 40 px tap target on screen (${b && Math.round(b.width)}×${b && Math.round(b.height)})`);
  await page.tap('#ask'); await page.waitForTimeout(100);
  const pr = await page.locator('#assistant').boundingBox(), tr = await page.locator('#top').boundingBox();
  ok(pr.x >= 0 && pr.x + pr.width <= 390 && pr.y >= tr.y + tr.height && pr.y + pr.height <= 844, `panel fits under the top bar (${Math.round(pr.x)},${Math.round(pr.y)} ${Math.round(pr.width)}×${Math.round(pr.height)})`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
  const small = await page.evaluate(() => [...document.querySelectorAll('#assistant button')].filter(el => el.offsetParent)
    .map(el => el.getBoundingClientRect()).filter(r => r.height < 40).length);
  ok(small === 0, 'helper buttons are ≥ 40 px tall on a phone');
  ok(await page.evaluate(() => [...document.querySelectorAll('#assistant > *')].every(el => getComputedStyle(el).animationName === 'none')), 'no animation under reduced motion');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('assistant')).backgroundColor) === 'rgb(255, 255, 255)', 'light theme panel');
  await page.locator('#assistant .as-chip', { hasText: 'Show me an example' }).tap(); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, 'phone-light.png') });
  await page.locator('#assistant .as-a').last().locator('button', { hasText: 'Barnard' }).tap(); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__px.get('view')) === 'field' && !(await page.isVisible('#assistant')), 'on a phone an action closes the panel to show the view');
  ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

console.log('Simple mode, dark');
{
  const { ctx, page, errors } = await open({ query: '?mode=simple' });
  await page.click('#ask');
  ok(/show you around/.test(await panelText(page)), 'intro in plain words');
  ok(await page.locator('#assistant .as-chip', { hasText: 'Is this data live, saved or simulated?' }).count() === 1, 'chips in plain words');
  await page.locator('#assistant .as-chip', { hasText: 'Is this data live, saved or simulated?' }).click(); await page.waitForTimeout(150);
  { const a = await lastAnswer(page); ok(a && /real telescope photos, saved for six example places/.test(a.text), 'plain-words answer'); }
  ok(!/detect/i.test(await panelText(page)), 'panel text never says "detect" in Simple mode');
  await page.click('#mode-switch [data-mode="advanced"]'); await page.waitForTimeout(200);
  ok(await page.locator('#assistant .as-chip', { hasText: 'What does the badge mean?' }).count() === 1, 'switching to Advanced swaps the chips');
  await page.screenshot({ path: path.join(SHOTS, 'simple-dark.png') });
  ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
