#!/usr/bin/env node
/**
 * Builds dist/landing.html: the single file Gumroad accepts for a custom profile page.
 *
 *   node build.mjs            build, print warnings
 *   node build.mjs --strict   build, exit 1 on any lint failure (use before publishing)
 *
 * Source of truth:
 *   config/site.json   editable content (brand, social links, featured matching, proof)
 *   src/index.html     markup, with {{path}} (escaped) and {{{path}}} (raw) placeholders
 *   src/styles.css     design tokens + components, inlined into one <style>
 *   src/script.js      vanilla JS, inlined into one <script>
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const strict = process.argv.includes('--strict');

// Gumroad's own limits and allowlists (from the open-source sanitizer and CSP).
const MAX_CHARS = 500_000;
const MAX_IMAGES = 25;
const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700' +
  '&family=IBM+Plex+Mono:wght@400;500&display=swap';

const read = (p) => readFile(join(root, p), 'utf8');
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const configPath = process.env.MB_CONFIG || 'config/site.json';
const outPath = process.env.MB_OUT || 'dist/landing.html';
const config = JSON.parse(configPath.startsWith('/') ? await readFile(configPath, 'utf8') : await read(configPath));
const problems = [];
const warn = (m) => problems.push(m);

/* ---------- config-driven fragments ---------- */

const SOCIAL = [
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['linkedin', 'LinkedIn'],
  ['website', 'الموقع الإلكتروني'],
];

function socialLinks(cls) {
  const items = [];
  for (const [key, label] of SOCIAL) {
    const url = (config.social?.[key] || '').trim();
    if (!url) continue;
    if (!/^https:\/\//i.test(url)) {
      warn(`social.${key} must be an https:// URL (got "${url}")`);
      continue;
    }
    items.push(
      `<li><a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}<span class="sr-only"> (يفتح في تبويب جديد)</span></a></li>`
    );
  }
  return items.join('\n          ');
}

function resultsBlock() {
  const r = config.historicalResults;
  if (!r?.show) return '';
  const ctx = r.context ? esc(r.context) : '';
  return `
      <div class="proof__results reveal">
        <div class="result">
          <p class="result__kicker mono">نحو</p>
          <p class="result__num">${esc(r.trained)}</p>
          <p class="result__label">متدرب ${ctx}</p>
        </div>
        <div class="result result--hl">
          <p class="result__kicker mono">نحو</p>
          <p class="result__num">${esc(r.firstClient)}</p>
          <p class="result__label">وصلوا إلى أول عميل قبل اليوم الأخير من البرنامج</p>
        </div>
        <div class="result__bar" role="img" aria-label="${esc(r.firstClient)} من أصل ${esc(r.trained)}">
          <span style="width:${Math.min(100, Math.round((r.firstClient / r.trained) * 1000) / 10)}%"></span>
        </div>
        <p class="proof__note">نتائج تاريخية لبرنامج تدريبي سابق، وليست ضمانًا لنتيجة أي مشارك لاحق. نتيجتك تعتمد على تطبيقك والتزامك.</p>
      </div>`;
}

function testimonialsBlock() {
  const list = Array.isArray(config.testimonials) ? config.testimonials : [];
  if (!list.length) return '';
  const cards = list.slice(0, 3).map((t) => {
    if (!t.quote || !t.name) warn('each testimonial needs "quote" and "name"');
    return `
        <figure class="quote reveal">
          <blockquote><p>${esc(t.quote)}</p></blockquote>
          <figcaption>
            <strong>${esc(t.name)}</strong>${t.context ? `<span>${esc(t.context)}</span>` : ''}
            ${t.result ? `<em class="quote__result">${esc(t.result)}</em>` : ''}
          </figcaption>
        </figure>`;
  });
  return `<div class="proof__quotes">${cards.join('')}</div>`;
}

const hasProof = Boolean(config.historicalResults?.show) || (config.testimonials || []).length > 0;

// When a permalink is pinned in config, Gumroad fills the price server-side at render time
// (also visible to crawlers). Otherwise script.js fills it from the injected gumroad-prices blob.
function pinned(slot) {
  const p = (config.featured?.[slot]?.permalink || '').trim();
  if (!p) return '';
  if (!/^[\w-]+$/.test(p)) {
    warn(`featured.${slot}.permalink must be the last part of the product URL (letters, digits, - or _)`);
    return '';
  }
  return p;
}
const priceAttrs = (slot) => (pinned(slot) ? ` data-gumroad-product="${esc(pinned(slot))}" data-gumroad-field="price"` : '');
// A pinned product gets a complete static card: visible without JavaScript, with a real link
// (relative, so it works on the store's own domain) and a server-filled live price.
const slotHidden = (slot) => (pinned(slot) ? '' : ' hidden');
const slotHref = (slot) => (pinned(slot) ? ` href="/l/${esc(pinned(slot))}"` : '');

const raw = {
  footer_social: socialLinks('foot__link'),
  follow_social: socialLinks('chip-link'),
  results_block: resultsBlock(),
  testimonials_block: testimonialsBlock(),
  book_price_attrs: priceAttrs('book'),
  course_price_attrs: priceAttrs('course'),
  book_hidden: slotHidden('book'),
  course_hidden: slotHidden('course'),
  book_href: slotHref('book'),
  course_href: slotHref('course'),
};
const flags = { proof: hasProof, social: Boolean(raw.footer_social) };

