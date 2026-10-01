/**
 * QA suite. Runs the SANITIZED page (what Gumroad would store) inside a local copy of Gumroad's embed
 * (real CSP, real storage shim, real follow/products bridge scripts) and checks layout, accessibility,
 * behaviour and Gumroad-specific rules.
 *
 *   node test/qa.mjs             full run (9 viewports x 2 themes + behaviour)
 *   node test/qa.mjs --quick     3 viewports, for iterating
 *   node test/qa.mjs --only behaviour|layout
 *
 * This is local verification only. It does not replace `gumroad pages preview`.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, mockStore } from './support/browser.mjs';
import { startServer, haveGumroadSource, GUMROAD_CHECKOUT } from './support/gumroad-env.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
const shots = argv.includes('--shots');

const VIEWPORTS = quick ? [320, 390, 1280] : [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const THEMES = ['light', 'dark'];

const results = [];
let section = '';
const check = (name, ok, detail = '') => {
  results.push({ section, name, ok: Boolean(ok), detail: ok ? '' : String(detail) });
  if (!ok) console.log(`  FAIL  [${section}] ${name}${detail ? '  ->  ' + detail : ''}`);
};
const group = (name) => { section = name; console.log(`\n== ${name}`); };

/* ---------- 0. build + sanitizer ---------- */
group('build and Gumroad sanitizer');
execFileSync('node', ['build.mjs', '--strict'], { cwd: repo, stdio: 'pipe' });
check('strict build passes (lint clean)', true);

