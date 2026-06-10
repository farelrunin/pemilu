const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { generateToken } = require('../middleware/auth');
const { genId } = require('../utils/voterHelpers');

// POST /api/auth/login
async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

    const users = await query(`
      SELECT u.*, CONCAT('Kader ', k.nomor, ' \u2014 ', k.nama) AS namaKader
      FROM users u LEFT JOIN kader k ON k.id = u.id_kader
      WHERE u.username = ?
    `, [username]);

    if (!users.length) return res.status(401).json({ error: 'Username tidak ditemukan' });
    const user = users[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Password salah' });

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id, username: user.username, role: user.role,
        idKader: user.id_kader, namaKader: user.namaKader
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/auth/me
async function me(req, res) {
  try {
    const users = await query(`
      SELECT u.id, u.username, u.role, u.id_kader,
             CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
      FROM users u LEFT JOIN kader k ON k.id = u.id_kader WHERE u.id = ?
    `, [req.user.id]);
    if (!users.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(users[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { username, password, role, idKader } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    const validRoles = ['Superadmin', 'AdminKantor', 'Kader', 'User'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: `Role harus salah satu dari: ${validRoles.join(', ')}` });
    if (role === 'Kader' && !idKader) return res.status(400).json({ error: 'Kader harus dipilih untuk role Kader' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });

    const exists = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length) return res.status(409).json({ error: 'Username sudah dipakai' });

    const id   = genId();
    const hash = await bcrypt.hash(password, 12);
    await query('INSERT INTO users (id, username, password_hash, role, id_kader) VALUES (?, ?, ?, ?, ?)',
      [id, username, hash, role, role === 'Kader' ? idKader : null]);
    res.status(201).json({ id, username, role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/auth/users
async function getUsers(req, res) {
  try {
    const data = await query(`
      SELECT u.id, u.username, u.role, u.id_kader, u.created_at,
             CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
      FROM users u LEFT JOIN kader k ON k.id = u.id_kader ORDER BY u.created_at DESC
    `);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// DELETE /api/auth/users/:id
async function deleteUser(req, res) {
  try {
    if (req.user.id === req.params.id) return res.status(400).json({ error: 'Tidak bisa menghapus diri sendiri' });
    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/check
function checkAdminStatus(req, res) {
  res.json({ isAdmin: true, user: req.user });
}

// GET /api/admin/users
async function getAdminUsers(req, res) {
  try {
    const data = await query(`
      SELECT u.id, u.username, u.role, u.created_at
      FROM users u
      ORDER BY u.created_at DESC
    `);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/users
async function createAdminUser(req, res) {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username dan password (min 6 karakter) wajib diisi' });
    }

    const existing = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length) return res.status(400).json({ error: 'Username sudah terdaftar' });

    const id = genId();
    const hashedPassword = await bcrypt.hash(password, 12);
    const finalRole = ['Superadmin', 'AdminKantor', 'Kader', 'User'].includes(role) ? role : 'User';
    
    await query(
      'INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, NOW())',
      [id, username, hashedPassword, finalRole]
    );

    res.status(201).json({ success: true, id, username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PUT /api/admin/users/:id
async function updateAdminUser(req, res) {
  try {
    const { password } = req.body;
    const userId = req.params.id;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, userId]);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// DELETE /api/admin/users/:id
async function deleteAdminUser(req, res) {
  try {
    const userId = req.params.id;
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
    }

    await query('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/login-history
async function getLoginHistory(req, res) {
  res.json([]);
}

// GET /api/admin/import-history
async function getImportHistory(req, res) {
  res.json([]);
}

module.exports = {
  login,
  me,
  register,
  getUsers,
  deleteUser,
  checkAdminStatus,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  getLoginHistory,
  getImportHistory
};

