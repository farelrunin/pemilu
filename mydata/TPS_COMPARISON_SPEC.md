# 🎯 Fitur Perbandingan TPS — Detailed Checklist

## 📋 Konsep & Logika

**Pertanyaan yang ingin dijawab:**
```
Anda punya 150 data pemilih
TPS SITIMULYO punya 28 orang
→ Berapa % dari 28 orang TPS yang ada di data Anda?
→ Berarti, peluang menang di TPS ini berapa %?
```

**Jawaban sistem:**
```
✅ COCOK (confident match)      → 18 orang (64%)    → Dipilih
⚠️  PERLU_DICEK (might match)   → 5 orang (18%)     → Kemungkinan (kalau typo diperbaiki)
❌ TIDAK_COCOK (no match)       → 5 orang (18%)     → Diluar jangkauan
─────────────────────────────────────────────────────
Total TPS: 28 orang
Potensi Menang: 64% - 82% (best case scenario)
```

---

## 🔍 Algoritma Matching (Sudah Ada ✅)

Nama di database: `computeNameSimilarity()`, `computeAgeSignal()`, `computeLocationSignal()`

### Formula Skor Total
```
SKOR_TOTAL = (
    (NAMA_SIMILARITY × 0.70) +
    (AGE_SIGNAL × 0.15) +
    (LOCATION_SIGNAL × 0.15)
) × 100 / 255
```

**Penjelasan:**
- **Nama Similarity (70%)** — paling penting
  - Levenshtein distance untuk mendeteksi typo
  - Token overlap untuk mendeteksi missing words
  - Contoh: "Siti Nurhayati" vs "Siti Nurh Yati" → 82% match
  
- **Usia Proximity (15%)** — medium penting
  - Persis sama (beda 0 tahun) → 100%
  - Beda 1 tahun → 85%
  - Beda 2 tahun → 70%
  - Beda 4 tahun → 45%
  - Beda > 4 tahun → 0%
  
- **Lokasi Proximity (15%)** — medium penting
  - Dusun/RT/RW harus cocok
  - Jika RT/RW ada tapi tidak cocok → lebih penting dari dusun

### Status Decision Logic
```javascript
if (skor >= 85 && (namaSimilarity >= 80 || (usiaPerfect && lokasiperfect))) {
    status = "COCOK"
} else if (skor >= 60 && skor < 85) {
    status = "PERLU_DICEK"
} else {
    status = "TIDAK_COCOK"
}
```

---

## 📦 Data Structure (Sudah Ada ✅)

### Tabel: `data_tps`
```sql
id              | INT PRIMARY KEY
nama_tps        | VARCHAR(100) — nama lokasi TPS (e.g., "SITIMULYO")
nama            | VARCHAR(100) — nama orang di TPS
jenis_kelamin   | ENUM('L','P')
usia            | INT
dusun           | VARCHAR(100)
alamat          | VARCHAR(255)
rt              | VARCHAR(10)
rw              | VARCHAR(10)
created_at      | DATETIME
```

### Tabel: `hasil_perbandingan`
```sql
id                    | INT PRIMARY KEY
pemilih_id            | VARCHAR(20) — ID pemilih lokal (NULL jika tidak cocok)
data_tps_id           | INT — ID dari data_tps
skor_kemiripan_nama   | DECIMAL(5,2) — 0-100
skor_total            | DECIMAL(5,2) — 0-100
status_cocok          | ENUM('COCOK','PERLU_DICEK','TIDAK_COCOK')
catatan               | VARCHAR(255)
created_at            | DATETIME
```

---

## 🛠️ Backend Endpoints (Belum Ada ❌)

### 1. Upload Data TPS
**Endpoint:** `POST /api/tps/upload`

**Request:**
```javascript
{
    file: <multipart file Excel>,
    nama_tps: "SITIMULYO"  // Nama lokasi TPS
}
```

**Excel Format yang diharapkan:**
| NAMA | JENIS KELAMIN | USIA | DUSUN | ALAMAT | RT | RW |
|------|---------------|------|-------|--------|----|----|
| Siti Nurhayati | P | 35 | Sitimulyo | Jl. Raya 123 | 02 | 05 |
| ... | ... | ... | ... | ... | ... | ... |

**Response Success:**
```javascript
{
    status: "success",
    message: "Upload berhasil",
    data: {
        nama_tps: "SITIMULYO",
        total_berhasil: 28,
        total_gagal: 0,
        detail_gagal: []
    }
}
```

**Response Error (duplikat):**
```javascript
{
    status: "error",
    message: "Gagal upload",
    data: {
        total_berhasil: 25,
        total_gagal: 3,
        detail_gagal: [
            { row: 2, nama: "...", error: "Column RT tidak ditemukan" }
        ]
    }
}
```

---

### 2. List TPS yang Sudah Di-upload
**Endpoint:** `GET /api/tps/list?page=1&limit=10`

