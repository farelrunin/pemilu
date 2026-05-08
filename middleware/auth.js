// ════════════════════════════════════════
//  middleware/auth.js — JWT Gatekeeper
// ════════════════════════════════════════

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'datapilih_secret_key_2026';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '24h';

// ── verifyToken: Cek apakah request punya token valid ──
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Akses ditolak. Token tidak ditemukan.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username, role, idKader }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesi kadaluarsa. Silakan login kembali.' });
    }
    return res.status(401).json({ error: 'Token tidak valid.' });
  }
}

// ── isSuperadmin: Hanya Superadmin yang boleh lewat ──
function isSuperadmin(req, res, next) {
  if (!req.user || req.user.role !== 'Superadmin') {
    return res.status(403).json({ error: 'Akses ditolak. Hanya Superadmin.' });
  }
  next();
}

// ── isAdmin: Boleh Superadmin atau AdminKantor ──
function isAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'Superadmin' && req.user.role !== 'AdminKantor')) {
    return res.status(403).json({ error: 'Akses ditolak. Hanya Admin atau Superadmin.' });
  }
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
