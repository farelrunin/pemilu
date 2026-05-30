const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { query, pool } = require('../db');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Import modular components
const {
  normalizeGender,
  normalizeAge,
  normalizeAreaCode,
  findSpreadsheetColumnIndex,
  getRawVal
} = require('../utils/tpsMatcher');

const {
  runTPSComparison,
  refreshTPSComparisonIfNeeded
} = require('../services/tpsService');

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

// ── MODULE API ENDPOINTS ──────────────────────────────────────────

// 1️⃣ Upload data TPS dari Excel
router.post('/upload', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
  try {
    const { namaTps } = req.body;
    if (!namaTps || !req.file) {
      return res.status(400).json({ error: 'Nama TPS dan file Excel wajib dikirim' });
    }

    const cleanedNamaTps = String(namaTps).trim().toUpperCase();

    const [existing] = await query('SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?', [cleanedNamaTps]);
    if (existing.total > 0) {
      return res.status(400).json({ error: `Data TPS dengan nama "${cleanedNamaTps}" sudah ada. Silakan hapus dahulu jika ingin mengupload ulang.` });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    if (rawData.length < 2) {
      return res.status(400).json({ error: 'Format Excel tidak valid atau baris data kosong' });
    }

    const headers = rawData[0].map(h => String(h || '').trim());

    const columnMap = {
      nama: findSpreadsheetColumnIndex(headers, ['nama', 'name', 'nama lengkap', 'nama_lengkap']),
      jenis_kelamin: findSpreadsheetColumnIndex(headers, ['jenis_kelamin', 'jk', 'gender', 'jenis kelamin', 'sex']),
      usia: findSpreadsheetColumnIndex(headers, ['usia', 'age', 'umur']),
      dusun: findSpreadsheetColumnIndex(headers, ['dusun', 'hamlet', 'dusun_alamat', 'dukuh']),
      alamat: findSpreadsheetColumnIndex(headers, ['alamat', 'address', 'jalan', 'domisili']),
      rt: findSpreadsheetColumnIndex(headers, ['rt', 'rt_domisili']),
      rw: findSpreadsheetColumnIndex(headers, ['rw', 'rw_domisili'])
    };

    if (columnMap.nama === -1) {
      return res.status(400).json({ error: 'Kolom "Nama" wajib ada pada sheet pertama Excel' });
    }

    const rowsToInsert = [];
    for (let i = 1; i < rawData.length; i++) {
      const rawRow = rawData[i];
      if (!rawRow || rawRow.length === 0) continue;

      const nama = getRawVal(rawRow, columnMap.nama);
      if (!nama) continue; // Skip empty rows

      const jenisKelamin = normalizeGender(getRawVal(rawRow, columnMap.jenis_kelamin));
      const usia = normalizeAge(getRawVal(rawRow, columnMap.usia));
      const dusun = getRawVal(rawRow, columnMap.dusun);
      const alamat = getRawVal(rawRow, columnMap.alamat);
      const rt = normalizeAreaCode(getRawVal(rawRow, columnMap.rt)) || null;
      const rw = normalizeAreaCode(getRawVal(rawRow, columnMap.rw)) || null;

      rowsToInsert.push([
        cleanedNamaTps,
        nama,
        jenisKelamin,
        usia,
        dusun,
        alamat,
        rt,
        rw
      ]);
    }

    if (!rowsToInsert.length) {
      return res.status(400).json({ error: 'Tidak ada baris data pemilih valid yang dapat diimpor' });
    }

    await query(
      'INSERT INTO data_tps (nama_tps, nama, jenis_kelamin, usia, dusun, alamat, rt, rw) VALUES ?',
      [rowsToInsert]
    );

    res.json({
      status: 'success',
      message: `Berhasil mengimpor ${rowsToInsert.length} data pemilih ke dalam TPS ${cleanedNamaTps}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2️⃣ Dapatkan daftar semua file TPS terunggah
router.get('/list', verifyToken, async (req, res) => {
  try {
    const list = await query(`
      SELECT 
        dt.nama_tps,
        COUNT(dt.id) AS total_data,
        COUNT(hp.id) AS total_dibandingkan,
        COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) AS cocok,
        COUNT(CASE WHEN hp.status_cocok = 'PERLU_DICEK' THEN 1 END) AS perlu_dicek,
        COUNT(CASE WHEN hp.status_cocok = 'TIDAK_COCOK' THEN 1 END) AS tidak_cocok,
        MAX(dt.created_at) AS created_at
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      GROUP BY dt.nama_tps
      ORDER BY dt.nama_tps ASC
    `);

    res.json({
      status: 'success',
      data: list
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3️⃣ Dapatkan detail baris pemilih TPS tertentu
router.get('/:nama_tps/data', verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const q = req.query.q ? String(req.query.q).trim() : '';

    const tps = req.params.nama_tps;

    let countQuery = 'SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?';
    const countParams = [tps];
    if (q) {
      countQuery += ' AND (nama LIKE ? OR rt LIKE ?)';
      countParams.push(`%${q}%`, `%${q}%`);
    }

    const [totalRow] = await query(countQuery, countParams);
    const total = totalRow?.total || 0;

    let selectQuery = `
      SELECT dt.id, dt.nama_tps, dt.nama, dt.jenis_kelamin, dt.usia, dt.dusun, dt.alamat, dt.rt, dt.rw,
             hp.status_cocok, hp.skor_total, hp.catatan,
             p.nama AS nama_lokal, p.id AS pemilih_id
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      WHERE dt.nama_tps = ?
    `;
    const selectParams = [tps];
    if (q) {
      selectQuery += ' AND (dt.nama LIKE ? OR dt.rt LIKE ?)';
      selectParams.push(`%${q}%`, `%${q}%`);
    }
    selectQuery += ' ORDER BY dt.nama ASC LIMIT ? OFFSET ?';
    selectParams.push(limit, offset);

    const list = await query(selectQuery, selectParams);

    res.json({
      status: 'success',
      data: list,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3️⃣.5️⃣ Jalankan perbandingan seluruh TPS secara bersih dan global dari nol
router.post('/perbandingan-semua', verifyToken, async (req, res) => {
  try {
    // Hapus seluruh hasil lama agar tidak ada pemilih_id yang terkunci oleh sisa duplikat lama
    await query('DELETE FROM hasil_perbandingan');

    const tpsList = await query('SELECT DISTINCT nama_tps FROM data_tps ORDER BY nama_tps ASC');

    const results = [];
    for (const tps of tpsList) {
      const resCompare = await runTPSComparison(tps.nama_tps);
      results.push({
        tps: tps.nama_tps,
        total: resCompare.statistik.total_data_tps,
        cocok: resCompare.statistik.cocok,
        perlu_dicek: resCompare.statistik.perlu_dicek,
        tidak_cocok: resCompare.statistik.tidak_cocok
      });
    }

    res.json({
      status: 'success',
      message: `Berhasil mencocokkan ulang ${tpsList.length} TPS secara bersih, berurutan, dan global.`,
      results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4️⃣ Jalankan perbandingan data TPS secara manual
router.post('/:nama_tps/perbandingan', verifyToken, async (req, res) => {
  try {
    const result = await runTPSComparison(req.params.nama_tps);
    res.json({
      status: 'success',
      message: `Pencocokan spasial pemilih untuk TPS ${req.params.nama_tps} berhasil diselesaikan.`,
      result
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// 5️⃣ Update satu baris data pemilih TPS
router.put('/data/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, jenisKelamin, usia, alamat, rt, rw } = req.body;
    const dusun = String(req.body.dusun || '').trim();

    if (!nama) return res.status(400).json({ error: 'Nama pemilih wajib diisi' });

    const [dataTps] = await query(`SELECT nama_tps FROM data_tps WHERE id = ?`, [id]);
    if (!dataTps) return res.status(404).json({ error: 'Data TPS tidak ditemukan' });

    await query(`
      UPDATE data_tps 
      SET nama = ?, jenis_kelamin = ?, usia = ?, dusun = ?, alamat = ?, rt = ?, rw = ?
      WHERE id = ?
    `, [nama, jenisKelamin, usia, dusun, alamat, rt, rw, id]);

    const compResult = await refreshTPSComparisonIfNeeded(dataTps.nama_tps);

    res.json({
      status: 'success',
      message: 'Berhasil memperbarui data TPS dan memperbarui hasil perbandingan.',
      comparison: compResult
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6️⃣ Hapus satu baris data pemilih TPS
router.delete('/data/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [dataTps] = await query(`SELECT nama_tps FROM data_tps WHERE id = ?`, [id]);
    if (!dataTps) return res.status(404).json({ error: 'Data TPS tidak ditemukan' });

    await query(`DELETE FROM data_tps WHERE id = ?`, [id]);
    const compResult = await refreshTPSComparisonIfNeeded(dataTps.nama_tps);

    res.json({
      status: 'success',
      message: 'Berhasil menghapus baris data TPS.',
      comparison: compResult
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6️⃣.5️⃣ Dapatkan daftar pemilih Non-DPT (Terdaftar di database lokal, tetapi tidak terdaftar di data TPS mana pun)
router.get('/non-dpt', verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const { dusun, q } = req.query;

    let countQueryStr = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM pemilih p
      LEFT JOIN hasil_perbandingan hp ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
      WHERE hp.id IS NULL OR hp.status_cocok = 'TIDAK_COCOK'
    `;
    const countParams = [];

    if (dusun) {
      countQueryStr += ` AND LOWER(k.dusun) = LOWER(?)`;
      countParams.push(String(dusun).trim());
    }
    if (q) {
      countQueryStr += ` AND (p.nama LIKE ? OR p.nik LIKE ?)`;
      countParams.push(`%${q}%`, `%${q}%`);
    }

    const [totalRow] = await query(countQueryStr, countParams);
    const total = totalRow?.total || 0;

    let selectQueryStr = `
      SELECT p.id, p.nama, p.nik, p.jenis_kelamin, 
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS usia,
             k.dusun AS dusun_pemilih, k.rt AS rt_pemilih, k.rw AS rw_pemilih,
             CONCAT('Kader ', k.nomor, ' — ', k.nama) AS nama_kader
      FROM pemilih p
      LEFT JOIN hasil_perbandingan hp ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
      WHERE hp.id IS NULL OR hp.status_cocok = 'TIDAK_COCOK'
    `;
    const selectParams = [];

    if (dusun) {
      selectQueryStr += ` AND LOWER(k.dusun) = LOWER(?)`;
      selectParams.push(String(dusun).trim());
    }
    if (q) {
      selectQueryStr += ` AND (p.nama LIKE ? OR p.nik LIKE ?)`;
      selectParams.push(`%${q}%`, `%${q}%`);
    }

    selectQueryStr += ` ORDER BY k.dusun ASC, p.nama ASC LIMIT ? OFFSET ?`;
    selectParams.push(limit, offset);

    const data = await query(selectQueryStr, selectParams);

    res.json({
      status: 'success',
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7️⃣ Hapus satu file TPS secara utuh beserta hasil perbandingannya
router.delete('/:nama_tps', verifyToken, isAdmin, async (req, res) => {
  try {
    const tps = req.params.nama_tps;

    await query(`
      DELETE hp
      FROM hasil_perbandingan hp
      JOIN data_tps dt ON dt.id = hp.data_tps_id
      WHERE dt.nama_tps = ?
    `, [tps]);

    const del = await query('DELETE FROM data_tps WHERE nama_tps = ?', [tps]);

    res.json({
      status: 'success',
      message: `Berhasil menghapus ${del.affectedRows} baris data untuk TPS ${tps} beserta riwayat pencocokannya.`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8️⃣ Dapatkan hasil perbandingan spasial TPS tertentu dengan paginasi
router.get('/:nama_tps/hasil', verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const { dusun, rt, status, q } = req.query;

    const tps = req.params.nama_tps;
    const isAllTps = (!tps || tps.toLowerCase() === 'all' || tps.toLowerCase() === 'sitimulyo');
    
    const countParams = [];
    if (!isAllTps) countParams.push(tps);
    
    let countQueryStr = `
      SELECT COUNT(*) AS total FROM (
        SELECT dt.rt AS rt_tps, dt.rw AS rw_tps, hp.status_cocok, dt.nama AS nama_tps, p.nama AS nama_pemilih, p.nik,
               CASE 
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
                 ELSE TRIM(COALESCE(k.dusun, dt.dusun))
               END AS resolved_dusun
        FROM hasil_perbandingan hp
        JOIN data_tps dt ON dt.id = hp.data_tps_id
        LEFT JOIN pemilih p ON p.id = hp.pemilih_id
        LEFT JOIN kader k ON k.id = p.kader_id
        ${isAllTps ? '' : 'WHERE dt.nama_tps = ?'}
      ) AS t
      WHERE 1=1
    `;
 
     if (dusun) {
       countQueryStr += ` AND LOWER(t.resolved_dusun) = LOWER(?)`;
       countParams.push(String(dusun).trim());
     }
     if (rt) {
       countQueryStr += ` AND CAST(NULLIF(t.rt_tps, '') AS UNSIGNED) = ?`;
       countParams.push(parseInt(rt));
     }
     if (status) {
       countQueryStr += ` AND t.status_cocok = ?`;
       countParams.push(status);
     }
     if (q) {
       countQueryStr += ` AND (t.nama_tps LIKE ? OR t.nama_pemilih LIKE ? OR t.nik LIKE ?)`;
       countParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
     }
 
     const [totalRow] = await query(countQueryStr, countParams);
     const total = totalRow?.total || 0;
 
     const selectParams = [];
     if (!isAllTps) selectParams.push(tps);
 
     let selectQueryStr = `
       SELECT * FROM (
         SELECT hp.id, hp.pemilih_id, dt.nama AS nama_tps, dt.jenis_kelamin AS jk_tps, dt.usia AS usia_tps, dt.dusun AS dusun_tps, dt.rt AS rt_tps, dt.rw AS rw_tps, dt.alamat AS alamat_tps,
                hp.status_cocok, hp.skor_total, hp.catatan,
                p.nama AS nama_pemilih, p.nik, TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS usia_pemilih,
                k.dusun AS dusun_pemilih, k.kordus, k.rt AS rt_pemilih,
                CONCAT('Kader ', k.nomor, ' — ', k.nama) AS nama_kader,
                CASE 
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
                  ELSE TRIM(COALESCE(k.dusun, dt.dusun))
                END AS resolved_dusun
         FROM hasil_perbandingan hp
         JOIN data_tps dt ON dt.id = hp.data_tps_id
         LEFT JOIN pemilih p ON p.id = hp.pemilih_id
         LEFT JOIN kader k ON k.id = p.kader_id
         ${isAllTps ? '' : 'WHERE dt.nama_tps = ?'}
       ) AS t
       WHERE 1=1
     `;
 
     if (dusun) {
       selectQueryStr += ` AND LOWER(t.resolved_dusun) = LOWER(?)`;
       selectParams.push(String(dusun).trim());
     }
     if (rt) {
       selectQueryStr += ` AND CAST(NULLIF(t.rt_tps, '') AS UNSIGNED) = ?`;
       selectParams.push(parseInt(rt));
     }
     if (status) {
       selectQueryStr += ` AND t.status_cocok = ?`;
       selectParams.push(status);
     }
     if (q) {
       selectQueryStr += ` AND (t.nama_tps LIKE ? OR t.nama_pemilih LIKE ? OR t.nik LIKE ?)`;
       selectParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
     }

    selectQueryStr += ` ORDER BY 
      CAST(NULLIF(t.rt_tps, '') AS UNSIGNED) ASC, 
      t.rt_tps ASC,
      CAST(NULLIF(t.rw_tps, '') AS UNSIGNED) ASC, 
      t.rw_tps ASC,
      t.nama_tps ASC 
      LIMIT ? OFFSET ?`;
    selectParams.push(limit, offset);

    const list = await query(selectQueryStr, selectParams);

    // Get unique RTs for this dusun to populate select dropdown dynamically from master kader table
    let rtList = [];
    if (dusun) {
      const rtQuery = `
        SELECT DISTINCT rt 
        FROM kader
        WHERE rt IS NOT NULL AND rt <> ''
          AND LOWER(
            CASE 
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
              WHEN LOWER(TRIM(COALESCE(dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
              ELSE TRIM(COALESCE(dusun, ''))
            END
          ) = LOWER(?)
        ORDER BY CAST(rt AS UNSIGNED) ASC, rt ASC
      `;
      const rtParams = [String(dusun).trim()];
      
      const rtRows = await query(rtQuery, rtParams);
      rtList = rtRows
        .map(r => r.rt)
        .filter(rtVal => rtVal !== null && rtVal !== undefined && String(rtVal).trim() !== '');
    }

    res.json({
      status: 'success',
      data: list,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      availableRTs: rtList
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 9️⃣ KPI Dashboard - Ringkasan Statistik TPS terbandingkan secara akumulatif
router.get('/statistik', verifyToken, async (req, res) => {
  try {
    // 1. Get ringkasan
    const [ringkasanStats] = await query(`
      SELECT 
        COUNT(DISTINCT dt.nama_tps) AS total_tps,
        COUNT(dt.id) AS total_pemilih_tps,
        COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) AS total_cocok_seluruh,
        COUNT(CASE WHEN hp.status_cocok = 'PERLU_DICEK' THEN 1 END) AS total_perlu_dicek_seluruh,
        COUNT(CASE WHEN hp.status_cocok = 'TIDAK_COCOK' OR hp.status_cocok IS NULL THEN 1 END) AS total_tidak_cocok_seluruh
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
    `);

    // 2. Get perbandingan per TPS
    const perbandinganList = await query(`
      SELECT 
        dt.nama_tps,
        COUNT(dt.id) AS total,
        COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) AS cocok,
        COUNT(CASE WHEN hp.status_cocok = 'PERLU_DICEK' THEN 1 END) AS perlu_dicek,
        COUNT(CASE WHEN hp.status_cocok = 'TIDAK_COCOK' OR hp.status_cocok IS NULL THEN 1 END) AS tidak_cocok,
        ROUND(COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) / COUNT(dt.id) * 100, 2) AS persentase_cocok
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      GROUP BY dt.nama_tps
      ORDER BY dt.nama_tps ASC
    `);

    res.json({
      status: 'success',
      data: {
        total_tps: ringkasanStats.total_tps || 0,
        ringkasan: ringkasanStats,
        perbandingan: perbandinganList || []
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🔟 Statistik per dusun untuk peta wilayah
router.get('/statistik-dusun', verifyToken, async (req, res) => {
  try {
    const { tps } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    
    if (tps) {
      where += ' AND dt.nama_tps = ?';
      params.push(tps);
    }

    const data = await query(`
      SELECT 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
          ELSE TRIM(COALESCE(k.dusun, dt.dusun))
        END AS dusun,
        COUNT(dt.id) AS total_pemilih_tps,
        COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) AS cocok,
        COUNT(CASE WHEN hp.status_cocok = 'PERLU_DICEK' THEN 1 END) AS perlu_dicek,
        COUNT(CASE WHEN hp.status_cocok = 'TIDAK_COCOK' OR hp.status_cocok IS NULL THEN 1 END) AS tidak_cocok,
        ROUND(COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) / COUNT(dt.id) * 100, 2) AS persentase_cocok,
        ROUND(COUNT(CASE WHEN hp.status_cocok IN ('COCOK', 'PERLU_DICEK') THEN 1 END) / COUNT(dt.id) * 100, 2) AS persentase_optimal
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
      ${where}
      GROUP BY 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
          ELSE TRIM(COALESCE(k.dusun, dt.dusun))
        END
      ORDER BY persentase_cocok DESC
    `, params);

    res.json({
      status: 'success',
      data
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