**Response:**
```javascript
{
    status: "success",
    data: [
        {
            nama_tps: "SITIMULYO",
            total_data: 28,
            status_perbandingan: "BELUM_DIBANDING", // atau "SUDAH_DIBANDING"
            created_at: "2026-04-27 10:30:00"
        },
        // ... lebih
    ],
    pagination: {
        page: 1,
        limit: 10,
        total: 2
    }
}
```

---

### 3. Trigger Perbandingan
**Endpoint:** `POST /api/tps/:nama_tps/perbandingan`

**Request:** (empty body)

**Logic:**
1. Ambil semua record dari `data_tps` WHERE `nama_tps = 'SITIMULYO'`
2. Ambil semua record dari `pemilih` table
3. Loop setiap TPS record:
   - Cari best match dari pemilih dengan `computeNameSimilarity + computeAgeSignal + computeLocationSignal`
   - Hitung total skor
   - Tentukan status (COCOK, PERLU_DICEK, TIDAK_COCOK)
   - INSERT ke `hasil_perbandingan`
4. Hitung statistik
5. Return hasil

**Response:**
```javascript
{
    status: "success",
    message: "Perbandingan selesai",
    data: {
        nama_tps: "SITIMULYO",
        durasi_ms: 1250,
        statistik: {
            total_data_tps: 28,
            total_pemilih: 150,
            cocok: 18,
            perlu_dicek: 5,
            tidak_cocok: 5,
            persentase_cocok: 64.29,
            persentase_optimal: 82.14  // cocok + perlu_dicek
        }
    }
}
```

---

### 4. List Hasil Perbandingan
**Endpoint:** `GET /api/tps/:nama_tps/hasil?page=1&limit=20&status=COCOK`

**Query Params:**
- `page` — nomor halaman
- `limit` — records per page
- `status` — filter (COCOK, PERLU_DICEK, TIDAK_COCOK, atau kosong = semua)
- `sort` — urutkan by (skor_desc, skor_asc, status)

**Response:**
```javascript
{
    status: "success",
    data: [
        {
            id: 1,
            nama_pemilih: "Siti Nurhayati",
            nama_tps: "Siti Nurh Yati",
            jenis_kelamin_pemilih: "P",
            jenis_kelamin_tps: "P",
            usia_pemilih: 35,
            usia_tps: 34,
            dusun_pemilih: "Sitimulyo",
            dusun_tps: "Sitimulyo",
            rt_pemilih: "02",
            rt_tps: "02",
            skor_nama: 82,
            skor_total: 85.15,
            status_cocok: "COCOK",
            catatan: "Match sempurna"
        },
        // ... lebih
    ],
    pagination: {
        page: 1,
        limit: 20,
        total: 18,
        totalPages: 1
    }
}
```

---

### 5. Statistik Keseluruhan
**Endpoint:** `GET /api/tps/statistik`

**Response:**
```javascript
{
    status: "success",
    data: {
        total_tps: 2,
        total_data_tps_seluruh: 56,
        total_pemilih_lokal: 150,
        perbandingan: [
            {
                nama_tps: "SITIMULYO",
                total: 28,
                cocok: 18,
                perlu_dicek: 5,
                tidak_cocok: 5,
                persentase_cocok: 64.29,
                persentase_optimal: 82.14
            },
            {
                nama_tps: "TEMBALANG",
                total: 28,
                cocok: 20,
                perlu_dicek: 3,
                tidak_cocok: 5,
                persentase_cocok: 71.43,
                persentase_optimal: 82.14
            }
        ],
        ringkasan: {
            total_cocok_seluruh: 38,
            total_perlu_dicek_seluruh: 8,
            total_tidak_cocok_seluruh: 10,
            persentase_cocok_rata2: 67.86
        }
    }
}
```

---

### 6. (Optional) Tandai Manual Match
**Endpoint:** `PUT /api/hasil-perbandingan/:id/verifikasi`

**Request:**
```javascript
{
    pemilih_id: "kader_123_a",
    status: "COCOK",
    catatan: "Diverifikasi manual oleh superadmin"
}
```

**Response:**
```javascript
{
    status: "success",
    message: "Verifikasi berhasil"
}
```

---

## 🎨 Frontend Pages (Belum Ada ❌)

### 1. `upload-tps.html` — Upload Data TPS

**Sections:**
1. **Form Upload**
   - Input: Nama TPS (text field)
   - Input: File Excel (drag-drop area)
   - Preview: Tabel preview data (max 5 rows)
   - Tombol: "Upload"

2. **Hasil Upload**
   - Status message (success/error)
   - Statistik: "Berhasil 28, Gagal 0"
   - Tabel detail error (jika ada)

3. **History**
   - List TPS yang pernah di-upload
   - Tombol delete/re-upload

---

### 2. `perbandingan-tps.html` — Dashboard Perbandingan

**Sections:**
1. **Header**
   - Pilih TPS mana (dropdown dari data_tps.nama_tps)
   - Tombol "Bandingkan Sekarang"
   - Loading indicator

