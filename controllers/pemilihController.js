const XLSX = require('xlsx');
const { query } = require('../db');
const {
  genId,
  normalizeNIK,
  getNIKStatus,
  hitungUmur,
  cleanupDuplicateLogs,
  extractTPSRows,
  getSpreadsheetValue
} = require('../utils/voterHelpers');

// Helper: check if column exists
async function hasColumn(table, column) {
  const res = await query(
    `SELECT COUNT(*) AS n
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [process.env.DB_NAME || 'pendataan_pemilih', table, column]
  );
  return res[0] && res[0].n > 0;
}

// GET /api/pemilih
async function getPemilih(req, res) {
  try {
    const { q, kaderId, statusFilter, page, limit } = req.query;
    const pg  = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pg - 1) * lim;

    let where  = ' WHERE 1=1';
    const params = [];

    if (kaderId)  { where += ' AND p.kader_id = ?';                params.push(kaderId); }
    if (q)        { where += ' AND (p.nama LIKE ? OR p.nik LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (statusFilter === 'bermasalah') {
      where += ' AND p.status IS NOT NULL';
    } else if (statusFilter === 'underage') {
      where += " AND p.status = 'BELUM_CUKUP_UMUR'";
    } else if (statusFilter === 'clear') {
      where += ' AND p.status IS NULL';
    }

    const [countRow] = await query(
      `SELECT COUNT(*) AS total FROM pemilih p JOIN kader k ON k.id = p.kader_id ${where}`, params
    );
    const total = countRow.total;

    const data = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id
      ${where}
      ORDER BY k.nomor ASC, p.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, lim, offset]);

    res.json({
      data,
      total,
      page: pg,
      limit: lim,
      totalPages: Math.ceil(total / lim) || 1
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/pemilih/statistik
async function getPemilihStats(req, res) {
  try {
    await cleanupDuplicateLogs();

    const [totalSemua] = await query('SELECT COUNT(*) AS n FROM pemilih');
    const [bermasalah] = await query('SELECT COUNT(*) AS n FROM pemilih WHERE status IS NOT NULL');
    const [underage]   = await query("SELECT COUNT(*) AS n FROM pemilih WHERE status = 'BELUM_CUKUP_UMUR'");
    const clear = Math.max((totalSemua.n || 0) - (bermasalah.n || 0), 0);

    const [logRows] = await query('SELECT COUNT(*) AS n FROM log_duplikat');
    let percobaanDuplikat = logRows.n;

    if (await hasColumn('log_duplikat', 'jumlah_percobaan')) {
      const [logDup] = await query('SELECT COALESCE(SUM(jumlah_percobaan), 0) AS n FROM log_duplikat');
      percobaanDuplikat = logDup.n;
    }

    res.json({
      total: clear,
      clear,
      totalSemua: totalSemua.n,
      bermasalah: bermasalah.n,
      underage: underage.n,
      percobaanDuplikat,
      entryDuplikat: logRows.n
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/pemilih/cek-nik/:nik
async function checkNIK(req, res) {
  try {
    const rows = await query(`
      SELECT p.nama, p.nik, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.nik = ?
    `, [req.params.nik]);
    res.json({ exists: rows.length > 0, data: rows[0] || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/pemilih/:id
async function getPemilihById(req, res) {
  try {
    const rows = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Pemilih tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/pemilih
async function addPemilih(req, res) {
  try {
    const { nama, nik, kaderId, tanggalLahir, jenisKelamin, rt, rw } = req.body;
    if (!nama || !kaderId) return res.status(400).json({ error: 'Nama dan Kader wajib diisi' });
    const normalizedNik = normalizeNIK(nik);

    if (tanggalLahir) {
      const umur = hitungUmur(tanggalLahir);
      if (umur !== null && umur < 17) return res.status(400).json({ error: 'Umur minimal 17 tahun (berdasarkan tanggal lahir)' });
    }

    const kaderAda = await query('SELECT id, nama, nomor FROM kader WHERE id = ?', [kaderId]);
    if (!kaderAda.length) return res.status(400).json({ error: 'Kader tidak ditemukan' });

    const status = getNIKStatus(normalizedNik);

    let nikDup = [];
    if (normalizedNik) {
      nikDup = await query(`
      SELECT p.id, p.nama, p.kader_id, CONCAT('Kader ', k.nomor, ' — ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.nik = ?
      `, [normalizedNik]);
    }

    if (nikDup.length) {
      const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');

      if (hasJumlahPercobaan) {
        await query(
          `INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             jumlah_percobaan = jumlah_percobaan + 1,
             waktu_terakhir = CURRENT_TIMESTAMP,
             nama_input = VALUES(nama_input)`,
          [normalizedNik, nama.trim(), kaderId, nikDup[0].kader_id, nikDup[0].nama]
        );
      } else {
        await query(
          'INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing) VALUES (?, ?, ?, ?, ?)',
          [normalizedNik, nama.trim(), kaderId, nikDup[0].kader_id, nikDup[0].nama]
        );
      }

      return res.status(409).json({
        error: `DITOLAK: NIK ${normalizedNik} sudah terdaftar pada ${nikDup[0].namaKader} atas nama "${nikDup[0].nama}".`,
        existing: nikDup[0]
      });
    }

    const id = genId();
    let finalStatus = status;
    
    try {
      await query(
        'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status, rt, rw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, nama.trim(), normalizedNik, tanggalLahir || null, jenisKelamin || null, kaderId, finalStatus, rt || null, rw || null]
      );
    } catch (insertError) {
      if (insertError.code === 'ER_TRUNCATED_WRONG_VALUE' || insertError.message.includes('Incorrect')) {
        finalStatus = 'tanggal_invalid';
        await query(
          'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status, rt, rw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, nama.trim(), normalizedNik, null, jenisKelamin || null, kaderId, finalStatus, rt || null, rw || null]
        );
      } else {
        throw insertError;
      }
    }

    const [p] = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama) AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.id = ?
    `, [id]);
    res.status(201).json(p);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'NIK sudah terdaftar (constraint)' });
    res.status(500).json({ error: e.message });
  }
}

