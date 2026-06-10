const { query } = require('../db');

// List of standard keys mapped to SVG elements
const dusunMappingKeys = new Set([
  'babadan', 'karang anom', 'karanganom', 'karang tengah', 'karangtengah',
  'nglengis', 'mojosari', 'karang ploso', 'karangploso', 'pager gunung 1',
  'pager gunung 2', 'pagergunung 1', 'pagergunung 2', 'nganyang', 'banyakan 1',
  'banyakan 2', 'banyakan 3', 'banyakan', 'ngablak', 'ngampon', 'padangan',
  'cepoko', 'cepokojajar', 'kuden', 'monggang', 'somokaton', 'madugondo',
  'gondosari somokaton', 'gondobari somokaton', 'gondosari-somokaton',
  'gondosari', 'gondobari', 'karang gayam', 'karanggayam', 'k. gayam',
  'k. ploso', 'p. gunung 1', 'p. gunung 2', 'sitimulyo', 'alamat umum (belum terinci)'
]);

async function validate() {
  console.log('==================================================');
  console.log('       RUNNING PRE-PUSH VALIDATION CHECKS         ');
  console.log('==================================================\n');

  let failed = false;

  try {
    // Check 1: NIK and NIK Status
    console.log('[Check 1/3] Memeriksa data pemilih tanpa kader/wilayah (Data Yatim)...');
    const orphans = await query(`
      SELECT p.id, p.nama, p.nik 
      FROM pemilih p
      LEFT JOIN kader k ON p.kader_id = k.id
      WHERE p.kader_id IS NULL OR k.id IS NULL
    `);
    
    if (orphans.length > 0) {
      console.error(`❌ GAGAL: Ditemukan ${orphans.length} data pemilih yatim (tanpa kader/wilayah valid):`);
      orphans.forEach(o => {
        console.error(`  - ID: ${o.id}, Nama: ${o.nama}, NIK: ${o.nik}`);
      });
      failed = true;
    } else {
      console.log('✅ BERHASIL: Semua data pemilih terelasi ke kader/wilayah dengan benar.\n');
    }

    // Check 2: Invalid/Unmapped Dusuns
    console.log('[Check 2/3] Memeriksa kecocokan nama wilayah dusun dengan standar peta...');
    const unmappedKaders = await query(`
      SELECT DISTINCT k.id, k.nama, k.dusun
      FROM kader k
    `);

    const invalidDusuns = [];
    unmappedKaders.forEach(k => {
      const cleanDusun = String(k.dusun || '').toLowerCase().trim();
      if (!cleanDusun || !dusunMappingKeys.has(cleanDusun)) {
        invalidDusuns.push(k);
      }
    });

    if (invalidDusuns.length > 0) {
      console.error(`❌ GAGAL: Ditemukan ${invalidDusuns.length} kader dengan nama dusun tidak dikenal oleh peta:`);
      invalidDusuns.forEach(k => {
        console.error(`  - Kader: ${k.nama} (ID: ${k.id}), Dusun di DB: "${k.dusun}"`);
      });
      failed = true;
    } else {
      console.log('✅ BERHASIL: Semua nama wilayah dusun kader terdaftar di mapping peta.\n');
    }

    // Check 3: Sum comparison (Database vs Map Data)
    console.log('[Check 3/3] Memeriksa sinkronisasi total database dengan data peta...');
    const [dbVotersResult] = await query('SELECT COUNT(*) AS total FROM pemilih');
    const dbTotal = dbVotersResult.total;

    // Get statistik-dusun data
    const mapStats = await query(`
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
          ELSE TRIM(COALESCE(k.dusun, ''))
        END AS dusun,
        COUNT(p.id) AS total_pemilih_tps
      FROM pemilih p
      LEFT JOIN kader k ON k.id = p.kader_id
      GROUP BY 1
    `);

    // Sum of map data
    let mapTotal = 0;
    mapStats.forEach(item => {
      mapTotal += item.total_pemilih_tps;
    });

    console.log(`- Total Pemilih di Database (tabel 'pemilih'): ${dbTotal}`);
    console.log(`- Total Pemilih di Agregasi Peta: ${mapTotal}`);

    if (dbTotal !== mapTotal) {
      console.error(`❌ GAGAL: Jumlah data database (${dbTotal}) tidak sinkron dengan agregasi peta (${mapTotal})!`);
      failed = true;
    } else {
      console.log('✅ BERHASIL: Total data database sinkron dengan data peta.\n');
    }

  } catch (err) {
    console.error('❌ GAGAL: Terjadi error saat query database:', err.message);
    failed = true;
  }

  console.log('==================================================');
  if (failed) {
    console.log('❌ VALIDASI PRE-PUSH GAGAL! Silakan perbaiki data.');
    console.log('==================================================');
    process.exit(1);
  } else {
    console.log('✅ SEMUA VALIDASI BERHASIL! Aman untuk di-push.');
    console.log('==================================================');
    process.exit(0);
  }
}

validate();