2. **Summary Cards**
   - Card 1: "Total TPS Data" = 28
   - Card 2: "Cocok" = 18 (hijau)
   - Card 3: "Perlu Dicek" = 5 (kuning)
   - Card 4: "Tidak Cocok" = 5 (merah)
   - Card 5: "Peluang Menang" = 64-82%

3. **Charts**
   - Pie/Donut chart: status distribution
   - Bar chart: skor distribution

4. **Table Hasil**
   - Kolom: Nama (kami), Nama TPS, Skor, Usia, Dusun, RT, Status, Aksi
   - Sorting: klik header
   - Filter: status dropdown
   - Pagination

5. **Detail Row** (click to expand)
   - Full data comparison side-by-side
   - Tombol: "Tandai Cocok Manual", "Hapus Match"

---

### 3. `statistik-tps.html` — Insight & Analytics

**Sections:**
1. **Overview**
   - Total TPS yang sudah dibandingkan
   - Total pemilih lokal
   - Persentase cocok rata-rata

2. **Charts**
   - Line chart: persentase cocok per TPS
   - Grouped bar: COCOK vs PERLU_DICEK vs TIDAK_COCOK per TPS
   - Heatmap: nama_tps vs status

3. **Ranking**
   - Top TPS dengan persentase cocok tertinggi
   - Bottom TPS dengan persentase cocok terendah

4. **Export**
   - Tombol export ke Excel
   - Tombol print

---

## 📊 UI/UX Best Practices

### Upload Page
```
┌─────────────────────────────────────┐
│  📤 Upload Data TPS                  │
├─────────────────────────────────────┤
│                                       │
│  Nama TPS: [_________________]       │
│                                       │
│  File Excel:                          │
│  ┌───────────────────────────────┐   │
│  │ Drag & drop file di sini      │   │
│  │ atau klik untuk browse        │   │
│  └───────────────────────────────┘   │
│                                       │
│  📋 Preview (max 5 baris)            │
│  ┌───────────────────────────────┐   │
│  │ Nama | JK | Usia | Dusun | RT │   │
│  ├───────────────────────────────┤   │
│  │ Siti | P  | 35   | Sitimulyo  │   │
│  │ ...                            │   │
│  └───────────────────────────────┘   │
│                                       │
│  [Batal]  [Upload]                   │
└─────────────────────────────────────┘
```

### Comparison Result
```
┌─────────────────────────────────────┐
│  📊 Hasil Perbandingan TPS SITIMULYO │
├─────────────────────────────────────┤
│                                       │
│  ✅ COCOK          ⚠️ PERLU_DICEK    │
│  18 (64%)          5 (18%)           │
│                    ❌ TIDAK_COCOK    │
│  📈 Peluang Menang: 64-82%          │
│  5 (18%)                             │
│                                       │
│  [Filter: Semua ▼] [Sort: Score ▼]  │
│                                       │
│  ┌───────────────────────────────┐   │
│  │ Nama Kami | Nama TPS | Skor   │   │
│  ├───────────────────────────────┤   │
│  │ Siti N.   | Siti Nurh.| 85%  ✅   │
│  │ Budi M.   | Boedi M.  | 78%  ⚠️   │
│  │ ...                            │   │
│  └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## 🚀 Implementasi Step-by-Step

### Phase 1: Backend (Estimasi: 4-6 jam)
```
1. Setup data_tps migration (jika belum)
2. Implement POST /api/tps/upload
   - Handle file upload (XLSX parsing)
   - Validasi format
   - Insert ke database
   - Error handling & logging
3. Implement POST /api/tps/{nama_tps}/perbandingan
   - Loop matching algorithm
   - Insert hasil ke database
   - Calculate statistics
4. Implement GET endpoints (list, hasil, statistik)
```

### Phase 2: Frontend (Estimasi: 3-4 jam)
```
1. Create upload-tps.html
2. Create perbandingan-tps.html
3. Create statistik-tps.html
4. Add navigation links di index.html
5. Add CSS styles
```

### Phase 3: Testing & Polish (Estimasi: 2-3 jam)
```
1. Test dengan real data TPS (28 records)
2. Verify accuracy matching algorithm
3. UI/UX improvements
4. Performance optimization (jika diperlukan)
```

---

## ⚠️ Edge Cases & Limitations

1. **Nama Typo**: Algoritma sudah handle dengan Levenshtein distance
2. **Usia Beda**: Sampai 4 tahun masih bisa cocok
3. **Lokasi Beda**: Hanya cocok jika RT/RW sama atau dusun sama
4. **Duplikat Nama**: Algoritma akan pick best match (highest score)
5. **Data NULL**: Fields opsional (dusun, alamat, rt, rw) akan diberikan weight 0 jika NULL

---

## 📞 Next Action
**Silahkan pilih:**
- [ ] Mulai implement backend endpoints?
- [ ] Mulai implement frontend pages?
- [ ] Adjust algorithm weights/scoring first?