let pagePath = join(repo, 'dist/landing.html');
if (haveGumroadSource()) {
  try {
    execFileSync('ruby', ['tools/sanitize.rb', 'dist/landing.html', GUMROAD_CHECKOUT], { cwd: repo, stdio: 'pipe' });
    check("Gumroad's own sanitizer removes nothing", true);
    pagePath = join(repo, 'dist/landing.sanitized.html');
  } catch (e) {
    check("Gumroad's own sanitizer removes nothing", false, String(e.stdout || e.message).slice(0, 400));
  }
} else {
  console.log('  (skipped: Gumroad source checkout not found; testing the unsanitized build)');
}
const html = readFileSync(pagePath, 'utf8');
check('page under 500,000 characters', [...html].length < 500000, [...html].length);
check('no <script src> and no external script hosts', !/<script[^>]+src=/i.test(html));
check('no checkout / buy actions embedded', !/data-gumroad-action/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')));
check('no download links', !/\sdownload[\s=>]/.test(html.replace(/<(script|style)>[\s\S]*?<\/\1>/g, '')));
check('own gumroad-data block is not defined', !/id=["']gumroad-data["']/.test(html));
check('follow form uses Gumroad markup', /<form[^>]*data-gumroad-follow/.test(html) && /data-gumroad-follow-message/.test(html));
check('"gumroad-prices" referenced so Gumroad builds the price blob', /gumroad-prices/.test(html));

const { server, base } = await startServer({ pagePath });
const browser = await launch();
mkdirSync(join(repo, 'test/out'), { recursive: true });

async function open({ width = 1280, height = 900, theme = 'light', reduced = false, scenario = 'full', frame = false, follow = 'success', touch = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, colorScheme: theme, locale: 'ar',
    reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: touch, isMobile: touch,
  });
  await mockStore(ctx);
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  const url = frame ? `${base}/frame?scenario=${scenario}&follow=${follow}` : `${base}/embed?scenario=${scenario}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  const target = frame ? page.frameLocator('#gumroad-landing-frame') : null;
  const fr = frame ? page.frames().find((f) => f !== page.mainFrame()) : page;
  await fr.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return { ctx, page, fr, problems, target };
}

async function scrollThrough(fr, page, h) {
  const total = await fr.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += Math.max(300, h * 0.7)) { await fr.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(90); }
  await fr.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

/* ---------- 1. layout, per viewport and theme ---------- */
const axeSrc = existsSync(join(repo, 'node_modules/axe-core/axe.min.js')) ? readFileSync(join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8') : null;

if (only !== 'behaviour') {
  for (const theme of THEMES) {
    for (const w of VIEWPORTS) {
      group(`layout ${w}px ${theme}`);
      const h = w < 700 ? 800 : 900;
      const { ctx, page, fr, problems } = await open({ width: w, height: h, theme });
      await scrollThrough(fr, page, h);

      const m = await fr.evaluate(() => {
        const vw = window.innerWidth;
        const clipped = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n); if (/(hidden|clip)/.test(o.overflowX) && n.getBoundingClientRect().right <= vw + 1 && n.getBoundingClientRect().left >= -1) return true; } return false; };
        const over = [];
        document.querySelectorAll('#mb *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) over.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ` [${Math.round(r.left)},${Math.round(r.right)}]`);
        });
        const textClip = [];
        document.querySelectorAll('.btn, .path, .chip-link, .domains li, .pcard__title, .gcard__title, .stage__title, .brand__name, .form__input').forEach((el) => {
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') textClip.push(el.className.split(' ')[0]);
        });
        const small = [];
        if (vw <= 768) document.querySelectorAll('.btn, .path, .icon-btn, .chip-link, .foot__link, .menu__panel a, .form__input').forEach((el) => {
          const r = el.getBoundingClientRect(); if (r.width && r.height && (r.height < 44 || r.width < 44)) small.push(`${el.className.split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
        });
        const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
        const h1s = document.querySelectorAll('h1').length;
        const lvls = [...document.querySelectorAll('h1,h2,h3')].map((e) => +e.tagName[1]);
        let jump = false; for (let i = 1; i < lvls.length; i++) if (lvls[i] - lvls[i - 1] > 1) jump = true;
        return { sw: document.documentElement.scrollWidth, vw, over: over.slice(0, 6), textClip, small: [...new Set(small)].slice(0, 6), imgsNoAlt, h1s, jump,
          dir: document.documentElement.dir, theme: document.documentElement.dataset.theme, font: getComputedStyle(document.querySelector('.mb')).fontFamily.split(',')[0] };
      });
      check('no horizontal page scroll', m.sw <= m.vw, `scrollWidth ${m.sw} > ${m.vw}`);
      check('no element overflows the viewport', m.over.length === 0, m.over.join('; '));
      check('no clipped text in controls', m.textClip.length === 0, m.textClip.join(', '));
      check('touch targets >= 44px (<=768px)', m.small.length === 0, m.small.join(', '));
      check('images have alt', m.imgsNoAlt === 0);
      check('exactly one h1, no skipped heading levels', m.h1s === 1 && !m.jump, `h1=${m.h1s} jump=${m.jump}`);
      check('RTL document direction', m.dir === 'rtl');
      check(`theme applied (${theme})`, m.theme === theme, m.theme);
      check('web font requested first', /IBM Plex Sans Arabic/.test(m.font), m.font);
      check('no console errors/warnings or failed requests', problems.length === 0, problems.join(' | '));

      if (axeSrc && (w === 390 || w === 1280 || w === 320)) {
        await fr.evaluate(axeSrc);
        const ax = await fr.evaluate(async () => {
          const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }, rules: { 'color-contrast': { enabled: true }, region: { enabled: false }, 'document-title': { enabled: false } } });
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => (n.html || '').slice(0, 90) + ' :: ' + (n.any[0]?.message || n.all[0]?.message || '').slice(0, 120)) }));
        });
        check(`axe-core: no violations (${ax.length ? ax.map((a) => a.id + 'x' + a.n).join(', ') : 'clean'})`, ax.length === 0, JSON.stringify(ax, null, 1).slice(0, 1500));
      }
      if (shots || w === 390 || w === 1280) await page.screenshot({ path: join(repo, `test/out/qa-${w}-${theme}.png`) });
      await ctx.close();
    }
  }
}

