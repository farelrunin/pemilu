// ════════════════════════════════════════
//  middleware/httpHeaders.js
//  HTTP security headers & cache control
// ════════════════════════════════════════
'use strict';

// Cegah browser cache halaman — penting untuk local mode
function noCache(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}

// Content Security Policy — cegah XSS
function csp(req, res, next) {
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self';"
  );
  next();
}

module.exports = { noCache, csp };