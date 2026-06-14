const { query } = require('../db');

async function audit() {
  try {
    // 1. Total pemilih yang dikumpulkan kader
    const [totalPemilih] = await query('SELECT COUNT(*) AS total FROM pemilih');

    // 2. Total data TPS (KPU) yang sudah diupload
    const [totalTps] = await query('SELECT COUNT(*) AS total FROM data_tps');
    const tpsList = await query('SELECT nama_tps, COUNT(*) AS total FROM data_tps GROUP BY nama_tps ORDER BY nama_tps');

    // 3. Total hasil perbandingan
    const [totalHasil] = await query('SELECT COUNT(*) AS total FROM hasil_perbandingan');
    const [hasilBreakdown] = await query(`
      SELECT 
        COUNT(CASE WHEN status_cocok = 'COCOK' THEN 1 END) AS cocok,
        COUNT(CASE WHEN status_cocok = 'PERLU_DICEK' THEN 1 END) AS perlu_dicek,
        COUNT(CASE WHEN status_cocok = 'TIDAK_COCOK' THEN 1 END) AS tidak_cocok
      FROM hasil_perbandingan
    `);

    // 4. Pemilih yang sama sekali tidak ada di hasil_perbandingan
    const [unmatched] = await query(`
      SELECT COUNT(*) AS total
      FROM pemilih p
      LEFT JOIN hasil_perbandingan hp ON hp.pemilih_id = p.id
      WHERE hp.id IS NULL
    `);

    console.log('====== AUDIT DATA ======');
    console.log(`📋 Total pemilih dikumpulkan kader : ${totalPemilih.total}`);
    console.log(`📂 Total baris data TPS (KPU)     : ${totalTps.total}`);
    console.log(`📊 TPS yang diupload               : ${tpsList.length} TPS`);
    tpsList.forEach(t => console.log(`   - ${t.nama_tps}: ${t.total} baris`));
    console.log('');
    console.log(`🔄 Total entri hasil perbandingan  : ${totalHasil.total}`);
    console.log(`   ✅ COCOK      : ${hasilBreakdown.cocok}`);
    console.log(`   ⚠️  PERLU_DICEK: ${hasilBreakdown.perlu_dicek}`);
    console.log(`   ❌ TIDAK_COCOK: ${hasilBreakdown.tidak_cocok}`);
    console.log('');
    console.log(`❓ Pemilih tanpa hasil perbandingan: ${unmatched.total} (BELUM_DIBANDINGKAN)`);
    console.log('======================');

    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
}
audit();
