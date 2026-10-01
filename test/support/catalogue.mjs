/**
 * MOCK catalogue data, for layout and behaviour testing only. Never shipped.
 *
 * Shape follows Pages::ProfileData (the real `gumroad-data` payload) and Pages::ProductPrices
 * (the real `gumroad-prices` payload) from Gumroad's open-source code. Names, prices and URLs
 * here are invented: the host `store.example` does not exist.
 */
const HOST = 'https://store.example/l/';

// Real Gumroad catalogue images are https URLs on Gumroad's CDN. Mocks use https://store.example/img/...,
// which the test harness serves itself (see gumroad-env.mjs) and allows in the CSP.
const art = (label) => `https://store.example/img/${label}.svg`;
export function mockImage(label) {
  const bg = label.includes('book') ? '#12376A' : label.includes('course') ? '#0F2F57' : '#1B4A7E';
  return `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800' viewBox='0 0 800 800'>` +
    `<rect width='800' height='800' fill='${bg}'/><rect x='60' y='60' width='680' height='680' fill='none' stroke='#D4AF37' stroke-width='3'/>` +
    `<text x='400' y='420' font-family='sans-serif' font-size='54' text-anchor='middle' fill='#D4AF37'>MOCK ${label}</text></svg>`;
}

const prod = (permalink, name, native_type, price, extra = {}) => ({
  name,
  url: HOST + permalink,
  price,
  native_type,
  thumbnail_url: art(permalink),
  cover_url: null,
  description: 'وصف تجريبي للمنتج يظهر في البطاقة لأغراض اختبار التصميم فقط، ويجب ألا يُنشر هذا النص.',
  ...extra,
});

const book = prod('mock-book', 'من الصفر إلى أول عميل', 'ebook', '$19');
const course = prod('mock-course', 'ابنِ نظام العمل الحر', 'course', '$149');
const others = [
  prod('mock-template', 'قالب عرض السعر للعملاء', 'digital', '$9'),
  prod('mock-call', 'جلسة استشارية فردية', 'call', '$80'),
  prod('mock-club', 'عضوية المجتمع', 'membership', '$12 شهريًا'),
  prod('mock-bundle', 'باقة أدوات العمل الحر', 'bundle', '$29'),
  prod('mock-x1', 'منتج تجريبي خامس بعنوان طويل نسبيًا ليختبر التفاف النص في البطاقة', 'digital', '$5'),
  prod('mock-x2', 'منتج تجريبي سادس', 'digital', '$6'),
  prod('mock-x3', 'منتج تجريبي سابع', 'digital', '$7'),
  prod('mock-x4', 'منتج تجريبي ثامن', 'digital', '$8'),
];

const priceEntry = (price, extra = {}) => ({ price, price_cents: 0, currency_code: 'usd', localized: false, ...extra });
const pricesFor = (list, over = {}) =>
  Object.fromEntries(list.map((p) => [p.url.split('/').pop(), priceEntry(p.price, over[p.url.split('/').pop()])]));

const payload = (products, total = products.length) => ({ products, posts: [], pages: [], products_total: total, posts_total: 0 });

export function scenario(name) {
  switch (name) {
    case 'full': {
      const all = [book, course, ...others.slice(0, 4)];
      return {
        data: payload(all),
        // The price blob is the visitor-localised, discount-aware price: it wins over gumroad-data's `price`.
        prices: pricesFor(all, { 'mock-course': { price: '$119', original_price: '$149' } }),
      };
    }
    case 'many': {
      const all = [book, course, ...others];
      return { data: payload(all), prices: pricesFor(all) };
    }
    case 'variant': {
      const c = { ...course, name: 'ابني نظام العمل الحر | برنامج عملي' };
      const all = [book, c, ...others.slice(0, 2)];
      return { data: payload(all), prices: pricesFor(all) };
    }
    case 'noimg': {
      const strip = (p) => ({ ...p, thumbnail_url: null, cover_url: null });
      const all = [strip(book), strip(course), ...others.slice(0, 3).map(strip)];
      return { data: payload(all), prices: pricesFor(all) };
    }
    case 'single': {
      const all = [others[0]];
      return { data: payload(all), prices: pricesFor(all) };
    }
    case 'bookonly': {
      const all = [book];
      return { data: payload(all), prices: pricesFor(all) };
    }
    case 'empty':
      return { data: payload([]), prices: {} };
    case 'nodata':
      return { data: null, prices: null };
    case 'paged': {
      const first = [book, course, ...others.slice(0, 6)];
      const rest = others.slice(6).concat([prod('mock-p9', 'منتج تجريبي تاسع', 'digital', '$9'), prod('mock-p10', 'منتج تجريبي عاشر', 'digital', '$10')]);
      return {
        data: payload(first, first.length + rest.length),
        prices: pricesFor(first),
        more: { products: rest, total: first.length + rest.length, prices: pricesFor(rest) },
      };
    }
    default:
      throw new Error('unknown scenario ' + name);
  }
}
