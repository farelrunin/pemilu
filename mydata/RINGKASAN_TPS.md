# 🎯 Summary: Fitur Perbandingan Data TPS

## 🎬 Cerita Singkat

**Anda punya 150 orang data pemilih di database.**
**TPS SITIMULYO punya 28 orang daftar pemilih.**

**Pertanyaan:** 
Dari 28 orang di TPS, berapa banyak yang ada di data Anda?
→ Ini berarti, **peluang Anda menang berapa % di TPS SITIMULYO?**

---

## 🔄 Flow Singkat

```
PDF TPS (28 orang)
      ↓
   Convert ke Excel (jika perlu)
      ↓
   Upload ke sistem
      ↓
   Sistem bandingkan 28 orang vs 150 orang Anda
      ↓
   Hasilnya:
   - 18 orang COCOK (100% yakin ada)
   - 5 orang PERLU_DICEK (mungkin ada, tapi ada typo)
   - 5 orang TIDAK_COCOK (benar-benar tidak ada)
      ↓
   Kesimpulan:
   ✅ Peluang Menang = 64% - 82%
   (Best case: jika 5 orang PERLU_DICEK ternyata cocok juga)
```

---

## 📊 Contoh Hasil Real

```
TPS SITIMULYO — Perbandingan Hasil
═══════════════════════════════════════

📍 Total Data TPS: 28 orang
💾 Total Data Kami: 150 orang

HASIL MATCHING:
═══════════════════════════════════════
✅ COCOK (Confident Match)       18 orang    64%
   → Data yang 100% cocok dengan TPS

⚠️  PERLU_DICEK (Possible Match)  5 orang    18%
   → Mungkin cocok, tapi ada perbedaan minor (typo nama, usia ±1 tahun)

❌ TIDAK_COCOK (No Match)         5 orang    18%
   → Benar-benar tidak ada di data Anda

═══════════════════════════════════════

💡 INSIGHT:
───────────────────────────────────────
• Peluang PASTI Menang:    64% (18/28 orang)
• Peluang BISA Menang:     82% (23/28 orang, jika PERLU_DICEK ternyata cocok)
• Peluang Tidak Menang:    18% (5/28 orang)

REKOMENDASI:
───────────────────────────────────────
1. Verifikasi 5 orang PERLU_DICEK secara manual
   → Cek di field "Nama TPS" vs "Nama Kami"
   → Cek umur dan lokasi
2. Tanyakan ke 5 orang TIDAK_COCOK apakah mereka berubah tempat tinggal
   → Mungkin mereka pindah ke dusun lain
3. Fokus campaign ke 18 orang COCOK (already have)
4. Arahkan 5 orang PERLU_DICEK ke campaign (to verify)
```

---

## 🛠️ Komponen Sistem

### A. Sudah Ada ✅

| Komponen | Status | Lokasi |
|----------|--------|--------|
| Helper: Levenshtein Distance | ✅ | `server.js` line ~138 |
| Helper: Name Similarity | ✅ | `server.js` line ~156 |
| Helper: Age Proximity | ✅ | `server.js` line ~183 |
| Helper: Location Similarity | ✅ | `server.js` line ~195 |
| Database: `data_tps` table | ✅ | `server.js` line ~260 |
| Database: `hasil_perbandingan` table | ✅ | `server.js` line ~276 |
| Auth & RBAC | ✅ | `middleware/auth.js` |
| File Upload (Multer) | ✅ | `server.js` line 15 |
| Excel Parsing (XLSX) | ✅ | `server.js` line 10 |

### B. Perlu Diimplementasi ❌

| Komponen | Prioritas | Estimasi |
|----------|-----------|----------|
| `POST /api/tps/upload` | HIGH | 1.5 jam |
| `POST /api/tps/{nama_tps}/perbandingan` | HIGH | 1.5 jam |
| `GET /api/tps/list` | MEDIUM | 30 menit |
| `GET /api/tps/{nama_tps}/hasil` | MEDIUM | 1 jam |
| `GET /api/tps/statistik` | MEDIUM | 1 jam |
| `upload-tps.html` | HIGH | 1.5 jam |
| `perbandingan-tps.html` | HIGH | 2 jam |
| `statistik-tps.html` | MEDIUM | 1 jam |
| Navigation & Links | MEDIUM | 30 menit |
| **TOTAL** | | **9.5 jam** |

---

## 🧮 Algoritma Scoring (Simplified)

```javascript
skor = (
    (namaSimilarity * 0.70) +           // Nama 70%
    (ageDifference * 0.15) +            // Usia 15%
    (locationMatch * 0.15)              // Lokasi 15%
);

if (skor >= 85) return "COCOK";         // Confident
if (skor >= 60) return "PERLU_DICEK";   // Possible
return "TIDAK_COCOK";                   // Not matched
```

**Contoh:**
```
Nama: "Siti Nurhayati" vs "Siti Nurh Yati"
  → Similarity: 82%

Usia: 35 vs 34 (beda 1 tahun)
  → Score: 85%

Lokasi: "Sitimulyo" vs "Sitimulyo" (sama)
  → Score: 100%

TOTAL SKOR = (82 * 0.70) + (85 * 0.15) + (100 * 0.15)
           = 57.4 + 12.75 + 15
           = 85.15%

STATUS: ✅ COCOK (karena >= 85)
```

---

## 📱 UI Preview

