/**
 * Writes test/out/preview.html: a standalone, openable copy of the page for design review.
 * It uses MOCK products and prices (clearly labelled on screen) and a stand-in for Gumroad's follow
 * bridge, because outside Gumroad there is no catalogue and no follow endpoint. Never published.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from './support/catalogue.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(repo, 'dist/landing.html'), 'utf8');
const sc = scenario(process.argv[2] || 'noimg');
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const doc = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>معاينة theMoBader (بيانات تجريبية)</title>
<style>body{padding-bottom:44px}.mb-preview-banner{position:fixed;inset-inline:0;bottom:0;z-index:9999;background:#F14242;color:#fff;font:600 13px/1.6 system-ui,sans-serif;padding:8px 14px;text-align:center}</style>
</head><body>
<div class="mb-preview-banner" role="note">معاينة بمنتجات وأسعار تجريبية، لا تعكس متجرك الحقيقي ولن تُنشر</div>
<script id="gumroad-data" type="application/json">${json(sc.data)}</script>
<script id="gumroad-prices" type="application/json">${json(sc.prices)}</script>
${page}
<script>
// Stand-in for Gumroad's follow bridge (the real one answers with Gumroad's own message).
document.addEventListener('submit', function (e) {
  var f = e.target.closest('form[data-gumroad-follow]'); if (!f) return;
  e.preventDefault();
  setTimeout(function () {
    f.setAttribute('data-gumroad-follow-state', 'success');
    var m = f.querySelector('[data-gumroad-follow-message]'); if (m) m.textContent = 'معاينة فقط: لم يُرسل أي بريد.';
    window.dispatchEvent(new CustomEvent('gumroad:follow:result', { detail: { success: true, message: '' } }));
  }, 500);
}, true);
</script>
</body></html>`;

mkdirSync(join(repo, 'test/out'), { recursive: true });
writeFileSync(join(repo, 'test/out/preview.html'), doc);
console.log('wrote test/out/preview.html', (doc.length / 1024).toFixed(0) + ' KB');
