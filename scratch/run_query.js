const { query } = require('../db');

async function test() {
  try {
    const totalTps = await query("SELECT COUNT(*) AS c FROM data_tps");
    console.log("Total data_tps records in database:", totalTps[0].c);

    const totalHasil = await query("SELECT COUNT(*) AS c FROM hasil_perbandingan");
    console.log("Total hasil_perbandingan records:", totalHasil[0].c);

    const dupHasil = await query("SELECT data_tps_id, COUNT(*) AS c FROM hasil_perbandingan GROUP BY data_tps_id HAVING c > 1");
    console.log("Duplicate data_tps_id count:", dupHasil.length);

    const stats = await query(`
      SELECT 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          ELSE 'Lainnya'
        END AS dusun,
        COUNT(dt.id) AS total_pemilih_tps
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
      GROUP BY 1
    `);
    console.log("Query stats output:", stats);
  } catch (e) {
    console.error(e);
  }
}
test();
