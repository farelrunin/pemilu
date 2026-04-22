-- ════════════════════════════════════════════════════
--  MIGRATION v7: Tambah Kolom Status Pemilih
--  Tambah kolom status untuk menandai data bermasalah
-- ════════════════════════════════════════════════════

USE pendataan_pemilih;

-- Tambah kolom status (opsional) - untuk menandai data bermasalah
ALTER TABLE pemilih ADD COLUMN status VARCHAR(50) DEFAULT NULL AFTER jenis_kelamin;

-- ═══ Selesai! Restart server: node server.js ═══