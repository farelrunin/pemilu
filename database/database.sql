-- ════════════════════════════════════════════════════
--  PENDATAAN PEMILIH — Setup Database MySQL (v2)
--  Jalankan file ini sekali untuk fresh install
-- ════════════════════════════════════════════════════

-- 1. Buat database (jika belum ada)
CREATE DATABASE IF NOT EXISTS pendataan_pemilih CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE pendataan_pemilih;

-- ── Tabel Kader ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS koordinator (
    id VARCHAR(20) PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_koordinator_nama (nama)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS kader (
    id VARCHAR(20) PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    nomor INT NOT NULL,
    dusun VARCHAR(100) NOT NULL DEFAULT '',
    kordus VARCHAR(100) NOT NULL DEFAULT '',
    koordinator_id VARCHAR(20) DEFAULT NULL,
    target_suara INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_kader_nomor (nomor),
    KEY idx_kader_koordinator (koordinator_id),
    CONSTRAINT fk_kader_koordinator FOREIGN KEY (koordinator_id) REFERENCES koordinator (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ── Tabel Pemilih ────────────────────────────────────
CREATE TABLE IF NOT EXISTS pemilih (
    id VARCHAR(20) PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    nik VARCHAR(32) DEFAULT NULL,
    tanggal_lahir DATE DEFAULT NULL,
    jenis_kelamin ENUM('L','P') DEFAULT NULL,
    kader_id VARCHAR(20) NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    -- NIK unik bila tersedia (NULL boleh lebih dari satu)
    UNIQUE KEY uq_pemilih_nik (nik),
    -- FULLTEXT untuk pencarian nama cepat
    FULLTEXT KEY ft_pemilih_nama (nama),
    KEY idx_pemilih_kader (kader_id),
    CONSTRAINT fk_pemilih_kader FOREIGN KEY (kader_id) REFERENCES kader (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ── Tabel Log Duplikat (Audit Kecurangan) ────────────
CREATE TABLE IF NOT EXISTS log_duplikat (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nik_target VARCHAR(32) NOT NULL,
    nama_input VARCHAR(100) NOT NULL,
    kader_id_pelaku VARCHAR(20) NOT NULL,
    kader_id_existing VARCHAR(20) DEFAULT NULL,
    nama_existing VARCHAR(100) DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    KEY idx_log_nik (nik_target),
    KEY idx_log_kader (kader_id_pelaku),
    KEY idx_log_created (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ════════════════════════════════════════════════════
--  Selesai! Jalankan: node server.js
-- ════════════════════════════════════════════════════