/* ---------- templating ---------- */

const lookup = (path, obj) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function render(tpl) {
  // conditionals: <!--@if flag-->...<!--@endif-->
  tpl = tpl.replace(/<!--@if (\w+)-->([\s\S]*?)<!--@endif-->/g, (_, flag, body) =>
    flags[flag] ? body : ''
  );
  tpl = tpl.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, p) => {
    if (!(p in raw)) warn(`unknown raw placeholder {{{${p}}}}`);
    return raw[p] ?? '';
  });
  tpl = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    if (p === 'year') return String(new Date().getFullYear());
    const v = lookup(p, config);
    if (v === undefined) warn(`unknown placeholder {{${p}}}`);
    return esc(v);
  });
  return tpl;
}

/* ---------- assemble ---------- */

let css = await read('src/styles.css');
const darkMatch = css.match(/\/\*@@DARK_BEGIN\*\/([\s\S]*?)\/\*@@DARK_END\*\//);
if (!darkMatch) throw new Error('styles.css is missing the @@DARK_BEGIN / @@DARK_END markers');
css = css.replace('/*@@DARK_COPY@@*/', darkMatch[1]);

const publicConfig = {
  featured: config.featured,
};
let js = await read('src/script.js');
js = js.replace('/*@@CONFIG@@*/', `var MB_CONFIG = ${JSON.stringify(publicConfig)};`);

const minCss = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/\s{2,}/g, ' ')
    .replace(/;}/g, '}')
    .trim();

let body = render(await read('src/index.html'))
  .replace(/<!--(?!\[)[\s\S]*?-->/g, '') // strip HTML comments
  .replace(/>\s+</g, '> <')
  .trim();

const earlyTheme = await read('src/theme-init.js');

const html = [
  `<script>${earlyTheme.trim()}</script>`,
  `<link rel="stylesheet" href="${FONT_CSS}">`,
  `<style>${minCss(css)}</style>`,
  body,
  `<script>${js.replace(/^\s*\/\/(?!@).*$/gm, '').replace(/\n{2,}/g, '\n').trim()}</script>`,
].join('\n');

/* ---------- lint ---------- */

function lint(out) {
  const fail = (m) => problems.push(m);
  const len = [...out].length;
  if (len > MAX_CHARS) fail(`page is ${len} chars, limit is ${MAX_CHARS}`);

  if (/\{\{|\}\}/.test(out.replace(/<(script|style)>[\s\S]*?<\/\1>/g, ''))) fail('unresolved {{placeholder}} left in markup');
  if (/lorem ipsum|TODO|FIXME|REPLACE_ME|placeholder text/i.test(out)) fail('placeholder text found');
  if (/href="#"|href=""/.test(out)) fail('dead link (href="#" or empty href)');
  if (/\sdownload[\s=>]/.test(out.replace(/<script>[\s\S]*?<\/script>/g, ''))) fail('download attribute found (downloads do not work in the sandbox)');
  if (/\.(pdf|zip|exe|dmg|rar|epub|mobi)(["'?#])/i.test(out)) fail('link to a downloadable file type');
  if (/data-gumroad-action\s*=\s*["']buy/.test(out.replace(/<script>[\s\S]*?<\/script>/g, ''))) fail('buy action found: profiles must link to product pages, not embed checkout');
  if (/target=["']_(top|parent)/.test(out)) fail('target=_top/_parent is blocked by the sanitizer');
  if (/<(title|meta|base)\b/i.test(out.replace(/<script>[\s\S]*?<\/script>/g, ''))) fail('<title>/<meta>/<base> are stripped by the sanitizer');
  if (/<script[^>]*\ssrc=/i.test(out)) fail('external <script src> found');
  if (/id=["']gumroad-data["']/.test(out)) fail('page must not define its own gumroad-data (Gumroad injects it)');
  if (/<(iframe|object|embed)\b/i.test(out)) fail('iframe/object/embed found');

  const imgs = (out.match(/<img\b/g) || []).length;
  if (imgs > MAX_IMAGES) fail(`${imgs} <img> tags, limit is ${MAX_IMAGES}`);

  // Every absolute URL must be on a host Gumroad's CSP/sanitizer allows (or an https social link).
  const urls = [...out.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
  const allowed = [/^https:\/\/fonts\.googleapis\.com\//, /^http:\/\/www\.w3\.org\/2000\/svg/];
  const socials = SOCIAL.map(([k]) => (config.social?.[k] || '').trim()).filter(Boolean);
  for (const u of urls) {
    if (allowed.some((r) => r.test(u))) continue;
    if (socials.some((s) => u.startsWith(s))) continue;
    fail(`unexpected external URL: ${u}`);
  }

  // Em dashes and ellipses are not used in copy (house style).
  const visible = out.replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  if (/—|…|\.\.\./.test(visible)) fail('em dash or ellipsis found in visible copy');
}
lint(html);

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(outPath.startsWith('/') ? outPath : join(root, outPath), html + '\n');

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`built ${outPath}  ${kb} KB  ${[...html].length} chars  (limit ${MAX_CHARS})`);
if (problems.length) {
  console.log(`\n${problems.length} issue(s):`);
  for (const p of problems) console.log('  - ' + p);
  if (strict) process.exit(1);
} else {
  console.log('lint: clean');
}
