
// ════════════════════════════════════════
//  server.js — Express + MySQL (v3 — Auth)
// ════════════════════════════════════════
require('dotenv').config();
const express  = require('express');
const path     = require('path');
const { query, testConnection } = require('./db');

const app    = express();
const PORT   = process.env.PORT || 3000;

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

const { genId } = require('./utils/voterHelpers');

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

// ══════ ROUTES ═════════════════════════════════════════
const authRoutes = require('./routes/auth');
const kaderRoutes = require('./routes/kader');
const pemilihRoutes = require('./routes/pemilih');

app.use('/api', authRoutes);
app.use('/api', kaderRoutes);
app.use('/api', pemilihRoutes);
app.use('/api/tps', require('./routes/tps'));

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
app.get('/peta-sitimulyo',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'peta-sitimulyo.html')));
app.get('/peta-kader',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'peta-kader.html')));
app.get('/non-dpt',               (req, res) => res.sendFile(path.join(__dirname, 'public', 'non-dpt.html')));
app.get('/laporan-dusun',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'laporan-dusun.html')));

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

// 🔄 Auto-compare TPS yang sudah ada di database tapi belum pernah dibandingkan
async function autoCompareUnprocessedTPS() {
  try {
    const { runTPSComparison } = require('./services/tpsService');

    // Cari TPS yang belum punya SATUPUN hasil perbandingan
    const unprocessed = await query(`
      SELECT DISTINCT dt.nama_tps
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      WHERE hp.id IS NULL
      ORDER BY dt.nama_tps ASC
    `);

    if (!unprocessed.length) {
      console.log('✅ [AUTO-COMPARE] Semua TPS sudah pernah dibandingkan.');
      return;
    }

    console.log(`🔄 [AUTO-COMPARE] Ditemukan ${unprocessed.length} TPS yang belum dibandingkan. Memulai pencocokan otomatis...`);

    for (const row of unprocessed) {
      try {
        console.log(`   ⏳ [AUTO-COMPARE] Memproses TPS: ${row.nama_tps}`);
        const result = await runTPSComparison(row.nama_tps);
        console.log(`   ✅ [AUTO-COMPARE] Selesai ${row.nama_tps}: cocok=${result.statistik.cocok}, perlu_dicek=${result.statistik.perlu_dicek}, tidak_cocok=${result.statistik.tidak_cocok}`);
      } catch (err) {
        console.error(`   ❌ [AUTO-COMPARE] Gagal proses TPS ${row.nama_tps}:`, err.message);
      }
    }

    console.log('🎉 [AUTO-COMPARE] Pencocokan otomatis selesai untuk semua TPS yang tertunda.');
  } catch (err) {
    console.error('❌ [AUTO-COMPARE] Gagal menjalankan auto-compare saat startup:', err.message);
  }
}

async function start() {
  await testConnection();
  await ensureKoordinatorSchema();
  await ensureTPSComparisonSchema();
  await ensureRoleEnum();
  await ensureNikColumnsFlexible();
  app.listen(PORT, () => {
    console.log(`✅ Server berjalan di http://localhost:${PORT}`);
    // Jalankan pencocokan otomatis di background setelah server siap
    setImmediate(() => autoCompareUnprocessedTPS());
  });
}
start();
