const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { query, pool } = require('../db');
const { verifyToken, isAdmin } = require('../middleware/auth');

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

// ── SIMILARITY ENGINE & SPREADSHEET HELPERS ────────────────────────

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGender(value) {
  const raw = normalizeMatchText(value);
  if (!raw) return null;
  if (['l', 'lk', 'lakilaki', 'laki laki', 'male', 'pria'].includes(raw)) return 'L';
  if (['p', 'pr', 'perempuan', 'female', 'wanita'].includes(raw)) return 'P';
  return null;
}

function normalizeAge(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAreaCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits) return String(parseInt(digits, 10));
  return normalizeMatchText(raw);
}

function levenshteinDistance(a = '', b = '') {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function computeNameSimilarity(sourceName, candidateName) {
  const source = normalizeMatchText(sourceName);
  const candidate = normalizeMatchText(candidateName);
  if (!source || !candidate) return 0;

  // Jika nama persis sama setelah semua spasi dihilangkan (misal: "Siti Mulyo" vs "Sitimulyo")
  if (source.replace(/\s+/g, '') === candidate.replace(/\s+/g, '')) {
    return 100;
  }

  const distance = levenshteinDistance(source, candidate);
  const maxLength = Math.max(source.length, candidate.length, 1);
  const levScore = Math.max(0, 1 - (distance / maxLength));

  const sourceTokens = new Set(source.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  const overlap = [...sourceTokens].filter(token => candidateTokens.has(token)).length;
  const tokenScore = sourceTokens.size || candidateTokens.size
    ? overlap / Math.max(sourceTokens.size, candidateTokens.size)
    : 0;

  return Math.round(((levScore * 0.7) + (tokenScore * 0.3)) * 100);
}

function computeAgeSignal(tpsAge, pemilihAge) {
  if (tpsAge == null || pemilihAge == null) return 0;
  const diff = Math.abs(Number(tpsAge) - Number(pemilihAge));
  
  if (diff === 0) return 100;
  if (diff <= 1) return 100; 
  if (diff <= 2) return 95;  
  if (diff <= 3) return 85;  
  if (diff <= 5) return 60;  
  return 0;
}

function computeLocationSignal(tpsRow, pemilihRow) {
  const areaSource = normalizeMatchText([tpsRow.dusun, tpsRow.alamat].filter(Boolean).join(' '));
  const areaTarget = normalizeMatchText([pemilihRow.dusun, pemilihRow.kordus].filter(Boolean).join(' '));
  const rtSource = normalizeAreaCode(tpsRow.rt);
  const rtTarget = normalizeAreaCode(pemilihRow.rt);

  let dusunScore = 0;
  if (areaSource && areaTarget) {
    if (areaSource.includes(areaTarget) || areaTarget.includes(areaSource)) {
      dusunScore = 100;
    } else {
      dusunScore = computeNameSimilarity(areaSource, areaTarget);
    }
  }

  let rtScore = 0;
  if (rtSource && rtTarget) {
    rtScore = rtSource === rtTarget ? 100 : 0;
  }

  return { dusunScore, rtScore };
}

function findSpreadsheetColumnIndex(headers = [], aliases = []) {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeMatchText(headers[i]);
    if (aliases.some(alias => normalizeMatchText(alias) === h)) return i;
  }
  return -1;
}

function getSpreadsheetValue(row = [], aliases = []) {
  // Aliases lookup
  return '';
}

// Helper to extract cell values safely
function getRawVal(row, index) {
  if (index === undefined || index === -1 || row[index] === undefined) return '';
  return String(row[index]).trim();
}

// ── COMPARISON LOGIC CONTROLLERS ──────────────────────────────────

async function runTPSComparison(namaTps) {
  const dataTps = await query(`
    SELECT id, nama, jenis_kelamin, usia, dusun, alamat, rt, rw FROM data_tps WHERE nama_tps = ?
  `, [namaTps]);

  if (!dataTps.length) {
    const error = new Error('TPS tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }

  const pemilihLokal = await query(`
    SELECT p.id, p.nama, p.jenis_kelamin, 
           COALESCE(p.rt, k.rt) AS rt,
           COALESCE(p.rw, k.rw) AS rw,
           TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS usia,
           k.dusun, k.kordus
    FROM pemilih p
    LEFT JOIN kader k ON k.id = p.kader_id
    WHERE p.jenis_kelamin IS NOT NULL AND p.tanggal_lahir IS NOT NULL
      AND p.id NOT IN (
        SELECT DISTINCT hp.pemilih_id 
        FROM hasil_perbandingan hp
        JOIN data_tps dt ON dt.id = hp.data_tps_id
        WHERE hp.pemilih_id IS NOT NULL 
          AND hp.status_cocok IN ('COCOK', 'PERLU_DICEK')
          AND dt.nama_tps <> ?
      )
  `, [namaTps]);

  const startTime = Date.now();
  let cocok = 0, perluDicek = 0, tidakCocok = 0;

  await query(`
    DELETE hp
    FROM hasil_perbandingan hp
    JOIN data_tps dt ON dt.id = hp.data_tps_id
    WHERE dt.nama_tps = ?
  `, [namaTps]);

  const potentialMatches = [];
  for (const tps of dataTps) {
    for (const pemilih of pemilihLokal) {
      const namaSimilarity = computeNameSimilarity(tps.nama, pemilih.nama);
      const ageSignal = computeAgeSignal(tps.usia, pemilih.usia);
      const locationSignal = computeLocationSignal(tps, pemilih);

      const totalScore = Math.round(
        (namaSimilarity * 0.70) +
        (ageSignal * 0.15) +
        (((locationSignal.dusunScore + locationSignal.rtScore) / 2) * 0.15)
      );

      if (totalScore >= 60) {
        potentialMatches.push({
          tpsId: tps.id,
          pemilihId: pemilih.id,
          score: totalScore,
          namaSimilarity,
          ageSignal,
          locationSignal
        });
      }
    }
  }

  potentialMatches.sort((a, b) => b.score - a.score);

  const matchedTpsIds = new Set();
  const matchedPemilihIds = new Set();
  const finalMatches = [];

  for (const match of potentialMatches) {
    if (matchedTpsIds.has(match.tpsId) || matchedPemilihIds.has(match.pemilihId)) {
      continue;
    }

    matchedTpsIds.add(match.tpsId);
    matchedPemilihIds.add(match.pemilihId);

    let status = 'PERLU_DICEK';
    if (match.score >= 85) {
      status = 'COCOK';
      cocok++;
    } else {
      perluDicek++;
    }

    finalMatches.push({
      tpsId: match.tpsId,
      pemilihId: match.pemilihId,
      status,
      score: match.score,
      namaSimilarity: match.namaSimilarity,
      ageSignal: match.ageSignal,
      locationSignal: match.locationSignal
    });
  }

  for (const tps of dataTps) {
    if (!matchedTpsIds.has(tps.id)) {
      tidakCocok++;
      finalMatches.push({
        tpsId: tps.id,
        pemilihId: null,
        status: 'TIDAK_COCOK',
        score: 0,
        namaSimilarity: 0,
        ageSignal: 0,
        locationSignal: { dusunScore: 0, rtScore: 0 }
      });
    }
  }

  if (finalMatches.length > 0) {
    const values = finalMatches.map(m => [
      m.tpsId,
      m.pemilihId,
      m.status,
      m.score,
      `Skor: ${m.score}% (nama: ${m.namaSimilarity}%, usia: ${m.ageSignal}%, lokasi: ${Math.round((m.locationSignal.dusunScore + m.locationSignal.rtScore) / 2)}%)`
    ]);

    await query(
      `INSERT INTO hasil_perbandingan (data_tps_id, pemilih_id, status_cocok, skor_total, catatan) VALUES ?`,
      [values]
    );
  }

  return {
    durasi_ms: Date.now() - startTime,
    statistik: {
      total_data_tps: dataTps.length,
      total_pemilih: pemilihLokal.length,
      cocok,
      perlu_dicek: perluDicek,
      tidak_cocok: tidakCocok,
      persentase_cocok: dataTps.length ? Math.round((cocok / dataTps.length) * 100) : 0,
      persentase_optimal: dataTps.length ? Math.round(((cocok + perluDicek) / dataTps.length) * 100) : 0
    }
  };
}

async function refreshTPSComparisonIfNeeded(namaTps) {
  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?`,
    [namaTps]
  );
  const total = Number(countRow?.total || 0);

  if (total === 0) {
    await query(`
      DELETE hp
      FROM hasil_perbandingan hp
      JOIN data_tps dt ON dt.id = hp.data_tps_id
      WHERE dt.nama_tps = ?
    `, [namaTps]);
    return null;
  }

  return runTPSComparison(namaTps);
}

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

    const tps = req.params.nama_tps;

    const [totalRow] = await query('SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?', [tps]);
    const total = totalRow?.total || 0;

    const list = await query(`
      SELECT dt.id, dt.nama_tps, dt.nama, dt.jenis_kelamin, dt.usia, dt.dusun, dt.alamat, dt.rt, dt.rw,
             hp.status_cocok, hp.skor_total, hp.catatan,
             p.nama AS nama_lokal, p.id AS pemilih_id
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      WHERE dt.nama_tps = ?
      ORDER BY dt.nama ASC
      LIMIT ? OFFSET ?
    `, [tps, limit, offset]);

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
    const { dusun, rt } = req.query;

    const tps = req.params.nama_tps;
    const isAllTps = (!tps || tps.toLowerCase() === 'all' || tps.toLowerCase() === 'sitimulyo');
    
    const countParams = [];
    if (!isAllTps) countParams.push(tps);
    
    let countQueryStr = `
      SELECT COUNT(*) AS total FROM (
        SELECT dt.rt AS rt_tps, dt.rw AS rw_tps,
               CASE 
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
                 WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
                 ELSE TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun))
               END AS resolved_dusun
        FROM hasil_perbandingan hp
        JOIN data_tps dt ON dt.id = hp.data_tps_id
        LEFT JOIN pemilih p ON p.id = hp.pemilih_id
        LEFT JOIN kader k ON k.id = p.kader_id
        LEFT JOIN (
          SELECT rt, MAX(dusun) AS dusun
          FROM kader
          WHERE rt IS NOT NULL AND rt <> ''
          GROUP BY rt
        ) AS rt_mapping ON rt_mapping.rt = dt.rt
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
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
                  WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
                  ELSE TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun))
                END AS resolved_dusun
         FROM hasil_perbandingan hp
         JOIN data_tps dt ON dt.id = hp.data_tps_id
         LEFT JOIN pemilih p ON p.id = hp.pemilih_id
         LEFT JOIN kader k ON k.id = p.kader_id
         LEFT JOIN (
            SELECT rt, MAX(dusun) AS dusun
            FROM kader
            WHERE rt IS NOT NULL AND rt <> ''
            GROUP BY rt
          ) AS rt_mapping ON rt_mapping.rt = dt.rt
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

    selectQueryStr += ` ORDER BY 
      CAST(NULLIF(t.rt_tps, '') AS UNSIGNED) ASC, 
      t.rt_tps ASC,
      CAST(NULLIF(t.rw_tps, '') AS UNSIGNED) ASC, 
      t.rw_tps ASC,
      t.nama_tps ASC 
      LIMIT ? OFFSET ?`;
    selectParams.push(limit, offset);

    const list = await query(selectQueryStr, selectParams);

    // Get unique RTs for this dusun to populate select dropdown dynamically
    let rtList = [];
    if (dusun) {
      const rtQuery = `
        SELECT DISTINCT dt.rt 
        FROM hasil_perbandingan hp
        JOIN data_tps dt ON dt.id = hp.data_tps_id
        LEFT JOIN pemilih p ON p.id = hp.pemilih_id
        LEFT JOIN kader k ON k.id = p.kader_id
        LEFT JOIN (
          SELECT rt, MAX(dusun) AS dusun
          FROM kader
          WHERE rt IS NOT NULL AND rt <> ''
          GROUP BY rt
        ) AS rt_mapping ON rt_mapping.rt = dt.rt
        WHERE 1=1
        ${isAllTps ? '' : 'AND dt.nama_tps = ?'}
        AND LOWER(
          CASE 
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
            WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
            ELSE TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun))
          END
        ) = LOWER(?)
        ORDER BY CAST(NULLIF(dt.rt, '') AS UNSIGNED) ASC, dt.rt ASC
      `;
      const rtParams = [];
      if (!isAllTps) rtParams.push(tps);
      rtParams.push(String(dusun).trim());
      
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
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
          ELSE TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun))
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
      LEFT JOIN (
        SELECT rt, MAX(dusun) AS dusun
        FROM kader
        WHERE rt IS NOT NULL AND rt <> ''
        GROUP BY rt
      ) AS rt_mapping ON rt_mapping.rt = dt.rt
      ${where}
      GROUP BY 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
          ELSE TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun))
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
