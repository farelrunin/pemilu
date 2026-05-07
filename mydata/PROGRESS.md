# 📊 Status Progress Aplikasi Pemilu — 27 April 2026

## ✅ SUDAH SELESAI

### Backend Infrastructure
- [x] Express + MySQL setup
- [x] Authentication (login, register, token-based)
- [x] Authorization (Superadmin, Kader roles)
- [x] Database schema (koordinator, kader, pemilih, users, log_duplikat)
- [x] Multer (file upload) dan XLSX (Excel parsing) library

### Backend Logic
- [x] Helper functions untuk fuzzy matching:
  - `levenshteinDistance()` — string similarity algorithm
  - `computeNameSimilarity()` — fuzzy name matching (Levenshtein + token overlap)
  - `computeAgeSignal()` — age proximity scoring
  - `computeLocationSignal()` — dusun/RT/RW matching
  - `parseNIK()` — extract birth date & gender dari NIK
- [x] Schema untuk TPS comparison:
  - Tabel `data_tps` — storage untuk data TPS yang di-upload
  - Tabel `hasil_perbandingan` — hasil matching antara pemilih & TPS data

### Frontend
- [x] Login page
- [x] Dashboard (index.html) — daftar pemilih & kader
- [x] Add/Edit Kader
- [x] Add/Edit Pemilih (dengan NIK auto-parsing)
- [x] View Kader details
- [x] Koordinator management

---

## ❌ BELUM SELESAI — Fitur Perbandingan dengan Data TPS

### Backend Endpoints (DIPERLUKAN)
- [ ] `POST /api/tps/upload` — Upload Excel data TPS
  - Input: file Excel + nama_tps
  - Parse & validasi format (NAMA, JENIS KELAMIN, USIA, DUSUN, ALAMAT, RT, RW)
  - INSERT ke tabel `data_tps`
  - Output: berhasil N baris, gagal M baris, detail error

- [ ] `GET /api/tps/list` — List semua TPS yang sudah di-upload
  - Pagination + filter by nama_tps
  - Return: tabel dengan kolom nama_tps, total_data, tgl_upload

- [ ] `POST /api/tps/:nama_tps/perbandingan` — Trigger perbandingan
  - Ambil semua data dari data_tps dengan nama_tps tertentu
  - Ambil semua pemilih dari database lokal
  - Jalankan algorithm matching untuk setiap pasangan
  - INSERT hasil ke tabel `hasil_perbandingan`
  - Output: statistik hasil (cocok, perlu_dicek, tidak_cocok, durasi)

- [ ] `GET /api/tps/:nama_tps/hasil` — Lihat hasil perbandingan
  - Pagination + sorting
  - Return: detail matching per record (nama pemilih, nama TPS, skor, status)

- [ ] `GET /api/tps/statistik` — Statistik keseluruhan
  - Total pemilih lokal
  - Total data TPS per lokasi
  - Persentase cocok (cocok / total TPS)
  - Breakdown per status (COCOK, PERLU_DICEK, TIDAK_COCOK)

### Frontend Pages (DIPERLUKAN)
- [ ] `upload-tps.html` — Upload data TPS
  - Drag & drop area untuk file Excel
  - Input field: nama TPS
  - Preview data sebelum upload
  - Hasil upload: berhasil/gagal summary

- [ ] `perbandingan-tps.html` — Dashboard perbandingan
  - Pilih TPS mana yang ingin dibandingkan
  - Tombol "Bandingkan Sekarang"
  - Tabel hasil dengan kolom:
    * Nama Pemilih (Anda)
    * Nama TPS
    * Skor Kesamaan
    * Usia (Anda vs TPS)
    * Dusun (Anda vs TPS)
    * Status (COCOK / PERLU_DICEK / TIDAK_COCOK)
    * Aksi (Tandai Manual / Abaikan)

- [ ] `statistik-tps.html` — Statistik & insight
  - Card summary: Total TPS, Total Cocok, Persentase Cocok
  - Chart: breakdown per status
  - Chart: persentase per TPS
  - List kader dengan ranking "dipilih vs target"

---

## 🔧 MATCHING ALGORITHM

Skor perbandingan dihitung dari:
1. **Nama Similarity** (70% weight)
   - Levenshtein distance + token overlap
   - Range: 0-100

2. **Usia Proximity** (15% weight)
   - Persis = 100
   - Beda 1 = 85
   - Beda 2 = 70
   - Beda 4 = 45
   - Beda > 4 = 0

3. **Lokasi Proximity** (15% weight)
   - Dusun/RT/RW matching
   - Dusun samaan = 100, RT samaan = 100

**Status Decision:**
- **COCOK** — skor >= 85 AND (nama similarity >= 80 OR (usia perfect AND lokasi perfect))
- **PERLU_DICEK** — skor >= 60 AND skor < 85
- **TIDAK_COCOK** — skor < 60

---

## 📋 Data Flow

