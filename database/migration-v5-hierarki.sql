-- ════════════════════════════════════════════════════
--  MIGRATION v5: Hierarki Dusun-Kordus-Korlap
--  Tambah kolom dusun, kordus, korlap ke tabel kader
-- ════════════════════════════════════════════════════

USE pendataan_pemilih;

-- Tambah kolom dusun (wajib)
ALTER TABLE kader ADD COLUMN dusun VARCHAR(100) NOT NULL DEFAULT '' AFTER nomor;

-- Tambah kolom kordus (wajib)
ALTER TABLE kader ADD COLUMN kordus VARCHAR(100) NOT NULL DEFAULT '' AFTER dusun;

-- Tambah kolom korlap (opsional)
ALTER TABLE kader ADD COLUMN korlap VARCHAR(100) DEFAULT NULL AFTER kordus;

-- ═══ Selesai! Restart server: node server.js ═══