// ════════════════════════════════════════
//  middleware/auth.js — JWT Gatekeeper
// ════════════════════════════════════════

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'datapilih_secret_key_2026';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '24h';

// ── verifyToken: LOCAL MODE — auth dinonaktifkan ──
function verifyToken(req, res, next) {
  // Local mode: inject user dummy agar controller tidak error saat akses req.user
  req.user = { id: 'local', username: 'local', role: 'Superadmin', idKader: null };
  next();
}

// ── isSuperadmin: LOCAL MODE — selalu lolos ──
function isSuperadmin(req, res, next) {
  next();
}

// ── isAdmin: LOCAL MODE — selalu lolos ──
function isAdmin(req, res, next) {
  next();
}

// ── Generate token ──
function generateToken(user) {
  // user.id_kader might be null for Superadmin / AdminKantor
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, idKader: user.id_kader },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

module.exports = { verifyToken, isSuperadmin, isAdmin, generateToken, JWT_SECRET };
