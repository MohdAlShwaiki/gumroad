/**
 * Screenshot helper for design review.
 *   node test/shot.mjs --w 1440 --h 900 --theme light --scenario full --out hero-1440-light
 * Always renders the SANITIZED page (what Gumroad would store) inside the CSP and shim of the real embed.
 * Writes test/out/<out>.png (viewport) and <out>-full.png (whole page after scrolling through it).
 */
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './support/gumroad-env.mjs';

import { launch, mockStore } from './support/browser.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const w = +arg('w', 1440), h = +arg('h', 900);
const theme = arg('theme', 'light'), scenario = arg('scenario', 'full'), out = arg('out', `shot-${w}-${theme}`);
const reduced = arg('reduced', '0') === '1';
const at = arg('at', '');
const full = arg('full', at ? '0' : '1') === '1';
const sheet = +arg('sheet', 0); // slice height; lays 3 slices side by side

const pagePath = existsSync(join(repo, 'dist/landing.sanitized.html')) ? join(repo, 'dist/landing.sanitized.html') : join(repo, 'dist/landing.html');
const { server, base } = await startServer({ pagePath });
mkdirSync(join(repo, 'test/out'), { recursive: true });

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: w, height: h },
  colorScheme: theme,
  reducedMotion: reduced ? 'reduce' : 'no-preference',
  deviceScaleFactor: 1,
  locale: 'ar',
});
await mockStore(ctx);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url().slice(0,90)} ${r.failure()?.errorText}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}/embed?scenario=${scenario}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
await page.screenshot({ path: join(repo, `test/out/${out}.png`) });

// scroll through so reveal animations fire (content stays visible without this; it only plays the entrance)
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < total; y += Math.max(300, h * 0.6)) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120); }
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(700);
if (full) await page.screenshot({ path: join(repo, `test/out/${out}-full.png`), fullPage: true });
for (const sel of at.split(',').filter(Boolean)) {
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); }, sel);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(repo, `test/out/${out}-${sel.replace(/[^a-z0-9]+/gi, '')}.png`) });
}

if (sheet) {
  // Viewport slices (not fullPage clips, which can render blank past ~10k px). Nav is pinned to the top only.
  await page.addStyleTag({ content: '.nav{position:absolute !important;left:0;right:0}' });
  await page.setViewportSize({ width: w, height: sheet });
  await page.waitForTimeout(300);
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  const slices = [];
  for (let y = 0; y < H; y += sheet) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(350);
    slices.push((await page.screenshot()).toString('base64'));
  }
  for (let i = 0, n = 1; i < slices.length; i += 3, n++) {
    const group = slices.slice(i, i + 3);
    const sp = await ctx.newPage();
    await sp.setViewportSize({ width: w * group.length + 8 * (group.length - 1), height: sheet });
    await sp.setContent(`<body style="margin:0;background:#888;display:flex;gap:8px;align-items:flex-start">${group.map((b) => `<img style="display:block" src="data:image/png;base64,${b}">`).join('')}</body>`);
    await sp.screenshot({ path: join(repo, `test/out/${out}-sheet${n}.png`) });
    await sp.close();
  }
}
const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sh: document.documentElement.scrollHeight, theme: document.documentElement.dataset.theme, font: getComputedStyle(document.querySelector('h1')).fontFamily.slice(0, 40) }));
console.log(JSON.stringify({ out, ...m, overflowX: m.sw > m.iw, logs }));
await browser.close();
server.close();
