const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host     : '127.0.0.1',
  port     : process.env.DB_PORT     || 3306,
  user     : process.env.DB_USER     || 'root',
  password : process.env.DB_PASSWORD || '',
  database : process.env.DB_NAME     || 'pendataan_pemilih',
  waitForConnections: true,
  connectionLimit   : 1,
  charset           : 'utf8mb4'
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function check() {
  try {
    console.log("=== DIAGNOSTIK DATABASE ===");
    
    const [tpsCount] = await query("SELECT COUNT(*) AS total FROM data_tps");
    const [pemilihCount] = await query("SELECT COUNT(*) AS total FROM pemilih");
    const [hasilCount] = await query("SELECT COUNT(*) AS total FROM hasil_perbandingan");
    
    console.log(`1. Total Baris di data_tps (DPT Resmi Diupload): ${tpsCount.total}`);
    console.log(`2. Total Baris di pemilih (Database Lokal/Target Anda): ${pemilihCount.total}`);
    console.log(`3. Total Baris di hasil_perbandingan: ${hasilCount.total}`);
    
    const statusBreakdown = await query(`
      SELECT status_cocok, COUNT(*) AS jumlah 
      FROM hasil_perbandingan 
      GROUP BY status_cocok
    `);
    console.log("\n4. Breakdown Status di hasil_perbandingan:");
    statusBreakdown.forEach(row => {
      console.log(`   - ${row.status_cocok}: ${row.jumlah}`);
    });

    const multiMatched = await query(`
      SELECT pemilih_id, COUNT(*) AS match_count, p.nama
      FROM hasil_perbandingan hp
      JOIN pemilih p ON p.id = hp.pemilih_id
      WHERE pemilih_id IS NOT NULL
      GROUP BY pemilih_id
      HAVING match_count > 1
      ORDER BY match_count DESC
      LIMIT 10
    `);
    
    console.log("\n5. Pemilih lokal yang tercocokkan MULTIPLE TIMES (Ganda di TPS berbeda):");
    if (multiMatched.length === 0) {
      console.log("   (Tidak ada pemilih yang tercocokkan lebih dari sekali)");
    } else {
      console.log(`   Ditemukan ${multiMatched.length} pemilih ganda teratas:`);
      multiMatched.forEach(row => {
        console.log(`   - ${row.nama} (ID: ${row.pemilih_id}) cocok sebanyak ${row.match_count} kali di baris TPS yang berbeda!`);
      });
    }

    const [uniqueMatchedPemilih] = await query(`
      SELECT COUNT(DISTINCT pemilih_id) AS total 
      FROM hasil_perbandingan 
      WHERE pemilih_id IS NOT NULL AND status_cocok IN ('COCOK', 'PERLU_DICEK')
    `);
    console.log(`\n6. Jumlah Pemilih Unik dari database Anda yang berhasil tercocokkan (COCOK/PERLU_DICEK): ${uniqueMatchedPemilih.total} dari ${pemilihCount.total}`);

    // Check duplicate rows in data_tps (same name, rt, rw, tps)
    const tpsDuplicates = await query(`
      SELECT nama, rt, rw, nama_tps, COUNT(*) AS c
      FROM data_tps
      GROUP BY nama, rt, rw, nama_tps
      HAVING c > 1
      LIMIT 5
    `);
    console.log("\n7. Duplikat Data di dalam data_tps (Baris kembar dalam file Excel yang sama):");
    if (tpsDuplicates.length === 0) {
      console.log("   (Tidak ada baris kembar persis di data_tps)");
    } else {
      tpsDuplicates.forEach(row => {
        console.log(`   - "${row.nama}" (RT ${row.rt}/RW ${row.rw}) di TPS ${row.nama_tps} muncul sebanyak ${row.c} kali!`);
      });
    }

  } catch (err) {
    console.error("Error running diagnostics:", err);
  } finally {
    await pool.end();
  }
}

check();
