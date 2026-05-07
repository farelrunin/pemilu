# 📊 TPS Comparison — Business Logic Explained

**Tanggal**: 27 April 2026  
**Status**: ✅ Updated - Business Logic Clarified

---

## 🎯 INTI SISTEMNYA

### Data Yang Ada
```
Database Anda (Lokal):
├─ ~Ribuan orang yang akan memilih bosmu
└─ Tersimpan di table: pemilih

Dari Pemerintah (File TPS):
├─ TPS SITIMULYO: 28 orang (daftar resmi pemilih di TPS itu)
├─ TPS TEMBALANG: 45 orang
├─ TPS KOKAH: 32 orang
└─ dst... (bisa banyak TPS)
```

---

## ❓ PERTANYAAN YANG DIJAWAB

### Saat Upload File TPS SITIMULYO (28 orang):

```
PERTANYAAN:
"Dari 28 orang di TPS SITIMULYO ini, berapa banyak yang 
sudah ada di database ribuan orang saya?"

SISTEM AKAN:
1. Ambil 28 orang dari file TPS SITIMULYO
2. Bandingkan dengan ribuan orang di database lokal
3. Cari kecocokan: nama, usia, lokasi
4. Classify: COCOK / PERLU_DICEK / TIDAK_COCOK

HASIL:
✓ COCOK:        18 orang (64%) → Ada di database, nama & data match
⚠ PERLU DICEK:   5 orang (18%) → Ada di database tapi ada typo/minor diff
✗ TIDAK COCOK:   5 orang (18%) → TIDAK ada di database

KESIMPULAN:
→ Di TPS SITIMULYO ini, saya punya coverage 64-82%
→ Berarti dari 28 pemilih di TPS, saya bisa jangkau 18-23 orang
→ 5 orang masih perlu diverifikasi apakah valid
→ 5 orang di luar coverage area saya
```

---

## 📊 FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────┐
│ USER: Upload file TPS (contoh: SITIMULYO.csv)           │
│ Format: NAMA | JK | USIA | DUSUN | ALAMAT | RT | RW    │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ SISTEM: Parse & Simpan ke table data_tps                │
│ Result: "28 data TPS SITIMULYO berhasil diupload"       │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ USER: Click "Bandingkan"                                │
│ (Klik dari halaman /perbandingan-tps)                   │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ SISTEM: Matching Algorithm                              │
│ ├─ Loop setiap orang di TPS (28x)                       │
│ ├─ Cari best match di database lokal (~ribuan)          │
│ ├─ Hitung score: Nama (70%) + Usia (15%) + Lokasi (15%)│
│ ├─ Classify: COCOK/PERLU_DICEK/TIDAK_COCOK             │
│ └─ Simpan ke table hasil_perbandingan                   │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ HASIL DITAMPILKAN:                                      │
│ • Stats Cards: Total 28, Ada 18, Mungkin 5, Tidak 5    │
│ • Pie Chart: Visual breakdown status                    │
│ • Table Detail: Setiap orang TPS dengan match-nya       │
│ • Coverage: 64-82% dari total 28 pemilih di TPS        │
└─────────────────────────────────────────────────────────┘
```

---

## 🔍 CONTOH MATCHING DETAIL

### Row 1: Siti Nurhayati (TPS) vs Database

```
TPS DATA:
├─ Nama: "Siti Nurhayati"
├─ JK: P
├─ Usia: 35
├─ Dusun: "Sitimulyo"
└─ RT: 02

DATABASE LOKASI (Ini best match yang ditemukan):
├─ Nama: "Siti Nurhayati"
├─ JK: P  
├─ Usia: 35
├─ Dusun: "Sitimulyo"
└─ RT: 02

SCORING:
├─ Nama similarity: "Siti Nurhayati" vs "Siti Nurhayati" = 100%
├─ Usia: 35 vs 35 = 100%
├─ Lokasi: Sitimulyo + RT02 = 100%
├─ SKOR FINAL = (100×0.7 + 100×0.15 + 100×0.15) / 100 = 100%
└─ STATUS: ✓ COCOK (100% match)

INTERPRETASI: Orang ini PASTI ada di database saya
```

### Row 5: Bambang Sutrisno (TPS) vs Database

```
TPS DATA:
├─ Nama: "Bambang Sutrisno"
├─ JK: L
├─ Usia: 42
├─ Dusun: "Sitimulyo"
└─ RT: 01

DATABASE LOKASI (Best match):
├─ Nama: "Bambang Sutrno"      ← TYPO! Kurang 'i'
├─ JK: L
├─ Usia: 43                     ← Beda 1 tahun
├─ Dusun: "Sitimulyo"
└─ RT: 01

SCORING:
├─ Nama similarity: "bambang sutrisno" vs "bambang sutrno" = 94%
├─ Usia: 42 vs 43 (beda 1) = 85%
├─ Lokasi: exact match = 100%
├─ SKOR FINAL = (94×0.7 + 85×0.15 + 100×0.15) / 100 = 93%
└─ STATUS: ⚠ PERLU_DICEK (93% match, ada minor diff)

INTERPRETASI: Mungkin orang yang sama, tapi ada typo di nama atau usia beda 1 tahun
              → Perlu verifikasi manual
```

### Row 8: Ahmad Hasan (TPS) vs Database

```
TPS DATA:
├─ Nama: "Ahmad Hasan"
├─ JK: L
├─ Usia: 45
├─ Dusun: "Sitimulyo"
└─ RT: 01

