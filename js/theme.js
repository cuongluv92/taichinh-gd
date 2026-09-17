// ==========================================================================
// Applies the saved light/dark choice before first paint. Loaded
// synchronously (no defer) and before css/app.css in index.html, so the
// page never flashes the wrong theme. CSP here is script-src 'self' (no
// 'unsafe-inline'), so this has to be a real file instead of an inline
// <script> block.
// ==========================================================================
'use strict';
(function () {
  try {
    var v = localStorage.getItem('taichinh_gd_theme_v1');
    if (v !== 'light' && v !== 'dark') return;
    document.documentElement.setAttribute('data-theme', v);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = v === 'light' ? '#f4f5f7' : '#0a0b0d';
  } catch (e) {}
})();
