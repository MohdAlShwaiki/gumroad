(function () {
  var r = document.documentElement, t = null;
  try { t = localStorage.getItem('mb-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  r.setAttribute('data-theme', t);
  r.setAttribute('dir', 'rtl');
  r.setAttribute('lang', 'ar');
  r.className += ' mb-js';
})();
