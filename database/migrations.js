// ════════════════════════════════════════
//  database/migrations.js
//  Semua fungsi ensure schema & migrasi kolom
//  dipanggil saat startup dari server.js
// ════════════════════════════════════════
'use strict';

const { query } = require('../db');

// ── Helper: inspeksi skema ────────────────────────────

async function hasColumn(table, column) {
  const res = await query(
    `SELECT COUNT(*) AS n
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [process.env.DB_NAME || 'pendataan_pemilih', table, column]
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

// ── Migrasi: tabel koordinator & relasi kader ─────────

async function ensureKoordinatorSchema() {
  const { genId } = require('../utils/voterHelpers');
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS koordinator (
        id VARCHAR(20) PRIMARY KEY,
        nama VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT NOW(),
        UNIQUE KEY uq_koordinator_nama (nama)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensureColumn('kader', 'koordinator_id', 'koordinator_id VARCHAR(20) NULL AFTER kordus');

    if (!(await hasIndex('kader', 'idx_kader_koordinator'))) {
      await query('ALTER TABLE kader ADD INDEX idx_kader_koordinator (koordinator_id)');
    }

    if (!(await hasForeignKey('kader', 'fk_kader_koordinator'))) {
      await query(`
        ALTER TABLE kader
        ADD CONSTRAINT fk_kader_koordinator
        FOREIGN KEY (koordinator_id) REFERENCES koordinator(id)
        ON UPDATE CASCADE ON DELETE SET NULL
      `);
    }

    // Migrasi data legacy kordus → koordinator
    const legacyKoordinator = await query(
      `SELECT DISTINCT TRIM(kordus) AS nama FROM kader WHERE TRIM(COALESCE(kordus,'')) <> ''`
    );

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
      WHERE k.koordinator_id IS NULL AND TRIM(COALESCE(k.kordus,'')) <> ''
    `);

    await query(`
      UPDATE kader k
      JOIN koordinator ko ON ko.id = k.koordinator_id
      SET k.kordus = ko.nama
      WHERE COALESCE(k.kordus,'') <> ko.nama
    `);
  } catch (err) {
    console.warn('[Migration] Gagal ensureKoordinatorSchema:', err.message);
  }
}

// ── Migrasi: tabel data_tps & hasil_perbandingan ──────

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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensureColumn('data_tps', 'alamat', 'alamat VARCHAR(255) DEFAULT NULL AFTER dusun');
    await ensureColumn('data_tps', 'rt',     'rt VARCHAR(10) DEFAULT NULL AFTER alamat');
    await ensureColumn('data_tps', 'rw',     'rw VARCHAR(10) DEFAULT NULL AFTER rt');

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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Pastikan nullable
    const hasilMeta = await getColumnMeta('hasil_perbandingan', 'pemilih_id');
    if (hasilMeta && hasilMeta.IS_NULLABLE !== 'YES') {
      await query('ALTER TABLE hasil_perbandingan MODIFY COLUMN pemilih_id VARCHAR(20) NULL');
    }

    // Bersihkan duplikat sebelum tambah unique key
    await query(`
      DELETE hp1 FROM hasil_perbandingan hp1
      JOIN hasil_perbandingan hp2
        ON hp1.data_tps_id = hp2.data_tps_id AND hp1.id < hp2.id
    `);

    if (await hasIndex('hasil_perbandingan', 'uq_hasil')) {
      await query('ALTER TABLE hasil_perbandingan DROP INDEX uq_hasil');
    }

    if ((await hasIndex('hasil_perbandingan', 'idx_hasil_tps')) && !(await hasIndex('hasil_perbandingan', 'uq_hasil_tps'))) {
      if (await hasForeignKey('hasil_perbandingan', 'fk_hasil_tps')) {
        await query('ALTER TABLE hasil_perbandingan DROP FOREIGN KEY fk_hasil_tps');
      }
      await query('ALTER TABLE hasil_perbandingan DROP INDEX idx_hasil_tps');
    }

    if (!(await hasIndex('hasil_perbandingan', 'uq_hasil_tps'))) {
      await query('ALTER TABLE hasil_perbandingan ADD UNIQUE KEY uq_hasil_tps (data_tps_id)');
    }

    if (!(await hasForeignKey('hasil_perbandingan', 'fk_hasil_tps'))) {
      await query(`
        ALTER TABLE hasil_perbandingan
        ADD CONSTRAINT fk_hasil_tps FOREIGN KEY (data_tps_id) REFERENCES data_tps(id) ON DELETE CASCADE
      `);
    }

    await ensureColumn('pemilih', 'status', 'status VARCHAR(50) DEFAULT NULL AFTER jenis_kelamin');
    await ensureColumn('pemilih', 'rt',     'rt VARCHAR(10) DEFAULT NULL AFTER status');
    await ensureColumn('pemilih', 'rw',     'rw VARCHAR(10) DEFAULT NULL AFTER rt');
    await ensureColumn('kader',   'rt',     'rt VARCHAR(10) DEFAULT NULL AFTER kordus');
    await ensureColumn('kader',   'rw',     'rw VARCHAR(10) DEFAULT NULL AFTER rt');
  } catch (err) {
    console.warn('[Migration] Gagal ensureTPSComparisonSchema:', err.message);
  }
}

// ── Migrasi: role enum & panjang kolom NIK ────────────

async function ensureRoleEnum() {
  try {
    const [row] = await query(
      `SELECT COLUMN_TYPE FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'users' AND column_name = 'role'`,
      [process.env.DB_NAME || 'pendataan_pemilih']
    );
    if (!row || !row.COLUMN_TYPE) return;
    if (!row.COLUMN_TYPE.includes('AdminKantor') || !row.COLUMN_TYPE.includes('User')) {
      await query(
        "ALTER TABLE users MODIFY COLUMN role ENUM('Superadmin','AdminKantor','Kader','User') NOT NULL DEFAULT 'User'"
      );
    }
  } catch (err) {
    console.warn('[Migration] Gagal ensureRoleEnum:', err.message);
  }
}

async function ensureNikColumnsFlexible() {
  try {
    const pemilihNik = await getColumnMeta('pemilih', 'nik');
    if (pemilihNik && (
      Number(pemilihNik.CHARACTER_MAXIMUM_LENGTH || 0) < 32 ||
      pemilihNik.IS_NULLABLE !== 'YES'
    )) {
      await query('ALTER TABLE pemilih MODIFY COLUMN nik VARCHAR(32) NULL');
    }

    const logNik = await getColumnMeta('log_duplikat', 'nik_target');
    if (logNik && Number(logNik.CHARACTER_MAXIMUM_LENGTH || 0) < 32) {
      await query('ALTER TABLE log_duplikat MODIFY COLUMN nik_target VARCHAR(32) NOT NULL');
    }
  } catch (err) {
    console.warn('[Migration] Gagal ensureNikColumnsFlexible:', err.message);
  }
}

// ── Export semua ──────────────────────────────────────

module.exports = {
  ensureKoordinatorSchema,
  ensureTPSComparisonSchema,
  ensureRoleEnum,
  ensureNikColumnsFlexible,
  hasColumn,
  getColumnMeta,
  hasIndex,
  hasForeignKey,
  ensureColumn,
};