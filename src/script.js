/* theMoBader · Gumroad profile · interactions
   Vanilla JS, no dependencies. Everything below is progressive enhancement: the page is fully
   readable without it, and each module is isolated so one failure never blocks the rest.
   Configuration is injected at build time from config/site.json. */
(function () {
  'use strict';
  /*@@CONFIG@@*/

  var doc = document;
  var root = doc.documentElement;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var canObserve = 'IntersectionObserver' in window;
  var animate = canObserve && !reduced;
  var ARROW = '←'; // points left: the forward direction in RTL

  function safe(fn) { try { fn(); } catch (e) { /* a failed enhancement must never break the page */ } }

  function h(tag, attrs, kids) {
    var el = doc.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) continue;
        el.setAttribute(k, attrs[k]);
      }
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    });
    return el;
  }

  if (animate) root.className += ' mb-anim';

  /* ------------------------------------------------------------------ theme */
  safe(function () {
    var btn = $('[data-theme-toggle]');
    var mb = $('#mb');
    if (!btn) return;

    function stored() {
      try { var t = localStorage.getItem('mb-theme'); return t === 'dark' || t === 'light' ? t : null; } catch (e) { return null; }
    }
    function set(theme, persist) {
      root.setAttribute('data-theme', theme);
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      if (persist) { try { localStorage.setItem('mb-theme', theme); } catch (e) {} }
    }
    set(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);

    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      if (mb && !reduced) {
        mb.classList.add('mb-theming');
        setTimeout(function () { mb.classList.remove('mb-theming'); }, 420);
      }
      set(next, true);
    });

    // Follow the OS setting live, until the visitor makes an explicit choice.
    if (window.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: dark)');
      var onChange = function (e) { if (!stored()) set(e.matches ? 'dark' : 'light', false); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }
  });

  /* ------------------------------------------------------------ nav + menu */
  safe(function () {
    var nav = $('[data-nav]');
    if (!nav) return;
    var ticking = false;
    function update() {
      ticking = false;
      var y = window.pageYOffset || root.scrollTop || 0;
      nav.classList.toggle('is-scrolled', y > 8);
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();

    var menu = $('[data-menu]');
    if (menu) {
      var close = function () { menu.removeAttribute('open'); };
      $$('a', menu).forEach(function (a) { a.addEventListener('click', close); });
      doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menu.hasAttribute('open')) { close(); var s = $('summary', menu); if (s) s.focus(); }
      });
      doc.addEventListener('click', function (e) { if (menu.hasAttribute('open') && !menu.contains(e.target)) close(); });
    }
  });

  // Move keyboard focus to the target of in-page links so screen-reader and keyboard users land there.
  safe(function () {
    doc.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      var target = id ? doc.getElementById(id) : null;
      if (!target) return;
      setTimeout(function () {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        try { target.focus({ preventScroll: true }); } catch (err) {}
      }, reduced ? 0 : 450);
    });
  });

  /* --------------------------------------------------- active section state */
  safe(function () {
    if (!canObserve) return;
    var map = { hero: 'top', trust: 'top', problem: 'top', products: 'products', journey: 'products', about: 'about', method: 'about', proof: 'about', follow: 'follow', final: 'follow' };
    var links = $$('[data-nav-link]');
    var els = [];
    Object.keys(map).forEach(function (k) {
      var el = k === 'hero' ? $('.hero') : doc.getElementById(k);
      if (el) { el.setAttribute('data-section', map[k]); els.push(el); }
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var key = en.target.getAttribute('data-section');
        links.forEach(function (a) {
          if (a.getAttribute('data-nav-link') === key) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    els.forEach(function (el) { io.observe(el); });
  });

  /* ------------------------------------------------------------- reveal */
  safe(function () {
    if (!animate) return;
    var els = $$('.reveal');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    els.forEach(function (el) {
      var idx = Array.prototype.indexOf.call(el.parentNode.children, el);
      el.style.setProperty('--d', Math.min(idx, 5) * 70 + 'ms');
      io.observe(el);
    });
    // Safety net: if observation never fires (hidden tab, odd embedding), never leave content invisible.
    setTimeout(function () {
      $$('.reveal:not(.is-in)').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < (window.innerHeight || 800)) el.classList.add('is-in');
      });
    }, 2500);
  });

  safe(function () {
    var list = $('[data-creed]');
    if (!list || !animate) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var i = $$('[data-creed-item]', list).indexOf(en.target);
        en.target.style.transitionDelay = Math.max(0, i) * 90 + 'ms';
        en.target.classList.add('is-on');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -18% 0px', threshold: 0 });
    $$('[data-creed-item]', list).forEach(function (el) { io.observe(el); });
    setTimeout(function () {
      $$('[data-creed-item]:not(.is-on)', list).forEach(function (el) {
        if (el.getBoundingClientRect().top < (window.innerHeight || 800)) el.classList.add('is-on');
      });
    }, 3000);
  });

  safe(function () {
    var bars = $('.proof__results');
    if (!bars || !animate) return;
    var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { bars.classList.add('is-in'); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(bars);
  });

  /* --------------------------------------------------------- hero flow panel */
  safe(function () {
    var flow = $('[data-flow]');
    if (!flow) return;
    var stages = $('.flow__stages', flow);

    function measure() {
      var vertical = window.matchMedia && matchMedia('(min-width: 60rem)').matches;
      var len = vertical ? stages.offsetHeight - 66 : stages.offsetWidth * 0.6666 - 44;
      flow.style.setProperty('--track', Math.max(40, Math.round(len)) + 'px');
    }
    measure();
    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(stages);
    else window.addEventListener('resize', measure);

    if (canObserve && !reduced) {
      new IntersectionObserver(function (en) {
        flow.classList.toggle('is-live', en[0].isIntersecting);
      }, { threshold: 0.25 }).observe(flow);
    }

    // Gentle depth on pointer devices only. Skipped for touch and reduced motion.
    var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (fine && !reduced) {
      var raf = 0;
      flow.addEventListener('pointermove', function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = flow.getBoundingClientRect();
          flow.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
          flow.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
        });
      });
      flow.addEventListener('pointerleave', function () {
        flow.style.setProperty('--px', '0');
        flow.style.setProperty('--py', '0');
      });
    }
  });

  /* ------------------------------------------------------------- catalogue */
  // Gumroad injects two JSON blocks into this document at render time:
  //   #gumroad-data    { products: [{ name, url, price, native_type, thumbnail_url, cover_url, description }], products_total, ... }
  //   #gumroad-prices  { "<permalink>": { price, original_price, currency_code, ... } }  (visitor-localised, never cached)
  // Nothing about products (names, prices, links, images) is hardcoded in this page.
  function readJSON(id) {
    var el = doc.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }
  var data = readJSON('gumroad-data');
  var prices = readJSON('gumroad-prices') || {};

  function isProduct(p) {
    return p && typeof p.name === 'string' && typeof p.url === 'string' && /^https?:\/\//i.test(p.url);
  }
  function permalinkOf(p) {
    try {
      var seg = new URL(p.url).pathname.split('/').filter(Boolean);
      return seg[seg.length - 1] || '';
    } catch (e) { return ''; }
  }
  function priceOf(p) {
    var e = prices[permalinkOf(p)] || {};
    return { now: e.price || p.price || '', was: e.original_price || '' };
  }
  function imageOf(p) {
    var u = p.thumbnail_url || p.cover_url || '';
    return /^https:\/\//i.test(u) ? u : '';
  }

  // Arabic-aware normalisation so spelling variants (hamza, ya/alef-maqsura, ta-marbuta, diacritics) still match.
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^ء-ي0-9a-z ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function score(name, pattern) {
    var n = norm(name), q = norm(pattern);
    if (!n || !q) return 0;
    if (n === q) return 3;
    if (n.indexOf(q) !== -1) return 2;
    var toks = q.split(' ').filter(function (t) { return t.length >= 3; });
    if (!toks.length) return 0;
    var hit = toks.filter(function (t) { return n.indexOf(t) !== -1 || n.indexOf(t.slice(0, -1)) !== -1; }).length;
    return hit / toks.length >= 0.75 ? 1 : 0;
  }
  function findFor(slot, items, taken) {
    var cfg = (MB_CONFIG.featured && MB_CONFIG.featured[slot]) || {};
    var pin = String(cfg.permalink || '').trim();
    var best = null, bestScore = 0;
    items.forEach(function (p) {
      if (taken.indexOf(p) !== -1) return;
      var sc = 0;
      if (pin && permalinkOf(p) === pin) sc = 9;
      else (cfg.match || []).forEach(function (m) { sc = Math.max(sc, score(p.name, m)); });
      if (sc > bestScore) { best = p; bestScore = sc; }
    });
    return best;
  }

  function setPrice(row, valEl, wasEl, p) {
    var pr = priceOf(p);
    if (!pr.now) { if (row) row.hidden = true; return; }
    valEl.textContent = pr.now;
    if (wasEl && pr.was) { wasEl.textContent = pr.was; wasEl.hidden = false; }
    if (row) row.hidden = false;
  }

  function fillSlot(slot, p) {
    var el = $('[data-slot="' + slot + '"]');
    if (!el) return false;
    var link = $('[data-slot-link]', el);
    link.setAttribute('href', p.url);
    link.setAttribute('aria-label', link.textContent.replace(ARROW, '').trim() + ': ' + p.name);

    var title = $('[data-slot-title]', el);
    if (title && p.name) title.textContent = p.name;

    setPrice($('[data-price-row]', el), $('[data-slot-price]', el), $('[data-slot-was]', el), p);

    var img = imageOf(p);
    var media = $('[data-slot-media]', el);
    if (img && media) {
      var fallback = Array.prototype.slice.call(media.children);
      var pic = h('img', { src: img, alt: p.name, loading: 'lazy', decoding: 'async' });
      pic.addEventListener('error', function () {
        pic.remove();
        fallback.forEach(function (n) { media.appendChild(n); });
      });
      fallback.forEach(function (n) { media.removeChild(n); });
      media.appendChild(pic);
    }
    el.hidden = false;
    return true;
  }

  var TYPES = { ebook: 'كتاب', course: 'دورة', digital: 'منتج رقمي', membership: 'عضوية', bundle: 'باقة', call: 'جلسة', coffee: 'دعم', commission: 'عمل مخصص' };

  function genericCard(p) {
    var img = imageOf(p);
    var media = h('div', { 'class': 'gcard__media' });
    var mono = h('span', { 'class': 'gcard__mono mono', 'aria-hidden': 'true' }, ['theMoBader']);
    if (img) {
      var pic = h('img', { src: img, alt: p.name, loading: 'lazy', decoding: 'async' });
      pic.addEventListener('error', function () { pic.remove(); media.appendChild(mono); });
      media.appendChild(pic);
    } else { media.appendChild(mono); }

    var pr = priceOf(p);
    var foot = h('div', { 'class': 'gcard__foot' }, [
      pr.now ? h('p', { 'class': 'price' }, [
        h('span', { 'class': 'price__val', 'data-gumroad-product': permalinkOf(p), 'data-gumroad-field': 'price' }, [pr.now]),
        pr.was ? h('s', { 'class': 'price__was' }, [pr.was]) : null
      ]) : h('span'),
      h('a', { 'class': 'link', href: p.url, 'aria-label': 'تعرّف على المنتج: ' + p.name }, [
        'تعرّف على المنتج ', h('span', { 'class': 'arrow', 'aria-hidden': 'true' }, [ARROW])
      ])
    ]);
    return h('article', { 'class': 'gcard', 'data-paths': 'career learn' }, [
      media,
      h('div', { 'class': 'gcard__body' }, [
        h('p', { 'class': 'gcard__cat' }, [TYPES[p.native_type] || 'منتج']),
        h('h3', { 'class': 'gcard__title' }, [p.name]),
        p.description ? h('p', { 'class': 'gcard__desc' }, [p.description]) : null,
        foot
      ])
    ]);
  }

  var onPage = { book: false, course: false, others: 0 }; // what the catalogue put on the page (read by the path chooser)

  safe(function () {
    var items = data && Array.isArray(data.products) ? data.products.filter(isProduct) : [];
    var featuredWrap = $('.featured');
    var note = $('[data-catalogue-note]');

    if (!items.length) {
      // No catalogue: keep any statically pinned cards (they carry their own link and server-filled price).
      var anyStatic = $$('.pcard').some(function (c) { return !c.hidden; });
      if (featuredWrap && !anyStatic) featuredWrap.hidden = true;
      if (note) note.hidden = anyStatic;
      $$('[data-needs]').forEach(function (el) { el.hidden = true; });
      return;
    }

    var taken = [], filled = {};
    ['book', 'course'].forEach(function (slot) {
      var p = findFor(slot, items, taken);
      if (p && fillSlot(slot, p)) { taken.push(p); filled[slot] = true; }
      else { var stale = $('[data-slot="' + slot + '"]'); if (stale) stale.hidden = true; } // pinned but not in the catalogue
    });
    onPage.book = !!filled.book; onPage.course = !!filled.course;
    var count = Object.keys(filled).length;
    if (featuredWrap) {
      featuredWrap.setAttribute('data-count', String(count));
      if (!count) featuredWrap.hidden = true;
    }
    $$('[data-needs]').forEach(function (el) {
      var need = el.getAttribute('data-needs');
      el.hidden = !(need === 'book' ? filled.book : need === 'course' ? filled.course : false);
    });

    // Everything else in the catalogue, in Gumroad's own order.
    var rest = items.filter(function (p) { return taken.indexOf(p) === -1; });
    var more = $('[data-more]'), grid = $('[data-more-grid]'), toggle = $('[data-more-toggle]'), mtitle = $('[data-more-title]');
    var total = data && typeof data.products_total === 'number' ? data.products_total : items.length;
    if (!more || !grid) return;
    if (!rest.length && total <= items.length) return;

    if (mtitle) mtitle.textContent = count ? 'منتجات أخرى' : 'كل المنتجات';
    var LIMIT = 6, shown = 0;
    function render(list) {
      list.forEach(function (p) { grid.appendChild(genericCard(p)); shown++; });
    }
    var queue = rest.slice();
    render(queue.splice(0, rest.length <= LIMIT ? rest.length : LIMIT));
    more.hidden = false;
    onPage.others = grid.children.length;

    var remote = total - items.length; // products Gumroad did not include in the first payload
    var remaining = queue.length + Math.max(0, remote);
    if (remaining > 0 && toggle) {
      toggle.hidden = false;
      toggle.textContent = 'عرض كل المنتجات (' + (shown + remaining) + ')';
      toggle.addEventListener('click', function () {
        render(queue.splice(0, queue.length));
        toggle.setAttribute('aria-expanded', 'true');
        if (remote > 0 && window.gumroadProducts && typeof window.gumroadProducts.request === 'function') {
          toggle.disabled = true;
          window.gumroadProducts.request({ offset: items.length, limit: 100 }).then(function (res) {
            if (res && res.success) {
              for (var k in (res.prices || {})) prices[k] = res.prices[k];
              render((res.products || []).filter(isProduct).filter(function (p) {
                return !items.some(function (q) { return q.url === p.url; });
              }));
            }
            toggle.hidden = true;
          });
        } else { toggle.hidden = true; }
      });
    }
  });

  /* ------------------------------------------------- path chooser (A / B / C) */
  safe(function () {
    var wrap = $('[data-products]');
    var btns = $$('[data-path]', wrap || doc);
    var hint = $('[data-path-hint]');
    if (!wrap || !btns.length) return;
    // Hints only describe what is actually on the page.
    function hintFor(key) {
      if (key === 'freelance') {
        if (onPage.book && onPage.course) return 'ابدأ بالكتاب لتفهم الرحلة، ثم انتقل إلى البرنامج لتبني نظامك.';
        if (onPage.book) return 'ابدأ بالكتاب لتفهم الرحلة وترسم طريقك إلى أول عميل.';
        if (onPage.course) return 'ابنِ نظامك للعمل الحر خطوة بخطوة مع البرنامج.';
        return 'تصفّح المنتجات أدناه، وتابعني ليصلك كل جديد في العمل الحر.';
      }
      if (key === 'career') {
        return onPage.others
          ? 'تصفّح المنتجات الأخرى أدناه، وتابعني ليصلك كل جديد في المسار المهني.'
          : 'تابعني ليصلك كل جديد في المسار المهني، وفي الأثناء ابدأ بما يناسب مهاراتك من المنتجات أعلاه.';
      }
      return 'كل ما أقدّمه أمامك، وتابعني لتصلك الأفكار أولًا بأول.';
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-path');
        var on = b.getAttribute('aria-pressed') !== 'true';
        btns.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        if (on) { b.setAttribute('aria-pressed', 'true'); wrap.setAttribute('data-active', key); }
        else { wrap.removeAttribute('data-active'); }
        if (hint) hint.textContent = on ? hintFor(key) : '';
      });
    });
  });

  /* ------------------------------------------------------------ follow form */
  // Gumroad's wrapper handles the submit (data-gumroad-follow) and replies with a state attribute and
  // message. We never cancel or replace that flow. We only add a busy state and clear it on the reply.
  safe(function () {
    var form = $('[data-mb-form]');
    if (!form) return;
    var btn = $('button[type="submit"]', form);
    var label = $('[data-btn-label]', form);
    var input = $('input[type="email"]', form);
    var idle = label ? label.textContent : '';
    var timer = 0;

    function busy(on) {
      clearTimeout(timer);
      form.setAttribute('aria-busy', on ? 'true' : 'false');
      if (btn) btn.disabled = on;
      if (label) label.textContent = on ? 'جارٍ الإرسال' : idle;
      if (on) timer = setTimeout(function () { busy(false); }, 15000);
    }
    form.addEventListener('submit', function () {
      if (window.parent === window) return; // nothing is listening when viewed outside Gumroad's frame
      form.removeAttribute('data-gumroad-follow-state');
      busy(true);
    });
    window.addEventListener('gumroad:follow:result', function (e) {
      busy(false);
      if (e && e.detail && e.detail.success && input) input.value = '';
    });
    window.addEventListener('pageshow', function () { busy(false); });
  });

  /* ------------------------------------------------------------------ misc */
  safe(function () {
    var y = String(new Date().getFullYear());
    $$('[data-year]').forEach(function (el) { el.textContent = y; });
  });
})();