DATABASE SEARCH:
├─ Cari "ahmad hasan" → tidak ada
├─ Cari "ahmad" + "hasan" → tidak ada kombinasi bagus
├─ Best match di area lain? → skor terlalu rendah (<60)
└─ KESIMPULAN: Tidak ada orang ini di database

SCORING:
├─ Best match score: 35% (terlalu rendah)
└─ STATUS: ✗ TIDAK_COCOK

INTERPRETASI: Orang ini TIDAK ada di database saya
              → Tidak termasuk target campaign di TPS ini
```

---

## 📈 STATISTIK KESELURUHAN (Lihat di /statistik-tps)

```
Scenario: Upload 3 TPS

┌─────────────────────────────────────┐
│ TPS          │ Total│ Ada │Mungkin│ Tidak│ Coverage │
├─────────────────────────────────────┤
│ SITIMULYO    │ 28  │ 18  │  5   │  5   │  64-82%  │
│ TEMBALANG    │ 45  │ 28  │  8   │  9   │  80-88%  │
│ KOKAH        │ 32  │ 12  │  6   │ 14   │  56-62%  │
└─────────────────────────────────────┘

INSIGHTS:
• TPS TEMBALANG: Best coverage (80-88%), fokus mobilisasi
• TPS SITIMULYO: Medium coverage (64-82%), verifikasi 5 orang
• TPS KOKAH: Low coverage (56-62%), perlu investigasi/strategy
```

---

## 🎯 CASE STUDY: TPS SITIMULYO (28 orang)

### Apa yang terjadi:

```
Database Saya: 150+ ribu orang
TPS SITIMULYO: 28 orang resmi pemilih

SEBELUM SISTEM:
"Saya gak tahu berapa dari 28 orang itu yang ada di database saya"

SESUDAH SISTEM:
"Dari 28 orang di TPS SITIMULYO:
  • 18 orang pasti ada di database saya (COCOK)
  • 5 orang mungkin ada (perlu verify)
  • 5 orang tidak ada di database saya
  
  KESIMPULAN: Coverage di TPS ini = 64-82%
  → Saya bisa campaign ke 18-23 orang dari 28 pemilih"
```

---

## 💼 STRATEGI CAMPAIGN BERDASARKAN HASIL

### Tier 1: Coverage ≥ 80% (Prioritas Utama)
```
Strategi: MOBILISASI LANGSUNG
├─ Sudah punya banyak target
├─ Focus: Pastikan mereka datang coblos
├─ Cara: Campaign, persuasi, transport, etc
└─ Expected: High turnout (besar kemungkinan menang)
```

### Tier 2: Coverage 50-79% (Medium)
```
Strategi: VERIFIKASI + MOBILISASI
├─ Ada gap 10-40% yang belum ter-cover
├─ Action: 
│  ├─ Verifikasi PERLU_DICEK apakah valid
│  ├─ Research: Cari data orang-orang yang TIDAK COCOK
│  └─ Tambah target jika memungkinkan
└─ Expected: Medium turnout
```

### Tier 3: Coverage < 50% (Rendah)
```
Strategi: RESEARCH + INVESTIGASI
├─ Coverage sangat rendah
├─ Kemungkinan:
│  ├─ Data saya incomplete di area ini
│  ├─ Atau area ini bukan target utama
│  └─ Atau ada strategi khusus diperlukan
├─ Action: Investigasi lebih lanjut
└─ Expected: Perlu strategy overhaul
```

---

## 🔐 ACCURACY FACTORS

### Matching Algorithm menggunakan:

1. **Nama Similarity (70% weight)**
   - Levenshtein distance (deteksi typo)
   - Token overlap (deteksi reordering)
   - Accuracy: ~95% untuk nama Indo

2. **Usia (15% weight)**
   - Exact match: 100%
   - Beda 1 tahun: 85%
   - Beda 2 tahun: 70%
   - Accuracy: Sangat tinggi jika data valid

3. **Lokasi (15% weight)**
   - Dusun/area name matching
   - RT/RW exact match
   - Accuracy: Tergantung consistency data input

### False Positive/Negative?

```
BISA TERJADI JIKA:
├─ Data TIDAK VALID:
│  ├─ Nama berbeda (nickname vs formal name)
│  ├─ Usia salah di salah satu source
│  └─ Lokasi gak konsisten (dusun vs alamat)
├─ Typo significant:
│  ├─ "Ahmad" vs "Amad" (beda 1 huruf)
│  └─ "Sitimulyo" vs "Siti Mulyo" (spasi)
└─ Duplikat nama:
   ├─ "Muhammad Ali" ada 10x di TPS
   └─ Sulit bedakan mana yang sebenarnya

SOLUSI:
├─ Manual verification untuk PERLU_DICEK
├─ Use NIK if available (lebih reliable)
└─ Regular data cleanup di database lokal
```

---

## ✅ KESIMPULAN

Sistem ini memberikan **coverage insight per TPS**, bukan hanya:
- "Berapa % saya dipilih" (general)
- Tapi: "Di TPS ini, saya bisa jangkau berapa % dari total pemilih resmi" (specific per area)

**Gunakan untuk:**
- Identify prioritas area (high vs low coverage)
- Target campaign strategy
- Resource allocation
- Forecasting vote potential per TPS

**Limitations:**
- Tergantung kualitas data input
- Perlu periodic verification
- Tidak 100% akurat untuk duplikat nama
- NIK + DOB lebih reliable daripada nama aja

---

**Sudah clear kah? Mau test dengan data real sekarang? 🚀**
