/**
 * A local stand-in for the document Gumroad serves a custom profile page in.
 *
 * Fidelity comes from reading Gumroad's own open-source code, not from guessing:
 *   - the storage shim, follow bridge and products bridge are extracted verbatim from
 *     app/controllers/concerns/renders_custom_html_pages.rb
 *   - the Content-Security-Policy is rebuilt from the same file's CUSTOM_HTML_CSP
 *   - the document shape mirrors profile_custom_html_document
 *   - Tailwind's real preflight reset is included, because Gumroad injects Tailwind into every page
 *
 * What it is NOT: the live service. It cannot check moderation, image hosting, the wrapper's own
 * chrome, or SEO metadata. Real confirmation is `gumroad pages preview` / the live page.
 *
 * The product data in ./catalogue.mjs is MOCK data for layout testing and never ships.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { scenario, mockImage } from './catalogue.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

export const GUMROAD_CHECKOUT =
  process.env.GUMROAD_REPO ||
  [join(homedir(), 'antiwork/gumroad'), '/home/user/antiwork/gumroad'].find((p) => existsSync(p));

const rubyPath = () =>
  join(GUMROAD_CHECKOUT || '', 'app/controllers/concerns/renders_custom_html_pages.rb');

export const haveGumroadSource = () => Boolean(GUMROAD_CHECKOUT) && existsSync(rubyPath());

/** Extract a `NAME = <<~HTML ... HTML` heredoc and undo Ruby's squiggly-heredoc indentation. */
function heredoc(src, name) {
  const m = src.match(new RegExp(`${name} = <<~HTML\\n([\\s\\S]*?)\\n  HTML\\n`));
  if (!m) throw new Error(`could not find ${name} in Gumroad source`);
  const lines = m[1].split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

function loadScripts() {
  if (!haveGumroadSource()) return null;
  const src = readFileSync(rubyPath(), 'utf8');
  return {
    shim: heredoc(src, 'SANDBOX_COMPAT_SCRIPT'),
    follow: heredoc(src, 'FOLLOW_BRIDGE_SCRIPT'),
    products: heredoc(src, 'PRODUCTS_BRIDGE_SCRIPT'),
  };
}

/** Rebuild CUSTOM_HTML_CSP from the Ruby source (interpolated hosts replaced with local stand-ins). */
export function cspHeader() {
  const sandbox = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
  const fallback = [
    `sandbox ${sandbox}`,
    "default-src 'none'",
    "script-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com https://fonts.bunny.net",
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com',
    'img-src data: blob: https://store.example',
    'media-src data: blob: https://store.example',
    'font-src data: https://fonts.gstatic.com https://fonts.bunny.net',
    "connect-src 'none'",
    "form-action 'self'",
  ].join('; ') + ';';
  if (!haveGumroadSource()) return fallback;
  const src = readFileSync(rubyPath(), 'utf8');
  const block = src.match(/CUSTOM_HTML_CSP = \[([\s\S]*?)\]\.join/);
  if (!block) return fallback;
  const parts = block[1]
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .map((l) => l.trim().match(/^"(.*)",?$/))
    .filter(Boolean)
    .map((m) =>
      m[1]
        .replace('#{CUSTOM_HTML_SANDBOX}', sandbox)
        .replace('#{PAGES_TAILWIND_ASSET_HOST}', 'https://assets.example')
        .replace('#{PAGE_ASSET_HOSTS}', 'https://store.example')
        .trim()
    );
  return parts.join('; ') + ';';
}

function preflight() {
  const p = join(repo, 'node_modules/tailwindcss/preflight.css');
  return existsSync(p) ? `<style>@layer base {\n${readFileSync(p, 'utf8')}\n}</style>` : '';
}

const jsonScript = (id, obj) =>
  `<script id="${id}" type="application/json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const NAV_BRIDGE = (host) => `<script data-gumroad-navigation-bridge>
(function () {
  var STORE_HOSTNAMES = ${JSON.stringify([host])};
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (window.parent === window) return;
    var link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!link) return;
    var target = (link.getAttribute("target") || "").toLowerCase();
    if (target && target !== "_self") return;
    if (link.hasAttribute("download")) return;
    var url; try { url = new URL(link.getAttribute("href"), document.baseURI); } catch (_e) { return; }
    if (STORE_HOSTNAMES.indexOf(url.hostname) === -1) return;
    var here = new URL(document.baseURI);
    if (url.hash && url.pathname === here.pathname && url.search === here.search && url.hostname === here.hostname) return;
    e.preventDefault();
    parent.postMessage({ type: "gumroad:navigate", url: url.href }, "*");
  }, true);
})();
</script>`;

/** The sandboxed document, shaped like profile_custom_html_document. */
export function embedDocument({ pageHtml, name = 'full' }) {
  const scripts = loadScripts();
  const sc = scenario(name);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${scripts ? scripts.shim : ''}
    ${preflight()}
  </head>
  <body>
    ${sc.data ? jsonScript('gumroad-data', sc.data) : ''}
    ${sc.prices ? jsonScript('gumroad-prices', sc.prices) : ''}
    ${pageHtml}
    ${NAV_BRIDGE('store.example')}
    ${scripts ? scripts.follow : ''}
    ${scripts ? scripts.products : ''}
  </body>
</html>`;
}

/** The trusted parent page: hosts the sandboxed iframe and answers its bridge messages. */
export function wrapperDocument({ query }) {
  const sandbox = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
  const mode = new URLSearchParams(query).get('follow') || 'success';
  const name = new URLSearchParams(query).get('scenario') || 'full';
  const sc = scenario(name);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100vh;display:block}</style></head>
<body>
<iframe id="gumroad-landing-frame" sandbox="${sandbox}" src="/embed?${query}"></iframe>
<script>
  window.__nav = []; window.__follows = []; window.__productRequests = [];
  var MODE = ${JSON.stringify(mode)};
  var MORE = ${JSON.stringify(sc.more || null)};
  addEventListener('message', function (e) {
    var d = e.data; if (!d || typeof d !== 'object') return;
    if (d.type === 'gumroad:follow') {
      window.__follows.push(d);
      setTimeout(function () {
        var ok = MODE === 'success';
        var msg = ok ? 'Check your inbox to confirm your follow request.'
          : MODE === 'refused' ? "Please subscribe from theMoBader's subscribe page: https://store.example/subscribe"
          : 'Something went wrong. Please try again.';
        e.source.postMessage({ type: 'gumroad:follow:result', success: ok, message: msg, requestId: d.requestId }, '*');
      }, 450);
    } else if (d.type === 'gumroad:navigate') {
      window.__nav.push(d.url);
    } else if (d.type === 'gumroad:products') {
      window.__productRequests.push(d);
      e.source.postMessage({ type: 'gumroad:products:result', success: !!MORE, products: MORE ? MORE.products : [],
        productsTotal: MORE ? MORE.total : 0, prices: MORE ? MORE.prices : {}, offset: d.offset, limit: d.limit,
        requestId: d.requestId, documentToken: d.documentToken }, '*');
    }
  });
</script>
</body></html>`;
}

export async function startServer({ pagePath }) {
  const read = () => readFileSync(pagePath, 'utf8');
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/embed') {
      const html = embedDocument({ pageHtml: read(), name: url.searchParams.get('scenario') || 'full' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': cspHeader() });
      return res.end(html);
    }
    if (url.pathname === '/frame') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(wrapperDocument({ query: url.searchParams.toString() }));
    }
    if (url.pathname.startsWith('/img/')) {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end(mockImage(url.pathname.slice(5).replace('.svg', '')));
    }
    res.writeHead(404).end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
