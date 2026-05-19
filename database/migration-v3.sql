-- ════════════════════════════════════════════════════
--  MIGRATION v3: Smart Log (UPSERT)
--  Rebuild log_duplikat with composite PK + counter
-- ════════════════════════════════════════════════════

USE pendataan_pemilih;

-- Backup & drop old table
DROP TABLE IF EXISTS log_duplikat;

-- New smart log table
CREATE TABLE log_duplikat (
    nik_target CHAR(16) NOT NULL,
    kader_id_pelaku VARCHAR(20) NOT NULL,
    nama_input VARCHAR(100) DEFAULT NULL,
    kader_id_existing VARCHAR(20) DEFAULT NULL,
    nama_existing VARCHAR(100) DEFAULT NULL,
    jumlah_percobaan INT NOT NULL DEFAULT 1,
    waktu_pertama DATETIME DEFAULT CURRENT_TIMESTAMP,
    waktu_terakhir DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (nik_target, kader_id_pelaku),
    KEY idx_log_kader (kader_id_pelaku),
    KEY idx_log_waktu (waktu_terakhir)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ═══ Selesai! Restart server: node server.js ═══