```
📄 PDF TPS (28 records)
  ↓
  Convert ke Excel (jika perlu)
  ↓
  Upload via upload-tps.html
  ↓
  POST /api/tps/upload
  ↓
  Parse Excel → Validasi → INSERT data_tps
  ↓
  POST /api/tps/{nama_tps}/perbandingan
  ↓
  Loop setiap data_tps:
    - Cari match di pemilih table
    - Hitung skor similarity
    - INSERT hasil_perbandingan
  ↓
  GET /api/tps/{nama_tps}/hasil
  ↓
  Display di perbandingan-tps.html dengan chart & tabel
```

---

## 🎯 User Flow (Logika Bisnis)

**Scenario:** Anda punya 150 orang data pemilih. TPS SITIMULYO punya 28 orang.

1. **Upload:** Upload Excel TPS → 28 records masuk database
2. **Bandingkan:** Sistem compare 28 orang TPS lawan 150 orang Anda
3. **Hasil:** 
   - 18 orang cocok (COCOK)
   - 5 orang perlu cek (PERLU_DICEK)
   - 5 orang tidak cocok (TIDAK_COCOK)
4. **Insight:** 
   - **Persentase Cocok = 18/28 = 64%** (peluang menang di TPS ini)
   - 5 orang perlu verifikasi manual (kemungkinan cocok kalau typo dibetulin)
   - 5 orang benar-benar tidak ada di TPS (diluar target area)

---

## 🚀 Urutan Implementasi

### Phase 1: Backend (Priority High)
1. Lengkapi schema `data_tps` dan `hasil_perbandingan`
2. Implement `POST /api/tps/upload`
3. Implement `POST /api/tps/{nama_tps}/perbandingan` (matching algorithm)
4. Implement `GET /api/tps/{nama_tps}/hasil`
5. Implement `GET /api/tps/statistik`

### Phase 2: Frontend (Priority High)
1. Create `upload-tps.html`
2. Create `perbandingan-tps.html` + JS logic
3. Create `statistik-tps.html` + charts
4. Update `index.html` navbar — link ke halaman baru

### Phase 3: Polish
1. Error handling & validation
2. UI/UX improvements
3. Export hasil ke Excel
4. Audit log untuk setiap perbandingan

---

## 💾 Database Schema (Existing)

```sql
-- Tabel untuk menyimpan data TPS yang di-upload
CREATE TABLE data_tps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama_tps VARCHAR(100) NOT NULL,        -- nama lokasi TPS (e.g., "SITIMULYO")
  nama VARCHAR(100) NOT NULL,             -- nama dari TPS
  jenis_kelamin ENUM('L','P'),            -- gender
  usia INT,                               -- age
  dusun VARCHAR(100),                     -- hamlet/village
  alamat VARCHAR(255),                    -- address
  rt VARCHAR(10),                         -- RT (neighborhood)
  rw VARCHAR(10),                         -- RW (ward)
  created_at DATETIME DEFAULT NOW(),
  KEY idx_nama (nama),
  KEY idx_nama_tps (nama_tps),
  KEY idx_rt_rw (rt, rw)
);

-- Tabel hasil perbandingan
CREATE TABLE hasil_perbandingan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pemilih_id VARCHAR(20),                 -- ID pemilih lokal (NULL jika tidak cocok)
  data_tps_id INT NOT NULL,               -- ID data TPS
  skor_kemiripan_nama DECIMAL(5,2),       -- name similarity (0-100)
  skor_total DECIMAL(5,2),                -- overall score (weighted)
  status_cocok ENUM('COCOK','PERLU_DICEK','TIDAK_COCOK'),
  catatan VARCHAR(255),                   -- notes
  created_at DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_hasil_tps (data_tps_id),
  KEY idx_pemilih (pemilih_id),
  KEY idx_status (status_cocok)
);

-- Tabel users (sudah ada)
CREATE TABLE users (
  id VARCHAR(20) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('superadmin','kader') DEFAULT 'kader',
  id_kader VARCHAR(20),
  created_at DATETIME DEFAULT NOW(),
  FOREIGN KEY (id_kader) REFERENCES kader(id)
);

-- Tabel kader (sudah ada)
CREATE TABLE kader (
  id VARCHAR(20) PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  nomor INT NOT NULL UNIQUE,
  dusun VARCHAR(100) DEFAULT '',
  kordus VARCHAR(100) DEFAULT '',
  koordinator_id VARCHAR(20),
  target_suara INT DEFAULT 0,
  created_at DATETIME DEFAULT NOW()
);

-- Tabel pemilih (sudah ada)
CREATE TABLE pemilih (
  id VARCHAR(20) PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  nik VARCHAR(32),
  tanggal_lahir DATE,
  jenis_kelamin ENUM('L','P'),
  kader_id VARCHAR(20) NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  FULLTEXT KEY ft_nama (nama),
  UNIQUE KEY uq_nik (nik),
  FOREIGN KEY (kader_id) REFERENCES kader(id)
);
```

---

## 📝 Next Step
1. Review rencana ini ✅
2. Tentukan prioritas (quick win vs kompleks)
3. Mulai backend endpoint `POST /api/tps/upload`