### Upload Page
```
┌─────────────────────────────────────────┐
│  📤 Upload Data TPS                      │
├─────────────────────────────────────────┤
│                                           │
│  Nama TPS:  [SITIMULYO________________]  │
│                                           │
│  File Excel:                              │
│  ┌───────────────────────────────────┐   │
│  │  📁 Drag & drop file di sini      │   │
│  │      atau klik untuk browse       │   │
│  └───────────────────────────────────┘   │
│                                           │
│  Preview (5 baris pertama):               │
│  ┌───────────────────────────────────┐   │
│  │ Nama | JK | Usia | Dusun | RT RW │   │
│  ├───────────────────────────────────┤   │
│  │ Siti | P  | 35   | Sitimulyo 2 5 │   │
│  │ Budi | L  | 40   | Sitimulyo 3 6 │   │
│  └───────────────────────────────────┘   │
│                                           │
│  [Batal]              [Upload]            │
└─────────────────────────────────────────┘
```

### Comparison Result Page
```
┌──────────────────────────────────────┐
│  📊 Hasil Perbandingan TPS SITIMULYO  │
├──────────────────────────────────────┤
│                                        │
│  Pilih TPS: [SITIMULYO___________] ▼ │
│  [Bandingkan Sekarang]                │
│                                        │
│  STATISTIK:                            │
│  ┌──────────┬──────────┬────────────┐ │
│  │ ✅ COCOK │ ⚠️ CHECK │ ❌ TIDAK   │ │
│  │   18     │    5     │     5      │ │
│  │   64%    │   18%    │    18%     │ │
│  └──────────┴──────────┴────────────┘ │
│                                        │
│  📈 Peluang Menang: 64% - 82%         │
│                                        │
│  TABEL HASIL:                          │
│  [Filter: Semua ▼] [Sort: Score ▼]   │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │ Nama Kami|Nama TPS|Skor|Status   │ │
│  ├──────────────────────────────────┤ │
│  │ Siti N.  |Siti N. |85% |✅ COCOK │ │
│  │ Budi M.  |Boedi M.|78% |⚠️ CHECK │ │
│  │ ...      |...    |... |...      │ │
│  └──────────────────────────────────┘ │
│                                        │
│  [Export Excel]  [Print]              │
└──────────────────────────────────────┘
```

---

## 🚀 Rencana Eksekusi

### Sprint 1: Backend (Est. 5 jam)
- [ ] Implement `POST /api/tps/upload`
- [ ] Implement `POST /api/tps/{nama_tps}/perbandingan`
- [ ] Implement `GET /api/tps/{nama_tps}/hasil`
- [ ] Implement `GET /api/tps/statistik`
- [ ] Test dengan Postman

### Sprint 2: Frontend (Est. 4.5 jam)
- [ ] Create `upload-tps.html`
- [ ] Create `perbandingan-tps.html` + JavaScript
- [ ] Create `statistik-tps.html` + Chart.js
- [ ] Update navigation

### Sprint 3: QA & Polish (Est. 1-2 jam)
- [ ] Test end-to-end dengan data TPS real
- [ ] Verify accuracy
- [ ] UI/UX tweaks

---

## 📊 Expected Results

Setelah implementasi selesai, Anda bisa:

1. ✅ Upload data TPS dalam format Excel
2. ✅ Otomatis compare dengan data pemilih yang sudah ada
3. ✅ Lihat persentase kecocokan per lokasi TPS
4. ✅ Lihat detail match untuk setiap orang
5. ✅ Export hasil ke Excel
6. ✅ Buat keputusan strategi campaign berdasarkan data

---

## 🎯 Kesimpulan Logika Bisnis Anda

```
PERTANYAAN:
"Aku punya 150 orang data pemilih. 
TPS SITIMULYO punya 28 orang. 
Berapa % dari 28 orang itu yang ada di data aku?"

JAWABAN (Setelah Implementasi):
"Dari 28 orang di TPS:
- 18 orang 100% ada di data Anda (64%)
- 5 orang kemungkinan ada di data Anda tapi ada typo (18%)
- 5 orang benar-benar tidak ada (18%)

Jadi peluang Anda menang di TPS SITIMULYO adalah 64% - 82%."

AKSI:
1. Fokus campaign ke 18 orang COCOK (prioritas)
2. Verifikasi & hubungi 5 orang PERLU_DICEK
3. Cari tahu di mana 5 orang TIDAK_COCOK (pindah? alamat lama?)
```

---

## ❓ FAQ

**Q: Format Excel TPS harus apa?**
A: Kolom: NAMA, JENIS_KELAMIN, USIA, DUSUN, ALAMAT, RT, RW
   (nama kolom tidak case-sensitive, tapi harus ada semua field)

**Q: Kalau nama typo banget, masih bisa cocok?**
A: Bisa, sampai 20% character difference masih dianggap mungkin cocok (PERLU_DICEK)

**Q: Kalau usia beda jauh?**
A: Kalau beda > 4 tahun, skor usia jadi 0% (tidak cocok)

**Q: Bagaimana jika ada duplikat nama di data TPS?**
A: Sistem akan match ke orang yang paling mirip (highest score)

**Q: Bisa manual tandai match yang salah?**
A: Ya, akan dibuat fitur untuk override/verify hasil matching

---

## 📞 Ready to Start?

Silahkan reply dengan:
- Pilihan mana yang mau dikerjakan duluan (Backend atau Frontend)?
- Atau execute semuanya sesuai sprint plan?
