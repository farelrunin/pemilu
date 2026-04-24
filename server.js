// ════════════════════════════════════════
//  server.js — Express + MySQL (v3 — Auth)
// ════════════════════════════════════════
require('dotenv').config();
const express  = require('express');
const path     = require('path');
const multer   = require('multer');
const XLSX     = require('xlsx');
const bcrypt   = require('bcryptjs');
const { query, testConnection } = require('./db');
const { verifyToken, isSuperadmin, generateToken } = require('./middleware/auth');

const app    = express();
const PORT   = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());

// Prevent browser caching for protected pages (helps logout + back button behavior)
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ── Helper: hitung umur dari tanggal lahir ──────────
function hitungUmur(tanggalLahir) {
  if (!tanggalLahir) return null;
  const lahir = new Date(tanggalLahir);
  const now   = new Date();
  let umur    = now.getFullYear() - lahir.getFullYear();
  const m     = now.getMonth() - lahir.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < lahir.getDate())) umur--;
  return umur;
}

// ── Helper: parse NIK → tanggal lahir & jenis kelamin ──
function normalizeNIK(value) {
  const digits = String(value ?? '').trim().replace(/\D/g, '');
  return digits || null;
}

function getNIKStatus(nik) {
  return /^\d{16}$/.test(nik || '') ? null : 'NIK_INVALID';
}

function normalizeSpreadsheetKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getSpreadsheetValue(row, aliases = []) {
  if (!row || typeof row !== 'object') return '';

  const normalizedEntries = Object.entries(row).map(([key, value]) => [
    normalizeSpreadsheetKey(key),
    value
  ]);

  for (const alias of aliases) {
    const normalizedAlias = normalizeSpreadsheetKey(alias);
    const match = normalizedEntries.find(([key]) => key === normalizedAlias);
    if (match) return match[1];
  }

  return '';
}

function parseNIK(nik) {
  if (!nik || nik.length !== 16) return null;
  let tanggal = parseInt(nik.substring(6, 8));
  const bulan = parseInt(nik.substring(8, 10));
  let tahun   = parseInt(nik.substring(10, 12));

  let jenisKelamin = 'L';
  if (tanggal > 40) {
    jenisKelamin = 'P';
    tanggal -= 40;
  }

  // Tentukan abad: jika tahun >= 0 dan <= 12 (tahun kecil) → 2000-an, sisanya 1900-an
  const currentYear2Digit = new Date().getFullYear() % 100;
  tahun = tahun <= currentYear2Digit ? 2000 + tahun : 1900 + tahun;

  // Validasi
  if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) return null;

  const tgl = `${tahun}-${String(bulan).padStart(2, '0')}-${String(tanggal).padStart(2, '0')}`;
  return { tanggalLahir: tgl, jenisKelamin };
}

async function hasColumn(table, column) {
  const res = await query(
    `SELECT COUNT(*) AS n
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [process.env.DB_NAME || '', table, column]
  );
  return res[0] && res[0].n > 0;
}

async function getColumnMeta(table, column) {
  const res = await query(
    `SELECT DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [process.env.DB_NAME || 'pendataan_pemilih', table, column]
  );
  return res[0] || null;
}

async function cleanupDuplicateLogs(nikList = []) {
  const uniqueNIKs = [...new Set(
    (Array.isArray(nikList) ? nikList : [nikList])
      .map(nik => String(nik || '').trim())
      .filter(Boolean)
  )];

  let sql = `
    DELETE l
    FROM log_duplikat l
    LEFT JOIN pemilih p ON p.nik = l.nik_target
  `;
  const params = [];

  if (uniqueNIKs.length) {
    sql += ` WHERE l.nik_target IN (${uniqueNIKs.map(() => '?').join(', ')}) AND p.id IS NULL`;
    params.push(...uniqueNIKs);
  } else {
    sql += ' WHERE p.id IS NULL';
  }

  return query(sql, params);
}

// ══════ API AUTH ══════════════════════════════════════

