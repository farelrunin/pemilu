-- ════════════════════════════════════════════════════
--  MIGRATION: Overhaul Database Schema
--  Jalankan sekali di MySQL sebelum restart server
-- ════════════════════════════════════════════════════

USE pendataan_pemilih;

-- ═══ 1. Tabel log_duplikat (audit kecurangan) ═══
CREATE TABLE IF NOT EXISTS log_duplikat (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nik_target CHAR(16) NOT NULL,
    nama_input VARCHAR(100) NOT NULL,
    kader_id_pelaku VARCHAR(20) NOT NULL,
    kader_id_existing VARCHAR(20) DEFAULT NULL,
    nama_existing VARCHAR(100) DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    KEY idx_log_nik (nik_target),
    KEY idx_log_kader (kader_id_pelaku),
    KEY idx_log_created (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ═══ 2. Tambah kolom target_suara di kader ═══
ALTER TABLE kader ADD COLUMN target_suara INT NOT NULL DEFAULT 0 AFTER nomor;

-- ═══ 3. Tambah kolom baru di pemilih ═══
ALTER TABLE pemilih ADD COLUMN tanggal_lahir DATE DEFAULT NULL AFTER nik;
ALTER TABLE pemilih ADD COLUMN jenis_kelamin ENUM('L','P') DEFAULT NULL AFTER tanggal_lahir;

-- ═══ 4. Migrasi data umur → tanggal_lahir (estimasi) ═══
UPDATE pemilih SET tanggal_lahir = DATE_SUB(CURDATE(), INTERVAL umur YEAR) WHERE umur IS NOT NULL AND umur > 0;

-- ═══ 5. Hapus kolom lama ═══
ALTER TABLE pemilih DROP COLUMN umur;
ALTER TABLE pemilih DROP COLUMN is_duplikat;
ALTER TABLE pemilih DROP COLUMN duplikat_info;

-- ═══ 6. Hapus index duplikat ═══
-- (index mungkin sudah terhapus otomatis saat kolom dihapus)
-- ALTER TABLE pemilih DROP INDEX idx_pemilih_duplikat;

-- ═══ Selesai! ═══
-- Restart server: node server.js
