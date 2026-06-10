const { query } = require('../db');
const { genId, cleanupDuplicateLogs } = require('../utils/voterHelpers');

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

// Helper: resolve koordinator input
async function resolveKoordinatorInput(payload = {}) {
  const koordinatorId = String(payload.koordinatorId || '').trim();
  const legacyName = String(payload.kordus || payload.namaKoordinator || '').trim();

  if (koordinatorId) {
    const rows = await query('SELECT id, nama FROM koordinator WHERE id = ? LIMIT 1', [koordinatorId]);
    if (!rows.length) {
      return { error: 'Koordinator tidak ditemukan' };
    }
    return rows[0];
  }

  if (!legacyName) {
    return { error: 'Koordinator wajib dipilih' };
  }

  const existing = await query('SELECT id, nama FROM koordinator WHERE nama = ? LIMIT 1', [legacyName]);
  if (existing.length) {
    return existing[0];
  }

  const id = genId();
  await query('INSERT INTO koordinator (id, nama) VALUES (?, ?)', [id, legacyName]);
  return { id, nama: legacyName };
}

// GET /api/koordinator
async function getKoordinator(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    let where = '';
    const params = [];

    if (q) {
      where = 'WHERE ko.nama LIKE ?';
      params.push(`%${q}%`);
    }

    const rows = await query(`
      SELECT ko.id, ko.nama, ko.created_at,
             COUNT(DISTINCT k.id) AS jumlahKader,
             COUNT(p.id) AS jumlahPemilih,
             COUNT(DISTINCT NULLIF(TRIM(k.dusun), '')) AS jumlahDusun
      FROM koordinator ko
      LEFT JOIN kader k ON k.koordinator_id = ko.id
      LEFT JOIN pemilih p ON p.kader_id = k.id
      ${where}
      GROUP BY ko.id, ko.nama, ko.created_at
      ORDER BY ko.nama ASC
    `, params);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/koordinator
async function addKoordinator(req, res) {
  try {
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.status(400).json({ error: 'Nama koordinator wajib diisi' });

    const dup = await query('SELECT id FROM koordinator WHERE nama = ? LIMIT 1', [nama]);
    if (dup.length) return res.status(400).json({ error: 'Nama koordinator sudah terdaftar' });

    const id = genId();
    await query('INSERT INTO koordinator (id, nama) VALUES (?, ?)', [id, nama]);

    res.status(201).json({
      id,
      nama,
      jumlahKader: 0,
      jumlahPemilih: 0,
      jumlahDusun: 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PUT /api/koordinator/:id
async function updateKoordinator(req, res) {
  try {
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.status(400).json({ error: 'Nama koordinator wajib diisi' });

    const exists = await query('SELECT id FROM koordinator WHERE id = ? LIMIT 1', [req.params.id]);
    if (!exists.length) return res.status(404).json({ error: 'Koordinator tidak ditemukan' });

    const dup = await query('SELECT id FROM koordinator WHERE nama = ? AND id != ? LIMIT 1', [nama, req.params.id]);
    if (dup.length) return res.status(400).json({ error: 'Nama koordinator sudah dipakai' });

    await query('UPDATE koordinator SET nama = ? WHERE id = ?', [nama, req.params.id]);
    await query('UPDATE kader SET kordus = ? WHERE koordinator_id = ?', [nama, req.params.id]);

    const [row] = await query('SELECT id, nama, created_at FROM koordinator WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// DELETE /api/koordinator/:id
async function deleteKoordinator(req, res) {
  try {
    const exists = await query('SELECT id FROM koordinator WHERE id = ? LIMIT 1', [req.params.id]);
    if (!exists.length) return res.status(404).json({ error: 'Koordinator tidak ditemukan' });

    const [usage] = await query('SELECT COUNT(*) AS jumlah FROM kader WHERE koordinator_id = ?', [req.params.id]);
    if (Number(usage?.jumlah || 0) > 0) {
      return res.status(400).json({ error: `Koordinator masih dipakai oleh ${usage.jumlah} kader` });
    }

    await query('DELETE FROM koordinator WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/kader/statistik-dusun
async function getKaderDusunStats(req, res) {
  try {
    const data = await query(`
      SELECT 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari', 'gondosari somokaton', 'gondosari-somokaton', 'gondosari') THEN 'Gondosari-Somokaton'
          ELSE TRIM(k.dusun)
        END AS dusun,
        COUNT(k.id) AS total_kader,
        GROUP_CONCAT(CONCAT('Kader ', k.nomor, ' (', k.nama, ')') ORDER BY k.nomor ASC SEPARATOR ', ') AS daftar_kader
      FROM kader k
      GROUP BY 1
    `);
    
    const pemilihStats = await query(`
      SELECT 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari', 'gondosari somokaton', 'gondosari-somokaton', 'gondosari') THEN 'Gondosari-Somokaton'
          ELSE TRIM(k.dusun)
        END AS dusun,
        COUNT(p.id) AS total_pemilih
      FROM pemilih p
      JOIN kader k ON k.id = p.kader_id
      GROUP BY 1
    `);

    const result = data.map(item => {
      const pStat = pemilihStats.find(p => p.dusun.toLowerCase() === item.dusun.toLowerCase());
      return {
        dusun: item.dusun,
        total_kader: item.total_kader,
        daftar_kader: item.daftar_kader,
        total_pemilih: pStat ? pStat.total_pemilih : 0
      };
    });

    res.json({ status: 'success', data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/kader
async function getKaders(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    const koordinatorId = String(req.query.koordinatorId || '').trim();
    const dusun = String(req.query.dusun || '').trim();
    let where = 'WHERE 1 = 1';
    const params = [];

    if (q) {
      where += ` AND (
        k.nama LIKE ?
        OR k.dusun LIKE ?
        OR COALESCE(ko.nama, k.kordus, '') LIKE ?
        OR CAST(k.nomor AS CHAR) LIKE ?
      )`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (koordinatorId) {
      where += ' AND k.koordinator_id = ?';
      params.push(koordinatorId);
    }

    if (dusun) {
      where += ` AND LOWER(
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('', 'sitimulyo') THEN 'alamat umum (belum terinci)'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'karang gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'karang ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'pager gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'pager gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'karang anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari', 'gondosari somokaton', 'gondosari-somokaton', 'gondosari') THEN 'gondosari-somokaton'
          ELSE LOWER(TRIM(k.dusun))
        END
      ) = LOWER(?)`;
      params.push(dusun);
    }

    const rows = await query(`
      SELECT k.id, k.nama, k.nomor, k.dusun, k.kordus, k.rt, k.rw, k.target_suara, k.created_at, k.koordinator_id,
             COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator,
             (
               SELECT COUNT(*)
               FROM pemilih p
               WHERE p.kader_id = k.id
             ) AS jumlahPemilih
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      ${where}
      ORDER BY COALESCE(ko.nama, NULLIF(k.kordus, ''), 'zzz') ASC, k.dusun ASC, k.nomor ASC
    `, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/kader/:id
async function getKaderById(req, res) {
  try {
    const rows = await query(`
      SELECT k.*, COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      WHERE k.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Kader tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/kader
async function addKader(req, res) {
  try {
    const { nama, nomor, dusun, rt, rw } = req.body;
    if (!nama || !nomor || !dusun) return res.status(400).json({ error: 'Nama, nomor, dusun, dan koordinator wajib diisi' });

    const koordinator = await resolveKoordinatorInput(req.body);
    if (koordinator.error) return res.status(400).json({ error: koordinator.error });

    const dup = await query('SELECT id FROM kader WHERE nomor = ?', [parseInt(nomor)]);
    if (dup.length) return res.status(400).json({ error: `Kader ${nomor} sudah terdaftar` });
    const id = genId();
    await query('INSERT INTO kader (id, nama, nomor, dusun, kordus, rt, rw, koordinator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, nama.trim(), parseInt(nomor), dusun.trim(), koordinator.nama, rt || null, rw || null, koordinator.id]);
    const [kader] = await query(`
      SELECT k.*, COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      WHERE k.id = ?
    `, [id]);
    res.status(201).json(kader);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PUT /api/kader/:id
async function updateKader(req, res) {
  try {
    const { nama, nomor, dusun, rt, rw } = req.body;
    if (!nama || !nomor || !dusun) return res.status(400).json({ error: 'Nama, nomor, dusun, dan koordinator wajib diisi' });

    const koordinator = await resolveKoordinatorInput(req.body);
    if (koordinator.error) return res.status(400).json({ error: koordinator.error });

    const dup = await query('SELECT id FROM kader WHERE nomor = ? AND id != ?', [parseInt(nomor), req.params.id]);
    if (dup.length) return res.status(400).json({ error: `Nomor kader ${nomor} sudah dipakai` });
    await query('UPDATE kader SET nama = ?, nomor = ?, dusun = ?, kordus = ?, rt = ?, rw = ?, koordinator_id = ? WHERE id = ?',
      [nama.trim(), parseInt(nomor), dusun.trim(), koordinator.nama, rt || null, rw || null, koordinator.id, req.params.id]);
    const [kader] = await query(`
      SELECT k.*, COALESCE(ko.nama, NULLIF(k.kordus, '')) AS namaKoordinator
      FROM kader k
      LEFT JOIN koordinator ko ON ko.id = k.koordinator_id
      WHERE k.id = ?
    `, [req.params.id]);
    res.json(kader);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// DELETE /api/kader/:id
async function deleteKader(req, res) {
  try {
    const { deleteAction } = req.body || {};
    
    if (!deleteAction || deleteAction === 'delete') {
      const pemilihDalamKader = await query('SELECT nik FROM pemilih WHERE kader_id = ?', [req.params.id]);

      await query('DELETE FROM pemilih WHERE kader_id = ?', [req.params.id]);
      await cleanupDuplicateLogs(pemilihDalamKader.map(p => p.nik));
      await query('DELETE FROM kader WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Action tidak valid' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/kader/:id/pemilih
async function getKaderPemilih(req, res) {
  try {
    const data = await query(`
      SELECT p.*, 
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p
      WHERE p.kader_id = ?
      ORDER BY p.created_at DESC
    `, [req.params.id]);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/kader/:id/aktivitas
async function getKaderActivity(req, res) {
  try {
    await cleanupDuplicateLogs();

    const kaderId = req.params.id;
    const pemilih = await query(`
      SELECT p.*,
             TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS umur
      FROM pemilih p
      WHERE p.kader_id = ?
      ORDER BY p.created_at DESC
    `, [kaderId]);

    const hasJumlahPercobaan = await hasColumn('log_duplikat', 'jumlah_percobaan');
    const hasWaktuTerakhir   = await hasColumn('log_duplikat', 'waktu_terakhir');
    const hasWaktuPertama    = await hasColumn('log_duplikat', 'waktu_pertama');

    const duplikat = await query(`
      SELECT CONCAT('dup-', COALESCE(l.nik_target, 'tanpa-nik'), '-', COALESCE(l.kader_id_pelaku, 'unknown')) AS id,
             l.nik_target AS nik,
             COALESCE(NULLIF(l.nama_input, ''), NULLIF(l.nama_existing, ''), '(tanpa nama)') AS nama,
             l.nama_existing,
             ${hasJumlahPercobaan ? 'l.jumlah_percobaan' : '1'} AS jumlah_percobaan,
             ${hasWaktuPertama ? 'l.waktu_pertama' : 'l.created_at'} AS waktu_pertama,
             ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} AS waktu_terakhir,
             CASE
               WHEN ke.id IS NOT NULL THEN CONCAT('Kader ', ke.nomor, ' - ', ke.nama)
               WHEN l.kader_id_existing IS NOT NULL THEN CONCAT('ID: ', l.kader_id_existing)
               ELSE '-'
             END AS kaderExisting
      FROM log_duplikat l
      LEFT JOIN kader ke ON ke.id = l.kader_id_existing
      WHERE l.kader_id_pelaku = ?
      ORDER BY ${hasWaktuTerakhir ? 'l.waktu_terakhir' : 'l.created_at'} DESC
    `, [kaderId]);

    const totalBermasalah = pemilih.filter(item => item.status !== null).length;
    const totalDuplikatBaris = duplikat.length;
    const totalDuplikatPercobaan = duplikat.reduce((sum, item) => sum + (Number(item.jumlah_percobaan) || 0), 0);

    const riwayat = [
      ...pemilih.map(item => ({
        ...item,
        jenis_entry: 'pemilih',
        label_status: item.status ? 'Butuh Cek' : 'Data Masuk',
        catatan: item.status
          ? 'NIK kosong atau tidak valid. Perlu cek manual ke berkas fisik.'
          : 'Data sudah tersimpan di database pemilih.',
        waktu_input: item.created_at
      })),
      ...duplikat.map(item => ({
        ...item,
        tanggal_lahir: null,
        jenis_kelamin: null,
        umur: null,
        status: 'DUPLIKAT_LOG',
        jenis_entry: 'duplikat',
        label_status: 'Duplikat',
        catatan: `Bentrok dengan ${item.nama_existing || 'data yang sudah ada'} (${item.kaderExisting || '-'})`,
        waktu_input: item.waktu_terakhir
      }))
    ].sort((a, b) => {
      const timeA = new Date(a.waktu_input || 0).getTime();
      const timeB = new Date(b.waktu_input || 0).getTime();
      return timeB - timeA;
    });

    res.json({
      pemilih,
      duplikat,
      riwayat,
      summary: {
        pemilihLength: pemilih.length,
        totalBermasalah,
        totalDuplikatBaris,
        totalDuplikatPercobaan,
        totalBarisAudit: riwayat.length,
        totalAktivitas: pemilih.length + totalDuplikatPercobaan
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// DELETE /api/kader/:id/pemilih/clear
async function clearKaderPemilih(req, res) {
  try {
    const kaderId = req.params.id;
    
    const kaderCheck = await query('SELECT id FROM kader WHERE id = ?', [kaderId]);
    if (!kaderCheck.length) return res.status(404).json({ error: 'Kader tidak ditemukan' });

    const pemilihDalamKader = await query('SELECT nik FROM pemilih WHERE kader_id = ?', [kaderId]);
    
    const result = await query('DELETE FROM pemilih WHERE kader_id = ?', [kaderId]);
    await cleanupDuplicateLogs(pemilihDalamKader.map(p => p.nik));
    
    res.json({ 
      success: true,
      message: `Semua data pemilih dalam kader dihapus`,
      deletedCount: result.affectedRows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getKoordinator,
  addKoordinator,
  updateKoordinator,
  deleteKoordinator,
  getKaderDusunStats,
  getKaders,
  getKaderById,
  addKader,
  updateKader,
  deleteKader,
  getKaderPemilih,
  getKaderActivity,
  clearKaderPemilih
};
