-- ════════════════════════════════════════════════════
--  MIGRATION v6: Tambah Kolom RT
--  Tambah kolom rt ke tabel kader (bisa nomor atau nama)
-- ════════════════════════════════════════════════════

USE pendataan_pemilih;

-- Tambah kolom rt (opsional) - bisa nomor atau nama
ALTER TABLE kader ADD COLUMN rt VARCHAR(50) DEFAULT NULL AFTER korlap;

-- ═══ Selesai! Restart server: node server.js ═══