// PUT /api/pemilih/:id
async function updatePemilih(req, res) {
  try {
    const { nama, nik, kaderId, tanggalLahir, jenisKelamin, rt, rw } = req.body;
    if (!nama || !kaderId) return res.status(400).json({ error: 'Nama dan Kader wajib diisi' });
    const normalizedNik = normalizeNIK(nik);

    const pemilihLama = await query('SELECT nik FROM pemilih WHERE id = ?', [req.params.id]);
    if (!pemilihLama.length) return res.status(404).json({ error: 'Pemilih tidak ditemukan' });

    const status = getNIKStatus(normalizedNik);

    let nikDup = [];
    if (normalizedNik) {
      nikDup = await query(`
      SELECT p.nama, CONCAT('Kader ', k.nomor, ' — ', k.nama) AS namaKader
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.nik = ? AND p.id != ?
      `, [normalizedNik, req.params.id]);
    }
    if (nikDup.length) return res.status(400).json({ error: `NIK sudah dipakai oleh ${nikDup[0].nama} (${nikDup[0].namaKader})` });

    await query(
      'UPDATE pemilih SET nama = ?, nik = ?, kader_id = ?, tanggal_lahir = ?, jenis_kelamin = ?, status = ?, rt = ?, rw = ? WHERE id = ?',
      [nama.trim(), normalizedNik, kaderId, tanggalLahir || null, jenisKelamin || null, status, rt || null, rw || null, req.params.id]
    );
    if ((pemilihLama[0].nik || null) !== normalizedNik) {
      await cleanupDuplicateLogs([pemilihLama[0].nik]);
    }
    const [p] = await query(`
      SELECT p.*, CONCAT('Kader ', k.nomor, ' — ', k.nama) AS namaKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p JOIN kader k ON k.id = p.kader_id WHERE p.id = ?
    `, [req.params.id]);
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// DELETE /api/pemilih/:id
async function deletePemilih(req, res) {
  try {
    const pemilih = await query('SELECT nik FROM pemilih WHERE id = ?', [req.params.id]);
    if (!pemilih.length) return res.status(404).json({ error: 'Pemilih tidak ditemukan' });

    await query('DELETE FROM pemilih WHERE id = ?', [req.params.id]);
    await cleanupDuplicateLogs([pemilih[0].nik]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Helper: cleanup uploaded file
function cleanupUploadedFile(filePath) {
  if (!filePath) return;
  const fs = require('fs');
  try { fs.unlinkSync(filePath); } catch (_) {}
}

// Helper: search existing voters by NIK
async function findExistingPemilihByNIK(nikList = []) {
  const uniqueNIKs = [...new Set(nikList.filter(Boolean))];
  if (!uniqueNIKs.length) return new Map();

  const rows = await query(`
    SELECT p.nik, p.nama, p.kader_id,
           CONCAT('Kader ', k.nomor, ' ', k.nama, ' (', COALESCE(k.dusun, '-'), ' · ', COALESCE(k.kordus, '-'), ')') AS namaKader
    FROM pemilih p
    JOIN kader k ON k.id = p.kader_id
    WHERE p.nik IN (${uniqueNIKs.map(() => '?').join(', ')})
  `, uniqueNIKs);

  return new Map(rows.map(row => [row.nik, row]));
}

// Helper: log duplicate activity
async function catatLogDuplikat(nik, namaInput, kaderIdPelaku, existingRow) {
  if (!nik || !existingRow) return;

  const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');
  if (hasJumlahPercobaan) {
    await query(
      `INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         jumlah_percobaan = jumlah_percobaan + 1,
         waktu_terakhir = CURRENT_TIMESTAMP,
         nama_input = VALUES(nama_input)`,
      [nik, namaInput, kaderIdPelaku, existingRow.kader_id, existingRow.nama]
    );
  } else {
    await query(
      'INSERT INTO log_duplikat (nik_target, nama_input, kader_id_pelaku, kader_id_existing, nama_existing) VALUES (?, ?, ?, ?, ?)',
      [nik, namaInput, kaderIdPelaku, existingRow.kader_id, existingRow.nama]
    );
  }
}

// Helper: analyze import file rows
async function analyzeImportRows(rows) {
  const normalizedRows = rows.map((row, index) => ({
    baris: index + 2,
    nama: String(getSpreadsheetValue(row, ['nama', 'NAMA', 'Nama'])).trim(),
    nik: normalizeNIK(getSpreadsheetValue(row, ['nik', 'NIK', 'Nik']))
  }));

  const existingByNIK = await findExistingPemilihByNIK(normalizedRows.map(row => row.nik));
  const seenInFile = new Map();

  const hasil = {
    total: normalizedRows.length,
    siap: 0,
    bermasalah: 0,
    duplikat: 0,
    gagal: 0,
    akanDiimport: 0,
    detail: []
  };

  for (const row of normalizedRows) {
    const { baris, nama, nik } = row;

    if (!nama) {
      hasil.gagal++;
      hasil.detail.push({
        baris, nama, nik,
        status: 'gagal',
        alasan: 'Nama wajib diisi',
        bisaImport: false
      });
      continue;
    }

    if (nik && seenInFile.has(nik)) {
      const firstInFile = seenInFile.get(nik);
      hasil.duplikat++;
      hasil.detail.push({
        baris, nama, nik,
        status: 'duplikat',
        alasan: `NIK ganda di dalam file import (duplikat dari baris ${firstInFile.baris})`,
        bisaImport: false,
        existing: {
          nama: firstInFile.nama,
          kader_id: null,
          namaKader: `baris ${firstInFile.baris} di file import`
        }
      });
      continue;
    }

    const existing = nik ? existingByNIK.get(nik) : null;
    if (existing) {
      hasil.duplikat++;
      hasil.detail.push({
        baris, nama, nik,
        status: 'duplikat',
        alasan: `NIK sudah terdaftar atas nama "${existing.nama}" di ${existing.namaKader}`,
        bisaImport: false,
        existing
      });
      continue;
    }

    if (nik) {
      seenInFile.set(nik, { baris, nama });
    }

    let status = 'siap';
    let alasan = '';
    let importStatus = null;

    if (!nik) {
      status = 'bermasalah';
      alasan = 'NIK kosong';
      importStatus = 'NIK_INVALID';
      hasil.bermasalah++;
    } else if (nik.length !== 16) {
      status = 'bermasalah';
      alasan = `NIK tidak 16 digit (${nik.length} digit)`;
      importStatus = 'NIK_INVALID';
      hasil.bermasalah++;
    } else {
      hasil.siap++;
    }

    hasil.akanDiimport++;
    hasil.detail.push({
      baris,
      nama,
      nik,
      status,
      alasan,
      bisaImport: true,
      importStatus
    });
  }

  return hasil;
}

// POST /api/pemilih/import/preview
async function importPreview(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    const kaderId = req.body.kaderId;
    if (!kaderId) return res.status(400).json({ error: 'Kader tujuan wajib dipilih' });

    const kaderAda = await query('SELECT id, nama, nomor FROM kader WHERE id = ?', [kaderId]);
    if (!kaderAda.length) return res.status(400).json({ error: 'Kader tidak ditemukan' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = extractTPSRows(sheet);
    const hasil = await analyzeImportRows(rows);

    cleanupUploadedFile(req.file.path);

    res.json({
      mode: 'preview',
      ...hasil,
      perluKonfirmasi: hasil.total > 0,
      pesan: hasil.duplikat || hasil.bermasalah || hasil.gagal
        ? 'Periksa hasil cross-check dulu sebelum melanjutkan import.'
        : 'Semua data lolos cross-check dan siap diimport.'
    });
  } catch (e) {
    cleanupUploadedFile(req.file?.path);
    res.status(500).json({ error: e.message });
  }
}

// POST /api/pemilih/import
async function importSubmit(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    const kaderId = req.body.kaderId;
    if (!kaderId) return res.status(400).json({ error: 'Kader tujuan wajib dipilih' });
    let excludedBaris = [];

    if (req.body.excludedBaris) {
      try {
        const parsedExcluded = JSON.parse(req.body.excludedBaris);
        excludedBaris = Array.isArray(parsedExcluded) ? parsedExcluded.map(Number).filter(Number.isFinite) : [];
      } catch (_) {
        return res.status(400).json({ error: 'Format data pengecualian import tidak valid' });
      }
    }

    const kaderAda = await query('SELECT id, nama, nomor FROM kader WHERE id = ?', [kaderId]);
    if (!kaderAda.length) return res.status(400).json({ error: 'Kader tidak ditemukan' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const analisis = await analyzeImportRows(rows);
    const excludedSet = new Set(excludedBaris);
    const hasil = {
      berhasil: 0,
      bermasalah: 0,
      duplikat: 0,
      gagal: 0,
      dilewati: 0,
      detail: []
    };

    for (const item of analisis.detail) {
      if (!item.bisaImport) {
        if (item.status === 'duplikat') {
          hasil.duplikat++;
          let existingForLog = item.existing && item.existing.kader_id
            ? item.existing
            : null;

          if (!existingForLog && item.nik) {
            const currentExisting = await query(
              'SELECT nama, kader_id FROM pemilih WHERE nik = ? LIMIT 1',
              [item.nik]
            );
            existingForLog = currentExisting[0] || null;
          }

          if (existingForLog) {
            await catatLogDuplikat(item.nik, item.nama, kaderId, existingForLog);
          }
        } else {
          hasil.gagal++;
        }

        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: item.status,
          alasan: item.alasan
        });
        continue;
      }

      if (excludedSet.has(item.baris)) {
        hasil.dilewati++;
        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: 'dilewati',
          alasan: 'Ditandai jangan dimasukkan saat preview'
        });
        continue;
      }

      const parsed = parseNIK(item.nik);
      const tanggalLahir = parsed ? parsed.tanggalLahir : null;
      const jenisKelamin = parsed ? parsed.jenisKelamin : null;
      
      let insertStatus = item.importStatus;
      
      try {
        await query(
          'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [genId(), item.nama, item.nik, tanggalLahir, jenisKelamin, kaderId, insertStatus]
        );
      } catch (insertError) {
        if (insertError.code === 'ER_TRUNCATED_WRONG_VALUE' || insertError.message.includes('Incorrect')) {
          insertStatus = 'tanggal_invalid';
          await query(
            'INSERT INTO pemilih (id, nama, nik, tanggal_lahir, jenis_kelamin, kader_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [genId(), item.nama, item.nik, null, jenisKelamin, kaderId, insertStatus]
          );
        } else {
          throw insertError;
        }
      }

      if (item.status === 'bermasalah') {
        hasil.bermasalah++;
        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: 'bermasalah',
          alasan: item.alasan
        });
      } else {
        hasil.berhasil++;
        hasil.detail.push({
          baris: item.baris,
          nama: item.nama,
          nik: item.nik,
          status: 'berhasil',
          alasan: ''
        });
      }
    }

    cleanupUploadedFile(req.file.path);
    res.json({
      ...hasil,
      total: analisis.total,
      siap: analisis.siap,
      akanDiimport: analisis.akanDiimport
    });
  } catch (e) {
    cleanupUploadedFile(req.file?.path);
    res.status(500).json({ error: e.message });
  }
}

// GET /api/log-duplikat
async function getLogDuplikat(req, res) {
  try {
    await cleanupDuplicateLogs();

    const { page, limit, kaderId } = req.query;
    const pg  = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pg - 1) * lim;

    let where  = '';
    const params = [];
    if (kaderId) { where = ' WHERE l.kader_id_pelaku = ?'; params.push(kaderId); }

    const [countRow] = await query(
      `SELECT COUNT(*) AS total FROM log_duplikat l${where}`, params
    );

    const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');
    const hasWaktuTerakhir   = await hasColumn('log_duplikat', 'waktu_terakhir');
    const hasWaktuPertama   = await hasColumn('log_duplikat', 'waktu_pertama');

    const data = await query(`
      SELECT l.nik_target, l.nama_input, l.kader_id_pelaku, l.kader_id_existing,
             l.nama_existing,
             ${hasJumlahPercobaan ? 'l.jumlah_percobaan' : '1 AS jumlah_percobaan'},
             ${hasWaktuPertama ? 'l.waktu_pertama' : 'l.created_at'} AS waktu_pertama,
             ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} AS waktu_terakhir,
             CASE
               WHEN kp.id IS NOT NULL THEN CONCAT('Kader ', kp.nomor, ' — ', kp.nama)
               WHEN l.kader_id_pelaku IS NOT NULL THEN CONCAT('ID: ', l.kader_id_pelaku)
               ELSE '-' END AS kaderPelaku,
             CASE
               WHEN ke.id IS NOT NULL THEN CONCAT('Kader ', ke.nomor, ' — ', ke.nama)
               WHEN l.kader_id_existing IS NOT NULL THEN CONCAT('ID: ', l.kader_id_existing)
               ELSE '-' END AS kaderExisting
      FROM log_duplikat l
      LEFT JOIN kader kp ON kp.id = l.kader_id_pelaku
      LEFT JOIN kader ke ON ke.id = l.kader_id_existing
      ${where}
      ORDER BY ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} DESC
      LIMIT ? OFFSET ?
    `, [...params, lim, offset]);

    res.json({
      data,
      total: countRow.total,
      page: pg,
      totalPages: Math.ceil(countRow.total / lim) || 1
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/log-duplikat/statistik
async function getLogDuplikatStats(req, res) {
  try {
    await cleanupDuplicateLogs();

    const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');

    const [totalNIK] = await query('SELECT COUNT(*) AS n FROM log_duplikat');
    let totalPercobaan = totalNIK.n;

    let perKader;
    if (hasJumlahPercobaan) {
      const [row] = await query('SELECT COALESCE(SUM(jumlah_percobaan), 0) AS n FROM log_duplikat');
      totalPercobaan = row.n;
      perKader = await query(`
        SELECT CONCAT('Kader ', k.nomor, ' — ', k.nama) AS kader,
               COUNT(DISTINCT l.nik_target) AS nikDirebut,
               SUM(l.jumlah_percobaan) AS totalSpam
        FROM log_duplikat l JOIN kader k ON k.id = l.kader_id_pelaku
        GROUP BY l.kader_id_pelaku ORDER BY totalSpam DESC
      `);
    } else {
      perKader = await query(`
        SELECT CONCAT('Kader ', k.nomor, ' — ', k.nama) AS kader,
               COUNT(DISTINCT l.nik_target) AS nikDirebut,
               COUNT(*) AS totalSpam
        FROM log_duplikat l JOIN kader k ON k.id = l.kader_id_pelaku
        GROUP BY l.kader_id_pelaku ORDER BY totalSpam DESC
      `);
    }

    res.json({ totalPercobaan, totalNIK: totalNIK.n, perKader });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/pemilih/tidak-terpeta
async function getUnmappedPemilih(req, res) {
  try {
    const { q, page, limit } = req.query;
    const pg  = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(2000, Math.max(1, parseInt(limit) || 1000));
    const offset = (pg - 1) * lim;

    let searchClause = '';
    const params = [];
    if (q) {
      searchClause = ' AND (p.nama LIKE ? OR p.nik LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    const countRows = await query(`
      SELECT COUNT(*) AS total
      FROM pemilih p
      LEFT JOIN kader k ON k.id = p.kader_id
      LEFT JOIN hasil_perbandingan hp ON hp.pemilih_id = p.id
      WHERE (hp.id IS NULL 
         OR k.id IS NULL 
         OR LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('', 'sitimulyo'))
         ${searchClause}
    `, params);

    const data = await query(`
      SELECT p.id, p.nama, p.nik, p.status, p.rt, p.rw, p.created_at,
             k.nama AS namaKader, k.nomor AS nomorKader, k.dusun AS dusunKader,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur,
             CASE
               WHEN hp.id IS NOT NULL THEN hp.status_cocok
               ELSE 'BELUM_DIBANDINGKAN'
             END AS status_cocok
      FROM pemilih p
      LEFT JOIN kader k ON k.id = p.kader_id
      LEFT JOIN hasil_perbandingan hp ON hp.pemilih_id = p.id
      WHERE (hp.id IS NULL 
         OR k.id IS NULL 
         OR LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('', 'sitimulyo'))
         ${searchClause}
      ORDER BY p.nama ASC
      LIMIT ? OFFSET ?
    `, [...params, lim, offset]);

    res.json({
      status: 'success',
      data,
      total: countRows[0]?.total || 0,
      page: pg,
      limit: lim
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getPemilih,
  getPemilihStats,
  checkNIK,
  getPemilihById,
  addPemilih,
  updatePemilih,
  deletePemilih,
  importPreview,
  importSubmit,
  getLogDuplikat,
  getLogDuplikatStats,
  getUnmappedPemilih
};
