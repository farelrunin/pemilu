const { query } = require('../db');

// Standardized names from the map's dusunMapping keys
const allowedDusuns = new Set([
  'babadan',
  'karang anom',
  'karanganom',
  'karang tengah',
  'karangtengah',
  'nglengis',
  'mojosari',
  'karang ploso',
  'karangploso',
  'pager gunung 1',
  'pager gunung 2',
  'pagergunung 1',
  'pagergunung 2',
  'nganyang',
  'banyakan 1',
  'banyakan 2',
  'banyakan 3',
  'banyakan',
  'ngablak',
  'ngampon',
  'padangan',
  'cepoko',
  'cepokojajar',
  'kuden',
  'monggang',
  'somokaton',
  'madugondo',
  'gondosari somokaton',
  'gondobari somokaton',
  'gondosari-somokaton',
  'gondosari',
  'gondobari',
  'karang gayam',
  'karanggayam',
  'k. gayam',
  'k. ploso',
  'p. gunung 1',
  'p. gunung 2',
  'sitimulyo',
  'alamat umum (belum terinci)'
]);

async function runAudit() {
  console.log('=== PEMULAIAN AUDIT DATA PETA ===\n');

  try {
    // 1. Total records overview
    const [pemilihCount] = await query('SELECT COUNT(*) AS total FROM pemilih');
    const [dupLogCount] = await query('SELECT COUNT(*) AS total FROM log_duplikat');
    
    let sumPercobaan = 0;
    try {
      const [sumRow] = await query('SELECT COALESCE(SUM(jumlah_percobaan), 0) AS total FROM log_duplikat');
      sumPercobaan = Number(sumRow.total);
    } catch (_) {
      sumPercobaan = dupLogCount.total;
    }

    console.log(`[STATUS OVERVIEW]`);
    console.log(`Total Pemilih di tabel 'pemilih': ${pemilihCount.total}`);
    console.log(`Total Entri Log Duplikat unik: ${dupLogCount.total}`);
    console.log(`Total Percobaan Duplikat (Spam): ${sumPercobaan}`);
    console.log(`Jumlah total aktivitas (Pemilih + Percobaan Duplikat): ${pemilihCount.total + sumPercobaan}\n`);

    // 2. Audit Data Yatim (Orphan) - No valid kader_id
    const orphans = await query(`
      SELECT p.id, p.nama, p.nik, p.kader_id
      FROM pemilih p
      LEFT JOIN kader k ON p.kader_id = k.id
      WHERE p.kader_id IS NULL OR k.id IS NULL
    `);
    console.log(`[AUDIT DATA YATIM]`);
    console.log(`Ditemukan ${orphans.length} pemilih tanpa kader yang valid.`);
    if (orphans.length > 0) {
      console.log('Contoh data yatim:', orphans.slice(0, 5));
    }
    console.log('');

    // 3. Audit Dusun Kosong / Tidak Terdaftar di Map
    const unmappedVoters = await query(`
      SELECT p.id, p.nama, k.nama AS namaKader, k.dusun
      FROM pemilih p
      JOIN kader k ON p.kader_id = k.id
    `);

    let unmappedCount = 0;
    const unmappedDusunGroups = {};

    unmappedVoters.forEach(v => {
      const dusunClean = String(v.dusun || '').toLowerCase().trim();
      if (!dusunClean || !allowedDusuns.has(dusunClean)) {
        unmappedCount++;
        unmappedDusunGroups[v.dusun] = (unmappedDusunGroups[v.dusun] || 0) + 1;
      }
    });

    console.log(`[AUDIT WILAYAH TIDAK TERPETA]`);
    console.log(`Ditemukan ${unmappedCount} pemilih berada di dusun yang tidak terdaftar di peta.`);
    if (unmappedCount > 0) {
      console.log('Daftar nama dusun yang tidak sinkron dan jumlah pemilihnya:', unmappedDusunGroups);
    }
    console.log('');

    // 4. Audit Data di Wilayah Putih (Gondosari, Karang Tengah, Monggang)
    console.log(`[AUDIT WILAYAH PUTIH (Gondosari, Karang Tengah, Monggang)]`);
    
    const checkWhiteAreas = await query(`
      SELECT 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari', 'gondosari somokaton', 'gondosari-somokaton', 'gondosari') THEN 'Gondosari'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('karang tengah', 'karangtengah') THEN 'Karang Tengah'
          WHEN LOWER(TRIM(COALESCE(k.dusun, ''))) IN ('monggang') THEN 'Monggang'
          ELSE NULL
        END AS nama_wilayah,
        COUNT(p.id) AS total_pemilih
      FROM pemilih p
      JOIN kader k ON k.id = p.kader_id
      GROUP BY 1
      HAVING nama_wilayah IS NOT NULL
    `);
    
    console.log('Jumlah pemilih di wilayah putih berdasarkan tabel pemilih:', checkWhiteAreas);

    // Check KPU DPT (data_tps) for these white areas
    const tpsWhiteAreas = await query(`
      SELECT dusun, COUNT(*) AS total 
      FROM data_tps 
      WHERE LOWER(TRIM(dusun)) IN ('gondosari', 'karang tengah', 'karangtengah', 'monggang', 'gondobari')
      GROUP BY dusun
    `);
    console.log('Jumlah DPT (data_tps) KPU di wilayah putih:', tpsWhiteAreas);
    console.log('');

  } catch (err) {
    console.error('Gagal menjalankan audit:', err);
  }
}

runAudit();
