-- ════════════════════════════════════════════════════
--  SETUP DATABASE UNTUK RAILWAY
--  Jalankan file ini di console MySQL Railway kamu.
-- ════════════════════════════════════════════════════

-- 1. Tabel Koordinator
CREATE TABLE IF NOT EXISTS koordinator (
    id VARCHAR(20) PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_koordinator_nama (nama)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 2. Tabel Kader
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

-- 3. Tabel Pemilih
CREATE TABLE IF NOT EXISTS pemilih (
    id VARCHAR(20) PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    nik VARCHAR(32) DEFAULT NULL,
    tanggal_lahir DATE DEFAULT NULL,
    jenis_kelamin ENUM('L','P') DEFAULT NULL,
    status VARCHAR(50) DEFAULT NULL,
    kader_id VARCHAR(20) NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_pemilih_nik (nik),
    FULLTEXT KEY ft_pemilih_nama (nama),
    KEY idx_pemilih_kader (kader_id),
    CONSTRAINT fk_pemilih_kader FOREIGN KEY (kader_id) REFERENCES kader (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 4. Tabel Log Duplikat
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

-- 5. Tabel Users (Penting untuk login)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(20) NOT NULL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('Superadmin','AdminKantor','Kader') NOT NULL DEFAULT 'Kader',
    id_kader VARCHAR(20) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_users_kader (id_kader),
    CONSTRAINT fk_users_kader FOREIGN KEY (id_kader) REFERENCES kader(id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 6. Tabel Data TPS (Untuk perbandingan)
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
    KEY idx_data_tps_nama_tps (nama_tps)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 7. Tabel Hasil Perbandingan
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
    CONSTRAINT fk_hasil_pemilih FOREIGN KEY (pemilih_id) REFERENCES pemilih (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
