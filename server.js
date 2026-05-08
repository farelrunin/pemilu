// ════════════════════════════════════════
//  server.js — Express + MySQL (v3 — Auth)
// ════════════════════════════════════════
require('dotenv').config();
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const multer   = require('multer');
const XLSX     = require('xlsx');
const bcrypt   = require('bcryptjs');
const { query, testConnection } = require('./db');
const { verifyToken, isSuperadmin, isAdmin, generateToken } = require('./middleware/auth');

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

// Content Security Policy to prevent XSS
app.use((req, res, next) => {
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';");
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
  if (!/^\d{16}$/.test(nik || '')) return 'NIK_INVALID';
  
  const parsed = parseNIK(nik);
  if (parsed) {
    const age = hitungUmur(parsed.tanggalLahir);
    // Syarat memilih adalah minimal 17 tahun
    if (age !== null && age < 17) return 'BELUM_CUKUP_UMUR';
  }
  
  return null;
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

function findSpreadsheetColumnIndex(headers = [], aliases = []) {
  const normalizedHeaders = headers.map(normalizeSpreadsheetKey);
  for (const alias of aliases) {
    const normalizedAlias = normalizeSpreadsheetKey(alias);
    const index = normalizedHeaders.findIndex((key) => key === normalizedAlias);
    if (index !== -1) return index;
  }
  return -1;
}

function isDecorativeSpreadsheetRow(row = []) {
  const nonEmpty = row.filter((value) => String(value ?? '').trim() !== '');
  if (!nonEmpty.length) return true;
  return nonEmpty.every((value) => /^\d+$/.test(String(value).trim()));
}

function extractTPSRows(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerRowIndex = matrix.findIndex((row) => {
    const headers = Array.isArray(row) ? row : [];
    const namaIndex = findSpreadsheetColumnIndex(headers, ['nama', 'name']);
    const usiaIndex = findSpreadsheetColumnIndex(headers, ['usia', 'age']);
    return namaIndex !== -1 && usiaIndex !== -1;
  });

  if (headerRowIndex === -1) {
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  const headers = matrix[headerRowIndex];
  const columnMap = {
    nama: findSpreadsheetColumnIndex(headers, ['nama', 'name']),
    jenis_kelamin: findSpreadsheetColumnIndex(headers, ['jenis_kelamin', 'jk', 'gender', 'jenis kelamin']),
    usia: findSpreadsheetColumnIndex(headers, ['usia', 'age']),
    dusun: findSpreadsheetColumnIndex(headers, ['dusun', 'hamlet']),
    alamatGabungan: findSpreadsheetColumnIndex(headers, ['dusunalamat', 'dusun alamat']),
    alamat: findSpreadsheetColumnIndex(headers, ['alamat', 'address']),
    rt: findSpreadsheetColumnIndex(headers, ['rt']),
    rw: findSpreadsheetColumnIndex(headers, ['rw'])
  };

  let dataStartIndex = headerRowIndex + 1;
  while (dataStartIndex < matrix.length && isDecorativeSpreadsheetRow(matrix[dataStartIndex])) {
    dataStartIndex++;
  }

  const rows = [];
  for (let i = dataStartIndex; i < matrix.length; i++) {
    const rawRow = Array.isArray(matrix[i]) ? matrix[i] : [];
    const alamatGabungan = columnMap.alamatGabungan !== -1 ? rawRow[columnMap.alamatGabungan] : '';
    const alamat = columnMap.alamat !== -1 ? rawRow[columnMap.alamat] : '';
    const mappedRow = {
      nama: columnMap.nama !== -1 ? rawRow[columnMap.nama] : '',
      jenis_kelamin: columnMap.jenis_kelamin !== -1 ? rawRow[columnMap.jenis_kelamin] : '',
      usia: columnMap.usia !== -1 ? rawRow[columnMap.usia] : '',
      dusun: columnMap.dusun !== -1 ? rawRow[columnMap.dusun] : '',
      alamat: alamat || alamatGabungan || '',
      rt: columnMap.rt !== -1 ? rawRow[columnMap.rt] : '',
      rw: columnMap.rw !== -1 ? rawRow[columnMap.rw] : ''
    };

    const hasAnyValue = Object.values(mappedRow).some((value) => String(value ?? '').trim() !== '');
    if (!hasAnyValue) continue;
    rows.push(mappedRow);
  }

  return rows;
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

  // Validasi bulan & hari basic
  if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) return null;

  const tgl = `${tahun}-${String(bulan).padStart(2, '0')}-${String(tanggal).padStart(2, '0')}`;
  
  // Validasi tanggal lebih ketat: pastikan hari valid untuk bulan tertentu
  const dateObj = new Date(tgl);
  if (dateObj.getFullYear() !== tahun || 
      dateObj.getMonth() !== (bulan - 1) || 
      dateObj.getDate() !== tanggal) {
    // Tanggal invalid (misal: Nov 31) → return null
    return null;
  }
  
  return { tanggalLahir: tgl, jenisKelamin };
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGender(value) {
  const raw = normalizeMatchText(value);
  if (!raw) return null;
  if (['l', 'lk', 'lakilaki', 'laki laki', 'male', 'pria'].includes(raw)) return 'L';
  if (['p', 'pr', 'perempuan', 'female', 'wanita'].includes(raw)) return 'P';
  return null;
}

function normalizeAge(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAreaCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits) return String(parseInt(digits, 10));
  return normalizeMatchText(raw);
}

function levenshteinDistance(a = '', b = '') {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function computeNameSimilarity(sourceName, candidateName) {
  const source = normalizeMatchText(sourceName);
  const candidate = normalizeMatchText(candidateName);
  if (!source || !candidate) return 0;

  const distance = levenshteinDistance(source, candidate);
  const maxLength = Math.max(source.length, candidate.length, 1);
  const levScore = Math.max(0, 1 - (distance / maxLength));

  const sourceTokens = new Set(source.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  const overlap = [...sourceTokens].filter(token => candidateTokens.has(token)).length;
  const tokenScore = sourceTokens.size || candidateTokens.size
    ? overlap / Math.max(sourceTokens.size, candidateTokens.size)
    : 0;

  return Math.round(((levScore * 0.7) + (tokenScore * 0.3)) * 100);
}

function computeAgeSignal(tpsAge, pemilihAge) {
  if (tpsAge == null || pemilihAge == null) return 0;
  const diff = Math.abs(Number(tpsAge) - Number(pemilihAge));
  
  // Data TPS seringkali data tahun lalu atau tahun sebelumnya.
  // Kita beri toleransi lebih tinggi.
  if (diff === 0) return 100;
  if (diff <= 1) return 100; // Toleransi data tahun lalu
  if (diff <= 2) return 95;  // Sangat mungkin data 2 tahun lalu
  if (diff <= 3) return 85;  // Masih masuk akal untuk data lama / typo kecil
  if (diff <= 5) return 60;  
  return 0;
}

function computeLocationSignal(tpsRow, pemilihRow) {
  const areaSource = normalizeMatchText([tpsRow.dusun, tpsRow.alamat].filter(Boolean).join(' '));
  const areaTarget = normalizeMatchText([pemilihRow.dusun, pemilihRow.kordus].filter(Boolean).join(' '));
  const rtSource = normalizeAreaCode(tpsRow.rt);
  const rtTarget = normalizeAreaCode(pemilihRow.rt);

  let dusunScore = 0;
  if (areaSource && areaTarget) {
    if (areaSource.includes(areaTarget) || areaTarget.includes(areaSource)) {
      dusunScore = 100;
    } else {
      dusunScore = computeNameSimilarity(areaSource, areaTarget);
    }
  }

  let rtScore = 0;
  if (rtSource && rtTarget) {
    rtScore = rtSource === rtTarget ? 100 : 0;
  }

  return { dusunScore, rtScore };
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

async function hasIndex(table, indexName) {
  const res = await query(
    `SELECT COUNT(*) AS n
     FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
    [process.env.DB_NAME || 'pendataan_pemilih', table, indexName]
  );
  return res[0] && res[0].n > 0;
}

async function hasForeignKey(table, constraintName) {
  const res = await query(
    `SELECT COUNT(*) AS n
     FROM information_schema.table_constraints
     WHERE table_schema = ? AND table_name = ? AND constraint_name = ? AND constraint_type = 'FOREIGN KEY'`,
    [process.env.DB_NAME || 'pendataan_pemilih', table, constraintName]
  );
  return res[0] && res[0].n > 0;
}

async function ensureColumn(table, column, definition) {
  if (!(await hasColumn(table, column))) {
    await query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function ensureTPSComparisonSchema() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS data_tps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama_tps VARCHAR(100) NOT NULL,
        nama VARCHAR(100) NOT NULL,
        jenis_kelamin ENUM('L','P') DEFAULT NULL,
        usia INT DEFAULT NULL,
        dusun VARCHAR(100) DEFAULT NULL,
        alamat VARCHAR(255) DEFAULT NULL,
        rt VARCHAR(10) DEFAULT NULL,
        rw VARCHAR(10) DEFAULT NULL,
        created_at DATETIME DEFAULT NOW(),
        KEY idx_data_tps_nama (nama),
        KEY idx_data_tps_nama_tps (nama_tps),
        KEY idx_data_tps_rt_rw (rt, rw)
      ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
    `);

    await ensureColumn('data_tps', 'alamat', 'alamat VARCHAR(255) DEFAULT NULL AFTER dusun');
    await ensureColumn('data_tps', 'rt', 'rt VARCHAR(10) DEFAULT NULL AFTER alamat');
    await ensureColumn('data_tps', 'rw', 'rw VARCHAR(10) DEFAULT NULL AFTER rt');

    await query(`
      CREATE TABLE IF NOT EXISTS hasil_perbandingan (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pemilih_id VARCHAR(20) DEFAULT NULL,
        data_tps_id INT NOT NULL,
        skor_kemiripan_nama DECIMAL(5,2) NOT NULL DEFAULT 0,
        skor_total DECIMAL(5,2) NOT NULL DEFAULT 0,
        status_cocok ENUM('COCOK','PERLU_DICEK','TIDAK_COCOK') NOT NULL DEFAULT 'TIDAK_COCOK',
        catatan VARCHAR(255) DEFAULT NULL,
        created_at DATETIME DEFAULT NOW(),
        UNIQUE KEY uq_hasil_tps (data_tps_id),
        KEY idx_hasil_status (status_cocok),
        KEY idx_hasil_pemilih (pemilih_id),
        CONSTRAINT fk_hasil_tps FOREIGN KEY (data_tps_id) REFERENCES data_tps(id) ON DELETE CASCADE,
        CONSTRAINT fk_hasil_pemilih FOREIGN KEY (pemilih_id) REFERENCES pemilih(id) ON DELETE SET NULL
      ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
    `);

    const hasilPemilihMeta = await getColumnMeta('hasil_perbandingan', 'pemilih_id');
    if (hasilPemilihMeta && hasilPemilihMeta.IS_NULLABLE !== 'YES') {
      await query('ALTER TABLE hasil_perbandingan MODIFY COLUMN pemilih_id VARCHAR(20) NULL');
    }

    await query(`
      DELETE hp1
      FROM hasil_perbandingan hp1
      JOIN hasil_perbandingan hp2
        ON hp1.data_tps_id = hp2.data_tps_id
       AND hp1.id < hp2.id
    `);

    if (await hasIndex('hasil_perbandingan', 'uq_hasil')) {
      await query('ALTER TABLE hasil_perbandingan DROP INDEX uq_hasil');
    }

    if ((await hasIndex('hasil_perbandingan', 'idx_hasil_tps')) && !(await hasIndex('hasil_perbandingan', 'uq_hasil_tps'))) {
      // Hapus FK dulu sebelum drop index (MySQL tidak izinkan drop index yg dipakai FK)
      if (await hasForeignKey('hasil_perbandingan', 'fk_hasil_tps')) {
        await query('ALTER TABLE hasil_perbandingan DROP FOREIGN KEY fk_hasil_tps');
      }
      await query('ALTER TABLE hasil_perbandingan DROP INDEX idx_hasil_tps');
    }

    if (!(await hasIndex('hasil_perbandingan', 'uq_hasil_tps'))) {
      await query('ALTER TABLE hasil_perbandingan ADD UNIQUE KEY uq_hasil_tps (data_tps_id)');
    }

    // Pastikan FK fk_hasil_tps tetap ada (mungkin sudah di-drop di atas)
    if (!(await hasForeignKey('hasil_perbandingan', 'fk_hasil_tps'))) {
      await query(`
        ALTER TABLE hasil_perbandingan
        ADD CONSTRAINT fk_hasil_tps FOREIGN KEY (data_tps_id) REFERENCES data_tps(id) ON DELETE CASCADE
      `);
    }

    await ensureColumn('pemilih', 'status', 'status VARCHAR(50) DEFAULT NULL AFTER jenis_kelamin');
    await ensureColumn('pemilih', 'rt', 'rt VARCHAR(10) DEFAULT NULL AFTER status');
    await ensureColumn('pemilih', 'rw', 'rw VARCHAR(10) DEFAULT NULL AFTER rt');
    await ensureColumn('kader', 'rt', 'rt VARCHAR(10) DEFAULT NULL AFTER kordus');
    await ensureColumn('kader', 'rw', 'rw VARCHAR(10) DEFAULT NULL AFTER rt');
  } catch (err) {
    console.warn('Gagal memastikan skema perbandingan TPS:', err.message);
  }
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

async function ensureKoordinatorSchema() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS koordinator (
        id VARCHAR(20) PRIMARY KEY,
        nama VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT NOW(),
        UNIQUE KEY uq_koordinator_nama (nama)
      ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
    `);

    if (!(await hasColumn('kader', 'koordinator_id'))) {
      console.log('Menambah kolom kader.koordinator_id');
      await query('ALTER TABLE kader ADD COLUMN koordinator_id VARCHAR(20) NULL AFTER kordus');
    }

    if (!(await hasIndex('kader', 'idx_kader_koordinator'))) {
      await query('ALTER TABLE kader ADD INDEX idx_kader_koordinator (koordinator_id)');
    }

    if (!(await hasForeignKey('kader', 'fk_kader_koordinator'))) {
      await query(`
        ALTER TABLE kader
        ADD CONSTRAINT fk_kader_koordinator
        FOREIGN KEY (koordinator_id) REFERENCES koordinator(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
      `);
    }

    const legacyKoordinator = await query(`
      SELECT DISTINCT TRIM(kordus) AS nama
      FROM kader
      WHERE TRIM(COALESCE(kordus, '')) <> ''
    `);

    for (const item of legacyKoordinator) {
      const nama = String(item.nama || '').trim();
      if (!nama) continue;

      const existing = await query('SELECT id FROM koordinator WHERE nama = ? LIMIT 1', [nama]);
      if (!existing.length) {
        await query('INSERT INTO koordinator (id, nama) VALUES (?, ?)', [genId(), nama]);
      }
    }

    await query(`
      UPDATE kader k
      JOIN koordinator ko ON ko.nama = TRIM(k.kordus)
      SET k.koordinator_id = ko.id
      WHERE k.koordinator_id IS NULL
        AND TRIM(COALESCE(k.kordus, '')) <> ''
    `);

    await query(`
      UPDATE kader k
      JOIN koordinator ko ON ko.id = k.koordinator_id
      SET k.kordus = ko.nama
      WHERE COALESCE(k.kordus, '') <> ko.nama
    `);
  } catch (err) {
    console.warn('Gagal memastikan skema koordinator:', err.message);
  }
}

async function resolveKoordinatorInput(payload = {}) {
  const koordinatorId = String(payload.koordinatorId || '').trim();
  const legacyName = String(payload.kordus || payload.namaKoordinator || '').trim();

  if (koordinatorId) {
    const rows = await query('SELECT id, nama FROM koordinator WHERE id = ? LIMIT 1', [koordinatorId]);
    if (!rows.length) {
      return { error: 'Koordinator tidak ditemukan' };
    }
    return rows[0];
  }

  if (!legacyName) {
    return { error: 'Koordinator wajib dipilih' };
  }

  const existing = await query('SELECT id, nama FROM koordinator WHERE nama = ? LIMIT 1', [legacyName]);
  if (existing.length) {
    return existing[0];
  }

  const id = genId();
  await query('INSERT INTO koordinator (id, nama) VALUES (?, ?)', [id, legacyName]);
  return { id, nama: legacyName };
}

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
             CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List users (Superadmin only)
app.get('/api/auth/users', verifyToken, isSuperadmin, async (req, res) => {
  try {
    const data = await query(`
      SELECT u.id, u.username, u.role, u.id_kader, u.created_at,
             CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
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

app.get('/api/koordinator', verifyToken, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    let where = '';
    const params = [];

    if (q) {
      where = 'WHERE ko.nama LIKE ?';
      params.push(`%${q}%`);
    }

    const rows = await query(`
      SELECT ko.id, ko.nama, ko.created_at,
             COUNT(DISTINCT k.id) AS jumlahKader,
             COUNT(p.id) AS jumlahPemilih,
             COUNT(DISTINCT NULLIF(TRIM(k.dusun), '')) AS jumlahDusun
      FROM koordinator ko
      LEFT JOIN kader k ON k.koordinator_id = ko.id
      LEFT JOIN pemilih p ON p.kader_id = k.id
      ${where}
      GROUP BY ko.id, ko.nama, ko.created_at
      ORDER BY ko.nama ASC
    `, params);

    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/koordinator', verifyToken, isAdmin, async (req, res) => {
  try {
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.status(400).json({ error: 'Nama koordinator wajib diisi' });

    const dup = await query('SELECT id FROM koordinator WHERE nama = ? LIMIT 1', [nama]);
    if (dup.length) return res.status(400).json({ error: 'Nama koordinator sudah terdaftar' });

    const id = genId();
    await query('INSERT INTO koordinator (id, nama) VALUES (?, ?)', [id, nama]);

    res.status(201).json({
      id,
      nama,
      jumlahKader: 0,
      jumlahPemilih: 0,
      jumlahDusun: 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/koordinator/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.status(400).json({ error: 'Nama koordinator wajib diisi' });

    const exists = await query('SELECT id FROM koordinator WHERE id = ? LIMIT 1', [req.params.id]);
    if (!exists.length) return res.status(404).json({ error: 'Koordinator tidak ditemukan' });

    const dup = await query('SELECT id FROM koordinator WHERE nama = ? AND id != ? LIMIT 1', [nama, req.params.id]);
    if (dup.length) return res.status(400).json({ error: 'Nama koordinator sudah dipakai' });

    await query('UPDATE koordinator SET nama = ? WHERE id = ?', [nama, req.params.id]);
    await query('UPDATE kader SET kordus = ? WHERE koordinator_id = ?', [nama, req.params.id]);

    const [row] = await query('SELECT id, nama, created_at FROM koordinator WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/koordinator/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const exists = await query('SELECT id FROM koordinator WHERE id = ? LIMIT 1', [req.params.id]);
    if (!exists.length) return res.status(404).json({ error: 'Koordinator tidak ditemukan' });

    const [usage] = await query('SELECT COUNT(*) AS jumlah FROM kader WHERE koordinator_id = ?', [req.params.id]);
    if (Number(usage?.jumlah || 0) > 0) {
      return res.status(400).json({ error: `Koordinator masih dipakai oleh ${usage.jumlah} kader` });
    }

    await query('DELETE FROM koordinator WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kader', verifyToken, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const koordinatorId = String(req.query.koordinatorId || '').trim();
    let where = 'WHERE 1 = 1';
    const params = [];

    if (q) {
      where += ` AND (
        k.nama LIKE ?
        OR k.dusun LIKE ?
        OR COALESCE(ko.nama, k.kordus, '') LIKE ?
        OR CAST(k.nomor AS CHAR) LIKE ?
      )`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (koordinatorId) {
      where += ' AND k.koordinator_id = ?';
      params.push(koordinatorId);
    }

    const rows = await query(`
      SELECT k.id, k.nama, k.nomor, k.dusun, k.kordus, k.rt, k.rw, k.target_suara, k.created_at, k.koordinator_id,
             COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator,
             (
               SELECT COUNT(*)
               FROM pemilih p
               WHERE p.kader_id = k.id
             ) AS jumlahPemilih
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      ${where}
      ORDER BY COALESCE(ko.nama, NULLIF(k.kordus, ''), 'zzz') ASC, k.dusun ASC, k.nomor ASC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kader/:id', verifyToken, async (req, res) => {
  try {
    const rows = await query(`
      SELECT k.*, COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      WHERE k.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Kader tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/kader', verifyToken, isAdmin, async (req, res) => {
  try {
    const { nama, nomor, dusun, rt, rw } = req.body;
    if (!nama || !nomor || !dusun) return res.status(400).json({ error: 'Nama, nomor, dusun, dan koordinator wajib diisi' });

    const koordinator = await resolveKoordinatorInput(req.body);
    if (koordinator.error) return res.status(400).json({ error: koordinator.error });

    const dup = await query('SELECT id FROM kader WHERE nomor = ?', [parseInt(nomor)]);
    if (dup.length) return res.status(400).json({ error: `Kader ${nomor} sudah terdaftar` });
    const id = genId();
    await query('INSERT INTO kader (id, nama, nomor, dusun, kordus, rt, rw, koordinator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, nama.trim(), parseInt(nomor), dusun.trim(), koordinator.nama, rt || null, rw || null, koordinator.id]);
    const [kader] = await query(`
      SELECT k.*, COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      WHERE k.id = ?
    `, [id]);
    res.status(201).json(kader);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/kader/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { nama, nomor, dusun, rt, rw } = req.body;
    if (!nama || !nomor || !dusun) return res.status(400).json({ error: 'Nama, nomor, dusun, dan koordinator wajib diisi' });

    const koordinator = await resolveKoordinatorInput(req.body);
    if (koordinator.error) return res.status(400).json({ error: koordinator.error });

    const dup = await query('SELECT id FROM kader WHERE nomor = ? AND id != ?', [parseInt(nomor), req.params.id]);
    if (dup.length) return res.status(400).json({ error: `Nomor kader ${nomor} sudah dipakai` });
    await query('UPDATE kader SET nama = ?, nomor = ?, dusun = ?, kordus = ?, rt = ?, rw = ?, koordinator_id = ? WHERE id = ?',
      [nama.trim(), parseInt(nomor), dusun.trim(), koordinator.nama, rt || null, rw || null, koordinator.id, req.params.id]);
    const [kader] = await query(`
      SELECT k.*, COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      WHERE k.id = ?
    `, [req.params.id]);
    res.json(kader);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/kader/:id', verifyToken, isAdmin, async (req, res) => {
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

app.delete('/api/kader/:id/pemilih/clear', verifyToken, isAdmin, async (req, res) => {
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
    } else if (statusFilter === 'underage') {
      where += " AND p.status = 'BELUM_CUKUP_UMUR'";
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
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader,
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
    const [underage]   = await query("SELECT COUNT(*) AS n FROM pemilih WHERE status = 'BELUM_CUKUP_UMUR'");
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
      underage: underage.n,
      percobaanDuplikat,
      entryDuplikat: logRows.n
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cek NIK real-time (ringan, hanya cek ada/tidak)
app.get('/api/pemilih/cek-nik/:nik', verifyToken, async (req, res) => {
  try {
    const rows = await query(`
      SELECT p.nama, p.nik, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.nik = ?
    `, [req.params.nik]);
    res.json({ exists: rows.length > 0, data: rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pemilih/:id', verifyToken, async (req, res) => {
  try {
    const rows = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Pemilih tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pemilih', verifyToken, isAdmin, async (req, res) => {
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
      SELECT p.id, p.nama, p.kader_id, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
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
    let finalStatus = status; // status dari getNIKStatus()
    
    try {
      await query(
        'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status, rt, rw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, nama.trim(), normalizedNik, tanggalLahir || null, jenisKelamin || null, kaderId, finalStatus, rt || null, rw || null]
      );
    } catch (insertError) {
      // Jika error (misal: tanggal invalid), coba insert lagi dengan tanggal_lahir = NULL dan status = 'bermasalah'
      if (insertError.code === 'ER_TRUNCATED_WRONG_VALUE' || insertError.message.includes('Incorrect')) {
        finalStatus = 'tanggal_invalid';
        await query(
          'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status, rt, rw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, nama.trim(), normalizedNik, null, jenisKelamin || null, kaderId, finalStatus, rt || null, rw || null]
        );
      } else {
        throw insertError;
      }
    }

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

app.put('/api/pemilih/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { nama, nik, kaderId, tanggalLahir, jenisKelamin, rt, rw } = req.body;
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
      'UPDATE pemilih SET nama = ?, nik = ?, kader_id = ?, tanggal_lahir = ?, jenis_kelamin = ?, status = ?, rt = ?, rw = ? WHERE id = ?',
      [nama.trim(), normalizedNik, kaderId, tanggalLahir || null, jenisKelamin || null, status, rt || null, rw || null, req.params.id]
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

app.delete('/api/pemilih/:id', verifyToken, isAdmin, async (req, res) => {
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
           CONCAT('Kader ', k.nomor, ' ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
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

app.post('/api/pemilih/import/preview', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    const kaderId = req.body.kaderId;
    if (!kaderId) return res.status(400).json({ error: 'Kader tujuan wajib dipilih' });

    const kaderAda = await query('SELECT id, nama, nomor FROM kader WHERE id = ?', [kaderId]);
    if (!kaderAda.length) return res.status(400).json({ error: 'Kader tidak ditemukan' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = extractTPSRows(sheet);
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

app.post('/api/pemilih/import', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
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
      
      let insertStatus = item.importStatus;
      
      try {
        await query(
          'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [genId(), item.nama, item.nik, tanggalLahir, jenisKelamin, kaderId, insertStatus]
        );
      } catch (insertError) {
        // Jika error tanggal, insert dengan tanggal_lahir = NULL
        if (insertError.code === 'ER_TRUNCATED_WRONG_VALUE' || insertError.message.includes('Incorrect')) {
          insertStatus = 'tanggal_invalid';
          await query(
            'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [genId(), item.nama, item.nik, null, jenisKelamin, kaderId, insertStatus]
          );
        } else {
          throw insertError;
        }
      }

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

app.get('/api/log-duplikat', verifyToken, isAdmin, async (req, res) => {
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

app.get('/api/log-duplikat/statistik', verifyToken, isAdmin, async (req, res) => {
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

// ══════ API TPS COMPARISON ═════════════════════════════

async function runTPSComparison(namaTps) {
  const dataTps = await query(`
    SELECT id, nama, jenis_kelamin, usia, dusun, alamat, rt, rw FROM data_tps WHERE nama_tps = ?
  `, [namaTps]);

  if (!dataTps.length) {
    const error = new Error('TPS tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }

  const pemilihLokal = await query(`
    SELECT p.id, p.nama, p.jenis_kelamin, 
           COALESCE(p.rt, k.rt) AS rt,
           COALESCE(p.rw, k.rw) AS rw,
           TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS usia,
           k.dusun, k.kordus
    FROM pemilih p
    LEFT JOIN kader k ON k.id = p.kader_id
    WHERE p.jenis_kelamin IS NOT NULL AND p.tanggal_lahir IS NOT NULL
  `);

  const startTime = Date.now();
  let cocok = 0, perluDicek = 0, tidakCocok = 0;

  await query(`
    DELETE hp
    FROM hasil_perbandingan hp
    JOIN data_tps dt ON dt.id = hp.data_tps_id
    WHERE dt.nama_tps = ?
  `, [namaTps]);

  // ── Optimization: Cari semua potential matches (skor >= 60) ──
  const potentialMatches = [];
  for (const tps of dataTps) {
    for (const pemilih of pemilihLokal) {
      const namaSimilarity = computeNameSimilarity(tps.nama, pemilih.nama);
      const ageSignal = computeAgeSignal(tps.usia, pemilih.usia);
      const locationSignal = computeLocationSignal(tps, pemilih);

      const totalScore = Math.round(
        (namaSimilarity * 0.70) +
        (ageSignal * 0.15) +
        (((locationSignal.dusunScore + locationSignal.rtScore) / 2) * 0.15)
      );

      if (totalScore >= 60) {
        potentialMatches.push({
          tpsId: tps.id,
          pemilihId: pemilih.id,
          score: totalScore,
          namaSimilarity,
          ageSignal,
          locationSignal
        });
      }
    }
  }

  // Sort berdasarkan skor tertinggi agar matching lebih adil (Greedy)
  potentialMatches.sort((a, b) => b.score - a.score);

  const usedTpsIds = new Set();
  const usedPemilihIds = new Set();
  const finalResults = new Map(); // tpsId -> matchData

  for (const match of potentialMatches) {
    if (usedTpsIds.has(match.tpsId) || usedPemilihIds.has(match.pemilihId)) continue;

    let status = 'TIDAK_COCOK';
    if (match.score >= 85) {
      status = 'COCOK';
      cocok++;
    } else {
      status = 'PERLU_DICEK';
      perluDicek++;
    }

    finalResults.set(match.tpsId, {
      pemilihId: match.pemilihId,
      score: match.score,
      namaSimilarity: match.namaSimilarity,
      status,
      catatan: `Skor: ${match.score}% (nama: ${match.namaSimilarity}%, usia: ${match.ageSignal}%, lokasi: ${Math.round((match.locationSignal.dusunScore + match.locationSignal.rtScore) / 2)}%)`
    });

    usedTpsIds.add(match.tpsId);
    usedPemilihIds.add(match.pemilihId);
  }

  // ── Simpan Hasil ──
  for (const tps of dataTps) {
    const match = finalResults.get(tps.id);
    const status = match ? match.status : 'TIDAK_COCOK';
    if (!match) tidakCocok++;

    const pemilihId = match ? match.pemilihId : null;
    const score = match ? match.score : 0;
    const namaSim = match ? match.namaSimilarity : 0;
    const catatan = match ? match.catatan : 'Tidak ada match';

    await query(`
      INSERT INTO hasil_perbandingan (pemilih_id, data_tps_id, skor_kemiripan_nama, skor_total, status_cocok, catatan)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        pemilih_id = VALUES(pemilih_id),
        skor_kemiripan_nama = VALUES(skor_kemiripan_nama),
        skor_total = VALUES(skor_total),
        status_cocok = VALUES(status_cocok),
        catatan = VALUES(catatan)
    `, [pemilihId, tps.id, namaSim, score, status, catatan]);
  }

  return {
    nama_tps: namaTps,
    durasi_ms: Date.now() - startTime,
    statistik: {
      total_data_tps: dataTps.length,
      total_pemilih: pemilihLokal.length,
      cocok,
      perlu_dicek: perluDicek,
      tidak_cocok: tidakCocok,
      persentase_cocok: dataTps.length ? Math.round((cocok / dataTps.length) * 100) : 0,
      persentase_optimal: dataTps.length ? Math.round(((cocok + perluDicek) / dataTps.length) * 100) : 0
    }
  };
}

async function refreshTPSComparisonIfNeeded(namaTps) {
  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?`,
    [namaTps]
  );
  const total = Number(countRow?.total || 0);

  if (total === 0) {
    await query(`
      DELETE hp
      FROM hasil_perbandingan hp
      JOIN data_tps dt ON dt.id = hp.data_tps_id
      WHERE dt.nama_tps = ?
    `, [namaTps]);
    return null;
  }

  return runTPSComparison(namaTps);
}

// 1️⃣ Upload data TPS dari Excel
app.post('/api/tps/upload', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
  try {
    await ensureTPSComparisonSchema();
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    
    const namaTps = String(req.body.nama_tps || '').trim();
    if (!namaTps) return res.status(400).json({ error: 'Nama TPS wajib diisi' });

    // Parse Excel
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = extractTPSRows(sheet);

    await query(`DELETE FROM data_tps WHERE nama_tps = ?`, [namaTps]);

    let berhasil = 0, gagal = 0;
    const detailGagal = [];

    for (let baris = 0; baris < rows.length; baris++) {
      const row = rows[baris];
      
      try {
        const nama = getSpreadsheetValue(row, ['nama', 'name']).toString().trim();
        const jenisKelaminStr = getSpreadsheetValue(row, ['jenis_kelamin', 'jk', 'gender']).toString().trim();
        const usiaStr = getSpreadsheetValue(row, ['usia', 'age']).toString().trim();
        const dusun = getSpreadsheetValue(row, ['dusun', 'hamlet']).toString().trim();
        const alamat = getSpreadsheetValue(row, ['alamat', 'address']).toString().trim();
        const rt = getSpreadsheetValue(row, ['rt']).toString().trim();
        const rw = getSpreadsheetValue(row, ['rw']).toString().trim();

        // Validasi required fields
        if (!nama) {
          detailGagal.push({ baris: baris + 1, nama: '(kosong)', error: 'Nama kosong' });
          gagal++;
          continue;
        }

        // Normalize gender
        const jenisKelamin = normalizeGender(jenisKelaminStr) || null;
        const usia = normalizeAge(usiaStr);

        if (!usia) {
          detailGagal.push({ baris: baris + 1, nama, error: 'Usia tidak valid' });
          gagal++;
          continue;
        }

        // Insert ke database
        await query(
          'INSERT INTO data_tps (nama_tps, nama, jenis_kelamin, usia, dusun, alamat, rt, rw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [namaTps, nama, jenisKelamin, usia, dusun, alamat, rt, rw]
        );
        berhasil++;
      } catch (err) {
        detailGagal.push({ baris: baris + 1, nama: getSpreadsheetValue(row, ['nama']), error: err.message });
        gagal++;
      }
    }

    let comparison = null;
    if (berhasil > 0) {
      comparison = await runTPSComparison(namaTps);
    }

    cleanupUploadedFile(req.file.path);
    res.status(201).json({
      status: 'success',
      message: comparison
        ? `Upload ${namaTps} berhasil: ${berhasil} data masuk, ${gagal} error. Perbandingan otomatis selesai.`
        : `Upload ${namaTps} berhasil: ${berhasil} data masuk, ${gagal} error`,
      data: {
        nama_tps: namaTps,
        total_berhasil: berhasil,
        total_gagal: gagal,
        detail_gagal: detailGagal.slice(0, 10),
        comparison
      }
    });
  } catch (e) {
    cleanupUploadedFile(req.file?.path);
    res.status(500).json({ error: e.message });
  }
});

// 2️⃣ List TPS yang sudah di-upload
app.get('/api/tps/list', verifyToken, isAdmin, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const pg = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pg - 1) * lim;

    // Group by nama_tps
    const [countRow] = await query(`
      SELECT COUNT(DISTINCT nama_tps) AS total FROM data_tps
    `);
    const total = countRow ? countRow.total : 0;

    const data = await query(`
      SELECT DISTINCT dt.nama_tps,
             COUNT(DISTINCT dt.id) AS total_data,
             MAX(dt.created_at) AS created_at,
             IF(COUNT(DISTINCT hp.data_tps_id) > 0, 'SUDAH_DIBANDING', 'BELUM_DIBANDING') AS status_perbandingan
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      GROUP BY dt.nama_tps
      ORDER BY MAX(dt.created_at) DESC
      LIMIT ? OFFSET ?
    `, [lim, offset]);

    res.json({
      data: data || [],
      pagination: {
        page: pg,
        limit: lim,
        total,
        totalPages: Math.ceil(total / lim) || 1
      }
    });
  } catch (e) { 
    console.error('❌ /api/tps/list error:', e.message);
    res.status(500).json({ error: e.message }); 
  }
});

// 2b️⃣ Detail data TPS mentah
app.get('/api/tps/:nama_tps/data', verifyToken, isAdmin, async (req, res) => {
  try {
    const namaTps = req.params.nama_tps;
    const pg = Math.max(1, parseInt(req.query.page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = (pg - 1) * lim;

    const [countRow] = await query(
      `SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?`,
      [namaTps]
    );

    const data = await query(`
      SELECT dt.id, dt.nama_tps, dt.nama, dt.jenis_kelamin, dt.usia, dt.dusun, dt.alamat, dt.rt, dt.rw,
             hp.status_cocok, hp.skor_total, hp.catatan, p.nama AS nama_pemilih
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      WHERE dt.nama_tps = ?
      ORDER BY dt.nama ASC
      LIMIT ? OFFSET ?
    `, [namaTps, lim, offset]);

    res.json({
      data,
      pagination: {
        page: pg,
        limit: lim,
        total: Number(countRow?.total || 0),
        totalPages: Math.ceil(Number(countRow?.total || 0) / lim) || 1
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3️⃣ Trigger perbandingan data TPS dengan pemilih lokal
app.post('/api/tps/:nama_tps/perbandingan', verifyToken, isAdmin, async (req, res) => {
  try {
    const namaTps = req.params.nama_tps;
    const result = await runTPSComparison(namaTps);

    res.json({
      status: 'success',
      message: 'Perbandingan selesai',
      data: result
    });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

// 3b️⃣ Update satu baris TPS
app.put('/api/tps/data/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await ensureTPSComparisonSchema();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID data TPS tidak valid' });

    const [existing] = await query(
      `SELECT id, nama_tps FROM data_tps WHERE id = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'Data TPS tidak ditemukan' });

    const nama = String(req.body.nama || '').trim();
    const jenisKelamin = normalizeGender(req.body.jenis_kelamin) || null;
    const usia = normalizeAge(req.body.usia);
    const dusun = String(req.body.dusun || '').trim();
    const alamat = String(req.body.alamat || '').trim();
    const rt = String(req.body.rt || '').trim();
    const rw = String(req.body.rw || '').trim();

    if (!nama) return res.status(400).json({ error: 'Nama wajib diisi' });
    if (!usia) return res.status(400).json({ error: 'Usia tidak valid' });

    await query(`
      UPDATE data_tps
      SET nama = ?, jenis_kelamin = ?, usia = ?, dusun = ?, alamat = ?, rt = ?, rw = ?
      WHERE id = ?
    `, [nama, jenisKelamin, usia, dusun, alamat, rt, rw, id]);

    const comparison = await refreshTPSComparisonIfNeeded(existing.nama_tps);
    res.json({ status: 'success', message: 'Data TPS berhasil diperbarui', data: { id, nama_tps: existing.nama_tps, comparison } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3c️⃣ Hapus satu baris TPS
app.delete('/api/tps/data/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID data TPS tidak valid' });

    const [existing] = await query(
      `SELECT id, nama_tps FROM data_tps WHERE id = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'Data TPS tidak ditemukan' });

    await query(`DELETE FROM data_tps WHERE id = ?`, [id]);
    const comparison = await refreshTPSComparisonIfNeeded(existing.nama_tps);
    res.json({ status: 'success', message: 'Baris TPS berhasil dihapus', data: { nama_tps: existing.nama_tps, comparison } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3d️⃣ Hapus satu TPS penuh
app.delete('/api/tps/:nama_tps', verifyToken, isAdmin, async (req, res) => {
  try {
    const namaTps = req.params.nama_tps;
    const [countRow] = await query(
      `SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?`,
      [namaTps]
    );
    if (!Number(countRow?.total || 0)) {
      return res.status(404).json({ error: 'TPS tidak ditemukan' });
    }

    await query(`DELETE FROM data_tps WHERE nama_tps = ?`, [namaTps]);
    res.json({ status: 'success', message: `TPS ${namaTps} berhasil dihapus` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4️⃣ List hasil perbandingan TPS
app.get('/api/tps/:nama_tps/hasil', verifyToken, isAdmin, async (req, res) => {
  try {
    const namaTps = req.params.nama_tps;
    const { page, limit, status, sort } = req.query;
    const pg = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pg - 1) * lim;

    let where = ` WHERE dt.nama_tps = ?`;
    const params = [namaTps];

    if (status && ['COCOK', 'PERLU_DICEK', 'TIDAK_COCOK'].includes(status)) {
      where += ` AND hp.status_cocok = ?`;
      params.push(status);
    }

    let orderBy = `ORDER BY hp.skor_total DESC`;
    if (sort === 'skor_asc') orderBy = `ORDER BY hp.skor_total ASC`;
    if (sort === 'status') orderBy = `ORDER BY FIELD(hp.status_cocok, 'COCOK', 'PERLU_DICEK', 'TIDAK_COCOK'), hp.skor_total DESC`;

    // Count
    const [countRow] = await query(`
      SELECT COUNT(*) AS total
      FROM hasil_perbandingan hp
      JOIN data_tps dt ON dt.id = hp.data_tps_id
      ${where}
    `, params);

    // Data
    const data = await query(`
      SELECT hp.id, hp.pemilih_id, dt.nama AS nama_tps, dt.jenis_kelamin AS jk_tps, dt.usia AS usia_tps, dt.dusun AS dusun_tps, dt.rt AS rt_tps, dt.rw AS rw_tps,
             p.nama AS nama_pemilih, p.jenis_kelamin AS jk_pemilih,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS usia_pemilih,
             k.dusun AS dusun_pemilih, k.kordus, k.rt AS rt_pemilih,
             hp.skor_kemiripan_nama, hp.skor_total, hp.status_cocok, hp.catatan
      FROM hasil_perbandingan hp
      JOIN data_tps dt ON dt.id = hp.data_tps_id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
      ${where}
      ${orderBy}
      LIMIT ? OFFSET ?
    `, [...params, lim, offset]);

    res.json({
      data,
      pagination: {
        page: pg,
        limit: lim,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / lim) || 1
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5️⃣ Statistik keseluruhan TPS
app.get('/api/tps/statistik', verifyToken, isAdmin, async (req, res) => {
  try {
    const [totalTps] = await query(`
      SELECT COUNT(DISTINCT nama_tps) AS total FROM data_tps
    `);

    const perbandingan = await query(`
      SELECT dt.nama_tps,
             COUNT(DISTINCT dt.id) AS total,
             COUNT(DISTINCT CASE WHEN hp.status_cocok = 'COCOK' THEN dt.id END) AS cocok,
             COUNT(DISTINCT CASE WHEN hp.status_cocok = 'PERLU_DICEK' THEN dt.id END) AS perlu_dicek,
             COUNT(DISTINCT CASE WHEN hp.status_cocok = 'TIDAK_COCOK' THEN dt.id END) AS tidak_cocok,
             ROUND(COUNT(DISTINCT CASE WHEN hp.status_cocok = 'COCOK' THEN dt.id END) / COUNT(DISTINCT dt.id) * 100, 2) AS persentase_cocok,
             ROUND(COUNT(DISTINCT CASE WHEN hp.status_cocok IN ('COCOK', 'PERLU_DICEK') THEN dt.id END) / COUNT(DISTINCT dt.id) * 100, 2) AS persentase_optimal
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      GROUP BY dt.nama_tps
      ORDER BY persentase_cocok DESC
    `);

    const [totalCocok] = await query(`
      SELECT COUNT(*) AS total FROM hasil_perbandingan WHERE status_cocok = 'COCOK'
    `);

    const [totalPerluDicek] = await query(`
      SELECT COUNT(*) AS total FROM hasil_perbandingan WHERE status_cocok = 'PERLU_DICEK'
    `);

    const [totalTidakCocok] = await query(`
      SELECT COUNT(*) AS total FROM hasil_perbandingan WHERE status_cocok = 'TIDAK_COCOK'
    `);

    res.json({
      status: 'success',
      data: {
        total_tps: totalTps.total || 0,
        perbandingan,
        ringkasan: {
          total_cocok_seluruh: totalCocok.total || 0,
          total_perlu_dicek_seluruh: totalPerluDicek.total || 0,
          total_tidak_cocok_seluruh: totalTidakCocok.total || 0
        }
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API ADMIN (Manage User) ────────────────────────
// Note: isAdmin and isSuperadmin are imported from ./middleware/auth

// Check admin status
app.get('/api/admin/check', verifyToken, isAdmin, (req, res) => {
  res.json({ isAdmin: true, user: req.user });
});

// Get all users
app.get('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const data = await query(`
      SELECT u.id, u.username, u.role, u.created_at
      FROM users u
      ORDER BY u.created_at DESC
    `);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create user
app.post('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username dan password (min 6 karakter) wajib diisi' });
    }

    // Cek username sudah ada
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update user (password only)
app.put('/api/admin/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.params.id;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, userId]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete user
app.delete('/api/admin/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
    }

    await query('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Placeholder admin history endpoints
app.get('/api/admin/login-history', verifyToken, isAdmin, async (req, res) => {
  res.json([]);
});

app.get('/api/admin/import-history', verifyToken, isAdmin, async (req, res) => {
  res.json([]);
});

// ── HTML pages ────────────────────────────────────────
app.get('/login',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/',               (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tambah-pemilih', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tambah-pemilih.html')));
app.get('/tambah-kader',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'tambah-kader.html')));
app.get('/kader',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'kader.html')));
app.get('/koordinator',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'koordinator.html')));
app.get('/edit-pemilih',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit-pemilih.html')));
app.get('/edit-kader',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit-kader.html')));
app.get('/view-kader',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'view-kader.html')));
app.get('/import',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'import.html')));
app.get('/log-duplikat',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'log-duplikat.html')));
app.get('/admin-dashboard',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html')));
app.get('/admin-users',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-users.html')));
app.get('/kelola-user',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'kelola-user.html')));
app.get('/upload-tps',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'upload-tps.html')));
app.get('/kelola-tps',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'kelola-tps.html')));
app.get('/perbandingan-tps',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'perbandingan-tps.html')));
app.get('/statistik-tps',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'statistik-tps.html')));

// ── Ensure role enum includes AdminKantor and User ──
async function ensureRoleEnum() {
  try {
    const [row] = await query(
      `SELECT COLUMN_TYPE FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'users' AND column_name = 'role'`,
      [process.env.DB_NAME || 'pendataan_pemilih']
    );
    if (!row || !row.COLUMN_TYPE) return;

    // If AdminKantor or User is missing, alter enum
    if (!row.COLUMN_TYPE.includes('AdminKantor') || !row.COLUMN_TYPE.includes('User')) {
      console.log('🔧 Memperbarui enum users.role (menambah AdminKantor dan User)');
      await query(
        "ALTER TABLE users MODIFY COLUMN role ENUM('Superadmin','AdminKantor','Kader','User') NOT NULL DEFAULT 'User'"
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
  await ensureKoordinatorSchema();
  await ensureTPSComparisonSchema();
  await ensureRoleEnum();
  await ensureNikColumnsFlexible();
  app.listen(PORT, () => console.log(`✅ Server berjalan di http://localhost:${PORT}`));
}
start();
