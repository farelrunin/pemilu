-- ════════════════════════════════════════════════════
--  Migration v10 — Tabel Data TPS & Hasil Perbandingan
-- ════════════════════════════════════════════════════

USE pendataan_pemilih;

-- ── Tabel Data TPS (data dari file Excel/PDF TPS) ───
CREATE TABLE IF NOT EXISTS data_tps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_tps VARCHAR(50) NOT NULL COMMENT 'Contoh: TPS 01, TPS 02',
    nama VARCHAR(100) NOT NULL,
    jenis_kelamin ENUM('L','P') DEFAULT NULL,
    usia INT DEFAULT NULL,
    dusun VARCHAR(100) DEFAULT NULL,
    rt VARCHAR(10) DEFAULT NULL,
    rw VARCHAR(10) DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    KEY idx_data_tps_nama (nama),
    KEY idx_data_tps_nama_tps (nama_tps),
    KEY idx_data_tps_dusun (dusun)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ── Tabel Hasil Perbandingan ─────────────────────────
CREATE TABLE IF NOT EXISTS hasil_perbandingan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pemilih_id VARCHAR(20) NOT NULL,
    data_tps_id INT NOT NULL,
    skor_kemiripan_nama DECIMAL(5,2) NOT NULL COMMENT '0-100%',
    skor_total DECIMAL(5,2) NOT NULL COMMENT '0-100%',
    status_cocok ENUM('COCOK','PERLU_DICEK','TIDAK_COCOK') NOT NULL DEFAULT 'TIDAK_COCOK',
    catatan VARCHAR(255) DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_hasil (pemilih_id, data_tps_id),
    KEY idx_hasil_status (status_cocok),
    KEY idx_hasil_pemilih (pemilih_id),
    KEY idx_hasil_tps (data_tps_id),
    CONSTRAINT fk_hasil_pemilih FOREIGN KEY (pemilih_id) REFERENCES pemilih (id) ON DELETE CASCADE,
    CONSTRAINT fk_hasil_tps FOREIGN KEY (data_tps_id) REFERENCES data_tps (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ════════════════════════════════════════════════════
--  Selesai! Jalankan: node run-migration.js
-- ════════════════════════════════════════════════════