/* ---------- 2. behaviour ---------- */
if (only !== 'layout') {
  group('theme toggle and system preference');
  {
    const { ctx, page, fr } = await open({ width: 1280, theme: 'light' });
    check('defaults to light when OS is light', await fr.evaluate(() => document.documentElement.dataset.theme) === 'light');
    await fr.click('[data-theme-toggle]');
    check('toggle switches to dark', await fr.evaluate(() => document.documentElement.dataset.theme) === 'dark');
    check('aria-pressed reflects dark', await fr.getAttribute('[data-theme-toggle]', 'aria-pressed') === 'true');
    check('storage shim keeps the choice for this visit', await fr.evaluate(() => { try { return localStorage.getItem('mb-theme') === 'dark'; } catch (e) { return false; } }));
    const bg = await fr.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    check('html background is a flat opaque colour (Gumroad background bridge reads it)', /^rgb\(/.test(bg), bg);
    await fr.click('[data-theme-toggle]');
    check('toggle switches back to light', await fr.evaluate(() => document.documentElement.dataset.theme) === 'light');
    await ctx.close();
    const d = await open({ width: 1280, theme: 'dark' });
    check('respects prefers-color-scheme: dark with no saved choice', await d.fr.evaluate(() => document.documentElement.dataset.theme) === 'dark');
    await d.ctx.close();
  }

  group('navigation (desktop and mobile menu)');
  {
    const { ctx, page, fr } = await open({ width: 1280 });
    const links = await fr.evaluate(() => [...document.querySelectorAll('[data-nav-link]')].map((a) => ({ href: a.getAttribute('href'), ok: !!document.getElementById(a.getAttribute('href').slice(1)) })));
    check('4 nav links, all targets exist', links.length === 4 && links.every((l) => l.ok), JSON.stringify(links));
    await fr.click('[data-nav-link="products"]'); await page.waitForTimeout(900);
    check('nav link scrolls to products', await fr.evaluate(() => document.getElementById('products').getBoundingClientRect().top < 200 && window.scrollY > 300));
    check('active nav state follows scroll', await fr.evaluate(() => document.querySelector('[data-nav-link="products"]').getAttribute('aria-current') === 'true'));
    check('nav gets solid state when scrolled', await fr.evaluate(() => document.querySelector('[data-nav]').classList.contains('is-scrolled')));
    await ctx.close();
    const m = await open({ width: 390, height: 800, touch: true });
    check('mobile: menu hidden until opened', await m.fr.evaluate(() => !document.querySelector('[data-menu]').hasAttribute('open')));
    await m.fr.click('[data-menu] summary');
    check('mobile: menu opens', await m.fr.evaluate(() => document.querySelector('[data-menu]').hasAttribute('open')));
    await m.fr.click('.menu__panel a[href="#about"]'); await m.page.waitForTimeout(900);
    check('mobile: choosing a link closes the menu and scrolls', await m.fr.evaluate(() => !document.querySelector('[data-menu]').hasAttribute('open') && document.getElementById('about').getBoundingClientRect().top < 220));
    await m.ctx.close();
  }

  group('keyboard and focus');
  {
    const { ctx, page, fr } = await open({ width: 1280 });
    const seen = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(260); // let the skip-link slide-in transition finish
      seen.push(await fr.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { tag: e.tagName, text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, offscreen: e.getBoundingClientRect().bottom < 0 }; }));
    }
    check('first Tab reaches the skip link', seen[0] && /انتقل/.test(seen[0].text), JSON.stringify(seen[0]));
    check('every focused control shows a visible outline', seen.filter(Boolean).every((s) => s.outline), JSON.stringify(seen.filter((s) => s && !s.outline)));
    check('tab order never lands on a hidden element', seen.every((s) => s && !s.offscreen), JSON.stringify(seen.filter((s) => !s || s.offscreen)));
    await ctx.close();
  }

  group('reduced motion');
  {
    const { ctx, page, fr } = await open({ width: 1280, reduced: true });
    const r = await fr.evaluate(() => ({
      anim: document.documentElement.classList.contains('mb-anim'),
      hidden: [...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity !== '1').length,
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
      creed: [...document.querySelectorAll('[data-creed-item]')].filter((e) => getComputedStyle(e).opacity !== '1').length,
    }));
    check('motion layer is off', !r.anim);
    check('all content visible immediately', r.hidden === 0 && r.creed === 0, JSON.stringify(r));
    check('no running animations', r.running === 0, r.running);
    await ctx.close();
  }

  group('content is visible without scroll-triggered animation');
  {
    // Simulate an environment where IntersectionObserver never fires: the safety net must still reveal content.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ar' });
    await mockStore(ctx);
    await ctx.addInitScript(() => { window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }; });
    const page = await ctx.newPage();
    await page.goto(`${base}/embed?scenario=full`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3300);
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.hero .reveal')].filter((e) => getComputedStyle(e).opacity !== '1').length);
    check('above-the-fold content appears even if observers never fire', hidden === 0, hidden);
    await ctx.close();
    // JS fully disabled: everything must be readable, theme follows the OS.
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ar', javaScriptEnabled: false, colorScheme: 'dark' });
    const p2 = await ctx2.newPage();
    await p2.goto(`${base}/embed?scenario=full`, { waitUntil: 'networkidle' });
    const vis = await p2.locator('h1').isVisible();
    const bgc = await p2.locator('body').evaluate((b) => getComputedStyle(document.documentElement).backgroundColor);
    check('JS disabled: headline visible', vis);
    check('JS disabled: dark OS preference still gives the dark theme', bgc === 'rgb(7, 24, 44)', bgc);
    await ctx2.close();
  }

  group('catalogue: live data, matching and fallbacks');
  const cat = async (scenario, fn, opts = {}) => { const o = await open({ width: 1280, scenario, ...opts }); try { await fn(o); } finally { await o.ctx.close(); } };
  await cat('full', async ({ fr, problems }) => {
    const r = await fr.evaluate(() => {
      const t = (s) => document.querySelector(s)?.textContent.trim();
      return { book: !document.querySelector('[data-slot="book"]').hidden, course: !document.querySelector('[data-slot="course"]').hidden,
        bookHref: document.querySelector('[data-slot="book"] [data-slot-link]').getAttribute('href'), courseHref: document.querySelector('[data-slot="course"] [data-slot-link]').getAttribute('href'),
        bookPrice: t('[data-slot="book"] [data-slot-price]'), coursePrice: t('[data-slot="course"] [data-slot-price]'), courseWas: t('[data-slot="course"] [data-slot-was]'),
        more: document.querySelectorAll('.gcard').length, imgs: [...document.querySelectorAll('.pcard img, .gcard img')].map((i) => i.complete && i.naturalWidth > 0),
        counts: document.querySelector('.featured').dataset.count, hint: !document.querySelector('.hero__hint').hidden };
    });
    check('book and course cards both shown and linked to catalogue URLs', r.book && r.course && /\/l\/mock-book$/.test(r.bookHref) && /\/l\/mock-course$/.test(r.courseHref), JSON.stringify(r));
    check('prices come from live data (nothing hardcoded)', r.bookPrice === '$19', r.bookPrice);
    check('discount-aware price wins from the prices blob, original shown struck through', r.coursePrice === '$119' && r.courseWas === '$149', `${r.coursePrice} / ${r.courseWas}`);
    check('other products rendered as cards', r.more === 4, r.more);
    check('catalogue images load', r.imgs.length > 0 && r.imgs.every(Boolean), JSON.stringify(r.imgs));
    check('hero hint "start with the book" shown when the book exists', r.hint);
    check('no console errors', problems.length === 0, problems.join(' | '));
  });
  await cat('variant', async ({ fr }) => {
    check('spelling variant (ابني ... | برنامج عملي) still matches the program', await fr.evaluate(() => !document.querySelector('[data-slot="course"]').hidden));
  });
  await cat('noimg', async ({ fr }) => {
    const r = await fr.evaluate(() => ({ cover: !!document.querySelector('.pcard--book .cover'), pipe: !!document.querySelector('.pcard--course .pipe'), mono: document.querySelectorAll('.gcard__mono').length }));
    check('no catalogue images: designed fallbacks (cover, system diagram) are shown', r.cover && r.pipe && r.mono > 0, JSON.stringify(r));
  });
  await cat('bookonly', async ({ fr }) => {
    const r = await fr.evaluate(() => ({ course: document.querySelector('[data-slot="course"]').hidden, count: document.querySelector('.featured').dataset.count, link: document.querySelector('.step .link[data-needs="course"]').hidden, more: document.querySelector('[data-more]').hidden }));
    check('only the book exists: program card and its links hide, no empty gaps', r.course && r.count === '1' && r.link && r.more, JSON.stringify(r));
    await fr.click('button[data-path="freelance"]');
    const hint = await fr.evaluate(() => document.querySelector('[data-path-hint]').textContent);
    check('hint never mentions a program that does not exist', hint.length > 10 && !/البرنامج/.test(hint), hint);
    await fr.click('button[data-path="career"]');
    const hint2 = await fr.evaluate(() => document.querySelector('[data-path-hint]').textContent);
    check('career hint does not point at products that are not on the page', !/أدناه/.test(hint2), hint2);
  });
  await cat('single', async ({ fr }) => {
    const r = await fr.evaluate(() => ({ feat: document.querySelector('.featured').hidden, title: document.querySelector('[data-more-title]').textContent, cards: document.querySelectorAll('.gcard').length, hint: document.querySelector('.hero__hint').hidden }));
    check('unrelated catalogue: featured hidden, products still listed under a neutral title', r.feat && r.title === 'كل المنتجات' && r.cards === 1 && r.hint, JSON.stringify(r));
  });
  for (const sc of ['empty', 'nodata']) {
    await cat(sc, async ({ fr, problems }) => {
      const r = await fr.evaluate(() => ({ note: !document.querySelector('[data-catalogue-note]').hidden, feat: document.querySelector('.featured').hidden, h1: !!document.querySelector('h1') }));
      check(`${sc}: graceful message, no broken layout`, r.note && r.feat && r.h1, JSON.stringify(r));
      check(`${sc}: no console errors`, problems.length === 0, problems.join(' | '));
    });
  }
  await cat('many', async ({ fr, page }) => {
    const before = await fr.evaluate(() => document.querySelectorAll('.gcard').length);
    const tg = await fr.evaluate(() => { const b = document.querySelector('[data-more-toggle]'); return { shown: !b.hidden, text: b.textContent }; });
    check('large catalogue: first 6 shown, "show all" offered', before === 6 && tg.shown, `${before} ${JSON.stringify(tg)}`);
    await fr.click('[data-more-toggle]'); await page.waitForTimeout(200);
    const after = await fr.evaluate(() => document.querySelectorAll('.gcard').length);
    check('show all reveals the remaining products', after === 8, `cards after expand: ${after}`);
    check('toggle disappears once everything is shown', await fr.evaluate(() => document.querySelector('[data-more-toggle]').hidden));
  });
  {
    const { ctx, page, fr } = await open({ width: 1280, scenario: 'paged', frame: true });
    const inner = page.frameLocator('#gumroad-landing-frame');
    const n0 = await inner.locator('.gcard').count();
    await inner.locator('[data-more-toggle]').click(); await page.waitForTimeout(700);
    const n1 = await inner.locator('.gcard').count();
    const reqs = await page.evaluate(() => window.__productRequests.length);
    check('catalogue larger than the first payload: asks Gumroad for the next slice and appends it', reqs === 1 && n1 > n0, `requests=${reqs} cards ${n0}->${n1}`);
    await ctx.close();
  }

  group('path chooser');
  {
    const { ctx, page, fr } = await open({ width: 1280 });
    await fr.click('button[data-path="freelance"]');
    const a = await fr.evaluate(() => ({ p: document.querySelector('[data-products]').dataset.active, pressed: document.querySelector('button[data-path="freelance"]').getAttribute('aria-pressed'), hint: document.querySelector('[data-path-hint]').textContent.length > 10, badges: [...document.querySelectorAll('.pcard__badge')].filter((b) => getComputedStyle(b).display !== 'none').length }));
    check('choosing a goal highlights matching products with a badge and a hint', a.p === 'freelance' && a.pressed === 'true' && a.hint && a.badges === 2, JSON.stringify(a));
    await fr.click('button[data-path="freelance"]');
    check('choosing it again clears the highlight', await fr.evaluate(() => !document.querySelector('[data-products]').dataset.active && document.querySelector('[data-path-hint]').textContent === ''));
    await ctx.close();
  }

  for (const mode of ['success', 'error', 'refused']) {
    group(`follow form, Gumroad replies "${mode}"`);
    const { ctx, page } = await open({ width: 390, height: 800, frame: true, follow: mode });
    const inner = page.frameLocator('#gumroad-landing-frame');
    await inner.locator('.form__btn').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(1000); // let the section's reveal transition settle
    await inner.locator('#mb-email').fill('visitor@example.com');
    await inner.locator('.form__btn').click();
    await page.waitForTimeout(120);
    check('loading state shown while Gumroad processes', await inner.locator('.form__btn').isDisabled() && /جارٍ/.test(await inner.locator('[data-btn-label]').textContent()));
    await page.waitForTimeout(900);
    const posted = await page.evaluate(() => window.__follows.map((f) => f.email));
    check("form handed to Gumroad's bridge with the typed email (not intercepted by the page)", posted.length === 1 && posted[0] === 'visitor@example.com', JSON.stringify(posted));
    const st = await inner.locator('form').getAttribute('data-gumroad-follow-state');
    const msg = (await inner.locator('[data-gumroad-follow-message]').textContent()).trim();
    check(`Gumroad's state attribute is "${mode === 'success' ? 'success' : 'error'}"`, st === (mode === 'success' ? 'success' : 'error'), st);
    check('message from Gumroad is displayed', msg.length > 5, msg);
    if (mode === 'refused') check('refusal message shows the subscribe-page URL so the visitor is never stuck', /store\.example\/subscribe/.test(msg), msg);
    check('button usable again after the reply', !(await inner.locator('.form__btn').isDisabled()));
    if (mode === 'success') check('input cleared after success', (await inner.locator('#mb-email').inputValue()) === '');
    await ctx.close();
  }

  group('product links go through Gumroad navigation (no hijacking)');
  {
    const { ctx, page } = await open({ width: 1280, frame: true });
    const inner = page.frameLocator('#gumroad-landing-frame');
    await inner.locator('[data-slot="book"] [data-slot-link]').click(); await page.waitForTimeout(300);
    const nav = await page.evaluate(() => window.__nav);
    check('clicking a product CTA is forwarded to Gumroad as a normal store navigation', nav.length === 1 && /\/l\/mock-book$/.test(nav[0]), JSON.stringify(nav));
    await inner.locator('a[href="#about"]').first().click(); await page.waitForTimeout(500);
    check('in-page anchors are not sent to the parent (they scroll inside the page)', (await page.evaluate(() => window.__nav)).length === 1);
    await ctx.close();
  }

  group('pinned permalinks: static cards work without JavaScript');
  {
    const cfg = JSON.parse(readFileSync(join(repo, 'config/site.json'), 'utf8'));
    cfg.featured.book.permalink = 'mock-book'; cfg.featured.course.permalink = 'mock-course';
    const cfgPath = join(repo, 'test/out/pinned-config.json'), outHtml = join(repo, 'test/out/pinned.html');
    (await import('node:fs')).writeFileSync(cfgPath, JSON.stringify(cfg));
    execFileSync('node', ['build.mjs', '--strict'], { cwd: repo, stdio: 'pipe', env: { ...process.env, MB_CONFIG: cfgPath, MB_OUT: outHtml } });
    let pinnedPage = outHtml;
    if (haveGumroadSource()) { execFileSync('ruby', ['tools/sanitize.rb', outHtml, GUMROAD_CHECKOUT], { cwd: repo, stdio: 'pipe' }); pinnedPage = outHtml.replace(/\.html$/, '.sanitized.html'); }
    const s2 = await startServer({ pagePath: pinnedPage });
    const mk = async (opts, scenario) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar', ...opts }); await mockStore(ctx); const page = await ctx.newPage(); const problems = []; page.on('pageerror', (e) => problems.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); }); await page.goto(`${s2.base}/embed?scenario=${scenario}`, { waitUntil: 'networkidle' }); return { ctx, page, problems }; };
    {
      const { ctx, page } = await mk({ javaScriptEnabled: false }, 'full');
      const card = page.locator('[data-slot="book"]');
      check('JS off: pinned book card is visible', await card.isVisible());
      check('JS off: CTA is a real link to /l/<permalink>', (await card.locator('[data-slot-link]').getAttribute('href')) === '/l/mock-book');
      check('JS off: Gumroad live-price attributes present for server-side fill', (await card.locator('[data-slot-price]').getAttribute('data-gumroad-product')) === 'mock-book' && (await card.locator('[data-slot-price]').getAttribute('data-gumroad-field')) === 'price');
      await ctx.close();
    }
    {
      const { ctx, page, problems } = await mk({}, 'full');
      check('JS on: catalogue upgrades the link to the full store URL', (await page.locator('[data-slot="book"] [data-slot-link]').getAttribute('href')) === 'https://store.example/l/mock-book');
      check('JS on: no errors', problems.length === 0, problems.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({}, 'single');
      check('pinned product missing from the catalogue: card hides instead of showing a dead link', !(await page.locator('[data-slot="book"]').isVisible()) && !(await page.locator('[data-slot="course"]').isVisible()));
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({}, 'nodata');
      check('catalogue block missing: pinned cards stay (they carry their own link)', await page.locator('[data-slot="book"]').isVisible());
      await ctx.close();
    }
    s2.server.close();
  }

  group('link audit');
  {
    const { ctx, fr } = await open({ width: 1280 });
    const a = await fr.evaluate(() => {
      const links = [...document.querySelectorAll('#mb a[href]')];
      const bad = [];
      links.forEach((l) => {
        const h = l.getAttribute('href');
        if (h.startsWith('#')) { if (!document.getElementById(h.slice(1))) bad.push('missing target ' + h); }
        else if (/^https?:\/\/store\.example\//.test(h)) { if (l.hasAttribute('target')) bad.push('store link must not set target (Gumroad navigates it) ' + h); }
        else if (/^https?:/.test(h)) { if (l.getAttribute('target') !== '_blank') bad.push('external without _blank ' + h); if (!/noopener/.test(l.rel || '')) bad.push('external without noopener ' + h); }
        else if (h.startsWith('/l/')) { if (l.hasAttribute('target')) bad.push('store link must not set target ' + h); }
        else bad.push('odd href ' + h);
        if (l.hasAttribute('download')) bad.push('download attr');
        if (!(l.textContent || l.getAttribute('aria-label') || '').trim()) bad.push('link without text ' + h);
      });
      const vague = links.filter((l) => /^(اقرأ المزيد|اضغط هنا|المزيد|learn more|click here)$/i.test(l.textContent.trim())).length;
      return { n: links.length, bad, vague, buy: document.querySelectorAll('[data-gumroad-action]').length, forms: document.querySelectorAll('form').length, form: !!document.querySelector('form[data-gumroad-follow] input[type="email"][required]') };
    });
    check(`all ${a.n} links resolve (anchors exist, product links are catalogue URLs)`, a.bad.length === 0, a.bad.join('; '));
    check('no vague link text ("learn more", "click here")', a.vague === 0);
    check('no checkout/buy elements, exactly one form (the follow form)', a.buy === 0 && a.forms === 1 && a.form);
    await ctx.close();
  }
}

await browser.close();
server.close();

/* ---------- summary ---------- */
const failed = results.filter((r) => !r.ok);
const by = {};
for (const r of results) { by[r.section] ??= { pass: 0, fail: 0 }; by[r.section][r.ok ? 'pass' : 'fail']++; }
console.log('\n================ SUMMARY ================');
for (const [s, c] of Object.entries(by)) console.log(`${c.fail ? 'FAIL' : ' ok '}  ${s}  (${c.pass} passed${c.fail ? ', ' + c.fail + ' failed' : ''})`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('\nFailures:'); for (const f of failed) console.log(` - [${f.section}] ${f.name}${f.detail ? '\n     ' + f.detail.split('\n').join('\n     ') : ''}`); process.exit(1); }
