-- ════════════════════════════════════════════════════
--  MIGRATION v4: Authentication & RBAC
--  Tabel users untuk otentikasi
-- ════════════════════════════════════════════════════

USE pendataan_pemilih;

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

-- ═══ Selesai! Jalankan: node seed-admin.js untuk buat akun Superadmin ═══