// Login
app.post('/api/auth/login', async (req, res) => {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Info user saat ini
app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const users = await query(`
      SELECT u.id, u.username, u.role, u.id_kader,
             CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), COALESCE(CONCAT(' · ', k.korlap), ''), ')') AS namaKader
      FROM users u LEFT JOIN kader k ON k.id = u.id_kader WHERE u.id = ?
    `, [req.user.id]);
    if (!users.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(users[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Register (Superadmin only)
app.post('/api/auth/register', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const { username, password, role, idKader } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    if (!['Superadmin', 'Kader'].includes(role)) return res.status(400).json({ error: 'Role harus Superadmin atau Kader' });
    if (role === 'Kader' && !idKader) return res.status(400).json({ error: 'Kader harus dipilih untuk role Kader' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });

    const exists = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length) return res.status(409).json({ error: 'Username sudah dipakai' });

    const id   = genId();
    const hash = await bcrypt.hash(password, 12);
    await query('INSERT INTO users (id, username, password_hash, role, id_kader) VALUES (?, ?, ?, ?, ?)',
      [id, username, hash, role, role === 'Kader' ? idKader : null]);
    res.status(201).json({ id, username, role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List users (Superadmin only)
app.get('/api/auth/users', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const data = await query(`
      SELECT u.id, u.username, u.role, u.id_kader, u.created_at,
             CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), COALESCE(CONCAT(' · ', k.korlap), ''), ')') AS namaKader
      FROM users u LEFT JOIN kader k ON k.id = u.id_kader ORDER BY u.created_at DESC
    `);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete user (Superadmin only)
app.delete('/api/auth/users/:id', verifyToken, isSuperadmin, async (req, res) => {
  try {
    if (req.user.id === req.params.id) return res.status(400).json({ error: 'Tidak bisa menghapus diri sendiri' });
    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════ API KADER ══════════════════════════════════════

app.get('/api/kader', verifyToken, async (req, res) => {
  try {
    const rows = await query(`
      SELECT k.*, COUNT(p.id) AS jumlahPemilih
      FROM kader k LEFT JOIN pemilih p ON p.kader_id = k.id
      GROUP BY k.id ORDER BY k.nomor ASC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kader/:id', verifyToken, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM kader WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Kader tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/kader', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const { nama, nomor, dusun, kordus, targetSuara } = req.body;
    if (!nama || !nomor || !dusun || !kordus) return res.status(400).json({ error: 'Nama, nomor, dusun, dan kordus wajib diisi' });
    const dup = await query('SELECT id FROM kader WHERE nomor = ?', [parseInt(nomor)]);
    if (dup.length) return res.status(400).json({ error: `Kader ${nomor} sudah terdaftar` });
    const id = genId();
    await query('INSERT INTO kader (id, nama, nomor, dusun, kordus, target_suara) VALUES (?, ?, ?, ?, ?, ?)',
      [id, nama.trim(), parseInt(nomor), dusun.trim(), kordus.trim(), parseInt(targetSuara) || 0]);
    const [kader] = await query('SELECT * FROM kader WHERE id = ?', [id]);
    res.status(201).json(kader);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/kader/:id', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const { nama, nomor, dusun, kordus, targetSuara } = req.body;
    if (!nama || !nomor || !dusun || !kordus) return res.status(400).json({ error: 'Nama, nomor, dusun, dan kordus wajib diisi' });
    const dup = await query('SELECT id FROM kader WHERE nomor = ? AND id != ?', [parseInt(nomor), req.params.id]);
    if (dup.length) return res.status(400).json({ error: `Nomor kader ${nomor} sudah dipakai` });
    await query('UPDATE kader SET nama = ?, nomor = ?, dusun = ?, kordus = ?, target_suara = ? WHERE id = ?',
      [nama.trim(), parseInt(nomor), dusun.trim(), kordus.trim(), parseInt(targetSuara) || 0, req.params.id]);
    const [kader] = await query('SELECT * FROM kader WHERE id = ?', [req.params.id]);
    res.json(kader);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/kader/:id', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const { deleteAction } = req.body || {}; // 'delete' untuk hapus pemilih, 'keep' untuk pindah ke kader lain
    
    if (!deleteAction || deleteAction === 'delete') {
      const pemilihDalamKader = await query('SELECT nik FROM pemilih WHERE kader_id = ?', [req.params.id]);

      // Hapus semua pemilih dalam kader sebelum menghapus kader
      await query('DELETE FROM pemilih WHERE kader_id = ?', [req.params.id]);
      await cleanupDuplicateLogs(pemilihDalamKader.map(p => p.nik));
      await query('DELETE FROM kader WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Action tidak valid' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Get daftar pemilih dalam satu kader ───────────────
app.get('/api/kader/:id/pemilih', verifyToken, async (req, res) => {
  try {
    const data = await query(`
      SELECT p.*, 
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p
      WHERE p.kader_id = ?
      ORDER BY p.created_at DESC
    `, [req.params.id]);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Hapus semua isi kader (pemilih saja, kader tetap ada) ─
app.get('/api/kader/:id/aktivitas', verifyToken, async (req, res) => {
  try {
    await cleanupDuplicateLogs();

    const kaderId = req.params.id;
    const pemilih = await query(`
      SELECT p.*,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p
      WHERE p.kader_id = ?
      ORDER BY p.created_at DESC
    `, [kaderId]);

    const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');
    const hasWaktuTerakhir   = await hasColumn('log_duplikat', 'waktu_terakhir');
    const hasWaktuPertama    = await hasColumn('log_duplikat', 'waktu_pertama');

    const duplikat = await query(`
      SELECT CONCAT('dup-', COALESCE(l.nik_target, 'tanpa-nik'), '-', COALESCE(l.kader_id_pelaku, 'unknown')) AS id,
             l.nik_target AS nik,
             COALESCE(NULLIF(l.nama_input, ''), NULLIF(l.nama_existing, ''), '(tanpa nama)') AS nama,
             l.nama_existing,
             ${hasJumlahPercobaan ? 'l.jumlah_percobaan' : '1'} AS jumlah_percobaan,
             ${hasWaktuPertama ? 'l.waktu_pertama' : 'l.created_at'} AS waktu_pertama,
             ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} AS waktu_terakhir,
             CASE
               WHEN ke.id IS NOT NULL THEN CONCAT('Kader ', ke.nomor, ' - ', ke.nama)
               WHEN l.kader_id_existing IS NOT NULL THEN CONCAT('ID: ', l.kader_id_existing)
               ELSE '-'
             END AS kaderExisting
      FROM log_duplikat l
      LEFT JOIN kader ke ON ke.id = l.kader_id_existing
      WHERE l.kader_id_pelaku = ?
      ORDER BY ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} DESC
    `, [kaderId]);

    const totalBermasalah = pemilih.filter(item => item.status !== null).length;
    const totalDuplikatBaris = duplikat.length;
    const totalDuplikatPercobaan = duplikat.reduce((sum, item) => sum + (Number(item.jumlah_percobaan) || 0), 0);

    const riwayat = [
      ...pemilih.map(item => ({
        ...item,
        jenis_entry: 'pemilih',
        label_status: item.status ? 'Butuh Cek' : 'Data Masuk',
        catatan: item.status
          ? 'NIK kosong atau tidak valid. Perlu cek manual ke berkas fisik.'
          : 'Data sudah tersimpan di database pemilih.',
        waktu_input: item.created_at
      })),
      ...duplikat.map(item => ({
        ...item,
        tanggal_lahir: null,
        jenis_kelamin: null,
        umur: null,
        status: 'DUPLIKAT_LOG',
        jenis_entry: 'duplikat',
        label_status: 'Duplikat',
        catatan: `Bentrok dengan ${item.nama_existing || 'data yang sudah ada'} (${item.kaderExisting || '-'})`,
        waktu_input: item.waktu_terakhir
      }))
    ].sort((a, b) => {
      const timeA = new Date(a.waktu_input || 0).getTime();
      const timeB = new Date(b.waktu_input || 0).getTime();
      return timeB - timeA;
    });

    res.json({
      pemilih,
      duplikat,
      riwayat,
      summary: {
        totalPemilih: pemilih.length,
        totalBermasalah,
        totalDuplikatBaris,
        totalDuplikatPercobaan,
        totalBarisAudit: riwayat.length,
        totalAktivitas: pemilih.length + totalDuplikatPercobaan
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/kader/:id/pemilih/clear', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const kaderId = req.params.id;
    
    // Validasi kader ada
    const kaderCheck = await query('SELECT id FROM kader WHERE id = ?', [kaderId]);
    if (!kaderCheck.length) return res.status(404).json({ error: 'Kader tidak ditemukan' });

    const pemilihDalamKader = await query('SELECT nik FROM pemilih WHERE kader_id = ?', [kaderId]);
    
    // Hapus semua pemilih dalam kader ini
    const result = await query('DELETE FROM pemilih WHERE kader_id = ?', [kaderId]);
    await cleanupDuplicateLogs(pemilihDalamKader.map(p => p.nik));
    
    res.json({ 
      success: true,
      message: `Semua data pemilih dalam kader dihapus`,
      deletedCount: result.affectedRows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════ API PEMILIH ════════════════════════════════════

app.get('/api/pemilih', verifyToken, async (req, res) => {
  try {
    const { q, kaderId, statusFilter, page, limit } = req.query;
    const pg  = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pg - 1) * lim;

    let where  = ' WHERE 1=1';
    const params = [];

    if (kaderId)  { where += ' AND p.kader_id = ?';                params.push(kaderId); }
    if (q)        { where += ' AND (p.nama LIKE ? OR p.nik LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (statusFilter === 'bermasalah') {
      where += ' AND p.status IS NOT NULL';
    } else if (statusFilter === 'clear') {
      where += ' AND p.status IS NULL';
    }

    // Count total
    const [countRow] = await query(
      `SELECT COUNT(*) AS total FROM pemilih p JOIN kader k ON k.id = p.kader_id ${where}`, params
    );
    const total = countRow.total;

    // Data with pagination
    const data = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), COALESCE(CONCAT(' · ', k.korlap), ''), ')') AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id
      ${where}
      ORDER BY k.nomor ASC, p.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, lim, offset]);

    res.json({
      data,
      total,
      page: pg,
      limit: lim,
      totalPages: Math.ceil(total / lim) || 1
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pemilih/statistik', verifyToken, async (req, res) => {
  try {
    await cleanupDuplicateLogs();

    const [totalSemua] = await query('SELECT COUNT(*) AS n FROM pemilih');
    const [bermasalah] = await query('SELECT COUNT(*) AS n FROM pemilih WHERE status IS NOT NULL');
    const clear = Math.max((totalSemua.n || 0) - (bermasalah.n || 0), 0);

    // Be tolerant terhadap beberapa versi skema log_duplikat (dengan/ tanpa jumlah_percobaan)
    const [logRows] = await query('SELECT COUNT(*) AS n FROM log_duplikat');
    let percobaanDuplikat = logRows.n;

    if (await hasColumn('log_duplikat', 'jumlah_percobaan')) {
      const [logDup] = await query('SELECT COALESCE(SUM(jumlah_percobaan), 0) AS n FROM log_duplikat');
      percobaanDuplikat = logDup.n;
    }

    res.json({
      total: clear,
      clear,
      totalSemua: totalSemua.n,
      bermasalah: bermasalah.n,
      percobaanDuplikat,
      entryDuplikat: logRows.n
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cek NIK real-time (ringan, hanya cek ada/tidak)
app.get('/api/pemilih/cek-nik/:nik', verifyToken, async (req, res) => {
  try {
    const rows = await query(`
      SELECT p.nama, p.nik, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), COALESCE(CONCAT(' · ', k.korlap), ''), ')') AS namaKader
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.nik = ?
    `, [req.params.nik]);
    res.json({ exists: rows.length > 0, data: rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pemilih/:id', verifyToken, async (req, res) => {
  try {
    const rows = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), COALESCE(CONCAT(' · ', k.korlap), ''), ')') AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Pemilih tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pemilih', verifyToken, async (req, res) => {
  try {
    const { nama, nik, kaderId, tanggalLahir, jenisKelamin } = req.body;
    if (!nama || !kaderId) return res.status(400).json({ error: 'Nama dan Kader wajib diisi' });
    const normalizedNik = normalizeNIK(nik);

    // Validasi tanggal lahir → umur minimal 17 (jika tanggal lahir disediakan)
    if (tanggalLahir) {
      const umur = hitungUmur(tanggalLahir);
      if (umur !== null && umur < 17) return res.status(400).json({ error: 'Umur minimal 17 tahun (berdasarkan tanggal lahir)' });
    }

    const kaderAda = await query('SELECT id, nama, nomor FROM kader WHERE id = ?', [kaderId]);
    if (!kaderAda.length) return res.status(400).json({ error: 'Kader tidak ditemukan' });

    // Tentukan status berdasarkan validitas NIK
    const status = getNIKStatus(normalizedNik);

    // ═══ CEK NIK DUPLIKAT — TOLAK KERAS ═══
    let nikDup = [];
    if (normalizedNik) {
      nikDup = await query(`
      SELECT p.id, p.nama, p.kader_id, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), COALESCE(CONCAT(' · ', k.korlap), ''), ')') AS namaKader
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.nik = ?
      `, [normalizedNik]);
    }

    if (nikDup.length) {
      const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');

      if (hasJumlahPercobaan) {
        // UPSERT: increment counter jika sudah ada, insert jika belum
        await query(
          `INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             jumlah_percobaan = jumlah_percobaan + 1,
             waktu_terakhir = CURRENT_TIMESTAMP,
             nama_input = VALUES(nama_input)`,
          [normalizedNik, nama.trim(), kaderId, nikDup[0].kader_id, nikDup[0].nama]
        );
      } else {
        // Tabel lama tanpa jumlah_percobaan; simpan log duplikat sebagai baris baru
        await query(
          'INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing) VALUES (?, ?, ?, ?, ?)',
          [normalizedNik, nama.trim(), kaderId, nikDup[0].kader_id, nikDup[0].nama]
        );
      }

      return res.status(409).json({
        error: `DITOLAK: NIK ${normalizedNik} sudah terdaftar pada ${nikDup[0].namaKader} atas nama "${nikDup[0].nama}".`,
        existing: nikDup[0]
      });
    }

    // ═══ INSERT DATA BARU ═══
    const id = genId();
    await query(
      'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, nama.trim(), normalizedNik, tanggalLahir || null, jenisKelamin || null, kaderId, status]
    );

    const [p] = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama) AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.id = ?
    `, [id]);
    res.status(201).json(p);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'NIK sudah terdaftar (constraint)' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/pemilih/:id', verifyToken, async (req, res) => {
  try {
    const { nama, nik, kaderId, tanggalLahir, jenisKelamin } = req.body;
    if (!nama || !kaderId) return res.status(400).json({ error: 'Nama dan Kader wajib diisi' });
    const normalizedNik = normalizeNIK(nik);

    const pemilihLama = await query('SELECT nik FROM pemilih WHERE id = ?', [req.params.id]);
    if (!pemilihLama.length) return res.status(404).json({ error: 'Pemilih tidak ditemukan' });

    // Tentukan status berdasarkan validitas NIK
    const status = getNIKStatus(normalizedNik);

    let nikDup = [];
    if (normalizedNik) {
      nikDup = await query(`
      SELECT p.nama, CONCAT('Kader ', k.nomor, ' — ', k.nama) AS namaKader
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.nik = ? AND p.id != ?
      `, [normalizedNik, req.params.id]);
    }
    if (nikDup.length) return res.status(400).json({ error: `NIK sudah dipakai oleh ${nikDup[0].nama} (${nikDup[0].namaKader})` });

    await query(
      'UPDATE pemilih SET nama = ?, nik = ?, kader_id = ?, tanggal_lahir = ?, jenis_kelamin = ?, status = ? WHERE id = ?',
      [nama.trim(), normalizedNik, kaderId, tanggalLahir || null, jenisKelamin || null, status, req.params.id]
    );
    if ((pemilihLama[0].nik || null) !== normalizedNik) {
      await cleanupDuplicateLogs([pemilihLama[0].nik]);
    }
    const [p] = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama) AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.id = ?
    `, [req.params.id]);
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pemilih/:id', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const pemilih = await query('SELECT nik FROM pemilih WHERE id = ?', [req.params.id]);
    if (!pemilih.length) return res.status(404).json({ error: 'Pemilih tidak ditemukan' });

    await query('DELETE FROM pemilih WHERE id = ?', [req.params.id]);
    await cleanupDuplicateLogs([pemilih[0].nik]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════ IMPORT EXCEL ═══════════════════════════════════

function cleanupUploadedFile(filePath) {
  if (!filePath) return;
  const fs = require('fs');
  try { fs.unlinkSync(filePath); } catch (_) {}
}

async function findExistingPemilihByNIK(nikList = []) {
  const uniqueNIKs = [...new Set(nikList.filter(Boolean))];
  if (!uniqueNIKs.length) return new Map();

  const rows = await query(`
    SELECT p.nik, p.nama, p.kader_id,
           CONCAT('Kader ', k.nomor, ' â€” ', k.nama, ' (', COALESCE(k.dusun, '-'), ' Â· ', COALESCE(k.kordus, '-'), COALESCE(CONCAT(' Â· ', k.korlap), ''), ')') AS namaKader
    FROM pemilih p
    JOIN kader k ON k.id = p.kader_id
    WHERE p.nik IN (${uniqueNIKs.map(() => '?').join(', ')})
  `, uniqueNIKs);

  return new Map(rows.map(row => [row.nik, row]));
}

async function catatLogDuplikat(nik, namaInput, kaderIdPelaku, existingRow) {
  if (!nik || !existingRow) return;

  const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');
  if (hasJumlahPercobaan) {
    await query(
      `INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         jumlah_percobaan = jumlah_percobaan + 1,
         waktu_terakhir = CURRENT_TIMESTAMP,
         nama_input = VALUES(nama_input)`,
      [nik, namaInput, kaderIdPelaku, existingRow.kader_id, existingRow.nama]
    );
  } else {
    await query(
      'INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing) VALUES (?, ?, ?, ?, ?)',
      [nik, namaInput, kaderIdPelaku, existingRow.kader_id, existingRow.nama]
    );
  }
}

async function analyzeImportRows(rows) {
  const normalizedRows = rows.map((row, index) => ({
    baris: index + 2,
    nama: String(getSpreadsheetValue(row, ['nama', 'NAMA', 'Nama'])).trim(),
    nik: normalizeNIK(getSpreadsheetValue(row, ['nik', 'NIK', 'Nik']))
  }));

  const existingByNIK = await findExistingPemilihByNIK(normalizedRows.map(row => row.nik));
  const seenInFile = new Map();

  const hasil = {
    total: normalizedRows.length,
    siap: 0,
    bermasalah: 0,
    duplikat: 0,
    gagal: 0,
    akanDiimport: 0,
    detail: []
  };

  for (const row of normalizedRows) {
    const { baris, nama, nik } = row;

    if (!nama) {
      hasil.gagal++;
      hasil.detail.push({
        baris, nama, nik,
        status: 'gagal',
        alasan: 'Nama wajib diisi',
        bisaImport: false
      });
      continue;
    }

    if (nik && seenInFile.has(nik)) {
      const firstInFile = seenInFile.get(nik);
      hasil.duplikat++;
      hasil.detail.push({
        baris, nama, nik,
        status: 'duplikat',
        alasan: `NIK ganda di dalam file import (duplikat dari baris ${firstInFile.baris})`,
        bisaImport: false,
        existing: {
          nama: firstInFile.nama,
          kader_id: null,
          namaKader: `baris ${firstInFile.baris} di file import`
        }
      });
      continue;
    }

    const existing = nik ? existingByNIK.get(nik) : null;
    if (existing) {
      hasil.duplikat++;
      hasil.detail.push({
        baris, nama, nik,
        status: 'duplikat',
        alasan: `NIK sudah terdaftar atas nama "${existing.nama}" di ${existing.namaKader}`,
        bisaImport: false,
        existing
      });
      continue;
    }

    if (nik) {
      seenInFile.set(nik, { baris, nama });
    }

    let status = 'siap';
    let alasan = '';
    let importStatus = null;

    if (!nik) {
      status = 'bermasalah';
      alasan = 'NIK kosong';
      importStatus = 'NIK_INVALID';
      hasil.bermasalah++;
    } else if (nik.length !== 16) {
      status = 'bermasalah';
      alasan = `NIK tidak 16 digit (${nik.length} digit)`;
      importStatus = 'NIK_INVALID';
      hasil.bermasalah++;
    } else {
      hasil.siap++;
    }

    hasil.akanDiimport++;
    hasil.detail.push({
      baris,
      nama,
      nik,
      status,
      alasan,
      bisaImport: true,
      importStatus
    });
  }

  return hasil;
}

app.post('/api/pemilih/import/preview', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    const kaderId = req.body.kaderId;
    if (!kaderId) return res.status(400).json({ error: 'Kader tujuan wajib dipilih' });

    const kaderAda = await query('SELECT id, nama, nomor FROM kader WHERE id = ?', [kaderId]);
    if (!kaderAda.length) return res.status(400).json({ error: 'Kader tidak ditemukan' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const hasil = await analyzeImportRows(rows);

    cleanupUploadedFile(req.file.path);

    res.json({
      mode: 'preview',
      ...hasil,
      perluKonfirmasi: hasil.total > 0,
      pesan: hasil.duplikat || hasil.bermasalah || hasil.gagal
        ? 'Periksa hasil cross-check dulu sebelum melanjutkan import.'
        : 'Semua data lolos cross-check dan siap diimport.'
    });
  } catch (e) {
    cleanupUploadedFile(req.file?.path);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pemilih/import', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    const kaderId = req.body.kaderId;
    if (!kaderId) return res.status(400).json({ error: 'Kader tujuan wajib dipilih' });
    let excludedBaris = [];

    if (req.body.excludedBaris) {
      try {
        const parsedExcluded = JSON.parse(req.body.excludedBaris);
        excludedBaris = Array.isArray(parsedExcluded) ? parsedExcluded.map(Number).filter(Number.isFinite) : [];
      } catch (_) {
        return res.status(400).json({ error: 'Format data pengecualian import tidak valid' });
      }
    }

    const kaderAda = await query('SELECT id, nama, nomor FROM kader WHERE id = ?', [kaderId]);
    if (!kaderAda.length) return res.status(400).json({ error: 'Kader tidak ditemukan' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const analisis = await analyzeImportRows(rows);
    const excludedSet = new Set(excludedBaris);
    const hasil = {
      berhasil: 0,
      bermasalah: 0,
      duplikat: 0,
      gagal: 0,
      dilewati: 0,
      detail: []
    };

    for (const item of analisis.detail) {
      if (!item.bisaImport) {
        if (item.status === 'duplikat') {
          hasil.duplikat++;
          let existingForLog = item.existing && item.existing.kader_id
            ? item.existing
            : null;

          if (!existingForLog && item.nik) {
            const currentExisting = await query(
              'SELECT nama, kader_id FROM pemilih WHERE nik = ? LIMIT 1',
              [item.nik]
            );
            existingForLog = currentExisting[0] || null;
          }

          if (existingForLog) {
            await catatLogDuplikat(item.nik, item.nama, kaderId, existingForLog);
          }
        } else {
          hasil.gagal++;
        }

        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: item.status,
          alasan: item.alasan
        });
        continue;
      }

      if (excludedSet.has(item.baris)) {
        hasil.dilewati++;
        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: 'dilewati',
          alasan: 'Ditandai jangan dimasukkan saat preview'
        });
        continue;
      }

      const parsed = parseNIK(item.nik);
      const tanggalLahir = parsed ? parsed.tanggalLahir : null;
      const jenisKelamin = parsed ? parsed.jenisKelamin : null;

      await query(
        'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [genId(), item.nama, item.nik, tanggalLahir, jenisKelamin, kaderId, item.importStatus]
      );

      if (item.status === 'bermasalah') {
        hasil.bermasalah++;
        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: 'bermasalah',
          alasan: item.alasan
        });
      } else {
        hasil.berhasil++;
        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: 'berhasil',
          alasan: ''
        });
      }
    }

    cleanupUploadedFile(req.file.path);
    res.json({
      ...hasil,
      total: analisis.total,
      siap: analisis.siap,
      akanDiimport: analisis.akanDiimport
    });
  } catch (e) {
    cleanupUploadedFile(req.file?.path);
    res.status(500).json({ error: e.message });
  }
});

// ══════ API LOG DUPLIKAT ═══════════════════════════════

app.get('/api/log-duplikat', verifyToken, isSuperadmin, async (req, res) => {
  try {
    await cleanupDuplicateLogs();

    const { page, limit, kaderId } = req.query;
    const pg  = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pg - 1) * lim;

    let where  = '';
    const params = [];
    if (kaderId) { where = ' WHERE l.kader_id_pelaku = ?'; params.push(kaderId); }

    const [countRow] = await query(
      `SELECT COUNT(*) AS total FROM log_duplikat l${where}`, params
    );

    const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');
    const hasWaktuTerakhir   = await hasColumn('log_duplikat', 'waktu_terakhir');

    const hasWaktuPertama   = await hasColumn('log_duplikat', 'waktu_pertama');

    const data = await query(`
      SELECT l.nik_target, l.nama_input, l.kader_id_pelaku, l.kader_id_existing,
             l.nama_existing,
             ${hasJumlahPercobaan ? 'l.jumlah_percobaan' : '1 AS jumlah_percobaan'},
             ${hasWaktuPertama ? 'l.waktu_pertama' : 'l.created_at'} AS waktu_pertama,
             ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} AS waktu_terakhir,
             CASE
               WHEN kp.id IS NOT NULL THEN CONCAT('Kader ', kp.nomor, ' — ', kp.nama)
               WHEN l.kader_id_pelaku IS NOT NULL THEN CONCAT('ID: ', l.kader_id_pelaku)
               ELSE '-' END AS kaderPelaku,
             CASE
               WHEN ke.id IS NOT NULL THEN CONCAT('Kader ', ke.nomor, ' — ', ke.nama)
               WHEN l.kader_id_existing IS NOT NULL THEN CONCAT('ID: ', l.kader_id_existing)
               ELSE '-' END AS kaderExisting
      FROM log_duplikat l
      LEFT JOIN kader kp ON kp.id = l.kader_id_pelaku
      LEFT JOIN kader ke ON ke.id = l.kader_id_existing
      ${where}
      ORDER BY ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} DESC
      LIMIT ? OFFSET ?
    `, [...params, lim, offset]);

    res.json({
      data,
      total: countRow.total,
      page: pg,
      totalPages: Math.ceil(countRow.total / lim) || 1
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/log-duplikat/statistik', verifyToken, isSuperadmin, async (req, res) => {
  try {
    await cleanupDuplicateLogs();

    const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');

    const [totalNIK] = await query('SELECT COUNT(*) AS n FROM log_duplikat');
    let totalPercobaan = totalNIK.n;

    let perKader;
    if (hasJumlahPercobaan) {
      const [row] = await query('SELECT COALESCE(SUM(jumlah_percobaan), 0) AS n FROM log_duplikat');
      totalPercobaan = row.n;
      perKader = await query(`
        SELECT CONCAT('Kader ', k.nomor, ' — ', k.nama) AS kader,
               COUNT(DISTINCT l.nik_target) AS nikDirebut,
               SUM(l.jumlah_percobaan) AS totalSpam
        FROM log_duplikat l JOIN kader k ON k.id = l.kader_id_pelaku
        GROUP BY l.kader_id_pelaku ORDER BY totalSpam DESC
      `);
    } else {
      perKader = await query(`
        SELECT CONCAT('Kader ', k.nomor, ' — ', k.nama) AS kader,
               COUNT(DISTINCT l.nik_target) AS nikDirebut,
               COUNT(*) AS totalSpam
        FROM log_duplikat l JOIN kader k ON k.id = l.kader_id_pelaku
        GROUP BY l.kader_id_pelaku ORDER BY totalSpam DESC
      `);
    }

    res.json({ totalPercobaan, totalNIK: totalNIK.n, perKader });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HTML pages ────────────────────────────────────────
app.get('/login',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/',               (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tambah-pemilih', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tambah-pemilih.html')));
app.get('/tambah-kader',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'tambah-kader.html')));
app.get('/kader',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'kader.html')));
app.get('/edit-pemilih',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit-pemilih.html')));
app.get('/edit-kader',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit-kader.html')));
app.get('/view-kader',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'view-kader.html')));
app.get('/import',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'import.html')));
app.get('/log-duplikat',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'log-duplikat.html')));
app.get('/kelola-user',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'kelola-user.html')));

// ── Ensure role enum includes AdminKantor (for backward-compatibility) ──
async function ensureRoleEnum() {
  try {
    const [row] = await query(
      `SELECT COLUMN_TYPE FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'users' AND column_name = 'role'`,
      [process.env.DB_NAME || 'pendataan_pemilih']
    );
    if (!row || !row.COLUMN_TYPE) return;

    // If AdminKantor is missing, alter enum to include it
    if (!row.COLUMN_TYPE.includes('AdminKantor')) {
      console.log('🔧 Menambahkan role AdminKantor ke enum users.role');
      await query(
        "ALTER TABLE users MODIFY COLUMN role ENUM('Superadmin','AdminKantor','Kader') NOT NULL DEFAULT 'Kader'"
      );
    }
  } catch (err) {
    console.warn('⚠️ Gagal memastikan role enum:', err.message);
  }
}

// ── Start ─────────────────────────────────────────────
async function ensureNikColumnsFlexible() {
  try {
    const pemilihNik = await getColumnMeta('pemilih', 'nik');
    if (pemilihNik && (
      Number(pemilihNik.CHARACTER_MAXIMUM_LENGTH || 0) < 32 ||
      pemilihNik.IS_NULLABLE !== 'YES'
    )) {
      console.log('Menyesuaikan kolom pemilih.nik agar NIK kosong/bermasalah tetap bisa disimpan');
      await query('ALTER TABLE pemilih MODIFY COLUMN nik VARCHAR(32) NULL');
    }

    const logNik = await getColumnMeta('log_duplikat', 'nik_target');
    if (logNik && Number(logNik.CHARACTER_MAXIMUM_LENGTH || 0) < 32) {
      console.log('Memperlebar kolom log_duplikat.nik_target agar sinkron dengan data pemilih');
      await query('ALTER TABLE log_duplikat MODIFY COLUMN nik_target VARCHAR(32) NOT NULL');
    }
  } catch (err) {
    console.warn('Gagal memastikan panjang kolom NIK:', err.message);
  }
}

async function start() {
  await testConnection();
  await ensureRoleEnum();
  await ensureNikColumnsFlexible();
  app.listen(PORT, () => console.log(`✅ Server berjalan di http://localhost:${PORT}`));
}
start();
